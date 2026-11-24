#!/usr/bin/env bash
# Exports region scenes to data/regions/<region_id>.region.json for the server (ADR 0004).
#
#   tools/export-regions.sh                       # every client/regions/<id>/region.tscn
#   tools/export-regions.sh test_greybox          # just these regions
#   tools/export-regions.sh --bake test_greybox   # re-bake the navmesh and save the scene first
#
# Commit the scene and its export together: the fast check fails if a scene's hash doesn't match
# the source_hash in its export. Env: GODOT (path to Godot 4.7.2; defaults to the Mac app).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
[[ -x "$GODOT" ]] || { echo "Godot not found at $GODOT (set GODOT=...)" >&2; exit 1; }

# The exporter uses class_name scripts, which need the project imported once.
if [[ ! -f "$REPO_ROOT/client/.godot/global_script_class_cache.cfg" ]]; then
  "$GODOT" --headless --path "$REPO_ROOT/client" --import >/dev/null 2>&1 || true
fi
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
status=0
"$GODOT" --headless --path "$REPO_ROOT/client" -s res://tools/export_region.gd -- "$@" 2>&1 | tee "$log" || status=$?
# Godot can print script errors and still exit 0, so check its output too.
if [[ $status -ne 0 ]] || grep -qE "SCRIPT ERROR|Parse Error|^ERROR:" "$log"; then
  echo "Region export failed (above)." >&2; exit 1
fi
