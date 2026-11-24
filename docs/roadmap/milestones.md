# Milestones

Each milestone ends with something **playable on the test server**. Tasks inside a milestone are split into branches by the agent or owner doing the work. Each milestone's acceptance criteria are the definition of done.

## M0: Foundations

**Goal:** two people in two browsers walk around a test region together and chat. Everything is deployed.

| Task | Done when |
|---|---|
| Repo skeleton **(done)** | `client/`, `server/`, `data/` and `tools/` exist (`protocol/`, `infra/` and `assets-src/` arrive with the tasks that need them). `.gitignore`, `.gitattributes` (LFS for `assets-src/`), and `.mcp.json` for the Godot and Blender MCPs are in place. Go 1.27 is installed (`brew install go`). |
| Fast check and CI **(done)** | `tools/check.sh` and the CI fast lane run in under 2 minutes. Docs-only changes skip CI. The nightly slow-lane workflow exists ([ADR 0009](../decisions/0009-fast-ci.md)). |
| Protocol generator **(done)** | A schema with `hello`, `welcome`, `ping`, `pong`, `move_to`, `path_started`, `path_stopped`, `entity_enter`, `entity_leave`, `chat_say` and `chat`. Codecs are generated for Go and GDScript, and round-trip tests pass on both sides. |
| Test region and export | A greybox region (about 200 m × 200 m: hills, a river, rocks, a cave mouth) with a baked navmesh. `export_region.gd` writes the region file, and the staleness check works. |
| Navmesh pathfinding (Go) | Load, A*, funnel and raycast, with unit tests on fixture meshes. A path in the test region takes under 0.2 ms. |
| World server core | Tick loop, region inbox, `Step()`, spatial grid, interest management, movement along paths. Tick-stepped tests cover: walk, repath, stop, entity enter and leave. |
| Client core | Connect with a **dev ticket** (no platform login yet), clock sync, click-to-move, path playback for you and others, third-person camera, click marker. |
| Local chat | Within 40 m, rate limited, shown in a chat box and as a speech bubble. |
| Streaming spike | Chunked loading measured on the web, with and without threads. An ADR records the choice. |
| Static site for the wiki and docs | A generator is chosen (with an ADR) and builds `/wiki/` (published pages only) and `/dev/` (behind a password). |
| Deploy | DNS, the nginx file, the certificate, `/opt/udg`, `tools/deploy.sh`. The game is live at `https://dinosaur.untitledgames.co.uk`, with the racing site and other sites unaffected. |

**Acceptance:** you and one other person open the URL, each get a dev character, see each other moving smoothly with no visible jitter at 150 ms of latency, and chat. The world server's p99 tick time is under 2 ms with 50 bots walking around (nightly bot test).

## M1: Accounts, characters and worlds

| Task | Done when |
|---|---|
| Platform login in the client | Log in, refresh (one at a time) and log out through `JavaScriptBridge` fetch, plus sign-up and resend verification screens |
| Platform config (racing repo PR) | `ALLOWED_ORIGINS` and `SERVICE_KEYS` additions. Racing login is re-checked. |
| `cmd/api` | JWKS check, service API client, worlds, character CRUD (3 slots, name rules), join tickets, deleted-accounts list |
| Character creation | Name, a basic appearance (skin tone, hair, beard), starting gear (pelt loincloth) |
| World select | World 1 (free) and World 2 (premium only), with tests for premium refused and allowed |
| Persistence | Position, region and HP saved. Online lease. Graceful shutdown saves everyone. |
| Deletion hook | `/internal/players/:id` is live, then `DELETION_HOOKS` is added to the platform, with an end-to-end deletion test |

**Acceptance:** register on the platform, log in, create up to 3 characters, join either world (premium only if flagged), log out and back in where you left off, and delete your account with your characters gone too. The racing game is unaffected throughout.

## M2: Items and gathering

Inventory (30 slots), equipment, the bank, ground items, item data and validation, the XP and levels system, skills UI, Lumberjacking, Excavating and Digging, tools and their tiers, the item invariant test, the XP table generated into the wiki.

**Acceptance:** chop, mine and dig, level up, fill your inventory, bank it, log out, and find everything still there.

## M3: Combat

Melee (Strength), equipment bonuses and requirements, creature AI (small raptor), HP, hit splats, safe death and respawn, drop tables (including a 1/100 rare drop), Cooking and Angling (food heals).

**Acceptance:** fight raptors with a bone club, eat cooked fish to survive, get drops including the rare tooth over time, die and respawn with nothing lost.

## M4: Processing

Crafting, Weapon-Crafting and Herbology (potions), stations, "make X", recipe data, wiki pages generated for recipes.

## M5: Abilities, Ranged and Voodoo

Abilities 1–4 with gear modifiers, ground telegraphs, the first mini-boss with dodgeable attacks, Ranged (slingshot and ammo) and Voodoo (staffs, runes or totems, to be decided).

## M6: Quests and Hunting

Dialogue system, quest engine, journal, "Grug's Cave Problem", the first quest series opener, Hunt Masters and tasks.

## M7: Playtest readiness

Art and audio pass for the starting region, performance budgets met, staff tools (mute, kick, teleport) with rank tests, reports with chat context, a nightly 300-bot load test, and a backup routine.

## Later (not scheduled)

Trading, the marketplace, PvP minigames, premium expansions, the website's Premium purchase, splitting regions across processes, Steam and desktop clients, hiscores, clans, mobile browser support (if chosen).
