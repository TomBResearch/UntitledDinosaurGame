package content

import (
	"fmt"
	"regexp"
)

// AppearanceFile is data/appearance.json: the choices a player has at character creation (open
// question S2, answered 2026-11-25). The client gets a copy to show them and draw the caveman.
type AppearanceFile struct {
	About       string         `json:"about"`
	Default     Look           `json:"default"`
	BodyTypes   []BodyType     `json:"body_types"`
	SkinTones   []ColourChoice `json:"skin_tones"`
	HairStyles  []Choice       `json:"hair_styles"`
	HairColours []ColourChoice `json:"hair_colours"`
	Beards      []Choice       `json:"beards"`
}

// Look is one character's appearance: the id of one choice from each list. It's the JSON the API
// stores and sends ({bodyType, skinTone, hairStyle, hairColour, beard}).
type Look struct {
	BodyType   string `json:"bodyType"`
	SkinTone   string `json:"skinTone"`
	HairStyle  string `json:"hairStyle"`
	HairColour string `json:"hairColour"`
	Beard      string `json:"beard"`
}

// Choice is a choice with no numbers: the client draws it by its id.
type Choice struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ColourChoice is a choice that is a colour (sRGB, "#rrggbb").
type ColourChoice struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Colour string `json:"colour"`
}

// BodyType scales the placeholder body: Width across, Height up.
type BodyType struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Appearance is the loaded choices, as sets of ids for checking a Look.
type Appearance struct {
	Default Look
	sets    [5]map[string]bool // in Look's field order
}

// Valid reports whether every part of the look is one of the choices in data/appearance.json.
func (a *Appearance) Valid(l Look) bool {
	for i, id := range l.parts() {
		if !a.sets[i][id] {
			return false
		}
	}
	return true
}

func (l Look) parts() [5]string {
	return [5]string{l.BodyType, l.SkinTone, l.HairStyle, l.HairColour, l.Beard}
}

// MaxAppearanceChoices is the most choices one list may have, so the creation screen stays usable.
const MaxAppearanceChoices = 16

var colourPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// appearanceIDPattern is the shape of an appearance id: up to 32 characters (the API's limit).
var appearanceIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// buildAppearance checks the file and returns the choices.
func buildAppearance(f AppearanceFile) (*Appearance, []error) {
	var problems []error
	bad := func(format string, args ...any) {
		problems = append(problems, fmt.Errorf("appearance.json: "+format, args...))
	}
	a := &Appearance{Default: f.Default}
	lists := [5]struct {
		key string
		ids []string
	}{{key: "body_types"}, {key: "skin_tones"}, {key: "hair_styles"}, {key: "hair_colours"}, {key: "beards"}}
	for _, b := range f.BodyTypes {
		lists[0].ids = append(lists[0].ids, b.ID)
		if b.Name == "" {
			bad("body type %q has no name", b.ID)
		}
		if !(b.Width >= 0.5 && b.Width <= 1.5) || !(b.Height >= 0.8 && b.Height <= 1.2) {
			bad("body type %q: width must be 0.5..1.5 and height 0.8..1.2, got %v and %v", b.ID, b.Width, b.Height)
		}
	}
	for _, cl := range []struct {
		li      int
		choices []ColourChoice
	}{{1, f.SkinTones}, {3, f.HairColours}} {
		li := cl.li
		for _, c := range cl.choices {
			lists[li].ids = append(lists[li].ids, c.ID)
			if c.Name == "" {
				bad("%s: %q has no name", lists[li].key, c.ID)
			}
			if !colourPattern.MatchString(c.Colour) {
				bad("%s: %q has a bad colour %q (want #rrggbb, lower case)", lists[li].key, c.ID, c.Colour)
			}
		}
	}
	for _, pl := range []struct {
		li      int
		choices []Choice
	}{{2, f.HairStyles}, {4, f.Beards}} {
		li := pl.li
		for _, c := range pl.choices {
			lists[li].ids = append(lists[li].ids, c.ID)
			if c.Name == "" {
				bad("%s: %q has no name", lists[li].key, c.ID)
			}
		}
	}
	for i, l := range lists {
		set := map[string]bool{}
		if len(l.ids) == 0 || len(l.ids) > MaxAppearanceChoices {
			bad("%s must have 1..%d choices, got %d", l.key, MaxAppearanceChoices, len(l.ids))
		}
		for _, id := range l.ids {
			switch {
			case !appearanceIDPattern.MatchString(id):
				bad("%s: bad id %q (lower-case letters, digits, underscores, up to 32)", l.key, id)
			case set[id]:
				bad("%s: duplicate id %q", l.key, id)
			}
			set[id] = true
		}
		a.sets[i] = set
	}
	if !a.Valid(f.Default) {
		bad("default %+v isn't made of listed choices", f.Default)
	}
	return a, problems
}
