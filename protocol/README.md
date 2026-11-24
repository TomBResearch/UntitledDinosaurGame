# Protocol

[`messages.schema`](messages.schema) is every message between the web client and a world server. It is the single source for both codecs ([ADR 0005](../docs/decisions/0005-websocket-generated-protocol.md)):

| Generated file | Used by |
|---|---|
| `server/internal/proto/messages_gen.go` | World server (Go) |
| `client/net/proto/messages.gd` (`class_name Proto`) | Client (GDScript) |

Never edit the generated files. The wire format is specified in [networking.md](../docs/architecture/networking.md#wire-format).

## Adding or changing a message

1. Edit `messages.schema`. The field types are listed at the top of the file. Client messages take ids 1–63 and server messages 64 and up.
2. Run `tools/protogen.sh`. The protocol hash changes, so old clients are told to refresh.
3. Add a sample of the new message to `samples()` in **both** `server/internal/proto/proto_test.go` and `client/tests/test_proto_roundtrip.gd`, then refresh the shared test vectors with `cd server && go test ./internal/proto -update`.
4. Handle the message on both sides, and update the catalogue in networking.md.
5. Run `tools/check.sh`. It fails if the generated files are stale.

`hello` is special: it must keep id 1 and start with `protocol_hash: u32`, with no `bool` or optional fields, so a server can always read an out-of-date client's version. The generator enforces this.

## Test vectors

[`testdata/golden.txt`](testdata/golden.txt) holds encoded frames for a fixed set of sample messages. The Go and GDScript tests each build the same samples and check that their encoder produces exactly these bytes and that decoding them gives the same messages back. This proves the two codecs agree. The Go decoder is also fuzzed: briefly in the fast check, and for 60 s in the nightly slow lane.
