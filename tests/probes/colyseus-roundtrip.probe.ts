/**
 * UDG-SPIKE-001 — the pinned SDK's public prediction primitives against the UDG disposition
 * boundary: a feasibility probe, run before any predictor is written (the delegated build
 * instruction of 2026-11-19: "determine from actual exports/declarations/source plus minimal proof
 * whether a public hook accepts the UDG disposition bound on replay independently of SDK
 * retirement"; a custom predictor requires an ADR, so this file decides whether one is needed).
 *
 * ## The question, precisely
 *
 * The pinned client (`@colyseus/sdk` 0.18.9) ships a public rollback-prediction surface —
 * `Predict`, `Reconciler`, `SimReconciler` (all re-exported from the package barrel). The spike's
 * local-prediction limb must rewind to authoritative state and replay the still-valid inputs, but
 * ADR-0003 §4 says the client prunes by the server's per-entity disposition record
 * (`inputResolvedThrough`) and **never** by the SDK acknowledgement (`lastProcessed`), which is a
 * send-order watermark, not a representation claim (PR-8). So the primitive is only usable as-is
 * if its resolution boundary can be bound to the disposition field independently of SDK retirement.
 *
 * ## What this probe measures, in three parts
 *
 * A. **Declarations and installed source** (read off disk, from the very link `apps/client`
 *    imports): the public options surfaces (`RollbackOptions`, `ReconcilerOptions`,
 *    `SimReconcilerOptions`), and the installed runtime's boundary lines — which watermark
 *    `tick()` polls, what `InputHandle.at(seq)` returns for acked seqs, and whether any declared
 *    member can carry an external boundary.
 * B. **A live seat on the real pinned room** driving the public `Reconciler` over the real
 *    `InputHandle` and the real `PlayerSchema` row: prediction immediate at `send()`, a
 *    server-forced correction (a frame the authority refuses — GA-4 semantics — so the published
 *    truth falls behind the prediction), adoption, replay of the remaining valid inputs at most
 *    once per reconcile, the ack/disposition pairing read inside one delivery, and the raw
 *    (pre-display-smoothing) correction at the matched acknowledged boundary.
 * C. **The divergence case as a minimal reproduction**: an eviction burst retires frames that were
 *    never represented, so the server's record resolves *below* the SDK watermark. The probe
 *    measures whether any public surface can still recover an input in the unresolved range
 *    (`at(seq)` for `resolvedThrough < seq <= lastProcessed`) — the exact capability a
 *    disposition-bounded replay would need.
 *
 * ## Verdict semantics
 *
 * The probe PASSES when it measured what it set out to measure; its *observations* — not its
 * green checks — carry the feasibility answer, and they are written explicitly into
 * `observations.verdict`. A "boundary not injectable" finding is a passing measurement of an
 * incompatibility, reported as one, never papered over.
 *
 * ## What this probe is not
 *
 * Not Gate A (Not Run), not a compatibility claim (`stackCompatibility` stays `not-established`),
 * not a browser run (Part B is the Node seat over the pinned SDK — the same package build the
 * browser imports), and not a movement claim beyond the flat reference relation: the reconciler's
 * `step` here restates `drive × speed × dt` for the probe only; the spike itself owns the
 * sole-step-function integration.
 *
 * ## How to run it
 *
 * ```sh
 * pnpm build:libraries && pnpm --filter @udg/server build
 * node tests/probes/colyseus-roundtrip.probe.ts \
 *   --out artifacts/spike-001/UDG-SPIKE-001-roundtrip.probe-result.json
 * ```
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ProbeRecorder,
  connectSeat,
  loadPinnedStack,
  sleep,
  startHarnessServer,
  stampAndSend,
  waitForIssuedEpoch,
  type RegisteredHandler,
} from '../support/client-harness/transport.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const outPath = args.includes('--out')
  ? args[args.indexOf('--out') + 1] ?? join('artifacts', 'spike-001', 'UDG-SPIKE-001-roundtrip.probe-result.json')
  : join('artifacts', 'spike-001', 'UDG-SPIKE-001-roundtrip.probe-result.json');

const recorder = new ProbeRecorder(
  'UDG-SPIKE-001-ROUNDTRIP',
  'public SDK prediction primitives vs the UDG disposition boundary (RegionRoom, replicated state, flat step)',
  undefined,
);

interface PlayerRow {
  inputResolvedThrough: number;
  inputGapStart: number;
  inputGapEnd: number;
  inputRetiredUnrepresented: number;
  lastAuthorityTick: number;
  sessionEpoch: number;
  x: number;
  z: number;
  connected: boolean;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

const rowOf = (room: { state: unknown; sessionId: string }): PlayerRow | undefined =>
  (room.state as ProbeRegionState).players.get(room.sessionId);

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => { reject(new Error(`${label} exceeded ${String(ms)} ms`)); }, ms);
    }),
  ]);

/**
 * The async-predicate wait this probe needs.
 *
 * The harness's own `until` polls a SYNCHRONOUS predicate: `while (!condition())`. An async
 * predicate makes `!condition()` test a Promise — always truthy — so the loop never runs and
 * `until` returns `true` without ever evaluating the body. That is a vacuous pass of exactly the
 * class this repository treats as a failure, and this probe hit it live: every wait that needed
 * the reconciler's pump (an async predicate) settled instantly and the first ledger read landed
 * mid-stream. The harness is another task's granted file, so the fix lives here, as a local
 * helper, and the harness's sync-only contract is recorded as a limitation for its owner.
 */
const untilAsync = async (condition: () => Promise<boolean> | boolean, budgetMs: number, stepMs = 10): Promise<boolean> => {
  const deadline = performance.now() + budgetMs;
  for (;;) {
    if (await condition()) return true;
    if (performance.now() > deadline) return false;
    await sleep(stepMs);
  }
};

process.on('uncaughtException', (error: unknown) => {
  process.stderr.write(`[roundtrip][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`[roundtrip][unhandled] ${String(reason instanceof Error ? reason.stack : reason)}\n`);
});

// ───────────────────────────────────────────────────── A. declarations & installed source

interface OptionSurface {
  readonly file: string;
  readonly members: string[];
}

/** Extract the declared member names of one interface block from a `.d.ts` text. */
const interfaceMembers = (text: string, name: string): string[] => {
  const start = text.indexOf(`export interface ${name}`);
  if (start < 0) return [];
  const body = text.slice(start);
  const open = body.indexOf('{');
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let index = open; index < body.length; index += 1) {
    if (body[index] === '{') depth += 1;
    else if (body[index] === '}') {
      depth -= 1;
      if (depth === 0) { end = index; break; }
    }
  }
  if (end < 0) return [];
  const members: string[] = [];
  for (const line of body.slice(open + 1, end).split('\n')) {
    const match = /^\s+(?:readonly\s+|static\s+)?([A-Za-z_$][\w$]*)\??\s*[:(<]/.exec(line);
    // Skip the keywords that open a nested declaration line rather than name a member.
    if (match?.[1] !== undefined && !['if', 'for', 'while', 'return'].includes(match[1])) members.push(match[1]);
  }
  return members;
};

const staticChecks = (): void => {
  const sdkDir = join(ROOT, 'apps', 'client', 'node_modules', '@colyseus', 'sdk');
  const build = join(sdkDir, 'build');
  const read = (file: string): string => {
    const path = join(build, file);
    if (!existsSync(path)) throw new Error(`installed SDK is missing ${file}`);
    return readFileSync(path, 'utf8');
  };

  // A1 — the prediction surface is public.
  const index = read('index.d.ts');
  recorder.check('predict-surface-is-public',
    /export \{[^}]*\bPredict\b[^}]*\bReconciler\b[^}]*\bSimReconciler\b/s.test(index),
    'index.d.ts re-exports Predict / Reconciler / SimReconciler from ./predict.ts');

  // A2 — no declared option member can carry an external resolution boundary.
  const rollbackD = read('predict/rollback.d.ts');
  const surfaces: OptionSurface[] = [
    { file: 'predict/rollback.d.ts', members: interfaceMembers(rollbackD, 'RollbackOptions') },
    { file: 'predict/reconciler.d.ts', members: interfaceMembers(read('predict/reconciler.d.ts'), 'ReconcilerOptions') },
    { file: 'predict/simReconciler.d.ts', members: interfaceMembers(read('predict/simReconciler.d.ts'), 'SimReconcilerOptions') },
  ];
  const boundaryLike = surfaces
    .flatMap((surface) => surface.members.map((member) => `${surface.file}:${member}`))
    .filter((entry) => /resolved|through|disposition|watermark|confirm|boundary|ackbound/i.test(entry));
  recorder.observe('public_option_surface', surfaces);
  recorder.check('no-declared-option-carries-a-resolution-boundary', boundaryLike.length === 0,
    `option members ${JSON.stringify(surfaces.map((s) => s.members))}; boundary-like matches ${JSON.stringify(boundaryLike)}; the only ack-facing hook is the post-hoc onReconcile?: (acked: number) => void`);

  // A3 — the installed runtime hard-codes the boundary to SDK retirement.
  const rollbackMjs = read('predict/rollback.mjs');
  const handleMjs = read('input/InputHandle.mjs');
  const handleD = read('input/InputHandle.d.ts');
  const pollLine = rollbackMjs.includes('const acked = this.input_.lastProcessed;');
  const watermarkLine = rollbackMjs.includes('ackWatermark = () => this.input_.lastProcessed');
  const replayWindow = rollbackMjs.includes('const from = Math.max(acked, this.replayFrom);');
  const atGate = (handleMjs.match(/if \(seq <= this\._lastProcessed \|\| seq > this\._sentCount\)/g) ?? []).length;
  recorder.observe('boundary_source_lines', {
    pollLine, watermarkLine, replayWindow,
    atGateOccurrences: atGate,
    reconcileVisibility: /protected reconcile\(acked: number\)/.test(rollbackD)
      ? 'protected (not callable through the public type)'
      : 'unexpected',
  });
  recorder.check('boundary-is-hardcoded-to-sdk-retirement', pollLine && watermarkLine && replayWindow && atGate >= 2,
    `tick() polls input_.lastProcessed: ${String(pollLine)}; ackWatermark closure: ${String(watermarkLine)}; replay window Math.max(acked, replayFrom): ${String(replayWindow)}; at()/reckonTimeAt() retire-gate occurrences: ${String(atGate)}`);

  // A4 — the disposition claim exists only on the replicated row; the handle carries no such field,
  // so a boundary reading it necessarily lives in seat-side policy, not in the SDK primitive.
  const handleCarriesDisposition = /resolvedThrough|inputRetired/i.test(handleD) || /resolvedThrough|inputRetired/i.test(handleMjs);
  recorder.check('handle-exposes-no-disposition-field', !handleCarriesDisposition,
    'InputHandle (declaration and installed source) exposes lastProcessed/sentCount/pendingCount/epoch/at only; inputResolvedThrough exists solely on the replicated PlayerSchema row');
};

// ───────────────────────────────────────────────────── main: live room

async function main(): Promise<void> {
  staticChecks();

  const [{ defineOperatorRegionRoom, RegionRoom }, movementMod, schemaMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as Promise<{
      defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
      RegionRoom: {
        liveRooms(): readonly {
          tickRecords: readonly {
            tick: number;
            consumed: readonly { entityId: string; seq: number }[];
            refused: readonly { entityId: string; count: number }[];
          }[];
        }[];
      };
    }>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<{
      authorityEntityId(sessionId: string): string;
    }>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
  ]);
  const RegionSchema = schemaMod['RegionSchema'];

  // The pinned SDK index, exactly as `apps/client` resolves it — `Reconciler` is exported there.
  const requireFromClient = createRequire(join(ROOT, 'apps', 'client', 'index.js'));
  const sdkIndex = (await import(pathToFileURL(requireFromClient.resolve('@colyseus/sdk')).href)) as {
    Reconciler: new (instance: object, options: Record<string, unknown>) => {
      tick(now: number): void;
      readonly state: { x: number; z: number };
      readonly reconcileSeq: number;
      readonly stepMs: number;
    };
  };

  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  // Same posture as PR-14 C10: raise the ceiling so an eviction burst takes the 4100 path, not 4101's.
  const deploymentOverrides = { region: { bounds }, input: { rateCeilingMessagesPerSecond: 240 } };
  const cfg = (configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>)(
    configMod['DEFAULT_SERVER_CONFIG'], deploymentOverrides);
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: (configMod['computeConfigHash'] as (c: unknown) => string)(cfg),
    manifestHash: (configMod['regionHash'] as (c: unknown) => string)(cfg),
  };
  const speed = (cfg['movement'] as { speed: number }).speed;
  const network = cfg['network'] as { tickRate: number; simulationStepSeconds: number };
  const envelope = cfg['input'] as { bufferMaxSize: number };
  const stepSeconds = network.simulationStepSeconds;
  recorder.observe('configuration', {
    speedMetresPerSecond: speed,
    tickRate: network.tickRate,
    simulationStepSeconds: stepSeconds,
    bufferMaxSize: envelope.bufferMaxSize,
    configHash: identity.configHash,
  });

  const stack = await loadPinnedStack(ROOT);
  const server = await startHarnessServer(ROOT, {
    region: defineOperatorRegionRoom({ config: deploymentOverrides }),
  } as never);

  try {
    // ── B. the compliant seat drives the public Reconciler ────────────────────────────────────
    const mover = await withTimeout(connectSeat(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'mover create');
    const epoch = await waitForIssuedEpoch(mover.room);
    const handle = mover.room.input<Record<string, unknown>>();
    // The advertised-rate members are public SDK declarations (api map §12); the harness's
    // JSDoc handle type does not narrow them, so this structural read is the honest read —
    // `undefined` here is a recorded finding (the missing-advertised-rate failure), never a coercion.
    const advertised = handle as unknown as { tickRate?: number; stepMs?: number; patchRate?: number };
    recorder.observe('advertised_step', {
      tickRate: advertised.tickRate, stepMs: advertised.stepMs, patchRate: advertised.patchRate, epoch,
    });
    recorder.check('room-advertises-the-fixed-rate-on-the-handle',
      advertised.tickRate === network.tickRate && advertised.stepMs === stepSeconds * 1000,
      `tickRate ${String(advertised.tickRate)} stepMs ${String(advertised.stepMs)} patchRate ${String(advertised.patchRate)} (a missing advertised rate is a failure the spike must catch)`);

    // Same-delivery pairing (GA-8 shape): the ack and the disposition record are read inside ONE
    // state-change callback — the delivery that moved one is the delivery whose other field is read.
    const pairings: { delivery: number; ack: number; resolved: number; retired: number; tick: number }[] = [];
    mover.room.onStateChange(() => {
      const row = rowOf(mover.room);
      if (row === undefined) return;
      pairings.push({
        delivery: pairings.length + 1,
        ack: handle.lastProcessed,
        resolved: row.inputResolvedThrough,
        retired: row.inputRetiredUnrepresented,
        tick: row.lastAuthorityTick,
      });
    });

    // The reconciler binds to the seat's OWN decoded replica row and the real input handle — no
    // fake anywhere on the replay path. `step` restates the flat relation; `smoothMs: 0` keeps
    // corrections raw (Gate A measures the pre-display-smoothing magnitude). `reconcileSeq` is the
    // SDK's own reconcile counter: every step of ONE reconcile observes the same pre-increment
    // value, so grouping the step log by it is grouping by reconcile window.
    const stepLog: { seq: number; replay: boolean; reconcileWindow: number }[] = [];
    const firstRow = rowOf(mover.room);
    if (firstRow === undefined) throw new Error('the mover seat never replicated a row');
    const reconciler = new sdkIndex.Reconciler(firstRow as object, {
      input: handle,
      fields: ['x', 'z'],
      smoothMs: 0,
      step: (
        ctx: { dt: number; tick: number; isReplay: boolean },
        state: Record<string, number>,
        command: Record<string, number>,
      ) => {
        state['x'] = (state['x'] ?? 0) + (((command['moveX'] as number) ?? 0) * speed * ctx.dt);
        state['z'] = (state['z'] ?? 0) + (((command['moveZ'] as number) ?? 0) * speed * ctx.dt);
        stepLog.push({ seq: ctx.tick, replay: ctx.isReplay, reconcileWindow: reconciler.reconcileSeq });
      },
    });
    // Every reconcile, captured as it happens: the prediction immediately before the SDK adopted,
    // the state immediately after (adopted truth plus any replayed pending), and the row/ack of
    // that moment. Zero-correction reconciles — the wire-precision short-circuit where the
    // prediction already matches the truth — are recorded here too, because Gate A counts them.
    const rawReconciles: {
      atMs: number; ack: number; resolved: number; sent: number; rowZ: number | null;
      predictedBeforeZ: number; predictedAfterZ: number; correctionZ: number | null;
    }[] = [];
    const pump = (): void => {
      const beforeZ = reconciler.state.z;
      const windowBefore = reconciler.reconcileSeq;
      reconciler.tick(performance.now());
      if (reconciler.reconcileSeq !== windowBefore) {
        const r = rowOf(mover.room);
        const rowZ = r?.z ?? null;
        rawReconciles.push({
          atMs: Math.trunc(performance.now()),
          ack: handle.lastProcessed,
          resolved: r?.inputResolvedThrough ?? -1,
          // `sent − ack` is the pending count at this reconcile: correctionZ is the exact raw
          // correction only when it is 0; with inputs pending it additionally carries their
          // (known, per-frame) step contribution, which the spike's trace writer decomposes.
          sent: handle.sentCount,
          rowZ,
          predictedBeforeZ: beforeZ,
          predictedAfterZ: reconciler.state.z,
          correctionZ: rowZ === null ? null : beforeZ - rowZ,
        });
      }
    };
    const pumpFor = async (ms: number, everyMs = 16): Promise<void> => {
      const end = performance.now() + ms;
      while (performance.now() < end) { pump(); await sleep(everyMs); }
    };
    const send = (frame: Record<string, unknown>): number => stampAndSend(handle, frame);

    // B1 — prediction is immediate at send(): the predicted row moved before any delivery moved it.
    const zBeforeSend = reconciler.state.z;
    const rowZBeforeSend = rowOf(mover.room)?.z ?? 0;
    send({ sessionEpoch: epoch, generation: 1, directIntent: true, moveX: 0, moveZ: 1 });
    const movedImmediately = reconciler.state.z - zBeforeSend;
    recorder.check('prediction-moves-at-send-not-at-delivery',
      Math.abs(movedImmediately - speed * stepSeconds) < 1e-12
      && (rowOf(mover.room)?.z ?? 0) === rowZBeforeSend,
      `predicted +${movedImmediately.toFixed(9)} m synchronously with send(); the replicated row had not moved yet`);

    // B2 — two more valid frames, then one the AUTHORITY refuses (axis outside [-1, 1]): the
    // client predicted 5 · speed · dt of travel, the server represents it with a neutral step
    // (GA-4), so the delivery that acks seq 4 is a server-forced correction the primitive absorbs.
    for (let index = 2; index <= 3; index += 1) {
      await pumpFor(70);
      send({ sessionEpoch: epoch, generation: index, directIntent: true, moveX: 0, moveZ: 1 });
    }
    await pumpFor(70);
    send({ sessionEpoch: epoch, generation: 4, directIntent: true, moveX: 0, moveZ: 5 });

    // The correction is read ACROSS a reconcile (the pump's own record), not from a read position
    // that poll order could move: an earlier run measured 0 here purely because the acked delivery
    // was already adopted before the outer read ran. The refused frame's boundary is the
    // reconcile whose ack/resolved covers seq 4; its raw magnitude is predicted-before minus the
    // authoritative row, with nothing replayed at that instant (nothing was pending).
    const corrected = await untilAsync(async () => {
      await pumpFor(30);
      return rawReconciles.some((entry) => entry.ack >= 4 && entry.resolved >= 4
        && entry.correctionZ !== null && Math.abs(entry.correctionZ - 5 * speed * stepSeconds) < 1e-9);
    }, 8_000);
    await pumpFor(150);
    const rowAfterAdopt = rowOf(mover.room);
    recorder.check('server-refusal-reaches-the-seat-as-a-correction-boundary',
      rawReconciles.some((entry) => entry.ack >= 4 && entry.resolved >= 4),
      `reconciles ${JSON.stringify(rawReconciles)}`);
    recorder.check('correction-is-adopted-to-the-authoritative-row',
      Math.abs(reconciler.state.z - (rowAfterAdopt?.z ?? Number.NaN)) < 1e-9,
      `predicted z ${reconciler.state.z.toFixed(9)} equals the replicated row ${String(rowAfterAdopt?.z.toFixed(9))} at the matched boundary (float64 axes, ADR-0001: exact)`);
    const boundaryReconcile = rawReconciles.find((entry) => entry.ack >= 4 && entry.resolved >= 4
      && entry.correctionZ !== null && Math.abs(entry.correctionZ - 5 * speed * stepSeconds) < 1e-9);
    recorder.observe('raw_correction_at_matched_boundary_metres', {
      entry: boundaryReconcile ?? null,
      allReconciles: rawReconciles,
      note: 'predicted-before minus authoritative-row at the reconcile that adopted the boundary (smoothMs 0, no display smoothing): one refused frame of 5·v·dt against its neutral authoritative step; reconciles with correction 0 are the SDK short-circuit where prediction already matched, retained as the zero-correction population',
    });
    recorder.check('raw-correction-is-measured-not-assumed',
      corrected && boundaryReconcile !== undefined,
      `boundary reconcile ${JSON.stringify(boundaryReconcile ?? null)}; expected |correction| ${String(5 * speed * stepSeconds)} (one refused frame of 5·v·dt)`);

    // B3 — replay of the remaining valid inputs: within one reconcile each pending seq steps at
    // most once, and only seqs the boundary has not resolved. One frame mid-burst is again one the
    // authority refuses, so the reconciler's wire-precision short-circuit (a prediction that
    // MATCHES the truth skips adopt+replay) cannot excuse an empty observation: the mismatch
    // guarantees real adopt+replay windows while frames 8..10 are still in flight.
    const boundaryBeforeBurst = handle.lastProcessed;
    for (let index = 5; index <= 10; index += 1) {
      const moveZ = index === 7 ? 5 : 1;
      send({ sessionEpoch: epoch, generation: index, directIntent: true, moveX: 0, moveZ });
      await pumpFor(35);
    }
    const settled = await untilAsync(async () => {
      await pumpFor(30);
      const r = rowOf(mover.room);
      return r !== undefined && handle.lastProcessed >= 10 && r.inputResolvedThrough >= 10;
    }, 8_000);
    // One quiet interval after the client-observed boundary: the room's tick record for the
    // consuming tick is pushed in the same synchronous tick body that published the row, so a
    // completed client-side observation of `resolved == 10` already implies the record exists —
    // this pause makes that ordering observable rather than relied-upon.
    await pumpFor(80);
    const replaySteps = stepLog.filter((entry) => entry.replay);
    const perWindowSeqs = new Map<number, number[]>();
    for (const entry of replaySteps) {
      const seqs = perWindowSeqs.get(entry.reconcileWindow) ?? [];
      seqs.push(entry.seq);
      perWindowSeqs.set(entry.reconcileWindow, seqs);
    }
    const windowSummaries = [...perWindowSeqs.entries()].map(([window, seqs]) => ({
      reconcileWindow: window,
      seqs: seqs.sort((a, b) => a - b),
      duplicatedWithinWindow: seqs.length !== new Set(seqs).size,
    }));
    const anyDouble = windowSummaries.some((summary) => summary.duplicatedWithinWindow);
    recorder.observe('replay_windows', { boundaryBeforeBurst, windows: windowSummaries });
    recorder.check('replay-ran-between-ack-boundaries', replaySteps.length >= 1 && settled,
      `boundary at burst start ${String(boundaryBeforeBurst)}; replayed steps ${String(replaySteps.length)}; windows ${JSON.stringify(windowSummaries)}`);
    recorder.check('replayed-each-pending-input-at-most-once-per-reconcile', !anyDouble,
      `per-window seq lists ${JSON.stringify(windowSummaries.map((s) => s.seqs))}; ctx.isReplay is the SDK's own replay flag, reconcileSeq its own window id`);

    // B4 — no second authoritative step: the room consumed each seq this seat sent exactly once,
    // under this seat's entity id only (the offender below shares the room, not the ledger).
    const moverEntity = movementMod.authorityEntityId(mover.room.sessionId);
    const roomsAtB4 = RegionRoom.liveRooms();
    const consumedForMover = roomsAtB4
      .flatMap((instance) => instance.tickRecords.flatMap((record) => record.consumed))
      .filter((entry) => entry.entityId === moverEntity)
      .map((entry) => entry.seq);
    const uniqueConsumed = new Set(consumedForMover);
    recorder.observe('consumed_seqs_for_mover', {
      sent: 10,
      consumed: consumedForMover.slice().sort((a, b) => a - b),
      // Ledger context so a missing entry is diagnosable from the artefact alone: which rooms
      // exist, how far each has ticked, and what its last recorded consumed row was.
      rooms: roomsAtB4.map((instance) => ({
        records: instance.tickRecords.length,
        lastRecordTick: instance.tickRecords[instance.tickRecords.length - 1]?.tick ?? -1,
        lastConsumed: instance.tickRecords[instance.tickRecords.length - 1]?.consumed ?? [],
        allConsumedForMover: instance.tickRecords.flatMap((r) => r.consumed).filter((e) => e.entityId === moverEntity).map((e) => e.seq),
      })),
      clientAckAtRead: handle.lastProcessed,
      clientResolvedAtRead: rowOf(mover.room)?.inputResolvedThrough ?? -1,
    });
    recorder.check('authority-consumed-each-sent-seq-exactly-once',
      consumedForMover.length === uniqueConsumed.size && uniqueConsumed.size >= 10,
      `consumed entries ${String(consumedForMover.length)}, distinct ${String(uniqueConsumed.size)} for ${moverEntity}, seqs ${JSON.stringify(consumedForMover.slice().sort((a, b) => a - b))} (local prediction added no authority step: the predicted set is a superset of, never extra to, the consumed set)`);

    // B5 — the compliant stream's two boundaries agree, per delivery (the precondition under which
    // the SDK-retirement boundary and the disposition boundary select the same replay set).
    const compliantPairings = pairings.filter((p) => p.retired === 0);
    const disagree = compliantPairings.filter((p) => p.ack !== p.resolved);
    recorder.observe('same_delivery_pairings', pairings.slice(-8));
    recorder.check('compliant-delivery-boundaries-agree',
      compliantPairings.length >= 3 && disagree.length === 0,
      `${String(compliantPairings.length)} retired-zero deliveries, ${String(disagree.length)} where ack != inputResolvedThrough (read inside one delivery each)`);

    // ── C. the divergence reproduction: retirement outrunning resolution ──────────────────────
    const offender = await withTimeout(connectSeat(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'offender create');
    const offenderEpoch = await waitForIssuedEpoch(offender.room);
    const offenderHandle = offender.room.input<Record<string, unknown>>();
    const lastDelivery: { resolved: number; retired: number; ack: number; gapStart: number; gapEnd: number; tick: number } = {
      resolved: -1, retired: -1, ack: -1, gapStart: -1, gapEnd: -1, tick: -1,
    };
    offender.room.onStateChange(() => {
      const r = rowOf(offender.room);
      if (r === undefined) return;
      // Scalars only, read inside the delivery: a schema instance must never be retained by
      // reference across patches (it is mutated in place).
      lastDelivery.resolved = r.inputResolvedThrough;
      lastDelivery.retired = r.inputRetiredUnrepresented;
      lastDelivery.ack = offenderHandle.lastProcessed;
      lastDelivery.gapStart = r.inputGapStart;
      lastDelivery.gapEnd = r.inputGapEnd;
      lastDelivery.tick = r.lastAuthorityTick;
    });
    const burst = envelope.bufferMaxSize + 12;
    for (let index = 0; index < burst; index += 1) {
      stampAndSend(offenderHandle, { sessionEpoch: offenderEpoch, generation: 1, directIntent: true, moveX: 0.1, moveZ: 0 });
    }
    const retiredSeen = await untilAsync(() => lastDelivery.retired > 0, 8_000);
    const retiredAck = offenderHandle.lastProcessed;
    recorder.observe('eviction_divergence', {
      burst,
      ack: retiredAck,
      lastDelivery,
      sent: offenderHandle.sentCount,
    });
    recorder.check('eviction-makes-retirement-outrun-resolution',
      retiredSeen && lastDelivery.resolved >= 0 && lastDelivery.resolved < retiredAck && lastDelivery.retired > 0,
      `resolvedThrough ${String(lastDelivery.resolved)} < lastProcessed ${String(retiredAck)} with retired ${String(lastDelivery.retired)}, gap ${String(lastDelivery.gapStart)}..${String(lastDelivery.gapEnd)} (the two boundaries are observably distinct claims)`);
    let recoverable = 0;
    const probeCount = Math.max(0, Math.min(retiredAck, offenderHandle.sentCount) - lastDelivery.resolved);
    for (let seq = lastDelivery.resolved + 1; seq <= Math.min(retiredAck, offenderHandle.sentCount); seq += 1) {
      if (offenderHandle.at(seq) !== undefined) recoverable += 1;
    }
    recorder.check('unresolved-but-retired-inputs-are-not-recoverable-through-any-public-surface',
      probeCount >= 1 && recoverable === 0,
      `at(seq) over (${String(lastDelivery.resolved)}, ${String(retiredAck)}]: ${String(recoverable)} of ${String(probeCount)} recoverable — at()/reckonTimeAt() are the handle's only seq lookbacks and both retire-gate on lastProcessed`);

    recorder.observe('control_and_adverse_ledgers', {
      control: {
        seat: 'mover',
        pacing: 'controlled: 70–105 ms spacing in B2, 35 ms spacing burst in B3 — every frame delivered, no eviction',
        sent: 10,
        consumedSeqs: consumedForMover.slice().sort((a, b) => a - b),
        consumedOnceEach: consumedForMover.length === uniqueConsumed.size,
        ackAtEnd: handle.lastProcessed,
        resolvedAtEnd: rowOf(mover.room)?.inputResolvedThrough ?? -1,
        retiredAtEnd: rowOf(mover.room)?.inputRetiredUnrepresented ?? -1,
      },
      adverse: {
        seat: 'offender',
        pacing: `tight burst of ${String(burst)} frames into a ${String(envelope.bufferMaxSize)}-frame buffer`,
        sent: offenderHandle.sentCount,
        ackAtEnd: retiredAck,
        resolvedThrough: lastDelivery.resolved,
        namedGap: [lastDelivery.gapStart, lastDelivery.gapEnd],
        retiredUnrepresented: lastDelivery.retired,
        recoverableUnresolved: recoverable,
      },
      note: 'the sent-equals-consumed-once equality is asserted on the controlled all-delivered stream; the burst is retained as the adverse case with its own exact ledger outcome, never merged into the control',
    });

    recorder.observe('verdict', {
      publicPredictionSurface: 'Predict / Reconciler / SimReconciler exist and run on the real room, real handle, real PlayerSchema row',
      dispositionBoundaryInjectable: false,
      evidence: [
        'RollbackOptions/ReconcilerOptions/SimReconcilerOptions declare no resolution-boundary member (Part A2)',
        'tick() polls input.lastProcessed; replay iterates max(acked, replayFrom)+1..sentCount from the handle ring (Part A3)',
        'InputHandle.at(seq) returns undefined for seq <= lastProcessed, so a disposition bound BELOW the SDK watermark cannot recover inputs through any public surface (Part A3, reproduced live in Part C)',
      ],
      compatibleRegime: 'On a compliant in-envelope stream the two boundaries are equal on every retired-zero delivery (B5), the refused-frame case reconciles to the row exactly (B2), and replay selects each pending seq at most once per reconcile (B3): the public Reconciler is usable for the spike on the compliant envelope, with the disposition record — read in the same delivery — as the authority for retention/resynchronisation and SDK retirement never consulted as a representation claim.',
      incompatibleRegime: 'When retirement outruns resolution (eviction/dedupe, ADR-0003 §3.1, PR-13/PR-15) no public hook can move the SDK boundary to inputResolvedThrough; the ADR-mandated behaviour there is discard-pending + resynchronisation, which is expressible with public primitives (input.reset() epoch follow-through, bounded rejoin), and a predictor that instead kept replaying unresolved inputs WOULD be a custom predictor requiring an ADR — this probe is the minimal reproduction for that line.',
      decisionRequestedOf: 'Codex (delegated approver): confirm the spike builds its seat-side policy layer on the public Reconciler + disposition record under compatibleRegime, or commission an ADR first.',
    });
    recorder.limit('correctionZ is predicted-before minus the authoritative row: exactly the raw correction at a matched boundary when nothing is pending (the recorded boundary reconcile: sent == ack), and raw-plus-pending-steps otherwise (the sent/ack pair on every entry makes that decomposition possible from the artefact alone).');
    recorder.limit('The harness `until` is sync-predicate-only and returns true immediately for an async predicate (measured live: it made two of this probe\'s waits vacuous on an earlier run). The probe uses its own untilAsync and reports the trap to the harness owner; transport.mjs is not this task\'s file to change.');
    recorder.limit('Part B times against the room cadence (20 Hz ticks, 250 ms patch): the replay-window observation needs one ack mid-burst; windows are generous, and a miss is reported as a failed check, never skipped.');
    recorder.limit('The reconciler step here restates the flat relation for the probe; the spike itself keeps tests/reference/flat-direct-step.ts as the sole movement function, and this probe asserts nothing about locomotion (UDG-005/006 own it).');
    recorder.limit('Not Gate A; no threshold, profile, or P06 claim; stackCompatibility remains not-established.');
    recorder.limit('The browser-side wiring of these primitives (Vite-served seat, remote-interpolation limb) is the next slice; this probe ran the identical package build under Node.');

    await mover.room.leave().catch(() => undefined);
  } finally {
    recorder.write(outPath);
    await server.close().catch(() => undefined);
    process.stdout.write(`[roundtrip] ${recorder.passed ? 'pass' : 'FAIL'} — ${String(recorder.checks.filter((c) => c.ok).length)}/${String(recorder.checks.length)} checks; observations incl. verdict in ${outPath}\n`);
    process.exit(recorder.passed ? 0 : 1);
  }
}

void main();
