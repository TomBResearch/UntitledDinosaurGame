#!/usr/bin/env python3
"""Prints a Markdown table of streaming-spike results (the bench's JSON files).

    python3 client/spikes/streaming/summarize.py build/spike-results [label-prefix ...]

Columns:
  gpu       "software" when WebGL fell back to SwiftShader (the frame times then mean nothing)
  main ms   main-thread work per chunk load: request + polls + get + instantiate + add (p50 / max)
  hitch     the frame after each chunk's main-thread work (p50 / max), against the idle p50
  walk      frame times while walking (p50 / p95 / max) and frames over 33 ms
  load ms   request to placed, per chunk (p50)
  busy      each frame's own work, from the bench's _process to post-draw (not GPU time): idle p50,
            and frames that did stream work (p50 / max). Walk frame times are vsync-capped unless the
            browser's frame-rate limit is off; busy times are not.
"""

import json
import pathlib
import sys


def browser(r: dict) -> str:
    ua = r.get("web", {}).get("user_agent", "")
    if not ua:
        return r.get("platform", "?")
    for name in ("HeadlessChrome", "Claude", "Edg", "Chrome", "Firefox"):
        if name in ua:
            return {"Claude": "Chromium (app pane)", "Edg": "Edge"}.get(name, name)
    return "Safari" if "Safari" in ua else ua[:20]


def gpu(r: dict) -> str:
    name = r.get("gpu", "")
    if not name or "WebKit WebGL" in name:  # not recorded, or the browser's masked name
        return "?"
    return "software" if "SwiftShader" in name or "llvmpipe" in name else "GPU"


def main_ms(chunk: dict) -> float:
    return sum(chunk.get(k, 0.0) for k in ("request_call_ms", "poll_calls_ms", "get_ms", "instantiate_ms", "add_ms"))


def pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    v = sorted(values)
    return v[min(len(v) - 1, max(0, round(q * (len(v) - 1))))]


def row(r: dict) -> str:
    opts = r.get("options", {})
    walk = r["walk"]
    f = walk["frame_ms"]
    hitch = walk["per_chunk"]["hitch_frame_ms"]
    total = walk["per_chunk"]["total_ms"]
    mains = [main_ms(c) for c in r.get("chunks", [])]
    threads = "yes" if r.get("threads_feature") and not r.get("nothreads_feature") else "no"
    if r.get("platform") != "Web":
        threads = "native"
    mode = opts.get("mode", "threaded") + (" sub" if opts.get("sub") == "1" else "")
    mode += f" split{opts['split']}" if opts.get("split", "0") != "0" else ""
    mode += " norender" if opts.get("norender") == "1" else ""
    ring = f"{opts.get('load', '160')}/{opts.get('unload', '220')}"
    startup = r.get("web", {}).get("startup_ms")
    busy = r.get("busy_ms", {})
    idle_b, work_b = busy.get("settle", {}), busy.get("stream_work_frames", {})
    busy_col = (f"{idle_b.get('p50', 0):.1f} | {work_b.get('p50', 0):.1f} / {work_b.get('max', 0):.1f}"
                if busy else " | ")
    return (f"| {r.get('label', '')} | {browser(r)} | {gpu(r)} | {threads} | {mode} | {opts.get('chunk', '64')} | {ring} "
            f"| {walk['chunks_loaded']} | {pct(mains, 0.5):.1f} / {max(mains, default=0):.1f} "
            f"| {hitch.get('p50', 0):.1f} / {hitch.get('max', 0):.1f} | {r['settle_frame_ms'].get('p50', 0):.1f} "
            f"| {f.get('p50', 0):.1f} / {f.get('p95', 0):.1f} / {f.get('max', 0):.1f} | {f.get('over_33', 0)} "
            f"| {total.get('p50', 0):.1f} | {r['initial_load'].get('ms', 0):.0f} "
            f"| {'' if startup is None else f'{startup:.0f}'} | {busy_col} |")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    folder = pathlib.Path(sys.argv[1])
    prefixes = sys.argv[2:]
    print("| run | browser | gpu | threads | load mode | chunk m | load/free m | chunks | main ms p50 / max "
          "| hitch ms p50 / max | idle p50 | walk ms p50 / p95 / max | >33 ms | load ms p50 "
          "| first ring ms | start-up ms | busy idle p50 | busy stream frames p50 / max |")
    print("|" + "---|" * 18)
    for path in sorted(folder.glob("*.json")):
        r = json.loads(path.read_text())
        if "walk" not in r or (prefixes and not any(r.get("label", "").startswith(p) for p in prefixes)):
            continue
        print(row(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
