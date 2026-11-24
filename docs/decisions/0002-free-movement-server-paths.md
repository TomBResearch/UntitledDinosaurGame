# 0002: Free click-to-move; the server computes paths and clients play them back

**Status:** Accepted (2026-11-23)

## Context

Movement is click-to-move, as in RuneScape, but the owner rejected a tile grid. Dodging boss mechanics must depend on where you actually stand, not which square you're on. The server must be authoritative. The previous attempt sank under client prediction, rollback and a physics engine.

## Decision

- **Continuous positions** (metres, as floats) on a **navmesh**. There's no grid.
- **The server computes every path.** The client sends `move_to(point)`. The server snaps the point to the navmesh, finds a path (A* over polygons, then funnel smoothing) and broadcasts `path_started(entity, waypoints, speed, start_tick)`.
- **Every client plays the same path back** at the known speed from the known start time. A path played this way comes out identical on every client, so there's no prediction, rollback or reconciliation, and no stream of position updates.
- **Hiding latency:** on click, the local client shows a click marker and turns the character towards the target at once. Walking starts when `path_started` arrives, one round trip later (typically 50–150 ms), which feels like normal click-to-move.
- **No physics engine and no player-on-player collision.** Characters move only along navmesh paths, and players pass through each other, as in most MMOs. Creatures use the same navmesh.
- **Dash (ability 1):** the client sends a direction. The server moves the dasher along the navmesh up to the dash distance (it stops at walls), grants a short window where they can't be hit, and broadcasts it as a fast path. Local prediction of the dash alone is allowed later if it feels slow. That's a small, isolated exception, not a general prediction system.
- **Area attacks** (circles, cones, lines, rings) are checked by the server against each player's position on the tick the attack lands. The client draws the warning shape the server sends.

## Consequences

- Very low bandwidth: messages are sent only when someone's path changes, not 20 times a second per entity.
- The server needs pathfinding over Godot's baked navmesh ([0004](0004-navmesh-baked-in-godot.md)).
- Boss warnings must last longer than normal latency (at least about 600 ms) so dodging is fair. If it ever feels unfair, "favour the dodger" lag compensation can be added later.
- Following a moving target (attacking a moving creature) means repathing on a timer, at most every 4 ticks per follower.

## Rejected

- **Tile grid with slow ticks (OSRS-style):** rejected by the owner because dodging would depend on squares.
- **Direct WASD control with client prediction and reconciliation:** much more complex (this is what the previous attempt struggled with), costs more per player, and isn't needed for click-to-move.
- **A physics engine on the server (Rapier, Jolt):** nothing in the design needs rigid-body physics.
