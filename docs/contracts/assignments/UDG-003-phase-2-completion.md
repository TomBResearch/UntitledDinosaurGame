# UDG-003 Phase 2 completion — transport substrate, input envelope, and the ADR-0003 consequences

> Assignment: [UDG-003-phase-2.md](UDG-003-phase-2.md) (version pinned at handoff commit
> `17ade43be0a64935cb2e06be02ebbe9756f6eb6f`, including §8.2.1, its adoption record, and the amended
> ADR-0003). Implementation baseline: `8716b8c6e3c4a3f005fe260eebf5569bb02201dd`.
> **Status: In Review.** Submitted by the agent implementer on 2026-11-12. No reviewer acceptance is
> recorded here, none is implied, and nothing in this file is a gate decision. UDG-003 remains
> **In Progress**; Phase 3 remains unassigned. Acceptance belongs to the owner.

## 1. What Phase 2 was, in one paragraph

Phase 2 put the accepted Phase 1 authority on the pinned third-party transport and gave it the
obligations ADR-0003 had already chosen: the per-frame send sequence and its two closed sets, the
disposition record and effect ledger published beside the canonical row, the hashed input envelope,
`RegionRoom` and `ColyseusInputAdapter` as production code on the accepted core, the §3.3 signals
with their §3.3 consequences, the bounded closure with its three separately-recorded numbers, the
client recovery rules written so they can be executed rather than quoted, the Gate A substrate
probe the reserved slot existed for, and an adversarial population that had to leave a compliant
control untouched. It is **not** a production client (UDG-008), **not** formal Gate A
(UDG-SPIKE-001), **not** navigation (UDG-007), and it produces no compatibility claim:
`stackCompatibility` remains `not-established` and the suite asserts it.

## 2. What was built

| Surface | Owns |
| --- | --- |
| `packages/protocol` — `DirectInputSchema.seq`, `DIRECT_WIRE_FRAME_FIELDS`, `validateDirectWireFrame`, `coreFrameOfWireFrame`, `PlayerSchema` disposition fields (17 → 23), `applyDisposition` / `readDisposition`, `RESERVED_CLOSE_CODES` 4100/4101/4102, `INPUT_SEQ_MIN/MAX` | the wire shape, its projection, and the record beside the canonical row (W-2) |
| `packages/config/src/input.ts` | the hashed envelope block: λ, B, J, closure bounds, `G`, the two client deadlines, the rolling rejoin allowance and ladder, the three close codes, the rate ceiling, `dedupeClosureEnabled: false` — with the relational checks that make the block one policy (W-3) |
| `apps/server/src/network/ColyseusInputAdapter.ts` | `SessionInputState`: domain snapshot at join/rejoin, the §3.1 subtraction with the around-`next()` sampling order, gap naming, watermark, pressure latch, strand streak, the trailing-window rate measurement, the three close observations (W-5) |
| `apps/server/src/rooms/RegionRoom.ts` | hash gate via `screenJoin`, UDG-owned epochs, one observation per entity per tick, wire validation → five-field projection, the consequence table (pressure throttles; retired closes 4100 in the bounded window with one forced final publication; rate closes 4101 directly; strand has **no closure branch**), the GA-10 ledger keyed by `(epoch, requestId)`, operator deployment behind a per-process nonce, journal sink, tick telemetry (W-4/W-5/W-6) |
| `apps/server/src/network/join-validation.ts`, `movement/MovementAuthorityAdapter.ts`, `state/map-player.ts`, `telemetry/tick-metrics.ts`, `lifecycle/DevelopmentSessions.ts`, `server-config.ts`, `main.ts` | the join screen and epoch issuer, the binding of the accepted core to the room’s cadence, explicit disposition publication beside the canonical copy, bounded telemetry, the bounded reconnect window, config loading that refuses to invent region bounds (W-4/W-11) |
| `tests/support/client-harness/transport.mjs` + `recovery.ts` | the test-only client harness (pinned-stack resolution exactly as `apps/server` resolves it, shutdown that cannot `process.exit` over evidence) and the executable frozen rules R-A…R-E — UDG-008’s hand-off (W-7) |
| `tests/probes/pr14-gate-a.probe.ts` | 24 checks on the real room, real replicated state, accepted authority, flat reference step — the Gate A **substrate**, not the gate (W-8) |
| `tests/runtime/udg-003-phase-2/abuse-population.ts`, `recovery-scenarios.ts` | the compliant control population with four offender classes, the W-9 close-path measurement, and the three live limit scenarios (W-9/W-10) |
| `tests/unit/udg-003-phase-2/vectors.test.ts`, `tests/system/udg-003-phase-2/runtime.test.ts` | nine pure vectors, the fifteen-artefact manifest that refuses a half-run, and the runtime suites inside `pnpm test` (W-12) |

## 3. The W ledger

| Item | Delivered as | Commit |
| --- | --- | --- |
| W-1 | ADR-0003 §4 acknowledgement clause applied to movement-authority §5.1 byte-for-byte; contract assertions; checksums re-pinned | `7f03be1` |
| W-2 | `seq` on the wire, two closed sets, one projection; disposition record and effect ledger; reserved close codes; protocol-v1 §6.5/§6.6 | `aea0ce3` |
| W-3 | hashed envelope block with relational validation; `configHash` moves under the owner’s D-P2-4 condition | `aea0ce3` |
| W-4 | `RegionRoom`, join validation, epoch ownership, production authority binding | `26bcd03` |
| W-5 | `ColyseusInputAdapter`, per-tick FIFO observation, consequence table | `26bcd03`, `190a5a6` |
| W-6 | consequences with evidence that pressure alone never closes; **PE-1…PE-5 determination: not passed** (§6 below); strand stays diagnostic and cannot close | `190a5a6` |
| W-7 | executable frozen rules R-A…R-E + live scenarios S1–S4 including **each of the three limits**; `recovery-harness.json`; hand-off statement for UDG-008 | `190a5a6`, `95e1dbd` |
| W-8 | PR-14: 24 checks, substrate only, formal gate left to UDG-SPIKE-001 | `3ad1a46`, `99da1cd` |
| W-9 | measured, not assumed (§5 below) | `190a5a6` |
| W-10 | population with compliant controls: `abuse-results.json` (11/11), `buffer-depth.csv`, `room-lifecycle.json` | `190a5a6` |
| W-11 | tick telemetry, disposal, real smoke (`config-smoke`, unbounded refusal), CI steps, capture plan moved to phase-2 exactly as §8.2.1 authorises | `95e1dbd` |
| W-12 | fifteen artefacts + manifest + gate; digests committed with the record; the plan requires both phases’ sets | `95e1dbd` |

## 4. Defects the phase found live, and where each was fixed

Every one of these was observed on the real substrate before it was fixed; none was theorised.

1. **Sampling order is part of the retirement identity.** Reading `consumedCount` only *before*
   `next()` charges the next tick with this tick’s frame and invents a retirement on the first
   frame. The adopted code samples around `next()`; the wrong order’s arithmetic is recorded in
   `retirement-arithmetic.json` (live, 2026-11-12).
2. **`setFixedTimestep` takes a frequency, not an interval.** The room passed
   `simulationStepSeconds * 1000` and ticked at ~55 Hz — draining the buffer two and a half times
   faster than the §2 envelope’s λ, making queue depth unobservable at the declared pressure line
   at any sender pace. Fixed to `tickRate`; the pressure scenario now builds depth in ~180 ms.
3. **A rate signal that counts ticks cannot exceed the tick rate.** The first rate model counted
   observing ticks per second — capped at 20/s at 20 Hz, so no declared ceiling could ever fire.
   Arrivals are now differenced across a trailing one-second window with a 250 ms span rule
   (bursts stay a buffer case). The 50/s scenario closes with 4101; the 20/s population never sees
   the signal.
4. **`closeSeat` closed nothing completely.** It sampled no §3.1 close observations (leaving W-9
   unanswerable) and never released the entity — the authority kept a phantom seated entity behind
   the removed row. Closures now sample their three numbers and journal the leave.
5. **Refused rooms registered as live zombies.** A room refused at create (no operator bounds) had
   already joined the live registry, and `evidence()` answered `TypeError`. Registration now
   follows construction, refused rooms report `{refused: true}` — and the refusal itself is an
   asserted scenario (`unbounded-room-refuses-the-seat`).
6. **`create` makes a new room.** A plain-create “population” was six rooms with one seat each and
   every neighbour assertion vacuous (`liveRoomCount 6`). The population now shares one room by id
   — which is what GA-12’s control population means.
7. **PR-15’s controlled-gap window was not controlled.** It held the step gate for two loopback
   messages and asserted a step had been withheld — the §7 failure mode, surfaced as a real false
   failure under probe load. The construction now waits for a withheld step; no assertion moved.
8. **Escape-hatch casts crept into new code** (`as unknown as` in `map-player.ts`, an `as unknown`
   in config loading, a `RegisteredHandler` shortcut). Phase 1’s prohibition is a rule for all
   repository code; the copies are explicit field-by-field now and PR-0’s scan confirms it.
9. **The pinned `gracefullyShutdown(true)` ends in `process.exit`** and can end a probe before its
   evidence is written; the harness shuts down without it and writes evidence before shutdown
   regardless.
10. **`gracefullyShutdown` waits for rooms that never empty** (`autoDispose = false` by design).
    The harness races its own close with a bounded wait rather than outliving its evidence.

## 5. W-9 — the close-path accounting, measured

The question ADR-0003 §3.1 left open: do frames still buffered when a seat closes advance the
consumed count, and must `serverQueuedAtClose` therefore enter the retirement total?

Measured on a rate-closed seat with **7 frames still queued** and `consumedCountAtClose` 6: across
the closure window the queue is destroyed with the accessor and advances nothing — a post-close
read returns a released accessor whose counter no longer exists. Frames buffered when a seat closes
are **neither retirement nor consumption**: they are residue destroyed at close. `serverQueuedAtClose`
therefore **must not** enter the retirement total; it is the diagnostic the adopted §3.1 note says
it is, and the close-side total is `retiredUnrepresented` alone.

Construction honesty: the retiring offender’s queue was measured at zero at close twice (eviction
plus drain beat the window); that construction is recorded as unable to answer the question rather
than used to answer it. Artefact: `close-path-accounting.json`.

## 6. W-6 — the PE determination, reported as the negative it is

**PE-1…PE-5: not passed** (`pe-determination.json`, per-criterion reasons). The false-positive rate
of the dedupe signature on compliant traffic has not been bounded on any production-representative
delivery population; loopback scenarios cannot bound it, and PE-2 exists precisely to refuse a
convenient “validation succeeded”. Consequences, all shipped as facts rather than intentions:
`dedupeClosureEnabled: false` in hashed configuration; the room’s consequence table has **no
closure branch** for the strand signature (asserted against the emitted production code, not the
source prose); the signal stays diagnostic and client-local recovery remains the only remedy.
D-P2-6 stays open by design; what would change it is GA-12 evidence, named in the artefact.

## 7. Digests, and every assertion that legitimately moved (§6 discipline)

| Pin | Baseline (`8716b8c`) | Phase 2 | Moved under |
| --- | --- | --- | --- |
| `configHash` (defaults) | `948f8c10142239a2f3118795e8afa71a749ed09b316961b671d9b915d024cb01` | `2743a9a047ce7264833af88e8bd2f8aeea970a45e306a348e1fe0654191bec7a` | D-P2-4 approval of the W-3 block; §6.1 one disclosed change |
| `movementHash` | `c80f61d451eaf9ee7dc2804ba04f1794e2e0149ac33647932dd14852edf522ce` | unchanged | §6.6 — it did not move and the vectors assert it |
| `regionHash` | `0276d99fad197dea3e42421096b52f9f80855e459eb33277e8986ad8fa8f853f` | unchanged | §6.6 |
| `tests/fixtures/protocol/valid.json` | `47f058a1…` | `b77743a4dfed…` | W-2’s six-field direct input + disposition fields; re-pinned with the bytes, same commit |
| `…/malformed.json` | `8d13a931…` | `10a2a424838a…` | same |
| `…/ordering.json` | `c61c060f…` | `5d55801dafda…` | same |

Assertions that moved, with the clause that moved them (all owner-approved via D-P2-3/D-P2-4):

| Assertion | Was | Now | Clause |
| --- | --- | --- | --- |
| `DIRECT_INPUT_FIELDS.length` (schema-roundtrip) | 5 | 6 | protocol-v1 §6.5 two closed sets |
| `PLAYER_FIELDS.length` (schema-roundtrip) | 17 | 23 | protocol-v1 §6.5 disposition fields |
| `DIRECT_INPUT_FIELDS` toEqual (UDG-002 suite) | five names | six (adds `seq`) | same |
| PR-0 `input-field-count` | 5 | 6 | same |
| PR-3 declaration expectation | five fields | six (adds `seq`) | same |
| config reordered-document fixture (config.test) | no `input` block | includes the envelope | W-3 hashed block |
| UDG-003 suite probe list | 8 ids, PR-14 absent | 9 ids | W-8 filling the reserved slot; the Phase 0 absence assertion was correct for every pre-W-8 record and stands unrewritten (R-1) |
| PR-15 S2a construction | uncontrolled window | waits for a withheld step | §7 property 2 — construction fixed, **no assertion moved** |

No UDG-002 assertion was relaxed: malformed payloads still refuse, out-of-order still refuses, and
`pnpm test:fixtures` refuses stale digests (§6.5 checked by running it).

## 8. Machine-readable vectors (`artifacts/udg-003-phase-2/`, digests in `vectors-manifest.json`)

`envelope-hashes.json` · `stamped-seq-roundtrip.json` · `retirement-arithmetic.json` ·
`disposition-record.json` · `consequence-handling.json` · `input-overflow.json` ·
`input-reconciliation.json` · `strand-and-dedupe-policy.json` · `pe-determination.json` ·
`close-path-accounting.json` · `recovery-harness.json` · `abuse-results.json` ·
`buffer-depth.csv` · `room-lifecycle.json` · `tick-metrics.json`

The manifest carries the §6.4 baseline-to-digest table and the producing commit; the gate keeps its
own fifteen-file list (`PHASE_2_VECTOR_FILES`) and the suite imports it instead of restating it;
the manifest refuses to be written when any runtime artefact is absent or failing. GA coverage per
artefact is inside each file’s `criterion` field (GA-1, GA-2, GA-3, GA-4, GA-6, GA-7, GA-9, GA-12
as applicable; GA-5/GA-8/GA-10 are UDG-007/UDG-008 subjects and this record says so rather than
claiming them).

## 9. What Phase 2 did not do

- No production client, no client-side recovery in `apps/client`, no `apps/client` import of the
  harness (asserted); recovery rules live in test support until UDG-008 adopts them.
- No formal Gate A, no GA-11 measurements: every envelope number is a provisional test setting and
  says so in the same sentence as its value; UDG-SPIKE-001 runs the gate.
- No navigation or routes: M0 refuses discrete commands, so GA-10’s committed-identity half
  (`Δ == 1`) is **not producible in this substrate** and PR-14 records the M0-expressible halves
  (abandoned identity charges 0; re-answer charges 0) instead of quietly dropping the criterion.
- No Gate B/C, no `stackCompatibility` claim, no D4 designation, no new storage/release/archive.
- Loopback, one server process, one room: RTT, packet loss, and cross-process desynchronisation
  remain unmeasurable here; duplicate/reordered CONTINUOUS stamps are not constructible through
  the SDK send path (the SDK owns the stamp); their server-side halves are measured as
  discrete-identity replay idempotence.

## 10. Decisions the owner still owes

1. **Acceptance of this phase** — the only decision this record asks for.
2. **D4** remains undesignated, as instructed.
3. **D-P2-6** stays open: PE-1…PE-5 are not passed on today’s evidence; enabling dedupe-triggered
   closure later is the owner’s call against GA-12 evidence, not this record’s.
4. The GA-10 committed-identity half waits on UDG-007 routes; if the owner wants it inside the
   Gate A criteria as written, that is a sequencing decision about UDG-007, not a Phase 2 gap.

## 11. Commits, commands, CI, retained evidence

Implementation commits (baseline `8716b8c`, handoff `17ade43`): `7f03be1` (W-1) · `aea0ce3`
(W-2/W-3) · `26bcd03` (W-4/W-5) · `3ad1a46` (W-8) · `99da1cd` (W-8 corrections) · `190a5a6`
(W-6…W-10) · `95e1dbd` (W-11/W-12) · `4e389f5` (this record) · `dcae4ec` · `cf34987` (the CI run’s
findings). §8.1 commands were run locally with results recorded in the submission message and CI;
the Phase 2 bundle is the phase-2-labelled capture of `cf34987445f737d21285b8b1f5d6b650f85873b5`,
retained at `/workspace/udg-evidence/ci-run-43263252706/` and re-verified `PASS` (0 issues) from the
retained copy; nothing earlier is rewritten (R-1).

**Added 2026-11-12, review basis (dated addition; §6.3: new facts go in new records).** The
per-criterion index the reviewer asked for is
[UDG-003-phase-2-evidence-matrix.md](UDG-003-phase-2-evidence-matrix.md). It maps GA-1…GA-13 and
AC-1…AC-20 onto artefacts inside the retained bundle, and it corrects two things this record said too
smoothly: **GA-10 is FAIL** (both `Δ == 1` halves are unproduced, not only the committed-identity
half, because M0 refuses every discrete command until UDG-007), and **W-10 is incomplete** on its
RTT, jitter and loss populations, which is why **GA-11 is FAIL** rather than merely deferred. It also
lists the gaps with **no deferral clause** (Phase 2 journal replay for GA-13/AC-3d/AC-20, the GA-9
projection instrument behind AC-7, AC-1’s 200-tick trace, AC-3c over the population, AC-3b’s discrete
high-water marks, AC-3e’s per-reason reporting shape), two record defects found in this batch, and
one measured consequence of the §8.2.1 plan move: `evidence verify` is plan-relative, so the handoff
bundle `UDG-003-…-17ade43b` verifies **PASS at `17ade43` and at `190a5a6`** and **FAIL here** (23 issues,
all `vectors-phase-2/… absent` / `phase-2-* never run`), while the accepted Phase 1 bundle fails even at
`190a5a6` (2 `probes/` requirements added after it was captured) — i.e. the mechanism predates Phase 2
and this phase’s move pushed the boundary back one commit. What is measured true is that the three
bundles of run 43263252706 verify PASS, 0 issues from the retained copies. Nothing was re-captured or
edited to change a colour. Nothing in that file moves a status upward:
dedupe-triggered closure stays disabled, D4 stays undesignated, Gate A stays Not Run, and acceptance
stays with the owner.
