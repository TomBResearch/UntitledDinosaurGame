# UDG-003 Phase 2 — amendment and test plan for the remaining decisions

> **Status: proposal, for owner review. Nothing in this file has been applied.** No governing document has been
> edited, no test line has been written for any item below, and Phase 2 remains **In Review** at implementation
> head `cfc49664f3cb8dca95ddfa86bcae82e0fdc8a94c` with records at `8606547af1edca1e88e5088c73a104c976a48613`.
> **Gate A stays Not Run. Dedupe-triggered closure stays disabled (`dedupeClosureEnabled: false`). D4 stays
> undesignated. AC-15 stays PASS under the approved H1 reading, H2 stays deferred.**
>
> Every quoted clause below was read from the file named, at the current head. Every measured number was read
> from a retained bundle: the batch-T bundle
> `/workspace/udg-evidence/ci-run-43458461044/UDG-003-2026-11-13T16-09-49-380Z-cfc49664` or the OD-10 bundle
> `/workspace/udg-evidence/ci-run-43481796058/UDG-003-2026-11-13T18-30-09-607Z-a9116e03`. Where a claim is
> inference from those numbers rather than a number itself, it says so.

---

## 1. OD-1 — GA-10: keep the zero-effect measurement, move both `Δ == 1` checks

### 1.1 What Phase 2 keeps (measured, already retained)

The half of GA-10 this substrate can decide is measured and stays in Phase 2 as evidence: every seat in every
retained room reports `effectCount: 0` with `gap: null` and `resolvedThrough` at the sent watermark; the ledger
counts a key once per `(epoch, identity)`; cache and batch re-answers are charged nothing; the `Δ == 0`
halves hold (an abandoned identity advances nothing). PR-14 reports `refused:navigation 1`, and
`measurements/UDG-003.json` reports `NAVIGATION_BUSY` with `pathCandidates 0`.

That last fact is why the row cannot be closed here: **there is no committable discrete identity on this
substrate**, so "`Δ == 1` per committed identity" has nothing to count and "`Δ == 1` for a deliberate reissue
under a new identity" has no identity to reissue. Recording zero as a pass is exactly the failure the row
names ("an epoch change accepted as the proof").

### 1.2 The dependency chain, checked

| task | gate | Requires Verified | consequence |
| --- | --- | --- | --- |
| `UDG-SPIKE-001` (ADR-0003 §5 execution) | **A** | **UDG-003, UDG-004** | Gate A's prerequisites do **not** include UDG-007 |
| `UDG-007` asset pipeline and navigation | C | **UDG-SPIKE-002**, plus "adopted P08 and fixed collision/config hashes" | the navmesh, routes and `apps/server/src/regions/load-region.ts` land **after** Gate A |
| `UDG-008` input surfaces | C | UDG-004, UDG-005 — and it states *"Navigation can be a test double until 007 is Verified"* | downstream tasks are explicitly allowed to run without real navigation, so nothing forces 007 earlier |

ADR-0003 §5's own preamble insists Gate A runs *"with no dependency on locomotion, physics or navigation"*,
and assignment §0 rule 1 keeps Gate A's formal execution with UDG-SPIKE-001 under **D-P2-5**. The two facts
are in direct conflict inside GA-10 as written: the criterion set must not depend on navigation, yet GA-10's
`Δ == 1` halves cannot be measured without it. **The row as written makes Gate A un-runnable at its own
prerequisites.** That is the defect the amendment fixes; it is not a measurement gap Phase 2 can close.

### 1.3 Where both checks become required (three places, named)

1. **UDG-007 acceptance** — the primary owner. UDG-007 owns `packages/navigation/**`,
   `apps/server/src/regions/load-region.ts` and the validated routes; a committed route effect first exists
   there, so GA-10a and GA-10b become rows of its `Tests and acceptance` section (§1.4 (c)).
2. **Any citation of UDG-003's Gate A result as covering exactly-once semantics** — the amended pass paragraph
   in §1.4 (b) makes that citation conditional on GA-10a/GA-10b having been measured.
3. **Any later Gate A re-run** — once UDG-007 is Verified, a re-run evaluates GA-10 **and** GA-10a **and**
   GA-10b together; the deferral never becomes a permanent exemption.

### 1.4 Proposed clause changes

**(a) `docs/adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md` §5 — split the GA-10 row.**
Current single row (line 294):

> `| **GA-10** | exactly-once across an epoch change | effect ledger Δ == 1 per committed identity, Δ == 0 for an abandoned identity, Δ == 1 for a deliberate reissue under a new identity | an epoch change accepted as the proof; a duplicate or lost effect |`

Replacement, three rows:

```markdown
| **GA-10** | exactly-once across an epoch change — **the half the pre-UDG-007 substrate can commit** | for
every identity this substrate can commit: `Δ == 0` for an identity abandoned by an epoch change; nothing
reissued across the change; ledger keys charged once per `(epoch, identity)`, cache and batch re-answers
charged nothing; `effectCount` monotone per epoch; the ledger's own equality assertion replays equal. Where
no discrete effect can commit, the row is measured **as zero-effect and reported as such** | a duplicate or
lost effect; a re-answer charged as a new effect; an epoch change accepted as the proof; **reporting a
zero-effect measurement as satisfying GA-10a or GA-10b** |
| **GA-10a** | **one committed identity, exactly once** — *deferred to UDG-007 acceptance* | `Δ == 1` for a
single discrete identity committed once, on a real route effect, on the accepted Gate A harness | measuring
it where no effect can commit; `pathCandidates == 0` presented as `Δ == 1` |
| **GA-10b** | **deliberate reissue under a new identity** — *deferred to UDG-007 acceptance* | the same
request reissued deliberately under a new identity after an epoch change: `Δ == 1` for the reissue and
`Δ == 0` for the abandoned identity | a "reissue" of an identity that never existed; a reissue counted twice
or zero times; an epoch change accepted as the proof |
```

**(b) ADR-0003 §5 — the pass paragraph** (current text: *"Gate A **passes** when GA-1…GA-13 all pass together
with AC-1…AC-20 and the numeric gates, on the accepted harness dependencies. It **fails** if any single row
fails or lacks a verifiable artefact — including GA-11, where failing to measure is itself the failure. No row
can be satisfied by a loopback probe: …"*). Insert between the second and third sentences:

> **GA-10a and GA-10b are not Gate A prerequisites.** They require a committed discrete effect, which requires
> the validated routes and navigation intake that [UDG-007](../contracts/UDG-007.md) owns, while this gate's
> prerequisites are UDG-003 and UDG-004 (UDG-SPIKE-001 metadata) and §5's preamble forbids a navigation
> dependency. Gate A therefore **passes** with GA-10a and GA-10b recorded as **outstanding**, each with the
> reason and the owning task named in the run record, and they become required at UDG-007 acceptance. Marking
> either half PASS on a substrate where `pathCandidates == 0` is a failure of GA-10. Once UDG-007 is Verified,
> no UDG-003 Gate A result may be cited as covering exactly-once semantics until both halves have been
> measured, and any later Gate A re-run evaluates GA-10, GA-10a and GA-10b together.

**(c) `docs/contracts/UDG-007.md`, `Tests and acceptance`** — append:

> **Exactly-once across an epoch change (GA-10a, GA-10b; deferred here from ADR-0003 §5).** With the real
> navigation intake and a validated route committed, measure the discrete-effect ledger on the accepted Gate A
> harness plus real routes: `Δ == 1` for one route effect committed once; `Δ == 0` for an identity abandoned by
> an epoch change; `Δ == 1` for the same request deliberately reissued under a new identity. The bundle is
> replayable and names, per row, the epoch of each ledger key and the seat the effect belongs to. A run where
> `pathCandidates == 0` cannot satisfy either row and must say so in the run record. **Discrete queue limits
> (AC-3b, discrete half):** the same run reports `continuousHighWater` and `discreteHighWater` for the 8-per-
> entity and 64-per-room discrete bounds, which Phase 2 could not exercise because no discrete traffic exists
> (retained maximum `discreteHighWater 0` across every Phase 2 room).

**(d) `docs/contracts/assignments/UDG-003-phase-2.md` §9** — append to the acceptance paragraph:

> GA-10's scope at Phase 2 is the **zero-effect half** (ADR-0003 §5 as amended): Phase 2 reports the ledger's
> `Δ == 0` halves, the once-per-`(epoch, identity)` charging, and the substrate fact that no discrete effect
> can commit here. **GA-10a and GA-10b stay outstanding with UDG-007**; the Phase 2 FAIL is recorded with that
> reason and is never closed by an epoch change.

**(e) Deliberately *not* amended.** `docs/contracts/protocol-v1.md` (line 341: *"`effectCount` /
`lastAppliedRequestId` are the discrete-effect ledger GA-10 measures…"*) stays as written — the fields exist
and their semantics do not move, so a protocol edit would be churn against §4.4. The superseded proposal
`docs/adr/proposals/UDG-003-d7-input-acknowledgement-policy.md` (line 769) is a historical record and is not
edited. The `PR-14` row of `docs/integration/colyseus-0.18-api-map.md` may optionally gain a pointer to the
deferral; it is not required and is not proposed.

**Files affected:** `docs/adr/0003-…-policy.md` (ledgered by `docs/contracts/checksums.json`, so its digest
moves and `pnpm contracts:checksums` must be re-run with the owner's approval),
`docs/contracts/UDG-007.md` (ledgered, same), `docs/contracts/assignments/UDG-003-phase-2.md` (assignment
record at the handoff version — an owner edit, and it must be disclosed because §2 pins the assignment version
at `17ade43b`), plus my records (`UDG-003-phase-2-evidence-matrix.md`, `-completion.md`, `docs/contracts/UDG-003.md`).

---

## 2. OD-2 — W-10 populations in Phase 2, production settings and inequalities in UDG-SPIKE-001

### 2.1 The boundary, in the assignment's own words

W-10 (assignment line 202): *"Adversarial populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender
runs and the **compliant control population** GA-12 requires"* — an artefact obligation
(`abuse-results.json`, `buffer-depth.csv`, `room-lifecycle.json`, per-criterion vectors) for GA-2, GA-9, GA-12.

GA-11 (ADR-0003 §5): *"the jitter/overrun and round-trip populations are **recorded**;
`B + J·λ + stall ≤ bufferMaxSize` is **evaluated on measured values**;
`clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT` is **evaluated**; production values
re-[derived]…"*. Assignment §5 rule 7: *"Production tuning remains Gate A's job (GA-11): the values declared in
`packages/config` are provisional test settings until measured, and the records say so in the same sentence as
the value."* §0 rule 1 and **D-P2-5** keep the formal execution with UDG-SPIKE-001.

So **Phase 2 owes the populations; UDG-SPIKE-001 owes evaluating the two inequalities on measured values and
naming production values.** Today's state is honest and partial: offenders ✓, controls ✓, reconnect ✓,
mid-tick arrival ✓, **RTT ✗ jitter ✗ loss ✗** — loopback only, no impairment path at all. GA-11 stays FAIL
until the populations exist, and stays at most PARTIAL after them because the inequalities need production
values.

### 2.2 The impairment layer (test-only, no dependency change)

**Seam, measured on the pinned stack rather than assumed.** `@colyseus/sdk@0.18.9`'s `Room` creates
`this.connection = new Connection(options.protocol)` (`build/Room.mjs:126`), assigns
`this.connection.events.onmessage = this.onMessageCallback.bind(this)` (line 127), and `Connection` holds
`this.transport = new WebSocketTransport(this.events)` (`build/Connection.mjs:36`) whose `send`/`sendUnreliable`
are the outbound path and whose inbound path is `this.events.onmessage?.(event)`
(`build/transport/WebSocketTransport.mjs:79`). Wrapping `room.connection.transport.send` and
`room.connection.events.onmessage` **after join** therefore intercepts both directions of a real WebSocket
round trip inside the test process, with no proxy, no production source change and no dependency change.

**No new dependency is possible anyway on this substrate, and that was checked:** `ws@8.22.2` appears in
`pnpm-lock.yaml` only as a transitive entry (line 1482, `ws@8.22.2: {}` at 2615) and
`require.resolve('ws', { paths: [apps/server] })` **fails** under pnpm's strict layout. A relay/proxy server
would mean declaring `ws`, i.e. a dependency-set change §4.4 does not grant. The wrapper needs nothing.

**Proposed files** (both inside owned paths, assignment §4.1 `tests/support/client-harness/**`):
`tests/support/client-harness/impairment.ts` (the layer) and
`tests/runtime/udg-003-phase-2/impairment-population.ts` (the runner). Knobs per seat: forward delay
(client→server), backward delay, jitter drawn from a **seeded deterministic** distribution, drop probability +
seed, and a **withhold** control (delay one identified message until signalled, or forever). Counters:
`sentTotal`, `deliveredTotal`, `droppedTotal`, `withheldTotal`, per-direction delay histograms,
`reconnectEvents`, `outOfOrderHoleObserved`.

**What each population measures, and what would make it fail.**

| population | measure | falsified by |
| --- | --- | --- |
| **RTT** | delivered round trip per seat: `t(send)` → the patch carrying that frame's watermark; p50/p95/p99/max, **with the loopback baseline reported separately** so the imposed component is visible | an RTT claim with the baseline not measured; a p99 computed over fewer frames than declared; the loopback component folded in silently |
| **jitter** | deviation from the declared delay per arrival; the resulting overrun count (GA-11's "jitter/overrun") and tick-boundary straddle counts, from `TickMetrics.samples()` | a jitter figure with no overrun count; deviations asserted rather than measured from arrival timestamps |
| **loss** | *n* deliveries withheld per seat, each with seat, stamp and arrival ordinal, plus the consequence pair: does the intake name a gap, does the client deadline fire, does the ack advance | a loss run where nothing detects the hole and the artefact still reads PASS |
| **arrival phase** | per-arrival offset inside the tick (already emitted; extended with the impairment columns) | phase asserted from the schedule rather than from arrival ordinals |

Every population ships a **zero-impairment control** (`droppedTotal == 0`, RTT inside the measured loopback
band) so the impairment is what moves the numbers.

### 2.3 Withheld application delivery vs TCP packet loss — the discriminator, asserted

This is the distinction the artefact must *prove*, not assert. Four recorded facts:

1. **Ordering is the discriminator.** After a harness drop, later frames on the same connection are still
   delivered with strictly greater sequence (`outOfOrderHoleObserved: true`). Over TCP that pattern is
   impossible for genuine segment loss: a lost segment head-of-line-blocks the byte stream until retransmit,
   so no later application message can be delivered before the missing one. An out-of-order hole is therefore
   *evidence of application-layer withholding, never of segment loss*, and the artefact says so.
2. **No retransmission, no reconnect.** A withheld message never arrives and no close/reconnect event fires
   (`reconnectEvents: 0`, `messageArrivedLater: false`). Under real segment loss on a TCP stream the bytes are
   retransmitted and the message arrives late, or the connection errors. Both signatures are recorded.
3. **Socket health is recorded but is *not* the discriminator** — `transport.isOpen` stays true under either
   condition on a loopback socket, so the artefact records it without citing it as proof.
4. **Cross-check inside the drop window**: an unrelated message on the same connection (a later patch, or a
   keepalive) still arrives while the withheld one has not. Expected under application withholding;
   impossible under TCP head-of-line blocking.

The artefact field is `dropModel: "application-layer delivery loss (hole with later deliveries)"`,
`tcpLossModelled: false`, `reason: "network-layer impairment requires NET_ADMIN (tc/netem), which the pinned
GitHub-hosted ubuntu-latest runner does not grant"`. **Real network loss cannot be produced on this substrate**:
no MTU or segment effects, no reordering, no congestion behaviour, no correlated bursts, and RTT is *imposed*
rather than observed from a real path (with the loopback baseline measured alongside). Naming this is the whole
point of the amendment below — without it, "loss populations" reads as a network measurement it is not.

### 2.4 Exact clauses that need amending

**(a) Assignment W-10 (line 202)** — the word "loss" is the overclaim. Current:

> `| **W-10** | Adversarial populations: RTT, jitter, loss, mid-tick arrival, reconnect, offender runs and the **compliant control population** GA-12 requires | … |`

Proposed:

> `| **W-10** | Adversarial populations: RTT, jitter, **application-layer delivery loss** (a delivery withheld in flight on the pinned harness, with `tcpLossModelled: false` and the runner reason recorded), **imposed** RTT and jitter over a real WebSocket round trip with the loopback baseline reported separately, mid-tick arrival, reconnect, offender runs and the **compliant control population** GA-12 requires. Phase 2 records the populations; it does not evaluate the two GA-11 inequalities and does not set production values (§0 D-P2-5, §5 rule 7) | … |`

**(b) ADR-0003 §5 preamble** (line ~278: *"…over a real round trip with RTT, jitter and loss populations."*) —
proposed replacement of that phrase:

> …over a real round trip — the pinned transport on the run's loopback, with the baseline latency measured, not
> assumed — with RTT, jitter and loss populations, **where the impairment source of every population is named
> in the artefact (`network` or `harness`), a harness-modelled loss population is admissible provided the
> bundle records `tcpLossModelled: false` with the runner reason and the head-of-line-blocking discriminator,
> and Gate A additionally records whether the runner could produce network-layer impairment
> (`tc`/`netem` requires `NET_ADMIN`). Where it cannot, the loss population is recorded as harness-modelled and
> that limitation travels with the GA-11 numbers.**

**(c) ADR-0003 §5 GA-11 row** — append to the PASS cell:
*"…; the impairment source of each population is named, and the two inequalities are evaluated only on values
whose source is declared production or measured toward production"*. Append to the FAIL cell: *"an unlabelled
impairment source; a harness-modelled loss population presented as a network loss measurement; evaluating an
inequality on provisional test values and calling the result production justification."*

**(d) `docs/contracts/UDG-SPIKE-001.md`, `Gate A acceptance and evidence`** — append:

> **GA-11 execution.** Evaluate `B + J·λ + stall ≤ bufferMaxSize` and
> `clientSnapshotDeadlineMs ≥ 4 × patch interval + 2 × measured p99 RTT` on the recorded populations, name the
> production values beside the provisional ones, and record whether the runner provided network-layer
> impairment; if it did not, re-measure the loss population with the harness layer and carry the label.

**Files affected:** `docs/contracts/assignments/UDG-003-phase-2.md` (W-10 row),
`docs/adr/0003-…-policy.md` (§5 preamble + GA-11 row, ledgered), `docs/contracts/UDG-SPIKE-001.md` (ledgered);
test-only code under `tests/support/client-harness/**` and `tests/runtime/udg-003-phase-2/**`, plus the capture
plan (`tools/checks/src/evidence.ts`) and CI steps under §8.2.1.

---

## 3. OD-3 and GA-13 — AC-3e's per-reason table, the two mappings, and the approved retired-offender rule

### 3.1 AC-3e from the metrics already emitted (no new production surface)

Measured inventory of what Phase 2 already retains, which is what the table can be built from:

| source | what it carries | measured in the OD-10 bundle |
| --- | --- | --- |
| journal `observation` rows | the disposition and, for refusals, the reason code | `consumed` 400, `refused:epoch` 8 (`EPOCH_MISMATCH`), `dropped:lifecycle` 1 — **and nothing else** |
| journal `meta` rows (per tick) | `continuousHighWater`, `discreteHighWater`, `cacheDepth`, counters | maxima **1 / 0 / 0** over 2 220 meta rows across every retained room |
| `TickMetrics.samples()` (room accessor, T-4) | per-seat transport-side queue depth per tick, signals, closed seats | depth peaks to **8** in the burst construction |
| `roomDiagnostics()` transport boundary | refusals that die **before** the intake (rate ceiling, schema-invalid, pre-buffer epoch) | the rate-ceiling run closes with 4101 and leaves **no** journal row |
| retirement counters + close observations | `retiredUnrepresented`, `dequeuedTotal`, `consumedCount`, `serverQueuedAtClose`, closure code and elapsed | see §3.3 |

Two facts the table must state plainly, both currently hidden:

* **The two depths are different queues.** The authority's own `continuousHighWater` never exceeded **1** in any
  retained room, while the transport-side per-seat depth reached **8**. `apps/server/src/authority/step.ts:760`
  samples the authority queue (`entity.continuousQueue.highWater`); GA-1's `depth < 32` is about the transport's
  continuous buffer. A per-reason table that does not label which queue a depth came from is misleading, and
  the current `measurements/UDG-003.json` headline does not label it.
* **Some reasons have no row by construction.** `overflow` retires frames **before** they are represented, so
  it appears only as a counter (30 in §3.3) and never as a disposition; `superseded` needs discrete traffic and
  has **zero occurrences** anywhere in Phase 2's journals; `structural` and `rateLimited` exist only at the
  transport boundary. That is the reporting shape AC-3e asks for, and it can be produced today.

Proposed artefact `input-reasons.json`, one row per `(reason, stage, queue)` with `count`, `seats`, `evidence`
and an explicit `source: journal | metrics | diagnostics | counters`, plus a `zeroReasons` list naming the
reasons that cannot occur on this substrate and why. Control: seed a run with a known injected refusal set and
require the table to reproduce it exactly, and require `superseded: 0` to be reported as *absent because no
discrete traffic exists*, never as *none happened, all clear*.

### 3.2 Mapping the two remaining AC-3 gaps

* **Discrete queue limits (AC-3b discrete half, 8/entity, 64/room) → UDG-007.** Evidence for the mapping is
  the retained `discreteHighWater` maximum of **0** in every Phase 2 room: the queues are never non-empty
  because no `moveTo`/route candidate can be constructed (`NAVIGATION_BUSY`, `pathCandidates 0`). Proposed text
  is already folded into §1.4 (c) (UDG-007 acceptance) so the limits and GA-10a/b are closed by the same run.
* **Production-envelope eviction consequences (GA-1's "a legal burst that evicts (fails the envelope, not the
  client)") → Gate A.** §5 rule 7 forbids Phase 2 from treating the declared values as production, so the
  eviction consequence at the production envelope cannot be asserted here without moving the envelope. Proposed
  GA-1 note (ADR-0003 §5, GA-1 row, PASS cell appended): *"Phase 2 measures the mechanism at the declared test
  envelope and names it; the eviction-consequence half at production values is evaluated at Gate A, and a Phase
  2 run at test values may not be cited as GA-1's production justification."*

### 3.3 GA-13 — the approved coverage rule for the retired offender, and what the bytes establish

> **Approved rule (owner, 2026-11-13).** *For the retired offender: replay all retained authority rows; account
> separately for evictions that produced no authority rows using captured transport evidence. Show what the
> retained evidence establishes about the loss, seat attribution, and closure timing, and report anything that
> remains unverified. Keep the replay and transport verdicts explicit.*

Implementation shape (batch P-3 below): the scenario's artefact carries **two verdicts** and never merges them.

**`replayVerdict` — authority rows (PASS-able today).** Every retained row for the seat's window replays to the
same dispositions, canonical state and chain tip, and the artefact asserts
`authorityRowsForEvictedFrames: 0` **as an expected zero** — an evicted frame is retired before it is
represented, so there is no row and no tick consumed it. The zero is a property of the mechanism, not a gap in
the replay, and the artefact says so rather than counting the window as unattributed.

**`transportVerdict` — the loss itself, from the retained bytes** (`abuse-results.json`,
`retired-offender-closes-in-bounded-window`):

| aspect | retained fields | what it establishes |
| --- | --- | --- |
| the loss | `retiredUnrepresented: 30`, `serverQueuedAtClose: 0`, `dequeuedTotal: 0`, `consumedCountAtClose: 30`, `stampsSent: 73`, `collidedStamps: 7`, `missingStamps` = the 66 distinct sent stamps, `allSentStampsConsumed: false`, `pairingConsistent: true`, `movedMeters: 0` | thirty frames were retired without ever being represented; none was still queued at the sampling instant; nothing on the seat moved; the client's own stamp pairing stayed consistent, so the loss is server-side, not a client that lost track |
| seat attribution | `observation.entityId: Gu_6pQfUl`, `sampledAtMs: 18803`, the window's declared alias set, closure `entityId: Gu_6pQfUl` | the loss is attributed to **one named seat**, not to the room — the attribution GA-3 demands |
| closure timing | `closeElapsedMs: 364`, `closureWindowMs: 250`, `closureMaxMs: 1000`, `closure.code: 4100`, `expectedCode: 4100` | closure fired inside the bounded window, with the reserved code, once, after the window opened |
| residue | `close-path-accounting.json`: `serverQueuedAtClose: 6`, `consumedCountAtClose: 5`, `consumedCountImmediatelyAfterClose: 0`, `consumedCountAfterClosureWindow: 0`, `accessorReleasedWithSeat: true` | queued residue drained to zero with the seat and the accessor was released — no zombie holder |

**Reported as unverified, not smoothed over:**

1. **Per-stamp identity of the thirty evicted frames.** The buffer reports a **count**, not a list, and
   ADR-0003 §3.1's pre-buffer boundary gives no reason at eviction time; `missingStamps` lists the stamps the
   *client* sent that never appear in a journal, which is a superset (66) of the 30 retirements. The mapping
   from count to stamps is therefore not recoverable from retained bytes and must not be inferred.
2. **Whether `consumedCountAtClose: 30` means the acknowledgement advanced over retired frames.** The counter
   is the stack's own (`PR-8` found no public surface that withholds or retracts an acknowledgement), so the
   artefact reports the equality `consumedCount == retiredUnrepresented` as a measured coincidence and refuses
   to label it "acknowledged but never consumed" — that wording is a §3.1 claim about *semantics* the bytes do
   not settle. Recording the caveat is the honest line.
3. **Causation versus co-incidence.** The retirement and the closure are in the same window on the same seat;
   nothing in the retained bytes proves the retirement *caused* this closure rather than a concurrent signal.
   The scenario's construction (pressure line, `retiredUnrepresented > 0`, code 4100) makes retirement the only
   candidate signal, and that is stated as reasoning, not as measurement.
4. **Why seven stamps collided.** Recorded as measured (unpaced burst, client-side stamping); not proven to be
   pacing alone.

`GA-13` may then move **PARTIAL → PASS** under the approved rule — every authority-bearing scenario replayed and
attributed, every eviction that produced no authority row accounted for by named transport evidence, four
no-authority scenarios proven negatively — **if** the owner accepts the two-verdict presentation as
"sufficient evidence". If the owner wants per-stamp eviction identity, GA-13 stays PARTIAL and the requirement
belongs with the buffer's own reporting, which is UDG-SPIKE-001/envelope territory, not a Phase 2 test.

---

## 4. OD-4 — `M` and `P`, quoted before any verdict

### 4.1 Canonical definitions and order

From `docs/contracts/assignments/UDG-003-phase-1.md` §0.1 (the corrected Phase 1 text, still the canonical
definition of the letters):

> "Stage letters are **F, L, Q, S, A, C, R, X, M, P** (the draft omitted **R** and **M** and invented **J**),
> and stage **M** (map canonical state to the replica) and **P** (publish results, metrics, flush) need a room
> and a replica, so they are **Phase 2 work**: Phase 1 implements and asserts **F → L → Q → S → A → C → R → X**
> and records the data M and P will need in the journal instead."

So the order is *… X, then M, then P*; M is *canonical → replica mapping*; P is *publish results, metrics,
flush*; and both are **assigned to Phase 2**, which is why AC-6 asks for them and why Phase 1's
`stageOrder: [F, L, Q, S, A, C, R, X]` was not a defect.

Where they are implemented, and what the code says:

* **M** — `apps/server/src/state/map-player.ts`: *"Publishing entity state and the disposition record into the
  replicated schema (UDG-003 Phase 2, W-2/W-4; protocol-v1 §6 and §6.5)… The **canonical projection stays the
  only route to movement fields**. This module never computes a position, a mode or a watermark — it runs the
  protocol's `toReplica` / `toRegionReplica` and copies the produced values into the live schema instances… The
  disposition record is **not** part of `PlayerSimulationState`… It is applied by `applyDisposition` beside it,
  from the transport's own record, **in the tick that consumed**"*.
* **P** — `apps/server/src/rooms/RegionRoom.ts`: *"Publish in the consuming tick (§4 clause, W-4): the record the
  client reads is the record of the tick that consumed, not of the next patch"*, over
  `outcome.entities` from `#authority.stepTick()`, with the separate cadence knob
  *"Patch cadence and step cadence are separate declared knobs (PR-15 S7 measured the skew)"* →
  `this.patchRate = this.#configValue.network.statePatchIntervalMs` (default **100 ms**,
  `packages/config/src/network.ts:56`).

**The honest split inside P.** P has three named duties — *results*, *metrics*, *flush*. Metrics and flush exist
and are observable (telemetry artefacts; schema patches arriving at the seat at ~100 ms). **Results do not**:
the publish loop iterates `outcome.results.filter((item) => item.accepted)` and every retained seat reports
`effectCount: 0`, `pathCandidates 0`. So `P`'s results half has nothing to publish on this substrate and —
exactly as with GA-10 — belongs to **UDG-007**, while GA-7 ("final publication withheld") belongs to
**UDG-SPIKE-001**.

### 4.2 The existing harness *can* observe these exact semantics

A seat already receives patches (T-4's observer trace is built from them), and the harness can read both sides
of the boundary: the room's own authority view (`#authority.core.view(entity)`, via the existing telemetry
accessor) and the client's replica row. Proposed assertions, with the control that fails when the property is
absent:

| # | assertion | failing control |
| --- | --- | --- |
| 1 | **M is canonical, not the wire**: after each consuming tick, the seat's replica row (position, mode, `inputResolvedThrough`, disposition fields) equals `toReplica(view)` + `applyDisposition`, compared field-by-field | a **refused** frame (rate ceiling / epoch): the refused stamp's position must **not** appear in the replica. Fails the moment M maps the wire instead of canonical state |
| 2 | **M writes by value**: mutating the projection object returned by the mapping leaves the live replica unchanged | a reference leak: mutation would show through |
| 3 | **M ≠ P, and in that order**: withhold one inbound patch (the §2.2 layer, or a one-seat minimal withhold) — authority advances (journal `tick` rows, `inputResolvedThrough`) while the seat's replica stays at the previously published value; on release the replica takes the withheld value | the assertion collapses if M and P are the same event: with a patch withheld, either nothing advances (M not separate) or the replica moves anyway (P not a boundary). This is the control that makes AC-6's *sequence* meaningful rather than one stage counted twice |
| 4 | **P's cadence is the declared knob**: patch arrivals are ~`statePatchIntervalMs` apart and demonstrably *not* tick-cadence apart, with the measured skew reported beside PR-15 S7 | an assertion written against 50 ms ideals rather than measured slack |
| 5 | **Per-entity, not per-room**: a case with no resident seat (refused join, pre-join, post-closure) shows **no** M and **no** P for that entity | asserting M/P room-generally, which would pass for a seat that never existed |
| 6 | **P's results half is empty, and named**: `resultsAccepted: 0` with the reason string, and the artefact refuses to call it a publish-results pass | a PASS that silently counts metrics-only publication as all of P |

### 4.3 Proposed verdict and clause text

**AC-6 stays PARTIAL** until (a) the batch below runs, **and** (b) the owner rules on the one definitional
question: whether the room's `map-player` + patch/metrics flush *is* AC-6's M/P. If yes, AC-6 → **PASS** with
`P`'s results half named as UDG-007's. If no, AC-6 is amended to move M/P wholesale — the honest owner in that
case is **UDG-008** for the client-side consumption of P (it is the first real client) with **UDG-007** for
results — and AC-6 stays PARTIAL with that owner named.

Proposed AC-6 text for the second route (readiness proposal AC table, line 579):

> `| AC-6 | the stage sequence F, L, Q, S, A, C, R, X, M, P holds for every executed 5.5 case and every recorded eligibility-changing arrival permutation, **where M is the room's mapping of canonical state to the replica (`state/map-player.ts`) and P is the publish/flush boundary (schema patch at `network.statePatchIntervalMs`, telemetry flush, and — once a discrete effect can commit — result publication). `P`'s result half belongs to UDG-007 and its withheld-publication case to Gate A GA-7: a run with `resultsAccepted == 0` satisfies the halves that exist and records the rest as outstanding with the owner named.** |`

---

## 5. OD-5 — recorded, unchanged

**AC-15 stays PASS** under the reading the owner approved and carried forward: *"still verifies"* means a bundle
verifies with the verifier of its **own capture commit** (H1), and the H1 sweep over 151 bundles / 66 capture
commits is the measured basis (144 PASS; 7 FAIL, all retained-because-red). AC-15's contract row is
**unamended**. **H2 stays deferred**: no capture-plan identity is recorded inside a bundle, no `tools/checks`
capability is added for it, and nothing below proposes one — the only `tools/checks` edit anywhere in this plan
is the artefact list and capture order, which §8.2.1 already scopes ("*What moves in the capture plan when
Phase 2 artefacts land*").

Preservation, restated as a constraint on the batch: retained bundle bytes and the store inventory are
untouchable — no recorded byte or digest is rewritten (Phase 0 §5 rule 6, still in force). The failed run's
bundle stays retained as the failure it was, `logs/phase-2-reference-trace.stdout.log` at **0 bytes**
(re-verifying it still returns exactly `EVIDENCE-FILE-EMPTY logs/phase-2-reference-trace.stdout.log`, 1 issue),
the empty-stdout rule stays in force, and the fix at `cfc49664` obeys it rather than loosening it. The two
clerical notes stay open for the owner and change no verdict: AC-15 still says "both bundles" from a two-task
era, and the H1 reading binds nothing outside the matrix/completion records until the owner writes it into the
readiness proposal.

---

## 6. The smallest batch that closes Phase 2's decidable part

Nothing here needs production source, `authority/**`, the dependency set, the protocol, or a hash. All of it is
`tests/**` plus the capture plan.

| id | closes / moves | code | artefacts |
| --- | --- | --- | --- |
| **P-1** AC-3e per-reason table (§3.1) | **AC-3e PARTIAL → PASS**; GA-1 wording corrected in the matrix (two queues labelled) | fold into `tests/runtime/udg-003-phase-2/abuse-population.ts` (same rooms, same run — no new CI step) | **+1** `input-reasons.json` |
| **P-2** impairment layer + four populations (§2.2–2.3) | **W-10 complete for the populations**; **GA-11 FAIL → PARTIAL** (inequalities still need production values) | `tests/support/client-harness/impairment.ts`, `tests/runtime/udg-003-phase-2/impairment-population.ts` | **+1** `transport-impairment.json`; new CI step (summary to **stdout**) |
| **P-3** retired-offender two-verdict block (§3.3) | **GA-13 PARTIAL → PASS** if the owner accepts the presentation | `abuse-population.ts`, `journal-replay.ts` | 0 (fields inside existing artefacts) |
| **P-4** AC-6 M/P + six controls (§4.2) | **AC-6 PARTIAL → PASS** with the results half named, pending the owner's definitional ruling | `tests/runtime/udg-003-phase-2/stage-sequence.ts` | **+1** `stage-sequence.json`; new CI step (summary to **stdout**) |
| **P-5** records | — | matrix, completion, `UDG-003.md`, checksums | 0 |

Plan and gate plumbing that travels with it, all under §8.2.1: `tools/checks/src/evidence.ts`
(`PHASE_2_VECTOR_FILES` 24 → **27**, capture order extended by two steps), `.github/workflows/ci.yml`
(two new capture steps, each writing its summary to **stdout** — the `c7e497b` failure is the standing
reminder), `tests/contracts/UDG-003.test.ts:1937` (`expect(gate).toHaveLength(24)` → 27, with the comment
line 1934 extended to name the three additions), and
`tests/system/udg-003-phase-2/runtime.test.ts` assertions for all three new artefacts including each falsifying
control. **Order: P-3 first** (no new surface, needed by the GA-13 ruling), then **P-1**, then **P-2**,
**P-4 last** because control 3 depends on P-2's withhold.

**What the batch does *not* claim.** GA-10a/GA-10b stay outstanding until UDG-007; GA-1's production-envelope
eviction half and GA-11's inequality evaluation stay with Gate A; AC-3b's discrete half stays with UDG-007;
GA-12 and PE-1…PE-5 stay NOT PASSED (reported); Gate A stays Not Run; `dedupeClosureEnabled` stays `false`; D4
stays undesignated; GA-10 stays FAIL at Phase 2 with the amendment's reason attached.

**Optional, offered but not counted here (P-2b).** The same withhold control that makes P-4's control 3 work
also makes GA-6a/6b and **GA-7** ("final publication withheld") measurable on the real harness — one extra
scenario in `impairment-population.ts`, no new artefact. It is outside the four decisions, so it is not in the
smallest batch; if the owner wants Phase 2 to close GA-7 rather than leave it PARTIAL, say so and it joins P-2
with its own verdict row.

**Invariants asserted by the batch's own tests:** `dedupeClosureEnabled: false`; D4 undesignated; Gate A Not
Run; `configHash` still `2743a9a047ce7264833af88e8bd2f8aeea970a45e306a348e1fe0654191bec7a`; `pnpm-lock.yaml`
and every manifest unchanged; `apps/server/src/authority/**` unchanged since `96d3df6`; no
`authority/**`-or-protocol edit; retained bundle bytes and store inventory unchanged (whole-store digest
before/after each download).

---

## 7. Decision summary for the owner

| decision | what is proposed | owner action |
| --- | --- | --- |
| OD-1 | GA-10 split into GA-10 / GA-10a / GA-10b; Gate A explicitly runnable before UDG-007; both halves required at UDG-007 acceptance, and required before any Gate A result is cited as exactly-once | approve (a)–(d); note the two ledgered digests that move |
| OD-2 | populations stay in Phase 2 (P-2); inequalities and production values stay with UDG-SPIKE-001; "loss" relabelled to what the harness can actually do, with the TCP discriminator recorded | approve W-10 + §5 preamble + GA-11 + UDG-SPIKE-001 text |
| OD-3 / GA-13 | AC-3e table from existing metrics (P-1); discrete limits → UDG-007; production-envelope eviction → Gate A; approved retired-offender rule implemented as two explicit verdicts with four reported unverified items (P-3) | approve P-1/P-3; rule on whether the two-verdict presentation completes GA-13 |
| OD-4 | M/P quoted and located in Phase 2's own code; six assertions with failing controls (P-4); results half named as UDG-007, withheld publication as GA-7 | rule whether the room's map + flush *is* AC-6's M/P; AC-6 stays PARTIAL until P-4 runs |
| OD-5 | AC-15 PASS under H1, H2 deferred, bytes preserved | nothing owed; optional clerical edits at the owner's discretion |
