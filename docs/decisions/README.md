# Decision records

Each significant technical choice gets a short record: the context, the decision, its consequences, and what was rejected. Records are never edited to change a decision. Instead, a new record supersedes the old one, and the owner approves it.

**Status values:** Proposed (not yet approved; ask before building on it), Accepted, or Superseded by NNNN.

| # | Decision | Status |
|---|---|---|
| [0001](0001-godot-web-client.md) | Godot 4.7.2 web client in typed GDScript, Compatibility renderer | Accepted |
| [0002](0002-free-movement-server-paths.md) | Free click-to-move: the server computes paths and clients play them back | Accepted |
| [0003](0003-go-server.md) | Go for the world server and backend API (not Godot headless, TypeScript or Rust) | Accepted |
| [0004](0004-navmesh-baked-in-godot.md) | The navmesh is baked in Godot and exported for the server | Accepted |
| [0005](0005-websocket-generated-protocol.md) | WebSocket transport with a binary protocol generated from one schema | Accepted |
| [0006](0006-shared-account-platform.md) | Use the shared account platform; integrate with config only | Accepted |
| [0007](0007-worlds-and-regions.md) | Worlds are processes; regions are self-contained, with loading transitions between them | Accepted |
| [0008](0008-public-wiki-private-docs.md) | Public `wiki/` and private `docs/` | Accepted |
| [0009](0009-fast-ci.md) | A fast CI lane on every push; slow tests nightly | Accepted |
| [0010](0010-hosting-shared-server.md) | Host on the shared project server as a separate stack | Accepted |
| [0011](0011-content-as-json-data.md) | Game content as JSON in `data/`, with a content hash | Accepted |
| [0013](0013-region-streaming-web-threads.md) | Stream region chunks on the single-threaded web build; no cross-origin isolation | Proposed |

Template: [0000-template.md](0000-template.md)
