#!/usr/bin/env bash
# The slow lane (ADR 0009): run nightly and on demand, never on every push.
# M0 adds the web/server export builds here.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Go tests with the race detector"
(cd "$REPO_ROOT/server" && go test -race -count=1 ./...)

echo "== Navmesh pathfinding benchmark (budget: 200 µs per path; picks up data/regions/test_greybox.region.json)"
bench="$(cd "$REPO_ROOT/server" && go test -run '^$' -bench . -benchtime 5000x ./internal/navmesh/)"
echo "$bench"
awk '/^BenchmarkFindPath\// { found = 1; if ($3 + 0 > 200000) { print "Over budget: " $1 " takes " $3 " ns per path"; bad = 1 } }
     END { if (!found) print "No FindPath benchmark ran"; exit bad || !found }' <<<"$bench"

echo "== Bot walk test: 50 bots on test_greybox for 6,000 ticks (budget: p99 tick under 2 ms)"
bots="$(cd "$REPO_ROOT/server" && go test -run '^$' -bench '^BenchmarkBots$' -benchtime 6000x ./internal/region/)"
echo "$bots"
awk '/^BenchmarkBots/ { for (i = 2; i <= NF; i++) if ($i == "p99-ns/tick") { found = 1; p99 = $(i - 1)
       printf "p99 tick: %.3f ms\n", p99 / 1e6; if (p99 + 0 > 2000000) { print "Over budget"; bad = 1 } } }
     END { if (!found) print "No bot benchmark ran"; exit bad || !found }' <<<"$bots"

echo "== Protocol decoder fuzzing (60 s)"
(cd "$REPO_ROOT/server" && go test -run '^$' -fuzz '^FuzzDecode$' -fuzztime "${PROTO_FUZZTIME:-60s}" ./internal/proto)

echo "Slow lane passed."
