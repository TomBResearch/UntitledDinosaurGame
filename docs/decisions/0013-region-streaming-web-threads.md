# 0013: Stream region chunks on the single-threaded web build; no cross-origin isolation

**Status:** Accepted (2026-11-25, approved by the owner). Measured with real drawing in Chromium (headless Chrome on the GPU) and Safari, on desktop, and in a throttled browser. Only the 2020 integrated-GPU target is still unmeasured (see "Still to measure").

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
  - **Bench:** walks a third-person camera at 12 m/s (three times walking speed) for 40 s, about 47 chunk loads a run. It records:
    - frame times, and the frame after each chunk's work (the hitch);
    - each frame's **busy time**: from the start of the frame's processing to the end of submitting its draw calls (`RenderingServer.frame_post_draw`). That's the CPU cost of a frame, without the GPU's own time and without waiting for vsync;
    - load times, memory, and the WebGL renderer, so a run that fell back to software rendering would show.
- **Builds:** Godot 4.7.2 release web templates, the Compatibility renderer, two presets: thread support off (the game's current setting) and on. They were served on localhost by `serve.py`, the threaded one with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: same-origin`.
- **Machine:** Apple M5 Pro (18 cores), macOS 27.2.
- **Browsers:**
  1. **Headless Chrome 158** (Chrome for Testing's `chrome-headless-shell`), drawing WebGL 2 on the GPU (ANGLE on Metal, recorded in every result). Two suites: one at the normal 60 Hz vsync, and one with Chrome's frame-rate limit and vsync off (`--disable-frame-rate-limit --disable-gpu-vsync`), so frame times show what a frame costs. **These are the main numbers.**
  2. **Safari 27.2**, in a visible foreground window on the Apple GPU, at the display's vsync (about 72 Hz, so frames are about 14 ms). Safari only gives whole-millisecond timers to pages that aren't cross-origin isolated, so its single-threaded numbers are rounded to 1 ms; the isolated (threaded) runs get finer timers.
  3. **Chromium 156** (the Claude desktop app's browser pane), with the Mac's screen locked. That throttles any page that draws WebGL to about 1 frame a second, so these runs used the bench's `norender=1`: the render loop is off, but mesh and buffer uploads still happen. Its per-chunk costs came out two to three times higher than in headless Chrome, probably because the pane was a background, throttled page. Its frame-time maxima and first-ring times aren't usable.
- **Desktop:** the same bench run natively from the exported pack (`godot --main-pack build/.../index.pck`), so it loads the same binary chunks, with a 45 s walk (540 m). The screen was locked, so nothing was presented and there was no vsync.

### Results

**Headless Chrome, vsync off** (each frame's real cost). Milliseconds, p50 / max. "Main thread per chunk" is the streamer's own calls for one chunk: load, instantiate and add. "Busy" is the whole frame's CPU time. Two runs each of the single-threaded and threaded builds (A and B); the ranges cover both.

| Build | Main thread per chunk | Busy, frame with chunk work | Busy, idle frame | Frame after a chunk | Walking frames p50 / p95 / max | Load, request to placed | First ring (31 chunks) |
|---|---|---|---|---|---|---|---|
| Single-threaded, `load_threaded_request` | **0.7 / 1.1–3.0** | 1.9 / 3.2–4.6 | 1.1 | 2.2 / 3.3–4.6 | 1.2 / 1.5 / 4.9–5.6 | 0.7 | **0.26 s** |
| Single-threaded, plain `load` | 0.7 / 1.2 | 1.9 / 2.8 | 1.1 | 2.1 / 2.9 | 1.2 / 1.4 / 5.8 | 0.7 | 0.27 s |
| Threads + COOP/COEP, `load_threaded_request` | 0.6–0.7 / 1.0–1.1 | 1.2 / 2.6–2.8 | 1.2 | 1.8 / 2.3–2.4 | 1.3 / 1.5–1.6 / 4.0–4.3 | 113–118 (on workers) | **3.2 s** |

No frame in any run took over 25 ms. The worst walking frames (4–6 ms) weren't after streaming work: frames without any chunk work had the same maxima.

**Headless Chrome at 60 Hz** (as players will see it). **These frame times are vsync-limited**: every run, single-threaded or threaded, came out at 16.7 ms p50, 17.4–17.6 ms p95 and 17.9–19.4 ms max, with no frame over 25 ms. They show that there's no visible hitch, but they can't tell the builds apart; the table above does. What does differ at 60 Hz:

| Build | Main thread per chunk | Load, request to placed | First ring (31 chunks) | Start-up |
|---|---|---|---|---|
| Single-threaded | 1.3–1.6 / 2.5–2.6 | 1.4–1.8 | 0.62–0.64 s (2.0 s on the very first, cold-cache run) | 0.36–0.40 s (1.4 s cold) |
| Threads + COOP/COEP | 0.4–0.6 / 0.8–1.0 | 17 (on workers) | 0.67–0.68 s | 0.41–0.43 s |

The same single-threaded load costs about twice as much at 60 Hz as uncapped (1.4 against 0.7 ms), most likely because the CPU clocks down between frames when it's mostly idle. Real play is at 60 Hz, so **plan on about 1.5 ms a chunk on an M5 Pro, 2.5 ms worst**.

At 60 Hz the first ring is limited by the one-chunk-a-frame rule: 31 frames is 0.52 s. Uncapped, the same 31 chunks load in 0.26 s.

**Safari 27.2 at about 72 Hz.** Its frame times are **vsync-limited** too: every run came out at 13.9–14.0 ms p50 and 16–21 ms max, with no frame over 25 ms. Busy times aren't. Milliseconds, p50 / max (single-threaded values are whole milliseconds):

| Build | Main thread per chunk | Busy, frame with chunk work | Busy, idle frame | Walking frames p50 / p95 / max | Load, request to placed | First ring (31 chunks) | Start-up |
|---|---|---|---|---|---|---|---|
| Single-threaded, `load_threaded_request` | 1 / 2 | 3 / 6 | 2 | 14 / 15 / 16–21 | 1 | 0.58 s (1.3 s on the first, cold-cache run) | 0.65–0.75 s |
| Single-threaded, plain `load` | 1 / 2 | 3 / 5 | 2 | 14 / 15 / 16 | 1 | 0.58 s | 0.62 s |
| Threads + COOP/COEP, `load_threaded_request` | 0.4 / 0.6–0.7 | 2.4 / 5.3–5.4 | 2.0 | 13.9 / 14.5–14.6 / 16.5–19.4 | 14 (on workers) | 0.63 s | 0.63–0.73 s |

Safari runs the threaded build. Threads there cost less than in Chrome (loads take about one frame, and the first ring is only 10% slower), but they gain about as little: about 0.6 ms of busy time on a frame with chunk work. The fallbacks behaved as in Chrome: 32 m chunks made idle frames busier (3 against 2 ms) with 479 draw calls against 308, the split made each chunk take 140 ms to appear and the first ring 4.9 s, and the wider ring did nothing for the cost per chunk. Freeing a chunk cost at most 2–4 ms.

**Desktop (native)** and the throttled browser pane, for comparison (main thread per 64 m chunk, p50 / max):

| Build | Main thread per chunk | Wait (request to ready) |
|---|---|---|
| Desktop, threaded | 0.2 / 0.4 | 1.3 (on a worker) |
| Desktop, plain `load` | 0.7 / 0.8 | 0.6 |
| Throttled pane, single-threaded, `load_threaded_request` | 2.2 / 3.3 | 1.8 |
| Throttled pane, single-threaded, plain `load` | 2.2 / 3.2 | 1.8 |
| Throttled pane, threads + COOP/COEP | 0.6 / 0.7 | 7.5 (on a worker) |

**The fallbacks.** Headless Chrome, vsync off, single-threaded unless noted:

| Variant | Chunks loaded in 480 m | Walking frames p50 / max | Busy, frame with chunk work (p50 / max) | First ring | Draw calls in view |
|---|---|---|---|---|---|
| 64 m chunks (the plan) | 47 | 1.2 / 4.9–5.6 | 1.9 / 3.2–4.6 | 0.26 s (31 chunks) | 383 |
| 32 m chunks | 169 | 1.9 / 5.5 | 2.4 / 3.2 | 0.41 s (100 chunks) | 658 |
| 32 m chunks, threads | 169 | 1.9 / 4.6 | 1.9 / 3.4 | 12.3 s (100 chunks) | 658 |
| 64 m, nodes added 2 a frame | 47 | 1.2 / 4.9 | 1.2 / 2.9 | 0.57 s | 383 |
| 64 m, ring 220 m / 280 m | 61 | 1.4 / 5.1 | 2.2 / 3.0 | 0.30 s (52 chunks) | 482 |

Desktop gave the same picture: 32 m chunks cost 0.6 ms against 0.7 ms per load (plain `load`) for a quarter of the area, and 50% more draw calls.

Other findings:

- **Single-threaded `load_threaded_request` blocks.** On the single-threaded web build it does the whole load (parse, resource creation and buffer uploads) inside the request call, on the main thread. It costs exactly what a plain `load` costs. It still works, and code written against it runs unchanged on a threaded build.
- **What threads gain:** on the frame after a chunk, about 0.5 ms (1.8 against 2.2 ms uncapped), or about 1 ms of main thread per chunk at 60 Hz. That's on a frame that has 15 ms to spare.
- **What threads cost:**
  - **Loads take far longer:** 17 ms from request to placed at 60 Hz and over 100 ms uncapped, against under 2 ms single-threaded. The worker threads compete with the main thread.
  - **The first ring is slower:** about the same at 60 Hz (0.67 against 0.63 s), but 3.2 against 0.26 s uncapped, and 12.3 s against 0.41 s for 100 small chunks. A loading screen that hurries the first ring would be slowed down by threads.
  - **Every frame costs slightly more:** an idle frame was 1.2–1.3 ms against 1.1 ms.
- **Freeing a chunk** on the web costs 0.2–0.6 ms typically and at most 1.2–3.2 ms. The 10–11 ms spikes in the throttled pane were the throttling. Natively it's at most 0.3 ms. The streamer frees one chunk a frame, farthest first.
- **Wasm against native:** the single-threaded web load (0.7 ms uncapped) costs about the same as a native plain `load` (0.7 ms), so wasm isn't the bottleneck at this chunk weight.
- **Memory:** 24–31 MB of video memory in view on the web. (Release web builds don't report static memory; natively it was about 53 MB.)
- **Download and start-up:** the engine is the same size either way. `index.wasm` is 6.7 MB with Brotli (9.8 MB gzip, 38 MB raw); `index.js` is 58 KB against 62 KB. The threaded build starts extra worker threads (each loads `index.js` again, from cache). On localhost, from navigation to the bench's first frame took 0.36–0.40 s single-threaded and 0.41–0.43 s threaded with a warm cache. On the internet that's dominated by the 6.7 MB download, the same for both.
- **`use_sub_threads`** on the threaded build didn't finish its run in 10 minutes in the throttled pane, and isn't in the headless suite. Not investigated; there's no reason to use it.
- **The fallbacks** (smaller chunks, adding a chunk's nodes over several frames, a wider preload ring) aren't needed: a chunk costs 1–2 ms of main thread, inside a frame that has more than 10 ms to spare.
  - **Smaller chunks:** a 32 m chunk costs nearly as much per load as a 64 m one, because per-load overhead dominates. Over the same walk that's 169 loads instead of 47, and the extra draw calls (658 against 383) make *every* frame slower (1.9 against 1.2 ms).
  - **Adding nodes over several frames:** the frame with chunk work is cheaper (1.2 against 1.9 ms), but each chunk takes longer to appear and the first ring takes twice as long. It's the one fallback worth keeping in mind, if chunks get much heavier.
  - **A wider ring:** loads 30% more chunks and draws 25% more, for the same cost per chunk.

### What cross-origin isolation changes

Checked with `coi_check.html` in Chromium 156, headless Chrome 158 and Safari 27.2, with the same results in all three. Each was checked isolated (COOP/COEP) and not, against a second local origin (`cors_peer.py`):

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
   - finish (get, instantiate, add) at most one chunk a frame while playing. The loading screen may finish several a frame, since nobody is watching frame times then;
   - free at most one chunk a frame, farthest first;
   - start loads nearest first;
   - keep 64 m chunks and the 160 m / 220 m distances.
4. **Chunk content rules**, so a chunk stays a few milliseconds of main-thread work on the web:
   - repeated props are one `MultiMeshInstance3D` per mesh per chunk, not a node each;
   - shared meshes, materials and prop scenes are their own files, so each chunk refers to them instead of embedding copies;
   - instanced scenes with collision only where they're needed;
   - small props get a visibility range.

   A chunk like the spike's costs about 1.5 ms of main thread at 60 Hz (2.5 ms worst) on an M5 Pro in Chromium with drawing, and about 1 ms (2–3 ms worst) in Safari. Expect roughly two to three times that on the 2020 integrated-GPU target. It stays well inside a 16.7 ms frame, provided the frame's own work leaves room.
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

- **The 2020 integrated-GPU target:** the numbers above are from an M5 Pro. The same suite (`run_web_suite.sh chrome`) runs on any machine with Chrome.

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
  - the target hardware.

## Rejected

- **A threaded web build with COOP/COEP:** about 0.5–1 ms less main-thread work per chunk on fast hardware, when there's over 10 ms to spare. And it costs:
  - isolation headers on every response;
  - CORS or CORP on every cross-origin resource, now and later;
  - loads that take about 10 times longer at 60 Hz (over 100 times uncapped), and a slower first ring;
  - slightly slower frames in Chrome.

  Safari runs it, so browser support isn't the reason; the small gain is.
- **Smaller (32 m) chunks:** about three and a half times the loads for the same walk and 70% more draw calls, which makes every frame slower, to fix a hitch that isn't there.
- **Adding a chunk's nodes over several frames:** cheaper frames with chunk work (1.2 against 1.9 ms), but each chunk takes longer to appear and the first ring takes twice as long. Not needed at this chunk weight; the first fix to try if chunks get much heavier.
- **A wider preload ring:** loads more chunks and draws more, for the same hitch per chunk. Useful only if loads had to be spread out, and the one-a-frame rule already does that.
- **A service-worker shim for isolation (`ensure_cross_origin_isolation_headers`):** the same costs as the headers, plus a forced reload.
