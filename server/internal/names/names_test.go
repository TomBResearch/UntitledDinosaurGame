package names_test

import (
	"errors"
	"testing"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/names"
)

func TestWellFormed(t *testing.T) {
	for name, want := range map[string]bool{
		"Ugg": true, "Grug": true, "Big Ugg": true, "Ugg 2": true, "a1b": true, "Abcdefghijkl": true, "A B C D": true,
		"Ug": false, "Abcdefghijklm": false, " Ugg": false, "Ugg ": false, "Big  Ugg": false, "Ugg_2": false,
		"Ügg": false, "Uggа": false /* Cyrillic а */, "": false, "   ": false, "Ugg\t1": false, "Ugg!": false,
	} {
		if got := names.WellFormed(name); got != want {
			t.Errorf("WellFormed(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestFilter(t *testing.T) {
	data, err := content.Load("../../../data")
	if err != nil {
		t.Fatal(err)
	}
	f := data.NameFilter
	cases := map[string]error{
		// Fine, including words that contain a short blocked word.
		"Grug": nil, "Big Ugg": nil, "Class": nil, "Grape": nil, "Cocktail": nil, "Assassin": nil,
		"Hereward": nil,
		// The wrong shape.
		"Ug": names.ErrShape, "Big  Ugg": names.ErrShape,
		// Blocked anywhere, also with look-alike digits.
		"Shithead": names.ErrBlocked, "xFuckx": names.ErrBlocked, "Sh1thead": names.ErrBlocked, "Big Fuck": names.ErrBlocked,
		"Pa3do Man": names.ErrBlocked,
		// Strict on purpose, like the platform (the "Scunthorpe problem"): staff can rename.
		"Scunthor": names.ErrBlocked,
		// Blocked as a whole name or part.
		"Dick": names.ErrBlocked, "Big Dick": names.ErrBlocked, "Dick99": names.ErrBlocked, "Pr1ck": names.ErrBlocked,
		// The chat word list, as whole words.
		"Wanker": names.ErrBlocked, "Bastard Ugg": names.ErrBlocked,
		// Reserved.
		"Admin": names.ErrReserved, "Admin Grug": names.ErrReserved, "Adm1n": names.ErrReserved, "Mod": names.ErrReserved,
		"Staff Ugg": names.ErrReserved, "0wner": names.ErrReserved, "System": names.ErrReserved, "Mod 2": names.ErrReserved, "Mod Squad": names.ErrReserved,
	}
	for name, want := range cases {
		if got := f.Check(name); !errors.Is(got, want) {
			t.Errorf("Check(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestNewFilterRejectsBadLists(t *testing.T) {
	good := names.FilterFile{Lookalikes: map[string]string{"1": "i"}, BlockedAnywhere: []string{"abc"},
		BlockedWords: []string{"abc"}, ReservedPrefixes: []string{"abc"}, ReservedExact: []string{"abc"}}
	if _, err := names.NewFilter(good, nil); err != nil {
		t.Fatal(err)
	}
	bad := []func(*names.FilterFile){
		func(f *names.FilterFile) { f.Lookalikes = map[string]string{"x": "i"} },
		func(f *names.FilterFile) { f.Lookalikes = map[string]string{"1": "I"} },
		func(f *names.FilterFile) { f.BlockedWords = []string{"Abc"} },
		func(f *names.FilterFile) { f.ReservedExact = nil },
		func(f *names.FilterFile) { f.BlockedAnywhere = []string{"a b"} },
	}
	for i, mod := range bad {
		f := good
		mod(&f)
		if _, err := names.NewFilter(f, nil); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}
