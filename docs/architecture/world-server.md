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
└── saver: batches character saves to Postgres
```

The code: `server/cmd/world` (the process and its flags), `server/internal/world` (the WebSocket endpoint and sessions; the hub's job while there's one region) and `server/internal/region` (the simulation). Players all join one spawn region for now; region transfers and the saver come later.

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

**What M0 runs.** `Region.Step()` (`server/internal/region`) does steps 1–3, 8 and 9; AI, combat, skilling and timers slot in between movement and interest as they arrive:
1. **Inbox:** joins, leaves and intents, in arrival order. `move_to` is rate-limited and range-checked here, and only a player's last click in the tick is kept. `chat_say` has its handler (`Region.chat`) waiting for the local chat task.
2. **Paths:** each kept click becomes a path from where the player is this tick (see [Pathfinding](#pathfinding)), or a stop.
3. **Movement:** every walking entity moves to where its quantised path puts it this tick; one at or past the end stops there.
4. **Interest:** entities that crossed a cell boundary move cells, with their enter and leave events.
5. **Flush:** each player with anything queued gets one frame. A player whose queue is full is removed afterwards (its `entity_leave` goes out with the next tick).

Within a tick a player's frame is in event order: `path_started` and `path_stopped` from steps 2–3, then `entity_enter` and `entity_leave`. An entity that comes into view in the same tick as it starts a path arrives as one `entity_enter` carrying that path.

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

## Saving characters

- **Dirty tracking:** any change to a character's skills, items, bank, quests or position marks it dirty.
- **The saver saves dirty characters every 60 s**, plus right away on logout, region transfer, a bank deposit or withdrawal, and quest completion. Each save is one transaction.
- **Online lease:** `characters.online_world_id` and `lease_until` are refreshed every 20 s by the world. A crashed world's characters can log in again after 60 s.
- **Shutdown** (SIGTERM): stop accepting joins, warn players ("World restarting in 60 s"), save everyone, then release the leases.
  - M0 has no saving yet. SIGTERM stops accepting connections, sends every player `kick(shutdown)` and closes them, waits up to 15 s, then stops the region loops.

## Item safety

- Items are only ever **moved** between containers (inventory, equipment, bank, the ground), or **created** and **destroyed** by named sources and sinks (drops, gathering, crafting, quests, eating, dropping). Every create and destroy has a reason code.
- **Rare items** (a drop rate of 1/100 or rarer, or flagged `audit: true`) write an audit row when created and whenever they change owner.
- An invariant test runs randomised action sequences: item counts must change only through sources and sinks.

## Metrics and logs

- Built so far: JSON logs (`log/slog`) for startup, joins, leaves, server-side closes and slow ticks, and the region's `Stats` counters (invalid intents by type, players dropped). `/metrics` itself isn't built yet.
- Prometheus-style `/metrics` on an internal port: tick time (p50, p99, max), players and entities per region, bytes in and out, invalid intents by type, save duration.
- Structured JSON logs. Never log tokens, tickets or chat containing personal data.
