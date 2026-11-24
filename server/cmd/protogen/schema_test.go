package main

import (
	"os"
	"strings"
	"testing"
)

const minimal = `
message hello = 1 client {
  protocol_hash: u32
}
`

func parse(t *testing.T, src string) (*Schema, error) {
	t.Helper()
	return Parse(strings.NewReader(src))
}

func TestTheRealSchemaGenerates(t *testing.T) {
	f, err := os.Open("../../../protocol/messages.schema")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s, err := Parse(f)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GenGo(s); err != nil {
		t.Fatal(err)
	}
	if len(GenGDScript(s)) == 0 {
		t.Fatal("empty GDScript")
	}
}

func TestCommentsAndSpacingDontChangeTheHash(t *testing.T) {
	a, err := parse(t, minimal)
	if err != nil {
		t.Fatal(err)
	}
	b, err := parse(t, "# a comment\nmessage   hello = 1 client {   # hi\n\n  protocol_hash:u32\n}\n")
	if err != nil {
		t.Fatal(err)
	}
	if a.Hash != b.Hash {
		t.Errorf("hash changed: %08x vs %08x", a.Hash, b.Hash)
	}
	c, err := parse(t, minimal+"message ping = 2 client {\n  t: u64\n}\n")
	if err != nil {
		t.Fatal(err)
	}
	if c.Hash == a.Hash {
		t.Error("adding a message didn't change the hash")
	}
}

func TestDocComments(t *testing.T) {
	s, err := parse(t, "## Section\n\n# Says hi.\nmessage hello = 1 client {\n  # The hash.\n  protocol_hash: u32 # trailing\n}\n")
	if err != nil {
		t.Fatal(err)
	}
	h := s.Messages[0]
	if strings.Join(h.Doc, "|") != "Says hi." || strings.Join(h.Fields[0].Doc, "|") != "The hash.|trailing" {
		t.Errorf("docs: %q, %q", h.Doc, h.Fields[0].Doc)
	}
}

func TestSizes(t *testing.T) {
	s, err := parse(t, minimal+`
struct P {
  a: bool
  b: u16
  c: list<pos, 3>
}
message m = 2 server {
  p: P?
  q: string<200>
  e: E
  ok: bool
}
enum E {
  x = 0
}
`)
	if err != nil {
		t.Fatal(err)
	}
	p, m := s.Structs[0], s.Messages[1]
	// P: 1 flag byte + u16 + (1 + 3*15). m: 1 flag byte + P + (2 + 200) + enum.
	if p.MaxSize() != 1+2+1+45 || m.MaxSize() != 1+49+202+1 {
		t.Errorf("sizes: P %d, m %d", p.MaxSize(), m.MaxSize())
	}
	if m.FlagBits != 2 || m.Fields[0].Flag != 0 || m.Fields[3].Flag != 1 {
		t.Errorf("flags: %d bits, p bit %d, ok bit %d", m.FlagBits, m.Fields[0].Flag, m.Fields[3].Flag)
	}
}

func TestSchemaErrors(t *testing.T) {
	cases := map[string]string{
		"no hello":           "message ping = 2 client {\n  t: u64\n}\n",
		"hello wrong id":     "message hello = 2 client {\n  protocol_hash: u32\n}\n",
		"hello wrong first":  "message hello = 1 client {\n  ticket: string<9>\n  protocol_hash: u32\n}\n",
		"hello with a bool":  "message hello = 1 client {\n  protocol_hash: u32\n  b: bool\n}\n",
		"duplicate id":       minimal + "message ping = 1 client {\n}\n",
		"duplicate name":     minimal + "message hello = 2 client {\n}\n",
		"bad direction":      minimal + "message ping = 2 both {\n}\n",
		"unknown type":       minimal + "message ping = 2 client {\n  x: Nope\n}\n",
		"unknown scalar":     minimal + "message ping = 2 client {\n  x: f32\n}\n",
		"self-containing":    minimal + "struct A {\n  a: A\n}\n",
		"enum gap":           minimal + "enum E {\n  a = 0\n  b = 2\n}\n",
		"optional enum":      minimal + "enum E {\n  a = 0\n}\nmessage m = 2 client {\n  e: E?\n}\n",
		"list of bool":       minimal + "message m = 2 client {\n  l: list<bool, 3>\n}\n",
		"list of optional":   minimal + "struct A {\n  x: u8\n}\nmessage m = 2 client {\n  l: list<A?, 3>\n}\n",
		"reserved field":     minimal + "message m = 2 client {\n  class: u8\n}\n",
		"reserved type":      minimal + "struct Writer {\n  x: u8\n}\n",
		"message vs struct":  minimal + "struct Ping {\n  x: u8\n}\nmessage ping = 2 client {\n}\n",
		"duplicate field":    minimal + "message m = 2 client {\n  a: u8\n  a: u8\n}\n",
		"unclosed":           minimal + "message m = 2 client {\n  a: u8\n",
		"camel message":      minimal + "message Ping = 2 client {\n}\n",
		"zero-length string": minimal + "message m = 2 client {\n  s: string<0>\n}\n",
	}
	for name, src := range cases {
		if _, err := parse(t, src); err == nil {
			t.Errorf("%s: parsed without error", name)
		}
	}
}

func TestCamel(t *testing.T) {
	for in, want := range map[string]string{"type_id": "TypeID", "hp": "HP", "path_started": "PathStarted", "tick_hz": "TickHz"} {
		if got := camel(in); got != want {
			t.Errorf("camel(%q) = %q, want %q", in, got, want)
		}
	}
}
