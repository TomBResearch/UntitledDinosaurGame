# Developer docs (private)

Internal documentation for Untitled Dinosaur Game. Players never see this; the public wiki is in [`../wiki/`](../wiki/index.md). [ADR 0008](decisions/0008-public-wiki-private-docs.md) says what goes where.

## Start here

| If you want to… | Read |
|---|---|
| Understand the game | [vision.md](vision.md) |
| See what's being built next | [roadmap/milestones.md](roadmap/milestones.md) |
| Check what isn't decided yet | [open-questions.md](open-questions.md) |
| Pick up a task (agents) | [agents/workflow.md](agents/workflow.md) |

## Architecture

| Doc | Covers |
|---|---|
| [overview.md](architecture/overview.md) | Components, how a player gets into a world, data flow |
| [world-server.md](architecture/world-server.md) | Ticks, regions, entities, interest management, pathfinding, saving |
| [networking.md](architecture/networking.md) | Transport, messages, movement playback, bandwidth |
| [client.md](architecture/client.md) | Godot client structure, rendering limits, region streaming |
| [backend.md](architecture/backend.md) | HTTP API: worlds, characters, join tickets, deletion hook |
| [accounts.md](architecture/accounts.md) | How we use the shared account platform |
| [content-pipeline.md](architecture/content-pipeline.md) | Blender → Godot → region export → server; `data/` files |
| [security.md](architecture/security.md) | Authority rules, validation, rate limits, required tests |

## Design

| Doc | Covers |
|---|---|
| [skills.md](design/skills.md) | The skill list and what each one does |
| [progression.md](design/progression.md) | Levels, XP curve, the formula and its knobs |
| [combat.md](design/combat.md) | Click-to-attack, combat bonuses, abilities 1–4, boss telegraphs |
| [items-and-bank.md](design/items-and-bank.md) | Inventory, equipment, bank, drops, ground items |
| [death.md](design/death.md) | Safe death and respawn |
| [worlds-and-premium.md](design/worlds-and-premium.md) | World list, premium worlds, content flags |
| [quests.md](design/quests.md) | Quest structure |

## Operations and decisions

- [operations/hosting.md](operations/hosting.md): the project server, Docker layout, domains, memory budget
- [operations/deploy.md](operations/deploy.md): deploying to the live site, passwords, the playtest gate
- [operations/site.md](operations/site.md): building the wiki and docs site, the leak guard, and serving `/wiki/` and `/dev/`
- [decisions/](decisions/README.md): every significant technical choice, with its reasons
