# UDG-003 readiness proposal — revision 2

Status: **proposal, revision 2 — awaiting the owner's decision. Nothing here is adopted, assigned or approved, and no gate has moved.** P03 stays Pending, UDG-003 stays Not Started and unassigned, Gates A/B/C stay **Not Run**, and D4's independent backup destination stays undesignated.

Revision 1 was published at `d7b3127f984370d6faa29308de147876e254728c` (base `d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4`) and CI-green at run `42641249067`. This revision responds to the owner's six review points:

| Point | Where it is resolved |
| --- | --- |
| Cutoff before any tick work; lifecycle first **inside** the frozen set; post-cutoff events wait | P03-b, and the stage list in P03-c now agree |
| One generation/intention algorithm; admission must not reject the eventual winner before arbitration; obsolete held generation; cached replay after `H` advances; `GENERATION_MAX` accepted as a value while a further increment is refused | P03-d (pseudocode) + P03-e (traces) |
| Burst criteria no longer claim equal total travel; acknowledgement truthfulness is proved or escalated | AC-3a…AC-3e, P03-f, PR-8 |
| Probe modules must live in the workspace that owns the dependency; typecheck and emit are separate commands | §3.4, and grant G-10 is **withdrawn** |
| Assignment scope reconciled: fixtures, unit/tooling tests, probe build config and output, evidence summary, records, and a journal that can actually replay | §3.3, §3.5, §3.8, P03-g |
| O12 direction, digest mislabels, identifier domain, provisional pins | P03-c stage R, §3.1, P03-c stage X and §7, §2.1/§2.2 |

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
- Admission state (`H`, `latchedKind`, `G_d`, queues) is mutated only between stages C and F of the tick, and only by the code in this file. Handlers on the transport side validate and enqueue; they never move a player.
- An asynchronous completion observed after the cutoff cannot activate in `T` (case O03). UDG-003 cannot generate one because navigation is absent, so it is exercised through a journal-level completion stub rather than a real query.
- `cutoffOrdinal` is journaled every tick (P03-g). Order is never inferred from client timestamps or promise scheduling.

### P03-c The tick, stage by stage

One tick runs these stages in this order, and this is the list P03-b agrees with:

| Stage | Work | Source |
| --- | --- | --- |
| **F** | freeze `cutoffOrdinal` and snapshot `eligible(T)`; nothing else may observe the live queue afterwards | 5.1 |
| **L** | apply lifecycle from the frozen set: disconnect, expiry, epoch change. Old-epoch queued observations and queues of a departed entity are dropped and recorded. An entity retained across a reconnect stays idle | 5.1 "connection lifecycle always prevents old-epoch movement" |
| **S** | **screen** every application operation in the frozen set: structural validation, epoch equality, request-identity cache lookup, window pre-check. **Screening never advances `H`, never latches a kind, and never rejects an operation that could win arbitration** — losers are decided in stage A | 5.1, 5.2, 4.3 |
| **A** | **arbitrate** per entity over the surviving candidates: newer generation first, then kind precedence `directIntent true → explicit cancel → path activation → keepalive`, then lowest `arrivalOrdinal` within one kind. Losers are rejected here, with the code their relation to the *winning* decision gives them | 5.2 |
| **C** | **commit** the single winner: advance `H` if and only if the winner's generation is above it; latch the kind; take at most one continuous frame; reserve the request-id cache slot for a discrete winner | 5.2 |
| **R** | commit eligible **route completions** only after the input decision is committed. A completion whose generation no longer equals `H`, or whose kind is not the latched kind, is discarded with a terminal `SUPERSEDED`. Input is decided first; the completion is then found obsolete — that is O12, and the direction matters | 5.1, O03, O04, O12 |
| **X** | step each connected entity exactly once, in ascending `entityId` order using plain `<` on the identifier string. Entity ids are printable ASCII (`ASCII_IDENTIFIER`, ≤ 64) and server-assigned, so code-unit order is code-point order and is host-independent; `localeCompare` is banned in this path | 5.1, 4.4 |
| **M** | map canonical state to the replica, including the `routeRevision`/`nextWaypointIndex` 0 sentinels | 4.4 |
| **P** | publish terminal results, then metrics, then flush the tick's journal rows | 4.3, 19.1 |

**State, precisely.** Two pieces must not be conflated, or O06 becomes unprovable:

- `H` — highest **admitted** generation; `latchedKind` — the kind of that admitted intention; `G_d` — the generation of the *current direct intention*, which exists only while `latchedKind == direct` and is cleared the moment another kind is committed.
- `movementMode` — the replicated mode (`idle`/`direct`/`path`), derived per tick from what was actually consumed: a nonzero `directIntent: true` frame drives `direct`; a release, a keepalive, a refused frame or no frame at all yields `idle` horizontal behaviour, while `latchedKind` and `G_d` stay as they were so the same direct generation can legitimately resume (O06).

Two consequences are stated because they are the ones a rewrite gets wrong:

1. kind precedence **overrides** arrival order (O02: same generation, either arrival order, direct wins), and within one kind arrival order decides;
2. different real arrival orders may legitimately produce different intermediate ticks. [movement-authority.md 5.5](../interfaces/movement-authority.md) forbids claiming global determinism independent of network arrival, and the UDG-003 suite must not assert it.

### P03-d Generation admission — one algorithm

Per entity/epoch the server holds `H`, `latchedKind`, `G_d`, queues and the request cache. The whole rule is this algorithm; there is no second place where generations are decided.

```text
// stage F — freeze
cutoff = arrivalCounter                       // first statement of step(T)
elig   = snapshot of queued items with arrivalOrdinal <= cutoff

// stage L — lifecycle inside the frozen set
apply(elig.lifecycle: disconnect | expiry | epochChange)
drop every queued item whose sessionEpoch != entity.epoch, recording EPOCH_MISMATCH

// stage S — screening: NO H mutation, NO kind latch, NO winner rejection
candidates = []
for o in elig where o is an application operation:

  if o is a continuous frame:
      v = validateDirectFrame(o, { sessionEpoch: entity.epoch })       // protocol, order fixed
      if v fails:                             record(v.code); continue  // structural, no state change
      if v.generation <  H:                   record(SUPERSEDED);       continue
      if v.generation >  H and v.generation - H > 64:
                                              record(RESYNC_REQUIRED);  continue
      if v.generation == H and latchedKind != direct:
                                              record(INVALID_GENERATION); continue
      candidates.push({ kind: v.directIntent ? direct : keepalive,
                        generation: v.generation, ordinal: o.ordinal, frame: v })

  else:                                       // UDG_MOVE_TO | UDG_CANCEL_PATH
      v = validateMoveTo(o, ctx) | validateCancelPath(o, ctx)
      if v fails:                             record(v.code); continue
      hit = requestCache.get(entityId, entity.epoch, v.requestId)
      if hit exists:                          // BEFORE any generation test
          r = compareRequestIdentity(hit, { requestId: v.requestId, payloadHash: hash(v) })
          record(r.ok ? hit.terminalResult          // replay: recorded result, no movement, no H change
                      : REQUEST_ID_CONFLICT)        // different payload, no state change, no H change
          continue
      if v.generation <  H:                   record(SUPERSEDED);       continue
      if v.generation >  H and v.generation - H > 64:
                                              record(RESYNC_REQUIRED);  continue
      if v.generation == H and latchedKind != o.kind:
                                              record(INVALID_GENERATION); continue
      candidates.push({ kind: o.kind, generation: v.generation, ordinal: o.ordinal, request: v })

// stage A — arbitration. Arrival order decides only within one kind.
winner = candidates.sort((a, b) =>
             (b.generation - a.generation)                    // newer intention beats older
          || (precedence[a.kind] - precedence[b.kind])        // direct 0, cancel 1, path 2, keepalive 3
          || (a.ordinal   - b.ordinal)                        // first admitted wins within a kind
         )[0]
for loser in candidates except winner:
      code = (loser.generation == winner.generation) ? INVALID_GENERATION   // incompatible equal kind
                                                     : SUPERSEDED           // older intention lost
      record(code, loser)

// stage C — commit exactly one admitted intention
if winner.generation > H: H = winner.generation
latchedKind = winner.kind
G_d = (winner.kind == direct) ? winner.generation : cleared
consumedFrame = (winner.kind == direct) ? winner.frame : none      // at most ONE continuous frame per tick
if winner is discrete: requestCache.reserve(entityId, entity.epoch, winner.requestId, payloadHash)

// stages R, X, M, P — route completions, one step per entity, replica map, publish + journal
horizontalDrive = (consumedFrame exists and consumedFrame is nonzero) ? consumedFrame : NONE
```

- **Nothing that can win is rejected before arbitration.** Screening answers only "is this item usable at all, and is it in range"; stage A decides who wins; stage C is the first place `H` moves. Revision 1 mutated `H` during screening, which made whichever equal-generation operation arrived first the de facto winner — exactly the defect this revision removes.
- `H` never changes for a structurally invalid, old-epoch, rate-limited, cache-hit or excessive-gap operation, and never for a loser of arbitration.
- **A held direct generation cannot bypass `H`.** A continuous frame is admissible only when `generation == H` *and* `latchedKind == direct` (equivalently `generation == G_d`, because `G_d` exists only while the latched kind is direct), or when it opens a new intention above `H` within the 64 window. Equality with an obsolete `G_d` is not a category: after a newer cancel or path commits, `G_d` is cleared and any frame still carrying the old generation is below `H` → `SUPERSEDED`, never applied.
- **Kind latching across ticks:** an equal-generation operation whose kind differs from the latched kind is `INVALID_GENERATION` in the tick it arrives, so a late same-generation click cannot revive a route cancelled by direct input, and a late same-generation direct start cannot resurrect a cancelled path. Legitimate mode changes use a higher generation.
- Only the single consumed continuous frame can contribute to the tick; a keepalive wins nothing over an intention and contributes no movement; a release (`directIntent: true`, zero axes) is a direct sample that commits direct with zero horizontal drive.

`GENERATION_MAX` — value versus increment:

| Situation | Behaviour |
| --- | --- |
| an operation carrying `generation == GENERATION_MAX` (4 294 967 294) | a legal domain value; admitted under the normal rules above. UDG-003 does not treat the top of the domain as an error |
| a wire value above `GENERATION_MAX` (e.g. 4 294 967 295) | outside the generation domain → `INVALID_GENERATION` from the protocol validator; no `H` change. Epoch tops out one higher (`EPOCH_MAX` = `UINT32_MAX`); the two domains are distinct and neither wraps |
| a **new** intention while `H == GENERATION_MAX` | cannot be formed: `RESYNC_REQUIRED`, `H` unchanged, epoch renewal through the join lifecycle is required. No wrap to 0, ever |
| a held frame or cached replay at `generation == GENERATION_MAX` | admitted or answered normally; neither needs an increment, so neither is refused |

Revision 1 wrote "refuse at `GENERATION_MAX`", which conflated accepting the adopted value with permitting an impossible increment. Only the increment is refused.

### P03-e Worked traces

Every trace shows both arrival orders where order is claimed not to matter, and each becomes a named fixture (`UDG-003-ordering-t1` … `t4`) that the assignment can cite directly.

**T-1 / T-2 — equal-generation direct versus cancel, both orders (`H = 19`, kind `direct`, entity moving).**

| | order 1 | order 2 |
| --- | --- | --- |
| observed | `ordinal 300` direct g20 (`directIntent: true`, axes `1,0`); `ordinal 301` cancel g20 `req c1` | cancel g20 `req c1` first (`ordinal 300`); direct g20 second (`ordinal 301`) |
| screening | both candidates (g20 > `H`, gap 1 ≤ 64); **`H` untouched** | identical |
| arbitration | same generation → precedence: direct (0) beats cancel (1) → direct wins | identical |
| commit | `H = 20`, `latchedKind = direct`, `G_d = 20`, consumed frame = the direct frame | identical |
| loser | cancel g20 → equal generation, incompatible kind → `INVALID_GENERATION`, terminal `accepted: false, appliedTick: null, routeRevision: null` for `c1`, recorded once | identical |
| tick outcome | mode `direct`, one step, horizontal drive from the consumed frame | identical |
| journal difference | only the two `ordinal` values | only the two `ordinal` values |

**T-3 — a newer cancel, then an old held frame (`H = 24`, kind `direct`, `G_d = 24`).**

| | |
| --- | --- |
| observed at cutoff 402 | `ordinal 401` cancel g25 `req c9`; `ordinal 402` direct frame g24 (the stale held sample) |
| screening | cancel g25: above `H`, gap 1 → candidate. Direct g24: `== H` and latched kind is `direct` → candidate. Neither is rejected yet |
| arbitration | 25 > 24 → **cancel wins**; arrival order is irrelevant |
| commit | `H = 25`, `latchedKind = cancel`, `G_d` cleared, `consumedFrame = none` |
| loser | direct g24 → below the winning generation → `SUPERSEDED`; its vector is never applied and it is not re-queued |
| tick outcome | mode `idle`, zero horizontal drive, one step; `y` unchanged (no physics in this task) |
| next tick | a further frame still at g24 is `generation < H` → `SUPERSEDED`. There is no "equality with an obsolete `G_d`" path to bypass `H` or the newer cancel |
| to resume direct movement | the client must use a **higher** generation |

**T-4 — cached replay after `H` has advanced.**

| | |
| --- | --- |
| history | `req r7` at g30 was admitted long ago and terminalled (`NAVIGATION_BUSY` in UDG-003); the cache holds `(entityId, epoch, r7, payloadHash, terminalResult)`; `H` is now 34 |
| retry, identical payload | screening hits the cache **before** any generation test → the recorded terminal result is returned verbatim; no movement is reapplied, no second transition occurs, `H` stays 34, no second terminal record is emitted; the journal row carries `dedupe: cache` |
| retry, different payload | `REQUEST_ID_CONFLICT`; no state change, no `H` change, no new cache slot |
| retry after eviction (beyond 128 records or 30 s TTL) | no cache hit → generation admission: `30 < H = 34` → `SUPERSEDED`. An evicted id still cannot replay movement, which is the property [protocol.md 4.3](../interfaces/protocol.md) requires |
| retry with a stale epoch | the cache is keyed by epoch, so there is no hit; epoch equality refuses it, and old-epoch records stay inert diagnostics |

### P03-f Neutral input, queues and what "acknowledgement" may honestly claim

- No consumable frame for the tick means the entity steps `neutralDirectFrame` for the current epoch and held generation: horizontal desired displacement becomes zero **on that tick**, `movementMode` becomes `idle`, heading is preserved ([5.4](../interfaces/movement-authority.md)). No new intent is invented and no SDK acknowledgement is fabricated.
- A `directIntent: false` keepalive that passes validation consumes no movement and cancels nothing. UDG-003 has no path mode, so its observable effect matches neutral; the journal still distinguishes `keepalive` from `neutral` because the difference becomes load-bearing at UDG-007/Spike 003.
- Consumption is **at most one continuous frame per entity per tick**, oldest admitted first. Remaining frames stay queued up to 32 per client. A frame arriving at a full queue is refused `RATE_LIMITED`, counted, and never re-queued; drop-newest is the recommendation because it preserves arrival order and cannot resurrect stale input. Losers of arbitration are recorded with their code, contribute neutral input for that tick and are not re-queued. "Drain a burst then simulate only its last frame" and "move a character repeatedly to empty a queue" stay forbidden.
- **Acknowledgement is a separate claim from counting.** The adopted prohibition stands: frames never represented in state must not be acknowledged. Counting a refusal is *not* evidence that an SDK acknowledgement is truthful — a transport that acknowledges on receipt may acknowledge a frame UDG dropped. PR-8 must establish from installed declarations and executed behaviour what the pinned SDK's acknowledgement actually tracks (received vs applied), and how — if at all — the application can withhold or correct it through a public API. If no supported mechanism distinguishes them, that is recorded as an API-visibility limitation and **escalated**: whether the limitation, a documented equivalent, or the contract's bounded offender disconnect satisfies the requirement is the owner's call (D-7), not the implementer's. The app-level journal remains the truth record for what was applied.
- UDG-003 has no physics, so "vertical settling can still occur in idle" is **not** exercised here and must not be simulated by hand; idle assertions are horizontal-only with `y` unchanged. The vertical half belongs to UDG-006 and Gate B, reported in a separate population as [acceptance-gates.md 7.3](../validation/acceptance-gates.md) requires.

### P03-g Replay journal — enough to replay, not only to hash

The journal is the authority record and doubles as evidence; its vocabulary follows [evidence-requirements.md 19.1](../validation/evidence-requirements.md). A per-tick state digest alone cannot replay anything, so the journal records the **inputs, lifecycle and ordering decisions** as well as state, in joinable rows keyed by `(serverTick, arrivalOrdinal)`:

| Row type | Fields |
| --- | --- |
| `prologue` (once per run) | protocol version, `configHash`, `movementHash`, `regionHash`, region provenance label, tick origin, `dt`, patch interval, initial per-entity canonical state digest (`canonicalHash`), seeds, run id |
| `event` | `arrivalOrdinal`, alias, kind (`join`/`leave`/`expiry`/`epochChange`), epoch before/after, tick the event was *eligible* for |
| `observation` | `arrivalOrdinal`, eligible tick, alias, kind (`direct`/`keepalive`/`cancel`/`moveTo`/`unknownMessage`), epoch, generation, `directIntent`, raw axes as decoded, normalised axes, `requestId` (never a token), screening outcome and code, SDK frame identity where publicly observable else `null` with the recorded limitation |
| `intention` | tick, candidate summary as `(kind, generation, ordinal)` triples in arrival order, winner, every loser with its rejection code, `H` before/after, `latchedKind` before/after, `G_d` before/after, `cutoffOrdinal` |
| `tick` | `serverTick`, `cutoffOrdinal`, alias, consumed frame identity (`observation` ref or `none`), `inputSource`, mode before/after, `routeRevision`, desired and resolved displacement, rejection/result code |
| `result` | `requestId`, terminal `accepted`/`appliedTick`/`routeRevision`/`reason`, `dedupe` (`none`/`cache`), cache depth |
| `state` | per entity per tick: canonical state digest (position, yaw, velocities, grounded, verticalVelocity, mode, route fields, `intentGeneration`, `sessionEpoch`, `connected`, `lastAuthorityTick`) |
| `meta` | sampled queue depths, counters by reason (`overflow`, `superseded`, `epoch`, `structural`, `rateLimited`), buffer high-water marks |

- **Replay requirement:** `replay(prologue, event[], observation[])` must reproduce — in the same runtime — not only every `state` digest but every `intention` decision: the same winner, the same loser codes, the same `H` trajectory. A replay that reaches the same positions through different admissions has not proved the rule. A replay whose prologue hashes do not match the running configuration is refused outright, not partially compared.
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
| discrete path requests | contract-specific | refused `NAVIGATION_BUSY` **after** honest structural/epoch/generation/bounds checks: no `H` change (rejected before admission), no route mutation, `routeRevision` 0, one terminal record reserved for dedupe |
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
| this proposal, revision 1 | `d7b3127f984370d6faa29308de147876e254728c`, CI `42641249067`. Revision 2's own commit cannot be named here; `git log -- docs/contracts/assignments/UDG-003-readiness-proposal.md` is authoritative |
| **contracts index** — file `report.json.contractHash` hashes: `docs/contracts/README.md` | `255e7b2cb8fd64c41e2e5beb2a56b03bb62b08e0ca11089299d81a2e540a5943` (unchanged across the UDG-001 and UDG-002 editions) |
| **UDG-002 task contract** — file `report.json.configHashes.taskContract` hashes: `docs/contracts/UDG-002.md` | `d78ec67820faa4179a0141f4beb48a96dc20e33766bc724d629ffda8280d7c4b` at the reviewed edition; `25e44ba5…` at the correction-round head `9b04ee28`; `53a152fed391dc47e93c0c5d3013e787a84047ca45dbe52694214221b360d059` for the current file, whose status line changed when acceptance was recorded. Historical bundles keep the value their own report names; the file is never re-hashed backwards |
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
| ordering (`UDG-003-ordering-*`) | traces **T-1, T-2, T-3, T-4** from P03-e; the executable 5.5 subset — O02 (both arrival orders), O06 (missing frame then same-generation resume), O07's route-free half (invalid MoveTo refused, `H` unchanged), O09 (reconnect epoch 8 with an epoch-7 backlog), **O12 with input decided first and the completion then rejected as obsolete** — plus permutation runs recording every arrival permutation that changes eligibility |
| admission (`UDG-003-admission-*`) | gap 64 admissible / 65 refused `RESYNC_REQUIRED` with unchanged `H`; below-`H` `SUPERSEDED`; equal-generation incompatible kind `INVALID_GENERATION` both within and across ticks; generation-zero rules; `GENERATION_MAX` admitted as a value with a further increment refused; wire values above the domain `INVALID_GENERATION`; kind latching and `G_d` clearing |
| neutral (`UDG-003-neutral-*`) | missing frame, keepalive, release, refused frame counted as neutral, "no horizontal hold after the last direct tick" |
| abuse (`UDG-003-abuse-*`) | 100-frame burst in one tick; sustained 40 fps for 60 s; payload over 1024 bytes; 65 queued discrete operations in a room; 9 for one entity; unknown message name; unsupported join version; wrong `configHash`; disallowed origin; non-loopback bind without the opt-in. Every offender case asserts the observer's state and trace are untouched, and records dropped/refused counts **by reason** |
| lifecycle (`UDG-003-lifecycle-*`) | disposal mid-tick; entity removal with queued input; epoch renewal; cache eviction then stale replay still refused; reconnect retains one idle entity; lifecycle observed after the cutoff deferred to the next tick |
| journal (`UDG-003-journal-*`) | replay reproduces digests **and** decisions; a prologue mismatch is refused; mutation of a decoded SDK instance after intake does not alter the journal |
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
| AC-3a | **consumption**: for every tick, continuous frames consumed per entity ∈ {0, 1}, and locomotion steps equal the number of connected entities exactly once each — under a 100-frame burst, under sustained 40 fps, and under an empty queue |
| AC-3b | **bounded queues**: sampled queue depth never exceeds 32 frames/client, 64 queued discrete operations/room, 8/entity; terminal cache ≤ 128 records and ≤ 30 s; reported from `buffer-depth.csv` with high-water marks |
| AC-3c | **bounded displacement**: as AC-2, re-asserted per tick over the abuse population so a burst cannot buy extra travel per tick |
| AC-3d | **replay equivalence**: replaying the recorded accepted/consumed input sequence reproduces identical canonical state digests **and** identical admission/rejection decisions in the same runtime |
| AC-3e | **honest reporting**: dropped and refused frames are reported separately by reason (`overflow`, `superseded`, `epoch`, `structural`, `rateLimited`) in `abuse-results.json` and in per-tick rows. The suite asserts nothing about total travel under a burst versus a one-per-tick spread — a burst drops frames, so travel legitimately differs, and asserting equality would require applying several frames in one tick, which is prohibited |
| AC-4 | removing input yields zero horizontal desired displacement **on the next tick** and `idle`, `y` unchanged, heading preserved |
| AC-5 | stale route activations, duplicate movement commits and old-epoch accepted frames each count **exactly zero** |
| AC-6 | the stage sequence F, L, S, A, C, R, X, M, P holds for every executed 5.5 case and every recorded eligibility-changing arrival permutation |
| AC-7 | an offender's malformed message produces no crash, no observer-visible state change and no observer trace difference |
| AC-8 | every `UDG_MOVE_TO` is refused `NAVIGATION_BUSY` (after honest structural/epoch/generation/bounds checks), `routeRevision` 0 throughout, no `UDG_ROUTE_STATUS` emitted |
| AC-9 | startup and lifecycle: AC-13's refusals all hold; disposal stops ticks and releases sessions with no post-dispose write |
| AC-10 | the probe modules compile under `skipLibCheck: false` with no `any`, no cast-to-unknown, no `@ts-ignore`, no private path (`@colyseus/core/build/…`) and no private SDK field; a scan proves it, and lint's `no-explicit-any` is already an error |
| AC-11 | every API the shipped code uses has an api-map row with a probe path and a runtime test id, and unused V1/V2 names have rows saying "not used, and why"; PR-8's acknowledgement finding is recorded with its experiment output, and if it shows received/applied cannot be distinguished the finding is escalated (D-7) rather than restated as satisfied |
| AC-12 | probes are typechecked by the typecheck command and executed from the build output; the suite builds before asserting, and a measurement records that ordering |
| AC-13 | startup refuses: absent bounds file, malformed bounds, inverted axis range, unknown key, world/region identity mismatch with room configuration, non-finite bound, synthetic bounds without the opt-in (§4) |
| AC-14 | journal rows carry the input, lifecycle and ordering fields of P03-g — a journal of state digests alone fails the schema test |
| AC-15 | root commands green locally **and** in CI on the pushed submitted commit; both bundles verify `PASS`; the UDG-001 and UDG-002 suites pass at the new head and every retained bundle still verifies (§5) |

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
| R-2 no silent digest change | UDG-003 must not change `configHash`/`movementHash` semantics. Keeping abuse limits out of `ServerConfig` (D-4) is what keeps `948f8c10fc40…` and `c80f61d451ea…` true. A deliberate digest change needs owner review, an amended record and a fixture rerun |
| R-3 amendments preserve invariants | only §3.6's, each keeping a live refusal demonstration. "Byte-stable UDG-001 suite" is not the requirement; "the suite still refuses what it used to refuse" is |
| R-4 fixture digests are additive | UDG-002's catalogued fixtures keep their pinned `sha256`; UDG-003 only adds entries. `pnpm test:fixtures` must still refuse an unrecognised layout and a stale digest |
| R-5 historical chain, not a terminal hash | records cite the durable-store inventory **chain** (v2 → … → current), because each append embeds its predecessor's hash and the version documenting a commit's own CI run cannot exist before that commit. Current at time of writing: v10, 995 files, `cc05ab0776a68fc2e7462178e907ffc8dcc564224b8e85aea77770b90159eb44` |
| R-6 verify, don't assert | the completion record lists the retained-bundle verification run, including that the deliberately-red counterexample bundles still refuse with `EVIDENCE-GATE-NOT-PASS` |
| R-7 CI on the pushed commit | local green is not submission; CI must be green on the exact pushed head and both bundles download-verify before In Review is claimed |
| R-8 status truth | UDG-003 stays In Review until the reviewer accepts; Gate A stays **Not Run**; encoding widths stay provisional under ADR 0001 until Gate A; D4 stays undesignated and UDG-003 provisions no storage |
| R-9 boundaries hold | no `@colyseus/*` import in `@udg/protocol`'s domain/validation/mapping (the checker already refuses it, and `@udg/protocol/schema` stays the only schema runtime path); `@udg/config` imports neither Node builtins nor browser APIs; `apps/server` never imports `@udg/client` |
| R-10 name the file each digest hashes | revision 1 collapsed the contracts index and the UDG-002 task contract into one row. Every pinned digest names its file **and** the revision it describes, and where a file has legitimately moved since (a status line at acceptance), both the historical value and the current one are recorded rather than reconciled by rewriting history |

## 6. Genuine owner decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| D-1 | **Adopt P03** as §1 drafts it — cutoff before any tick work with lifecycle inside the frozen set; the F/L/S/A/C/R/X/M/P stages; the screening-then-arbitration-then-commit algorithm with a newer generation first, kind precedence over arrival order, and no rejection of a potential winner before arbitration; the cleared-`G_d` rule; cached replay answered before generation admission; `GENERATION_MAX` accepted as a value with increments refused; the neutral rule; the multi-stream journal; P03-h's resolutions — and record it in [adoption.md](adoption.md) with the contract hash. This satisfies scope.md's "P03 before UDG-003 Ready" | Adopt as drafted; no ADR (it elaborates v0.2 §5 rather than changing it). G-9's doc-comment note travels with it |
| D-2 | **Approve the pin set in §2.1 as proposed and provisional**, with PR-0/PR-1 establishing resolution and PR-2…PR-12 establishing API compatibility, and with the phase-0 failure consequence: a failed PR-0/PR-2/PR-3 ends the task with a blocker and an ADR proposal, and does **not** authorise relaxing `skipLibCheck`, using a private path, or writing a hand-rolled tick loop | Approve, with the explicit understanding that registry metadata is not compatibility evidence |
| D-3 | **How does UDG-003 get a client for the real transport smoke run?** A-1 refuses any `@colyseus/sdk` entry in the lockfile, and the SDK's register group is owned by UDG-SPIKE-001, which is Not Started, so a smoke client fails the UDG-001 suite until the owner moves that ownership. (a) select `@colyseus/sdk` with the group's `ownerTask` moved to UDG-003 and its reason stating that transport smoke only is proven here, prediction remaining UDG-SPIKE-001's; (b) `@colyseus/testing`, whose peers drag in the SDK **and** `@colyseus/tools`, needing (a) plus another package; (c) no real client — server-side harness only, transport-level client evidence deferred to UDG-SPIKE-001, weakening "a real server smoke run" | (a), with `@colyseus/testing` unselected. Gate A keeps its meaning because SPIKE-001 still owns the prediction proof. (c) is the fallback if untouched group ownership matters more than the smoke run |
| D-4 | **Where do the abuse limits live?** Payload 1024 B, 64/room, 8/entity, 40 fps with burst 40 are server policy. In `ProtocolLimits` they would enter `configHash`, changing UDG-002's frozen default digest and telling clients that server deployment policy is shared simulation config | Keep them in `apps/server/src/server-config.ts` as validated, documented, pinned runtime policy with their own digest in evidence, **outside** `configHash`. Making them client-detectable through `configHash` would be a separate, explicit `ProtocolLimits` decision with an amended UDG-002 digest record |
| D-5 | **Synthetic region mechanism** (§4): required `UDG_REGION_BOUNDS_PATH`, mandatory `"provenance": "test-only-synthetic"` label, explicit `UDG_ALLOW_SYNTHETIC_REGION=1` opt-in, derived synthetic `manifestHash` documented as not-an-asset-manifest | Approve as drafted. It keeps D5's "no production defaults", makes fixture geometry un-mistakable in evidence, and gives UDG-007 a one-value swap |
| D-6 | **Tooling grant list** G-1…G-9 (G-10 withdrawn) with §3.6's amendment schedule, including A-5's fixture-kind dispatch, A-6's capture plan, A-6b's SDK-import isolation rule including the probe tree, A-1/A-2's register corrections, and whether the assignment is one task or split at the phase-0 boundary | Approve as one assignment with §3.2's phases as hard stops. Each grant names its file and its limited purpose; no grant widens functional scope; G-9 is documentation-only |
| D-7 | **Conditional — acknowledgement truthfulness.** If PR-8 shows the pinned SDK's acknowledgement cannot distinguish frames received from frames applied, does the owner accept a documented API-visibility limitation (application journal as the authority record, the prohibition on acknowledging never-represented frames enforced at the UDG layer), or require the contract's documented equivalent with a bounded offender disconnect and a bounded-memory proof? | Decide from the probe output, not in advance. Recording a counter as proof of a truthful acknowledgement is not an acceptable third option |

## 7. Routine choices recommended (no decision needed, recorded so a reviewer can disagree)

| Choice | Reason |
| --- | --- |
| at most one continuous frame consumed per entity per tick, oldest admitted first; drop-newest on overflow | preserves arrival order, cannot resurrect stale input, matches "never drain then simulate the last frame" |
| `entityId` order by plain `<` on printable-ASCII identifiers, `localeCompare` banned | entity ids come from `ASCII_IDENTIFIER` (printable ASCII ≤ 64, `MAX_IDENTIFIER_LENGTH`) and are server-assigned, so code-unit order is code-point order and host-independent; `requestId` is the narrower `[A-Za-z0-9_-]{1,64}` and is never used as an ordering key |
| `keepalive` ranked below direct, cancel and path in arbitration | a keepalive asserts no intention, so it must never beat a real one; it wins only when nothing else is eligible |
| `latchedKind`/`G_d` separated from `movementMode` | O06 needs "mode idle now, same direct generation may resume next tick" without letting an obsolete generation beat a newer cancel |
| `canonicalHash` from `@udg/config` for state digests | one canonical-JSON implementation, already Verified; `@udg/server` may import `@udg/config` |
| SDK-touching probe code in `apps/server/probes/**`, contract-named wrappers in `tests/probes` and `tests/reference` | resolution follows the importing file's directory, and the contract's named paths stay meaningful (no root tsconfig change) |
| buffer-depth assertions on **counts**, heap figures informational | byte thresholds on shared runners are flakes; P10 owns numeric thresholds |
| smoke server on `127.0.0.1` port 0 | runner-safe and still a real transport; README documents the manual default port |
| no physics, navigation, client rendering, persistence or identity service | excluded by UDG-003's contract; the flat reference is a spike reference, not UDG-005's locomotion |

## 8. What this revision does not do

It adopts nothing, assigns nothing, installs nothing, starts nothing and moves no gate. UDG-003 stays **Not Started** and unassigned until the owner records P03 adoption (D-1) and pins an assignment; Gates A, B and C stay **Not Run**; D4's independent backup destination stays undesignated with the risk recorded as open. If D-1…D-6 are approved, the next deliverable is the pinned UDG-003 assignment record built from §3 — and no code before that.
