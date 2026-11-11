# UDG-003 Phase 1 completion — transport-independent movement authority core

> Assignment: [UDG-003-phase-1.md](UDG-003-phase-1.md) (pinned at `e1b0026`, corrected against P03 at `23f2869`).
> **Status: In Review.** Submitted by the agent implementer on 2026-11-12. No reviewer acceptance is recorded
> here, none is implied, and nothing in this file is a gate decision. UDG-003 remains **In Progress** and
> incomplete; Phases 2 and 3 remain unassigned.

## 1. What Phase 1 was, in one paragraph

Phase 1 builds the movement authority core that P03 describes and nothing that touches a socket: the frozen
arrival cutoff, the stage order, one-input-per-entity-per-tick selection at stage Q, screening, arbitration,
commit, the neutral rule, the bounded queues and terminal-request cache, the input-sufficient journal and
deterministic replay. It is transport-independent by construction — time and scheduling arrive through the
injected `TimeSource` and `Scheduler` ports, and the module set imports neither `@colyseus/*` nor any browser
or engine API. It is **not** a working server: there is no `RegionRoom`, no SDK input attachment, no
`MovementAuthorityAdapter`, no physics, no navigation, no client prediction and no multiple-input consumption.
D-7 stays open and Phase 1 neither uses nor waives it; Part B of the returned recommendation is not adopted.

## 2. What was built

`apps/server/src/authority/` — 12 modules, 4 142 lines. Exactly one of them mutates.

| Module | Owns | Stage |
| --- | --- | --- |
| `types.ts` (522) | the stage list, dispositions, capacities, journal row shapes, the movement seam | vocabulary |
| `determinism.ts` (34) | `TimeSource`, `Scheduler`, `ScheduledHandle` — the only way time enters | vocabulary |
| `clock.ts` (223) | fixed-step clock derived from `NetworkConfig`; `uint32` bound, patch cadence, late-firing clamp | F |
| `arrival.ts` (235) | arrival ordinals, copy-on-record rendering, shape classification | F |
| `bounded.ts` (206) | `BoundedFifo` (drop-newest), `IdentityCache` (128 records / 30 s), `BatchRegistry` | Q, C |
| `entity.ts` (189) | per-entity authority state built on the adopted `PlayerSimulationState`/`LocomotionState` | — |
| `admit.ts` (98) | ingest gate; returns a decision, never mutates | L |
| `screen.ts` (491) | continuous and discrete screening, arbitration, payload hash | S, A |
| `commit.ts` (215) | the commit plan: watermark, latch, purge, disposals; returns a plan, never mutates | C |
| `journal.ts` (321) | row builders, tick hash chain, `toReplayInputs`, digest blanking, completeness and sanitisation checks | X |
| `replay.ts` (202) | replay from **inputs** only; prologue mismatch is refused | replay |
| `step.ts` (1 406) | **the only mutating module**: `F → L → Q → S → A → C → R → X`, lifecycle, stats, AC-17 reconciliation | all |

Test support (`tests/support/authority/`, 6 files) supplies the virtual clock/scheduler, wire-shaped payload
builders, the reference stepper (`drive × speed × dt`, no locomotion model), the harness, replay helpers and
scenario helpers. `tests/unit/udg-003/` holds 11 files / **90 tests**; `tests/contracts/UDG-003.test.ts` gained
8 Phase 1 assertions (**64 tests** in that file).

**Stages M and P are not implemented and are not faked.** They merge replica state and emit patches, which
needs a room and a client — Phase 2. `step.ts` therefore names exactly eight stages, and the contract suite
fails if a ninth letter appears anywhere in it.

## 3. Corrections applied before any code was written

The first pinned assignment described P03 from memory and was wrong in seven ways. It was corrected in
`23f2869` **before a single source file was written**, so no code was ever built against the incorrect draft:
the cutoff is an `arrivalOrdinal` captured as the first statement of the tick (not a timestamp or a tick
count); stage Q selects the **oldest eligible** continuous observation, kind-blind (not the newest, and not by
a generation ceiling); the capacities are 32 continuous per client, 8 discrete per entity, 64 discrete per
room, and a 128-record / 30 s identity cache (not the drafted values); the forward window is
`MAX_GENERATION_FORWARD_GAP` = 64 (not 5); `UDG_MOVE_TO` is refused in screening with `NAVIGATION_BUSY`, or
`OUT_OF_BOUNDS` from validation (not `INVALID_PAYLOAD`); stage Q leaves non-selected frames queued unrefused
while stage C **purges** inadmissible backlog as refused-not-consumed; and arbitration is generation
descending, then kind precedence `direct → cancel → path`, then arrival ordinal ascending, so kind precedence
overrides arrival order. The stage set is F L Q S A C R X M P with Phase 1 covering F→R and X; the P03 clause
range is a–i.

Dependency grants A1/A2 were applied for `@udg/config`: the core needs the same `canonicalHash`,
`computeConfigHash`, `movementHash` and `regionHash` the protocol records, and duplicating canonical hashing
inside `@udg/server` would fork it away from the digests clients compare. No third-party dependency or version
changed; `pnpm install --frozen-lockfile` passes and `docs/integration/dependencies.json` was regenerated
(16 declared packages, 8 deferred groups).

## 4. Defects the Phase 1 tests found, and what was done

Each of these was a real defect in code written for this phase, surfaced by a test written from the adopted
text, and each is now asserted rather than assumed.

1. **A committed discrete intention was never disposed.** Stage Q's consumed reference named only continuous
   observations, so a winning `UDG_CANCEL_PATH` was neither consumed nor refused and AC-17's arithmetic did
   not balance. A non-continuous winning request is now recorded as `consumed`.
2. **Terminal refusals for a parsable `requestId` were not cached.** A request whose identity parsed but whose
   payload failed validation wrote a journal row and then, on retry, a *second* terminal record. Screening now
   parses the identity first, so an identified refusal is written once and replayed from the cache; an
   unparsable identity still writes no cache record (asserted by depth, not by prose).
3. **Observation rows carried no `payloadHash`** for requests, so replay could not compare identities.
   Discrete rows now carry the request identity hash screening produced.
4. **Lifecycle-dropped backlog was invisible.** A departed entity's queued arrivals left no trace; the tick
   outcome now names them in `dropped`, dispositioned `dropped:lifecycle` — dropped, never consumed.
5. **Replay re-ingested one arrival several times.** A single arrival can produce several disposition rows
   across ticks; `toReplayInputs` now dedupes observations and events by arrival ordinal.
6. **Rendered non-finite fields replayed as strings.** `NaN`, `Infinity` and `-Infinity` markers round-tripped
   as text, so a replayed malformed frame differed from the original. They replay as numeric non-finite
   values.
7. **The clock sample overwrote what it measured.** `driftMs`/`scheduledDelayMs` are now recorded fields and
   `clamped` distinguishes the delay floor from the normal period.
8. **`boundReached` was a field only `advance()` set**, so a clock created at the bound lied. It is now a
   property of the counter.
9. **Route-completion accounting polluted AC-17.** Committed/discarded route completions are not arrival
   dispositions; they moved to `routeCompletionsCommitted`/`routeCompletionsDiscarded` so arrival
   reconciliation stays honest.
10. **`VirtualScheduler.advance()` could move virtual time backwards** when a callback advanced time itself.
11. **Stage Q's queue removal made repeat-determinism untestable**, which is why `askStagesQSA` exists: pure
    Q/S/A over a snapshot, with no removal. It is a test seam, not a production path, and says so in place.

## 5. Commands run locally, with results

Node 24.22.2, pnpm 12.18.0, TypeScript 5.9.3. Each command was run once against the tree this record is
committed in; exit codes are as returned, not as expected.

| Command | Exit | Result actually observed |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped` |
| `pnpm typecheck` | 0 | all 9 workspace projects, ending `apps/server typecheck: Done` |
| `pnpm lint` | 0 | eslint clean; `boundary check OK: 61 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test:unit` | 0 | unit suite green |
| `pnpm test:boundaries` | 0 | every fixture `PASS`, including the engine, browser-global and undeclared-dependency rejects |
| `pnpm test` | 0 | `Test Files 20 passed (20)`, `Tests 470 passed (470)` |
| `npx vitest run tests/unit/udg-003` | 0 | `Test Files 11 passed (11)`, `Tests 90 passed (90)` |
| `pnpm dependencies:verify` | 0 | `docs/integration/dependencies.json matches the installed dependency graph` |
| `pnpm --filter @udg/server typecheck` | 0 | clean under the ADR-0002 exception |
| `pnpm --filter @udg/server typecheck:probes` | 0 | clean under the ADR-0002 exception |
| `pnpm run declarations:strict` | 0 | UDG-owned emitted declarations clean with `skipLibCheck: false` |
| `pnpm --filter @udg/server typecheck:probes:full` | **2** | **intentionally failing retained check**: the 27 pinned vendor declaration diagnostics, 0 repository diagnostics |
| `pnpm contracts:checksums` | 0 | manifest matches the tracked planning files |

Two intermediate failures are kept because they are evidence, not embarrassment:

- `pnpm contracts:checksums` failed with `drift detected … docs/contracts/UDG-003.md: hash changed` after the
  status line was edited, and `pnpm test` failed 2 tests (`UDG-001 … keeps the contract checksum manifest
  matching tracked planning files`, and UDG-002's nested-suite guard) for the same reason. Both went green only
  after the manifest was re-pinned with `pnpm contracts:checksums -- --write`. A checksum guard that fails
  before it is satisfied is the guard working.
- The Phase 1 contract assertions failed seven times during development, including a child-process run that
  threw `canonicalJson refuses the non-finite number at $.locomotion.position.x` because this file's own
  stepper had invented a `position` field on `LocomotionState` instead of using `kinematic.position`. The
  assertion caught a wrong assumption in the *evidence*, which is exactly where it should be caught.

**Boundary negative measurement.** A temporary `apps/server/src/authority/__negative.ts` importing
`@babylonjs/core` was refused by the accepted gate and deleted before commit:

```text
BOUNDARY-ENGINE-FORBIDDEN apps/server/src/authority/__negative.ts:2 @babylonjs/core :: @udg/server may not
depend on @babylonjs/core (denied prefix "@babylonjs/"). Server owns authority and replication; client and
browser UI are forbidden.
```

## 6. Per-criterion evidence

Each row names the deciding test and, where the case is deterministic, the machine-readable vector written
during the run. Nothing is evidenced by a sentence alone.

| Criterion | Decided by | Vector |
| --- | --- | --- |
| PA1-1 stage order and frozen cutoff | `cutoff.test.ts` (frozen cutoff, ordinal-vs-timestamp), `vectors.test.ts` §PA1-1, contract stage-order assertion | `pa1-1-pa1-2-cutoff-consumption.json` |
| PA1-2 one input per entity per tick, FIFO, no backlog consumption | `cutoff.test.ts` (burst of 5 → 5 ticks, no coalescing, no `take(n)`), `vectors.test.ts` §PA1-2 | same file, `burst.perTick` |
| PA1-3 generation window from the protocol constant | `admission.test.ts`, `vectors.test.ts` §PA1-3 (admitted at +64, `RESYNC_REQUIRED` at +65, `SUPERSEDED` below `H`, `INVALID_GENERATION` for equal-generation discrete, generation 0, domain top) | `pa1-3-generation.json` |
| PA1-4 T-1, T-2, T-3, T-6 as observed values | `arbitration.test.ts`, `vectors.test.ts` §PA1-4 — T-1 and T-2 compared with arrival order reversed and equal apart from ordinals; T-6 uses the exact P03-e burst (o1–o4 + cancel g12) and asserts three purges, one step, `SUPERSEDED` refusals | `pa1-4-traces-t1-t2-t3-t6.json` |
| PA1-5 commit rule (`H`, `G_d`, latch, drive) | `commit` cases in `cutoff.test.ts`/`neutral.test.ts`, `vectors.test.ts` §PA1-5 | `pa1-5-pa1-8-…json` |
| PA1-6 keepalive neutrality | `neutral.test.ts`, `vectors.test.ts` §PA1-6 (initial, driven, held, resumed — `H`/`G_d`/latch unchanged) | same file |
| PA1-7 every no-winner branch | `neutral.test.ts` (T-7 branches), `vectors.test.ts` §PA1-7 — missing-input, keepalive-only, all-invalid, screened-refusal-only, cache-hit-only, each asserting one step, `idle`, zero displacement, unchanged metadata, `inputSource` distinguished | same file |
| PA1-8 neutral stop and displacement bound | `neutral.test.ts` (AC-4 next-tick stop), `vectors.test.ts` §PA1-8 (7 axis combinations, each ≤ `speed × dt`) | same file |
| PA1-9 bounded structures | `queues.test.ts` (pinned capacities vs literals, 32/8/64 bounds, drop-newest, cause counters, 128-record eviction, T-4, 30 s TTL), `vectors.test.ts` §PA1-9 | `pa1-9-pa1-11-…json` |
| PA1-10 identity-cache completeness | `identity-cache.test.ts`, `vectors.test.ts` §PA1-10 (batch-shared disposition, `REQUEST_ID_CONFLICT` without overwriting the cached identity, refusal replay, unparsable id writes no record) | same file |
| PA1-11 path refusal | `path-refusal.test.ts`, `vectors.test.ts` §PA1-11 (`NAVIGATION_BUSY`, `OUT_OF_BOUNDS`, no `path` candidate, `route` stays `null`, no route-status row, cancel clears drive only) | same file |
| PA1-12 lifecycle ordering, O09 shape | `lifecycle.test.ts`, `vectors.test.ts` §PA1-12 (epoch-8 issuance over an epoch-7 backlog → 3 `refused:epoch` rows, watermark reset, first frame of epoch 8 admitted, leave drops 2 as `dropped:lifecycle`) | `pa1-12-pa1-14-…json` |
| PA1-13 one step per connected entity | `clock.test.ts` (ascending `entityId`, `dt` exactly configured, disconnected not stepped), `vectors.test.ts` §PA1-13 | same file |
| PA1-14 journal schema, replay equivalence and sufficiency | `journal.test.ts`, `vectors.test.ts` §PA1-14 (two replays + a digest-blanked replay all reach the same chain tip and state digests; malformed input still replays; prologue mismatch refused), plus the **emitted-module run** below | same file |
| PA1-15 foundation regression | `pnpm test` 470 green with UDG-001 at 49 and UDG-002 at 31 unmodified; contract assertions hold `index.ts` = `export {};`, no package export, no entry-map row | §5 |

**AC-17 disposition arithmetic** is evidenced per scenario in `disposition-reconciliation.json` (5 scenarios:
quiet, driven, mixed, overflow, departure), each asserting `balanced: true` with `consumed`,
`refused:<reason>`, `answered`, `queued` and `observed` reported by reason.

## 7. The emitted module runs, not just the transformed source

Unit tests import TypeScript through a transform, which proves the transform works. `UDG-003.test.ts`
therefore also runs `pnpm --filter @udg/server build` (**exit 0**, fully typechecked, no `--noCheck` on the
accepted path), checks that the emitted `dist/index.js` and `dist/index.d.ts` are still exactly `export {};`,
and then executes `dist/authority/*.js` in a **child process** under plain Node with ports this file writes
itself — a virtual clock driven through `clock.start()`, a scheduler, and the flat reference stepper. The
recorded child-process result:

```json
{ "tickCount": 4, "watermark": 4, "latchedKind": "cancel", "held": null, "stepCalls": 4,
  "moveRefusal": ["NAVIGATION_BUSY"], "moveCandidates": 0, "routeFieldIsNull": true,
  "dispositionsBalanced": true, "replayOk": true, "rows": 27, "replayRows": 27,
  "terminalCacheRecords": 2, "replayTip": "<identical to originalTip, 64 hex>" }
```

Four ticks, four steps, the cancel at generation 4 winning over the queued frame, the move refused without
becoming a candidate, dispositions balanced, and a replay from the recorded inputs reproducing the same tick
chain tip. The script (`artifacts/udg-003-phase-1/emitted-run.mjs`) and its output are regenerated by the run.

## 8. Machine-readable vectors

Written to `artifacts/udg-003-phase-1/` during the run (gitignored; raw artefacts stay out of Git). The suite
refuses to write any artefact containing a machine path, and re-running the suite reproduces these files
**byte for byte** — verified by diffing two runs' digest lists.

```text
c3158f7753c2ab62e1aeffc71d641b97f62c401462e6f3cb24eee47c436b883d  disposition-reconciliation.json
6794cb4e48cd7480de85e74fbad16743a49702150277ef719e60715c54f23fda  pa1-1-pa1-2-cutoff-consumption.json
9c1c7cf008ce89304393cf7a5afdfdf18b2c9ef438aaf529c04ed5cba2afbe56  pa1-12-pa1-14-lifecycle-stepping-replay.json
57228ba0790c23a9e040b860469f021e8062911b794012e80bdbf6fb2c6d09f3  pa1-3-generation.json
7af0c5d7337be445e12a3a5abf7bd8750a2ef91de9c32b503c52e2f937e0bdcc  pa1-4-traces-t1-t2-t3-t6.json
1e9df37cd65b85912302d0119600083b8385f5e3fbf704110e646a6740127d8e  pa1-5-pa1-8-commit-keepalive-neutral-bound.json
b3547690846d4ba96e19875d0b19fbb72b4cb5087e8f553bb4aa2e5439bce0a8  pa1-9-pa1-11-bounds-identity-navigation.json
4f46fa80658d2b2815547236d2c2c51afdfd1cfb23283959515d922435621ed2  summary.json
```

`summary.json` names the 13 vectors and the 5 reconciliation scenarios and records the configuration the
numbers came from: explicit test bounds (no invented production default, per D5) and the fact that the
resulting `configHash` differs from the pinned default, which is the point of an explicit override.

Retention as at revision 1, and it was true then: these digests identified artefacts that lived only in the
working tree's `artifacts/` directory. **Revision 2 changed that** under reviewer correction C4: the same
suite now writes a manifest naming the commit and every digest, CI gates it and uploads the directory beside
the bundles, and the `UDG-003` capture plan copies it into the verified bundle as `vectors/`. See §12.4 and
§12.6 for the digests that supersede the two that moved. **The independent backup destination is still
undesignated (D4 open)**: the published CI artefact and the retained bundle are the same repository's
artefacts, not an independent copy, and this record claims no preservation outside them.

## 9. Commits, and CI as at submission

| Commit | Content |
| --- | --- |
| `e1b0026` | pin the Phase 1 assignment before implementing it |
| `23f2869` | correct the Phase 1 record against P03 before writing any code |
| `58ecb18` | implement the transport-independent Phase 1 authority core (+ `@udg/config` grant, regenerated dependency register) |
| `7efa463` | pin the cutoff, admission and neutral rules |
| `1bf8740` | cover navigation refusal, identity, bounds, lifecycle, journal and cadence |
| `11cb58b` | the vector suite and the Phase 1 contract assertions (§6–§7) |
| `73d48c9` | this record, the status line, the integration link (A7) and the re-pinned checksum manifest (A6) |

**CI for the submitted head `73d48c96895305f5773d716e012c13489ea62e4a`: run `42914263581`, conclusion
`success`** — [workflow run](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/42914263581).
All 20 steps green on a GitHub-hosted `linux-x64` runner: frozen-lockfile install, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm build`, `declarations:strict`, `test:unit`, `test:boundaries`, `test:fixtures`, the UDG-001
(49), UDG-002 (31) and UDG-003 (64) task suites, `contracts:checksums`, `dependencies:verify`, evidence
capture, the required-artefact assertions, evidence verification and publication. So AC-15's local-and-CI
half is satisfied for the commands CI actually runs; the bundle half is qualified in the note below.

Retained for that run (`/workspace/udg-evidence/ci-run-42914263581/`, outside Git): the artefact directory,
both per-task bundles — `UDG-001-2026-11-10T22-26-38-965Z-73d48c96` and
`UDG-002-2026-11-10T22-27-52-156Z-73d48c96`, each verifying with `PASS evidence verify … (0 issue(s))` — the
probe results, and `runner/runner-log.txt.gz`. The Phase 0 surface is unchanged at this head: **PR-0 pass
(49 checks), PR-1 pass (43), PR-2 pass (7), PR-3 pass (10), PR-8 pass (15), PR-12 pass (6), PR-13 pass (20)**,
the declaration inventory still **27 third-party diagnostics / 0 repository diagnostics**, and
`stackCompatibility` still **`not-established`**. Nothing in a green run at this head is a compatibility claim:
Phase 1 added no transport code for a compatibility claim to attach to.

The evidence store gained a **second inventory record** rather than more runs on Phase 0's:
`inventory-v25.json` (mirror `inventory.json`, 2 114 files) adds `UDG-003-PHASE-1-2026-11-12` carrying this
submission's head, status **In Review**, the vector directory and its byte-stability, the absence of a
capture plan, Gates A/B/C **Not Run**, `stackCompatibility: not-established`, the open decisions and
`releases: none`. Chain verification over `v10 … v25` reports exactly one discontinuity — `v19 → v20`, the
disclosed `INTEGRITY-2026-11-10` incident — and every other hop matches on version, digest and file count.
Per the records-only convention adopted in the Phase 0 record §10.5b, the run produced by *this* commit is
named in the chain rather than transcribed into a further commit.

**Evidence-bundle gap, disclosed rather than papered over.** §6 item 7 asks for "the retained bundle's
verification result", and AC-15 speaks of "both bundles verified". That machinery is the capture plan
(`node tools/checks/dist/evidence.js plans`), and it lists **`UDG-001` and `UDG-002` only**: those two tasks
were granted `tools/checks/**`, UDG-003 was not — Phase 1's grants are A1–A8 and none of them touches the
evidence tooling. So this phase produces **no `UDG-003` evidence bundle**, and claiming one would be false.
What the submission does carry is: the CI run's own conclusion and runner log for the published head, the
vectors in §8 with their digests, the command table in §5, and the UDG-001/UDG-002 bundles that CI captures
and verifies on every push to `main` — verified with 0 issues at this head, which is what AC-15's "both
bundles" actually refers to. Adding a `UDG-003` capture plan is a small, well-defined change to a controlled
path; it needs an explicit grant and is listed in §11 as a decision the owner owes rather than being done here.

> **Superseded by §12.4 at revision 2.** The reviewer's correction C4 supplied that grant (`A9`), so
> `UDG-003` now has its own capture plan and bundle, labelled `phase: "phase-1"`. The paragraph above is kept
> as what was true at the first submission; it is not a current gap.

## 10. What Phase 1 did not do

- No `RegionRoom`, no `@colyseus/*` import under `apps/server/src/authority/**`, no SDK input attachment, no
  lifecycle transport wiring, no `MovementAuthorityAdapter`. Verified by import scanning of the shipped
  source (after comments and literals are stripped) and by the accepted boundary gate.
- No acknowledgement claim of any kind. **D-7 remains open** and continues to block transport acceptance;
  Phase 1 introduces no `inputDisposition`, no client-side reconciliation and no send-order claim.
  `stackCompatibility` remains **not-established**.
- **Part B is not adopted.** Exactly one continuous observation is consumed per entity per tick; there is no
  backlog consumption, no coalescing and no `take(n)` anywhere in the tree.
- No physics, no collision, no locomotion model (the stepper applies `drive × speed × dt` and nothing else),
  no navigation, no route construction, no `UDG_ROUTE_STATUS`, no client prediction.
- No multiple-input consumption, no `sessionEpoch` renewal procedure, no replica/patch stages (M, P).
- Not decided by Phase 1: AC-1 (200-tick 40 m reference trace), AC-3c (abuse population), AC-7 (an offender's
  message through a transport), AC-9 (startup/disposal), AC-10/AC-11/AC-12, AC-13 (bounds-file startup),
  AC-15 (root commands green locally **and** in CI is a *submission* criterion rather than a phase claim, so it
  is not marked passed here; §9 records both halves for the commands CI runs, with the bundle qualification
  recorded there), and the
  route-dependent cases O01, O03, O04, O05, O08, O10, O11, which are **deferred, not faked**.
- **Gates A, B and C remain Not Run.** Compiling and unit-testing an authority core is not a gate pass.
  Phases 2 and 3 remain unassigned, so UDG-003 is not eligible for Verified at any phase.

## 11. Decisions the owner still owes

1. **Review this submission.** Nothing here is accepted; §5–§8 are the reviewer's basis.
2. **Part B / the input-consumption rule** ([proposal](../../adr/proposals/UDG-003-input-consumption-rule.md))
   — still unanswered, and Phase 1 implemented the strict one-input rule as required in the meantime.
3. **D-7** — still open; it gates any transport work, not this phase.
4. **D4** — the independent evidence backup destination is still undesignated.
5. **Phases 2 and 3** — unassigned; nothing in Phase 1 should be read as pre-authorising them.
6. ~~**A `UDG-003` evidence capture plan** (§9)~~ — **answered by the review instruction**: the owner authorised
   the narrowly scoped tooling and CI change under grant `A9`, so `UDG-003` now has a capture plan, a phase
   label and a gate (§12.4). What the owner still owes here is the decision of **where** the published bytes
   are copied for independent retention, which is item 4 (`D4`) and unchanged.

## 12. Revision 2 — the three reviewer corrections, and the phase's own evidence gate

The first submission (§9) was returned **In Review** with three technical corrections and one evidence
requirement. They are restated in [the assignment's §0.2](UDG-003-phase-1.md); this section records what the
code now does, what was measured, and what was found on the way. The owner's acceptance of revision 1 was
never recorded, and none of this changes that: **Phase 1 remains In Review.**

### 12.1 C1 — lifecycle authority comes from the server alone

The defect was in replay, not in the live path. Live, a lifecycle operation could only arrive through
`join`/`leave`/`epochChange`. Replay rebuilt arrivals from the journal and asked the payload what it was:
`control = raw['control']`. A client message carrying a field named `control` was therefore journalled as a
refused structural message **and** fed back to a replay as a server command.

`ArrivalOrigin` (`'server-lifecycle' | 'client-payload'`) is now assigned where the arrival is created — the
control path or `ingest` — and travels into `observation.origin`, `observation.control` and `event.origin`.
`toReplayInputs` sets `control` from `origin` and nothing else, and `replayRun` refuses a journal whose
provenance and control disagree (`provenance-inconsistent`) before it runs a single tick, so a hand-edited
artefact cannot launder a client message into a lifecycle event either.

Measured, live and replayed (`pa1-c1-provenance.json`):

```text
live     refused=true code=INVALID_PAYLOAD origin=[client-payload] typedControl=[null]
         payloadSaid="leave" lifecycleEvents=[join] watermark 0 -> 0 connected=true
replay   refused again, same origin, state digest identical to the live run, same row count
persisted JSON round trip: state digest identical to the live run
tampered inputs claiming server provenance: refused, reason=provenance-inconsistent
```

The mutation check was run rather than assumed: restoring the old `raw['control']` projection makes the two
replay tests in `tests/unit/udg-003/provenance.test.ts` fail with the entity in `disconnected`, and they pass
again only when the correction is put back. The emitted module is checked the same way in a child process
(§7, re-run for this revision): the forged message is refused `INVALID_PAYLOAD`, journalled `client-payload`
with `control: null`, and the only lifecycle event in the journal is the join.

### 12.2 C2 — replay restores the clock the decisions were made under

The terminal-request cache expires after `TERMINAL_REQUEST_TTL_SECONDS` (30) of the injected `TimeSource`.
Whether an identical retry is answered from the cache or decided afresh is therefore a fact about the clock,
and a replay that started its own clock at zero would silently move every retry back inside the window —
answering a request the original refused, while still matching every digest it bothered to compare.

The journal now declares `timeBasis: 'recorded-clock-readings'`, records the run's clock origin in the
prologue, and stamps `atMs` on every observation, every event and every tick-chain record. `RecordedTime`
(determinism.ts) implements `TimeSource` over the recorded readings and refuses a restore that would move
time backwards; `replayRun` restores each arrival's and each boundary's reading before feeding it, and refuses
the run (`recorded-time-not-monotonic`) rather than replaying in a different time order.

Measured (`pa1-c2-time-basis.json`), with three runs whose only difference is the clock:

| Retry delay | Live decision | Its own replay |
| --- | --- | --- |
| `TTL − 1` (29 999 ms) | `answered`, `dedupe: cache`, `atMs = 30 999` | `answered`, `cache`, same `atMs`, same state digest |
| `TTL` (30 000 ms) | `refused:generation` `INVALID_GENERATION`, `dedupe: none` | same |
| `TTL + 1` (30 001 ms) | `refused:generation` `INVALID_GENERATION`, `dedupe: none` | same |

Each was replayed twice — from the rows in memory and from a JSON round trip of rows and chain — and each
replay restored its own side. A fourth run starting at `startMs = 5 000 000` confirms the prologue carries a
non-zero origin (`timeOriginMs`) and that the replay reports the same origin it was given. A tampered journal
whose last arrival is stamped `atMs = 0` is refused rather than obeyed.

**One honest residual, and how it is handled.** A field JSON cannot carry (an object, an array, a bigint) is
journalled as an `invalid` descriptor: `{ kind: 'invalid', type: 'object', render: '<invalid:object>' }`.
Reconstructing a payload from that descriptor and rendering it again described the field differently on the
second pass — the artefact said *object* the first time and *string* the second — so the replayed row's
`malformed` list was smaller than the original's. That is the exact thing correction C2 asks not to lose, so
`buildArrival`/`ingest` accept an optional recorded rendering, and replay re-attaches the one the artefact
carries. No transport handler passes that parameter, so no client can choose how its own fields are
described; a tampered artefact can misstate its own fields, which is no more than a tampered artefact can
already do to its own payload. With that in place, a message carrying `NaN`, an object and a non-numeric
string replays with `malformed: ['moveX', 'moveZ']`, the same descriptors, the same `atMs` and the same
`INVALID_PAYLOAD` refusal (§4's defect list gains the entry below as 12-1).

### 12.3 C3 — the core retains a working set, not its history

`JournalSink` is now a **required** build option and the core keeps no journal of its own: rows go to the sink
as they are decided, chain records the same way, and the only history left is the chain tip. The previous
public `journalRows` and `chain` getters are gone — this is a breaking change to the test surface, and the
suites that used them were rewritten to read the journal they were handed rather than to keep a second copy
inside the system under test. Released entities now report `reconciliation(id).known === false` and are refused
rather than silently processed if a message arrives for them afterwards.

Departed bookkeeping is released once the tick's rows have reached the sink, with the entity's alias retained
under a bounded 64-record window (the alias counter itself stays monotonic, so no alias is ever reused) and its
observed/cache totals folded into the released totals. `retention()` reports the working set directly.

Measured across 60 join/leave cycles with a resident entity working throughout (`pa1-c3-retention.json`):

```text
arrivals offered 301      observed counted 301      released entities 60
retained: entities 1, queued 0, controlQueue 0, tickRowBuffer 0, aliasRecords 61, reachableArrivals 0
sampled every 10 cycles: streamedRows 216 -> 426 -> 636 -> 846 -> 1056 -> 1266 (monotone)
                         chain 21 -> 41 -> 61 -> 81 -> 101 -> 121
                         reachableArrivals 0 at every sample
replay of the churned run: same row count, same chain tip, same released-entity count, same resident set
```

`aliasRecords` grows to the 64 bound and stops; the cache test floods 400 distinct requests and the retained
record count never leaves 128. A separate test shows a departed entity cannot be resurrected by a later
message, and that the refusal is still journalled with a stable alias.

### 12.4 C4 — the phase's evidence is gated by the tool

`node tools/checks/dist/evidence.js plans` now lists `UDG-001`, `UDG-002` **and** `UDG-003`, so the existing
CI capture/verify/publish loop exercises this phase without a second source of truth naming it. The bundle's
`report.json` carries `phase: "phase-1"` and a `phaseNote` that says in as many words that it is not Phase 2
or Phase 3, not a stack-compatibility claim and not a Gate A/B/C pass; `verify` refuses a bundle whose plan
declares a phase the report does not (§10's non-claims are now inside the artefact).

The gate itself recomputes everything from bytes and takes nothing from the manifest on trust. Observed
negative measurements, each against the directory the suite had just written:

| Condition | Exit | Stderr |
| --- | --- | --- |
| complete, clean | 0 | `PASS phase-1 vectors: 11 artefact(s) listed, hashed and attributable` |
| `pa1-c3-retention.json` deleted | 1 | `VECTORS-FILE-MISSING: … is listed but absent` |
| `cycles` edited in place | 1 | `VECTORS-FILE-BYTES: manifest says 788 bytes, found 789` and `VECTORS-FILE-HASH` |
| `--expect-phase phase-2` | 1 | `VECTORS-PHASE-MISMATCH` |
| manifest absent | 1 | `VECTORS-MANIFEST-MISSING` |
| produced from a dirty tree, gate without `--allow-dirty` | 1 | `VECTORS-TREE-DIRTY: … not attributable to a commit` |

The manifest names the 40-character commit it was produced from; `verify` cross-checks it against the
bundle's `implementationSha`, so vectors from one commit cannot be filed against another. CI runs the vector
suite with `UDG_VECTORS_OUT` pointed at `artifacts/udg-003-phase-1`, gates it, and uploads the directory
beside the bundles; the capture plan writes the same artefacts into the bundle under `vectors/` and runs the
gate as one of its own commands, so a missing artefact fails the capture as well as the standalone step.

Two lists of the required vectors now exist on purpose — `PHASE_1_VECTOR_FILES` in the gate and
`PHASE_1_VECTOR_NAMES` in the suite — because the gate must own the requirement and the suite must own the
production. `tests/contracts/UDG-003.test.ts` refuses them drifting apart, and exercises the built gate
against a scratch directory it corrupts on purpose, asserting the exit codes rather than the prose.

### 12.5 Defects this revision found in the corrections themselves

| # | Found by | Defect | Correction |
| --- | --- | --- | --- |
| 12-1 | `time-basis.test.ts` | Replaying a malformed message re-derived its rendering from a reconstructed payload, so an object field came back a string and `malformed` shrank from two fields to one | replay re-attaches the recorded rendering through `ingest`; the parameter is unreachable from a transport handler |
| 12-2 | `retention.test.ts` | The new test asserted that an accepted message journalled a row at ingest; accepted messages are journalled when decided | the assertion now states both halves truly: a gate refusal streams immediately, an accepted message streams at its tick |
| 12-3 | the contract suite's child process | The emitted-run script drove ticks only through the scheduler callback, and the core drives its own tick counter — no tick ever ran (`stepCalls: 0`), so every assertion about it was vacuous | the script calls `run.step()` and moves the clock, and now asserts `ticksRan = 4` explicitly |
| 12-4 | the same script | It joined at epoch 1 while the harness passes `sessionEpoch: 1` to the build; every message was refused `EPOCH_MISMATCH` and the "evidence" recorded an empty run | the build option is passed, and the assertions (`forged`, `retained`, `replayTime`) now fail loudly if the run is ever empty again |
| 12-5 | the same script | It read `run.journalRows`, which no longer exists | the script creates its own collector, and `exposesJournal: false` is asserted — the absence of a retained journal became a positive check |

12-3 and 12-4 matter more than their size: an evidence script that silently runs zero ticks passes every
"counted" assertion in the file. Both are now asserted rather than assumed.

### 12.6 Vector digests for revision 2, and why two of §8's moved

Re-run twice from the same tree; the digest lists are identical, so the artefacts remain byte-stable.

```text
1b981db7194e3cf3910bf4f402445829944d977b67d27bf584177667ca3d0a06  disposition-reconciliation.json
6794cb4e48cd7480de85e74fbad16743a49702150277ef719e60715c54f23fda  pa1-1-pa1-2-cutoff-consumption.json
d48239dbaba3a580a7651b0d4a8f158ff1c7a0309e6b94114f007849f4cc7314  pa1-12-pa1-14-lifecycle-stepping-replay.json
57228ba0790c23a9e040b860469f021e8062911b794012e80bdbf6fb2c6d09f3  pa1-3-generation.json
7af0c5d7337be445e12a3a5abf7bd8750a2ef91de9c32b503c52e2f937e0bdcc  pa1-4-traces-t1-t2-t3-t6.json
1e9df37cd65b85912302d0119600083b8385f5e3fbf704110e646a6740127d8e  pa1-5-pa1-8-commit-keepalive-neutral-bound.json
b3547690846d4ba96e19875d0b19fbb72b4cb5087e8f553bb4aa2e5439bce0a8  pa1-9-pa1-11-bounds-identity-navigation.json
a2b2f58aedba8fb23cfbba3129fe671c797f421321ecde502013f6810b20b626  pa1-c1-provenance.json
ca115d09ec27242d97aa30412350d02283ce35b5fa51d58fb13e1d77a1e6a464  pa1-c2-time-basis.json
67cfccd058f97b4b635fd83394a23030e67b23cce37ffddfef574c60f3f246a0  pa1-c3-retention.json
8abd16afc87fa28c5f36aa1b1e3e9573397efb42f9bcf1717ab09b26502a6703  summary.json
```

The eleven artefacts above are the ones the gate requires, and their digests are identical on the hosted
runner and in a local re-run of the same commit (§12.11). `vectors-manifest.json` is deliberately **not**
digest-pinned here: it names the commit that produced it, so its own bytes — and therefore its digest — move
with every submission. At the submission head `358f9ef5…` it is
`a60604fd293774e5621b2a18c8fcc755571b31bda4bc294975a4e66ef574c78a`, and the retained bundle's
`checksums.sha256` covers that byte-for-byte.

§8 quoted eight digests from revision 1 and is left as written there, because it is the record of that submission. Two of
them no longer reproduce at this revision, and the reason is the corrections themselves rather than any
silent restatement: `disposition-reconciliation.json` and
`pa1-12-pa1-14-lifecycle-stepping-replay.json` count and describe journal rows, and journal rows now carry
`origin`, `control` and `atMs`. The other six are byte-identical. The manifest lists all eleven artefacts
plus itself; its own digest cannot appear inside itself, which is why the manifest's digest is quoted here
and the bundle's `checksums.sha256` covers it.

### 12.7 Commands run for revision 2

| Command | Exit | Result actually observed |
| --- | --- | --- |
| `pnpm typecheck` | 0 | all workspace projects, including the new suites |
| `pnpm lint` | 0 | eslint clean; `boundary check OK: 61 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test` | 0 | `Test Files 23 passed (23)`, `Tests 493 passed (493)` |
| `npx vitest run tests/unit/udg-003` | 0 | `Test Files 14 passed (14)`, `Tests 107 passed (107)` |
| `npx vitest run tests/contracts/UDG-003.test.ts` | 0 | `Tests 69 passed (69)` |
| `pnpm --filter @udg/checks build` | 0 | clean |
| `node tools/checks/dist/evidence.js plans` | 0 | `UDG-001`, `UDG-002`, `UDG-003` |
| `node tools/checks/dist/evidence.js vectors --dir artifacts/udg-003-phase-1 --allow-dirty` | 0 | `PASS phase-1 vectors: 11 artefact(s) …` |
| the same gate, six corrupted conditions | 1 | the table in §12.4 |

The full §5 table from revision 1 was re-run for the commands whose behaviour could be affected by these
changes; `pnpm test` rose from 470 to 493 tests (five provenance, six time-basis, six retention, one vector
group) with the UDG-001 (49) and UDG-002 (31) contract suites unchanged in intent.

### 12.8 What revision 2 still does not claim

* **Acceptance.** Phase 1 is **In Review**. Nothing here records, implies or requests reviewer acceptance.
* **The one-input rule.** Stage Q still consumes at most one continuous observation per entity per tick. No
  coalescing, draining or `take(n)` was introduced, and Part B remains unadopted.
* **D-7.** Still open, still blocking transport acceptance; nothing in this revision speaks about SDK
  acknowledgement, and no `inputDisposition` port appears.
* **Phases 2–3.** Unassigned. No `RegionRoom`, no transport, no physics, no navigation, no client prediction,
  no `MovementAuthorityAdapter`.
* **Compatibility and gates.** `stackCompatibility` remains **not-established**; Gates A, B and C remain
  **Not Run**; the Phase 0 probe verdicts and the 27-diagnostic declaration inventory are unchanged.
* **Storage.** The published bytes go to the existing evidence store and the existing CI artefact upload.
  `D4` — an independent backup destination — is still undesignated, and no new storage, release, tag or
  archive was created.
* **History.** Prior bundles, prior inventories and the disclosed `v19 → v20` discontinuity are untouched.

### 12.9 Commits, CI and retained evidence for revision 2

| Commit | Content |
| --- | --- |
| `97af708` | gate the UDG-003 phase evidence in the tool (grant `A9`) |
| `6f3cf6a` | the three core corrections, their suites, the vector manifest and the CI step (grants `A10`–`A12`) |
| `09077de` | this record, §0.2 of the assignment, the review instruction in `adoption.md`, the status line and the re-pinned checksum manifest (`A4`–`A7`) |
| `18d1fe7` | the Phase 0 evidence-ordering and scratch-path fixes the new capture plan exposed (12-6, 12-7) |
| `4e5fab4` | measure the thresholds the bundle states (12-8) |
| `04ea3a6`, `f66cf3d` | record the prerequisite commits the bundle must name, in the form the gate reads (12-9) |
| *(this commit)* | §12.10, recording what the capture plan surfaced |

Per the records-only convention adopted in the Phase 0 record §10.5b and used for revision 1, the CI run
produced *by a records commit* is named in the evidence inventory chain rather than transcribed into a
further repository commit. The CI run and retained evidence for **this** submission head are appended below
by the following records-only commit.

### 12.10 What giving the phase a capture plan surfaced

Rehearsed locally on a clean tree at `f66cf3de10246c3d1d507ebee2606e6b2943746f`:
`artifacts/UDG-003-2026-11-11T00-15-53-120Z-f66cf3de` captures `PASS` and verifies with
`PASS evidence verify … (0 issue(s))` — `phase: "phase-1"`, 493 tests, 45 hash-covered files including
`measurements/UDG-003.json` and 12 files under `vectors/`, a manifest whose `implementationSha` is the
commit the run executed, and three prerequisite commits. Producing that bundle turned up four things that
were invisible while no run was ever owned by this task:

| # | Surfaced by | What was actually wrong | What was done |
| --- | --- | --- | --- |
| 12-6 | the `test` command of the new plan | `pnpm test` **failed**: the Phase 0 evidence assertion asks whether an owned run received `probe-results.json`, but those artefacts were written in `afterAll`, which runs after every test in the file. Under UDG-001 and UDG-002 captures this task never owned a run, so the assertion had never been evaluated in the branch that mattered | the artefacts are written as soon as the probes produce them and again at the end; a probe's measurement is unchanged |
| 12-7 | the bundle's `vectors/` listing | the emitted-module child process wrote `emitted-run.mjs` into the vector artefact directory, so a scratch script would have been published as evidence | it writes to `artifacts/.local/udg-003-phase-1/` now |
| 12-8 | `evidence.js verify` | every threshold the plan states must have a measured value under it, and the plan stated none it could measure | the vector run now measures the stage order of an executed tick, the one continuous observation consumed out of a three-frame burst, the navigation refusal read from the stage that refuses it, both sides of the cache window, the retained working set across churn, replay equivalence including a digest-blanked replay, and each artefact's digest recomputed from the bytes the manifest names |
| 12-9 | `evidence.js verify` | a report must name its prerequisite commits, which it reads from `docs/contracts/assignments/<taskId>.md` — a file a *phased* task has no reason to create | prerequisite discovery now also reads `assignments/<taskId>-phase-*.md`, and the Phase 1 record states its three |
| 12-10 | **CI, not local**: run `42930387070` on `d87382e5` failed at "Verify the captured evidence bundles" with four `EVIDENCE-SECRET` issues | capture sanitised the files it wrote itself and the junit report, but a suite that is told where to put its artefacts writes them unmediated — and the Phase 0 probe records quote the command line they ran. Locally those paths are `/workspace/…`, which the secret patterns do not flag; on a GitHub-hosted runner the same field is `/home/runner/work/…`, which it does | capture now sanitises every file the report will hash, through an exported `sanitiseBundleDirectory` the contract suite points at a directory holding the runner's shape and asserts the rewrite. The re-captured local bundle contains no `/home/` or `/workspace/` path at all, and its probe command reads `REPO_ROOT/node_modules/…` |

12-10 is the one that matters most as a habit rather than a bug: the local bundle had verified cleanly, with
zero issues, against a machine whose paths happened not to trip the scan. A gate that only passes on the host
that wrote it is not yet shown to be a gate.

### 12.11 CI, retained bytes and what the hosted runner added

| Run | Head | Conclusion | What it decided |
| --- | --- | --- | --- |
| `42930387070` | `d87382e50c982e84a2107f27dfc26adb38541043` | **failure** | four `EVIDENCE-SECRET` issues in the UDG-003 bundle — defect 12-10, found only on a hosted runner |
| `42932711426` | `3feb0758745180effc7ee9605f02208173d75e3f` | **failure** | the new sanitisation test asserted one host's alias (defect 12-11 below); 1 failed, 493 passed |
| `42934515683` | `358f9ef5040d9daaaa3b20c23790ec855b3bf4bb` | **success** | the submission head. 23 steps green, including the new "Record and gate the UDG-003 Phase 1 vectors" step and the capture, assertion, verification and publication of **three** bundles |

Retained in the evidence store, outside Git (`/workspace/udg-evidence/`), with a `NOTICE.txt` on each failed
run naming the step and the cause rather than leaving the failure to inference:

```text
ci-run-42934515683/   UDG-001-…-358f9ef5  UDG-002-…-358f9ef5  UDG-003-…-358f9ef5
                      UDG-00{1,2,3}-ci-summary.json   udg-003-phase-1/   probes/   runner/runner-log.txt.gz
ci-run-42932711426/   UDG-001-…-3feb0758 (status FAIL, refused by verification)   udg-003-phase-1/   probes/   runner/ NOTICE.txt
ci-run-42930387070/   UDG-001/002/003-…-d87382e5   udg-003-phase-1/   probes/   runner/ NOTICE.txt
```

Every bundle from the successful run verifies from the retained bytes, not from a local rebuild:

```text
PASS evidence verify …/ci-run-42934515683/UDG-001-2026-11-11T00-53-45-215Z-358f9ef5 (0 issue(s))
PASS evidence verify …/ci-run-42934515683/UDG-002-2026-11-11T00-55-24-556Z-358f9ef5 (0 issue(s))
PASS evidence verify …/ci-run-42934515683/UDG-003-2026-11-11T00-57-28-058Z-358f9ef5 (0 issue(s))
```

The Phase 1 bundle carries `phase: "phase-1"`, `status: PASS`, `implementationSha:
358f9ef5040d9daaaa3b20c23790ec855b3bf4bb`, `workingTreeDirty: false`, 494 tests, and its `phaseNote` states
that it is not Phase 2 or Phase 3, not a third-party stack compatibility claim and not a Gate A/B/C pass. The
summary published beside it repeats the label and carries `verification.ok: true`.

| # | Found by | Defect | Correction |
| --- | --- | --- | --- |
| 12-11 | CI `42932711426` | the sanitisation test asserted the rewritten text contained `<HOME>`. On a hosted runner the checkout path *is* under the home directory, so longest-path-first aliasing rewrites it to `REPO_ROOT` and no `<HOME>` appears. The assertion measured which machine ran the suite | assert the property instead: no home-shaped path survives, the secret pattern matches nothing, an alias was applied — and build the synthetic home path from `homedir()` so both hosts treat it identically |

Two cross-checks close correction C4:

* **the published bytes are the gated bytes.** `evidence.js vectors --dir
  /workspace/udg-evidence/ci-run-42934515683/udg-003-phase-1` exits 0 against the retained artefact, and all
  eleven vector digests plus `summary.json` are identical to a fresh local run of `358f9ef5…` — so retention
  does not depend on trusting the upload.
* **the Phase 0 surface is unchanged.** PR-0 pass (49), PR-1 pass (43), PR-2 pass (7), PR-3 pass (10), PR-8
  pass (15), PR-12 pass (6), PR-13 pass (20); the declaration inventory still reports 27 third-party
  diagnostics and 0 repository diagnostics; `stackCompatibility` is still `not-established`; Gates A/B/C are
  still **Not Run**.

| Commit after the submission head | Content |
| --- | --- |
| *(records-only commit)* | this section, and the two failed runs named with their causes |

Nothing in this section records reviewer acceptance. **UDG-003 Phase 1 remains In Review**, Phases 2–3 remain
unassigned, D-7 and D4 remain open, Part B remains unadopted, and the one-input rule is unchanged. The fix is measured by the condition that failed, not by the
same green local run repeated.

On the prerequisites, one note worth keeping: the first draft of those lines was written from recall, and
`git rev-parse` showed two of the three 40-character values were wrong. The record quotes only shas resolved
from this repository's history and confirmed as ancestors of the head they are quoted against — which is the
same rule the rest of the evidence follows: nothing enters a record because it sounds right.

## 13. Revision 3 — one recorded tick time, and a cutoff that bounds lifecycle cleanup

The owner accepted revision 2's four items and returned two focused corrections, recorded as PA1-C6 and
PA1-C7 in assignment §0.3. Both changed behaviour; neither changed the TTL, the one-input rule, or the phase
boundary.

### 13.1 PA1-C6 — the tick takes one reading, and nothing else gets to disagree

Before this revision a single `step()` could consult the injected clock up to five times: for the tick's
recorded value, for the screening context, inside `IdentityCache.lookup`, inside `IdentityCache.compact`, and
again when stamping a cache write. Any two of those could fall on opposite sides of the 30-second boundary, and
the journal recorded only the first. A replay restores that first reading, so it would reproduce a decision the
live run had not made — which is precisely what a reviewer asked to be made impossible rather than unlikely.

| Reader | Revision 2 | Revision 3 |
| --- | --- | --- |
| tick boundary | `tickAtMs = time.nowMs()` | unchanged, and it is now the tick's only reading |
| screening context | `#contextFor(tick)` took a **fresh** reading | `#contextFor(tick, tickAtMs)` |
| cache lookup | `IdentityCache` held a `TimeSource` and read it inside `lookup` | `lookup(entityId, epoch, requestId, nowMs)`; the class holds **no** clock |
| cache compaction | `compact()` read the clock | `compact(nowMs)` |
| cache write | `storedAtMs: this.#time.nowMs()` | `storedAtMs: atMs`, threaded from the same value |
| `askStagesQSA` seam | took its own reading | takes the instant as an argument, so a "pure" question cannot disagree with the tick it describes |

The TTL is untouched: `expiresAtMs = storedAtMs + TERMINAL_REQUEST_TTL_SECONDS * 1000`, still 30 s, still
measured from the record's own write.

`tests/unit/udg-003/tick-time.test.ts` (4 tests) supplies the clock the correction asks for — one that advances
on every read — and then asserts the boundary genuinely falls inside a tick:

```text
recorded tick reading      storedAt + 25 000   (5 000 ms inside the window)
next reading, same tick    storedAt + 35 000   (5 000 ms past it)
disposition                answered / dedupe = cache      watermark unmoved
lookup at recorded         found              lookup at next reading: expired
write case                 storedAtMs === recorded tick time, expiresAtMs === recorded + 30 000
replay, persisted rows     inside → answered/cache, outside → refused:generation, chain tip equal
```

Mutation checks, each reverted after measurement:

| Mutation | Result |
| --- | --- |
| `#contextFor` takes a fresh reading (revision-2 behaviour) | 3 of the 4 new tests fail |
| `storedAtMs: this.#time.nowMs()` for cache writes | the write-side test fails |

### 13.2 PA1-C7 — a departure disposes only of what the cutoff covers

`#refuseEpochMismatched` and the departure path's `continuousQueue.clear()` / `discreteQueue.clear()` are gone.
One sweep replaces them:

```ts
#disposeEligible(entity, cutoff, cause /* 'departure' | 'epoch' */, rows, ceiling)
// removes exactly the arrivals with  arrival.ordinal <= cutoff.ordinal && arrival.ordinal <= ceiling
```

`ceiling` is the cutoff for an ordinary pass, or `departureOrdinal - 1` when a retirement settles after a
rejoin — so an arrival belonging to the *live* association is never dropped as the ended one's backlog. Each
removal writes one observation row and increments one counter, whatever the cause.

A departure that still holds residue keeps the entity's bookkeeping alive in `#retiring` (bounded by the entity
count, reported by `retention().retiring`) and releases it at `#settleRetiring` on the next tick, before that
tick reads its own controls. Without that, the residue would have no entity left to be journalled from.

`tests/unit/udg-003/cutoff-lifecycle.test.ts` (5 tests) injects an arrival **while lifecycle work is in
progress** — the injection runs on the tick's own clock reading, immediately after the cutoff is frozen — and
measures:

| Case | Live behaviour |
| --- | --- |
| leave | eligible arrival dropped at the cutoff tick; injected ordinal (`> cutoff`) has **no** row that tick; `retiring 1`, `queuedArrivals 1`, `reconciliation.stillQueued 1`, `balanced true`; next tick: exactly one `dropped:lifecycle` row, `retiring 0`, `queuedArrivals 0`, `releasedEntities 1`, alias unchanged, `counters['dropped:lifecycle'] === 2` |
| expiry | same shape; the entity is `departed` and not stepped, residue accounted once at the next tick |
| epoch change | the old-epoch frame in the frozen set is refused `refused:epoch`; the post-cutoff old-epoch frame is journalled `queued` (preserved, unrefused) and refused exactly once on the next tick; `watermark` never moves |
| rejoin in the same tick | the ended association's backlog is dropped, the post-cutoff arrival stays, and at the next tick it is **consumed** by the live association (`watermark 2`) with only one `dropped:lifecycle` in the run |

Mutation check: restoring the unbounded `clear()` fails 3 of the 5 tests; making the epoch sweep ignore the
cutoff fails the epoch test.

### 13.3 The limit this revision found, and did not paper over

An arrival injected *inside* a tick is ordered **after** the departure control by its ordinal, yet it entered
the queue before stage L ran. The journal records ordinals and cutoffs — the only ordering P03 recognises — so
a replay re-derives queue membership from the ordinal, finds the association already released, and refuses the
arrival at admission instead of holding it as residue. Live and replay therefore disagree, and the test asserts
the disagreement rather than hiding it:

```text
shared prefix (join, eligible drop, leave event, both state/meta rows)   identical
live residue for the injected ordinal        ['dropped:lifecycle']
replay residue for the same ordinal           ['refused:epoch']            one disposition either way
chain tips                                     deliberately unequal
```

`pa1-c7-cutoff-lifecycle.json` carries the same fact in machine-readable form (`replay.tipEqual: false` with
the reason), so the limitation travels with the evidence.

### 13.4 Wider variant considered and not taken

Retiring **every** departed entity for one tick, residue or not, makes the injected case replay-identical: the
release no longer depends on queue contents that only an intra-tick arrival could have changed. It was
implemented and measured, and it rewrote twelve accepted assertions across the lifecycle and retention suites
(release timing, `known: false` windows, churn accounting). That is a second behavioural change the reviewer
did not ask for, and it would quietly redefine revision 2's accepted release semantics, so it is recorded here
for the owner's decision instead of being taken:

| Option | Replay of an intra-tick arrival | Cost |
| --- | --- | --- |
| as submitted | not exact; divergence asserted and vector-recorded | none beyond the disclosed gap |
| retire every departure for one tick | exact | release timing shifts for all departures; 12 accepted assertions rewritten; one extra tick of bookkeeping per departure |

The narrower reading of the correction is that a host must not ingest while a tick is running — a transport
obligation for Phase 2 — and the cutoff bound itself is now unconditional either way.

### 13.5 Defects this revision found

| # | Found by | Defect | Correction |
| --- | --- | --- | --- |
| 13-1 | the new tick-time suite | `#contextFor` took a second clock reading per tick, so screening and the journal could disagree about the TTL | the reading is passed in |
| 13-2 | tracing the cache question | `IdentityCache.lookup` and `compact` read a clock the class owned — an unrecorded instant inside a decision | the class holds no clock; both take `nowMs` |
| 13-3 | the write-side test | cache writes were stamped from a third reading | `#applyPlan` receives the tick's value |
| 13-4 | `accepts no old-epoch frame at all (AC-5)` | the new `ceiling` was first written as a strict `<`, which silently exempted the last queued arrival (`ordinal === cutoff.ordinal`) from every sweep | the ceiling is inclusive; the retirement marker is passed as `departureOrdinal - 1` |
| 13-5 | review of the seam | `askStagesQSA` took its own reading, so a "pure" question about a tick could be answered at a different instant | the instant is a required argument |
| 13-6 | the new suites themselves | the per-tick time was read from `TickRow.atMs`, which does not exist (the per-tick reading lives on the hashed chain record), and literal arrival stamps written by the test were ahead of the virtual clock, so replay correctly refused them as non-monotonic | read the chain record; stamp injected and deferred arrivals from `harness.time.nowMs()` |
| 13-7 | the full suite | "retire every departure" was implemented before its blast radius was measured | reverted; recorded as §13.4 for owner decision |

### 13.6 Commands and artefacts for revision 3

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 — `boundary check OK: 61 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm test` | exit 0 — `Test Files 25 passed (25)`, `Tests 504 passed (504)` |
| `npx vitest run tests/unit/udg-003` | 16 files, 118 tests |
| `npx vitest run tests/contracts/UDG-003.test.ts` | 70 tests |
| UDG-001 / UDG-002 contract suites | 49 and 31, unmodified in intent, both green after the checksum re-pin |
| `pnpm build`, `pnpm dependencies:verify`, `pnpm test:boundaries`, `pnpm test:fixtures`, `pnpm run declarations:strict` | exit 0 each |
| `node tools/checks/dist/evidence.js vectors --dir artifacts/udg-003-phase-1 --allow-dirty` | `PASS phase-1 vectors: 13 artefact(s) listed, hashed and attributable` |
| `pnpm contracts:checksums` | in sync (63 files) after re-pinning `UDG-003.md` and `adoption.md` |

Two vectors are new and eleven are unchanged, which is the statement worth having: the corrections did not
perturb a single earlier vector. Only `summary.json` moved, because it counts artefacts.

```text
1b981db7194e3cf3910bf4f402445829944d977b67d27bf584177667ca3d0a06  disposition-reconciliation.json
6794cb4e48cd7480de85e74fbad16743a49702150277ef719e60715c54f23fda  pa1-1-pa1-2-cutoff-consumption.json
d48239dbaba3a580a7651b0d4a8f158ff1c7a0309e6b94114f007849f4cc7314  pa1-12-pa1-14-lifecycle-stepping-replay.json
57228ba0790c23a9e040b860469f021e8062911b794012e80bdbf6fb2c6d09f3  pa1-3-generation.json
7af0c5d7337be445e12a3a5abf7bd8750a2ef91de9c32b503c52e2f937e0bdcc  pa1-4-traces-t1-t2-t3-t6.json
1e9df37cd65b85912302d0119600083b8385f5e3fbf704110e646a6740127d8e  pa1-5-pa1-8-commit-keepalive-neutral-bound.json
b3547690846d4ba96e19875d0b19fbb72b4cb5087e8f553bb4aa2e5439bce0a8  pa1-9-pa1-11-bounds-identity-navigation.json
a2b2f58aedba8fb23cfbba3129fe671c797f421321ecde502013f6810b20b626  pa1-c1-provenance.json
ca115d09ec27242d97aa30412350d02283ce35b5fa51d58fb13e1d77a1e6a464  pa1-c2-time-basis.json
67cfccd058f97b4b635fd83394a23030e67b23cce37ffddfef574c60f3f246a0  pa1-c3-retention.json
76921771a31dec0ecd9ff260b427418f6b1b67d09427fceb5b17767ad1753c7d  pa1-c6-tick-time.json                                   (new)
c1708877b2d4eddf91aa00b2796d6d07a94952ea6affc41a3cdc2070c61f1f29  pa1-c7-cutoff-lifecycle.json                             (new)
24008e949a8a94a194bbe58481133ae257001b5f0acd1366f237f5add63ff50b  summary.json                                             (moved: 13 artefacts)
```

Two independent runs of `tests/unit/udg-003/vectors.test.ts` produced identical digest lists, so the artefacts
stay byte-stable across runs as they were for revision 2.

### 13.7 What revision 3 still does not claim

Nothing here records reviewer acceptance. **UDG-003 Phase 1 remains In Review**, Phases 2–3 remain unassigned,
D-7 remains open and continues to block transport acceptance, Part B remains unadopted, D4 remains
undesignated, Gates A/B/C remain **Not Run**, and `stackCompatibility` remains `not-established`. Phase 1 adds
no transport, no `RegionRoom`, no SDK input and no acknowledgement claim, and a green Phase 1 CI run is not
evidence that UDG-003 passed.

### 13.8 The thresholds the capture plan now states, measured

The plan's threshold entries for the two corrections are answered by `measurements/UDG-003.json`, copied into
the bundle and covered by its checksums:

```json
"tickTime":        { "ttlMs": 30000, "oneReadingPerTick": true, "recordedInsideWindow": true,
                    "nextReadingPastWindow": true, "cacheAnswerFollowsRecordedTime": true,
                    "replayReproducedBothSides": true },
"cutoffLifecycle": { "injectedAfterCutoff": true, "residueHeldForNextTick": true,
                    "residueAccountedOnce": true, "epochResidueRefusedOnce": true,
                    "rejoinResidueConsumed": true, "noDoubleCount": true,
                    "intraTickArrivalReplayable": false }
```

That last `false` is the §13.3 limit, published as a measured value inside a bundle whose overall status is
`PASS`. It is not a gate failure and it is not a claim that Phase 1 passed: it is the phase saying, in the
artefact itself, which property it does not have. `vectors` reports `listed 13, required 13,
everyRequiredPresent true` and `digestsMatchBytes true`.

A clean-tree local run at `d2f0057b` (before the records-only commit that names it):

```text
PASS  artifacts/UDG-003-2026-11-11T09-08-36-169Z-d2f0057b
PASS evidence verify artifacts/UDG-003-2026-11-11T09-08-36-169Z-d2f0057b (0 issue(s))
phase phase-1  status PASS  implementationSha d2f0057be1d959c5dc12c3eef6dbf35dd96ae4fa  workingTreeDirty false
48 hash-covered files, of which 14 are under vectors/ (13 artefacts + manifest)
no residual /workspace/ or /home/ path anywhere in the bundle
```

CI for the submitted head is named in the evidence inventory chain rather than transcribed into a further
record, under the convention adopted in §10.5b.


## 14. Revision 4 — the mid-tick arrival is admitted at the boundary it can be decided at (PA1-C8)

Revision 3 (`9598bd7737e5b2971d90063ed68d794e43fb90a7`, CI `42992946900`) was accepted as addressing PA1-C6 and
PA1-C7 and returned **In Review** because of the mismatch §13.3 disclosed. The owner asked for that mismatch to
be closed rather than carried: hold arrivals received during a running tick in a **bounded deferred intake**,
decide admission at the next tick boundary with the same association state and the same order in live execution
and in replay, preserve arrival order, account for overflow explicitly, stay inside the Phase 1 core, use the
divergent case as the regression for leave / expiry / epoch change / leave-rejoin, require the equivalence in
the Phase 1 evidence check, and preserve the bundle that documents the mismatch.

### 14.1 What the core does now

* `step()` is now two methods. `step()` freezes the cutoff, raises `#tickRunning`, drains the intake, takes
  `tickAtMs` and calls `#tickBody(cutoff, tickAtMs)` inside a `try`/`finally` that always clears the flag. The
  ordering is the whole correction and it is deliberate in both directions:
  * the flag is raised **before** the tick's clock reading, so an arrival that reaches the core on that reading
    — or from a journal sink, or from a host callback — waits for the boundary instead of being admitted into
    the tick that is already past its cutoff;
  * the drain runs **before** that reading, so nothing the boundary admitted can be mistaken for an arrival the
    boundary should have deferred. The drain uses the internal admission path, so the flag cannot postpone the
    arrivals the boundary exists to admit.
* `#enqueue` routes by `#tickRunning`: `#admit` (reserve an ordinal, describe the message, admit) between
  ticks, `#deferIntake` during one. `#admitBuilt` is the shared half — classify, gate, enqueue — so a deferred
  arrival and a between-ticks arrival are the same question asked the same way. `#drainIntake` calls
  `#admitBuilt` on each held arrival in receipt order; the ordinal was reserved on receipt, so it is not
  reserved twice and the row names the ordinal the caller was told.
* The intake is one array in receipt order, bounded at `CAPACITIES.deferredIntake` = 64. A full intake answers
  `RATE_LIMITED` / `refused:overflow` with `overflowCause: 'deferred-intake'`, counts the rejection in
  `stats().overflowCauses` and `retention().deferredIntakeRejections`, and writes **no** journal row and no
  disposition counter. That asymmetry is not an accounting hole: a replay offers arrivals between ticks, where
  there is no intake to overflow, so a journalled intake refusal would be a decision one run could reach and
  the other could not — the exact shape of the defect being fixed. The bound itself is a core bound, not
  configuration: it changes no gameplay decision, so it does not move `configHash`.
* Because ordinals are reserved on receipt, every drained arrival satisfies `ordinal <= cutoff.ordinal` at the
  boundary that admits it. No queue can hold work outside the cutoff of the tick that holds it, which is now
  asserted rather than assumed.

### 14.2 What revision 4 removed

`#retiring`, `#settleRetiring` and the `ceiling` argument PA1-C7 added are gone, and `retention()` reports
`deferredIntake` / `deferredIntakeRejections` in place of `retiring`. The retirement existed only to hold a
departed entity alive while post-cutoff residue sat in its queue; with the intake, that residue cannot exist.
`#disposeEligible` stays, cutoff bound and all: it is still what disposes an eligible backlog when a departure
or an epoch change runs inside the frozen set, and it remains the enforcement point — were admission ever to
move back inside a tick, the sweep would refuse to reach outside the frozen set and the invariant assertion in
`deferred-intake.test.ts` would fail rather than quietly drop rows.

### 14.3 Defects this revision found, in revision 4's own code

| # | Defect | How it was proved |
|---|---|---|
| 14-1 | `#drainIntake` called `#admit`, which reserves a **second** ordinal. The admitted arrival got a new ordinal, the row named that one instead of the ordinal the caller had been told, and the queue-order assertions went blank because nothing matched. | Splitting `#admit` into reserve-and-build plus `#admitBuilt` fixed it; mutating `#admitBuilt` back fails 8 of 8 tests in the new suite. |
| 14-2 | The drain ran after the tick's clock reading. The injection fires on that reading, so the arrival was admitted in the very tick it arrived in — the deferral existed and did nothing. | Moving the drain above the reading. With the original order the "no disposition names it inside the tick" assertion fails. |
| 14-3 | The running flag was raised after the drain, so the read/drain/flag order had to be settled as one decision rather than three edits. Flag → drain → read → body is the only ordering that satisfies both PA1-C8 (defer mid-tick) and PA1-C6 (one reading per tick). | Both properties are asserted in the same suite; either ordering breaks one of them. |
| 14-4 | An intake-full rejection was counted only in a core-local counter, so the overflow-by-cause table (AC-3e) hid a refusal the caller had been told about. | `#noteOverflow('deferred-intake')` now names it. The suite asserts `overflowCauses['deferred-intake'] === 3` alongside zero journalled rows. |
| 14-5 | `retention()` still reported `retiring`, and `reachableArrivals` omitted the intake, so the report understated what the core holds between a tick and its boundary. | Replaced and added; the churn assertions in `retention.test.ts` still hold because the intake is empty between ticks. |
| 14-6 | **A `join` in the same tick as a `leave` did not cancel the release that `leave` asked for**, so end-of-tick release deleted a running entity together with its queues, counters and canonical state. Revision 3 masked this: the residue case routed the departure through `#retiring` instead of `#pendingRelease`, so the list never contained a rejoined entity. | `#pendingRelease.delete(entityId)` in the join branch. Removing that line fails exactly one test out of 121 — the leave/rejoin replay equivalence case — which is why this is recorded as a masked defect rather than a new requirement. |
| 14-7 | The vector comparison compared two **arrays** with `===`, which is never true for distinct arrays; the equivalence assertion could not have passed however correct the core was. The unit suite's projection-based comparison hid the same class of mistake. | Compare per-row JSON joined into one string. Before the fix `leave` reported `rowsEqual: false` for every run. |
| 14-8 | `queues.test.ts` asserts the capacity table with `toEqual`, so adding `deferredIntake` failed it. Working as intended: the bound is now a decision visible in an assertion rather than an edit buried in a helper. | The assertion was updated with a comment saying which numbers are P03-adopted and which are not. |

Mutation checks run against this revision: never deferring fails 8/8; reversing the drain fails the order test;
removing the bound fails the overflow test; re-reserving the ordinal at the boundary fails 8/8; and not
cancelling the release on rejoin fails the leave/rejoin case alone.

### 14.4 Evidence for this revision

`tests/unit/udg-003/deferred-intake.test.ts` replaces `cutoff-lifecycle.test.ts` (5 tests removed, 8 added). It
lands an arrival on the tick's own clock reading, after the lifecycle control is enqueued, and then:

* asserts no disposition of any kind names it inside the running tick, that the intake holds it, and that no
  queue holds an ordinal the running tick has frozen past;
* asserts it is consumed at the following boundary with `eligibleTick` equal to that tick;
* lands three arrivals in one tick and asserts receipt order equals sorted order equals admitted order;
* lands 67 arrivals in one tick and asserts 64 accepted into the intake, three refused
  `RATE_LIMITED/refused:overflow`, `deferredIntake === 64`, `deferredIntakeRejections === 3`,
  `overflowCauses['deferred-intake'] === 3`, zero journalled `refused:overflow` rows and zero
  `refused:overflow` counter movement at that moment; then that every accepted arrival is journalled exactly
  once at the boundary;
* for **leave, expiry, epoch change and leave/rejoin**: round-trips every journal row and every chain record
  through JSON, replays through the production replay path with a fresh zero-origin clock, and requires equal
  row-for-row journal, equal canonical state (position, mode, connected) and an equal chain tip.

The phase gate now requires the same thing. `validateVectorManifest` calls `replayEquivalenceIssues`
(`tools/checks/src/evidence.ts`), which reads `pa1-c8-deferred-intake.json` and emits
`VECTORS-REPLAY-EQUIVALENCE` if any of `leave`, `expiry`, `epoch`, `rejoin` does not report
`replayable: true`, if `allEqual` is absent, if the file is missing, or if it does not parse. The new contract
test re-signs the manifest for each tampered vector so the failure it observes can only be the rule under test,
and asserts each of the four cases individually, then that restoring the honest vector is the only thing that
clears the gate.

Required artefacts move from 13 to 14. `pa1-c7-cutoff-lifecycle.json` is rewritten rather than dropped: it now
publishes `supersededBy: "PA1-C8"` plus the sweep invariant (`queuedBeyondCutoff: 0`,
`dispositionOnce: 1`) measured on all four lifecycles. Measured values for this revision:

```text
authority.cutoffLifecycle  = { sweepBoundToCutoff: true, queuedBeyondCutoffTotal: 0, eachDispositionOnce: true }
authority.deferredIntake   = { limit: 64, decidedAtNextBoundary: true, receiptOrderPreserved: true,
                               overflowAccepted: 64, overflowRejected: 3, overflowJournalled: 0,
                               leaveReplayable: true, expiryReplayable: true, epochChangeReplayable: true,
                               leaveRejoinReplayable: true, allSupportedCasesReplayable: true }
```

The `false` that revision 3 published inside `authority.cutoffLifecycle` is gone because the property it
described is gone; the gate now refuses a bundle in which any of the four cases is unproven, so the same
regression cannot silently return.

The first attempt wrote that first measurement as `queuedBeyondCutoff: true`, meaning "no queue holds work
past its cutoff". A reader holding only the bundle could read the same key as a breach, and the `true` in a
bundle whose headline property is a bound is exactly the kind of name that gets misread under review, so it is
published as the count instead (`queuedBeyondCutoffTotal: 0`) with the per-case counts in
`pa1-c7-cutoff-lifecycle.json`. The rename moves no vector digest — measurements are a separate artefact — and
`pa1-c8-deferred-intake.json` hashes identically before and after (`292c2856…`).

Vector digests after this revision (14 artefacts; `vectors-manifest.json` excluded because it names the commit):

```text
1b981db7194e3cf3910bf4f402445829944d977b67d27bf584177667ca3d0a06  disposition-reconciliation.json
6794cb4e48cd7480de85e74fbad16743a49702150277ef719e60715c54f23fda  pa1-1-pa1-2-cutoff-consumption.json
d48239dbaba3a580a7651b0d4a8f158ff1c7a0309e6b94114f007849f4cc7314  pa1-12-pa1-14-lifecycle-stepping-replay.json
57228ba0790c23a9e040b860469f021e8062911b794012e80bdbf6fb2c6d09f3  pa1-3-generation.json
7af0c5d7337be445e12a3a5abf7bd8750a2ef91de9c32b503c52e2f937e0bdcc  pa1-4-traces-t1-t2-t3-t6.json
1e9df37cd65b85912302d0119600083b8385f5e3fbf704110e646a6740127d8e  pa1-5-pa1-8-commit-keepalive-neutral-bound.json
25c24ee867674133e2d3834baed8f2d1974c9cd07c172b775dbd28805878b7c2  pa1-9-pa1-11-bounds-identity-navigation.json
a2b2f58aedba8fb23cfbba3129fe671c797f421321ecde502013f6810b20b626  pa1-c1-provenance.json
ca115d09ec27242d97aa30412350d02283ce35b5fa51d58fb13e1d77a1e6a464  pa1-c2-time-basis.json
67cfccd058f97b4b635fd83394a23030e67b23cce37ffddfef574c60f3f246a0  pa1-c3-retention.json
76921771a31dec0ecd9ff260b427418f6b1b67d09427fceb5b17767ad1753c7d  pa1-c6-tick-time.json
e72214e8a2ea6adbd08d40f8214ba07d68e79fb34e71f40ef19ea15671a1fbca  pa1-c7-cutoff-lifecycle.json
292c285685642393b96fccbd8bedfe6b95d3c21f1dbca2a2374444b4dace7d5b  pa1-c8-deferred-intake.json
c5c977a275797846bcc667bdc6f39d7d83fce7eb47b5b60ff0448505bc607605  summary.json
```

Which digests moved, and why:

| Artefact | Moved | Reason |
|---|---|---|
| `pa1-c8-deferred-intake.json` | new | this correction's evidence |
| `pa1-c7-cutoff-lifecycle.json` | yes | rewritten to the sweep invariant plus `supersededBy`, because the residue state it measured can no longer arise |
| `pa1-9-pa1-11-bounds-identity-navigation.json` | yes | it records the capacity table, and the table gained the intake bound |
| `summary.json` | yes | it counts artefacts and lists the correction artefacts |
| the other nine | no | unchanged bytes: revision 4 moves no cutoff rule, no one-input rule, no screening, arbitration, commit, identity, clock or reconciliation behaviour |

Two independent runs produced identical digests for all fourteen.

### 14.5 Commands as run

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, `boundary check OK: 61 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm build` | exit 0 |
| `pnpm dependencies:verify` | exit 0, `docs/integration/dependencies.json matches the installed dependency graph` |
| `pnpm test:boundaries` | exit 0 |
| `pnpm test:fixtures` | exit 0, `fixture validation OK: 24 fixture(s)` |
| `pnpm run declarations:strict` | exit 0 |
| `pnpm test` | exit 0, `Test Files 25 passed (25)`, `Tests 508 passed (508)` |
| `npx vitest run tests/unit/udg-003` | exit 0, `16 files`, `121 tests` |
| `npx vitest run tests/contracts/UDG-003.test.ts` | exit 0, `71 tests` |
| `UDG_VECTORS_OUT=artifacts/udg-003-phase-1 npx vitest run tests/unit/udg-003/vectors.test.ts` | exit 0, `9 tests` |
| `node tools/checks/dist/evidence.js vectors --dir artifacts/udg-003-phase-1 --allow-dirty` | exit 0, `PASS phase-1 vectors: 14 artefact(s) listed, hashed and attributable` |
| `pnpm contracts:checksums` | in sync after `-- --write` |

### 14.6 What revision 4 does not claim

* It is not Phase 2 or Phase 3. There is still no SDK transport, no `RegionRoom`, no lifecycle transport
  wiring, no physics, no navigation and no client prediction; `apps/server/src/index.ts` is still `export {}`
  and `@udg/server` still has no entry-map row.
* It is not a compatibility claim. `stackCompatibility` remains `not-established`; the Phase 0 probe verdicts
  are unchanged because this revision touched no third-party surface.
* It does not close D-7, Part B, D4, or any gate: Gates A, B and C remain **Not Run**.
* It does not change the one-input-per-entity-per-tick rule, the 30-second TTL, the four P03 capacities, or the
  stage order `F L Q S A C R X`.
* It does not make Phase 1 Verified. It is submitted **In Review** for the owner to accept.

### 14.7 The revision 3 bundle stays where it is

`/workspace/udg-evidence/ci-run-42992946900/UDG-003-2026-11-11T09-16-10-905Z-9598bd77` is the bundle that
published `authority.cutoffLifecycle.intraTickArrivalReplayable: false`. It is preserved unmodified, its digest
history is untouched, and the inventory record `UDG-003-PHASE-1R3-2026-11-13` still names it. Revision 4 does
not withdraw it and does not rewrite what it said: the disclosure was accurate about the code at that commit.


## 15. Revision 5 — receipt order across both admission paths (PA1-C9)

Revision 4 (`0c054f1887f0e5631c171c8dc8704ba5614fa532`, CI `43004614712`) closed the intra-tick mismatch and was
returned **In Review** for one remaining finding: an older arrival waiting in the deferred intake could be
overtaken by a newer arrival received between two ticks, which went straight into the entity queue. Replay feeds
both arrivals in ordinal order, so it can never overtake — which meant live execution and replay could disagree
about which observation stage Q selects, and about which arrival gets the last free slot.

### 15.1 The rule, and why the fix is one line wide

`#enqueue` now drains the intake before admitting anything while no tick is running:

```ts
if (this.#tickRunning) return this.#deferIntake(/* … */);
this.#drainIntake();          // receipt order spans both paths
return this.#admit(/* … */);
```

The intake is therefore flushed at **every** core entry point — a tick boundary, another message, or a lifecycle
control — rather than only at a boundary. That is the whole behavioural change. Two properties make it
sufficient rather than merely plausible: ordinals are reserved on receipt (so a flushed arrival is always older
than the one whose arrival caused the flush, and always within the cutoff of the tick that follows), and both
paths converge on `#admitBuilt` (so admission decisions do not depend on which path delivered the message).
Nothing else moved: no capacity, no TTL, no stage order, no cutoff rule, no lifecycle release timing.

### 15.2 The divergence, measured before the fix

The scenario was run against revision 4's code first, so the regression is known to bite rather than asserted
after the fact. Each row is the live run's answer, replay's answer, and the two chain tips.

| Scenario | Live consumed | Replay consumed | Live refused | Replay refused | Live tip | Replay tip |
|---|---|---|---|---|---|---|
| room available | `3` (the newer) | `2` (the older) | — | — | `ae00e33b324a4df8…` | `589bce6aede7652d…` |
| exactly one slot free | `2,3,4` | `2,3,4` | `34` (**the older**) | `35` (the newer) | `1679b46b8cde4d89…` | `4846b43be88ea319…` |

The second row is the more serious of the two: drop-newest is the declared capacity policy, and a run that
admitted the newer arrival first refuses the **older** one while remaining internally consistent — the policy
reads as correct in its own run even though it was applied to the wrong arrival. After the fix both scenarios
reproduce replay's answer exactly (`35` refused, tips equal, rows equal), and the published
`pa1-c9-receipt-order.json` carries both comparisons.

### 15.3 What the new suite asserts

`tests/unit/udg-003/receipt-order.test.ts` (6 tests) lands an older arrival on the running tick's own clock
reading, then a newer one between T and T+1, and then:

* **room available** — stage Q consumes the older arrival; the newer one is journalled `queued` on that tick and
  `consumed` on the next, never refused; persisted replay gives an identical journal, consumed identity,
  canonical state and chain tip;
* **exactly one free slot** — the older arrival takes the slot, the newer carries the single
  `refused:overflow` row with `RATE_LIMITED` and `overflowCauses['continuous-capacity'] === 1`, the older is
  never refused; persisted replay agrees on the refusal identity, the journal, canonical state and the tip;
* **lifecycle control between ticks** — a `leave` also waits behind the intake, so the older observation belongs
  to the association that is ending and is disposed exactly once as `dropped:lifecycle` rather than admitted to
  an entity that has gone;
* **mixed paths** — two arrivals during a tick plus three between ticks leave the queue reading as one ordinal-
  ascending sequence, and the next consumption is the minimum ordinal.

`overtake()` asserts `retention().deferredIntake === 0` after the newer arrival, which is the guard that fires
first when the flush is removed. Mutation check: deleting the `#drainIntake()` call fails all 6 tests; with the
guard bypassed, the dispositions and tips above are what changes.

Existing bounds and lifecycle regressions were preserved rather than edited: `deferred-intake.test.ts`,
`retention.test.ts`, `lifecycle.test.ts`, `queues.test.ts`, `cutoff*.test.ts`, `time-basis.test.ts` and
`tick-time.test.ts` all pass unmodified, and the repository suite moved only by the six new tests (508 → 514).

### 15.4 Evidence

`pa1-c9-receipt-order.json` joins the required list (14 → 15 artefacts) and the gate holds it to the same
standard as the revision-4 file: `replayEquivalenceIssues` refuses a bundle where `spaceAvailable` or
`singleFreeSlot` is absent or not `replayable: true`, or where `allEqual` is missing, unparseable or the file is
absent — reported as `VECTORS-REPLAY-EQUIVALENCE`. The rule is now one function over (file, cases), so a third
scenario cannot quietly be checked less strictly than the first two. The contract suite re-signs the manifest for
each tampered vector — otherwise the observed failure is only the digest check — and asserts each scenario by
name, then that an absent receipt-order vector is refused, and that restoring the honest vectors is the only
thing that clears the gate.

New measured threshold:

```text
authority.receiptOrder = { intakeFlushedAtEveryEntryPoint: true, olderConsumedFirstWhenRoom: true,
                           newerRefusedWhenOneSlotFree: true, olderNeverRefusedByCapacity: true,
                           spaceAvailableReplayable: true, singleFreeSlotReplayable: true,
                           allSupportedCasesReplayable: true }
```

Vector digests after this revision (15 artefacts; `vectors-manifest.json` excluded because it names the commit):

```text
1b981db7194e3cf3910bf4f402445829944d977b67d27bf584177667ca3d0a06  disposition-reconciliation.json
6794cb4e48cd7480de85e74fbad16743a49702150277ef719e60715c54f23fda  pa1-1-pa1-2-cutoff-consumption.json
d48239dbaba3a580a7651b0d4a8f158ff1c7a0309e6b94114f007849f4cc7314  pa1-12-pa1-14-lifecycle-stepping-replay.json
57228ba0790c23a9e040b860469f021e8062911b794012e80bdbf6fb2c6d09f3  pa1-3-generation.json
7af0c5d7337be445e12a3a5abf7bd8750a2ef91de9c32b503c52e2f937e0bdcc  pa1-4-traces-t1-t2-t3-t6.json
1e9df37cd65b85912302d0119600083b8385f5e3fbf704110e646a6740127d8e  pa1-5-pa1-8-commit-keepalive-neutral-bound.json
25c24ee867674133e2d3834baed8f2d1974c9cd07c172b775dbd28805878b7c2  pa1-9-pa1-11-bounds-identity-navigation.json
a2b2f58aedba8fb23cfbba3129fe671c797f421321ecde502013f6810b20b626  pa1-c1-provenance.json
ca115d09ec27242d97aa30412350d02283ce35b5fa51d58fb13e1d77a1e6a464  pa1-c2-time-basis.json
67cfccd058f97b4b635fd83394a23030e67b23cce37ffddfef574c60f3f246a0  pa1-c3-retention.json
76921771a31dec0ecd9ff260b427418f6b1b67d09427fceb5b17767ad1753c7d  pa1-c6-tick-time.json
e72214e8a2ea6adbd08d40f8214ba07d68e79fb34e71f40ef19ea15671a1fbca  pa1-c7-cutoff-lifecycle.json
292c285685642393b96fccbd8bedfe6b95d3c21f1dbca2a2374444b4dace7d5b  pa1-c8-deferred-intake.json
f9963f4292bf0bbc4cc1a4f86df442196c6b63edb8780422b13e6daf09a7f2dc  pa1-c9-receipt-order.json
66debab979cc400b5467d2542a6fb384d05d3e7285cc8f4bf80dcd4c8e7ce2fd  summary.json
```

Exactly two digests moved against revision 4: `pa1-c9-receipt-order.json` is new and `summary.json` counts and
lists the artefacts. The other thirteen are byte-identical to revision 4, which is the check that a
one-line ordering fix did not disturb any other decision. Two independent local runs produced the digests above.

### 15.5 Commands as run

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, `boundary check OK: 61 file(s), 0 violations, rule table 818c63d5b12f` |
| `pnpm build` | exit 0 |
| `pnpm dependencies:verify` | exit 0, `docs/integration/dependencies.json matches the installed dependency graph` |
| `pnpm test:boundaries` | exit 0 |
| `pnpm test:fixtures` | exit 0, `fixture validation OK: 24 fixture(s)` |
| `pnpm run declarations:strict` | exit 0 |
| `pnpm test` | exit 0, `Test Files 26 passed (26)`, `Tests 514 passed (514)` |
| `npx vitest run tests/unit/udg-003` | exit 0, `17 files`, `127 tests` |
| `npx vitest run tests/contracts/UDG-003.test.ts` | exit 0, `71 tests` |
| `UDG_VECTORS_OUT=artifacts/udg-003-phase-1 npx vitest run tests/unit/udg-003/vectors.test.ts` | exit 0, `9 tests` |
| `node tools/checks/dist/evidence.js vectors --dir artifacts/udg-003-phase-1 --allow-dirty` | exit 0, `PASS phase-1 vectors: 15 artefact(s) listed, hashed and attributable` |

### 15.6 What revision 5 does not claim

It is still Phase 1: no transport, no `RegionRoom`, no lifecycle transport wiring, no physics, no navigation, no
client prediction; `apps/server/src/index.ts` is still `export {}` and `@udg/server` still has no entry-map row.
It is not a compatibility claim: `stackCompatibility` remains `not-established` and this revision touches no
third-party surface. It closes no gate — Gates A, B and C remain **Not Run** — and resolves neither D-7, Part B
nor D4. It does not change the one-input rule, the 30-second TTL, the four P03 capacities, the intake bound or
the stage order. Phase 1 is submitted **In Review** and is not Verified.


## 16. Owner acceptance of Phase 1, recorded 2026-11-11

The project owner (`TomBResearch`), acting as reviewer and integration owner, accepted UDG-003 **Phase 1** on
2026-11-11 at revision 5. This section records the decision on the owner's instruction. The implementer recorded
no acceptance of its own work at any point: revisions 1, 2, 3, 4 and 5 were each submitted **In Review**, and
§11–§15 are left as they were written, including the disclosure each revision published about its own state.

```text
Implementer recommendation                       In Review (every revision; never more)
Reviewer decision and date                       **Accepted 2026-11-11** by the project owner (TomBResearch),
                                                 acting as reviewer and integration owner
Accepted implementation / reviewed submission    5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c
Passing submission CI                            https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43010353106
                                                 (success; all steps green; 514 tests, 0 failures, 0 errors,
                                                 0 skipped; UDG-001 49 / UDG-002 31 / UDG-003 71 task tests)
Retained Phase 1 bundle                           /workspace/udg-evidence/ci-run-43010353106/UDG-003-2026-11-11T11-20-26-111Z-5d77c612
                                                 phase phase-1, status PASS, implementationSha 5d77c612…,
                                                 workingTreeDirty false, tests 514/0/0/0, 15 vector artefacts,
                                                 PASS evidence verify … (0 issue(s)), no machine path in any file
Retained companions from the same run             UDG-001-2026-11-11T11-17-25-477Z-5d77c612 and
                                                 UDG-002-2026-11-11T11-18-46-321Z-5d77c612, both verifying;
                                                 probes/ with PR-0…PR-13 verdicts unchanged from Phase 0;
                                                 inventory chain record UDG-003-PHASE-1R5-2026-11-15
```

**What acceptance covers.** The transport-independent Phase 1 movement authority core: stage order
`F → L → Q → S → A → C → R → X`; the arrival cutoff frozen as the first statement of a tick; exactly one continuous
observation consumed per entity per tick at stage Q; screening and arbitration with the adopted precedence; the
bounded queues, terminal-request cache and one-tick time basis; the bounded deferred intake and receipt order
across both admission paths; lifecycle disposition bounded by the cutoff; the journal, its bounded retained state
and deterministic replay from persisted inputs; and the Phase 1 evidence gate that publishes those vectors and
refuses a bundle in which a claimed live/replay equivalence is unproven.

**What acceptance does not cover.** Phases 2 and 3, which remain unassigned and require separate authorisation:
stages `M` and `P`, `RegionRoom`, SDK input attachment and lifecycle transport wiring, physics, navigation and
client-side prediction. No acknowledgement claim of any kind. No third-party stack compatibility claim —
`stackCompatibility` remains `not-established`. No gate: **Gates A, B and C remain Not Run**, and Part B of
ADR-P-0002 remains unadopted. D-7 remains open and continues to block transport acceptance. D4 remains open: no
independent evidence backup destination is designated, and nothing in this acceptance authorises a release, tag,
archive or storage location.

**Date basis and correction.** The acceptance is recorded as **2026-11-11**: commit
`c10bfb5468dd10a286eba95c74118d3291395326` carries commit date `2026-11-11T11:33:09Z`, and its CI run
`43012892204` was created `2026-11-11T11:33:16Z` and completed `2026-11-11T11:41:11Z`. The records originally read
`2026-11-16`, a date no retained artefact supports; they were corrected on the owner's instruction, and the
correction commit itself is part of this record rather than an edit that pretends the earlier date was never
written. The owner's approval message has no independently verifiable timestamp, so the decision date is the date
the acceptance reached `main`. Every Phase 1 bundle in the evidence store — revisions 1 to 5 and the acceptance run
— is named with a `2026-11-11` capture timestamp, which is consistent with the corrected date and inconsistent with
the earlier review-instruction dates in §11–§15; those sections are left unamended because their dates cannot be
verified, and the discrepancy is disclosed instead.

**Task status.** `docs/contracts/UDG-003.md` keeps UDG-003 at **In Progress**. A phase-level acceptance is not a
task-level `Verified`: Phase 1 is one of three phases, and the task's own acceptance criteria are not all
satisfied by it. `docs/contracts/assignments/UDG-003-phase-1.md` carries the phase status
**Accepted at phase level**, and `docs/contracts/adoption.md` records the decision as
*UDG-003 Phase 1 acceptance recorded 2026-11-11*.

**Evidence provenance.** The accepted submission's CI run is the one whose bundle is named above; its 15 vector
digests equal the two local runs quoted in §15.4. Every earlier bundle remains retained and unmodified —
including the revision-3 bundle that published `intraTickArrivalReplayable: false`, which records a property the
code had at that commit and does not have now. The evidence inventory chain gained
`UDG-003-PHASE-1R5-2026-11-15` at v31 and the acceptance as a new chain version; no historical inventory,
bundle byte or recorded digest was rewritten to make the story read cleanly.
