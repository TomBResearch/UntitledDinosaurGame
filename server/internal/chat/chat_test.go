package chat

import (
	"strings"
	"testing"
)

func TestClean(t *testing.T) {
	cases := []struct{ in, want string }{
		{"hello", "hello"},
		{"  hello   world  ", "hello world"},
		{"\thello\n\r\nworld\v", "hello world"},
		{"a\u00a0\u2003\u3000b", "a b"},        // no-break, em and ideographic spaces
		{"a\u2028b\u2029c", "a b c"},           // line and paragraph separators
		{"\x00a\x07b\x1bc\x7f\u0085", "abc"},   // C0 and C1 controls
		{"abc\u202edef\u202c", "abcdef"},       // right-to-left override
		{"\u2066a\u2067b\u2068c\u2069", "abc"}, // bidi isolates
		{"\u200ea\u200fb\u061c", "ab"},         // direction marks
		{"sh\u200bi\u200ct\u200d\u2060\ufeff", "shit"},
		{"soft\u00adhyphen", "softhyphen"},
		{"a \u200b b", "a b"},      // removing a zero-width space doesn't leave two spaces
		{"\u3164\u115f\u2800", ""}, // fillers that draw as nothing
		{"   ", ""},
		{"\u200b\u202e", ""},
		{"ünïcödé ✓ 恐竜", "ünïcödé ✓ 恐竜"},
		{"❤\ufe0f", "❤\ufe0f"}, // variation selectors stay
	}
	for _, c := range cases {
		if got := string(Clean(nil, c.in)); got != c.want {
			t.Errorf("Clean(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCleanAppends(t *testing.T) {
	got := Clean([]rune("x"), "  y  ")
	if string(got) != "xy" {
		t.Errorf("got %q: Clean shouldn't put a space after what dst already held", string(got))
	}
}

func testFilter(t *testing.T) *Filter {
	t.Helper()
	f, err := NewFilter([]string{"shit", "fuck", "fucking"},
		map[string]string{"@": "a", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t", "3": "e", "4": "a"})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestMask(t *testing.T) {
	f := testFilter(t)
	cases := []struct {
		in, want string
		n        int
	}{
		{"hello there", "hello there", 0},
		{"shit", "****", 1},
		{"Oh SHIT, a raptor", "Oh ****, a raptor", 1},
		{"sh1t $hit 5HI7 sh!t", "**** **** **** ****", 4},
		{"shit! shit!! !shit", "****! ****!! !****", 3},
		{"fuck fucking fucker", "**** ******* fucker", 2}, // only listed forms
		{"shitake mushroom", "shitake mushroom", 0},
		{"bullshit", "bullshit", 0}, // inside a longer word
		{"shit's", "****'s", 1},
		{"f.u.c.k", "f.u.c.k", 0},
		{"1337 $$$ 0", "1337 $$$ 0", 0},
		{"ＳＨＩＴ", "ＳＨＩＴ", 0}, // full-width letters aren't a-z after lower-casing
		{"🦖shit🦖", "🦖****🦖", 1},
		{"", "", 0},
	}
	for _, c := range cases {
		text := []rune(c.in)
		n, _ := f.Mask(text, nil)
		if got := string(text); got != c.want || n != c.n {
			t.Errorf("Mask(%q) = %q (%d words), want %q (%d)", c.in, got, n, c.want, c.n)
		}
		if len(text) != len([]rune(c.in)) {
			t.Errorf("Mask(%q) changed the length", c.in)
		}
	}
}

func TestMaskDoesNotAllocateOnceWarm(t *testing.T) {
	f := testFilter(t)
	text := []rune("well sh1t, a raptor is coming fast")
	buf := make([]byte, 0, 64)
	allocs := testing.AllocsPerRun(100, func() {
		_, buf = f.Mask(text, buf)
	})
	if allocs != 0 {
		t.Errorf("Mask allocates %v times a call", allocs)
	}
}

func TestNewFilterRejectsBadInput(t *testing.T) {
	bad := []struct {
		words []string
		subs  map[string]string
		want  string
	}{
		{[]string{"Shit"}, nil, "lower-case"},
		{[]string{"s"}, nil, "lower-case"},
		{[]string{"two words"}, nil, "lower-case"},
		{[]string{"shit", "shit"}, nil, "twice"},
		{nil, map[string]string{"a": "e"}, "isn't a letter"},
		{nil, map[string]string{"$$": "s"}, "isn't a letter"},
		{nil, map[string]string{" ": "s"}, "isn't a letter"},
		{nil, map[string]string{"": "s"}, "isn't a letter"},
		{nil, map[string]string{"$": "S"}, "one letter"},
		{nil, map[string]string{"$": "ss"}, "one letter"},
	}
	for _, b := range bad {
		if _, err := NewFilter(b.words, b.subs); err == nil || !strings.Contains(err.Error(), b.want) {
			t.Errorf("NewFilter(%q, %q): want an error mentioning %q, got %v", b.words, b.subs, b.want, err)
		}
	}
}
