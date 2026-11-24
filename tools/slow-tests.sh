#!/usr/bin/env bash
# The slow lane (ADR 0009): run nightly and on demand, never on every push.
# M0 adds the bot walk test (50 bots, tick-time budget) and the web/server export builds here.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Go tests with the race detector"
(cd "$REPO_ROOT/server" && go test -race -count=1 ./...)

echo "== Navmesh pathfinding benchmark (budget: 200 µs per path; picks up data/regions/test_greybox.region.json)"
bench="$(cd "$REPO_ROOT/server" && go test -run '^$' -bench . -benchtime 5000x ./internal/navmesh/)"
echo "$bench"
awk '/^BenchmarkFindPath\// { found = 1; if ($3 + 0 > 200000) { print "Over budget: " $1 " takes " $3 " ns per path"; bad = 1 } }
     END { if (!found) print "No FindPath benchmark ran"; exit bad || !found }' <<<"$bench"

echo "Slow lane passed."
