# 0004: The navmesh is baked in Godot and exported for the server

**Status:** Accepted (2026-11-23)

## Context

The server pathfinds ([0002](0002-free-movement-server-paths.md)) and is written in Go ([0003](0003-go-server.md)). Levels are built in the Godot editor. If the navmesh were baked twice with two tools, client and server could disagree about where you can walk.

## Decision

- **Godot is the only place a navmesh is baked.** Each region scene has a `NavigationRegion3D`, baked in the editor.
- **An editor tool script** (`client/tools/export_region.gd`, run headless by `tools/export-regions.sh`) writes `data/regions/<region>.region.json` (or a compact binary later). The file contains:
  - navmesh vertices and polygons, with polygon adjacency
  - spawn points (creatures, players and respawn points)
  - resource nodes (trees, rocks, fishing spots, dig sites), with their type ids
  - region exits (trigger area, then target region and entry point)
  - static blockers used for line of sight, if any
- **Each exported file records a hash of its source scene.** The fast check fails if a scene changed and wasn't re-exported.
- The server never edits region data. To change the world, change the scene and re-export.

## Consequences

- Level designers, human or agent, work only in Godot. Placing a tree or a spawn means placing a marker node with the right script.
- The Go side needs a loader plus A*, funnel and navmesh raycast. All are pure functions tested against small fixture regions.
- Terrain height comes from the navmesh polygons, so the server knows the height (y) at every position, and clients don't need to agree on physics.

## Rejected

- **Baking with Recast in Go (bindings or a port) from exported geometry:** a second bake can drift from what the editor shows.
- **Exporting raw collision meshes and pathfinding on them:** more data and harder pathfinding for no benefit.
