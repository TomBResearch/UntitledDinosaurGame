/**
 * Recovery scenarios against the real transport (UDG-003 Phase 2 W-7, GA-6/GA-7).
 *
 * The pure policy module (`tests/support/client-harness/recovery.ts`) states the frozen rules;
 * this script is their scenario evidence on the wire: deliveries are real state deliveries, the
 * deadlines run on the real clock, drops are real unclean disconnects, and rejoins are real
 * reconnections carrying server-issued epochs. Three of the scenarios are the three limits the
 * assignment names — the 500 ms client deadline, the 4000 ms episode deadline, and the two-rejoins
 * per rolling 60 s allowance — and each records the observed event times, not a claim.
 *
 * Writes `recovery-harness.json` under `UDG_VECTORS_OUT` (default `artifacts/udg-003-phase-2/`).
 * Runtime rules are PR-14's: Node type stripping, harness resolution, loopback, provisional test
 * settings, timeouts recorded rather than hung.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  connectSeat,
  loadPinnedStack,
  sleep,
  startHarnessServer,
  stampAndSend,
  until,
  waitForIssuedEpoch,
  type RegisteredHandler,
  type Seat,
} from '../../support/client-harness/transport.mjs';
import { RecoveryPolicy, type Delivery, type RecoveryEvent } from '../../support/client-harness/recovery.ts';
import { flattenConsumed, streamAccounting } from '../../support/authority/accounting.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/** A live room, as far as this script needs it: evidence, plus the bytes a replay consumes. */
interface LiveRoom {
  evidence(): Record<string, unknown>;
  readonly tickRecords: readonly {
    readonly tick: number;
    readonly consumed: readonly { readonly entityId: string; readonly seq: number }[];
  }[];
  journal(): { rows: readonly Record<string, unknown>[]; chain: readonly Record<string, unknown>[]; dropped: number };
  journalPrologue(): Record<string, unknown> | undefined;
  liveConfig(): Record<string, unknown> | undefined;
}

interface RegionRoomModule {
  RegionRoom: { liveRooms(): readonly LiveRoom[] };
  defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
}

/**
 * One room journal per recovery scenario, serialised for the fresh-process replay (R-1).
 *
 * Each recovery scenario creates its OWN room (`connectSeat` creates), so a scenario's journal is a whole
 * room's journal rather than a slice — which is the easier case: the replay starts from the prologue with
 * nothing assumed about prior state.
 */
const roomJournals: Record<string, unknown>[] = [];
let exportedRoomCount = 0;

interface PlayerRow {
  inputResolvedThrough: number;
  inputGapStart: number;
  inputGapEnd: number;
  inputRetiredUnrepresented: number;
  sessionEpoch: number;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

const scenarios: { name: string; expectation: string; observed: Record<string, unknown>; pass: boolean }[] = [];

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
  process.stderr.write(`[recovery][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`[recovery][unhandled] ${String(reason instanceof Error ? reason.stack : reason)}\n`);
});

/** Drive the policy clock from the real clock; every event it emits is kept with its timestamp. */
const startClock = (policy: RecoveryPolicy, events: { atMs: number; event: RecoveryEvent }[]): NodeJS.Timeout =>
  setInterval(() => {
    const at = performance.now();
    for (const event of policy.tick(at)) events.push({ atMs: Math.round(at - startMs), event });
  }, 10);

let startMs = 0;

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
  const inputConfig = cfg['input'] as ConstructorParameters<typeof RecoveryPolicy>[0];
  const stepMeters = ((cfg['movement'] as Record<string, unknown>)['speed'] as number)
    * ((cfg['network'] as Record<string, unknown>)['simulationStepSeconds'] as number);

  // ── Seats, epochs and consumption (T-0b, F-3) ────────────────────────────────────────────────
  /**
   * One seat's client-side stream: what it put on the wire, stamped with the epoch the room issued.
   *
   * T-0b exists because of F-3, measured directly on the pinned stack: a frame sent the moment
   * `create()` resolves reaches `admit` before this association has an issued epoch, and `admit` refuses
   * exactly that case with `EPOCH_MISMATCH` ("the association has no issued epoch: the entity has
   * neither joined nor been retained"). Sending immediately gave `refused:epoch`; waiting for the seat's
   * replica row to report its issued epoch gave `consumed`. Because ADR-003 §4 represents a refusal, the
   * watermark advanced over the refused frame either way — which is why every scenario below that needs
   * ACCEPTED input now says so and is checked against the authority's record rather than the watermark.
   */
  interface SeatStream {
    readonly scenario: string;
    readonly entityId: string;
    readonly epoch: number;
    readonly sent: number[];
    /** Duplicate stamps the sender noticed (a seat that paced itself has none). */
    collided: number;
  }
  const seatStreams: SeatStream[] = [];

  const liveRooms = (): readonly LiveRoom[] => roomMod['RegionRoom'].liveRooms();

  /** The room whose journal contains this entity — found by fact, not by creation order. */
  const roomFor = (entityId: string): LiveRoom => {
    for (const candidate of liveRooms()) {
      if (candidate.journal().rows.some((row) => row['entityId'] === entityId)) return candidate;
    }
    throw new Error(`no live room journals the entity ${entityId}`);
  };

  /** Join a seat and wait for the room's issued epoch BEFORE its first frame. */
  const openSeat = async (scenario: string): Promise<{ seat: Seat<ProbeRegionState>; stream: SeatStream }> => {
    const seat = await withTimeout(
      connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema),
      8_000,
      scenario,
    );
    const epoch = await waitForIssuedEpoch(seat.room);
    const stream: SeatStream = { scenario, entityId: seat.room.sessionId, epoch, sent: [], collided: 0 };
    seatStreams.push(stream);
    return { seat, stream };
  };

  /** Send with the epoch the ROOM issued, recording the stamp that actually went on the wire. */
  const sendStamped = (stream: SeatStream, seat: Seat<ProbeRegionState>, frame: Record<string, unknown>): void => {
    const seq = seat.handle.sentCount + 1;
    if (stream.sent.includes(seq)) stream.collided += 1;
    stampAndSend(seat.handle, { ...frame, sessionEpoch: stream.epoch });
    stream.sent.push(seq);
  };

  /** The FIFO-paired, stamp-level accounting (the same implementation the population uses). */
  const accountStream = (stream: SeatStream) => {
    const room = roomFor(stream.entityId);
    return streamAccounting({
      journalRows: room.journal().rows,
      consumed: flattenConsumed(room.tickRecords),
      entityId: stream.entityId,
      sentStamps: stream.sent,
      collidedStamps: stream.collided,
    });
  };

  /** What the authority's own journal says about one entity's client frames. */
  interface JournalAudit {
    readonly roomsHoldingEntity: number;
    readonly clientFrames: number;
    readonly framesConsumed: number;
    readonly refusedBy: Readonly<Record<string, number>>;
    readonly ticksWithConsumedInput: number;
    readonly movedMeters: number;
    readonly allClientFramesConsumed: boolean;
  }

  /**
   * Domain-safe cross-check read straight from the authority's journal rows: a rejoin restarts the stamp
   * domain, so a scenario that spans rejoins (S4) cannot be audited by stamp identity, only by counting
   * what the authority recorded for that entity.
   */
  const journalAudit = (entityId: string): JournalAudit => {
    // Aggregated over EVERY live room that journals this entity. A rejoin whose old room had been disposed
    // lands the seat in a new room, so a single-room audit would silently under-report S4's stream — the
    // same class of error as reading one counter and calling it the whole stream.
    const holders = liveRooms().filter((room) => room.journal().rows.some((row) => row['entityId'] === entityId));
    const rows = holders.flatMap((room) => room.journal().rows).filter((row) => row['entityId'] === entityId);
    const frames = rows.filter((row) => row['type'] === 'observation' && row['origin'] === 'client-payload');
    const refusedBy: Record<string, number> = {};
    for (const frame of frames) {
      const disposition = String(frame['disposition']);
      if (disposition.startsWith('refused:')) refusedBy[disposition] = (refusedBy[disposition] ?? 0) + 1;
    }
    const consumedTicks = rows.filter((row) => row['type'] === 'tick' && row['consumed'] !== null && row['consumed'] !== undefined);
    const movedMeters = consumedTicks.reduce((total, row) => total + (Number(row['resolvedDisplacement']) || 0), 0);
    const audit: JournalAudit = {
      roomsHoldingEntity: holders.length,
      clientFrames: frames.length,
      framesConsumed: frames.filter((frame) => frame['disposition'] === 'consumed').length,
      refusedBy,
      ticksWithConsumedInput: consumedTicks.length,
      movedMeters: Math.round(movedMeters * 1e6) / 1e6,
      allClientFramesConsumed: frames.length > 0 && frames.every((frame) => frame['disposition'] === 'consumed'),
    };
    return audit;
  };

  /** The evidence block every accepted-input assertion in this file reads. */
  interface StreamEvidence {
    readonly sentStamps: readonly number[];
    readonly sessionEpoch: number;
    readonly stampsSent: number;
    readonly stampsConsumed: number;
    readonly stampsRefused: number;
    readonly refusedBy: Readonly<Record<string, number>>;
    readonly missingStamps: readonly number[];
    readonly pairingConsistent: boolean;
    readonly collidedStamps: number;
    readonly movedMeters: number;
    readonly stepMeters: number;
    readonly allSentStampsConsumed: boolean;
    readonly journal: JournalAudit;
  }

  const acceptedInputEvidence = (stream: SeatStream): StreamEvidence => {
    const accounting = accountStream(stream);
    const evidence: StreamEvidence = {
      sentStamps: stream.sent,
      sessionEpoch: stream.epoch,
      stampsSent: accounting.stampsSent,
      stampsConsumed: accounting.stampsConsumed,
      stampsRefused: accounting.stampsRefused,
      refusedBy: accounting.refusedBy,
      missingStamps: accounting.missingStamps,
      pairingConsistent: accounting.pairingConsistent,
      collidedStamps: accounting.collidedStamps,
      movedMeters: accounting.movedMeters,
      stepMeters,
      allSentStampsConsumed: accounting.allSentStampsConsumed,
      journal: journalAudit(stream.entityId),
    };
    return evidence;
  };

  /** Hand the room this scenario just finished to the replay record. */
  const exportRoomJournals = (scenario: string): void => {
    const rooms = roomMod['RegionRoom'].liveRooms();
    for (const room of rooms.slice(exportedRoomCount)) {
      const journal = room.journal();
      const prologue = room.journalPrologue();
      roomJournals.push({
        scenario,
        configDocument: room.liveConfig() ?? null,
        prologue: prologue ?? null,
        rows: journal.rows,
        chain: journal.chain,
        dropped: journal.dropped,
        evidence: {
          journalRows: room.evidence()['journalRows'],
          ticks: room.evidence()['ticks'],
          chainTip: room.evidence()['chainTip'],
        },
      });
    }
    exportedRoomCount = rooms.length;
  };

  const stack = await loadPinnedStack(ROOT);
  const server = await startHarnessServer(ROOT, {
    region: roomMod['defineOperatorRegionRoom']({ config: overrides, runId: 'udg-003-phase-2-recovery', journalRetention: 40_000, regionProvenance: 'test-only-synthetic' }),
  });

  /** Feed a seat’s real deliveries and clock into a fresh policy. */
  const wire = (seat: Seat<ProbeRegionState>, policy: RecoveryPolicy, events: { atMs: number; event: RecoveryEvent }[]) => {
    const deliveries: Delivery[] = [];
    seat.room.onStateChange(() => {
      const row = seat.room.state.players.get(seat.room.sessionId);
      if (row === undefined) return;
      const delivery: Delivery = {
        atMs: performance.now(),
        // R-A: both numbers are read from THIS state delivery and no other.
        ack: seat.handle.lastProcessed,
        record: {
          resolvedThrough: row.inputResolvedThrough,
          gapStart: row.inputGapStart,
          gapEnd: row.inputGapEnd,
          retiredUnrepresented: row.inputRetiredUnrepresented,
        },
        epoch: row.sessionEpoch,
      };
      deliveries.push(delivery);
      for (const event of policy.observe(delivery)) events.push({ atMs: Math.round(delivery.atMs - startMs), event });
    });
    return deliveries;
  };

  try {
    // ── S1 same-delivery pairing: every observed pair is internally consistent ──────────────────
    startMs = performance.now();
    const { seat, stream: s1Stream } = await openSeat('same-delivery-pairing-on-the-wire');
    const s1Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s1Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const s1Deliveries = wire(seat, s1Policy, s1Events);
    const s1Clock = startClock(s1Policy, s1Events);
    for (let i = 0; i < 5; i += 1) {
      sendStamped(s1Stream, seat, {
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
      await sleep(60);
    }
    await until(() => (seat.room.state.players.get(seat.room.sessionId)?.inputResolvedThrough ?? 0) >= 5, 4_000);
    clearInterval(s1Clock);
    const consistent = s1Deliveries.every((d) => d.record === null || d.ack <= d.record.resolvedThrough);
    // R-A is a claim about a COMPLIANT stream, so it needs accepted input: five frames stamped with the
    // room's issued epoch and five dispositions of `consumed`. Before T-0b this scenario proved nothing
    // of the kind — its frames could be refused and the pairing would still have "held", because a
    // refusal represents a frame and an acknowledgement of a refused frame still satisfies ack <= through.
    const s1StreamEvidence = acceptedInputEvidence(s1Stream);
    scenarios.push({
      name: 'same-delivery-pairing-on-the-wire',
      expectation: 'R-A: the acknowledgement and the disposition record arrive in one delivery and never disagree (ack <= resolvedThrough); a compliant stream produces no stall',
      observed: { deliveries: s1Deliveries.length, allPairsConsistent: consistent, events: s1Events.map((e) => e.event.type), state: s1Policy.snapshot().state, stream: s1StreamEvidence },
      pass: consistent && s1Deliveries.length > 0 && s1Events.length === 0
        && s1StreamEvidence.allSentStampsConsumed === true
        && s1StreamEvidence.journal.allClientFramesConsumed === true,
    });
    exportRoomJournals('same-delivery-pairing-on-the-wire');

    // ── S2 the 500 ms deadline runs with zero deliveries; a rejoin recovers through the record ──
    const s2Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s2Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const { seat: seat2, stream: s2Stream } = await openSeat('client-deadline-fires-with-zero-deliveries-and-the-record-recovers');
    const s2DeliveriesRef = wire(seat2, s2Policy, s2Events);
    const s2Clock = startClock(s2Policy, s2Events);
    for (let i = 0; i < 3; i += 1) {
      sendStamped(s2Stream, seat2, {
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
      await sleep(60);
    }
    await until(() => (seat2.room.state.players.get(seat2.room.sessionId)?.inputResolvedThrough ?? 0) >= 3, 4_000);
    const token = seat2.room.reconnectionToken;
    const dropAt = performance.now();
    await seat2.room.leave(false).catch(() => undefined); // unclean: no leave handshake, server sees a drop
    const stalled = await until(
      () => s2Events.some((e) => e.event.type === 'INPUT_ACK_STALLED'),
      2_000,
    );
    const stallEvent = s2Events.find((e) => e.event.type === 'INPUT_ACK_STALLED');
    // The deadline runs from the last accepted delivery, not from the drop: the delivery stream
    // stops slightly before the socket tear is observed, and the clock ticks at 10 ms granularity.
    const lastDeliveryRelMs = s2DeliveriesRef.length > 0 ? Math.round((s2DeliveriesRef[s2DeliveriesRef.length - 1] as Delivery).atMs - startMs) : -1;
    const stallDelayFromLastDeliveryMs = stallEvent === undefined || lastDeliveryRelMs < 0 ? -1 : Math.round(stallEvent.atMs - lastDeliveryRelMs);
    void dropAt;
    // The deadline is measured from the last ACCEPTED delivery, so the stream feeding it has to be
    // accepted: three consumed dispositions, or the stall this scenario measures would have been a stall
    // against a stream the authority never took. Sampled AFTER the stream had been resolved, never at
    // send time — an evidence snapshot taken before the authority's next tick reports an in-flight
    // frame as a missing stamp, which is a measurement artefact and not a fact about the stream.
    const s2StreamEvidence = acceptedInputEvidence(s2Stream);
    const stopSending = s2Events.some((e) => e.event.type === 'stop-sending');
    const discarded = s2Events.some((e) => e.event.type === 'discard-prediction');
    // The ladder’s first rung (250 ms) comes due inside the episode; the transport answers it.
    const attempted = await until(() => s2Events.some((e) => e.event.type === 'rejoin-attempt'), 2_000);
    const rejoinedRoom = attempted
      ? await withTimeout(seat2.client.reconnect<ProbeRegionState>(token, RegionSchema), 6_000, 'S2 reconnect')
      : null;
    if (rejoinedRoom !== null) {
      s2Policy.markRejoin(performance.now());
      // Re-wire the policy to the reconnected seat: same policy, new deliveries, new epoch.
      rejoinedRoom.onStateChange(() => {
        const row = rejoinedRoom.state.players.get(rejoinedRoom.sessionId);
        if (row === undefined) return;
        const delivery: Delivery = {
          atMs: performance.now(),
          ack: seat2.handle.lastProcessed,
          record: {
            resolvedThrough: row.inputResolvedThrough,
            gapStart: row.inputGapStart,
            gapEnd: row.inputGapEnd,
            retiredUnrepresented: row.inputRetiredUnrepresented,
          },
          epoch: row.sessionEpoch,
        };
        for (const event of s2Policy.observe(delivery)) s2Events.push({ atMs: Math.round(delivery.atMs - startMs), event });
      });
      stampAndSend(seat2.handle, {
        sessionEpoch: 2,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
    }
    const recovered = await until(() => s2Events.some((e) => e.event.type === 'recovered'), 4_000);
    clearInterval(s2Clock);
    const recoveredEvent = s2Events.find((e) => e.event.type === 'recovered');
    scenarios.push({
      name: 'client-deadline-fires-with-zero-deliveries-and-the-record-recovers',
      expectation:
        'R-B: after an unclean drop nothing arrives, so the 500 ms client deadline must fire on its own (the trigger is “deadline”, not “deliveries”); ' +
        'stop-sending and discard-prediction accompany it; the ladder’s 250 ms rung attempts; the reconnected seat carries a NEW server epoch and the ' +
        'policy recovers through the record (R-C), not by guessing across domains',
      observed: {
        stalled,
        stallTrigger: stallEvent !== undefined && stallEvent.event.type === 'INPUT_ACK_STALLED' ? stallEvent.event.trigger : null,
        stallDelayFromLastDeliveryMs,
        deadlineMs: inputConfig.clientSnapshotDeadlineMs,
        stopSending,
        predictionDiscarded: discarded,
        attempted,
        recovered,
        viaEpochChange: recoveredEvent !== undefined && recoveredEvent.event.type === 'recovered' ? recoveredEvent.event.viaEpochChange : null,
        rebasedTo: recoveredEvent !== undefined && recoveredEvent.event.type === 'recovered' ? recoveredEvent.event.rebasedTo : null,
        events: s2Events.map((e) => e.event.type),
        stream: s2StreamEvidence,
      },
      pass: stalled && stopSending && discarded && attempted && recovered
        && s2StreamEvidence.allSentStampsConsumed === true
        && stallTriggerIsDeadline(stallEvent)
        // The deadline expired on or after lastDelivery + 500 ms; the 10 ms clock granularity is
        // the only tolerance, and it is named rather than hidden.
        && stallDelayFromLastDeliveryMs >= inputConfig.clientSnapshotDeadlineMs,
    });
    exportRoomJournals('client-deadline-fires-with-zero-deliveries-and-the-record-recovers');

    // ── S3 the 4000 ms episode deadline closes the client itself ────────────────────────────────
    const s3Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s3Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const { seat: seat3, stream: s3Stream } = await openSeat('episode-deadline-closes-the-client-at-4000ms');
    wire(seat3, s3Policy, s3Events);
    const s3Clock = startClock(s3Policy, s3Events);
    sendStamped(s3Stream, seat3, {
      generation: 1,
      directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
      moveX: 0,
      moveZ: 1,
    });
    await until(() => (seat3.room.state.players.get(seat3.room.sessionId)?.inputResolvedThrough ?? 0) >= 1, 4_000);
    await seat3.room.leave(false).catch(() => undefined);
    // No transport for the duration: attempts come due at the ladder’s rungs and the scenario
    // reports none of them as an actual rejoin, so the allowance stays unspent while the episode
    // runs against its deadline (D-P2-8: failed attempts do not spend the allowance).
    const episodeClosed = await until(() => s3Events.some((e) => e.event.type === 'client-close'), 6_000);
    clearInterval(s3Clock);
    const closeEvent = s3Events.find((e) => e.event.type === 'client-close');
    const attempts = s3Events.filter((e) => e.event.type === 'rejoin-attempt');
    const episodeAgeMs = closeEvent === undefined ? -1 : Math.round(closeEvent.atMs - (s3Events.find((e) => e.event.type === 'INPUT_ACK_STALLED')?.atMs ?? closeEvent.atMs));
    // The episode starts from a delivery the client actually received, so the one frame that opens it has
    // to be an accepted one. Audited from the journal rows, because by now the transport is gone.
    const s3StreamEvidence = acceptedInputEvidence(s3Stream);
    scenarios.push({
      name: 'episode-deadline-closes-the-client-at-4000ms',
      expectation:
        'R-D: the episode deadline bounds the episode; attempts at the ladder’s rungs do not extend it. At expiry the client closes ITSELF under ' +
        'INPUT_RECOVERY (4102) — no server participation, no further attempt, and the allowance untouched because no rejoin ever happened',
      observed: {
        episodeClosed,
        closeReason: closeEvent !== undefined && closeEvent.event.type === 'client-close' ? closeEvent.event.reason : null,
        closeCode: closeEvent !== undefined && closeEvent.event.type === 'client-close' ? closeEvent.event.code : null,
        expectedCode: inputConfig.closeCodes.INPUT_RECOVERY,
        episodeAgeMs,
        deadlineMs: inputConfig.clientRecoveryDeadlineMs,
        attempts: attempts.map((e) => e.atMs),
        spentAllowance: s3Policy.snapshot(),
        stream: s3StreamEvidence,
      },
      pass: episodeClosed
        && s3StreamEvidence.allSentStampsConsumed === true
        && closeEvent !== undefined && closeEvent.event.type === 'client-close'
        && closeEvent.event.reason === 'episode-deadline'
        && closeEvent.event.code === inputConfig.closeCodes.INPUT_RECOVERY
        && episodeAgeMs >= inputConfig.clientRecoveryDeadlineMs,
    });
    exportRoomJournals('episode-deadline-closes-the-client-at-4000ms');

    // ── S4 the rolling allowance: two actual rejoins in 60 s, the third attempt is refused ───────
    const s4Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s4Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const { seat: seat4 } = await openSeat('two-actual-rejoins-per-rolling-window-and-the-third-is-refused');
    wire(seat4, s4Policy, s4Events);
    const s4Clock = startClock(s4Policy, s4Events);
    let workingSeat = seat4;
    const rejoinOnce = async (): Promise<boolean> => {
      const rejoinToken = workingSeat.room.reconnectionToken;
      await workingSeat.room.leave(false).catch(() => undefined);
      const gotAttempt = await until(() => s4Events.some((e) => e.event.type === 'rejoin-attempt' && !consumedAttempts.has(e.atMs)), 2_000);
      if (!gotAttempt) return false;
      const attempt = s4Events.filter((e) => e.event.type === 'rejoin-attempt').find((e) => !consumedAttempts.has(e.atMs));
      if (attempt === undefined) return false;
      consumedAttempts.add(attempt.atMs);
      const room = await withTimeout(workingSeat.client.reconnect<ProbeRegionState>(rejoinToken, RegionSchema), 6_000, 'S4 reconnect');
      void 0;
      s4Policy.markRejoin(performance.now());
      workingSeat = { room, handle: room.input(), client: workingSeat.client };
      room.onStateChange(() => {
        const row = room.state.players.get(room.sessionId);
        if (row === undefined) return;
        const delivery: Delivery = {
          atMs: performance.now(),
          ack: workingSeat.handle.lastProcessed,
          record: {
            resolvedThrough: row.inputResolvedThrough,
            gapStart: row.inputGapStart,
            gapEnd: row.inputGapEnd,
            retiredUnrepresented: row.inputRetiredUnrepresented,
          },
          epoch: row.sessionEpoch,
        };
        for (const event of s4Policy.observe(delivery)) s4Events.push({ atMs: Math.round(delivery.atMs - startMs), event });
      });
      // A frame under the NEW epoch re-arms the delivery stream so the episode resolves. The epoch is
      // waited for rather than read once (T-0b): after a rejoin the room issues the new epoch as part of
      // completing the join, and a frame stamped with the PREVIOUS domain is a genuine mismatch that
      // would be scored as this scenario's input being refused.
      const rejoinEpoch = await waitForIssuedEpoch(room, 4_000, (s4DomainEpoch ?? 0) + 1);
      s4DomainEpoch = rejoinEpoch;
      // Acceptance is recorded AT THE TIME. A domain whose room has since been disposed of takes its rows
      // with it, so an end-of-run audit can only see the rooms that are still alive — measuring at the
      // moment of the rejoin is the difference between "this domain's frame was accepted" and "one of
      // them was, somewhere, in a room we can still open".
      const consumedBefore = journalAudit(room.sessionId).framesConsumed;
      s4PendingDomain = { epoch: rejoinEpoch, seq: workingSeat.handle.sentCount + 1, consumedBefore };
      stampAndSend(workingSeat.handle, {
        sessionEpoch: rejoinEpoch,
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
      await until(() => s4Events.some((e) => e.event.type === 'recovered'), 4_000);
      if (s4PendingDomain !== null) {
        const pending = s4PendingDomain;
        const accepted = await until(() => journalAudit(room.sessionId).framesConsumed > pending.consumedBefore, 3_000);
        s4RejoinStamps.push({ epoch: pending.epoch, seq: pending.seq, accepted });
        s4PendingDomain = null;
      }
      return true;
    };
    const s4RejoinStamps: { epoch: number; seq: number; accepted: boolean }[] = [];
    let s4PendingDomain: { epoch: number; seq: number; consumedBefore: number } | null = null;
    /** The epoch domain the seat is currently in; a rejoin retires it and the wait demands the next one. */
    let s4DomainEpoch: number | undefined = seat4.room.state.players.get(seat4.room.sessionId)?.sessionEpoch;
    const consumedAttempts = new Set<number>();
    await sleep(300);
    const first = await rejoinOnce();
    await sleep(300);
    const second = await rejoinOnce();
    // Third drop: the window now holds two actual rejoins; the policy must REFUSE the attempt and
    // end closed — the ladder does not get to make a third.
    await workingSeat.room.leave(false).catch(() => undefined);
    const refused = await until(() => s4Events.some((e) => e.event.type === 'allowance-refused'), 3_000);
    const s4Closed = await until(() => s4Events.some((e) => e.event.type === 'client-close'), 2_000);
    clearInterval(s4Clock);
    const totalAttempts = s4Events.filter((e) => e.event.type === 'rejoin-attempt').length;
    const s4Close = s4Events.find((e) => e.event.type === 'client-close');
    scenarios.push({
      name: 'two-actual-rejoins-per-rolling-window-and-the-third-is-refused',
      expectation:
        'R-E: at most rejoinWindowAllowance (2) ACTUAL rejoins in any trailing rejoinWindowSeconds (60 s), per entity across episodes. Failed or ' +
        'unmade attempts do not spend it; when it is spent the client does not attempt — it ends under INPUT_RECOVERY. The third ladder rung exists ' +
        'for schedule definition, not as a reachable third rejoin inside one window',
      observed: {
        firstRejoin: first,
        secondRejoin: second,
        thirdRefused: refused,
        closed: s4Closed,
        closeReason: s4Close !== undefined && s4Close.event.type === 'client-close' ? s4Close.event.reason : null,
        totalAttempts,
        allowanceUsed: inputConfig.rejoinWindowAllowance,
        state: s4Policy.snapshot().state,
        // S4 spans two stamp domains, so its input claim is the domain-safe one read from the authority's
        // journal: every client frame it sent ended `consumed`, with no refusal of any kind.
        // The rooms a disposed domain left behind are gone from the live registry, so this audit covers
        // only what is still resident; the per-domain `rejoinStreams` entries are the complete record.
        journal: journalAudit(seat4.room.sessionId),
        rejoinStreams: s4RejoinStamps,
      },
      pass: first && second && refused && s4Closed
        && s4Close !== undefined && s4Close.event.type === 'client-close' && s4Close.event.reason === 'allowance-exhausted'
        && totalAttempts === inputConfig.rejoinWindowAllowance
        && s4Policy.snapshot().state === 'closed'
        && journalAudit(seat4.room.sessionId).allClientFramesConsumed === true
        && s4RejoinStamps.length === 2
        && s4RejoinStamps.every((entry, index, all) => all.findIndex((other) => other.epoch === entry.epoch) === index)
        // One frame per rejoin domain, and every domain's frame measured as ACCEPTED while its own room
        // was still live. An end-of-run audit cannot stand in for this: a domain whose room has been
        // disposed of takes its rows with it, so the complete record is the per-domain entries, not the
        // rooms that happen to still be resident.
        && s4RejoinStamps.every((entry) => entry.accepted === true),
    });
    exportRoomJournals('two-actual-rejoins-per-rolling-window-and-the-third-is-refused');
  } finally {
    mkdirSync(OUT_DIR, { recursive: true });
    // The replay inputs R-1 retains: one whole-room journal per recovery scenario, replayed by a different
    // process from these bytes (`journal-replay.ts`). A recovery scenario whose room produced no rows is
    // reported with `rows: 0` rather than quietly dropped from the file.
    writeFileSync(
      resolve(OUT_DIR, 'journal-recovery.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-13', 'AC-3d', 'AC-20'],
          kind: 'udg-003-phase-2-journal-inputs',
          producer: 'tests/runtime/udg-003-phase-2/recovery-scenarios.ts',
          runId: 'udg-003-phase-2-recovery',
          stepper: 'flat-reference',
          rooms: roomJournals,
          settingsNote:
            'One room per recovery scenario, so each journal is a whole run from its own prologue. Reconnection rows carry the '
            + 'server-issued epoch of the domain they belonged to; a stamp is never replayed across a domain.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const failed = scenarios.filter((entry) => !entry.pass);
    writeFileSync(
      resolve(OUT_DIR, 'recovery-harness.json'),
      `${JSON.stringify(
        {
          taskId: 'UDG-003',
          phase: 'phase-2',
          criterion: ['GA-6', 'GA-7'],
          verdict: failed.length === 0 && scenarios.length === 4 ? 'pass' : 'fail',
          frozenRules: [
            'R-A Same-delivery comparison: ack and record are compared only within one state delivery.',
            'R-B INPUT_ACK_STALLED: G consecutive non-advancing deliveries, or the clientSnapshotDeadline expiring with no delivery at all; on stall stop sending, discard prediction, open an episode.',
            'R-C Snapshot recovery: a record that advances (including across an epoch change) rebases the client; through the record, never by guessing across stamp domains.',
            'R-D Episode deadline: clientRecoveryDeadlineMs from episode start; at expiry the client closes itself under INPUT_RECOVERY (4102).',
            'R-E Rolling allowance: at most rejoinWindowAllowance ACTUAL rejoins per trailing rejoinWindowSeconds per entity across episodes; the ladder is a schedule, not an entitlement; refused attempts do not spend allowance.',
          ],
          handoff: 'UDG-008 implements these rules in the production client; this file and input-reconciliation.json are its conformance cases.',
          limitations: [
            'Loopback, one server, one room; RTT and packet loss remain unmeasurable here (§3.2 loss paths are covered at their server-visible halves: drops, epochs, and deadlines).',
            'Every deadline value is the provisional hashed test setting; GA-6 re-derives the tolerable windows from the delivery population.',
            'Duplicate and reordered CONTINUOUS stamps are not constructible through the SDK send path; their server halves are measured as discrete-identity replay idempotence.',
          ],
          scenarios,
          streamNote:
            'T-0b: every seat waits for the room-issued epoch before its first frame (F-3), and every scenario that needs ACCEPTED input '
            + 'asserts consumption from the authority journal (five frames in S1, three in S2, one in S3, one per rejoin domain in S4). '
            + 'A scenario that deliberately produces a refusal is not present here by design: the refused-input control lives in the '
            + 'population script (`wrong-epoch-stream-fails-the-compliant-assertion`), and S4 third-attempt refusal is a CLIENT-side '
            + 'allowance refusal that sends nothing at all.',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stderr.write(`[recovery] ${String(scenarios.length - failed.length)}/${String(scenarios.length)} scenarios passed\n`);
    await Promise.race([server.close().catch(() => undefined), sleep(4_000)]);
  }
  if (scenarios.some((entry) => !entry.pass)) process.exitCode = 2;
}

const stallTriggerIsDeadline = (stallEvent: { event: RecoveryEvent } | undefined): boolean =>
  stallEvent !== undefined && stallEvent.event.type === 'INPUT_ACK_STALLED' && stallEvent.event.trigger === 'deadline';

await main();
process.exit(process.exitCode ?? 0);
