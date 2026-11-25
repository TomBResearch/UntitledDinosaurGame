# Client (Godot web)

Godot 4.7.2, typed GDScript, Compatibility renderer ([ADR 0001](../decisions/0001-godot-web-client.md)).

## Rule: no game rules

The client never decides an outcome. It sends intents and shows events. Anything it predicts, which is only the click marker and turning on click (later, maybe the dash), is cosmetic and gets overwritten by server events.

## Project layout (`client/`)

Rows marked *(planned)* don't exist yet.

| Path | What |
|---|---|
| `main.tscn` | The entry scene: reads the launch options, then on the deployed page checks the platform session and goes through characters and the world list to the game ([below](#characters-worlds-and-joining)); in a dev run it asks for a dev name and opens the game |
| `autoload/net.gd` | The `Net` autoload: the world connection, so it outlives screen changes. All its code is `NetClient`. |
| `net/net_client.gd` | `NetClient`: `WebSocketPeer`, the `hello` handshake, pings, decoding frames into typed signals, kicks |
| `net/clock_sync.gd` | `ClockSync`: the server clock estimate from pings |
| `net/proto/` | **Generated** encoders and decoders. Never edit them by hand. |
| `core/launch_options.gd` | Name, server URL and dev aids from the web query string or desktop arguments |
| `core/appearance_catalog.gd` | `AppearanceCatalog`: the appearance choices from `data/appearance.json` (names, colours, body sizes), stepping through them and random looks |
| `core/json_read.gd` | `JsonRead`: typed reads from parsed JSON with fallbacks |
| `net/api/` | `GameApi` (the backend API with the session's token; one refresh and retry on a 401) and `ApiText` (plain words for every API error) |
| `screens/` | `game/` (the world), `name_entry/` (dev runs), `account_check/` ("Checking your account…", or Try again when the platform can't be reached), `characters/` (the character list with rename and delete, and creation) and `worlds/` (the world list). *(planned)* Boot (version check), Loading. Login is on the landing page, not in the client ([ADR 0015](../decisions/0015-login-on-the-landing-page.md)). |
| `world/` | `PathPlayback`, `MotionTrack`, `ErrorBlend`, the `EntityManager`, the `OrbitCamera` and the `ClickMarker`. *(planned)* chunk streaming, starting from the spike's `SpikeChunkStreamer` |
| `spikes/streaming/` | The M0 streaming spike: region generator, chunk streamer, bench and web measuring tools ([README](../../client/spikes/streaming/README.md)). Not shipped. |
| `entities/player/` | The player view (`PlayerView`: name label, speech bubble) and the placeholder caveman (`CavemanModel`, `caveman.tscn`), drawn from a look. *(planned)* creatures, nodes and ground items |
| `ui/` | `ui/chat/`: the `ChatBox`, `ChatLog` and `SpeechBubble`. `ui/caveman_preview/`: the turning 3D caveman on the character screens. `ui/theme/screens.tres`: the menu screens' theme. *(planned)* HUD, inventory, equipment, skills, bank, dialogue, context menu, ability bar |
| `autoload/session.gd` | The `Session` autoload: the account platform session ([below](#platform-session)) and `Session.api`, the game API with its token. All its code is `SessionKeeper` (`core/session_keeper.gd`). |
| `net/platform/` | `PlatformSession` (token, profile, one refresh at a time), `PlatformReply`, and the transports: `WebPlatformTransport` (a `JavaScriptBridge` fetch) and the `PlatformTransport` base |
| `regions/<region>/` | Authoring scenes: terrain chunks, props, navmesh, marker nodes ([content-pipeline.md](content-pipeline.md)) |
| `tools/export_region.gd` | Editor script that exports region data for the server |
| `data/` | **Generated** from `data/` by `dataval -emit-client` (ignored by git). `content_hash.txt` goes in `hello`. |
| `tests/` | GUT unit tests (path playback, clock, error blend, frame dispatch, proto round-trips, launch options, chat, platform session, the game API, appearance, the character and world screens, the game screen's kicks). `tests/helpers/` has a fake game API transport. |

## Platform session

Login is on the landing page ([ADR 0015](../decisions/0015-login-on-the-landing-page.md)). The game only keeps the session going, in the `Session` autoload (`SessionKeeper`, `PlatformSession`):

- **When:** on the web, on a deployed page with no `name` option (`LaunchOptions.use_platform`). Desktop runs and local pages without `accounts=` never touch the platform, so dev tickets, `?name=` and `-- --name=` work as before.
- **Start:** `main.gd` shows "Checking your account…" and calls `Session.begin()`, which refreshes once (`POST /auth/refresh`, with the cookie).
  - Signed in: the character list ([below](#characters-worlds-and-joining)).
  - No session (401, or 403 for a ban or an origin the platform doesn't allow): straight back to `/` (`location.replace`, so Back doesn't return to the game).
  - No usable answer (offline, rate limited, platform down): Try again, or back to Base Camp.
- **Keeping it:** a one-shot timer refreshes 60 s before the access token expires (`PlatformSession.refresh_delay_s`; 840 s for the platform's 15-minute tokens). If the platform can't be reached it retries every 15 s; the world connection doesn't need the token. A refresh that finds the session gone (logged out on the landing page, banned, reused) goes back to `/`.
- **One refresh at a time:** a second caller waits for the refresh already running and gets the same answer. Across tabs, refresh and log out run under the Web Lock `udg-platform-session`, which the landing page takes too (`navigator.locks`), so the page and the game never refresh with the same cookie at once.
- **Log out:** the HUD's Log out button (shown only with a platform session) closes the world connection, waits for any running refresh, calls `/auth/logout` and goes to `/`.
- **Transport:** Godot's `HTTPRequest` can't send credentialed cross-origin requests, so `WebPlatformTransport` adds a small `window.udgPlatform.send` helper and calls `fetch(..., { credentials: "include" })` through `JavaScriptBridge`, with a callback per request.
- **Tests** (`tests/test_platform_session.gd`, headless, no real time): single-flight refresh, log out waiting for a refresh, what each answer means, the timer's delay and retries, and when to go back to `/`, with a fake transport and the timer's handler called directly.

## Characters, worlds and joining

With a platform session, `main.gd`'s `_on_signed_in()` goes: character list → (creation) → world list → `POST /api/join` → the game screen with the ticket. The screens live in the client, not on the landing page: the caveman preview is 3D, and the chosen character and world flow straight into the join without handing anything between pages. The design side (slots, names, appearance) is in [design/characters.md](../design/characters.md).

- **The game API** (`Session.api`, a `GameApi`) calls `/api` on the page's own origin through the same `JavaScriptBridge` fetch as the platform (`WebPlatformTransport` with an empty base URL), with `Authorization: Bearer <access token>`. A 401 refreshes the session once and tries again: a background tab pauses the refresh timer, so the token may have just expired. A second 401 means no session: back to `/`.
- **Character list** (`CharacterSelectScreen`): three slots from `GET /api/characters`; the selected character turns in the 3D preview (`CavemanPreview`, its own `World3D`). An empty slot opens creation. Rename and Delete open a dialog. Delete stays off until the name is typed (any case, as the API checks), and rename explains the 30-day wait from `nextRenameAt` before the player tries.
- **Creation** (`CharacterCreateScreen`): a name, and `<` `>` buttons for each part of the look, starting from a random look, with Randomise. The preview follows every change. `POST /api/characters` decides; the client checks nothing. Every refusal (name shape, not allowed, reserved, taken, slot used, look not available, rate limited) is shown in plain words from `ApiText`, and the player can fix it and try again.
- **World list** (`WorldSelectScreen`): `GET /api/worlds` with each world's busy band (Low, Medium, High, Full) or Offline, and a Premium badge on premium-only worlds. Without Premium (from the profile: `PlatformSession.has_premium()`, which counts staff) a premium world's Join is off and it says why. That's only a hint: the API decides with the account's fresh state.
- **Joining:** Join asks `POST /api/join`. A ticket opens the game at the API's `wsUrl`. Any refusal stays on the list with the reason (Premium, already online, offline, full, banned); a character that's gone goes back to the character list; no session goes to `/`.
- **In the world:** a refused ticket (`kick(bad_ticket)`) goes back to the world list with a message. Reconnect (after a drop or a world restart) asks for a new ticket for the same character and world, because each works once; if that fails the overlay says why and offers the world list. The HUD's Characters button leaves the world for the character list.
- **Looks in the world:** every player, you included, is drawn with the look in their `entity_enter` (`PlayerView.look_of`), which the world takes from their join ticket. Dev players have none and are drawn with the default look.
- **Dev runs** (desktop, `?name=`, local pages without `accounts=`) skip all of this and join with a dev ticket, as before.
- **Tests** (`tests/test_game_api.gd`, `test_appearance.gd`, `test_character_screens.gd`, `test_world_select.gd`, `test_game_screen.gd`): routes, bodies and the 401 retry; text for every API error; appearance from data and the caveman drawn from it; each screen against a fake API (lists, create, rename, delete, every refusal, premium hints, where each join answer leads); and the game screen's kicks and reconnects.

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
- Every server frame goes through `Proto.decode(frame, FROM_SERVER)` and comes out as typed signals: `welcomed`, `entity_entered`, `entity_left`, `path_started`, `path_stopped`, `chat_received`, `system_message_received` and `kicked`. A frame that fails to decode, or a text frame, closes the connection with status 1002. Nothing is hand-encoded.
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

### Chat

Local chat as the client shows it. The rules (40 m, the rate limit, cleaning, the filter, mutes) are all the server's: see [world-server.md](world-server.md#local-chat).

- **Chat box** (`ChatBox`, bottom left): the last 50 lines (`ChatLog`), each the speaker's name then the text. A role badge (`[Mod]`, `[Admin]` and so on) goes before the name for anyone who isn't a normal player; that's always nobody until M1. Your own name is yellow and others' are blue. `system_message` lines (only "you're muted" so far) show in red, with English text chosen by the client from the message key.
- **Plain text only:** player text is added with `RichTextLabel.add_text`, which never parses BBCode, and BBCode is off on the label. `[color=red]hi[/color]` shows exactly as typed. There's nothing to escape, so nothing can be escaped wrongly.
- **Typing:** Enter opens a one-line input; Enter sends (an empty or all-space line just closes it) and Esc cancels. The input is capped at `chat.max_chars` from `data/progression.json` (120), which Godot counts in code points like the server does; the server still checks. While the input is open, keys go to it and the camera ignores the arrow keys. Clicks on the game still walk: a click takes the focus away, so the input takes it straight back.
- **Speech bubble** (`SpeechBubble`, a `Label3D` on the player view): your latest line over your head for 5 s, in yellow with a dark outline, word-wrapped at 420 px, at a fixed size on screen so it reads at any camera distance. A new line replaces it. It's a child of the player's view, so it follows them and goes when they leave view. `Label3D` doesn't parse BBCode either.
- **Emoji** arrive and are sent fine, but the default font has no emoji, so they show as a box in the chat box and as nothing in a bubble. An emoji fallback font is a later job.

### Launch options and dev aids

- **Web:** query string, for example `index.html?name=Grug&server=ws://127.0.0.1:8090/w/dev`.
- **Desktop:** user arguments, for example `godot --path client -- --name=Grug`.
- **Deployed page, no `name`:** the game uses the account platform ([Platform session](#platform-session)). A `name` makes it a dev run, without the platform, on any page.
- `accounts=http://localhost:3110` points the game at a local copy of the platform, on a page served from this machine only; a deployed page ignores it. With it, a local page uses the platform too ([web/README.md](../../web/README.md#testing-against-a-local-platform)).
- `server` defaults to `ws://127.0.0.1:8090/w/dev` on desktop and on a page served from this machine (localhost or 127.0.0.1). A page served from anywhere else connects to its own host's `/w/1`, over `wss://` when the page is https ([deploy.md](../operations/deploy.md)). Without a `name` (or after the server refuses it) the client asks for one in a small text box.
- Dev aids for trying several clients at once:
  - `demo` clicks a random spot within 9 m every 2.5–5 s.
  - `lag=150` adds 150 ms of round-trip latency (75 ms each way).
  - `shot=<path>` saves the window to a PNG every 2 s (desktop).
  - `quit=<seconds>` quits after that long.
- The HUD's top line shows fps, the estimated tick, the best round trip, how far the clock is still slewing, entities in view, KB received and where your character is drawn (metres).

### Web export

`client/export_presets.cfg` has a **Web** preset:
- single-threaded, no GDExtension;
- `data/*.json` and `data/*.txt` are included, and tests, GUT and editor tools are left out;
- output goes to `build/web/`, which is ignored by git.

Build it with `mkdir -p build/web && Godot --headless --path client --export-release Web ../build/web/index.html` (Godot won't create the folder) (about 2 s), then serve `build/web` on localhost. The world server allows `localhost:*` origins by default. It runs on WebGL 2 (Compatibility) in Chromium.

## Region streaming

Decided by the M0 streaming spike: [ADR 0013](../decisions/0013-region-streaming-web-threads.md), with its numbers. The spike's streamer and bench are in `client/spikes/streaming/`.

- Each region is split into **64 m chunks**, each its own scene with terrain, props and decoration.
- The client keeps chunks within **about 160 m** loaded and frees those beyond about 220 m. The two distances differ (hysteresis) so a chunk near the edge doesn't load and unload repeatedly. Distance is from the player to the nearest point of the chunk.
- Loading uses `ResourceLoader.load_threaded_request`, nearest chunk first. **The web build is single-threaded**, and there the call loads synchronously: the whole load runs inside it, on the main thread. For a spike chunk that's about 1.5 ms at 60 Hz on an M5 Pro (2.5 ms worst) in Chromium with drawing, and about 1 ms in Safari; frames with chunk work showed no visible hitch in either. The same code loads in the background on desktop, or on a threaded build.
- To keep that from hitching:
  - **at most one chunk is finished (get, instantiate, add) a frame, and at most one is freed a frame**, farthest first. Freeing a chunk costs up to about 3 ms on the web;
  - **chunks stay light.** Repeated props are one `MultiMeshInstance3D` per mesh per chunk, shared meshes, materials and prop scenes are their own files, instanced scenes are only for things that need collision, and small props have a visibility range.
- Changing region shows a loading screen. The new region's nearby chunks load before you appear. The loading screen may finish several chunks a frame: at one a frame, the 31-chunk first ring takes about 0.5 s at 60 Hz.

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

- **Single-threaded** (`variant/thread_support=false`), so the page needs **no cross-origin isolation**: no COOP/COEP headers ([ADR 0013](../decisions/0013-region-streaming-web-threads.md)). Turning threads on would need those headers, and CORS or CORP on every cross-origin resource the page loads; the ADR has the details.
- Precompressed `.br` and `.gz` files are served by Caddy, as in the racing game. The engine `index.wasm` is about 6.7 MB with Brotli (9.8 MB gzip, 38 MB raw).
- The `index.html` shell shows a branded loading bar.
- `Cache-Control: no-cache` on `index.html`, and long caching on content-hashed `.pck` and `.wasm` files.
- The **Web** preset excludes `spikes/*`. The two "Streaming spike" presets export the spike bench instead of the game: their `streaming_spike` feature tag makes `bench.tscn` the main scene.
