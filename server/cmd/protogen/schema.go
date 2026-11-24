package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// Kind is a field type's shape.
type Kind int

// The field kinds the schema supports. See protocol/messages.schema for their wire encoding.
const (
	KBool Kind = iota
	KU8
	KU16
	KU32
	KU64
	KI32
	KPos
	KString
	KList
	KEnum
	KStruct
)

var scalarKinds = map[string]Kind{
	"bool": KBool, "u8": KU8, "u16": KU16, "u32": KU32, "u64": KU64, "i32": KI32, "pos": KPos,
}

// Type is a field's type.
type Type struct {
	Kind     Kind
	Max      int     // string: max bytes; list: max elements
	Elem     *Type   // list element
	Name     string  // enum or struct name, as written
	Optional bool    // struct only: Name?
	Enum     *Enum   // resolved
	Struct   *Struct // resolved
}

// UsesFlag reports whether the field is stored as a bit in its struct's flag bytes.
func (t *Type) UsesFlag() bool { return t.Kind == KBool || (t.Kind == KStruct && t.Optional) }

// Field is one field of a struct or message.
type Field struct {
	Name string
	Type *Type
	Doc  []string
	Line int
	Flag int // bit index in the flag bytes, if Type.UsesFlag()
}

// Struct is a struct or a message (a struct with an id and a direction).
type Struct struct {
	Name       string // structs: CamelCase; messages: snake_case
	Doc        []string
	Fields     []*Field
	Line       int
	IsMessage  bool
	ID         int
	FromClient bool

	FlagBits int // number of flag fields

	maxSize       int // computed by resolve
	sizing, sized bool
}

// FlagBytes is how many flag bytes start the struct's encoding.
func (s *Struct) FlagBytes() int { return (s.FlagBits + 7) / 8 }

// MaxSize is the largest possible encoding of the struct's body, in bytes.
func (s *Struct) MaxSize() int { return s.maxSize }

// EnumValue is one named value of an enum.
type EnumValue struct {
	Name  string
	Value int
	Doc   []string
}

// Enum is a u8-backed enum. Values run 0..len-1 so decoders can range-check them.
type Enum struct {
	Name   string
	Doc    []string
	Values []EnumValue
	Line   int
}

// Schema is a parsed and resolved protocol schema.
type Schema struct {
	Enums    []*Enum
	Structs  []*Struct // non-message structs, in file order
	Messages []*Struct // in file order
	Hash     uint32
}

var (
	camelName  = regexp.MustCompile(`^[A-Z][A-Za-z0-9]*$`)
	snakeName  = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)
	listType   = regexp.MustCompile(`^list<\s*([A-Za-z0-9_]+\??)\s*,\s*([0-9]+)\s*>$`)
	stringType = regexp.MustCompile(`^string<\s*([0-9]+)\s*>$`)
	// Names used by the generated runtimes, which declarations must not reuse.
	reservedTypeNames = map[string]bool{
		"Message": true, "MsgID": true, "Direction": true, "Pos": true, "Proto": true,
		"Writer": true, "Reader": true, "Decoded": true, "Dir": true,
	}
	// GDScript keywords and names the generated GDScript classes already use.
	reservedFieldNames = map[string]bool{
		"and": true, "as": true, "assert": true, "await": true, "break": true, "breakpoint": true,
		"class": true, "class_name": true, "const": true, "continue": true, "elif": true, "else": true,
		"enum": true, "extends": true, "for": true, "func": true, "if": true, "in": true, "is": true,
		"match": true, "namespace": true, "not": true, "or": true, "pass": true, "preload": true,
		"return": true, "self": true, "signal": true, "static": true, "super": true, "trait": true,
		"var": true, "void": true, "when": true, "while": true, "yield": true,
		"message_id": true, "message_name": true, "direction": true, "max_body_size": true,
		"encode_body": true, "decode_body": true, "r": true, "w": true, "f": true, "n": true, "item": true,
	}
)

const (
	maxFlagBits  = 64
	maxStringLen = 1 << 16
	maxListLen   = 1 << 12
)

// Parse reads and resolves a schema.
func Parse(src io.Reader) (*Schema, error) {
	p := &parser{s: &Schema{}, names: map[string]int{}, ids: map[int]string{}}
	if err := p.parse(src); err != nil {
		return nil, err
	}
	if err := p.resolve(); err != nil {
		return nil, err
	}
	p.s.Hash = hashSchema(p.s)
	return p.s, nil
}

type parser struct {
	s     *Schema
	names map[string]int // declared names -> line
	ids   map[int]string // message ids -> name
	line  int
}

func (p *parser) errf(format string, args ...any) error {
	return fmt.Errorf("schema line %d: %s", p.line, fmt.Sprintf(format, args...))
}

func (p *parser) parse(src io.Reader) error {
	sc := bufio.NewScanner(src)
	var doc []string // comment lines waiting for the next declaration or field
	var curS *Struct // open struct or message
	var curE *Enum   // open enum
	for sc.Scan() {
		p.line++
		raw := sc.Text()
		code, comment, hasComment := strings.Cut(raw, "#")
		code = strings.TrimSpace(code)
		comment = strings.TrimSpace(comment)
		if code == "" {
			if hasComment && !strings.HasPrefix(comment, "#") {
				doc = append(doc, comment)
			} else {
				doc = nil // a blank line or a "##" section heading ends a doc comment
			}
			continue
		}
		if hasComment {
			doc = append(doc, comment) // a trailing comment adds to the doc
		}
		inBlock := curS != nil || curE != nil
		switch {
		case code == "}":
			if !inBlock {
				return p.errf("unexpected }")
			}
			if curS != nil && len(curS.Fields) == 0 && !curS.IsMessage {
				return p.errf("struct %s has no fields", curS.Name)
			}
			if curE != nil && len(curE.Values) == 0 {
				return p.errf("enum %s has no values", curE.Name)
			}
			curS, curE = nil, nil
		case inBlock && curE != nil:
			v, err := p.enumValue(code, curE)
			if err != nil {
				return err
			}
			v.Doc = doc
			curE.Values = append(curE.Values, v)
		case inBlock:
			f, err := p.field(code, curS)
			if err != nil {
				return err
			}
			f.Doc = doc
			curS.Fields = append(curS.Fields, f)
		default:
			s, e, err := p.decl(code)
			if err != nil {
				return err
			}
			if s != nil {
				s.Doc = doc
				curS = s
			} else {
				e.Doc = doc
				curE = e
			}
		}
		doc = nil
	}
	if err := sc.Err(); err != nil {
		return err
	}
	if curS != nil || curE != nil {
		return p.errf("missing } at end of file")
	}
	if len(p.s.Messages) == 0 {
		return p.errf("no messages")
	}
	return nil
}

func (p *parser) declare(name string) error {
	if line, dup := p.names[name]; dup {
		return p.errf("%s is already declared on line %d", name, line)
	}
	p.names[name] = p.line
	return nil
}

// decl parses "enum Name {", "struct Name {" or "message name = id client|server {".
func (p *parser) decl(code string) (*Struct, *Enum, error) {
	head, ok := strings.CutSuffix(code, "{")
	if !ok {
		return nil, nil, p.errf("expected a declaration ending in {, got %q", code)
	}
	words := strings.Fields(head)
	switch {
	case len(words) == 2 && words[0] == "enum":
		if !camelName.MatchString(words[1]) || reservedTypeNames[words[1]] {
			return nil, nil, p.errf("enum name %q must be CamelCase and not reserved", words[1])
		}
		if err := p.declare(words[1]); err != nil {
			return nil, nil, err
		}
		e := &Enum{Name: words[1], Line: p.line}
		p.s.Enums = append(p.s.Enums, e)
		return nil, e, nil
	case len(words) == 2 && words[0] == "struct":
		if !camelName.MatchString(words[1]) || reservedTypeNames[words[1]] {
			return nil, nil, p.errf("struct name %q must be CamelCase and not reserved", words[1])
		}
		if err := p.declare(words[1]); err != nil {
			return nil, nil, err
		}
		s := &Struct{Name: words[1], Line: p.line}
		p.s.Structs = append(p.s.Structs, s)
		return s, nil, nil
	case len(words) == 5 && words[0] == "message" && words[2] == "=":
		name := words[1]
		if !snakeName.MatchString(name) {
			return nil, nil, p.errf("message name %q must be snake_case", name)
		}
		if err := p.declare(name); err != nil {
			return nil, nil, err
		}
		if err := p.declare(camel(name)); err != nil {
			return nil, nil, p.errf("message %s clashes with a type name: %v", name, err)
		}
		id, err := strconv.Atoi(words[3])
		if err != nil || id < 1 || id > 255 {
			return nil, nil, p.errf("message id %q must be 1-255", words[3])
		}
		if other, dup := p.ids[id]; dup {
			return nil, nil, p.errf("message id %d is already used by %s", id, other)
		}
		p.ids[id] = name
		var fromClient bool
		switch words[4] {
		case "client":
			fromClient = true
		case "server":
		default:
			return nil, nil, p.errf("message direction must be client or server, got %q", words[4])
		}
		s := &Struct{Name: name, Line: p.line, IsMessage: true, ID: id, FromClient: fromClient}
		p.s.Messages = append(p.s.Messages, s)
		return s, nil, nil
	}
	return nil, nil, p.errf("can't parse declaration %q", code)
}

func (p *parser) enumValue(code string, e *Enum) (EnumValue, error) {
	name, val, ok := strings.Cut(code, "=")
	name, val = strings.TrimSpace(name), strings.TrimSpace(val)
	if !ok || !snakeName.MatchString(name) {
		return EnumValue{}, p.errf("expected \"snake_name = number\" in enum %s, got %q", e.Name, code)
	}
	n, err := strconv.Atoi(val)
	if err != nil || n != len(e.Values) {
		return EnumValue{}, p.errf("enum %s values must count up from 0: expected %s = %d", e.Name, name, len(e.Values))
	}
	if n > 255 {
		return EnumValue{}, p.errf("enum %s has more than 256 values", e.Name)
	}
	for _, v := range e.Values {
		if v.Name == name {
			return EnumValue{}, p.errf("enum %s has %s twice", e.Name, name)
		}
	}
	return EnumValue{Name: name, Value: n}, nil
}

func (p *parser) field(code string, s *Struct) (*Field, error) {
	name, typ, ok := strings.Cut(code, ":")
	name, typ = strings.TrimSpace(name), strings.TrimSpace(typ)
	if !ok || !snakeName.MatchString(name) {
		return nil, p.errf("expected \"snake_name: type\", got %q", code)
	}
	if reservedFieldNames[name] {
		return nil, p.errf("field name %q is reserved", name)
	}
	for _, f := range s.Fields {
		if f.Name == name {
			return nil, p.errf("%s has field %s twice", s.Name, name)
		}
	}
	t, err := p.typ(typ, false)
	if err != nil {
		return nil, err
	}
	f := &Field{Name: name, Type: t, Line: p.line}
	if t.UsesFlag() {
		f.Flag = s.FlagBits
		s.FlagBits++
		if s.FlagBits > maxFlagBits {
			return nil, p.errf("%s has more than %d bool and optional fields", s.Name, maxFlagBits)
		}
	}
	return f, nil
}

func (p *parser) typ(src string, inList bool) (*Type, error) {
	if k, ok := scalarKinds[src]; ok {
		if inList && k == KBool {
			return nil, p.errf("lists of bool aren't supported")
		}
		return &Type{Kind: k}, nil
	}
	if m := stringType.FindStringSubmatch(src); m != nil {
		n, _ := strconv.Atoi(m[1])
		if n < 1 || n > maxStringLen {
			return nil, p.errf("string length must be 1-%d", maxStringLen)
		}
		return &Type{Kind: KString, Max: n}, nil
	}
	if m := listType.FindStringSubmatch(src); m != nil {
		if inList {
			return nil, p.errf("lists of lists aren't supported")
		}
		n, _ := strconv.Atoi(m[2])
		if n < 1 || n > maxListLen {
			return nil, p.errf("list length must be 1-%d", maxListLen)
		}
		elem, err := p.typ(m[1], true)
		if err != nil {
			return nil, err
		}
		return &Type{Kind: KList, Max: n, Elem: elem}, nil
	}
	name, optional := strings.CutSuffix(src, "?")
	if camelName.MatchString(name) {
		if optional && inList {
			return nil, p.errf("lists of optional structs aren't supported")
		}
		// Enum or struct: resolved once the whole file is read.
		return &Type{Kind: KStruct, Name: name, Optional: optional}, nil
	}
	return nil, p.errf("unknown type %q", src)
}

// resolve links named types and computes sizes.
func (p *parser) resolve() error {
	enums := map[string]*Enum{}
	for _, e := range p.s.Enums {
		enums[e.Name] = e
	}
	structs := map[string]*Struct{}
	for _, s := range p.s.Structs {
		structs[s.Name] = s
	}
	var link func(t *Type, line int) error
	link = func(t *Type, line int) error {
		switch t.Kind {
		case KList:
			return link(t.Elem, line)
		case KStruct:
			if e := enums[t.Name]; e != nil {
				if t.Optional {
					return fmt.Errorf("schema line %d: enum %s can't be optional", line, t.Name)
				}
				t.Kind, t.Enum = KEnum, e
				return nil
			}
			if s := structs[t.Name]; s != nil {
				t.Struct = s
				return nil
			}
			return fmt.Errorf("schema line %d: unknown type %s", line, t.Name)
		}
		return nil
	}
	all := append(append([]*Struct{}, p.s.Structs...), p.s.Messages...)
	for _, s := range all {
		for _, f := range s.Fields {
			if err := link(f.Type, f.Line); err != nil {
				return err
			}
		}
	}
	for _, s := range all {
		if _, err := structSize(s); err != nil {
			return err
		}
	}
	return checkHello(p.s)
}

// checkHello enforces the hello contract: a server must always be able to read an old client's
// protocol hash, so hello keeps id 1, starts with protocol_hash: u32, and has no flag bytes.
func checkHello(s *Schema) error {
	for _, m := range s.Messages {
		if m.Name != "hello" {
			continue
		}
		if m.ID != 1 || !m.FromClient || m.FlagBits != 0 || len(m.Fields) == 0 ||
			m.Fields[0].Name != "protocol_hash" || m.Fields[0].Type.Kind != KU32 {
			return fmt.Errorf("schema line %d: hello must be \"message hello = 1 client\", start with "+
				"\"protocol_hash: u32\" and have no bool or optional fields", m.Line)
		}
		return nil
	}
	return fmt.Errorf("schema: message hello is missing")
}

func structSize(s *Struct) (int, error) {
	switch {
	case s.sized:
		return s.maxSize, nil
	case s.sizing:
		return 0, fmt.Errorf("schema line %d: struct %s contains itself", s.Line, s.Name)
	}
	s.sizing = true
	n := s.FlagBytes()
	for _, f := range s.Fields {
		fs, err := typeSize(f.Type)
		if err != nil {
			return 0, err
		}
		n += fs
	}
	s.maxSize, s.sized = n, true
	return n, nil
}

// typeSize is the largest encoding of a value of type t, in bytes.
func typeSize(t *Type) (int, error) {
	switch t.Kind {
	case KBool:
		return 0, nil
	case KU8, KEnum:
		return 1, nil
	case KU16:
		return 2, nil
	case KU32, KI32:
		return 5, nil
	case KU64:
		return 9, nil
	case KPos:
		return 15, nil
	case KString:
		return uvarintLen(uint64(t.Max)) + t.Max, nil
	case KList:
		es, err := typeSize(t.Elem)
		if err != nil {
			return 0, err
		}
		return uvarintLen(uint64(t.Max)) + t.Max*es, nil
	case KStruct:
		return structSize(t.Struct)
	}
	return 0, fmt.Errorf("unknown kind %d", t.Kind)
}

func uvarintLen(v uint64) int {
	n := 1
	for v >= 0x80 {
		v >>= 7
		n++
	}
	return n
}

// Canonical returns the schema without comments or formatting. The protocol hash is taken from
// it, so editing comments or whitespace doesn't change the protocol version.
func Canonical(s *Schema) string {
	var b strings.Builder
	for _, e := range s.Enums {
		fmt.Fprintf(&b, "enum %s{", e.Name)
		for _, v := range e.Values {
			fmt.Fprintf(&b, "%s=%d;", v.Name, v.Value)
		}
		b.WriteString("}\n")
	}
	fields := func(st *Struct) {
		for _, f := range st.Fields {
			fmt.Fprintf(&b, "%s:%s;", f.Name, typeString(f.Type))
		}
		b.WriteString("}\n")
	}
	for _, st := range s.Structs {
		fmt.Fprintf(&b, "struct %s{", st.Name)
		fields(st)
	}
	for _, m := range s.Messages {
		dir := "server"
		if m.FromClient {
			dir = "client"
		}
		fmt.Fprintf(&b, "message %s=%d %s{", m.Name, m.ID, dir)
		fields(m)
	}
	return b.String()
}

func typeString(t *Type) string {
	switch t.Kind {
	case KString:
		return fmt.Sprintf("string<%d>", t.Max)
	case KList:
		return fmt.Sprintf("list<%s,%d>", typeString(t.Elem), t.Max)
	case KEnum:
		return t.Name
	case KStruct:
		if t.Optional {
			return t.Name + "?"
		}
		return t.Name
	}
	for name, k := range scalarKinds {
		if k == t.Kind {
			return name
		}
	}
	return "?"
}

func hashSchema(s *Schema) uint32 {
	sum := sha256.Sum256([]byte(Canonical(s)))
	return binary.BigEndian.Uint32(sum[:4])
}

// camel turns snake_case into CamelCase, with Go initialisms: type_id -> TypeID, hp -> HP.
func camel(snake string) string {
	var b strings.Builder
	for _, part := range strings.Split(snake, "_") {
		switch part {
		case "id", "hp", "npc", "url", "utf8":
			b.WriteString(strings.ToUpper(part))
		default:
			b.WriteString(strings.ToUpper(part[:1]) + part[1:])
		}
	}
	return b.String()
}
