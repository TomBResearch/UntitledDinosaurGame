#!/usr/bin/env bash
# The fast check (ADR 0009). Same as the CI fast lane. Run it before every push; target under 60 s.
#
#   tools/check.sh          # everything
#   tools/check.sh go       # Go only (format, vet, staticcheck, tests, data)
#   tools/check.sh godot    # data + Godot only (import, GUT)
#
# Env: GODOT (path to Godot 4.7.2; defaults to the Mac app), STATICCHECK (path, optional locally).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PART="${1:-all}"
START=$SECONDS
step() { printf '\n== %s (%ss)\n' "$1" "$((SECONDS - START))"; }

run_data() {
  step "Content data: validate and emit the client copy"
  (cd "$REPO_ROOT/server" && go run ./cmd/dataval -data ../data -emit-client ../client/data)
}

run_go() {
  cd "$REPO_ROOT/server"
  step "Go: format"
  unformatted="$(gofmt -l .)"
  if [[ -n "$unformatted" ]]; then
    echo "Not gofmt'ed (run: cd server && gofmt -w .):"; echo "$unformatted"; exit 1
  fi
  step "Go: vet"
  go vet ./...
  STATICCHECK="${STATICCHECK:-$(command -v staticcheck || true)}"
  if [[ -n "$STATICCHECK" ]]; then
    step "Go: staticcheck"
    "$STATICCHECK" ./...
  else
    echo "(staticcheck not installed locally; CI runs it. Install: go install honnef.co/go/tools/cmd/staticcheck@v0.8.2)"
  fi
  step "Go: tests"
  go test ./...
  cd "$REPO_ROOT"
}

run_godot() {
  GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
  [[ -x "$GODOT" ]] || { echo "Godot not found at $GODOT (set GODOT=...)" >&2; exit 1; }
  step "Godot: import"
  # Import exits 0 even on script errors, so scan its output.
  import_log="$("$GODOT" --headless --path "$REPO_ROOT/client" --import 2>&1 || true)"
  if grep -E "SCRIPT ERROR|Parse Error|ERROR:" <<<"$import_log" | grep -v "addons/gut"; then
    echo "Godot import reported errors (above)." >&2; exit 1
  fi
  step "Godot: GUT tests"
  "$GODOT" --headless --path "$REPO_ROOT/client" -s addons/gut/gut_cmdln.gd -gconfig=res://.gutconfig.json
}

case "$PART" in
  all) run_data; run_go; run_godot ;;
  go) run_data; run_go ;;
  godot) run_data; run_godot ;;
  *) echo "usage: tools/check.sh [all|go|godot]" >&2; exit 2 ;;
esac
printf '\nFast check passed in %ss.\n' "$((SECONDS - START))"
