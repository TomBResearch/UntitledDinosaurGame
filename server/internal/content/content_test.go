package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const repoData = "../../../data"

func TestRepoDataIsValid(t *testing.T) {
	c, err := Load(repoData)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Skills) != 14 {
		t.Errorf("expected 14 skills (docs/design/skills.md), got %d", len(c.Skills))
	}
	if got := c.XP.XPForLevel(100); got != 6387165 {
		t.Errorf("level 100 needs %d XP, want 6387165", got)
	}
	if len(c.Hash) != 64 {
		t.Errorf("bad hash %q", c.Hash)
	}
}

func TestHashIgnoresFormattingButNotValues(t *testing.T) {
	dir := copyData(t)
	base := mustLoad(t, dir).Hash

	reformatted := strings.ReplaceAll(read(t, dir, "skills.json"), "\n", "\n\n  ")
	write(t, dir, "skills.json", reformatted)
	if got := mustLoad(t, dir).Hash; got != base {
		t.Error("whitespace changed the hash")
	}

	write(t, dir, "progression.json", strings.Replace(read(t, dir, "progression.json"), `"linear": 25`, `"linear": 26`, 1))
	if got := mustLoad(t, dir).Hash; got == base {
		t.Error("a value change didn't change the hash")
	}
}

func TestRejectsBadSkills(t *testing.T) {
	dir := copyData(t)
	write(t, dir, "skills.json", `{"skills": [
		{"id": "strength", "name": "Strength", "group": "combat"},
		{"id": "strength", "name": "Again", "group": "combat"},
		{"id": "Bad Id", "name": "", "group": "nonsense"}
	]}`)
	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, want := range []string{"duplicate id", "bad id", "no name", "unknown group"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %q, got: %v", want, err)
		}
	}
}

func TestRejectsUnknownFields(t *testing.T) {
	dir := copyData(t)
	write(t, dir, "progression.json", strings.Replace(read(t, dir, "progression.json"), `"max_level"`, `"max_levle": 1, "max_level"`, 1))
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "max_levle") {
		t.Fatalf("expected an unknown-field error, got %v", err)
	}
}

func TestRejectsBadWalkSpeed(t *testing.T) {
	for _, speed := range []string{"0", "-1", "100"} {
		dir := copyData(t)
		write(t, dir, "progression.json", strings.Replace(read(t, dir, "progression.json"), `"walk_speed_m_s": 4.0`, `"walk_speed_m_s": `+speed, 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "walk_speed_m_s") {
			t.Errorf("walk speed %s: expected an error, got %v", speed, err)
		}
	}
}

func TestValidatesRegions(t *testing.T) {
	dir := copyData(t)
	if err := os.Mkdir(filepath.Join(dir, "regions"), 0o755); err != nil {
		t.Fatal(err)
	}
	fixture := read(t, "../navmesh/testdata", "corridor.region.json")
	write(t, dir, "regions/corridor.region.json", fixture)
	c := mustLoad(t, dir)
	if len(c.Regions) != 1 || c.Regions[0].ID != "corridor" || c.Regions[0].Mesh.PolygonCount() != 4 {
		t.Fatalf("regions not loaded: %+v", c.Regions)
	}

	write(t, dir, "regions/misnamed.region.json", fixture)
	write(t, dir, "regions/broken.region.json", strings.Replace(fixture, `"format": 1`, `"format": 9`, 1))
	_, err := Load(dir)
	for _, want := range []string{"regions/misnamed.region.json: region_id \"corridor\" doesn't match", "regions/broken.region.json: region file: format 9"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("error should mention %q, got: %v", want, err)
		}
	}
}

func TestEmitClientWritesOnlyClientFiles(t *testing.T) {
	c := mustLoad(t, repoData)
	out := t.TempDir()
	if err := c.EmitClient(out); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(out)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if strings.Join(names, ",") != "content_hash.txt,progression.json,skills.json" {
		t.Errorf("unexpected client files: %v", names)
	}
	if strings.TrimSpace(read(t, out, "content_hash.txt")) != c.Hash {
		t.Error("content_hash.txt doesn't match")
	}
}

func copyData(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, n := range []string{"progression.json", "skills.json", "chat_filter.json"} {
		write(t, dir, n, read(t, repoData, n))
	}
	return dir
}

func mustLoad(t *testing.T, dir string) *Content {
	t.Helper()
	c, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func read(t *testing.T, dir, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func write(t *testing.T, dir, name, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRejectsBadChatSettings(t *testing.T) {
	for _, c := range []struct{ from, to, want string }{
		{`"radius_m": 40.0`, `"radius_m": 0`, "chat.radius_m"},
		{`"radius_m": 40.0`, `"radius_m": 500`, "chat.radius_m"},
		{`"max_chars": 120`, `"max_chars": 0`, "chat.max_chars"},
		{`"max_chars": 120`, `"max_chars": 121`, "chat.max_chars"},
	} {
		dir := copyData(t)
		write(t, dir, "progression.json", strings.Replace(read(t, dir, "progression.json"), c.from, c.to, 1))
		if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: expected an error mentioning %s, got %v", c.to, c.want, err)
		}
	}
}

func TestRejectsBadChatFilter(t *testing.T) {
	dir := copyData(t)
	write(t, dir, "chat_filter.json", `{"about": "", "substitutions": {"$": "s"}, "words": ["Rude"]}`)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "chat_filter.json") {
		t.Fatalf("expected a chat_filter.json error, got %v", err)
	}
	dir = copyData(t)
	write(t, dir, "chat_filter.json", `{"words": [], "substitutions": {}, "extra": 1}`)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "extra") {
		t.Fatalf("expected an unknown-field error, got %v", err)
	}
}

func TestChatFilterIsServerOnly(t *testing.T) {
	c := mustLoad(t, repoData)
	out := t.TempDir()
	if err := c.EmitClient(out); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(out, "chat_filter.json")); err == nil {
		t.Error("chat_filter.json was copied to the client")
	}
	text := []rune("oh sh1t")
	if n, _ := c.ChatFilter.Mask(text, nil); n != 1 {
		t.Errorf("the repo filter didn't mask %q", "oh sh1t")
	}
}
