# UDG-003 readiness proposal — revision 3

Status: **P03 ADOPTED. Revision 3 was reviewed at `df59e540fc880b41a599c33c97e34fab4d7d7fa9` and approved by the owner on 2026-11-09** with three binding clarifications, recorded as Q-01 to Q-03 in [adoption.md](../adoption.md#p03-adoption-and-udg-003-phase-0-authorisation-recorded-2026-11-09), which also records decisions **D-1 to D-7** (D-7 left undecided pending PR-8). **Only Phase 0 is assigned** — see [assignments/UDG-003-phase-0.md](UDG-003-phase-0.md). Nothing below was implemented by adoption itself: UDG-003 Phases 1 to 3 stay unassigned, Gates A/B/C stay **Not Run**, P04/P05 and P07–P10 stay Pending, and D4's independent backup destination stays undesignated. The three clarifications bind the adopted algorithm: stage Q/S/C act only on the frozen eligible snapshot (Q-01); the selected observation and each processed request leave their queue exactly once and retained frames keep FIFO order, with the accounting invariant and arrival-during-tick cases tested (Q-02); the batch duplicate registry retains the original ordinal, payload identity and eventual shared disposition (Q-03).

Revision 1 was published at `d7b3127f984370d6faa29308de147876e254728c` (base `d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4`, CI `42641249067`); revision 2 at `2ec3660fcb1fd9fa8d2a478797e5d3c51e8849df` with a digest-precision follow-up, head `005b4c95767e82397ca91edf45e7fa4961ea0017` (CI `42652919880`). The owner accepted the corrected cutoff model, the workspace-local probe layout and the provisional pin/probe approach **in principle**, and this focused revision resolves six defects inside the P03 algorithm itself plus the records that depend on it. Nothing else was expanded and no new questionnaire was added:

| Point | Where it is resolved |
| --- | --- |
| A keepalive is an observation, not an intention kind: it never advances `H`, replaces `latchedKind` or clears `G_d`; initial neutral generation-zero frame and `direct gN → keepalive gN → direct gN` resume; horizontal drive separated from intention metadata | P03-c state, P03-d stage S, **T-5**, AC-16 |
| At most one continuous observation selected per entity **before** arbitration, by documented FIFO; the rest stay queued rather than being discarded as losers; stale backlog invalidated by a competing discrete intention without extra steps or fabricated acknowledgement | P03-c stage Q, P03-d stages Q/C, P03-f queue policy, **T-6**, AC-3a/AC-17 |
| The no-winner branch is defined and never dereferences an absent winner: missing input, all-invalid input, cache-hit-only and screened-refusal-only ticks step once with neutral drive and preserve intention metadata | P03-d stage C, P03-f, **T-7**, AC-18 |
| Request identity completed: persistent cache **and** frozen-batch registry, identical retries share one disposition, same-id/different-payload conflicts without overwriting the cached identity, fresh ids cannot reuse a latched same-kind generation, terminal **refusals** cached | P03-d stage S, **T-4**, **T-8**, AC-19 |
| `UDG_MOVE_TO` is refused `NAVIGATION_BUSY` in screening after validation, identity and generation checks — never a candidate, no `H`, no `path` latch; T-4 no longer calls it an admitted request | P03-d stage S, P03-h, T-4, T-8, AC-8 |
| Replay inputs made sufficient: full initial canonical states, raw and validated request payloads including MoveTo destinations and malformed-input renderings; digests are comparison output, not inputs | P03-g, §3.5, AC-14/AC-20 |

The acknowledgement hard stop is retained: **D-7 is decided from PR-8's probe evidence and is never pre-approved as a waiver** (P03-f, AC-11, §6).

Preparation was read-only: nothing installed, nothing implemented, no service started; the only repository change is this file. Registry statements were read from `registry.npmjs.org` on 2026-11-09 as metadata and are **not** compatibility proof. The only Colyseus package installed in this repository is `@colyseus/schema@5.0.45`, selected and Verified by UDG-002.

[UDG-003](../UDG-003.md) stays the contract; [movement-authority.md 5.1–5.5](../interfaces/movement-authority.md) and [protocol.md 4.2–4.4](../interfaces/protocol.md) stay the shared requirements; adoption stays in [adoption.md](adoption.md).

## 0. What already exists, so the assignment does not rebuild it

UDG-002 delivered and Verified the parts of the ordering story that are pure protocol decisions. UDG-003 consumes them and must not re-implement them:

| Existing export (`@udg/protocol`) | What it already decides | What UDG-003 must still own |
| --- | --- | --- |
| `validateDirectFrame`, `validateMoveTo`, `validateCancelPath`, `validateJoin`, `validateRouteStatus` | shape → epoch range → generation range → generation-zero rule → axes → keepalive rule → normalisation → epoch equality, with the reported `RejectionCode` | calling them at intake, and what a refusal does to state |
| `admitGeneration(raw, {watermark, limit})` | the discrete-intention arithmetic: `≤ watermark` → `SUPERSEDED`, gap `> limit` → `RESYNC_REQUIRED`, otherwise admissible | the watermark, the arbitration that runs **before** the watermark moves, and continuous-frame admission (P03-d) |
| `compareRequestIdentity`, `TERMINAL_REQUEST_CACHE_SIZE` (128), `TERMINAL_REQUEST_TTL_SECONDS` (30) | identical-payload replay versus `REQUEST_ID_CONFLICT` | the cache: storage, TTL, eviction, `(entityId, epoch, requestId)` keying, and running the lookup before generation admission |
| `neutralDirectFrame`, `NEUTRAL_DIRECT_INPUT`, `directInputOf` | the neutral frame shape and "non-direct reads as no intent" | deciding *when* neutral applies (P03-f) |
| `normaliseAxes`, `normaliseSignedZero`, `normaliseYaw`, `isInsideBounds`, `liftStamp`/`projectStamp`/`projectMoveTo`/`projectRejection` | axis normalisation, signed-zero canonicalisation, containment, wire projections | the journal and replica rows that record the results |
| `MAX_GENERATION_FORWARD_GAP` (64), `GENERATION_MIN` (0), `GENERATION_MAX` (4 294 967 294), `EPOCH_MIN` (1), `EPOCH_MAX` (4 294 967 295), `UINT32_MAX`, `ROUTE_ABSENT_REVISION`/`ROUTE_ABSENT_INDEX` (0/0), `REJECTION_CODES` (closed, 14) | the numeric envelope, sentinels and the closed rejection vocabulary | stop-before-overflow behaviour, and no new codes |
| `readIdentifier` (`ASCII_IDENTIFIER = /^[\x21-\x7e]+$/`, `MAX_IDENTIFIER_LENGTH` 64) and `REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/` | two **different** domains: identifiers are printable ASCII up to 64; request ids are the narrower alnum-plus-`_`/`-` set | assigning server-owned entity identifiers inside the validated domain, and never widening either |
| `@udg/protocol/schema`: `DirectInputSchema`, `PlayerSchema`, `RegionSchema`, `schema`/`t`/`Encoder`/`Decoder`/`MapSchema` | the only schema declaration site, flat primitives, `float64` widths (ADR 0001, provisional until Gate A) | whether the pinned **server** accepts this declaration as its fixed-input schema (PR-3) |
| `@udg/config`: `validateServerConfig`, `requireRegionBounds`, `configBounds`, `computeConfigHash`, `movementHash`, `regionHash`, `canonicalHash`, `PROVISIONAL_P07_FIELDS` | validated configuration, "bounds are supplied or startup fails", canonical hashing | reading a supplied bounds document, refusing inconsistent ones, publishing the hashes (§4) |

`validateDirectFrame`'s generation-zero rule (`generation == 0` only legal with `directIntent === false`), its keepalive rule (`directIntent: false` with nonzero axes is `INVALID_PAYLOAD`), its axis normalisation and its check ordering are Verified behaviour that UDG-003 inherits rather than restates. `computeConfigHash` hashes the whole `ServerConfig` including `region`, which is why §4 step 4 exists.

[protocol-v1.md 8](../protocol-v1.md) already assigns "Admission, watermarks, `RESYNC_REQUIRED` issuance, supersede ordering" to UDG-003 (decision U2-6). This proposal stays inside that line and adds **no** protocol export.

## 1. Proposed P03 — tick cutoff, total ordering, generation window, replay journal

P03 elaborates [movement-authority.md 5.1–5.2](../interfaces/movement-authority.md) and [protocol.md 4.2–4.3](../interfaces/protocol.md) so they are testable. It does not change baseline v0.2 §5 and does not pre-adopt P04 or P10. Clauses are cited `P03-a` … `P03-i`.

### P03-a One fixed-step owner, one clock

- The room owns exactly one fixed-step owner at 20 Hz (`dt` 0.05 s) and one patch schedule at 100 ms, both read from validated `ServerConfig.network`. No literal tick or patch rate appears in server source; the suite asserts that what a running room advertises equals the configuration it was started with.
- `serverTick` is a room-local counter, `0` at creation, `uint32` on the replica, and stops before overflow rather than wrapping ([protocol.md 4.4](../interfaces/protocol.md)). `routeRevision` stays `ROUTE_ABSENT_REVISION` for the whole of UDG-003 because no route can exist (P03-h).
- The authority step reads no wall clock. `Date.now()`, `performance.now()`, `Math.random()`, filesystem and network access live only in the scheduler adapter and telemetry modules. Tests inject a deterministic scheduler. The production scheduler is whatever the pinned server's declared fixed-step facility turns out to be (PR-2); if that facility is absent or unusable **UDG-003 stops and escalates** — "an absent public fixed-step facility blocks Gate A; it does not authorise an alternative loop" is applied literally.
- `arrivalOrdinal` is a server-private, strictly monotonic counter incremented when an observation is **enqueued**, bounded by `Number.MAX_SAFE_INTEGER`; at the bound the room refuses further admissions and drains, never wraps. It is never replicated and needs no protocol field.

### P03-b Tick cutoff, and when an observation becomes eligible

- **The cutoff is captured before any tick work.** The first statement of `step(T)` is `cutoffOrdinal = arrivalCounter`. Nothing — not lifecycle handling, not validation, not a metrics read — runs before it. A later capture would make an observation's eligibility depend on handler order.
- **The eligible set for `T` is frozen at that instant:** `eligible(T) = { o : o.arrivalOrdinal ≤ cutoffOrdinal }`. It is computed once, snapshotted, and is the only input the rest of the tick may read.
- **Lifecycle events are handled first *inside* that frozen set** (P03-c stage L), not outside it. A disconnect, expiry or epoch change observed at `arrivalOrdinal > cutoffOrdinal` is not part of `T` at all: it waits for `T+1`, exactly like any other observation. This is what makes a tick reproducible — the same cutoff always selects the same set.
- Admission state (`H`, `latchedKind`, `G_d`) is mutated only in stage C, and queue membership only in stages L, Q and C — all of it in one module. Handlers on the transport side validate and enqueue; they never move a player, never consume an observation and never touch a watermark.
- An asynchronous completion observed after the cutoff cannot activate in `T` (case O03). UDG-003 cannot generate one because navigation is absent, so it is exercised through a journal-level completion stub rather than a real query.
- `cutoffOrdinal` is journaled every tick (P03-g). Order is never inferred from client timestamps or promise scheduling.

### P03-c The tick, stage by stage

One tick runs these stages in this order, and this is the list P03-b agrees with:

| Stage | Work | Source |
| --- | --- | --- |
| **F** | freeze `cutoffOrdinal` and snapshot `eligible(T)`; nothing else may observe the live queue afterwards | 5.1 |
| **L** | apply lifecycle from the frozen set: disconnect, expiry, epoch change. Old-epoch queued observations and queues of a departed entity are dropped and recorded. An entity retained across a reconnect stays idle | 5.1 "connection lifecycle always prevents old-epoch movement" |
| **Q** | **select at most one continuous observation per entity, strictly FIFO**: the *oldest* eligible continuous observation — `directIntent: true` or `false` — becomes this tick's selected observation, and every other eligible continuous observation **stays queued in arrival order**. Skipping forward to the oldest `directIntent: true` frame would be "drain a burst then simulate only its last frame", which 5.1 forbids | 5.1 |
| **S** | **screen**: (a) the selected continuous observation is validated and generation-checked, and a valid `directIntent: false` keepalive **stops here** — it is an observation, not an intention, and never reaches arbitration; (b) each discrete request is validated, checked for duplicate identity against the persistent cache **and** the frozen batch's request registry, generation-checked (strictly above `H`), containment-checked, and `UDG_MOVE_TO` is terminal-refused `NAVIGATION_BUSY` here. **Screening never advances `H`, never latches a kind, and never rejects an intention that could win arbitration** — intention losers are decided in stage A | 5.1, 5.2, 4.3, UDG-003 contract |
| **A** | **arbitrate** among the surviving **intention** candidates only — at most one continuous (necessarily `directIntent: true`) plus the admitted discrete intentions: newer generation first, then kind precedence `directIntent true → explicit cancel → path activation`, then lowest `arrivalOrdinal` within a kind. Losers are rejected here with the code their relation to the *winning* decision gives them. The candidate set may be empty | 5.2 |
| **C** | **commit the winner, or take the neutral branch**: with a winner, advance `H` if and only if its generation is above it, latch the kind, set `G_d`, and write one terminal record (acceptance **or** refusal); with no winner, keep `H`, `latchedKind` and `G_d` exactly as they were and step with neutral horizontal input. Then purge from the queue every continuous observation the committed decision made inadmissible — `generation < H`, or `generation == H` for a frame asserting an intention while the latched kind is no longer `direct` (keepalive frames are never purged on kind grounds) — each recorded as **refused, not consumed** | 5.1, 5.2, 4.3 |
| **R** | commit eligible **route completions** only after the input decision is committed. A completion whose generation no longer equals `H`, or whose kind is not the latched kind, is discarded with a terminal `SUPERSEDED`. Input is decided first; the completion is then found obsolete — that is O12, and the direction matters | 5.1, O03, O04, O12 |
| **X** | step each connected entity exactly once, in ascending `entityId` order using plain `<` on the identifier string. Entity ids are printable ASCII (`ASCII_IDENTIFIER`, ≤ 64) and server-assigned, so code-unit order is code-point order and is host-independent; `localeCompare` is banned in this path | 5.1, 4.4 |
| **M** | map canonical state to the replica, including the `routeRevision`/`nextWaypointIndex` 0 sentinels | 4.4 |
| **P** | publish terminal results, then metrics, then flush the tick's journal rows | 4.3, 19.1 |

**State, precisely.** Two pieces must not be conflated, or O06 becomes unprovable:

- `H` — highest **admitted** generation; `latchedKind` — the kind of that admitted intention, `none` before the first one; `G_d` — the generation of the *current direct intention*, which exists only while `latchedKind == direct` and is cleared the moment another kind is committed.
- `horizontalDrive` — **this tick's** drive, deliberately separate from intention metadata: the selected-and-admitted `directIntent: true` frame's normalised axes when nonzero, otherwise `NONE`.
- `movementMode` — the replicated mode (`idle`/`direct`/`path`), derived from `horizontalDrive`: nonzero drives `direct`; a release, a keepalive, a refused or purged frame, a cache-hit-only tick or a missing frame gives `idle` horizontal behaviour while `latchedKind` and `G_d` stay as they were so the same direct generation can legitimately resume (O06).

**A keepalive is an observation, not an intention kind.** A valid `directIntent: false` frame is consumed as an observation and nothing more: it never advances `H`, never replaces `latchedKind`, never clears `G_d`, and contributes no horizontal drive. That is why the initial neutral generation-zero frame leaves `H = 0` with `latchedKind = none` rather than creating a "keepalive intention", and why `direct gN → keepalive gN → direct gN` resumes the held direct intention instead of churning metadata (trace T-5). Keepalive therefore does not appear in the precedence list; it is filtered out before arbitration.

Two consequences are stated because they are the ones a rewrite gets wrong:

1. kind precedence **overrides** arrival order (O02: same generation, either arrival order, direct wins), and within one kind arrival order decides;
2. different real arrival orders may legitimately produce different intermediate ticks. [movement-authority.md 5.5](../interfaces/movement-authority.md) forbids claiming global determinism independent of network arrival, and the UDG-003 suite must not assert it.

### P03-d Generation admission and intention selection — one algorithm

Per entity/epoch the server holds `H`, `latchedKind`, `G_d`, the continuous queue, the discrete queue and the request cache. This is the whole rule; there is no second place where generations or intentions are decided.

```text
// ---------------- per entity/epoch state ----------------
// H              highest admitted generation (0 at join)
// latchedKind    none | direct | cancel | path        (none before the first committed intention)
// G_d            generation of the current direct intention; set only while latchedKind == direct
// queue          FIFO of continuous observations, <= 32
// discreteQueue  FIFO of discrete requests, <= 8 per entity, <= 64 per room
// requestCache   persistent terminal records, key (entityId, epoch, requestId), 128 records / 30 s

// helpers used below
// refuse(o, code)   : dispose of an observation. For a discrete request whose requestId parsed, it writes exactly
//                     ONE terminal record — protocol 4.3 caches refusals, not only acceptances. An unparsable
//                     identity yields a journal row and NO cache record.
// answer(o, result) : reply from the persistent cache or the batch registry; writes no new record and never
//                     overwrites the identity that authorises the dedupe.

// ---------------- stage F : freeze ----------------
cutoff   = arrivalCounter                                   // FIRST statement of step(T)
elig     = snapshot of every queued item with arrivalOrdinal <= cutoff
batchIds = {}                                               // requestId -> { payloadHash, ordinal } seen in THIS tick

// ---------------- stage L : lifecycle, inside the frozen set ----------------
apply(elig.lifecycle: join | leave | expiry | epochChange)
for o in (queue + discreteQueue) where o.sessionEpoch != entity.epoch:
    refuse(o, EPOCH_MISMATCH)                               // refused, not consumed; never stepped

// ---------------- stage Q : select ONE continuous observation, FIFO ----------------
selected = queue.oldestEligible()                           // directIntent true OR false; kind-blind on purpose
                                                          // every other eligible frame stays queued, in arrival
                                                          // order, and is NOT refused here

// ---------------- stage S : screening — no H mutation, no latch, no winner rejection ----------------
intentionCandidates = []
keepalive = none

if selected exists:
    v = validateDirectFrame(selected, { sessionEpoch: entity.epoch })     // protocol order is fixed
    if v fails:                                      refuse(selected, v.code)
    elif v.generation < H:                           refuse(selected, SUPERSEDED)
    elif v.generation > H and v.generation - H > 64: refuse(selected, RESYNC_REQUIRED)
    elif v.directIntent == false:                    keepalive = selected  // OBSERVATION: not an intention.
                                                     // H, latchedKind and G_d are untouched by definition.
    elif v.generation == H and latchedKind != direct: refuse(selected, INVALID_GENERATION)  // held generation obsolete
    else:
        // generation > H (a new direct intention, gap already checked) or generation == H with latchedKind == direct
        intentionCandidates.push({ kind: direct, generation: v.generation,
                                   ordinal: selected.ordinal, axes: v.axes })

for o in elig discrete requests (UDG_MOVE_TO | UDG_CANCEL_PATH), in arrival order:
    v = validateMoveTo(o, ctx) | validateCancelPath(o, ctx)
    if v fails:                    refuse(o, v.code); continue            // identity unparsable -> NO cache record
    sig = { requestId: v.requestId, payloadHash: payloadHashOf(v) }       // destination/cancel fields, not raw text

    // request identity: persistent cache first, then this tick's batch registry (protocol 4.3)
    hit = requestCache.get(entityId, entity.epoch, v.requestId)
    if hit exists:
        answer(o, identityMatches(hit, sig) ? hit.terminalResult          // replay: the recorded pending/terminal result
                                            : REQUEST_ID_CONFLICT)        // a conflict NEVER overwrites hit's identity
        continue                                                          // no movement, no H change, no new record
    if batchIds.has(v.requestId):
        answer(o, batchIds[v.requestId].payloadHash == sig.payloadHash
                     ? SHARED_DISPOSITION_OF(batchIds[v.requestId].ordinal) // identical retry: ONE disposition,
                                                                            // ONE terminal record, ONE publish
                     : REQUEST_ID_CONFLICT)
        continue
    batchIds.set(v.requestId, sig)

    if v.generation <  H:            refuse(o, SUPERSEDED);         continue
    if v.generation == H:            refuse(o, INVALID_GENERATION); continue  // equality is NEVER a new discrete
    if v.generation - H > 64:        refuse(o, RESYNC_REQUIRED);    continue  // intention, whatever the latched kind

    if o is UDG_MOVE_TO:                                                          // UDG-003 has no navigation
        refuse(o, insideRegionBounds(v.destination) ? NAVIGATION_BUSY
                                                    : OUT_OF_BOUNDS)              // honest code first
        continue                                                                  // never a candidate: no H change,
                                                                                  // no path latch, no route mutation
    intentionCandidates.push({ kind: cancel, generation: v.generation,
                               ordinal: o.ordinal, requestId: v.requestId })

// ---------------- stage A : arbitration over intentions only ----------------
winner = intentionCandidates.sort((a, b) =>
             (b.generation - a.generation)                 // newer admitted generation beats an older one
          || (precedence[a.kind] - precedence[b.kind])     // direct 0, cancel 1, path 2   (path: unreachable here)
          || (a.ordinal - b.ordinal)                       // first admitted wins within one kind
         ).firstOrNull()                                   // MAY BE undefined — never dereferenced blindly
for loser in intentionCandidates except winner:
    refuse(loser, loser.generation == winner.generation ? INVALID_GENERATION : SUPERSEDED)

// ---------------- stage C : commit the winner, or take the neutral branch ----------------
if winner exists:
    if winner.generation > H: H = winner.generation
    latchedKind = winner.kind
    G_d = (winner.kind == direct) ? winner.generation : cleared
    horizontalDrive = (winner.kind == direct and winner.axes is nonzero) ? winner.axes : NONE
    cacheTerminalRecord(winner)                            // the admitted intention's own terminal result; screened
                                                           // refusals were already cached by refuse() in stage S
else:
    // missing input, all-invalid input, keepalive-only, or cache-hit-only: no intention metadata changes
    horizontalDrive = NONE                                 // a consumed keepalive differs only in journal inputSource
    // H, latchedKind, G_d deliberately unchanged

// stale backlog: the committed decision can make already-queued continuous observations inadmissible
stale = queue.filter(q => q.generation < H                                   // below the new watermark
                       or (q.generation == H and q.directIntent == true       // a HELD sample that is no longer
                           and latchedKind != direct))                        // held: kind is no longer direct)
for q in stale: refuse(q, q.generation < H ? SUPERSEDED : INVALID_GENERATION) // refused, NOT consumed: no step,
queue.removeAll(stale)                                                       // no drive, no invented acknowledgement

// ---------------- stages R, X, M, P ----------------
R: commit eligible route completions AFTER the input decision; a completion whose generation != H or whose
   kind != latchedKind is discarded with a terminal SUPERSEDED            // O12 direction; vacuous in UDG-003
X: step each connected entity EXACTLY ONCE, ascending entityId            // once whether or not a winner existed
M: map canonical -> replica, routeRevision/nextWaypointIndex sentinels 0/0
P: publish terminal results, metrics, then journal rows (P03-g)
```

- **Nothing that can win is rejected before arbitration.** Screening answers only "is this usable, is this a duplicate, is this in range, is navigation available at all". Stage A decides who wins; stage C is the first and only place `H` moves. Revision 1 mutated `H` during screening, which made whichever equal-generation operation arrived first the de facto winner — the defect this revision removes.
- **`UDG_MOVE_TO` never enters arbitration.** UDG-003 has no navigation, so a MoveTo that survives validation, identity and generation checks is terminal-refused `NAVIGATION_BUSY` in screening (or `OUT_OF_BOUNDS`/`INVALID_DESTINATION` when the destination is outside the validated volume). `H` does not move, `latchedKind` never becomes `path`, `routeRevision` stays 0, and the refusal is cached so a retry answers identically. `path` therefore appears in the precedence list for P03 completeness but is unreachable in this task, and a fixture asserts that no candidate with kind `path` is ever constructed. `UDG_CANCEL_PATH` *is* admissible because its effect is a stop, not a route: admitting a cancel advances `H`, latches `cancel` and clears horizontal drive without touching route state.
- **A keepalive is an observation.** The `directIntent == false` branch is taken **before** the equal-generation kind test, so a keepalive cannot be refused as `INVALID_GENERATION`, cannot become a candidate, and cannot alter `H`, `latchedKind` or `G_d`. Its only effect is this tick's journal `inputSource: keepalive` and a consumed observation with `horizontalDrive = NONE`.
- **Discrete equality is never a new intention.** A discrete request is admitted only strictly above `H`, so a fresh `requestId` cannot reuse an already-latched same-kind generation; legitimate follow-ups use a higher generation. The only equality path is identity replay, answered from the cache or the batch registry before admission.
- **A held direct generation cannot bypass `H`.** A continuous frame is a candidate only when `generation == H` *and* `latchedKind == direct` (equivalently `generation == G_d`), or when it opens a new intention above `H` within the 64 window. After a newer cancel commits, `G_d` is cleared and backlog frames carrying the old generation fall below `H` → `SUPERSEDED` — applied never, in the purge or in a later tick.
- **Kind latching across ticks:** an equal-generation *intention* whose kind differs from the latched kind is `INVALID_GENERATION` in the tick it arrives, so a late same-generation click cannot revive a route cancelled by direct input, and a late same-generation direct start cannot resurrect a cancelled path.
- **Exactly one consumption, and purges are not steps.** Stage Q consumes at most one continuous observation per entity per tick. Losers, purged backlog and overflow refusals are recorded with their reason, contribute no drive, are never re-queued, and never cause an extra step — the entity steps once in stage X whatever stage C decided. Purge work is bounded by the 32-frame queue. P03-f governs what may honestly be claimed about SDK acknowledgement for anything refused here.
- `H` never changes for a structurally invalid, old-epoch, rate-limited, duplicate-answered, screened-refusal or excessive-gap operation, for a loser of arbitration, for a purged frame, or in the no-winner branch.
- **No second mutation.** A committed winner mutates the state once. A cache or batch hit performs no state transition at all — that is the whole content of the dedupe requirement.
- **Every refusal is attributable, and refused once.** Stage A losers carry `rejectedCode`; overflow, lifecycle, screening, purge and no-path refusals carry `disposition`; `meta` counts by disposition. A frame that was purged is not later refused again as a stale arrival, because it is no longer in the queue.

`GENERATION_MAX` — value versus increment:

| Situation | Behaviour |
| --- | --- |
| an operation carrying `generation == GENERATION_MAX` (4 294 967 294) | a legal domain value; admitted under the normal rules above. UDG-003 does not treat the top of the domain as an error |
| a wire value above `GENERATION_MAX` (e.g. 4 294 967 295) | outside the generation domain → `INVALID_GENERATION` from the protocol validator; no `H` change. Epoch tops out one higher (`EPOCH_MAX` = `UINT32_MAX`); the two domains are distinct and neither wraps |
| a **new** intention while `H == GENERATION_MAX` | cannot be formed: `RESYNC_REQUIRED`, `H` unchanged, epoch renewal through the join lifecycle is required. No wrap to 0, ever |
| a held frame or cached replay at `generation == GENERATION_MAX` | admitted or answered normally; neither needs an increment, so neither is refused |

Revision 1 wrote "refuse at `GENERATION_MAX`", which conflated accepting the adopted value with permitting an impossible increment. Only the increment is refused.

### P03-e Worked traces

Each trace becomes a named fixture (`UDG-003-ordering-t1` … `UDG-003-ordering-t8`, reused by the admission, neutral, abuse and journal groups) that the assignment can cite directly. Where order is claimed not to matter, both orders are asserted.

**T-1 / T-2 — equal-generation direct versus cancel, both orders (`H = 19`, `latchedKind = direct`, entity moving).**

| | order 1 | order 2 |
| --- | --- | --- |
| observed | `ordinal 300` direct g20 (`directIntent: true`, axes `1,0`); `ordinal 301` cancel g20 `req c1` | cancel g20 `req c1` first (`ordinal 300`); direct g20 second (`ordinal 301`) |
| stage Q | the direct frame is the only continuous observation → selected and consumed; nothing else is queued | identical |
| screening | direct g20: `> H`, gap 1 → candidate. Cancel g20: `> H`, gap 1, identity fresh → candidate. **`H` untouched** | identical |
| arbitration | same generation → precedence: direct (0) beats cancel (1) → **direct wins** | identical |
| commit | `H = 20`, `latchedKind = direct`, `G_d = 20`, `horizontalDrive` from the consumed frame; terminal `accepted: true, appliedTick = T` recorded once | identical |
| loser | cancel g20 → equal generation, different kind → `INVALID_GENERATION`, terminal `accepted: false, appliedTick: null, routeRevision: null` for `c1`, cached | identical |
| tick outcome | mode `direct`, exactly one step; queue empty afterwards | identical |
| journal difference | only the two `ordinal` values | only the two `ordinal` values |

**T-3 — a newer cancel beats an old held frame (`H = 24`, `latchedKind = direct`, `G_d = 24`).**

| | |
| --- | --- |
| observed at cutoff 402 | `ordinal 401` cancel g25 `req c9`; `ordinal 402` direct g24 (a stale held sample); queue also holds `ordinal 398` direct g24 and `ordinal 399` keepalive g24 |
| stage Q | the oldest eligible continuous observation is the queued **g24 from ordinal 398** → it is selected and consumed; ordinals 399 and 402 stay queued, unrefused |
| screening | selected g24: `== H` with `latchedKind == direct` → candidate direct g24. Cancel g25: `> H`, gap 1, identity fresh → candidate cancel |
| arbitration | 25 > 24 → **cancel wins**; arrival order is irrelevant |
| commit | `H = 25`, `latchedKind = cancel`, `G_d` cleared, `horizontalDrive = NONE`; terminal for `c9` is `accepted: true` (mode changed) with `routeRevision: null` |
| loser | the selected g24 frame is refused `SUPERSEDED`: consumed, no drive, not re-queued |
| purge | the remaining queued items (ordinals 399, 402) both carry g24 < `H = 25` → refused `SUPERSEDED`, removed, counted as **refused**, causing no step, no drive and no invented acknowledgement |
| tick outcome | mode `idle`, zero horizontal drive, exactly one step; `y` unchanged (no physics in this task) |
| next tick | a further frame still at g24 is `generation < H` → `SUPERSEDED`. There is no "equality with an obsolete `G_d`" path that bypasses `H` or the newer cancel |
| to resume direct movement | the client must use a **higher** generation |

**T-4 — cached replay after `H` has advanced, and refusals are cached too.**

| | |
| --- | --- |
| history | `req r7` (MoveTo, destination `(12, 0.9, −3)`) at g30 was **screened-refused `NAVIGATION_BUSY`** in UDG-003 — never admitted, so `H` did not move and no kind latched. Per protocol 4.3 the terminal *refusal* is cached as `(entityId, epoch, r7, payloadHash, terminalResult)`; `H` is now 34 |
| retry, identical payload | screening hits the persistent cache **before** any generation test → the recorded refusal is returned verbatim; no movement, no second transition, `H` stays 34, no second record; journal `dedupe: cache` |
| retry, different destination | `REQUEST_ID_CONFLICT`; no state change, no `H` change, and the cached identity is **not** overwritten — the record that authorises the dedupe survives the conflict |
| retry after eviction (beyond 128 records or 30 s TTL) | no cache hit → generation checks: `30 < H = 34` → `SUPERSEDED`. An evicted id still cannot replay movement, the property [protocol.md 4.3](../interfaces/protocol.md) requires |
| retry with a stale epoch | the cache is keyed by epoch, so no hit; epoch equality refuses it, and old-epoch records stay inert diagnostics |

**T-5 — a keepalive is an observation: initial neutral frame, and direct → keepalive → direct resume.**

| step | state and effect |
| --- | --- |
| join | `H = 0`, `latchedKind = none`, `G_d` unset, mode `idle` |
| neutral g0 frame (`directIntent: false`, axes `0,0`) | selected and consumed; `generation == H`, `directIntent == false` → **keepalive branch before any kind test**. `H` stays 0, `latchedKind` stays `none`, `G_d` stays unset; `horizontalDrive = NONE`; mode `idle`; journal `inputSource: keepalive`, `intentionCommitted: false`. No intention is created by the generation-zero frame |
| direct g1 (axes `1,0`) | selected, consumed; `1 > H`, gap 1 → the only candidate → commit: `H = 1`, `latchedKind = direct`, `G_d = 1`; drive from the normalised axes; mode `direct`; one step |
| keepalive g1 | selected, consumed; `directIntent == false` → keepalive branch: **not** refused `INVALID_GENERATION`, not a candidate; `H = 1`, `latchedKind = direct`, `G_d = 1` all unchanged; `horizontalDrive = NONE`; mode `idle` for this tick |
| direct g1 again | selected, consumed; `generation == H` with `latchedKind == direct` → admissible held sample → commit with **no `H` change**; drive resumes; mode `direct` |
| invariants asserted | no keepalive tick advanced `H`, replaced `latchedKind` or cleared `G_d`; exactly one observation consumed per tick; exactly one step per tick; the resume used the same generation, which is what [5.2](../interfaces/movement-authority.md) requires |

**T-6 — FIFO selection and stale backlog against a competing discrete intention (burst shape).**

| | |
| --- | --- |
| setup | `H = 10`, `latchedKind = direct`, `G_d = 10`; queue in arrival order: `o1` direct g10 `(1,0)`, `o2` keepalive g10, `o3` direct g10 `(0,1)`, `o4` direct g11 `(1,1)`; also eligible this tick: `o5` cancel g12 `req c5` |
| stage Q | selected = **`o1`** (oldest continuous, kind-blind). `o2`, `o3`, `o4` **stay queued** — they are not arbitration losers and were not consumed |
| screening | `o1` → candidate direct g10. `o5` → identity fresh, `12 > 10`, gap 2 → candidate cancel. `o4`'s higher generation is irrelevant this tick: it was not selected and is not a candidate |
| arbitration | cancel g12 wins (newer generation beats older) |
| commit | `H = 12`, `latchedKind = cancel`, `G_d` cleared, `horizontalDrive = NONE`; one step; `c5` terminal `accepted: true` |
| loser | `o1` refused `SUPERSEDED` (consumed, no drive, not re-queued) |
| purge | `o2`, `o3` carry g10 < 12 → refused `SUPERSEDED`. `o4` carries g11 < 12 → also refused `SUPERSEDED`. All three are counted as **refused**, never as consumed; zero extra steps; no acknowledgement is invented for them (P03-f, PR-8) |
| boundedness | consumption stayed at one; purge work ≤ the 32-frame queue; queue depth after the tick is 0; buffer depth trace records the high-water mark |
| why not "apply the newest frame" | draining `o1..o4` and simulating only `o4` is exactly the behaviour [5.1](../interfaces/movement-authority.md) forbids, and it would let a burst buy travel |

**T-7 — the no-winner branch: the algorithm never dereferences an absent winner.**

| variant | state and effect |
| --- | --- |
| missing input | queue empty, no discrete request → `intentionCandidates` empty → `winner` undefined → neutral branch: `horizontalDrive = NONE`, mode `idle`, `H`/`latchedKind`/`G_d` untouched, exactly one step |
| all input invalid | the single eligible frame is structurally unusable (non-finite axis, or a uint32 value the codec silently coerced): selected, consumed, refused `INVALID_PAYLOAD`, `H` unchanged, `horizontalDrive = NONE`, one step, journal `inputSource: rejected` with the raw representation recorded |
| cache-hit-only tick | two discrete retries of already-cached ids, no continuous observation: both answered in screening, no candidate, `winner` undefined → neutral branch, `H` unchanged, one step, no new terminal records |
| screened-refusal-only tick | a MoveTo that is refused `NAVIGATION_BUSY`: no candidate, neutral branch, `H` unchanged, one step |
| keepalive-only | see T-5: consumed, neutral drive, intention metadata intact |

**T-8 — request identity is complete: batch registry, conflicts, latched generations, refusal caching.**

| case | behaviour |
| --- | --- |
| same tick, same id, same payload | `req r9` MoveTo appears twice in one frozen batch with an identical destination: the first is screened and refused `NAVIGATION_BUSY` (and cached); the second hits the **batch registry** and shares that single disposition — one terminal record, one publish, no second transition |
| same tick, same id, different payload | the second occurrence gets `REQUEST_ID_CONFLICT`; no cache write, no state change, no `H` change |
| fresh id on a latched generation | `H = 15` with `latchedKind = cancel` from `rA`; a *new* `req rB` at generation 15 → refused `INVALID_GENERATION`, because discrete admission is strictly above `H` whatever the latched kind — a fresh id cannot reuse a latched same-kind generation as a new discrete intention. The legitimate follow-up is generation 16 with a new id |
| terminal refusals are cached | `NAVIGATION_BUSY`, `OUT_OF_BOUNDS` and `INVALID_DESTINATION` records are cached and replayed identically (T-4), because 4.3 requires the terminal result to be emitted once and retained for dedup — not only for accepted requests |
| unparsable identity | a request whose `requestId` fails `REQUEST_ID_PATTERN` cannot be deduped by identity: it is refused `INVALID_PAYLOAD`, journaled as an observation, and creates **no** cache record — inventing a key for it would let a malformed payload poison the cache |
| MoveTo never reaches arbitration | no candidate with kind `path` is ever constructed; `latchedKind` never becomes `path`; `routeRevision` stays 0; no `UDG_ROUTE_STATUS` is emitted |
### P03-f Neutral input, queues and what "acknowledgement" may honestly claim

- **No-winner ticks are ordinary, not exceptional.** When stage C takes the neutral branch — missing input, all input invalid, keepalive-only, cache-hit-only, or screened-refusal-only — the entity steps `neutralDirectFrame` for the current epoch and held generation: horizontal desired displacement becomes zero **on that tick**, `movementMode` becomes `idle`, heading is preserved ([5.4](../interfaces/movement-authority.md)), and `H`, `latchedKind` and `G_d` are untouched. No new intent is invented and no SDK acknowledgement is fabricated.
- **A keepalive is a consumed observation.** A valid `directIntent: false` frame is selected by FIFO, consumed, and contributes no horizontal drive; it never advances `H`, never replaces `latchedKind`, never clears `G_d`, and never enters arbitration. The journal distinguishes `keepalive` from `neutral` because that difference becomes load-bearing at UDG-007/Spike 003, even though both give zero horizontal drive in UDG-003.
- **Queue policy, stated once.** Stage Q consumes **at most one continuous observation per entity per tick**, the oldest eligible one, kind-blind; deliberately not "the oldest frame that asserts something", because skipping ahead is the forbidden "drain a burst then simulate only its last frame". Everything else eligible **stays queued in arrival order**, unrefused, up to 32 per client. A frame arriving at a full queue is refused `RATE_LIMITED`, counted and never re-queued (drop-newest: it preserves arrival order and cannot resurrect stale input; drop-oldest would need a documented reason). An intention loser is consumed once and refused with its code. After stage C commits, the queue is purged of observations the new decision made inadmissible — `generation < H`, or `generation == H` for an intention-asserting frame once the latched kind is no longer `direct` — each recorded as **refused, not consumed**, causing no step and no drive, with purge work bounded by the 32-frame queue. An entity therefore never moves more than once per tick because of a backlog, and a backlog can never be replayed as movement after the fact.
- **Acknowledgement is a separate claim from counting, and it stays a hard stop.** The adopted prohibition stands: frames never represented in state must not be acknowledged. Counting a refusal is *not* evidence that an SDK acknowledgement is truthful — a transport that acknowledges on receipt may acknowledge a frame UDG dropped, purged or superseded. PR-8 must establish from installed declarations and executed behaviour what the pinned acknowledgement actually tracks (received versus applied) and whether any public API lets the application withhold or correct it. If no supported mechanism distinguishes them, that is recorded as an API-visibility limitation with its experiment output and **escalated**: D-7 is decided from that evidence and is **never pre-approved as a waiver**, and a documented equivalent plus a bounded-memory proof or the contract's bounded offender disconnect remain the alternatives. The application journal stays the truth record for what was actually applied.
- UDG-003 has no physics, so "vertical settling can still occur in idle" is **not** exercised here and must not be simulated by hand; idle assertions are horizontal-only with `y` unchanged. The vertical half belongs to UDG-006 and Gate B, reported in a separate population as [acceptance-gates.md 7.3](../validation/acceptance-gates.md) requires.
- UDG-003 has no physics, so "vertical settling can still occur in idle" is **not** exercised here and must not be simulated by hand; idle assertions are horizontal-only with `y` unchanged. The vertical half belongs to UDG-006 and Gate B, reported in a separate population as [acceptance-gates.md 7.3](../validation/acceptance-gates.md) requires.

### P03-g Replay journal — enough to replay, not only to hash

The journal is the authority record and doubles as evidence; its vocabulary follows [evidence-requirements.md 19.1](../validation/evidence-requirements.md). A per-tick state digest alone cannot replay anything, so the journal records the **inputs, lifecycle and ordering decisions** as well as state, in joinable rows keyed by `(serverTick, arrivalOrdinal)`:

| Row type | Fields |
| --- | --- |
| `prologue` (once per run) | protocol version, `configHash`, `movementHash`, `regionHash`, region provenance label, tick origin, `dt`, patch interval, movement speed and the validated region bounds used for containment, seeds, run id, and the **full initial canonical state of every entity** (position, yaw, velocities, grounded, verticalVelocity, mode, route fields, `intentGeneration`, `sessionEpoch`, `connected`, `lastAuthorityTick`) plus its `canonicalHash` for comparison |
| `event` | `arrivalOrdinal`, alias, kind (`join`/`leave`/`expiry`/`epochChange`), epoch before/after, tick the event was *eligible* for |
| `observation` | `arrivalOrdinal`, eligible tick, alias, kind (`direct`/`keepalive`/`cancel`/`moveTo`/`unknownMessage`), epoch, generation, `directIntent`, the **raw decoded payload needed to re-run screening** — axes exactly as decoded, and for a discrete request the `requestId`, `payloadHash` and the full validated field set (`x`, `y`, `z` for a MoveTo destination; none for a cancel), plus a canonical rendering of a **malformed** payload (`field: { value, type }` or `"<invalid:type>"`, never silently dropped) and the SHA-256 of the raw record for provenance, normalised axes, screening disposition with its code, and SDK frame identity where publicly observable else `null` with the recorded limitation |
| `intention` | tick, `cutoffOrdinal`, the selected continuous observation reference (or `none`), the intention candidate set as `(kind, generation, ordinal)` triples in arrival order, winner (or `none`), every loser with its rejection code, and `H`/`latchedKind`/`G_d` before and after. Screened refusals are listed separately from losers, so a `NAVIGATION_BUSY` is never recorded as an arbitration loss |
| `tick` | `serverTick`, `cutoffOrdinal`, alias, consumed observation reference or `none`, `inputSource` (`direct`/`keepalive`/`neutral`/`rejected`), `horizontalDrive` axes or `NONE`, `intentionCommitted` true/false, mode before/after, `routeRevision`, desired and resolved displacement, rejection/result code, purged-observation count and reasons |
| `result` | `requestId`, `payloadHash`, terminal `accepted`/`appliedTick`/`routeRevision`/`reason`, `dedupe` (`none`/`cache`/`batch`), cache depth |
| `state` | per entity per tick: canonical state digest (position, yaw, velocities, grounded, verticalVelocity, mode, route fields, `intentGeneration`, `sessionEpoch`, `connected`, `lastAuthorityTick`) |
| `meta` | sampled queue depth and the ordered `arrivalOrdinal`s remaining in each queue after the tick, counters by disposition (`consumed`, `refused:overflow`, `refused:superseded`, `refused:epoch`, `refused:structural`, `refused:generation`, `refused:navigation`, `purged`), buffer high-water marks |

- **Replay requirement — inputs, not summaries.** `replay(prologue, event[], observation[])` reconstructs state and decisions from the recorded **inputs alone**: initial canonical states, the validated configuration and region bounds needed by containment checks, and each observation's raw or validated payload. Digests and candidate summaries are comparison outputs, never replay inputs — a fixture therefore strips every digest from a journal and must still replay it, and a fixture must replay a malformed-input journal, because a screening decision that cannot be reconstructed from the record was not really proved. Replay must reproduce, in the same runtime, every `state` digest **and** every `intention` decision: the same selection, winner, loser codes, screened refusals, purges and `H` trajectory. A replay that reaches the same positions through different admissions has not proved the rule, and a replay whose prologue hashes do not match the running configuration is refused outright rather than partially compared.
- **Copy-on-record.** The pinned codec reuses mutable state: `InputEncoder.encode()` returns "a subarray of an internal buffer — copy if retaining across calls", and `InputDecoder.decodeAll` re-uses one instance across callbacks ("reads of the instance must be synchronous"). The adapter copies scalars into a frozen observation record before returning, and a test mutates the source instance after intake to prove the journal and the queued observation are unaffected.
- **Bounds.** Queue depth bounded (32 frames/client, 64 queued discrete operations/room, 8/entity); in-memory retention bounded (current tick plus the 128-record terminal cache); the journal streams to disk, and sustained abuse must not grow any unbounded array. Measured numbers are counts; a heap-growth threshold is P10 territory and a byte threshold on shared runners is a flake generator.
- **Sanitisation.** Aliases stable per run and joinable across traces; no token, cookie, reconnect secret or private machine path in any row.

### P03-h Conflicts and mismatches with what is already adopted

| Item | Status | Resolution |
| --- | --- | --- |
| `admitGeneration` refuses `generation ≤ watermark`; 5.2 needs `generation == H` continuous samples | **real conflict** | UDG-003 owns the continuous rule and runs arbitration before `H` moves; `admitGeneration` keeps its discrete-intention meaning. One protocol-owner-reviewed scope note (P03-d), no behaviour change, UDG-002's suites untouched |
| forward gap 64 | match | `MAX_GENERATION_FORWARD_GAP`, never a literal |
| `GENERATION_MAX` is a legal value; increments above it are not | match, restated | value admitted; new intention at the top refused `RESYNC_REQUIRED`; wire values above the domain refused `INVALID_GENERATION`; no wrap |
| `arrivalOrdinal` has no protocol bound | gap P03 fills | server-private bound `Number.MAX_SAFE_INTEGER`; drain at the bound (P03-a) |
| abuse responses | closed vocabulary | `RATE_LIMITED`, `RESYNC_REQUIRED`, `EPOCH_MISMATCH`, `INVALID_PAYLOAD`, `SUPERSEDED`, `INVALID_GENERATION`, `REQUEST_ID_CONFLICT`, `NAVIGATION_BUSY`, `OUT_OF_BOUNDS`, `INVALID_DESTINATION` only. An offender disconnect is a transport event recorded in the journal, never a fabricated command result (4.3 keeps transport failure separate) |
| discrete path requests | contract-specific | refused in **stage S**, never a candidate: after honest validation, identity, generation and containment checks, `NAVIGATION_BUSY` (or `OUT_OF_BOUNDS`/`INVALID_DESTINATION`) is a terminal refusal that is cached for dedup. No `H` change, no `path` latch, `routeRevision` 0, no route mutation |
| `UDG_ROUTE_STATUS` (optional pending) | unused | no pending work exists; the suite asserts absence |
| `movementMode` `path` (2) | unreachable | replica mode is only 0/1; route-dependent 5.5 cases are deferred (§3.5) |
| P04 pending policy, `navmeshHash`, route revisions | not this task | not implemented, not pre-empted; no pending state may exist |

### P03-i What P03 does not decide

Pending-route behaviour (P04), entity-bound simulator factories (P05), gravity and controller margins (P07), worker and asset formats (P08), dead zones and mode-handoff procedure (P09), and every spike threshold and sample size (P10). UDG-003 measures the Gate A numbers it can legitimately produce (§3.7) and records the rest as not-yet-measurable instead of inheriting a neighbour's pass condition.

## 2. Proposed Colyseus pin set, and what is actually proven

### 2.1 Proposed pins — provisional, not established

**Every pin below is a proposal.** Registry metadata is not compatibility evidence, and no package other than `@colyseus/schema@5.0.45` is installed here. The pins become "the tested compatibility set" only when an authorised install lands them and PR-0/PR-1 record resolution, licences and a single resolved schema copy; API compatibility is provisional until PR-2…PR-12 execute against those installs. If the authorised install resolves something different, the register and this table's successor record the actual, not the expectation.

| Package | Proposed pin | Licence | Declared `engines` | Declared constraints that matter | Evidence class |
| --- | --- | --- | --- | --- | --- |
| `@colyseus/core` | `0.18.27` (registry `latest`, published 2026-11-05) | MIT | node ≥ 22.x | peer `@colyseus/schema ^5.0.8`; peer `@colyseus/ws-transport 0.18.x` (optional); peer `express ^4.16.0 \|\| ^5.0.0` (optional); peer `zod`, `@pm2/io`, `@colyseus/auth` optional; dep `@colyseus/shared-types ^0.18.2` | registry metadata only |
| `@colyseus/schema` | `5.0.45` — already installed | MIT | – | peer `typescript ≥ 5.0.0` (5.9.3 installed ✓); `exports` `.` and `./input` | **installed and executed by UDG-002** |
| `@colyseus/sdk` | `0.18.9` (registry `latest`, published 2026-10-30) | MIT | node ≥ 12.x | dep `@colyseus/schema ^5.0.8` — a direct dependency, not a peer; peer `@colyseus/core 0.18.x` optional | registry metadata only |
| `@colyseus/ws-transport` | `0.18.4` (registry `latest`, published 2026-08-10) | MIT | node ≥ 22.x | peer `@colyseus/core ^0.18.5`; peer `express ^4.16.0 \|\| ^5.0.0` — required, not optional | registry metadata only |
| `express` | whatever the resolver yields for that peer range, then pinned exactly (`latest` is `5.3.0`; last 4.x is `4.22.3`) | MIT | – | arrives through pnpm's peer auto-install | registry metadata only |
| `@colyseus/testing` | **not in the minimal set**; `0.18.6` exists and its peers require `@colyseus/core 0.18.x`, `@colyseus/sdk 0.18.x` **and `@colyseus/tools 0.18.x`** | MIT | node ≥ 22.x | choosing it drags `@colyseus/tools` into the runtime graph too | registry metadata only |

`5.0.45` satisfies both `^5.0.8` ranges, so one resolved schema copy *can* serve server, SDK and protocol — but "one copy" is a thing to prove: two resolved versions would mean two registration domains and a wire that disagrees with itself. PR-1 asserts exactly one `@colyseus/schema@<version>` in the lockfile and one entry in the installed graph. Everything listed is MIT and ESM with a `types` condition in `exports`, which resolves under this repository's `NodeNext` setting.

Pin rules the task keeps: exact versions only (no `^`, `~`, `latest`), no `pnpm.overrides`, no patched packages, licences captured from the install, and `pnpm install --frozen-lockfile` green in CI from the committed lockfile.

### 2.2 Public APIs already verified (do not re-probe; do not over-claim)

From the installed declarations of `@colyseus/schema@5.0.45` and from UDG-002's executed probes:

| API | Fact | Class |
| --- | --- | --- |
| `schema(fields, name)` + `t.uint32()/t.float64()/t.boolean()`, `MapSchema`, `Encoder`/`Decoder` | non-decorator builder form; `defineTypes` exists but announces itself deprecated | declared + executed |
| `DirectInputSchema` | flat five fields with defaults; the input codec rejects nested Schema at construction | declared + executed |
| codec coercion | out-of-range integer wraps and fractional values truncate **silently**; `float64` carries a double exactly; `-0` decodes as `+0` | executed (UDG-002) |
| `@colyseus/schema/input`: `InputEncoder`, `InputDecoder`, `InputMode = "reliable" \| "unreliable"`, `historySize` (default 3), `decodeAll` per-input `seq`, `copyInto`, `reset()` | reliable mode is one input per packet and **`seq` is `0`**; reliable `encode()` returns an **empty `Uint8Array` when nothing changed**; `encode()` returns a subarray of an internal buffer; `decodeAll` re-uses one instance | declared |
| no sanitizer in `@colyseus/schema` | sanitization/idle behaviour, if it exists, is a server/SDK concern | declared (absence checked against the installed build) |

None of that is evidence about the **server** or about **prediction**. Room-free encode/decode tests prove a codec: nothing about a fixed-step loop, an input queue, an idle policy, an acknowledgement, a patch schedule or a reconciler.

### 2.3 Assumptions that are only documentation observations

`defineInput`, `setFixedTimestep`, "single-frame next consumption", configurable sanitization/idle, `room.input`, `Predict.get`, the reconciler, `sim`, `attachAll`, a configurable 100 ms patch rate and any acknowledgement surface are **V1/V2 documentation observations** ([references.md](../references.md)) and are treated as unproven until compiled and executed against the pinned installs. [colyseus.md 6.1](../integration/colyseus.md) governs — "An API absent from installed declarations is a failed probe" — and 6.2 warns not to assume `pausePrediction`, `resetEpoch`, `clearHistory` or `switchMode` exist. Everything client-predictive belongs to **UDG-SPIKE-001**; UDG-003 earns the server-side half.

### 2.4 Probe plan (one row per API in `docs/integration/colyseus-0.18-api-map.md`)

The api-map row schema is fixed by [colyseus.md 6.1](../integration/colyseus.md): exact package and version, import path, declaration file and symbol, official source URL or immutable source commit, minimal compiled probe path, runtime test id, result, limitations.

| ID | Probe | Compile / runtime | Pass condition | If it fails |
| --- | --- | --- | --- | --- |
| PR-0 | dependency resolution under the strict compiler policy | compile | `@udg/server` typechecks the pinned stack with `skipLibCheck: false` from `tsconfig.base.json`, no `any`, no `@ts-ignore` | **stop**: the pin set is unusable. Do not relax the compiler policy; escalate (D-2) |
| PR-1 | install graph identity | runtime | exact versions installed as declared; **one** resolved `@colyseus/schema`; peer/`express` resolution recorded; licences captured | stop; the register cannot describe the graph |
| PR-2 | fixed-step facility with advertised `dt` | compile + runtime | a declared facility drives ticks at the configured 20 Hz; observed tick count under an injected scheduler matches | **Gate A blocker** — record and escalate; no private or hand-rolled loop substitute |
| PR-3 | flat input declaration accepted | compile + runtime | `DirectInputSchema` is accepted as the fixed-input declaration and all five fields survive a real send/receive | blocker for the input path; escalate |
| PR-4 | malformed decode through the server | runtime | codec-coerced and out-of-range bytes reach `validateDirectFrame`, are refused with the adopted code, produce zero movement, and neither crash the room nor reach an observer | blocker: "an offender's message must not crash the room" would be unprovable |
| PR-5 | queue depth, coalescing, overflow | runtime | the SDK's behaviour under saturation is observed and recorded (buffer, coalesce or drop) and UDG's 32-frame bound is enforced at a named place | if no bound is demonstrable, the contract's documented-equivalent clause must be written and bounded memory proven before acceptance |
| PR-6 | idle/neutral behaviour | runtime | whether the SDK synthesises frames is established; UDG's neutral rule (P03-f) applies exactly once | blocker for the neutral rule |
| PR-7 | one frame per tick | runtime | a 100-frame burst yields at most one consumed frame and exactly one step per entity per tick | blocker; contract headline |
| PR-8 | acknowledgement semantics, received versus applied | compile + runtime | the public acknowledgement surface is named **and** an experiment shows what it tracks: does an applied frame and a dropped frame produce distinguishable acknowledgement state? | if indistinguishable, record the limitation with the experiment output and **escalate** (D-7). Do not substitute a counter for the proof, and do not claim truthfulness |
| PR-9 | `@colyseus/testing` helpers | compile + runtime | only if D-3 chooses it | otherwise the row records "not used, and why" |
| PR-10 | patch schedule versus tick schedule | runtime | over 200 ticks (10 s at 20 Hz) the patch schedule emits about 100 times at 100 ms, independently of the tick schedule; recorded as counts | record the ratio; a mismatch with configuration is a blocker |
| PR-11 | room disposal and lifecycle | runtime | disposal stops ticks, releases sessions, no write after dispose | blocker: "room disposal" is a named test |
| PR-12 | epoch renewal lifecycle | runtime | the public epoch-renewal procedure is discovered and documented (needed by `RESYNC_REQUIRED` and generation exhaustion) | record **BLOCKED** honestly and escalate; inventing a reset call is forbidden |

Two hard rules. Probes run **before** room behaviour is written (§3.2): a probe that fails after the room exists means the room was designed on an assumption. And a probe may not be satisfied by a cast, `@ts-expect-error`, a private path (`@colyseus/core/build/…` — the `./*` wildcard export makes that possible, which is why it must be forbidden) or a hand-written fake of SDK behaviour.

## 3. Proposed UDG-003 assignment

### 3.1 Prerequisite pins (each names the file it hashes)

Revision 1 collapsed two different digests into one row. Every value below names its file and the revision it describes; per U2-5 the checksum manifest at each commit is authoritative for the bytes at that commit, and no historical digest is ever rewritten.

| Item | Value |
| --- | --- |
| UDG-001 accepted implementation / reviewed submission | `1c735c2d845e399cc8b3cc33adac4ba7a6081387` / `0e586b619796597266f7ec4942d24231dfb5ce62`, CI `42511785889`; **Verified** |
| P01/P02/P06 adoption record | `74ffdaaba1bc3617999c99e73c7f197ebd01a570` |
| UDG-002 assignment record | `45051f6391dc9862dd92e514dddb6d51ea50c746` |
| UDG-002 accepted implementation / reviewed submission | `372be938f0dd825ff89fac56da7dc29d0789098f` / `a967c5f97ede7126837addcd192eb599648b9546`, CI `42627324928`; **Verified** |
| UDG-002 acceptance record commit | `d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4`, CI `42632130409` |
| this proposal, revision 1 | `d7b3127f984370d6faa29308de147876e254728c`, CI `42641249067`. Revision 2 opens at `2ec3660fcb1fd9fa8d2a478797e5d3c51e8849df`; the commit carrying this sentence cannot name itself, so `git log -- docs/contracts/assignments/UDG-003-readiness-proposal.md` stays authoritative for it |
| **contracts index** — file `report.json.contractHash` hashes: `docs/contracts/README.md` | `255e7b2cb8fd64c41e2e5beb2a56b03bb62b08e0ca11089299d81a2e540a5943` (unchanged across the UDG-001 and UDG-002 editions) |
| **UDG-002 task contract** — file `report.json.configHashes.taskContract` hashes: `docs/contracts/UDG-002.md` | `d78ec67820faa4179a0141f4beb48a96dc20e33766bc724d629ffda8280d7c4b` at the assignment commit `45051f63` and the first submission `a2a2318e`; `25e44ba5190e…` at the correction head `9b04ee28`; `87ac552f0793…` at the accepted implementation `372be938`; `7c7549cb4306…` at the reviewed submission `a967c5f9`; `53a152fed391dc47e93c0c5d3013e787a84047ca45dbe52694214221b360d059` for the current file, whose status line moved when acceptance was recorded. Each value was re-computed from `git show <commit>:docs/contracts/UDG-002.md` for this revision. Historical bundles keep the value their own report names; the file is never re-hashed backwards |
| **UDG-003 task contract** — `docs/contracts/UDG-003.md` at base `d364d2d` | `096f3ff0755569230b884cf4138be035845e28d44ad7332dc6bbd0c9e0cafaf5` (re-pinned at assignment, because the status line moves when the task starts) |
| baseline specification — `docs/specifications/UDG-SPEC-M0-002.md` v0.2 | `b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf` |
| P03's shared-requirement source — `docs/interfaces/movement-authority.md` | `0eaf5eb9d67cf34265ec28486b4b9b012ff42b2e0044ac8c98d49e8d28169f84` |
| Colyseus evidence contract — `docs/integration/colyseus.md` | `8bba03fcfb12ac9042c78b3a570e9ff2f2170031079f7f5ac1c3565f78b1090c` |
| checksum manifest at base — `docs/contracts/checksums.json` | `afe610ead0f5ac8478ac865883b524d015f97bbb3d0486df903f0e5c5658d780`, 58 entries |
| lockfile at base — `pnpm-lock.yaml` | `899e6f4d18930cb23fc32438dfe5d7b11d4d16741ebf2cf03f54a5c8585517e5`; superseded by the install UDG-003 itself commits, never by a claim |
| default configuration digests | `configHash 948f8c10fc404e2ebdb015abc8e30b8e66caf357347db3a2636ace96687a208a`, `movementHash c80f61d451eaf9ee7dc2804ba04f1794e2e0149ac33647932dd14852edf522ce` — the bounds-null `DEFAULT_SERVER_CONFIG`; a room started with bounds advertises a different, correct `configHash` (§4 step 4) |
| boundary rule table at base | `818c63d5b12f984b17172688be6fd82ed103d9e18473e0978e307225e8194b82`; A-6b re-digests it, the new value is named in the new record, historical values stay |
| P03 adoption record | **does not exist yet** — decision D-1 creates it; UDG-003 cannot reach Ready before it does |

### 3.2 Phase order (so the probe phase is not optional)

1. **Phase 0 — pins and probes only:** PR-0, PR-1, PR-2, PR-3, PR-8, PR-12, plus the probe build configuration in §3.4. Deliverable: the api-map skeleton and honest probe results. Failure ends the task with a blocker record, not a workaround.
2. **Phase 1 — authority core:** journal streams, cutoff, screening/arbitration/commit, neutral rule, queues, terminal cache — deterministic, injected scheduler, no transport.
3. **Phase 2 — transport and room:** adapter, join validation, session association, tick metrics, disposal, real server smoke run through the chosen client.
4. **Phase 3 — abuse, evidence, CI:** offender suite, buffer depth, capture plan, CI steps, submission.

### 3.3 Files — owned, supporting and controlled

**Owned by UDG-003 (contract list, unchanged):** `apps/server/src/{main,server-config}.ts`, `apps/server/src/rooms/RegionRoom.ts`, `apps/server/src/network/{ColyseusInputAdapter,join-validation}.ts`, `apps/server/src/movement/MovementAuthorityAdapter.ts`, `apps/server/src/state/map-player.ts`, `apps/server/src/lifecycle/DevelopmentSessions.ts`, `apps/server/src/telemetry/tick-metrics.ts`, `tests/reference/flat-direct-step.ts`, `tests/probes/colyseus-server.probe.ts`, `tests/contracts/UDG-003.test.ts`, `docs/integration/colyseus-0.18-api-map.md`.

**Supporting paths the assignment must also own, because the contract list alone cannot build, test or record the work:**

| Path | Why it is in scope |
| --- | --- |
| `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/tsconfig.probes.json` | the workspace that owns the dependency also owns the probe project (§3.4) |
| `apps/server/probes/**` (SDK probe modules), `apps/server/reference/**` (flat reference step) | code that imports `@colyseus/*` / shared packages must sit in their workspace; output lands in the already-ignored `apps/server/probes/dist/` |
| `tests/unit/udg-003/**` | deterministic authority-core suites (screening, arbitration, commit, neutral, cache) that run without a transport |
| `tests/fixtures/UDG-003-*/**`, `tests/fixtures/catalog.json` | scenario fixtures per §3.5, catalogued and digest-pinned like UDG-002's, without editing any UDG-002 entry |
| `docs/contracts/assignments/{UDG-003,UDG-003-completion,UDG-003-evidence}.json/md` | assignment record, completion record, and the sanitised machine-readable evidence summary with hashes (the raw bundles stay out of Git) |
| `docs/integration/dependencies.json`, `pnpm-lock.yaml` | selected packages, exact pins, licences, and the installed graph |
| `docs/contracts/UDG-003.md`, `docs/contracts/checksums.json`, `README.md`, `tests/AGENTS.md`, `apps/server/AGENTS.md`, `tools/checks/AGENTS.md` | status truth, delivered surface, run instructions, and the manifest regenerated by command |
| `docs/contracts/protocol-v1.md` | only the P03-d scope note (G-9) and, if the entry-map generalisation lands, its record entries |
| `docs/adr/` | **only if** a probe failure or a protocol/config conflict forces an ADR; the implementer proposes, the owner accepts. Adoption edits belong to the owner and are made only on explicit instruction |

**Controlled-path grants** — permission to touch a file is never permission to widen scope:

| Grant | Path | Limited to |
| --- | --- | --- |
| G-1 | `tools/checks/src/evidence.ts` | A-2, A-6 |
| G-2 | `tools/checks/src/fixtures.ts` | A-5 (kind dispatch; no new fixture command) |
| G-3 | `tools/checks/src/boundaries.ts` | A-6b: one SDK-import isolation rule covering `apps/server` **and** its probe tree |
| G-4 | `tests/contracts/UDG-001.test.ts` | A-1, A-3, A-4 and their live refusal demonstrations, nothing else |
| G-5 | `tests/fixtures/catalog.json` | new `UDG-003-*` entries with pinned `sha256`; **no edit to any UDG-002 entry** |
| G-6 | `.github/workflows/ci.yml` | a real probe step, a UDG-003 suite step, artefact list; existing evidence-step invariants untouched |
| G-7 | the status and record files in the table above | status, delivered surface, register and record updates the change requires |
| G-8 | `pnpm-lock.yaml`, `docs/contracts/checksums.json` | regenerated by the pinned toolchain and `pnpm contracts:checksums -- --write`; never hand-edited |
| G-9 | `packages/protocol/src/validation/commands.ts` | one doc-comment scope note on `admitGeneration` (P03-d); protocol-owner review; **no behaviour or export change** |
| ~~G-10~~ | ~~root `tsconfig.json` exclusion~~ | **withdrawn in revision 2** — the workspace-local probe layout (§3.4) makes the root-project exclusion unnecessary, so the root project keeps compiling every file under `tests/` |

No grant touches `packages/config`, the UDG-001/UDG-002 suites' evidence-integrity assertions, `docs/contracts/{scope,ownership,repository,definition-of-done,traceability}.md`, or any accepted evidence record. `.gitignore` needs no change: `apps/server/probes/dist/` is already ignored by the existing `dist/` rule (verified with `git check-ignore`).

### 3.4 Commands, probe modules and output paths

**Why revision 1's approach was wrong.** Module resolution walks up from the *importing file's* directory. A file at `tests/probes/x.ts` searches `tests/node_modules` and the repository `node_modules` — never `apps/server/node_modules` — so declaring a probe project inside `apps/server` does not make imports in `tests/probes` resolve; under pnpm's non-flat layout they simply fail. And `noEmit` produces no executable module, so a probe project cannot also be the thing the suite spawns.

**Layout.** Third-party-touching code lives in the workspace that owns the dependency; the contract-named paths stay as thin entry points.

```text
apps/server/probes/                    probe modules — import @colyseus/* (compiled by this workspace)
apps/server/reference/                 flat-direct-step reference — imports @udg/protocol, @udg/config
apps/server/tsconfig.probes.json       include ["src/**/*","probes/**/*","reference/**/*"], rootDir ".",
                                       outDir "probes/dist"
apps/server/probes/dist/               emitted output; already ignored by the root dist/ rule
tests/probes/colyseus-server.probe.ts  contract-named wrapper: node builtins only; builds if needed,
                                       spawns a compiled probe, relays its JSON
tests/reference/flat-direct-step.ts    contract-named wrapper: spawns apps/server/probes/dist/reference/…
```

- Inside `apps/server`, `@colyseus/*`, `@udg/protocol` and `@udg/config` resolve from `apps/server/node_modules` at compile time, and the emitted files at `apps/server/probes/dist/...` resolve the same packages at runtime by walking up to the same directory.
- The wrappers import no third-party module, so they typecheck in the root project and stay exactly where the contract names them.

**Typecheck and emit are separate commands with separate paths.**

| Purpose | Command | Effect |
| --- | --- | --- |
| typecheck the app | `pnpm --filter @udg/server typecheck` → `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.probes.json --noEmit` | strict checking of `src` and of the probe/reference tree under `skipLibCheck: false`, writing nothing |
| build for execution | `pnpm --filter @udg/server build` → `tsc -p tsconfig.json && tsc -p tsconfig.probes.json` | `apps/server/dist/**` (the workspace) **and** `apps/server/probes/dist/{src,probes,reference}/**` (runnable probes) |
| run one probe | `node apps/server/probes/dist/probes/<name>.probe.js --out <bundle-relative path>` | JSON result per probe, collected into `metrics/probes.json` |
| run the reference trace | `node apps/server/probes/dist/reference/flat-direct-step.js --ticks 200 --out <path>` | the 40 m trace rows the UDG-003 suite asserts |
| whole repository | `pnpm typecheck` (includes `pnpm -r typecheck`), `pnpm build`, `pnpm test` | unchanged composition; the root project still checks every file under `tests/` |

The UDG-003 suite builds what it asserts (the UDG-002 lesson) and records it as a measurement, because `pnpm test` builds only `packages/*`. Root `package.json` gains nothing: probes are run by the UDG-003 suite through the wrappers, so `pnpm test`, `pnpm test:contract -- --task UDG-003` and CI execute identical code. `test:e2e`, `test:spike`, `assets:build` and `assets:verify` stay guarded and must still refuse with their owning task named; UDG-003 creates `tests/reference/` and `tests/probes/`, **not** `tests/e2e/` or `tests/spikes/`. The smoke server binds `127.0.0.1` on an ephemeral port and prints one ready line; README documents ports, shutdown and ready signals.

### 3.5 Fixtures and cases

All with `UDG-003-*` ids, catalogued with pinned digests:

| Group | Cases |
| --- | --- |
| ordering (`UDG-003-ordering-*`) | traces **T-1 … T-8** from P03-e; the executable 5.5 subset — O02 (both arrival orders), O06 (missing frame then same-generation resume), O07's route-free half (invalid MoveTo refused, `H` unchanged), O09 (reconnect epoch 8 with an epoch-7 backlog), **O12 with input decided first and the completion then rejected as obsolete** — plus permutation runs recording every arrival permutation that changes eligibility, including a permutation where a keepalive is the oldest queued observation ahead of a direct frame |
| admission (`UDG-003-admission-*`) | gap 64 admissible / 65 refused `RESYNC_REQUIRED` with unchanged `H`; below-`H` `SUPERSEDED`; equal-generation intention `INVALID_GENERATION` both within and across ticks; **equal-generation discrete request with a fresh id refused whatever the latched kind**; generation-zero rules; `GENERATION_MAX` admitted as a value with a further increment refused; wire values above the domain `INVALID_GENERATION`; kind latching and `G_d` clearing; **keepalive metadata invariance (T-5)** |
| neutral (`UDG-003-neutral-*`) | missing frame, keepalive, release, refused frame counted as neutral, **all-invalid input**, **cache-hit-only tick**, **screened-refusal-only tick** — each asserting exactly one step and unchanged intention metadata (T-7) — and "no horizontal hold after the last direct tick" |
| queue (`UDG-003-queue-*`) | **T-6** FIFO selection under a burst; non-selected frames remain queued and are not recorded as losers; purge after a competing discrete commit refuses the stale backlog without extra steps or drive; overflow at 32 refuses newest with `RATE_LIMITED`; queue depth and remaining ordinals reconstructed from the journal |
| abuse (`UDG-003-abuse-*`) | 100-frame burst in one tick; sustained 40 fps for 60 s; payload over 1024 bytes; 65 queued discrete operations in a room; 9 for one entity; unknown message name; unsupported join version; wrong `configHash`; disallowed origin; non-loopback bind without the opt-in. Every offender case asserts the observer's state and trace are untouched, and records dropped/refused counts **by reason** |
| lifecycle (`UDG-003-lifecycle-*`) | disposal mid-tick; entity removal with queued input; epoch renewal; cache eviction then stale replay still refused; reconnect retains one idle entity; lifecycle observed after the cutoff deferred to the next tick |
| journal (`UDG-003-journal-*`) | replay reproduces digests **and** decisions from inputs alone; a journal with every digest stripped must still replay; a malformed-input journal must replay; a prologue mismatch is refused; mutation of a decoded SDK instance after intake does not alter the journal; screened refusals are recorded as refusals, never as arbitration losses |
| reference (`UDG-003-reference-*`) | the 200-tick 40 m flat trace, diagonal speed bounded at 0.2 m per tick, labelled reset segments excluded from the calculation |

Route-dependent cases are **deferred, not faked**: O01, O03, O04, O05, O08, O10 and O11 all need a route or a navigation completion, and in UDG-003 no route can exist because every `UDG_MOVE_TO` is refused. The assignment states that in its acceptance section and proves the refusal instead; O03's *cutoff* mechanic is still exercised through a journal-level completion stub, which needs no navigation. A synthetic route invented to make those cases green would cheapen Gate C's later evidence.

### 3.6 UDG-001 / UDG-002 compatibility amendments

Each amendment is invariant-preserving and keeps a **live** demonstration that the rule still refuses something. These are the checks that turn red the moment UDG-003 legitimately installs a dependency or fills a workspace, so they are scheduled, not improvised:

| ID | Current text | Why it becomes false | Amendment (invariant kept) |
| --- | --- | --- | --- |
| A-1 | `tests/contracts/UDG-001.test.ts` asserts `lockfile.includes('@colyseus/core' / '@colyseus/sdk' / '@colyseus/testing')` is `false`, unconditionally | a selected dependency legitimately appears | make the lockfile check status-aware, mirroring the installed-graph assertion beside it: allow only names a **selected** group names; keep refusing every other deferred scope and keep refusing a not-selected group's own names. Kept live by a synthetic register that selects `@dimforge/rapier3d-compat` while its owner task is Not Started → still refused |
| A-2 | `DEFERRED_GAME_LIBRARIES` names `@colyseus/core`, `@colyseus/sdk`, `@colyseus/testing` | the pinned set also contains `@colyseus/ws-transport` (and `express` transitively) which no group names — and today's refused-prefix list would admit `@colyseus/ws-transport` **silently**, a coverage hole, not a convenience | extend the `@colyseus/core` group to `['@colyseus/core', '@colyseus/ws-transport']` (the "server runtime" set [colyseus.md 6.1](../integration/colyseus.md) requires be pinned), record `express` as a transitive runtime dependency with its licence, and widen the refused-prefix loop to the `@colyseus/` scope minus selected names. Derivation stays graph-derived |
| A-3 | `IMPLEMENTED_WORKSPACES` is hard-coded to `@udg/protocol`/`@udg/config`, both mapped to `UDG-002.md` | `@udg/server` legitimately gains exports, and the shape cannot express a third implemented workspace | derive `package → owning task contract` from the existing `WORKSPACES` table, still **contract-driven**: only a contract that no longer says Not Started unlocks exports, and only the documented entry points. Keep the synthetic-tree demonstration that an unstarted workspace declaring exports still fails |
| A-4 | `readContractEntryMap()` reads exactly `docs/contracts/protocol-v1.md` | `@udg/server`'s delivered surface belongs to `docs/integration/colyseus-0.18-api-map.md`, not the protocol record | collect `<!-- entry-map:begin/end -->` blocks from a declared list of delivered-API records with the same table grammar and normalisation; "implemented but documents no entry points" still fails; a drifted block still throws |
| A-5 | `readCatalog()` treats every `UDG-*` directory under `tests/fixtures/` as a protocol message fixture and validates it with `validateProtocolFixture` | UDG-003's fixtures are multi-row scenarios (ordering permutations, abuse traces, journal replays), not single-message validation cases | dispatch on a declared `kind`: existing protocol kinds unchanged, plus declared UDG-003 kinds with their own required fields (case id, arrival-ordered input rows, expected decisions and codes, tick origin, bounds provenance). Unknown `kind` refuses; the `UDG-\d{3}-` id rule stays; the new kinds are digest-pinned like the existing ones; **no UDG-002 fixture digest changes** |
| A-6 | `CAPTURE_PLANS` has UDG-001 and UDG-002 only, and `capture()` throws for any other task | capturing a UDG-003 bundle would refuse | add the UDG-003 plan: commands, required artefacts (§3.8), `measurements/UDG-003.json`, the task-scoped `UDG_EVIDENCE_OUT`/`UDG_EVIDENCE_TASK` rule and the child-env stripping preserved. `EVIDENCE-THRESHOLD-UNMEASURED` stays, so every threshold must be produced by a real test |
| A-6b | `PACKAGE_RULES['@udg/server']` permits Colyseus generally | the contract wants SDK hooks discovered in the adapter and listed in the api-map, yet nothing today stops an SDK import from anywhere in the server | one rule: `@colyseus/*` may be imported from `apps/server/src/{rooms,network,movement}/**`, from `@udg/protocol/schema`, **and from `apps/server/probes/**`** (the discovery surface); every other server module reaches SDK behaviour through those. Positive and negative boundary fixtures for all three allowed positions and one refused position; rule-table digest change recorded |
| A-7 | CI has no probe step and no UDG-003 step | the contract requires compiled probes; the suite requires CI proof | add a real "Run the server/SDK compile and runtime probes" step and a "Run the UDG-003 task suite" step before the evidence tail. Nothing in the UDG-001 workflow suite inspects step *content*, so an echoing probe step would pass silently — which is exactly why the probe step is covered by AC-10/AC-11 instead. The asserted invariants survive: four evidence steps by name with `!cancelled()`, no `continue-on-error` anywhere, artefact upload errors on missing files, and the failure-mapping test still failing the job for every required step |
| A-8 | `UNAVAILABLE_SUITES` guards `test:e2e`, `test:spike`, `assets:build`, `assets:verify` | unchanged by UDG-003 | no change; the suite must still show that at least one contract task lacks a suite and that its command exits 2 with an attributed reason |
| A-9 | status sentences in `tests/AGENTS.md`, `apps/server/AGENTS.md`, `tools/checks/AGENTS.md`, README | they become untrue when the task lands | describe what exists and who created it under which grant, keep naming what still does not exist (`tests/e2e`, `tests/spikes`, the asset pipeline, the load-test harness), and keep every operative rule and scope limit intact |
| A-10 | `docs/contracts/checksums.json` | `UDG-003.md` status and edited contract text change | regenerate with `pnpm contracts:checksums -- --write`; record the entry count; hand-editing stays forbidden |

Expected to keep working **unchanged**: `test:unit`'s "no longer guarded" assertion, the evidence fail-the-run rule, `EVIDENCE-GATE-NOT-PASS`, machine-path aliasing, CI step invariants, and the register's host-independence behaviour. If one of them has to move for a reason not listed here, that is a finding to raise, not a detail to adjust quietly.

### 3.7 Acceptance criteria (measurable)

Numbers come from [acceptance-gates.md 7.3](../validation/acceptance-gates.md); each is produced by a named test and lands in `measurements/UDG-003.json`, which `EVIDENCE-THRESHOLD-UNMEASURED` protects.

| AC | Condition |
| --- | --- |
| AC-1 | 200 valid direct ticks produce the specified 40 m flat trace within `1e-6 m` in pure simulation, labelled reset segments excluded |
| AC-2 | every tick's horizontal desired displacement ≤ `0.2 m + 1e-6 m`, across the whole suite including bursts |
| AC-3a | **consumption**: for every tick, continuous observations consumed per entity ∈ {0, 1} — the FIFO-selected one, if any — and locomotion steps equal the number of connected entities exactly once each, under a 100-frame burst, under sustained 40 fps, under an empty queue and in every no-winner branch. Non-selected eligible frames are neither consumed nor refused at selection, and a purge never produces a step |
| AC-3b | **bounded queues**: sampled queue depth never exceeds 32 frames/client, 64 queued discrete operations/room, 8/entity; terminal cache ≤ 128 records and ≤ 30 s; reported from `buffer-depth.csv` with high-water marks |
| AC-3c | **bounded displacement**: as AC-2, re-asserted per tick over the abuse population so a burst cannot buy extra travel per tick |
| AC-3d | **replay equivalence**: replaying the recorded accepted/consumed input sequence reproduces identical canonical state digests **and** identical admission/rejection decisions in the same runtime |
| AC-3e | **honest reporting**: dropped and refused frames are reported separately by reason (`overflow`, `superseded`, `epoch`, `structural`, `rateLimited`) in `abuse-results.json` and in per-tick rows. The suite asserts nothing about total travel under a burst versus a one-per-tick spread — a burst drops frames, so travel legitimately differs, and asserting equality would require applying several frames in one tick, which is prohibited |
| AC-4 | removing input yields zero horizontal desired displacement **on the next tick** and `idle`, `y` unchanged, heading preserved |
| AC-5 | stale route activations, duplicate movement commits and old-epoch accepted frames each count **exactly zero** |
| AC-6 | the stage sequence F, L, Q, S, A, C, R, X, M, P holds for every executed 5.5 case and every recorded eligibility-changing arrival permutation |
| AC-7 | an offender's malformed message produces no crash, no observer-visible state change and no observer trace difference |
| AC-8 | every `UDG_MOVE_TO` is refused in **screening** — `NAVIGATION_BUSY`, or `OUT_OF_BOUNDS`/`INVALID_DESTINATION` for a destination outside the validated volume — never entering arbitration, never changing `H` and never latching `path`; `routeRevision` 0 throughout, no `path` candidate is ever constructed, and no `UDG_ROUTE_STATUS` is emitted |
| AC-9 | startup and lifecycle: AC-13's refusals all hold; disposal stops ticks and releases sessions with no post-dispose write |
| AC-10 | the probe modules compile under `skipLibCheck: false` with no `any`, no cast-to-unknown, no `@ts-ignore`, no private path (`@colyseus/core/build/…`) and no private SDK field; a scan proves it, and lint's `no-explicit-any` is already an error |
| AC-11 | every API the shipped code uses has an api-map row with a probe path and a runtime test id, and unused V1/V2 names have rows saying "not used, and why"; PR-8's acknowledgement finding is recorded with its experiment output, and if it shows received/applied cannot be distinguished the finding is escalated (D-7) rather than restated as satisfied |
| AC-12 | probes are typechecked by the typecheck command and executed from the build output; the suite builds before asserting, and a measurement records that ordering |
| AC-13 | startup refuses: absent bounds file, malformed bounds, inverted axis range, unknown key, world/region identity mismatch with room configuration, non-finite bound, synthetic bounds without the opt-in (§4) |
| AC-14 | journal rows carry the input, lifecycle and ordering fields of P03-g — a journal of state digests alone fails the schema test |
| AC-15 | root commands green locally **and** in CI on the pushed submitted commit; both bundles verify `PASS`; the UDG-001 and UDG-002 suites pass at the new head and every retained bundle still verifies (§5) |
| AC-16 | **keepalive invariance (T-5)**: for every consumed `directIntent: false` frame, `H`, `latchedKind` and `G_d` are unchanged and `horizontalDrive` is `NONE`; the initial neutral generation-zero frame leaves `H = 0` with `latchedKind = none`; and `direct gN → keepalive gN → direct gN` resumes the held direct intention at the same generation, stepping exactly once per tick |
| AC-17 | **queue policy (T-6)**: only the FIFO-selected observation is consumed; every other eligible frame stays queued with its ordinal recorded; a purge refuses stale backlog with the correct code and produces zero steps and zero drive; no frame is refused twice; per entity per run the disposition counters reconcile to `consumed + refused + answered + queued == observed` |
| AC-18 | **no-winner branch (T-7)**: missing, all-invalid, keepalive-only, cache-hit-only and screened-refusal-only ticks each step the connected entity exactly once with neutral horizontal input and unchanged intention metadata, and no code path dereferences an absent winner (asserted by a unit test over each branch, not inferred) |
| AC-19 | **identity completeness (T-4, T-8)**: intra-batch identical retries share one disposition, one record and one publish; same-id/different-payload gives `REQUEST_ID_CONFLICT` without overwriting the cached identity; a fresh id at `generation == H` is refused `INVALID_GENERATION` whatever the latched kind; terminal **refusals** are cached and replayed identically; an unparsable `requestId` creates no cache record |
| AC-20 | **replay sufficiency**: a journal with every digest stripped still replays to the same decisions and states, a malformed-input journal replays, and replay uses only prologue state, validated configuration and observation payloads — never a digest or candidate summary as an input |

Not claimed by UDG-003 and not to be marked passed: Gate A itself (needs UDG-004 and UDG-SPIKE-001), the 0.15 m correction gate (needs a client), collision and penetration (UDG-006), route traversal and query CPU (UDG-007), and every P10 threshold.

### 3.8 Required evidence

Per [evidence-requirements.md 19.1](../validation/evidence-requirements.md) and the contract: `traces/ticks.jsonl`, `traces/inputs.jsonl`, `traces/journal.jsonl` (all P03-g row types), `traces/room-lifecycle.jsonl`, `metrics/buffer-depth.csv`, `metrics/abuse-results.json`, `metrics/probes.json`, `metrics/tick-metrics.csv`, the api-map copied as an artefact, plus `report.json`, `environment.json`, `commands.json`, `junit.xml`, `checksums.sha256`, sanitised logs and `measurements/UDG-003.json`. `assets/` stays empty and is explained in the plan's waiver list (no region asset exists; D5). A sanitised summary with digests is committed as `docs/contracts/assignments/UDG-003-evidence.json`.

Inherited without renegotiation: capture injects `UDG_EVIDENCE_OUT` and `UDG_EVIDENCE_TASK` and only the owning task's suites write artefacts; child spawns never inherit an evidence destination; raw bundles stay out of Git; runner logs stay in durable storage; a local summary never claims CI reproduction; the submission stays In Review until the reviewer accepts; Gate A is signed only by the integration owner at UDG-SPIKE-001.

## 4. Starting the server with explicitly supplied, validated region bounds — no UDG-007 dependency

`@udg/config` already ships the right shape: `DEFAULT_REGION_CONFIG` carries `bounds: null`, no production default exists anywhere, and `requireRegionBounds` fails by name, saying bounds are supplied by the region asset (UDG-007) and validated at startup (UDG-003). UDG-003 is that validation point.

1. Read `UDG_REGION_BOUNDS_PATH` — **required**, no embedded default. Absent is a startup error, not a fallback.
2. Parse and validate: `validateServerConfig` for the document plus `validateRegionBounds`/`configBounds` for `{worldId, regionId, bounds: {x:{min,max}, y:{min,max}, z:{min,max}}}` — exact keys, finite numbers, `min < max` per axis, bounded printable-ASCII identifiers.
3. Identity check against room configuration: a document naming a different `worldId`/`regionId` is refused, or the room would serve one region's geometry under another region's name.
4. Publish `configHash`, `movementHash`, `regionHash`. `computeConfigHash` covers the whole `ServerConfig` including `region`, so a room started **with** bounds advertises a `configHash` different from the bounds-null default `948f8c10fc40…`. That is correct, not drift, and the record says so; UDG-002's suite keeps asserting the default digest over `DEFAULT_SERVER_CONFIG`.
5. Provenance gate: while no asset pipeline exists the document must carry `"provenance": "test-only-synthetic"`, and the server refuses a synthetic document unless `UDG_ALLOW_SYNTHETIC_REGION=1` is set. Production-shaped startup cannot silently inherit fixture geometry. The label propagates to `environment.json`, the journal prologue and the bundle.
6. `manifestHash`: joins require 64-hex and no asset manifest exists. Proposed: `canonicalHash({ kind: 'udg-synthetic-manifest', label: 'test-only-synthetic', worldId, regionId, bounds, navmesh: 'absent' })`, named in the api-map and README as **not an asset manifest**. `validateJoin`'s hash rule is satisfied, `ASSET_MISMATCH` stays meaningful, and UDG-007 changes one value.
7. Bind and origin policy: loopback only unless an explicit allow-list is configured; a non-loopback bind without it is refused at startup. Ports and shutdown are documented in README.
8. Join checks then behave as [protocol.md 4.2](../interfaces/protocol.md) says: exact `PROTOCOL_VERSION` (`PROTOCOL_MISMATCH`), `configHash` (`CONFIG_MISMATCH`), `manifestHash` (`ASSET_MISMATCH`); world/region come from server room configuration; `entityId` is server-assigned and never trusted from a movement payload. Movement is additionally bounded by `isInsideBounds` against the validated volume, so a destination outside it reports `OUT_OF_BOUNDS` before any `NAVIGATION_BUSY` refusal, and a disallowed spawn origin is refused at join.

The only UDG-007 dependency is the *absence* of real bounds, expressed as a required input plus a provenance label — no import, no path assumption, no `assets/` fixture, no `assets/` claim. `pnpm assets:build`/`assets:verify` stay guarded.

## 5. Keeping UDG-001 and UDG-002 valid as the project grows

| Rule | Meaning for UDG-003 |
| --- | --- |
| R-1 accepted evidence is immutable | no edit to `docs/contracts/assignments/UDG-00{1,2}-evidence.json`, to a completion record's recorded digests, or to any retained bundle. New facts go in new records |
| R-2 no silent digest change | UDG-003 must not change `configHash`/`movementHash` semantics. *(Dated note, 2026-11-11: the owner has since authorised a **deliberate and disclosed** `configHash` change for the ADR-0003 envelope values — see [UDG-003-phase-2.md §6](UDG-003-phase-2.md). The prohibition this row states is on a **silent** change, and it stands untouched.)* Keeping abuse limits out of `ServerConfig` (D-4) is what keeps `948f8c10fc40…` and `c80f61d451ea…` true. A deliberate digest change needs owner review, an amended record and a fixture rerun |
| R-3 amendments preserve invariants | only §3.6's, each keeping a live refusal demonstration. "Byte-stable UDG-001 suite" is not the requirement; "the suite still refuses what it used to refuse" is |
| R-4 fixture digests are additive | UDG-002's catalogued fixtures keep their pinned `sha256`; UDG-003 only adds entries. `pnpm test:fixtures` must still refuse an unrecognised layout and a stale digest |
| R-5 historical chain, not a terminal hash | records cite the durable-store inventory **chain** (v2 onward, appended by version) and never a tip hash as a promise, because each append embeds its predecessor's hash and the version documenting a commit's own CI run cannot exist inside that commit. The current tip is read from the store (`/workspace/udg-evidence/inventory-v<max>.json`), never asserted from a record. Everything is still on one host, so D4 stays open |
| R-6 verify, don't assert | the completion record lists the retained-bundle verification run, including that the deliberately-red counterexample bundles still refuse with `EVIDENCE-GATE-NOT-PASS` |
| R-7 CI on the pushed commit | local green is not submission; CI must be green on the exact pushed head and both bundles download-verify before In Review is claimed |
| R-8 status truth | UDG-003 stays In Review until the reviewer accepts; Gate A stays **Not Run**; encoding widths stay provisional under ADR 0001 until Gate A; D4 stays undesignated and UDG-003 provisions no storage |
| R-9 boundaries hold | no `@colyseus/*` import in `@udg/protocol`'s domain/validation/mapping (the checker already refuses it, and `@udg/protocol/schema` stays the only schema runtime path); `@udg/config` imports neither Node builtins nor browser APIs; `apps/server` never imports `@udg/client` |
| R-10 name the file each digest hashes | revision 1 collapsed the contracts index and the UDG-002 task contract into one row. Every pinned digest names its file **and** the revision it describes, and where a file has legitimately moved since (a status line at acceptance), both the historical value and the current one are recorded rather than reconciled by rewriting history |

## 6. Genuine owner decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| D-1 | **Adopt P03** as §1 drafts it — cutoff before any tick work with lifecycle inside the frozen set; the F/L/Q/S/A/C/R/X/M/P stages; screening that never rejects a potential winner before arbitration, with FIFO selection of at most one continuous observation and a post-commit purge of the stale backlog; intention kinds limited to direct/cancel/path with **keepalive as an observation that changes no intention metadata**; the neutral no-winner branch; discrete admission strictly above `H` with identity answered first from the persistent cache and the frozen-batch registry, terminal refusals cached, and conflicts never overwriting a cached identity; the cleared-`G_d` rule so an obsolete held generation cannot bypass `H`; `GENERATION_MAX` accepted as a value with increments refused; the neutral rule; the multi-stream journal whose replay reconstructs decisions from inputs; and P03-h's resolutions — and record it in [adoption.md](adoption.md) with the contract hash. This satisfies scope.md's "P03 before UDG-003 Ready" | Adopt as drafted; no ADR (it elaborates v0.2 §5 rather than changing it). G-9's doc-comment note travels with it |
| D-2 | **Approve the pin set in §2.1 as proposed and provisional**, with PR-0/PR-1 establishing resolution and PR-2…PR-12 establishing API compatibility, and with the phase-0 failure consequence: a failed PR-0/PR-2/PR-3 ends the task with a blocker and an ADR proposal, and does **not** authorise relaxing `skipLibCheck`, using a private path, or writing a hand-rolled tick loop | Approve, with the explicit understanding that registry metadata is not compatibility evidence |
| D-3 | **How does UDG-003 get a client for the real transport smoke run?** A-1 refuses any `@colyseus/sdk` entry in the lockfile, and the SDK's register group is owned by UDG-SPIKE-001, which is Not Started, so a smoke client fails the UDG-001 suite until the owner moves that ownership. (a) select `@colyseus/sdk` with the group's `ownerTask` moved to UDG-003 and its reason stating that transport smoke only is proven here, prediction remaining UDG-SPIKE-001's; (b) `@colyseus/testing`, whose peers drag in the SDK **and** `@colyseus/tools`, needing (a) plus another package; (c) no real client — server-side harness only, transport-level client evidence deferred to UDG-SPIKE-001, weakening "a real server smoke run" | (a), with `@colyseus/testing` unselected. Gate A keeps its meaning because SPIKE-001 still owns the prediction proof. (c) is the fallback if untouched group ownership matters more than the smoke run |
| D-4 | **Where do the abuse limits live?** Payload 1024 B, 64/room, 8/entity, 40 fps with burst 40 are server policy. In `ProtocolLimits` they would enter `configHash`, changing UDG-002's frozen default digest and telling clients that server deployment policy is shared simulation config | Keep them in `apps/server/src/server-config.ts` as validated, documented, pinned runtime policy with their own digest in evidence, **outside** `configHash`. Making them client-detectable through `configHash` would be a separate, explicit `ProtocolLimits` decision with an amended UDG-002 digest record |
| D-5 | **Synthetic region mechanism** (§4): required `UDG_REGION_BOUNDS_PATH`, mandatory `"provenance": "test-only-synthetic"` label, explicit `UDG_ALLOW_SYNTHETIC_REGION=1` opt-in, derived synthetic `manifestHash` documented as not-an-asset-manifest | Approve as drafted. It keeps D5's "no production defaults", makes fixture geometry un-mistakable in evidence, and gives UDG-007 a one-value swap |
| D-6 | **Tooling grant list** G-1…G-9 (G-10 withdrawn) with §3.6's amendment schedule, including A-5's fixture-kind dispatch, A-6's capture plan, A-6b's SDK-import isolation rule including the probe tree, A-1/A-2's register corrections, and whether the assignment is one task or split at the phase-0 boundary | Approve as one assignment with §3.2's phases as hard stops. Each grant names its file and its limited purpose; no grant widens functional scope; G-9 is documentation-only |
| D-7 | **Conditional — acknowledgement truthfulness, decided from evidence.** If PR-8 shows the pinned acknowledgement cannot distinguish frames received from frames applied, does the owner accept a documented API-visibility limitation (application journal as the authority record, the prohibition on acknowledging never-represented frames enforced at the UDG layer), or require the contract's documented equivalent with a bounded offender disconnect and a bounded-memory proof? | Decide from the probe output, never in advance, and never as a pre-approved waiver. Recording a counter as proof of a truthful acknowledgement is not an acceptable third option |

## 7. Routine choices recommended (no decision needed, recorded so a reviewer can disagree)

| Choice | Reason |
| --- | --- |
| at most one continuous frame consumed per entity per tick, oldest admitted first; drop-newest on overflow | preserves arrival order, cannot resurrect stale input, matches "never drain then simulate the last frame" |
| `entityId` order by plain `<` on printable-ASCII identifiers, `localeCompare` banned | entity ids come from `ASCII_IDENTIFIER` (printable ASCII ≤ 64, `MAX_IDENTIFIER_LENGTH`) and are server-assigned, so code-unit order is code-point order and host-independent; `requestId` is the narrower `[A-Za-z0-9_-]{1,64}` and is never used as an ordering key |
| keepalive excluded from arbitration entirely | it asserts no intention, so it is neither a candidate nor a loser; treating it as a ranked kind would let a keepalive consume an intention slot or, worse, alter `latchedKind` |
| `latchedKind`/`G_d` separated from `movementMode` | O06 needs "mode idle now, same direct generation may resume next tick" without letting an obsolete generation beat a newer cancel |
| `canonicalHash` from `@udg/config` for state digests | one canonical-JSON implementation, already Verified; `@udg/server` may import `@udg/config` |
| SDK-touching probe code in `apps/server/probes/**`, contract-named wrappers in `tests/probes` and `tests/reference` | resolution follows the importing file's directory, and the contract's named paths stay meaningful (no root tsconfig change) |
| buffer-depth assertions on **counts**, heap figures informational | byte thresholds on shared runners are flakes; P10 owns numeric thresholds |
| smoke server on `127.0.0.1` port 0 | runner-safe and still a real transport; README documents the manual default port |
| no physics, navigation, client rendering, persistence or identity service | excluded by UDG-003's contract; the flat reference is a spike reference, not UDG-005's locomotion |

## 8. What this revision does not do

It adopts nothing, assigns nothing, installs nothing, starts nothing and moves no gate. UDG-003 stays **Not Started** and unassigned until the owner records P03 adoption (D-1) and pins an assignment; Gates A, B and C stay **Not Run**; D4's independent backup destination stays undesignated with the risk recorded as open. If D-1…D-6 are approved, the next deliverable is the pinned UDG-003 assignment record built from §3 — and no code before that.
