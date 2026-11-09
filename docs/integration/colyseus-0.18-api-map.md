# Colyseus 0.18 public API map (UDG-003 Phase 0)

Status: **Phase 0 record, provisional.** Every pin below is an *installed candidate* approved as a
provisional set under owner decision **D-2**, not a compatibility endorsement. Compatibility claims
come only from the probes in this table. [colyseus.md](colyseus.md) 6.1 sets the row format;
[UDG-003-phase-0.md](../contracts/assignments/UDG-003-phase-0.md) sets the scope;
[UDG-003-readiness-proposal.md](../contracts/assignments/UDG-003-readiness-proposal.md) 2.4 sets the
probe ids.

## 0. Compiler status, stated separately

Three questions are easy to conflate, so they are answered apart. Read this before any row below: the
behaviour probes run on emitted JavaScript, and none of them shows that the stack compiles.

| Question | Command | Measured | Status |
| --- | --- | --- | --- |
| Does the pinned stack typecheck under this repository's policy? | `pnpm --filter @udg/server typecheck:probes` (`tsc -p tsconfig.probes.json --noEmit`) | exit **2**; 27 diagnostics, **0 in repository code** | **BLOCKED** — PH0-B1 |
| Can the probes be executed at all? | `pnpm --filter @udg/server build:probes` (`tsc -p tsconfig.probes.json --noCheck`) | exit 0 | **diagnostic emission only** — not a compatibility claim, and deliberately excluded from `pnpm build` |
| Is the candidate stack compatible? | `artifacts/probes/compatibility-verdict.json`, mirrored into `probe-run-index.json` | `stackCompatibility: "not-established"`, `pr0: "blocked"` | **not established** |

**PR-0 carries the compiler verdict.** The strict typecheck is its compile half; while that command
exits non-zero, PR-0 reports `verdict: "blocked"` and fails, and its `ok` is `false`. A suite that
reproduces the compiler's errors is evidence *about* the failure. Reading five passing behaviour probes
as a compatible stack would be a category error, so the suite asserts the blocked verdict rather than
tolerating it.

Two findings gate Phase 1:

- **PH0-B1 (blocker)** — the pinned declarations do not typecheck under the repository compiler policy.
  Inventory, classification, remedy investigation and recommendation:
  [§5](#5-blocker-ph0-b1-third-party-declarations-do-not-typecheck).
- **PH0-B2 (reclassified — a design obligation, not a blocker and not a library defect)** — `sessionEpoch`
  is a UDG protocol concept that UDG owns; Colyseus 0.18 has no epoch concept and is not expected to
  have one. [§6](#6-reclassified-ph0-b2-the-session-epoch-is-udg-owned).

## 1. Installed set

| Package | Version | Declared by | Why |
| --- | --- | --- | --- |
| `@colyseus/core` | `0.18.27` | `apps/server` | room base class, fixed timestep, input buffers, matchmaker |
| `@colyseus/sdk` | `0.18.9` | `apps/server` | probe/transport smoke client only, owner decision **D-3**; prediction validation stays with UDG-SPIKE-001 |
| `@colyseus/ws-transport` | `0.18.4` | `apps/server` | the only transport in M0 |
| `@colyseus/schema` | `5.0.45` | `packages/protocol` | accepted in UDG-002; a required peer of `@colyseus/core` |
| `@types/express` | `5.0.4` | `apps/server` (dev) | `@colyseus/core` imports untyped `express` types |
| `@types/debug` | `4.1.12` | `apps/server` (dev) | `@colyseus/core` imports untyped `debug` |
| `@colyseus/testing` | not selected | — | owner decision **D-3** leaves it unselected |

Transitive runtime packages the server process loads but does not declare (PR-1):
`express@5.3.0`, `ws@8.22.2`, `msgpackr@2.1.4`, `debug@4.4.3`, `@colyseus/shared-types@0.18.3`, plus
`@colyseus/better-call@1.3.3`, `nanoid`, `@colyseus/timer`, `@standard-schema/spec`, `tslib`,
`msgpackr-extract@3.0.7` (native build **denied**, [§7](#7-supply-chain-posture)). pnpm's isolated
layout keeps all of these invisible to `apps/server` source, which is the boundary property UDG-001
requires: whoever imports a package must declare it.

## 2. Probe index

Phase 0 ran six assigned probes. Each is a module under `apps/server/probes/`, executed as its own process by
`tests/probes/colyseus-server.probe.ts`, and reported by `pnpm test:contract -- --task UDG-003`. `PR-13` is not an
assigned Phase 0 probe: it is the overflow/acknowledgement remedy investigation the owner authorised on 2026-11-09,
run against the same pins and reported in the same artefact ([§9](#9-pr-13-overflow-postures-can-a-supported-mechanism-prevent-unrepresented-retirement)).

| Probe | Module | Question | Outcome |
| --- | --- | --- | --- |
| `PR-0` | `apps/server/probes/pr0-compile.probe.ts` | does the pinned stack compile under the repository policy | **BLOCKED, 43 checks, `ok: false`, `verdict: "blocked"`** — the strict typecheck it reports on exits 2 with 27 third-party diagnostics (PH0-B1); its typed-reference and escape-hatch halves pass |
| `PR-1` | `apps/server/probes/pr1-graph.probe.ts` | what actually resolved, and is there one schema runtime | passes, 43 checks |
| `PR-2` | `apps/server/probes/pr2-fixed-step.probe.ts` | is there a public fixed-step facility at the advertised dt | passes, 7 checks |
| `PR-3` | `apps/server/probes/pr3-input-schema.probe.ts` | is the adopted input schema the room's declaration, with five fields intact | passes, 10 checks |
| `PR-8` | `apps/server/probes/pr8-ack.probe.ts` | which frames does one acknowledgement retire | passes, 15 checks; traces frames by identity through receipt, buffering, overflow, consumption, refusal and acknowledgement ([§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence)) |
| `PR-12` | `apps/server/probes/pr12-epoch.probe.ts` | what lifecycle primitives exist for a UDG-owned session epoch | passes, 6 checks; records the primitives, the renewal procedure still required and what stays unproved ([§6](#6-reclassified-ph0-b2-the-session-epoch-is-udg-owned)) |
| `PR-13` | `apps/server/probes/pr13-overflow-policy.probe.ts` | can a public, supported mechanism keep the buffer from retiring a frame the room never represented | passes, 20 checks; nine postures measured, one prevents the violation ([§9](#9-pr-13-overflow-postures-can-a-supported-mechanism-prevent-unrepresented-retirement)) |

Each probe result carries `verdict`: `pass`, `fail`, or `blocked` — `blocked` meaning the probe could not
be attempted as stated because a precondition of it is unmet. `pass` for a behaviour probe is not a
compatibility claim about the stack; only [§0](#0-compiler-status-stated-separately) answers that.

Machine-readable ownership for these packages lives in `docs/integration/dependencies.json`, which is
regenerated by `pnpm dependencies:record` and never hand-edited. The rules this map answers are in
`docs/integration/colyseus.md`; the assignment that bounds Phase 0 is
`docs/contracts/assignments/UDG-003-phase-0.md`; the probe ids come from
`docs/contracts/assignments/UDG-003-readiness-proposal.md` 2.4.

## 3. API rows

`Result` is what the probe recorded on 2026-11-09. A row that says *not exercised* means the symbol
resolves and typechecks but Phase 0 did not measure its behaviour; it must not be read as support for
later use.

| API | Package / version | Import path | Declaration | Official source | Probe | Runtime test id | Result | Limitations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Room` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `class Room<T>` | [Room.d.ts pinned] · [docs] | `apps/server/probes/pr0-compile.probe.ts` | `symbol:Room` | resolves; `typeof Room === 'function'` | state parameter is the *instance* type: `Room<{ state: RegionState }>`, not `typeof RegionSchema` |
| `Room.setState` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `setState(state: ExtractRoomState<T>)` | [docs] | `apps/server/probes/rooms.ts` | `room-instance-observed` | accepts `new RegionSchema()` when `T['state']` is the instance type | `ExtractRoomState<T>` reads `T['state']` directly, so the generic argument is a shape, not a class |
| `Room.setFixedTimestep` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `setFixedTimestep(intervalMs, callback)` | [docs] | `apps/server/probes/pr2-fixed-step.probe.ts` | `facility-runs`, `rate-is-20hz`, `dt-is-the-fixed-step` | **passes**: 59 steps in 3002 ms, 19.65 Hz, `dt` exactly `0.05` in every step | loopback, one room, no load; jitter under load is a later measurement |
| `StepContext` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `interface StepContext` | [docs] | `apps/server/probes/pr2-fixed-step.probe.ts` | `tick-index-is-monotonic`, `no-wall-clock-delta-is-offered` | keys exactly `dt`, `dtMs`, `tick`, `subSteps`, `subDt`; `dtMs` is derived from the fixed `dt`, never a measured interval | the context offers no measured elapsed time, which is what the authority needs; nothing in it identifies a tick to the client |
| `Room.patchRate`, `Room.unreliablePatchRate` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` | [docs] | `apps/server/probes/pr2-fixed-step.probe.ts` | `patchRateMs` observation | `patchRate` followed the timestep (50 ms), `unreliablePatchRate` stayed `null` | replication timing is UDG-003 Phase 2 scope; PR-2 only records the default |
| `Room.defineInput` | `@colyseus/core@0.18.27` | `@colyseus/core` (protected) | `build/Room.d.ts` | [docs] | `apps/server/probes/pr3-input-schema.probe.ts` | `declaration-is-the-adopted-one` | **passes**: `DirectInputSchema` accepted, declared fields exactly `sessionEpoch,generation,directIntent,moveX,moveZ` | protected, so it is exercised from a room subclass rather than probed directly |
| `this.inputs` / input buffer | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/input/RoomInput.d.ts`, `build/input/InputBuffer.d.ts` (`peek`, `next`, `drain`, `size`, `consumedCount`, `wasIdle`) | [docs] | `apps/server/probes/rooms.ts` | `frame-arrived`, `S1-buffered`, `S4-buffer-is-bounded`, `S4-overflow-evicts-the-oldest-frames` | **passes**: `next()` returns one frame or a synthesised idle with `wasIdle === true`; `drain()` empties; `bufferMaxSize` bounds the buffer **passes**, but overflow is lossy and the loss is silent: eviction counts as **consumed**, so `consumedCount` rises for frames the application never saw ([§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence)). The P03 queue policy may assume neither lossless buffering nor an acknowledgement that implies application |
| `RegisteredHandler` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/matchmaker/RegisteredHandler.d.ts` (`klass`, `options`, `name`) | [docs] | `apps/server/probes/support.ts` | `declared:@colyseus/core` | registration through `matchMaker.defineRoomType(name, handler.klass, handler.options)` works | `options` is typed `any` by the library; the probe passes it through unchanged |
| `defineRoom` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Server.d.ts` `defineRoom<T>(klass, defaultOptions?)` | [docs] | `apps/server/probes/pr2-fixed-step.probe.ts` | `room-created` | **passes** | `defaultOptions` is `Parameters<onCreate>[0]`, so a room's options type must be the single `onCreate` parameter |
| `matchMaker.defineRoomType`, `matchMaker.getAllHandlers` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/MatchMaker.d.ts` | [docs] | `apps/server/probes/pr12-epoch.probe.ts` | `handlers` registration | **passes**: registered types are readable back | process-global; probes rely on one server per process |
| `defineServer` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/index.d.ts` | [docs] | `apps/server/probes/support.ts` | `room-created` | **passes**: `{ rooms, transport }` wires matchmaking and the transport onto a supplied http server | Phase 0 always supplies its own `http.Server`; a production entrypoint may prefer `server.listen()` |
| `Server.serverless` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Server.d.ts` `serverless(): Promise<HttpServer>` | [docs] | `apps/server/probes/support.ts` | `room-created` | **passes**: binds routes without grabbing a port, so the harness can use port 0 | intended for serverless hosts; UDG-003's own entrypoint is Phase 2 |
| `Server.listen` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Server.d.ts` `listen(port, hostname?, backlog?, cb?)` | [docs] | `apps/server/probes/pr12-epoch.probe.ts` (harness variant) | `session-identity-is-issued` | resolves `undefined`; `Server` exposes **no** `endpoint` and **no** `getPort()` | the bound address must be read from the transport's declared `server` member (`transport.server?.address()`); composing a client URL from `Server` alone is impossible |
| `Server.gracefullyShutdown` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Server.d.ts` | [docs] | `apps/server/probes/support.ts` | every probe's `finally` | **passes**: shuts rooms and transport without leaving handles, so probes exit | `close()` and `unref()` do not exist on `Server` |
| `WebSocketTransport` | `@colyseus/ws-transport@0.18.4` | `@colyseus/ws-transport` | `build/WebSocketTransport.d.ts`; base `Transport.d.ts` declares `server?: http.Server` | [docs] | `apps/server/probes/support.ts` | `reachable:express-via-@colyseus/ws-transport` | **passes**: listens on an ephemeral loopback port; `transport.listen()` returns the transport, not a server | `express` is a **required peer** of the transport and optional for core; an app importing `express` itself must declare it |
| `sdk.Client` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/Client.d.ts` `new Client(settings)` | [docs] | `apps/server/probes/pr2-fixed-step.probe.ts` | `room-created` | **passes** with an `http://` base URL | a `ws://` string throws `TypeError: Invalid URL`; the harness converts, see `httpEndpoint` in `apps/server/probes/support.ts` |
| `client.create` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/Client.d.ts` `create(roomName, options?, rootSchema?)` | [docs] | `apps/server/probes/pr3-input-schema.probe.ts` | `room-created`, `session-id-matches-server` | **passes**; the state schema must be passed as the third argument for patches to decode | generic overloads are awkward: the root-schema overload is the one that typechecks against a built schema class |
| `room.reconnectionToken` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/Room.d.ts` | [docs] | `apps/server/probes/pr12-epoch.probe.ts` | `reconnection-token-is-a-credential` | token present (length recorded, value never written) | a credential: excluded from evidence, logs and journals by rule, and the suite asserts no token value is serialised |
| `client.reconnect` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/Client.d.ts` `reconnect(token, rootSchema?)` | [docs] | `apps/server/probes/pr12-epoch.probe.ts` | `reconnection-is-public-and-exercised`, `reconnectPreservesIdentity` | **passes** only when the room called `allowReconnection`; the same `sessionId` comes back | without a server-side seat the failure is `reconnection token invalid or expired`, which looks like a transport error but is not |
| `Room.allowReconnection` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `allowReconnection(previousClient, seconds \| "manual")` | [docs] | `apps/server/probes/rooms.ts` (`SessionRoom.onLeave`) | `serverSideReconnections` | **passes**: one redeemed seat, identity preserved | preserving identity is the opposite of epoch renewal — see PH0-B2 |
| `Room.autoDispose` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` | [docs] | `apps/server/probes/rooms.ts` | `reconnection-is-public-and-exercised` | must be `false` for a reconnection window to be observable | a room that disposes with its last client answers `room "…" has been disposed` |
| `sdk room.input` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/Room.d.ts` `input<T>()` | [docs] | `apps/server/probes/pr3-input-schema.probe.ts` | `all-five-fields-preserved` | **passes**: `handle.data` is a mutable frame object; `send()` returns the frame's sequence number | mutating `handle.data` in place is the supported shape; the SDK transmits a delta, so an unchanged repeat frame decodes to the previous values |
| `InputHandle` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` (`data`, `mode`, `tickRate?`, `stepSeconds?`, `stepMs?`, `patchRate?`, `subSteps`, `subStepSeconds?`, `subStepMs?`, `send()`, `onSend()`, `reset()`, `epoch`, `lastProcessed`, `sentCount`, `pendingCount`, `replayBufferSize`, `at()`, `reckonTimeAt()`) | [docs] | `apps/server/probes/pr8-ack.probe.ts` | `S1-ack-does-not-follow-receipt`, `S2-ack-names-the-applied-frame`, `S3-refusal-is-invisible-to-the-ack`, `S3-no-public-way-to-withhold-or-retract-an-ack` | **passes**; 13 members, and **none controls, withholds or retracts an acknowledgement** | see [§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence) |
| `InputHandle.lastProcessed` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` | [docs] | `apps/server/probes/pr8-ack.probe.ts` | `S4-ack-is-a-sequence-watermark-not-a-per-frame-disposition`, `S4-dropped-frames-ARE-retired-by-the-ack`, `S4-client-prunes-dropped-frames-without-knowing-they-were-dropped` | a **sequence watermark**, not a per-frame disposition: measured equal to the server `consumedCount`, with `pendingCount === sentCount - lastProcessed`, retiring every `seq <= lastProcessed` (`handle.at()` then returns `undefined`) | received != acked (S1), but applied = refused = dropped once retired; a synthesised idle frame moves neither counter (S5). D-7 is the owner's decision |
| `InputBuffer.ackSeq` | `@colyseus/core@0.18.27` | not reachable from `this.inputs` | `build/input/InputBuffer.d.ts` only | [docs] | `apps/server/probes/pr8-ack.probe.ts` | `S4-ack-value-is-not-observable-through-the-public-room-accessor` | the value the library acknowledges with is declared **only** on the internal `InputBuffer`; the room-facing accessor exposes `consumedCount` but not the ack | a room cannot read the acknowledgement it is causing, so an application cannot log or gate on it without reaching into library internals - which UDG does not do |
| `Room.onJoin` / `onLeave` / `onDrop` client type | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `onLeave(client: ExtractRoomClient<T>, code?)`; `Client` is exported from the entry point | [docs] | `apps/server/probes/rooms.ts` | `reconnection-is-public-and-exercised` | **passes with the declared type**: the callbacks are typed `ServerClient` (an alias of the exported `Client`) and the client is handed to `allowReconnection(client, 10)` uncast | an earlier submission typed the parameter `never` to force a call through; a `never` cast satisfies any parameter type and hides exactly the signature mismatch PR-0 exists to report, so it is now banned by the escape-hatch scan |
| `registerSerializer` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/serializer/Serializer.d.ts` `registerSerializer(id, serializer)` | [docs] | `apps/server/probes/pr3-input-schema.probe.ts` | `all-five-fields-preserved` | the SDK entry module registers `'schema'` → `SchemaSerializer` itself, so a Node client needs no call | the two-argument form is easy to mistake for one; passing only the serializer is a compile error, which is the good outcome |
| `SchemaSerializer` + `@colyseus/schema@5.0.45` | `5.0.45` | `@colyseus/schema` (via `@udg/protocol/schema`) | `build/index.d.ts` | [docs] | `apps/server/probes/pr1-graph.probe.ts` | `one-schema-runtime`, `single-schema-version` | **passes**: one schema directory resolves for `@udg/protocol`, core, sdk and the transport; lockfile holds `5.0.45` only | two copies would mean two registration domains; PR-1 exists to catch that before Phase 1 |
| `validate` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/index.d.ts` | [docs] | `apps/server/probes/pr0-compile.probe.ts` | `symbol:validate` | resolves; **not exercised** | UDG validation is `@udg/protocol`; this row exists so nobody assumes the library validator is the trust boundary |
| Wire codec behaviour | `msgpackr@2.1.4` (via core) | not importable from `apps/server` | — | [docs] | `apps/server/probes/pr3-input-schema.probe.ts` | `malformed-frame-survives-the-transport`, `validator-refuses-what-the-codec-coerced` | out-of-domain integers are **truncated modulo 2³²** (`2³²+7` → `7`), `NaN` arrives as `null`, and `validateDirectFrame` refuses with `INVALID_PAYLOAD` | the schema is not the trust boundary; the room declares no `sanitize` option on purpose, because it would rewrite values before validation |

## 4. PR-8: which frames does one acknowledgement retire? (D-7 evidence)

The first submission read these numbers as counts and reached the wrong conclusion. The corrected probe
traces **frame identities** instead: every frame carries a distinct `generation`, every `send()` returns
the client `seq` that the acknowledgement later compares against, and the probe room logs every step it
represented in state (`frame` for an applied frame, `neutral` for the authoritative neutral input that
steps in a refusal's place).

| Scenario | Identities observed |
| --- | --- |
| **S1** three frames sent, nothing consumed | sent generations `1,2,3` at seqs `1,2,3`; buffer holds `1,2,3`; `consumedCount 0`; `lastProcessed 0`; **no step represented** |
| **S2** consume one and apply it | `consumedCount 1`, `lastProcessed 1`; the watermark retires **exactly generation 1** (`retiredGenerations [1]`); room logged `frame:1`; `2,3` still pending |
| **S3** consume one, then **refuse** it | `consumedCount 1`, `lastProcessed 1` — the refusal is invisible to the ack; the room still stepped `neutral:1`, so **state advanced** without the refused intent |
| **S4** `bufferMaxSize 2`, six frames sent, nothing consumed | buffer holds `5,6`; `consumedCount 4`; `lastProcessed 4`; `pendingCount 2 = sentCount 6 - lastProcessed 4`; the watermark retires `1,2,3,4`; those four are **dropped** — they appear in no step; the client can still replay only `5,6`, because every `seq <= 4` returns `undefined` from `handle.at()` |
| **S5** synthesised idle frame | `wasIdle true`; server `0 → 0`, client `0 → 0` — an idle frame is not a client input |

**What one acknowledgement is.** A single integer over the client's send order — measured equal to the
server buffer's `consumedCount`, matching the pinned declarations, which state that `consumedCount`
counts inputs removed from the pending set "via any consume primitive … plus clear and overflow …
**whether applied to state or discarded**", and that the client should "prune your pending inputs against
it (`seq <= lastProcessed`)". It retires a prefix of frames and carries **no per-frame disposition**.

**Corrected conclusion (S4).** The first submission recorded `S4-droppedFramesAcked: false`, from
`clientLastProcessed + bufferSize < clientSent`. That expression evaluates `4 + 2 < 6`, which is false
precisely because *every* frame was accounted for — four retired, two still pending. Overflow eviction
advances `consumedCount`, so the four surplus frames **were** retired by the acknowledgement. Totals
cannot distinguish "nothing was dropped" from "dropped and acknowledged"; the identity trace can, and it
says they were dropped and acknowledged. The original numbers and the expression that misread them are
kept in the probe result under `S4_supersededFirstReading`, and the bundle from CI run `42678254682` is
retained unchanged in the durable store — this is a correction on the record, not a rewrite of it.

**Refused is not the same as dropped, and the ack cannot tell them apart:**

| | represented in state? | retired by the ack? | client can tell? |
| --- | --- | --- | --- |
| applied frame | yes, with its own intent | yes | no |
| refused frame | yes, as an authoritative **neutral** step; the intent did not move anything | yes | no |
| dropped frame (overflow) | **no step at all** | yes | no |

So the pinned acknowledgement separates *received* from *consumed*, and does **not** separate *applied*
from *refused* from *dropped*. There is no public API to withhold, retract or qualify an acknowledgement
(measured across the 13 members of `InputHandle`), and the room cannot even read the ack value it causes.

**D-7 stays the owner's decision.** The prohibition "never acknowledge a frame that was never represented
in state" is not waived here, and S4 shows it is violated by the library's own accounting for dropped
frames. What the application can carry instead is a **per-frame journal** — generations applied,
generations neutralised, generations that never arrived. That journal is server-side evidence: it shows
what the server stepped. It does **not** prove client reconciliation, because the client prunes on the
watermark alone and is never told to stop predicting from a retired frame. Proving convergence there is
UDG-SPIKE-001's work, and PR-8 deliberately does not claim it.
## 5. Blocker PH0-B1: third-party declarations do not typecheck

`pnpm --filter @udg/server typecheck:probes` (`tsc -p tsconfig.probes.json --noEmit`, inheriting
`tsconfig.base.json` unchanged) exits **2** with **27 diagnostics, none in repository code**. PR-0 reads
that report and reports itself blocked; `tests/contracts/UDG-003.test.ts` pins the same inventory in both
directions, so a fix is as loud as a regression and the shape cannot drift with the pins.

| Declaration file | Code | Count | Cause |
| --- | --- | --- | --- |
| `@colyseus/better-call@1.3.3/dist/context.d.mts` | `TS2304` | 18 | references `HeadersInit` |
| `@colyseus/better-call@1.3.3/dist/endpoint.d.mts` | `TS2304` | 1 | references `HeadersInit` |
| `@colyseus/better-call@1.3.3/dist/error.d.mts` | `TS2304` | 3 | references `HeadersInit` |
| `@colyseus/sdk@0.18.9/build/HTTP.d.ts` | `TS2304` | 1 | references `HeadersInit` |
| `@colyseus/sdk@0.18.9/build/HTTP.d.ts` | `TS2344` | 2 | a generic constraint its own declaration does not satisfy |
| `@colyseus/core@0.18.27/build/router/node.d.ts` | `TS1192` | 1 | default-imports `node:http` |
| `@colyseus/ws-transport@0.18.4/build/WebSocketTransport.d.ts` | `TS1192` | 1 | same |

### 5.1 Classification: two type-environment mismatches, one upstream defect

| Class | Diagnostics | What it actually is | Fixable by configuration? |
| --- | --- | --- | --- |
| **A.** `HeadersInit` not found (23) | `TS2304` | The libraries emit declarations that use the **DOM lib's global** `HeadersInit`. `@types/node@24.19.2` exposes `Headers` as a global but **not** `HeadersInit`; `undici-types@7.24.6` exports it as a module member, and `undici-types` is not importable from `apps/server` (`TS2307`) | Yes — but every route either loads DOM globals or hand-declares a global (§5.3) |
| **B.** `Module '"http"' has no default export` (2) | `TS1192` | The libraries **default-import a Node builtin in their own declarations**, which requires `allowSyntheticDefaultImports`/`esModuleInterop`. Their published types assume a consumer policy UDG has deliberately not adopted | Yes, only by relaxing that policy (§5.3) |
| **C.** `UnionToIntersection<MethodOptions<API, "DELETE">>` constraint (2) | `TS2344` | A **declaration defect inside `@colyseus/sdk`**: its own mapped type does not satisfy its own constraint. No consumer setting is involved | **No** — not by any setting except `skipLibCheck`, which hides everything |

### 5.2 Would different pins avoid it? (investigated first, nothing installed or adopted)

Registry metadata and published tarballs inspected on 2026-11-09 — declaration files read from the
tarballs, no install, no lockfile change:

| Package | Current pin | Newer version? | Defect present in every published candidate? |
| --- | --- | --- | --- |
| `@colyseus/core` | `0.18.27` | **none** — latest published | Yes: `0.18.20` … `0.18.27` all depend on `@colyseus/better-call@^1.3.1`, which carries class A |
| `@colyseus/sdk` | `0.18.9` | **none** — latest published | Yes: `0.18.6` … `0.18.9` all reference `HeadersInit` in `build/HTTP.d.ts` and carry class C |
| `@colyseus/ws-transport` | `0.18.4` | **none** — latest published | Yes: `0.18.2` … `0.18.4` all default-import `http` |
| `@colyseus/better-call` | `1.3.3` (resolved by core) | **none** — latest published | Yes: `1.2.1` … `1.3.3` all use `HeadersInit` in 6 declaration files |
| `typescript` | `5.9.3` | `6.0.3`, `7.0.2` | Not a route: see below |

TypeScript is not a route either. Measured on this probe project: `5.8.3` → the same 27 diagnostics;
`6.0.3` and `7.0.2` → the same 25 (`TS2304` ×23 + `TS2344` ×2) **and they cannot even read the repository
config as written** — `TS5107`/`TS5108`: `esModuleInterop=false` is deprecated in 6 and **removed** in 7.
An upgrade therefore clears class B only by surrendering a setting the owner listed as non-relaxable, and
leaves classes A and C untouched.

**Conclusion: PH0-B1 is not a version-pinning accident.** It is a property of the whole published 0.18
line, and no combination of available versions closes it.

### 5.3 Measured remedies (all measured outside the repository; **none adopted**)

Scratch configs in a throwaway directory extending `apps/server/tsconfig.probes.json` unchanged, one
variable at a time, `tsc 5.9.3`:

| Variant | Diagnostics | Exit | What it costs |
| --- | --- | --- | --- |
| as committed | **27** (23 `TS2304`, 2 `TS2344`, 2 `TS1192`) | 2 | — |
| `lib: ["ES2024","DOM"]` | 4 | 2 | 23 cleared, **DOM globals become legal in first-party Node code** |
| `allowSyntheticDefaultImports: true` | 25 | 2 | clears class B; permits default-importing modules with no default export |
| ambient `HeadersInit` global, nothing else | 4 | 2 | clears class A without DOM; still a hand-declared global standing in for a library's emission choice |
| shim **+** `allowSyntheticDefaultImports` | **2** | 2 | the floor short of `skipLibCheck`; **class C survives** |
| `skipLibCheck: true` | 0 | **0** | every third-party type error invisible, including ones that would matter to UDG |

The DOM cost is not hypothetical. The same two-line file, two configs:

```ts
export const leaked: number = window.innerWidth;
export const alsoLeaked: typeof fetch = fetch;
```

`lib: ["ES2024","DOM"]` → **compiles clean**. As committed → `error TS2304: Cannot find name 'window'`.
Server code that can name `window` at compile time is a class of bug the Node workspace exists to prevent,
and it would quietly split first-party behaviour from the probe project's.

### 5.4 Recommendation (owner decision; nothing below is adopted)

**R0 — recommended: keep PH0-B1 open and change nothing.** The pinned stack stays
`stackCompatibility: not-established` and Phase 1 stays unassigned. Cost: probe JavaScript keeps running
through `--noCheck` as measurement only. Upstream actions worth opening: (i) Colyseus emitting
declarations that do not require the DOM lib for a Node target (class A), (ii) `@colyseus/sdk`'s
`HTTP.d.ts` constraint (class C), (iii) default-importing `node:http` in published `.d.ts` files
(class B). Re-measure by bumping pins when a release lands; the pinned inventory turns a fix into a loud
event.

**R1 — narrow, needs approval: probe-project-only ambient `HeadersInit`.** 27 → 4. Precisely what it
changes: one global **type alias** in a `.d.ts` included by `tsconfig.probes.json` alone — no runtime
code, no DOM globals (`window` still errors), no suppression, and no hidden errors: the alias is itself
typechecked at every use site. Honest limits: it asserts a shape the library did not declare, so a
mismatch there is UDG's problem, and **it does not make PR-0 pass** — classes B and C remain.

**R2 — narrow, needs approval: probe-project-only `allowSyntheticDefaultImports: true`.** 27 → 25.
Type-only; it changes no emit, and `import http from 'http'` *is* valid at Node ESM runtime, so class B
is arguably a declaration-emission complaint rather than a real defect. Its cost is exactly what the
policy exists to prevent: first-party code could then default-import an ESM module with no default
export and typecheck. Confined to the probe project the exposure is small, but **it does not make PR-0
pass**, and it weakens the one setting that keeps `esModuleInterop: false` meaningful.

**R1 + R2 together: 27 → 2. PR-0 still fails.** That is the decisive fact: **no configuration short of
`skipLibCheck` clears PH0-B1**, and `skipLibCheck` is forbidden — it would hide the next real mismatch
between a pinned declaration and UDG's code, which is the failure mode Phase 0 exists to catch.

**R3 — rejected: `lib: DOM`.** Demonstrated above: it imports a second global namespace into Node code.

**R4 — rejected: `skipLibCheck: true`.** Turns the compiler off for third-party surfaces; makes the
inventory vanish by destroying the instrument.

> **Measurement note (2026-11-09, owner Route 1).** After this recommendation was written the owner authorised
> measuring `skipLibCheck` as a *candidate* confined to the Colyseus-facing projects, so it is no longer
> unexamined. The two paragraphs above stand as written on the evidence then available, and **R4 remains the
> repository posture**: nothing is adopted, PR-0 stays BLOCKED under the committed policy, and the recommendation
> in the proposal is still R0. What changed is only that the candidate now has measurements — what it hides,
> what it demonstrably keeps checking, which projects would need it, and its residual risk — recorded in
> [§10](#10-compiler-policy-candidate-skiplibcheck-confined-to-the-network-facing-projects) and in
> [ADR-P-0002 Part A](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md).

**R5 — rejected: a package patch or vendored `.d.ts`.** Editing a pinned dependency's declarations
means UDG maintains a fork of the type surface, and the dependency register would describe a package
that no longer matches its pinned tarball.

Whatever the owner decides, **the candidate stack cannot be accepted as compatible on the current
evidence**, because class C is a defect in a library's own published types and no approved lever reaches
it.
## 6. Reclassified PH0-B2: the session epoch is UDG-owned

The first submission recorded this as a **blocker** — "the pinned set has no epoch-renewal API". That was
the wrong classification. `sessionEpoch` is a **UDG protocol concept**: the server assigns it, the server
validates it, and the server decides when it is renewed. Colyseus 0.18 has no epoch concept and is not
expected to have one, so its silence is a boundary, not a defect. The identifier stays for traceability,
with the status **Reclassified — design obligation, not a blocker**; it does not gate Phase 1.

**Supported lifecycle primitives PR-12 measured:**

| Primitive | Measured behaviour | Use for an application epoch |
| --- | --- | --- |
| `client.create()` | issues a fresh server-assigned `sessionId` per join | the point at which UDG can stamp a new epoch |
| `client.reconnectionToken`, `client.reconnect()` | **preserves** the identity; the same `sessionId` returns | explicitly *not* renewal — a rejoin must decide whether the epoch is reused |
| `Room.allowReconnection(client, seconds)` | required server-side consent; without it `reconnect()` is refused with `reconnection token invalid or expired` | the consent gate an epoch policy can attach to |
| `Room.onLeave` / `Room.onDrop` | leave with a code, and transport loss without one (measured `leaveCode 1006` on an abrupt close) | the two rejoin paths UDG must treat identically |
| `Room.autoDispose = false` | otherwise the room disposes with its last client and answers `room "…" has been disposed` | a precondition for any reconnection window |
| `InputHandle.reset()`, `InputHandle.epoch` | client-side input bookkeeping: `epoch 0 → 1` on `reset()`, session identity unchanged | **not** the protocol epoch and not a renewal call |

**The renewal procedure UDG still has to build** (specified, deliberately **not implemented** in Phase 0;
its home is UDG-003 Phase 2 `DevelopmentSessions`):

1. issue `sessionEpoch` server-side at the join boundary, next to the `sessionId` the library provides;
2. carry it in every frame and command, and refuse stale epochs through the admission rules already in
   `@udg/protocol`;
3. decide per rejoin whether this is the same session (token reconnection) or a new one (new epoch), and
   record which;
4. publish the epoch to the client through authoritative state, so prediction restarts with it;
5. renew on `RESYNC_REQUIRED` and on generation-domain exhaustion, staying inside `EPOCH_MAX`
   (`4_294_967_295`) with no wrap.

**What remains unproved:** whether a reconnection token can be revoked before its TTL expires; whether an
`allowReconnection` seat survives a restart (Phase 0 has no persistence); whether the epoch can reach the
client atomically with the state patch that follows renewal; behaviour under restart, loss, or multiple
processes; and how an input-handle reset should interact with an epoch change. `handle.reset()` must not
be used as part of a renewal procedure.

## 7. Supply-chain posture

`pnpm-workspace.yaml` denies dependency build scripts, and pnpm 12 enforces that with
`ERR_PNPM_IGNORED_BUILDS` rather than a warning. `msgpackr-extract@3.0.7` — pulled transitively by the
D-2 pin set — is denied by name (`allowBuilds: msgpackr-extract: false`), so **no dependency build
script runs in this repository** and `msgpackr` uses its pure-JavaScript decoder. PR-1 asserts the
denial by name. Letting the native addon build is a separate owner decision (amendment A-11 in the
Phase 0 assignment), and would need its own evidence.

## 8. What Phase 0 did not establish

- Nothing about prediction, rollback or client reconciliation. `@colyseus/sdk` is present only as a
  transport smoke client under **D-3**; UDG-SPIKE-001 owns prediction validation.
- Nothing about replication timing, client-side interpolation, or behaviour under loss, latency,
  reconnection under load, or multiple processes.
- Nothing about `@colyseus/testing` (unselected) or any transport other than `ws-transport`.
- Nothing about client reconciliation. [§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence)
  shows the client prunes on the watermark alone; an application journal records what the server stepped
  and is **not** evidence that a client stops predicting from a retired frame. UDG-SPIKE-001 owns that.
- No gate. Gate A stays **Not Run**, encoding widths stay provisional under ADR 0001, and the pins in
  [§1](#1-installed-set) stay candidates until the owner resolves PH0-B1. The stack is
  `not-established`, and no probe result in this file should be quoted as a compatibility endorsement.

## 9. PR-13 overflow postures: can a supported mechanism prevent unrepresented retirement?

[§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence) proved the acknowledgement retires an
evicted frame as though it had been simulated. PR-13 asks the preventive question, with the same pins and public
API only. Two identity sets decide every scenario:

- **`ackedUnrepresented`** — sent frames whose seq the client's `lastProcessed` retires although their values never
  entered a solver step. Non-empty **is** the prohibition being violated.
- **`unackedUnrepresented`** — frames that vanished without acknowledgement: the residue a reconnection must
  resolve truthfully.

| posture | peak backlog (bound 4) | `ackedUnrepresented` | disconnect | conclusion |
| --- | --- | --- | --- | --- |
| none (5 ms sender) | 4 | 8 of 14 acked | — | the failure, reproduced; the bound held |
| `InputAccessor.clear()` at a threshold | 4 | 14 (`consumedCount` 10 → 14) | — | moves the same watermark: **not a remedy** |
| `Client.leave(4008)` at a threshold | 4 | 3 | yes (4008) | watermark froze at 3 of 8 sent; the 20 Hz tick acted **too late** for a 5 ms sender |
| `Room.maxMessagesPerSecond = 40` vs ~200/s | 4 | 29 | yes (4002) | cuts the offender off; a ceiling above the consume rate still permits growth |
| `defineInput(…, { seqField: 'generation' })` | 4 | 9 | — | the ack is still a send-order watermark |
| `Room.send(client, 'udg-backlog', …)` + obeying sender | **2** | **0** | none | **prevention**, 0 frames sent inside the signal window at loopback |
| `drain()` then step the newest | 3 | 13 (3 drained without a step) | — | **rejected**: the ack jump the declarations warn about, measured |
| `take(1)` per 20 Hz step vs 40/s sender | 4 | 8 | none | an under-sized budget makes eviction unavoidable |
| `take(3)` per 20 Hz step vs the same sender | **2** | **0** | none | **prevention**: all 24 sent frames entered a step |
| `defineInput(…, { sanitize })` | 4 | 9 | none | the only admission-time hook: `(input) => void` rewrites, cannot refuse |

**There is no rejection lever.** `sanitize` is the sole admission hook and returns `void`, so a room cannot refuse
an over-quota frame; no `InputAccessor` or `InputHandle` member withholds or retracts an acknowledgement (§4).
Prevention comes from matching consumption to the admitted rate, which is what the declarations themselves
recommend for a shared world: `take` a bounded few and sub-step, "the ack then === inputs actually simulated;
`drain()`-then-apply-latest would silently jump the ack past inputs the server never simulated" — N7 measures that
warning instead of quoting it.

**Measured sizing rule** (from the two `take` points plus the threshold and rate scenarios; not a rate sweep):
`n ≥ ceil(admittedArrivalRate / stepRate)`; `bufferMaxSize ≥ n` plus jitter and signal round-trip headroom;
`maxMessagesPerSecond ≤ n × stepRate` so an offender is cut off rather than accommodated. Buffering stayed at or
below the declared bound in every scenario: the problem was never growth, it is what becomes of what the bound
drops.

**SDK proof versus UDG-SPIKE-001 proof.** PR-13 proves server-side accounting only. It does not observe client
reconciliation, and a room's own record of what it stepped is not evidence that a client stops predicting from a
retired frame: convergence after a cut-off, behaviour under loss and reconnect, and the non-zero signal round trip
of a real network stay with UDG-SPIKE-001. D-7 is unchanged: the remedy measured here is a posture in which the
acknowledgement is never asked to distinguish applied from refused from drained, not a better acknowledgement.

The recommendation built on this table, and the four-item architectural decision it implies, are in
[ADR proposal ADR-P-0002](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) Part B.

## 10. Compiler-policy candidate: `skipLibCheck` confined to the network-facing projects

The measured evaluation of the owner's Route 1 — what the exception hides, what it keeps checking, which projects
would need it, and the residual risk — is in
[ADR-P-0002](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) Part A. Nothing is adopted;
[§5](#5-blocker-ph0-b1-third-party-declarations-do-not-typecheck) and §5.4 remain the blocker record, and PR-0 stays
**BLOCKED** under the committed policy. The two facts worth carrying here:

- the exception demonstrably keeps checking first-party code and application calls (20 first-party diagnostics
  identical with and without it, 13 of 15 invalid public-API calls still error, `window`/`document`/`HTMLElement`
  still unavailable) and hides only the inside of declaration files;
- it is not narrow. Measured per minimal import: `@udg/protocol` and `@udg/protocol/schema` need nothing (0
  diagnostics); `apps/server` needs it for 23–26 diagnostics depending on entry; `apps/client` needs it for 3 of
  its own once it imports `@colyseus/sdk`, because 22 of the 23 `HeadersInit` diagnostics are an artefact of the
  server's Node `lib` and vanish under the client's existing DOM `lib`.

[docs]: https://docs.colyseus.io/ 'Colyseus documentation (versionless URL; the pinned package is the authority)'
[pinned]: https://www.npmjs.com/package/@colyseus/core/v/0.18.27 'pinned package page'
