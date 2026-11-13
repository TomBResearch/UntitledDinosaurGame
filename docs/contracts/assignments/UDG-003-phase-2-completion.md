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

## 12. The repair batch of 2026-11-13 — what it closed, at which head, and what it left exactly as hard

> **Renumbered 2026-11-13 (§14's commit).** This section and the one after it were added as "§8" and "§9"
> after §11 already existed, so the file carried two of each. The text below is unchanged; only the numbers
> moved, to 12 and 13, because a record that points at "§9" and means two different sections is not a record.


Phase 2 remains **In Review**, now carried at head `9d1372a91474d416cbd8c24d6d9849fa6388e936`; the
submission at `cf34987445f737d21285b8b1f5d6b650f85873b5` and its retained bundle under
`ci-run-43263252706/` are untouched (350 of 350 files re-hashed against the pre-batch snapshot). CI run
[43408391171](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43408391171) is
`success` on the new head, and its evidence is retained in a **new** run directory,
`/workspace/udg-evidence/ci-run-43408391171/`, whose UDG-003 bundle
`UDG-003-2026-11-13T10-28-48-335Z-9d1372a9` verifies **PASS, 0 issues** from the retained copy alongside
UDG-001 and UDG-002 (`report.json`: `phase phase-2`, `measurementsScope phase-1`, 177 hashed files). The
Phase 2 vector gate now reports **18** artefacts listed, hashed and attributable; Phase 1 still reports 15.

**R-1 closed the replay gap** (§6 item 1 of the matrix, GA-13, AC-3d, AC-20). The room's journal is now
replayed by a fresh process that starts no server and imports no `@colyseus/*` package, from bytes retained
in the bundle, against the three comparisons GA-13 names: dispositions, canonical state, per-tick chain
hashes through the tip. Six journals, six equal replays, six digest-blanked replays equal, six tampered
prologues refused, zero integrity issues, three negative controls per journal (a 1.5× stepper, an edited
disposition, a changed tip hash) so the equal sign is demonstrably falsifiable. Six of sixteen scenarios are
**not** replayed and are named with their reason: four have no authority surface at all (configuration
loading, telemetry, disposal) and two assert over a window their own watermark does not bound. That is why
**GA-13 is PARTIAL, not PASS** — the criterion says *every scenario*, and this record is not going to spend
a status on a denominator it quietly shrank. Transport-side facts (`retiredUnrepresented`, gap naming, close
code and window, `serverQueuedAtClose`) are recorded, never claimed as recomputed; §3.1 attributes eviction
to the enqueue attempt, and crediting the authority with the message-loss model is the conflation that clause
exists to prevent.

**R-2 (option A) and R-3 closed the two record defects** (D1, D2) as corrections, not as re-writes: the
Phase 1 measurement file keeps its `phase-1` label and the tool now gates the *pair* of labels
(`report.json.measurementsScope`), and `Room.setFixedTimestep` has an API-map row stating — with the pinned
declaration and four measured tick rates — that its second argument is a rate in Hz.

**H1 ran**, and it is the honest shape of AC-15's last half-sentence: historical bundles were verified with
the verifier built from **their own capture commit** (worktrees at `5d77c612`, `17ade43b`, `cf34987`), all
**PASS, 0 issues**, while the same `cf349874` bundle verified from this batch's tree returns **7 issues** —
three files missing, three unlisted, one command never run — because the Phase 2 required-file list moved
15 → 18. The plan moved; the retained bytes did not. **OD-5 is offered as (a): record the capture-plan
reading.** **H2 — a committed plan identity so `verify` need not be run from a worktree — is still a
proposal, and no line of it has been written.**

**What this batch did not touch, deliberately:** both GA-10 `Δ == 1` halves remain **FAIL** (OD-1);
GA-11 remains **FAIL** and W-10's RTT/jitter/loss populations remain unproduced (OD-2) — **R-4**, the seeded
client-side socket-impairment population, stays a **proposal the owner has not approved**, and no line of it
is written here; GA-1,
GA-5a/5b, GA-7, GA-9 remain PARTIAL; AC-1 and AC-3c remain FAIL; AC-6 remains PARTIAL (OD-4); `dedupeClosureEnabled`
stays `false` in hashed config; **D4 stays undesignated**; **Gate A stays Not Run**; `stackCompatibility`
stays **not-established**; no dependency was added (`pnpm-lock.yaml` is unchanged across this batch) and
nothing under `authority/**` was edited — the prologue R-1 needed was already public inside the accepted
core, which is the only reason the room could hand it over at all.

Two defects in the batch were caught by CI rather than locally, and they are recorded because a submission
that mentions only its own green is worth less than one that mentions its own red: the Phase 2 step re-ran
PR-14 without an invocation id and overwrote attributed probe bytes (`PROBE-INVOCATION-MISMATCH`, run
43404420159), and the replay's verdict went only to stderr, leaving an empty stdout log the capture refuses
(`EVIDENCE-FILE-EMPTY`). Both fixed on `9d1372a`, both now pinned by contract assertions so they cannot
quietly come back.

## 13. T-0 and the H1 sweep (2026-11-13, second sitting) — F-1, and AC-15 closed

Phase 2 remains **In Review**. This section records the second approved item, **T-0**, and the completed H1
sweep; it adds nothing to the W ledger and moves no gate. The evidence matrix §10 carries the full account;
what belongs in a completion record is the defect, the correction, and the two things the correction then
found.

**F-1, in one paragraph.** The room issues a new epoch per join and screens any frame that does not carry its
seat's epoch; the harness stamped a literal `sessionEpoch: 1` on every frame; and because ADR-0003 §4 makes a
refusal a *representation*, the refusal advanced `inputResolvedThrough` exactly as the policy demands. So the
retained population journal for `9d1372a` — counting client frames only (`kind: 'direct'`,
`origin: 'client-payload'`) — shows the three "compliant control" seats as **0 consumed / 60 refused**,
59 consumed / 1 refused, and **0 consumed / 60 refused**: only the room's first seat ever had a frame accepted,
while `abuse-results.json` reported all three as resolving everything they sent. The pressure and silent seats
were 0/12 and 0/5 refused. Every part of that was locally correct and the conclusion was wrong, which is why
the fix is an instrument change and not a wording change. The offenders' verdicts stood because retirement,
throttling and rate closure are all decided before the screen.

**T-0's instrument.** The harness now reads the issued epoch from the seat's own replica row (`issuedEpoch`),
every population send stamps that value, and each seat records the stamps it actually put on the wire.
`windowAccounting` joins the room's per-tick dequeued stamps to the authority's journalled dispositions in
FIFO order and reports consumed / refused / dropped-at-close / missing / duplicated / pairing-consistent /
stamp-collided / metres-moved per seat; `allSentStampsConsumed` is the only compliant-stream assertion left,
and no watermark carries a consumption claim anywhere in the suite. Contract guards forbid a `sessionEpoch:
<digit>` literal in the population script and name the accounting fields the pass conditions depend on.

**The control that makes it falsifiable.** `wrong-epoch-stream-fails-the-compliant-assertion`: two seats,
eight byte-identical frames each, differing only in epoch. Correct epoch → 8 consumed, 1.6 m moved, assertion
true. Epoch + 1 → 0 consumed, 8 refused, 0 m, assertion **false** — and `watermarkWouldHaveCalledItCompliant:
true` records that the pre-T-0 check still passed the refused seat. Measured post-T-0: control seats on
epochs 1/2/3, 60 sent / 60 consumed / 0 refused / 12.0 m each.

**Two things the honest instrument then found in scenarios that had been passing.**

1. The pressure seat had been arriving at ~800 frames/s against a declared ceiling of 30/s, and had escaped
   closure under F-1 only because the room never looked at its stream; with epochs fixed it closed with
   `4101` on its first T-0 run. It is now constructed inside the only band the hashed envelope leaves —
   drain λ·tickRate = 20/s < arrivals < ceiling 30/s — measured 21.85/s, peak server-side depth 14 against the
   line at 8, throttle latched, zero closures, zero retirements, 160/160 stamps consumed. The band arithmetic
   is written into the artefact, so a retune that leaves the band fails rather than mis-closes.
2. Unpaced bursts collide stamps (the SDK owns its counter; PR-15 S1 already recorded that a stamp equals the
   acknowledgement only while stamps and sends correspond 1:1). The rate and retiring-offender scenarios
   report `collidedStamps` 11 and 6, so per-stamp claims are refused for those seats and the counter is
   published; paced scenarios report 0.

**GA-2 and GA-3 were re-read against their own assertions, as asked.** Both PASS verdicts stand: what they
name is depth→throttle and eviction→closure arithmetic, which happens before the screen and is indifferent to
epoch validity. What was wrong was the wording. GA-2's "seat still seated and resolving afterwards" was never
verified and is replaced by the measured 160 consumed / 0 refused. GA-3's `consumedCountAtClose` is the
**accessor's dequeue count**, which includes frames the screen then refused — in the new run the retiring
offender has a nonzero dequeue count while **zero** of its stamps were accepted, a state that only the
corrected wording can describe. W-9's numbers moved to `6` queued / `7` dequeued with the accessor
demonstrably released at close, so its conclusion rests on the release rather than on a zero drain delta.

**AC-15 → PASS under H1, with the caveat kept beside it.** The method was run over the entire store: 151
bundle directories over 66 capture commits, each verified by the verifier built at its own commit — 144 PASS
with 0 issues, 7 refusals, every refusal a run retained *because* it was red. The first pass covered 150 of
151; reconciling the sweep list against a fresh scan of the store found one bundle retained under an early
`artifact/` subdirectory layout, and it was verified the same way at its own commit. The verifier verdict and
the captured run status are kept in **separate columns**, because they disagree in both directions: one bundle
verifies PASS while its captured status is FAIL (the check that refuses a red captured gate did not exist at
that commit), and two bundles captured PASS are refused by their own verifiers. The durable table is committed
at `docs/contracts/assignments/evidence/UDG-003-h1-sweep-2026-11-13.tsv` and copied, with the raw sweep
output, to `/workspace/udg-evidence/h1-sweep-2026-11-13/`; the sweep wrote no bundle, no `report.json` and no
inventory.

**F-2, recorded because clearing a ledger is exactly what the attribution gate exists to catch.** The H1
worktrees were first created inside the repository's own `artifacts/` directory, and PR-0's project scan
correctly failed on them (`outside approval: artifacts/h1-*/tsconfig.json`), leaving three `PR-0:fail`
entries in the local probe-invocation ledger that the R-7 gate rightly refused to let a later pass retire. The
worktrees now live at `/workspace/udg-h1-worktrees/`, outside every working tree; the local
`artifacts/probes/` ledger was deleted and rebuilt — gitignored scratch that CI never carries, holding failures
caused by directories this session had put in the repository, not by the commit under test.

**F-3, minor, and deliberately not fixed inside this run.** Each recovery room journals exactly one
`refused:epoch` whose frame carries `sessionEpoch: 1` while the seat's own journalled epoch is also 1 — the
first send after `join` landed before the room had bound the seat's epoch. Counting client frames only, the
four recovery rooms have **4, 2, 0 and 0** accepted frames, which is also why two of them still report
`wrongStepper: not-applicable-no-committed-motion`. GA-6's measured properties are client-rule properties
(deadline, episode, allowance) driven by deliveries, so nothing claimed there depends on acceptance; but the
recovery harness needs the same issued-epoch wait the population now has. That is **T-0b**, listed for
approval rather than slipped into a run whose bytes are already retained.

**Verification at the T-0 head** — `c1b2f9bbe52477dc3d5a1a2325fe85a108e640ee`, CI
[43435990922](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43435990922) **success**
(full suite on the hosted runner), retained at
`/workspace/udg-evidence/ci-run-43435990922/UDG-003-2026-11-13T13-50-47-729Z-c1b2f9bb`; all three bundles in
that directory verify **PASS, 0 issues** from the retained copies, with `PASS phase-1 vectors: 15` and
`PASS phase-2 vectors: 18`. Locally: typecheck, lint, boundaries (72 files, 0 violations), fixtures,
dependencies and checksums green; contracts UDG-003 105/105; phase-2 vectors 9/9; runtime suite 5/5;
population 12/12 scenarios; recovery 4/4; PR-14 27 checks; replay 6/6 journals equal on dispositions,
canonical state and chain tip, with 17 scenarios accounted for (11 replayed, 2 window-attributable, 4 with no
authority surface). Invariants: `apps/server/src/authority/**`, `pnpm-lock.yaml`, the package
manifests and `packages/config/src/**` are unchanged across this batch, so `configHash`, `movementHash` and
`regionHash` did not move; the Phase 2 artefact list stays at **18** — the T-1…T-4 proposal would move it to
24 (25 if the projection artefact is split) and is recorded, artefact by artefact with the gate that refuses
each one, at matrix §10.10, **pending**; `dedupeClosureEnabled` stays `false`;
D4 stays undesignated; Gate A stays Not Run; GA-10 stays FAIL; GA-11 stays FAIL; AC-6 stays PARTIAL; AC-1 and
AC-3c stay FAIL until T-1 and T-2 are approved.

> **Dated correction (same day, §14).** Every conditional in that last clause has since been decided and
> executed: OD-8 and OD-9 were approved, T-0b and T-1…T-4 were implemented, the Phase 2 artefact list moved
> **18 → 24**, and AC-1 and AC-3c moved to PASS. The paragraph above is left exactly as it read at the T-0
> head; §14 records the move and its own invariants.

## 14. T-0b and T-1…T-4 (2026-11-13, third sitting) — the criteria measure what they claim

Phase 2 remains **In Review**. This sitting implemented what the owner approved after §13: **T-0b** (the
recovery half of the F-3 fix), **T-1**, **T-2**, **T-3**, **T-4**, plus the rulings **OD-8** (AC-1's evidence
producer lives under `tests/reference/`) and **OD-9** (six new artefacts). Matrix §11 carries the account with
its numbers; what a completion record owes is the head, the defect class, and the invariants.

**Heads.** `c7e497b6b367f2d2b95c67394abfcf612336fdd2` implemented the batch; its CI run
[43455499702](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43455499702)
**failed** on `EVIDENCE-FILE-EMPTY logs/phase-2-reference-trace.stdout.log` — both new capture steps wrote
their summary to stderr, which the capture runner legitimately allows to be empty, while the record stream it
refuses to leave blank is stdout. `cfc49664f3cb8dca95ddfa86bcae82e0fdc8a94c` obeys the rule and its run
[43458461044](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43458461044) is **success**.
The failed run is retained as the failure it is; no attempt was deleted and no rule was loosened.

**Retained evidence.** `/workspace/udg-evidence/ci-run-43458461044/UDG-003-2026-11-13T16-09-49-380Z-cfc49664`
— `report.json` sha256 `56a0219837a982a0745f0c822212e3537f6485c862b9c70d31453cccfb594b24`,
`vectors-phase-2/vectors-manifest.json` sha256 `768e487308e1bb7213dee9b3c31ef2a00afaf0d644635ce645d27c9a41cd3aae`,
187 hashed files. All three bundles of that run verify `PASS (0 issues)` from the retained copies; the phase-2
gate reads `PASS phase-2 vectors: 24 artefact(s) listed, hashed and attributable` and phase 1 still reads 15.
The whole-store digest taken before the download against after: 0 files changed, 0 removed, 363 added — every
earlier bundle, including `cf34987`, `9d1372a` and `c1b2f9b`, is byte-identical to what it was.

**The defect class this sitting chased, once, in one sentence.** A check that reads a *representation* of
progress instead of the *fact* of acceptance will report success for a stream the server refused; F-1 was that
in the abuse population, F-3/T-0b was the same in the recovery harness, and T-2's travel budget would have
been its third instance had the denominator stayed "frames sent" rather than "stamps accepted". All three are
now measured against journal dispositions joined to the stamps actually put on the wire, through one shared
accounting module rather than three copies of a rule.

**What each item produced, in one line each.** T-0b: every recovery seat waits for the room-issued epoch, and
accepted input is asserted per scenario (5 / 3 / 1 stamps consumed, 0 refused; two rejoin domains each recorded
accepted, measured while their own room was still live). T-1: `tests/reference/flat-direct-step.ts`, 200 ticks,
Σ from the trace's own rows `40.00000000000003` m (|error| 2.842e-14), labelled reset segments excluded, 7/7
controls. T-2: per-tick bound `0.200001` m over 355 accepted ticks (8 refused and 1 800 no-input ticks
classified separately), 0 out-of-bound, 9 seats inside a travel budget denominated in accepted stamps, 4/4
controls. T-3: the `B = 8` burst proven by the room's own post-drain depth series `7,6,5,4,3,2,1,0` plus direct
co-presence at depth 8 with zero consumed, 0 retirements, watermark 8 at rest, no signal, no closure. T-4:
projections identical solo and among offenders under asserted equivalence preconditions, observer trace
identical byte-for-byte against a clean control, ordinals compared as growth only, 4 rooms confirmed by census.
GA-13: three shared-journal windows verified by recomputation from the retained rows; four no-authority
scenarios still listed and still not counted as replayed.

**Verdicts moved:** AC-1 FAIL → **PASS**, AC-3c FAIL → **PASS**, AC-7 PARTIAL → **PASS**, GA-9 PARTIAL →
**PASS**. **Unmoved:** GA-1 and GA-13 stay PARTIAL, GA-10 and GA-11/W-10 stay FAIL, AC-6 stays PARTIAL,
GA-12 and PE-1…PE-5 stay NOT PASSED (reported), Gate A stays **Not Run**, D4 stays undesignated.

**Invariants.** Local: typecheck, lint, boundaries, fixtures, dependencies, checksums (65 files, 0 changes)
green; full suite **28 files / 568 tests** passed (was 557); contracts UDG-003 105/105, UDG-001+002 80/80;
phase-2 vectors 10/10; runtime suite 10/10; population 14/14 scenarios; recovery 4/4; PR-14 27 checks; replay
6/6 journals. `apps/server/src/authority/**` unchanged since `96d3df6`; `pnpm-lock.yaml` and every package
manifest unchanged; no protocol surface change; `configHash` stays
`2743a9a047ce7264833af88e8bd2f8aeea970a45e306a348e1fe0654191bec7a`. One server file gained five read-only lines
(`RegionRoom.ts`) exposing the telemetry window the per-seat depth rows are read from; no admission, authority
or transition code changed. `dedupeClosureEnabled` stays `false`; GA-10 stays FAIL; R-4 and H2 remain
unimplemented proposals; OD-1…OD-5, OD-7 and OD-10 remain the owner's to decide. OD-6, OD-8 and OD-9 are
closed.

## 15. OD-10 applied (2026-11-13, fourth sitting) — coverage rule, gaps reported, no promotion

Phase 2 remains **In Review**, and the owner's acceptance of the T-0b…T-4 batch (`cfc49664`, CI 43458461044)
came with one ruling attached and executed here: **OD-10**. Implementation head
`a9116e0359e77905a0712702f249a561e7954d5e`, CI
[43481796058](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43481796058) **success**,
retained at `/workspace/udg-evidence/ci-run-43481796058/UDG-003-2026-11-13T18-30-09-607Z-a9116e03`
(`report.json` sha256 `cf0adb64bd38f8b404935fef31a7dd3386c90105e033ef515ea0797a34a869e4`,
manifest sha256 `a735a96d8129b3717667885133f0b19903cbb0296d53995dded97eab6641b3a7`, 187 hashed files, all three
bundles of the run `PASS, 0 issues`, phase-2 gate 24 artefacts). No artefact-list change: the burst room's
journal went into `journal-population.json` as `additionalJournals`, not into a twenty-fifth file.

**What the rule required, and what was done.** Every authority-bearing scenario replayed from retained inputs
with its seat × tick × stamp × disposition window **recomputed** from the rows by the replay rather than
trusted from the producer; every no-authority scenario given scenario-specific evidence that it entered no
authority path and produced no authority state or effects, kept visible in the census and counted as **zero**
replays. Result: 7 journals replayed, 19 scenarios accounted for, 15 authority (8 with a verified window, 2
with a named gap, 5 from single-scenario journals), 4 no-authority (4 verified, 0 without evidence,
`noAuthorityCountedAsReplays: 0`), `falseClaims: []`.

**What applying it found.** Three things the previous census could not see: staging row ranges are not
attribution (the retiring offender's frames are journalled in the *next* scenario's range); alias strings are
per-room counters and collide across rooms, so a window without its journal silently joins two entities; and
the `B = 8` burst was being counted as "replayed in the room journal" while its own room's journal was not
retained at all. All three are now impossible to overlook: windows carry their journal, ranges cross-check
with the disagreement counted, and the burst replays from its own 58 rows.

**Gaps reported, not promoted.** `retired-offender-closes-in-bounded-window` cannot be replay-attributed
because an evicted frame is retired before it is ever represented, so there is no row for it;
`offenders-never-touch-the-compliant-population` has no frame of its own in its window by construction and is
verified for the absence of refusals and closures instead. **GA-13 stays PARTIAL** on the first of those:
fourteen of fifteen authority scenarios are attributed exactly, and the owner, not this batch, decides whether
"a frame never represented has nothing to replay" completes the criterion.

**A gap is not a false claim.** The artefact fails on bytes that contradict their own summary and reports gaps
as gaps, because a single red word would hide which short is which.

**Still pending after this sitting:** implementation scope generally, dedupe-triggered closure, D4, and Phase 2
acceptance — none of which this sitting touched. **OD-6, OD-8, OD-9, OD-10** are closed; **OD-1…OD-5** are
answered in matrix §13–§14 with a recommendation each and await the owner's ruling.

**Invariants.** `apps/server/src/authority/**` unchanged since `96d3df6`; `pnpm-lock.yaml` and the package
manifests unchanged; no protocol change; `configHash` stays
`2743a9a047ce7264833af88e8bd2f8aeea970a45e306a348e1fe0654191bec7a`; `dedupeClosureEnabled` stays `false`;
Gate A stays **Not Run**; GA-10 and GA-11 stay FAIL; AC-6 stays PARTIAL; GA-12 and PE-1…PE-5 stay NOT PASSED
(reported). Evidence work only, in `tests/**`: no production source changed in this sitting. Local: full suite
28 files / 568 tests, contracts UDG-003 105/105, runtime 10/10, population 14/14, recovery 4/4, PR-14 27
checks, replay 7/7. Whole-store digest before the download against after: 0 changed, 0 removed, 363 added.

## 16. Decision record and test plan for what remains (2026-11-13, fifth sitting) — proposal only

Phase 2 remains **In Review**. The owner answered OD-1…OD-5 and authorised the decision record and test plan,
not the implementation. The record is
**[UDG-003-phase-2-amendment-and-test-plan.md](UDG-003-phase-2-amendment-and-test-plan.md)**: proposed clause
text for ADR-0003 §5 (GA-10 split into GA-10 / GA-10a / GA-10b, the Gate A pass paragraph amended so Gate A can
run at its own prerequisites, §5's preamble and the GA-11 row scoped to named impairment sources), for
UDG-007's acceptance section (both `Δ == 1` halves plus the discrete queue limits, which Phase 2 measured as
`discreteHighWater 0` because no discrete traffic exists), for UDG-SPIKE-001's Gate A acceptance section (the
two inequalities evaluated on measured values), for assignment W-10 (the word "loss" scoped to what the harness
can honestly do), for assignment §9, and for AC-6 if the owner moves `M`/`P` rather than accepting the room's
mapping as those stages.

**Nothing in it has been applied.** No governing file has been edited, no ledgered digest has moved, and no P-batch
test line exists. Two ledgered digests (`docs/adr/0003-…-policy.md`, `docs/contracts/UDG-007.md`,
`docs/contracts/UDG-SPIKE-001.md`) will move when — and only when — the owner approves and applies them, and the
assignment edit at the `17ade43b`-pinned version must be disclosed for the same reason §8.2.1's was.

Facts the sitting measured rather than assumed, all recorded in the plan: the Gate A prerequisite chain
(UDG-SPIKE-001 requires UDG-003 and UDG-004 only) is what makes GA-10 un-runnable as written; `ws` is not
resolvable from `apps/server` under the pinned strict layout, so an impairment proxy would be a dependency
change and a per-seat wrapper around the SDK's own `connection.transport` / `connection.events` is not; network
loss needs `NET_ADMIN` the hosted runner does not grant, so the harness layer's drops must be labelled as
withheld deliveries with the head-of-line-blocking discriminator recorded; the authority queue's high water (max
**1**) and the transport queue's depth (max **8**) are different queues; `P`'s "results" half has nothing to
publish because every retained seat reports `effectCount: 0`.

**Batch offered for approval, in order P-3 → P-1 → P-2 → P-4** (+ P-5 records): artefacts 24 → **27**, two new
CI capture steps writing their summaries to **stdout**, contract-test count 24 → 27, and no change to
production source, `authority/**`, the dependency set, the protocol, `configHash`
`2743a9a047ce7264833af88e8bd2f8aeea970a45e306a348e1fe0654191bec7a`, `dedupeClosureEnabled: false`, Gate A
**Not Run**, D4 undesignated, GA-10 and GA-11 FAIL, GA-12 and PE-1…PE-5 NOT PASSED, AC-6 PARTIAL. Phase 2
acceptance stays with the owner.

---

## 17. The amendments applied and the P-batch executed (2026-11-13, sixth sitting)

The owner accepted the §16 plan with five rulings — OD-1 keep the measured zero-effect half here and move
GA-10a/GA-10b to UDG-007 acceptance; OD-2 approve W-10's amended form and the bounded impairment layer,
labelled; OD-3 separate the replay and transport verdicts and keep what the bytes cannot settle unverified;
OD-4 accept the server's canonical-to-replica mapping as `M` and record the navigation-result half as
outstanding under UDG-007; OD-5 leave AC-15 PASS under H1 and defer H2 and P-2b — and approved the batch
**P-3 → P-1 → P-2 → P-4 → P-5**.

**Chain.** `f0b2adb8` applied the clauses (three ledgered digests moved, sixty-five tracked).
`16d356d48ce89805c77146f07b470029f9c8afb8` is the batch. `8db422628b8f582a82429407702dbcc5dbd3ca74` corrects
two experiments that CI caught measuring themselves. Records follow at `{{RECORDS}}`, with CI run
`{{CI_RUN}}` and bundle `{{BUNDLE}}` verified as `{{VERIFY}}`.

**What the batch added to the record.** A criterion split that names its owner (GA-10a/GA-10b at UDG-007,
GA-11 and both production inequalities at UDG-SPIKE-001, the client-side deadline at UDG-008). An artefact
for each of the four work items, each with failing controls rather than narrative. A coverage rule with two
new classes, one of which — `authority-absence-accounted` — exists specifically so that an absence can be
reported without being promoted into a replay. And four residues on GA-13 that stay unverified because the
retained bytes do not settle them, pinned by name in the runtime suite so that losing one is a test failure
rather than an improvement.

**What the batch changed about how it was written.** Two of its own experiments were wrong in ways that
only a slower machine showed: a withhold window that slept and therefore stalled the input it was meant to
observe, and a delay control built on a tick-quantised figure that passed or failed on where the send
landed relative to a tick boundary. Both are now stated as the property rather than as a millisecond band,
and both scripts write their false checks and their numbers to stderr, because a retained log that says
only `exit 2` is not evidence of anything.

**Decisions closed.** OD-1, OD-2, OD-3, OD-4, OD-5, OD-8, OD-9, OD-10.

**What is still owed, and by whom.**

| Owed | Owner | Note |
|---|---|---|
| GA-10a, GA-10b | UDG-007 acceptance | outstanding, never passable here |
| Both GA-11 inequalities, production values, runner-capability note | UDG-SPIKE-001 (Gate A) | Phase 2 records populations only |
| Discrete queue limits 8/entity and 64/room | UDG-007 | needs discrete traffic that does not exist here |
| Eviction consequence at production envelope | UDG-SPIKE-001 | §5 rule 7 keeps values provisional |
| Results half of `P`; AC-6 to a whole-sequence verdict | UDG-007, then the owner | AC-6 is PARTIAL and `qualified-pending-owner` |
| GA-6a/6b, GA-7 (withheld publication) | Gate A, or P-2b if the owner reopens it | deferred by OD-5 |
| GA-12, PE-1 … PE-5 | unchanged | not passed |
| D4, dedupe-triggered closure, Gate A | owner / UDG-SPIKE-001 | open, disabled, Not Run |

Phase 2 remains **In Review**. Nothing in this sitting accepted, closed or gated it.
