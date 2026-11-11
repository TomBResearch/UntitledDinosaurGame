# ADR-P-0003 proposal — D-7: input acknowledgement, overflow and resynchronisation policy

Status: **Proposed. This document assigns no work, amends no contract clause, adopts nothing and opens no phase.**
It is a decision paper for owner review of **D-7**, which remains **open**. Phase 2 and Phase 3 remain **unassigned**;
Gates A, B and C remain **Not Run**; `stackCompatibility` remains **not-established**. UDG-003 remains **In Progress**,
with Phase 1 accepted at phase level on 2026-11-11 at `5d77c6125e1c3a8035ae5c0cb5d115e91f008c9c`.

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
| **D7-D** | authorise the protocol surface the policy needs: a per-entity authoritative **input disposition watermark** in replicated state, and reserved close codes | the client has nothing to reconcile against except the SDK watermark, which is exactly the thing D-7 says cannot be trusted |
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

* the authoritative per-entity disposition watermark in replicated state, and its projection/mapping rules (**D7-D**);
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
| `defineInput(…, { seqField })` | the ack remains a send-order watermark (9 violations) |
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

### 3.2 Proposed replacement wording (apply only on adoption)

Replace the second, third and fourth sentences of the §5.1 paragraph quoted in §1.1 with the following. The first
sentence of that paragraph, the buffer bound of 32 frames per client, and every other clause of §5.1 are unchanged.

> Input buffering is initially bounded at 32 frames per client. The admitted continuous-input rate per entity is at
> most one frame per authority tick; a client that exceeds that rate is an offender. Do not drain a burst then simulate
> only its last frame, or move a character repeatedly to empty a queue. Queue overflow and stale backlog handling must
> use demonstrated supported SDK behaviour, with a bounded offender disconnect when safe continuity cannot be proven.
>
> The SDK acknowledgement is a send-order watermark over the client's own send sequence. It is **not** an assertion that
> an input was represented in authoritative state, and a client MUST NOT use it as the authority for discarding
> predicted input. For every tick in which an entity's continuous input is resolved, authoritative state carries an
> **input disposition watermark** for that entity: the highest client sequence resolved, and that frame's disposition —
> `applied`, `refused` with its protocol rejection code, or `neutral`.
>
> For a session that respects the admitted rate, no frame is retired by the SDK watermark before the authoritative
> input disposition watermark has resolved it. For a session that does not, the SDK watermark MAY retire frames that
> were never represented in state; that residue is a violation attributable to the offending session, is bounded by the
> buffer bound plus recorded detection latency, is reported in `abuse-results.json` under its own reason, and terminates
> the offending seat. It is never evidence of a compatible stack, and it is never repaired by draining.
>
> Record frames consumed but rejected by UDG rules; their effective input is neutral and their authoritative disposition
> is recorded. A client discards its pending inputs and resynchronises from authoritative state whenever its SDK
> watermark has retired a frame the authoritative input disposition watermark has not resolved, and on every
> reconnection and epoch change. Gate A must prove the client reconciles a refusal **and** an overflow-residue case
> correctly, each over a real round trip.

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
| **T1** | the SDK watermark retires a sequence the authoritative disposition watermark has not resolved | this is exactly the residue case; the frame may never have been simulated, so its predicted motion is fictional |
| **T2** | socket close, connection failure or transport error, before sending any further input on the replacement session | frames in flight may have been simulated or not; the client cannot tell |
| **T3** | epoch change, including rejoin with preserved identity | every pending frame belongs to the previous epoch and will be refused; keeping them predicts motion that can never be accepted |
| **T4** | receipt of a throttle signal whose resolved watermark is ahead of the client's last represented frame | the server has already resolved more than the client knows it predicted correctly |
| **T5** | receipt or prediction of imminent termination for its own session (rate ceiling reached, reserved close code) | residue after close is unacknowledged forever (§3.2) |
| **T6** | an authoritative state revision the client cannot map to a tick it knows (missed revision beyond its retained window) | there is no frame of reference left to predict against |
| **T7** | a pending discrete request identity retired by the watermark with no disposition recorded | the client cannot tell whether the action happened; retrying could duplicate it, so state decides |

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
keepalive was consumed without becoming an intention (AC-16); or the pending set is simply unresolved but not yet
outrun, which is ordinary latency.

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
did. Gate A additionally requires: PR-14 real-state correctness (real shared locomotion step against real replicated
`RegionSchema`/`PlayerSchema` with the collision pass in the loop, asserting on state, not logs); the burst and
adversarial set in §6 under non-zero round trip, loss and jitter; UDG-SPIKE-001 convergence claims — that a client stops
predicting from a retired frame, and behaviour under disconnect, loss and reconnect; the numerical gates (the 40 m flat
trace within `1e-6 m`, the per-tick displacement cap, the 0.15 m direct-correction limit) and the proof that burst count
cannot increase travel; AC-1..AC-20 including AC-15 (both bundles verify on the pushed head), AC-16..AC-20; and a
stack-compatibility claim, which today remains `not-established`. PR-0 passing under
[ADR-0002](../0002-server-declaration-checking-exception.md) is a compiler-policy result and is not compatibility.

### 5.5 Provenance of every number quoted here

Probe verdicts and results: `probes/PR-8.probe-result.json` and `probes/PR-13.probe-result.json` in the retained bundle
`/workspace/udg-evidence/ci-run-43010353106/UDG-003-2026-11-11T11-20-26-111Z-5d77c612`, verdicts `PR-8=pass(15)`,
`PR-13=pass(20)`; the posture table with all ten rows is in
[colyseus-0.18-api-map.md](../../integration/colyseus-0.18-api-map.md) and
[UDG-003-phase-0-completion.md §9.2 and §10.2](../../contracts/assignments/UDG-003-phase-0-completion.md).
Journal, disposition and reconciliation behaviour: the accepted Phase 1 core at the same head, vectors in the same
bundle's `vectors/` directory, gate `node tools/checks/dist/evidence.js vectors --dir <directory>`.

## 6. Acceptance tests for this policy

These are the tests the owner should require before D-7 can be closed. They are written as pass conditions with named
artefacts, not as implementation. Each must also satisfy AC-3d/AC-20: replaying the recorded journal reproduces the same
dispositions, canonical state and chain tip.

### 6.1 Overflow

| id | scenario | pass condition |
| --- | --- | --- |
| **OF-1** | compliant sender at `λ = S`, 200 ticks | zero evictions; `overflowCauses` all zero; SDK watermark and authoritative disposition watermark equal at every tick boundary; `stepCount == tickCount` |
| **OF-2** | compliant sender with declared jitter plus one deliberately stalled tick | buffer bound 32 never exceeded; the PR-13 identity set `ackedUnrepresented` stays empty; no `dropped` disposition appears; the stall shows as `neutral` steps, never as catch-up motion (AC-16, AC-18) |
| **OF-3** | non-compliant sender at 5× the admitted rate | detection latency recorded; throttle signal issued and obeyed within one round trip; the residue inside that session is **non-zero, bounded and named** — a zero count here would mean the violation was hidden, not prevented; the client reaches an empty pending set within the declared resynchronisation budget |
| **OF-4** | persistent offender after the signal is ignored | rate ceiling reached and seat closed with the reserved code; the watermark is frozen at closure; the residue is recorded as unacknowledged rather than represented; no write after closure; the bound was never exceeded (AC-3b) |
| **OF-5** | step overrun: a tick blocked past `dt` while arrival continues | arrival is held, never digested: the deferred intake bound holds and its rejections are counted by cause; the outcome is bounded, explicitly disposed eviction or refusal-plus-resynchronisation — never silent retirement |

### 6.2 Isolation of other players

| id | scenario | pass condition |
| --- | --- | --- |
| **IS-1** | two sessions, one compliant and one offending; run the compliant journal solo as a baseline | the compliant player's consumed ordinals, dispositions, step counts and trajectory are **identical to the solo baseline** — byte-equal canonical state at every tick, not merely "unaffected on average" |
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
| **RC-5** | discrete request retried across the reconnect | the retry is a new-epoch request, not a `DUPLICATE_REQUEST` of the pre-disconnect one, and it commits the action exactly once (AC-19); a same-epoch retry still collapses to one disposition and one publish |
| **RC-6** | one player reconnects while others continue | IS-1 holds across the reconnect; the rejoining entity steps exactly once on the tick it resumes (AC-18); other players' watermarks and dispositions are untouched |

Artefacts: `ticks.jsonl`, `inputs.jsonl`, `buffer-depth.csv`, `abuse-results.json` (with dropped and refused reported
separately by reason — AC-3e), `room-lifecycle.json`, plus the Phase 1-style vector JSON for each scenario, gated so a
claimed live/replay equivalence that the artefacts do not prove fails the run.

## 7. Configuration and protocol consequences if D7-P1 is adopted

| item | value | status |
| --- | --- | --- |
| admitted continuous rate per entity | `λ ≤ S`, `S = 20 Hz` | derive from the frozen step rate; declare in `packages/config` so it is hashed |
| continuous buffer bound | 32 frames per client | already adopted (AC-3b); unchanged |
| headroom justification | jitter, tick overrun, signal round trip | **formula, not values** — the numbers come from the §6 jitter and overrun tests, not from PR-13 |
| offender consequence | throttle signal and/or `Room.maxMessagesPerSecond` with reserved close code | **D7-C**; note that the ceiling is a per-second average and cannot prevent the first over-quota window, so it terminates rather than prevents |
| authoritative disposition watermark | per-entity sequence + disposition, published in replicated state | **D7-D**; touches frozen protocol surface, so protocol-owned files change only with owner approval |
| reserved close codes | offender termination | none reserved today; reservation is protocol-owned |

## 8. What this proposal does not do

It does not amend `docs/interfaces/movement-authority.md`, `docs/interfaces/protocol.md`,
`docs/contracts/protocol-v1.md` or any specification — §3.2 is proposed wording held for owner decision. It does not
assign Phase 2 or Phase 3, reopen Phase 1, or treat the accepted Phase 1 status as relevant to D-7 in either
direction. It does not adopt `take(n)` or any multi-input consumption; the [input-consumption rule
proposal](UDG-003-input-consumption-rule.md) remains the statement of that question and its answer is unchanged. It
does not close D-7, pass or alter Gates A/B/C, provision evidence storage (D4 remains open), or make any third-party
compatibility claim. If the owner declines D7-B, the honest repository state is unchanged: **D-7 remains open, and
Phase 2 cannot be scoped honestly until either the clause is amended or a different mechanism makes representation
observable to the client.**
