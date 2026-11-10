# ADR proposal — the input-consumption rule: can one frame per entity per tick survive the pinned SDK?

Status: **Proposed. This document assigns no work, amends no contract clause, and adopts nothing.** It replaces the
Part B recommendation of [ADR-P-0002](UDG-003-compiler-exception-and-input-backlog-posture.md), which the owner
**did not approve** as the backlog solution and returned with five corrections (C-1…C-5, recorded in that document's
§0). Phase 1 remains unassigned. **D-7 remains open.** Gates A/B/C remain **Not Run**.

What changed relative to the returned document: `take(n)` is no longer presented as configuration — it is an
amendment to the adopted one-input rule and is priced as such (§3); PR-13's step arrays are described as what they
are (§1.3); the sizing formula is a capacity consideration and not a guarantee (§2.3); the obedient-sender and
post-eviction-disconnect results are no longer offered as protection (§2.2); and no claim rests on catch-up draining,
which the accepted contract forbids.

## 1. The question, stated precisely

### 1.1 What the baseline requires

Three accepted statements govern this ([movement-authority.md §5.1–§5.2](../../interfaces/movement-authority.md),
[v0.2 §7.1](../../specifications/UDG-SPEC-M0-002.md), [P03](../../contracts/assignments/UDG-003-readiness-proposal.md)):

| id | Requirement | Where it is written |
| --- | --- | --- |
| **R1** | each connected entity consumes **at most one** SDK input frame and receives **exactly one** locomotion step per server tick | movement-authority §5.1 |
| **R2** | the server **must not** advance a character multiple times in one tick merely because the client sent multiple input frames | v0.2 §7.1, anti-cheat constraint |
| **R3** | draining a burst and simulating only its last frame is **forbidden**, as is moving a character repeatedly to empty a queue | movement-authority §5.1 |
| **R4** | buffering is bounded (initially 32 frames per client); overflow and stale-backlog handling must use demonstrated supported SDK behaviour, with bounded offender disconnect where safe continuity cannot be proven | movement-authority §5.1, §5.2 |

The property the owner is protecting is not throughput. It is that **an acknowledgement never retires a frame that
was never represented in authoritative state**, because the client prunes on the watermark alone
([api map §4](../../integration/colyseus-0.18-api-map.md)) and would otherwise keep predicting from a frame the server
has thrown away.

### 1.2 What has to be separated

R1 and R2 are statements about **simulation**: at most one frame stepped, one step advanced, per entity per tick.
The unrepresented-retirement property is a statement about **admission and capacity**: whether the frames the server
accepts can all be represented before the bound evicts them. These are different obligations, and conflating them is
what made the returned document read as if `take(n)` "solved" the problem by weakening the first to help the second.

| obligation | whose decision | can the SDK enforce it? |
| --- | --- | --- |
| R1/R2 — one step per entity per tick | UDG's room loop | yes, trivially: the room consumes at most one frame per entity per step callback. Whatever the buffer holds is irrelevant to the step count |
| no frame retired unrepresented | arithmetic of arrival vs consumption against a bound | **no**: the buffer evicts, eviction counts as consumed, and the acknowledgement is a send-order watermark that retires everything below it ([api map §4](../../integration/colyseus-0.18-api-map.md)) |

### 1.3 What PR-13 actually measured, stated without embellishment

PR-13's rooms record frame identities read through a consume primitive inside the fixed-step callback, and the probe
computes two identity sets from the **send table**: `ackedUnrepresented` (retired by the client watermark although no
step read them) and `unackedUnrepresented` (vanished without acknowledgement).

No locomotion step ran. No integrator, collision query, or authority code executed, and no state field was advanced
from an input value: `simulated`/`applied` in those results means **read in a step and logged**. "Represented" in
this document therefore means *read by the room in a step*, a proxy for representation and not evidence of movement.
The probe is sufficient to decide a mechanism question — which levers exist and what they do to identities — and it
is not sufficient to decide a state-correctness question, which is why §4 requires a real-state probe before anything
is adopted.

It is also honest about its own limits: loopback transport, zero round trip, in-process server, and the senders are
the probe's own clients, which obey whatever the scenario tells them to.

## 2. Can the one-input rule be preserved by a demonstrated supported mechanism?

**Answer: yes for the simulation rule, and yes for the retirement property only under a declared arrival rate that
the SDK cannot itself enforce. There is no supported mechanism that preserves both against an unbounded sender.**

### 2.1 What the library does offer, and what each thing is

Measured in PR-13 against the current pins (20 checks; outcomes transcribed in
[api map §9](../../integration/colyseus-0.18-api-map.md)):

| mechanism | what it is | verdict against R1–R4 and the retirement property |
| --- | --- | --- |
| `InputAccessor.next()` / one consume per step | the default shape | satisfies R1/R2 by construction; does nothing about arrival rate |
| `InputAccessor.take(n)`, `drain()` | consume *n* or all per step | **changes R1**; `drain()`-then-apply-latest additionally violates R3 and retires frames that were never read |
| `InputAccessor.clear()` | discard the backlog | retires more frames unrepresented; moves the same watermark an eviction moves |
| `defineInput({ seqField })` | choose which field is the sequence | no help: the acknowledgement stays a send-order watermark |
| `defineInput({ sanitize })` | the only admission hook | typed `(input) => void`: it may rewrite a frame, it may **not** refuse one. Measured: ran 14 times, 5 frames stepped after rewriting, 9 acknowledged with no step |
| `Room.maxMessagesPerSecond` | per-client message ceiling | **enforcement after the fact**: the ceiling is a per-second average and the offending frames were already buffered and acknowledged before the limit fired; the disconnect (code `4002`) arrives afterwards |
| per-tick threshold + `Client.leave(code)` | application-side guard | same objection: it stops the session after growth has already retired frames |
| `Room.send(client, signal)` + an obeying client | application-level throttle signal | prevents while the client obeys; measures nothing about a client that does not, and its round trip is zero on loopback |

There is therefore **no rejection lever**: nothing in the public surface lets a room decline an over-quota frame at
admission time, and nothing makes the acknowledgement report a per-frame disposition. That is the mechanism verdict,
and it is unchanged from the returned document.

### 2.2 Why two earlier "preventions" are withdrawn

- **N6 (an obedient loopback sender that stops on a signal) is not protection.** It assumes exactly the behaviour
  that needs enforcing, over a transport with zero round trip. It shows the mechanism is *expressible*, not that it
  holds.
- **N3/N4 (eviction, then a disconnect) are not protection.** They show the violation occurring and then stopping.
  In N3 the watermark froze at `5 of 10` with 5 frames unacked-and-unrepresented, while 5 others were still retired
  without a step; in N4 the disconnect landed after 30 acknowledgements without a step. A reviewer cannot read either
  as "the rule was preserved".

What the measurements do support is narrower and worth stating exactly: **when the admitted arrival rate for an
entity does not exceed the step rate, one consume per tick drains the buffer, nothing is evicted, and no frame is
retired unrepresented** (observed as `0 acked without a step`, peak backlog `2 of 4`, no disconnect). That is an
arithmetic consequence of R1, not a new mechanism.

### 2.3 Sizing, stated as capacity rather than as a guarantee

For an entity with admitted arrival rate `λ`, step rate `S = 1/0.05 s = 20 Hz` and a consume budget of one frame per
tick, retention requires `λ ≤ S`. If a larger per-tick budget `n` is ever adopted, `n ≥ ceil(λ / S)` is the necessary
capacity condition, with buffer bound `≥ n` plus headroom for jitter, tick overrun and signal round trip, and a
declared ceiling `≤ n · S`.

**This is a capacity condition, not a protection claim.** It bounds mean arrival against mean consumption and says
nothing about:

- a burst inside one sampling interval (a sender may send an entire allowance in the first millisecond);
- jitter or a step that overruns `dt`, which pauses consumption while arrival continues;
- an adversarial sender that deliberately rides the ceiling, or that alternates bursts with idle periods to exploit
  any drain-then-apply behaviour (forbidden by R3, and therefore not available as a remedy);
- a per-second average ceiling, which is measured to admit over-quota frames before it fires.

Prevention for a compliant sender and detection for a non-compliant one are different guarantees and must be written
as such. **Nothing in the current pins provides prevention against a sender that does not comply.**

## 3. If a multi-input rule is ever adopted, these clauses change first

`take(n)`, `drain()`, or any per-tick budget above one **amends the adopted baseline**. It is not a configuration
choice available to a room, and it cannot be introduced inside Phase 1. The clauses that would have to change, with
the exact text each one carries today:

| # | Clause | Current wording that a multi-input rule contradicts |
| --- | --- | --- |
| A-1 | [movement-authority.md §5.1](../../interfaces/movement-authority.md) | each connected entity consumes **at most one** SDK input frame and receives **exactly one** locomotion step per server tick |
| A-2 | [movement-authority.md §5.1](../../interfaces/movement-authority.md) | input buffering is initially bounded at **32 frames per client** (the bound and the consumption rule are arithmetically linked; changing one changes the other) |
| A-3 | [movement-authority.md §5.1](../../interfaces/movement-authority.md) | explicitly **forbids** draining a burst and then simulating only its last frame |
| A-4 | [movement-authority.md §5.2](../../interfaces/movement-authority.md) | the closing requirement that overflow and stale-backlog handling use demonstrated supported SDK behaviour with bounded offender disconnect |
| A-5 | [UDG-SPEC-M0-002.md §7.1](../../specifications/UDG-SPEC-M0-002.md) | the per-tick step "read the next buffered input frame, or neutral input if absent" — singular by construction |
| A-6 | [UDG-SPEC-M0-002.md §7.1](../../specifications/UDG-SPEC-M0-002.md) | anti-cheat: the server **must not** advance a character multiple times in one tick merely because the client sent multiple input frames |
| A-7 | P03 processing order, item 2 (admitted operations in arrival order per entity) and item 5 (one step per connected entity in stable lexical order) | the order statement assumes a single consumed frame per entity per tick; multi-input must define where the extra frames are placed relative to route-completion commits and the collision pass |
| A-8 | [configuration.md](../../interfaces/configuration.md) and `packages/config/src/network.ts` limits | buffer bound and admitted rate become derived values of the rule, not independent knobs; they must stay validated and hash-covered as they are today |

An accepted ADR would have to change A-1…A-8 together, and each affected traceability row and acceptance criterion
with them. Until that happens, **the one-input rule stands and Phase 1 must implement it.**

### 3.1 What a multi-input alternative would have to conserve

Any amendment must state, and a probe must prove, all five of these. None is satisfied automatically by "consuming
more frames".

1. **Total simulation time.** The tick clock is the only source of advancement: `Σ dt_stepped == dt_tick` per tick,
   with `dt_tick = 0.05 s` regardless of how many frames were read. Extra frames may change *which* intention is
   used and what discrete operations are admitted; they may never add time. A frame must never carry its own elapsed
   time into the integrator.
2. **Movement speed.** Displacement per tick is `f(winning intention) × dt_tick`. Consuming three frames must not
   triple displacement, and consuming zero must produce exactly the neutral-input step. The aggregation from N frames
   to one intention must be deterministic and specified (see 3), including for the axes, the discrete-intent field and
   the generation used for reconciliation.
3. **Input ordering.** Strict per-entity arrival order; generation strictly increasing per epoch; frames outside
   `MAX_GENERATION_FORWARD_GAP` refused as today; P03's equal-generation precedence retained; a defined rule for what
   happens to frames left in the buffer when a discrete operation is admitted mid-burst, so an operation cannot be
   applied out of order relative to the movement it accompanies.
4. **Client prediction and reconciliation.** The client predicts one step per local tick at its own `dt`. If the
   server consumes N frames per tick, the two timelines can only agree if reconciliation is driven by **authoritative
   state plus the epoch/generation domain**, never by frame counts, sequence watermarks or elapsed frame totals. The
   amendment must also state what a client does with a frame that was retired without representation: it must never
   re-predict from it, and it must not be able to infer a false "server applied this". Because the acknowledgement is
   a watermark with no per-frame disposition (D-7, unresolved), this cannot be closed by the transport: it needs an
   application-level disposition, an application-level resynchronisation state, or an explicit acceptance of the
   residue.
5. **Anti-cheat and determinism.** A faster sender must be unable to buy simulation time, extra displacement, or
   additional collision resolutions; collision resolution runs exactly once per tick on the authoritative transform;
   the step order stays stable-lexical so a re-run of the same journal produces the same state.

## 4. Evidence required before any multi-input alternative could be adopted

Nothing below is implemented, and PR-13 does not substitute for any of it.

### 4.1 PR-14 — real-state correctness probe (replaces the bookkeeping proxy)

Drive the **actual** shared locomotion step against **actual** replicated state
(`@udg/protocol/schema` `RegionSchema`/`PlayerSchema`) through a room fed by the SDK input buffer, with the collision
pass in the loop, and assert on state rather than on logs:

| assertion | why it is the one that matters |
| --- | --- |
| per entity, `stepCount == tickCount` while the session is connected, for every arrival rate tested | this is R1/R2 as a state fact, not as a room-implementation detail |
| displacement per tick equals `f(winning intention) × 0.05 s` within the frozen width policy, for 1×, 2× and 20× arrival rates | movement speed cannot be bought with packets |
| a tick with no consumed frame advances state by exactly the neutral-input step | the idle path cannot be used to store up motion |
| the entity's transform never advances twice within one tick's collision pass | one authoritative resolution per tick |
| generation strictly increasing per epoch; out-of-domain frames refused with the existing protocol errors | the amendment cannot smuggle stale or forward-dated input |
| every frame that is acknowledged is either represented in a step or listed in an explicit non-representation disposition the client can act on | this is the property the watermark cannot express; it is D-7 in probe form |
| re-running the same input journal reproduces the same state | determinism and auditability survive the change |

### 4.2 Burst and adversarial acceptance tests

| scenario | what must hold |
| --- | --- |
| burst: 50 frames in 10 ms, then idle; repeated with growing burst sizes | buffer bound never exceeded; no frame retired unrepresented for a compliant session; no catch-up draining; the idle period does not become a debt paid by skipping |
| sustained over-rate at 2×, 5×, 20× the step rate | the declared ceiling is enforced with the reserved close code; detection latency is bounded and recorded; the residue inside the offending session is bounded and named |
| step overrun (a step deliberately blocked past `dt`) while arrival continues | consumption pauses, arrival does not; the outcome must be bounded eviction with an explicit disposition, never silent retirement |
| jittered arrival (per-frame delay drawn from a declared distribution, plus a stalled tick) | the sizing derived in §2.3 must hold with its headroom, or the sizing is wrong — this is the test that turns the formula into evidence |
| replay of stale generations and forward-dated generations interleaved with valid frames | refused by the existing epoch/generation rules; no state effect; no watermark movement that retires valid frames |
| throttle signal round trip under non-zero RTT | the signal's effect is measured, not assumed; a slow signal cannot be counted as prevention |
| disconnect and rejoin mid-burst, with identity preserved | epoch/session rules hold; the rejoin does not replay frames retired during the burst |
| two sessions on one connection or one room, one compliant and one offending | the offender's consequence must not starve the compliant session (no head-of-line blocking, no shared budget exhaustion) |

### 4.3 What stays with UDG-SPIKE-001 regardless

PR-13 and PR-14 prove server-side accounting and server-side state behaviour. They cannot prove, and must not be
quoted as proving: convergence after a cut-off, behaviour under packet loss or reconnect, that a client stops
predicting from a retired frame, or any effect of a real non-zero round trip. Those remain UDG-SPIKE-001
obligations, and an application journal is server-side evidence only.

## 5. Recommendation

**Recommend keeping the baseline rule exactly as adopted: one frame per entity per tick, one step per entity per
tick. No baseline amendment, no `take(n)`, no `drain()`, no catch-up draining.** Phase 1 should implement that rule
and nothing else, and the backlog question should be closed as an admission and scope problem rather than a
consumption problem:

1. **Declare an admitted arrival rate per entity equal to the step rate** (`20 Hz`, one continuous frame per entity
   per `0.05 s` tick), and validate it as configuration in `packages/config` so it is hashed and reviewable rather
   than ambient.
2. **Declare the consequence for exceeding it**, using a demonstrated supported primitive: `Room.maxMessagesPerSecond`
   with a reserved close code, or a mandatory server throttle signal. This is *detection and termination*, and the
   wording must say so, because the ceiling is a per-second average and cannot prevent the first over-quota window.
   The choice between the two primitives is the owner's, and it should be made after UDG-SPIKE-001 measures real
   round trip rather than now.
3. **Size the buffer from the declared rate plus measured headroom** (jitter, tick overrun, signal round trip), and
   record the derivation next to the value. The headroom numbers are not available yet: they come from the jitter and
   overrun tests in §4.2, not from PR-13.
4. **State the scope of the guarantee in the contract text**, because it is narrower than it looks: *for a compliant
   sender, no frame is retired unrepresented; for a non-compliant sender, the violation is detected and the session is
   stopped, and frames retired inside the violation window may have been unrepresented.* Any stronger claim is
   unproven on the current pins.
5. **Leave D-7 open.** This recommendation does not resolve it: the acknowledgement remains a send-order watermark
   with no per-frame disposition. Closing it needs an application-level input disposition or an explicit, owner-signed
   acceptance of the residue — a protocol decision, not a probe result.

Rejected, with reasons: `take(n)` as the primary answer (amends R1 and the anti-cheat constraint for a benefit that
`λ ≤ S` already provides); `drain()`-then-apply-latest (violates R3 and retires unrepresented frames); `clear()`
(retires more, silently); `seqField` (does not touch the watermark); an application-level custom input transport
(forbidden by the adopted fixed-step prediction design); and treating `sanitize` as a rejection hook (it is typed
`(input) => void`).

**Validation before any of this becomes configuration:** PR-14 (§4.1), the burst and adversarial set (§4.2), and the
UDG-SPIKE-001 network conditions (§4.3). Until then the numbers in §2.3 are formulas, not values, and Phase 1 stays
unassigned.
