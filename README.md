# Untitled Dinosaur Game

Browser-based prehistoric RPG planning repository.

**Current state:** UDG-001 (workspace and CI foundation) is **Verified** — accepted by the project
owner on 2026-11-08 (implementation `1c735c2`, reviewed submission `0e586b6`). UDG-002 (protocol and
configuration types, validation and replica mapping) is **In Review**: `@udg/protocol` and
`@udg/config` contain the wire contract, validation and mapping described in
[docs/contracts/protocol-v1.md](docs/contracts/protocol-v1.md), and they contain nothing else. Game
movement, networking, physics and rendering behaviour still do not exist, validation Gates A, B and C
have not run, refinements P03 to P05 and P07 to P10 remain pending, and no task beyond UDG-002 is
assigned. The planning contracts and their
[adoption status](docs/contracts/adoption.md) remain the authority for what may be built next.

## Start here

- **For an agent:** read [AGENTS.md](AGENTS.md), then the specific [task contract](docs/contracts/README.md) you are assigned. Each task links only to the shared rules it needs.
- **For the project owner:** review [adoption status](docs/contracts/adoption.md). P01, P02 and P06 are approved (P02 with clarifications U2-1 to U2-6 and ADR 0001); P03 to P05 and P07 to P10 remain pending, so UDG-003 and everything downstream of it stay Not Started.
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
| [docs/contracts/protocol-v1.md](docs/contracts/protocol-v1.md) | The built M0 protocol: entry points, wire messages, rejection codes, replica fields, normalisation order and the provisional items |
| [tools/checks/](tools/checks/AGENTS.md) | `@udg/checks`: boundary, fixture, evidence and task-dispatch checkers created by UDG-001 |
| [packages/protocol/](packages/protocol/src) | `@udg/protocol`: canonical domain types, wire validation, replica schema declarations and mapping (UDG-002) |
| [packages/config/](packages/config/src) | `@udg/config`: configuration validation, protocol limits, region bounds and the canonical hash (UDG-002) |
| apps/, packages/simulation, packages/physics, packages/navigation, assets/ | Scoped `AGENTS.md` instructions plus the empty workspace skeletons created by UDG-001; each is filled by its owning task |

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
pnpm typecheck                    # builds the workspace libraries, then strict no-emit checks
                                  # (pnpm test does the same: a suite that asserts against built
                                  # output has to be able to produce it on a fresh checkout)
pnpm lint                         # ESLint plus dependency-boundary and cycle checks
pnpm test                         # all populated unit and Node integration suites
pnpm build                        # clean, then build shared libraries, tools and both apps
pnpm test:boundaries              # positive and deliberately invalid dependency fixtures
pnpm test:fixtures                # fixture manifest schema, pinned file and configuration hashes
pnpm test:unit                      # unit suites for the packages that have logic (UDG-002 onward)
pnpm test:contract -- --task UDG-001
pnpm test:contract -- --task UDG-002
pnpm dependencies:record          # rewrite docs/integration/dependencies.json from the install
pnpm dependencies:verify          # fail when that register no longer describes the install
pnpm contracts:checksums          # report contract documents whose bytes moved since the manifest
pnpm contracts:checksums -- --write # rewrite docs/contracts/checksums.json after such a change
pnpm evidence:capture -- --task UDG-001 --out artifacts
pnpm evidence:capture -- --task UDG-002 --out artifacts
pnpm evidence:verify -- --run artifacts/RUN_ID
pnpm evidence:summary -- --run artifacts/RUN_ID --out docs/contracts/assignments/UDG-002-evidence.json
node tools/checks/dist/evidence.js plans   # the task IDs that have a capture plan
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
| `pnpm test:unit`, `pnpm test:contract -- --task UDG-002` | Implemented and passing: protocol and configuration validation, mapping, schema round trips and the executable protocol fixtures | UDG-002 |
| `pnpm dependencies:record`, `pnpm dependencies:verify`, `pnpm contracts:checksums`, `pnpm evidence:capture`, `pnpm evidence:verify`, `pnpm evidence:summary` | Implemented; a capture plan exists for each of UDG-001 and UDG-002 | UDG-001, extended by UDG-002 |
| `pnpm test:contract -- --task UDG-003 … UDG-SPIKE-003` | Exits `2`: that task's suite does not exist yet | each task creates its own suite |
| `pnpm test:e2e -- --suite camera` | Exits `1`: no browser suite exists | UDG-004 camera, UDG-SPIKE-001 netcode, UDG-006 physics, UDG-008 input, UDG-SPIKE-003 hybrid |
| `pnpm test:spike -- --id UDG-SPIKE-001 …` | Exits `1`: no spike harness exists | UDG-SPIKE-001, UDG-SPIKE-002, UDG-SPIKE-003 |
| `pnpm assets:build`, `pnpm assets:verify` | Exits `1`: no asset pipeline exists | UDG-007 |

## Continuous integration

`.github/workflows/ci.yml` runs the same sequence above on `ubuntu-24.04` with Node `24.22.2`, the
corepack-pinned pnpm `12.18.0`, a frozen installation, and third-party actions pinned to commit
shas. Evidence capture, the artefact assertion, evidence verification and artefact publication are
required checks: no step in the job sets `continue-on-error`, so a failure in any of them fails the
run, while `if: !cancelled()` keeps them executing after an earlier failure so a red run still
publishes its logs and machine-readable results. A missing artefact is an error
(`if-no-files-found: error`), never a warning — a green run always carries the evidence it claims.
`tests/contracts/UDG-001.test.ts` parses the workflow, maps every evidence failure to a failed job
conclusion, and executes the assertion script against empty, incomplete and complete bundles.

That policy was also demonstrated on the runner itself, in probe run [42509775271](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42509775271)
(three jobs on the now-deleted branch `udg-001-ci-negative-probe`, `main` untouched). A capture that
could not start failed its job at the capture, assertion, verification and upload steps alike, and a
publication with no artefacts failed on `if-no-files-found: error`. The third job was meant to corrupt
a captured bundle but never got the chance — its capture step had already failed, so the corruption
step was skipped — and that is how the real hole surfaced: capture had written a complete bundle that
honestly recorded a failing run, the new assertion step passed it because every artefact was present,
and the verifier then in use printed `PASS evidence verify … (0 issue(s))` for it. A bundle whose own
record is not PASS is therefore refused outright now (`EVIDENCE-GATE-NOT-PASS`). That runner
observation is separate from the proof of the fix: the contract suite builds a hash-consistent bundle
with status `FAIL` and asserts the single refusal code plus a non-zero exit and that no summary file
is written, and re-running the corrected verifier over the retained probe bundle reproduces the same
refusal on the original bytes.

Per owner clarification C-05 the workflow had to run green on the pushed commit before UDG-001 could
be Verified. It did: run [42510445695](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42510445695)
on the accepted implementation `1c735c2` and run
[42511785889](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42511785889) on the
reviewed submission `0e586b6` each completed with 19 of 19 steps success on `ubuntu-24.04`, and the
published evidence bundles verify with zero issues. The project owner recorded acceptance on
2026-11-08, so UDG-001 is **Verified**. UDG-002 was authorised by the same owner decision set that
adopted P02 and P06 on 2026-11-08, is **In Review** with the owner as reviewer, and its own CI history
— including two red runs and the green submission run — is recorded in
[the UDG-002 completion record](docs/contracts/assignments/UDG-002-completion.md). P03 to P05 and P07
to P10 remain pending and Gates A, B and C remain Not Run, so no task beyond UDG-002 is assigned; the
local reproduction of the identical command sequence and the CI bundles are retained and verified.

## Evidence

A run writes `artifacts/RUN_ID/` containing `report.json`, `environment.json`, `commands.json`,
`junit.xml`, `boundary-report.json`, `build.log`, `logs/` and `checksums.sha256`, plus the artefacts
its task declares — for UDG-002 the protocol field map, the round-trip results, the observed
rejection codes and the live refusal probes. Each task's bundle is described by a capture plan
(`node tools/checks/dist/evidence.js plans` lists them), and CI captures, asserts and verifies every
plan it finds, so adding a task cannot silently drop evidence. `pnpm evidence:verify` re-checks the
report schema, required artefacts, non-empty and matching hashes, zero skipped or flaky tests,
command exit codes, the task's own prerequisite commits, that task-declared JSON artefacts parse and
carry that task's identity, and the absence of credentials or private machine paths. Verification and `pnpm evidence:summary` are gates rather than neutral audits: a bundle whose
own record says `FAIL`, `BLOCKED` or `INVALID` is refused with `EVIDENCE-GATE-NOT-PASS` even when
every stored hash matches, and no summary file is written for it, because a self-consistent record of
a failing run proves nothing about completion. `artifacts/` is not committed: raw bundles are copied
to owner-reachable durable storage and only sanitised summaries plus hashes are committed, per
clarification C-03.

## Scope and commands

The assignable planning scope stops at UDG-SPIKE-003. UDG-009 through UDG-012 remain future work.
`@udg/protocol` and `@udg/config` now hold the UDG-002 deliverables; no server room, locomotion,
physics, navigation, rendering or generated asset exists yet, and the protocol package deliberately
imports no schema runtime outside `@udg/protocol/schema`. Of the game libraries, only
`@colyseus/schema@5.0.45` is selected (by UDG-002); the remaining entries in
[docs/integration/dependencies.json](docs/integration/dependencies.json) are recorded `not-selected`
with the task that must choose them, and that status is derived from the install rather than asserted
by hand. The [repository contract](docs/contracts/repository.md)
specifies what assigned tasks must create and how those commands must behave.

The original README specification is preserved byte-for-byte at its specification path; this page is
the working navigation entry point. Edit each operational requirement in its owner file and link to
it elsewhere to prevent conflicting copies.
