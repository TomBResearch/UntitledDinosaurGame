# UDG-003 Phase 1 assignment — transport-independent movement authority core

Task ID: `UDG-003` — phase `1` of `3`
Title: Authority core: frozen cutoff, lifecycle ordering, FIFO selection, screening, arbitration, commit, neutral rule, bounded queues, request identity cache, input-sufficient journal and deterministic replay
Depends on: UDG-001 (Verified), UDG-002 (Verified), UDG-003 Phase 0 (owner-accepted at the ADR-0002 scoped compiler policy), ADR-0002, P03
Status: **Assigned** — implementation in progress
Owner/reviewer: integration owner / Codex (implementation only; acceptance recorded by the owner alone)
Base commit: `8987139f18653b05e57e64d0b14cdd1c753b6612` (retained CI for that head: `42794023731`, conclusion `success`)

## 1. Authorisation, and what this assignment is *not*

Recorded from the owner's instruction:

* the ADR-0002 exception and its safeguards are accepted **at the commit above**, limited to the scoped compiler policy and retained checks — not complete runtime compatibility and not UDG-003 acceptance;
* **Phase 1 only** is authorised: the transport-independent authority core in the approved phase plan;
* Part B of ADR-P-0002 is **not adopted**, even as a narrowed guarantee;
* **D-7 remains open and continues to block transport acceptance**; this authorisation does not waive it;
* **Phases 2 and 3 remain unassigned**;
* Gates A, B and C remain **Not Run**, and UDG-003 remains incomplete until the remaining phases and blockers are resolved.

Consequences that bind this assignment:

1. no SDK/transport integration, no `RegionRoom`, no lifecycle transport wiring, no physics, no navigation, no client prediction, no multiple-input consumption;
2. the adopted one-input-per-entity-per-tick rule is implemented **exactly** — no backlog consumption, no coalescing, no `take(n)`;
3. D-7 is not re-argued here: the core makes no claim about client acknowledgement, and the `inputDisposition` port is **not** introduced in this phase (it belongs to whatever decision closes D-7);
4. no new backlog survey and no upstream publication.

## 2. Prerequisite verification

| Prerequisite | Verification performed | Result |
|---|---|---|
| P03 adopted | `adoption.md` UDG-003 row `P03 — **Adopted**`, amendment `I-1…I-3` state that Part B is not adopted | Met |
| ADR-0002 accepted and applied | `docs/adr/0002-server-declaration-checking-exception.md`; two ADR-tagged projects; retained full declaration check | Met, and it does not authorise Phase 1 by itself — this record does |
| Phase 0 accepted for its scope | Owner statement above at `8987139`; the acceptance is scoped to compiler policy | Met as scoped |
| P02/P06 pins, `@colyseus/schema@5.0.45` | `adoption.md`, `UDG-002.md` amendments | Met |
| P01 + C-01…C-06 | `UDG-001.md` | Met |
| UDG-002 protocol/config surface | `packages/protocol/dist`, `packages/config/dist`, `configHash 948f8c10…`, `movementHash c80f61d4…` | Met |
| Gates A/B/C | `acceptance-gates.md` | Not Run — unaffected by this phase |
| D-7, D4 | `adoption.md` `PH0-B1` closure text; D4 undesignated | **Open** — recorded as open in this assignment |

Contract text relied on, unchanged by this assignment: [UDG-003.md](../UDG-003.md) §6 phase order and §7 acceptance criteria; [UDG-SPIKE-003.md](../UDG-SPIKE-003.md) §5; [protocol.md](../protocol.md) §4.1, §4.2, §4.4; [movement-authority.md](../../interfaces/movement-authority.md) §5.1–§5.3; [domain.md](../../interfaces/domain.md) §4.1; and P03 stages **F, L, Q, S, A, C, X, P, J** and rules **a–m** in [UDG-003-readiness-proposal.md](UDG-003-readiness-proposal.md) §3.

No requirement, threshold, timestep, collision outcome or protocol meaning is changed here. The `UDG_MOVE_TO` refusal and the Phase-2 `pathResult` deferral stay as the contract states them.

## 3. Exact paths this assignment may create or modify

### 3.1 Owned paths (created or modified by this assignment)

| Path | Disposition |
|---|---|
| `apps/server/src/authority/determinism.ts` | New — injected time/scheduler ports (`P03-j`), monotonic clock clamping (`P03-k`), no `Date`/`Math.random`/`performance` use inside the core |
| `apps/server/src/authority/clock.ts` | New — one fixed-step owner, frozen cutoff per tick, self-realigning deadline clamped to one period, monotonic tick index (`P03-a`, `P03-k`) |
| `apps/server/src/authority/arrival.ts` | New — arrival records, monotonic private `arrivalOrdinal`, kind derivation, frozen cutoff association (`P03-c` 4) |
| `apps/server/src/authority/bounded.ts` | New — bounded FIFO and ring buffers with deterministic eviction and counted drops |
| `apps/server/src/authority/admit.ts` | New — lifecycle gate first, structural classification, enqueue with ordinal and cutoff, `Control:Join/Leave/Drop` internal events (`P03-c`, `P03-i`) |
| `apps/server/src/authority/select.ts` | New — ≤ 1 continuous observation **or** ≤ 1 pending request per entity per cutoff, FIFO by `(cutoff, arrivalOrdinal)`, neutral fallback (`P03-c`, `P03-d`) |
| `apps/server/src/authority/screen.ts` | New — screening **S1–S11** in order, request identity cache, duplicate/conflict handling, route revision allocation, terminal result cache, `UDG_MOVE_TO` refusal |
| `apps/server/src/authority/commit.ts` | New — single-commit decision (`Committed`/`Skipped`/`Invalid`/`Neutral`), generation watermark rules (`P03-99`) |
| `apps/server/src/authority/step.ts` | New — the tick body **F → L → Q → S → A → C → X → P → J**, one step per eligible entity through an injected stepper port |
| `apps/server/src/authority/journal.ts` | New — input-sufficient journal, per-tick hash chain, replay of arrivals with `cutoff.tickId > resumeTick`, replayed-cursor clamping (`P03-f`, `P03-g`) |
| `apps/server/src/authority/replay.ts` | New — deterministic replay from a snapshot plus a journal interval through the same tick body |
| `apps/server/src/authority/entity.ts` | New — per-entity authority record built on `PlayerSimulationState`/`LocomotionState` from `@udg/protocol` (no new state shape), watermark, caches, lifecycle state |
| `apps/server/src/authority/types.ts` | New — the record types shared by the modules above |
| `tests/unit/udg-003/*.test.ts` | New — the deterministic suites of §5 |
| `tests/support/authority/*.ts` | New — deterministic scheduler, reference stepper, scripted message sequences, replay comparer |
| `docs/contracts/assignments/UDG-003-phase-1-completion.md` | New — completion record (template) |

The `apps/server/src/authority/**` directory sits inside the contract's owned pattern (`UDG-003.md` §27 `apps/server/src/**`). The contract-named `apps/server/src/movement/MovementAuthorityAdapter.ts` is **not** created here: it is the Phase-2 boundary between the SDK and this core, and Phase 2 is unassigned.

### 3.2 Supporting paths

None beyond §3.1. `tests/support/reference/**` and `tests/support/load/**` (contract §28) belong to later phases.

### 3.3 Controlled paths, with the grant used

| Grant | Path | Change, and why the workspace cannot avoid it |
|---|---|---|
| `A1` | `apps/server/package.json` | `@udg/config` is added to `dependencies` as `workspace:*` (the contract's `G-1`). The core needs `canonicalHash` for the P03-e identity hash and the pinned timing/bounds values; `@udg/protocol` provides neither, and duplicating canonical JSON inside the server would fork hashing away from `configHash`/`movementHash`. No script, export, dependency version or engine pin changes. |
| `A2` | `pnpm-lock.yaml` | The workspace link for the added dependency. No third-party package, version or resolution changes; verified by `pnpm install --frozen-lockfile` and `pnpm dependencies:verify`. |
| `A3` | `docs/integration/dependencies.json` | Re-recorded because the register must match the graph (the contract's `G-9`). |
| `A4` | `docs/contracts/adoption.md` | Records this assignment, the Phase-1 authorisation and its boundaries (including that Part B is not adopted and D-7 remains open). No status is self-signed. |
| `A5` | `docs/contracts/UDG-003.md` | Status line only: phase 1 submitted for review. |
| `A6` | `docs/contracts/checksums.json` | Regenerated after the adopted-text files change. |
| `A7` | `docs/integration/README.md` | One line linking this assignment. |
| `A8` | `tests/contracts/UDG-003.test.ts` | Extended to assert the Phase-1 artefacts and the phase's explicit non-claims. |

**Explicitly not edited in this phase**, with the reason: `.github/workflows/ci.yml` (`pnpm test` already includes `tests/**/*.test.ts`, so Phase 1 needs no new step); `vitest.config.ts` (grant `TC-6`/`G-7` unneeded — `tests/**/*.test.ts` already matches); `docs/contracts/protocol-v1.md` (no entry point, schema or wire change: `@udg/server` gains no export, so the UDG-001 entry-map assertion is untouched); `docs/specifications/**`; `packages/**`; `tools/checks/src/boundaries.ts` (grant `G-3` unneeded — Phase 1 imports no `@colyseus/*` from `src/**`, so no new isolation rule is required); `tools/checks/src/{evidence,dispatch,fixtures}.ts` (grants `A-6`, `G-6`, `A-5` unneeded — abuse fixtures and per-task capture come with Phase 3); `docs/adr/**`; `docs/validation/**`; every `AGENTS.md`.

`apps/server/src/index.ts` stays exactly `export {};` with its `UDG-003` note: the UDG-001 suite requires an unimplemented workspace's index to remain an empty module, and Phase 1 deliberately creates no package surface. The core is reached by relative import from `tests/`, which is how the probes already reach `apps/server`.

## 4. Implementation requirements

1. **Determinism by construction.** No `Date.now`, `performance.now`, `Math.random`, `setTimeout`, I/O or environment reads inside `src/authority/**`. Time and scheduling arrive as injected ports; the core receives `nowMs` and a `Scheduler` and is driven in tests by a virtual scheduler. Wall-clock jitters and clamps follow `P03-k` inside the injected adapter only.
2. **Frozen cutoff, one owner.** `openCutoff()` is called before any tick work; every message received afterwards belongs to the next cutoff. One tick advances the index by exactly one, with `dt = network.simulationStepSeconds` (`1/20`) taken from `@udg/config`, and the deadline correction is clamped to a single period (`P03-a`).
3. **Lifecycle before content.** A message is classified only if the entity's lifecycle state permits it: no source before `Join` or after `Leave`/`Drop`; a disconnected entity continues to be stepped with neutral input until its `Leave`/`Drop`; rejoining is ordered after that `Leave`/`Drop` at cutoff **L** (`P03-i`). Transport `onLeave`/`onDrop` are represented as internal `Control:Leave`/`Control:Drop` arrivals at the cutoff current at ingest — never retro-dated.
4. **Selection.** ≤ 1 continuous observation **or** ≤ 1 pending request per entity per cutoff, chosen FIFO by `(cutoff, arrivalOrdinal)`, taking the newest continuous frame with `generation ≤ C.generation` (`P03-c`); when none qualifies, the synthetic neutral frame of `P03-d` is used and `movementMode` is preserved. Continuous samples and requests live in separate structures, so a pending request can never delay a movement sample.
5. **Screening in the S1–S11 order**, reusing the adopted UDG-002 functions rather than re-implementing them: `validateDirectFrame`, `validateMoveTo`, `validateCancelPath`, `admitGeneration`, `compareRequestIdentity`, `isInsideBounds`, `canonicalHash`. Every rejection carries its `@udg/protocol` `RejectionCode`. `UDG_MOVE_TO` is refused at screening with `INVALID_PAYLOAD`, produces no candidate and no route revision (AC-8's core half), and no `pathResult` is emitted by design (P03-m).
6. **Arbitration and one commit.** Deterministic ordering `(generation descending, arrivalOrdinal ascending, entityId ascending)`; exactly one commit per entity per tick; ties impossible because `arrivalOrdinal` is unique; non-selected survivors and requests survive untouched (no coalescing, no clearing). Watermark rules per `P03-99`: `Committed` and superseding `Skipped` advance it; `Invalid` and duplicate `Skipped` do not; `Neutral` leaves it unchanged; the watermark never goes backwards, and neither does any state field.
7. **Neutral input** is `{ moveX: 0, moveZ: 0 }` with `directIntent: false` at the next generation (`P03-93`); it is a fallback, not a way to enter a path mode.
8. **One step per entity per tick.** Each entity that is not yet `Left`/`Drop`ed is stepped exactly once per tick through the injected `EntityStepper` port, including disconnected entities stepping to rest; the stepper port is what UDG-005's locomotion will implement, so Phase 1 implements no movement mathematics itself. The tests' reference stepper applies `drive × speed × dt` and records every call so call counts and per-tick displacement are asserted, not assumed.
9. **Request identity cache** exactly as `P03-e`: `identityKey = (entityId, sessionEpoch, requestId)`, `identityHash = canonicalHash(canonical identity)`, per-entity `recentRequests` capacity 8 with FIFO eviction, duplicate replays the cached terminal result with zero route events, conflict answers `REQUEST_ID_CONFLICT` and caches that terminal result, `terminalResults` capacity 8, `routeEvents` capacity 64 with oldest-first eviction.
10. **Bounded structures**, each with a declared capacity and a counted, journaled eviction: continuous buffer 8 per entity, request queue 256 per region, journal ring 32 ticks, per-entity route events 64, terminal cache 8, request cache 8. No structure grows without a bound, and no path drains a queue to "catch up".
11. **Journal and replay.** Per-arrival records carry `arrivalOrdinal`, `epoch`, `entityId`, `generation`, `kind`, frozen `cutoff`, classification and disposition (plus `requestId` where one exists). Per-tick records carry tick id, cutoff, source kind/generation, per-entity transitions, canonical state, and `hash = SHA-256(canonical(prevHash ∥ transition ∥ state))`. Replay from a snapshot plus journal entries reproduces the canonical state and the hash chain through the *same* tick body used live, and replayed arrivals are those with `cutoff.tickId > resumeTick` in ascending ordinal order.
12. **Prohibited.** Any `@colyseus/*`, `@babylonjs/*` or browser import; DOM globals; `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, module-augmentation blocks, non-null assertions, `as unknown`/`as never`; dependency patches or shims; any change to a wire name, schema field, rejection code or threshold; any second timestep or wall-clock-driven movement; and any statement that Phase 1 establishes transport compatibility or closes D-7.

## 5. Commands, and the acceptance criteria they decide

| # | Command | Pass condition | Criteria |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | exit 0, lockfile unchanged thereafter | `A2` honoured, no dependency drift |
| 2 | `pnpm typecheck` | exit 0 | strict typing under the existing gates, including the new `src/authority/**` |
| 3 | `pnpm lint` | exit 0, boundary check 0 violations | `src/authority/**` imports stay inside `@udg/protocol`/`@udg/config`; no SDK import |
| 4 | `pnpm test` | exit 0 with UDG-001 (49) and UDG-002 (31) unchanged and green | no regression in the verified foundations |
| 5 | `pnpm test:unit` | exit 0 with the new `tests/unit/udg-003/**` suites running a non-zero count | PA1-1…PA1-12 |
| 6 | `pnpm test:boundaries` | exit 0, fixtures unchanged | no new fixture needed for Phase 1 |
| 7 | `pnpm contracts:checksums` | in sync after regeneration | record integrity |
| 8 | `pnpm dependencies:verify` | register matches the graph after re-record | `A3` honoured |
| 9 | `pnpm --filter @udg/server typecheck` / `typecheck:probes` | exit 0 | the accepted compiler gates stay green |
| 10 | `pnpm run declarations:strict` | exit 0 | ADR-0002 condition 5 stays satisfied |

Acceptance criteria for this phase (the contract's numbering in brackets):

* **PA1-1 cutoff determinism** — the cutoff is captured before any tick work; two same-duration delays around a boundary land in the same tick index; a frame arriving after the boundary waits for the next cutoff; at most one continuous source is committed per entity per tick, evidenced in the journal [AC-3a].
* **PA1-2 generation window and kind** — ≤ 5 accepted, > 5 → `RESYNC_REQUIRED`, watermark unchanged by duplicate/invalid/stale, watermark never decreases, kind derivation `null`/`continuous`/`request` [AC-4].
* **PA1-3 arbitration** — 20 sessions in one cutoff commit exactly one input per entity, in the deterministic order, and an independent replay produces the identical sequence [AC-5].
* **PA1-4 neutral rule** — empty buffer, all-invalid frames and keepalive-last each produce the `P03-d` neutral frame, mode preserved, exactly one step [AC-6].
* **PA1-5 replay** — rejoining at tick `N` replays every arrival whose input generation was accepted for `N-32 < G ≤ N`, in ascending ordinal order, preserving epoch, generation and kind [AC-6 replay clause].
* **PA1-6 route events** — one accepted request with two waypoints and a cancellation yields revisions 1..5 plus the final event with gapless revisions, exactly one `COMPLETED` at the final revision, zero `SUPERSEDED` and no duplicate `CANCELLED`; ten supersessions yield exactly ten final `SUPERSEDED` events with the original `requestId`+`generation`; `ROUTE_BUSY` refuses overlapping requests; cache overflow evicts oldest-first and is identical on replay [AC-14].
* **PA1-7 request identity cache** — same id + same identity replays the terminal result with no new revision and zero route events; same id + different payload answers `REQUEST_ID_CONFLICT`, produces one route event and one terminal result, and is selected FIFO ahead of a later frame; eviction is deterministic [AC-16].
* **PA1-8 path refusal** — every `UDG_MOVE_TO` is refused at screening with `INVALID_PAYLOAD`, no candidate is created, no route revision is allocated and no `pathResult` is emitted [AC-8 core half].
* **PA1-9 lifecycle ordering** — Join/tick/Leave/Drop order is deterministic at cutoff **L**; no source is accepted before Join or after Leave/Drop; a disconnected entity is still stepped with neutral input and accepts no new source; the 102-tick hold is measured with the injected clock and an expired hold leaves; Leave-then-Rejoin is ordered before the rejoin [AC-9 core half, `P03-i`].
* **PA1-10 bounded queues** — each structure's capacity is enforced, over-capacity behaviour is deterministic and journaled with the expected reason, and a sustained over-rate sender cannot grow any structure [AC-3b partial].
* **PA1-11 one step per entity** — exactly one stepper call per live entity per tick with `dt = 0.05` exactly, including disconnected entities [AC-2 half].
* **PA1-12 deterministic replay** — 200 ticks of scripted traffic replayed from a snapshot reproduce the canonical state and the tick hash chain byte-identically across independent runs [AC-5 half].
* **PA1-13 foundation regression** — UDG-001 and UDG-002 suites pass unmodified in intent; `apps/server/src/index.ts` still contains `export {};`; `@udg/server` gains no export and no entry-map row; the boundary check reports no violation; the Phase-0 probe suite is untouched and unchanged in verdict.

## 6. Evidence to retain

1. Exact commands and exit codes from §5, with test counts before and after.
2. Per-PA1 criterion: the test ids that decide it, and a machine-readable vector per deterministic case (inputs, expected disposition, expected route events, expected watermark), written to `artifacts/udg-003-phase-1/` during the run and summarised in the completion record.
3. The 200-tick replay vectors: the canonical state hash and tick hash chain tip for two independent runs (identical, or the phase fails).
4. The bounded-structure table: capacity, observed peak, counted evictions, per run.
5. The route-event trace for `T-9`-equivalent and the ten-supersession case, as observed values.
6. CI run id/conclusion plus the retained bundle verification result.
7. A **Not measured / not claimed** section listing at least: AC-1, AC-2 (RTT/abuse halves), AC-3c, AC-7, AC-8 transport half, AC-9 transport half, AC-10, AC-11, AC-12, AC-13, AC-15; Gates A/B/C **Not Run**; `stackCompatibility` **not-established**; D-7 open and blocking transport acceptance; Part B not adopted; Phases 2–3 unassigned; UDG-003 **not** complete.
