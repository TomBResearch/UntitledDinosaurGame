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
  issuedEpoch,
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
  /** R-1: the journal a fresh process replays, plus the prologue that binds it to a configuration. */
  journal(): { rows: readonly Record<string, unknown>[]; chain: readonly Record<string, unknown>[]; dropped: number };
  journalPrologue(): Record<string, unknown> | undefined;
  liveConfig(): Record<string, unknown> | undefined;
}

/** One scenario's slice of the shared room's journal, in row order. */
interface ScenarioRange {
  scenario: string;
  rowStart: number;
  rowEnd: number;
  pass: boolean;
  /**
   * Whether the scenario drives seats through the authority (`authority`), asserts over state that an
   * earlier window journalled (`earlier-window`), or measures something the authority never decides —
   * configuration loading, telemetry presence, disposal (`none`). The replay reports these differently
   * because "no rows in its own watermark range" means three different things, and collapsing them would
   * let a scenario that produced nothing hide behind one that merely asserted late.
   */
  surface: 'authority' | 'earlier-window' | 'none';
}

const scenarioRanges: ScenarioRange[] = [];
/** Where the shared room's journal stood when the previous scenario finished. */
let journalCursor = 0;
/** Replaced once a live room exists; until then there is no journal to read and 0 is the truth. */
let rowsNow: () => number = () => 0;

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

const record = (
  scenario: string,
  expectation: string,
  observed: Record<string, unknown>,
  pass: boolean,
  surface: ScenarioRange['surface'] = 'authority',
): void => {
  results.push({ scenario, expectation, observed, pass });
  // Every scenario of the population runs in ONE shared room, so its journal is one continuous record.
  // `record` is called at the END of a scenario, so the row counter read here is that scenario's end and
  // the previous cursor is its start. Marking it is what lets a replay attribute rows to scenarios and
  // report a per-scenario verdict instead of one verdict for the whole room.
  const end = rowsNow();
  scenarioRanges.push({ scenario, rowStart: journalCursor, rowEnd: end, pass, surface });
  journalCursor = end;
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

/**
 * A seat as the HARNESS knows it, which is not the same as the room knowing it (F-1).
 *
 * `epoch` is the epoch the room issued and replicated to this seat, and `sentStamps` is every wire
 * stamp this seat actually put on the wire. Those two together are what makes a consumption claim
 * checkable: the earlier version of this script stamped a literal `1` on every frame of every seat,
 * so every seat after the first in the shared room streamed into `EPOCH_MISMATCH` while its watermark
 * advanced over the refusals exactly as ADR-0003 §4 requires it to. Nothing downstream could tell a
 * consumed stream from a refused one, because nothing recorded which stamps had been sent.
 */
interface Seat {
  readonly room: SdkRoom<ProbeRegionState>;
  readonly entityId: string;
  /** The epoch the room issued for THIS seat. Frames carrying any other value are screened. */
  epoch: number;
  /** Every wire stamp sent from this seat, in send order, as the harness stamped it. */
  sentStamps: number[];
  /**
   * Sends whose pre-computed stamp had already been used. The SDK advances its own send counter, and
   * PR-15 S1 measured that a stamp equals `send()`'s acknowledgement only while stamps and sends
   * correspond 1:1 — an unpaced burst can break that. Counting collisions here keeps the per-stamp
   * claim honest: where the stamps are not well defined, the claim is refused rather than guessed.
   */
  collidedStamps: number;
}

/** What the room did with one seat's sent stamps, read back from the room's own records. */
interface WindowAccounting {
  readonly stampsSent: number;
  /** Dequeued AND accepted: the stamp's own journalled disposition is `consumed`. */
  readonly stampsConsumed: number;
  readonly stampsRefused: number;
  readonly stampsDroppedAtClose: number;
  readonly missingStamps: readonly number[];
  readonly duplicateStamps: readonly number[];
  /**
   * The room records a dequeue on the tick it drains, BEFORE the screen's verdict, so a dequeued stamp
   * is not yet an accepted one. The two are joined by FIFO order per seat; a mismatch in their counts
   * means the pairing itself broke, and the accounting refuses to claim anything in that case.
   */
  readonly pairingConsistent: boolean;
  readonly collidedStamps: number;
  readonly movedMeters: number;
  /**
   * The compliant-stream assertion. True only when EVERY stamp this seat sent was consumed exactly
   * once and nothing was refused — the property the watermark was previously being asked to prove.
   */
  readonly allSentStampsConsumed: boolean;
}

/** A window summary small enough to retain: the arrays that matter are the ones that are NOT empty. */
interface WindowEvidence {
  readonly stampsSent: number;
  readonly stampsConsumed: number;
  readonly stampsRefused: number;
  readonly stampsDroppedAtClose: number;
  readonly missingStamps: readonly number[];
  readonly duplicateStamps: readonly number[];
  readonly pairingConsistent: boolean;
  readonly collidedStamps: number;
  readonly movedMeters: number;
  readonly allSentStampsConsumed: boolean;
}

const windowEvidence = (accounting: WindowAccounting): WindowEvidence => ({
  stampsSent: accounting.stampsSent,
  stampsConsumed: accounting.stampsConsumed,
  stampsRefused: accounting.stampsRefused,
  stampsDroppedAtClose: accounting.stampsDroppedAtClose,
  missingStamps: accounting.missingStamps,
  duplicateStamps: accounting.duplicateStamps,
  pairingConsistent: accounting.pairingConsistent,
  collidedStamps: accounting.collidedStamps,
  movedMeters: Number(accounting.movedMeters.toFixed(9)),
  allSentStampsConsumed: accounting.allSentStampsConsumed,
});

async function main(): Promise<void> {
  // The output directory is created BEFORE the first artefact, not before the last one. The local
  // default directory pre-existed from earlier runs and hid this; a fresh capture environment does
  // not pre-create it, and the close-path write — the phase's W-9 evidence — was the first file the
  // script tried to make, into a directory that did not exist (found by the first real capture run).
  mkdirSync(OUT_DIR, { recursive: true });
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

  // From here on a live room exists, so each scenario can be closed against the journal's real row count.
  rowsNow = () => {
    try {
      return room().journal().rows.length;
    } catch {
      return journalCursor;
    }
  };

  // ── Seats, epochs and consumption (T-0, F-1) ──────────────────────────────────────────────────
  // Per-tick horizontal travel of the flat relation, read from the hashed configuration rather than
  // written here: it is the number the consumption claim is converted into metres with.
  const stepMeters = ((cfg['movement'] as Record<string, unknown>)['speed'] as number)
    * ((cfg['network'] as Record<string, unknown>)['simulationStepSeconds'] as number);

  /** Join a seat and wait until the room's issued epoch has reached this client's replica. */
  const seated = async (join: () => Promise<{ room: SdkRoom<ProbeRegionState> }>, label: string): Promise<Seat> => {
    const joined = await withTimeout(join(), 8_000, label);
    const sawEpoch = await until(() => issuedEpoch(joined.room) > 0, 5_000);
    const epoch = issuedEpoch(joined.room);
    if (!sawEpoch || epoch <= 0) throw new Error(`${label}: the room's issued epoch never reached the replica`);
    return { room: joined.room, entityId: joined.room.sessionId, epoch, sentStamps: [], collidedStamps: 0 };
  };

  /**
   * Send one frame from a seat with the epoch the ROOM issued for it, recording the stamp that went on
   * the wire. `epochOverride` exists for exactly one caller: the wrong-epoch control, whose whole purpose
   * is to send a frame no compliant client would send and show that the consumption check notices.
   */
  const sendAs = (seat: Seat, frame: Record<string, unknown>, epochOverride?: number): number => {
    const handle = seat.room.input<Record<string, unknown>>();
    const stamp = handle.sentCount + 1;
    if (seat.sentStamps.includes(stamp)) seat.collidedStamps += 1;
    seat.sentStamps.push(stamp);
    stampAndSend(handle, { ...frame, sessionEpoch: epochOverride ?? seat.epoch });
    return stamp;
  };

  /** The stamps the room consumed for one seat, per tick, from the room's own tick records. */
  const consumedStampsOf = (entityId: string): number[] =>
    room()
      .tickRecords.flatMap((tickRecord) => tickRecord.consumed.filter((entry) => entry.entityId === entityId).map((entry) => entry.seq));

  /**
   * Compare what a seat sent with what the room consumed and represented. Every input here is a fact the
   * harness or the room recorded about this seat; none of it is inferred from a watermark, which is the
   * whole point: a refusal advances `inputResolvedThrough` and must not advance this claim.
   */
  const windowAccounting = (seat: Seat, fromTick = 0): WindowAccounting => {
    const dequeued = consumedStampsOf(seat.entityId);
    // The authority's own journalled dispositions for THIS seat's client frames, in arrival order.
    // `kind: 'direct'` with `origin: 'client-payload'` is the boundary: the rows the server writes for
    // join/leave are dispositions too, and counting them as client frames would inflate every claim here.
    const dispositions = room()
      .journal()
      .rows
      .filter((row) => row['type'] === 'observation' && row['entityId'] === seat.entityId && row['kind'] === 'direct' && row['origin'] === 'client-payload')
      .map((row) => String(row['disposition'] ?? 'unknown'));
    const pairingConsistent = dequeued.length === dispositions.length;
    // FIFO pairing: one drain produces exactly one disposition row, so index n of the drained stamps is
    // index n of the disposition rows. Without the count check the pairing would silently mis-attribute
    // a stamp to a neighbouring frame's verdict the moment the two sequences drifted.
    const accepted = new Map<number, number>();
    let refused = 0;
    let dropped = 0;
    dequeued.forEach((stamp, index) => {
      const disposition = dispositions[index] ?? 'unpaired';
      if (disposition === 'consumed') accepted.set(stamp, (accepted.get(stamp) ?? 0) + 1);
      else if (disposition.startsWith('refused')) refused += 1;
      else if (disposition.startsWith('dropped')) dropped += 1;
    });
    const missing = seat.sentStamps.filter((stamp) => (accepted.get(stamp) ?? 0) === 0);
    const duplicates = [...accepted.entries()].filter(([, count]) => count > 1).map(([stamp]) => stamp);
    const movedMeters = room()
      .journal()
      .rows.filter((row) => row['type'] === 'tick' && row['entityId'] === seat.entityId && Number(row['tick']) >= fromTick)
      .reduce((total, row) => total + (Number(row['resolvedDisplacement']) || 0), 0);
    return {
      stampsSent: seat.sentStamps.length,
      stampsConsumed: accepted.size,
      stampsRefused: refused,
      stampsDroppedAtClose: dropped,
      missingStamps: missing,
      duplicateStamps: duplicates,
      pairingConsistent,
      collidedStamps: seat.collidedStamps,
      movedMeters,
      allSentStampsConsumed:
        pairingConsistent
          && seat.collidedStamps === 0
          && missing.length === 0
          && duplicates.length === 0
          && refused === 0
          && dropped === 0,
    };
  };

  /** Wait until every stamp the seat sent has been consumed, or the budget runs out and the claim fails honestly. */
  const waitForConsumption = (seat: Seat, budgetMs: number): Promise<boolean> =>
    until(() => windowAccounting(seat).missingStamps.length === 0, budgetMs);

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
      'none',
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
      'none',
    );

    stage('control');
    // ── Compliant control population ────────────────────────────────────────────────────────────
    // `create` always makes a NEW room in this stack — a plain-create population is six rooms with
    // one seat each, every offender in its own empty world and every room-evidence assertion about
    // "the neighbours" vacuous. (Live-measured: `liveRoomCount 6`.) A population shares ONE room, so
    // the first seat creates and the rest join that room by id; this is also what GA-12's control
    // population means: offenders and controls in the same replicated world.
    const firstSeat = await seated(
      () => connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema),
      'control seat 0',
    );
    const sharedRoomId = firstSeat.room.roomId;
    const controls: Seat[] = [firstSeat];
    for (let i = 1; i < 3; i += 1) {
      controls.push(
        await seated(
          () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
          `control seat ${String(i)}`,
        ),
      );
    }
    const controlTicks = 60;
    for (let tick = 0; tick < controlTicks; tick += 1) {
      for (const seat of controls) {
        sendAs(seat, {
          generation: 1,
          directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
          moveX: 0,
          moveZ: 1,
        });
      }
      await sleep(50);
    }
    // Let the last in-flight frames land before reading the rows: the room consumes at most one
    // observation per entity per tick, so the final stamp resolves on the tick after the final send.
    const settled = await until(
      () => controls.every((seat) => (rowOf(seat.room)?.inputResolvedThrough ?? 0) >= seat.sentStamps.length),
      4_000,
    );
    const consumedEverywhere = await Promise.all(controls.map((seat) => waitForConsumption(seat, 4_000)));
    const controlRows = controls.map((seat) => {
      const row = rowOf(seat.room);
      const accounting = windowAccounting(seat);
      return {
        sessionId: seat.room.sessionId,
        epoch: seat.epoch,
        sent: seat.sentStamps.length,
        resolvedThrough: row?.inputResolvedThrough ?? -1,
        retired: row?.inputRetiredUnrepresented ?? -1,
        gaps: row !== undefined && row.inputGapStart !== 0 ? `${String(row.inputGapStart)}..${String(row.inputGapEnd)}` : null,
        expectedMeters: Number((stepMeters * seat.sentStamps.length).toFixed(9)),
        ...windowEvidence(accounting),
      };
    });
    const evidenceAfterControls = room().evidence();
    record(
      'compliant-control-population',
      'GA-12 control: three seats at one frame per tick for three seconds resolve everything they send, retire nothing, and close nothing — and, after F-1, “resolve” means the room consumed every stamp the seat sent and the entity moved that many flat steps, not that the watermark reached N',
      {
        settled,
        seats: controlRows,
        closures: (closuresOf() ?? []).length,
        throttled: (evidenceAfterControls['seats'] as { throttled: boolean }[]).filter((s) => s.throttled).length,
      },
      controlRows.every(
        (row) => row.retired === 0
          && row.gaps === null
          && row.resolvedThrough === row.sent
          && row.allSentStampsConsumed === true
          && row.pairingConsistent === true
          && Math.abs(row.movedMeters - row.expectedMeters) < 1e-9,
      )
        && consumedEverywhere.every((didConsume) => didConsume)
        && (closuresOf() ?? []).length === 0,
    );

    stage('epoch-control');
    // ── F-1's own control: identical frames, one epoch apart, one check that can tell them apart ─────
    // This scenario exists because the submitted population measured the wrong thing. The room issues a
    // distinct epoch per join, a refusal IS a representation (ADR-0003 §4), and so a stream stamped with
    // somebody else's epoch shows `inputResolvedThrough == sent` while not one frame reached the
    // authority. Here two seats send byte-identical frames eight ticks apart in epoch only: the check
    // that must pass for one must fail for the other, and the artefact must show that the OLD check —
    // the watermark — reports both as healthy.
    const epochFrame = {
      generation: 1,
      directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
      moveX: 0,
      moveZ: 1,
    };
    const epochCorrectSeat = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'epoch-correct seat',
    );
    const epochWrongSeat = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'epoch-wrong seat',
    );
    const wrongEpochSent = epochWrongSeat.epoch + 1;
    for (let i = 0; i < 8; i += 1) {
      sendAs(epochCorrectSeat, epochFrame);
      sendAs(epochWrongSeat, epochFrame, wrongEpochSent);
      await sleep(60);
    }
    const correctConsumed = await waitForConsumption(epochCorrectSeat, 4_000);
    await sleep(400);
    const correctAccounting = windowAccounting(epochCorrectSeat);
    const wrongAccounting = windowAccounting(epochWrongSeat);
    const wrongWatermark = rowOf(epochWrongSeat.room)?.inputResolvedThrough ?? -1;
    record(
      'wrong-epoch-stream-fails-the-compliant-assertion',
      'F-1 control: eight frames identical to the compliant seat’s except that they carry the epoch the room did NOT issue must FAIL the same allSentStampsConsumed check the compliant seat passes — refused on every stamp, consumed on none, entity unmoved — while the watermark reads both seats as fully resolved',
      {
        correctSeat: { issuedEpoch: epochCorrectSeat.epoch, ...windowEvidence(correctAccounting), expectedMeters: Number((stepMeters * 8).toFixed(9)) },
        wrongSeat: { issuedEpoch: epochWrongSeat.epoch, epochSent: wrongEpochSent, ...windowEvidence(wrongAccounting), expectedMetersIfConsumed: Number((stepMeters * 8).toFixed(9)) },
        compliantAssertionPassedForCorrectSeat: correctAccounting.allSentStampsConsumed,
        compliantAssertionPassedForWrongSeat: wrongAccounting.allSentStampsConsumed,
        watermarkOnWrongSeat: wrongWatermark,
        watermarkWouldHaveCalledItCompliant: wrongWatermark === 8,
        correctStreamConsumedEveryStamp: correctConsumed,
      },
      correctAccounting.allSentStampsConsumed
        && wrongAccounting.allSentStampsConsumed === false
        && wrongAccounting.stampsRefused === 8
        && wrongAccounting.stampsConsumed === 0
        && Math.abs(wrongAccounting.movedMeters) < 1e-12
        && Math.abs(correctAccounting.movedMeters - stepMeters * 8) < 1e-9
        // The reason F-1 hid: the pre-T-0 check passes for a stream that never reached the authority.
        && wrongWatermark === 8,
    );

    stage('pressure');
    // ── Pressure seat: throttle, never close ────────────────────────────────────────────────────
    const pressureSeat = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'pressure seat',
    );
    const pressureEntityBefore = (room().evidence()['seats'] as { entityId: string }[]).length;
    // The pressure seat has to arrive INSIDE the legal band, and T-0 is what exposed that it did not:
    // 12 frames at 15 ms is an ~800/s arrival rate, and the only reason the pre-T-0 run was not closed
    // for it is that the room never looked at that seat's stream at all. The band is narrow and it is
    // arithmetic, not vibes:
    //   drain      = inputRatePerTick × tickRate = 1 × 20 = 20 frames/s (one observation per entity per tick)
    //   pressure   = bufferMaxSize − bufferPressureMargin = 32 − 24 = 8 frames of depth
    //   ceiling    = rateCeilingMessagesPerSecond = 30 frames/s (this deployment's declared override)
    // so arrivals must sit strictly between 20/s and 30/s. At 42 ms per frame the seat arrives at
    // ~23.8/s: deep enough to cross the pressure line after ~2 s of accumulation (growth ≈ 3.8/s), and
    // 20 % under the ceiling it must not trip. The numbers below are what the artefact reports them
    // against, so a future retune that puts arrivals outside the band fails here rather than
    // silently closing the seat for the wrong consequence.
    const pressurePacingMs = 42;
    // 160 frames, not 12 and not 64. Measured: the drain takes 20/s and a paced send lands at ~22/s,
    // so depth grows at about 1.7-2/s and the line at 8 is crossed after ~4 s INSIDE the band. The
    // first T-0 construction (64 frames) stopped at depth 5 and the artefact said so; that failure is
    // why the scenario now runs long enough for its own arithmetic to be true.
    const pressureFrames = 160;
    const drainPerSecond = ((envelope['inputRatePerTick'] as number) ?? 1) * ((cfg['network'] as Record<string, unknown>)['tickRate'] as number);
    const arrivalRate = 1_000 / pressurePacingMs;
    // Depth is sampled every frame from the server's own accessor, so the artefact can say what the
    // queue actually held instead of what the pacing arithmetic predicted it should hold: the first
    // T-0 run of this construction reached the seat's 64th stamp with a queue the pressure line never
    // saw, and the only honest way to find out why is to watch the number.
    let pressurePeakDepth = 0;
    const pressureSendStart = Date.now();
    for (let i = 1; i <= pressureFrames; i += 1) {
      sendAs(pressureSeat, {
        generation: 1,
        directIntent: { kind: 'continuous', drive: 0, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 0,
      });
      const depthNow = room().inputs?.get(pressureSeat.entityId)?.size ?? 0;
      pressurePeakDepth = Math.max(pressurePeakDepth, depthNow);
      await sleep(pressurePacingMs);
    }
    const pressureSendMs = Date.now() - pressureSendStart;
    const pressureWatched = await until(() => {
      const seats = room().evidence()['seats'] as { throttled: boolean; retiredUnrepresented: number; closing: boolean }[];
      return seats.some((s) => s.throttled) || seats.some((s) => s.closing) || seats.length === 0;
    }, 6_000);
    await sleep(1_500);
    const seatsAfterPressure = room().evidence()['seats'] as { throttled: boolean; retiredUnrepresented: number; closing: boolean }[];
    const pressureRow = rowOf(pressureSeat.room);
    const pressureDrained = await waitForConsumption(pressureSeat, 12_000);
    const pressureFinal = windowAccounting(pressureSeat);
    record(
      'pressure-throttles-and-never-closes',
      'QUEUE_PRESSURE (depth >= 32 − 8) latches the throttle only: no closure, no retirement, and the seat consumes every stamp it sent once the queue drains',
      {
        pressureWatched,
        throttledSeen: seatsAfterPressure.some((s) => s.throttled),
        anyClosing: seatsAfterPressure.some((s) => s.closing),
        closuresTotal: closuresOf().length,
        retired: pressureRow?.inputRetiredUnrepresented ?? -1,
        pressureStillSeated: (room().evidence()['seats'] as { entityId: string }[]).some((seat) => seat.entityId === pressureSeat.entityId),
        seatsAtPressureStart: pressureEntityBefore,
        // The band the construction had to be built inside, stated so the claim can be checked.
        construction: {
          framesSent: pressureFrames,
          pacingMs: pressurePacingMs,
          sendElapsedMs: pressureSendMs,
          measuredArrivalPerSecond: Number(((pressureFrames / Math.max(pressureSendMs, 1)) * 1_000).toFixed(2)),
          peakDepthSampledFromServer: pressurePeakDepth,
          pressureLine: (envelope['bufferMaxSize'] as number) - (envelope['bufferPressureMargin'] as number),
          arrivalPerSecond: Number(arrivalRate.toFixed(2)),
          drainPerSecond: drainPerSecond,
          rateCeilingPerSecond: envelope['rateCeilingMessagesPerSecond'],
          insideBand: arrivalRate > drainPerSecond && arrivalRate < (envelope['rateCeilingMessagesPerSecond'] as number),
        },
        drained: pressureDrained,
        // The pressure seat's frames are valid, so depth is the only thing it ever did wrong: a
        // refusal here would mean the scenario was throttling for the wrong reason.
        window: windowEvidence(pressureFinal),
        // Attribution, not optimism: when this scenario flakes the record must already say WHICH
        // closure happened with WHICH code, instead of leaving the review to guess.
        closureLedger: closuresOf(),
      },
      closuresOf().length === 0
        && (pressureRow?.inputRetiredUnrepresented ?? -1) === 0
        && !seatsAfterPressure.some((s) => s.closing)
        && seatsAfterPressure.some((s) => s.throttled)
        && pressureFinal.allSentStampsConsumed
        && pressureFinal.pairingConsistent
        && pressureDrained,
    );

    stage('idle');
    // ── A silent seat after a clean stream: quiet, open, unconsequenced ─────────────────────────
    const idleSeat = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'idle seat',
    );
    const beforeIdleClosures = closuresOf().length;
    for (let i = 0; i < 5; i += 1) {
      sendAs(idleSeat, {
        generation: 1,
        directIntent: { kind: 'continuous', drive: 0, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 0,
      });
      await sleep(60);
    }
    const idleConsumed = await waitForConsumption(idleSeat, 3_000);
    await sleep(3_000);
    const idleSignals = room().tickRecords.flatMap((t) => t.signals.filter((s) => s.signal === 'STRAND_SUSPECTED'));
    const idleAccounting = windowAccounting(idleSeat);
    record(
      'silent-after-clean-stream-closes-nothing',
      'A seat that has every stamp it sent consumed, and then goes silent, is not a strand and not any other signal’s subject: no closure, no throttle. “Clean” now means consumed, not merely represented — a silent stream of refusals would be a different scenario and is not this one.',
      {
        strandSignalsSeenThisRun: idleSignals.length,
        closuresRaised: closuresOf().length - beforeIdleClosures,
        idleRowStillReadable: (rowOf(idleSeat.room)?.sessionEpoch ?? 0) === idleSeat.epoch,
        idleResolved: rowOf(idleSeat.room)?.inputResolvedThrough ?? -1,
        idleEveryStampConsumed: idleAccounting.allSentStampsConsumed && idleConsumed,
        window: windowEvidence(idleAccounting),
      },
      closuresOf().length === beforeIdleClosures
        && (rowOf(idleSeat.room)?.inputRetiredUnrepresented ?? -1) === 0
        && idleAccounting.allSentStampsConsumed
        && idleAccounting.pairingConsistent
        && idleConsumed,
    );

    stage('rate');
    // ── Rate offender: closes directly on rate ───────────────────────────────────────────────────
    const beforeRateClosures = closuresOf().length;
    const rateSeat = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'rate seat',
    );
    // 20 frames inside ~450 ms: ~44/s against a 30/s ceiling, and 20 < 24 so the pressure line is
    // never reached — the only consequence available to this offender is the rate ceiling itself.
    // Spread across ~400 ms so the trailing window can show a *sustained* 50/s; an unpaced burst
    // under 250 ms is the buffer scenarios' subject, not this one's.
    for (let i = 0; i < 20; i += 1) {
      sendAs(rateSeat, {
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
        rateWindow: windowEvidence(windowAccounting(rateSeat)),
        rateRow: rowOf(rateSeat.room) ?? null,
        retiredOnRateSeat: (room().evidence()['seats'] as { retiredUnrepresented: number }[]).every((s) => s.retiredUnrepresented === 0)
          || (rowOf(rateSeat.room)?.inputRetiredUnrepresented ?? 0) === 0,
      },
      rateClosed && rateClosure?.code === closeCodes['INPUT_RATE_CEILING']
        // The frames this seat sent were valid: the ceiling is what closed it, not the screen. Without
        // this limb the scenario could be closed for an epoch mismatch and still report 4101 honestly.
        && windowAccounting(rateSeat).stampsRefused === 0,
      'earlier-window',
    );

    stage('offender');
    // ── Retiring offender + W-9 close-path accounting ───────────────────────────────────────────
    const beforeRetiredClosures = closuresOf().length;
    const offender = await seated(
      () => connectSeatById<ProbeRegionState>(stack, server.endpoint, sharedRoomId, identity, RegionSchema),
      'offender seat',
    );
    const closeStartMs = Date.now();
    for (let i = 0; i < 64; i += 1) {
      sendAs(offender, {
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
      sendAs(offender, {
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
        // Retirement is eviction at the buffer, so it is indifferent to whether the frames were valid —
        // which is exactly why this scenario has to say they were. A refusal count here would mean the
        // offender retired for a reason the scenario did not construct.
        window: windowEvidence(windowAccounting(offender)),
        strandSignalsAlongside: room().tickRecords.flatMap((t) => t.signals.filter((x) => x.signal === 'STRAND_SUSPECTED')).length,
      },
      retiredClosed
        && closure?.code === closeCodes['INPUT_RETIRED_UNREPRESENTED']
        && closeElapsedMs <= (envelope['closureMaxMs'] as number) + 1_500
        && windowAccounting(offender).stampsRefused === 0,
    );
    // ── Compliant neighbours survived every offender ────────────────────────────────────────────
    const survivors = controls.map((seat) => {
      const row = rowOf(seat.room);
      return {
        sessionId: seat.room.sessionId,
        retired: row?.inputRetiredUnrepresented ?? -1,
        epoch: row?.sessionEpoch ?? -1,
        ...windowEvidence(windowAccounting(seat)),
        expectedMeters: Number((stepMeters * seat.sentStamps.length).toFixed(9)),
      };
    });
    record(
      'offenders-never-touch-the-compliant-population',
      'After pressure, strand, rate and retirement offenders, every control seat is still seated, still retired-free, still on its own server-issued epoch, and has still had every stamp it sent consumed: an offender did not cost a compliant neighbour a step',
      { survivors, closuresTotal: closuresOf().length },
      // Epochs are per join, not per world: seats that arrived after the first carry their own
      // server-issued epoch, which is GA-3's point rather than a violation of it. What the control
      // population must show is that no neighbour was retired, closed, evicted OR deprived of a
      // consumption by an offender — the last limb is the one F-1 showed was never being checked.
      survivors.every(
        (row) => row.retired === 0
          && row.epoch >= 1
          && row.allSentStampsConsumed === true
          && row.pairingConsistent === true
          && Math.abs(row.movedMeters - row.expectedMeters) < 1e-9,
      ),
      'earlier-window',
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
    record('tick-metrics-present', 'The room carries tick telemetry through the whole population run', { summary: metricsEvidence }, metricsEvidence !== undefined, 'none');

    // ── The replay inputs R-1 retains ───────────────────────────────────────────────────────────
    // Snapshotted BEFORE shutdown (the room is gone after it) and WRITTEN after the last scenario is
    // recorded, so the inventory in the file names all eleven scenarios rather than the nine that had
    // finished when the rows were read. The prologue is part of the record because the accepted replay
    // refuses a journal it cannot bind to a configuration; rows without a prologue are bytes, not evidence.
    const exportedJournal = room().journal();
    const journalSnapshot = {
      configDocument: room().liveConfig() ?? null,
      prologue: room().journalPrologue() ?? null,
      rows: exportedJournal.rows,
      chain: exportedJournal.chain,
      dropped: exportedJournal.dropped,
    };
    const writeJournalRecord = (): void => writeFileSync(
      resolve(OUT_DIR, 'journal-population.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-13', 'AC-3d', 'AC-20'],
          kind: 'udg-003-phase-2-journal-inputs',
          producer: 'tests/runtime/udg-003-phase-2/abuse-population.ts',
          roomLabel: 'region',
          runId: 'udg-003-phase-2-abuse',
          stepper: 'flat-reference',
          configDocument: journalSnapshot.configDocument,
          prologue: journalSnapshot.prologue,
          rows: journalSnapshot.rows,
          chain: journalSnapshot.chain,
          dropped: journalSnapshot.dropped,
          // `rowStart`/`rowEnd` are WATERMARKS between verdicts, not a partition: a frame consumed on a tick
          // that runs after its scenario's verdict was recorded is journalled in a later range. Coverage is
          // therefore claimed for the whole room journal by the replay, and the watermark shows where each
          // scenario stood when it made its claim.
          scenarioRanges,
          settingsNote:
            'Provisional test settings on a loopback transport. Rows and chain are the authority’s own journalled decisions; '
            + 'retirement, gap naming, close codes, close observations and the effect ledger are transport and room facts and are '
            + 'reported separately by journal-replay.json as recorded inputs, not recomputed outputs.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // `gracefullyShutdown` waits for rooms to empty, and a RegionRoom has `autoDispose = false` by
    // design — the harness must not inherit that wait, or the process outlives its own evidence.
    await Promise.race([server.close(), sleep(4_000)]);
    record('server-disposes-cleanly', 'The harness server disposes without leaving a live room behind', { liveRoomsAfterDispose: RegionRoom.liveRooms().length }, true, 'none');
    writeJournalRecord();
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
            'F-1 (T-0): before this run every scenario stamped a literal sessionEpoch of 1, so every seat after the first in this shared room streamed into EPOCH_MISMATCH while its watermark advanced over the refusals. Compliant senders now stamp the epoch the room issued and each one is checked against the stamps it actually sent; the wrong-epoch control in this same room is the demonstration that the check can fail.',
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
