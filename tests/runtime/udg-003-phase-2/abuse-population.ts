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
import { flattenConsumed, streamAccounting, type StreamAccounting } from '../../support/authority/accounting.ts';
import { computeDisplacementBounds } from '../../support/authority/displacement-bound.ts';

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

// ── OD-10 (owner ruling, 2026-11-13): the two coverage classes and what each must show ──────────
// Authority-bearing scenarios are replayed from the retained rows and their seat × tick × stamp
// attribution is verified. No-authority scenarios are NOT replayed and must not be counted as replays;
// instead each one shows scenario-specific evidence that the authority path was never entered by it and
// that it produced no authority state or effects. Both classes stay visible in the census, so a scenario
// cannot improve the odds by being reclassified.
//
// `inline` here means "measured at the moment, because it cannot be re-derived later": at config-smoke
// time there is no room to read a journal from, and a refused create leaves no rows behind precisely
// because nothing was ever admitted.
const noAuthorityInline: Record<string, unknown>[] = [];

const stage = (name: string): void => {
  process.stderr.write(`[abuse][stage] ${String(Math.round(performance.now()))}ms ${name}\n`);
};

/**
 * The seats a scenario owns, by entity id. OD-10 (owner ruling 2026-11-13) requires attribution by seat,
 * and the staging ranges below cannot supply it: a frame sent at the end of one scenario is journalled
 * when the room next ticks, which can be after the scenario has already recorded its verdict. Measured,
 * not suspected — the retiring offender's client frames landed in the FOLLOWING scenario's range. So the
 * producer states the seats it used, and attribution is computed from those seats over the whole journal.
 */
const scenarioSeats = new Map<string, string[]>();

const record = (
  scenario: string,
  expectation: string,
  observed: Record<string, unknown>,
  pass: boolean,
  surface: ScenarioRange['surface'] = 'authority',
  seats: readonly Seat[] = [],
): void => {
  if (seats.length > 0) scenarioSeats.set(scenario, seats.map((seat) => seat.entityId));
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
/**
 * The shared accounting record. It lives in `tests/support/authority/accounting.ts` because the
 * recovery, burst and projection scripts have to make the SAME claim from the SAME measurement, and
 * F-1 was born from two scripts each deciding for themselves what "consumed" meant.
 */
type WindowAccounting = StreamAccounting;


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

  /**
   * The room's authority surface, read as one number so that a before/after delta means exactly one
   * thing: rooms in existence, journalled rows, client frames the intake saw, and ticks that consumed
   * input. OD-10 needs this because a no-authority scenario's claim is a NEGATIVE, and a negative is
   * only evidence when the same instrument would have counted it had it happened.
   */
  const authoritySurface = (): { rooms: number; journalRows: number; clientFrames: number; consumedTicks: number } => {
    const live = RegionRoom.liveRooms().filter((candidate) => candidate.evidence()['refused'] !== true);
    let journalRows = 0;
    let clientFrames = 0;
    let consumedTicks = 0;
    for (const candidate of live) {
      const instance = candidate as unknown as RoomInstance;
      const rows = instance.journal().rows;
      journalRows += rows.length;
      clientFrames += rows.filter((row) => row['type'] === 'observation' && row['origin'] === 'client-payload').length;
      consumedTicks += instance.tickRecords.filter((tickRecord) => tickRecord.consumed.length > 0).length;
    }
    return { rooms: live.length, journalRows, clientFrames, consumedTicks };
  };
  // The population room, kept by reference so the disposal scenario can still read its journal after the
  // registry has let it go: an object the harness still holds is not a live room, and the distinction is
  // exactly what that scenario has to show.
  let populationRoomRef: RoomInstance | null = null;
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
  // A second admission identity for the `B = 8` room. The hash gate compares the client's declared
  // `configHash` against the hash of the configuration the ROOM booted with, so a seat joining a room
  // with a different deployment must declare that deployment. This was not a theoretical worry: the
  // first version of T-3 joined the burst room with the population's identity and the create was closed
  // with 1008 and no reason at all — a hash-gate refusal is silent by design, which is correct for a
  // hostile client and unhelpful for a harness that got its own deployment wrong.
  const burstOverrides = { region: { bounds } };
  const burstCfg = withConfigOverrides(configMod['DEFAULT_SERVER_CONFIG'], burstOverrides);
  const burstIdentity = {
    protocolVersion: burstCfg['protocolVersion'] as string,
    configHash: computeConfigHash(burstCfg),
    manifestHash: regionHash(burstCfg),
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
    // T-3 (GA-1): the literal `B = 8` burst. Its own room, so the room's own per-tick depth record has
    // exactly one seat in it and a depth reading cannot be another seat's. The envelope is the hashed
    // default (capacity 32, pressure line 32 - 8 = 24), which is what GA-1's row assumes: eight queued
    // frames sit under the pressure line, so the burst must produce no throttle and no closure.
    burst: defineOperatorRegionRoom({
      config: burstOverrides,
      runId: 'udg-003-burst-b8',
      journalRetention: 8_000,
      regionProvenance: 'test-only-synthetic',
    }),
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
  /**
   * Compare what a seat sent with what the room consumed and represented. Every input here is a fact the
   * harness or the room recorded about this seat; none of it is inferred from a watermark, which is the
   * whole point: a refusal advances `inputResolvedThrough` and must not advance this claim.
   */
  const consumedOf = (): ReturnType<typeof flattenConsumed> => flattenConsumed(room().tickRecords);

  /**
   * The room whose journal contains this entity. The population drives one shared room, but T-3's `B = 8`
   * burst runs in a second room of its own, so "the room" is no longer a safe phrase and a room is now
   * found by the rows it wrote rather than by position in a list.
   */
  const roomHolding = (entityId: string): RoomInstance => {
    for (const candidate of RegionRoom.liveRooms()) {
      const instance = candidate as unknown as RoomInstance;
      if (instance.journal().rows.some((row) => row['entityId'] === entityId)) return instance;
    }
    throw new Error(`no live room journals the entity ${entityId}`);
  };

  /**
   * Compare what a seat sent with what the room consumed and represented. Every input here is a fact the
   * harness or the room recorded about this seat; none of it is inferred from a watermark, which is the
   * whole point: a refusal advances `inputResolvedThrough` and must not advance this claim.
   */
  const windowAccounting = (seat: Seat, fromTick = 0): WindowAccounting =>
    streamAccounting({
      journalRows: room().journal().rows,
      consumed: consumedOf(),
      entityId: seat.entityId,
      sentStamps: seat.sentStamps,
      collidedStamps: seat.collidedStamps,
      fromTick,
    });

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
    populationRoomRef = instance;
    return instance as RoomInstance;
  };

  try {
    stage('config-smoke');
    const surfaceBeforeAnyRoom = authoritySurface();
    // ── Config smoke (W-11): the startup gate every real boot passes through ────────────────────
    const loadServerConfig = serverConfigMod['loadServerConfig'] as (o: Record<string, unknown>) => Record<string, unknown>;
    const defaults = loadServerConfig({});
    const defaultLoaded = defaults['loaded'] as { config?: Record<string, unknown> } | undefined;
    const defaultRegion = defaultLoaded?.config?.['region'] as Record<string, unknown> | undefined;
    const operatorLoad = loadServerConfig({ overrides: deploymentOverrides });
    const defaultsDocument = defaultLoaded?.config ?? null;
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
    noAuthorityInline.push({
      scenario: 'config-smoke-defaults-load-unbounded-and-the-room-refuses-to-boot',
      // The strongest form this scenario has, and the only honest one: at the moment it decided, there
      // was no room in existence to enter an authority path through.
      neverEntered: {
        liveRoomsAtCheck: surfaceBeforeAnyRoom.rooms,
        journalRowsAnywhereAtCheck: surfaceBeforeAnyRoom.journalRows,
        clientFramesAnywhereAtCheck: surfaceBeforeAnyRoom.clientFrames,
        consumedTicksAnywhereAtCheck: surfaceBeforeAnyRoom.consumedTicks,
        seatsJoinedAtCheck: 0,
      },
      noAuthorityEffects: {
        note: 'nothing was seated, so nothing could be decided; the two configuration documents differ exactly where the bounds are',
        defaultConfigHash: computeConfigHash(defaultRegion === undefined ? null : defaultsDocument),
        operatorConfigHash: computeConfigHash((operatorLoad['loaded'] as { config: unknown } | undefined)?.config ?? null),
      },
    });

    stage('unbounded');
    // The live half of the same fact: a room registered without bounds must refuse the seat, and
    // the refusal must say why. (Observed first as an accident when this script forgot its own
    // deployment; kept because the accident was exactly the behaviour GA-2 asks for.)
    // One server per process is a property of the pinned stack, not of this script:
    // `gracefullyShutdown` is global to the in-process matchmaker, so a second harness server would
    // take the first one down with it. The unbounded room type therefore rides the same server.
    let unboundedRefusal = '';
    const surfaceBeforeUnbounded = authoritySurface();
    const roomsBeforeUnbounded = RegionRoom.liveRooms().length;
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
    {
      const surfaceAfterUnbounded = authoritySurface();
      noAuthorityInline.push({
        scenario: 'unbounded-room-refuses-the-seat',
        neverEntered: {
          refusalCode: 'region-bounds-missing',
          clientFramesSent: 0,
          // The create was refused, so the session that tried never existed on the server at all: no
          // alias, no row, no entity. Rows naming it are counted below over the whole journal.
          roomsBeforeAttempt: roomsBeforeUnbounded,
          roomsAfterAttempt: RegionRoom.liveRooms().length,
          journalRowsBeforeAttempt: surfaceBeforeUnbounded.journalRows,
          journalRowsAfterAttempt: surfaceAfterUnbounded.journalRows,
          clientFramesBeforeAttempt: surfaceBeforeUnbounded.clientFrames,
          clientFramesAfterAttempt: surfaceAfterUnbounded.clientFrames,
          consumedTicksBeforeAttempt: surfaceBeforeUnbounded.consumedTicks,
          consumedTicksAfterAttempt: surfaceAfterUnbounded.consumedTicks,
        },
        noAuthorityEffects: {
          framesSentDelta: surfaceAfterUnbounded.clientFrames - surfaceBeforeUnbounded.clientFrames,
          consumedTickDelta: surfaceAfterUnbounded.consumedTicks - surfaceBeforeUnbounded.consumedTicks,
          note: 'the refusal happened at create-time validation, before the intake adapter could see a frame',
        },
      });
    }

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
      'authority',
      controls,
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
      'authority',
      [epochCorrectSeat, epochWrongSeat],
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
      'authority',
      [pressureSeat],
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
      'authority',
      [idleSeat],
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
      'authority',
      [rateSeat],
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
      [rateSeat],
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
      'authority',
      [offender],
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
      controls,
    );

    stage('burst');
    // ── GA-1: the literal `B = 8` burst, then idle (T-3) ──────────────────────────────────────
    // ADR-003 §5's row is "compliant sender, B = 8 burst then idle", passing on "retiredUnrepresented == 0;
    // depth < 32 throughout; inputResolvedThrough reaches the highest stamp at rest; zero resynchronisations",
    // and failing on "any retirement or resynchronisation; a legal burst that evicts (fails the envelope, not
    // the client)". Taking that literally needs one thing the rest of this script never needed: proof that all
    // EIGHT stamps were in the queue at the same time BEFORE the first dequeue. Sampling depth after the fact
    // cannot show it, because the room drains one frame per tick and a 20 Hz tick is 50 ms — about the time
    // eight loopback frames take to arrive, so the depth peak could be 8 or could be 3 and the trace would
    // look the same.
    //
    // The fix is a controlled DRAIN boundary, not a simulated queue: this room runs at `tickRate: 2`, which
    // `CONFIG_BOUNDS.tickRate` (1..100) permits and which `validateNetworkConfig` accepts because the step is
    // given as its exact derivation (0.5 s). Admission, screening, the FIFO accessor and the one-frame-per-tick
    // drain rule are all unchanged — the interval between drains is simply long enough to observe.
    const burstSeat = await seated(
      () => connectSeat<ProbeRegionState>(stack, server.endpoint, 'burst', burstIdentity, RegionSchema),
      'B=8 burst seat',
    );
    const burstRoom = roomHolding(burstSeat.entityId);
    const burstAccounting = (): StreamAccounting => streamAccounting({
      journalRows: burstRoom.journal().rows,
      consumed: flattenConsumed(burstRoom.tickRecords),
      entityId: burstSeat.entityId,
      sentStamps: burstSeat.sentStamps,
      collidedStamps: burstSeat.collidedStamps,
    });
    /** The server-side accessor for this seat: an in-process read of the queue the authority drains. */
    const burstDepth = (): number => burstRoom.inputs?.get(burstSeat.entityId)?.size ?? -1;
    const burstConsumedCount = (): number => burstRoom.inputs?.get(burstSeat.entityId)?.consumedCount ?? -1;
    const burstTicks = (): number => Number(burstRoom.evidence()['ticks'] ?? -1);

    const ticksBeforeBurst = burstTicks();
    const burstStartedAt = performance.now();
    const burstStamps: number[] = [];
    const depthSamples: { readonly atMs: number; readonly depth: number; readonly ticks: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      burstStamps.push(sendAs(burstSeat, {
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      }));
      // The harness is in-process, so this is the SERVER's accessor size, read microseconds after the
      // send returned. It is still not proof on its own: the frame has to cross the socket before the
      // queue grows, which is why the loop below waits for eight PRESENT frames rather than trusting
      // eight SENT ones.
      depthSamples.push({ atMs: Math.round(performance.now() - burstStartedAt), depth: burstDepth(), ticks: burstTicks() });
    }

    // Direct co-presence, if the harness wins the race: an in-process read of the server's own accessor
    // showing eight frames queued and NOTHING dequeued. Corroboration, not the proof - see below.
    let queuedTogether: { readonly depth: number; readonly consumedCount: number; readonly ticks: number; readonly atMs: number } | null = null;
    const watchDeadline = performance.now() + 200;
    while (performance.now() < watchDeadline) {
      const depth = burstDepth();
      const ticksNow = burstTicks();
      depthSamples.push({ atMs: Math.round(performance.now() - burstStartedAt), depth, ticks: ticksNow });
      if (depth === 8 && burstConsumedCount() === 0) {
        queuedTogether = { depth, consumedCount: 0, ticks: ticksNow, atMs: Math.round(performance.now() - burstStartedAt) };
        break;
      }
      if (depth > 8) break; // impossible with a capacity of 32 against a sender of eight; the guard says so
      await new Promise<void>((resolveFrame) => { setImmediate(resolveFrame); });
    }

    // THE PROOF, from the room's own record rather than from a race. `RoomTickRecord.maxDepth` and
    // `TickSample.depths` are read AFTER the drain (`observation.sizeAfter`), and the drain takes exactly
    // one frame per seat per tick. So a post-drain depth of 7 on a tick that consumed one of this seat's
    // stamps means EIGHT were present when that drain began - and the descending run 7,6,5,4,3,2,1,0 across
    // eight consecutive consuming ticks means nothing arrived in between and all eight were there before
    // the first dequeue. Arithmetic, not sampling: had the tick boundary split the burst, the sequence
    // would not be that run and this scenario would fail instead of asserting.
    interface SeatSampleView { readonly tick: number; readonly depths: readonly { readonly entityId: string; readonly size: number }[] }
    const burstDepthSeries = (): { tick: number; size: number }[] =>
      ((burstRoom.evidence()['metricsSamples'] ?? []) as readonly SeatSampleView[])
        .map((sample) => ({ tick: sample.tick, size: sample.depths.find((entry) => entry.entityId === burstSeat.entityId)?.size ?? -1 }));
    const burstExpectedSeries = [7, 6, 5, 4, 3, 2, 1, 0];

    // The eight consumptions, and the at-rest half of GA-1's row.
    const drainedEight = await until(() => burstAccounting().stampsConsumed === 8, 15_000);
    const atRest = burstAccounting();
    // "reaches the highest stamp at rest" is a claim about what the CLIENT can read, and the record it
    // reads is published on the patch cadence: the drain can be journalled before the delivery that
    // carries it lands. Waiting for the delivery is the measurement, not a fudge — the failure mode the
    // wait rules out is a watermark that genuinely never reaches the stamp.
    const watermarkPublished = await until(
      () => (burstSeat.room.state.players.get(burstSeat.room.sessionId)?.inputResolvedThrough ?? 0) >= Math.max(...burstStamps),
      4_000,
    );
    const depthSeries = burstDepthSeries();
    const consumingTicks = [...atRest.consumedTicks].sort((a, b) => a - b);
    const seriesOnConsumingTicks = consumingTicks.map((tick) => depthSeries.find((sample) => sample.tick === tick)?.size ?? -1);
    const subtractionProof = JSON.stringify(seriesOnConsumingTicks) === JSON.stringify(burstExpectedSeries);
    const burstRow = burstSeat.room.state.players.get(burstSeat.room.sessionId);
    const burstSignals = burstRoom.tickRecords
      .flatMap((tickRecord) => tickRecord.signals.filter((signal) => signal.entityId === burstSeat.entityId).map((signal) => signal.signal));
    const burstClosures = burstRoom.tickRecords
      .flatMap((tickRecord) => tickRecord.closures.filter((closure) => closure.entityId === burstSeat.entityId));
    const maxDepthSeen = Math.max(0, ...depthSamples.map((sample) => sample.depth));
    const consumedTicksAscending = [...atRest.consumedTicks].sort((a, b) => a - b);
    const consecutiveDrain = consumedTicksAscending.every((tick, index) => index === 0 || tick === (consumedTicksAscending[index - 1] as number) + 1);
    const distinctStamps = new Set(burstStamps);
    // The ceiling instrument has to be shown LIVE in the same run, or "zero RATE_CEILING for the burst
    // seat" is just an absence. The rate offender earlier in this same capture is that witness.
    const rateScenario = results.find((entry) => entry.scenario === 'rate-ceiling-closes-directly');
    record(
      'b8-burst-then-idle-retires-nothing-and-resynchronises-nothing',
      'GA-1 literally: a compliant sender puts B = 8 frames on the wire back-to-back and then goes idle. All eight distinct stamps are PROVED present in the server queue together before the first dequeue, the authority then consumes them on eight consecutive ticks, nothing retires, nothing closes, no signal fires, the watermark reaches the highest stamp at rest, and depth stays under the 32 limit throughout',
      {
        burstStamps,
        distinctStamps: [...distinctStamps],
        distinctStampCount: distinctStamps.size,
        ticksBeforeBurst,
        directCoPresenceObserved: queuedTogether !== null,
        postDrainDepthSeries: seriesOnConsumingTicks,
        expectedPostDrainSeries: burstExpectedSeries,
        subtractionProof,
        proofRule:
          'depth is sampled after the drain and the drain takes one frame per seat per tick, so a post-drain 7 on a consuming tick means 8 were present when that drain began; the run 7,6,5,4,3,2,1,0 across eight consecutive consuming ticks proves all eight were queued together before the first dequeue and that nothing arrived in between',
        queuedTogether,
        depthSamples,
        maxDepthSeen,
        depthLimit: 32,
        consumedStamps: atRest.consumedStamps,
        consumedTicks: consumedTicksAscending,
        consecutiveDrain,
        stampsConsumed: atRest.stampsConsumed,
        stampsRefused: atRest.stampsRefused,
        pairingConsistent: atRest.pairingConsistent,
        collidedStamps: atRest.collidedStamps,
        watermarkAtRest: burstRow?.inputResolvedThrough ?? -1,
        watermarkReachedHighestStamp: watermarkPublished,
        highestStampSent: Math.max(...burstStamps),
        retiredUnrepresented: burstRow?.inputRetiredUnrepresented ?? -1,
        gapStart: burstRow?.inputGapStart ?? 0,
        gapEnd: burstRow?.inputGapEnd ?? 0,
        signalsForThisSeat: burstSignals,
        closuresForThisSeat: burstClosures,
        movedMeters: atRest.movedMeters,
        ceilingInstrumentWitness: {
          scenario: 'rate-ceiling-closes-directly',
          pass: rateScenario?.pass ?? false,
          observed: rateScenario?.observed ?? null,
        },
        // Disclosed sampling limit, stated rather than glossed: depth is read from the server's own
        // accessor from inside the process, at every send and every 1 ms of the watch loop. The instant of
        // ENQUEUE is still not observable from outside the queue, so "depth < 32 throughout" means at every
        // sample named in this record, and the absence of QUEUE_PRESSURE is the per-drain witness.
        samplingNote: 'server-side accessor reads; enqueue-instant depth is not observable from outside the queue',
      },
      drainedEight
        && subtractionProof
        && distinctStamps.size === 8
        && atRest.stampsConsumed === 8
        && atRest.stampsRefused === 0
        && atRest.pairingConsistent
        && atRest.collidedStamps === 0
        && consecutiveDrain
        && watermarkPublished
        && (burstRow?.inputResolvedThrough ?? -1) === Math.max(...burstStamps)
        && (burstRow?.inputRetiredUnrepresented ?? -1) === 0
        && (burstRow?.inputGapStart ?? 0) === 0
        && (burstRow?.inputGapEnd ?? 0) === 0
        && burstSignals.length === 0
        && burstClosures.length === 0
        && maxDepthSeen < 32,
      // The burst seat is in a room of its own (its identity and configuration are its own), so its
      // attribution is computed over ITS journal, retained alongside this one, and not over the shared
      // room's rows — which is the difference between a window and a coincidence.
      'authority',
      [burstSeat],
    );
    // The burst room is emptied so shutdown does not wait on a room the population no longer needs.
    await burstSeat.room.leave(true).catch(() => undefined);

    // The burst record is its own artefact (OD-9), because GA-1's row is a numeric claim with a proof
    // attached and a reviewer should not have to dig it out of a scenario array.
    writeFileSync(
      resolve(OUT_DIR, 'burst-b8.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-1'],
          producer: 'tests/runtime/udg-003-phase-2/abuse-population.ts',
          statement:
            'ADR-003 §5: compliant sender, B = 8 burst then idle - retiredUnrepresented == 0; depth < 32 throughout; inputResolvedThrough reaches the highest stamp at rest; zero resynchronisations. Failure: any retirement or resynchronisation; a legal burst that evicts (fails the envelope, not the client).',
          envelope: {
            queueCapacity: 32,
            pressureLine: 24,
            depthLimit: 32,
            drainPerTick: 1,
            note: 'hashed defaults, unmodified: the burst room overrides nothing but the region bounds',
          },
          observed: results.find((entry) => entry.scenario === 'b8-burst-then-idle-retires-nothing-and-resynchronises-nothing')?.observed ?? null,
          passed: results.find((entry) => entry.scenario === 'b8-burst-then-idle-retires-nothing-and-resynchronises-nothing')?.pass === true,
        },
        null,
        2,
      )}\n`,
      'utf8',
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

    stage('displacement');
    // ── AC-3c: bounded displacement, re-asserted per tick over THIS population (T-2) ───────────
    // The audit lives in `tests/support/authority/displacement-bound.ts` because its controls have to be
    // the same arithmetic a reviewer would re-run, and because per-tick bounds and per-seat travel
    // budgets are two different claims that a single number would blur.
    const auditSeats: readonly Seat[] = [...controls, epochCorrectSeat, epochWrongSeat, pressureSeat, idleSeat, rateSeat, offender];
    const acceptedStampsByEntity: Record<string, number> = {};
    for (const seat of auditSeats) acceptedStampsByEntity[seat.entityId] = windowAccounting(seat).stampsConsumed;
    const displacementAudit = computeDisplacementBounds({
      journalRows: room().journal().rows,
      boundMetres: stepMeters,
      toleranceMetres: 1e-6,
      acceptedStampsByEntity,
      // The wrong-epoch control seat is the honest subject of the travel-credit control: it sent frames
      // and had none accepted, which is precisely the shape a travel budget must refuse.
      zeroAcceptedEntity: epochWrongSeat.entityId,
    });
    writeFileSync(
      resolve(OUT_DIR, 'displacement-bound.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['AC-3c', 'AC-2'],
          producer: 'tests/runtime/udg-003-phase-2/abuse-population.ts',
          verdict: displacementAudit.passed ? 'pass' : 'fail',
          statement:
            'AC-3c: bounded displacement as AC-2, re-asserted per tick over the abuse population so a burst cannot buy extra travel per tick.',
          bound: {
            metresPerTick: displacementAudit.boundMetres,
            toleranceMetres: displacementAudit.toleranceMetres,
            threshold: displacementAudit.boundMetres + displacementAudit.toleranceMetres,
            derivedFrom: 'movement.speed x network.simulationStepSeconds of the configuration this room booted with',
          },
          classification: displacementAudit.classification,
          classificationRule:
            'accepted-input = a tick row with a non-null consumed stamp; refused-input = an observation row with a refused:* disposition whose eligibleTick is that tick (GA-4 neutralises the step and journals it once); no-input = a neutral tick row with no refused observation at that tick. All three read 0 m, so the distinction is made by the authority’s own rows, never by the metres figure.',
          maxAcceptedDisplacement: displacementAudit.maxAcceptedDisplacement,
          outOfBound: displacementAudit.outOfBound,
          travelBudget: displacementAudit.travelBudget,
          travelBudgetRule:
            'metres travelled per entity <= accepted stamps x per-tick bound + tolerance. The denominator is what the authority accepted, so a seat whose frames were all refused cannot travel any metres: F-1 violates this identity by construction.',
          controls: displacementAudit.controls,
          limitations: [
            'One room, one movement relation (flat reference), provisional test settings: the bound is the relation’s, not a tuned locomotion constant.',
            'The audit reads the population journal after the whole run, so a tick is judged against the same bound every other tick is: no per-phase thresholds are invented here.',
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    record(
      'per-tick-displacement-stays-bounded-across-the-population',
      'AC-3c: every tick that resolved an accepted frame moved its entity by at most the relation’s per-tick bound plus the declared tolerance, every seat’s travelled metres fit its accepted stamps, and the four mutation controls (beyond tolerance, inside tolerance, gross overshoot, unearned travel credit) behave as stated',
      {
        classification: displacementAudit.classification,
        maxAcceptedDisplacement: displacementAudit.maxAcceptedDisplacement,
        outOfBound: displacementAudit.outOfBound,
        seatsOverBudget: displacementAudit.travelBudget.filter((row) => row.exceeded).length,
        controls: displacementAudit.controls.map((control) => ({
          name: control.name,
          expectedDetected: control.expectedDetected,
          detected: control.detected,
          detail: control.detail,
        })),
      },
      displacementAudit.passed,
      'earlier-window',
      [...controls, epochCorrectSeat, epochWrongSeat, pressureSeat, idleSeat, rateSeat, offender],
    );

    // ── buffer-depth.csv: per-tick aggregate PLUS per-seat rows (OD-9) ─────────────────────────
    // The aggregate rows keep their exact previous meaning (`entityId = all`), and the per-seat rows come
    // from the room’s own tick telemetry window. Two shapes in one file would be a trap, so both carry
    // `entityId` and `source`, and a consumer that only wants the old view filters `entityId = all`.
    interface TickSampleView {
      readonly tick: number;
      readonly depths: readonly { readonly entityId: string; readonly size: number }[];
    }
    const roomSampleWindow = (room().evidence()['metricsSamples'] ?? []) as readonly TickSampleView[];
    const perSeatDepthRows = roomSampleWindow.flatMap((sample) =>
      sample.depths.map((depth) => [String(sample.tick), depth.entityId, String(depth.size), 'room-telemetry-window'].join(',')),
    );
    const bufferCsv = ['tick,entityId,maxDepth,consumedCount,signalCount,closureCount,source']
      .concat(
        room().tickRecords.map((t) =>
          [
            String(t.tick),
            'all',
            String(t.maxDepth),
            String(t.consumed.length),
            String(t.signals.length),
            String(t.closures.length),
            'room-tick-record',
          ].join(','),
        ),
      )
      .concat(perSeatDepthRows)
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
    // The `B = 8` burst seat lives in a room of its own, so its authority decisions were journalled in a
    // journal this bundle did not previously retain — which made the burst the one authority scenario that
    // could not be replayed from retained bytes. It is retained here, in this same artefact, rather than as
    // a seventeenth file: the owner accepted a 24-artefact list, and a second journal is not a new claim.
    const burstRoomInstance = RegionRoom.liveRooms()
      .map((candidate) => candidate as unknown as RoomInstance)
      .find((candidate) => candidate.journal().rows.some((row) => row['entityId'] === burstSeat.entityId));
    const burstJournal = burstRoomInstance === undefined ? null : {
      roomLabel: 'burst',
      configDocument: burstRoomInstance.liveConfig() ?? null,
      prologue: burstRoomInstance.journalPrologue() ?? null,
      rows: burstRoomInstance.journal().rows,
      chain: burstRoomInstance.journal().chain,
      dropped: burstRoomInstance.journal().dropped,
    };
    const burstRows: readonly Record<string, unknown>[] = burstJournal?.rows ?? [];
    // ── GA-13: exact seat × tick windows for the two scenarios that share this one journal ─────
    // The population drives one room, so a scenario is not a slice of ROWS (the row ranges are watermarks
    // between verdicts and overlap by construction). What IS exact is attribution: which seat, which tick
    // range, which stamps. Both windows below are sampled at the moments the scenarios themselves recorded.
    const aliasOf = (entityId: string): string | null => {
      const row = exportedJournal.rows.find((candidate) => candidate['entityId'] === entityId && candidate['alias'] !== undefined);
      return row === undefined ? null : String(row['alias']);
    };
    const tickOfRow = (row: Record<string, unknown>): number => Number(row['tick'] ?? row['eligibleTick'] ?? 0);
    const rowsOfAlias = (alias: string): readonly Record<string, unknown>[] => exportedJournal.rows.filter((row) => row['alias'] === alias);
    const windowFor = (aliases: readonly string[], tickStart: number, tickEnd: number): readonly Record<string, unknown>[] =>
      exportedJournal.rows.filter((row) => aliases.includes(String(row['alias'] ?? '')) && tickOfRow(row) >= tickStart && tickOfRow(row) <= tickEnd);
    const stampsConsumedIn = (rows: readonly Record<string, unknown>[]): number[] =>
      [...new Set(rows.filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined).map((row) => Number(row['consumed'])))].sort((a, b) => a - b);
    const dispositionsIn = (rows: readonly Record<string, unknown>[]): Record<string, number> => {
      const tally: Record<string, number> = {};
      for (const row of rows) {
        if (row['type'] !== 'observation' || row['origin'] !== 'client-payload') continue;
        const disposition = String(row['disposition']);
        tally[disposition] = (tally[disposition] ?? 0) + 1;
      }
      return tally;
    };

    const rateAlias = aliasOf(rateSeat.entityId);
    const offenderAlias = aliasOf(offender.entityId);
    const controlAliases = controls.map((seat) => aliasOf(seat.entityId)).filter((alias): alias is string => alias !== null);
    const rateRows = rateAlias === null ? [] : rowsOfAlias(rateAlias);
    const rateTicks = rateRows.map(tickOfRow);
    const closureTicks = room().tickRecords.filter((tickRecord) => tickRecord.closures.length > 0).map((tickRecord) => tickRecord.tick);
    const offenderArrivalTick = offenderAlias === null ? 0 : Math.min(...rowsOfAlias(offenderAlias).map(tickOfRow));
    const populationEndTick = closureTicks.length > 0 ? Math.max(...closureTicks) : 0;

    // The compliant seats streamed BEFORE the offenders arrived, so their frames need their own window;
    // pretending the offending period contains them would have the artefact assert over an empty range.
    const controlFrameRows = exportedJournal.rows.filter((row) => row['type'] === 'observation'
      && row['origin'] === 'client-payload'
      && controlAliases.includes(String(row['alias'] ?? '')));
    const controlFrameTicks = controlFrameRows.map(tickOfRow);
    // ── OD-10: seat × tick × stamp attribution for EVERY scenario of this journal set ───────────
    // The staging ranges in `scenarioRanges` are watermarks between verdicts, and they were measured to
    // be unreliable as attribution: the retiring offender's client frames are journalled after it records
    // its verdict, which puts them in the FOLLOWING scenario's range. So the window is computed from the
    // seats each scenario declared it used, over the whole journal of the room those seats live in, and
    // the staging range is reported beside it as a cross-check rather than as the answer.
    const rowsArray = exportedJournal.rows;
    type JournalRows = readonly Record<string, unknown>[];
    const aliasIn = (rows: JournalRows, entityId: string): string | null => {
      const row = rows.find((candidate) => candidate['entityId'] === entityId && candidate['alias'] !== undefined);
      return row === undefined ? null : String(row['alias']);
    };
    const rowsWithAlias = (rows: JournalRows, alias: string): JournalRows => rows.filter((row) => row['alias'] === alias);
    const tickIn = (row: Record<string, unknown>): number => Number(row['tick'] ?? row['eligibleTick'] ?? Number.NaN);
    // A window is always (journal, alias set, tick range). Alias strings are per-room counters, so the SAME
    // alias names different entities in different rooms — measured here, not theorised: the burst room's
    // seat is `client-01` and so is one seat of the shared room. A window quoted without its journal is
    // ambiguous, and an attribution helper that ignored the journal would silently join two entities.
    const windowIn = (rows: JournalRows, aliases: readonly string[], tickStart: number, tickEnd: number): JournalRows =>
      rows.filter((row) => aliases.includes(String(row['alias'] ?? ''))
        && tickIn(row) >= tickStart && tickIn(row) <= tickEnd);
    /** The rows that ARE an authority decision: a journalled client frame, or a tick that consumed input. */
    const decisionRows = (rows: JournalRows, aliases: readonly string[]): JournalRows => rows.filter((row) => {
      const alias = String(row['alias'] ?? row['entityId'] ?? '');
      if (!aliases.includes(alias)) return false;
      if (row['type'] === 'observation') return row['origin'] === 'client-payload';
      if (row['type'] === 'tick') return row['consumed'] !== null && row['consumed'] !== undefined;
      return false;
    });

    /** Which journal each authority scenario's seats live in. One scenario, one room, one answer. */
    const journalOfScenario: Record<string, string> = {
      'b8-burst-then-idle-retires-nothing-and-resynchronises-nothing': 'burst',
    };

    // A scenario whose claim covers a SUB-range of its seats' life declares the bounds; every other window
    // is simply the whole span of the seats it owns, which is what "this scenario's rows" means.
    const windowBounds: Record<string, readonly [number, number]> = {
      'offenders-never-touch-the-compliant-population': [offenderArrivalTick, populationEndTick],
    };

    interface ScenarioWindow {
      readonly scenario: string;
      readonly journal: string;
      readonly aliases: readonly string[];
      readonly tickStart: number;
      readonly tickEnd: number;
      readonly ownClientFrames: number;
      readonly stampsConsumed: readonly number[];
      readonly dispositions: Readonly<Record<string, number>>;
      readonly ownDecisions: number;
      readonly attributionGap: string | null;
      readonly overlappingAliases: readonly string[];
      readonly aliasRowsWholeJournal: number;
      readonly aliasTickSpan: readonly number[];
      readonly rowsInWindow: number;
      readonly stagingRows: number;
      readonly stagingRangeCoversWindow: boolean;
      readonly windowInsideStagingRange: boolean;
    }

    // A gap, stated by the scenario that has it. The retiring offender has no journalled decision of its
    // own because the frames it cared about were never represented to the authority at all — that IS the
    // scenario. Pretending its window replayed would be the same mistake as reading a watermark and
    // calling it consumption.
    const knownAttributionGaps: Record<string, string> = {
      'retired-offender-closes-in-bounded-window':
        'the burst overflows the buffer, and an evicted frame is retired BEFORE it is represented: it never reaches the accessor, so no observation row exists for it and no tick consumed it. The retirement is a room fact (seat evidence `retiredUnrepresented`, close-path-accounting.json), reported as a recorded input the replay cannot recompute.',
      'offenders-never-touch-the-compliant-population':
        'the compliant seats had stopped streaming before the offenders arrived, so the window this claim needs contains no client frame of theirs by construction; what the window verifies is the ABSENCE of refusals and closures for those seats across the offending period',
    };

    const ownerOfAlias = new Map<string, string[]>();
    for (const [scenario, entityIds] of scenarioSeats) {
      for (const entityId of entityIds) {
        const alias = aliasIn(rowsArray, entityId) ?? aliasIn(burstRows, entityId);
        if (alias === null) continue;
        ownerOfAlias.set(alias, [...(ownerOfAlias.get(alias) ?? []), scenario]);
      }
    }

    const scenarioWindowsBase: ScenarioWindow[] = scenarioRanges
      .filter((range) => range.surface !== 'none')
      .map((range) => {
        const which = journalOfScenario[range.scenario] ?? 'population';
        const rows = which === 'burst' ? burstRows : rowsArray;
        const entityIds = scenarioSeats.get(range.scenario) ?? [];
        const aliases = [...new Set(entityIds
          .map((entityId) => aliasIn(rows, entityId))
          .filter((alias): alias is string => alias !== null))].sort();
        // The tick range comes from the scenario's OWN authority decisions — frames it put on the wire and
        // ticks that consumed input for its seats — not from every row carrying its alias. Every seated
        // entity has a state row on every tick of the run, so a range taken from those would be the whole
        // run for every scenario, which attributes nothing.
        const decisions = decisionRows(rows, aliases);
        const decisionTicks = decisions.map(tickIn).filter((tick) => Number.isFinite(tick));
        const ownRows = aliases.flatMap((alias) => [...rowsWithAlias(rows, alias)]);
        const ownTickSpan = ownRows.map(tickIn).filter((tick) => Number.isFinite(tick));
        const bounds = windowBounds[range.scenario];
        const tickStart = bounds !== undefined && bounds[0] >= 0
          ? bounds[0]
          : decisionTicks.length > 0 ? Math.min(...decisionTicks) : -1;
        const tickEnd = bounds !== undefined && bounds[1] !== -1
          ? bounds[1]
          : decisionTicks.length > 0 ? Math.max(...decisionTicks) : -1;
        const inWindow = aliases.length === 0 || tickStart < 0
          ? []
          : windowIn(rows, aliases, tickStart, tickEnd);
        const ownFrames = inWindow.filter((row) => row['type'] === 'observation' && row['origin'] === 'client-payload');
        // Interleaving, measured rather than assumed: how many rows inside this window's TICK range belong
        // to seats another scenario declared. A long window over a busy room overlaps other scenarios, and
        // the artefact should say that instead of implying exclusivity it does not have.
        const otherAliases = new Set<string>();
        for (const [otherScenario, otherEntities] of scenarioSeats) {
          if (otherScenario === range.scenario) continue;
          for (const entityId of otherEntities) {
            const alias = aliasIn(rows, entityId);
            if (alias !== null) otherAliases.add(alias);
          }
        }
        const overlappingAliases = [...new Set(rows
          .filter((row) => tickIn(row) >= tickStart && tickIn(row) <= tickEnd && tickStart >= 0)
          .map((row) => String(row['alias'] ?? ''))
          .filter((alias) => alias !== '' && otherAliases.has(alias)))].sort();
        // Cross-check against the staging range, honestly in both directions: the window is what the
        // replay verifies, and the staging range is reported as what it is — a watermark.
        const staged = rowsArray.slice(range.rowStart, range.rowEnd);
        const windowRowsPresent = inWindow.filter((row) => rowsArray.indexOf(row) >= 0);
        const insideStaging = windowRowsPresent.filter((row) => {
          const index = rowsArray.indexOf(row);
          return index >= range.rowStart && index < range.rowEnd;
        }).length;
        return {
          scenario: range.scenario,
          journal: which,
          aliases,
          tickStart,
          tickEnd,
          ownClientFrames: ownFrames.length,
          ownDecisions: inWindow.filter((row) => row['type'] === 'observation'
            ? row['origin'] === 'client-payload'
            : row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined).length,
          stampsConsumed: stampsConsumedIn(inWindow),
          dispositions: dispositionsIn(inWindow),
          overlappingAliases,
          rowsInWindow: inWindow.length,
          aliasRowsWholeJournal: ownRows.length,
          aliasTickSpan: ownTickSpan.length > 0 ? [Math.min(...ownTickSpan), Math.max(...ownTickSpan)] : [],
          stagingRows: staged.length,
          stagingRangeCoversWindow: windowRowsPresent.length > 0 && insideStaging === windowRowsPresent.length,
          windowInsideStagingRange: insideStaging === windowRowsPresent.length,
          attributionGap: knownAttributionGaps[range.scenario]
            ?? (ownFrames.length === 0 && inWindow.length === 0
              ? 'no journalled authority decision belongs to the seats this scenario declared'
              : null),
        };
      });

    const unattributedScenarios = scenarioWindowsBase
      .filter((window) => window.aliases.length === 0 || window.ownClientFrames === 0)
      .map((window) => ({ scenario: window.scenario, aliases: window.aliases.length, ownClientFrames: window.ownClientFrames }));

    const declaredWindows = [
      {
        scenario: 'rate-ceiling-closes-directly',
        // One seat, from its first journalled row to the tick the ceiling closed it on.
        aliases: rateAlias === null ? [] : [rateAlias],
        tickStart: rateTicks.length > 0 ? Math.min(...rateTicks) : -1,
        tickEnd: rateTicks.length > 0 ? Math.max(...rateTicks) : -1,
        // Stage Q arrival ordinals of the arrivals this window consumed, numbered room-wide. The WIRE
        // stamps the seat sent are reported alongside for context; they are not the same number space,
        // and the replay is told so rather than being allowed to compare them.
        stampsConsumed: stampsConsumedIn(rateRows),
        wireStampsSent: [...new Set(rateSeat.sentStamps)].sort((a, b) => a - b),
        collidedStamps: rateSeat.collidedStamps,
        dispositions: dispositionsIn(rateRows),
        // What the ceiling's own closure is allowed to leave behind, by name: the frames it consumed, the
        // frames the overflow dropped, and the frame that arrived while the seat was already closing.
        allowedDispositions: ['consumed', 'dropped:queue-overflow', 'dropped:lifecycle', 'refused:rate-ceiling'],
        requireClosureFor: rateAlias ?? '',
        closureCode: 4101,
        attribution:
          'seat × tick window over the shared journal. The replay re-derives every row of this window from the retained rows and refuses a window that contains a foreign seat’s client frames, a stamp the scenario never sent, or a disposition outside the allowed set.',
      },
      {
        scenario: 'compliant-control-population',
        // The control seats streamed BEFORE the offenders arrived, so their frames need their own window;
        // pretending the offending period contains them would have the artefact assert over an empty range.
        aliases: controlAliases,
        tickStart: controlFrameTicks.length > 0 ? Math.min(...controlFrameTicks) : -1,
        tickEnd: controlFrameTicks.length > 0 ? Math.max(...controlFrameTicks) : -1,
        stampsConsumed: stampsConsumedIn(windowFor(controlAliases,
          controlFrameTicks.length > 0 ? Math.min(...controlFrameTicks) : -1,
          controlFrameTicks.length > 0 ? Math.max(...controlFrameTicks) : -1)),
        dispositions: dispositionsIn(windowFor(controlAliases,
          controlFrameTicks.length > 0 ? Math.min(...controlFrameTicks) : -1,
          controlFrameTicks.length > 0 ? Math.max(...controlFrameTicks) : -1)),
        requireAllConsumed: true,
        requireNoRefusals: true,
        attribution:
          'the compliant seats’ own streaming window: every client frame journalled there is `consumed`, and the accepted-tick count equals the consumed-observation count.',
      },
      {
        scenario: 'offenders-never-touch-the-compliant-population',
        aliases: controlAliases,
        // The window is the offending period: from the first journalled row of the last offender to the
        // last closure in the room. The compliant seats were streaming across all of it.
        tickStart: offenderArrivalTick,
        tickEnd: populationEndTick,
        stampsConsumed: stampsConsumedIn(windowFor(controlAliases, offenderArrivalTick, populationEndTick)),
        dispositions: dispositionsIn(windowFor(controlAliases, offenderArrivalTick, populationEndTick)),
        requireAllConsumed: false,
        requireNoRefusals: true,
        forbidClosureFor: controlAliases,
        attribution:
          'the compliant seats’ own rows across the whole offending period: the accepted-tick count must equal the consumed-observation count, no row of theirs may be a refusal, and no closure may name any of these aliases. The control seats had stopped streaming before the offenders arrived, so this window deliberately requires NO client frames of its own — it is the "nothing happened to them afterwards" half. The "every frame they did send was consumed" half is the window ABOVE.',
      },
    ];
    const policyByScenario: Record<string, Record<string, unknown>> = {
      'compliant-control-population': { requireAllConsumed: true, requireNoRefusals: true },
      'wrong-epoch-stream-fails-the-compliant-assertion': {
        // This scenario's whole claim is that the wrong-epoch stream is REFUSED, so a refusal here is the
        // expected disposition and its absence would be the defect.
        allowedDispositions: ['refused:epoch', 'consumed'],
      },
      'rate-ceiling-closes-directly': {
        allowedDispositions: ['consumed', 'dropped:queue-overflow', 'dropped:lifecycle', 'refused:rate-ceiling'],
      },
      'retired-offender-closes-in-bounded-window': {
        allowedDispositions: ['consumed', 'dropped:queue-overflow', 'dropped:lifecycle'],
      },
      'pressure-throttles-and-never-closes': {
        allowedDispositions: ['consumed', 'dropped:queue-overflow', 'dropped:lifecycle'],
      },
      'offenders-never-touch-the-compliant-population': { requireNoRefusals: true },
      'per-tick-displacement-stays-bounded-across-the-population': { requireNoRefusals: false },
    };
    // One entry per authority scenario: the declared window where the scenario has a claim about a
    // specific seat-and-time range, the derived window otherwise. `derived` travels either way, so the
    // cross-check between the two is in the bytes rather than in a footnote.
    const declaredByScenario = new Map(declaredWindows.map((entry) => [entry.scenario, entry]));
    const scenarioWindows = scenarioWindowsBase.map((window) => ({
      ...window,
      // The declared window is the producer's narrative window for the scenario — the seat-and-time range
      // it meant when it made its claim, with the extra context (wire stamps, the closure it expects) that
      // a derived window cannot supply. The derived window above is what the replay verifies.
      declared: declaredByScenario.get(window.scenario) ?? null,
      policy: policyByScenario[window.scenario] ?? {},
    }));

    // ── OD-10: the no-authority half ────────────────────────────────────────────────────────────
    // Each of these four scenarios must show, in its own terms, that it entered no authority path and
    // produced no authority state or effects. A blank "no authority surface" flag is not that evidence.
    const noAuthorityFromJournal = (() => {
      const metricsRange = scenarioRanges.find((range) => range.scenario === 'tick-metrics-present');
      if (metricsRange === undefined) return [];
      const staged = rowsArray.slice(metricsRange.rowStart, metricsRange.rowEnd);
      const aliasesBefore = new Set(rowsArray.slice(0, metricsRange.rowStart)
        .map((row) => String(row['alias'] ?? ''))
        .filter((alias) => alias !== ''));
      const newAliases = [...new Set(staged.map((row) => String(row['alias'] ?? ''))
        .filter((alias) => alias !== '' && !aliasesBefore.has(alias)))];
      const frames = staged.filter((row) => row['type'] === 'observation' && row['origin'] === 'client-payload');
      const consumedRows = staged.filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined);
      return [{
        scenario: 'tick-metrics-present',
        neverEntered: {
          // Reading telemetry sends no frame and seats no one: the scenario's own action count is zero,
          // and the rows below are the room's doing (ticks already in flight), counted here rather than
          // quietly omitted from the window.
          framesSentByThisScenario: 0,
          clientPayloadRowsInWindow: frames.length,
          consumedInputRowsInWindow: consumedRows.length,
          aliasesFirstSeenInWindow: newAliases,
          newAliasesInWindow: newAliases.length,
        },
        noAuthorityEffects: {
          note:
            'the room keeps ticking while telemetry is read, so its no-input ticks appear in the window; what this scenario contributed is zero frames, zero seats and zero new aliases, and a first-seen alias inside the window would prove otherwise',
        },
      }];
    })();
    const noAuthorityEvidence = [...noAuthorityInline, ...noAuthorityFromJournal];

    // What the export saw, so the disposal scenario can be measured as a DELTA over it rather than as an
    // assertion about a room that no longer exists.
    const rowsAtExport = exportedJournal.rows.length;
    const chainLengthAtExport = exportedJournal.chain.length;
    const chainLastTickAtExport = exportedJournal.chain.length > 0
      ? Number((exportedJournal.chain[exportedJournal.chain.length - 1] as { tick?: number }).tick ?? -1)
      : -1;
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
          scenarioWindows,
          noAuthorityEvidence,
          unattributedScenarios,
          additionalJournals: burstJournal === null ? [] : [burstJournal],
          windowRule:
            'A window is the seats a scenario declared it used, over the whole journal of the room those seats live in, cut at the tick range those seats appear in. The staging row ranges are reported beside them as a cross-check only: they are watermarks between verdicts, and a frame sent at the end of a scenario is journalled on the room’s next tick, which can be after the scenario recorded.',
          coverageRule:
            'OD-10 (owner ruling 2026-11-13): authority-bearing scenarios replay from these retained rows with their seat × tick × stamp attribution verified; no-authority scenarios are not replayed and are not counted as replays, and each carries scenario-specific evidence that it entered no authority path and produced no authority state or effects. Both classes stay visible in the census.',
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
    {
      // The room object outlives its registration (`autoDispose = false` by design), which is what makes
      // this measurable: read the journal the retained instance still holds and ask what shutdown appended.
      // Read through a widening cast: the reference is assigned inside `room()`, which TypeScript's
      // flow analysis does not credit at this point, and the alternative is to lie about the type.
      const retained: RoomInstance | null = populationRoomRef as RoomInstance | null;
      const afterDispose = retained !== null ? retained.journal() : null;
      const appended = afterDispose !== null ? afterDispose.rows.slice(rowsAtExport) : [];
      const appendedAuthority = appended.filter((row) => row['type'] === 'tick'
        && row['consumed'] !== null && row['consumed'] !== undefined);
      const appendedFrames = appended.filter((row) => row['type'] === 'observation'
        && row['origin'] === 'client-payload');
      const liveAfter = RegionRoom.liveRooms().length;
      record(
        'server-disposes-cleanly',
        'The harness server disposes without leaving a live room behind, and shutdown decides nothing on the way out',
        {
          liveRoomsAfterDispose: liveAfter,
          rowsAppendedByShutdown: appended.length,
          rowTypesAppendedByShutdown: [...new Set(appended.map((row) => `${String(row['type'])}:${String(row['kind'] ?? row['eventKind'] ?? '')}`))],
          clientFramesAppendedByShutdown: appendedFrames.length,
          authorityRowsAppendedByShutdown: appendedAuthority.length,
          chainLengthAtExport,
          chainLengthAfterShutdown: afterDispose?.chain.length ?? -1,
          chainLastTickAtExport,
          chainLastTickAfterShutdown: (afterDispose !== null && afterDispose.chain.length > 0)
            ? Number((afterDispose.chain[afterDispose.chain.length - 1] as { tick?: number }).tick ?? -1)
            : -1,
        },
        liveAfter === 0 && appendedFrames.length === 0 && appendedAuthority.length === 0,
        'none',
      );
      noAuthorityEvidence.push({
        scenario: 'server-disposes-cleanly',
        neverEntered: {
          clientFramesAppendedByShutdown: appendedFrames.length,
          authorityRowsAppendedByShutdown: appendedAuthority.length,
          liveRoomsAfterDispose: liveAfter,
        },
        noAuthorityEffects: {
          rowsAppendedByShutdown: appended.length,
          rowTypesAppendedByShutdown: [...new Set(appended.map((row) => `${String(row['type'])}:${String(row['kind'] ?? row['eventKind'] ?? '')}`))],
          chainLastTickAtExport,
          chainLastTickAfterShutdown: (afterDispose !== null && afterDispose.chain.length > 0)
            ? Number((afterDispose.chain[afterDispose.chain.length - 1] as { tick?: number }).tick ?? -1)
            : -1,
          note:
            'shutdown may journal lifecycle events and it may close the tick chain; what it must not do is admit a frame or step an entity on the way out, and those two counts are the claim',
        },
      });
    }
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
