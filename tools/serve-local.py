#!/usr/bin/env python3
"""Serves the site locally the way Caddy does in production, for trying the whole M1 flow on one machine.

    /        the landing page (web/)
    /play/   the web export of the game (build/web/)
    /api/    the backend API, passed on to http://127.0.0.1:3010

The game calls /api on its own origin, as on the live site, so the API needs no CORS. The worlds are
reached directly (the API's -public-ws), not through here. See docs/operations/local-stack.md.

    python3 tools/serve-local.py            # http://localhost:8060/
    python3 tools/serve-local.py --port 8061 --api http://127.0.0.1:3011

Local testing only: it binds to 127.0.0.1 and has no security of its own.
"""

import argparse
import http.server
import os
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Request headers passed on to the API, and response headers passed back.
FORWARD_REQUEST = ("Authorization", "Content-Type")
FORWARD_RESPONSE = ("Content-Type", "Retry-After", "Cache-Control")


def make_handler(api: str):
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm"}

        def translate_path(self, path):
            path = path.split("?", 1)[0].split("#", 1)[0]
            if path.startswith("/play/"):
                root, rest = os.path.join(REPO, "build", "web"), path[len("/play/"):]
            else:
                root, rest = os.path.join(REPO, "web"), path.lstrip("/")
            full = os.path.normpath(os.path.join(root, rest))
            # Never serve anything outside the two folders.
            return full if full == root or full.startswith(root + os.sep) else root

        def end_headers(self):
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def _proxy(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            req = urllib.request.Request(api + self.path, data=body, method=self.command)
            for name in FORWARD_REQUEST:
                if self.headers.get(name):
                    req.add_header(name, self.headers[name])
            req.add_header("X-Real-IP", "127.0.0.1")
            try:
                res = urllib.request.urlopen(req, timeout=10)
            except urllib.error.HTTPError as err:
                res = err
            except OSError:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                super().end_headers()
                self.wfile.write(b'{"error":"unavailable"}')
                return
            data = res.read()
            self.send_response(res.status)
            for name in FORWARD_RESPONSE:
                if res.headers.get(name):
                    self.send_header(name, res.headers[name])
            self.send_header("Content-Length", str(len(data)))
            super().end_headers()
            self.wfile.write(data)

        def _route(self, serve):
            if self.path.startswith("/api/"):
                self._proxy()
            elif self.path in ("/play", "/play?") or self.path.startswith("/play?"):
                self.send_response(308)
                self.send_header("Location", "/play/" + self.path[len("/play"):])
                super().end_headers()
            else:
                serve()

        def do_GET(self):
            self._route(super().do_GET)

        def do_HEAD(self):
            self._route(super().do_HEAD)

        def do_POST(self):
            self._route(lambda: self.send_error(405))

        def do_PATCH(self):
            self._route(lambda: self.send_error(405))

        def do_DELETE(self):
            self._route(lambda: self.send_error(405))

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8060)
    parser.add_argument("--api", default="http://127.0.0.1:3010", help="the backend API's address")
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.api.rstrip("/")))
    print(f"Serving http://localhost:{args.port}/ (game at /play/, /api/ -> {args.api})")
    server.serve_forever()


if __name__ == "__main__":
    main()
