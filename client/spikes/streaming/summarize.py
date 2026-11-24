#!/usr/bin/env python3
"""Prints a Markdown table of streaming-spike results (the bench's JSON files).

    python3 client/spikes/streaming/summarize.py build/spike-results [label-prefix ...]

Columns:
  main ms   main-thread work per chunk load: request + polls + get + instantiate + add (p50 / max)
  hitch     the frame after each chunk's main-thread work (p50 / max), against the idle p50
  walk      frame times while walking (p50 / p95 / max) and frames over 33 ms
  load ms   request to placed, per chunk (p50)
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
    return (f"| {r.get('label', '')} | {browser(r)} | {threads} | {mode} | {opts.get('chunk', '64')} | {ring} "
            f"| {walk['chunks_loaded']} | {pct(mains, 0.5):.1f} / {max(mains, default=0):.1f} "
            f"| {hitch.get('p50', 0):.1f} / {hitch.get('max', 0):.1f} | {r['settle_frame_ms'].get('p50', 0):.1f} "
            f"| {f.get('p50', 0):.1f} / {f.get('p95', 0):.1f} / {f.get('max', 0):.1f} | {f.get('over_33', 0)} "
            f"| {total.get('p50', 0):.1f} | {r['initial_load'].get('ms', 0):.0f} "
            f"| {'' if startup is None else f'{startup:.0f}'} |")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    folder = pathlib.Path(sys.argv[1])
    prefixes = sys.argv[2:]
    print("| run | browser | threads | load mode | chunk m | load/free m | chunks | main ms p50 / max "
          "| hitch ms p50 / max | idle p50 | walk ms p50 / p95 / max | >33 ms | load ms p50 "
          "| first ring ms | start-up ms |")
    print("|" + "---|" * 15)
    for path in sorted(folder.glob("*.json")):
        r = json.loads(path.read_text())
        if "walk" not in r or (prefixes and not any(r.get("label", "").startswith(p) for p in prefixes)):
            continue
        print(row(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
