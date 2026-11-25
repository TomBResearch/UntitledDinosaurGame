package sitegen

import (
	"bytes"
	"fmt"
	"html"
	"html/template"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// site is one of the two trees: the public wiki or the private dev docs.
type site struct {
	cfg      Config
	name     string // "wiki" or "dev": also the URL prefix and output folder
	public   bool
	order    []*page
	pages    map[string]*page  // repo path -> page in this site
	route    map[string]string // repo path -> output path, relative to the site root
	assets   map[string]string // repo path of a linked non-Markdown file -> output path
	nav      []navGroup
	warnings []string
}

func newSite(cfg Config, name string, public bool) *site {
	return &site{cfg: cfg, name: name, public: public, pages: map[string]*page{}, route: map[string]string{}, assets: map[string]string{}}
}

func (s *site) add(p *page, out string) {
	s.order = append(s.order, p)
	s.pages[p.path] = p
	s.route[p.path] = out
}

type navGroup struct {
	Title string
	Items []navItem
}

type navItem struct {
	Title   string
	Href    string // relative to the site root; made page-relative when rendered
	Current bool
	Draft   bool
}

type pageData struct {
	Site        string // "wiki" or "dev"
	Title       string
	Root        string // relative path to the site root, e.g. "../"
	Body        template.HTML
	Nav         []navGroup
	Updated     string
	Preview     bool   // a wiki page shown in /dev/
	Draft       bool   // ...and it's a draft
	PublicHref  string // for a published preview: the page's URL on /wiki/
	Source      string // repo path of the Markdown
	SourceURL   string
	Home        bool // the site's front page
	ComingSoon  bool // the public wiki has no published index yet
	ComingPages []navItem
}

// render turns one page into HTML for this site, rewriting its links.
func (s *site) render(p *page, tmpl *template.Template) ([]byte, Problems) {
	out := s.route[p.path]
	doc := parse(p.body)
	var problems Problems
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Link:
			dest, prob := s.link(p, string(n.Destination))
			n.Destination = []byte(dest)
			if prob != "" {
				problems = append(problems, prob)
			}
		case *ast.Image:
			dest, prob := s.link(p, string(n.Destination))
			n.Destination = []byte(dest)
			if prob != "" {
				problems = append(problems, prob)
			}
		}
		return ast.WalkContinue, nil
	})
	var body bytes.Buffer
	if err := markdown.Renderer().Render(&body, p.body, doc); err != nil {
		return nil, Problems{fmt.Sprintf("%s: %v", p.path, err)}
	}
	data := pageData{
		Site:    s.name,
		Title:   p.title,
		Root:    rootPrefix(out),
		Body:    template.HTML(body.String()),
		Nav:     s.navFor(out),
		Updated: p.fm["updated"],
		Source:  p.path,
		Home:    out == "index.html",
	}
	if s.cfg.RepoURL != "" {
		data.SourceURL = s.cfg.RepoURL + "/" + p.path
	}
	if !s.public && strings.HasPrefix(p.path, wikiDir+"/") {
		data.Preview = true
		data.Draft = !p.published()
		if p.published() {
			data.PublicHref = rootPrefix(out) + "../wiki/" + strings.TrimPrefix(out, previewDir+"/")
		}
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "page.html", data); err != nil {
		return nil, Problems{fmt.Sprintf("%s: theme: %v", p.path, err)}
	}
	return buf.Bytes(), problems
}

// link rewrites one link or image destination on page p. The second result is a
// problem that fails the build, written so an agent knows what to change.
func (s *site) link(p *page, dest string) (string, string) {
	if strings.HasPrefix(dest, "#") {
		if !p.ids[dest[1:]] {
			return dest, fmt.Sprintf("%s: link to %s, but %s has no heading with that anchor. Anchors follow GitHub's heading slugs (lower case, punctuation dropped, spaces become hyphens).", where(p, dest), dest, p.path)
		}
		return dest, ""
	}
	if strings.HasPrefix(dest, "/") {
		return dest, fmt.Sprintf("%s: absolute link %q. Use a relative link to the .md file (for example ../design/combat.md) so it works on GitHub and on the site.", where(p, dest), dest)
	}
	target, frag, ok := resolveRepoPath(p.path, dest)
	if !ok {
		return dest, "" // external (https:, mailto:) or empty
	}
	if strings.HasPrefix(target, "..") {
		return dest, fmt.Sprintf("%s: link %q points outside the repository.", where(p, dest), dest)
	}
	info, err := os.Stat(filepath.Join(s.cfg.Root, filepath.FromSlash(target)))
	if err != nil {
		return dest, fmt.Sprintf("%s: broken link %q: %s does not exist. Fix the path (python3 tools/check-links.py lists every broken link).", where(p, dest), dest, target)
	}
	if info.IsDir() {
		found := false
		for _, idx := range []string{"README.md", "index.md"} {
			if _, err := os.Stat(filepath.Join(s.cfg.Root, filepath.FromSlash(target), idx)); err == nil {
				target, found = target+"/"+idx, true
				break
			}
		}
		if !found {
			return dest, fmt.Sprintf("%s: link %q is a folder with no README.md or index.md. Link to a file instead.", where(p, dest), dest)
		}
	}
	fragment := ""
	if frag != "" {
		fragment = "#" + frag
	}
	out := s.route[p.path]
	inWiki := strings.HasPrefix(target, wikiDir+"/")
	if !s.public && strings.HasPrefix(p.path, wikiDir+"/") && !p.published() && !inWiki {
		s.warnings = append(s.warnings, fmt.Sprintf("%s: draft wiki page links to %s, outside wiki/. The build will fail when this page is published, so remove the link before publishing.", where(p, dest), target))
	}

	if to, ok := s.route[target]; ok {
		if frag != "" && !s.pages[target].ids[frag] {
			return dest, fmt.Sprintf("%s: link %q, but %s has no heading with the anchor #%s. Anchors follow GitHub's heading slugs; check the heading's spelling, or the -1 suffix on a repeated heading.", where(p, dest), dest, target, frag)
		}
		return relURL(out, to) + fragment, ""
	}

	isMD := strings.HasSuffix(target, ".md")
	inDocs := strings.HasPrefix(target, docsDir+"/")

	if s.public {
		switch {
		case inWiki && isMD:
			return dest, fmt.Sprintf("%s: this published wiki page links to %s, which is a draft. Drafts are not on the public wiki. Either publish %s (set `status: published`, only once the feature is in the game), or remove the link and leave the words as plain text.", where(p, dest), target, path.Base(target))
		case inWiki:
			return s.asset(out, target, strings.TrimPrefix(target, wikiDir+"/")) + fragment, ""
		case inDocs:
			return dest, fmt.Sprintf("%s: this published wiki page links to %s. The public wiki must never link into docs/ (ADR 0008, CLAUDE.md rule 6). Remove the link; if players need the information, put the player-facing part on a wiki page.", where(p, dest), target)
		default:
			return dest, fmt.Sprintf("%s: this published wiki page links to %s, outside wiki/. Public wiki pages can only link to other published wiki pages and to external https:// sites. Remove the link.", where(p, dest), target)
		}
	}

	// The dev site.
	switch {
	case inDocs && !isMD:
		return s.asset(out, target, strings.TrimPrefix(target, docsDir+"/")) + fragment, ""
	case inWiki && !isMD:
		return s.asset(out, target, previewDir+"/"+strings.TrimPrefix(target, wikiDir+"/")) + fragment, ""
	case s.cfg.RepoURL != "":
		return s.cfg.RepoURL + "/" + target + fragment, "" // CLAUDE.md, protocol/messages.schema and so on
	default:
		return dest, ""
	}
}

func (s *site) asset(from, target, out string) string {
	s.assets[target] = out
	return relURL(from, out)
}

// navFor makes the site's navigation relative to the page at out.
func (s *site) navFor(out string) []navGroup {
	groups := make([]navGroup, len(s.nav))
	for i, g := range s.nav {
		groups[i] = navGroup{Title: g.Title, Items: make([]navItem, len(g.Items))}
		for j, it := range g.Items {
			it.Current = it.Href == out
			it.Href = relURL(out, it.Href)
			groups[i].Items[j] = it
		}
	}
	return groups
}

// wikiNav lists wiki pages in this site: the index first, then in the order the wiki
// index links to them, then any others by title.
func wikiNav(s *site, wiki []*page, group string) []navGroup {
	rank := map[string]int{}
	for _, p := range wiki {
		if p.path == wikiDir+"/index.md" {
			for i, t := range p.mdTargets {
				if _, seen := rank[t]; !seen {
					rank[t] = i + 1
				}
			}
		}
	}
	rank[wikiDir+"/index.md"] = 0
	var pages []*page
	for _, p := range wiki {
		if _, ok := s.route[p.path]; ok {
			pages = append(pages, p)
		}
	}
	sort.SliceStable(pages, func(i, j int) bool {
		ri, iok := rank[pages[i].path]
		rj, jok := rank[pages[j].path]
		if iok != jok {
			return iok
		}
		if iok && ri != rj {
			return ri < rj
		}
		return pages[i].title < pages[j].title
	})
	var items []navItem
	if s.public {
		if _, ok := s.route[wikiDir+"/index.md"]; !ok {
			items = append(items, navItem{Title: "Wiki home", Href: "index.html"})
		}
	}
	for _, p := range pages {
		title := p.title
		if p.path == wikiDir+"/index.md" {
			title = "Wiki home"
		}
		items = append(items, navItem{Title: title, Href: s.route[p.path], Draft: !p.published()})
	}
	return []navGroup{{Title: group, Items: items}}
}

// docsNav groups docs pages by their top folder, in a reading order.
func docsNav(s *site, docs []*page) []navGroup {
	order := []string{"", "roadmap", "architecture", "design", "decisions", "operations", "agents"}
	byDir := map[string][]*page{}
	for _, p := range docs {
		rel := strings.TrimPrefix(p.path, docsDir+"/")
		dir := ""
		if i := strings.Index(rel, "/"); i >= 0 {
			dir = rel[:i]
		}
		if _, known := byDir[dir]; !known && !contains(order, dir) {
			order = append(order, dir)
		}
		byDir[dir] = append(byDir[dir], p)
	}
	var groups []navGroup
	for _, dir := range order {
		pages := byDir[dir]
		if len(pages) == 0 {
			continue
		}
		sort.Slice(pages, func(i, j int) bool {
			ii, jj := path.Base(pages[i].path) == "README.md", path.Base(pages[j].path) == "README.md"
			if ii != jj {
				return ii
			}
			return pages[i].path < pages[j].path
		})
		title := "Overview"
		if dir != "" {
			title = strings.ToUpper(dir[:1]) + dir[1:]
		}
		g := navGroup{Title: title}
		for _, p := range pages {
			t := p.title
			switch {
			case p.path == docsDir+"/README.md":
				t = "Docs home"
			case strings.HasSuffix(p.path, "/0000-template.md"):
				t = "ADR template"
			}
			g.Items = append(g.Items, navItem{Title: t, Href: s.route[p.path]})
		}
		groups = append(groups, g)
	}
	return groups
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// comingSoon is the public wiki's front page until wiki/index.md is published.
func (s *site) comingSoon(tmpl *template.Template) ([]byte, error) {
	nav := s.navFor("index.html")
	var pages []navItem
	for _, g := range nav {
		for _, it := range g.Items {
			if it.Href != "index.html" {
				pages = append(pages, it)
			}
		}
	}
	var buf bytes.Buffer
	err := tmpl.ExecuteTemplate(&buf, "page.html", pageData{
		Site: s.name, Title: "The wiki is coming", Nav: nav, ComingSoon: true, ComingPages: pages,
	})
	return buf.Bytes(), err
}

// headingRenderer writes headings with their id and a small "#" link to the section.
type headingRenderer struct{}

func (headingRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindHeading, func(w util.BufWriter, _ []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
		n := node.(*ast.Heading)
		raw, _ := n.AttributeString("id")
		id, _ := raw.([]byte)
		esc := html.EscapeString(string(id))
		if entering {
			fmt.Fprintf(w, `<h%d id="%s">`, n.Level, esc)
		} else {
			fmt.Fprintf(w, `<a class="anchor" href="#%s" aria-label="Link to this section">#</a></h%d>`+"\n", esc, n.Level)
		}
		return ast.WalkContinue, nil
	})
}
