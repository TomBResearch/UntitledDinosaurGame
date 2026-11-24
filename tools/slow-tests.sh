#!/usr/bin/env bash
# The slow lane (ADR 0009): run nightly and on demand, never on every push.
# M0 adds the bot walk test (50 bots, tick-time budget) and the web/server export builds here.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Go tests with the race detector"
(cd "$REPO_ROOT/server" && go test -race -count=1 ./...)

echo "Slow lane passed."
