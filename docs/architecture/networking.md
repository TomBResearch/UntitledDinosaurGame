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

These are the messages for M0–M3. The schema in `protocol/` is the real source; this table is for reading.

### Client → server (intents)

| Message | Fields | Limits |
|---|---|---|
| `hello` | ticket, protocol_hash, content_hash, client_version | Once |
| `ping` | client_time | 1/s |
| `move_to` | position (quantised) | 10/s |
| `interact` | target entity, option index | 5/s |
| `attack` | target entity | 5/s |
| `ability` | slot (1–4), direction or target | 4/s |
| `item_action` | container, slot, action (use, equip, drop, eat, use-on) and target | 10/s |
| `item_move` | from container and slot, to container and slot | 10/s |
| `bank_action` | deposit, withdraw or deposit all, with slot and amount | 10/s |
| `chat_say` | text (up to 120 characters) | 1/s, burst 3 |
| `dialogue_choice` | dialogue id, option | 5/s |
| `logout` | – | – |

### Server → client (events)

| Message | Fields |
|---|---|
| `welcome` | your entity id, character snapshot (skills, inventory, equipment), region id, server tick, tick rate |
| `region_change` | region id, entry position (the client shows a loading screen) |
| `entity_enter` | id, kind, type id, name, appearance, position, current path (if moving), HP fraction, combat state |
| `entity_leave` | id |
| `path_started` / `path_stopped` | see above |
| `attack_started` | attacker, target, attack style, impact tick |
| `hit` | target, amount, kind (normal, miss, critical), source |
| `hp_changed` | entity, HP fraction (others), exact HP (you only) |
| `died` / `respawned` | entity, position |
| `telegraph` | id, shape (circle, cone, line, ring) with parameters, lands-at tick |
| `ground_item` / `ground_item_gone` | id, item, quantity, position |
| `inventory_changed` / `equipment_changed` / `bank_changed` | changed slots only |
| `xp_gained` | skill, amount, new total XP, level (if it changed) |
| `skilling` | entity, action animation, node (for others to see) |
| `chat` | sender entity, name, role badge, text |
| `system_message` | key and parameters (the client localises them) |
| `dialogue` | NPC, text key, options |
| `pong` | see clock sync |
| `kick` | reason code |

## Bandwidth budget

| | Target |
|---|---|
| Download per player, busy area (100 entities nearby) | under 15 KB/s on average, peaks under 60 KB/s |
| Upload per player | under 1 KB/s |
| World server with 1,000 players | under 15 MB/s out |

Because movement is sent only when paths change, a busy area costs a few hundred bytes per second for each moving entity in view.

## Encoding rules

- Little-endian. Integers use varints. Booleans are packed into flag bytes.
- **Positions** are 3 × i32 in centimetres relative to the region origin, which covers ±21 km. That's 12 bytes, or fewer with varint packing.
- **Angles** are u16. HP shown to other players is a u8 fraction.
- **Strings** are UTF-8 with a length prefix. Chat is capped at 120 characters.
