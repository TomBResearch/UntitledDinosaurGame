# ADR-P-0003 proposal — D-7: input acknowledgement, overflow and resynchronisation policy

Status: **Proposed. This document assigns no work, amends no contract clause, adopts nothing and opens no phase.**
It is a decision paper for owner review of **D-7**, which remains **open**. Phase 2 and Phase 3 remain **unassigned**;
Gates A, B and C remain **Not Run**; `stackCompatibility` remains **not-established**. UDG-003 remains **In Progress**,
with Phase 1 accepted at phase level on 2026-11-11 at `5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c`.

Two probes carry its evidence: **PR-8** (15 checks) and **PR-13** (20 checks) from Phase 0, and **PR-15** (27 checks,
`pass`) added for this decision — input identity, gap visibility, client observability and acknowledgement/state pairing,
measured on the same pins. PR-15 answers the four implementation questions the owner raised on the first draft; §9–§12
are those answers and §13 is the single consolidated wording that results from them. **PR-14 remains reserved** for the
Gate A real-state probe in §12.1, and the contract suite asserts that absence.

**Revision 2**, on the owner's second review, which authorised a proposal revision only. Three things changed and nothing
else was touched: §9.3.1 defines the retirement count on actual SDK dequeue results within one connection domain, counts a
UDG-refused frame as dequeued rather than retired, ignores ticks that dequeue nothing, and states which mechanism can see
buffer eviction and which can see pre-buffer discarding; §11.2 and §13 now agree that queue pressure throttles while a
confirmed retirement closes the seat, with the closure window's start, end and withheld-patch behaviour defined in
§11.2.1; and T8 is rewritten in §10.5 as a named client-observable signal, with the client's inability to see server queue
depth stated rather than worked around, plus the bounded two-step recovery the client can actually execute. §12.4 states
the resulting Gate A pass/fail criteria. **D-7 remains open and Phase 2 remains unassigned pending owner approval.**

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
| **D7-F** | confirm the §11.2 mapping — pressure throttles, a confirmed retirement or strand closes the seat, a rate ceiling closes directly — and the §11.2.1 closure bounds | otherwise the same condition could be answered with a signal in one section and a disconnect in another, which is the divergence this revision removed |
| **D7-G** | accept `B = 8`, `closureWindowMs = 250 ms` and `closureMaxMs = 1000 ms` as **provisional test settings**, with production `B` and `J` fixed from the Gate A population under GA-11 | the §6.1 and §12.4 criteria need numbers to be decidable, and a mean rate is not an envelope; setting them here would be inventing a measurement |
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
| **T8** | `INPUT_ACK_STALLED` (§10.5): the client still holds an outstanding input while neither the acknowledgement nor the state record has advanced for the declared window | PR-15 measured a second drop path — a replayed sequence is deduped **before** the buffer and the ack stays permanently below `sentCount` (`13 < 14`, `pendingCount` stuck at 1) — and the client cannot tell that from a slow network. Bounded recovery, never waiting; and pruning on `seq <= lastProcessed` would strand the input forever |

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
| **RC-3** | rejoin after a violation window in which frames were retired unrepresented | the client detects watermark outrun (T1) or the terminal reason in the closure record, discards and resynchronises; after resynchronisation it predicts from nothing retired, and its position matches authoritative state within the direct-correction tolerance |
| **RC-3b** | closure whose final state publication is withheld (§11.2.1) | the server still records the confirmed loss, its counters and `serverQueuedAtClose`; the client discards the whole pending set, prunes nothing by `lastProcessed`, reissues no pending request identity, and recovers through rejoin plus snapshot inside the declared budget — reported as detected-and-bounded, never as a clean reconciliation (GA-7) |
| **RC-4** | rejoin on the same connection, and rejoin as a fresh join | PR-12's facts hold in room context: a new join is a new context and an existing connection is not re-registered; stale-epoch frames count exactly zero |
| **RC-5a** | same-epoch retry of a pending request | one disposition, one record, one publish (AC-19 terminal-request cache) |
| **RC-5b** | epoch change with **no** reissue | the identity is abandoned with the epoch; the effect ledger advances **zero** times for it afterwards, and no stale-epoch frame is admitted (AC-5) |
| **RC-5c** | deliberate reissue as a **new** identity after rejoin | treated as a new intent with its own decision: exactly one effect for the new identity, and never a second effect for the abandoned one |
| **RC-5d** | rejoin after a close that swallowed the disposition of a committed request | the client resolves the outcome from authoritative state — `effectCount`/`lastAppliedRequestId` — and does not reissue blind; exactly-once is proved by the ledger, not by the epoch change (§12.3) |
| **RC-6** | one player reconnects while others continue | IS-1 holds across the reconnect; the rejoining entity steps exactly once on the tick it resumes (AC-18); other players' watermarks and dispositions are untouched |

Artefacts: `ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json` (with `retiredUnrepresented`,
`outstandingAtClose` and `serverQueuedAtClose` reported as three separate observations, and dropped versus refused reported
separately by reason — AC-3e, §11.3), `room-lifecycle.json`, plus the Phase 1-style vector JSON for each scenario, gated so a
claimed live/replay equivalence that the artefacts do not prove fails the run.

## 7. Configuration and protocol consequences if D7-P1 is adopted

| item | value | status |
| --- | --- | --- |
| admitted continuous rate per entity | `λ ≤ S`, `S = 20 Hz` | derive from the frozen step rate; declare in `packages/config` so it is hashed |
| continuous buffer bound | 32 frames per client | already adopted (AC-3b); unchanged |
| burst allowance `B` | **8 frames — provisional test setting** (**D7-G**) | must satisfy `B + J·λ + stall ≤ bufferMaxSize`; PR-15 shows the pinned bound holding at 4 and evicting immediately above it. Production value is fixed from the Gate A population, not from this table |
| jitter tolerance `J` | **no value claimed; Gate A measures it** (GA-11) | PR-15 is loopback, where `J = 0`; any number here would be invented |
| closure bounds | `closureWindowMs = 250 ms`, `closureMaxMs = 1000 ms` — **provisional test settings** (**D7-G**) | §11.2.1: the window exists so the disposition record can reach the client before close; both are declared configuration and both are re-examined against the measured round-trip population |
| stalled-acknowledgement bounds | `G` deliveries, `K` rejoins per minute — **declared, values set with `B` and `J`** | §10.5: the client's recovery must be bounded without knowing anything about server queue depth, which no supported client API exposes |
| offender consequence | throttle on pressure; bounded closure on a confirmed retirement or strand; `Room.maxMessagesPerSecond` with a reserved close code as the outer bound | **D7-C/D7-F**; the ceiling is a per-second average and cannot prevent the first over-quota window, so it terminates rather than prevents |
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
* the **count is exact anyway** — `accessor.consumedCount` 12 minus the 5 real dequeue results = 7 (§9.3.1), matching the
  client-side count of frames sent but never stepped.

A gap therefore cannot be the record, because a gap needs two endpoints. The record is a **contiguous prefix plus an
explicit retirement count plus an optional named range**:

| field | meaning | rule |
| --- | --- | --- |
| `inputResolvedThrough` | highest sequence such that **every** sequence ≤ it has an explicit disposition | advances one step at a time, or past an explicitly closed gap — never past a sequence with no disposition |
| `inputGapStart` / `inputGapEnd` | the named range the server observed, `start = previous + 1`, `end = current − 1` | written only from an observed hole; absent when the server cannot name one |
| `inputRetiredUnrepresented` | count of sequences retired without a step, computed by the arithmetic of §9.3.1 | monotonic **within one connection domain**; the only field that can report the leading and trailing holes the room cannot name |

**The gap rule, stated as the owner asked:** resolving sequence *n* MUST NOT imply anything about any sequence below
`inputResolvedThrough` that lacks a disposition. Advancement is by one, or by an explicit gap closure that names the
range and increments `inputRetiredUnrepresented`. A server that cannot name a hole may still publish the count, and the
client treats a nonzero count as a mandatory resynchronisation (§10.3, T1) rather than as a bookkeeping detail.

### 9.3.1 The retirement arithmetic, defined on actual dequeue results

The count is defined on what the SDK actually dequeued, not on ticks or wall-clock time. All three quantities live in
**one connection domain**, are snapshotted when the domain starts and reset when it changes; differenceing them across a
domain boundary is prohibited, because PR-15 measured both counters restarting across a rejoin.

| quantity | how the room measures it | what it excludes |
| --- | --- | --- |
| `consumedDelta` | `accessor.consumedCount − domainBaseConsumed` — the accessor's cumulative CONSUMED count minus its value at domain start | frames never sent; frames dropped **before** the buffer |
| `dequeuedCount` | number of `accessor.next()` results in the same window that were real dequeued inputs, using the declaration's own guard `accessor.wasIdle === false` | idle-synthesised frames, which never advance the ack; **a tick that dequeues nothing contributes zero** |
| `refusedCount` | the subset of `dequeuedCount` that UDG screening refused | nothing is excluded — a refused frame **was** dequeued, is represented by its neutral step, and receives a disposition |

```text
retiredUnrepresented += (consumedDelta − dequeuedCount)      // per domain; evaluated each step and once at close
```

Three consequences the owner asked to keep separate:

* **a refused frame is never a retirement.** It sits inside `dequeuedCount`, so the subtraction cannot charge it; its
  disposition is `refused:*` with its reason, and it advances `inputResolvedThrough` like any represented frame.
* **a tick that dequeues nothing contributes nothing.** The rule is not "one tick = one frame": a tick whose `next()`
  returns `undefined`, or returns an idle-synthesised frame under an `idle` policy, moves neither term.
* **`clear()` is charged as a retirement.** The declarations have `clear()` drop all buffered snapshots while the ack
  advances on overflow-drop, so a `clear()` produces exactly the divergence this formula measures. PR-13 already measured
  `clear()` moving the acknowledgement with nothing stepped, so a room that calls `clear()` on an offender is reporting a
  real unrepresented retirement — one reason §11.2 requires bounded closure rather than a shrug.

**Which mechanism covers which loss.** No single count sees everything, and pretending otherwise is the failure mode this
policy exists to avoid:

| mechanism | detects | cannot detect |
| --- | --- | --- |
| `consumedDelta − dequeuedCount` | **buffer eviction**, `clear()` drops | **pre-buffer dedupe** (the frame never entered the buffer and never advanced the ack), frames never sent |
| a hole in the stamped sequence | eviction **and** pre-buffer dedupe — PR-15 saw the single skip `13 → 15` reveal the deduped stamp | a hole with no earlier consumed frame; a hole no later frame reveals |
| the strand signal **T8** (§10.5) | **pre-buffer dedupe** and any other permanently-unreachable acknowledgement | anything the client can still resolve itself |

PR-15 proved the split rather than inferring it: after a replayed stamp, `lastProcessed` sat at 13 against `sentCount` 14
with the client still holding that frame — a loss the subtraction cannot see, because the dropped frame never touched the
buffer. That is why the record publishes a count *and* named ranges, and why the client needs T8.

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
    if INPUT_ACK_STALLED (defined in §10.5)                → bounded recovery, §10.5
    otherwise                                              → disarm
    prune pending entries with seq ≤ resolvedThrough only   // never ≤ lastProcessed
    // no branch may test server queue emptiness: the client cannot observe it
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

### 10.5 T8 named as a client-observable signal, with a bounded recovery

**What the client cannot observe, stated plainly.** The pinned SDK gives the client an `InputHandle` and nothing else: the
counters `lastProcessed`, `sentCount`, `pendingCount`, the replay ring behind `at(seq)`/`replayBufferSize`, and `epoch`.
`accessor.size` — the server's queue depth — is a server-side accessor member and has **no client-side counterpart**, and
PR-15 confirmed that no disposition or queue state reaches the client on any of these surfaces. So **the client cannot
establish server queue emptiness, and no T8 condition may be written as "the server buffer is empty".** The first draft's
"pendingCount non-zero with an empty replay buffer" was also wrong in its own terms: `at(seq)` covers the *client's* ring,
not the server's queue, and a client-side ring can be empty for reasons that say nothing about the server.

The signal is therefore defined only over client-observable quantities:

```text
INPUT_ACK_STALLED is true when all of the following hold, measured from state deliveries only:
  (a) outstanding > 0                  // the client holds an input it has not pruned:
                                       //   highest stamped seq sent  >  inputResolvedThrough
  (b) lastProcessed has not advanced   across `G` consecutive state deliveries
  (c) inputResolvedThrough has not advanced across the same `G` deliveries
  (d) epoch is unchanged               // T3 owns the domain-change case; a rejoin clears a stall by construction
```

Conditions (b) and (c) together are what distinguishes a stall from an ordinary in-flight frame: a frame the server has
merely not reached yet moves *something*, and a frame the server will never reach moves nothing. `G` is the same delivery
count as §10.3, declared in deliveries **and** milliseconds, and re-measured at Gate A.

**Bounded recovery, two steps, both executable without knowing anything about the server's queue.**

| step | action | bound | outcome |
| --- | --- | --- | --- |
| **R1 — reconcile** | discard the pending input set, resynchronise the local entity from the authoritative snapshot just applied, and re-base the stamp counter so every subsequent frame carries a strictly greater sequence | one attempt per stall episode | clears the ordinary case, including a client that had queued work behind a stranded frame |
| **R2 — rejoin** | if `INPUT_ACK_STALLED` is still true `G` deliveries after R1 completed, leave and rejoin the room, which starts a fresh session epoch and a fresh sequence domain | one rejoin per stall episode; `K` rejoins per minute before the client surfaces a connection error to the player | clears the strand permanently, because the dedupe tracker and the client's stamp base both reset |

No third step exists. A client that could not clear the stall by R2 has a different fault and must not loop: it surfaces
the connection error and stops sending. Both steps are **client-local and time-bounded**, which is what makes the rule
executable when the server has already forgotten the client's frames.

**Server-side confirmation, which the client cannot do.** The server *can* see the same condition exactly, through public
API: `accessor.size === 0` together with `accessor.latest.seq > inputResolvedThrough` and no advance for one patch
interval is `INPUT_STRAND_CONFIRMED`, and §11.2 puts it on the closure path. That asymmetry is the reason both signals
exist: the client's version is a heuristic with a bounded escape, and the server's version is the confirmation that makes
the loss attributable and reported rather than merely survived.

## 11. Point 3 — a testable arrival envelope, not a mean rate

### 11.1 The envelope

A mean of 20 Hz says nothing about a 40-frame burst, so the envelope is declared as a token bucket per entity and stated
in the same units the buffer has:

| parameter | value | basis |
| --- | --- | --- |
| sustained admitted rate `λ` | ≤ one frame per `stepMs` (`S = 20 Hz`) | the adopted consumption rule |
| burst allowance `B` | **`B = 8`, provisional test setting** | must be < the buffer bound so a legal burst never evicts; PR-15 shows the bound holds at 4 and evicts immediately above it. Eight is chosen so the §6.1 burst test is strict but not brittle, and it is a **test value**: the production value is set from the Gate A population, not asserted here |
| production jitter tolerance `J` | **not set — Gate A measures it** | PR-15 is loopback, where `J = 0`. Any number here would be invented. Gate A measures the distribution, then `B` and `J` are fixed together against the inequality below and recorded in the gate evidence |
| token refill | 1 token per `stepMs` | matches consumption exactly |
| arrival jitter tolerance `J` | **owner value, measured at Gate A** | PR-15 is loopback: `J = 0` there, so no number in this file is a measured jitter tolerance |
| stall allowance | one stalled tick must not evict: `B + J·λ + stall ≤ bufferMaxSize` | the derivation to record beside the value; 8 + headroom + 1 ≤ 32 leaves the margin explicit |

`bufferMaxSize` stays 32 (AC-3b). The envelope, not the buffer, is the contract: **inside** it eviction is arithmetically
impossible, so eviction is evidence of an offender rather than of a sizing mistake.

### 11.2 Observed conditions: pressure throttles, confirmed retirement closes

`sanitize` cannot refuse and nothing rejects before the buffer (§1.2), so every consequence is triggered by an observation.
Two consequences, kept strictly apart: **queue pressure throttles; a confirmed unrepresented retirement closes the seat.**
§13 uses these same names and the same mapping, and the two sections must never diverge again.

| id | observed condition (public API named) | consequence | why this consequence |
| --- | --- | --- | --- |
| **X1 `INPUT_QUEUE_PRESSURE`** | `accessor.size ≥ bufferMaxSize − B` | **throttle signal only** — never closure | pressure is a prediction, not a loss. PR-13 measured that acting on a threshold does not stop an over-rate sender, so X1 is not prevention either; closing a seat on a depth heuristic would punish a session that has lost nothing |
| **X2 `INPUT_RETIRED_UNREPRESENTED`** | `consumedDelta − dequeuedCount` increments (§9.3.1) | **bounded seat closure** of §11.2.1 | the loss already happened and cannot be undone by any later action; the residue belongs to this session and the acknowledgement it received was untrue |
| **X3 `INPUT_STRAND_CONFIRMED`** | `accessor.size === 0` **and** `accessor.latest.seq > inputResolvedThrough`, unmoved for one patch interval | **bounded seat closure** of §11.2.1 | the pre-buffer dedupe path: the server will never dequeue the frame the client still counts as outstanding, so no waiting resolves it (§10.5) |
| **X4 `INPUT_RATE_CEILING`** | arrival rate above `Room.maxMessagesPerSecond` | close with the reserved code, no closure window required beyond §11.2.1's cap | a per-second average can only terminate, never prevent; the ceiling is the outer bound when X1's signal is ignored |

X1 may repeat without escalating on its own. X2 and X3 are confirmations and act. X4 is independent of both. A throttle
signal that goes unheeded while X2/X3 never fires is an X4 case, not a reason to close early.

### 11.2.1 The closure window, and what happens when the final patch never arrives

Closure is bounded in both directions: the offender gets a real chance to learn the outcome, and the room gets a definite
end. All three bounds are declared configuration, recorded in the gate evidence.

| bound | value | starts / ends |
| --- | --- | --- |
| `closureWindowMs` | **provisional 250 ms** for tests; production value set with `B` and `J` at Gate A | **starts** at the end of the authority step in which X2 or X3 was confirmed; **ends** at the earliest of: the final state patch having been sent **and** `closureWindowMs` elapsed, the cap `closureMaxMs` reached, or the client leaving on its own |
| `closureMaxMs` | **provisional 1000 ms** | hard cap on the window. A seat is never held open past it for the sake of politeness |
| forced final patch | one `setState`-equivalent publication inside the window | the window exists precisely so the disposition record — `inputResolvedThrough`, named gaps, `inputRetiredUnrepresented`, the terminal reason — can reach the client before the socket closes |

During the window the room admits no further frames from that session, publishes the record once, and then closes with the
reserved code naming the reason. It does not `clear()` and it does not consume more frames: the record describes what
already happened.

**If the final patch never arrives** — lost, or the client was already gone — the protocol does not degrade into guessing:

* the **server** records the confirmed loss regardless. The closure is attributed to X2/X3 with its counters;
  `pendingAtClosure` (§11.3) is recorded from `accessor.size` at close; publication failure is never a reason to report a
  smaller residue;
* the **client** treats *close without a final record* as the worst case, not the benign one: it discards the entire
  pending input set, never prunes by `lastProcessed`, and resynchronises from the authoritative snapshot it receives on
  rejoin. It does not reissue any pending discrete request — §12.3's abandon-by-default rule, resolved from the effect
  ledger;
* the client **does not wait for the patch**. Its own bounds apply: on socket close it executes R1 immediately, and R2 if
  the stall condition is still true after rejoin (§10.5). A missing final patch therefore costs one rejoin, not a stuck
  client;
* nothing in this path may be reported as a successful reconciliation. A closure whose record was never published is
  evidence of a **detected-and-bounded** loss, and Gate A reports it as such (§12.4 GA-7).

### 11.3 Two observations at close, never merged

| field | whose observation | measured source |
| --- | --- | --- |
| `retiredUnrepresented` | server, arithmetic over the domain | `consumedDelta − dequeuedCount` (§9.3.1), plus the named gap ranges |
| `outstandingAtClose` | **client** | its own `pendingCount` at the moment its socket closes — frames it sent and had not been acked for |
| `serverQueuedAtClose` | **server** | `accessor.size` at the moment the seat closes — frames still buffered |

Three separate observations, reported separately and never summed, averaged, or one inferred from another. They answer
different questions and they legitimately disagree: the client can hold frames the server threw away before the buffer
(`pendingCount` 1 with an empty accessor, PR-15), and the server can hold frames the client has already pruned on an ack
that turned out to be unrepresented. Collapsing them would erase exactly the distinction this policy exists to draw —
"the server discarded work" versus "the client was still waiting" — and only the first is a breach of the acknowledgement
clause.

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

### 12.4 Gate A pass/fail criteria for this policy

Each criterion is a decidable condition over recorded artefacts, evaluated on the Gate A harness of §12.1 over a real
round trip with RTT, jitter and loss populations. **A criterion whose artefact is missing, unverifiable or not replayable
is FAIL, not "not run" and not "deferred"** — deferring is what left D-7 unable to be closed the first time. Values marked
*provisional* are test settings; the gate records the measured production value next to the result.

| id | criterion | PASS requires | FAIL is |
| --- | --- | --- | --- |
| **GA-1** | compliant sender inside the envelope, at `B = 8` *provisional* burst, then idle | `retiredUnrepresented == 0` for every compliant entity; buffer depth `< bufferMaxSize` throughout; `inputResolvedThrough` reaches the highest stamp at rest; **zero** resynchronisations | any retirement, any resynchronisation, or a burst that evicts despite being inside the declared envelope (that is an envelope-sizing failure, and it fails the *envelope*, not the client) |
| **GA-2** | queue pressure alone: X1 fired, no confirmation ever observed | throttle signal delivered and obeyed within one round trip; **no closure**; `retiredUnrepresented == 0` | a closure on pressure alone, or pressure producing a retirement that GA-1 says is impossible |
| **GA-3** | confirmed retirement: sender outside the envelope with prevention disabled | X2 fires; the seat closes inside the declared window (`≤ closureMaxMs`); `retiredUnrepresented > 0`, bounded, named and attributed to that session alone; the residue is reported even if the client never acknowledged receipt | closure without a confirmed count; residue attributed room-wide; a zero count reported as success (prevention was disabled, so zero means the counter is broken) |
| **GA-4** | refused frames are represented | for every `refused:*` disposition: the frame is inside `dequeuedCount`, it is **not** charged to `retiredUnrepresented`, it advances `inputResolvedThrough`, and it produced a neutral step journaled once | a refused frame appearing as a retirement, or a refusal with no disposition and no neutral step |
| **GA-5** | eviction versus dedupe attribution | an eviction-only run produces a nonzero `consumedDelta − dequeuedCount` and a matching named range; a dedupe-only run produces **zero** from that subtraction and is detected by the stamped hole **and** T8/X3 — the two runs are distinguishable in the report | either run detected by the wrong mechanism, or a single combined "dropped inputs" counter |
| **GA-6** | client stall with the delivery stream stalled (no patches at all) | `INPUT_ACK_STALLED` fires from client-observable quantities only; R1 then R2 executes within the declared bounds; the client ends with an empty pending set and a matching authoritative record; **no unbounded wait and no rejoin loop** (≤ `K` rejoins/minute, then a surfaced connection error) | any branch that tests server queue emptiness from the client; more than one R1 per episode; more rejoins than `K`; a client that keeps sending into a stall |
| **GA-7** | closure with the final patch deliberately withheld | the server still records the confirmed loss, its counters and `serverQueuedAtClose`; the client discards the whole pending set, prunes nothing by `lastProcessed`, does not reissue a pending request identity, and recovers through rejoin + snapshot inside the declared budget | a client that waits for the missing patch, prunes by `lastProcessed`, reissues blind, or a run reported as a clean reconciliation |
| **GA-8** | same-delivery comparison | across the whole run, every T1 evaluation reads the acknowledgement and `inputResolvedThrough` from the **same** delivery; zero resynchronisations caused by comparing across deliveries | any cross-delivery comparison, or a resynchronisation whose trigger cites two patches |
| **GA-9** | isolation | the compliant entity's per-entity projection (§12.2) is identical to its solo baseline; room-wide ordinals compared only as growth properties | a projection difference; or an assertion that failed only because another session legitimately consumed an ordinal |
| **GA-10** | exactly-once under epoch change | effect ledger shows `Δ == 1` per committed identity, `Δ == 0` for an abandoned identity after the epoch change, `Δ == 1` for a deliberate reissue under a new identity | an epoch change accepted as the proof, a duplicate effect, or a lost committed effect |
| **GA-11** | measurement of `J`, then fixing `B` and `J` | the jitter/overrun population is recorded, the inequality `B + J·λ + stall ≤ bufferMaxSize` is evaluated with the measured values, and the production values are recorded alongside the provisional ones used | production values asserted without a measured population, or the inequality left unevaluated |
| **GA-12** | evidence integrity | every scenario replays from its recorded journal to the same dispositions, canonical state and chain tip; no machine path, token or raw credential in any artefact; `stackCompatibility` asserted **only** where the numeric gates actually pass | a non-replayable scenario artefact, an unsanitised field, or a compatibility claim drawn from probe passage alone |

Gate A **passes** when GA-1 through GA-12 all pass, plus the pre-existing AC-1..AC-20 and numeric gates, on the accepted
harness dependencies (§12.1). It **fails** if any one criterion fails or lacks a verifiable artefact — including GA-11,
where failing to measure the jitter is itself a failure rather than an omission. Nothing in this table can be satisfied by
a loopback probe: PR-8, PR-13 and PR-15 establish that the mechanisms exist and where their limits are, and they are not
substitutes for any row above.

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
> The SDK acknowledgement is a send-order watermark over the client's own send sequence. It is **not** an assertion that an
input was represented in authoritative state, and a client MUST NOT use it as the authority for discarding predicted
input. Each continuous frame carries a client send sequence — the value `sentCount + 1` read before the send, stamped into
the field declared as the room's input `seqField`, strictly increasing within one connection domain — and authoritative
state carries, per entity and per session epoch: `inputResolvedThrough`, the highest sequence for which **every** sequence
at or below it has an explicit disposition; the named gap ranges the server observed; and `inputRetiredUnrepresented`,
computed within one connection domain as the increase in the accessor's consumed count minus the number of real dequeued
input results, where idle-synthesised frames and ticks that dequeue nothing contribute nothing and a frame dequeued then
refused by UDG rules counts as dequeued. Advancing `inputResolvedThrough` past a sequence with no disposition of its own
is prohibited, whether a gap is named or not. This count covers buffer eviction and buffer clearing; it cannot see a frame
the input layer discards before the buffer, which is reported only through a named gap or the stalled-acknowledgement
condition below. The server publishes these fields in the tick in which it consumes.

For a session inside the declared envelope, no frame is retired by the SDK watermark before the authoritative record has
resolved it. For a session outside it the SDK watermark MAY retire frames that were never represented in state; that
residue is attributable to the offending session alone. **Queue pressure causes throttling, not termination.** A
confirmed unrepresented retirement, or a confirmed acknowledgement that can never be satisfied, causes **bounded seat
closure**: the window opens at the end of the authority step that confirmed the condition and closes at the earliest of the
final state publication having been sent and the declared window elapsing, the declared hard cap being reached, or the
client leaving; during it the room admits no further frames from that session and publishes the disposition record once,
without clearing the buffer or consuming further frames. An arrival rate above the declared ceiling closes the seat
directly. If the final publication never reaches the client, the server still records the confirmed loss and its counters,
and the client discards its entire pending input set, prunes nothing by the SDK acknowledgement, reissues no pending
request identity, and recovers by resynchronising from authoritative state on rejoin — a withheld publication is reported
as a detected and bounded loss, never as a successful reconciliation. At closure the server reports `retiredUnrepresented`,
the client's `outstandingAtClose` and the server's `serverQueuedAtClose` as three separate observations, never summed or
inferred from one another.

Record frames consumed but rejected by UDG rules; their effective input is neutral and their authoritative disposition is
recorded, and such a frame is never counted as an unrepresented retirement. A client compares the acknowledgement with the
authoritative record **within one state delivery**, and discards its pending inputs and resynchronises from authoritative
state on: the tolerance being exceeded in that comparison; a nonzero `inputRetiredUnrepresented`; an epoch change observed
in authoritative state; a throttle signal naming a resolved sequence ahead of the client's last represented one; imminent
termination of its own session; an unresolvable state revision; a retired request identity with no disposition; or a
stalled acknowledgement, defined solely from client-observable quantities as a non-empty pending set in which neither the
acknowledgement nor the authoritative record advances across the declared number of consecutive state deliveries while the
session epoch is unchanged. Because the client cannot observe server queue depth through any supported API, that condition
is resolved by a bounded client-side recovery — one reconciliation attempt, then one leave-and-rejoin, which starts a new
session epoch and sequence domain — and never by waiting or by rejoining in a loop. Pruning uses `inputResolvedThrough`,
never `lastProcessed`. Gate A must prove the client reconciles a refusal **and** an overflow-residue case correctly, each
over a real round trip; that pressure alone throttles while a confirmed retirement closes the seat within the declared
window; that eviction and pre-buffer discarding are distinguished in the reported counts; that a withheld final publication
recovers without reissue; that a stalled delivery stream resolves within the declared bounds; and that ordinary delivery
timing causes no resynchronisation.

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
