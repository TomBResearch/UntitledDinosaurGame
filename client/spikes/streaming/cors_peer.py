#!/usr/bin/env python3
"""A second origin for coi_check.html: python3 cors_peer.py 8063.

  POST /cors   answers with CORS for the caller's origin, with credentials (like the platform's /auth)
  GET /plain   no CORS, no CORP
  GET /corp    Cross-Origin-Resource-Policy: cross-origin
  GET /img     a 1x1 PNG without CORP; /img-corp with CORP cross-origin
"""
import http.server, sys, base64
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        o = self.headers.get("Origin")
        if o: self.send_header("Access-Control-Allow-Origin", o); self.send_header("Access-Control-Allow-Credentials", "true"); self.send_header("Vary", "Origin")
    def do_OPTIONS(self):
        self.send_response(204); self.cors()
        self.send_header("Access-Control-Allow-Methods", "POST"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers()
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200); self.cors(); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b"{}")
    def do_GET(self):
        p = self.path
        body = PNG if p.startswith("/img") else b"hello"
        self.send_response(200)
        self.send_header("Content-Type", "image/png" if p.startswith("/img") else "text/plain")
        if p in ("/corp", "/img-corp"): self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
