# 0005: WebSocket transport with a binary protocol generated from one schema

**Status:** Accepted (2026-11-23)

## Context

Browsers can't use raw UDP. WebRTC data channels can be unreliable, but they need a signalling and TURN setup. Click-to-move with server paths sends only occasional events, so TCP's head-of-line blocking isn't a serious problem. The client is GDScript and the server is Go, so message formats must never drift apart.

## Decision

- **Secure WebSocket (WSS)**: one connection per player to their world server, routed `/w/<world-id>` through Caddy. Messages are binary.
- **One schema file** (`protocol/messages.schema`), a simple text format that lists each message's id, direction and typed fields.
- **`cmd/protogen` generates** Go encoders and decoders (`server/internal/proto/`) and GDScript encoders and decoders (`client/net/proto/`). Generated files are committed, and the fast check fails if they're stale.
- **The protocol version** is a hash of the schema, sent in the handshake. A mismatch gets a "please refresh" reply.
- The client uses Godot's `WebSocketPeer` directly (not the high-level multiplayer API), which gives full control over framing and batching.
- **Messages are batched per tick:** each tick, the server sends at most one WebSocket frame per client, holding all of that client's events.

## Consequences

- Adding a message means editing the schema, running `tools/protogen.sh`, and handling it on both sides.
- Fixed binary encoding (little-endian, varints, and positions quantised to centimetres within a region) keeps messages small.
- A Steam/desktop client later could use the same protocol over the same WebSocket. Nothing changes.

## Rejected

- **Godot high-level multiplayer (RPCs, MultiplayerSynchronizer):** this needs Godot at both ends.
- **Protobuf or FlatBuffers:** GDScript support is community-maintained and patchy. Our needs are simple enough for a small generator.
- **JSON messages:** too big and slow at 1,000 players.
- **WebRTC or WebTransport:** extra infrastructure for little gain with this movement model. Revisit if packet loss on mobile becomes a measured problem.
