# ADR 0003 — Input acknowledgement, overflow and resynchronisation policy (D-7)

Status: **Accepted**

Decision ID and title: ADR-0003 — **D7-P1**, the transport posture that keeps one consumed input and one authority step
per connected entity per tick, replaces the SDK acknowledgement as a representation claim with an authoritative per-entity
disposition record, throttles on queue pressure, and closes a seat on a confirmed unrepresented retirement (D-7).

Owner and reviewers: Project owner (`TomBResearch`), acting as integration owner and project reviewer. The implementer
measured, recommended and drafted; it authored no approval and records none of its own.

Date: 2026-11-11 — dated by the commit that carries this record into `main`, because the owner's approval message carries no
independently verifiable timestamp. The same date basis used for the Phase 1 acceptance
([UDG-003-phase-1.md §0.6](../contracts/assignments/UDG-003-phase-1.md)).

Affected task IDs and contract clauses:
[UDG-003](../contracts/UDG-003.md) (D-7; Phase 2 scope),
[decision proposal ADR-P-0003](proposals/UDG-003-d7-input-acknowledgement-policy.md) (superseded on two points, below),
[input-consumption rule](proposals/UDG-003-input-consumption-rule.md),
[Phase 2 assignment draft](../contracts/assignments/UDG-003-phase-2-assignment-draft.md),
[api map §11](../integration/colyseus-0.18-api-map.md),
[movement-authority.md §5.1](../interfaces/movement-authority.md) (**to be amended — application outstanding, §6**),
[protocol-v1.md](../contracts/protocol-v1.md),
[acceptance-gates.md](../validation/acceptance-gates.md) (Gate A criteria GA-1…GA-13).

**Not affected, explicitly:** the frozen 50 ms step, the one-input rule (P03 stage Q), the 32-frame buffer bound (AC-3b),
and every gate. **No gate has been run.** `stackCompatibility` remains **not-established**.

**Amended 2026-11-11** on the owner's instruction (item D-P2-8 of the Phase 2 assignment): §3.2's retry budget is
replaced by the owner-resolved recovery budget, and §7 carries a dated note recording that the **R-2** and **R-7**
reliability defects disclosed here are fixed. The replaced §3.2 wording is quoted in full inside that section rather
than deleted, so the amendment is auditable. Nothing else in the decision changes: D7-P1, the retirement arithmetic, the
diagnostic-only status of a suspected strand, and every Gate A criterion stand as accepted.

**Live status, 2026-11-11:** **Phase 2 is assigned** — [UDG-003-phase-2.md](../contracts/assignments/UDG-003-phase-2.md),
**Ready and not started** — on the implementation baseline of §7's dated note. Phase 3 remains **unassigned**. The §6
application actions are now authorised work, not outstanding instructions, and none of them is performed yet.

## 1. Trigger and reproduction

D-7 asked what transport policy makes the movement-authority acknowledgement requirement honest, given two measured facts
about the pinned `@colyseus/core@0.18.27` / `@colyseus/sdk@0.18.9` / `@colyseus/schema@5.0.45` stack:

* **PR-8** (15 checks) — the SDK acknowledgement is a send-order watermark over the client's own sequence. It carries no
  disposition, and after a disconnect it can sit below what the client sent with no way to reconcile;
* **PR-13** (20 checks) — no supported lever stops a frame being retired by buffer overflow without ever entering state,
  for a session that sends faster than the room consumes. `sanitize` cannot refuse, and nothing rejects before the buffer;
* **PR-15** (27 checks) — the identity mapping that does exist, its limits, and the client's observability surface: the
  stamped `sentCount + 1` equals what `send()` returns and what the room consumes; a retired frame leaves a nameable hole
  between neighbours but retirement before the first consumed frame is unnameable while the accessor's consumed count
  counts it exactly; the sequence domain restarts across a rejoin (`sentCount` 10 → 3) while `InputHandle.epoch` does not
  move; a replayed stamp is discarded **before** the buffer and permanently strands the acknowledgement below the client's
  send count; no disposition of any kind reaches the client; and the acknowledgement is one delivery with state (0 of 60
  samples at default cadence and 0 of 70 at `patchRate` 250 ms against a 50 ms step moved without a state delivery).

Reproduction: `pnpm --filter @udg/server build:probes && npx vitest run tests/contracts/UDG-003.test.ts` on the accepted
pins; probe verdicts and results are retained in the evidence bundles named in §7.

## 2. Decision

**D7-P1 is adopted as owner policy.** Four commitments:

1. **Rate-bounded admission, unchanged consumption.** The admitted continuous-input rate per entity is at most one frame
   per authority tick. Consumption stays exactly as P03 stage Q defines it: one FIFO-selected continuous observation and
   one authority step per connected entity per tick. No `take(n)` with `n > 1`, no drain-to-latest, no backlog.
2. **An authoritative per-entity disposition record replaces the acknowledgement as the representation claim.** Per entity
   and per session epoch: `inputResolvedThrough` (contiguous prefix of explicitly resolved sequences), the named gap ranges
   the server observed, and `inputRetiredUnrepresented` computed by §3.1.
3. **Queue pressure throttles; a confirmed unrepresented retirement closes the seat** — bounded by §3.3. A suspected
   unsatisfiable acknowledgement is **diagnostic only** until positively validated (§3.4).
4. **The client discards pending prediction and resynchronises** on the enumerated triggers, under the client-local deadline
   of §3.2, and prunes by `inputResolvedThrough` — never by the SDK acknowledgement.

Provisional settings accepted **as test settings only**: `B = 8`, `closureWindowMs = 250 ms`, `closureMaxMs = 1000 ms`,
`clientSnapshotDeadlineMs = 500 ms`, and the client recovery budget of §3.2 as amended on 2026-11-11 — a 4000 ms
episode deadline, at most **two actual rejoins in a rolling 60-second window**, and a 250/500/1000 ms backoff ladder that
is a schedule rather than an entitlement. **Gate A must measure and justify production settings** (§5, GA-11).

### 2.1 Disposition of each decision item

| item | owner disposition | what that means now |
| --- | --- | --- |
| **D7-A** adopt D7-P1 | **Accepted** | the policy above is the owner policy for UDG-003 transport work |
| **D7-B** the acknowledgement-clause amendment | **Accepted in substance**; the adopted wording is §4 of this record | **not yet applied to `docs/interfaces/movement-authority.md`** — that file is contract-owned baseline text and this authorisation covered the decision record and the assignment draft only. §6 lists it as the first application action |
| **D7-C** offender consequence | **Accepted** — throttle signal, then bounded closure on confirmation, rate ceiling as the outer bound | the consequence structure in §3.3 replaces "disconnect on threshold" proposals; the reserved close code itself is protocol work in the Phase 2 draft |
| **D7-D** protocol surface | **Accepted as policy**; the concrete edits are scheduled, not performed | `DirectInputSchema` per-frame sequence field, the per-entity record fields and reserved close codes are Phase 2 scope items in the draft assignment; protocol-owned files are untouched here |
| **D7-E** Gate A obligations | **Unchanged** | PR-14 real-state proof, adversarial RTT/loss/jitter tests, UDG-SPIKE-001 convergence, numeric gates, AC-1…AC-20 and the compatibility evidence still have to be produced |
| **D7-F** consequence mapping | **Accepted** | pressure → throttle; confirmed retirement → bounded closure; ceiling → direct closure; suspected strand → diagnostic |
| **D7-G** provisional values | **Accepted as provisional test settings** | `B = 8`, 250 ms, 1000 ms, and the client-side deadline and retry budget of §3.2; production values require the GA-11 measurement |

## 3. Adopted normative detail

### 3.1 The retirement count

Computed **within one connection domain**, snapshotted at domain start and reset on domain change:

```text
retiredUnrepresented += (consumedDelta − dequeuedCount)     // per domain; each step and once at close
consumedDelta  = accessor.consumedCount − domainBaseConsumed
dequeuedCount  = accessor.next() results with accessor.wasIdle === false
```

Idle-synthesised frames and ticks that dequeue nothing contribute nothing. A frame dequeued and then refused by UDG rules
counts as **dequeued** — it is represented by its neutral step, receives a disposition and is never a retirement.
`clear()` is charged, because the declarations advance the acknowledgement on overflow-drop.

Coverage, stated as limits: the subtraction sees **buffer eviction and clearing** and cannot see a frame the input layer
discards **before** the buffer; a hole in the stamped sequence sees both, but only when a later stamp arrives; the
stalled-acknowledgement condition of §3.2 is the only client-side recourse for a terminal pre-buffer discard.

Two boundary statements, so the record does not overclaim. First, in a room that keeps ticking, an eviction is always
followed by the consumption of a newer frame — the buffer drops the *oldest* entries — so the only unnameable hole is the
**leading** one, before the room's first consumed frame. There is no "trailing hole" category in a draining room, and this
record does not assert one. Second, whether frames still buffered when a seat closes are dropped **without** advancing the
accessor's consumed count is **unmeasured**: PR-15 measured `serverQueuedAtClose` and PR-13 measured termination freezing
the watermark, but neither measured the close-path accounting. Whether `serverQueuedAtClose` must therefore be added to the
retirement total at closure is an explicit Gate A measurement obligation (Phase 2 draft item **W-9**), not an assumption
made here.

At closure, three observations are reported separately and never summed or inferred from one another:
`retiredUnrepresented` (server arithmetic), `outstandingAtClose` (client `pendingCount` at socket close) and
`serverQueuedAtClose` (`accessor.size` at seat close).

### 3.2 The client-local deadline

The client's recovery must not depend on a server event. **`clientSnapshotDeadlineMs` is a client-local timer that can
expire with no state delivery at all.**

```text
timer starts / restarts on: an accepted state delivery (snapshot application or patch advancing authoritative state)
timer is armed while:     the client holds an outstanding input, or expects state it has not received
on expiry (500 ms provisional):
  1. STOP SENDING     — no further send() until recovery completes
  2. DISCARD PENDING PREDICTION — drop the pending input set and any locally predicted continuation;
                                  hold the last authoritative snapshot rather than extrapolating
  3. BOUNDED REJOIN   — leave and rejoin, within the retry budget
  4. SNAPSHOT RECOVERY— apply the authoritative snapshot before any further input; re-baseline epoch and stamp base
if no fresh snapshot is available: remain stopped and continue within the retry budget; on budget exhaustion surface a
                                 connection error and stay stopped — no sending, no prediction, no silent resume
```

Recovery budget (provisional test settings), **as amended 2026-11-11**:

| limit | value | behaviour when it is reached |
| --- | --- | --- |
| client-local snapshot deadline | `clientSnapshotDeadlineMs = 500 ms`, restarted on each accepted state delivery, able to expire with no delivery at all | stop sending, discard pending prediction, enter recovery |
| recovery-episode deadline | `clientRecoveryDeadlineMs = 4000 ms`, measured from the start of the episode | the episode ends: the client stays stopped, keeps its prediction discarded, surfaces a connection error, and starts no further rejoin in that episode |
| rolling rejoin allowance | **at most two actual rejoins in any rolling 60-second window**, counted per entity across episodes | the next rejoin is not attempted: the client stays stopped, records `recoverySuspended: 'rolling-window'`, and retries only when the oldest counted rejoin leaves the window |

The 250 / 500 / 1000 ms ladder is a **backoff schedule, not an entitlement**: an attempt is made at the next ladder step
only if the rolling allowance still has room and the episode deadline has not expired. **Whichever limit is reached first
governs**, and the behaviour at each of the three limits is a required observation, not an internal detail: a limit that is
silently absorbed is a limit nobody tests. Exhaustion of any kind is a surfaced failure state, never a retry loop. Because
`clientSnapshotDeadlineMs` (500 ms) is shorter than `closureMaxMs` (1000 ms), a stalled client is expected to recover on its
own **while the server is still inside its closure window**; that is correct behaviour on both sides and is tested as GA-7.

> **Amendment, 2026-11-11 (owner decision D-P2-8).** The text this replaces read: *"Retry budget (provisional test
> settings): 3 rejoin attempts with backoff 250 / 500 / 1000 ms inside `clientRecoveryBudgetMs = 4000 ms`, plus a sustained
> cap of 2 rejoins per 60 s."* Those two clauses could not both hold — an episode that spent its third attempt breached the
> cap the same sentence imposed, so a client could obey one clause only by breaking the other. The owner resolved it in
> favour of the cap: **two actual rejoins in a rolling 60 seconds**, with the four-second episode deadline still applying.
> The key is renamed `clientRecoveryDeadlineMs` because it bounds one episode rather than budgeting attempts; that is the
> name Phase 2 declares in `packages/config`. The resolution was carried first by §2.1 of the Phase 2 assignment draft,
> and this record is amended to match it so that the decision and the assignment cannot be read to say different things.

The stalled-acknowledgement signal that normally fires this path is `INPUT_ACK_STALLED`, defined solely from
client-observable quantities: an outstanding input, with neither the SDK acknowledgement nor `inputResolvedThrough`
advancing across `G` consecutive state deliveries, epoch unchanged. **No client-side condition may test server queue
depth — no supported client API exposes it.**

### 3.3 Pressure, confirmation, ceiling

| signal | observed through | consequence |
| --- | --- | --- |
| `INPUT_QUEUE_PRESSURE` | `accessor.size ≥ bufferMaxSize − B` | **throttle only.** Never closure: a depth heuristic would punish a session that has lost nothing, and PR-13 measured that acting on a threshold is not prevention |
| `INPUT_RETIRED_UNREPRESENTED` | §3.1 arithmetic increments | **bounded seat closure.** The loss is arithmetic on the accessor's own counters — direct evidence, not a hypothesis |
| `INPUT_STRAND_SUSPECTED` | `accessor.size === 0` **and** `accessor.latest.seq > inputResolvedThrough`, unmoved for one patch interval | **diagnostic: record, attribute, may throttle. No closure** until positively validated under §3.4 |
| `INPUT_RATE_CEILING` | above `Room.maxMessagesPerSecond` | close directly with the reserved code; a per-second average can only terminate |

Closure window: opens at the end of the authority step that confirmed the condition; ends at the earliest of (final state
publication sent **and** `closureWindowMs` elapsed), `closureMaxMs` reached, or the client leaving. During it the room admits
no further frames from that session and publishes the disposition record once — without clearing the buffer and without
consuming further frames.

If the final publication never reaches the client, the server still records the confirmed loss, its counters and
`serverQueuedAtClose`; the client follows §3.2 — stop sending, discard pending prediction, bounded rejoin, snapshot
recovery — and reissues no pending request identity. A withheld publication is reported as a detected and bounded loss,
never as a successful reconciliation.

### 3.4 Positive evidence before a dedupe signal may close

`INPUT_STRAND_SUSPECTED` is a **hypothesis**: the same observable shape is produced by a client that stopped sending, an
idle entity, ordinary in-flight frames, patch delay, and a reconnect domain restart. PR-15 demonstrated one cause of it
(pre-buffer dedupe) but did not demonstrate that it is the only cause, and closure on an unvalidated signature would
terminate compliant sessions. Until **every** criterion below passes, the signal records and may throttle, and client
recovery under §3.2 remains the remedy.

| id | positive evidence required |
| --- | --- |
| **PE-1** | the signature reproduces deterministically in a controlled scenario that deliberately performs a pre-buffer dedupe, and appears when and only when a replayed stamp is observed |
| **PE-2** | a negative-control population of **compliant** runs — varied RTT, jitter, patch cadence, idle periods, mid-flight loss and reconnects — yields **zero** occurrences. Any occurrence keeps the signal diagnostic |
| **PE-3** | the missing stamp is **named**: the server identifies the specific sequence value that the journaled client transcript shows was sent, so the closure is attributable to one identified input rather than inferred from a stall |
| **PE-4** | the signature is distinguished from every benign alternative, each with its own control scenario: client stopped sending; idle entity; in-flight frames; patch delay; reconnect domain restart; a dequeued-then-refused frame |
| **PE-5** | the detection is replayable — the same journal yields the same detection, the same reason and the same chain tip |

Gate A asserts this as **GA-12**. Note that terminal dedupe — a discard with no later stamp — cannot satisfy PE-3 by
construction: there is no later stamp to name the hole. Such a case is therefore **permanently outside** the closure path,
and §3.2's bounded client recovery is the only remedy it can ever have. That is a limit of the design, recorded rather than
papered over.

## 4. Adopted wording for the acknowledgement clause

Intended to replace the second, third and fourth sentences of the
[movement-authority.md §5.1](../interfaces/movement-authority.md) paragraph beginning "Input buffering is initially bounded
at 32 frames per client", with the buffer bound, the first sentence and every other clause of §5.1 unchanged. **Recorded
here as adopted; not yet applied** — see §6.

> Input buffering is initially bounded at 32 frames per client. The admitted continuous-input rate per entity is at most one
> frame per authority tick, with a burst allowance declared as configuration below the buffer bound; a client that exceeds
> the declared envelope is an offender. Do not drain a burst then simulate only its last frame, or move a character
> repeatedly to empty a queue. Queue overflow and stale backlog handling must use demonstrated supported SDK behaviour, with
> a bounded offender disconnect when safe continuity cannot be proven.
>
> The SDK acknowledgement is a send-order watermark over the client's own send sequence. It is **not** an assertion that an
> input was represented in authoritative state, and a client MUST NOT use it as the authority for discarding predicted
> input. Each continuous frame carries a client send sequence — the value `sentCount + 1` read before the send, stamped into
> the field declared as the room's input `seqField`, strictly increasing within one connection domain — and authoritative
> state carries, per entity and per session epoch: `inputResolvedThrough`, the highest sequence for which **every** sequence
> at or below it has an explicit disposition; the named gap ranges the server observed; and `inputRetiredUnrepresented`,
> computed within one connection domain as the increase in the accessor's consumed count minus the number of real dequeued
> input results, where idle-synthesised frames and ticks that dequeue nothing contribute nothing and a frame dequeued then
> refused by UDG rules counts as dequeued. Advancing `inputResolvedThrough` past a sequence with no disposition of its own
> is prohibited, whether a gap is named or not. This count covers buffer eviction and buffer clearing; it cannot see a frame
> the input layer discards before the buffer, which is reported through a named gap only when a later stamp makes one
> nameable. The server publishes these fields in the tick in which it consumes.
>
> For a session inside the declared envelope, no frame is retired by the SDK watermark before the authoritative record has
> resolved it. For a session outside it the SDK watermark MAY retire frames that were never represented in state; that
> residue is attributable to the offending session alone. **Queue pressure causes throttling, not termination.** A
> confirmed unrepresented retirement causes **bounded seat closure**: the window opens at the end of the authority step that
> confirmed the condition and closes at the earliest of the final state publication having been sent and the declared window
> elapsing, the declared hard cap being reached, or the client leaving; during it the room admits no further frames from
> that session and publishes the disposition record once, without clearing the buffer or consuming further frames. An
> arrival rate above the declared ceiling closes the seat directly. A suspected unsatisfiable acknowledgement — an empty
> server buffer alongside an unresolved stamp — is recorded as a **diagnostic** and MAY cause throttling, and MUST NOT
> terminate a seat until it has been positively validated by the Gate A evidence criteria, including a compliant control
> population that never produces it and an identified missing stamp; where no later stamp exists, it can never be
> validated and client-side recovery is the only remedy. If the final publication never reaches the client, the server still
> records the confirmed loss and its counters, and the client stops sending, discards its pending prediction, reissues no
> pending request identity, and recovers by bounded rejoin and snapshot resynchronisation — a withheld publication is
> reported as a detected and bounded loss, never as a successful reconciliation. At closure the server reports
> `retiredUnrepresented`, the client's `outstandingAtClose` and the server's `serverQueuedAtClose` as three separate
> observations, never summed or inferred from one another.
>
> Record frames consumed but rejected by UDG rules; their effective input is neutral and their authoritative disposition is
> recorded, and such a frame is never counted as an unrepresented retirement. A client compares the acknowledgement with the
> authoritative record **within one state delivery**, and discards its pending inputs and resynchronises from authoritative
> state on: the tolerance being exceeded in that comparison; a nonzero `inputRetiredUnrepresented`; an epoch change observed
> in authoritative state; a throttle signal naming a resolved sequence ahead of the client's last represented one; imminent
> termination of its own session; an unresolvable state revision; a retired request identity with no disposition; a stalled
> acknowledgement defined solely from client-observable quantities as a non-empty pending set in which neither the
> acknowledgement nor the authoritative record advances across the declared number of consecutive state deliveries while the
> session epoch is unchanged; or **expiry of its own snapshot deadline, which runs from the last accepted state delivery and
> expires whether or not any delivery arrives**. On any such trigger the client stops sending, discards pending prediction,
> and proceeds to bounded rejoin and snapshot recovery within the declared retry budget; when no fresh snapshot is
> available it remains stopped and, on budget exhaustion, surfaces a connection error rather than resuming. Because the
> client cannot observe server queue depth through any supported API, recovery is always this bounded client-side path and
> never waiting or rejoining in a loop. Pruning uses `inputResolvedThrough`, never `lastProcessed`. Gate A must prove the
> client reconciles a refusal **and** an overflow-residue case correctly, each over a real round trip; that pressure alone
> throttles while a confirmed retirement closes the seat within the declared window; that eviction, nameable dedupe and
> terminal dedupe are handled as three distinct cases; that a stalled delivery stream and a withheld final publication both
> resolve through the client-local deadline within the declared budget; and that ordinary delivery timing causes no
> resynchronisation.

## 5. Gate A criteria for this policy

Evaluated on the Gate A harness defined in [ADR-P-0003 §12.1](proposals/UDG-003-d7-input-acknowledgement-policy.md) — the
flat reference step plus real replicated state, with no dependency on locomotion, physics or navigation — over a real round
trip with RTT, jitter and loss populations. **A criterion whose artefact is missing, unverifiable or not replayable is FAIL**,
not "not run". Provisional values below are test settings; GA-11 re-derives production values from measurement.

| id | criterion | PASS | FAIL |
| --- | --- | --- | --- |
| **GA-1** | compliant sender, `B = 8` burst then idle | `retiredUnrepresented == 0`; depth `< 32` throughout; `inputResolvedThrough` reaches the highest stamp at rest; zero resynchronisations | any retirement or resynchronisation; a legal burst that evicts (fails the envelope, not the client) |
| **GA-2** | pressure only, no confirmation | throttle obeyed within one round trip; **no closure**; zero retirements | a closure on pressure alone; pressure producing a retirement GA-1 says is impossible |
| **GA-3** | confirmed retirement, prevention disabled | closure within `closureMaxMs`; residue `> 0`, bounded, named, attributed to that session; reported even if never acknowledged | closure without a confirmed count; room-wide attribution; zero reported as success |
| **GA-4** | refused frames are represented | refused frame inside `dequeuedCount`, not charged as retired, advances `inputResolvedThrough`, neutral step journaled once | a refusal counted as retirement; a refusal with no disposition and no neutral step |
| **GA-5a** | **dedupe followed by a later stamp** — a gap is nameable | the gap is named as a range in the record; the subtraction stays zero for that frame; the client detects the named range and resynchronises; the server **does not close** unless PE-1…PE-5 all pass, and the run records whether validation passed | the gap unreported or charged to the wrong mechanism; a closure with PE-1…PE-5 unproven; a run that closes because the shape looked like dedupe |
| **GA-5b** | **terminal dedupe** — no later stamp, the server cannot identify the missing input | §3.2's bounded recovery succeeds despite the unidentifiable loss: deadline expires, client stops sending, discards pending prediction, rejoins within budget, applies a snapshot and matches authoritative state; the frame is applied at most once; the server reports the loss as **unidentifiable** rather than inventing a gap or a cause | a client loop, sending into the stall, double application, or a server record that asserts a cause or a missing range it cannot evidence |
| **GA-6** | **stalled delivery stream, client-local deadline** | three sub-cases pass: **6a** patches stop while inputs are outstanding → the deadline expires at the declared test value, sending stops, pending prediction is discarded, rejoin and snapshot recovery complete within budget; **6b** the server neither sends nor closes → the client still recovers on its own timer, proving the deadline does not depend on a server event; **6c** a limit is reached — the episode deadline expires, or the rolling two-rejoin allowance is spent → a surfaced error or a recorded `recoverySuspended` state as §3.2 requires; client stays stopped, no prediction, no sends | recovery that requires a delivery or a close event to begin; a test value exceeded; any send after expiry; extrapolated prediction after expiry; more rejoins than the budget |
| **GA-7** | **final publication withheld** | the server still records the loss, its counters and `serverQueuedAtClose`; the client's deadline expires inside the server's closure window, it recovers through rejoin + snapshot, and applies nothing twice | waiting for the missing patch; pruning by `lastProcessed`; blind reissue; reporting a clean reconciliation |
| **GA-8** | same-delivery comparison | every trigger evaluation reads the acknowledgement and `inputResolvedThrough` from one delivery | any cross-delivery comparison; a trigger citing two patches |
| **GA-9** | isolation | the compliant entity's per-entity projection `(clientSeq \| null, disposition, dx, dy, entityStateDigest)` is identical to its solo baseline; room-wide ordinals compared as growth only | a projection difference; a failure caused only by another session legitimately consuming an ordinal |
| **GA-10** | exactly-once across an epoch change | effect ledger `Δ == 1` per committed identity, `Δ == 0` for an abandoned identity, `Δ == 1` for a deliberate reissue under a new identity | an epoch change accepted as the proof; a duplicate or lost effect |
| **GA-11** | production settings measured and justified | the jitter/overrun and round-trip populations are recorded; `B + J·λ + stall ≤ bufferMaxSize` is evaluated on measured values; `clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT` is evaluated; production values recorded beside the provisional ones, with any change explained | asserting production values without a measured population; leaving either inequality unevaluated |
| **GA-12** | **positive evidence for the dedupe closure signal** | PE-1…PE-5 all pass, including a zero-false-positive compliant control population and a named missing stamp; only then may the signal terminate a seat, and the run records the control size | a closure on the suspected signal; an untested control; a closure whose missing stamp is not identified; PE-3 demanded of a terminal-dedupe case, which cannot supply it |
| **GA-13** | evidence integrity | every scenario replays to the same dispositions, canonical state and chain tip; no machine path, token or credential in any artefact; `stackCompatibility` asserted only where the numeric gates actually pass | a non-replayable artefact; an unsanitised field; a compatibility claim drawn from probe passage alone |

Gate A **passes** when GA-1…GA-13 all pass together with AC-1…AC-20 and the numeric gates, on the accepted harness
dependencies. It **fails** if any single row fails or lacks a verifiable artefact — including GA-11, where failing to measure
is itself the failure. No row can be satisfied by a loopback probe: PR-8, PR-13 and PR-15 show that the mechanisms exist and
where their limits are.

## 6. Application actions: now assigned, none performed

This record remains documentation: it performs none of the actions below. Items 1 to 3 were **authorised for Phase 2
implementation on 2026-11-11** by the owner's decisions D-P2-2, D-P2-3 and D-P2-4, and are **assigned work** in
[UDG-003-phase-2.md](../contracts/assignments/UDG-003-phase-2.md) (W-1, W-2, W-3), which is **Ready and not started**:

1. apply §4 to [movement-authority.md §5.1](../interfaces/movement-authority.md) — contract-owned text — **assigned (W-1),
   not applied**;
2. protocol edits in `packages/protocol` — the `DirectInputSchema` per-frame sequence field with validator, mapping and
   fixtures, the per-entity record fields, and the reserved close codes (**D7-D** execution) — **assigned (W-2), not
   edited**;
3. declare `B`, `J`, the closure bounds, `G`, and the client deadline and recovery budget of §3.2 as amended in
   `packages/config` so they are hashed, moving the active `configHash` pins and their fixtures together while historical
   evidence keeps the digest of the baseline it belongs to — **assigned (W-3), not declared**, and production tuning still
   depends on the Gate A measurement;
4. run Gate A — **Not Run**. Its formal execution belongs to **UDG-SPIKE-001** after that task's prerequisites are
   verified (owner decision D-P2-5); Phase 2 builds the substrate and reports criterion evidence, and declares no gate
   passed. Nothing in this record passes it.

The three items are listed here rather than only in the assignment so that a reader of the decision sees the same
distinction the assignment makes: **decided** is not **done**, and **authorised** is not **implemented**.

## 7. Evidence links and follow-up

Probe verdicts `PR-0 49 · PR-1 43 · PR-2 7 · PR-3 10 · PR-8 15 · PR-12 6 · PR-13 20 · PR-15 27`, all `pass`, with
`stackCompatibility: not-established`, in the retained bundles
`/workspace/udg-evidence/ci-run-43033573543`, `ci-run-43035450600`, `ci-run-43043889689` and `ci-run-43051206820`.
The last of those is the run that covers this record: the decision commit `376469b171832adba8363642eaf2723d6528cdbc`
reached `main` in the same push as the Phase 2 draft head `0b139eabad429e67b0a168fd6a364918b9aa2800`, so the workflow ran
once, on the head, with the decision commit as its ancestor. There is no separate CI run for `376469b…`, and none is
claimed.

**Two runs failed because of a probe defect, and neither was re-run to obtain a green.** The records-only head
`b0a7a7b51181202d2a07707f3f456563ce8ff02f` (run `43053089415`) failed four UDG-003 contract tests reading the **PR-15**
verdict; the next records-only head `178dfcec011b89de37d175e6334b4ac218fef668` (run `43055416863`) had a green test step
(`521 tests, 0 failures`) and failed at evidence verification, because that workflow's later probe invocation failed and the
bundle honestly recorded status `FAIL`. The cause is the probe's **non-atomic observation capture**: it publishes a live
array reference beside point-in-time scalars, so the artefact can disagree with itself and the assertions that read it are
intermittent. Both retained bundles carry a `NOTICE.txt`; the first also records that its probe artefacts are *not* the
failing invocation, because the workflow runs the probes twice into one directory and overwrote them (**R-7**).

**A green run after them is not a fix.** Head `496f3317859bb2415ae4cc9be85b2f1bcc05f85d` (run `43057524877`) passed, and its
artefact carries the same inconsistency harmlessly: `gaps` sum to 3 while `skipped` says 2. The defect is therefore always
present; only the assertion outcome varies with arrival interleaving. Hosted outcome so far is two failures out of four
runs; locally one failure in nine runs. Recorded as **R-2** and **R-7** of the
[Phase 2 draft](../contracts/assignments/UDG-003-phase-2-assignment-draft.md), with the minimal deterministic fix specified
and deliberately **not applied**, because the instruction behind this record authorises documentation only. Until that fix
lands, PR-15 must not be used as a Gate A substrate.

> **Dated note, 2026-11-11 — the condition above is discharged, and the sentence stands as written.** The owner accepted
> the fixes at review `8716b8c6e3c4a3f005fe260eebf5569bb02201dd`, CI
> [43079200640](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43079200640). **R-2** is fixed by
> `98cd592fb2b4a35c53eec93f243a24449046faf8`: the room owns the observation, settles on `accessor.size === 0`, copies every
> array by value and derives its own totals inside that single read, and the exact-gap assertions now live only in the
> controlled case while the uncontrolled case is asserted on the identity
> `consumed + skipped + unnamed = frames sent`. **R-7** is fixed in the same commit: every result file names its
> invocation, each invocation writes its own directory, the ledger is append-only, and `evidence.js probes` refuses
> unattributed, misattributed, unledgered or undisclosed-failure evidence — so the overwrite that destroyed the bytes above
> is now a gate failure rather than a discovery. A third defect that the new gate caught on its first hosted run (the
> bundle sanitiser rewriting every backslash, which made six probe artefacts unparseable) is fixed by
> `f2b31ad6eca33c620dd54b1f6c079817f179115f`, with the red run
> [43070703836](https://github.com/TomBResearch/UntitledDinosaurGame/actions/runs/43070703836) retained rather than re-run
> away. Full incident detail is in [UDG-003-phase-2.md §7](../contracts/assignments/UDG-003-phase-2.md) and §9.1–§9.3 of
> its predecessor draft. **PR-15 is therefore admissible as a Gate A substrate**, at 32 checks `pass`; PR-14 remains
> reserved for the real-state probe, and Gate A itself remains **Not Run**. This decision's substance is unaffected: its structural findings —
identity alignment, per-connection domain restart, pre-buffer discarding, atomic acknowledgement/state delivery — were each
reproduced in retained artefacts. Gate A remains **Not Run**. PR-15 is registered in `tests/probes/colyseus-server.probe.ts` and asserted by the UDG-003 contract suite, so a
future pin change fails loudly instead of silently altering this decision's basis. **PR-14 remains reserved** for the Gate A
real-state probe and the suite asserts its absence.

Follow-up: the approved assignment is
[UDG-003-phase-2.md](../contracts/assignments/UDG-003-phase-2.md) — **Ready, unstarted** — which supersedes the
[reviewable draft](../contracts/assignments/UDG-003-phase-2-assignment-draft.md). The draft is retained for its risk
record and its decision history; it no longer carries the live scope.

Supersedes or is superseded by: supersedes [ADR-P-0003](proposals/UDG-003-d7-input-acknowledgement-policy.md) on two points
only — the closure condition for a suspected strand (§3.4) and the client-local deadline (§3.2); the proposal remains the
evidence record for everything else. Supersedes nothing else. Does not weaken ADR-0001 or ADR-0002, and is not a
compatibility claim.
