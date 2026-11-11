# ADR-P-0003 proposal — D-7: input acknowledgement, overflow and resynchronisation policy

Status: **Proposed. This document assigns no work, amends no contract clause, adopts nothing and opens no phase.**
It is a decision paper for owner review of **D-7**, which remains **open**. Phase 2 and Phase 3 remain **unassigned**;
Gates A, B and C remain **Not Run**; `stackCompatibility` remains **not-established**. UDG-003 remains **In Progress**,
with Phase 1 accepted at phase level on 2026-11-11 at `5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c`.

Two probes carry its evidence: **PR-8** (15 checks) and **PR-13** (20 checks) from Phase 0, and **PR-15** (27 checks,
`pass`) added for this decision — input identity, gap visibility, client observability and acknowledgement/state pairing,
measured on the same pins. PR-15 answers the four implementation questions the owner raised on the first draft; §9–§12
are those answers and §13 is the single consolidated wording that results from them. **PR-14 remains reserved** for the
Gate A real-state probe in §11.3, and the contract suite asserts that absence.

It continues the work of [ADR-P-0002 Part B](UDG-003-compiler-exception-and-input-backlog-posture.md) and its
replacement, the [input-consumption rule proposal](UDG-003-input-consumption-rule.md). That document answered "may the
one-input rule be relaxed?"; this one answers the remaining question, "what transport policy makes the acknowledgement
honest, and what must the client do when it cannot be?". The two are consistent: **no relaxation is recommended here
either.** Every measurement quoted below comes from the pinned `@colyseus/core@0.18.27` / `@colyseus/sdk@0.18.9` probe
surface and is traceable to a retained artefact (§5.4).

## 0. What the owner is being asked to decide

| id | decision | if deferred |
| --- | --- | --- |
| **D7-A** | adopt policy **D7-P1** (§2) as the transport posture for UDG-003 Phase 2 | Phase 2 cannot be scoped: the room's admission, overflow and offender behaviour are undetermined |
| **D7-B** | authorise the acknowledgement-clause amendment in §3.2, or record a narrower wording | **D-7 stays open by construction.** No wording change means the literal clause stays unachievable on these pins (§3.1) |
| **D7-C** | choose the offender consequence: in-band throttle signal with escalation, or rate ceiling plus reserved close code directly (§2.1 clause 4, §7) | overflow handling stays unimplementable; both primitives are demonstrated, the choice is a product decision |
| **D7-D** | authorise the protocol surface PR-15 shows is needed: one `uint32` per-frame sequence field on `DirectInputSchema` declared as the room `seqField`, the per-entity authoritative record of §9.3 (`inputResolvedThrough`, named gap range, `inputRetiredUnrepresented`), and reserved close codes. Alternative if declined: **D7-P1-lite** (§10.4), which needs no protocol change and is genuinely weaker | the client has nothing to reconcile against except the SDK watermark, and PR-15 measured that no disposition reaches it today |
| **D7-F** | set the envelope values of §11.1 — burst allowance `B` (proposed 8) and jitter tolerance `J` (measured at Gate A) — and the escalation order X1→X4 | the overflow tests in §6.1 cannot be passed or failed without numbers, and a mean rate is not an envelope |
| **D7-E** | confirm that PR-14, the adversarial set in §6 and UDG-SPIKE-001 remain mandatory before Gate A, and that Phase 2 stays unassigned until D7-A and D7-B are decided | Gate A would be asserted on server-side bookkeeping, which is what PR-13 explicitly is not |

## 1. The decision D-7 actually is

### 1.1 The two sentences under dispute

From [movement-authority.md §5.1](../../interfaces/movement-authority.md), the paragraph beginning "Input buffering is
initially bounded at 32 frames per client" — quoted exactly:

> Do not drain a burst then simulate only its last frame, acknowledge frames that were never represented in state, or
> move a character repeatedly to empty a queue. Queue overflow and stale backlog handling must use demonstrated
> supported SDK behaviour, with a bounded offender disconnect if safe continuity cannot be proven. Record frames
> consumed but rejected by UDG rules; their effective input is neutral and their SDK acknowledgement remains truthful.
> Gate A must prove the client reconciles that rejection correctly.

The first sentence's middle clause and the third sentence assume the SDK acknowledgement can be made to track
representation. **PR-8 proves it cannot**, and PR-13 proves that no supported lever makes it track representation
(§5.1–§5.2). The second sentence is achievable and is kept unchanged by this proposal; the fourth is achievable only if
"truthful" is relocated from the SDK counter to an authoritative record the client can read.

### 1.2 Why this is a protocol decision and not a probe result

The probes have settled the mechanism. What is left is a choice about what the protocol promises and what a client must
do when the promise cannot be kept for *its own* misbehaving session. No further probe can decide that, and no library
change is permitted: an application-level custom input transport is forbidden by the adopted fixed-step prediction
design, and `sanitize` is typed `(input) => void`, so it cannot refuse.

## 2. Recommended policy — D7-P1

> **D7-P1 — rate-bounded admission, unchanged consumption, authoritative representation, deterministic consequence.**

1. **Admission is rate-bounded at the source.** The admitted continuous-input rate per entity is at most one frame per
   authority tick (`λ ≤ S`, `S = 20 Hz`), declared in `packages/config` so it is hashed and reviewable rather than
   ambient. The client is contractually bound to it; the server treats a breach as offender behaviour, not as a backlog
   to be digested.
2. **Consumption does not change.** Exactly one continuous observation per entity per tick, selected FIFO by arrival
   ordinal at stage Q, one authority step per connected entity per tick. No `take(n)` with `n > 1`, no `drain()`, no
   catch-up draining, no coalescing. This is the rule P03 adopted and the accepted Phase 1 core implements; D7-P1
   touches none of it.
3. **Representation is asserted only by an authoritative per-entity input disposition watermark.** For each tick in
   which an entity's observation is resolved, authoritative state carries the highest client sequence resolved for that
   entity and its disposition (`applied`, `refused` + protocol code, or `neutral`). The server already knows this: the
   accepted Phase 1 journal gives every admitted arrival exactly one disposition, and its reconciliation vector proves
   the accounting balances (`balanced: true`) across the quiet, driven, mixed, overflow and departure scenarios. What it
   does **not** do is tell the client anything — Phase 1 has no transport, and the SDK acknowledgement is a separate
   counter that PR-8 shows carries no disposition. D7-P1 publishes the same fact per entity so the client can act on it.
   **The SDK acknowledgement is never the client's authority for discarding predicted input.**
4. **Consequence is deterministic and named.** Buffer overflow means the sender breached clause 1, because clause 1
   makes overflow unreachable in a compliant session. The offender receives an in-band throttle signal naming the
   resolved watermark, and on persistence is rate-capped and closed with a reserved code. Both primitives are
   demonstrated by PR-13 (§5.2). The residue left inside an offending session is explicitly *unacknowledged-forever*
   rather than silently represented, is bounded by the buffer bound plus measured detection latency, and is reported.
5. **The client resynchronises when the two watermarks disagree** (§4). This is the clause that turns the policy from
   an accounting story into a recoverable protocol.

### 2.1 Why this preserves one input and one step per entity per tick

Because it never asks the server to consume more per tick. PR-13 located the cause of unrepresented retirement
precisely: it is *mismatch between admitted rate and consumed rate*, not the one-input rule.

| measured posture | arrival vs consumption | acked-but-unrepresented frames |
| --- | --- | --- |
| no policy, 5 ms sender | ~200/s vs 20/s, one per tick | 8 of 14 |
| `take(1)` per 20 Hz step vs 40/s sender | 40/s vs 20/s | 8 |
| `take(3)` per 20 Hz step vs 40/s sender | matched by consuming more | **0** (peak backlog 2) |
| `Room.send()` throttle signal, obeying sender, 5 ms sender | matched by bounding admission | **0** (peak backlog 2) |

The two zero rows achieve prevention by opposite means. `take(3)` buys it by consuming more than one input per tick —
which amends the adopted rule, the anti-cheat constraint that a burst cannot buy travel, and every accepted Phase 1
assertion. The throttle signal buys it by keeping the admitted rate compatible with one-per-tick consumption. D7-P1
takes the second path, so AC-3a (`consumed per entity per tick ∈ {0,1}`), AC-3c (bounded displacement), AC-17 (queue
policy) and the accepted Phase 1 suite are all preserved unchanged rather than renegotiated.

### 2.2 What D7-P1 needs that does not exist yet

Measured in PR-15 and *available today through public API*: the identity mapping (§9.1), gap detection between consumed
frames, `consumedCount` as an exact count of unrepresented retirements, atomic acknowledgement/state delivery (§10.2), and
the client-side observables (§10.1). What still needs an owner decision:

* one `uint32` per-frame sequence field on `DirectInputSchema`, declared as the room's `seqField` (**D7-D**). This is the
  only piece of the identity mapping the pinned library cannot supply on its own: `generation` is an intention domain and
  `sessionEpoch` a session domain, and PR-15 confirms neither identifies a frame;
* reserved close codes for offender termination, which the protocol registry does not yet carry;
* offender detection and consequence wiring in `RegionRoom` — Phase 1 has the counters (`overflowCauses`,
  `deferred-intake`) but no transport to act on them;
* a client-side reconciliation rule, which is UDG-SPIKE-001 territory and is written as testable acceptance criteria in
  §4 and §6.

### 2.3 Alternatives rejected, with their measurements

| rejected | measured reason |
| --- | --- |
| `take(n)`, `n > 1` | amends the adopted one-input rule and the burst-cannot-buy-travel constraint; benefit reproduced without it (§2.1) |
| `drain()` then apply newest | 3 frames retired with no step at all — the exact clause it would violate, measured rather than quoted |
| `InputAccessor.clear()` at a threshold | moves the *same* watermark: acked-unrepresented rose to 14; `consumedCount` 10 → 14 |
| `defineInput(…, { seqField })` **as an acknowledgement remedy** | the ack stays a send-order watermark (9 violations). Note the distinction PR-15 draws: it fails as *prevention* and is still required as *identity* (§9.1), and it brings a hazard of its own (§9.4) |
| `sanitize` as a rejection hook | typed `(input) => void`: rewrites, cannot refuse (9 violations) |
| per-tick threshold check alone | enforcement after growth: 20 Hz tick acted too late for a 5 ms sender; 3 frames retired before the seat ended |
| custom application-level input transport | forbidden by the adopted fixed-step prediction design |
| "rely on the application journal" | the journal proves what the server stepped; the client prunes on the watermark alone and is never told to stop predicting from a retired frame |

## 3. Does D7-P1 preserve the current acknowledgement requirement?

**No. It requires the explicit amendment in §3.2, and recommending otherwise would misstate the evidence.**

### 3.1 The measured fact that defeats the literal reading

PR-8 with `bufferMaxSize = 2` and six frames sent: the client is told to retire the first four — `consumedCount 4`,
`lastProcessed 4` — while the room produced **no step at all** for them, and `handle.at(seq)` is `undefined` for every
retired sequence, so the client prunes them *without any means of knowing they were dropped*. `pendingCount` reconciles
as `6 − 4 = 2`. That is a frame never represented in state being acknowledged, in the pinned library, in the normal
operation of a bounded buffer, with no lever available to withhold it (§5.1).

PR-13 adds that the violation cannot be pre-empted for a non-compliant sender: every posture that stopped it either
consumed more per tick or acted only after growth had already retired frames. Therefore the clause "…acknowledge frames
that were never represented in state" is satisfiable **for compliant sessions** and **not satisfiable for offending
sessions** on these pins. A guarantee that cannot be stated with its scope is not a guarantee; it is an undisclosed
exception.

### 3.2 Proposed replacement wording

**Moved, deliberately.** The first draft carried the wording here. PR-15 changed three details of it — the client must
compare the two watermarks *within one delivery*, pruning keys on `inputResolvedThrough` rather than on the SDK
watermark, and the epoch marker cannot come from `InputHandle.epoch` — so a single consolidated text now lives in
**§13** and nothing competing remains in this document. §3.1 keeps the reason an amendment is unavoidable; §13 is the
text to approve.

### 3.3 What the amendment does not weaken

It does not permit draining, per-tick multi-input consumption, or movement to empty a queue; it does not relax the
buffer bound, the neutral-input rule, the refusal vocabulary, or the offender-disconnect requirement; it does not
convert the residue into something acceptable in general — it scopes an existing unavoidable behaviour to the session
that caused it and requires that the client be able to detect and recover from it. Adopting §3.2 narrows nothing that
was ever demonstrated to hold; it stops asserting something that was demonstrated not to hold.

## 4. When the client must discard pending inputs and resynchronise

Definitions. **Pending set** — inputs the client has sent and predicted from but which the authoritative disposition
watermark has not resolved. **Authoritative state** — the replicated per-entity canonical state for the local player
plus the tick number, epoch and generation domain it belongs to. **Resynchronise** — replace local prediction with
authoritative state and re-anchor, never by replaying the pending set.

**Discard and resynchronise is mandatory when any of these is true:**

| id | trigger | why it cannot be handled by pruning |
| --- | --- | --- |
| **T1** | inside one state delivery, `lastProcessed` exceeds the authoritative `resolvedThrough` by more than the declared tolerance (§10.3) | this is the residue case: the frame may never have been simulated, so its predicted motion is fictional. It is tested *within* a delivery because PR-15 measured the acknowledgement and the state to be one delivery — comparing across deliveries is the false-positive machine |
| **T2** | socket close, connection failure or transport error, before sending any further input on the replacement session | frames in flight may have been simulated or not; the client cannot tell |
| **T3** | epoch change, including rejoin with preserved identity, detected from authoritative state — **not** from `InputHandle.epoch` | every pending frame belongs to the previous epoch and will be refused. PR-15 measured why the SDK counter cannot do this job: across a rejoin `epoch` stayed `0` while `sentCount` restarted (10 → 3) and the seat's `consumedCount` restarted with it |
| **T4** | receipt of a throttle signal whose resolved watermark is ahead of the client's last represented frame | the server has already resolved more than the client knows it predicted correctly |
| **T5** | receipt or prediction of imminent termination for its own session (rate ceiling reached, reserved close code) | residue after close is unacknowledged forever (§3.2) |
| **T6** | an authoritative state revision the client cannot map to a tick it knows (missed revision beyond its retained window) | there is no frame of reference left to predict against |
| **T7** | a pending discrete request identity retired by the watermark with no disposition recorded | the client cannot tell whether the action happened; retrying could duplicate it, so state decides (§12.3) |
| **T8** | `lastProcessed` cannot reach `sentCount` while the buffer is empty — the strand signature | PR-15 measured a second drop path: a replayed sequence is deduped **before** the buffer, and the ack then stays permanently below `sentCount` (`13 < 14`, `pendingCount` stuck at 1). No amount of waiting resolves it, and pruning on `seq <= lastProcessed` strands that input forever |

**Resynchronisation sequence, in order:** stop sending input; freeze prediction and extrapolation; discard the pending
set and any locally predicted path; obtain the authoritative snapshot for the local entity; apply it before any new
input; re-anchor epoch and generation domain; resume sending at no more than one frame per tick, the first frame
carrying the new epoch and generation.

**Mandatory acceptance condition for every trigger:** after resynchronisation the pending set is empty; no pre-event
frame is ever sent or admitted again (proved server-side as zero stale-epoch admissions, AC-5); the client's local
position equals the authoritative position within the accepted direct-correction tolerance; and the entity's step count
for the tick in which it resumed is exactly one (AC-18).

**Resynchronisation is NOT required when:** a frame was refused *with* a recorded disposition — the client keeps
predicting per the authoritative neutral step, which is the case the unamended fourth sentence already covered; a
keepalive was consumed without becoming an intention (AC-16); the pending set is unresolved but not yet outrun, which is
ordinary latency; or the two counters merely differ **across** deliveries rather than within one — PR-15 measured
0 of 60 samples at the default cadence and 0 of 70 at `patchRate` 250 ms against a 50 ms step where the acknowledgement
moved without a state delivery, so a same-delivery comparison has no timing artefact to forgive (§10.2).

## 5. What is already demonstrated, and what still has to be proved

### 5.1 Demonstrated by PR-8 (15 checks, `pass`) — server-side acknowledgement semantics

The acknowledgement is a sequence watermark over send order, equal to the server buffer's `consumedCount`; it retires a
prefix and carries no per-frame disposition. An applied frame, a refused frame and a dropped frame are indistinguishable
in it. A refused frame still advances state as a neutral step. Dropped frames **are** retired by the acknowledgement
(the first reading, "never acknowledged", was wrong and is superseded and retained). `handle.at(seq)` is `undefined` for
retired sequences, so the client cannot detect the drop. The ack value is not observable through the public room
accessor, so a room cannot read the acknowledgement it is causing. No member of `InputHandle` (13 members recorded) can
withhold, retract or qualify an acknowledgement.

### 5.2 Demonstrated by PR-13 (20 checks, `pass`) — which postures can and cannot prevent the violation

Bounded buffering holds: the declared buffer bound was never exceeded in any posture, so the problem is not growth but
what the bound does to what it drops. There is no rejection lever (§1.2). Enforcement after the fact is real but late: a
per-tick threshold and a rate ceiling both let frames be retired unrepresented before they act. Prevention was achieved
twice, at zero violations and peak backlog 2: by matching consumption to the admitted rate (`take(n)`, which amends the
adopted rule) and by an in-band `Room.send()` signal to an obeying sender (which does not). `drain()`-then-apply-latest
was measured, not merely condemned: 3 frames retired with no step. Termination freezes the watermark and leaves the
residue explicitly unacknowledged instead of silently represented.

### 5.3 Not demonstrated — Phase 2 obligations (unassigned)

That a real `RegionRoom` wires admission bounding, detection, signalling and termination in the order above; that the
authoritative disposition watermark is published, mapped and consumed correctly on both sides; that a real client obeys
the throttle signal within the recorded round trip; that the offender consequence is isolated to the offender (§6.2);
that the accepted Phase 1 ordering properties survive a real transport with jitter and mid-tick arrival; that no
head-of-line blocking appears; and that the journal and the published watermark never disagree. None of this exists
today: Phase 1 deliberately contains no transport, and D-7 is not closed by the accepted phase.

### 5.4 Not demonstrated — Gate A obligations (Not Run)

PR-8 and PR-13 observe **server-side accounting only**. They do not observe a client, and must not be quoted as if they
did. Gate A additionally requires: PR-14 real-state correctness, specified so that Gate A depends on nothing scheduled after it: the **flat
reference step** plus **real replicated state**, with no dependency on final locomotion, the physics pass or navigation
(§12.1); the burst and
adversarial set in §6 under non-zero round trip, loss and jitter; UDG-SPIKE-001 convergence claims — that a client stops
predicting from a retired frame, and behaviour under disconnect, loss and reconnect; the numerical gates (the 40 m flat
trace within `1e-6 m`, the per-tick displacement cap, the 0.15 m direct-correction limit) and the proof that burst count
cannot increase travel; AC-1..AC-20 including AC-15 (both bundles verify on the pushed head), AC-16..AC-20; and a
stack-compatibility claim, which today remains `not-established`. PR-0 passing under
[ADR-0002](../0002-server-declaration-checking-exception.md) is a compiler-policy result and is not compatibility.

### 5.5 Provenance of every number quoted here

Probe verdicts and results: `probes/PR-8.probe-result.json`, `probes/PR-13.probe-result.json` and
`probes/PR-15.probe-result.json` (`PR-15=pass(27)`) in the retained bundle
`/workspace/udg-evidence/ci-run-43010353106/UDG-003-2026-11-11T11-20-26-111Z-5d77c612`, verdicts `PR-8=pass(15)`,
`PR-13=pass(20)`; the posture table with all ten rows is in
[colyseus-0.18-api-map.md](../../integration/colyseus-0.18-api-map.md) and
[UDG-003-phase-0-completion.md §9.2 and §10.2](../../contracts/assignments/UDG-003-phase-0-completion.md).
Journal, disposition and reconciliation behaviour: the accepted Phase 1 core at the same head, vectors in the same
bundle's `vectors/` directory, gate `node tools/checks/dist/evidence.js vectors --dir <directory>`.

## 6. Acceptance tests for this policy

These are the tests the owner should require before D-7 can be closed. They are written as pass conditions with named
artefacts, not as implementation. Each must also satisfy AC-3d/AC-20: replaying the recorded journal reproduces the same
dispositions, canonical state and chain tip. Every one of them runs against the Gate A harness of §12.1, so no test here
needs code that Gate A is not allowed to depend on. The four corrections the owner asked for land in **OF-3/OF-3b**
(zero is a pass when prevention works), **IS-1** (per-entity projection, no room-wide ordinals), **RC-5a–RC-5d**
(abandon versus deliberate reissue, proved by an effect ledger) and §12.1 itself (the dependency fix).

### 6.1 Overflow

| id | scenario | pass condition |
| --- | --- | --- |
| **OF-1** | compliant sender at `λ = S`, 200 ticks | zero evictions; `overflowCauses` all zero; SDK watermark and authoritative disposition watermark equal at every tick boundary; `stepCount == tickCount` |
| **OF-2** | compliant sender with declared jitter plus one deliberately stalled tick | buffer bound 32 never exceeded; the PR-13 identity set `ackedUnrepresented` stays empty; no `dropped` disposition appears; the stall shows as `neutral` steps, never as catch-up motion (AC-16, AC-18) |
| **OF-3** | sender inside the declared envelope but bursty: `B` frames in one `stepMs`, repeated, then idle | **zero** `retiredUnrepresented` is the required result — prevention working is a pass, not a suspicious outcome; buffer depth stays below the bound; `inputResolvedThrough` reaches `sentCount` at rest; no resynchronisation occurs |
| **OF-3b** | sender outside the envelope **and** ignoring the throttle signal (prevention deliberately disabled) | the residue is non-zero, bounded, named, and attributed to that session alone; `retiredUnrepresented` and `pendingAtClosure` are reported as separate counts (§11.3); the client reaches an empty pending set through resynchronisation, not through draining; detection latency is recorded rather than assumed |
| **OF-4** | persistent offender after the signal is ignored | rate ceiling reached and seat closed with the reserved code; the watermark is frozen at closure; the residue is recorded as unacknowledged rather than represented; no write after closure; the bound was never exceeded (AC-3b) |
| **OF-5** | step overrun: a tick blocked past `dt` while arrival continues | arrival is held, never digested: the deferred intake bound holds and its rejections are counted by cause; the outcome is bounded, explicitly disposed eviction or refusal-plus-resynchronisation — never silent retirement |

### 6.2 Isolation of other players

| id | scenario | pass condition |
| --- | --- | --- |
| **IS-1** | two sessions, one compliant and one offending; run the compliant journal solo as a baseline | the compliant entity's **per-entity projection** `(clientSeq \| null, disposition, dx, dy, entityStateDigest)` per tick is identical to the solo baseline (§12.2). Room-wide arrival ordinals are **excluded** from the tuple: they legitimately differ when another session is present, and asserting equality on them would fail for a reason that is not interference |
| **IS-2** | offender fills its own continuous queue and the room's discrete budget | the compliant player's observations are never evicted or refused; room-level discrete overflow refuses by reason and touches no other entity's record; AC-7's no-observer-visible-change and no-trace-difference properties hold for the offender's malformed traffic |
| **IS-3** | per-entity watermark integrity | the authoritative disposition watermark is per entity and never room-wide: a compliant player's watermark must never resolve a sequence it did not send, and one player's residue must never appear in another's disposition record |
| **IS-4** | offender terminated mid-scene | the compliant players' `stepCount == tickCount` across the termination; no missed or extra tick for any observer; the room keeps ticking and disposing correctly (AC-9) |

### 6.3 Recovery after disconnect or reconnect

| id | scenario | pass condition |
| --- | --- | --- |
| **RC-1** | clean disconnect, rejoin | new epoch and generation domain; the pre-disconnect pending set is never sent or admitted (zero stale-epoch admissions, AC-5); the first post-rejoin input is consumed only after authoritative state is applied; the trace shows no catch-up teleport |
| **RC-2** | disconnect with unacknowledged residue (the PR-8 `pendingCount` case) | residue is **discarded, not resent**; the rejoining client's state digest equals the authoritative snapshot before any input is consumed |
| **RC-3** | rejoin after a violation window in which frames were retired unrepresented | the client detects watermark outrun (T1), discards and resynchronises; after resynchronisation it predicts from nothing retired, and its position matches authoritative state within the direct-correction tolerance |
| **RC-4** | rejoin on the same connection, and rejoin as a fresh join | PR-12's facts hold in room context: a new join is a new context and an existing connection is not re-registered; stale-epoch frames count exactly zero |
| **RC-5a** | same-epoch retry of a pending request | one disposition, one record, one publish (AC-19 terminal-request cache) |
| **RC-5b** | epoch change with **no** reissue | the identity is abandoned with the epoch; the effect ledger advances **zero** times for it afterwards, and no stale-epoch frame is admitted (AC-5) |
| **RC-5c** | deliberate reissue as a **new** identity after rejoin | treated as a new intent with its own decision: exactly one effect for the new identity, and never a second effect for the abandoned one |
| **RC-5d** | rejoin after a close that swallowed the disposition of a committed request | the client resolves the outcome from authoritative state — `effectCount`/`lastAppliedRequestId` — and does not reissue blind; exactly-once is proved by the ledger, not by the epoch change (§12.3) |
| **RC-6** | one player reconnects while others continue | IS-1 holds across the reconnect; the rejoining entity steps exactly once on the tick it resumes (AC-18); other players' watermarks and dispositions are untouched |

Artefacts: `ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json` (with dropped and refused reported
separately by reason — AC-3e), `room-lifecycle.json`, plus the Phase 1-style vector JSON for each scenario, gated so a
claimed live/replay equivalence that the artefacts do not prove fails the run.

## 7. Configuration and protocol consequences if D7-P1 is adopted

| item | value | status |
| --- | --- | --- |
| admitted continuous rate per entity | `λ ≤ S`, `S = 20 Hz` | derive from the frozen step rate; declare in `packages/config` so it is hashed |
| continuous buffer bound | 32 frames per client | already adopted (AC-3b); unchanged |
| burst allowance `B` | proposed 8 frames, owner value (**D7-F**) | must satisfy `B + J·λ + stall ≤ bufferMaxSize`; PR-15 shows the pinned bound holding at 4 and evicting immediately above it |
| jitter tolerance `J` | **no value claimed** | PR-15 is loopback, where `J = 0`; the number comes from the Gate A jitter population, not from this document |
| offender consequence | throttle signal and/or `Room.maxMessagesPerSecond` with reserved close code | **D7-C**; note that the ceiling is a per-second average and cannot prevent the first over-quota window, so it terminates rather than prevents |
| authoritative disposition watermark | per-entity sequence + disposition, published in replicated state | **D7-D**; touches frozen protocol surface, so protocol-owned files change only with owner approval |
| reserved close codes | offender termination | none reserved today; reservation is protocol-owned |

## 8. Evidence index for this decision

| claim in this document | probe | check ids | where the bytes live |
| --- | --- | --- | --- |
| identity mapping works end to end | PR-15 | `I1-stamped-sequence-equals-the-seq-send-returns`, `I1-bodyless-sends-still-advance-the-sequence`, `I1-server-consumes-the-same-sequence-in-order`, `I1-at-seq-finds-a-pending-frame-by-its-stamped-value` | `probes/PR-15.probe-result.json` in the bundle named in §5.5 |
| a gap is nameable between neighbours, unnameable before the first consumed frame, countable always | PR-15 | `I2-a-retired-frame-leaves-a-gap-in-the-stamped-sequence`, `I2-retirement-before-the-first-consumed-frame-cannot-be-named-by-the-room`, `I2-consumedCount-counts-every-unrepresented-retirement-though-not-by-identity`, `I2-evicted-frames-are-not-retrievable-through-the-accessor`, `I2-the-acknowledgement-counts-frames-that-were-never-stepped` | same |
| the `seqField` dedupe hazard | PR-15 | `I3-a-replayed-sequence-is-dropped-before-the-buffer`, `I3-dedupe-desynchronises-the-ack-from-the-client-sequence` | same |
| the sequence domain is per connection and `epoch` does not mark a rejoin | PR-15 | `I4-a-domain-change-is-observable-to-the-client`, `I4-the-acknowledgement-is-not-a-usable-ordering-across-a-rejoin` | same |
| what the client can and cannot observe | PR-15 | `I5-*` | same |
| acknowledgement and state are one delivery, at both cadences | PR-15 | `I6-the-acknowledgement-never-runs-ahead-of-state-at-the-default-cadence`, `I7-a-slower-patch-cadence-does-not-separate-ack-from-state` | same |
| the acknowledgement is a watermark with no disposition, and nothing prevents unrepresented retirement for an offender | PR-8, PR-13 | §5.1, §5.2 | same bundle, `PR-8` and `PR-13` results |

Two independent local PR-15 runs recorded **identical** figures for every scenario (consumed `5,9,10,11,12,14`; first
consumed sequence 5 with 4 unnamed leading retirements; `consumedCount` 12 against 5 stepped; `lastProcessed` 13 against
`sentCount` 14 after the replay; counters `10 → 3` across the rejoin; 0 mismatch samples at both cadences), so the
numbers quoted in §9 to §11 are reproducible rather than a lucky run.

**Which of those numbers are evidence and which are timing.** The hosted CI run of the same commit also passed all 27
checks and reproduced the structural results exactly — 7 frames retired unrepresented, the strand at `13 < 14`, the
per-connection restart `10 → 3` with `epoch` unmoved, and 0 mismatch samples at both cadences — but its first consumed
sequence was **6** with **5** unnamed leading retirements rather than 5 with 4, because which frames survive to the first
step depends on how arrival interleaves with the tick. The claim this decision rests on is therefore the *property*: a
nonzero unnameable leading retirement, an exact count where identity is impossible, and a domain that restarts. The exact
positions are quoted so a reader can check the artefact, not as if they were invariants. The suite asserts the properties,
so a future pin change fails loudly instead of quietly altering the decision's basis.

## 9. Point 1 — the input identity mapping, proven

### 9.1 The one supported mapping

PR-15 measured a single chain that works, using public declarations only:

```text
client   const expected = handle.sentCount + 1        // read before the send
         handle.data.seq = expected                   // an application field, declared as seqField
         const returned = handle.send()               // returns the seq it assigned
server   defineInput(SequencedInputSchema, { seqField: 'seq' })
         accessor.next() → frame.seq                  // the same number, per consumed frame
         accessor.at(value)                           // resolves a pending frame by it
client   handle.lastProcessed                          // server buffer consumedCount, echoed in the state patch
```

Measured: 8 sends stamped `1..8`, each equal to `send()`'s return and to `sentCount` afterwards; two no-change sends
returned `9` then `10`, so a body-less frame occupies a sequence rather than skipping one; the room consumed
`1,2,…,9` in exactly that order; and `accessor.at(8)` resolved a frame while it was still pending
(`I1-*`, all pass).

### 9.2 Four identifiers, and why none substitutes for another

| identifier | owner | advances on | identifies | cannot do |
| --- | --- | --- | --- | --- |
| **client send sequence** (`seq`) | the SDK, mirrored into an application field | every `send()` | one frame, inside one connection domain | survive a rejoin: measured `sentCount` 10 → 3 across a reconnect while `sessionId` was preserved |
| **UDG `generation`** | UDG protocol | a deliberate control intention | an intention domain | identify a frame: many frames share one generation |
| **UDG arrival ordinal** | the room | admission, across all sessions | position in one room's ordering | say anything about a client's send order, and it is not per entity |
| **`InputHandle.epoch`** | the SDK | `reset()` | a client-side encoder reset | mark a rejoin: measured `0 → 0` across a reconnect while counters restarted |

So the authoritative record is keyed **(UDG session epoch, client send sequence)**. PR-12 assigned epoch ownership to UDG;
PR-15 shows the input channel supplies no substitute marker.

### 9.3 Gap preservation: a count where identity is impossible

PR-15 measured the boundary of what the server can know. With `bufferMaxSize 4` and 12 frames sent at 5 ms, the room
consumed `5, 9, 10, 11, 12, 14`:

* the hole between neighbours is **nameable** — `5 → 9` names sequences 6, 7, 8 as never stepped;
* an evicted frame is **not retrievable** — `accessor.at(6)` returns nothing;
* the hole **before the first consumed frame is unnameable** — the first consumed sequence was 5, so sequences 1–4 have
  no earlier endpoint to hang a gap on, yet they were retired;
* the **count is exact anyway** — `accessor.consumedCount` 12 minus 5 frames stepped = 7, matching the client-side count
  of frames sent but never stepped.

A gap therefore cannot be the record, because a gap needs two endpoints. The record is a **contiguous prefix plus an
explicit retirement count plus an optional named range**:

| field | meaning | rule |
| --- | --- | --- |
| `inputResolvedThrough` | highest sequence such that **every** sequence ≤ it has an explicit disposition | advances one step at a time, or past an explicitly closed gap — never past a sequence with no disposition |
| `inputGapStart` / `inputGapEnd` | the named range the server observed, `start = previous + 1`, `end = current − 1` | written only from an observed hole; absent when the server cannot name one |
| `inputRetiredUnrepresented` | count of sequences retired by the buffer without a step, from `consumedCount − frames stepped` | monotonic; the only field that can report the **leading** and **trailing** holes the room cannot name |

**The gap rule, stated as the owner asked:** resolving sequence *n* MUST NOT imply anything about any sequence below
`inputResolvedThrough` that lacks a disposition. Advancement is by one, or by an explicit gap closure that names the
range and increments `inputRetiredUnrepresented`. A server that cannot name a hole may still publish the count, and the
client treats a nonzero count as a mandatory resynchronisation (§10.3, T1) rather than as a bookkeeping detail.

### 9.4 The hazard PR-15 found in the mechanism it recommends

`seqField` also **dedupes before the buffer**: a frame whose stamped value is ≤ the last seen is discarded and the room
never sees it. PR-15 replayed sequence 1 at wire 14 and measured the consequence — `lastProcessed` then sits permanently
at 13 against `sentCount` 14 with `pendingCount` stuck at 1, and a client pruning on `seq <= lastProcessed` strands an
input the server already threw away.

This is why §13 requires the client to stamp strictly increasing values it obtained from `sentCount + 1` and never a
reused one, and why trigger **T8** exists: an unsatisfiable ack target is a distinct condition from a slow network, and
it must resolve by resynchronisation, not by waiting.

## 10. Point 2 — the recovery trigger, verified against the pinned SDK

### 10.1 What the client can observe after built-in pruning

| observable | measured | use |
| --- | --- | --- |
| `lastProcessed` | moves only with a state delivery | ack watermark, per connection domain |
| `sentCount` | restarts across a rejoin (10 → 3) | the client's own target; the basis of T8 |
| `pendingCount` | `sentCount − lastProcessed`, exactly | in-flight size only — **not** "everything resolved" (§9.4) |
| `at(seq)` | acked sequence gone, in-flight sequence present | whether rollback-replay is still possible for that frame |
| `replayBufferSize` | 64 | bound for the client's own per-sequence prediction ring |
| `epoch` | unchanged across a rejoin | cannot mark a domain change (T3 uses state instead) |

No disposition of any kind reaches the client today. That absence is the whole case for the authoritative watermark.

### 10.2 Pairing is atomic, so the trigger does not need a patch-timing grace

The draft assumed ordinary patch timing would open an unsettled window and that a trigger must tolerate it. The
measurement says otherwise: **0 of 60** samples at the default cadence, and **0 of 70** with `Room.patchRate` forced to
250 ms against a 50 ms step, showed `lastProcessed` moving without a state delivery; neither value ever ran ahead of the
other, and both agreed at rest. The acknowledgement is echoed *in* the state patch, so a client that reads both when a
patch is applied sees no artefact at either cadence.

That removes the "reset on every patch" failure mode only if the rule is written as a **same-delivery comparison**. A
client that reads `lastProcessed` now and its watermark from an earlier patch invents the very skew the measurement says
does not exist. This is a contract requirement on the client, and it is what §10.3 encodes.

### 10.3 The trigger, with hysteresis

```text
on state delivery (patch):
    read lastProcessed, resolvedThrough, retiredUnrepresented, epoch     // one delivery, one snapshot
    if epoch ≠ predictedEpoch                              → resynchronise (T3)
    if retiredUnrepresented > 0                            → resynchronise (T1, unconditional)
    if lastProcessed > resolvedThrough:                    → arm; record the patch ordinal
        if still armed for `G` consecutive deliveries      → resynchronise (T1)
    if buffer empty and lastProcessed < sentCount
       and unresolved for `G` deliveries                   → resynchronise (T8, the strand)
    otherwise                                              → disarm
    prune pending entries with seq ≤ resolvedThrough only   // never ≤ lastProcessed
```

`G` is one state delivery by default. It is **not** justified as patch timing — which needs none — but as tolerance for
three real cases: a server that consumes in tick *n* and publishes its watermark in tick *n+1* (which §13 forbids, but a
client must not reset if it happens), the momentary `at(seq)` unavailability during rollback-replay, and a real round
trip, which loopback cannot measure and Gate A must (`G` is therefore declared in *deliveries and* milliseconds, and
re-measured). Hysteresis is on **deliveries**, not wall-clock time, so a stalled patch stream cannot arm forever.
After any resynchronisation the trigger disarms until a fresh snapshot has been applied, which is what stops a
correction storm.

### 10.4 If the watermark is not approved: the smallest alternative

Publishing per-entity fields is implementable through public API — `schema` state plus `@udg/protocol/mapping` — so this
is not a missing-API problem. It is a protocol-change authorisation problem. The owner may instead approve the smaller
posture, which needs **no new state field**:

> **D7-P1-lite.** The client reconciles by divergence: it keeps predicted entries only while `at(seq)` can replay them;
> when authoritative position and predicted position differ beyond the accepted direct-correction tolerance, or when T3
> or T8 fires, it discards the pending set and resynchronises. The SDK watermark stays a prune hint and is never a
> representation claim.

What lite gives up, and what it costs in contract terms: a *refused* frame whose authoritative effect is a neutral step
often leaves the position close to a small-signal prediction, so **refusals and unrepresented retirements become
undetectable until drift accumulates**; overflow cannot be attributed to a session; and `abuse-results.json` cannot
report a violation the client cannot see. Lite therefore satisfies AC-15's reconciliation proof only for gross
divergence, and the clause "Gate A must prove the client reconciles that rejection correctly" could then only be met by
a test that *causes* visible divergence. Adopting lite requires this contract change instead:

* [movement-authority.md §5.1](../../interfaces/movement-authority.md) — the sentence "their SDK acknowledgement remains
  truthful" replaced as in §13 but **without** the disposition-watermark paragraphs, and Gate A's reconciliation sentence
  narrowed to "reconciles a visible divergence correctly";
* no `protocol-v1.md` or `DirectInputSchema` change;
* and D-7 then closes only with that narrowing recorded, because the guarantee is genuinely weaker.

**Recommendation remains the watermark.** Lite is offered because the owner asked for the smallest alternative, not
because the two are equally defensible.

## 11. Point 3 — a testable arrival envelope, not a mean rate

### 11.1 The envelope

A mean of 20 Hz says nothing about a 40-frame burst, so the envelope is declared as a token bucket per entity and stated
in the same units the buffer has:

| parameter | value | basis |
| --- | --- | --- |
| sustained admitted rate `λ` | ≤ one frame per `stepMs` (`S = 20 Hz`) | the adopted consumption rule |
| burst allowance `B` | **owner value, proposed 8** frames | must be < the buffer bound so a legal burst never evicts; PR-15 shows the bound holds at 4 and evicts immediately above it |
| token refill | 1 token per `stepMs` | matches consumption exactly |
| arrival jitter tolerance `J` | **owner value, measured at Gate A** | PR-15 is loopback: `J = 0` there, so no number in this file is a measured jitter tolerance |
| stall allowance | one stalled tick must not evict: `B + J·λ + stall ≤ bufferMaxSize` | the derivation to record beside the value; 8 + headroom + 1 ≤ 32 leaves the margin explicit |

`bufferMaxSize` stays 32 (AC-3b). The envelope, not the buffer, is the contract: **inside** it eviction is arithmetically
impossible, so eviction is evidence of an offender rather than of a sizing mistake.

### 11.2 The observed condition that triggers termination

`sanitize` cannot refuse and nothing rejects before the buffer (§1.2), so the trigger is an observation, in this order:

| id | observed condition | source | consequence |
| --- | --- | --- | --- |
| **X1** | `inputRetiredUnrepresented` would increment | `consumedCount − frames stepped` | violation already real: throttle signal, count it, and the client must resynchronise; termination follows persistence |
| **X2** | `accessor.size ≥ bufferMaxSize − B` | `InputAccessor.size` | pre-eviction signal only: throttle. PR-13 already measured that acting on a threshold does not stop an over-rate sender, so X2 is never called prevention |
| **X3** | arrival rate above the declared ceiling | `Room.maxMessagesPerSecond` | rate ceiling plus reserved close code; a per-second average, so it terminates and cannot prevent |
| **X4** | offender ignores the signal within the declared window | throttle round trip | escalate to X3 |

### 11.3 Two counts, reported separately

| field | meaning | measured source |
| --- | --- | --- |
| `retiredUnrepresented` | frames the buffer retired that never entered state — **already gone at the moment of observation** | `consumedCount − frames stepped`, plus the named gap ranges |
| `pendingAtClosure` | frames the client had sent and not been acked for when the seat closed | client `pendingCount` at close, and server `accessor.size` at close, cross-checked |

PR-15 observed both shapes: 7 frames retired unrepresented in one scenario, and a `pendingCount` of 1 stranded by the
dedupe path in another. Collapsing them would hide the difference between "the server discarded work" and "the client was
still waiting", and only the first is a violation of the acknowledgement clause.

### 11.4 Zero unrepresented retirements is a pass

The draft's OF-3 demanded a non-zero residue for an offender. That was wrong in the direction that matters: if prevention
works, the honest result is zero, and a test that *requires* a violation would fail the good implementation. §6.1 is
corrected, and the violation window is now a separate scenario that disables prevention deliberately.

## 12. Point 4 — test dependency fixes

### 12.1 Gate A must not depend on post-Gate-A code

PR-14 as first drafted said "the actual shared locomotion step … with the collision pass in the loop". That makes Gate A
dependent on UDG-005 locomotion and the physics pass, which are scheduled after Gate A. Corrected:

* **harness**: `tests/reference/gate-a/` — the **flat reference step** from the accepted Phase 1 authority core
  (`apps/server/src/authority/**`, engine-free by the accepted boundary rules) driving **real replicated state**
  (`@udg/protocol/schema` `RegionSchema`/`PlayerSchema` plus `@udg/protocol/mapping`), fed by the SDK input buffer
  through a `RegionRoom`-shaped driver;
* **forbidden inputs**: `packages/physics`, navigation, worker integration, and any UDG-005 locomotion module. The
  boundary suite is the enforcement point, not a comment;
* **substitution**: where the draft said "collision pass", Gate A asserts the flat-room reference permitted by
  [acceptance-gates.md](../../validation/acceptance-gates.md) — bounded floor, labelled resets excluded from travel
  arithmetic — and the collision-dependent populations are reported separately at Gate B;
* AC-1..AC-20 stay the assertions; only the code they exercise is fixed at the reference step.

### 12.2 Isolation without room-wide ordinals

Byte-equality of *canonical state* across a solo run and a two-player run cannot hold: arrival ordinals are assigned
across sessions, so the compliant player's ordinal legitimately differs when another player is present. The comparison is
therefore a **per-entity projection**, keyed by the client send sequence, which is per entity by construction:

```text
projection(entity) = [ (clientSeq | null, disposition, dx, dy, entityStateDigest) per tick ]
```

* **IS-1** asserts these projections are equal between the solo baseline and the two-player run for the compliant
  entity, with ordinals excluded from the tuple;
* room-wide ordinals and room-wide counters are asserted **separately**, as growth properties, never as equality;
* entity state digests are compared over the entity's own state only, never the room's, so a second player cannot make
  the assertion fail for a reason that is not interference.

### 12.3 Retries across an epoch change

An epoch change alone cannot prove exactly-once, so the semantics are declared rather than inferred:

* **abandon by default.** On epoch change the client MUST NOT reissue a pending request identity; the identity is
  abandoned with the epoch, and the authoritative record — not the client's memory — decides what happened;
* **deliberate reissue is a new identity.** A user-driven retry gets a fresh `requestId`, is decided on its own merits,
  and may legitimately execute again. That is a second intent, not a duplicate;
* **same-epoch retry stays idempotent.** One disposition, one record, one publish (AC-19, the terminal-request cache);
* **exactly-once is proved by an effect ledger**, not by an epoch: authoritative state carries a per-entity
  `effectCount` and `lastAppliedRequestId`. RC-5 asserts `ΔeffectCount == 1` for the action across the whole scenario,
  `== 0` for an abandoned identity after the epoch change, and `== 1` per distinct identity for a deliberate reissue.

## 13. Consolidated proposed wording (apply only on adoption)

One text, in one place, replacing the second, third and fourth sentences of the
[movement-authority.md §5.1](../../interfaces/movement-authority.md) paragraph beginning "Input buffering is initially
bounded at 32 frames per client". The buffer bound, the first sentence and every other clause of §5.1 are unchanged.

> Input buffering is initially bounded at 32 frames per client. The admitted continuous-input rate per entity is at most
> one frame per authority tick, with a burst allowance declared as configuration below the buffer bound; a client that
> exceeds the declared envelope is an offender. Do not drain a burst then simulate only its last frame, or move a
> character repeatedly to empty a queue. Queue overflow and stale backlog handling must use demonstrated supported SDK
> behaviour, with a bounded offender disconnect when safe continuity cannot be proven.
>
> The SDK acknowledgement is a send-order watermark over the client's own send sequence. It is **not** an assertion that
> an input was represented in authoritative state, and a client MUST NOT use it as the authority for discarding predicted
> input. Each continuous frame carries a client send sequence — the value `sentCount + 1` read before the send, stamped
> into the field declared as the room's input `seqField`, strictly increasing within one connection domain — and
> authoritative state carries, per entity and per session epoch: `inputResolvedThrough`, the highest sequence for which
> **every** sequence at or below it has an explicit disposition; an optional named gap range the server observed; and
> `inputRetiredUnrepresented`, the count of sequences retired by the buffer without entering state. Advancing
> `inputResolvedThrough` past a sequence with no disposition of its own is prohibited, whether the gap is named or not.
> The server publishes these fields in the tick in which it consumes.
>
> For a session inside the declared envelope, no frame is retired by the SDK watermark before the authoritative record has
> resolved it. For a session outside it, the SDK watermark MAY retire frames that were never represented in state; that
> residue is attributable to the offending session, is reported as `retiredUnrepresented` separately from
> `pendingAtClosure`, and terminates the offending seat. It is never evidence of a compatible stack and is never repaired
> by draining.
>
> Record frames consumed but rejected by UDG rules; their effective input is neutral and their authoritative disposition
> is recorded. A client compares the acknowledgement with the authoritative record **within one state delivery**, and
> discards its pending inputs and resynchronises from authoritative state on: the tolerance in §10.3 being exceeded; a
> nonzero `inputRetiredUnrepresented`; an epoch change observed in authoritative state; a throttle signal naming a
> resolved sequence ahead of the client's last represented one; imminent termination of its own session; an
> unresolvable state revision; a retired request identity with no disposition; or an acknowledgement target the buffer can
> no longer reach. Pruning uses `inputResolvedThrough`, never `lastProcessed`. Gate A must prove the client reconciles a
> refusal **and** an overflow-residue case correctly, each over a real round trip, and that ordinary delivery timing
> causes no resynchronisation.

Consequential approvals inside the same decision: one `uint32` per-frame sequence field on `DirectInputSchema` with its
validator, mapping and fixture updates (**D7-D**); the per-entity authoritative fields above; reserved close codes; and
the burst/jitter values in §11.1 (**D7-F**).

## 14. What this proposal does not do

It does not amend `docs/interfaces/movement-authority.md`, `docs/interfaces/protocol.md`,
`docs/contracts/protocol-v1.md` or `packages/protocol/src/schema/DirectInputSchema.ts` — §13 is proposed wording held for
owner decision, and PR-15 measures the sequenced input shape in a **probe-local** declaration precisely so that the
frozen schema stays untouched until the owner decides. It does not
assign Phase 2 or Phase 3, reopen Phase 1, or treat the accepted Phase 1 status as relevant to D-7 in either
direction. It does not adopt `take(n)` or any multi-input consumption; the [input-consumption rule
proposal](UDG-003-input-consumption-rule.md) remains the statement of that question and its answer is unchanged. It
does not close D-7, pass or alter Gates A/B/C, provision evidence storage (D4 remains open), or make any third-party
compatibility claim. If the owner declines D7-B, the honest repository state is unchanged: **D-7 remains open, and
Phase 2 cannot be scoped honestly until either the clause is amended or a different mechanism makes representation
observable to the client.**
