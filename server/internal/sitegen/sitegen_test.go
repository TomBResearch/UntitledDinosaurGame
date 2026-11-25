package sitegen

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitHubSlugs(t *testing.T) {
	s := newSlugger()
	for _, c := range []struct{ in, want string }{
		{"Region file format", "region-file-format"},
		{"Region file format", "region-file-format-1"},
		{"Region file format", "region-file-format-2"},
		{"Content data (data/)", "content-data-data"},
		{"Known gaps (affect every game)", "known-gaps-affect-every-game"},
		{"What goes where?", "what-goes-where"},
		{"Abilities 1–4", "abilities-14"},
		{"Don't panic: it's fine", "dont-panic-its-fine"},
		{"snake_case and Ünïcödé", "snake_case-and-ünïcödé"},
		{"Two  spaces", "two--spaces"},
		{"Dino 🦖 bones", "dino--bones"},
	} {
		if got := s.slug(c.in); got != c.want {
			t.Errorf("slug(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHeadingIDsUseRenderedText(t *testing.T) {
	src := []byte("# Title\n\n## Content data (`data/`)\n\n## A [linked](x.md) heading\n")
	doc := parse(src)
	var ids []string
	for n := doc.FirstChild(); n != nil; n = n.NextSibling() {
		if id, ok := n.AttributeString("id"); ok {
			ids = append(ids, string(id.([]byte)))
		}
	}
	want := []string{"title", "content-data-data", "a-linked-heading"}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Errorf("ids = %v, want %v", ids, want)
	}
}

func TestFrontMatter(t *testing.T) {
	fm, body, n, err := splitFrontMatter([]byte("---\ntitle: \"Bank: safe\"\nstatus: draft\nupdated: 2026-11-23\n---\n\n# Bank\n"))
	if err != nil {
		t.Fatal(err)
	}
	if fm["title"] != "Bank: safe" || fm["status"] != "draft" || n != 5 || string(body) != "\n# Bank\n" {
		t.Errorf("got fm=%v n=%d body=%q", fm, n, body)
	}
	if errs := checkWikiFrontMatter(frontMatter{"title": "X", "status": "publish", "updated": "23/11/2026"}); len(errs) != 2 {
		t.Errorf("want status and date errors, got %v", errs)
	}
	if _, _, _, err := splitFrontMatter([]byte("---\ntitle: x\n")); err == nil {
		t.Error("unclosed front matter should fail")
	}
}

// repo writes a tiny repository: files maps repo paths to contents.
func repo(t *testing.T, files map[string]string) Config {
	t.Helper()
	root := t.TempDir()
	for p, body := range files {
		full := filepath.Join(root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	theme, err := filepath.Abs("../../../site")
	if err != nil {
		t.Fatal(err)
	}
	return Config{Root: root, Out: filepath.Join(root, "build", "site"), Theme: theme, RepoURL: "https://example.invalid/blob/main"}
}

func wikiPage(title, status, body string) string {
	return "---\ntitle: " + title + "\nstatus: " + status + "\nupdated: 2026-11-24\n---\n\n# " + title + "\n\n" + body
}

func read(t *testing.T, cfg Config, p string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(cfg.Out, filepath.FromSlash(p)))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func exists(cfg Config, p string) bool {
	_, err := os.Stat(filepath.Join(cfg.Out, filepath.FromSlash(p)))
	return err == nil
}

func TestPublicWikiHasOnlyPublishedPages(t *testing.T) {
	cfg := repo(t, map[string]string{
		"wiki/index.md":            wikiPage("Wiki", "published", "- [Skills](skills.md#gathering)\n"),
		"wiki/skills.md":           wikiPage("Skills", "published", "## Gathering\n\nSee [the XP table](levels.md).\n\n| Level | XP |\n|---|---|\n| 2 | 75 |\n"),
		"wiki/levels.md":           "---\ntitle: Levels\nstatus: draft\nupdated: 2026-11-24\n---\n\n# Levels\n\nSecret stuff.\n",
		"docs/README.md":           "# Dev docs\n\nSee [the wiki](../wiki/index.md), [rules](../CLAUDE.md#rules) and [ADRs](decisions/).\n",
		"docs/decisions/README.md": "# Decisions\n\n[Back](../README.md#dev-docs)\n",
		"CLAUDE.md":                "# Guide\n",
	})
	// skills.md links to a draft, which must fail; fix that first and check the rest.
	_, err := Build(cfg)
	var problems Problems
	if !errors.As(err, &problems) || len(problems) != 1 || !strings.Contains(problems[0], "wiki/skills.md:11") || !strings.Contains(problems[0], "is a draft") {
		t.Fatalf("want one draft-link problem at wiki/skills.md:11, got %v", err)
	}

	if err := os.WriteFile(filepath.Join(cfg.Root, "wiki", "skills.md"), []byte(wikiPage("Skills", "published", "## Gathering\n\n| Level | XP |\n|---|---|\n| 2 | 75 |\n")), 0o644); err != nil {
		t.Fatal(err)
	}
	stats, err := Build(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if stats.WikiPublished != 2 || stats.WikiDrafts != 1 || stats.DevPages != 5 {
		t.Errorf("stats = %+v", stats)
	}
	if exists(cfg, "wiki/levels.html") {
		t.Error("draft page was published to /wiki/")
	}
	pub := read(t, cfg, "wiki/index.html")
	if !strings.Contains(pub, `href="skills.html#gathering"`) || strings.Contains(pub, "Levels") {
		t.Errorf("public index should link skills.html#gathering and never mention the draft:\n%s", pub)
	}
	if !strings.Contains(read(t, cfg, "wiki/skills.html"), "<table>") {
		t.Error("tables should render")
	}

	dev := read(t, cfg, "dev/index.html")
	for _, want := range []string{
		`href="wiki-preview/index.html"`,
		`href="https://example.invalid/blob/main/CLAUDE.md#rules"`,
		`href="decisions/index.html"`,
		`noindex`,
	} {
		if !strings.Contains(dev, want) {
			t.Errorf("dev index missing %s", want)
		}
	}
	if !strings.Contains(read(t, cfg, "dev/decisions/index.html"), `href="../index.html#dev-docs"`) {
		t.Error("dev link to ../README.md#dev-docs should become ../index.html#dev-docs")
	}
	draft := read(t, cfg, "dev/wiki-preview/levels.html")
	if !strings.Contains(draft, `class="banner draft"`) || !strings.Contains(draft, "Secret stuff") {
		t.Error("the draft should be previewed in /dev/ with a draft banner")
	}
	if !strings.Contains(read(t, cfg, "dev/wiki-preview/skills.html"), `href="../../wiki/skills.html"`) {
		t.Error("a published preview should link to its public page")
	}
}

func TestComingSoonIndexWhileNothingIsPublished(t *testing.T) {
	cfg := repo(t, map[string]string{
		"wiki/index.md":  wikiPage("Wiki", "draft", "- [Bank](bank.md)\n"),
		"wiki/bank.md":   wikiPage("Bank", "draft", "Keep stuff safe.\n"),
		"docs/README.md": "# Docs\n",
	})
	stats, err := Build(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if stats.WikiPublished != 0 || stats.WikiDrafts != 2 {
		t.Errorf("stats = %+v", stats)
	}
	idx := read(t, cfg, "wiki/index.html")
	if !strings.Contains(idx, "The wiki is coming") || strings.Contains(idx, "Bank") {
		t.Errorf("want the coming-soon page with no drafts listed:\n%s", idx)
	}
	if exists(cfg, "wiki/bank.html") {
		t.Error("draft page was published")
	}
}

func TestLeakGuard(t *testing.T) {
	for _, c := range []struct {
		name, body, want string
	}{
		{"docs", "Read [the formula](../docs/design/progression.md).\n", "must never link into docs/"},
		{"docs anchor", "Read [it](../docs/design/progression.md#curve).\n", "must never link into docs/"},
		{"draft", "See [the bank](bank.md).\n", "which is a draft"},
		{"outside", "See [data](../data/progression.json).\n", "outside wiki/"},
		{"broken", "See [nothing](nope.md).\n", "broken link"},
		{"anchor", "See [skills](skills.md#nope).\n", "no heading with the anchor #nope"},
		{"own anchor", "See [below](#nope).\n", "no heading with that anchor"},
		{"absolute", "See [it](/dev/index.html).\n", "absolute link"},
	} {
		t.Run(c.name, func(t *testing.T) {
			cfg := repo(t, map[string]string{
				"wiki/index.md":              wikiPage("Wiki", "published", c.body),
				"wiki/skills.md":             wikiPage("Skills", "published", "Skills.\n"),
				"wiki/bank.md":               wikiPage("Bank", "draft", "Bank.\n"),
				"docs/design/progression.md": "# Progression\n\n## Curve\n",
				"data/progression.json":      "{}\n",
				"docs/README.md":             "# Docs\n",
			})
			_, err := Build(cfg)
			if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), "wiki/index.md:") {
				t.Fatalf("want a problem containing %q at wiki/index.md:<line>, got %v", c.want, err)
			}
			if exists(cfg, "wiki/index.html") {
				t.Error("a failed build must not write the site")
			}
		})
	}
}

func TestDraftLinkingIntoDocsWarns(t *testing.T) {
	cfg := repo(t, map[string]string{
		"wiki/index.md":  wikiPage("Wiki", "draft", "See [the formula](../docs/x.md).\n"),
		"docs/x.md":      "# X\n",
		"docs/README.md": "# Docs\n",
	})
	stats, err := Build(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(stats.Warnings) != 1 || !strings.Contains(stats.Warnings[0], "wiki/index.md:9") {
		t.Errorf("want one warning at wiki/index.md:9, got %v", stats.Warnings)
	}
}

func TestBadFrontMatterFails(t *testing.T) {
	cfg := repo(t, map[string]string{
		"wiki/index.md":  "---\ntitle: Wiki\nstatus: publish\nupdated: 2026-11-24\n---\n\n# Wiki\n",
		"docs/README.md": "# Docs\n",
	})
	if _, err := Build(cfg); err == nil || !strings.Contains(err.Error(), "`status: publish`") {
		t.Fatalf("want a status problem, got %v", err)
	}
}

func TestAssetsAreCopied(t *testing.T) {
	cfg := repo(t, map[string]string{
		"wiki/index.md":    wikiPage("Wiki", "published", "![Map](img/map.png)\n"),
		"wiki/img/map.png": "png",
		"docs/README.md":   "# Docs\n\n![Diagram](arch.svg)\n",
		"docs/arch.svg":    "<svg/>",
	})
	if _, err := Build(cfg); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"wiki/img/map.png", "dev/arch.svg", "dev/wiki-preview/img/map.png"} {
		if !exists(cfg, p) {
			t.Errorf("%s was not copied", p)
		}
	}
}
