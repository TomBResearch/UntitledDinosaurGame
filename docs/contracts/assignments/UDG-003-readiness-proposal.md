# UDG-003 readiness proposal

Status: **proposal — awaiting the owner's decision. Nothing here is adopted, assigned or approved, and no gate has moved.**

Prepared at base commit `d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4` (UDG-001 **Verified**, UDG-002 **Verified**, UDG-003 **Not Started**, Gates A/B/C **Not Run**). The commit that publishes this file cannot be named inside this file, because adding this file is what changes the head; `git log -- docs/contracts/assignments/UDG-003-readiness-proposal.md` is authoritative for that commit. Preparation was read-only: no package was installed, no service started, no code written. The only repository change is this file.

Registry statements below were read from `registry.npmjs.org` on 2026-11-09 as metadata only. Nothing was added to `package.json` or `pnpm-lock.yaml`; `git status` was clean apart from this file. The one Colyseus package that is actually installed is `@colyseus/schema@5.0.45`, selected and Verified by UDG-002.

Read this as a decision document, not a contract. [UDG-003](../UDG-003.md) stays the contract; [interfaces/movement-authority.md 5.1–5.5](../interfaces/movement-authority.md) and [interfaces/protocol.md 4.2–4.4](../interfaces/protocol.md) stay the shared requirements; P03 stays Pending in [scope.md 1.3](../scope.md) until the owner records adoption in [adoption.md](adoption.md).

## 0. What already exists, so the assignment does not rebuild it

UDG-002 delivered and Verified the parts of the ordering story that are pure protocol decisions. UDG-003 consumes them and must not re-implement them:

| Existing export (`@udg/protocol`) | What it already decides | What UDG-003 must still own |
| --- | --- | --- |
| `validateDirectFrame`, `validateMoveTo`, `validateCancelPath`, `validateJoin`, `validateRouteStatus` | shape → epoch range → generation range → generation-zero rule → axes → keepalive rule → normalisation → epoch equality, with the reported `RejectionCode` | calling them at intake, and what a refusal does to state |
| `admitGeneration(raw, {watermark, limit})` | discrete intention admission: `≤ watermark` → `SUPERSEDED`, gap `> limit` → `RESYNC_REQUIRED`, otherwise admissible | the watermark itself, and continuous-frame admission (see P03-d) |
| `compareRequestIdentity`, `TERMINAL_REQUEST_CACHE_SIZE` (128), `TERMINAL_REQUEST_TTL_SECONDS` (30) | identical-payload replay versus `REQUEST_ID_CONFLICT` | the cache: storage, eviction, TTL, per entity/epoch keying |
| `neutralDirectFrame`, `NEUTRAL_DIRECT_INPUT`, `directInputOf` | the neutral frame shape and "non-direct reads as no intent" | deciding *when* neutral applies (P03-f) |
| `normaliseAxes`, `normaliseSignedZero`, `normaliseYaw`, `isInsideBounds`, `liftStamp`/`projectStamp`/`projectMoveTo`/`projectRejection` | axis normalisation, signed-zero canonicalisation, containment, wire projections | the journal and replica rows that record the results |
| `MAX_GENERATION_FORWARD_GAP` (64), `GENERATION_MIN`/`GENERATION_MAX` (0…4 294 967 294), `EPOCH_MIN`/`EPOCH_MAX` (1…4 294 967 295), `UINT32_MAX`, `ROUTE_ABSENT_REVISION`/`ROUTE_ABSENT_INDEX` (0/0), `REJECTION_CODES` (closed, 14) | the numeric envelope, sentinels and the closed rejection vocabulary | stop-before-overflow behaviour, and no new codes |
| `@udg/protocol/schema`: `DirectInputSchema`, `PlayerSchema`, `RegionSchema`, `schema`/`t`/`Encoder`/`Decoder`/`MapSchema` | the only schema declaration site, flat primitives, `float64` widths (ADR 0001, provisional until Gate A) | whether the pinned **server** accepts this declaration as its fixed-input schema (PR-3) |
| `@udg/config`: `validateServerConfig`, `requireRegionBounds`, `configBounds`, `computeConfigHash`, `movementHash`, `regionHash`, `canonicalHash`, `PROVISIONAL_P07_FIELDS` | validated configuration, "bounds are supplied or startup fails", canonical hashing | reading a supplied bounds document, refusing inconsistent ones, publishing the hashes (§4) |

Two consequences of that table are worth stating before any UDG-003 code is written. The generation-zero rule (`generation == 0` is only legal with `directIntent: false`), the keepalive rule (`directIntent: false` with nonzero axes is `INVALID_PAYLOAD`), axis normalisation and the check ordering inside `validateDirectFrame` (shape → epoch range → generation range → generation-zero → axes → keepalive → normalise → epoch equality) are already Verified behaviour, and UDG-003 inherits them rather than restating them. And `computeConfigHash` hashes the whole `ServerConfig` including `region`, which is why §4 step 4 exists.

[protocol-v1.md 8](../protocol-v1.md) already records the boundary: "Admission, watermarks, `RESYNC_REQUIRED` issuance, supersede ordering — UDG-003 — decision U2-6". This proposal stays inside that line: it adds **no** protocol export.

## 1. Proposed P03 — tick cutoff, total ordering, generation window, replay journal

P03 elaborates [movement-authority.md 5.1–5.2](../interfaces/movement-authority.md) and [protocol.md 4.2–4.3](../interfaces/protocol.md) so that they are testable. It does not change baseline v0.2 §5 and it does not pre-adopt P04 (pending-route policy, deadline before Spike 003) or P10 (spike thresholds).

Each clause is cited as `P03-a` … `P03-i` in the assignment and in the task suite.

### P03-a One fixed-step owner, one clock

- The room owns exactly one fixed-step owner at 20 Hz (`dt` 0.05 s) and one patch schedule at 100 ms, both read from validated `ServerConfig.network`. No literal tick rate or patch rate appears in server source; the suite asserts the values a running room advertises equal the configuration it was started with.
- `serverTick` is a room-local counter, `0` at room creation, uint32 on the replica. At `UINT32_MAX` the room refuses to begin another tick, marks itself draining and stops ([protocol.md 4.4](../interfaces/protocol.md): "Stop and renew the development room before tick or revision overflow; never wrap silently"). `routeRevision` stays `ROUTE_ABSENT_REVISION` (0) for the whole of UDG-003 because no route can exist (P03-h).
- The authority step reads no wall clock. `Date.now()`, `performance.now()`, `Math.random()`, filesystem and network access live only in the scheduler adapter and telemetry modules, never in the step. Tests inject a deterministic scheduler; the production scheduler is whatever the pinned server's declared fixed-step facility turns out to be (PR-2), and if the facility is absent or unusable **UDG-003 stops and escalates** — the contract's rule that an absent public fixed-step facility blocks Gate A and "does not authorise an alternative loop" is kept literally.
- `arrivalOrdinal` is a server-private, strictly monotonic counter incremented when an observation is *enqueued*, bounded by `Number.MAX_SAFE_INTEGER`. At the bound the room refuses further admissions and drains; it never wraps. It is never replicated and never appears in a client message, so it needs no protocol field.

### P03-b Tick cutoff

- The cutoff is `cutoffOrdinal = arrivalCounter` captured as the **first** statement of `step(T)`, before any handler for that tick runs. A later capture would make eligibility depend on handler order.
- Eligibility is `observation.arrivalOrdinal ≤ cutoffOrdinal`. Everything after it — including an asynchronous completion, which UDG-003 cannot generate but the journal must already model — is eligible only for `T+1` (case O03).
- The cutoff is journaled every tick, together with the selected SDK frame identity where one is publicly observable (P03-g). Order is never inferred from client timestamps or from promise scheduling.
- Admission state (watermark, latched kind, queue) is mutated only inside `step(T)`. Handlers validate and enqueue; they never move a player ([movement-authority.md 5.1](../interfaces/movement-authority.md)).

### P03-c Deterministic ordering and tie-breaking

One tick runs exactly these stages, in this order:

| Stage | Work | Source rule |
| --- | --- | --- |
| S0 | disconnects, expiry, epoch changes | 5.1 "connection lifecycle always prevents old-epoch movement" |
| S1 | freeze `cutoffOrdinal`, select the eligible set | 5.1 |
| S2 | per entity, intake eligible operations in arrival order and apply the admission filters (P03-d) | 5.1, 5.2 |
| S3 | resolve the winning intention per entity: **directIntent true → explicit cancel → path activation**; ties within one kind resolved by **first admitted** (lowest `arrivalOrdinal`); an identical retry is deduplicated to the single admitted operation | 5.2 |
| S4 | commit eligible route completions **after** all competing input decisions | 5.1, case O12 |
| S5 | step each connected entity exactly once, in ascending `entityId` order using plain `<` on the identifier string (identifiers are bounded ASCII `[A-Za-z0-9_-]`, so no locale is involved; `localeCompare` is banned in this path) | 5.1, [protocol.md 4.4](../interfaces/protocol.md) |
| S6 | map canonical state to the replica (P03-h sentinels) | [protocol.md 4.4](../interfaces/protocol.md) |
| S7 | publish terminal results, then metrics, then flush the tick's journal rows | 4.3, 19.1 |

"Total ordering" means: for a fixed arrival sequence the per-tick relation is total and reproducible — inside an entity keyed by `(kindPrecedence, arrivalOrdinal)`, across entities by `(entityId, …)`. Two consequences are stated because they are the ones people get wrong:

1. kind precedence **overrides** arrival order (O02: direct and MoveTo at the same generation, either arrival order, direct wins), and within one kind arrival order decides;
2. different real arrival orders may legitimately produce different intermediate ticks. [movement-authority.md 5.5](../interfaces/movement-authority.md) forbids claiming global determinism independent of network arrival, and the UDG-003 suite is not allowed to assert it.

### P03-d Generation admission — two predicates, one watermark

The server tracks one watermark `H` per entity/epoch plus a latched kind, and the latched **direct generation** `G_d` (the generation held by the current direct sample; `0` at join).

| Operation | Admitted when | Refused as | Effect on `H` |
| --- | --- | --- | --- |
| discrete intention (MoveTo, CancelPath) | epoch matches, structurally valid, `generation > H`, `generation − H ≤ 64` | `SUPERSEDED` (`< H`), `INVALID_GENERATION` (`= H`, different latched kind), `RESYNC_REQUIRED` (gap > 64), `EPOCH_MISMATCH`, `INVALID_PAYLOAD` | advances to `generation` only on admission |
| discrete replay | `generation == H`, same latched kind, identical payload | none — returns the cached pending/terminal result (`compareRequestIdentity`) | none |
| continuous frame | epoch matches, structurally valid, and either `generation == G_d` (held sample: keepalive, release or continuation) or `generation > H` with gap ≤ 64 (new direct intention: set `H`, `G_d`, latch kind `direct`) | `SUPERSEDED` (`< H`), `INVALID_GENERATION` (`= H` with a latched non-direct kind) | advances only for a new intention |

- `H` never changes for a structurally invalid, old-epoch, rate-limited or excessive-gap operation, and never for a refused continuous frame ([movement-authority.md 5.2](../interfaces/movement-authority.md)).
- **The equality case is the one real conflict with the adopted surface.** `admitGeneration` refuses `generation ≤ watermark`, which is exactly right for discrete intentions and exactly wrong for continuous frames: a release, a keepalive and a resumed direct sample all legitimately carry the *current* generation ([5.2](../interfaces/movement-authority.md), cases O05, O06). Resolution: UDG-003 owns a second, server-side predicate for the continuous channel, and `admitGeneration` is used for discrete admission only. That matches [protocol-v1.md 8](../protocol-v1.md), which assigns admission and watermarks to UDG-003 and not to protocol. The only protocol-side edit requested is a one-line scope note on `admitGeneration` naming the two predicates — protocol-owner reviewed, no behaviour change, no new export, UDG-002's unit and contract suites unchanged.
- The generation-zero rule is already Verified protocol behaviour, not a new rule: `validateDirectFrame` refuses `generation == 0` unless `directIntent === false`. UDG-003 inherits it and must not work around it.
- `RESYNC_REQUIRED` does not silently resynchronise. P03 records the refusal, leaves `H` and mode untouched, and requires the session to obtain a new epoch through the join lifecycle. Renewals are counted and rate-limited; generation exhaustion at `GENERATION_MAX` follows the same path (no wrap, ever).
- `EPOCH_MISMATCH` is the code a stale frame gets, because `validateDirectFrame` answers epoch equality last, after structure — a frame that is structurally unusable is not meaningfully stale. UDG-003 must not reorder those checks.

### P03-e Duplicate handling happens at two layers, and they must not be conflated

1. **Transport layer (SDK-owned).** `@colyseus/schema/input` `InputDecoder.decodeAll(bytes, cb)` walks a length-framed unreliable packet oldest→newest and hands the receiver the framework `seq` of each input, documented as "monotonic: drop seq ≤ last seen". That is a *transport* sequence, not a UDG generation, and the adapter must never map one onto the other. UDG's 32-frame input buffer and its own counters sit behind it.
2. **Application layer (UDG-owned).** `requestId` replay uses `compareRequestIdentity` against a cache keyed by entity/epoch: 128 records, 30 s TTL (`TERMINAL_REQUEST_CACHE_SIZE`, `TERMINAL_REQUEST_TTL_SECONDS`), same-ID-same-payload returns the pending state or the cached terminal result without recomputation or a second transition, same-ID-different-payload is `REQUEST_ID_CONFLICT`, and the terminal result is emitted once. Two behaviours must be proved by fixtures because they are the ones a rewrite gets wrong: a cache-evicted stale replay still cannot move anything (stale-generation admission refuses it), and after a reconnect the old epoch's records remain only as inert diagnostics.
3. **Burst and overflow.** At most one continuous frame is *consumed* per entity per tick, oldest-admitted first. Remaining frames stay queued up to 32 per client; a frame arriving at a full queue is refused `RATE_LIMITED`, counted, acknowledged truthfully by the SDK and never re-queued. Drop-newest is the recommended policy because it preserves arrival order and cannot resurrect stale input; the alternative (drop-oldest) needs a documented reason. The contract's escape hatch — a bounded offender disconnect where safe continuity cannot be proven — stays unused unless PR-5 shows it is necessary, and the buffer-depth trace is the evidence either way. "Drain the burst then simulate only its last frame" and "move a character repeatedly to empty a queue" stay forbidden.
4. **Admission is not acceptance.** A discrete operation can be *admitted* (H advances, kind latched) and still produce `accepted: false`. A cancel at a new generation with no active route is the standing example: the intention is recorded, the entity is idle, and the terminal result is `accepted: false, appliedTick: null, routeRevision: null, reason: SUPERSEDED`. `accepted: true` keeps its adopted meaning — a mode change committed at `appliedTick` ([protocol.md 4.3](../interfaces/protocol.md)).

### P03-f Neutral input

- No consumable frame at the cutoff means the entity steps `neutralDirectFrame` for the current epoch and held generation: horizontal desired displacement becomes zero **on that tick**, mode becomes idle, heading is preserved (heading changes only for nonzero movement, [5.4](../interfaces/movement-authority.md)). No new intent is invented and no SDK acknowledgement is fabricated.
- A `directIntent: false` frame that passes validation is a keepalive: it consumes no movement and cancels nothing. In UDG-003 no path can exist, so its observable effect is identical to neutral; the difference becomes load-bearing at UDG-007/Spike 003 and the rule is written now so the journal distinguishes `inputSource: keepalive` from `inputSource: neutral`.
- Frames that are consumed but refused (stale epoch, superseded generation, rate limited, structurally invalid after codec coercion) are counted as `rejectedFrames`, contribute neutral input for that tick, keep a truthful SDK acknowledgement and are not re-queued.
- UDG-003 has no physics. "Physics vertical settling can still occur in idle" is therefore **not** exercised here and must not be simulated by hand: the idle assertion in this task is horizontal-only, with `y` unchanged. The vertical half belongs to UDG-006 and Gate B, in a separate population as [acceptance-gates.md 7.3](../validation/acceptance-gates.md) requires.

### P03-g Replay journal

The journal is the run's authority record and it doubles as evidence: its row schema is exactly the trace-row schema of [evidence-requirements.md 19.1](../validation/evidence-requirements.md), so nothing has to be transcribed later.

- **Prologue row, once per run:** protocol version, `configHash`, `movementHash`, `regionHash`, region provenance label, tick origin `0`, `dt`, patch interval, initial per-entity canonical state digest (`canonicalHash` from `@udg/config`), seeds, run id. A replay whose prologue does not match the running configuration is **refused**, not partially compared.
- **Tick rows:** `serverTick`, `cutoffOrdinal`, entity alias, application epoch/generation, SDK frame identity where publicly observable (otherwise `null` plus a recorded API-visibility limitation), input source (`direct` | `keepalive` | `neutral` | `rejected`), before/after mode, route revision (always the 0 sentinel in this task), desired and resolved displacement, rejection/result code. Plus one canonical state digest per entity per tick, which is what "replaying a recorded journal must reproduce canonical output exactly in the same runtime" is actually compared against.
- **Copy-on-record.** The pinned codec reuses mutable state: `InputEncoder.encode()` returns "a subarray of an internal buffer — copy if retaining across calls", and `InputDecoder.decodeAll` re-uses one instance across callbacks and documents "reads of the instance must be synchronous". The adapter therefore copies scalars into a frozen observation record before returning, and a test mutates the source instance after intake to prove the journal and the queued observation are unaffected.
- **Bounds.** Queue depth is bounded (32 frames/client, 64 queued discrete operations/room, 8/entity) and in-memory retention is bounded (per-tick working set plus the last 128 terminal records). The journal itself streams to disk; sustained abuse must not grow any unbounded array. The measured numbers are counts, not bytes: a heap-growth threshold is P10 territory and a byte threshold on shared runners is a flake generator.
- **Sanitisation.** Aliases are stable per run and joinable across traces; no token, cookie, reconnect secret or private machine path reaches a row (the existing sanitiser already refuses those in UDG-001/002 bundles and its rules extend to the new traces).

### P03-h Conflicts and mismatches with what is already adopted

| Item | Status | Resolution |
| --- | --- | --- |
| `admitGeneration` refuses `generation ≤ H`; 5.2 needs `generation == H` continuous samples | **real conflict** | two admission predicates, both in UDG-003; protocol behaviour unchanged, one protocol-owner-reviewed scope note (P03-d); UDG-002's unit and contract suites stay exactly as accepted |
| forward gap 64 | match | `MAX_GENERATION_FORWARD_GAP` is used, never a literal |
| `GENERATION_MAX` 4 294 967 294, no wraparound | match | refuse at the bound, renew the epoch, journal the event |
| `arrivalOrdinal` has no protocol bound | gap in P03 | server-private bound `Number.MAX_SAFE_INTEGER`, drain at the bound (P03-a) |
| abuse responses | closed vocabulary | `RATE_LIMITED`, `RESYNC_REQUIRED`, `EPOCH_MISMATCH`, `INVALID_PAYLOAD` only; an offender disconnect is a transport event recorded in the journal, never a fabricated `accepted: false` command result (4.3 keeps transport failure separate) |
| discrete path requests in UDG-003 | contract-specific | refused `NAVIGATION_BUSY` **before admission**: no `H` change, no route mutation, `routeRevision` stays 0, destination still validated so an out-of-bounds destination reports `OUT_OF_BOUNDS`/`INVALID_DESTINATION` honestly, and one terminal record is stored for dedup |
| `UDG_ROUTE_STATUS` (optional pending) | unused | no pending work exists, so no pending message is emitted; the suite asserts absence |
| `movementMode` `path` (2) | unreachable | replica mode is only 0/1; asserted, and the route-dependent cases are deferred (§3.5) |
| P04 pending policy, `navmeshHash`, route revisions | not this task | not implemented, not pre-empted, no pending state may exist |

### P03-i What P03 does not decide

Pending-route behaviour (P04), entity-bound simulator factory shapes (P05), gravity/controller margins (P07), worker and asset formats (P08), dead zones and mode hand-off procedure (P09), and every spike threshold and sample size (P10). UDG-003 measures the Gate A numbers it can legitimately produce (§3.7) and records the rest as not-yet-measurable rather than inheriting a neighbour's pass condition.

## 2. Proposed Colyseus pin set, and what is actually proven

### 2.1 Proposed pins (registry metadata read 2026-11-09; nothing installed)

| Package | Proposed exact pin | Licence | Declared `engines` | Declared constraints that matter | Evidence class |
| --- | --- | --- | --- | --- | --- |
| `@colyseus/core` | `0.18.27` (registry `latest`, published 2026-11-05) | MIT | node ≥ 22.x | peer `@colyseus/schema ^5.0.8`; peer `@colyseus/ws-transport 0.18.x` (optional); peer `express ^4.16.0 \|\| ^5.0.0` (optional); peer `zod`, `@pm2/io`, `@colyseus/auth` optional; dep `@colyseus/shared-types ^0.18.2` | registry manifest |
| `@colyseus/schema` | `5.0.45` (already installed; registry `latest`) | MIT | – | peer `typescript ≥ 5.0.0` (installed 5.9.3 ✓); `exports` `.` and `./input` | **installed + executed by UDG-002** |
| `@colyseus/sdk` | `0.18.9` (registry `latest`, published 2026-10-30) | MIT | node ≥ 12.x | dep `@colyseus/schema ^5.0.8` (a **direct dependency**, not a peer); peer `@colyseus/core 0.18.x` optional | registry manifest |
| `@colyseus/ws-transport` | `0.18.4` (registry `latest`, published 2026-08-10) | MIT | node ≥ 22.x | peer `@colyseus/core ^0.18.5`; peer `express ^4.16.0 \|\| ^5.0.0` — **required, not optional** | registry manifest |
| `express` | whatever the resolver yields for that peer range, then pinned exactly (registry `latest` is `5.3.0`; `4.22.3` is the last 4.x) | MIT | – | arrives automatically under pnpm's peer auto-install | registry manifest |
| `@colyseus/testing` | **not in the minimal set**; `0.18.6` exists and its peers require `@colyseus/core 0.18.x`, `@colyseus/sdk 0.18.x` **and `@colyseus/tools 0.18.x`** | MIT | node ≥ 22.x | choosing it drags `@colyseus/tools` into the runtime graph as well | registry manifest |

`schema 5.0.45` satisfies both `^5.0.8` ranges, so one resolved copy can serve server, SDK and protocol — **but "one copy" is a thing to prove, not to assume**: two resolved `@colyseus/schema` versions would mean two registration domains and a wire that disagrees with itself. PR-1 asserts exactly one `@colyseus/schema@<version>` key in the lockfile and one entry in the installed graph, and the existing register assertion that a selected group names exact versions covers the rest. Everything listed is MIT and ESM with a `types` condition in `exports`, which resolves under this repository's `NodeNext` setting.

Pin rules the task must keep: exact versions only (no `^`, `~`, `latest`), no `pnpm.overrides`, no patched packages, licences captured from the install rather than from the registry page, and `pnpm install --frozen-lockfile` green in CI from the committed lockfile.

### 2.2 Public APIs already verified (do not re-probe; do not over-claim)

From the **installed declarations** of `@colyseus/schema@5.0.45` (read, not inferred) and from the executed UDG-002 probes:

| API | Fact | Class |
| --- | --- | --- |
| `schema(fields, name)` + `t.uint32()/t.float64()/t.boolean()`, `MapSchema`, `Encoder`/`Decoder` | the non-decorator builder form; `defineTypes` exists but announces itself deprecated | declared + executed |
| `DirectInputSchema` | flat five fields with defaults; the input codec rejects nested Schema at construction | declared + executed |
| codec coercion | an out-of-range integer wraps and a fractional value truncates **silently**; `float64` carries a double exactly; `-0` decodes as `+0` | executed (UDG-002) |
| `@colyseus/schema/input`: `InputEncoder`, `InputDecoder`, `InputMode = "reliable" \| "unreliable"`, `historySize` (default 3), `decodeAll` per-input `seq`, `copyInto`, `reset()` | reliable mode is one input per packet and **`seq` is `0`**; reliable `encode()` returns an **empty `Uint8Array` when nothing changed**; `encode()` returns a subarray of an internal buffer; `decodeAll` re-uses one instance | declared |
| no sanitizer in `@colyseus/schema` | sanitization/idle behaviour, if it exists, is a server/SDK concern | declared (absence verified by search of the installed build) |

None of that is evidence about the **server** or about **prediction**. Room-free encode/decode tests prove a codec. They prove nothing about a fixed-step loop, an input queue, an idle policy, an acknowledgement, a patch schedule, or a reconciler, and the proposal deliberately does not treat them as if they did.

### 2.3 Assumptions that are only documentation observations

`defineInput`, `setFixedTimestep`, "single-frame next consumption", configurable sanitization/idle, `room.input`, `Predict.get`, the reconciler, `sim`, `attachAll`, a configurable 100 ms patch rate, and any SDK acknowledgement surface are **V1/V2 documentation observations** ([references.md](../references.md)). They are treated as unproven until compiled and exercised against the pinned installs. [colyseus.md 6.1](../integration/colyseus.md) governs: "An API absent from installed declarations is a failed probe", and 6.2 warns not to assume `pausePrediction`, `resetEpoch`, `clearHistory` or `switchMode` exist. Everything client-predictive (`room.input`, `Predict.get`, reconciler, `sim`, `attachAll`) is **UDG-SPIKE-001's** probe list, not UDG-003's; UDG-003 earns the server-side half.

### 2.4 Probe plan (each row becomes one row of `docs/integration/colyseus-0.18-api-map.md`)

The api-map row schema is fixed by [colyseus.md 6.1](../integration/colyseus.md): exact package and version, import path, declaration file and symbol, official source URL or immutable source commit, minimal compiled probe path, runtime test id, result, limitations.

| ID | Probe | Compile / runtime | Pass condition | If it fails |
| --- | --- | --- | --- | --- |
| PR-0 | dependency resolution under the strict compiler policy | compile | `@udg/server` typechecks the pinned server stack with `skipLibCheck: false` from `tsconfig.base.json`, no `any`, no `@ts-ignore` | **stop**: the pin set is not usable. Do not relax the compiler policy to continue; escalate (this is decision D-2) |
| PR-1 | install graph identity | runtime | exact versions installed as declared; **one** resolved `@colyseus/schema`; `express`/peer resolution recorded; licences captured | stop; the register cannot describe the graph |
| PR-2 | fixed-step facility with advertised `dt` | compile + runtime | a declared facility drives ticks at the configured 20 Hz; observed tick count over a controlled interval matches the injected scheduler | **Gate A blocker** — record and escalate; no private or hand-rolled loop substitute |
| PR-3 | flat input declaration accepted | compile + runtime | `DirectInputSchema` is accepted as the fixed-input declaration and all five fields survive a real send/receive | blocker for the input path; escalation |
| PR-4 | malformed decode through the server | runtime | codec-coerced and out-of-range bytes reach `validateDirectFrame`, are refused with the adopted code, produce zero movement, and neither crash the room nor reach an observer | blocker: the "offender must not crash the room" rule would be unprovable |
| PR-5 | queue depth, coalescing, overflow | runtime | the SDK's real behaviour under saturation is *observed and recorded* (buffer, coalesce or drop) and UDG's 32-frame bound is enforced somewhere named | if no bound is demonstrable, the contract's documented-equivalent clause must be written and proven before acceptance |
| PR-6 | idle/neutral behaviour | runtime | whether the SDK synthesises frames is determined; UDG's neutral rule (P03-f) applies exactly once, never twice | blocker for the neutral rule |
| PR-7 | one frame per tick | runtime | a 100-frame burst produces exactly one consumed frame and one step per entity per tick | blocker; this is the contract's headline acceptance line |
| PR-8 | acknowledgement identity | runtime | the public acknowledgement surface is named; in reliable mode `seq` is documented `0`, so where no per-frame identity exists the journal records `null` plus the limitation | not a failure if honestly recorded — a recorded API-visibility limit, which 19.1 explicitly allows |
| PR-9 | `@colyseus/testing` helpers | compile + runtime | only if D-3 chooses it | otherwise the row is recorded "not used, and why" |
| PR-10 | patch schedule versus tick schedule | runtime | over 200 ticks (10 s of tick time at 20 Hz) the patch schedule emits about 100 times at 100 ms, and the two schedules are independent; measured and recorded as counts | record the observed ratio; a mismatch with the configured values is a blocker |
| PR-11 | room disposal and lifecycle | runtime | disposal stops ticks, releases sessions, no write after dispose | blocker: "room disposal" is a named test |
| PR-12 | epoch renewal lifecycle | runtime | the public procedure for epoch renewal is discovered and documented (needed by `RESYNC_REQUIRED` and generation exhaustion) | record **BLOCKED** honestly and escalate; inventing a reset call is forbidden |

Two hard rules for the probe phase. First, probes run **before** room behaviour is written (§3.2): a probe that fails after the room exists means the room was designed on an assumption. Second, a probe may not be satisfied by a cast, a `// @ts-expect-error`, a private path (`@colyseus/core/build/…` — the `./*` wildcard export makes that *possible*, which is exactly why it must be forbidden) or a hand-written fake of the SDK's behaviour.

## 3. Proposed UDG-003 assignment

### 3.1 Prerequisite pins

| Item | Value |
| --- | --- |
| UDG-001 Verified implementation | `1c735c2d845e399cc8b3cc33adac4ba7a6081387` (accepted; recorded **Verified**) |
| UDG-001 reviewer acceptance | `0e586b6`, CI `42511785889` |
| P01/P02/P06 adoption record | `74ffdaaba1bc3617999c99e73c7f197ebd01a570` |
| UDG-002 assignment record | `45051f6391dc9862dd92e514dddb6d51ea50c746` |
| UDG-002 accepted implementation | `372be938f0dd825ff89fac56da7dc29d0789098f` |
| UDG-002 reviewed submission | `a967c5f97ede7126837addcd192eb599648b9546`, CI `42627324928` |
| UDG-002 acceptance record | `d364d2dafbc88f469ef60e5e61c5e5c5c6cfd7e4`, CI `42632130409` |
| this proposal's publication commit | read it from `git log -- docs/contracts/assignments/UDG-003-readiness-proposal.md` |
| P03 adoption record | **does not exist yet** — decision D-1 creates it; UDG-003 cannot be Ready before it does |
| UDG-002 contract / baseline / lockfile hashes | `255e7b2cb8fd…`, `b51e7afdd681…`, `899e6f4d1893…` (pinned in the assignment; the lockfile hash is superseded by the install that UDG-003 itself commits) |
| default config / movement digests | `948f8c10fc40…`, `c80f61d451ea…` (the bounds-null default; a room started with bounds advertises a different, correct `configHash` — see §4) |
| boundary rule table | `818c63d5b12f…` at base; a rule-table change re-digests and is named in the new completion record, historical digests untouched |

### 3.2 Phase order (so the probe phase is not optional)

1. **Phase 0 — pins and probes only:** PR-0, PR-1, PR-2, PR-3, PR-8, PR-12. Deliverable: the api-map skeleton plus honest probe results. A failure here ends the task with a blocker record, not with a workaround.
2. **Phase 1 — authority core:** journal, cutoff, admission predicates, ordering, neutral rule, buffers, terminal cache — deterministic, injected scheduler, no transport.
3. **Phase 2 — transport and room:** adapter, join validation, session association, tick metrics, disposal, real server smoke run through the chosen client.
4. **Phase 3 — abuse, evidence, CI:** offender suite, buffer depth, capture plan, CI step, submission.

### 3.3 Files

Owned by UDG-003 exactly as the contract lists them: `apps/server/src/{main,server-config}.ts`, `src/rooms/RegionRoom.ts`, `src/network/{ColyseusInputAdapter,join-validation}.ts`, `src/movement/MovementAuthorityAdapter.ts`, `src/state/map-player.ts`, `src/lifecycle/DevelopmentSessions.ts`, `src/telemetry/tick-metrics.ts`, `tests/reference/flat-direct-step.ts`, `tests/probes/colyseus-server.probe.ts`, `tests/contracts/UDG-003.test.ts`, `docs/integration/colyseus-0.18-api-map.md`, plus `apps/server/package.json`/`tsconfig.json` (its own workspace manifest, adding exact-version dependencies and a probe compile project).

Additional controlled paths, each with its own limit — a grant is permission to touch a file, never permission to widen scope:

| Grant | Path | Limited to |
| --- | --- | --- |
| G-1 | `tools/checks/src/evidence.ts` | amendments A-2, A-6 only |
| G-2 | `tools/checks/src/fixtures.ts` | A-5 only (kind dispatch; no new fixture *command*) |
| G-3 | `tools/checks/src/boundaries.ts` | A-6b only: one rule that `@colyseus/*` may be imported only from `apps/server/src/{rooms,network,movement}/**` and the schema entry point of protocol |
| G-4 | `tests/contracts/UDG-001.test.ts` | amendments A-1, A-3, A-4 and their live refusal demonstrations, nothing else |
| G-5 | `tests/fixtures/catalog.json` | new `UDG-003-*` entries with pinned `sha256`; **no edit to any UDG-002 entry** |
| G-6 | `.github/workflows/ci.yml` | a real probe step, a UDG-003 suite step, and the artefact list; the existing evidence-step invariants stay |
| G-7 | `docs/contracts/UDG-003.md`, `docs/contracts/protocol-v1.md`, `docs/integration/{dependencies.json,colyseus-0.18-api-map.md}`, `README.md`, `tests/AGENTS.md`, `apps/server/AGENTS.md`, `docs/contracts/assignments/{UDG-003,UDG-003-completion}.md` | status, delivered-API surface, register, and record updates required by the change |
| G-8 | `pnpm-lock.yaml`, `docs/contracts/checksums.json` | regenerated by the pinned toolchain and by `pnpm contracts:checksums -- --write`; never hand-edited |
| G-9 | `packages/protocol/src/validation/commands.ts` | one doc-comment scope note on `admitGeneration` (P03-d); protocol-owner review; **no behaviour or export change** |
| G-10 | `tsconfig.json` (root project) | exclude `tests/probes/**` and `tests/reference/**` only, per §3.4, so that tree is typechecked by `apps/server` under `skipLibCheck: false`; every other test file stays in the root project |

No grant touches `packages/config`, the UDG-001/UDG-002 suites' assertions about evidence integrity, `docs/contracts/{scope,ownership,repository,definition-of-done,traceability}.md`, or any accepted evidence record.

### 3.4 Commands

Required, unchanged: `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`, `test:boundaries`, `test:fixtures`, `test:contract -- --task UDG-003`, `contracts:checksums` (in sync), `dependencies:verify`.

Recommended shape, chosen to avoid new root surface:

- **No new root command is required for probes or the reference trace.** `tests/probes/colyseus-server.probe.ts` is a self-contained module the UDG-003 suite runs as a child process and whose JSON result becomes `metrics/probes.json` in the bundle; the contract suite is what makes probes run in `pnpm test` and in CI. `tests/reference/flat-direct-step.ts` is compiled by that same `apps/server` probe project, and the UDG-003 suite runs it and asserts the 40 m trace from its reported output — the same "assert against built output by relative path" convention UDG-002's suites already use, so no test imports a workspace by a specifier the root project cannot resolve. The root `package.json` therefore stays untouched unless the owner wants standalone entries (routine, not a decision — the cost is one more controlled path and one more dispatcher entry).
- **Probe typechecking must be real without weakening the compiler policy — and there is a trap here.** `tests/**/*.ts` is inside the **root** tsconfig project, and the root project sets `skipLibCheck: true` for unrelated vendored-declaration reasons while `apps/server` inherits `skipLibCheck: false`. Two things follow. First, a probe placed in `tests/probes/` would be typechecked where declaration-level breakage in the pinned stack is invisible, which is the wrong place to prove third-party integration. Second, `@colyseus/*` resolves from `apps/server/node_modules`, not from the repository root, so a `tests/probes/*.probe.ts` that imports `@colyseus/core` would not even resolve under the root project — the same reason UDG-002's suites import compiled workspace output by relative path rather than by specifier. Recommended resolution, recorded as grant **G-10**: exclude `tests/probes/**` and `tests/reference/**` from the root project and cover both from a new `apps/server/tsconfig.probes.json` with `noEmit`, which resolves the SDK and the shared packages from the workspace that actually depends on them; `apps/server`'s own `typecheck` script chains both projects, so `pnpm -r typecheck` runs them. The root project still typechecks every other test file, and the probe tree is checked **more** strictly, not less. The alternative — adding `@colyseus/*` to the root manifest's devDependencies so the root project can resolve it — would duplicate a runtime pin into repository tooling and is not recommended.
- The compiled probe and reference modules are executed as child processes by the UDG-003 suite, which reads their JSON output; that keeps `pnpm test`, `pnpm test:contract -- --task UDG-003` and CI running identical code without inventing a root command.
- `test:e2e`, `test:spike`, `assets:build`, `assets:verify` stay guarded and must still refuse with their owning task named. UDG-003 creates `tests/reference/` and `tests/probes/`, **not** `tests/e2e/` or `tests/spikes/`.
- The build-before-assert invariant from UDG-002 extends: the UDG-003 suite builds `@udg/server` itself before asserting anything about its output, and a measurement (`gate.buildsAppsBeforeAsserting`) records that ordering, because `pnpm test` builds only `packages/*`.
- The server smoke run binds `127.0.0.1` on an ephemeral port by default and prints one ready line; README gains the manual run, port and shutdown instructions the repository contract already requires.

### 3.5 Fixtures and cases

Positive and negative, all with `UDG-003-*` ids and pinned digests:

| Group | Cases |
| --- | --- |
| ordering (`UDG-003-ordering-*`) | the executable subset of [5.5](../interfaces/movement-authority.md) — O02 (equal generation, both arrival orders), O06 (missing frame, then same-generation resume), O07 in its route-free half (a structurally invalid MoveTo is refused and `H` is unchanged; the "valid path remains" half is deferred with the other route cases), O09 (reconnect epoch 8 with an epoch-7 backlog), O12-modified (completion decision ordered before input, with the completion stubbed at the journal level because no navigation exists) — plus permutation runs that record every arrival permutation that changes eligibility |
| admission (`UDG-003-admission-*`) | gap 64 admissible / 65 refused `RESYNC_REQUIRED` with unchanged `H`; below-`H` `SUPERSEDED`; equal-generation different-kind `INVALID_GENERATION`; equal-generation identical replay deduplicated; generation-zero rules; `GENERATION_MAX` refusal; kind latching across ticks |
| neutral (`UDG-003-neutral-*`) | missing frame, keepalive, release, rejected-frame-counted-as-neutral, "no horizontal hold after the last direct tick" |
| abuse (`UDG-003-abuse-*`) | 100-frame burst in one tick; sustained 40 fps over 60 s; payload over 1024 bytes; 65 queued discrete operations in a room; 9 for one entity; unknown message name; unsupported join version; wrong `configHash`; disallowed origin; non-loopback bind without the explicit opt-in; each offender case asserts the observer's state and trace are untouched |
| lifecycle (`UDG-003-lifecycle-*`) | room disposal mid-tick; entity removal with queued input; epoch renewal; cache eviction then stale replay still refused; reconnect retains one idle entity |
| reference (`UDG-003-reference-*`) | the flat 200-tick 40 m trace, diagonal speed ≤ 0.2 m per tick, and the labelled reset segments the Gate A note allows |

Route-dependent cases **cannot be honestly executed by this task**: O01, O03, O04, O05, O08, O10, O11 all need a route or a navigation completion, and in UDG-003 a route cannot exist because every `UDG_MOVE_TO` is refused before admission. The assignment must state that deferral in its acceptance section and prove the refusal instead — with O03's *cutoff* mechanic still exercised through the journal's asynchronous-completion stub, which needs no navigation. Inventing a fake route to make those cases green would be worse than deferring them: it would make Gate C's later evidence look derivable from a fake.

### 3.6 UDG-001 / UDG-002 compatibility amendment schedule

Each amendment is invariant-preserving, each keeps a **live** demonstration that the rule still refuses something, and none of them is optional — these are the checks that turn red the moment UDG-003 legitimately installs a dependency or fills in a workspace:

| ID | Current text | Why it becomes false | Amendment (invariant kept) |
| --- | --- | --- | --- |
| A-1 | `tests/contracts/UDG-001.test.ts` asserts `lockfile.includes('@colyseus/core' / '@colyseus/sdk' / '@colyseus/testing')` is `false`, unconditionally | a selected dependency legitimately appears | make the lockfile check status-aware exactly like the installed-graph half a dozen lines above it: allow only names a **selected** group names; keep refusing every other deferred scope and keep refusing a not-selected group's own names. Demonstrated by a synthetic register that selects `@dimforge/rapier3d-compat` while its owner task is Not Started → still refused |
| A-2 | `DEFERRED_GAME_LIBRARIES` names `@colyseus/core`, `@colyseus/sdk`, `@colyseus/testing` | the pinned set also contains `@colyseus/ws-transport` (and `express` transitively), which no group names — and today's forbidden-prefix list would let `@colyseus/ws-transport` into the graph **silently**, which is a coverage hole, not a convenience | extend the `@colyseus/core` group to `['@colyseus/core', '@colyseus/ws-transport']` (the "server runtime" set [colyseus.md 6.1](../integration/colyseus.md) demands be pinned), record `express` as a transitive runtime dependency with its licence, and extend the refused-prefix loop to `@colyseus/`-scope-wide-minus-selected so the hole closes. Derivation stays graph-derived |
| A-3 | `IMPLEMENTED_WORKSPACES` is hard-coded to `@udg/protocol`/`@udg/config`, both mapped to `UDG-002.md` | `@udg/server` legitimately gains exports, and the current shape cannot express a third implemented workspace | derive `package → owning task contract file` from the existing `WORKSPACES` table and keep the derivation **contract-driven**: a workspace may export more than an empty module only if its owning contract no longer says Not Started, and only the documented entry points. The live demonstration (an unstarted workspace that declares exports still fails) must be kept as a synthetic-tree case |
| A-4 | `readContractEntryMap()` reads exactly `docs/contracts/protocol-v1.md` | `@udg/server`'s delivered surface is documented in `docs/integration/colyseus-0.18-api-map.md`, not in the protocol record | collect `<!-- entry-map:begin/end -->` blocks from a declared list of delivered-API records, same table grammar, same normalisation; "implemented but documents no entry points" still fails, and a record that declares a block whose grammar drifted still throws |
| A-5 | `readCatalog()` treats **every** `UDG-*` directory under `tests/fixtures/` as a protocol message fixture and validates it with `validateProtocolFixture` | UDG-003's fixtures are multi-row scenarios (ordering permutations, abuse traces), not single-message validation cases — so they would either be rejected or force a nonsense fixture | dispatch on a declared `kind`: existing protocol kinds unchanged, plus explicitly-declared UDG-003 kinds with their own required fields (case id, input rows, expected rows/codes, tick origin, bounds provenance). Unknown `kind` refuses; the `UDG-\d{3}-` id rule stays; the new kinds are pinned by `sha256` like the existing ones; **no UDG-002 fixture digest changes** |
| A-6 | `CAPTURE_PLANS` has entries only for UDG-001 and UDG-002, and `capture()` throws for any other task | evidence capture for UDG-003 would refuse | add the UDG-003 plan (commands, required artefacts of §3.8, `measurements/UDG-003.json`, the task-scoped `UDG_EVIDENCE_OUT`/`UDG_EVIDENCE_TASK` rule with the child-env stripping preserved). `EVIDENCE-THRESHOLD-UNMEASURED` stays, so every threshold in the new plan must be produced by a real test |
| A-6b | `PACKAGE_RULES['@udg/server']` permits Colyseus generally | "Concrete SDK hooks are discovered through the compile probe and listed in the API map", and today nothing stops an SDK import from anywhere in the server | one new rule: `@colyseus/*` is importable only from `apps/server/src/{rooms,network,movement}/**`; everything else in the server that wants SDK behaviour goes through those modules. Positive and negative boundary fixtures added, with the rule-table digest change recorded |
| A-7 | CI has no probe step and no UDG-003 step | the contract requires probes compiled and the suite requires CI proof | add "Run the server/SDK compile and runtime probes" (a step that only echoes would prove nothing, and no workflow assertion would notice — so the probe step is covered by AC-10/AC-11 rather than by a workflow assertion) and "Run the UDG-003 task suite", both before the evidence tail. The workflow invariants the UDG-001 suite does assert stay intact: the four evidence steps exist by name with `!cancelled()`, no step anywhere declares `continue-on-error`, artefact upload errors on missing files, and the failure-mapping test keeps failing the job for every required step |
| A-8 | `UNAVAILABLE_SUITES` guards `test:e2e`, `test:spike`, `assets:build`, `assets:verify` | unchanged by UDG-003 | no change; the suite must keep demonstrating that at least one contract task still lacks a suite and that its command exits 2 with an attributed reason |
| A-9 | status sentences in `tests/AGENTS.md` (`tests/reference`/`tests/probes` do not exist), `apps/server/AGENTS.md`, `tools/checks/AGENTS.md`, README | they become untrue the moment the task lands | rewrite them to describe what exists and who created it under which grant, keep naming what still does not exist (`tests/e2e`, `tests/spikes`, the asset pipeline, the load-test harness), and keep every operative rule and scope limit word-for-word in meaning |
| A-10 | `docs/contracts/checksums.json` | `UDG-003.md` status and any edited contract text change | regenerate with `pnpm contracts:checksums -- --write`; the assignment records the new entry count; hand-editing the manifest stays forbidden |

For the record: `pnpm test:unit`'s "no longer guarded" assertion, the evidence fail-the-run rule, `EVIDENCE-GATE-NOT-PASS`, the machine-path aliasing rules, the CI ordering invariants and the register's host-independence behaviour are all expected to keep working **unchanged**. If one of them has to move for a reason not listed above, that is a finding to raise, not a detail to adjust quietly.

### 3.7 Acceptance criteria (measurable)

Numbers come from [acceptance-gates.md 7.3](../validation/acceptance-gates.md); each is produced by a named test and lands in `measurements/UDG-003.json`, which `EVIDENCE-THRESHOLD-UNMEASURED` now protects.

| AC | Condition |
| --- | --- |
| AC-1 | 200 valid direct ticks produce the specified 40 m flat trace within `1e-6 m` in pure simulation (the reference module), with labelled reset segments excluded from the calculation |
| AC-2 | every tick's horizontal desired displacement ≤ `0.2 m + 1e-6 m`, over the whole burst suite |
| AC-3 | a 100-frame burst in one tick changes neither the step count (exactly one per entity per tick) nor total travel, versus the same inputs spread one-per-tick |
| AC-4 | removing input yields zero horizontal desired displacement **on the next tick** and mode idle, with `y` unchanged and heading preserved |
| AC-5 | stale route activations, duplicate movement commits and old-epoch accepted frames each count **exactly zero** across the abuse and lifecycle suites |
| AC-6 | the eight-stage ordering table (S0–S7, P03-c) holds for every executed 5.5 case and every recorded eligibility-changing arrival permutation |
| AC-7 | buffer depth never exceeds the declared bounds under sustained abuse: ≤ 32 frames/client, ≤ 64 queued discrete operations/room, ≤ 8/entity, one terminal cache ≤ 128 records and ≤ 30 s |
| AC-8 | an offender's malformed message produces no crash, no observer-visible state change and no observer trace difference |
| AC-9 | every `UDG_MOVE_TO` is refused `NAVIGATION_BUSY` (or an honest bounds/structural code first), with `routeRevision` 0 throughout and no `UDG_ROUTE_STATUS` emitted |
| AC-10 | the server probe compiles under `skipLibCheck: false` with no `any`, no cast-to-unknown, no `@ts-ignore`, no private path (`@colyseus/core/build/…`) and no private SDK field; a scan proves it, and lint's `no-explicit-any` is already an error |
| AC-11 | every API used by the shipped code has an api-map row with a probe path and a runtime test id, and rows for the not-used V1/V2 names say "not used, and why" |
| AC-12 | journal replay reproduces the per-tick canonical state digests exactly, in the same runtime, and refuses a journal whose prologue hashes differ |
| AC-13 | startup refuses: absent bounds file, malformed bounds, inverted axis range, unknown key, world/region identity mismatch with room configuration, non-finite bound, synthetic bounds without the opt-in (§4) |
| AC-14 | room disposal stops ticks and releases sessions with no post-dispose write |
| AC-15 | root commands green locally **and** in CI on the pushed submitted commit; both evidence bundles verify `PASS`; the UDG-001 and UDG-002 suites pass at the new head and every retained bundle still verifies (§5) |

Not claimed by UDG-003, and not to be marked passed: Gate A itself (needs UDG-004 and UDG-SPIKE-001), the 0.15 m correction gate (needs a client), collision and penetration (UDG-006), route traversal and query CPU (UDG-007), and every P10 threshold.

### 3.8 Required evidence

Per [evidence-requirements.md 19.1](../validation/evidence-requirements.md) and the contract: `traces/ticks.jsonl`, `traces/inputs.jsonl`, `traces/journal.jsonl` (the P03-g rows), `metrics/buffer-depth.csv`, `metrics/abuse-results.json`, `metrics/probes.json`, `metrics/tick-metrics.csv`, `docs/integration/colyseus-0.18-api-map.md` copied as an artefact, `traces/room-lifecycle.jsonl`, plus `report.json`, `environment.json`, `commands.json`, `junit.xml`, `checksums.sha256`, sanitised logs and `measurements/UDG-003.json`. `assets/` stays empty and is explained in the plan's waiver list (no region asset exists; D5).

Rules already established that this task inherits without renegotiation: capture injects `UDG_EVIDENCE_OUT` + `UDG_EVIDENCE_TASK` and only the owning task's suites write artefacts; child spawns never inherit an evidence destination; raw bundles stay out of Git, only sanitised summaries and digests are committed; runner logs stay in durable storage; CI reproduction is not claimed by a local summary; the submission stays In Review until the reviewer accepts and Gate A is signed only by the integration owner at UDG-SPIKE-001.

## 4. Starting the server with explicitly supplied, validated region bounds — no UDG-007 dependency

`@udg/config` already ships the right shape: `DEFAULT_REGION_CONFIG` carries `bounds: null`, no production default exists anywhere, and `requireRegionBounds` fails with a named issue saying bounds are supplied by the region asset (UDG-007) and validated at startup (UDG-003). UDG-003 is that validation point.

Startup sequence, each step refusing loudly:

1. Read `UDG_REGION_BOUNDS_PATH` — **required**, no embedded default. Absent is a startup error, not a fallback.
2. Parse the document and validate it with `validateServerConfig` for the config document plus `validateRegionBounds`/`configBounds` for the volume: `{worldId, regionId, bounds: {x:{min,max}, y:{min,max}, z:{min,max}}}`, exact-key check, finite numbers, `min < max` per axis, bounded ASCII identifiers.
3. Check identity against room configuration: a document naming a different `worldId`/`regionId` than the room is configured for is refused (it would otherwise serve one region's geometry under another region's name).
4. Compute and publish `configHash`, `movementHash`, `regionHash`. `computeConfigHash` hashes the whole `ServerConfig` including `region`, so a room started **with** bounds advertises a `configHash` that differs from the bounds-null default `948f8c10fc40…` recorded by UDG-002. That is correct behaviour, not drift, and the record must say so — the default digest stays asserted by UDG-002's suite over `DEFAULT_SERVER_CONFIG` and is not touched.
5. Provenance gate: the bounds document must carry `"provenance": "test-only-synthetic"` while no asset pipeline exists, and the server refuses to start with a synthetic document unless `UDG_ALLOW_SYNTHETIC_REGION=1` is set explicitly. A production-shaped startup therefore cannot silently inherit fixture geometry. The label is propagated into `environment.json`, the journal prologue and the bundle, so no downstream reader can mistake the volume for UDG-007's asset.
6. `manifestHash`: the join metadata requires a 64-hex digest and no asset manifest exists yet. Proposed: derive it from a documented synthetic document — `canonicalHash({ kind: 'udg-synthetic-manifest', label: 'test-only-synthetic', worldId, regionId, bounds, navmesh: 'absent' })` — and name it in the api-map and README as **not an asset manifest**. `validateJoin`'s hash rule is satisfied, `ASSET_MISMATCH` becomes meaningful (client and server disagree about which geometry they are talking about), and when UDG-007 ships the real manifest the value simply changes.
7. Bind and origin policy: loopback only unless an explicit allow-list is configured; a non-loopback bind without it is refused at startup; `UDG_ALLOWED_ORIGINS` defaults to the loopback origins. Ports and shutdown are documented in README as the repository contract requires.
8. Join checks then behave as [protocol.md 4.2](../interfaces/protocol.md) says: protocol version must equal `PROTOCOL_VERSION` exactly (`PROTOCOL_MISMATCH`), `configHash` must match (`CONFIG_MISMATCH`), `manifestHash` must match (`ASSET_MISMATCH`); world/region come from server room configuration and are checked against the request; `entityId` is server-assigned and never trusted from a movement payload. Movement is then additionally bounded by `isInsideBounds` against the validated volume: a destination outside it is `OUT_OF_BOUNDS` before the `NAVIGATION_BUSY` refusal, so an out-of-bounds request is reported honestly instead of as a navigation limitation, and a disallowed spawn origin is refused at join.

The only UDG-007 dependency UDG-003 has is the *absence* of real bounds, and it is expressed as a required input plus a provenance label — no import, no path assumption, no fixture from `assets/`, no claim in the `assets/` evidence directory. `pnpm assets:build`/`assets:verify` stay guarded.

## 5. Keeping UDG-001 and UDG-002 valid as the project grows

| Rule | Meaning for UDG-003 |
| --- | --- |
| R-1 accepted evidence is immutable | no edit to `docs/contracts/assignments/UDG-00{1,2}-evidence.json`, to a completion record's recorded digests, or to any retained bundle. New facts go in new records |
| R-2 no silent digest change | UDG-003 must not change `configHash`/`movementHash` semantics. Keeping abuse limits out of `ServerConfig` (D-4) is what keeps `948f8c10fc40…` and `c80f61d451ea…` true as the default-config digests. A deliberate digest change would need protocol/config-owner review, an amended record and a fixture rerun — never a quiet edit |
| R-3 amendments preserve invariants | only §3.6's amendments, each keeping a live refusal demonstration; "byte-stable UDG-001 suite" is not a requirement, "the suite still refuses what it used to refuse" is |
| R-4 fixture digests are additive | UDG-002's catalogued fixtures keep their pinned `sha256`; UDG-003 adds entries. `pnpm test:fixtures` must still refuse an unrecognised layout and a stale digest |
| R-5 historical chain, not a terminal hash | records cite the durable-store inventory **chain** (v2 → v3 → v4 → v5 → … → current) because each append embeds its predecessor's hash and the version documenting a commit's own CI run cannot exist before that commit. Current at time of writing: v9, 937 files, `3387bb789d45181e8f8201fdbb21efc07dea1cfb90df66b3b1187f5ae81431a1` |
| R-6 verify, don't assert | the completion record lists the retained-bundle verification run, including that the two deliberately-red counterexample bundles still refuse with `EVIDENCE-GATE-NOT-PASS` |
| R-7 CI on the pushed commit | local green is not submission; CI must be green on the exact pushed head, and both bundles from that run download-verify before In Review is claimed |
| R-8 status truth | UDG-003 stays In Review until the reviewer accepts; Gate A stays **Not Run**; the encoding widths stay provisional under ADR 0001 until Gate A freezes them; D4's backup destination is still undesignated and UDG-003 provisions no storage |
| R-9 boundaries hold | no `@colyseus/*` import in `@udg/protocol`'s domain/validation/mapping modules (the boundary checker already refuses that, and the schema entry point stays the only schema runtime path); `@udg/config` still imports neither Node builtins nor a browser; `apps/server` never imports `@udg/client` |

Proof at submission: `pnpm test` runs the accepted UDG-002 unit suites and `pnpm test:contract -- --task UDG-001` / `--task UDG-002` run the two accepted task suites, all unchanged in intent at the new head; `pnpm test:fixtures`, `test:boundaries`, `contracts:checksums` and `dependencies:verify` pass; every retained bundle verifies; and the completion record names the CI URL of the run on the submitted commit.

## 6. Genuine owner decisions

Everything else in this document is a recommendation the implementer can be held to. These six need the owner.

| # | Decision | Recommendation |
| --- | --- | --- |
| D-1 | **Adopt P03** as §1 drafts it — the tick/cutoff model, the precedence-then-arrival ordering with ASCII lexical entity order, the two admission predicates and the equality case, admission-versus-acceptance, the two duplicate layers, the neutral rule, the journal schema and copy-on-record rule, the ordinal bound, and P03-h's conflict resolutions — and record it in [adoption.md](adoption.md) with the contract hash. This satisfies scope.md's "P03 before UDG-003 Ready" | Adopt as drafted; no ADR (it elaborates v0.2 §5 rather than changing it). G-9's doc-comment note travels with it |
| D-2 | **Approve the pin set** in §2.1 (core `0.18.27`, schema `5.0.45` already installed, ws-transport `0.18.4`, express exact-resolved, `@colyseus/testing` excluded) **and** the phase-0 probe-first rule with its failure consequence: a failed PR-0/PR-2/PR-3 ends the task with a blocker and an ADR proposal, and specifically does **not** authorise relaxing `skipLibCheck`, substituting a private path, or writing a hand-rolled tick loop | Approve. This is the decision that keeps "an absent facility blocks Gate A; it does not authorise an alternative loop" real rather than decorative |
| D-3 | **How does UDG-003 get a client for the real transport smoke run?** A-1 currently refuses any `@colyseus/sdk` entry in the lockfile, and its register group is owned by UDG-SPIKE-001, which is Not Started — so installing the SDK for a smoke client fails the UDG-001 suite until the owner changes that group's ownership. Options: (a) select `@colyseus/sdk` with the group's `ownerTask` changed to UDG-003 and its reason text stating that transport smoke only is proven here and prediction remains UDG-SPIKE-001's; (b) use `@colyseus/testing`, whose peers drag in the SDK **and** `@colyseus/tools`, so it needs (a) plus a fourth package; (c) no real client: server-side harness only, transport-level client evidence deferred to UDG-SPIKE-001, weakening "a real server smoke run" | (a): raw `@colyseus/sdk` client, register group ownership moved to UDG-003 with the limitation stated, `@colyseus/testing` unselected. Gate A's meaning is preserved because SPIKE-001 still owns the prediction proof. (c) is the fallback if the owner prefers untouched group ownership |
| D-4 | **Where do the abuse limits live?** Payload 1024 B, 64/room, 8/entity, 40 fps with burst 40 are server policy. Putting them into `ProtocolLimits` would make them part of `configHash`, changing UDG-002's frozen default digest and telling clients that server deployment policy is shared simulation config | Keep them in `apps/server/src/server-config.ts` as validated, documented, pinned runtime policy, with their own digest recorded in evidence but **outside** `configHash`. If the owner wants clients to be able to detect server abuse policy via `configHash`, that is a `ProtocolLimits` change plus an amended UDG-002 digest record — a separate, explicit decision |
| D-5 | **Synthetic region mechanism** (§4): required `UDG_REGION_BOUNDS_PATH` with no default, mandatory `"provenance": "test-only-synthetic"` label, explicit `UDG_ALLOW_SYNTHETIC_REGION=1` opt-in, and a derived synthetic `manifestHash` documented as not-an-asset-manifest | Approve as drafted. It keeps D5's "no production defaults" true, makes the fixture geometry un-mistakable in evidence, and gives UDG-007 a one-value swap |
| D-6 | **Tooling grant list** G-1…G-10 with §3.6's amendment schedule, including A-5's fixture-kind dispatch, A-6's capture plan, A-6b's SDK-import isolation rule, A-1/A-2's dependency-register corrections and G-10's probe-typechecking project split; and whether the assignment is one task or split at the phase-0 boundary | Approve as one assignment with the phase gates in §3.2 as hard stops. Each grant names its file and its limited purpose; no grant widens functional scope, and G-9 is documentation-only |

## 7. Routine choices recommended (no decision needed, recorded so the reviewer can disagree)

| Choice | Reason |
| --- | --- |
| one continuous-frame consumed per entity per tick, oldest admitted first; drop-newest on overflow | preserves arrival order, cannot resurrect stale input, matches "never drain then simulate the last frame" |
| `entityId` order by plain `<` on ASCII identifiers, `localeCompare` banned | identifiers are bounded `[A-Za-z0-9_-]`; a locale-sensitive comparison would make iteration order host-dependent |
| `canonicalHash` from `@udg/config` for state digests | one canonical-JSON implementation already Verified; `@udg/server` may import `@udg/config` |
| probes run as child processes by the UDG-003 suite; no new root command | keeps `pnpm test`, the task suite and CI running the same code; fewer controlled paths |
| probe code typechecked by an `apps/server` project (`skipLibCheck: false`) | the root project's `skipLibCheck: true` exists for unrelated vendored declarations and must not become where third-party integration is proven |
| smoke server on `127.0.0.1` with port 0 | runner-safe, still a real transport; README documents the manual default port |
| buffer-depth assertions on **counts**, heap figures informational only | byte thresholds on shared runners are flakes; P10 owns numeric thresholds |
| no physics, no navigation, no client rendering, no persistence, no identity service | UDG-003's contract excludes them; the flat reference is a spike reference, not UDG-005's locomotion |

## 8. What this proposal does not do

It adopts nothing, assigns nothing, installs nothing, starts nothing and moves no gate. UDG-003 stays **Not Started** and unassigned until the owner records P03 adoption (D-1) and pins an assignment; Gates A, B and C stay **Not Run**; D4's independent backup destination stays undesignated, with the risk recorded as open. If the owner approves D-1…D-6, the next deliverable is the pinned UDG-003 assignment record built from §3 — and no code before that.
