#!/usr/bin/env bash
# Regenerates the network protocol codecs from protocol/messages.schema (ADR 0005):
#   server/internal/proto/messages_gen.go   (Go, world server)
#   client/net/proto/messages.gd            (GDScript, client)
# Commit the results. tools/check.sh fails if they're stale.
#
# If the wire format changed, also refresh the shared test vectors and update the GDScript samples
# in client/tests/test_proto_roundtrip.gd to match:
#   cd server && go test ./internal/proto -update
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/server" && go run ./cmd/protogen "$@"
