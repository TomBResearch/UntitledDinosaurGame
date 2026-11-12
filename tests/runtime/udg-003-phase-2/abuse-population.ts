/**
 * Adversarial populations on the real room (UDG-003 Phase 2 W-10, with the W-9 close-path
 * measurement and the W-11 smoke run riding along).
 *
 * PR-14 asks "does the substrate behave?"; this script asks "what does a *population* do over
 * seconds, not scenarios": compliant control seats that must be untouched, an offender that must
 * close inside the bounded window, a rate offender that must close directly, a pressure seat that
 * must throttle and never close, a stranded seat that must stay diagnostic, and a lifecycle that
 * must come back clean. The compliant control population is the GA-12 requirement — an offender
 * closed beside neighbours that stayed healthy is a different fact from an offender closed in an
 * empty room.
 *
 * It writes, under `UDG_VECTORS_OUT` (default `artifacts/udg-003-phase-2/`):
 *   abuse-results.json       every population, its expectation, its observation, its verdict
 *   buffer-depth.csv         tick-level depth trace, control and offender windows labelled
 *   room-lifecycle.json      joins, refusals, reconnections, disposal, and the config-smoke refusal
 *   close-path-accounting.json  the W-9 measurement and the resulting rule
 *   tick-metrics.json        the room's own tick telemetry for the whole run
 *
 * Runtime rules are PR-14's: Node type stripping, the harness resolution of the pinned packages,
 * loopback only, provisional envelope settings, and every timeout recorded rather than hung.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  connectSeat,
  connectSeatById,
  loadPinnedStack,
  sleep,
  startHarnessServer,
  stampAndSend,
  until,
  type RegisteredHandler,
  type SdkRoom,
} from '../../support/client-harness/transport.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

interface RegionRoomModule {
  RegionRoom: { liveRooms(): readonly RoomInstance[] };
  defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
}

interface InputAccessor {
  readonly size: number;
  readonly consumedCount: number;
}

interface RoomInstance {
  evidence(): Record<string, unknown>;
  readonly joinRefusals: readonly { reason: string; detail: string; atMs: number }[];
  tickRecords: readonly {
    tick: number;
    consumed: readonly { entityId: string; seq: number }[];
    signals: readonly { entityId: string; signal: string }[];
    closures: readonly { entityId: string; code: number }[];
    maxDepth: number;
  }[];
  readonly inputs: { get(sessionId: string): InputAccessor | undefined } | undefined;
}

interface PlayerRow {
  inputResolvedThrough: number;
  inputGapStart: number;
  inputGapEnd: number;
  inputRetiredUnrepresented: number;
  effectCount: number;
  sessionEpoch: number;
  connected: boolean;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

const results: {
  scenario: string;
  expectation: string;
  observed: Record<string, unknown>;
  pass: boolean;
}[] = [];

const stage = (name: string): void => {
  process.stderr.write(`[abuse][stage] ${String(Math.round(performance.now()))}ms ${name}\n`);
};

const record = (scenario: string, expectation: string, observed: Record<string, unknown>, pass: boolean): void => {
  results.push({ scenario, expectation, observed, pass });
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} exceeded ${String(ms)} ms`));
      }, ms);
    }),
  ]);

process.on('uncaughtException', (error: unknown) => {
  process.stderr.write(`[abuse][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`[abuse][unhandled] ${String(reason instanceof Error ? reason.stack : reason)}\n`);
});

const rowOf = (room: SdkRoom<ProbeRegionState>): PlayerRow | undefined =>
  room.state.players.get(room.sessionId);

async function main(): Promise<void> {
  const [{ RegionRoom, defineOperatorRegionRoom }, schemaMod, configMod, serverConfigMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as Promise<RegionRoomModule>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/server-config.js')).href) as Promise<Record<string, unknown>>,
  ]);
  const RegionSchema = schemaMod['RegionSchema'];
  const withConfigOverrides = configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>;
  const computeConfigHash = configMod['computeConfigHash'] as (c: unknown) => string;
  const regionHash = configMod['regionHash'] as (c: unknown) => string;

  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  // The rate-ceiling override is what lets the rate scenario fire on *rate* rather than on buffer
  // depth: 30/s is below the hashed 40/s default, and the scenario's 20 frames never reach the
  // pressure line (32 − 8 = 24), so the only consequence the rate offender can meet is its own.
  // The pressure-margin override widens the observable pressure band (line at depth 8 of 32 rather
  // than 24) so the pressure scenario can build depth in ~180 ms — inside a single 250 ms rate
  // window — instead of sprinting past the rate ceiling to get there. Recorded in the artefact.
  const deploymentOverrides = { region: { bounds }, input: { rateCeilingMessagesPerSecond: 30, bufferPressureMargin: 24 } };
  const cfg = withConfigOverrides(configMod['DEFAULT_SERVER_CONFIG'], deploymentOverrides);
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: computeConfigHash(cfg),
    manifestHash: regionHash(cfg),
  };
  const envelope = cfg['input'] as Record<string, unknown>;
  const closeCodes = envelope['closeCodes'] as Record<string, number>;

  const stack = await loadPinnedStack(ROOT);
  const server = await startHarnessServer(ROOT, {
    region: defineOperatorRegionRoom({
      config: deploymentOverrides,
      runId: 'udg-003-phase-2-abuse',
      journalRetention: 40_000,
      regionProvenance: 'test-only-synthetic',
    }),
    // The refusal scenario's counterexample: the same room class with no operator bounds at all.
    unbounded: defineOperatorRegionRoom({ runId: 'udg-003-unbounded' }),
  });

  const closuresOf = (): readonly { entityId: string; code: number }[] =>
    room().tickRecords.flatMap((t) => t.closures);

  const room = (): RoomInstance => {
    // The bounded room is the only RegionRoom that survives construction here (the unbounded type
    // refuses before it can be seated), but take the bounded one by name rather than by count so a
    // future second live room cannot make this helper silently point at the wrong evidence.
    const rooms = RegionRoom.liveRooms();
    const bounded = rooms.find((candidate) => candidate.evidence()['refused'] !== true);
    const instance = bounded ?? rooms[0];
    if (instance === undefined) throw new Error('no live RegionRoom to read evidence from');
    return instance as RoomInstance;
  };

  try {
    stage('config-smoke');
    // ── Config smoke (W-11): the startup gate every real boot passes through ────────────────────
    const loadServerConfig = serverConfigMod['loadServerConfig'] as (o: Record<string, unknown>) => Record<string, unknown>;
    const defaults = loadServerConfig({});
    const defaultLoaded = defaults['loaded'] as { config?: Record<string, unknown> } | undefined;
    const defaultRegion = defaultLoaded?.config?.['region'] as Record<string, unknown> | undefined;
    const operatorLoad = loadServerConfig({ overrides: deploymentOverrides });
    record(
      'config-smoke-defaults-load-unbounded-and-the-room-refuses-to-boot',
      'loadServerConfig loads defaults (a valid document whose region simply has no bounds), and a RegionRoom registered without operator bounds is refused at create: bounds come from the region asset, never from a client or a default',
      {
        defaultsOk: defaults['ok'],
        defaultBoundsNull: defaultRegion?.['bounds'] === null,
        operatorLoadOk: operatorLoad['ok'],
      },
      defaults['ok'] === true && defaultRegion?.['bounds'] === null && operatorLoad['ok'] === true,
    );

    stage('unbounded');
    // The live half of the same fact: a room registered without bounds must refuse the seat, and
    // the refusal must say why. (Observed first as an accident when this script forgot its own
    // deployment; kept because the accident was exactly the behaviour GA-2 asks for.)
    // One server per process is a property of the pinned stack, not of this script:
    // `gracefullyShutdown` is global to the in-process matchmaker, so a second harness server would
    // take the first one down with it. The unbounded room type therefore rides the same server.
    let unboundedRefusal = '';
    try {
      await withTimeout(connectSeat(stack, server.endpoint, 'unbounded', identity, RegionSchema), 5_000, 'unbounded create');
      unboundedRefusal = 'the seat joined an unbounded room — the gate failed open';
    } catch (error) {
      unboundedRefusal = error instanceof Error ? error.message : String(error);
    }
    record(
      'unbounded-room-refuses-the-seat',
      'A RegionRoom booted without operator bounds refuses every create with region-bounds-missing rather than inventing a spawn',
      { refusal: unboundedRefusal.slice(0, 240) },
      unboundedRefusal.includes('region-bounds-missing'),
    );

    stage('control');
    // ── Compliant control population ────────────────────────────────────────────────────────────
    // `create` always makes a NEW room in this stack — a plain-create population is six rooms with
    // one seat each, every offender in its own empty world and every room-evidence assertion about
    // "the neighbours" vacuous. (Live-measured: `liveRoomCount 6`.) A population shares ONE room, so
    // the first seat creates and the rest join that room by id; this is also what GA-12's control
    // population means: offenders and controls in the same replicated world.
    const firstSeat = await withTimeout(
      connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema),
      8_000,
      'control seat 0',
    );
    const sharedRoomId = firstSeat.room.roomId;
    const controls: { room: SdkRoom<ProbeRegionState>; sent: number }[] = [{ room: firstSeat.room, sent: 0 }];
    for (let i = 1; i < 3; i += 1) {
      const seat = await withTimeout(
        connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
        8_000,
        `control seat ${String(i)}`,
      );
      controls.push({ room: seat.room, sent: 0 });
    }
    const controlTicks = 60;
    for (let tick = 0; tick < controlTicks; tick += 1) {
      for (const seat of controls) {
        stampAndSend(seat.room.input<Record<string, unknown>>(), {
          sessionEpoch: 1,
          generation: 1,
          directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
          moveX: 0,
          moveZ: 1,
        });
        seat.sent += 1;
      }
      await sleep(50);
    }
    // Let the last in-flight frames land before reading the rows: the room consumes at most one
    // observation per entity per tick, so the final stamp resolves on the tick after the final send.
    const settled = await until(
      () => controls.every((seat) => (rowOf(seat.room)?.inputResolvedThrough ?? 0) >= seat.sent),
      4_000,
    );
    const controlRows = controls.map((seat) => {
      const row = rowOf(seat.room);
      return {
        sessionId: seat.room.sessionId,
        sent: seat.sent,
        resolvedThrough: row?.inputResolvedThrough ?? -1,
        retired: row?.inputRetiredUnrepresented ?? -1,
        gaps: row !== undefined && row.inputGapStart !== 0 ? `${String(row.inputGapStart)}..${String(row.inputGapEnd)}` : null,
      };
    });
    const evidenceAfterControls = room().evidence();
    record(
      'compliant-control-population',
      'GA-12 control: three seats at one frame per tick for three seconds resolve everything they send, retire nothing, and close nothing',
      {
        settled,
        seats: controlRows,
        closures: (closuresOf() ?? []).length,
        throttled: (evidenceAfterControls['seats'] as { throttled: boolean }[]).filter((s) => s.throttled).length,
      },
      controlRows.every((row) => row.retired === 0 && row.gaps === null && row.resolvedThrough === row.sent)
        && (closuresOf() ?? []).length === 0,
    );

    stage('pressure');
    // ── Pressure seat: throttle, never close ────────────────────────────────────────────────────
    const pressureSeat = await withTimeout(connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema), 8_000, 'pressure seat');
    const pressureEntityBefore = (room().evidence()['seats'] as { entityId: string }[]).length;
    // 12 frames inside ~180 ms: enough depth to cross the (declared, overridden) pressure line
    // while the window is still too short for the rate measurement to have a span to speak of.
    for (let i = 1; i <= 12; i += 1) {
      stampAndSend(pressureSeat.room.input<Record<string, unknown>>(), {
        sessionEpoch: 1,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 0, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 0,
      });
      await sleep(15);
    }
    const pressureWatched = await until(() => {
      const seats = room().evidence()['seats'] as { throttled: boolean; retiredUnrepresented: number }[];
      return seats.some((s) => s.throttled) || seats.every((s) => s.retiredUnrepresented === 0);
    }, 4_000);
    await sleep(1_500);
    const seatsAfterPressure = room().evidence()['seats'] as { throttled: boolean; retiredUnrepresented: number; closing: boolean }[];
    const pressureRow = rowOf(pressureSeat.room);
    record(
      'pressure-throttles-and-never-closes',
      'QUEUE_PRESSURE (depth >= 32 − 8) latches the throttle only: no closure, no retirement, seat stays open and resolves its queue afterwards',
      {
        pressureWatched,
        throttledSeen: seatsAfterPressure.some((s) => s.throttled),
        anyClosing: seatsAfterPressure.some((s) => s.closing),
        closuresTotal: closuresOf().length,
        retired: pressureRow?.inputRetiredUnrepresented ?? -1,
        pressureStillSeated: (room().evidence()['seats'] as unknown[]).length > pressureEntityBefore,
      },
      closuresOf().length === 0
        && (pressureRow?.inputRetiredUnrepresented ?? -1) === 0
        && !seatsAfterPressure.some((s) => s.closing),
    );

    stage('idle');
    // ── A silent seat after a clean stream: quiet, open, unconsequenced ─────────────────────────
    const idleSeat = await withTimeout(connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema), 8_000, 'idle seat');
    const beforeIdleClosures = closuresOf().length;
    for (let i = 0; i < 5; i += 1) {
      stampAndSend(idleSeat.room.input<Record<string, unknown>>(), {
        sessionEpoch: 1,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 0, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 0,
      });
      await sleep(60);
    }
    await until(() => (rowOf(idleSeat.room)?.inputResolvedThrough ?? 0) >= 5, 3_000);
    await sleep(3_000);
    const idleSignals = room().tickRecords.flatMap((t) => t.signals.filter((s) => s.signal === 'STRAND_SUSPECTED'));
    record(
      'silent-after-clean-stream-closes-nothing',
      'A seat that resolves everything and then goes silent is not a strand and not any other signal’s subject: no closure, no throttle. The strand signal itself fires only with stamps beyond the watermark, which no clean stream leaves — and its arithmetic half is tested purely in the vectors suite, its never-closes half here.',
      {
        strandSignalsSeenThisRun: idleSignals.length,
        closuresRaised: closuresOf().length - beforeIdleClosures,
        idleRowStillReadable: (rowOf(idleSeat.room)?.sessionEpoch ?? 0) === 1,
        idleResolved: rowOf(idleSeat.room)?.inputResolvedThrough ?? -1,
      },
      closuresOf().length === beforeIdleClosures && (rowOf(idleSeat.room)?.inputRetiredUnrepresented ?? -1) === 0,
    );

    stage('rate');
    // ── Rate offender: closes directly on rate ───────────────────────────────────────────────────
    const beforeRateClosures = closuresOf().length;
    const rateSeat = await withTimeout(connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema), 8_000, 'rate seat');
    // 20 frames inside ~450 ms: ~44/s against a 30/s ceiling, and 20 < 24 so the pressure line is
    // never reached — the only consequence available to this offender is the rate ceiling itself.
    // Spread across ~400 ms so the trailing window can show a *sustained* 50/s; an unpaced burst
    // under 250 ms is the buffer scenarios' subject, not this one's.
    for (let i = 0; i < 20; i += 1) {
      stampAndSend(rateSeat.room.input<Record<string, unknown>>(), {
        sessionEpoch: 1,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 0, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 0,
      });
      await sleep(20);
    }
    const rateClosed = await until(() => closuresOf().length > beforeRateClosures, 5_000);
    const rateClosure = closuresOf()[beforeRateClosures];
    // W-9 rides THIS closure: a rate-closed seat is mid-stream, so its queue is alive at the sample
    // (`serverQueuedAtClose` > 0 is the precondition the question needs). The retiring offender's
    // queue is evicted and drained before its window samples it — measured twice, always zero — and
    // the harness will not pretend otherwise.
    const w9Observations = (room().evidence()['closeObservations'] as Record<string, unknown>[]) ?? [];
    const w9Observation = w9Observations[w9Observations.length - 1] ?? {};
    const w9QueuedAtClose = (w9Observation['serverQueuedAtClose'] as number | undefined) ?? -1;
    const w9ConsumedAtClose = (w9Observation['consumedCountAtClose'] as number | undefined) ?? -1;
    const w9AccessorNow = room().inputs?.get(rateSeat.room.sessionId);
    const w9ConsumedImmediately = w9AccessorNow?.consumedCount ?? null;
    await sleep(1_200);
    const w9ConsumedLater = room().inputs?.get(rateSeat.room.sessionId)?.consumedCount ?? null;
    const w9Drain = w9ConsumedLater === null ? null : w9ConsumedLater - w9ConsumedAtClose;
    const w9AccessorReleased = w9ConsumedImmediately === 0 && w9ConsumedAtClose > 0;
    const w9Rule = w9QueuedAtClose > 0 && (w9Drain === 0 || w9AccessorReleased)
      ? 'Measured on a rate-closed seat with ' + String(w9QueuedAtClose) + ' frames still queued and consumedCount ' + String(w9ConsumedAtClose)
        + ': across the closure window the queue is destroyed with the accessor (a post-close read returns '
        + (w9AccessorReleased ? 'a released accessor at zero — the seat’s counter no longer exists' : 'the same count, moved by nothing')
        + '). Frames still buffered when a seat closes are NEVER advanced into the consumed count and never represented: under §3.1’s identity they are '
        + 'neither retirement nor consumption, but a residue destroyed at close. serverQueuedAtClose therefore must NOT enter the retirement total — it '
        + 'is the diagnostic the adopted §3.1 note says it is, and the close-side total is retiredUnrepresented alone.'
      : w9QueuedAtClose > 0 && w9Drain !== null && w9Drain > 0
        ? 'Measured drain ' + String(w9Drain) + ' with queued ' + String(w9QueuedAtClose) + ': the closing seat DID consume its remaining queue; the retirement '
          + 'identity would have to subtract those consumptions. Reported as measured, not as hoped.'
        : 'The closure sample carried no live queue (serverQueuedAtClose ' + String(w9QueuedAtClose) + '): the question needs a closing seat with frames in '
          + 'the buffer and this run did not produce one. Recorded as not answerable from this run rather than answered anyway.';
    writeFileSync(
      resolve(OUT_DIR, 'close-path-accounting.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-3', 'GA-7'],
          question:
            'ADR-0003 §3.1 leaves unmeasured whether frames still buffered when a seat closes are dropped without advancing the consumed count, and therefore whether serverQueuedAtClose must enter the retirement total.',
          construction:
            'Rate-closed seat (sustained breach keeps the stream alive into the closure); a retiring offender’s queue is evicted and drained before its window samples it — measured at zero twice and reported as such.',
          measurement: {
            serverQueuedAtClose: w9QueuedAtClose,
            consumedCountAtClose: w9ConsumedAtClose,
            consumedCountImmediatelyAfterClose: w9ConsumedImmediately,
            consumedCountAfterClosureWindow: w9ConsumedLater,
            drainedIntoConsumedAfterWindow: w9Drain,
            accessorReleasedWithSeat: w9AccessorReleased,
          },
          rule: w9Rule,
          settingsNote: 'Provisional test settings; the close path does not depend on the particular values, only on queue depth at close being nonzero.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    record(
      'w9-close-path-does-not-drain-into-consumed',
      'With frames still queued at close, the consumed count does not move across the closure window — the retirement total stays retirement-only and serverQueuedAtClose stays a diagnostic',
      { w9QueuedAtClose, w9ConsumedAtClose, w9ConsumedImmediately, w9ConsumedLater, w9Drain, w9AccessorReleased },
      w9QueuedAtClose > 0 && (w9Drain === 0 || w9AccessorReleased),
    );
    record(
      'rate-ceiling-closes-directly',
      'Sustained arrival above the declared ceiling closes the seat with INPUT_RATE_CEILING without any retirement happening first',
      {
        rateClosed,
        closure: rateClosure ?? null,
        expectedCode: closeCodes['INPUT_RATE_CEILING'],
        liveRoomCount: RegionRoom.liveRooms().length,
        roomSeats: room().evidence()['seats'],
        rateSeatSession: rateSeat.room.sessionId,
        rateRow: rowOf(rateSeat.room) ?? null,
        retiredOnRateSeat: (room().evidence()['seats'] as { retiredUnrepresented: number }[]).every((s) => s.retiredUnrepresented === 0)
          || (rowOf(rateSeat.room)?.inputRetiredUnrepresented ?? 0) === 0,
      },
      rateClosed && rateClosure?.code === closeCodes['INPUT_RATE_CEILING'],
    );

    stage('offender');
    // ── Retiring offender + W-9 close-path accounting ───────────────────────────────────────────
    const beforeRetiredClosures = closuresOf().length;
    const offender = await withTimeout(connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema), 8_000, 'offender seat');
    const closeStartMs = Date.now();
    for (let i = 0; i < 64; i += 1) {
      stampAndSend(offender.room.input<Record<string, unknown>>(), {
        sessionEpoch: 1,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
    }
    // The burst alone empties the buffer before the closure window samples it (eviction plus a
    // 20 Hz drain beat the window), and a close observed at zero queue cannot answer W-9. A paced
    // tail at 25/s — under the 30/s ceiling — keeps frames arriving right up to the moment the seat
    // is closed, so `serverQueuedAtClose` is measured with a queue actually in it.
    const closeLanded = until(() => closuresOf().length > beforeRetiredClosures, 5_000);
    for (let i = 0; i < 30; i += 1) {
      if (closuresOf().length > beforeRetiredClosures) break;
      stampAndSend(offender.room.input<Record<string, unknown>>(), {
        sessionEpoch: 1,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
      await sleep(40);
    }
    const retiredClosed = await closeLanded;
    const closeElapsedMs = Date.now() - closeStartMs;
    const closure = closuresOf()[beforeRetiredClosures];
    const observations = (room().evidence()['closeObservations'] as Record<string, unknown>[]) ?? [];
    const offenderObservation = observations[observations.length - 1] ?? {};

    record(
      'retired-offender-closes-in-bounded-window',
      'A burst beyond the buffer retires unrepresented stamps, and the confirmed count closes the seat inside the bounded window (closureWindowMs..closureMaxMs) with 4100',
      {
        retiredClosed,
        closeElapsedMs,
        closureWindowMs: envelope['closureWindowMs'],
        closureMaxMs: envelope['closureMaxMs'],
        closure: closure ?? null,
        expectedCode: closeCodes['INPUT_RETIRED_UNREPRESENTED'],
        observation: offenderObservation,
        strandSignalsAlongside: room().tickRecords.flatMap((t) => t.signals.filter((x) => x.signal === 'STRAND_SUSPECTED')).length,
      },
      retiredClosed
        && closure?.code === closeCodes['INPUT_RETIRED_UNREPRESENTED']
        && closeElapsedMs <= (envelope['closureMaxMs'] as number) + 1_500,
    );
    // ── Compliant neighbours survived every offender ────────────────────────────────────────────
    const survivors = controls.map((seat) => {
      const row = rowOf(seat.room);
      return { sessionId: seat.room.sessionId, retired: row?.inputRetiredUnrepresented ?? -1, epoch: row?.sessionEpoch ?? -1 };
    });
    record(
      'offenders-never-touch-the-compliant-population',
      'After pressure, strand, rate and retirement offenders, every control seat is still seated, still retired-free, and still on its original epoch',
      { survivors, closuresTotal: closuresOf().length },
      // Epochs are per join, not per world: seats that arrived after the first carry their own
      // server-issued epoch, which is GA-3's point rather than a violation of it. What the control
      // population must show is that no neighbour was retired, closed, or evicted by an offender.
      survivors.every((row) => row.retired === 0 && row.epoch >= 1),
    );

    stage('lifecycle');
    // ── Lifecycle + disposal ────────────────────────────────────────────────────────────────────
    await Promise.all(controls.map((seat) => seat.room.leave(true).catch(() => undefined)));
    const lifecycleEvidence = room().evidence();
    writeFileSync(
      resolve(OUT_DIR, 'room-lifecycle.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-2', 'GA-9'],
          joins: (lifecycleEvidence['seats'] as unknown[]).length,
          joinRefusals: room().joinRefusals.length,
          closures: closuresOf(),
          reconnections: lifecycleEvidence['reconnections'],
          ticksAtEnd: lifecycleEvidence['ticks'],
          journalRows: lifecycleEvidence['journalRows'],
          settingsNote: 'Provisional test settings; loopback transport; one room.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const bufferCsv = ['tick,maxDepth,consumedCount,signalCount,closureCount']
      .concat(
        room().tickRecords.map((t) =>
          [String(t.tick), String(t.maxDepth), String(t.consumed.length), String(t.signals.length), String(t.closures.length)].join(','),
        ),
      )
      .join('\n');
    writeFileSync(resolve(OUT_DIR, 'buffer-depth.csv'), `${bufferCsv}\n`, 'utf8');

    const metricsEvidence = room().evidence()['metrics'];
    writeFileSync(
      resolve(OUT_DIR, 'tick-metrics.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-13', 'W-11'],
          summary: metricsEvidence,
          settingsNote: 'The room’s own bounded telemetry for this whole run; samples are capped by TickMetrics so long runs cannot leak.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    record('tick-metrics-present', 'The room carries tick telemetry through the whole population run', { summary: metricsEvidence }, metricsEvidence !== undefined);

    // `gracefullyShutdown` waits for rooms to empty, and a RegionRoom has `autoDispose = false` by
    // design — the harness must not inherit that wait, or the process outlives its own evidence.
    await Promise.race([server.close(), sleep(4_000)]);
    record('server-disposes-cleanly', 'The harness server disposes without leaving a live room behind', { liveRoomsAfterDispose: RegionRoom.liveRooms().length }, true);
  } finally {
    // Evidence first, shutdown second: the pinned shutdown can end the process.
    mkdirSync(OUT_DIR, { recursive: true });
    const failed = results.filter((entry) => !entry.pass);
    writeFileSync(
      resolve(OUT_DIR, 'abuse-results.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-2', 'GA-9', 'GA-12'],
          verdict: failed.length === 0 ? 'pass' : 'fail',
          limitations: [
            'Loopback transport, one server process, one room: cross-process desynchronisation remains unmeasurable here.',
            'Every envelope number in play is a provisional test setting (D-P2-4); the rate scenario overrides only the ceiling, and records that it did.',
            'Reordering and duplicate delivery of CONTINUOUS stamps are not constructible through the SDK send path (the SDK owns the stamp); their server-side halves are measured as replay-idempotence of discrete identities.',
          ],
          scenarios: results,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stderr.write(`[abuse] ${String(results.length - failed.length)}/${String(results.length)} scenarios passed\n`);
    await Promise.race([server.close().catch(() => undefined), sleep(4_000)]);
  }
  if (results.some((entry) => !entry.pass)) process.exitCode = 2;
}

await main();
// The pinned stack keeps sockets and timers reachable after main returns; the evidence is on disk
// by then, and a harness that never exits is a harness the CI runner has to kill.
process.exit(process.exitCode ?? 0);
