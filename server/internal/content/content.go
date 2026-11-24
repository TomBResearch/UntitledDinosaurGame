// Package content loads, validates and hashes the game content in data/ (ADR 0011).
package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/progression"
)

// Progression is data/progression.json.
type Progression struct {
	MaxLevel int               `json:"max_level"`
	MaxXP    int64             `json:"max_xp"`
	XPCurve  progression.Curve `json:"xp_curve"`
	Server   struct {
		TickHz int `json:"tick_hz"`
	} `json:"server"`
}

// Skill is one entry in data/skills.json.
type Skill struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
}

// Content is everything loaded from data/.
type Content struct {
	Progression Progression
	Skills      []Skill
	XP          *progression.Table
	// Regions are data/regions/*.region.json, sorted by id, exported from the Godot scenes (ADR 0004).
	// They're server-only and not part of Hash: the client has the scenes themselves.
	Regions []*navmesh.Region
	// Hash is a SHA-256 of the normalised data files. Clients send it in `hello`; a mismatch means "please refresh".
	Hash string
	// files holds each source file's normalised JSON, by path relative to data/.
	files map[string][]byte
}

// The files that are copied to the client as they are. Everything server-only is left out (ADR 0011).
var clientFiles = []string{"progression.json", "skills.json"}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,47}$`)
var skillGroups = map[string]bool{"combat": true, "gathering": true, "processing": true, "other": true}

// Load reads and validates data/. Every problem found is returned together, not just the first.
func Load(dir string) (*Content, error) {
	c := &Content{files: map[string][]byte{}}
	var problems []error
	if err := c.readJSON(dir, "progression.json", &c.Progression); err != nil {
		problems = append(problems, err)
	}
	var skills struct {
		Skills []Skill `json:"skills"`
	}
	if err := c.readJSON(dir, "skills.json", &skills); err != nil {
		problems = append(problems, err)
	}
	c.Skills = skills.Skills
	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}

	p := c.Progression
	if p.Server.TickHz < 1 || p.Server.TickHz > 60 {
		problems = append(problems, fmt.Errorf("progression.json: server.tick_hz must be 1..60, got %d", p.Server.TickHz))
	}
	table, err := progression.NewTable(p.XPCurve, p.MaxLevel, p.MaxXP)
	if err != nil {
		problems = append(problems, fmt.Errorf("progression.json: %w", err))
	}
	c.XP = table

	seen := map[string]bool{}
	for i, s := range c.Skills {
		switch {
		case !idPattern.MatchString(s.ID):
			problems = append(problems, fmt.Errorf("skills.json: skill %d has a bad id %q (lower-case letters, digits, underscores)", i, s.ID))
		case seen[s.ID]:
			problems = append(problems, fmt.Errorf("skills.json: duplicate id %q", s.ID))
		}
		seen[s.ID] = true
		if s.Name == "" {
			problems = append(problems, fmt.Errorf("skills.json: %q has no name", s.ID))
		}
		if !skillGroups[s.Group] {
			problems = append(problems, fmt.Errorf("skills.json: %q has unknown group %q", s.ID, s.Group))
		}
	}
	var regionProblems []error
	c.Regions, regionProblems = loadRegions(dir)
	problems = append(problems, regionProblems...)
	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}
	c.Hash = c.hash()
	return c, nil
}

// loadRegions reads and validates every regions/*.region.json, if there are any.
func loadRegions(dir string) ([]*navmesh.Region, []error) {
	paths, err := filepath.Glob(filepath.Join(dir, "regions", "*.region.json"))
	if err != nil {
		return nil, []error{err}
	}
	sort.Strings(paths)
	var regions []*navmesh.Region
	var problems []error
	for _, path := range paths {
		name := "regions/" + filepath.Base(path)
		raw, err := os.ReadFile(path)
		if err != nil {
			problems = append(problems, err)
			continue
		}
		r, err := navmesh.ParseRegion(raw)
		if err != nil {
			problems = append(problems, fmt.Errorf("%s: %w", name, err))
			continue
		}
		if want := strings.TrimSuffix(filepath.Base(path), ".region.json"); r.ID != want {
			problems = append(problems, fmt.Errorf("%s: region_id %q doesn't match the file name", name, r.ID))
		}
		regions = append(regions, r)
	}
	return regions, problems
}

// readJSON decodes one file strictly (unknown fields are errors) and keeps its normalised form for hashing.
func (c *Content) readJSON(dir, name string, into any) error {
	raw, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	c.files[name] = compact.Bytes()
	return nil
}

func (c *Content) hash() string {
	names := make([]string, 0, len(c.files))
	for n := range c.files {
		names = append(names, n)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, n := range names {
		fmt.Fprintf(h, "%s\x00%d\x00", n, len(c.files[n]))
		h.Write(c.files[n])
	}
	return hex.EncodeToString(h.Sum(nil))
}

// EmitClient writes the client-safe subset into dir (client/data/), plus content_hash.txt.
func (c *Content) EmitClient(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, name := range clientFiles {
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, c.files[name], "", "  "); err != nil {
			return err
		}
		pretty.WriteByte('\n')
		if err := os.WriteFile(filepath.Join(dir, name), pretty.Bytes(), 0o644); err != nil {
			return err
		}
	}
	return os.WriteFile(filepath.Join(dir, "content_hash.txt"), []byte(c.Hash+"\n"), 0o644)
}
