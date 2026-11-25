#!/usr/bin/env python3
"""Serves a streaming-spike web export on localhost and collects the bench's results.

    python3 client/spikes/streaming/serve.py build/spike-web-nothreads --isolated build/spike-web-threads

serves the single-threaded build at http://localhost:8061/ and the threaded one at
http://localhost:8061/mt/ with the cross-origin isolation headers a threaded Godot web build needs
(--coi sends them for the root too):
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
    Cross-Origin-Resource-Policy: same-origin
Without them the page isn't crossOriginIsolated, SharedArrayBuffer is missing and a threaded build
refuses to start.

The bench POSTs its JSON to /results?label=<label>; it's saved as <results-dir>/<label>.json
(default build/spike-results/) and its summary printed here.

--plan FILE runs a suite in one browser tab: FILE lists one full URL per line (each with a unique
label=), and after each result the page is sent to the line after the one with its label. Keep the
runs on one origin (/ and /mt/ of one server): some browsers (the Claude app's browser pane) won't
let a page navigate itself to another port.
"""

import argparse
import http.server
import json
import pathlib
import re
import sys
import urllib.parse

COI_HEADERS = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def next_url(plan: pathlib.Path | None, label: str) -> str:
    if plan is None:
        return ""
    lines = [ln.strip() for ln in plan.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    for i, line in enumerate(lines):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(line).query)
        if q.get("label", [""])[0] == label and i + 1 < len(lines):
            return lines[i + 1]
    return ""


ISOLATED_PREFIX = "/mt/"


def make_handler(root: pathlib.Path, isolated: pathlib.Path | None, results: pathlib.Path, coi: bool,
                 plan: pathlib.Path | None):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {
            **http.server.SimpleHTTPRequestHandler.extensions_map,
            ".wasm": "application/wasm",
            ".pck": "application/octet-stream",
            ".js": "text/javascript",
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def _isolated_path(self) -> bool:
            return isolated is not None and self.path.startswith(ISOLATED_PREFIX)

        def translate_path(self, path):
            if self._isolated_path():
                rel = urllib.parse.urlparse(path).path[len(ISOLATED_PREFIX):]
                full = (isolated / urllib.parse.unquote(rel)).resolve()
                return str(full) if full.is_relative_to(isolated) else str(isolated / "missing")
            return super().translate_path(path)

        def end_headers(self):
            if coi or self._isolated_path():
                for k, v in COI_HEADERS.items():
                    self.send_header(k, v)
            # Every run downloads afresh, so start-up times are comparable.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_POST(self):
            url = urllib.parse.urlparse(self.path)
            if url.path != "/results":
                self.send_error(404)
                return
            raw_label = urllib.parse.parse_qs(url.query).get("label", ["web"])[0]
            label = re.sub(r"[^A-Za-z0-9_.-]", "_", raw_label)[:80] or "web"
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            try:
                data = json.loads(body)
            except ValueError:
                self.send_error(400)
                return
            results.mkdir(parents=True, exist_ok=True)
            out = results / f"{label}.json"
            out.write_text(json.dumps(data, indent=2))
            walk = data.get("walk", {})
            frame = walk.get("frame_ms", {})
            hitch = walk.get("per_chunk", {}).get("hitch_frame_ms", {})
            print(f"results: {out}  walk p50 {frame.get('p50', 0):.1f} p95 {frame.get('p95', 0):.1f} "
                  f"max {frame.get('max', 0):.1f} ms; chunk hitch p50 {hitch.get('p50', 0):.1f} "
                  f"max {hitch.get('max', 0):.1f} ms", flush=True)
            reply = json.dumps({"next": next_url(plan, raw_label)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)

        def log_message(self, fmt, *args):
            pass

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=pathlib.Path, help="the web export folder")
    ap.add_argument("--port", type=int, default=8061)
    ap.add_argument("--coi", action="store_true", help="send COOP/COEP/CORP for the root too")
    ap.add_argument("--isolated", type=pathlib.Path, help="an export to serve at /mt/ with COOP/COEP/CORP")
    ap.add_argument("--results", type=pathlib.Path, default=pathlib.Path("build/spike-results"))
    ap.add_argument("--plan", type=pathlib.Path, help="a file of run URLs to step through")
    args = ap.parse_args()
    if not (args.root / "index.html").is_file():
        print(f"{args.root}/index.html not found; export the spike first", file=sys.stderr)
        return 1
    isolated = args.isolated.resolve() if args.isolated else None
    handler = make_handler(args.root.resolve(), isolated, args.results.resolve(), args.coi,
                           args.plan.resolve() if args.plan else None)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"serving {args.root} on http://localhost:{args.port}/ (cross-origin isolated: {args.coi})",
          flush=True)
    if isolated:
        print(f"serving {args.isolated} on http://localhost:{args.port}{ISOLATED_PREFIX} (cross-origin isolated)",
              flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
