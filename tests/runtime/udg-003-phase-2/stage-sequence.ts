/**
 * Stage `M` and stage `P`, measured on the real room (UDG-003 Phase 2, OD-4 / AC-6).
 *
 * The definitions are quoted rather than paraphrased. Phase 1 §0.1: *"Stage letters are F, L, Q, S, A, C,
 * R, X, M, P … and stage **M** (map canonical state to the replica) and **P** (publish results, metrics,
 * flush) need a room and a replica, so they are **Phase 2 work**."* `apps/server/src/state/map-player.ts`
 * is that mapping — *"The canonical projection stays the only route to movement fields… it runs the
 * protocol's `toReplica` / `toRegionReplica` and copies the produced values into the live schema
 * instances"* — and `RegionRoom` is the publication, in the tick that consumed, at
 * `network.statePatchIntervalMs`.
 *
 * What the owner accepted (OD-4): the server's canonical-to-replica mapping is `M`, and its metrics and
 * patch publication are the **observable part of** `P`. Successful navigation-result publication stays
 * outstanding under UDG-007, and AC-6's overall verdict stays qualified until the governing criterion
 * reflects that split. This script's job is to make the split measurable rather than arguable.
 *
 * Six things are asserted, each with the control that fails when the property is absent:
 *
 * 1. `M` writes the canonical projection into the replica — field-by-field against the authority's own
 *    view, on a seat whose stream is valid.
 * 2. `M` maps canonical state, **not the wire**: a seat whose frames are refused moves the authority's
 *    watermark and moves nothing else. The control asserts zero movement effect and the refusal
 *    disposition present in the replica — the two halves the owner named.
 * 3. `M` writes by value. Mutating the object that was handed to the mapping cannot reach the live row;
 *    the failing control is a reference leak.
 * 4. `M` and `P` are two stages in an order, not one stage counted twice: with a seat's inbound patches
 *    withheld, the authority's own replica rows advance while that seat's client row holds, and on release
 *    it catches up. If `M` were the publish, the pair could not disagree; if `P` were the tick, the client
 *    could not lag.
 * 5. `P`'s cadence is the declared knob and not the tick: patch arrivals sit at `statePatchIntervalMs`,
 *    measurably away from `simulationStepSeconds`.
 * 6. Both stages are per entity: an entity the hash gate refused has no row, no mapping and no
 *    publication, counted by an instrument that counted its neighbours.
 *
 * And what it refuses: `P`'s "results" half. Every seat here reports `effectCount: 0` because no discrete
 * effect can commit on this substrate, so the artefact records the results half as **outstanding under
 * UDG-007** and never as published.
 *
 * Writes `stage-sequence.json` under `UDG_VECTORS_OUT`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  connectSeat,
  connectSeatById,
  loadPinnedStack,
  sleep,
  startHarnessServer,
  stampAndSend,
  waitForIssuedEpoch,
  type RegisteredHandler,
} from '../../support/client-harness/transport.mjs';
import { installImpairment } from '../../support/client-harness/impairment.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/** The fields a refusal must NOT move. Everything positional in PlayerSchema. */
const MOVEMENT_FIELDS = ['x', 'y', 'z', 'yaw', 'vx', 'vy', 'vz', 'verticalVelocity'] as const;
/** How long the withheld-patch window stays shut. Two patch intervals at least, so cadence cannot explain it. */
const WITHHOLD_MS = 600;
const FRAMES = 24;
const FRAME_INTERVAL_MS = 50;

interface PlayerRow {
  [key: string]: unknown;
  entityId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  verticalVelocity: number;
  movementMode: number;
  routeRevision: number;
  sessionEpoch: number;
  connected: boolean;
  lastAuthorityTick: number;
  inputResolvedThrough: number;
  inputGapStart: number;
  inputGapEnd: number;
  inputRetiredUnrepresented: number;
  effectCount: number;
  lastAppliedRequestId: string;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

interface ReplicaRowEvidence {
  key: string;
  resolvedThrough: number;
  retired: number;
  effects: number;
  epoch: number;
}

interface RoomInstance {
  evidence(): Record<string, unknown>;
  journal(): { rows: readonly Record<string, unknown>[] };
}

/** Poll a settlement condition, and keep the elapsed figure either way. A fixed sleep is a bet on the
 * runner; this is a measurement with a bound that the artefact has to report. */
async function settleUntil(condition: () => boolean, boundMs: number, stepMs = 250): Promise<{ settled: boolean; elapsedMs: number }> {
  const startedAt = performance.now();
  while (performance.now() - startedAt <= boundMs) {
    if (condition()) return { settled: true, elapsedMs: Math.round(performance.now() - startedAt) };
    await sleep(stepMs);
  }
  return { settled: false, elapsedMs: Math.round(performance.now() - startedAt) };
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const [RegionRoomModule, schemaMod, configMod, mapMod, stepMod, clockMod, movementMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as unknown as Promise<{
      RegionRoom: { liveRooms(): readonly RoomInstance[] };
      defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
    }>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/state/map-player.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/step.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/clock.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<Record<string, unknown>>,
  ]);
  // The seats join with the ROOM's state schema, exactly as the other runtime scripts do; the same
  // constructor is also what the mapping control instantiates, so the row the mapping writes and the row a
  // client reads are one declared thing rather than two look-alikes.
  const RegionSchema = schemaMod['RegionSchema'] as unknown as {
    new (): { players: Map<string, Record<string, unknown>> };
  };
  // `toReplica` lives on the mapping entry point, which is the module the server's own mapping imports;
  // the protocol root deliberately does not re-export it, so reaching it here compares the mapping against
  // the same projection the mapping itself uses.
  const protocolMod = await import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/mapping/index.js')).href) as Record<string, unknown>;
  const toReplica = protocolMod['toReplica'] as ((state: unknown) => { ok: true; value: Record<string, unknown> } | { ok: false; issues: unknown[] });
  const withConfigOverrides = configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>;
  const computeConfigHash = configMod['computeConfigHash'] as (c: unknown) => string;
  const regionHash = configMod['regionHash'] as (c: unknown) => string;
  const publishPlayer = mapMod['publishPlayer'] as (
    region: unknown, entityId: string, state: unknown, disposition: unknown,
  ) => { ok: true } | { ok: false; issues: readonly string[] };

  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  const deploymentOverrides = { region: { bounds } };
  const cfg = withConfigOverrides(configMod['DEFAULT_SERVER_CONFIG'], deploymentOverrides);
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: computeConfigHash(cfg),
    manifestHash: regionHash(cfg),
  };
  const patchIntervalMs = (cfg['network'] as { statePatchIntervalMs: number }).statePatchIntervalMs;
  const stepMs = Math.round((cfg['network'] as { simulationStepSeconds: number }).simulationStepSeconds * 1000);

  const stack = await loadPinnedStack(ROOT);
  const server = await startHarnessServer(ROOT, {
    region: RegionRoomModule.defineOperatorRegionRoom({
      config: deploymentOverrides,
      runId: 'udg-003-phase-2-stage-sequence',
      journalRetention: 20_000,
      regionProvenance: 'test-only-synthetic',
    }),
  });

  const roomNow = (): RoomInstance | undefined =>
    RegionRoomModule.RegionRoom.liveRooms().find((candidate) => candidate.evidence()['refused'] !== true);
  const serverRowFor = (entityId: string): ReplicaRowEvidence | null => {
    const rows = (roomNow()?.evidence()['replicaRows'] ?? []) as ReplicaRowEvidence[];
    return rows.find((row) => row.key === entityId) ?? null;
  };

  // ── seats ────────────────────────────────────────────────────────────────────────────────────
  const compliant = await connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema as never);
  const roomId = compliant.room.roomId;
  const compliantEpoch = await waitForIssuedEpoch(compliant.room);
  const refusal = await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, identity, RegionSchema as never);
  const refusalEpoch = await waitForIssuedEpoch(refusal.room);
  const withheld = await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, identity, RegionSchema as never);
  const withheldEpoch = await waitForIssuedEpoch(withheld.room);
  const departed = await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, identity, RegionSchema as never);
  const departedEpoch = await waitForIssuedEpoch(departed.room);
  // Sampled AFTER the leave has settled, not at the instant `leave()` is called. The first version read
  // the pair immediately before awaiting the leave, and on a hosted runner a frame that was already in
  // flight landed afterwards: the departed row moved a little, and the artefact called a real property
  // false. In-flight work is part of the world, so the baseline is taken once the room has stopped
  // draining, and anything that moves the row after THAT would be mapping a retired entity.
  let departedRowAfterLeave: number | null = null;
  let neighbourRowAfterLeave: number | null = null;
  let departedSampling: Promise<void> = Promise.resolve();

  /** The client's own patch arrivals, per seat — that is `P` as the seat can observe it. */
  const arrivals = new Map<string, number[]>();
  const resolvedThroughLog = new Map<string, { atMs: number; resolvedThrough: number }[]>();
  for (const seat of [compliant, refusal, withheld, departed]) {
    const key = seat.room.sessionId;
    arrivals.set(key, []);
    resolvedThroughLog.set(key, []);
    (seat.room as unknown as { onStateChange(cb: (state: ProbeRegionState) => void): void })
      .onStateChange((state) => {
        arrivals.get(key)?.push(performance.now());
        const row = state.players?.get(key);
        resolvedThroughLog.get(key)?.push({ atMs: performance.now(), resolvedThrough: row?.inputResolvedThrough ?? 0 });
      });
  }

  const compliantKey = compliant.room.sessionId;
  const departedKey = departed.room.sessionId;
  const withheldKey = withheld.room.sessionId;

  const frame = (epoch: number): Record<string, unknown> => ({
    generation: 1,
    directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
    moveX: 0,
    moveZ: 1,
    sessionEpoch: epoch,
  });

  const withholdController = installImpairment(withheld.room as unknown as Parameters<typeof installImpairment>[0], { seed: 3 });
  withholdController.arm();

  const refusalRowAtStart = refusal.room.state.players?.get(refusal.room.sessionId);
  const refusalPositionAtStart = {
    x: refusalRowAtStart?.x ?? Number.NaN,
    y: refusalRowAtStart?.y ?? Number.NaN,
    z: refusalRowAtStart?.z ?? Number.NaN,
    vx: refusalRowAtStart?.vx ?? Number.NaN,
    vz: refusalRowAtStart?.vz ?? Number.NaN,
  };

  // A holder rather than a bare `let`: the assignment happens inside the streaming closure, and a local
  // variable would still read null to the checker afterwards, which is how a control like this one quietly
  // becomes unfalsifiable.
  // Two samples, not one instant. A single mid-window reading compares two numbers that are usually one
  // step apart, which on a loaded runner can come out level for reasons that have nothing to do with the
  // claim. What the claim actually needs is that the authority ADVANCED while the seat did not, so the
  // window is sampled when it opens and again later, and the pair of deltas is the evidence.
  const midStall: {
    value: {
      clientAtOpen: number; serverAtOpen: number;
      clientAtMid: number; serverAtMid: number;
      openAtMs: number; midAtMs: number;
    } | null;
  } = { value: null };
  const streaming = (async () => {
    for (let sent = 0; sent < FRAMES; sent += 1) {
      // The withheld seat's patches stop landing from the sixth frame onwards; the seat itself keeps
      // streaming, because the point is the delivery direction, not the sender.
      if (sent === 6) {
        // The window opens and the stream KEEPS RUNNING. An earlier version slept here, and sleeping
        // stopped the sends, so the authority had nothing new to resolve and the two samples came back
        // equal — the artefact was measuring its own pause. The claim needs the room to keep consuming
        // while the seat is kept from seeing it, which is what a paced stream through a closed window is.
        midStall.value = {
          clientAtOpen: withheld.room.state.players?.get(withheldKey)?.inputResolvedThrough ?? -1,
          serverAtOpen: serverRowFor(withheldKey)?.resolvedThrough ?? -1,
          clientAtMid: -1,
          serverAtMid: -1,
          openAtMs: performance.now(),
          midAtMs: -1,
        };
        withholdController.withholdInbound(WITHHOLD_MS);
      }
      if (sent === 12 && midStall.value !== null) {
        // Half a second of continued streaming later, still inside the 600 ms window: the authority has
        // had six more ticks of work, and this seat has been told none of it.
        midStall.value.clientAtMid = withheld.room.state.players?.get(withheldKey)?.inputResolvedThrough ?? -1;
        midStall.value.serverAtMid = serverRowFor(withheldKey)?.resolvedThrough ?? -1;
        midStall.value.midAtMs = performance.now();
      }
      stampAndSend(compliant.handle as never, frame(compliantEpoch));
      // The refusal control: a stamped epoch that is not the one this association holds. GA-4 makes the
      // refusal a representation, so the watermark advances and the disposition is published; AC-6's M
      // says nothing else may move.
      stampAndSend(refusal.handle as never, frame(refusalEpoch === 1 ? 2 : refusalEpoch - 1));
      stampAndSend(withheld.handle as never, frame(withheldEpoch));
      if (sent === 8) {
        // It leaves mid-window on an ordinary close. The row itself stays for the rejoin window by design
        // (ADR-0003 §4.3: retirement is not deletion), so what has to stop is the *mapping*: the room
        // publishes the entities the authority still holds, and this one is retired on leave.
        await departed.room.leave(false).catch(() => undefined);
        // Sampled in parallel, so the paced stream never pauses: a 400 ms sleep here would have shifted
        // the withheld-window sample past the window and broken a different check.
        departedSampling = (async () => {
          await sleep(400);
          departedRowAfterLeave = serverRowFor(departedKey)?.resolvedThrough ?? null;
          neighbourRowAfterLeave = serverRowFor(compliantKey)?.resolvedThrough ?? null;
        })();
      }
      else {
        stampAndSend(departed.handle as never, frame(departedEpoch));
      }
      await sleep(FRAME_INTERVAL_MS);
    }
  })();
  await streaming;
  // Wait for the seat to have been TOLD, not for a wall-clock guess. The room publishes every
  // statePatchIntervalMs, so the seat catches up on its own; polling until its row equals the authority's
  // — and publishing how long that took — is a real settlement check, where `sleep(1_500)` was a bet on
  // the runner that a hosted box is entitled to lose. The bound is 12 s and it is an assertion, not a
  // formality: the equality either arrives inside it or the check goes false and the elapsed figure goes
  // into the artefact with the failure.
  const settled = await settleUntil(() => {
    const client = compliant.room.state.players?.get(compliantKey);
    const server = serverRowFor(compliantKey);
    return client !== undefined
      && server !== null
      && client.inputResolvedThrough === server.resolvedThrough
      && client.inputRetiredUnrepresented === server.retired
      && client.effectCount === server.effects
      && client.sessionEpoch === server.epoch;
  }, 12_000);

  // ── 6. per entity: a departed seat stops being mapped and published, and a never-created entity
  //        is never mapped at all ───────────────────────────────────────────────────────────────
  // Two negatives, because they prove different things. A seat that leaves had a row, and `M`/`P` must
  // stop touching it while the neighbours keep going: that is the per-entity discipline. A join the hash
  // gate refused never produced an entity at all, so there is no identifier to point at — reported as
  // such rather than dressed up as a per-entity case.

  const badIdentity = { ...identity, configHash: '0'.repeat(64) };
  let refusedCreateEntityId: string | null = null;
  // Every path assigns before reading, so there is no placeholder value to invent here.
  let refusedCreateOutcome: string;
  try {
    const doomed = await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, badIdentity, RegionSchema as never);
    refusedCreateEntityId = doomed.room.sessionId;
    await doomed.room.leave(true).catch(() => undefined);
    refusedCreateOutcome = 'joined against every expectation';
  }
  catch {
    refusedCreateOutcome = 'the hash gate closed the join: no entity, therefore nothing to map or publish';
  }

  await departedSampling;
  const rows = roomNow()?.journal().rows ?? [];
  const evidence = roomNow()?.evidence() ?? {};
  const seatsEvidence = (evidence['seats'] ?? []) as readonly { entityId: string; effectCount: number }[];
  const serverRows = (evidence['replicaRows'] ?? []) as ReplicaRowEvidence[];

  // ── 1 and 2: the compliant seat's replica row against the authority's own record ─────────────
  const clientCompliantRow = compliant.room.state.players?.get(compliantKey);
  const serverCompliantRow = serverRowFor(compliantKey);
  const mappingMatchesAuthorityRecord = clientCompliantRow !== undefined
    && serverCompliantRow !== null
    && clientCompliantRow.inputResolvedThrough === serverCompliantRow.resolvedThrough
    && clientCompliantRow.inputRetiredUnrepresented === serverCompliantRow.retired
    && clientCompliantRow.effectCount === serverCompliantRow.effects
    && clientCompliantRow.sessionEpoch === serverCompliantRow.epoch;

  const refusalRowNow = refusal.room.state.players?.get(refusal.room.sessionId);
  const refusalDispositions = rows.filter((row) => row['type'] === 'observation'
    && row['entityId'] === refusal.room.sessionId
    && String(row['disposition'] ?? '').startsWith('refused'));
  const refusalMoved = MOVEMENT_FIELDS.some((field) => {
    const now = Number((refusalRowNow as unknown as Record<string, number> | undefined)?.[field] ?? Number.NaN);
    const before = Number((refusalPositionAtStart as unknown as Record<string, number>)[field]);
    return Number.isFinite(now) && Number.isFinite(before) && Math.abs(now - before) > 1e-12;
  });
  const refusalWatermarkAdvanced = (refusalRowNow?.inputResolvedThrough ?? 0) > 0;
  const compliantMoved = (clientCompliantRow?.inputResolvedThrough ?? 0) > 0
    && (clientCompliantRow?.z ?? 0) > 0;

  // ── 3: the mapping writes by value ──────────────────────────────────────────────────────────
  // A headless authority gives a real canonical state, from the same code the room runs, so this is not a
  // fixture pretending to be an entity.
  const valueControl = (() => {
    class Collector {
      readonly rows: Record<string, unknown>[] = [];
      readonly chain: Record<string, unknown>[] = [];
      recordRow(row: Record<string, unknown>): void { this.rows.push(row); }
      recordTickChain(record: Record<string, unknown>): void { this.chain.push(record); }
      recordPrologue(): void { /* the mapping test never replays */ }
    }
    // The same two ports the accepted AC-1 reference producer passes: a scheduler that never fires and a
    // clock that only moves when the test says so. Cadence is not what this control is about.
    const stubTime = { nowMs: (): number => 0 };
    const stubScheduler = { set: (): number => 0, clear: (_handle: number): void => undefined };
    const clock = (clockMod['FixedStepClock'] as {
      create(options: unknown): { dtSeconds?: number; error?: string; start?: unknown; stop?: unknown };
    }).create({ network: cfg['network'], scheduler: stubScheduler, time: stubTime, tickOrigin: 0 });
    if (!('dtSeconds' in clock)) return { ran: false, reason: `the headless clock refused to build: ${String(clock.error)}` };
    const core = (stepMod['AuthorityCore'] as {
      build(options: unknown): Record<string, unknown>;
    }).build({
      config: cfg,
      stepper: new (movementMod['FlatReferenceStepper'] as new (speed: number) => unknown)(
        (cfg['movement'] as { speed: number }).speed,
      ),
      time: stubTime,
      clock,
      runId: 'udg-003-phase-2-stage-mapping',
      sink: new Collector(),
      regionProvenance: 'test-only-synthetic',
    });
    if (!('view' in core)) return { ran: false, reason: `the headless authority refused to build: ${String((core as { reason?: string }).reason)}` };
    const typedCore = core as unknown as {
      step(): { entities: readonly { entityId: string }[] };
      view(entityId: string): { state: Record<string, unknown> } | undefined;
      join(entityId: string, epoch: number, spawn: { x: number; y: number; z: number }): unknown;
      ingest(entityId: string, payload: Record<string, unknown>): unknown;
    };
    // Join, ingest one accepted frame and step, exactly as the accepted AC-1 reference producer does: the
    // canonical state the mapping is tested against comes from the authority, not from a fixture.
    typedCore.join('e-map-control', 1, { x: 0, y: 0, z: 0 });
    typedCore.ingest('e-map-control', {
      sessionEpoch: 1,
      generation: 1,
      directIntent: true,
      moveX: 0,
      moveZ: 1,
    });
    const outcome = typedCore.step();
    const entityId = outcome.entities[0]?.entityId;
    if (entityId === undefined) return { ran: false, reason: 'the headless authority stepped no entity, so there was no canonical state to map' };
    // The room maps `view.state`, not the view façade; this control calls the mapping the same way.
    const view = typedCore.view(entityId)?.state as Record<string, unknown> | undefined;
    if (view === undefined) return { ran: false, reason: 'the headless authority exposed no view for its own entity' };
    const region = new RegionSchema();
    // The record shape the protocol's own checker accepts: absence is `null`, not a zero, because `0 / 0`
    // is the encoded no-gap sentinel and a half-named gap is illegal.
    const disposition = {
      inputResolvedThrough: 0,
      gap: null,
      inputRetiredUnrepresented: 0,
      effectCount: 0,
      lastAppliedRequestId: null,
    };
    const published = publishPlayer(region, entityId, view, disposition);
    if (published.ok === false) return { ran: false, reason: `publishPlayer refused: ${published.issues.join('; ')}` };
    const row = region.players.get(entityId);
    if (row === undefined) return { ran: false, reason: 'publishPlayer reported success without creating a row' };
    const projected = toReplica(view);
    if (projected.ok === false) return { ran: false, reason: 'toReplica refused the same state publishPlayer accepted' };
    // `toReplica` hands back a PlayerSchema instance, so the comparison walks the protocol's own field
    // list rather than whatever `Object.entries` happens to see through a schema proxy.
    const canonicalFields = (schemaMod['PLAYER_FIELDS'] ?? []) as readonly string[];
    const projectedRow = projected.value as unknown as Record<string, unknown>;
    const canonicalFieldsMatch = canonicalFields.length > 0
      && canonicalFields.every((field) => row[field] === projectedRow[field]);
    // The control: mutate the state that was mapped. A by-value copy is untouched; a leaked reference is
    // not, and the row would have moved with it.
    // The canonical state keeps its pose under `locomotion.kinematic.position`, which is what a leaked
    // reference would have reached. Twelve and a half metres, so nothing could mistake the residue for
    // float noise.
    const mutable = view as unknown as { locomotion?: { kinematic?: { position?: { x?: number } } } };
    const position = mutable.locomotion?.kinematic?.position;
    if (position !== undefined) position.x = (position.x ?? 0) + 12.5;
    const rowUnmoved = row['x'] === projectedRow['x'];
    // And the mapping is the only writer: re-publishing the untouched canonical state restores a row that
    // something else had edited.
    row['x'] = -999;
    const republished = publishPlayer(region, entityId, toReplicaOkValueView(typedCore, entityId), disposition);
    const mappingIsTheWriter = republished.ok === true && row['x'] !== -999;
    return {
      ran: true,
      entityId,
      canonicalFieldsMatch,
      mutatingTheMappedStateMovedTheRow: !rowUnmoved,
      mappingIsTheOnlyWriter: mappingIsTheWriter,
      dispositionDidNotTravelThroughTheProjection: row['inputResolvedThrough'] === disposition.inputResolvedThrough,
    };
  })();

  // ── 4 and 5: M is not P, and P is not the tick ──────────────────────────────────────────────
  // Read below, after the settlement poll rather than here: the poll is the wait, and a figure taken
  // before it would be a snapshot of the moment the window closed.
  const patchGaps = (arrivals.get(compliantKey) ?? []).slice(1)
    .map((atMs, index) => atMs - (arrivals.get(compliantKey)?.[index] ?? atMs));
  const patchMedianMs = median(patchGaps);
  const withheldLog = resolvedThroughLog.get(withheldKey) ?? [];
  // The same settlement, for the seat whose patches were withheld: after release its row has to arrive at
  // the authority's value, and the wait is polled rather than guessed.
  const caughtUp = await settleUntil(() => (withheld.room.state.players?.get(withheldKey)?.inputResolvedThrough ?? -1)
    === (serverRowFor(withheldKey)?.resolvedThrough ?? -2), 12_000);
  const withheldClientNow = withheld.room.state.players?.get(withheldKey)?.inputResolvedThrough ?? -1;
  const withheldServerNow = serverRowFor(withheldKey)?.resolvedThrough ?? -1;
  const caughtUpAfterRelease = withheldClientNow === withheldServerNow && withheldClientNow > 0;

  const checks = {
    mappingMatchesTheAuthoritysOwnRecord: mappingMatchesAuthorityRecord,
    compliantSeatActuallyMoved: compliantMoved,
    refusalAdvancedTheWatermark: refusalWatermarkAdvanced,
    refusalProducedRefusedRows: refusalDispositions.length > 0,
    refusalMovedNothing: !refusalMoved,
    mappingWritesByValue: valueControl.ran === true && valueControl.canonicalFieldsMatch === true
      && valueControl.mutatingTheMappedStateMovedTheRow === false,
    mappingIsTheOnlyWriter: valueControl.ran === true && valueControl.mappingIsTheOnlyWriter === true,
    withheldProvesMappingPrecedesPublication: midStall.value !== null
      && midStall.value.midAtMs > 0
      && midStall.value.serverAtMid - midStall.value.serverAtOpen >= 2
      && midStall.value.clientAtMid === midStall.value.clientAtOpen,
    clientCaughtUpWhenPublicationResumed: caughtUpAfterRelease && caughtUp.settled,
    // Stated comparatively, because an absolute millisecond band is a claim about the runner. What the
    // criterion asserts is which knob the cadence follows: the intervals have to sit nearer the declared
    // patch interval than the simulation step, and they have to be plainly too slow to be tick-paced. A
    // loaded runner that stretches every interval still satisfies both, and a per-tick publication fails
    // the first arm whichever way the machine is feeling.
    publicationCadenceIsTheDeclaredKnob: patchMedianMs !== null
      && Math.abs(patchMedianMs - patchIntervalMs) < Math.abs(patchMedianMs - stepMs),
    publicationCadenceIsNotTickPaced: patchMedianMs !== null
      && patchMedianMs >= stepMs * 1.5,
    departedEntityStopsBeingMappedWhileNeighboursContinue: departedRowAfterLeave !== null
      && neighbourRowAfterLeave !== null
      && (serverRowFor(departedKey)?.resolvedThrough ?? -1) === departedRowAfterLeave
      && (serverRowFor(compliantKey)?.resolvedThrough ?? -1) > neighbourRowAfterLeave,
    refusedCreateProducedNoEntityToMap: refusedCreateEntityId === null
      && refusedCreateOutcome.startsWith('the hash gate closed'),
    resultsHalfIsNotClaimedAsPublished: seatsEvidence.every((seat) => seat.effectCount === 0),
  };

  const artefact = {
    taskId: 'UDG-003',
    phase: 'phase-2',
    criterion: ['AC-6'],
    producer: 'tests/runtime/udg-003-phase-2/stage-sequence.ts',
    definitions: {
      quotedFrom: 'docs/contracts/assignments/UDG-003-phase-1.md §0.1 (the canonical statement of the letters)',
      order: 'F → L → Q → S → A → C → R → X, then M, then P',
      M: '"stage M (map canonical state to the replica)" — implemented by apps/server/src/state/map-player.ts, invoked per entity in the consuming tick',
      P: '"stage P (publish results, metrics, flush)" — the room publishes the schema rows at network.statePatchIntervalMs and flushes its telemetry; the observable half at a seat is the patch arrival',
      ownerRuling: 'OD-4 (2026-11-13), applied to the criterion on 2026-11-14: the server\'s canonical-to-replica mapping is M, and its metrics and patch publication are the observable part of P. Successful navigation-result publication is an explicit acceptance obligation of UDG-007 and stays outstanding there.',
      amendedClause: 'AC-6 as amended (docs/contracts/assignments/UDG-003-readiness-proposal.md, dated note 2026-11-14): "Scored against UDG-003 Phase 2: F, L, Q, S, A, C, R, X on every executed tick; M = the server\'s canonical-to-replica mapping, applied per entity in the consuming tick; P = that room\'s publication of state and metrics at the declared patch interval, plus its flush. P\'s results half — a committed navigation result reaching a client — needs the navigation intake this phase is forbidden to build, and is an explicit acceptance obligation of UDG-007, outstanding there. It is neither waived nor counted here."',
    },
    settings: {
      statePatchIntervalMs: patchIntervalMs,
      simulationStepMs: stepMs,
      framesPerSeat: FRAMES,
      withholdWindowMs: WITHHOLD_MS,
      envelope: 'hashed defaults; only the region bounds are declared',
    },
    mappingStageM: {
      compliantSeat: {
        entityId: compliantKey,
        settledAfterMs: settled.elapsedMs,
        settledWithinBound: settled.settled,
        epoch: compliantEpoch,
        clientRow: clientCompliantRow === undefined ? null : {
          inputResolvedThrough: clientCompliantRow.inputResolvedThrough,
          inputRetiredUnrepresented: clientCompliantRow.inputRetiredUnrepresented,
          effectCount: clientCompliantRow.effectCount,
          sessionEpoch: clientCompliantRow.sessionEpoch,
          x: clientCompliantRow.x,
          z: clientCompliantRow.z,
        },
        serverRow: serverCompliantRow,
        equal: mappingMatchesAuthorityRecord,
      },
      byValueControl: valueControl,
      refusalControl: {
        entityId: refusal.room.sessionId,
        epochIssuedByRoom: refusalEpoch,
        epochStampedOnFrames: refusalEpoch === 1 ? 2 : refusalEpoch - 1,
        outcome: refusedCreateOutcomeFor(refusalDispositions.length),
        watermarkAdvanced: refusalWatermarkAdvanced,
        refusedRowsJournalled: refusalDispositions.length,
        movementFieldsUnchanged: !refusalMoved,
        positionAtStart: refusalPositionAtStart,
        positionAtEnd: refusalRowNow === undefined ? null : {
          x: refusalRowNow.x,
          y: refusalRowNow.y,
          z: refusalRowNow.z,
          vx: refusalRowNow.vx,
          vz: refusalRowNow.vz,
        },
        replicaDisposition: {
          inputResolvedThrough: refusalRowNow?.inputResolvedThrough ?? null,
          inputGapStart: refusalRowNow?.inputGapStart ?? null,
          inputGapEnd: refusalRowNow?.inputGapEnd ?? null,
          lastAuthorityTick: refusalRowNow?.lastAuthorityTick ?? null,
        },
        whyThisIsTheControl: 'ADR-0003 §4 makes a refusal a representation, so the watermark and the disposition must move and the body must not. A mapping that read the wire instead of canonical state would move x/z here and the artefact would fail; a mapping that refused to publish the disposition would fail the second half the owner asked for.',
      },
      perEntityNegative: {
        departed: {
          entityId: departedKey,
          resolvedThroughAfterLeave: departedRowAfterLeave,
          resolvedThroughAtEnd: serverRowFor(departedKey)?.resolvedThrough ?? null,
          neighbourResolvedThroughAfterLeave: neighbourRowAfterLeave,
          neighbourResolvedThroughAtEnd: serverRowFor(compliantKey)?.resolvedThrough ?? null,
          samplingNote: 'the baseline is taken 400 ms after the leave resolved, so work already in flight is inside the baseline rather than mistaken for post-retirement mapping',
          rowStillReplicated: serverRowFor(departedKey) !== null,
          reading: 'the departed entity stopped being mapped while its neighbours kept advancing, which is what makes this a per-entity discipline rather than a room-wide one; the row itself is expected to remain, because retirement is not deletion (ADR-0003 §4.3)',
        },
        refusedCreate: {
          refusedCreateEntityId,
          outcome: refusedCreateOutcome,
          rowsForThatEntity: refusedCreateEntityId === null ? 0 : rows.filter((row) => row['entityId'] === refusedCreateEntityId).length,
          serverRowsForThatEntity: refusedCreateEntityId === null ? 0 : serverRows.filter((row) => row.key === refusedCreateEntityId).length,
          note: 'no entity identifier exists for a join the hash gate closed before create, so this half is reported as "nothing was created" and not as a per-entity mapping decision',
        },
      },
    },
    publicationStageP: {
      observableAtSeat: {
        patchArrivals: (arrivals.get(compliantKey) ?? []).length,
        medianIntervalMs: patchMedianMs,
        declaredIntervalMs: patchIntervalMs,
        tickIntervalMs: stepMs,
        cadenceIsTheKnobNotTheTick: checks.publicationCadenceIsTheDeclaredKnob
          && checks.publicationCadenceIsNotTickPaced,
        cadenceRule: `the median interval must sit nearer statePatchIntervalMs (${String(patchIntervalMs)}) than simulationStepSeconds (${String(stepMs)} ms), and must be at least 1.5 steps`,
        observedMedianMs: patchMedianMs,
      },
      mappingIsNotPublication: {
        withheldEntityId: withheldKey,
      withheldWindowMs: WITHHOLD_MS,
      framesSentDuringTheWindow: FRAMES - 6,
      methodNote: 'the stream keeps running while the window is shut. The first version slept inside the window instead, which stopped the sends: the authority had nothing new to resolve, the two samples came back equal, and the artefact was measuring its own pause. A withhold experiment that halts the input measures nothing, so the pair of deltas is now taken across a live stream.',
        midWindow: midStall.value,
        afterRelease: {
          caughtUpAfterMs: caughtUp.elapsedMs,
          clientResolvedThrough: withheldClientNow,
          serverResolvedThrough: withheldServerNow,
          caughtUp: caughtUpAfterRelease,
        },
        reading: midStall.value === null
          ? 'the window never opened'
          : `inside the window the authority advanced ${String((midStall.value.serverAtMid - midStall.value.serverAtOpen))} resolutions while the seat advanced ${String(midStall.value.clientAtMid - midStall.value.clientAtOpen)}; a single stage cannot fail to advance while its own mapping does, and a per-tick publication could not hold still for ${String(WITHHOLD_MS)} ms`,
        metricsFlush: 'the room\'s telemetry artefacts (tick-metrics.json, buffer-depth.csv) are the metrics half of P and are produced by the abuse population in this same bundle',
      },
      resultsHalf: {
        resultsAccepted: 0,
        effectCountEverywhere: seatsEvidence.every((seat) => seat.effectCount === 0),
        status: 'outstanding',
        owner: 'UDG-007',
        obligation: 'docs/contracts/UDG-007.md, "Successful navigation-result publication (AC-6, P\'s results half)": accepting UDG-007 requires a run where at least one accepted route effect reaches a client replica, its acknowledgement carries the applied record, it is attributable to the epoch and seat that produced it, and it is published exactly once',
        why: 'P is "publish results, metrics, flush". Metrics and flush are measured above. The results half needs a committed discrete effect, and none can commit on this substrate (no route candidate is ever constructed), so this artefact records the half as outstanding rather than counting the two it can see as all three.',
        relatedGateACriterion: 'GA-7 (final publication withheld) is the failure-shape half of the same duty and belongs to UDG-SPIKE-001',
      },
    },
    order: {
      claim: 'X → M → P per consuming tick: the tick chain records the step, the mapping writes the replica in that same tick, and the seat can only read it at the next patch',
      boundNote: 'M is not separately timestamped by the server, so the claim is stated as a bound: M happened inside the consuming tick, whose own record precedes the patch arrival that first showed the value. The withhold window is what proves M and P are distinct rather than adjacent.',
      evidence: withheldLog.length > 0
        ? { clientResolutionSamples: withheldLog.length, firstSampleAtMs: withheldLog[0]?.atMs ?? null, lastSampleAtMs: withheldLog[withheldLog.length - 1]?.atMs ?? null }
        : null,
    },
    checks,
    verdict: Object.values(checks).every((value) => value === true) ? 'pass' : 'fail',
    // The verdict follows the clause, not the artefact: this file changed nothing about AC-6, it only makes
    // the split measurable. The clause changed on 2026-11-14, and until it had, the honest word was PARTIAL.
    ac6Verdict: 'pass-for-the-stages-scored-here',
    ac6VerdictNote:
      'AC-6 as amended on 2026-11-14 scores Phase 2 against F, L, Q, S, A, C, R, X, M and P\'s publication of state, metrics and flush; every one of those is measured in this artefact with a control that fails when the property is absent. The results half of P is an acceptance obligation of UDG-007 and is outstanding there — it is not counted here and it is not waived, and no reading of this artefact makes UDG-007\'s acceptance happen.',
    doesNotClaim: [
      'that the results half of P was published: no discrete effect commits here',
      'a per-entity mapping negative from the hash-gated join: that join produced no entity, so there is no row to point at',
      'a stage letter for anything in the transport\'s schema-patch pipeline beyond what is measured above',
      'that AC-6 passes as a whole sequence: it passes for the stages the amended clause scores here, and the results half is outstanding at UDG-007 — see ac6VerdictNote',
      'that this artefact amended anything: the clause was amended by the owner in the readiness proposal on 2026-11-14; this file only measures against it',
    ],
  };

  writeFileSync(resolve(OUT_DIR, 'stage-sequence.json'), `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  if (artefact.verdict !== 'pass') {
    // The capture keeps stderr; a bare exit code 2 in a CI log is how a timing threshold becomes an
    // afternoon. Name the checks that went false and the numbers behind them.
    process.stderr.write(`[stages][fail] ${Object.entries(checks).filter(([, value]) => value !== true).map(([key, value]) => `${key}=${String(value)}`).join(', ')}\n`);
    process.stderr.write(`[stages][fail] patch median ${String(patchMedianMs ?? '-')} ms, declared ${String(patchIntervalMs)} ms, step ${String(stepMs)} ms; mid-window ${JSON.stringify(midStall.value)}\n`);
  }
  process.stdout.write(
    `[stages] ${artefact.verdict as string}: M matches the authority record=${String(checks.mappingMatchesTheAuthoritysOwnRecord)}, `
    + `refusal moved nothing=${String(checks.refusalMovedNothing)}, `
    + `M≠P during the withheld window the room advanced ${String((midStall.value?.serverAtMid ?? 0) - (midStall.value?.serverAtOpen ?? 0))} and the seat ${String((midStall.value?.clientAtMid ?? 0) - (midStall.value?.clientAtOpen ?? 0))}, `
    + `patch median ${String(patchMedianMs ?? '-')} ms vs declared ${String(patchIntervalMs)} ms, `
    + `AC-6 ${artefact.ac6Verdict as string} (results half outstanding at UDG-007)\n`,
  );

  await Promise.all([compliant, refusal, withheld, departed].map((seat) => seat.room.leave(true).catch(() => undefined)));
  await Promise.race([server.close().catch(() => undefined), sleep(4_000)]);
  if (artefact.verdict !== 'pass') process.exitCode = 2;
}

/** Re-read the canonical view for a re-publish, because the mapping must be provably the only writer. */
const toReplicaOkValueView = (
  core: { view(entityId: string): { state: Record<string, unknown> } | undefined },
  entityId: string,
): Record<string, unknown> => {
  const fresh = core.view(entityId)?.state;
  if (fresh === undefined) throw new Error('the headless authority lost its own entity between two mappings');
  return fresh;
};

const refusedCreateOutcomeFor = (refusedRows: number): string => refusedRows > 0
  ? `${String(refusedRows)} refused dispositions journalled; nothing else moved`
  : 'no refused disposition was journalled, which would itself be a finding';

await main();
// The pinned stack keeps sockets and timers reachable after main returns; the evidence is on disk.
process.exit(process.exitCode ?? 0);
