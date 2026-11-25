#!/usr/bin/env bash
# Generates the streaming spike's region and exports both web variants of the bench:
#   build/spike-web-nothreads/  (the game's current settings: single-threaded)
#   build/spike-web-threads/    (thread support; needs COOP/COEP, see serve.py --coi)
# Env: GODOT (defaults to the Mac app); SIZES=1 also prints compressed engine sizes.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
cd "$REPO_ROOT"
"$GODOT" --headless --path client --import >/dev/null 2>&1 || true
# Not headless: MultiMesh buffers need a real renderer (see build_spike_region.gd).
"$GODOT" --path client -s res://spikes/streaming/build_spike_region.gd 2>&1 | grep build_spike_region
"$GODOT" --headless --path client --import >/dev/null 2>&1 || true
for variant in nothreads threads; do
  out="build/spike-web-$variant"
  preset="Streaming spike (web, no threads)"
  [[ "$variant" == threads ]] && preset="Streaming spike (web, threads)"
  rm -rf "$out" && mkdir -p "$out"
  "$GODOT" --headless --path client --export-release "$preset" "../$out/index.html" >"$out.log" 2>&1 \
    || { tail -20 "$out.log"; exit 1; }
  if grep -E "ERROR|SCRIPT ERROR" "$out.log"; then exit 1; fi
  echo "== $out (export log: $out.log)"
  [[ "${SIZES:-0}" == 1 ]] || continue
  # Download sizes of the engine files (slow: brotli -q 11 on a 38 MB wasm takes about a minute).
  for f in "$out"/index.wasm "$out"/index.js; do
    printf '%-40s %8d KB raw %8d KB gzip -9 %8d KB brotli -q 11\n' "$f" "$(( $(wc -c <"$f") / 1024 ))" \
      "$(( $(gzip -9c "$f" | wc -c) / 1024 ))" "$(( $(brotli -c "$f" | wc -c) / 1024 ))"
  done
done
for v in nothreads threads; do cp client/spikes/streaming/coi_check.html "build/spike-web-$v/"; done
