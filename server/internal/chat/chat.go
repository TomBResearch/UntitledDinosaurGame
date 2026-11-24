// Package chat cleans and filters chat text (docs/architecture/world-server.md, "Local chat"). It has
// no state of its own, so one Filter can be shared by every region goroutine.
package chat

import (
	"fmt"
	"regexp"
	"unicode"
	"unicode/utf8"
)

// Clean appends text to dst with its whitespace tidied and its invisible characters removed, and
// returns dst:
//   - every run of whitespace becomes one space, and there's none at either end;
//   - control characters (Cc) and format characters (Cf) are dropped. Cf holds the bidi controls that
//     could reverse text (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F) and the zero-width ones that
//     could hide or split it (U+200B–U+200D, U+2060, U+FEFF, the soft hyphen U+00AD);
//   - a few letters that draw as nothing (Hangul fillers, the blank Braille pattern) count as
//     whitespace, so they can't make an empty-looking line.
//
// Dropping U+200D splits emoji joined with it (a family shows as its people); that's the price of
// not letting it hide text. Variation selectors (U+FE0F) are kept, so emoji keep their colour.
func Clean(dst []rune, text string) []rune {
	start := len(dst)
	space := false
	for _, r := range text {
		switch {
		case unicode.IsSpace(r) || blank(r):
			space = len(dst) > start
		case unicode.In(r, unicode.Cc, unicode.Cf):
			// dropped
		default:
			if space {
				dst = append(dst, ' ')
				space = false
			}
			dst = append(dst, r)
		}
	}
	return dst
}

func blank(r rune) bool {
	switch r {
	case '\u115f', '\u1160', '\u3164', '\uffa0', '\u2800':
		return true
	}
	return false
}

// Filter masks listed words with '*'. A word matches a whole word of chat (a run of letters, digits
// and substitution symbols), case-insensitively, once each substitution symbol is read as its letter:
// with "$" → "s" and "1" → "i", "$h1t" matches "shit". Symbols and digits at either end of a word are
// also tried without, so "shit!" masks as "****!". Words inside longer words never match ("shitake").
type Filter struct {
	words map[string]struct{}
	subs  map[rune]rune
}

var wordPattern = regexp.MustCompile(`^[a-z]{2,32}$`)

// NewFilter makes a filter. Words are 2–32 lower-case letters a–z. Each substitution maps one
// character that isn't a letter to one letter a–z.
func NewFilter(words []string, subs map[string]string) (*Filter, error) {
	f := &Filter{words: make(map[string]struct{}, len(words)), subs: make(map[rune]rune, len(subs))}
	for _, w := range words {
		if !wordPattern.MatchString(w) {
			return nil, fmt.Errorf("word %q must be 2-32 lower-case letters a-z", w)
		}
		if _, dup := f.words[w]; dup {
			return nil, fmt.Errorf("word %q is listed twice", w)
		}
		f.words[w] = struct{}{}
	}
	for from, to := range subs {
		fr, n := utf8.DecodeRuneInString(from)
		tr, m := utf8.DecodeRuneInString(to)
		switch {
		case n == 0 || n != len(from) || unicode.IsLetter(fr) || unicode.IsSpace(fr) || unicode.In(fr, unicode.Cc, unicode.Cf):
			return nil, fmt.Errorf("substitution %q: the symbol must be one visible character that isn't a letter", from)
		case m != len(to) || tr < 'a' || tr > 'z':
			return nil, fmt.Errorf("substitution %q: %q must be one letter a-z", from, to)
		}
		f.subs[fr] = tr
	}
	return f, nil
}

// Mask replaces every rune of each filtered word in text with '*', in place, and returns how many
// words it masked. The length in runes never changes. scratch is a buffer Mask may use; the grown
// buffer is returned so the caller can keep it.
func (f *Filter) Mask(text []rune, scratch []byte) (masked int, buf []byte) {
	buf = scratch
	for i := 0; i < len(text); {
		if !f.inWord(text[i]) {
			i++
			continue
		}
		j := i
		for j < len(text) && f.inWord(text[j]) {
			j++
		}
		var hit bool
		if hit, buf = f.matchWord(text[i:j], buf); hit {
			masked++
		}
		i = j
	}
	return masked, buf
}

func (f *Filter) inWord(r rune) bool {
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return true
	}
	_, ok := f.subs[r]
	return ok
}

// matchWord masks w if it, or w without the non-letters at its ends, is a listed word.
func (f *Filter) matchWord(w []rune, buf []byte) (bool, []byte) {
	lo, hi := 0, len(w)
	for lo < hi && !unicode.IsLetter(w[lo]) {
		lo++
	}
	for hi > lo && !unicode.IsLetter(w[hi-1]) {
		hi--
	}
	for _, span := range [4][2]int{{0, len(w)}, {0, hi}, {lo, len(w)}, {lo, hi}} {
		part := w[span[0]:span[1]]
		if len(part) < 2 {
			continue
		}
		buf = f.normalise(buf[:0], part)
		if _, ok := f.words[string(buf)]; ok {
			for k := range part {
				part[k] = '*'
			}
			return true, buf
		}
	}
	return false, buf
}

// normalise appends w lower-cased, with substitution symbols read as their letters.
func (f *Filter) normalise(dst []byte, w []rune) []byte {
	for _, r := range w {
		if s, ok := f.subs[r]; ok {
			r = s
		}
		dst = utf8.AppendRune(dst, unicode.ToLower(r))
	}
	return dst
}
