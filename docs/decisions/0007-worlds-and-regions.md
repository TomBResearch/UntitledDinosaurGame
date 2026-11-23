# 0007: Worlds are processes; regions are self-contained, with loading transitions between them

**Status:** Accepted (2026-11-23)

## Context

The owner wants RuneScape-style world selection: each world is a full copy of the map, and some worlds are premium-only. The target is about 1,000 players per world. The client can't load the whole map at once. The owner was happy with either seamless travel or loading screens, whichever suits the server better.

## Decision

- **World:** one `cmd/world` process, with an id, name, `premium_only` flag and player cap. The worlds list lives in the backend database.
- **Region:** a large area of the map (for example "Fern Valley", "Tar Pits" or a cave). Each region has its own navmesh, entities and **tick loop goroutine**. A region never reads or writes another region's state directly.
- **Inside a region, everything is seamless.** The client streams terrain chunks around the player, and the server sends only nearby entities (interest management; see [world-server.md](../architecture/world-server.md)).
- **Between regions, there's a short loading transition** at natural chokepoints: a cave mouth, a mountain pass, a river crossing. The player leaves region A's tick and joins region B's at the entry point, and the client loads B's scene.
- **Dungeons and boss lairs** are regions, and later can be per-group instanced regions.
- **Scaling path:** a region talks to the rest of the world only through messages (transfer a player, world chat). So a busy region can later move into its own process or machine without rewriting game code.

## Consequences

- At first, all regions of a world share one process. On the test server, there are 2 worlds (one free, one premium).
- Regions must be designed with clear chokepoint connections. That's a level-design rule.
- Cross-region features (world chat, friends online, trading later) go through the world-level message hub, not direct calls.

## Rejected

- **A seamless world with server handoff at region borders:** much harder (entities near borders, handoff races), and not needed for this game.
- **One loop for the whole world:** caps a world at one CPU core and makes splitting later harder.
