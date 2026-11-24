# 0003: Go for the world server and the backend API

**Status:** Accepted (2026-11-23)

## Context

The target is about 1,000 players per world, on modest hardware to start with (a shared 2 GB ARM server). The owner said efficiency matters far more here than in the racing game, and that matching the racing game's TypeScript is not a requirement. The heavy work is the world simulation: ticking every entity, working out who can see whom, combat, and encoding updates for every connected player. Fast CI also matters ([0009](0009-fast-ci.md)).

## Decision

- **One Go module (`server/`), Go 1.27**, producing these programs:
  - `cmd/world`: the world server. One process per world, with one tick loop (a goroutine) per region.
  - `cmd/api`: the HTTP backend (worlds, characters, join tickets, deletion hook).
  - `cmd/protogen`: generates protocol codecs for Go and GDScript ([0005](0005-websocket-generated-protocol.md)).
  - `cmd/dataval`: validates `data/` ([0011](0011-content-as-json-data.md)).
- **Shared internal packages** for content definitions, formulas, the protocol and the database.
- **PostgreSQL through `pgx`**, with SQL migrations committed and applied on start.
- **Region code is single-threaded inside its tick.** Concurrency happens only between regions and in network I/O, which keeps game logic simple and deterministic in tests.

## Consequences

- The client and server are in different languages. That's acceptable because the client holds no rules: it shares data files and a generated protocol, not logic.
- Godot stays the tool for all content. The server reads exported region data ([0004](0004-navmesh-baked-in-godot.md)).
- Pathfinding (A* plus funnel over navmesh polygons) and the navmesh raycast used for line of sight are written in Go. These are well-known algorithms, a few hundred lines, and fully unit-testable.
- Go cross-compiles to `linux/arm64` with one command, which suits the Graviton server.
- Garbage collection: keep the hot paths low on allocations (reuse buffers, avoid per-tick maps). Watch tick-time percentiles in metrics.

## Rejected

- **Headless Godot server (GDScript):** shares the engine, but interpreted GDScript becomes the bottleneck for per-player work at high player counts, it needs about 150–300 MB per process, and automated tests are slower to run.
- **Rust:** fastest and has no garbage collector, but long compile times would bring back the slow-CI problem, and the borrow checker slows iteration for both agents and the owner. Our workload doesn't need its extra speed. Revisit only if profiling shows Go's garbage collection hurting tick times.
- **TypeScript (Node):** matches the racing game, but it's single-threaded and slower for simulation work, and efficiency is the priority here.
- **C# (.NET):** a good option, but heavier to run and slower to compile than Go, with no advantage for us.
