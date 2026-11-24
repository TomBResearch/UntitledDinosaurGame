# Untitled Dinosaur Game: agent guide

Read this first. It covers what the project is, where things live and the rules every agent follows.

## What this is

A browser-based 3D sandbox MMORPG set in prehistoric times: cavemen, dinosaurs, jungles, caves and fossils. You start as a caveman in a pelt loincloth and level up skills (combat, gathering, processing and Hunting tasks) up to level 100. Movement is click-to-move in third person, with four ability keys. Each world is a full copy of the map, and you pick one from a world list, RuneScape-style. Progress is saved to your account, which is shared with the owner's other games.

**Project stage:** M0 (Foundations) in progress: the repo skeleton and the fast check are in place. Work follows [docs/roadmap/milestones.md](docs/roadmap/milestones.md).

## Where things live

Folders marked *(planned)* don't exist yet. They're created by the M0 task that first needs them.

| Path | What | Audience |
|---|---|---|
| `wiki/` | Player-facing wiki (Markdown with front matter) | **Public** |
| `docs/` | Internal design, architecture, decisions, roadmap. Start at [docs/README.md](docs/README.md) | Private |
| `client/` | Godot project: the web client. No game rules live here. GUT tests in `client/tests/`. | Private |
| `server/` | Go module: `cmd/dataval` now. Later `cmd/world` (world server), `cmd/api` (backend API), `cmd/protogen`, plus `internal/…` | Private |
| `data/` | Game content as JSON: items, creatures, drop tables, skills, recipes, quests, XP curve. One source of truth for client and server. | Private |
| `protocol/` *(planned)* | Network message schema. Go and GDScript codecs are generated from it. | Private |
| `assets-src/` *(planned)* | Blender sources and licences (Git LFS) | Private |
| `infra/` *(planned)* | Docker Compose, Caddy, nginx, deploy | Private |
| `tools/` | Scripts: `check.sh` (fast check), `slow-tests.sh`, `check-links.py`. Later: export regions, build, deploy. | Private |

The **shared account platform** (login, roles, Premium, bans, friends) is a separate service in the owner's repo `TomBResearch/UntitledAccountSystem`, live at `accounts.untitledgames.co.uk`. What this game uses from it is in [docs/architecture/accounts.md](docs/architecture/accounts.md).

## Pinned versions

| Tool | Version | Notes |
|---|---|---|
| Godot | **4.7.2 stable** | `/Applications/Godot.app`. Don't upgrade without a decision record. |
| Godot renderer | **Compatibility** (WebGL 2) | Required for web export. Never use Forward+ or Mobile-only features. |
| Client language | **GDScript, static typing everywhere** | C# can't export to the web |
| Server language | **Go 1.27** | World server and backend API ([ADR 0003](docs/decisions/0003-go-server.md)) |
| PostgreSQL | 17 | Via Docker |
| Blender | 5.3 | Exports glTF (`.glb`) |

## Commands

| Task | Command |
|---|---|
| **Fast check (run before every push)** | `tools/check.sh`: data validation, Go format, vet, staticcheck and tests, then Godot import and GUT. About 3 s locally. `tools/check.sh go` and `tools/check.sh godot` run one half. |
| Validate data and regenerate `client/data/` | `cd server && go run ./cmd/dataval -data ../data -emit-client ../client/data` (the check does this) |
| Docs link check | `python3 tools/check-links.py` |
| Slow tests (race detector now; bots, soak and builds later) | `tools/slow-tests.sh`. Runs nightly and on demand, never on every push. |
| Install staticcheck locally (optional; CI always runs it) | `go install honnef.co/go/tools/cmd/staticcheck@v0.8.2` |
| *Planned in M0:* export regions, regenerate protocol, local stack, deploy | `tools/export-regions.sh`, `tools/protogen.sh`, `cd infra && docker compose up -d --build`, `tools/deploy.sh` |

**MCP:** `.mcp.json` (Godot and Blender MCP servers) is local to the owner's Mac and ignored by git. Copy it from Untitled Racing Game if it's missing.

**CI** ([ADR 0009](docs/decisions/0009-fast-ci.md)):
- `ci.yml` is the fast lane for code and data: Go, Godot and gitleaks, run in parallel.
- `docs.yml` covers docs-only changes, with a link check only.
- `nightly.yml` is the slow lane.
- gitleaks false positives go in `.gitleaks.toml`.

## Non-negotiable rules

1. **The server is the authority** for positions, paths, combat, damage, XP, items, the bank, drops and quest state. The client only sends intents such as "move to", "attack", "use item" and "ability 1". See [docs/architecture/security.md](docs/architecture/security.md).
2. **No game rules in the client.** The client renders what the server sends. Shared numbers come from `data/`, never from hard-coded constants.
3. **`data/` is the single source of truth for content and balance.** If you change a player-visible number, update the wiki page and [wiki/changelog.md](wiki/changelog.md) in the same change.
4. **Godot owns level content.** Navmesh, spawns, resource nodes and region exits are placed in Godot scenes and exported to server data with `tools/export-regions.sh`. Never hand-edit exported region files.
5. **Server simulation is tick-stepped and testable without real time.** Tests drive `region.Step()` directly. No `time.Sleep` in tests, and no real-time waits in the fast check.
6. **Nothing internal goes in `wiki/`.** See [ADR 0008](docs/decisions/0008-public-wiki-private-docs.md). When unsure, keep it in `docs/`.
7. **Don't build identity or social features in the game.** Login, roles, Premium, bans and friends come from the account platform. Changes to the platform must be additive and must not break Untitled Racing Game.
8. **Staff permissions are enforced on the server for every action**, by rank, using the fresh role from the platform's service API. Each one needs a test proving lower ranks are refused.
9. **Text formats for Godot**: scenes `.tscn` and resources `.tres`, never binary.
10. **Open questions go to the owner.** If a task depends on something in [docs/open-questions.md](docs/open-questions.md), ask. Don't guess player-facing design.

## How to work

Follow [docs/agents/workflow.md](docs/agents/workflow.md). In short:
- Work one milestone task at a time, on its own branch.
- Run `tools/check.sh` locally before pushing. Don't sit waiting on CI after every small commit.
- A task is done when its acceptance criteria pass, the fast check passes, and docs and wiki are updated.
- Record significant technical choices as a new decision record in [docs/decisions/](docs/decisions/).
