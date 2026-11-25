// Package names holds the character name rules (docs/architecture/backend.md, "Character names"):
// the shape of a name, and the filter that refuses offensive or staff-like names. Uniqueness is the
// database's job.
package names

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/chat"
)

// Min and Max are the length limits, in characters.
const (
	Min = 3
	Max = 12
)

// Why a name is refused.
var (
	ErrShape    = errors.New("names: 3-12 letters and numbers, with single spaces between words")
	ErrBlocked  = errors.New("names: not allowed")
	ErrReserved = errors.New("names: reserved")
)

// WellFormed reports whether name has the right shape: 3–12 characters, ASCII letters and digits,
// with single spaces between words and no space at either end. Plain ASCII keeps out look-alike
// letters from other alphabets, so nobody can pass for someone else.
func WellFormed(name string) bool {
	if len(name) < Min || len(name) > Max || name[0] == ' ' || name[len(name)-1] == ' ' {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == ' ' && name[i-1] != ' ':
		default:
			return false
		}
	}
	return true
}

// Lower is the name's case-folded form, used for uniqueness ("Ugg" and "ugg" are the same name).
func Lower(name string) string { return strings.ToLower(name) }

// FilterFile is data/name_filter.json.
type FilterFile struct {
	About            string            `json:"about"`
	Lookalikes       map[string]string `json:"lookalikes"`
	BlockedAnywhere  []string          `json:"blocked_anywhere"`
	BlockedWords     []string          `json:"blocked_words"`
	ReservedPrefixes []string          `json:"reserved_prefixes"`
	ReservedExact    []string          `json:"reserved_exact"`
}

// Filter applies the account platform's username rules to character names, plus the chat word list.
type Filter struct {
	lookalikes         map[byte]byte
	anywhere, prefixes []string
	words, exact       map[string]bool
	chat               *chat.Filter
}

var listWord = regexp.MustCompile(`^[a-z]{2,32}$`)

// NewFilter checks the lists and builds a filter. chatFilter may be nil.
func NewFilter(f FilterFile, chatFilter *chat.Filter) (*Filter, error) {
	nf := &Filter{lookalikes: map[byte]byte{}, words: map[string]bool{}, exact: map[string]bool{}, chat: chatFilter}
	for from, to := range f.Lookalikes {
		if len(from) != 1 || from[0] < '0' || from[0] > '9' || len(to) != 1 || to[0] < 'a' || to[0] > 'z' {
			return nil, fmt.Errorf("lookalikes: %q -> %q must be one digit to one letter a-z", from, to)
		}
		nf.lookalikes[from[0]] = to[0]
	}
	lists := []struct {
		name  string
		words []string
	}{{"blocked_anywhere", f.BlockedAnywhere}, {"blocked_words", f.BlockedWords},
		{"reserved_prefixes", f.ReservedPrefixes}, {"reserved_exact", f.ReservedExact}}
	for _, l := range lists {
		if len(l.words) == 0 {
			return nil, fmt.Errorf("%s is empty", l.name)
		}
		for _, w := range l.words {
			if !listWord.MatchString(w) {
				return nil, fmt.Errorf("%s: %q must be 2-32 lower-case letters a-z", l.name, w)
			}
		}
	}
	nf.anywhere, nf.prefixes = f.BlockedAnywhere, f.ReservedPrefixes
	for _, w := range f.BlockedWords {
		nf.words[w] = true
	}
	for _, w := range f.ReservedExact {
		nf.exact[w] = true
	}
	return nf, nil
}

// Check returns nil if name may be used (availability aside), or ErrShape, ErrBlocked or ErrReserved.
func (f *Filter) Check(name string) error {
	if !WellFormed(name) {
		return ErrShape
	}
	lower := Lower(name)
	joined := strings.ReplaceAll(lower, " ", "")
	squashed := f.undoLookalikes(joined)
	for _, w := range f.anywhere {
		if strings.Contains(squashed, w) || strings.Contains(joined, w) {
			return ErrBlocked
		}
	}
	// The whole name, and each part between spaces and digits.
	candidates := []string{squashed, joined}
	candidates = append(candidates, strings.FieldsFunc(lower, func(r rune) bool { return r == ' ' || (r >= '0' && r <= '9') })...)
	for _, c := range candidates {
		if f.words[c] {
			return ErrBlocked
		}
	}
	if f.chat != nil {
		text := []rune(name)
		if n, _ := f.chat.Mask(text, nil); n > 0 {
			return ErrBlocked
		}
	}
	for _, c := range candidates {
		if f.exact[c] {
			return ErrReserved
		}
	}
	for _, p := range f.prefixes {
		if strings.HasPrefix(squashed, p) {
			return ErrReserved
		}
	}
	return nil
}

func (f *Filter) undoLookalikes(s string) string {
	b := []byte(s)
	for i, c := range b {
		if to, ok := f.lookalikes[c]; ok {
			b[i] = to
		}
	}
	return string(b)
}
