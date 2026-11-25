package sitegen

import (
	"strconv"
	"strings"
	"unicode"
)

// slugger makes heading IDs the way GitHub does (github-slugger), so links like
// `file.md#section` that work on GitHub also work on the built site.
//
// The rules: lower-case the heading's text, drop everything that isn't a letter,
// number, mark, connector punctuation (`_`), hyphen or space, then turn each space
// into a hyphen. A repeated slug gets `-1`, `-2` and so on, in document order.
type slugger struct {
	seen map[string]int
}

func newSlugger() *slugger { return &slugger{seen: map[string]int{}} }

func (s *slugger) slug(text string) string {
	base := githubSlug(text)
	result := base
	for {
		if _, taken := s.seen[result]; !taken {
			break
		}
		s.seen[base]++
		result = base + "-" + strconv.Itoa(s.seen[base])
	}
	s.seen[result] = 0
	return result
}

func githubSlug(text string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(text) {
		switch {
		case r == ' ':
			b.WriteByte('-')
		case r == '-', unicode.IsLetter(r), unicode.IsNumber(r), unicode.IsMark(r), unicode.Is(unicode.Pc, r):
			b.WriteRune(r)
		}
	}
	return b.String()
}
