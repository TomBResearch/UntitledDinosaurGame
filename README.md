# Untitled Dinosaur Game

Browser-based prehistoric RPG planning repository.

**Current state:** M0 planning contracts are organised. Game implementation has not started; validation Gates A, B and C have not run.

## Start here

- **For an agent:** read [AGENTS.md](AGENTS.md), then the specific [task contract](docs/contracts/README.md) you are assigned. Each task links only to the shared rules it needs.
- **For the project owner:** review [adoption status](docs/contracts/adoption.md) and assign [UDG-001](docs/contracts/UDG-001.md) when its planning decisions are accepted. Publishing this bundle does not assign implementation work.
- **For architecture context:** read the preserved [M0 Technical Specification v0.2](docs/specifications/UDG-SPEC-M0-002.md).

## Repository map

| Location | Purpose |
| --- | --- |
| [docs/contracts/](docs/contracts/README.md) | Eleven individual task contracts, dependency order, ownership and definition of done |
| [docs/interfaces/](docs/interfaces/README.md) | Shared domain, protocol, configuration, authority and navigation contracts |
| [docs/integration/](docs/integration/README.md) | Colyseus, Rapier and Recast validation rules and gate status |
| [docs/validation/](docs/validation/README.md) | Fixtures, thresholds, workloads and evidence requirements |
| [docs/adr/](docs/adr/README.md) | Architecture-conflict escalation and decision template |
| [docs/specifications/](docs/specifications/README.md) | Preserved source baseline and identity |
| apps/, packages/, tools/, assets/, tests/ | Scoped AGENTS.md instructions for future implementation work |

## Scope and commands

The assignable planning scope stops at UDG-SPIKE-003. UDG-009 through UDG-012 remain future work. No application source, package manifests, generated assets, executable test harness or pnpm commands exist yet. The [repository contract](docs/contracts/repository.md) specifies what assigned tasks must create and how those commands must behave.

The original README specification is preserved byte-for-byte at its new specification path; this page is the working navigation entry point. Edit each operational requirement in its owner file and link to it elsewhere to prevent conflicting copies.
