#!/bin/sh
# UDG staging smoke wrapper — runs the server-local CLI smoke test with the SAME runtime the
# service is expected to use. Pure observation: it never starts, signals, or kills the server.
#   usage: smoke.sh [smoke.mjs args]     e.g. smoke.sh --url ws://127.0.0.1:18673 --window-ms 6000
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

NODE_BIN="${UDG_ROOM_NODE:-}"
if [ -z "$NODE_BIN" ] && [ -x "$ROOT/runtime/bin/node" ] && "$ROOT/runtime/bin/node" -v >/dev/null 2>&1; then
  NODE_BIN="$ROOT/runtime/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN=$(command -v node || true)
  if [ -z "$NODE_BIN" ]; then
    echo "smoke: no node runtime found (set UDG_ROOM_NODE)" >&2
    exit 3
  fi
fi

exec "$NODE_BIN" "$ROOT/staging/smoke.mjs" "$@"
