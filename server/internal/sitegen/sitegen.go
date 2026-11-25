// Package sitegen builds the static site from the repo's Markdown (ADR 0012):
//
//   - /wiki/: the public player wiki, published wiki pages only (ADR 0008).
//   - /dev/: all of docs/, plus a preview of every wiki page with drafts marked.
//
// The leak guard lives here: a published wiki page that links into docs/, to a draft
// wiki page, or anywhere else outside wiki/ fails the build.
package sitegen

import (
	"bytes"
	"fmt"
	"html/template"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Config says where to read from and write to.
type Config struct {
	Root    string // repository root (holds wiki/ and docs/)
	Out     string // output directory; Build replaces Out/wiki and Out/dev
	Theme   string // theme directory: page.html and site.css
	RepoURL string // links from /dev/ to other repo files go here, e.g. https://github.com/o/r/blob/main
}

// Stats summarises a successful build.
type Stats struct {
	WikiPublished int      // pages on the public wiki
	WikiDrafts    int      // drafts left off the public wiki (previewed in /dev/)
	DevPages      int      // pages in /dev/, wiki previews included
	Warnings      []string // things that will become errors later, such as a draft that links into docs/
}

// Problems is every reason a build failed, one per line, so an agent can fix them all in one go.
type Problems []string

func (p Problems) Error() string { return strings.Join(p, "\n") }

const (
	wikiDir    = "wiki"
	docsDir    = "docs"
	previewDir = "wiki-preview" // where /dev/ puts the wiki preview
)

type page struct {
	path      string // repo-relative with forward slashes, e.g. "wiki/bank.md"
	fm        frontMatter
	body      []byte
	bodyLine  int // lines of front matter before body
	title     string
	ids       map[string]bool
	mdTargets []string // repo paths of the .md files this page links to, in order
}

func (p *page) published() bool { return p.fm["status"] == statusPublished }

// Build reads wiki/ and docs/ under cfg.Root and writes cfg.Out/wiki and cfg.Out/dev.
// On failure it returns Problems and leaves no half-written site behind.
func Build(cfg Config) (*Stats, error) {
	tmpl, err := template.ParseFiles(filepath.Join(cfg.Theme, "page.html"))
	if err != nil {
		return nil, fmt.Errorf("theme: %w", err)
	}
	css, err := os.ReadFile(filepath.Join(cfg.Theme, "site.css"))
	if err != nil {
		return nil, fmt.Errorf("theme: %w", err)
	}

	var problems Problems
	wiki, p1 := loadPages(cfg.Root, wikiDir, true)
	docs, p2 := loadPages(cfg.Root, docsDir, false)
	problems = append(problems, p1...)
	problems = append(problems, p2...)
	if len(problems) > 0 {
		return nil, problems
	}

	public := newSite(cfg, "wiki", true)
	dev := newSite(cfg, "dev", false)
	for _, p := range wiki {
		if p.published() {
			public.add(p, strings.TrimPrefix(htmlPath(p.path), wikiDir+"/"))
		}
		dev.add(p, previewDir+"/"+strings.TrimPrefix(htmlPath(p.path), wikiDir+"/"))
	}
	for _, p := range docs {
		out := strings.TrimPrefix(htmlPath(p.path), docsDir+"/")
		if strings.HasPrefix(out, previewDir+"/") {
			problems = append(problems, fmt.Sprintf("%s: docs/%s/ is reserved for the wiki preview in /dev/; rename the folder", p.path, previewDir))
			continue
		}
		dev.add(p, out)
	}
	if len(problems) > 0 {
		return nil, problems
	}

	public.nav = wikiNav(public, wiki, "")
	dev.nav = append(docsNav(dev, docs), wikiNav(dev, wiki, "Wiki preview")...)

	stats := &Stats{DevPages: len(dev.order)}
	for _, p := range wiki {
		if p.published() {
			stats.WikiPublished++
		} else {
			stats.WikiDrafts++
		}
	}

	files := map[string][]byte{}
	for _, s := range []*site{public, dev} {
		files[s.name+"/assets/site.css"] = css
		for _, p := range s.order {
			html, probs := s.render(p, tmpl)
			problems = append(problems, probs...)
			files[s.name+"/"+s.route[p.path]] = html
		}
		for src, out := range s.assets {
			b, err := os.ReadFile(filepath.Join(cfg.Root, filepath.FromSlash(src)))
			if err != nil {
				problems = append(problems, err.Error())
				continue
			}
			files[s.name+"/"+out] = b
		}
		stats.Warnings = append(stats.Warnings, s.warnings...)
	}
	if _, ok := public.route[wikiDir+"/index.md"]; !ok {
		html, err := public.comingSoon(tmpl)
		if err != nil {
			problems = append(problems, err.Error())
		}
		files["wiki/index.html"] = html
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		return nil, problems
	}
	return stats, writeTree(cfg.Out, files)
}

// loadPages reads every .md file under root/dir, parses it once for its title,
// heading IDs and links, and checks wiki front matter.
func loadPages(root, dir string, wiki bool) ([]*page, Problems) {
	var pages []*page
	var problems Problems
	err := filepath.WalkDir(filepath.Join(root, dir), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".md") {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		fm, body, bodyLine, err := splitFrontMatter(src)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", rel, err))
			return nil
		}
		if wiki {
			for _, e := range checkWikiFrontMatter(fm) {
				problems = append(problems, fmt.Sprintf("%s: %s (every wiki page starts with title, status and updated; see wiki/index.md)", rel, e))
			}
		}
		pg := &page{path: rel, fm: fm, body: body, bodyLine: bodyLine, ids: map[string]bool{}}
		doc := parse(body)
		pg.title = fm["title"]
		ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
			if !entering {
				return ast.WalkContinue, nil
			}
			switch n := n.(type) {
			case *ast.Heading:
				id, _ := n.AttributeString("id")
				pg.ids[string(id.([]byte))] = true
				if pg.title == "" && n.Level == 1 {
					pg.title = plainText(n, body)
				}
			case *ast.Link:
				if t, _, ok := resolveRepoPath(pg.path, string(n.Destination)); ok && strings.HasSuffix(t, ".md") {
					pg.mdTargets = append(pg.mdTargets, t)
				}
			}
			return ast.WalkContinue, nil
		})
		if pg.title == "" {
			pg.title = strings.TrimSuffix(path.Base(rel), ".md")
		}
		pages = append(pages, pg)
		return nil
	})
	if err != nil {
		problems = append(problems, err.Error())
	}
	return pages, problems
}

var markdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(headingRenderer{}, 100))),
)

// parse parses Markdown and gives every heading a GitHub-style id.
func parse(body []byte) ast.Node {
	doc := markdown.Parser().Parse(text.NewReader(body))
	slugs := newSlugger()
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if h, ok := n.(*ast.Heading); ok && entering {
			h.SetAttributeString("id", []byte(slugs.slug(plainText(h, body))))
		}
		return ast.WalkContinue, nil
	})
	return doc
}

// plainText is a node's text as GitHub sees it for slugs: inline code included, markup dropped.
func plainText(n ast.Node, src []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := c.(type) {
		case *ast.Text:
			b.Write(t.Segment.Value(src))
			if t.SoftLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(t.Value)
		case *ast.AutoLink:
			b.Write(t.Label(src))
		case *ast.RawHTML:
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

var scheme = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)

// resolveRepoPath turns a relative link on the page at from into a cleaned repo path
// and its fragment. ok is false for external links, in-page anchors and absolute paths.
func resolveRepoPath(from, dest string) (target, frag string, ok bool) {
	if dest == "" || strings.HasPrefix(dest, "#") || strings.HasPrefix(dest, "/") || scheme.MatchString(dest) {
		return "", "", false
	}
	p, frag, _ := strings.Cut(dest, "#")
	if u, err := url.PathUnescape(p); err == nil {
		p = u
	}
	return path.Clean(path.Join(path.Dir(from), p)), frag, true
}

// htmlPath maps a Markdown path to its page: README.md and index.md become index.html.
func htmlPath(p string) string {
	dir, base := path.Split(p)
	if base == "README.md" || base == "index.md" {
		return dir + "index.html"
	}
	return dir + strings.TrimSuffix(base, ".md") + ".html"
}

// relURL is the relative URL from the page at from to the file at to (both site-relative).
func relURL(from, to string) string {
	r, err := filepath.Rel(filepath.FromSlash(path.Dir(from)), filepath.FromSlash(to))
	if err != nil {
		return to
	}
	return filepath.ToSlash(r)
}

// rootPrefix is the relative path from a page back to its site's root, such as "../".
func rootPrefix(out string) string {
	return strings.Repeat("../", strings.Count(out, "/"))
}

func writeTree(out string, files map[string][]byte) error {
	for _, dir := range []string{"wiki", "dev"} {
		if err := os.RemoveAll(filepath.Join(out, dir)); err != nil {
			return err
		}
	}
	for name, b := range files {
		p := filepath.Join(out, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// lineOf finds the source line of a link, for error messages. 0 means unknown.
func lineOf(p *page, dest string) int {
	i := bytes.Index(p.body, []byte("]("+dest))
	if i < 0 {
		return 0
	}
	return p.bodyLine + bytes.Count(p.body[:i], []byte("\n")) + 1
}

func where(p *page, dest string) string {
	if l := lineOf(p, dest); l > 0 {
		return fmt.Sprintf("%s:%d", p.path, l)
	}
	return p.path
}
