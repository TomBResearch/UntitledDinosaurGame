# Untitled Dinosaur Game

Browser-based prehistoric RPG planning repository.

**Current state:** UDG-001 (workspace and CI foundation) is **Verified** — accepted by the project
owner on 2026-11-08 (implementation `1c735c2`, reviewed submission `0e586b6`). UDG-002 (protocol and
configuration types, validation and replica mapping) is **Verified** — accepted by the project owner
on 2026-11-09 (implementation `372be93`, reviewed submission `a967c5f`) after one review round that
produced four corrections and a follow-up. `@udg/protocol` and `@udg/config` contain the wire
contract, validation and mapping described in
[docs/contracts/protocol-v1.md](docs/contracts/protocol-v1.md), and they contain nothing else; the
replica encoding widths stay provisional under
[ADR 0001](docs/adr/0001-replica-precision-policy.md) until Gate A. [UDG-004](docs/contracts/UDG-004.md) is
**Verified** — accepted by the project owner on 2026-11-16 (implementation
`d318444fe8668f4485d85398ecc6eb88ff5e3b36`, passing CI run
[43893238010](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43893238010) attempt 2), after three
Mac control rulings during review; a browser client with a Babylon greybox, a React status overlay and a bounded
orbit/zoom/pinch/keyboard camera now exists and is tested in a real browser, and it accepts no game movement, no
server-authoritative pose and no asset pipeline — the failed-asset-load check that UDG-004 could not reach is
**carried forward to UDG-007**, untested rather than passed. Game movement, networking and physics behaviour still
do not exist and validation Gates A, B and C have not run.
[UDG-003](docs/contracts/UDG-003.md) is **Verified** — Phases 0 to 2 accepted at phase level, **Phase 3 accepted
2026-11-18** on implementation `74aa8dabbef7` (CI `44299429735`, **attempt 1**) with the closeout of what it leaves
unresolved reviewed at `5bec5ff66538` (CI `44316260678`). Acceptance **passes no gate** and closes nothing that was
not demonstrated —
and its `W-7` suite nondeterminism stays tracked there, not against UDG-004 — `W-7` was **seen firing in
retained hosted bytes on 2026-11-17** (run `44191978254`, a documents-only push, in the fifth of the job's five
suite invocations), which is why a red inside another task's capture bundle is not that task's failure. The
reviewer's first two directives were implemented on 2026-11-18: the whole-task capture now retains the artefacts
a failing case actually read (`W-A-3`), and the CI capture loop attempts every plan instead of aborting at the
first red one (`WA-6`) — a red that deletes other tasks' evidence is not evidence. The first of those decisions
was reviewed and accepted at `41934a1` (CI `44287836166`), and `W-7`'s episode tallies are now read at the
episode end, before the harness is restored or cleanup starts, with cleanup observations retained separately and
controls proving a cleanup callback cannot move an episode result. That repair was accepted at `74aa8dab` (CI `44299429735`), and the four defects still open — `W-7`'s delivery count, the authority-to-client mapping mismatch, the post-close input observation and `P-2b` — are now closed out individually with retained evidence, owners and reopening conditions rather than bundled as one flaky suite ([closeout](docs/contracts/assignments/evidence/UDG-003-phase-3-defect-closeout.md)). That closeout is now the acceptance basis: the four observations are registered as **CF-1 to CF-4**, stay **unclassified** where no cause was demonstrated, carry owners and byte-named reopening conditions, and travel to every place their guarantee is read — UDG-003, its Phase 2 evidence matrix, UDG-007, UDG-008 and UDG-SPIKE-001. Ten consecutive passing runs recorded stability under a declared load and order and establish no cause for any of them. Every task after
UDG-004 stays unassigned. Refinements P04, P05 and P07 to P10 remain pending (P03 was approved 2026-11-09).
The planning contracts and their [adoption status](docs/contracts/adoption.md) remain the authority for what may be built next.

## Start here

- **For an agent:** read [AGENTS.md](AGENTS.md), then the specific [task contract](docs/contracts/README.md) you are assigned. Each task links only to the shared rules it needs.
- **For the project owner:** review [adoption status](docs/contracts/adoption.md). P01, P02, P03 and P06 are approved (P02 with clarifications U2-1 to U2-6 and ADR 0001); P04, P05 and P07 to P10 remain pending. UDG-003 is **Verified** (accepted 2026-11-18, with four observations carried forward) and UDG-004 is **Verified** (accepted 2026-11-16); neither passes a gate — Gates A, B and C remain **Not Run** and `stackCompatibility` remains **not-established** — and every task after them stays Not Started.
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

`pnpm clean` removes workspace build output. Both development processes exist: the UDG-003 server
and `pnpm dev`, the UDG-004 Vite client. A client with no server is a normal state — it renders the
scene and reports the connection as failed rather than pretending otherwise.

| Service | Address | Ready signal (from the owning task) | Shutdown |
| --- | --- | --- | --- |
| Development Colyseus server | `127.0.0.1:2567` | `UDG_SERVER_READY` line with the bound port and protocol/config hashes (UDG-003) | `SIGINT`; the room disposes once and frees state |
| Development Vite client | `http://127.0.0.1:5173` | Vite ready line plus `UDG_CLIENT_READY` with the server URL it will contact (UDG-004) | `SIGINT` in the terminal running `pnpm dev` |

Both defaults are loopback only. Non-loopback exposure is refused unless the owning task's explicit
opt-in flag is set, because a development room bound to a routable interface is a security problem.
For the client that flag is `UDG_DEV_HOST`: unset, Vite binds `127.0.0.1` and prints no `Network:` line;
set to `0.0.0.0`, it binds every interface and says so loudly in the banner, so it is used only on an
interface you chose, never by default. Copy `.env.example` for the variable names; it contains no
secrets and never will.

## Command availability right now

Commands owned by tasks that have not started are wired to a dispatcher that exits non-zero with an
attributed reason. A missing suite is never reported as a pass, and `pnpm test` never succeeds on
zero discovered tests.

| Command | Status today | Owning task |
| --- | --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` | Implemented and passing | UDG-001 |
| `pnpm test:boundaries`, `pnpm test:fixtures`, `pnpm test:contract -- --task UDG-001` | Implemented and passing | UDG-001 |
| `pnpm test:unit`, `pnpm test:contract -- --task UDG-002` | Implemented and passing: protocol and configuration validation, mapping, schema round trips and the executable protocol fixtures | UDG-002 |
| `pnpm dependencies:record`, `pnpm dependencies:verify`, `pnpm contracts:checksums`, `pnpm evidence:capture`, `pnpm evidence:verify`, `pnpm evidence:summary` | Implemented; a capture plan exists for each of UDG-001, UDG-002, UDG-003 and UDG-004 | UDG-001, extended by UDG-002, UDG-003 and UDG-004 |
| `pnpm test:contract -- --task UDG-003 … UDG-SPIKE-003` | Exits `2`: that task's suite does not exist yet | each task creates its own suite |
| `pnpm dev` | Implemented and passing: the UDG-004 development client on `http://127.0.0.1:5173` — a **middle-button** drag orbits (the left button stays inert for UDG-008), wheel and pinch zoom within 2–20 m, a one-finger touch drag keeps the scene under the finger, and holding an arrow key orbits or pitches **continuously** while the scene canvas has focus | UDG-004 |
| `pnpm test:e2e -- --suite camera` | Implemented and passing: the UDG-004 camera suite, its screenshots and its lifecycle counts | UDG-004 |
| `pnpm test:e2e -- --suite netcode\|physics\|input\|hybrid` | Exits `1` naming its owner: no such suite exists, and a suite that does not exist is never a pass | UDG-SPIKE-001 netcode, UDG-006 physics, UDG-008 input, UDG-SPIKE-003 hybrid |
| `pnpm test:e2e` with no `--suite` | Exits `1`, naming all five owners: no single task owns "every browser suite" | the five tasks above |
| `pnpm test:spike -- --id UDG-SPIKE-001 …` | Exits `1`: no spike harness exists | UDG-SPIKE-001, UDG-SPIKE-002, UDG-SPIKE-003 |
| `pnpm assets:build`, `pnpm assets:verify` | Exits `1`: no asset pipeline exists | UDG-007 |

## Continuous integration

CI is two workflows with two names, so a reviewer can tell from a check name which kind of green they are
looking at (owner clarification C-07, [proposal](docs/contracts/assignments/ci-routing-proposal.md)):

| Workflow | What it is | Evidence |
| --- | --- | --- |
| `ci (routine)` — `.github/workflows/ci.yml` | routed checks on every push and pull request. One job resolves the changed paths for the whole push or PR (both sides of a rename, deletions included) and turns them into lanes: records, static, protocol, unit, camera, server, runtime, tooling, full suite. Unknown impact runs everything. | **none** — a routine run captures no bundle and can never satisfy a task's acceptance |
| `ci (acceptance — full evidence capture)` — `.github/workflows/acceptance.yml` | the full command sequence, all five capture plans, artefact assertion, verification, summaries and publication. Dispatched explicitly at a task submission or milestone, on the exact candidate commit. | all five bundles, published for 30 days |

Dispatch acceptance with the candidate named twice — once as the ref GitHub has to resolve, once as the
assertion the workflow checks it against:

```bash
# The candidate is the tip of the branch being accepted:
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref main -f candidate_sha="$(git rev-parse HEAD)"

# The candidate is a pull request head: name its branch, and that commit exactly.
gh workflow run acceptance.yml --repo TomBResearch/UntitledDinosaurGame \
  --ref "$BRANCH" -f candidate_sha="$HEAD_SHA"
```

The ref is a **ref name**, not a sha: GitHub resolves it before the workflow starts and answers
`HTTP 422: No ref found for: <sha>` to a bare commit (measured 2026-11-18). That is what `candidate_sha` is for,
and it is **required** — with no default, because a blank candidate is not a candidate. Three refusals, all of
them before install and before any capture, so a refused dispatch writes no bundle
([`44403714403`](.github/workflows/acceptance.yml), [`44403926011`](.github/workflows/acceptance.yml)):

| Dispatch | What happens |
| --- | --- |
| `candidate_sha=""` | never becomes a run — `HTTP 422: Required input 'candidate_sha' not provided` |
| `candidate_sha=45b787b8` | red in 10 s — `candidate_sha must be a full 40-character sha; 8 character(s) received`; a prefix cannot be compared with a checkout unambiguously, so it is refused rather than matched |
| a full sha that is not what the ref resolved to | red in 24 s — `this run checked out <sha> but was asked to verify <sha>`; this is what a branch that moved between choosing the candidate and dispatching looks like |

Once the candidate is confirmed, a later step re-reads every captured `report.json` and refuses any bundle whose
`implementationSha` is not that candidate, so the five bundles and the run disagree with each other in no case.

Both workflows run on `ubuntu-24.04` with Node `24.22.2`, the corepack-pinned pnpm `12.18.0`, a frozen
installation, and third-party actions pinned to commit shas — a rule asserted over **both** files, where an
action that appears only in the acceptance workflow has to be approved by name and sha in
`tests/unit/ci-routing/workflow-policy.test.ts`, alongside a test that shows the rule refusing an unapproved
action, a tag instead of a sha, and an approved action at a different sha. The routine lanes install the pinned
chromium with `playwright install chromium`; `--with-deps` is kept only in the acceptance lane, because the
runner image already ships chromium and its libraries and the system-package fetch cost 6 min 47 s of an
8 min 31 s camera run for packages that changed nothing (`44374825713`, remeasured at 2 min 50 s in `44400801523`)
— safe for the one browser-dependent unit test because it compares PNG bytes against ones it produced in the same
run, in the same browser build. Evidence capture, the artefact assertion, evidence
verification and artefact publication are required checks: no step in either file sets `continue-on-error`, so a
failure in any of them fails its run, while `if: !cancelled()` keeps the evidence steps executing after an
earlier failure so a red acceptance run still publishes its logs and machine-readable results. A missing
artefact is an error (`if-no-files-found: error`), never a warning — a green acceptance run always carries the
evidence it claims. `tests/contracts/UDG-001.test.ts` parses both workflows, maps every evidence failure to a
failed job conclusion, and executes the assertion script against empty, incomplete and complete bundles;
`tests/unit/ci-routing/` tests the routing table and asserts that every group the router can emit has a lane to
run in, in both directions.

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
adopted P02 and P06 on 2026-11-08 and reviewed by the owner on 2026-11-09: the first
submission drew four corrections, and the corrected head was accepted with
[run 42627324928](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42627324928) green on the reviewed submission. Its own CI history — two red runs,
a green first submission and a green accepted submission — is recorded in
[the UDG-002 completion record](docs/contracts/assignments/UDG-002-completion.md). P04, P05 and P07
to P10 remain pending and Gates A, B and C remain Not Run; UDG-003 is In Progress with Phase 3 **assigned on
2026-11-17, Ready and unstarted**
and UDG-004 was accepted on 2026-11-16 at `d318444`, so nothing beyond those two is assigned and no implementation for
either has been accepted beyond what those records describe; the local reproduction of the identical command sequence and every CI bundle are retained and verified —
including the runs that went red, which are named rather than removed.

## Evidence

A run writes `artifacts/RUN_ID/` containing `report.json`, `environment.json`, `commands.json`,
`junit.xml`, `boundary-report.json`, `build.log`, `logs/` and `checksums.sha256`, plus the artefacts
its task declares — for UDG-002 the protocol field map, the round-trip results, the observed
rejection codes and the live refusal probes. Each task's bundle is described by a capture plan
(`node tools/checks/dist/evidence.js plans` lists them), and an acceptance run captures, asserts and verifies
every plan it finds — all five, unconditionally — so adding a task cannot silently drop evidence, and a
routine run captures none. `pnpm evidence:verify` re-checks the
report schema, required artefacts, non-empty and matching hashes, zero skipped or flaky tests,
command exit codes, the task's own prerequisite commits, that task-declared JSON artefacts parse and
carry that task's identity, and the absence of credentials or private machine paths. A PNG is copied
byte-for-byte and never rewritten as text — a screenshot read as UTF-8 and written back is a different
file, and one that no viewer will open — while a binary that carries a machine path is reported as a
refusal with its bytes left exactly as they were (`UDG-004` is the task that established this rule;
see `docs/integration/client-stack-v1.md`). Verification and `pnpm evidence:summary` are gates rather than neutral audits: a bundle whose
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
