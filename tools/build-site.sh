#!/usr/bin/env bash
# Builds the static site (ADR 0012) into build/site/ (git-ignored):
#   build/site/wiki/  the public wiki: published wiki pages only
#   build/site/dev/   all of docs/, plus a preview of every wiki page (drafts marked)
#
#   tools/build-site.sh                 # build
#   tools/build-site.sh --serve [port]  # build, then serve build/site on http://localhost:8070
#
# Fails if a published wiki page links into docs/ or to a draft, or on a broken link or
# anchor. See docs/operations/site.md.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$REPO_ROOT/server" && go run ./cmd/sitegen -root "$REPO_ROOT" -out "$REPO_ROOT/build/site")
if [[ "${1:-}" == "--serve" ]]; then
  port="${2:-8070}"
  echo "Serving http://localhost:$port/wiki/ and http://localhost:$port/dev/ (no password locally). Ctrl-C to stop."
  exec python3 -m http.server "$port" --bind 127.0.0.1 -d "$REPO_ROOT/build/site"
fi
