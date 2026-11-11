# Colyseus 0.18 public API map (UDG-003 Phase 0)

Status: **Phase 0 record, provisional.** Every pin below is an *installed candidate* approved as a
provisional set under owner decision **D-2**, not a compatibility endorsement. Compatibility claims
come only from the probes in this table. [colyseus.md](colyseus.md) 6.1 sets the row format;
[UDG-003-phase-0.md](../contracts/assignments/UDG-003-phase-0.md) sets the scope;
[UDG-003-readiness-proposal.md](../contracts/assignments/UDG-003-readiness-proposal.md) 2.4 sets the
probe ids.

> **Decision update, 2026-11-11:** D-7 is decided. The owner adopted **D7-P1** in
> [ADR-0003](../adr/0003-input-acknowledgement-overflow-and-resynchronisation-policy.md), which accepts the per-entity
> authoritative disposition record, throttle-on-pressure and bounded closure on confirmed unrepresented retirement, with
> provisional test values and Gate A criteria GA-1…GA-13. Statements below that "D-7 stays the owner's decision" are the
> dated conclusions of the probe records that preceded it and are left as written; where the accepted record differs on the
> suspected-strand closure condition, ADR-0003 governs. `stackCompatibility` remains **not-established** and no gate has
> been run.

## 0. Compiler status, stated separately

**Status: the accepted compiler gate passes, under [ADR-0002](../adr/0002-server-declaration-checking-exception.md).
That is not a compatibility result, and `stackCompatibility` stays `not-established`.**

Three questions were being collapsed into "does it typecheck", so they are stated apart.

| question | answer today | where it is proven |
| --- | --- | --- |
| Does first-party code typecheck against the pinned declarations? | **yes** — `pnpm --filter @udg/server typecheck` and `typecheck:probes` exit 0 with 0 diagnostics, under the ADR-0002 exception | PR-0 check `accepted-typecheck-passes-under-the-exception`, artefact `probe-project-typecheck.json` |
| Are the vendor declaration defects fixed? | **no** — 27 diagnostics in 7 groups remain, listed and pinned | `pnpm --filter @udg/server typecheck:probes:full`, [colyseus-declaration-inventory.json](colyseus-declaration-inventory.json), PR-0 check `vendor-declaration-inventory-matches-the-pinned-inventory` |
| Is the pinned stack compatible at runtime? | **not established** — PR-1…PR-13 measure behaviour; Gate A is Not Run | `compatibility-verdict.json` reads `not-established` |

**The exception, and exactly how far it reaches.** `skipLibCheck: true` appears in three projects under two separate
authorities, and PR-0 pins that set so a fourth project acquiring it fails the build:

| project | authority | reason |
| --- | --- | --- |
| `apps/server/tsconfig.json` | [ADR-0002](../adr/0002-server-declaration-checking-exception.md), owner decision 2026-11-10 | the pinned Colyseus declarations (§5) are not checkable under a Node-only `lib` |
| `apps/server/tsconfig.probes.json` | ADR-0002 | the probe project imports the same stack |
| `tsconfig.json` (root tooling) | [UDG-001 decision D1](../contracts/assignments/UDG-001.md), predates this ADR | `playwright-core` declarations reference `SVGElement`/`HTMLElement`; `vitest` default-imports `node:path` |

`tsconfig.base.json` keeps `skipLibCheck: false`, and so do `packages/*`, `tools/*` and every other project.
**`apps/client` is not covered**; extending the exception there needs that project's own owner review.

**What is still checked inside the excepted projects.** `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `esModuleInterop: false`, `verbatimModuleSyntax` — everything inherited — plus every
application call against the pinned declarations. Measured before the decision (proposal §3.2–§3.5): 20 injected
first-party errors fail identically with and without the exception; `window`, `document` and `HTMLElement` still error
because `lib` is untouched; 13 of 15 invalid calls against the public API still error; 752 first-party call
expressions keep identical resolved signatures, none acquiring a type from the six defective files.

**What keeps the exception from becoming invisible**, each asserted by PR-0 rather than promised:

- the complete declaration inventory is pinned and compared — an added file, a new code, a changed count or a
  vanished entry fails (`vendor-declaration-inventory-matches-the-pinned-inventory`);
- the retained full check must still *fail*: a clean `typecheck:probes:full` would mean the pins moved and this
  record is stale (`retained-full-declaration-check-ran`);
- UDG's own emitted declarations are typechecked strictly with `skipLibCheck: false` and without importing
  `@colyseus/core`, `@colyseus/sdk` or `@colyseus/ws-transport` — `pnpm run declarations:strict`
  (`tsconfig.declarations.json`). Before it was accepted, a deliberate `UdgMissingName` reference injected into
  `packages/protocol/dist/index.d.ts` was verified to produce `TS2304` and a non-zero exit, so the check is known not
  to be vacuous;
- no suppression comment, ambient `declare global`/`declare module` shim, `any`/`unknown`/`never` cast or internal
  package import appears in the excepted projects (`exception-projects-use-no-suppression-or-shims`).

**What PR-0 does not claim**, recorded in its own result file under `explicitlyNotClaimed`: that the vendor defects
are fixed; that runtime behaviour, reconciliation or transport compatibility follows from compilation; that
`apps/client` or any other project is covered; that `build:probes` — which emits with `--noCheck` — is a build path.
`build` does not use it, and the contract suite asserts that.

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
`PR-15` is likewise not an assigned probe: it is the input-identity and acknowledgement/state-pairing feasibility
measurement the owner authorised for the D-7 decision ([§11](#11-pr-15-input-identity-gap-visibility-and-ackstate-pairing-d-7-feasibility-evidence)).
**`PR-14` is reserved** for the Gate A real-state probe specified in
[ADR-P-0003 §11](../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) and is deliberately absent from the index: the suite asserts that absence.

| Probe | Module | Question | Outcome |
| --- | --- | --- | --- |
| `PR-0` | `apps/server/probes/pr0-compile.probe.ts` | does first-party code typecheck against the pinned declarations under the accepted exception, and is that exception still exactly as approved | **passes, 49 checks** — the accepted gate exits 0 with 0 diagnostics under ADR-0002; the probe also pins the exception's scope, compares the retained vendor-declaration inventory against its pinned document, and re-checks UDG's own emitted declarations with `skipLibCheck: false`. The claim is deliberately narrower than the pre-exception one (§0) |
| `PR-1` | `apps/server/probes/pr1-graph.probe.ts` | what actually resolved, and is there one schema runtime | passes, 43 checks |
| `PR-2` | `apps/server/probes/pr2-fixed-step.probe.ts` | is there a public fixed-step facility at the advertised dt | passes, 7 checks |
| `PR-3` | `apps/server/probes/pr3-input-schema.probe.ts` | is the adopted input schema the room's declaration, with five fields intact | passes, 10 checks |
| `PR-8` | `apps/server/probes/pr8-ack.probe.ts` | which frames does one acknowledgement retire | passes, 15 checks; traces frames by identity through receipt, buffering, overflow, consumption, refusal and acknowledgement ([§4](#4-pr-8-which-frames-does-one-acknowledgement-retire-d-7-evidence)) |
| `PR-12` | `apps/server/probes/pr12-epoch.probe.ts` | what lifecycle primitives exist for a UDG-owned session epoch | passes, 6 checks; records the primitives, the renewal procedure still required and what stays unproved ([§6](#6-reclassified-ph0-b2-the-session-epoch-is-udg-owned)) |
| `PR-13` | `apps/server/probes/pr13-overflow-policy.probe.ts` | can a public, supported mechanism keep the buffer from retiring a frame the room never represented | passes, 20 checks; nine postures measured, one prevents the violation ([§9](#9-pr-13-overflow-postures-can-a-supported-mechanism-prevent-unrepresented-retirement)) |
| `PR-15` | `apps/server/probes/pr15-input-identity.probe.ts` | can the server name the client send sequence of each consumed observation, and can the client tell that the acknowledgement and authoritative state agree | passes, 27 checks; one supported identity mapping confirmed, the unnameable leading gap measured, the per-connection sequence domain measured, and ack/state delivery shown to be atomic at both cadences ([§11](#11-pr-15-input-identity-gap-visibility-and-ackstate-pairing-d-7-feasibility-evidence)) |

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
| `InputHandle.send` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` `send(): number` | [InputHandle.d.ts pinned] · [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I1-stamped-sequence-equals-the-seq-send-returns`, `I1-bodyless-sends-still-advance-the-sequence` | **passes**: returns the 1-based seq it assigned, equal to `sentCount` after the send; a no-change send is body-less and still advances the sequence (8 sends 1..8, then 9 → 10 with no field change) | returns `0` when the connection is closed, which the client must treat as "not sent" rather than seq 0 |
| `defineInput({ seqField })` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/input/types.d.ts` `DefineInputOptions.seqField` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I1-server-consumes-the-same-sequence-in-order`, `I3-a-replayed-sequence-is-dropped-before-the-buffer` | **passes**: an application-stamped monotonic field is readable on every consumed frame and matches the client's own table exactly; `at(value)` resolves a pending frame by it | it is the **application's** field, not the wire seq: the frozen `DirectInputSchema` has no per-frame monotonic field, so using this needs a protocol amendment. It also dedupes `≤ last-seen` **before** the buffer, which desynchronises the ack from `sentCount` (`I3-dedupe-desynchronises-the-ack-from-the-client-sequence`) |
| `InputAccessor.consumedCount` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/input/types.d.ts` `InputAccessor.consumedCount` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I2-consumedCount-counts-every-unrepresented-retirement-though-not-by-identity` | **passes**: `consumedCount − frames stepped` equals the client-side count of frames retired without a step (7 of 12) | it counts, it does not name: the identities of the retired frames are unobservable, and those **before the first consumed frame have no earlier endpoint to hang a gap on** (`I2-retirement-before-the-first-consumed-frame-cannot-be-named-by-the-room`) |
| `Room.patchRate` | `@colyseus/core@0.18.27` | `@colyseus/core` | `build/Room.d.ts` `patchRate: number \| null` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I7-a-slower-patch-cadence-does-not-separate-ack-from-state` | **passes**: at 250 ms against a 50 ms step, `lastProcessed` never moved without a state delivery and never ran ahead of the state watermark | loopback: a real round trip adds a window this cannot measure, so any client tolerance is expressed in patches *and* round trips and re-measured at Gate A |
| `InputHandle.lastProcessed` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` `lastProcessed` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I6-the-acknowledgement-arrives-with-a-state-delivery`, `I4-the-acknowledgement-is-not-a-usable-ordering-across-a-rejoin` | **passes**: 0 of 60 samples moved it without a state delivery, and it converged with the state watermark at rest | it is the server buffer's `consumedCount`, so it counts frames the room never stepped; across a rejoin the counters restart, so it is **not** an ordering across domains |
| `InputHandle.epoch` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` `epoch`, `reset()` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I4-a-domain-change-is-observable-to-the-client` | measured: `epoch` stayed `0` across a reconnection (0 → 0) while `sentCount` restarted (10 → 3) | so `epoch` cannot mark a rejoin for the client. PR-12 already placed session-epoch ownership with UDG; PR-15 shows the input channel does not supply a substitute |
| `InputHandle.at` / `pendingCount` / `replayBufferSize` | `@colyseus/sdk@0.18.9` | `@colyseus/sdk` | `build/input/InputHandle.d.ts` | [docs] | `apps/server/probes/pr15-input-identity.probe.ts` | `I5-acked-inputs-are-pruned-from-the-client-ring`, `I5-in-flight-inputs-are-still-replayable`, `I5-pending-count-is-derived-from-two-counters-only` | **passes**: an acked seq is gone from the client ring, an unacked seq is present, `pendingCount === sentCount − lastProcessed`, `replayBufferSize` 64 | the client-side view is two counters and a replay ring: **no disposition of any kind** reaches it |
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

**Disposition (owner decision, 2026-11-10): closed by exception, not by a fix.**
[ADR-0002](../adr/0002-server-declaration-checking-exception.md) accepts `skipLibCheck: true` for the two
`apps/server` projects, so the accepted gate now exits 0 and PR-0 reports a deliberately narrower claim (§0). The
27 diagnostics below are unchanged: they are still produced by `pnpm --filter @udg/server typecheck:probes:full`,
still inventoried in [colyseus-declaration-inventory.json](colyseus-declaration-inventory.json), and any change to
that inventory fails the build. Phase 1 remains unassigned, and nothing in §5.1–§5.3 is contradicted by the
exception — including the finding that no published pin and no TypeScript version avoids these defects. Everything
below is the record of the investigation while PH0-B1 was open, kept because it is the evidence for the decision.

`pnpm --filter @udg/server typecheck:probes` (`tsc -p tsconfig.probes.json --noEmit`) used to exit **2** with
**27 diagnostics, none in repository code**; it now exits 0, and the same project checked with `--skipLibCheck false`
(`pnpm --filter @udg/server typecheck:probes:full`) produces the inventory below. PR-0 reads both reports, and
`tests/contracts/UDG-003.test.ts` pins the same inventory in both directions, so a fix is as loud as a regression and
the shape cannot drift with the pins.

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

**Disposition of this recommendation (2026-11-10).** The owner did not accept R0 for the two `apps/server`
projects, and accepted **A4/R4** there instead, with four conditions: the retained full check, the pinned compared
inventory, the strict first-party declaration check, and a restated PR-0 (§0). R0's warning stands, now as a
recorded and accepted risk: an upstream type regression whose *exported* type degrades is invisible inside the
excepted projects, and the compensating control is the inventory comparison rather than the compiler. R1 and R2
remain uninteresting — they leave PR-0's claim unchanged in kind — and R3/R5 remain rejected. **`apps/client` was
explicitly excluded from the approval.**

**R0 — recommendation as issued on 2026-11-09: keep PH0-B1 open and change nothing.** The pinned stack stays
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
>
> **Outcome (2026-11-10):** the owner accepted this candidate for the two `apps/server` projects as
> [ADR-0002](../adr/0002-server-declaration-checking-exception.md). The repository posture is therefore no longer
> "nothing adopted": it is "excepted where documented, inventoried where excepted". PR-0 is restated rather than
> blocked, `stackCompatibility` is unchanged at `not-established`, and the exception does not reach `apps/client`
> or any project other than the two named.

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
  [§1](#1-installed-set) stay candidates: PH0-B1 was closed by an accepted compiler exception rather than by a
  release that fixes the declarations, so nothing has happened that would justify promoting a pin. The stack is
  `not-established`, and no probe result in this file should be quoted as a compatibility endorsement — including
  PR-0, which now claims only that first-party code typechecks against the pinned declarations under ADR-0002.

## 9. PR-13 overflow postures: can a supported mechanism prevent unrepresented retirement?

**Corrections applied on owner review, 2026-11-10** (the five corrections are recorded in
[ADR-P-0002 §0](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md); the replacement
recommendation is [UDG-003-input-consumption-rule.md](../adr/proposals/UDG-003-input-consumption-rule.md)). The
measurements below stand; four readings drawn from them did not.

- **C-1 — `take(n)` is not a remedy a room may choose.** Consuming more than one continuous frame per entity per tick
  amends the adopted one-input rule ([movement-authority §5.1](../interfaces/movement-authority.md)) and the v0.2 §7.1
  anti-cheat constraint. Where the table says a `take(n)` posture left 0 frames unrepresented, read it as: *this is
  what a baseline amendment would buy*, not as available configuration.
- **C-2 — "entered a step" means read by the room in a step and logged.** No locomotion step, integrator, collision
  query or authority code ran and no state field was advanced from an input value. These are identity-accounting
  results, not real-state correctness results; the real-state probe is still to be built
  ([recommendation §4.1](../adr/proposals/UDG-003-input-consumption-rule.md)).
- **C-3 — the sizing formula is a capacity condition, not a guarantee.** It bounds mean arrival against mean
  consumption; it says nothing about bursts inside a sampling interval, jitter, a step that overruns `dt`, or a sender
  that is deliberately over-rate.
- **C-4 — an obedient sender and a post-eviction disconnect are not protection.** The signal scenario assumes the
  behaviour that needs enforcing over a zero-round-trip loopback transport; the threshold and rate-limit scenarios show
  the violation occurring and then stopping.
- **C-5 — there is no continuity with "catch-up draining".** The accepted contract forbids draining a burst and
  simulating only its last frame, so no such behaviour exists in the design for any posture to be continuous with.

Numbers are from one retained CI run of a timing-sensitive probe; they are read as observed behaviour of the pinned
stack, not as constants.

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
| `Client.leave(4008)` at a threshold | 4 | 3 | yes (4008) | watermark froze at 3 of 8 sent; the 20 Hz tick acted **too late** for a 5 ms sender — enforcement after growth, never prevention (C-4) |
| `Room.maxMessagesPerSecond = 40` vs ~200/s | 4 | 29 | yes (4002) | cuts the offender off; a ceiling above the consume rate still permits growth |
| `defineInput(…, { seqField: 'generation' })` | 4 | 9 | — | the ack is still a send-order watermark |
| `Room.send(client, 'udg-backlog', …)` + obeying sender | **2** | **0** | none | 0 unrepresented **while the sender obeys**, at loopback round trip: shows the signal is expressible, not that it holds (C-4) |
| `drain()` then step the newest | 3 | 13 (3 drained without a step) | — | **rejected**: the ack jump the declarations warn about, measured |
| `take(1)` per 20 Hz step vs 40/s sender | 4 | 8 | none | an under-sized budget makes eviction unavoidable |
| `take(3)` per 20 Hz step vs the same sender | **2** | **0** | none | 0 unrepresented at this rate, **by consuming more than one frame per entity per tick — a baseline amendment, not a lever a room may pull** (C-1) |
| `defineInput(…, { sanitize })` | 4 | 9 | none | the only admission-time hook: `(input) => void` rewrites, cannot refuse |

**There is no rejection lever.** `sanitize` is the sole admission hook and returns `void`, so a room cannot refuse
an over-quota frame; no `InputAccessor` or `InputHandle` member withholds or retracts an acknowledgement (§4).

The zero-unrepresented rows were reached two ways: raising consumption to meet arrival (`take(n)`, which amends the
rule — C-1) and asking the sender to slow down (the signal, obeyed here at zero round trip). The third way is the one
that leaves the baseline intact and is the recommendation's starting point: **lower admission to meet consumption**,
i.e. admit no more continuous frames per entity than there are ticks, which makes the adopted one-frame-per-tick rule
self-draining. That is arithmetic rather than a new mechanism, and it needs an enforcement consequence for a sender
that does not comply — enforcement being detection and termination, not prevention.

**Capacity condition (necessary, not sufficient)** — from two `take` sample points plus the threshold and rate
scenarios, not a rate sweep, and never a protection claim (C-3): with a per-tick budget `n`, retention needs
`n ≥ ceil(admittedArrivalRate / stepRate)`, with `bufferMaxSize ≥ n` plus headroom for jitter, tick overrun and signal
round trip, and a declared ceiling low enough that an offender is cut off rather than accommodated. Under the adopted
rule `n = 1`, so the condition collapses to **admitted arrival rate ≤ step rate**. Buffering stayed at or below the
declared bound in every scenario: the problem was never growth, it is what becomes of what the bound drops.

**SDK proof versus UDG-SPIKE-001 proof.** PR-13 proves server-side accounting only. It does not observe client
reconciliation, and a room's own record of what it stepped is not evidence that a client stops predicting from a
retired frame: convergence after a cut-off, behaviour under loss and reconnect, and the non-zero signal round trip
of a real network stay with UDG-SPIKE-001. D-7 is unchanged: the remedy measured here is a posture in which the
acknowledgement is never asked to distinguish applied from refused from drained, not a better acknowledgement.

The recommendation built on this table is
[ADR proposal UDG-003-input-consumption-rule.md](../adr/proposals/UDG-003-input-consumption-rule.md), which keeps the
one-input rule, names the clauses a multi-input alternative would have to amend, and fixes the real-state and
adversarial evidence required before any such change. The earlier recommendation —
[ADR-P-0002](../adr/proposals/UDG-003-compiler-exception-and-input-backlog-posture.md) Part B — was **not approved**.

## 10. Compiler-policy candidate: `skipLibCheck` confined to the network-facing projects

**Disposition: accepted as [ADR-0002](../adr/0002-server-declaration-checking-exception.md) for
`apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json` only** (owner decision, 2026-11-10). `apps/client`
was expressly excluded, and every other project keeps `skipLibCheck: false` — except the root tooling project, which
has carried it since [UDG-001 decision D1](../contracts/assignments/UDG-001.md) for unrelated reasons (§0). Applied
with the conditions in §0: strict first-party checking preserved, no DOM globals, no suppression comments, no
dependency patches, no ambient shims, the full check retained as a pinned compared inventory, UDG's own declarations
kept under a strict check of their own, and PR-0 restated.

_The evaluation below is the measurement as proposed on 2026-11-09; where it says nothing is adopted, that is the
state at the time of measuring._

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

## 11. PR-15: input identity, gap visibility and ack/state pairing (D-7 feasibility evidence)

`apps/server/probes/pr15-input-identity.probe.ts` (27 checks) measures the four things
[ADR-P-0003](../adr/proposals/UDG-003-d7-input-acknowledgement-policy.md) needs before the owner can decide D-7. It runs
against the same pins on loopback, public declarations only, with a **probe-local** input declaration: the frozen
`DirectInputSchema` has no per-frame monotonic field, so the probe supplies one rather than editing the protocol.

| question | measured answer |
| --- | --- |
| Can the server name the client send sequence of each consumed observation? | **Yes, one supported way.** The client stamps `sentCount + 1` into a numeric field before `send()`; that value equals what `send()` returns, what `sentCount` reports, and what the room reads from the consumed frame, in order, across 8 sends including body-less ones. `defineInput({ seqField })` additionally makes `accessor.at(value)` resolve a pending frame by it. |
| Does that identity survive overflow? | **Partly, and the gap matters.** A retired frame leaves a hole between its neighbours (`consumed 5 then 9`, 3 sequences never stepped) and cannot be re-read (`at(6)` returns nothing). But everything retired **before the first consumed frame has no earlier endpoint**: the first consumed sequence was 5, so 4 retirements are unnameable, while `consumedCount − frames stepped = 7` counts them exactly. A gap needs two endpoints; a count needs none. |
| Does it survive a rejoin? | **No, and `epoch` does not mark the change.** Session identity is preserved while `sentCount` restarts (10 → 3) and the seat's `consumedCount` restarts with it; `handle.epoch` stayed `0`. The sequence domain is **per connection**, so the authoritative record must be keyed by UDG's own session epoch — exactly the ownership PR-12 assigned. |
| Is there a second drop path? | **Yes: `seqField` dedupe.** Replaying a sequence drops it *before* the buffer, and the room never sees it. The consequence is subtle and important: `lastProcessed` then stays permanently below `sentCount` (13 < 14, `pendingCount` stuck at 1), so neither "prune on `seq <= lastProcessed`" nor "pending reached zero, so all resolved" is a safe client rule. |
| What can the client observe after pruning? | `lastProcessed`, `sentCount`, `pendingCount` (pure arithmetic), `at(seq)` (acked seq gone, in-flight seq present), `replayBufferSize` 64. **No disposition of any kind reaches the client.** |
| Can the client pair the acknowledgement with authoritative state? | **Yes, atomically.** 0 of 60 samples moved `lastProcessed` without a state delivery at the default cadence, and 0 of 70 at `patchRate` 250 ms against a 50 ms step; neither value ever ran ahead of the other, and both converged at rest. They are one delivery, so comparing them inside one patch is legitimate — and comparing them across deliveries is the actual bug to avoid. |

**What this changes about the trigger design.** The initial hypothesis was that ordinary patch timing would open an
unsettled window needing a grace period. It does not: the acknowledgement rides the state patch, so a correctly written
client sees no skew at either cadence. The tolerance in ADR-P-0003 §10 is therefore justified by four *other* things, all
measured or contracted: a server that consumes in tick N and publishes its watermark in tick N+1 (a contract requirement
this repository must impose on itself), the per-connection sequence restart across a rejoin, the pre-buffer dedupe
desynchronisation, and a real round trip that loopback cannot measure.

**What it does not establish.** No client reconciliation, no loss, no RTT, no Gate A number, no Phase 2 behaviour, no
protocol change, and no compatibility claim — `stackCompatibility` remains `not-established` and the suite asserts it.
`PR-14` remains reserved for the real-state probe, which the contract suite also asserts.

[docs]: https://docs.colyseus.io/ 'Colyseus documentation (versionless URL; the pinned package is the authority)'
[pinned]: https://www.npmjs.com/package/@colyseus/core/v/0.18.27 'pinned package page'
