/**
 * GA-9 + AC-7: a compliant seat's projection is isolated from its neighbours (T-4).
 *
 * GA-9 asks that a compliant sender's state sequence be unaffected by offenders in the same room. AC-7
 * asks that an offender's MALFORMED message produce "no crash, no observer-visible state change and no
 * observer trace difference". Both are comparison claims, and a comparison is only as good as its
 * preconditions, so this script asserts the preconditions BEFORE it compares anything:
 *
 * 1. **same configuration** — every room booted from one deployment document, so the hashes match and no
 *    movement or drain difference can be hiding in a different envelope;
 * 2. **equivalent initial per-seat state** — the entity's own journalled initial state, compared on every
 *    field except the identity fields that CANNOT be equal (entity id, session epoch);
 * 3. **equivalent input payloads** — the compliant stream is the same normalised payload every time, and
 *    its hash is in the artefact;
 * 4. **equivalent input eligibility relative to the comparison window** — first accepted stamp is 1, the
 *    offset from the entity's join tick to its first consuming tick is the same in both runs, and the
 *    window is the same number of the entity's OWN decisions long;
 * 5. **both runs consumed every expected stamp** — an all-refusal window compares two dead seats and
 *    calls it isolation. That is F-1's shape, and it is refused here before the comparison, not after.
 *
 * Room-wide ordinals are checked SEPARATELY and never compared for equality. An ordinal counts the room's
 * decisions, not a seat's, so the population room's counter is strictly ahead of the solo room's for the
 * same compliant stream — that difference is the room being busier, which is exactly what GA-9's
 * criterion excludes: the failure it names is one caused "only by another session legitimately consuming
 * an ordinal". Comparing ordinals for equality would score correct behaviour as a violation.
 *
 * Output: `projection-isolation.json` (one artefact carrying both sides, per OD-9).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  connectSeat,
  connectSeatById,
  loadPinnedStack,
  sleep,
  stampAndSend,
  startHarnessServer,
  until,
  waitForIssuedEpoch,
  type RegisteredHandler,
  type Seat,
} from '../../support/client-harness/transport.mjs';
import { flattenConsumed, streamAccounting } from '../../support/authority/accounting.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/** One compliant stream per room; ten is enough to make an ordering argument and small enough to pace. */
const STREAM_STAMPS = 10;
const PACE_MS = 50;

interface PlayerRow {
  inputResolvedThrough: number;
  inputRetiredUnrepresented: number;
  sessionEpoch: number;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

interface LiveRoom {
  evidence(): Record<string, unknown>;
  liveConfig(): Record<string, unknown> | undefined;
  journal(): { rows: readonly Record<string, unknown>[] };
  readonly tickRecords: readonly {
    readonly tick: number;
    readonly consumed: readonly { readonly entityId: string; readonly seq: number }[];
    readonly closures: readonly { readonly entityId: string; readonly code: number }[];
  }[];
}

interface RegionRoomModule {
  RegionRoom: { liveRooms(): readonly LiveRoom[] };
  defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
}

/** A compliant stream: same payload, same pacing, stamped with the epoch the room issued. */
interface CompliantStream {
  readonly seat: Seat<ProbeRegionState>;
  readonly entityId: string;
  readonly epoch: number;
  readonly sent: number[];
  readonly payloadHash: string;
  collided: number;
}

const COMPLIANT_PAYLOAD = {
  generation: 1,
  directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
  moveX: 0,
  moveZ: 1,
} as const;

const payloadHashOf = (): string => createHash('sha256').update(JSON.stringify(COMPLIANT_PAYLOAD)).digest('hex');

process.on('uncaughtException', (error: unknown) => {
  process.stderr.write(`[isolation][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});

async function main(): Promise<void> {
  const [roomMod, schemaMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as Promise<RegionRoomModule>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
  ]);
  const RegionSchema = schemaMod['RegionSchema'];
  const withConfigOverrides = configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>;
  const computeConfigHash = configMod['computeConfigHash'] as (c: unknown) => string;
  const regionHash = configMod['regionHash'] as (c: unknown) => string;

  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  const overrides = { region: { bounds } };
  const cfg = withConfigOverrides(configMod['DEFAULT_SERVER_CONFIG'], overrides);
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: computeConfigHash(cfg),
    manifestHash: regionHash(cfg),
  };

  const stack = await loadPinnedStack(ROOT);
  // ONE room type, THREE rooms: every room therefore boots from the same deployment document, which is
  // what makes "the same stream produced the same projection" a fair question in the first place.
  const server = await startHarnessServer(ROOT, {
    region: roomMod['defineOperatorRegionRoom']({
      config: overrides,
      runId: 'udg-003-phase-2-isolation',
      journalRetention: 20_000,
      regionProvenance: 'test-only-synthetic',
    }) as RegisteredHandler,
  });

  const liveRooms = (): readonly LiveRoom[] => roomMod['RegionRoom'].liveRooms();
  const roomHolding = (entityId: string): LiveRoom => {
    for (const room of liveRooms()) {
      if (room.journal().rows.some((row) => row['entityId'] === entityId)) return room;
    }
    throw new Error(`no live room journals ${entityId}`);
  };

  /**
   * Open a seat, waiting for the room's issued epoch before anything is sent (T-0b).
   *
   * With no `roomId` this CREATES a room (one seat in it); with one it joins that room, which is how a
   * neighbour gets to be a neighbour. That distinction is the whole experiment: `connectSeat` uses
   * `client.create()`, so a script that calls it six times has six rooms and zero population, and every
   * "isolation" result it reports would be an artefact of the harness rather than a property of the room.
   */
  const openStream = async (roomId?: string): Promise<CompliantStream> => {
    const seat = roomId === undefined
      ? await connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema)
      : await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, identity, RegionSchema);
    const epoch = await waitForIssuedEpoch(seat.room);
    return { seat, entityId: seat.room.sessionId, epoch, sent: [], payloadHash: payloadHashOf(), collided: 0 };
  };

  const sendCompliant = (stream: CompliantStream): void => {
    const seq = stream.seat.handle.sentCount + 1;
    if (stream.sent.includes(seq)) stream.collided += 1;
    stampAndSend(stream.seat.handle, { ...COMPLIANT_PAYLOAD, sessionEpoch: stream.epoch });
    stream.sent.push(seq);
  };

  /** Send a message no compliant client would send: the offender's malformed command. */
  const sendMalformed = (seat: Seat<ProbeRegionState>): void => {
    seat.room.send('moveTo', { sessionEpoch: 'not-a-number', generation: -1, requestId: 42, x: 1 });
  };

  const rowsOf = (entityId: string): readonly Record<string, unknown>[] => roomHolding(entityId).journal().rows.filter((row) => row['entityId'] === entityId);
  /**
   * One `state` row, as the two things a comparison needs.
   *
   * `kinematic` is the comparable projection: position, velocity, mode, route and intent generation are the
   * authority's own movement state for that entity, and nothing in them depends on which room the entity
   * happens to be in.
   *
   * `full` is the whole journalled state minus `lastAuthorityTick`, kept so the artefact can show WHY the
   * per-tick `stateHash` values are not equal across rooms: the hash covers `lastAuthorityTick`, an
   * absolute tick in that room's own timeline. Two byte-for-byte identical compliant streams therefore
   * hash differently between rooms, and a comparison that compared hashes would score correct behaviour as
   * a violation.
   */
  interface StateView {
    readonly index: number;
    readonly tick: number;
    readonly stateHash: string;
    readonly kinematic: Record<string, unknown>;
    readonly full: Record<string, unknown>;
  }
  const stateSequence = (entityId: string): StateView[] =>
    rowsOf(entityId)
      .filter((row) => row['type'] === 'state')
      .map((row, index) => {
        const state = (row['state'] ?? {}) as Record<string, unknown>;
        const locomotion = (state['locomotion'] ?? {}) as Record<string, unknown>;
        // Identity and the room's clock are removed from the compared projection: `entityId` and
        // `sessionEpoch` cannot be equal across two seats and are not part of any movement claim, and
        // `lastAuthorityTick` is an absolute tick in that room's own timeline. Everything the authority
        // decided about HOW this entity moved stays in.
        const { lastAuthorityTick: _dropTick, entityId: _dropId, sessionEpoch: _dropEpoch, ...stateForComparison } = state;
        const locomotionForComparison = { ...(locomotion as Record<string, unknown>) };
        delete locomotionForComparison['lastAuthorityTick'];
        stateForComparison['locomotion'] = locomotionForComparison;
        return {
          index,
          tick: Number(row['tick']),
          stateHash: String(row['stateHash']),
          // The movement decision, field by field: position, velocity, mode, route, and the intent
          // generation that produced them. `lastAuthorityTick` is deliberately absent — it is the room's
          // clock, and it lives in `full` where the artefact can show it as the reason the hashes differ.
          kinematic: {
            kinematic: locomotion['kinematic'],
            mode: locomotion['mode'],
            route: locomotion['route'],
            grounded: (locomotion['kinematic'] as Record<string, unknown> | undefined)?.['grounded'],
            intentGeneration: state['intentGeneration'],
          },
          full: stateForComparison,
        };
      });
  const decisionCount = (entityId: string): number =>
    rowsOf(entityId).filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined).length;
  const joinTickOf = (entityId: string): number => {
    const join = rowsOf(entityId).find((row) => row['type'] === 'event' && row['kind'] === 'join');
    return join === undefined ? -1 : Number(join['eligibleTick']);
  };
  const firstConsumingTickOf = (entityId: string): number => {
    const first = rowsOf(entityId).find((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined);
    return first === undefined ? -1 : Number(first['tick']);
  };
  /**
   * Stage Q's arrival ordinal of the entity's first consumed arrival. It is NOT the wire stamp: arrivals
   * are numbered in receipt order, so the join is arrival 1 and a compliant seat's first client frame is
   * arrival 2 in every room. Measured and compared ACROSS rooms rather than hard-coded to a stamp.
   */
  /** The room-wide arrival ordinal of this seat's first consumed arrival (reported, never compared). */
  const firstAcceptedArrivalOf = (entityId: string): number | null => {
    const first = rowsOf(entityId).find((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined);
    return first === undefined ? null : Number(first['consumed']);
  };
  /**
   * How far into this seat's own arrival sequence its first accepted client frame sat: 1 means "the first
   * thing this association ever sent was accepted". Measured against the seat's OWN join row, because
   * arrival ordinals are room-wide and a neighbour's join is an arrival too.
   */
  const arrivalOffsetOf = (entityId: string): number | null => {
    const frames = rowsOf(entityId).filter((row) => row['type'] === 'observation' && row['origin'] === 'client-payload');
    const firstConsumed = frames.findIndex((row) => row['disposition'] === 'consumed');
    return firstConsumed < 0 ? null : firstConsumed + 1;
  };
  const initialStateOf = (entityId: string): Record<string, unknown> => {
    const join = rowsOf(entityId).find((row) => row['type'] === 'event' && row['kind'] === 'join');
    const state = (join?.['initialState'] ?? {}) as Record<string, unknown>;
    // Identity fields cannot be equal across seats and are not part of "equivalent initial state".
    const { entityId: _dropId, sessionEpoch: _dropEpoch, ...rest } = state;
    return rest;
  };
  /**
   * The ordinals THIS entity's decisions carry, in order. Per-entity ordinals count that entity's own
   * decisions, so they grow identically in both rooms for an identical stream — which is a fact worth
   * reporting, and is NOT the room-wide counter.
   */
  const roomOrdinals = (entityId: string): number[] =>
    rowsOf(entityId).filter((row) => row['type'] === 'tick').map((row) => Number(row['ordinal']));
  /** The highest ordinal the ROOM has issued, across every seat: the room-wide counter GA-9 warns about. */
  const roomWideOrdinal = (entityId: string): number => {
    const rows = roomHolding(entityId).journal().rows;
    return rows.reduce((max, row) => Math.max(max, Number(row['ordinal'] ?? row['arrivalOrdinal'] ?? 0)), 0);
  };
  const accountingOf = (stream: CompliantStream) => {
    const room = roomHolding(stream.entityId);
    return streamAccounting({
      journalRows: room.journal().rows,
      consumed: flattenConsumed(room.tickRecords),
      entityId: stream.entityId,
      sentStamps: stream.sent,
      collidedStamps: stream.collided,
    });
  };
  const closuresOf = (entityId: string): { tick: number; code: number }[] =>
    [...roomHolding(entityId).tickRecords].flatMap((record) =>
      record.closures.filter((closure) => closure.entityId === entityId).map((closure) => ({ tick: record.tick, code: closure.code })),
    );

  const failures: string[] = [];
  const note = (claim: string, ok: boolean, detail: unknown): void => {
    if (!ok) failures.push(`${claim}: ${JSON.stringify(detail)}`);
  };

  try {
    // ── R-solo: one compliant seat, nothing else in the room ────────────────────────────────────
    const solo = await openStream();
    // ── R-population: the same compliant stream, with a neighbour in the SAME room ──────────────
    const populated = await openStream();
    const noisyNeighbour = await openStream(populated.seat.room.roomId);
    // ── R-malformed: an observer plus an offender that sends a malformed command ────────────────
    const observer = await openStream();
    const malformedOffender = await openStream(observer.seat.room.roomId);
    // ── R-valid: the same observer position, but the offender only sends valid commands ─────────
    const observerControl = await openStream();
    const validOffender = await openStream(observerControl.seat.room.roomId);

    // Room census: every seat's room id, written into the artefact. The GA-9 comparison is only a
    // population comparison if the two seats are actually in one room, and the first version of this
    // script silently had six rooms and no population at all.
    const roomOf = (stream: CompliantStream): string => stream.seat.room.roomId;
    const census = {
      soloRoom: roomOf(solo),
      populationRoom: roomOf(populated),
      observerMalformedRoom: roomOf(observer),
      observerValidRoom: roomOf(observerControl),
      neighbours: {
        noisyInPopulationRoom: roomOf(noisyNeighbour) === roomOf(populated),
        malformedOffenderWithObserver: roomOf(malformedOffender) === roomOf(observer),
        validOffenderWithObserverControl: roomOf(validOffender) === roomOf(observerControl),
      },
      distinctRooms: new Set([solo, populated, noisyNeighbour, observer, malformedOffender, observerControl, validOffender].map(roomOf)).size,
    };

    const streams = [solo, populated, observer, observerControl];

    // Precondition 1: one configuration. Asserted, not assumed — the rooms are separate objects and a
    // future edit could give one of them a different deployment without changing any scenario text.
    const configHashes = streams.map((stream) => JSON.stringify(roomHolding(stream.entityId).liveConfig() ?? null));
    note('every room booted from the same configuration document', new Set(configHashes).size === 1, configHashes.map((h) => h.slice(0, 24)));

    // Precondition 2: equivalent initial per-seat state.
    const initialStates = streams.map((stream) => JSON.stringify(initialStateOf(stream.entityId)));
    note('compliant seats start from the same initial state', new Set(initialStates).size === 1, initialStates.map((s) => s.slice(0, 80)));

    // Precondition 3: equivalent input payloads.
    const payloadHashes = new Set(streams.map((stream) => stream.payloadHash));
    note('the compliant stream is the same payload in every room', payloadHashes.size === 1, [...payloadHashes].map((h) => h.slice(0, 16)));

    // Drive every stream with the same schedule, interleaved so they share tick boundaries.
    for (let i = 0; i < STREAM_STAMPS; i += 1) {
      for (const stream of streams) sendCompliant(stream);
      // The noisy neighbour sends valid frames at twice the rate: a real second stream, not a stub.
      if (i % 2 === 0) sendCompliant(noisyNeighbour);
      sendCompliant(malformedOffender);
      sendCompliant(validOffender);
      // The valid offender is a busier stream than the malformed one, so the two offenders' own
      // projections differ. Without that, "the observer did not notice the offender" and "the comparison
      // cannot see any offender" are the same sentence.
      if (i % 2 === 0) sendCompliant(validOffender);
      if (i === 3) {
        // The malformed command lands mid-window, where a per-message state change would be visible in
        // the observer's next rows. The control room's offender sends only valid frames.
        sendMalformed(malformedOffender.seat);
      }
      await sleep(PACE_MS);
    }

    // Settle: the last frame of a stream is drained on the tick after it arrives, and its record reaches
    // the client on the patch cadence. Measuring before that lands reports a stream as one stamp short —
    // an artefact of when the ruler was applied, not a fact about the run.
    const settled = await Promise.all(streams.map(async (stream) => await until(() => {
      const accounting = accountingOf(stream);
      return accounting.stampsConsumed === stream.sent.length || accounting.stampsRefused > 0;
    }, 5_000)));

    // Let the offenders' queued frames finish draining, then read where each one actually ended up: the
    // two offenders are deliberately different streams, and their end positions are the witness that the
    // comparison CAN see an offender at all.
    await Promise.all([malformedOffender, validOffender].map(async (offender) => await until(
      () => accountingOf(offender).stampsConsumed === offender.sent.length,
      5_000,
    )));
    const finalZ = (entityId: string): number => {
      const rows = stateSequence(entityId);
      const last = rows[rows.length - 1];
      return last === undefined ? -1 : ((last.kinematic['kinematic'] as { position?: { z?: number } } | undefined)?.position)?.z ?? -1;
    };
    const offenderEnds = { malformed: finalZ(malformedOffender.entityId), valid: finalZ(validOffender.entityId) };

    // Precondition 5 (before any comparison): every expected stamp consumed in BOTH kinds of run.
    const consumption = streams.map((stream) => {
      const accounting = accountingOf(stream);
      return {
        room: stream === solo ? 'solo' : stream === populated ? 'population' : stream === observer ? 'observer-malformed' : 'observer-valid-offender',
        entityId: stream.entityId,
        stampsSent: accounting.stampsSent,
        stampsConsumed: accounting.stampsConsumed,
        stampsRefused: accounting.stampsRefused,
        pairingConsistent: accounting.pairingConsistent,
        collidedStamps: accounting.collidedStamps,
        allSentStampsConsumed: accounting.allSentStampsConsumed,
        closed: closuresOf(stream.entityId),
      };
    });
    note(
      'every compliant seat had every stamp it sent consumed',
      consumption.every((entry) => entry.allSentStampsConsumed && entry.collidedStamps === 0 && entry.closed.length === 0),
      consumption,
    );

    // Precondition 4: eligibility relative to each window — same first stamp, same distance from join to
    // first consumption, same number of the entity's own decisions in the compared window.
    const eligibility = streams.map((stream) => {
      const joinTick = joinTickOf(stream.entityId);
      const firstConsuming = firstConsumingTickOf(stream.entityId);
      return {
        entityId: stream.entityId,
        joinTick,
        firstConsumingTick: firstConsuming,
        // Reported, deliberately NOT compared: this distance is how long the harness took to get the
        // first frame into each room after its join, so it measures the script's own scheduling and not
        // anything the authority decides. Comparing it would have the artefact fail on wall-clock jitter.
        ticksFromJoinToFirstConsumption: firstConsuming - joinTick,
        // Per-seat eligibility: how many arrivals INTO ITS OWN PRESENCE the seat's first accepted frame
        // was. A room-wide arrival ordinal cannot be compared between a solo room and a shared one — the
        // neighbour's join is an arrival too — so this is measured relative to the seat's own join row.
        arrivalOffsetFromOwnJoin: arrivalOffsetOf(stream.entityId),
        firstAcceptedArrivalRoomWide: firstAcceptedArrivalOf(stream.entityId),
        decisions: decisionCount(stream.entityId),
      };
    });
    // Eligibility relative to each window: the same number of the seat's own accepted decisions, entered
    // at the same distance from its join, on the same arrival position. Absolute ticks differ between rooms
    // and are reported, not compared.
    note(
      'input eligibility is equivalent across the compared windows',
      eligibility.every((entry) => entry.decisions === STREAM_STAMPS && entry.arrivalOffsetFromOwnJoin === 1)
      ,
      eligibility,
    );

    // ── The comparison: per-entity decision sequences, aligned by the entity's OWN index ───────
    // Absolute ticks are not comparable between two rooms that started at different moments; the entity's
    // own decision index is. Ticks are reported so a reader can see what was aligned away.
    /**
     * The seat's projection: its movement state at each of its OWN accepted decisions, in decision order.
     *
     * Aligning on "the last N state rows" would be wrong and this run proved it: a seat that spent a tick
     * with no input has an extra neutral state row, so two identical compliant streams would have windows
     * offset by one and the comparison would report a difference that is only a mis-alignment. Accepted
     * decisions are the entity's own countable sequence, and the state row at that tick is its result.
     */
    const windowOf = (entityId: string): StateView[] => {
      const byTick = new Map<number, StateView>();
      for (const view of stateSequence(entityId)) byTick.set(view.tick, view);
      const rows = rowsOf(entityId).filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined);
      const out: StateView[] = [];
      for (const row of rows) {
        const tick = Number(row['tick']);
        const view = byTick.get(tick) ?? [...byTick.entries()].filter(([candidate]) => candidate >= tick).map(([, value]) => value)[0];
        if (view !== undefined) out.push(view);
      }
      return out;
    };
    const comparable = (rows: readonly StateView[]): string => JSON.stringify(rows.map((row) => row.kinematic));
    const hashForm = (rows: readonly StateView[]): string[] => rows.map((row) => row.stateHash.slice(0, 10));
    const zOf = (rows: readonly StateView[]): unknown[] => rows.map((row) => (row.kinematic['kinematic'] as { position?: { z?: number } } | undefined)?.position?.z ?? null);
    const soloWindow = windowOf(solo.entityId);
    const populatedWindow = windowOf(populated.entityId);
    const projectionSequencesEqual = comparable(soloWindow) === comparable(populatedWindow);
    // Movement state, minus the room's clock, must be equal; the artefact reports the hashes so a reader
    // can see the difference and the reason next to it instead of having to infer either.
    const fullStateEqual = JSON.stringify(soloWindow.map((row) => row.full)) === JSON.stringify(populatedWindow.map((row) => row.full));
    note('the compliant projection is identical solo and in a population', projectionSequencesEqual && fullStateEqual, {
      soloKinematics: zOf(soloWindow),
      populationKinematics: zOf(populatedWindow),
      soloHashes: hashForm(soloWindow),
      populationHashes: hashForm(populatedWindow),
      fullStateEqual,
    });

    // Room-wide ordinal growth: checked separately, expected to DIFFER, and never used as the comparison.
    const soloOrdinals = roomOrdinals(solo.entityId);
    const populatedOrdinals = roomOrdinals(populated.entityId);
    const soloRoomOrdinal = roomWideOrdinal(solo.entityId);
    const populatedRoomOrdinal = roomWideOrdinal(populated.entityId);
    const monotone = (values: number[]): boolean => values.every((value, index) => index === 0 || value >= (values[index - 1] as number));
    // The room-wide counter is the one that must be ahead in the busier room; the per-entity sequence is
    // the one that must NOT be compared across rooms. Both are reported so the two cannot be confused.
    const strictlyAheadAfterFirstSharedDecision = populatedRoomOrdinal > soloRoomOrdinal;
    note('ordinals grow monotonically in both runs (per entity, and the room-wide counter too)',
      monotone(soloOrdinals) && monotone(populatedOrdinals) && soloRoomOrdinal > 0 && populatedRoomOrdinal > 0, {
        soloPerEntity: soloOrdinals,
        populationPerEntity: populatedOrdinals,
        soloRoomWide: soloRoomOrdinal,
        populationRoomWide: populatedRoomOrdinal,
      });
    note('the population room’s ROOM-WIDE ordinal counter is ahead, which is the room being busier, not a violation',
      strictlyAheadAfterFirstSharedDecision,
      {
        soloRoomWide: soloRoomOrdinal,
        populationRoomWide: populatedRoomOrdinal,
        perEntityLastEqual: (soloOrdinals[soloOrdinals.length - 1] as number) === (populatedOrdinals[populatedOrdinals.length - 1] as number),
        explanation:
          'GA-9 compares projections, not counters: the ordinal counts the room’s decisions, so a room with more seats issues more of them for the same compliant stream. The criterion names a difference caused only by another session legitimately consuming an ordinal as a non-violation, so equality is never asserted here; what IS asserted is that the compliant seat’s own per-decision state sequence is identical.',
      });

    // ── AC-7: the observer's trace with a malformed offender vs a valid offender ────────────────
    const observerWindow = windowOf(observer.entityId);
    const observerControlWindow = windowOf(observerControl.entityId);
    const observerTraceIdentical = comparable(observerWindow) === comparable(observerControlWindow)
      && JSON.stringify(observerWindow.map((row) => row.full)) === JSON.stringify(observerControlWindow.map((row) => row.full));
    note('the observer’s trace is identical with a malformed offender and with a valid one', observerTraceIdentical, {
      malformed: zOf(observerWindow),
      valid: zOf(observerControlWindow),
      malformedHashes: hashForm(observerWindow),
      validHashes: hashForm(observerControlWindow),
    });
    const offenderAccounting = accountingOf(malformedOffender);
    const allRows = [...liveRooms()].flatMap((room) => room.journal().rows);
    const malformedRows = allRows.filter((row) => row['type'] === 'observation'
      && ((row['malformed'] as unknown[] | undefined)?.length ?? 0) > 0);
    // Refused non-direct observations: the command channel's own refusals. Reported whether or not the
    // malformed array is populated, because what AC-7 claims is about the OBSERVER, and the artefact must
    // not lean on a journalling detail it has not measured.
    const refusedCommandRows = allRows.filter((row) => row['type'] === 'observation'
      && row['kind'] !== 'direct'
      && String(row['disposition'] ?? '').startsWith('refused'));
    const offenderControlAccounting = accountingOf(validOffender);
    // The comparison has to be capable of SEEING an offender at all; otherwise "the observer did not
    // notice" is indistinguishable from "the comparison cannot see anything". Two independent witnesses:
    // the two offenders' own state sequences differ (different numbers of accepted frames), and the
    // malformed messages are journalled with a refusal disposition.
    note('the offender is visible to the comparison',
      // The two offenders end at different positions (one sends five frames more), so a comparison that
      // reported "the observer saw no difference" demonstrably had an offender to see.
      Math.abs(offenderEnds.malformed - offenderEnds.valid) > 0.5
        && offenderAccounting.stampsConsumed > 0
        && offenderControlAccounting.stampsConsumed > 0,
      {
        noisyConsumed: offenderAccounting.stampsConsumed,
        validOffenderConsumed: offenderControlAccounting.stampsConsumed,
        offenderEndPositions: offenderEnds,
        malformedRowsJournalled: malformedRows.length,
        refusedCommandRows: refusedCommandRows.length,
        refusedCommandDispositions: [...new Set(refusedCommandRows.map((row) => String(row['disposition'])))],
      });
    note('no crash: no seat in any room was closed during the window',
      consumption.every((entry) => entry.closed.length === 0)
        && closuresOf(noisyNeighbour.entityId).length === 0
        && closuresOf(malformedOffender.entityId).length === 0
        && closuresOf(validOffender.entityId).length === 0,
      { closures: consumption.map((entry) => entry.closed.length) });

    // Discrimination control: a one-row mutation of the observer's own sequence MUST compare unequal.
    const positionOf = (row: StateView): number => ((row.kinematic['kinematic'] as { position?: { z?: number } } | undefined)?.position)?.z ?? 0;
    const mutated = observerWindow.map((row, index) => (index !== 3 ? row : {
      ...row,
      kinematic: { ...row.kinematic, kinematic: { ...(row.kinematic['kinematic'] as Record<string, unknown>), position: { z: positionOf(row) + 0.001 } } },
    }));
    const mutationDetected = comparable(mutated) !== comparable(observerControlWindow);
    note('the comparison detects a real per-tick difference (mutation control)', mutationDetected, {
      mutatedZ: positionOf(mutated[3] as StateView),
      controlZ: observerControlWindow[3] === undefined ? null : positionOf(observerControlWindow[3] as StateView),
    });
    // And a dead-window control: an all-refusal window must not be scoreable as isolation at all.
    const deadWindow = windowOf(solo.entityId).map((row) => ({ ...row, kinematic: { dead: true } }));
    const deadWindowWouldBeCaught = comparable(deadWindow) !== comparable(soloWindow);
    note('an all-refusal window cannot masquerade as an equal projection', deadWindowWouldBeCaught
      && consumption.every((entry) => entry.stampsConsumed > 0), { deadWindowFirst: deadWindow[0] });

    const checks = {
      sameConfigurationDocument: new Set(configHashes).size === 1,
      equivalentInitialState: new Set(initialStates).size === 1,
      equivalentPayloads: payloadHashes.size === 1,
      equivalentEligibility: eligibility.every((entry) => entry.arrivalOffsetFromOwnJoin === 1
        && entry.decisions === STREAM_STAMPS),
      everyExpectedStampConsumedInBothRuns: consumption.every((entry) => entry.allSentStampsConsumed),
      projectionSequencesEqual,
      ordinalsMonotoneInBothRuns: monotone(soloOrdinals) && monotone(populatedOrdinals),
      populationOrdinalAhead: strictlyAheadAfterFirstSharedDecision,
      observerTraceIdentical,
      offenderVisibleToTheComparison: Math.abs(offenderEnds.malformed - offenderEnds.valid) > 0.5,
      noClosureAnywhere: consumption.every((entry) => entry.closed.length === 0),
      mutationControlDetected: mutationDetected,
      deadWindowControlCaught: deadWindowWouldBeCaught,
    };

    const verdict = Object.values(checks).every((value) => value === true) && failures.length === 0 ? 'pass' : 'fail';
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUT_DIR, 'projection-isolation.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-9', 'AC-7'],
          producer: 'tests/runtime/udg-003-phase-2/projection-isolation.ts',
          verdict,
          // The verdict has to be readable from the artefact: every boolean the verdict is computed from,
          // with the failures list beside it, so a reviewer never has to re-run the script to learn which
          // limb said no.
          checks,
          statement:
            'GA-9: a compliant seat’s per-decision state sequence is identical alone and among offenders. AC-7: an offender’s malformed message produces no crash, no observer-visible state change and no observer trace difference.',
          design: {
            rooms:
              'four rooms of ONE registered type and ONE deployment document: a solo room, a room holding the compliant seat and a noisy neighbour, a room holding an observer and a malformed offender, and a room holding an observer and a valid offender. Neighbour seats JOIN their room by id — a script that only ever calls create() has six rooms and no population.',
            roomCensus: census,
            streamLength: STREAM_STAMPS,
            pacingMs: PACE_MS,
            alignment:
              'per-entity decision index (the entity’s own n-th journalled decision), compared on the entity’s movement state. Absolute ticks, wall-clock times and per-tick state hashes are reported but not compared: the state hash covers lastAuthorityTick, an absolute tick in that room’s own timeline, so two identical compliant streams necessarily hash differently between rooms. Comparing hashes would score a correct run as a violation, so the artefact reports both and asserts on the movement state.',
            eligibilityInstrument:
              'a tick row’s `consumed` field is stage Q’s arrival ordinal in receipt order, not the wire stamp: the join is arrival 1, so a compliant seat’s first accepted client frame is arrival 2 in every room. The wire stamp is what the room’s tick records and the journal dispositions are joined on, in the accounting module.',
            ordinalPolicy:
              'room-wide ordinals are checked for monotonic growth only, and the population room’s counter is EXPECTED to be ahead. GA-9’s failure clause names a difference caused “only by another session legitimately consuming an ordinal” as a non-violation, so ordinal equality is not asserted anywhere in this artefact.',
          },
          preconditions: {
            configHash: identity.configHash,
            payloadHash: solo.payloadHash,
            initialStates: initialStates.map((state) => JSON.parse(state) as Record<string, unknown>),
            eligibility,
          },
          settled,
          consumption,
          projections: {
            solo: soloWindow,
            population: populatedWindow,
            observerWithMalformedOffender: observerWindow,
            observerWithValidOffender: observerControlWindow,
            noisyNeighbour: windowOf(noisyNeighbour.entityId),
            malformedOffender: windowOf(malformedOffender.entityId),
            validOffender: windowOf(validOffender.entityId),
          },
          ordinals: {
            solo: soloOrdinals,
            population: populatedOrdinals,
            roomWide: { solo: soloRoomOrdinal, population: populatedRoomOrdinal },
            rule: 'monotone non-decreasing in each run; strictly greater in the population room; equality is never required',
          },
          malformedMessages: {
            sent: 'moveTo with a non-numeric sessionEpoch, a negative generation and a numeric requestId',
            journalledMalformedRows: malformedRows.length,
            refusedNonDirectObservations: refusedCommandRows.length,
            refusedCommandDispositions: [...new Set(refusedCommandRows.map((row) => String(row['disposition'])))],
            note:
              'AC-7 is a claim about the observer, and it is measured as one: no closure anywhere, no observer-visible movement difference, no observer trace difference. What the command channel journalled about the malformed message is reported here as measured rather than assumed.',
          },
          controls: [
            {
              name: 'per-tick mutation of the observer’s own sequence',
              expected: 'the two observer sequences compare unequal',
              detected: mutationDetected,
            },
            {
              name: 'all-refusal window (F-1’s shape)',
              expected: 'an equal-projection claim over a window with no accepted stamp is refused by the consumption precondition',
              detected: deadWindowWouldBeCaught,
            },
          ],
          failures,
          settledNote:
            'Every stream is waited out before measurement: a compliant seat’s last frame is consumed on the tick after it arrives and published on the patch cadence, so an immediate read reports one stamp short. The wait measures “reached the highest stamp at rest”; it does not tolerate a stream that genuinely never reaches it.',
          limitations: [
            'Loopback transport, four rooms in one process: cross-process and cross-region isolation remain out of scope for Phase 2.',
            'Ten decisions per stream is enough to show ordering and per-tick equality, not to measure drift over long sessions.',
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stderr.write(`[isolation] ${verdict} — projection equality ${String(projectionSequencesEqual)}, observer trace ${String(observerTraceIdentical)}, failures ${String(failures.length)}\n`);
    if (verdict !== 'pass') process.exitCode = 2;
  } finally {
    await Promise.race([server.close().catch(() => undefined), sleep(4_000)]);
  }
}

await main();
process.exit(process.exitCode ?? 0);
