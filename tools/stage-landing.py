#!/usr/bin/env python3
"""Copies the landing page (web/) to a staging folder with cache-busting version stamps.

Cloudflare overrides our `Cache-Control: no-cache` on static files and tells browsers to keep
them for 4 hours, so after a deploy a browser could mix a new index.html with an old main.js
and break. This stamps every reference to a page file with `?v=<hash of web/>`:

- index.html: the stylesheet, the main script, preloaded fonts and the favicon
- css/*.css: url(...) references to images and fonts
- js/*.js: relative module imports (every import of a module uses the same stamp, so each
  module still loads once)

Usage: tools/stage-landing.py <web dir> <out dir>    (prints the version)
"""
import hashlib
import pathlib
import re
import shutil
import sys

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
files = sorted(p for p in src.rglob("*") if p.is_file() and p.name != "README.md")
digest = hashlib.sha256()
for p in files:
    digest.update(str(p.relative_to(src)).encode() + b"\0" + p.read_bytes())
version = digest.hexdigest()[:10]

if out.exists():
    shutil.rmtree(out)
for p in files:
    dest = out / p.relative_to(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest)

stamp = f"?v={version}"

def rewrite(path, pattern, fn):
    text = path.read_text(encoding="utf-8")
    new, count = re.subn(pattern, fn, text)
    path.write_text(new, encoding="utf-8")
    return count

# index.html: href="css/..", src="js/..", href="fonts/..", href="img/.."
n = rewrite(out / "index.html", r'((?:href|src)=")((?:css|js|fonts|img)/[^"?#]+)(")',
            lambda m: f"{m.group(1)}{m.group(2)}{stamp}{m.group(3)}")
assert n >= 3, f"expected the stylesheet, script and fonts in index.html, stamped {n}"
for css in (out / "css").glob("*.css"):
    rewrite(css, r'url\("(\.\./(?:img|fonts)/[^"?#]+)"\)', lambda m: f'url("{m.group(1)}{stamp}")')
for js in (out / "js").glob("*.js"):
    rewrite(js, r'(from\s+"|import\(")(\./[^"?#]+\.js)(")', lambda m: f"{m.group(1)}{m.group(2)}{stamp}{m.group(3)}")

print(version)
