# Streaming spike (M0)

Measures chunked region streaming on the web export, single-threaded and with threads. The results and
the choice are in [ADR 0013](../../../docs/decisions/0013-region-streaming-web-threads.md). The real
streamer (`client/world/`, later) starts from `spike_chunk_streamer.gd`.

Nothing here ships: the game's **Web** preset excludes `spikes/*`.

| File | What |
|---|---|
| `build_spike_region.gd` | Generates the region into `generated/` (ignored by git): 512 m square, as 8 × 8 chunks of 64 m and 16 × 16 of 32 m. Terrain at 1 m spacing with collision, about 1,150 props per 64 m chunk as one MultiMesh per prop mesh, and 12 instanced landmark scenes with collision. Heights repeat every 512 m, so the bench tiles it forever. |
| `spike_terrain.gd` | `SpikeTerrain`: the height function and chunk paths |
| `spike_chunk_streamer.gd` | `SpikeChunkStreamer`: loads chunks within 160 m, frees beyond 220 m, finishes at most one chunk a frame, and times every main-thread step |
| `bench.tscn`, `bench.gd` | Walks a third-person camera at 12 m/s for 45 s and reports frame times, the hitch after each chunk, load times and memory. Options are in the script's header. |
| `serve.py` | Serves the single-threaded export at `/` and the threaded one at `/mt/` with COOP/COEP (one origin, so a tab can go from one to the other), saves the bench's results and steps a tab through a plan of runs |
| `build_web.sh` | Generates the region and exports both web variants (`build/spike-web-nothreads/`, `build/spike-web-threads/`) |
| `run_web_suite.sh` | Runs the whole web suite in one browser tab and prints the table |
| `summarize.py` | Results JSON to a Markdown table |
| `coi_check.html`, `cors_peer.py` | What cross-origin isolation changes: WebSocket, credentialed CORS fetch, no-cors fetch, images |

## Run it

```bash
client/spikes/streaming/build_web.sh
```

```bash
client/spikes/streaming/run_web_suite.sh safari
```

The browser has to draw at full speed: a visible, foreground window on an unlocked screen, or headless
Chrome (`run_web_suite.sh chrome /path/to/chrome`). A hidden tab or a locked screen draws about one frame
a second. `norender=1` turns drawing off to measure only the main-thread cost in such a browser.

Desktop, with the exported (binary) chunks, as on the web:

```bash
/Applications/Godot.app/Contents/MacOS/Godot --main-pack build/spike-web-nothreads/index.pck -- --label=desktop --quit=1
```

Run the generator without `--headless`: the headless renderer keeps no MultiMesh buffers, so props would
be saved without their transforms. The spike presets set the `streaming_spike` feature, which makes
`bench.tscn` the main scene (`project.godot`).
