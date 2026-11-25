# Networking

See [ADR 0002](../decisions/0002-free-movement-server-paths.md) for the movement model and [ADR 0005](../decisions/0005-websocket-generated-protocol.md) for the transport and protocol.

## Transport

- WSS to `/w/<world-id>`: one connection per player, binary frames only. A text frame closes the connection (status 1003).
- **Server to client:** at most one frame per tick (every 50 ms), holding every event for that client from that tick. A tick with nothing new sends nothing. A `pong` goes out in its own frame as soon as the ping is read.
- **Client to server:** intents are sent as they happen. Each intent is a few bytes. A client frame may hold several messages, but it must be at most `MaxClientMessageSize` bytes (1,132, the largest `hello`): that's the server's read limit, and a bigger frame closes the connection.
- **Keepalive:** the server sends a WebSocket ping every 5 s. The connection drops after 20 s in which the server hears nothing: no message and no pong.
  - Browsers answer WebSocket pings themselves. A background tab pauses the game loop but stays connected, so switching tabs doesn't log you out.
  - The client's own `ping` every 5 s is for clock sync. It pauses with the game in a background tab, and that's fine.
  - While paused, the browser keeps receiving. Frames wait in the client's receive buffer (8 MB, 65,536 frames: about an hour of a quiet area) and are played through when the tab comes back. A longer absence can overflow it. The idle logout (15 minutes with no input, from M1) keeps absences shorter than that.
- **Library:** the world server uses [`github.com/coder/websocket`](https://github.com/coder/websocket) (v1.8.15), the server's first Go dependency. It's small, has no dependencies of its own, takes a `context` on every read and write (so the silence and write timeouts are plain deadlines), and is safe to close from another goroutine, which is how a slow client is dropped without the tick waiting.
- **Origins:** browsers may connect from the server's own host, plus the patterns in `-origins` (default `localhost:*,127.0.0.1:*`, for a locally served web export). Production sets it to the game's domain.

### Connection lifecycle

1. The client opens the WebSocket and sends `hello` as its first frame, within 10 s.
2. The server checks, in order:
   - `protocol_hash` (before decoding the rest, see [Protocol version](#wire-format)): a mismatch gets `kick(refresh)`.
   - `content_hash` against the server's `data/` hash (the client's `client/data/content_hash.txt`): a mismatch gets `kick(refresh)`.
   - `ticket` (see [Join tickets](#join-tickets)): refused gets `kick(bad_ticket)`.
3. Accepted: the player joins the spawn region. The first frame back holds `welcome`, then `entity_enter` for **the player itself**, then `entity_enter` for everything in view.
4. After that, intents and pings flow until either side closes.

**The server closing a connection.** `kick(reason)` is always the last frame before a close the client should explain:

| Reason | When | Close status | Client should |
|---|---|---|---|
| `refresh` | stale protocol or content | 1008 | ask the player to reload the page |
| `bad_ticket` | the ticket was refused | 1008 | go back to the login or world list |
| `shutdown` | the world is stopping (SIGTERM) | 1001 | say so and offer to reconnect |
| `misbehaving` | too many invalid or rate-limited messages, or over the upload limit | 1008 | show an error |

Without a `kick`, the connection was dropped: a malformed frame (status 1002), a silent or too-slow connection (no close handshake). The client may reconnect.

**Slow clients never hold up the tick.** Each session has a queue of 64 frames (3.2 s). The region hands a frame over without waiting; if the queue is full, the player is removed from the region and the connection dropped. A single frame that can't be written within 10 s also drops it.

### Join tickets

A player gets a join ticket from the backend API (`POST /api/join`) and sends it as `hello.ticket`. The format, and how the API decides to issue one, are in [backend.md](backend.md#join-tickets).

- The world accepts tickets when **`WORLD_TICKET_KEY`** is set in its environment (the same value as the API's). Without it, every ticket except a dev ticket (below) is refused.
- A ticket is accepted once only, and only if:
  - its HMAC is right (anything else is forged);
  - it hasn't expired (30 s), and its expiry isn't more than 60 s away;
  - its `worldId` is this world (`-world`);
  - its nonce hasn't been used before. The world remembers used nonces until their tickets expire.
  - With **`-premium-only`**, it says `premium` (Premium or staff).
- The ticket's `name` becomes the player's display name, its `role` the chat badge, and its `appearance` the `look` everyone gets in `entity_enter`. A look with a part that isn't shaped like an id is dropped (the player is drawn with the default) rather than refusing the ticket. Dev players have no look.
- Each refusal is logged with the reason (never the ticket itself). The player is only told `kick(bad_ticket)`.
- Not yet: loading the character's saved region and position, and the online lease. Those come with persistence (a later M1 task). Until then everyone spawns at a `player_spawns` point of `test_greybox` (`-spawn-region`), as with dev tickets.
- Code: `server/internal/ticket` (checked by `ticket.Guard`), called from `server/internal/world`. Tests: forged, expired, reused, wrong world and premium worlds in `internal/ticket/ticket_test.go` and `internal/world/ticket_test.go`, and the API and both worlds together in `internal/joine2e` ([backend.md](backend.md#tests)).
- The client gets its ticket after the player picks a character and a world, and sends it straight away (it lasts 30 s). A refused ticket (`kick(bad_ticket)`) takes the player back to the world list. Reconnecting after a drop or a restart asks the API for a new ticket, because each one works once ([client.md](client.md#characters-worlds-and-joining)).

`GET /status` on the world server answers `{world, players}` for the API's world list. Caddy doesn't route it, so it's only reachable inside Docker.

### Dev tickets

For local development (desktop runs, `?name=` and local pages), a world server can also let anyone in by name. This works exactly as in M0, alongside real tickets. The deployed client no longer uses dev tickets: it joins with the API's tickets. The live World 1 still has `-dev-tickets` on, behind the playtest gate, until the owner turns both off ([ADR 0014](../decisions/0014-playtest-gate.md)). World 2 never has it.

- Start the server with **`-dev-tickets`**: `cd server && go run ./cmd/world -dev-tickets`. It logs a warning at startup. Never use it on a public server, except the live World 1 behind the playtest gate ([ADR 0014](../decisions/0014-playtest-gate.md)).
- It listens on **`127.0.0.1:8090`** (`-addr`) and serves world **`dev`** (`-world`), so the client connects to **`ws://127.0.0.1:8090/w/dev`**.
- The client sends `hello.ticket = "dev:<name>"`. `<name>` must have the shape of a character name ([backend.md](backend.md#routes)): 3–12 characters, ASCII letters and digits with single spaces between words, no space at either end. Dev names aren't filtered or unique: two players can both be `Ugg`. Dev players have the normal role.
- Everyone spawns at a `player_spawns` point of `test_greybox` (`-spawn-region`), in turn.
- Without `-dev-tickets`, every `dev:` ticket is refused.
- `hello.content_hash` must match too, so run `tools/check.sh` (or `dataval -emit-client`) after changing `data/`, and restart the server.

### Rate limits

Checked by the server per player; a message over its limit is dropped and counted as invalid, and **more than 50 invalid messages in a minute** disconnects with `kick(misbehaving)` ([security.md](security.md)).

| What | Limit | Where |
|---|---|---|
| `move_to` | 10 a second, burst 10 | region, counted in ticks so tests are exact |
| `chat_say` | 1 a second, burst 3 | region. Over 120 characters once cleaned is invalid too ([world-server.md](world-server.md#local-chat)). |
| `ping` | 1 a second, burst 3; extra pings aren't answered | session |
| Upload | 4 KB/s, burst 16 KB; over it disconnects | session |
| `move_to` further than 150 m from you | invalid | region |

## Clock sync

Paths start at a **server tick**, so the client needs to know the server's time.
- The client sends `ping(client_time)`. The server replies `pong(client_time, server_tick, tick_phase)`: `server_tick` is the last tick the region ran, and `tick_phase` is how long ago that tick was due, in 256ths of a tick (255 if a tick is late). So the server's time is `server_tick + tick_phase / 256` ticks.
- The client keeps a smoothed offset, averaging the samples with the lowest round-trip time.
- The client renders other entities **about 100 ms in the past** (interpolation delay), which absorbs jitter. It renders **your own character at the current estimated time**, so your movement feels immediate once the path arrives.

## Movement playback

1. You click. The client shows the click marker, turns your character to face it and sends `move_to(x, y, z)`.
2. The server replies with `path_started(entity, start_tick, speed, waypoints[])`, sent to everyone who can see you, including you.
3. Each client places the entity at `distance = speed × (now − start_tick)` along the waypoints. This is the same calculation everywhere, and it finishes at the last waypoint. Exactly:
   - `distance_cm = speed × (t − start_tick) / tick_hz`, with `speed` in cm/s, `t` in ticks (fractional on the client) and `tick_hz` from `welcome`.
   - Measure it along the straight **3D** segments between consecutive waypoints, which are whole centimetres. Past the end, stay on the last waypoint.
   - The broadcast waypoints *are* the server's path: it computes its own positions from the same quantised numbers, so it never disagrees with a client by more than float rounding.
   - Walk speed is `movement.walk_speed_m_s` in `data/progression.json` (4 m/s, sent as 400 cm/s).
4. A change of path sends a new `path_started`. Its first waypoint is where the old path had the entity on the new `start_tick`, so there's no jump. Stopping sends `path_stopped(entity, tick, position)`:
   - on arrival, on the first tick at or past the end, at the last waypoint;
   - when a click finds no path, or is within 10 cm of where you are, at your current position. If you were walking, everyone who sees you gets it; if you were standing, only you do (so your client can clear the click marker).
   - Only a player's last click in a tick is walked.
5. **Correction:** if a client's drawn position ever differs from where the server's numbers place it by more than 0.5 m, for example after a lag spike, the entity blends to the correct place over 150 ms. The client blends smaller differences the same way rather than snapping, because a repath of your own character (drawn ahead of the server) moves its target by up to about 0.6 m at 150 ms of latency. See [client.md](client.md#drawing-entities).

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
| `chat_say` **(M0)** | text (up to 120 characters, counted in code points after cleaning) | 1/s, burst 3 |
| `dialogue_choice` | dialogue id, option | 5/s |
| `logout` | – | – |

### Server → client (events)

| Message | Fields |
|---|---|
| `welcome` **(M0)** | your entity id, character snapshot (skills, inventory, equipment; not yet), region id, server tick, tick rate |
| `region_change` | region id, entry position (the client shows a loading screen) |
| `entity_enter` **(M0)** | id, kind, type id, name, position, current path (if moving), HP fraction, in combat, look (a player's appearance ids, or none) |
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
| `chat` **(M0)** | sender entity, name, role badge, text. Sent to every player within 40 m of the speaker, the speaker included. |
| `system_message` **(M0)** | key (the client localises it). M0 has one key, `chat_muted`; parameters come with the first key that needs them. |
| `dialogue` | NPC, text key, options |
| `pong` **(M0)** | see clock sync |
| `kick` **(M0)** | reason: `refresh`, `bad_ticket`, `shutdown` or `misbehaving` (see [Connection lifecycle](#connection-lifecycle)) |

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
- `hello` always has id 1 and starts with `protocol_hash: u32`, with no flag bytes (the generator enforces this). So the server can read an out-of-date client's hash even if the rest of its `hello` has changed shape. `proto.CheckHello` compares the hash before decoding the rest, and returns `ErrProtocolMismatch` for a stale client. The world server answers that with `kick(refresh)`.
- `client_time` in `ping` and `pong` is opaque to the server: it is echoed back unchanged, in whatever unit the client uses. `tick_phase` in `pong` is how far through the tick the server was, in 256ths.
