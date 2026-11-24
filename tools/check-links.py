#!/usr/bin/env python3
"""Checks that every relative Markdown link in the repo points at a file that exists.

    python3 tools/check-links.py

External (http/https) links and in-page anchors are not checked.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {".git", "node_modules", ".godot", "addons", "build"}
LINK = re.compile(r"\]\(([^)#\s]+)(#[^)]*)?\)")

broken = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP]
    for name in filenames:
        if not name.endswith(".md"):
            continue
        path = os.path.join(dirpath, name)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for match in LINK.finditer(text):
            target = match.group(1)
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(dirpath, target))):
                print(f"{os.path.relpath(path, ROOT)}: broken link -> {target}")
                broken += 1

print(f"{broken} broken link(s)")
sys.exit(1 if broken else 0)
