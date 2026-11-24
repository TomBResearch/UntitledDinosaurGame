#!/usr/bin/env bash
# Runs the streaming spike's web suite in one browser tab and prints the results table.
#
#   client/spikes/streaming/run_web_suite.sh safari         # Safari, in the foreground
#   client/spikes/streaming/run_web_suite.sh chrome PATH    # headless Chrome/Chromium at PATH
#   client/spikes/streaming/run_web_suite.sh manual         # prints the first URL; open it yourself
#                                                           # (e.g. in the Claude app's browser pane,
#                                                           # with the session's window in view)
#
# The browser must draw at full speed: a visible, foreground, unlocked window (or headless Chrome with
# background throttling off, as below). A hidden or locked screen throttles drawing to about 1 fps
# and the frame times mean nothing. Leave the machine alone while it runs (about 15 minutes).
#
# It starts serve.py (the single-threaded build at http://localhost:8061/, the threaded one at /mt/
# with COOP/COEP), plus cors_peer.py on :8063 and, if it isn't running, the world server on :8090 for
# the cross-origin isolation check. Each page posts its results and is sent on to the next run.
# Env: BUILD=1 rebuilds first (build_web.sh); WALK=40 seconds of walking per run; RUN=<id> names it.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$REPO_ROOT/client/spikes/streaming"
cd "$REPO_ROOT"
BROWSER="${1:-manual}"
RUN="${RUN:-$BROWSER-$(date +%H%M)}"
WALK="${WALK:-40}"
RESULTS="build/spike-results"
PLAN="$RESULTS/$RUN.plan.txt"

if [[ "${BUILD:-0}" == 1 || ! -f build/spike-web-threads/index.pck ]]; then
  "$HERE/build_web.sh"
fi
mkdir -p "$RESULTS"

ST="http://localhost:8061/?walk=$WALK"
MT="http://localhost:8061/mt/?walk=$WALK"
cat >"$PLAN" <<EOF
http://localhost:8061/mt/coi_check.html?label=$RUN-coi-isolated
http://localhost:8061/coi_check.html?label=$RUN-coi-plain
$ST&label=$RUN-st-a
$MT&label=$RUN-mt-a
$ST&label=$RUN-st-sync&mode=sync
$ST&label=$RUN-st-b
$MT&label=$RUN-mt-b
$ST&label=$RUN-st-chunk32&chunk=32&inflight=4
$ST&label=$RUN-st-split2&split=2
$ST&label=$RUN-st-ring220&load=220&unload=280
$MT&label=$RUN-mt-chunk32&chunk=32&inflight=4
EOF
LAST="$RUN-mt-chunk32"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
python3 "$HERE/serve.py" build/spike-web-nothreads --isolated build/spike-web-threads --port 8061 \
  --plan "$PLAN" --results "$RESULTS" & pids+=($!)
python3 "$HERE/cors_peer.py" 8063 & pids+=($!)
if ! nc -z 127.0.0.1 8090 2>/dev/null; then
  (cd server && exec go run ./cmd/world -dev-tickets >/dev/null 2>&1) & pids+=($!)
fi
sleep 2

FIRST="$(head -1 "$PLAN")"
case "$BROWSER" in
  safari) open -a Safari "$FIRST" ;;
  chrome)
    CHROME="${2:?usage: run_web_suite.sh chrome /path/to/chrome}"
    "$CHROME" --headless=new --window-size=1280,720 --user-data-dir="build/spike-chrome-profile" \
      --disable-background-timer-throttling --disable-renderer-backgrounding \
      --disable-backgrounding-occluded-windows --ignore-gpu-blocklist --enable-gpu \
      "$FIRST" >/dev/null 2>&1 & pids+=($!) ;;
  *) echo "Open this in a visible, foreground browser tab: $FIRST" ;;
esac

echo "Waiting for $LAST (results in $RESULTS/)..."
for _ in $(seq 1800); do
  [[ -f "$RESULTS/$LAST.json" ]] && break
  sleep 1
done
[[ -f "$RESULTS/$LAST.json" ]] || { echo "timed out" >&2; exit 1; }
for f in "$RESULTS/$RUN"-coi-*.json; do echo "== $(basename "$f")"; python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["checks"]))' "$f"; done
python3 "$HERE/summarize.py" "$RESULTS" "$RUN-"
