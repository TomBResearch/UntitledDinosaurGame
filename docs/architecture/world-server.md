# World server (`cmd/world`)

One process per world. Written in Go ([ADR 0003](../decisions/0003-go-server.md)).

## Process layout

```
world process
├── net: one reader and one writer goroutine per connection (WebSocket)
├── hub: routes sessions to regions, world chat, region transfers, shutdown
├── region "fern_valley": tick goroutine ─┐
├── region "tar_pits":    tick goroutine ─┼─ each owns its own entities, navmesh and spatial grid
├── region "raptor_cave": tick goroutine ─┘
└── saver: batches character saves to Postgres and renews online leases
```

The code: `server/cmd/world` (the process and its flags), `server/internal/world` (the WebSocket endpoint and sessions; the hub's job while there's one region), `server/internal/region` (the simulation) and `server/internal/persist` (the saver and the database, [below](#saving-characters)). New characters join the spawn region (`-spawn-region`); a saved character joins the region it was saved in, if the world has it. Region transfers come later.

- **Regions don't share memory.** A region only receives messages through its inbox channel (player intents, a transfer in, a shutdown) and sends them through the hub. That's what lets a region move into its own process later ([ADR 0007](../decisions/0007-worlds-and-regions.md)).
- **Inside a tick, everything is single-threaded.** No locks in game logic.

## The tick

**20 ticks per second (50 ms)**, configured in `data/progression.json` → `server.tick_hz`. All game timing is stored in **ticks**, converted from the milliseconds in `data/` at load time and rounded to the nearest tick.

Each `Region.Step()` runs these steps in order:
1. **Drain the inbox:** intents from players, and joins and leaves.
2. **Validate the intents and turn them into actions** (see [security.md](security.md)). An invalid intent is dropped and counted.
3. **Advance movement:** move each entity's position along its path by `speed × dt`. A path ends when its last waypoint is reached.
4. **Run the AI:** creatures pick targets, wander and leash.
5. **Resolve combat:** attack timers, ability effects, area attacks landing on this tick, damage, deaths.
6. **Skilling:** gathering and processing timers, success rolls, XP, depleting and respawning resource nodes.
7. **Timers:** respawns, ground item expiry, buffs.
8. **Update interest:** grid cell changes, then enter and leave events.
9. **Flush:** for each client, encode this tick's events into **one** binary frame and pass it to the writer goroutine.

**What runs now.** `Region.Step()` (`server/internal/region`) does steps 1–3 and 7–9; AI, combat and skilling slot in between movement and the timers as they arrive:
1. **Inbox:** joins, leaves, intents and notices (the shutdown warning), in arrival order. `move_to` is rate-limited and range-checked here, and only a player's last click in the tick is kept. `chat_say` is handled here too, and its `chat` goes out in this tick's frame (see [Local chat](#local-chat)).
2. **Paths:** each kept click becomes a path from where the player is this tick (see [Pathfinding](#pathfinding)), or a stop.
3. **Movement:** every walking entity moves to where its quantised path puts it this tick; one at or past the end stops there.
4. **Timers:** the [idle logout](#idle-logout) (a warning, then the logout) and [periodic saves](#saving-characters).
5. **Interest:** entities that crossed a cell boundary move cells, with their enter and leave events.
6. **Flush:** each player with anything queued gets one frame. A player whose queue is full is removed afterwards (its `entity_leave` goes out with the next tick).

Within a tick a player's frame is in event order: `chat` and `system_message` from step 1, `path_started` and `path_stopped` from steps 2–3, the idle warning from step 4, then `entity_enter` and `entity_leave`. An entity that comes into view in the same tick as it starts a path arrives as one `entity_enter` carrying that path.

**The loop** (`Region.Run`) steps at `1 s / tick_hz`. A tick that finishes late is followed straight away by the next, so the simulation catches up; a tick over the 10 ms budget is logged. Exporting tick time as a metric comes with `/metrics`.

**Tests call `Step()` directly** with a fake clock. A whole fight or gathering session runs in milliseconds ([ADR 0009](../decisions/0009-fast-ci.md)).

**Budget:** a region's tick must finish within **10 ms at p99** with its target population. The time is exported as a metric. If the tick runs over, the loop logs it and catches up by running the next tick immediately. It never skips simulation.

## Entities

Plain structs in slices indexed by a per-region `EntityID` (u32, recycled with a generation counter: the slot index in the low 20 bits, so a region holds up to about a million entities, and the slot's generation in the high 12; 0 is never an id). There's no inheritance tree. Components are optional fields or side tables, checked only by the systems that need them:

| Kind | Has |
|---|---|
| Player | Position, path, combat stats, equipment bonuses, inventory, skills, session |
| Creature | Position, path, combat stats, AI state, drop table id, respawn point |
| Resource node | Position, node type, depleted-until tick |
| Ground item | Position, item id, quantity, owner, public-at tick, expires-at tick |
| NPC (talk or shop) | Position, dialogue or quest hooks |

## Pathfinding

The code is `server/internal/navmesh`. Its fixtures are in `testdata/`.

- **Loading:** the navmesh comes from `data/regions/<region>.region.json` ([ADR 0004](../decisions/0004-navmesh-baked-in-godot.md)). The file format is below.
  - Polygon adjacency is computed at load from edges that share both vertex indices, after merging vertices closer than 1 cm.
  - The loader also labels islands (connected groups of polygons) and builds a 4 m polygon lookup grid for "which polygon is this point in?".
  - A loaded `Mesh` is read-only and shared. Path search needs scratch memory, which lives in a `Pathfinder` owned by the region's tick goroutine. A warmed-up `FindPath` makes no allocations, and neither does `Raycast`.
- **`FindPath(from, to)`:**
  1. Snap `to` onto the nearest polygon within 5 m (3D distance). Further away, or on another island, means no path.
  2. If the straight line is clear (`Raycast`), walk it. Most clicks are in plain sight, so this skips A* and avoids zigzags through small polygons.
  3. Otherwise run A* over polygons, with costs through portal-edge midpoints, then the funnel algorithm (string pulling).
  4. The result is a few waypoints with heights (y). The first waypoint is the start.
  5. Extra waypoints are added where the path crosses a polygon edge and straight-line height interpolation would be more than 5 cm off the surface, for example at the top and bottom of a ramp. So a client that interpolates linearly between waypoints stays on the ground.
- **Path length cap:** 150 m, or 2,000 polygons explored.
  - A path longer than 150 m is cut at 150 m along its route.
  - If the search runs out of polygons, the path goes to the explored point nearest the target.
  - Either way the status is `Partial` and the entity walks it. A failed path (`NoPath`) stops the entity with no error message.
  - The limits are `navmesh.DefaultLimits`.
- **`Raycast(from, to)`** walks the line across the mesh in XZ and reports where the mesh edge stops it. It's used for line of sight (ranged and Voodoo attacks) and to clamp dashes (`RayHit.Pos`). A ray that runs exactly along a straight wall carries on through the vertices where polygons meet.
- **`HeightAt(p)`** gives the surface height under a point. Where levels overlap (a bridge over a path), it picks the level nearest `p.Y`.
- **Walking a path** (`server/internal/region`):
  - The waypoints are rounded to whole centimetres (the protocol's `pos`), consecutive duplicates are dropped, and the path is cut at the protocol's 64 waypoints. That quantised path is what's broadcast **and** what the server walks, using the same formula as the clients ([networking.md](networking.md#movement-playback)).
  - The path's first waypoint is the entity's current position, not `FindPath`'s snapped start, so a repath never jumps.
  - A path shorter than 10 cm (a click on the spot) stops you instead, as does `NoPath`.
  - A standing entity is always exactly on the centimetre grid.
- **Followers** (chasing a target) repath at most every 4 ticks, and only if the target moved more than 1 m.
- **Budget:** under 0.2 ms per path on the test regions.
  - `BenchmarkFindPath` runs in the slow lane (`tools/slow-tests.sh`), which fails if any mesh is over budget.
  - It times random same-island pairs on a generated 200 m × 200 m mesh: 2 m squares on hills with 60 obstacles, about 10,000 polygons. That's much denser than a Godot bake.
  - It also times `data/regions/test_greybox.region.json` (and `TestGreyboxRegion` checks paths on it) when that file exists.
  - The fast check only asserts no allocations and a coarse 1 ms bound.
  - On the owner's Mac (M5 Pro):

| Mesh | Per path | Polygons explored | Partial | Raycast |
|---|---|---|---|---|
| Generated | about 60 µs | about 680 | 23 % | about 0.5 µs |
| Greybox export (1,736 triangles) | about 26 µs | about 250 | 25 % | about 1 µs |

### Region file, format 1

Written by `client/tools/export_region.gd`. Never edit it by hand.

```json
{
  "format": 1,
  "region_id": "test_greybox",
  "source_hash": "<hex sha256 of the region scene>",
  "navmesh": {
    "vertices": [[x, y, z], ...],
    "polygons": [[i0, i1, i2, ...], ...]
  },
  "player_spawns": [{"pos": [x, y, z]}],
  "respawn_points": [{"pos": [x, y, z]}],
  "creature_spawns": [],
  "resource_nodes": [],
  "exits": [],
  "entry_points": []
}
```

- **Vertices:** metres, on Godot's axes (+Y up), in region (world) space.
- **Polygons:** as `NavigationMesh.get_polygon()` returns them.
  - Each has 3 to 6 indices into `vertices` and is convex in XZ.
  - Either winding is accepted. The loader normalises it by signed area in the XZ plane.
  - Adjacency isn't stored. Two polygons are linked only if they share both vertices of an edge (within 1 cm), so a T-junction (one long edge against two short ones) isn't linked. A normal single-pass Godot bake shouldn't produce them.
- **Spawn and respawn points** must be within 5 m of the navmesh.
- **Markers:** `creature_spawns`, `resource_nodes`, `exits` and `entry_points` are kept raw (`json.RawMessage`) for the tasks that use them. The exporter writes these shapes:
  - creature spawn: `{"count", "creature_id", "pos", "respawn_s", "wander_radius"}`
  - resource node: `{"node_id", "pos"}`
  - exit: `{"pos", "size", "target_entry", "target_region", "yaw"}`. `pos` is the box centre and `size` its full size.
  - entry point: `{"entry_id", "pos", "yaw"}`
  - `yaw` is in radians about +Y, where 0 faces −Z, counter-clockwise seen from above. Numbers have 3 decimals.
- **Validation:** `dataval`, and so the fast check, loads every region file. It rejects:
  - a wrong format version or unknown fields
  - an out-of-range index
  - a polygon that's degenerate (repeated vertex, zero area) or not convex
  - an edge shared by three polygons, or two overlapping polygons
  - a `region_id` that doesn't match the file name

## Interest management

- The region uses a uniform grid of **16 m cells** over the navmesh's bounds. A player **sees** every cell within a radius of **64 m** (`region.Config.ViewRadius`, configurable): every cell whose centre is within 64 m of their own cell's centre. That's 49 cells, so you always see at least 41 m in every direction (64 m minus a cell's diagonal) and at most about 86 m.
- Seeing is symmetric: two players either see each other or neither does, and they find out in the same tick.
- An entity's position is checked against its cell every tick. Crossing a boundary is the only thing that changes what anyone sees.
- When a player crosses a cell boundary, the server works out which entities entered and left their view:
  - `entity_enter` carries the entity's full current state, including any path it's on.
  - `entity_leave` removes it.
- An event about an entity goes only to players who can currently see it.
- On joining, a player gets `entity_enter` for itself first, then for everything in view. Its own events (`path_started`, `path_stopped`) come back to it like anyone else's.
- **Crowd control** (not built yet): if more than about 150 entities are in view, low-priority ones are dropped first (other players' cosmetic actions, distant players). You still see them, with less detail.

## Local chat

`Region.chat` handles `chat_say` in the inbox step, in this order:

1. **Rate limit:** 1 a second, burst 3 (`Config.ChatLimit`, counted in ticks). Over it is dropped and counted as invalid, like `move_to`.
2. **Clean** (`server/internal/chat`, `Clean`): runs of whitespace become one space and the ends are trimmed. Control characters (Unicode Cc) and format characters (Cf) are dropped: Cf is where the bidi controls that could reverse text live (U+202A–U+202E, U+2066–U+2069, U+200E/F, U+061C) and the zero-width ones that could hide or split a word (U+200B–U+200D, U+2060, U+FEFF, the soft hyphen). A few letters that draw as nothing (the Hangul fillers and the blank Braille pattern) count as whitespace. Dropping U+200D splits emoji joined with it (a family emoji shows as its people); variation selectors stay.
3. **Empty** once cleaned: dropped, not invalid (`Stats.ChatEmpty`). Nothing is sent.
4. **Length:** over `chat.max_chars` (120) Unicode code points once cleaned is dropped and counted as invalid (`Stats.ChatTooLong`), never cut short. A real client can't type more, so a longer line isn't from one. The wire limit is 480 bytes, 4 per character.
5. **Muted:** the line is dropped and only the speaker gets `system_message(chat_muted)` (`Stats.ChatMuted`). The entity's `muted` flag is always false until staff tools arrive in M7. A muted player's notices are rate limited like their chat.
6. **Filter** (`chat.Filter`, from `data/chat_filter.json`): each listed word is replaced by `*` for each of its characters, so the length never changes (`Stats.ChatFiltered` counts lines with a hit).
   - A word is a run of letters, digits and substitution symbols. It matches a listed word if, lower-cased and with each symbol read as its letter (`$` → s, `1` → i, `0` → o and so on, also in the file), it's equal to it. Digits and symbols at either end are also tried without, so `shit!` masks as `****!` and `$hit` as `****`.
   - Only whole words match, so `shitake` and `Scunthorpe` are safe. The price is that every form has to be listed (`fuck`, `fucking`, `fucker`).
   - The list is short and obvious on purpose; the owner extends it. Don't add a word that's also an everyday word or a name (dick, cock, prick): it would mask innocent chat. `dataval` checks every word is 2–32 letters a–z, with no duplicates, and every substitution is one non-letter mapped to one letter.
   - The file is server-only: it isn't copied to the client, though it is part of the content hash.
7. **Deliver:** one `chat(entity, name, role, text)` to every player within `chat.radius_m` (40 m, `data/progression.json`) of the speaker, **measured in 3D**, the speaker included, in this tick's frame. The candidates are the speaker's watchers from the interest grid, so the radius must fit inside the view: `region.New` refuses a radius over the view radius less a cell's diagonal (64 − 22.6 = 41.4 m). `role` is always `normal` until accounts arrive in M1.

**3D, not 2D:** someone on a cliff 30 m above you and 30 m along is 42 m away and doesn't hear you, even though they're 30 m away on the map. That matches what you see, and caves under hills don't overhear the hill.

**Never logged:** the region doesn't log chat text, or anything about a line except the `Stats` counters (`ChatSent`, `ChatFiltered`, `ChatEmpty`, `ChatMuted`, `ChatRateLimited`, `ChatTooLong`). Chat reports with context (M7) will need their own retention rules.

A whole-region "shout" may come later ([open questions](../open-questions.md), S3).

## Saving characters

The code: `server/internal/persist` (the saver, the store interface and an in-memory store for tests) and `server/internal/persist/pgpersist` (Postgres). How the world reaches the database, and why: [ADR 0017](../decisions/0017-world-saves-to-postgres-directly.md).

**What's saved** (M1): the region, the position (whole centimetres, like the protocol) and HP. HP is stored as null for full; nothing changes it until combat (M3), which also defines maximum HP. Skills, items, the bank and quests join the save as their milestones arrive. Dev players (`-dev-tickets`) are never saved, and a world with no database runs fine for them.

**Joining** with a join ticket, in the connection's goroutine (never a region's):
1. The world takes the character's **online lease** and loads it, in one transaction that locks every row of the account. It refuses with `kick(already_online)` if any of the account's characters holds an unexpired lease, on any world, so an account has one character online even if the API issued two tickets at once. A character that isn't the ticket's account's, or is deleted, gets `kick(bad_ticket)`; a database error, `kick(unavailable)`.
2. The player joins the region they were saved in, at their saved position snapped onto its navmesh (within 5 m). A new character, a saved region this world doesn't have, or a position off the mesh starts at a `player_spawns` point.

**Saving:**
- **Periodically:** each player is checked every 60 s from when they joined (`region.Config.SaveEvery`), so saves are spread out, and saved only if their position or HP changed. A new character is saved at the first check.
- **On leaving the region, for any reason:** logging out, closing the tab, a dropped connection, the idle logout, a kick, too slow, and shutdown. That save is where the player stands, mid-walk included, and it releases the lease.
- **Never on the tick:** the region hands the save to the saver (`persist.Saver.Enqueue`), which never blocks. The saver keeps the newest unsaved state of each character in memory and writes them from its own goroutine, as one transaction per batch. If the database fails, the saves stay queued (a newer save replaces an older one, and a release is never lost) and are tried again every 2 s. `TestTheTickNeverWaitsForTheDatabase` steps a region with 20 players walking and leaving while the database is stuck.
- Every save also records `last_played_at`, which the API shows in the character list.

**The online lease:** `characters.online_world_id`, `lease_until` and `lease_id` (a random token the world picks when it takes the lease).
- A lease lasts 60 s (`persist.LeaseTTL`). The saver renews every lease the world holds every 20 s (`persist.RenewEvery`), and every save extends it too.
- The world saves, renews and releases only by its token, on its own world id. While a world holds a lease, the API refuses `POST /api/join` (`already_online`), renames and deletes for that account.
- **Crash safety:** a crashed world stops renewing, so its characters can log in again within 60 s. When a world starts, it ends every lease still on its own world id (one process per world, so they're left from its crash), and players can log in at once. What a crash loses is any walking since each player's last periodic save.
- **A stalled world:** if a world stops renewing for over 60 s and another world takes a character, the stalled world's saves for it change nothing. When it next renews or saves, it learns the lease is gone and disconnects the player with `kick(already_online)`.

**Not yet:** saving right away on a region transfer, a bank deposit or withdrawal, and quest completion (those features don't exist yet).

## Shutdown

On SIGTERM (or Ctrl-C), `cmd/world`:
1. Stops accepting connections (`503`).
2. If anyone is playing, sends everyone `system_message(shutdown_warning, 60)` ("The world is restarting in 1 minute") and waits 60 s (`-shutdown-warning`). Players keep playing meanwhile. A second signal skips the rest of the wait. An empty world skips it altogether.
3. Sends every player `kick(shutdown)` and closes them, waiting up to 10 s. Each player leaves their region as their connection closes, which saves them and releases their lease.
4. Stops the regions. A region saves anyone still in it as it stops (`Region.Stop`), for example a connection that didn't close in time.
5. Writes every queued save, retrying for up to 15 s, then exits.

Compose's `stop_grace_period` for the world is 100 s, which covers all of it.

## Idle logout

Open question S4, answered by the owner on 2026-11-24.

- A player who sends **no input for 15 minutes** is logged out, saved where they stand (`data/progression.json` `session.idle_logout_s`).
- **1 minute before** (`session.idle_warning_s`), they get `system_message(idle_warning, 60)`, which the client shows in the chat box.
- **Input** is any intent the client sends: a click to move, a chat line, and later attacks, abilities and item actions. A key press counts when it does something in the game, and so sends an intent; keys that only move the camera don't reach the server. The client's clock-sync pings and the browser's keepalive pongs aren't input, so a background tab is logged out like any idle player. Walking a long path isn't input either, only the click that started it.
- The logout is `kick(idle)`. The region times it in ticks, so tests run 15 minutes of idling in milliseconds.

## Item safety

- Items are only ever **moved** between containers (inventory, equipment, bank, the ground), or **created** and **destroyed** by named sources and sinks (drops, gathering, crafting, quests, eating, dropping). Every create and destroy has a reason code.
- **Rare items** (a drop rate of 1/100 or rarer, or flagged `audit: true`) write an audit row when created and whenever they change owner.
- An invariant test runs randomised action sequences: item counts must change only through sources and sinks.

## Metrics and logs

- Built so far: JSON logs (`log/slog`) for startup, joins, leaves, server-side closes, slow ticks, refused joins, failed saves and lost leases, and the region's `Stats` counters (invalid intents by type, players dropped by reason including idle, chat lines by outcome, saves queued). `/metrics` itself isn't built yet.
- Prometheus-style `/metrics` on an internal port: tick time (p50, p99, max), players and entities per region, bytes in and out, invalid intents by type, save duration.
- Structured JSON logs. Never log tokens, tickets or chat containing personal data. The world server logs no chat text at all.
