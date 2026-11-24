# Networking

See [ADR 0002](../decisions/0002-free-movement-server-paths.md) for the movement model and [ADR 0005](../decisions/0005-websocket-generated-protocol.md) for the transport and protocol.

## Transport

- WSS to `/w/<world-id>`: one connection per player, binary frames only.
- **Server to client:** at most one frame per tick (every 50 ms), holding every event for that client from that tick. A tick with nothing new sends nothing.
- **Client to server:** intents are sent as they happen. Each intent is a few bytes.
- **Keepalive:** a ping every 5 s doubles as clock sync. The connection drops after 20 s of silence.

## Clock sync

Paths start at a **server tick**, so the client needs to know the server's time.
- The client sends `ping(client_time)`. The server replies `pong(client_time, server_tick, tick_phase)`.
- The client keeps a smoothed offset, averaging the samples with the lowest round-trip time.
- The client renders other entities **about 100 ms in the past** (interpolation delay), which absorbs jitter. It renders **your own character at the current estimated time**, so your movement feels immediate once the path arrives.

## Movement playback

1. You click. The client shows the click marker, turns your character to face it and sends `move_to(x, y, z)`.
2. The server replies with `path_started(entity, start_tick, speed, waypoints[])`, sent to everyone who can see you.
3. Each client places the entity at `distance = speed × (now − start_tick)` along the waypoints. This is the same calculation everywhere, and it finishes at the last waypoint.
4. A change of path sends a new `path_started`. Stopping sends `path_stopped(entity, tick, position)`.
5. **Correction:** if a client's drawn position ever differs from where the server's numbers place it by more than 0.5 m, for example after a lag spike, the entity blends to the correct place over 150 ms.

## Message catalogue (first draft)

These are the messages for M0–M3. The schema, [`protocol/messages.schema`](../../protocol/messages.schema), is the real source; this table is for reading. Messages marked **(M0)** are in the schema now. The rest are added as their milestones need them, and some M0 messages gain fields later (for example the character snapshot in `welcome` and appearance in `entity_enter`).

### Client → server (intents)

| Message | Fields | Limits |
|---|---|---|
| `hello` **(M0)** | protocol_hash, ticket, content_hash, client_version | Once |
| `ping` **(M0)** | client_time | 1/s |
| `move_to` **(M0)** | position (quantised) | 10/s |
| `interact` | target entity, option index | 5/s |
| `attack` | target entity | 5/s |
| `ability` | slot (1–4), direction or target | 4/s |
| `item_action` | container, slot, action (use, equip, drop, eat, use-on) and target | 10/s |
| `item_move` | from container and slot, to container and slot | 10/s |
| `bank_action` | deposit, withdraw or deposit all, with slot and amount | 10/s |
| `chat_say` **(M0)** | text (up to 120 characters) | 1/s, burst 3 |
| `dialogue_choice` | dialogue id, option | 5/s |
| `logout` | – | – |

### Server → client (events)

| Message | Fields |
|---|---|
| `welcome` **(M0)** | your entity id, character snapshot (skills, inventory, equipment; not yet), region id, server tick, tick rate |
| `region_change` | region id, entry position (the client shows a loading screen) |
| `entity_enter` **(M0)** | id, kind, type id, name, appearance (not yet), position, current path (if moving), HP fraction, in combat |
| `entity_leave` **(M0)** | id |
| `path_started` / `path_stopped` **(M0)** | see above |
| `attack_started` | attacker, target, attack style, impact tick |
| `hit` | target, amount, kind (normal, miss, critical), source |
| `hp_changed` | entity, HP fraction (others), exact HP (you only) |
| `died` / `respawned` | entity, position |
| `telegraph` | id, shape (circle, cone, line, ring) with parameters, lands-at tick |
| `ground_item` / `ground_item_gone` | id, item, quantity, position |
| `inventory_changed` / `equipment_changed` / `bank_changed` | changed slots only |
| `xp_gained` | skill, amount, new total XP, level (if it changed) |
| `skilling` | entity, action animation, node (for others to see) |
| `chat` **(M0)** | sender entity, name, role badge, text |
| `system_message` | key and parameters (the client localises them) |
| `dialogue` | NPC, text key, options |
| `pong` **(M0)** | see clock sync |
| `kick` | reason code |

## Bandwidth budget

| | Target |
|---|---|
| Download per player, busy area (100 entities nearby) | under 15 KB/s on average, peaks under 60 KB/s |
| Upload per player | under 1 KB/s |
| World server with 1,000 players | under 15 MB/s out |

Because movement is sent only when paths change, a busy area costs a few hundred bytes per second for each moving entity in view.

## Wire format

The generator (`server/cmd/protogen`, run by `tools/protogen.sh`) turns the schema into the Go and GDScript codecs. Both follow these rules exactly, and shared test vectors in `protocol/testdata/golden.txt` prove they agree.

**Frames and messages**
- One WebSocket binary frame holds one or more messages back to back.
- Each message is its **id** (1 byte), its **body length** (varint), then the **body**. The length lets a decoder check the body size before reading it.
- By convention client messages use ids 1–63 and server messages 64 and up. Each message has one direction, and a decoder rejects a message sent the wrong way (a client can't send `welcome`).

**Inside a body**
- If a struct has `bool` or optional fields, it starts with **flag bytes**: bit *i* (lowest bit of the first byte first) is the *i*-th such field in schema order. An optional struct is present when its bit is set. Unused bits must be zero.
- Then the other fields follow in schema order, with no tags or padding.

**Field encodings**
- `u8` and `u16` are fixed width, little-endian.
- `u32` and `u64` are unsigned varints (LEB128). `u64` is capped at 2^63 − 1 so GDScript's signed 64-bit `int` can hold it.
- `i32` is a zigzag varint, so small negative numbers are small too.
- **Positions** (`pos`) are 3 × `i32` in centimetres relative to the region origin, which covers ±21 km. A typical position takes 6–9 bytes rather than 12.
- **Speeds** are centimetres per second (`u32`).
- **Strings** are UTF-8 with a varint byte length. A schema limit is in **bytes**, allowing 4 per character, so chat is `string<480>`. The 120-character limit itself is a game rule checked by the server.
- **Lists** are a varint count, then the elements. Every list has a maximum length.
- **Enums** are one byte. Values count up from 0, so a decoder can range-check them.
- **Angles** will be `u16`. **HP** shown to other players is a `u8` fraction (0–255).

**Strict decoding**
- A decoder rejects: an unknown id, the wrong direction, a truncated message, a body longer than the message can ever be, trailing bytes in a body, a non-minimal or over-long varint, a value out of range, unused flag bits, an unknown enum value, a string or list over its limit, and invalid UTF-8 (Go side).
- Any error rejects the whole frame. The world server then drops the connection.
- The encoding is canonical: anything a decoder accepts re-encodes to exactly the same bytes. The Go decoder's fuzz test checks this, as well as that it never panics.
- Every field is bounded, so the generator works out each message's largest size. `MaxClientMessageSize` (currently 1,132 bytes, for `hello`) is the read limit for client frames.

**Protocol version**
- `ProtocolHash` (`Proto.PROTOCOL_HASH`) is the first 4 bytes of the SHA-256 of the schema in a canonical form, without comments or formatting. Changing a comment doesn't change the version; changing anything else does.
- `hello` always has id 1 and starts with `protocol_hash: u32`, with no flag bytes (the generator enforces this). So the server can read an out-of-date client's hash even if the rest of its `hello` has changed shape. `proto.CheckHello` compares the hash before decoding the rest, and returns `ErrProtocolMismatch` for a stale client. The world server answers that with a "please refresh" message, which arrives with the world server core.
- `client_time` in `ping` and `pong` is opaque to the server: it is echoed back unchanged, in whatever unit the client uses. `tick_phase` in `pong` is how far through the tick the server was, in 256ths.
