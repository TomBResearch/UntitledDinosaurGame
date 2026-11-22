#!/bin/sh
# UDG staging launch wrapper. Boots ONLY the region-room service, loopback-bound, with a bounded
# old-space (heap) ceiling. It starts one process and execs it (the caller owns the PID — nothing
# here forks, backgrounds, or kills anything).
#
# Runtime selection:
#   UDG_ROOM_NODE                       explicit node binary (wins if set)
#   <root>/runtime/bin/node             the pinned Linux ARM64 build shipped in this archive,
#                                       used when it is executable on this host
#   node on PATH                        fallback (staging pins Node 24.22.2; report mismatches)
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

export UDG_ROOM_HOST="${UDG_ROOM_HOST:-127.0.0.1}"
export UDG_ROOM_PORT="${UDG_ROOM_PORT:-18673}"
export UDG_ROOM_CONFIG="${UDG_ROOM_CONFIG:-$ROOT/staging/config/region-config.json}"
MAX_OLD_SPACE_MB="${UDG_ROOM_MAX_OLD_SPACE_MB:-512}"

NODE_BIN="${UDG_ROOM_NODE:-}"
if [ -z "$NODE_BIN" ] && [ -x "$ROOT/runtime/bin/node" ] && "$ROOT/runtime/bin/node" -v >/dev/null 2>&1; then
  NODE_BIN="$ROOT/runtime/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN=$(command -v node || true)
  if [ -z "$NODE_BIN" ]; then
    echo "launch: no node runtime found (set UDG_ROOM_NODE)" >&2
    exit 3
  fi
  echo "launch: WARNING using system node ($("$NODE_BIN" -v)); the pinned runtime is v24.22.2" >&2
fi

exec "$NODE_BIN" --max-old-space-size="$MAX_OLD_SPACE_MB" "$ROOT/staging/launch.mjs"
