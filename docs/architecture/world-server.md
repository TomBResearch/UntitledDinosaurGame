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

**Tests call `Step()` directly** with a fake clock. A whole fight or gathering session runs in milliseconds ([ADR 0009](../decisions/0009-fast-ci.md)).

**Budget:** a region's tick must finish within **10 ms at p99** with its target population. The time is exported as a metric. If the tick runs over, the loop logs it and catches up by running the next tick immediately. It never skips simulation.

## Entities

Plain structs in slices indexed by a per-region `EntityID` (u32, recycled with a generation counter). There's no inheritance tree. Components are optional fields or side tables, checked only by the systems that need them:

| Kind | Has |
|---|---|
| Player | Position, path, combat stats, equipment bonuses, inventory, skills, session |
| Creature | Position, path, combat stats, AI state, drop table id, respawn point |
| Resource node | Position, node type, depleted-until tick |
| Ground item | Position, item id, quantity, owner, public-at tick, expires-at tick |
| NPC (talk or shop) | Position, dialogue or quest hooks |

## Pathfinding

- The navmesh is loaded from `data/regions/<region>.region.json` ([ADR 0004](../decisions/0004-navmesh-baked-in-godot.md)): polygons, adjacency, and a polygon lookup grid for "which polygon contains this point?".
- **`FindPath(from, to)`:** snap `to` onto the nearest polygon within 5 m, run A* over polygon centres (portal edges), then apply the funnel algorithm. The result is a few waypoints with heights (y).
- **Path length cap:** 150 m, or 2,000 polygons explored. A longer click walks as far as the cap allows. A failed path stops the entity with no error message.
- **`Raycast(from, to)`** over the navmesh is used for line of sight (ranged and Voodoo attacks) and to clamp dashes.
- **Followers** (chasing a target) repath at most every 4 ticks, and only if the target moved more than 1 m.
- **Budget:** under 0.2 ms per path on the test regions. A pathfinding benchmark runs in the slow lane.

## Interest management

- The region uses a uniform grid of **16 m cells**. A player **sees** every cell within a radius of **64 m** (`view_radius_m`, configurable).
- When a player crosses a cell boundary, the server works out which entities entered and left their view:
  - `entity_enter` carries the entity's full current state, including any path it's on.
  - `entity_leave` removes it.
- An event about an entity goes only to players who can currently see it.
- **Crowd control:** if more than about 150 entities are in view, low-priority ones are dropped first (other players' cosmetic actions, distant players). You still see them, with less detail.

## Saving characters

- **Dirty tracking:** any change to a character's skills, items, bank, quests or position marks it dirty.
- **The saver saves dirty characters every 60 s**, plus right away on logout, region transfer, a bank deposit or withdrawal, and quest completion. Each save is one transaction.
- **Online lease:** `characters.online_world_id` and `lease_until` are refreshed every 20 s by the world. A crashed world's characters can log in again after 60 s.
- **Shutdown** (SIGTERM): stop accepting joins, warn players ("World restarting in 60 s"), save everyone, then release the leases.

## Item safety

- Items are only ever **moved** between containers (inventory, equipment, bank, the ground), or **created** and **destroyed** by named sources and sinks (drops, gathering, crafting, quests, eating, dropping). Every create and destroy has a reason code.
- **Rare items** (a drop rate of 1/100 or rarer, or flagged `audit: true`) write an audit row when created and whenever they change owner.
- An invariant test runs randomised action sequences: item counts must change only through sources and sinks.

## Metrics and logs

- Prometheus-style `/metrics` on an internal port: tick time (p50, p99, max), players and entities per region, bytes in and out, invalid intents by type, save duration.
- Structured JSON logs. Never log tokens, tickets or chat containing personal data.
