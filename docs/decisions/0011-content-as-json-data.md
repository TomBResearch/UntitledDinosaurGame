# 0011: Game content as JSON in `data/`, with a content hash

**Status:** Accepted (2026-11-23)

## Context

The game will have hundreds of items, creatures, drop tables, recipes and quests. Adding content should mean writing data, not code. The client needs names, icons and stats for display, and the server needs everything. Both must agree.

## Decision

- **`data/` holds every content definition as JSON**, one file per category, split further as it grows:
  - `items/*.json`, `creatures/*.json`, `drops/*.json`, `recipes/*.json`, `nodes/*.json` (gathering spots), `quests/*.json`
  - `skills.json`, `progression.json` (the XP curve and its settings), `abilities.json`
- **Every entry has a stable string id** (`small_raptor_tooth`), never a number that could be reused.
- **`cmd/dataval` validates everything:** schema, references between files (a drop table naming an item that doesn't exist fails), ranges, and premium flags (free content can't need premium items).
- **The content hash:** a SHA-256 of the normalised data. The client sends it in the handshake, and a mismatch means "please refresh".
- **The client gets a generated, client-safe subset** (`client/data/`), built from `data/`. **Server-only fields never ship to the client:** unreleased items, exact drop weights before release, internal notes.
- **Every entry carries `"premium": false` by default.** Regions, items, quests and creatures can all be marked premium ([design/worlds-and-premium.md](../design/worlds-and-premium.md)).

## Consequences

- Wiki tables (items, drops, XP) can be generated from `data/` later, which keeps them accurate.
- A dodgy JSON edit is caught in the fast check, not in game.

## Rejected

- **Godot resources (`.tres`) as the source:** the Go server can't read them easily.
- **YAML:** nicer to read, but Godot has no built-in parser, and two parsers mean two sets of edge cases.
- **Content stored in the database:** harder to review in PRs and to version with code.
