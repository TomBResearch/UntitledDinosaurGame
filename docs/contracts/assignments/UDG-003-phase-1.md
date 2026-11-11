# UDG-003 Phase 1 assignment — transport-independent movement authority core

Task ID: `UDG-003` — phase `1` of `3`
Title: Authority core: frozen cutoff, lifecycle ordering, FIFO selection, screening, arbitration, commit, neutral rule, bounded queues, request identity cache, input-sufficient journal and deterministic replay
Depends on: UDG-001 (Verified), UDG-002 (Verified), UDG-003 Phase 0 (owner-accepted at the ADR-0002 scoped compiler policy), ADR-0002, P03
Status: **In Review** — revision 3, made against the owner's two further corrections (§0.3)
Owner/reviewer: integration owner / Codex (implementation only; acceptance recorded by the owner alone)
Base commit: `8987139f18653b05e57e64d0b14cdd1c753b6612` (retained CI for that head: `42794023731`, conclusion `success`)

Three commits are prerequisites in the sense the evidence gate means: accepted work this phase builds on,
each resolved with `git rev-parse` from this repository's history and confirmed an ancestor of the head it is
quoted against. The gate reads these lines, so the sha is written bare, as in the UDG-002 assignment.

```text
Prerequisite commit (UDG-001 acceptance): 524658e1fb4c53a450cdf933886c7ad4b17c72e9
Prerequisite commit (UDG-002 acceptance): d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4
Prerequisite commit (UDG-003 Phase 0, accepted as ADR-0002): 8987139f18653b05e57e64d0b14cdd1c753b6612
```

## 0. Correction to this record before any code was written

The first version of §3.1/§4/§5 of this record (`e1b0026`) was written from memory of P03 instead of from its text, and it mis-stated the adopted algorithm in seven ways. No code had been written against it, so the error is confined to this record; it is listed rather than quietly replaced, because the record is the implementation authority:

| # | The draft said | P03 actually says |
|---|---|---|
| 1 | the cutoff carried a generation ceiling and eligibility was "newest continuous frame with `generation ≤ C.generation`" | the cutoff is `cutoffOrdinal = arrivalCounter`, captured as the **first statement** of `step(T)`, and stage Q selects the **oldest** eligible continuous observation, kind-blind. Selecting the newest is the forbidden "drain a burst then simulate only its last frame" ([P03-b, P03-c Q](UDG-003-readiness-proposal.md)) |
| 2 | capacities 8 continuous / 256 requests / 64 route events / 8 request cache / 8 terminal cache | **32** continuous frames per client, **8** discrete per entity and **64** per room, terminal/request cache **128 records with a 30 s TTL** (P03-d/f/g) |
| 3 | generation window of 5 | `MAX_GENERATION_FORWARD_GAP` (**64**), never a literal (P03-h) |
| 4 | `UDG_MOVE_TO` refused `INVALID_PAYLOAD` | refused **`NAVIGATION_BUSY`** in screening, or `OUT_OF_BOUNDS` for a destination outside the validated volume, after honest validation/identity/generation/containment checks (AC-8) |
| 5 | "no clearing, no coalescing" as "nothing is ever removed" | stage Q consumes one observation and leaves the rest queued **unrefused**; stage C then **purges** the observations the committed decision made inadmissible, each recorded as *refused, not consumed* (P03-f) |
| 6 | arbitration `(generation desc, arrivalOrdinal asc, entityId asc)` | `(generation desc, kind precedence direct → cancel → path, arrivalOrdinal asc)`, losers `INVALID_GENERATION` at the winner's generation and `SUPERSEDED` otherwise, and **screening never rejects a potential winner** (P03-c A) |
| 7 | Phase 1 would demonstrate accepted route revisions 1…5 and `SUPERSEDED` route events | no route can exist in UDG-003: `routeRevision` stays 0, no `path` candidate is ever constructed and no `UDG_ROUTE_STATUS` is emitted; the route-dependent cases are **deferred, not faked** (AC-8, §3.5 of the proposal) |

Stage letters are **F, L, Q, S, A, C, R, X, M, P** (the draft omitted **R** and **M** and invented **J**), and stage **M** (map canonical state to the replica) and **P** (publish results, metrics, flush) need a room and a replica, so they are Phase 2 work: Phase 1 implements and asserts **F → L → Q → S → A → C → R → X** and records the data M and P will need in the journal instead. Sections 3.1, 4, 5 and 6 below are the corrected text.

## 0.2 Reviewer corrections requested after the first submission

The first Phase 1 submission (`73d48c9`, CI `42914263581`, records head `f4670e3`) was returned **In Review**
with three technical corrections and one evidence requirement, each of which the reviewer scoped narrowly.
They are recorded here because the reviewer's instruction, not the implementation, is what makes them
requirements:

| # | Requirement as given | What it obliged in the code |
|---|---|---|
| C1 | **Trusted event provenance through replay.** Never infer a lifecycle operation from a client payload field; add a regression showing a refused message with a lifecycle-like field remains refused on replay and cannot change entity state. | `ArrivalOrigin` (`server-lifecycle` / `client-payload`) is assigned from **how the core was called**, and travels into `observation.origin`, `observation.control` and `event.origin`. Replay projects `control` from `origin`, never from `raw`, so a payload that says `control: 'leave'` is fed back as a client message and refused again for the same structural reason. `replayRun` refuses inputs whose provenance and control disagree (`provenance-inconsistent`) before running. `tests/unit/udg-003/provenance.test.ts` covers live, replay, replay-from-serialised-evidence, tampered inputs and a mixed run. |
| C2 | **Replay must reproduce the approved cache-expiry time basis.** Record/restore the actual time inputs, or document a deterministic alternative only if the TTL semantics change; test identical retries before, at and after the 30-second boundary including replay from persisted evidence; verify malformed input retains enough information to reproduce its refusal. | The journal declares `timeBasis: 'recorded-clock-readings'` and records the clock origin in the prologue plus `atMs` on every observation, every event and every tick-chain record. `RecordedTime` restores those readings, refuses a non-monotonic restore, and `replayRun` rebuilds the original basis rather than starting its own clock at zero. `tests/unit/udg-003/time-basis.test.ts` runs three runs that differ **only** in the clock (`TTL-1`, `TTL`, `TTL+1`), plus a non-zero origin, a backwards-basis refusal and the malformed-field case. |
| C3 | **Bound retained state.** Stream journal and chain output through an injected sink; retain only bounded working state; release or explicitly bound expired/departed entity bookkeeping; add a long-run test showing memory-resident row/entity counts do not grow with total history. | `JournalSink` is a required build option; `Journal` retains no rows and no chain, and the core holds only a per-tick row buffer, live entities, their bounded queues, the control queue, the alias map (bounded at 64 records, with the alias counter left monotonic) and the chain tip. A departed entity's bookkeeping is released once its rows have reached the sink, and its arrivals stay counted. `retention()` reports the working set, and `tests/unit/udg-003/retention.test.ts` samples it across churn runs while the sink's totals grow. |
| C4 | **Retain actual Phase 1 evidence.** Narrowly scoped CI/evidence-tooling/test changes may validate and upload the required Phase 1 vectors and hashes; CI must fail if that evidence is missing or invalid; the published bytes are retained in the existing evidence store against the exact tested SHA; the evidence is labelled Phase 1 only, because the UDG-001/UDG-002 bundles do not prove Phase 1 and do not imply a full UDG-003 pass. | Grants `A9`–`A12` below. A `UDG-003` capture plan exists, labelled `phase: 'phase-1'` with a scope note naming what it is **not**; `evidence.js vectors` gates the vector manifest and its bytes (exit non-zero on missing, empty, altered or unattributable artefacts); CI runs the vector suite, gates it, captures and verifies the bundle and uploads the artefacts; the manifest names the 40-character commit it came from, and verification refuses a manifest whose commit is not the commit the run executed. |

The reviewer's constraints on this revision stand unchanged: no Phase 2 or Phase 3 work, no change to the
one-input rule, no resolving D-7 by assumption, no provisioning backup storage, and Gates A/B/C remain
**Not Run**. Historical evidence and the disclosed `v19 → v20` inventory discontinuity are preserved, not
rewritten.

## 0.3 Reviewer corrections requested after the second submission

Revision 2 (`358f9ef`, CI `42934515683`, records head `b2a6dd1`) was accepted as addressing C1–C4 and returned
**In Review** with two further corrections. The reviewer asked for the corrected submission SHA, a passing CI
link and the verified Phase 1 bundle, and restated that the assignment stays limited to Phase 1, that Phases
2–3 require separate authorisation, and that **D-7 remains an open transport decision**.

| # | Requirement as given | What it obliged in the code |
|---|---|---|
| **PA1-C6** | **Use the recorded tick time consistently for request-cache expiry and writes.** Prefer capturing one time value at the tick boundary and passing it through screening, lookup and commit, so replay restores the exact time used for those decisions. Preserve the 30-second TTL. Add a regression with an injected clock that advances within a tick across the expiry boundary, then verify that replay from persisted evidence reproduces the live disposition and chain tip. | `step()` captures `tickAtMs` once, beside the cutoff, and that value is the only reading the tick's decisions use: `#contextFor(tick, tickAtMs)` feeds screening, `IdentityCache.lookup(..., nowMs)` takes it as an argument, `#applyPlan(..., atMs)` stamps every cache write with it, and `planCommit` builds the winner on it. `IdentityCache` no longer holds a `TimeSource` at all, and `compact(nowMs)` cannot invent a reading either, so no cache question can be answered on an instant the journal did not record. The TTL is unchanged at 30 s measured from the record's own `storedAtMs`. `tests/unit/udg-003/tick-time.test.ts` uses a clock that advances on every read to put the tick's reading inside the window and the very next reading past it, asserts the cache answers from the record, asserts the write carries the recorded instant, and replays both sides of the boundary from persisted rows to the same chain tip. |
| **PA1-C7** | **Apply the frozen cutoff to lifecycle queue cleanup.** Leave, expiry and epoch change should only dispose of eligible queued observations during the current tick. Preserve post-cutoff observations until their next eligible tick, including when the entity expires, and account for each disposition exactly once. Add a regression that injects an arrival after the cutoff during lifecycle processing. | `#refuseEpochMismatched` and the departure `clear()` are replaced by one bounded sweep, `#disposeEligible(entity, cutoff, cause, rows, ceiling)`, which touches only `arrival.ordinal <= cutoff.ordinal` and writes exactly one row per removal. A departure whose queue still holds residue keeps the entity's bookkeeping alive as `#retiring` for one tick and releases it at `#settleRetiring` on the next tick, so the residue is journalled under the cause that applies rather than lost; a rejoin in the meantime keeps the arrival for the live association. `retention()` reports `retiring`. `tests/unit/udg-003/cutoff-lifecycle.test.ts` injects an arrival *during* lifecycle processing with a clock that runs the injection on the tick's own reading, and covers leave, expiry, epoch change, rejoin and replay. |

Two things this revision did **not** do, so that the correction stays the size the reviewer asked for:

* it did not change when a departure releases bookkeeping in the ordinary case. A wider variant — retiring
  every departed entity for a tick whether or not residue was queued — makes the injected case replay-identical
  too, but it shifts release timing for every departure and rewrote twelve accepted assertions in the lifecycle
  and retention suites. It is recorded in completion §13.5 as an option for the owner rather than taken here.
* it did not touch the one-input rule, D-7, Part B, Gates A/B/C, or anything outside Phase 1.


## 1. Authorisation, and what this assignment is *not*

Recorded from the owner's instruction:

* the ADR-0002 exception and its safeguards are accepted **at the commit above**, limited to the scoped compiler policy and its retained checks — not complete runtime compatibility and not UDG-003 acceptance;
* **Phase 1 only** is authorised: the transport-independent authority core of the approved phase plan;
* Part B of ADR-P-0002 is **not adopted**, even as a narrowed guarantee;
* **D-7 remains open and continues to block transport acceptance**; this authorisation does not waive it;
* **Phases 2 and 3 remain unassigned**;
* Gates A, B and C remain **Not Run**, and UDG-003 remains incomplete until the remaining phases and blockers are resolved.

Consequences that bind this assignment:

1. no SDK/transport integration, no `RegionRoom`, no lifecycle transport wiring, no physics, no navigation, no client prediction, no multiple-input consumption;
2. the adopted one-input-per-entity-per-tick rule is implemented **exactly**: stage Q consumes at most one continuous observation per entity per tick and nothing is ever coalesced, drained, or applied as "the newest of a burst";
3. D-7 is not re-argued and not worked around here: nothing in Phase 1 asserts anything about SDK acknowledgement (there is none), and no `inputDisposition` port is introduced, because closing D-7 is a separate owner decision. The application journal produced here is the truth record for what was applied, and is never evidence that a transport acknowledgement was truthful (P03-f);
4. no new backlog survey and no upstream publication.

## 2. Prerequisite verification

| Prerequisite | Verification performed | Result |
|---|---|---|
| P03 adopted | `adoption.md` UDG-003 row `P03 — **Approved 2026-11-09**, clarifications Q-01 to Q-03` | Met |
| ADR-0002 accepted and applied | `docs/adr/0002-server-declaration-checking-exception.md`; two ADR-tagged projects; retained full declaration check | Met as scoped; it does not by itself authorise Phase 1 — this record does |
| Phase 0 accepted for its scope | Owner statement at `8987139`, scoped to the compiler policy | Met as scoped |
| P02/P06 pins, `@colyseus/schema@5.0.45` | `adoption.md`, `UDG-002.md` amendments | Met |
| P01 + C-01…C-06 | `UDG-001.md` | Met |
| UDG-002 protocol/config surface | `packages/protocol/dist`, `packages/config/dist`, default `configHash 948f8c10…`, `movementHash c80f61d4…` | Met |
| Gates A/B/C | `acceptance-gates.md` | **Not Run** — unaffected by this phase |
| D-7, D4 | `adoption.md`; D4 undesignated | **Open**, and recorded open here |

Contract text relied on, unchanged by this assignment: [UDG-003.md](../UDG-003.md) (Behaviour and interfaces, Tests and acceptance); [UDG-SPIKE-003.md](../UDG-SPIKE-003.md) §5; [protocol.md](../protocol.md) §4.1–§4.4; [movement-authority.md](../../interfaces/movement-authority.md) §5.1–§5.3, §5.5; [domain.md](../../interfaces/domain.md) §4.1; and P03 clauses **a–i** with stages **F L Q S A C R X M P**, traces **T-1…T-8** and acceptance criteria **AC-1…AC-20** in [UDG-003-readiness-proposal.md](UDG-003-readiness-proposal.md) §1 and §3.7.

No requirement, threshold, timestep, collision outcome or protocol meaning is changed here. The `UDG_MOVE_TO` refusal, the `NAVIGATION_BUSY` code and the deferral of `path` semantics stay as P03 and the contract state them.

## 3. Exact paths this assignment may create or modify

### 3.1 Owned paths (all new; nothing outside this list is created by Phase 1)

| Path | Disposition |
|---|---|
| `apps/server/src/authority/determinism.ts` | New — the injected `Scheduler`/`TimeSource` ports (P03-a) and the `arrivalOrdinal` bound |
| `apps/server/src/authority/clock.ts` | New — one fixed-step owner: `serverTick` counter, `dt` and patch cadence taken from validated `ServerConfig.network`, self-realigning arming through the injected scheduler (P03-a) |
| `apps/server/src/authority/types.ts` | New — the records shared by the modules below (arrival, cutoff, candidate, disposition, journal rows, decisions) |
| `apps/server/src/authority/arrival.ts` | New — `arrivalOrdinal` counter, kind derivation, the frozen copy-on-record observation (P03-a, P03-g) |
| `apps/server/src/authority/bounded.ts` | New — fixed-capacity FIFO with drop-newest refusal, and the 128-record/30 s TTL identity cache with deterministic eviction (P03-d/f/g) |
| `apps/server/src/authority/entity.ts` | New — per entity/epoch authority state built on `PlayerSimulationState`/`LocomotionState` from `@udg/protocol` (`H`, `latchedKind`, `G_d`, the two queues, the caches, lifecycle status); no new state shape is invented |
| `apps/server/src/authority/admit.ts` | New — the ingest path: lifecycle gate, structural classification, enqueue with ordinal and copy-on-record; validates and enqueues, never mutates admission state (P03-b) |
| `apps/server/src/authority/screen.ts` | New — stage S pure decisions (validation, identity-first dedupe, generation window, containment, `NAVIGATION_BUSY`) and stage A pure arbitration. Neither mutates `H`, latches a kind or rejects a potential winner |
| `apps/server/src/authority/commit.ts` | New — stage C pure decision: commit the winner or take the neutral branch, compute the stale-backlog purge, compute the tick row values |
| `apps/server/src/authority/step.ts` | New — **the only module that mutates admission state or queue membership**: `F → L → Q → S → A → C → R → X`, plus the journal rows of P03-g |
| `apps/server/src/authority/journal.ts` | New — P03-g row builders, per-tick hash chain, digest stripping for the replay fixture, sanitisation checks |
| `apps/server/src/authority/replay.ts` | New — replay from prologue + observation rows **as inputs** through the same tick body; refuses a prologue whose hashes disagree |
| `tests/unit/udg-003/*.test.ts` | New — the deterministic suites of §5 |
| `tests/support/authority/*.ts` | New — virtual scheduler, reference stepper, scripted arrival builders, harness that assembles a core from validated configuration and explicit bounds |
| `docs/contracts/assignments/UDG-003-phase-1-completion.md` | New — completion record (template) |

`apps/server/src/authority/**` sits inside the contract's owned pattern (`apps/server/src/**`). The contract-named `apps/server/src/movement/MovementAuthorityAdapter.ts` is **not** created here: it is the Phase-2 boundary between the SDK and this core, and Phase 2 is unassigned. `apps/server/src/index.ts` stays exactly `export {};` with its `UDG-003` note — the UDG-001 suite requires an unimplemented workspace's index to stay an empty module, and Phase 1 deliberately creates no package surface, so the core is reached by relative import from `tests/` exactly as the probes are.

### 3.2 Supporting paths

None beyond §3.1. `tests/support/reference/**`, `tests/support/load/**`, `apps/server/reference/**` and `tests/fixtures/UDG-003-*/**` (contract/proposal §3.3, §3.5) belong to later phases; Phase 1's scenarios are generated by `tests/support/authority/scripts.ts` and asserted in-suite, so the fixture catalog and its `kind` dispatch (grant A-5, unneeded) stay untouched.

### 3.3 Controlled paths, with the grant used

| Grant | Path | Change, and why the workspace cannot avoid it |
|---|---|---|
| `A1` | `apps/server/package.json` | `@udg/config` added to `dependencies` as `workspace:*` (the proposal's `G-1`; §7 endorses `canonicalHash` from `@udg/config` for state digests and records that `@udg/server` may import it). The core needs `canonicalHash` for the P03-e identity hash and the P03-g state digests, and the pinned `ServerConfig` for `dt`, patch cadence and gap window; `@udg/protocol` provides neither, and duplicating canonical JSON inside the server would fork hashing away from `configHash`/`movementHash`. No script, export, version or engine pin changes. |
| `A2` | `pnpm-lock.yaml` | The workspace link for that dependency. No third-party package, version or resolution changes. |
| `A3` | `docs/integration/dependencies.json` | Re-recorded because the register must match the graph (the proposal's `G-9`). |
| `A4` | `docs/contracts/adoption.md` | Records this assignment, the Phase-1 authorisation and its boundaries. No status is self-signed. |
| `A5` | `docs/contracts/UDG-003.md` | Status line only: phase 1 submitted for review, Phases 2–3 still unassigned. |
| `A6` | `docs/contracts/checksums.json` | Regenerated with `node tools/checks/dist/evidence.js checksums --write` after the adopted-text files change; never hand-edited. |
| `A7` | `docs/integration/README.md` | One line linking this assignment. |
| `A8` | `tests/contracts/UDG-003.test.ts` | Extended to assert the Phase-1 artefacts and the phase's explicit non-claims. |
| `A9` | `tools/checks/src/evidence.ts` | Reviewer correction C4 only. Adds the `UDG-003` capture plan, the `phase`/`phaseNote` report fields, `artefactsIntoBundle`, `manifestArtefacts`/`manifestRequiredFiles`, the `PHASE_1_VECTOR_FILES` expectation and the `vectors` gate. No plan for another task changes, no accepted bundle changes, no existing verification rule is weakened, and the UDG-001/UDG-002 thresholds are untouched. |
| `A10` | `.github/workflows/ci.yml` | Reviewer correction C4 only. One new step that writes and gates the Phase 1 vectors, and `artifacts/udg-003-phase-1` added to the published artefact paths. The capture loop still iterates `evidence.js plans`, so no task is named twice; no step gains `continue-on-error`. |
| `A11` | `tests/unit/udg-003/vectors.test.ts` | Writes the artefacts to `UDG_VECTORS_OUT` when the evidence run asks, and writes `vectors-manifest.json` naming the commit, the phase and the digest of every vector. The required list is duplicated **on purpose**: the gate owns the requirement and this file owns the production. |
| `A12` | `tests/support/authority/harness.ts` | `startMs` option, so a scenario can begin its clock somewhere other than zero and prove the recorded time basis carries through the prologue and the replay. |

**Explicitly not edited in this phase**, with the reason: `vitest.config.ts` (grant `TC-6`/`G-7` unneeded; `docs/contracts/protocol-v1.md` (no entry point, schema or wire change — `@udg/server` gains no export, so the UDG-001 entry-map assertion is untouched, and the P03-d `admitGeneration` scope note (grant `G-9`) is a protocol-owner record edit that Phase 1 does not need because it changes no behaviour); `docs/specifications/**`; `packages/**`; `tools/checks/src/boundaries.ts` (grant `G-3` unneeded — Phase 1 imports no `@colyseus/*` from `src/**`, so no new isolation rule is required); `tools/checks/src/{dispatch,fixtures}.ts` (grants `A-6`, `G-6`, `A-5` unneeded — abuse fixtures and per-task capture plans beyond this phase's own vectors come with Phase 3); `tools/checks/src/boundaries.ts`; `tools/checks/src/support.ts`; `tests/contracts/UDG-001.test.ts` (grants A-1/A-3/A-4 unneeded: `@udg/server` gains no exports, so `IMPLEMENTED_WORKSPACES` and the entry-map collector stay as they are); `docs/adr/**`; `docs/validation/**`; every `AGENTS.md`.

## 4. Implementation requirements (each cites the adopted clause it implements)

1. **Determinism by construction** (P03-a). No `Date.now`, `performance.now`, `Math.random`, `setTimeout`, filesystem, network or environment access anywhere under `src/authority/**`. Time and scheduling arrive as injected ports (`TimeSource`, `Scheduler`); tests drive a virtual scheduler; the production adapter is Phase 2's. `dt`, the patch interval and the tick rate are read from a validated `ServerConfig.network` — no literal tick or patch rate appears in server source, and the suite asserts that what the core runs equals the configuration it was built with.
2. **Frozen cutoff** (P03-b). The first statement of `step(T)` is `cutoffOrdinal = arrivalCounter`; `eligible(T)` is snapshotted once and is the only input the rest of the tick may read. Nothing — not lifecycle, not validation, not a metrics read — runs before the capture, and a test asserts that an arrival enqueued after the capture is not part of `T` at all. `cutoffOrdinal` is journaled every tick. Order is never inferred from client timestamps or promise scheduling.
3. **One mutating module** (P03-b). `H`, `latchedKind` and `G_d` are mutated only in stage C, and queue membership only in stages L, Q and C, all inside `step.ts`. `admit.ts`, `screen.ts` and `commit.ts` return decisions and mutate nothing; a test proves `screen`/`arbitrate`/`decideCommit` are pure by re-running them on the same inputs and comparing the entity snapshot before and after.
4. **Stage L** (P03-c L). Lifecycle is applied inside the frozen set from `Control:Join`/`Control:Leave`/`Control:Expiry`/`Control:EpochChange` arrivals. Queued observations of a mismatched epoch are refused `EPOCH_MISMATCH` (refused, not consumed, never stepped); a departed entity's queues are dropped and recorded; an entity retained across a reconnect stays idle.
5. **Stage Q** (P03-c Q, P03-f). Select **at most one** continuous observation per entity per tick: the **oldest** eligible one, `directIntent: true` **or** `false`, kind-blind on purpose. Every other eligible continuous observation stays queued in arrival order, unrefused. Never "the oldest frame that asserts something", and never the newest.
6. **Stage S** (P03-c S, P03-d, P03-e) — no `H` mutation, no latch, no rejection of a possible winner. Continuous: `validateDirectFrame` → refuse its code; `generation < H` → `SUPERSEDED`; `generation > H` with a gap above `MAX_GENERATION_FORWARD_GAP` → `RESYNC_REQUIRED`; `directIntent === false` → the **keepalive branch, taken before any kind test** (observation only); `generation == H` with `latchedKind != direct` → `INVALID_GENERATION`; otherwise a `direct` candidate. Discrete, in arrival order: validate (`validateMoveTo`/`validateCancelPath`) and refuse with that code (an unparsable identity writes **no** cache record); then **identity first** — the persistent cache, then this tick's batch registry — replaying the recorded terminal result on a match and `REQUEST_ID_CONFLICT` on a mismatch **without overwriting the cached identity**; then `generation < H` → `SUPERSEDED`, `generation == H` → `INVALID_GENERATION` (equality is never a new discrete intention, whatever the latched kind), gap above the window → `RESYNC_REQUIRED`; then `UDG_MOVE_TO` is terminal-refused `NAVIGATION_BUSY` (`OUT_OF_BOUNDS` first when `isInsideBounds` fails) and **never becomes a candidate**; `UDG_CANCEL_PATH` becomes a `cancel` candidate.
7. **Stage A** (P03-c A). Sort the surviving intention candidates by generation descending, then kind precedence `direct 0 → cancel 1 → path 2` (`path` is unreachable in UDG-003 and a fixture asserts no `path` candidate is ever constructed), then lowest `arrivalOrdinal`; the winner set **may be empty** and is never dereferenced blindly. Losers take `INVALID_GENERATION` when their generation equals the winner's and `SUPERSEDED` otherwise. Kind precedence **overrides** arrival order, and both arrival orders of T-1/T-2 are asserted.
8. **Stage C** (P03-c C, P03-f). With a winner: advance `H` **iff** its generation is above it, latch the kind, set `G_d` for `direct` and clear it otherwise, take `horizontalDrive` from the winner's normalised axes when nonzero else `NONE`, and cache one terminal record. With no winner: `horizontalDrive = NONE` and `H`/`latchedKind`/`G_d` deliberately unchanged. Then purge from the queue every continuous observation the committed decision made inadmissible — `generation < H`, or `generation == H` while asserting an intention with `latchedKind != direct` (keepalive frames are never purged on kind grounds) — each recorded as **refused, not consumed**: no step, no drive, no invented acknowledgement. Purge work is bounded by the 32-frame queue.
9. **`H` never moves** for a structurally invalid, old-epoch, overflow-refused, duplicate-answered, screened-refusal, excessive-gap, arbitration-losing or purged operation, nor in the no-winner branch; and never backwards. A committed winner mutates state exactly once; a cache or batch hit performs no transition at all.
10. **Neutral input** (P03-d, P03-f, AC-4/AC-16/AC-18). Removing input gives zero horizontal desired displacement **on the next tick**, `movementMode: idle`, `y` unchanged and heading preserved; idle assertions are horizontal-only, because UDG-003 has no physics and vertical settling must not be simulated by hand. A consumed keepalive differs from a neutral tick only in the journal's `inputSource`.
11. **Stage X** (P03-c X, AC-3a). Each **connected** entity is stepped **exactly once** per tick, in ascending `entityId` order using plain `<` on the identifier string (`localeCompare` is banned in this path), whether or not a winner existed. Movement itself is not implemented here: it is the injected `EntityStepper` port, which Phase 2 adapts to UDG-005's `LocomotionSimulator`. The stepper returns the new canonical state plus the tick's resolved horizontal displacement, so step counts and the AC-2 displacement bound are measured, not assumed.
12. **Bounded structures** (P03-f, P03-g, AC-3b). Continuous queue **32 per client**, drop-**newest** with `RATE_LIMITED` (preserves arrival order, cannot resurrect stale input); discrete **8 per entity** and **64 per room**; terminal/request cache **128 records with a 30 s TTL**; per-run in-memory journal retention bounded. Every capacity is a named constant with a test that overflows it, and every eviction and refusal is counted by reason.
13. **Rate policy is out of scope here, stated rather than smuggled in.** The contract's abuse limits (1024-byte payload, 40 frames/second with burst 40) are runtime admission policy that lives in `apps/server/src/server-config.ts` (proposal D-4) and is enforced where messages arrive — Phase 2's adapter. Phase 1 enforces the **capacity** bounds above and nothing that needs a wall-clock rate.
14. **Journal** (P03-g, AC-14/AC-20). Row types `prologue`, `event`, `observation`, `intention`, `tick`, `result`, `state`, `meta` carry the fields P03-g lists, including the raw decoded payload needed to **re-run screening** (axes as decoded, `requestId`, `payloadHash`, the validated field set, and a canonical rendering plus SHA-256 of a **malformed** payload), the disposition with its code, `H`/`latchedKind`/`G_d` before and after, screened refusals recorded **separately from arbitration losers**, the tick's `inputSource`/`horizontalDrive`/`intentionCommitted`/mode before-and-after/`routeRevision` (always 0 here) and displacement, per-entity canonical state, and `meta` depth/counter samples. Rows are joinable on `(serverTick, arrivalOrdinal)`; aliases are stable per run; no token, cookie, reconnection secret or private machine path appears in any row.
15. **Replay** (P03-g, AC-3d/AC-20). `replay(prologue, events, observations)` reconstructs **state and decisions** from inputs alone — initial canonical states, the validated configuration and bounds, and each observation's payload. Digests and candidate summaries are comparison outputs and are never replay inputs: a fixture strips every digest and must still replay, a malformed-input journal must replay, and a prologue whose `configHash`/`movementHash`/`regionHash` disagree with the running configuration is **refused outright** rather than partially compared.
16. **Ordering key bounds** (P03-a). `arrivalOrdinal` is server-private, strictly monotonic, capped at `Number.MAX_SAFE_INTEGER`; at the cap the core refuses further admissions and drains rather than wrapping. It is never replicated.
17. **Prohibited.** Any `@colyseus/*`, `@babylonjs/*` or browser import; DOM globals; `any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, module augmentation, non-null assertions, `as unknown`/`as never`; dependency patches or shims; any change to a wire name, schema field, rejection code or threshold; a second timestep or any wall-clock-driven movement; `localeCompare` in the iteration path; and any statement that Phase 1 establishes transport compatibility, acknowledges anything honestly on anyone's behalf, or closes D-7.

## 5. Commands, and the acceptance criteria they decide

| # | Command | Pass condition | Criteria |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | exit 0, lockfile unchanged thereafter | `A2` honoured |
| 2 | `pnpm typecheck` | exit 0 | strict typing of the new `src/authority/**` and its tests |
| 3 | `pnpm lint` | exit 0, boundary check 0 violations | `src/authority/**` imports stay inside `@udg/protocol`/`@udg/config`; no SDK import |
| 4 | `pnpm test` | exit 0 with UDG-001 (49) and UDG-002 (31) unchanged and green | no regression in the verified foundations |
| 5 | `pnpm test:unit` | exit 0, with the new `tests/unit/udg-003/**` suites running a non-zero count | PA1-1…PA1-14 |
| 6 | `pnpm test:boundaries` | exit 0, fixtures unchanged | no new fixture is needed |
| 7 | `pnpm contracts:checksums` | in sync after regeneration | record integrity |
| 8 | `pnpm dependencies:verify` | register matches the graph after re-record | `A3` honoured |
| 9 | `pnpm --filter @udg/server typecheck` and `typecheck:probes` | exit 0 | the accepted compiler gates stay green |
| 10 | `pnpm run declarations:strict` | exit 0 | ADR-0002 condition 5 stays satisfied |
| 11 | `pnpm --filter @udg/server typecheck:probes:full` | exit 2 with the pinned 27-diagnostic inventory unchanged | the retained vendor-declaration check still reports, unchanged by this phase |

Acceptance criteria for this phase, each decided by a named test (the P03 AC it implements in brackets):

* **PA1-1 cutoff and stage order** — the cutoff is the first statement of the tick; an arrival captured after it is not eligible for `T`; the executed stage order is `F, L, Q, S, A, C, R, X`; `cutoffOrdinal` is journaled [AC-6; M/P deferred to Phase 2 and disclosed as deferred].
* **PA1-2 consumption** — continuous observations consumed per entity per tick ∈ {0, 1}; non-selected eligible frames are neither consumed nor refused at selection; a purge never produces a step [AC-3a].
* **PA1-3 generation rules** — gap 64 admissible / 65 `RESYNC_REQUIRED` with unchanged `H` (window read from `MAX_GENERATION_FORWARD_GAP`, never a literal); below `H` `SUPERSEDED`; equal-generation intention `INVALID_GENERATION` within and across ticks; equal-generation discrete with a fresh id refused whatever the latched kind; generation-zero rules; `GENERATION_MAX` admitted as a value with a further increment refused `RESYNC_REQUIRED`; a wire value above the domain `INVALID_GENERATION`; old-epoch accepted frames exactly zero [AC-5].
* **PA1-4 arbitration** — T-1/T-2 in both arrival orders give the same winner and the same loser codes; T-3/T-6 as recorded; `path` never constructed; a re-run of the same frozen batch yields the same decision [AC-5, AC-6].
* **PA1-5 commit and purge** — `H` advances only above itself; `G_d` set for `direct` and cleared otherwise; the purge refuses the stale backlog with the correct codes, with zero extra steps and zero drive; no frame is refused twice; per entity per run `consumed + refused + answered + queued == observed` [AC-17].
* **PA1-6 keepalive invariance** — every consumed `directIntent: false` frame leaves `H`, `latchedKind` and `G_d` unchanged with `horizontalDrive = NONE`; the initial neutral generation-zero frame leaves `H = 0` and `latchedKind = none`; `direct gN → keepalive gN → direct gN` resumes at the same generation, one step per tick [AC-16].
* **PA1-7 no-winner branch** — missing, all-invalid, keepalive-only, cache-hit-only and screened-refusal-only ticks each step the connected entity exactly once with neutral horizontal input and unchanged intention metadata, asserted per branch rather than inferred [AC-18].
* **PA1-8 neutral stop and displacement bound** — removing input gives zero horizontal desired displacement on the **next** tick, `idle`, `y` unchanged, heading preserved; and every tick's horizontal displacement from the reference stepper is ≤ `0.2 m + 1e-6 m` [AC-4, AC-2].
* **PA1-9 bounded queues** — 32 continuous per client with drop-newest `RATE_LIMITED`; 8 discrete per entity and 64 per room; cache 128 records / 30 s with deterministic eviction; sampled depth never exceeds the declared capacity and every drop is counted by reason [AC-3b, counts only — the `buffer-depth.csv` artefact is Phase 3].
* **PA1-10 identity cache completeness** — intra-batch identical retries share one disposition, one record and one publish; same id with a different payload gives `REQUEST_ID_CONFLICT` without overwriting the cached identity; a fresh id at `generation == H` is `INVALID_GENERATION`; terminal **refusals** are cached and replayed identically; an evicted id still cannot replay movement (`SUPERSEDED`); a stale epoch never hits; an unparsable `requestId` creates no cache record [AC-19].
* **PA1-11 path refusal** — every `UDG_MOVE_TO` is refused in screening with `NAVIGATION_BUSY`, or `OUT_OF_BOUNDS` for a destination outside the validated volume; it never enters arbitration, never moves `H`, never latches `path`; `routeRevision` is 0 throughout; no `path` candidate is ever constructed; no `UDG_ROUTE_STATUS` is emitted; `UDG_CANCEL_PATH` is admitted and clears drive without touching route state [AC-8].
* **PA1-12 lifecycle ordering** — join/leave/expiry/epoch-change are applied inside the frozen set; an event captured after the cutoff is deferred to `T+1`; old-epoch queued observations are refused `EPOCH_MISMATCH` and never stepped (the O09 shape: epoch 8 with an epoch-7 backlog); a departed entity's queues are dropped and recorded; an entity retained across a reconnect stays idle [P03-b/c L].
* **PA1-13 one step per connected entity** — steps equal the number of connected entities, each exactly once, with `dt` exactly the configured `1/20`, in ascending `entityId` order by plain `<` [AC-3a, AC-6].
* **PA1-14 journal schema, replay equivalence and sufficiency** — a journal carrying only state digests fails the schema test; replaying the recorded inputs reproduces identical canonical state digests **and** identical admission/rejection decisions in the same runtime; a digest-stripped journal and a malformed-input journal still replay; a prologue whose hashes disagree is refused; the tick hash chain is identical across independent runs [AC-14, AC-3d, AC-20].
* **PA1-15 foundation regression** — the UDG-001 and UDG-002 suites pass unmodified in intent; `apps/server/src/index.ts` still contains `export {};`; `@udg/server` gains no export and no entry-map row; the boundary check reports no violation; the Phase-0 probe suite is untouched and its verdicts are unchanged.

* **PA1-C1 trusted provenance (correction C1)** — a client payload naming a lifecycle control is refused on its shape, journaled as `client-payload` with typed `control: null`, produces no lifecycle event and changes no entity state; the same journal replayed (live rows, serialised rows) refuses it again with the same code and the same canonical digest; replay inputs rewritten to claim server provenance are refused before the run [AC-14, AC-20; reviewer correction C1].
* **PA1-C2 recorded time basis (correction C2)** — the reading of the clock is recorded beside every decision; an identical retry is answered from the cache at `TTL-1` and decided afresh at `TTL` and `TTL+1`, and **each run's replay reproduces its own side of the boundary**, from memory and from a JSON round trip, with a non-zero clock origin carried through the prologue; a journal whose recorded time runs backwards is refused rather than silently replayed; a malformed message keeps its field list, its refusal code and its reading through a round trip [AC-20; reviewer correction C2].
* **PA1-C3 bounded retained state (correction C3)** — journal rows and chain records reach the injected sink and nowhere else; `retention()` stays flat across repeated joins, churn and expiry while the sink's totals grow monotonically; released entities keep their arrival counts and report `known: false`; the terminal cache never exceeds 128 records; the churned run replays to the same chain tip [AC-3b, AC-14; reviewer correction C3].
* **PA1-C4 phase evidence is gated (correction C4)** — `evidence.js vectors` exits non-zero when a required vector is missing, empty, byte-changed, unattributable or from another commit, and the contract suite exercises that gate against a scratch directory it corrupts on purpose. A green UDG-001 or UDG-002 bundle is never read as Phase 1 evidence [reviewer correction C4].

**Not decided by Phase 1, and not to be marked passed:** AC-1 (the 200-tick 40 m reference trace belongs to `apps/server/reference/` and Phase 3), AC-3c (abuse population), AC-7 (an offender's message through the transport), AC-9 (startup/disposal — transport and room), AC-10/AC-11/AC-12 (probe/compiler measures, Phase 0 and Phase 2), AC-13 (bounds-file startup), AC-15 (root commands green locally **and** in CI with both bundles verified is the submission criterion, recorded here as a command list rather than a phase claim); the M and P stages; the route-dependent cases O01, O03, O04, O05, O08, O10, O11, which are **deferred, not faked**; Gate A/B/C remain **Not Run**; `stackCompatibility` remains **not-established**; D-7 remains open; Part B remains unadopted; Phases 2–3 remain unassigned; UDG-003 remains incomplete.

## 6. Evidence to retain

1. Exact commands and exit codes from §5, with test counts before and after, and the per-file test breakdown.
2. Per PA1 criterion: the test ids that decide it, and a machine-readable vector per deterministic case (inputs, expected disposition and code, expected `H`/`latchedKind`/`G_d` trajectory, expected step count) written to `artifacts/udg-003-phase-1/` during the run and summarised in the completion record.
3. The disposition reconciliation table per scenario (`consumed`, `refused:<reason>`, `answered`, `queued`, `observed`) proving AC-17's arithmetic and AC-3e's by-reason reporting.
4. The bounded-structure table: capacity, observed peak, counted evictions and drops per scenario.
5. The replay comparison: canonical state digest and tick hash chain tip for two independent runs plus the digest-stripped replay, all identical or the phase fails.
6. The T-1…T-8 traces as observed values, including both arrival orders where order must not matter.
7. The CI run id and conclusion, and the retained bundle's verification result.
8. A **Not measured / not claimed** section listing at least the §5 exclusions, plus: Gates A/B/C **Not Run**; `stackCompatibility` **not-established**; D-7 open and blocking transport acceptance; Part B not adopted; Phases 2–3 unassigned; UDG-003 **not** complete; no acknowledgement claim of any kind.
