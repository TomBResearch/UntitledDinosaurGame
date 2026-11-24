# 0001: Godot web client in typed GDScript

**Status:** Accepted (2026-11-23)

## Context

The game has to run in the browser first, with a desktop/Steam client later. The owner wants to use an established engine and its tooling rather than build an engine. An earlier attempt with no engine (Colyseus, Rapier and Recast in TypeScript) was abandoned for that reason.

## Decision

- The client is a **Godot 4.7.2** project, exported to the web. It's the same pinned version as Untitled Racing Game, so the owner has one install and one known-good web export.
- **GDScript with static typing everywhere.** Godot 4 still can't export C# to the web (checked November 2026; tracked in godotengine/godot#106125).
- **Compatibility renderer (WebGL 2)** only. It's the one renderer the web export supports, so the art style is designed around it: low-poly models, toon or unlit shading, baked or vertex lighting, few dynamic lights.
- The client is **a renderer and input device only**. It holds no game rules (see [0002](0002-free-movement-server-paths.md)), so most of the code a player can tamper with has nothing to cheat.
- Desktop and Steam builds later reuse the same project, exported natively.

## Consequences

- Godot's editor is where all levels are built, including navmesh baking ([0004](0004-navmesh-baked-in-godot.md)).
- Web builds are big (the engine `.wasm` alone is about 40 MB raw, about 7 MB with Brotli). Loading has to be designed for: a loading screen, region-by-region loading, and precompressed files.
- Threads on the web need cross-origin isolation headers (COOP/COEP). M0 checks whether background loading of regions works acceptably, with or without threads.

## Rejected

- **Godot 3 (C# on web):** an outdated engine for a new project.
- **Babylon.js or three.js with a hand-built engine:** this is the bespoke route the owner moved away from.
- **Unity WebGL:** heavier web builds, licensing risk, and no existing experience in the owner's projects.
