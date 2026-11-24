# Client (Godot web)

Godot 4.7.2, typed GDScript, Compatibility renderer ([ADR 0001](../decisions/0001-godot-web-client.md)).

## Rule: no game rules

The client never decides an outcome. It sends intents and shows events. Anything it predicts, which is only the click marker and turning on click (later, maybe the dash), is cosmetic and gets overwritten by server events.

## Project layout (`client/`)

Rows marked *(planned)* don't exist yet.

| Path | What |
|---|---|
| `main.tscn` | The entry scene: reads the launch options, asks for a dev name if needed, opens the game screen |
| `autoload/net.gd` | The `Net` autoload: the world connection, so it outlives screen changes. All its code is `NetClient`. |
| `net/net_client.gd` | `NetClient`: `WebSocketPeer`, the `hello` handshake, pings, decoding frames into typed signals, kicks |
| `net/clock_sync.gd` | `ClockSync`: the server clock estimate from pings |
| `net/proto/` | **Generated** encoders and decoders. Never edit them by hand. |
| `core/launch_options.gd` | Name, server URL and dev aids from the web query string or desktop arguments |
| `screens/` | `game/` (the world) and `name_entry/` now. *(planned)* Boot (version check), Login, World select, Character select and create, Loading |
| `world/` | `PathPlayback`, `MotionTrack`, `ErrorBlend`, the `EntityManager`, the `OrbitCamera` and the `ClickMarker`. *(planned)* chunk streaming |
| `entities/player/` | The player view: placeholder caveman and name label. *(planned)* creatures, nodes and ground items |
| `ui/` *(planned)* | HUD, inventory, equipment, skills, bank, chat, dialogue, context menu, ability bar |
| `autoload/session.gd` *(planned, M1)* | Platform login, single-flight token refresh, `/api` calls (via a `JavaScriptBridge` fetch wrapper on the web) |
| `regions/<region>/` | Authoring scenes: terrain chunks, props, navmesh, marker nodes ([content-pipeline.md](content-pipeline.md)) |
| `tools/export_region.gd` | Editor script that exports region data for the server |
| `data/` | **Generated** from `data/` by `dataval -emit-client` (ignored by git). `content_hash.txt` goes in `hello`. |
| `tests/` | GUT unit tests (path playback, clock, error blend, frame dispatch, proto round-trips, launch options) |

## Input

| Input | Action |
|---|---|
| Left click on ground | `move_to` |
| Left click on an entity | Its default option (attack a creature, chop a tree, talk to an NPC, take an item) |
| Right click | Context menu of every option, like RuneScape |
| Keys 1–4 | Abilities: 1 Dash/Dodge, 2 (to be decided), 3 Defensive, 4 Weapon special |
| Middle drag | Orbit the camera (third person, following you). Right click is kept for the context menu. |
| Arrow keys | Orbit the camera smoothly: left and right turn it, up raises it to look down more, down lowers it. Ignored while a text field (chat) has the keyboard. |
| Mouse wheel | Camera zoom |
| Enter | Chat |

Clicks pick entities by raycasting against simple collision shapes on the entity scenes. Ground clicks raycast against the terrain collision.

## Client core (M0)

How the pieces fit, as built in the M0 client core task. The wire rules are in [networking.md](networking.md).

### Connecting

- `NetClient.connect_to_world(url, "dev:<name>")` opens the `WebSocketPeer`. When it's open the client sends `hello` (`Proto.PROTOCOL_HASH`, the ticket, `res://data/content_hash.txt` and the project version).
- Every server frame goes through `Proto.decode(frame, FROM_SERVER)` and comes out as typed signals: `welcomed`, `entity_entered`, `entity_left`, `path_started`, `path_stopped`, `chat_received` and `kicked`. A frame that fails to decode, or a text frame, closes the connection with status 1002. Nothing is hand-encoded.
- Frames still waiting when the socket closes are read first, because a `kick` is often in the same poll as the close.
- Pings: four a second apart after `welcome` so the clock settles quickly (the server allows a burst of 3 and then 1 a second), then one every 5 s.
- Kicks: `refresh` shows "please refresh the page" (with a Refresh button that reloads it on the web); `shutdown` shows "The world is restarting." with Reconnect; `bad_ticket` goes back to the name box with a message; `misbehaving` shows an error with Reconnect. A close without a kick shows "Lost the connection" with Reconnect.

### Clock sync (`ClockSync`)

- Each pong gives a sample: `offset = (server_tick + tick_phase / 256) × tick_ms + rtt / 2 − received_at`.
- The target offset is the mean of up to 3 samples with the lowest round trip in the last 8, counting only samples within 20 ms of the best. One slow sample can't drag it.
- The offset in use **slews** towards the target at 5% of real time, so the estimated tick never jumps or runs backwards. It snaps only for the first sample or an error over 250 ms. A snap is reported, and the entity manager blends every entity across it.
- `welcome` counts as a rough first sample. Its round trip is from `hello` to `welcome`, plus one tick because it has no phase, so a real pong soon replaces it.

### Drawing entities

- `PathPlayback` is the server's `positionAt` in GDScript, in float64 and centimetres. Your own character is drawn at the estimated tick now; others are drawn 100 ms (2 ticks) behind.
- `MotionTrack` keeps the current path plus any that haven't started yet. A `path_started` for someone else usually arrives before the drawn time reaches its `start_tick`, so the old path plays until then and the switch is seamless. A `path_stopped` becomes a stationary "path" from its tick.
- Height is the path's `y`. Players have no client physics.
- **Correction (`ErrorBlend`):** whenever a path is replaced or the clock snaps, the difference between where the entity was drawn and where the new numbers put it eases out over 150 ms (smoothstep).
  - This covers errors under 0.5 m too. Your own character is drawn ahead of the server, so a repath of it at 150 ms of latency lands up to about 0.6 m from where it was drawn, and a snap would show.
  - Errors under 1 cm are ignored, and errors over 20 m (a teleport) snap.
- **Measured:** two desktop clients agreed on both players' positions at the same ticks to 0.0 cm over 96 samples (62 of them while walking). At 150 ms of simulated latency, no frame moved anyone more than 15 cm except during one 75 ms frame hitch, and each own-character repath showed as one blend.

### Click to move

- A left click raycasts from the camera against the physics world (the terrain's collision). The client shows the `ClickMarker`, turns your character to face the point at once and sends `move_to` with the point in whole centimetres. **It doesn't move until `path_started` arrives.**
- The marker clears on your own `path_stopped`, unless that stop's tick is before the tick when the click was sent (that stop is the end of an older path).

### Camera (`OrbitCamera`)

- Middle drag orbits; the wheel zooms. Pitch is clamped to 12–80° and distance to 4–30 m.
- The arrow keys orbit at up to 120°/s (turn) and 70°/s (tilt), easing in and out over about a fifth of a second, so a tap nudges the view and a hold turns it smoothly. Left and right turn the same way as dragging the mouse.
- The camera follows your character smoothly, and is pulled in front of any collision between it and you, so it never ends up underground.

### Launch options and dev aids

- **Web:** query string, for example `index.html?name=Grug&server=ws://127.0.0.1:8090/w/dev`.
- **Desktop:** user arguments, for example `godot --path client -- --name=Grug`.
- `server` defaults to `ws://127.0.0.1:8090/w/dev`. Without a `name` (or after the server refuses it) the client asks for one in a small text box.
- Dev aids for trying several clients at once:
  - `demo` clicks a random spot within 9 m every 2.5–5 s.
  - `lag=150` adds 150 ms of round-trip latency (75 ms each way).
  - `shot=<path>` saves the window to a PNG every 2 s (desktop).
  - `quit=<seconds>` quits after that long.
- The HUD's top line shows fps, the estimated tick, the best round trip, how far the clock is still slewing, entities in view and KB received.

### Web export

`client/export_presets.cfg` has a **Web** preset:
- single-threaded, no GDExtension;
- `data/*.json` and `data/*.txt` are included, and tests, GUT and editor tools are left out;
- output goes to `build/web/`, which is ignored by git.

Build it with `mkdir -p build/web && Godot --headless --path client --export-release Web ../build/web/index.html` (Godot won't create the folder) (about 2 s), then serve `build/web` on localhost. The world server allows `localhost:*` origins by default. It runs on WebGL 2 (Compatibility) in Chromium.

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
