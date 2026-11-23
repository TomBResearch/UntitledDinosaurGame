# Client (Godot web)

Godot 4.7.2, typed GDScript, Compatibility renderer ([ADR 0001](../decisions/0001-godot-web-client.md)).

## Rule: no game rules

The client never decides an outcome. It sends intents and shows events. Anything it predicts, which is only the click marker and turning on click (later, maybe the dash), is cosmetic and gets overwritten by server events.

## Project layout (`client/`)

| Path | What |
|---|---|
| `autoload/net.gd` | `WebSocketPeer`, handshake, batching, reconnect, dispatching messages to handlers |
| `autoload/clock.gd` | Server clock estimate, interpolation delay |
| `autoload/session.gd` | Platform login, single-flight token refresh, `/api` calls (via a `JavaScriptBridge` fetch wrapper on the web) |
| `autoload/content.gd` | Loads the client-safe content generated from `data/`; its hash goes in `hello` |
| `net/proto/` | **Generated** encoders and decoders. Never edit them by hand. |
| `screens/` | Boot (version check), Login, World select, Character select and create, Loading, Game |
| `world/` | Region scenes, chunk streaming, the entity view manager, click picking |
| `entities/` | Visual scenes for players, creatures, nodes and ground items. Each one plays back paths and animations. |
| `ui/` | HUD, inventory, equipment, skills, bank, chat, dialogue, context menu, ability bar |
| `regions/<region>/` | Authoring scenes: terrain chunks, props, navmesh, marker nodes ([content-pipeline.md](content-pipeline.md)) |
| `tools/export_region.gd` | Editor script that exports region data for the server |
| `tests/` | GUT unit tests (path playback, clock, proto round-trips, UI logic) |

## Input

| Input | Action |
|---|---|
| Left click on ground | `move_to` |
| Left click on an entity | Its default option (attack a creature, chop a tree, talk to an NPC, take an item) |
| Right click | Context menu of every option, like RuneScape |
| Keys 1–4 | Abilities: 1 Dash/Dodge, 2 (to be decided), 3 Defensive, 4 Weapon special |
| Mouse wheel / middle drag | Camera zoom and orbit (third person, following you) |
| Enter | Chat |

Clicks pick entities by raycasting against simple collision shapes on the entity scenes. Ground clicks raycast against the terrain collision.

## Region streaming

- Each region is split into **64 m chunks**, each its own scene with terrain, props and decoration.
- The client keeps chunks within **about 160 m** loaded and frees those beyond about 220 m. The two distances differ (hysteresis) so a chunk near the edge doesn't load and unload repeatedly.
- Loading uses `ResourceLoader.load_threaded_request`. **M0 spike:** check how this behaves in the web build, both single-threaded and with threads (which need COOP/COEP headers). Pick whichever gives the fewest hitches, and record it in an ADR.
- Changing region shows a loading screen. The new region's nearby chunks load before you appear.

## Rendering budgets (desktop browser, first target)

| | Budget |
|---|---|
| Frame rate | 60 fps on a 2020 integrated GPU (Intel Iris Xe or Apple M1) |
| Draw calls | under 400 |
| Triangles on screen | under 400k |
| Characters on screen | up to 100 at full detail, simpler models beyond 30 m |
| Initial download | under 25 MB compressed before the login screen (engine plus core) |

Mobile browsers are an [open question](../open-questions.md).

## Web export settings

- Precompressed `.br` and `.gz` files are served by Caddy, as in the racing game.
- The `index.html` shell shows a branded loading bar.
- `Cache-Control: no-cache` on `index.html`, and long caching on content-hashed `.pck` and `.wasm` files.
