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

Retention: these digests identify the artefacts; the artefacts themselves live in the working tree's
`artifacts/` directory and in no durable store. **The independent backup destination is still undesignated
(D4 open)**, so this record does not claim the vectors are preserved anywhere outside this repository and the
run that produced them.

## 9. Commits, and CI as at submission

| Commit | Content |
| --- | --- |
| `e1b0026` | pin the Phase 1 assignment before implementing it |
| `23f2869` | correct the Phase 1 record against P03 before writing any code |
| `58ecb18` | implement the transport-independent Phase 1 authority core (+ `@udg/config` grant, regenerated dependency register) |
| `7efa463` | pin the cutoff, admission and neutral rules |
| `1bf8740` | cover navigation refusal, identity, bounds, lifecycle, journal and cadence |
| this submission | the vector suite, the Phase 1 contract assertions, these records |

**CI: not yet run for this submission.** The head and run id are recorded in a follow-up commit, the same way
Phase 0 recorded its runs; until then no CI claim is made anywhere in this file. The previously accepted
revision-4 basis remains `8987139f18653b05e57e64d0b14cdd1c753b6612` with CI `42794023731`, and that run is
evidence for ADR-0002's compiler scope only — not for Phase 1.

**Evidence-bundle gap, disclosed rather than papered over.** §6 item 7 asks for "the retained bundle's
verification result", and AC-15 speaks of "both bundles verified". That machinery is the capture plan
(`node tools/checks/dist/evidence.js plans`), and it lists **`UDG-001` and `UDG-002` only**: those two tasks
were granted `tools/checks/**`, UDG-003 was not — Phase 1's grants are A1–A8 and none of them touches the
evidence tooling. So this phase produces **no `UDG-003` evidence bundle**, and claiming one would be false.
What the submission does carry is: the CI run's own conclusion and runner log for the published head, the
vectors in §8 with their digests, the command table in §5, and the UDG-001/UDG-002 bundles that CI still
captures and verifies on every push to `main` — which is what AC-15's "both bundles" actually refers to.
Adding a `UDG-003` capture plan is a small, well-defined change to a controlled path; it needs an explicit
grant and is listed in §11 as a decision the owner owes rather than being done here.

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
  AC-15 (root commands green in CI is the *submission* criterion, recorded in §9 as not yet run), and the
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
6. **A `UDG-003` evidence capture plan** (§9) — `tools/checks/**` is outside this phase's grants, so bundle-level
   evidence for UDG-003 cannot be produced without one.
