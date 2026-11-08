# Untitled Dinosaur Game

Browser-based prehistoric RPG planning repository.

**Current state:** UDG-001 (workspace and CI foundation) is implemented and **In Review**. Game
movement, networking, physics and rendering behaviour still do not exist, and validation Gates A,
B and C have not run. The planning contracts and their adoption status remain the authority for
what may be built next.

## Start here

- **For an agent:** read [AGENTS.md](AGENTS.md), then the specific [task contract](docs/contracts/README.md) you are assigned. Each task links only to the shared rules it needs.
- **For the project owner:** review [adoption status](docs/contracts/adoption.md). P01 is approved with clarifications C-01 to C-06; P02 to P10 remain pending, so UDG-002 and everything downstream of it stay Not Started.
- **For the current project plan:** read the [plan and version guide](docs/specifications/README.md). The [M0 Technical Specification v0.2](docs/specifications/UDG-SPEC-M0-002.md) is the current architecture baseline; the v1.0 agent contracts elaborate it into work packages.

## Repository map

| Location | Purpose |
| --- | --- |
| [docs/contracts/](docs/contracts/README.md) | Eleven individual task contracts, dependency order, ownership and definition of done |
| [docs/interfaces/](docs/interfaces/README.md) | Shared domain, protocol, configuration, authority and navigation contracts |
| [docs/integration/](docs/integration/README.md) | Colyseus, Rapier and Recast validation rules, gate status and the dependency register |
| [docs/validation/](docs/validation/README.md) | Fixtures, thresholds, workloads and evidence requirements |
| [docs/adr/](docs/adr/README.md) | Architecture-conflict escalation and decision template |
| [docs/specifications/](docs/specifications/README.md) | Current plan, document version guide and preserved architecture baseline |
| [tools/checks/](tools/checks/AGENTS.md) | `@udg/checks`: boundary, fixture, evidence and task-dispatch checkers created by UDG-001 |
| apps/, packages/, assets/, tests/ | Scoped `AGENTS.md` instructions plus empty workspace skeletons created by UDG-001 |

## Development prerequisites

| Requirement | Pinned value | Enforced by |
| --- | --- | --- |
| Operating system | Linux or macOS. Windows through WSL or CI; the repository scripts avoid shell-specific globbing, but browser and process supervision behaviour is only verified on Linux and in CI. | documented |
| Node.js | `24.22.2` | `.node-version`, `package.json` `engines`, `.npmrc` `engine-strict=true`, CI |
| pnpm | `12.18.0` | `packageManager` field resolved by corepack, `package.json` `engines`, CI |
| Repository checkout | Git with a clean worktree; evidence and build output are ignored paths | `.gitignore` |

Install the pinned toolchain with corepack (no global version manager is required):

```sh
corepack enable
corepack prepare pnpm@12.18.0 --activate
pnpm --version   # must print 12.18.0
node --version   # must print v24.22.2
```

## Install, check, run, stop

```sh
pnpm install --frozen-lockfile    # exact committed dependency graph; refuses a mutated lockfile
pnpm typecheck                    # strict no-emit checks for the root config and every workspace
pnpm lint                         # ESLint plus dependency-boundary and cycle checks
pnpm test                         # all populated unit and Node integration suites
pnpm build                        # clean, then build shared libraries, tools and both apps
pnpm test:boundaries              # positive and deliberately invalid dependency fixtures
pnpm test:fixtures                # fixture manifest schema, pinned file and configuration hashes
pnpm test:contract -- --task UDG-001
pnpm dependencies:record          # rewrite docs/integration/dependencies.json from the install
pnpm dependencies:verify          # fail when that register no longer describes the install
pnpm contracts:checksums          # report contract documents whose bytes moved since the manifest
pnpm contracts:checksums -- --write # rewrite docs/contracts/checksums.json after such a change
pnpm evidence:capture -- --task UDG-001 --out artifacts
pnpm evidence:verify -- --run artifacts/RUN_ID
```

`pnpm clean` removes workspace build output. There is nothing to run or stop yet: no server or
client entry point exists, so no port is bound and no ready signal is emitted. The ports and ready
signals below are the contract that UDG-003 and UDG-004 must honour, recorded here so a developer
can configure tooling in advance.

| Service | Address | Ready signal (from the owning task) | Shutdown |
| --- | --- | --- | --- |
| Development Colyseus server | `127.0.0.1:2567` | `UDG_SERVER_READY` line with the bound port and protocol/config hashes (UDG-003) | `SIGINT`; the room disposes once and frees state |
| Development Vite client | `http://127.0.0.1:5173` | Vite ready line plus `UDG_CLIENT_READY` with the server URL it will contact (UDG-004) | `SIGINT` in the terminal running `pnpm dev` |

Both defaults are loopback only. Non-loopback exposure is refused unless the owning task's explicit
opt-in flag is set, because a development room bound to a routable interface is a security problem.
Copy `.env.example` for the variable names; it contains no secrets and never will.

## Command availability right now

Commands owned by tasks that have not started are wired to a dispatcher that exits non-zero with an
attributed reason. A missing suite is never reported as a pass, and `pnpm test` never succeeds on
zero discovered tests.

| Command | Status today | Owning task |
| --- | --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` | Implemented and passing | UDG-001 |
| `pnpm test:boundaries`, `pnpm test:fixtures`, `pnpm test:contract -- --task UDG-001` | Implemented and passing | UDG-001 |
| `pnpm dependencies:record`, `pnpm dependencies:verify`, `pnpm contracts:checksums`, `pnpm evidence:capture`, `pnpm evidence:verify` | Implemented | UDG-001 |
| `pnpm test:contract -- --task UDG-002 … UDG-SPIKE-003` | Exits `2`: that task's suite does not exist yet | each task creates its own suite |
| `pnpm test:unit` | Exits `1`: no unit suite exists yet | UDG-002 first, then every task that adds logic |
| `pnpm test:e2e -- --suite camera` | Exits `1`: no browser suite exists | UDG-004 camera, UDG-SPIKE-001 netcode, UDG-006 physics, UDG-008 input, UDG-SPIKE-003 hybrid |
| `pnpm test:spike -- --id UDG-SPIKE-001 …` | Exits `1`: no spike harness exists | UDG-SPIKE-001, UDG-SPIKE-002, UDG-SPIKE-003 |
| `pnpm assets:build`, `pnpm assets:verify` | Exits `1`: no asset pipeline exists | UDG-007 |

## Continuous integration

`.github/workflows/ci.yml` runs the same sequence above on `ubuntu-24.04` with Node `24.22.2`, the
corepack-pinned pnpm `12.18.0`, a frozen installation, and third-party actions pinned to commit
shas. It uploads the evidence directory so logs and machine-readable results survive a failure.

Per owner clarification C-05, UDG-001 stays **In Review** until this workflow has actually run green
on the pushed commit; the local reproduction of the identical command sequence is recorded in the
completion report, and CI reproduction is not treated as passed before that run exists.

## Evidence

A run writes `artifacts/RUN_ID/` containing `report.json`, `environment.json`, `commands.json`,
`junit.xml`, `boundary-report.json`, `build.log`, `logs/` and `checksums.sha256`. `pnpm
evidence:verify` re-checks the report schema, required artefacts, non-empty and matching hashes,
zero skipped or flaky tests, command exit codes and the absence of credentials or private machine
paths. `artifacts/` is not committed: raw bundles are copied to owner-reachable durable storage and
only sanitised summaries plus hashes are committed, per clarification C-03.

## Scope and commands

The assignable planning scope stops at UDG-SPIKE-003. UDG-009 through UDG-012 remain future work.
No game source, protocol schema, generated asset or engine dependency exists yet; the game-library
entries in [docs/integration/dependencies.json](docs/integration/dependencies.json) are recorded as
`not-selected` with the task that must choose them. The [repository contract](docs/contracts/repository.md)
specifies what assigned tasks must create and how those commands must behave.

The original README specification is preserved byte-for-byte at its specification path; this page is
the working navigation entry point. Edit each operational requirement in its owner file and link to
it elsewhere to prevent conflicting copies.
