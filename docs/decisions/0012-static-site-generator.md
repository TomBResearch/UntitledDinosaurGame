# 0012: A small Go generator (`sitegen`) builds the wiki and docs site

**Status:** Accepted (2026-11-25)

## Context

[ADR 0008](0008-public-wiki-private-docs.md) publishes `wiki/` at `/wiki/` and `docs/` at `/dev/`, built by one static site generator chosen in M0. The generator has to:

- build quickly and reproducibly on the Mac and in CI, with nothing heavy to install (CI stays under 2 minutes, [ADR 0009](0009-fast-ci.md))
- read wiki front matter and put **only `status: published` pages** on `/wiki/`
- rewrite relative `.md` links to the built pages, in both trees
- render GitHub-flavoured tables and code blocks, with heading anchors that match **GitHub's slugs**, because the docs link to `file.md#section` (including GitHub's `-1` suffix for repeated headings)
- **fail the build** if a published wiki page links into `docs/` or to a draft (the leak guard for CLAUDE.md rule 6)
- show staff every wiki page, drafts included and clearly marked, so they can review drafts before publishing
- be easy for agents to keep using

## Decision

Write our own small generator in Go: `server/cmd/sitegen` (the command) and `server/internal/sitegen` (the code and its tests). It uses [goldmark](https://github.com/yuin/goldmark) with its GFM extension, Go's `html/template`, and a theme in `site/`.

- **Run it with `tools/build-site.sh`.** It writes `build/site/wiki/` and `build/site/dev/` (git-ignored) in about 20 ms, or under half a second with `go run`'s cached build. `tools/check.sh` (the Go part) and `docs.yml` both run it.
- **`/wiki/`** holds published wiki pages only. Until `wiki/index.md` is published, the front page is a friendly "the wiki is coming" page that lists any published pages.
- **`/dev/`** holds all of `docs/` (`README.md` becomes `index.html`), plus `/dev/wiki-preview/` with every wiki page. Drafts get a banner and a badge in the navigation. Links from docs to repo files outside `docs/` and `wiki/` (such as `CLAUDE.md` or `protocol/messages.schema`) go to the file on GitHub.
- **Heading ids follow github-slugger:** lower case, drop everything except letters, numbers, marks, `_`, `-` and spaces, turn each space into `-`, and add `-1`, `-2` to repeats. ids come from the heading's rendered text, so inline code counts and link markup doesn't.
- **The build fails, naming `file:line` and the fix, on:**
  - a published wiki page linking into `docs/`, to a draft wiki page, or to any other repo file outside `wiki/` (external `https://` links are fine)
  - any broken relative link, or a link to an anchor that doesn't exist, in either tree
  - wiki front matter without `title`, a `status` of `draft` or `published`, and `updated: YYYY-MM-DD`

  A failed build writes nothing. A draft that links into `docs/` only gets a warning, because it isn't public yet.
- **The output is self-contained:** system fonts only, no scripts, an inline SVG logo, and relative URLs, so the same files work under `/wiki/` and `/dev/`, from `python3 -m http.server`, or on any host. `/dev/` pages carry `noindex`. The output is deterministic, with no build timestamps.
- **Raw HTML in Markdown is not rendered** (goldmark's safe default), so a wiki page can't carry a script.
- **The `/dev/` password lives in Caddy, not in the generator.** See [operations/site.md](../operations/site.md).

### The generated XP table

`wiki/levels-and-xp.md` is ordinary Markdown with the table committed in it. The Go and GUT progression tests pin its anchor values to `data/progression.json`. sitegen renders it like any other page and never reads `data/`. When the planned `dataval --emit-wiki` step arrives ([content-pipeline.md](../architecture/content-pipeline.md#generated-outputs)), it will rewrite that table in the Markdown, which stays committed and is checked for staleness like the protocol codecs. So there is one input to the site (Markdown), the wiki stays readable on GitHub, and a changed number shows up in the diff.

## Consequences

- No new toolchain: Go is already installed everywhere the fast check runs. The only new dependency is goldmark, which is pure Go with no dependencies of its own.
- Leaks are caught by `tools/check.sh` locally and by `docs.yml` on every docs-only push, in well under a second.
- **Publishing a page means its links have to be publishable too.** For example, publishing `wiki/index.md` fails the build until every page it links to is published or the link is removed. That's deliberate: the public wiki never shows a link to something that isn't there.
- We own about 850 lines of generator, plus its tests. Features like search, a sitemap or syntax highlighting are ours to add if we want them.
- The theme is one template (`site/page.html`) and one stylesheet (`site/site.css`), so it's simple to restyle.

## Rejected

- **Hugo:** a single binary and very fast, but its draft handling (`draft: true`) doesn't match our `status` field without custom templates. Leak checks would need template logic or a separate script, heading ids differ from GitHub's unless configured, and every Mac and CI runner needs a pinned extra binary.
- **Zola:** the same trade-offs as Hugo. It also expects its own `content/` layout and `+++` TOML front matter, which would mean moving or duplicating `wiki/` and `docs/`.
- **MkDocs, Docusaurus, VitePress, Astro:** these add a Python or Node toolchain to CI and agents' machines for features we don't need. MkDocs' slugs don't match GitHub's by default either.
- **GitHub Pages or GitHub's own Markdown rendering:** it can't filter drafts or put `/dev/` behind a password, and it isn't served from our domain.
