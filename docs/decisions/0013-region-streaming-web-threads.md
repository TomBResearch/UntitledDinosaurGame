# 0013: Stream region chunks on the single-threaded web build; no cross-origin isolation

**Status:** Proposed (2026-11-24). The rendered-browser numbers (Chromium and Safari, drawing at full speed) are still to be measured; see "Still to measure".

## Context

Regions are seamless inside ([0007](0007-worlds-and-regions.md)), so the client streams 64 m terrain chunks around the player: it loads within about 160 m and frees beyond about 220 m ([client.md](../architecture/client.md#region-streaming)). The plan was to load with `ResourceLoader.load_threaded_request`, but the web export is single-threaded today. A threaded web build needs the page to be cross-origin isolated, which means COOP/COEP headers from Caddy ([0001](0001-godot-web-client.md)). The M0 streaming spike had to find out whether single-threaded loading hitches, what threads gain, and what isolation costs.

### How it was measured

- **Spike code:** `client/spikes/streaming/` ([README](../../client/spikes/streaming/README.md)).
  - **Region:** a generated region 512 m square, as 8 × 8 chunks of 64 m (and 16 × 16 of 32 m), tiled forever. Each 64 m chunk has:
    - terrain at 1 m spacing (8,192 triangles) with `HeightMapShape3D` collision;
    - about 1,150 props as one `MultiMeshInstance3D` per prop mesh (trees, rocks, bushes, ferns, pebbles), with small props hidden beyond 70–120 m;
    - 12 instanced landmark scenes with collision.

    A chunk is about 225 KB as `.tscn` text and is converted to binary on export.
  - **Streamer:** `SpikeChunkStreamer` loads chunks within 160 m and frees them beyond 220 m. It finishes at most one chunk a frame and times every main-thread call.
  - **Bench:** walks a third-person camera at 12 m/s (three times walking speed) for 45 s, about 40 chunk loads a run. It records frame times, the frame after each chunk's work, the load time and memory.
- **Builds:** Godot 4.7.2 release web templates, the Compatibility renderer, two presets: thread support off (the game's current setting) and on. They were served on localhost by `serve.py`, the threaded one with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: same-origin`.
- **Machine:** Apple M5 Pro (18 cores), macOS 27.2. The browser paced frames at 144 Hz.
- **Browser:** Chromium 156 (the Claude desktop app's browser pane). The Mac's screen was locked during the session, which throttles any page that draws WebGL to about 1 frame a second (Safari too). So these web runs used the bench's `norender=1`:
  - the render loop is off, but the rendering server's command queue is still flushed every frame, so mesh and buffer uploads still happen;
  - frames then ran at the display's 144 Hz (6.9 ms).
  - The per-chunk times below are main-thread CPU time measured with `Time.get_ticks_usec()` around each call. They're reliable.
  - Frame-time maxima and first-ring times from these runs are not: the throttled GPU process stalled single frames for minutes.
- **Desktop:** the same bench run natively from the exported pack (`godot --main-pack build/.../index.pck`), so it loads the same binary chunks, with a 45 s walk at 12 m/s (540 m).

### Results

Main-thread cost per 64 m chunk (p50 / max, milliseconds). "Wait" is the time from request until the chunk is ready to instantiate.

| Build | Load call | Main thread per chunk | Of which: load | instantiate + add | Wait |
|---|---|---|---|---|---|
| Web, single-threaded, `load_threaded_request` (41 chunks) | 1.7 / 3.1 inside `load_threaded_request` | **2.2 / 3.3** | 1.7 | 0.5 | 1.8 |
| Web, single-threaded, plain `ResourceLoader.load` (30 chunks) | 1.7 / 3.0 in `load` | **2.2 / 3.2** | 1.7 | 0.5 | 1.8 |
| Web, threads + COOP/COEP, `load_threaded_request` (37 chunks) | 0.04 | **0.6 / 0.7** | 0.0 | 0.5 | 7.5 (on a worker) |
| Desktop (native), threaded (52 chunks) | 0.0 | 0.2 / 0.4 | 0.0 | 0.2 | 1.3 (on a worker) |
| Desktop (native), plain `load` (52 chunks) | 0.6 in `load` | 0.7 / 0.8 | 0.6 | 0.1 | 0.6 |

Desktop runs of the fallbacks (native, threaded unless noted; main-thread ms per chunk, p50 / max):

| Variant | Chunks loaded in 540 m | Main thread per chunk | Draw calls in view |
|---|---|---|---|
| 64 m chunks (the plan) | 52 | 0.2 / 0.4 (plain `load`: 0.7 / 0.8) | 429 |
| 32 m chunks | 189 | 0.1 / 0.2 (plain `load`: 0.6 / 0.8) | 670 |
| 64 m, nodes added 2 a frame | 52 | 0.8 / 0.9, over about 15 ms of frames | 429 |
| 64 m, ring 220 m / 280 m | 67 | 0.2 / 0.3 | 521 |

The desktop runs drew every frame. The screen was locked, so nothing was presented and there was no vsync: frames took 1.3 ms. Every desktop run, streaming or not, had one or two frames of about 10 ms that weren't after any streaming work.

Other findings:

- **Single-threaded `load_threaded_request` blocks.** On the single-threaded web build it does the whole load (parse, resource creation and buffer uploads) inside the request call, on the main thread. It costs exactly what a plain `load` costs. It still works, and code written against it runs unchanged on a threaded build.
- **Threads move about 1.6 ms a chunk off the main thread.** The load takes four times longer in wall time (7.5 ms against 1.8 ms) because worker threads are slower to start and contend. Some of the work comes back as uploads at the next frame's sync: the frame after a chunk was about 1 ms longer than idle (8.0 ms against 7.0 ms), where the single-threaded build's work fitted inside the 144 Hz frame.
- **Freeing a chunk** on the web cost 0.3 ms typically but up to 10–11 ms (both builds). Natively it's at most 0.3 ms, so the web spikes may be the throttled GPU process. The spike's first streamer freed every far chunk in one frame anyway; it now frees one a frame, farthest first.
- **Wasm is about three times slower than native** for the same load (2.2 ms against 0.7 ms with a plain load).
- **Download and start-up:** the engine is the same size either way: `index.wasm` is 6.7 MB with Brotli (9.8 MB gzip, 38 MB raw), and `index.js` is 58 KB against 62 KB. The threaded build starts extra worker threads (each loads `index.js` again, from cache). From navigation to the bench's first frame took about 0.5 s on localhost for both. On the internet that's dominated by the 6.7 MB download, the same for both.
- **`use_sub_threads`** on the threaded build didn't finish its run in 10 minutes in the throttled pane. Not investigated; there's no reason to use it.
- **The fallbacks** (smaller chunks, adding a chunk's nodes over several frames, a wider preload ring) aren't needed: the single-threaded cost is a few milliseconds, and instantiating and adding a chunk is only 0.5 ms of it.
  - **Smaller chunks:** a 32 m chunk costs nearly as much per load as a 64 m one (0.6 against 0.7 ms with a plain load natively): per-load overhead dominates. A quarter of the area for nearly the same cost: over the same walk, 189 loads instead of 52 made about three times the loading work, and 50% more draw calls in view.
  - **Adding nodes over several frames:** the extra bookkeeping cost more than it saved.
  - **A wider ring:** loads 30% more chunks for the same cost per chunk.

### What cross-origin isolation changes

Checked with `coi_check.html` in Chromium 156, isolated (COOP/COEP) and not, against a second local origin (`cors_peer.py`):

| From the page | Not isolated | Isolated |
|---|---|---|
| WebSocket to the world server (another origin) | works | works (COEP doesn't cover WebSockets) |
| `fetch` POST with `credentials: "include"` to an origin that answers with CORS (how the M1 login calls `accounts.untitledgames.co.uk`) | works | works: a CORS response satisfies `require-corp` |
| `fetch` in `no-cors` mode, or an `<img>`, from an origin that sends no `Cross-Origin-Resource-Policy` | works | **blocked** |
| The same, when the origin sends `Cross-Origin-Resource-Policy: cross-origin` | works | works |
| `SharedArrayBuffer` | missing | present |

So isolation wouldn't break the world connection or the planned login. It would break any cross-origin resource that isn't CORS or CORP. Examples:
- avatars or images served from the account platform;
- third-party scripts and embeds without CORP, such as video embeds or payment widgets;
- anything Cloudflare injects from another origin.

With `COOP: same-origin`, a popup to another origin also loses its link to the page (that's from the spec; it wasn't tested here). Each of those would need the other side to send CORS or CORP, or an exception. That's ongoing work on the account platform, which is shared with Untitled Racing Game.

## Decision

1. **The web client stays single-threaded** (`variant/thread_support=false`, as now). The page is **not cross-origin isolated**, and Caddy sends **no COOP/COEP headers**.
2. **The streamer still loads with `ResourceLoader.load_threaded_request`.** On the single-threaded build it's a synchronous load; on a threaded build (desktop now, perhaps the web later) the same code loads in the background.
3. **Hitch budget rules for the real streamer** (`client/world/`, built from `SpikeChunkStreamer`):
   - finish (get, instantiate, add) at most one chunk a frame;
   - free at most one chunk a frame, farthest first;
   - start loads nearest first;
   - keep 64 m chunks and the 160 m / 220 m distances.
4. **Chunk content rules**, so a chunk stays a few milliseconds of main-thread work on the web:
   - repeated props are one `MultiMeshInstance3D` per mesh per chunk, not a node each;
   - shared meshes, materials and prop scenes are their own files, so each chunk refers to them instead of embedding copies;
   - instanced scenes with collision only where they're needed;
   - small props get a visibility range.

   A chunk like the spike's costs 2.2 ms of main thread (3.3 ms worst) on an M5 Pro. Expect roughly two to three times that on the 2020 integrated-GPU target. It stays well inside a 16.7 ms frame, provided the frame's own work leaves room.
5. **Revisit threads** (a new ADR) if real chunks or the target hardware push the single-threaded cost per chunk past about 8 ms (half a 60 Hz frame), and the cheaper fixes above don't bring it back.

## What the deploy must do

- **Nothing for streaming.** Don't add COOP, COEP or CORP headers for the game. The WebSocket at `/w/<id>` and the `/api` proxy need nothing extra.
- The spike's presets and `spikes/` are excluded from the game's **Web** preset, so the deployed `index.pck` doesn't carry them.
- If threads are ever switched on, this is the Caddy change:

  ```
  header {
      Cross-Origin-Opener-Policy "same-origin"
      Cross-Origin-Embedder-Policy "require-corp"
  }
  ```

  Every cross-origin resource the page loads must then send CORS or `Cross-Origin-Resource-Policy`, including anything from the account platform (that's a change to the platform). Cloudflare must not inject cross-origin scripts.
- Without header control, Godot's PWA option `progressive_web_app/ensure_cross_origin_isolation_headers` adds them through a service worker. That costs a reload on first visit.

## Still to measure

These need a browser that draws at full speed: a visible window on an unlocked screen, or headless Chrome. Run `client/spikes/streaming/run_web_suite.sh safari` (or `chrome <path>`, and in the app's browser pane with the session's window open). It runs the whole suite and prints the table. The results then go here, and the status changes to Accepted.

- The frame time while walking, and the frame after each chunk, with real drawing (WebGL buffer uploads and first draws).
- Safari: whether the threaded build runs, and both builds' frame times.
- The first ring (the loading screen's work): 31 chunks took 0.3 s natively. The web figure from the throttled runs isn't usable.
- The fallback variants on the web (the suite includes 32 m chunks, the split and the wider ring), to confirm the desktop result.

## Consequences

- **Easy:**
  - deploy is plain;
  - nothing on the account platform or Cloudflare has to change for isolation;
  - every browser that runs the single-threaded build is supported;
  - the streamer code is ready for threads.
- **Hard:**
  - chunk loading is synchronous on the web, so chunk weight is a budget to watch. A heavy chunk (big unique textures, thousands of nodes) shows up directly as a hitch;
  - the content pipeline should check chunk sizes later.
- **Follow-up:**
  - the real streamer in `client/world/` with the rules above;
  - chunk scenes in the region pipeline (`chunks/chunk_<x>_<z>.tscn`) with the staleness hash covering them ([content-pipeline.md](../architecture/content-pipeline.md));
  - the rendered measurements above.

## Rejected

- **A threaded web build with COOP/COEP:** about 1.6 ms less main-thread work per chunk on fast hardware. That isn't needed at this chunk weight, and it costs:
  - isolation headers on every response;
  - CORS or CORP on every cross-origin resource, now and later;
  - more worker start-up;
  - Safari risk that hasn't been measured.
- **Smaller (32 m) chunks:** about three times the loading work and 50% more draw calls for the same area (per-load overhead dominates), to fix a hitch that isn't there.
- **Adding a chunk's nodes over several frames:** instantiating and adding is about 0.5 ms; the load itself is the larger part, and splitting doesn't help that. On desktop it cost more main-thread time in total (0.8 against 0.2 ms).
- **A wider preload ring:** loads more chunks for the same hitch per chunk. Useful only if loads had to be spread out, and the one-a-frame rule already does that.
- **A service-worker shim for isolation (`ensure_cross_origin_isolation_headers`):** the same costs as the headers, plus a forced reload.
