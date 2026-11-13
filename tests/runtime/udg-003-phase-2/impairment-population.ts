/**
 * Bounded application-layer impairment on the real room (UDG-003 Phase 2, W-10 as amended under OD-2).
 *
 * What W-10 now says, in the amended clause: *"RTT, jitter, application-layer delivery loss (a delivery
 * withheld in flight on the pinned harness, with `tcpLossModelled: false` and the runner reason recorded),
 * imposed RTT and jitter over a real WebSocket round trip with the loopback baseline reported separately,
 * mid-tick arrival, reconnect, offender runs and the compliant control population GA-12 requires. Phase 2
 * records the populations; it does not evaluate the two GA-11 inequalities and does not set production
 * values."*
 *
 * So this script measures four populations and nothing else:
 *
 * * **RTT** — the delivered round trip per seat: this frame left at T, and the patch that carried its
 *   consumption arrived at T′. `inputResolvedThrough` is the field the server publishes for exactly this
 *   question (protocol-v1 §6), so nothing here has to guess which frame a patch answered. The unarmed
 *   baseline seat runs beside the impaired ones and its figures are published separately: an imposed delay
 *   is only evidence when the path it was imposed on has been measured.
 * * **jitter** — the deviation the layer applied, and the deviation the room saw between arrivals on the
 *   journal, plus the ticks where a seat's queue held more than one frame (the overrun population GA-11
 *   asks for, at test settings).
 * * **loss** — named withheld deliveries, with the room-side consequence: the withheld stamps never appear
 *   as consumptions, the ones after them do, and no part of that pattern is reachable over TCP.
 * * **arrival phase** — where inside the tick the arrivals landed, from the room's own rows.
 *
 * What it refuses to claim is on the artefact under `doesNotEstablish`: no TCP-loss behaviour, no production
 * tuning, no evaluation of `B + J·λ + stall ≤ bufferMaxSize` or of the snapshot-deadline inequality, and no
 * GA-6 or GA-7 verdict — the stall row stops at what the seat observed, because the client-local deadline
 * machine is production client behaviour and belongs to UDG-008.
 *
 * Writes `transport-impairment.json` under `UDG_VECTORS_OUT`.
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
  type SdkRoom,
} from '../../support/client-harness/transport.mjs';
import {
  installImpairment,
  type ImpairmentController,
  type ImpairmentOptions,
} from '../../support/client-harness/impairment.mjs';
import { flattenConsumed, streamAccounting } from '../../support/authority/accounting.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/**
 * The harness clock. The journal's `atMs` and the room's `startedAtMs` are `performance.now()` readings
 * (`RegionRoom.ts:197`), and server and client share this process, so `performance.now()` is the one clock
 * that makes a client-side send timestamp and a journalled arrival comparable. Mixing `Date.now()` into
 * that subtraction produces numbers around -1.8e12 ms, which is how this was caught locally: the first
 * version of the control PASSED on those values, because "less than 50 ms" is true of a negative trillion.
 * Every latency in this artefact is a difference of two readings of this clock.
 */
const nowMs = (): number => performance.now();

/** 40 frames at 50 ms is one second of stream per seat. */
const FRAMES_PER_SEAT = 40;
const FRAME_INTERVAL_MS = 50;
/** The delay imposed in each direction on the impaired seat, and its deterministic jitter envelope. */
const IMPOSED_DELAY_MS = 40;
const IMPOSED_JITTER_MS = 20;
/**
 * The outbound ordinals the loss seat withholds. Ordinal equals stamp, because `stampAndSend` stamps
 * `sentCount + 1` on every send — which is what turns "a delivery was withheld" into "stamp 7 never
 * arrived", a claim the room's own rows can confirm or refuse.
 */
const WITHHELD_ORDINALS = [3, 7, 12, 18];
/** How long the delivery-stall seat is held without patches. */
const STALL_MS = 350;

interface PlayerRow {
  inputResolvedThrough: number;
  sessionEpoch: number;
}

interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

interface InputHandle {
  data: Record<string, unknown>;
  readonly sentCount: number;
  send(): number;
}

interface RoomInstance {
  evidence(): Record<string, unknown>;
  journal(): { rows: readonly Record<string, unknown>[] };
  tickRecords: readonly {
    tick: number;
    consumed: readonly { entityId: string; seq: number }[];
    signals: readonly { entityId: string; signal: string }[];
    closures: readonly { entityId: string; code: number }[];
    refused: readonly { entityId: string; count: number }[];
    maxDepth: number;
  }[];
}

interface RegionRoomStatic {
  liveRooms(): readonly RoomInstance[];
}

/** The shape every population table shares, so `p95` is a field and not an index-signature guess. */
interface HistogramShape {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

const histogram = (values: readonly number[]): HistogramShape => {
  if (values.length === 0) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? null,
    mean: Number((sorted.reduce((total, value) => total + value, 0) / sorted.length).toFixed(3)),
  };
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const [RegionRoomModule, schemaMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as unknown as Promise<{
      RegionRoom: RegionRoomStatic;
      defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
    }>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
  ]);
  const RegionSchema = schemaMod['RegionSchema'];
  const withConfigOverrides = configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>;
  const computeConfigHash = configMod['computeConfigHash'] as (c: unknown) => string;
  const regionHash = configMod['regionHash'] as (c: unknown) => string;

  // Hashed defaults everywhere but the region bounds, which every room must declare and which move no
  // envelope number: the impairment lives in the harness, so the queue has no reason to be retuned.
  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  const deploymentOverrides = { region: { bounds } };
  const cfg = withConfigOverrides(configMod['DEFAULT_SERVER_CONFIG'], deploymentOverrides);
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: computeConfigHash(cfg),
    manifestHash: regionHash(cfg),
  };

  const stack = await loadPinnedStack(ROOT);
  const server = await startHarnessServer(ROOT, {
    region: RegionRoomModule.defineOperatorRegionRoom({
      config: deploymentOverrides,
      runId: 'udg-003-phase-2-impairment',
      journalRetention: 20_000,
      regionProvenance: 'test-only-synthetic',
    }),
  });

  interface SeatSpec {
    label: string;
    purpose: string;
    options: ImpairmentOptions;
    arm: boolean;
  }
  const specs: SeatSpec[] = [
    {
      label: 'baseline',
      purpose: 'unarmed control: the loopback round trip this run actually has, published separately from every imposed figure',
      options: {},
      arm: false,
    },
    {
      label: 'imposed-delay',
      purpose: `RTT and jitter populations under ${String(IMPOSED_DELAY_MS)} ms imposed each way with ${String(IMPOSED_JITTER_MS)} ms of deterministic jitter`,
      options: {
        forwardDelayMs: IMPOSED_DELAY_MS,
        inboundDelayMs: IMPOSED_DELAY_MS,
        inboundJitterMs: IMPOSED_JITTER_MS,
        seed: 20261113,
      },
      arm: true,
    },
    {
      label: 'withheld-deliveries',
      purpose: 'loss population: named deliveries withheld in flight, later deliveries allowed through',
      options: { dropOutboundAt: WITHHELD_ORDINALS, seed: 7 },
      arm: true,
    },
    {
      label: 'delivery-stall',
      purpose: `patches withheld for ${String(STALL_MS)} ms while the seat keeps streaming: what a seat observes during a stall, and nothing beyond it`,
      options: { seed: 11 },
      arm: true,
    },
  ];

  interface SeatRecord {
    spec: SeatSpec;
    room: SdkRoom<ProbeRegionState>;
    handle: InputHandle;
    entityId: string;
    epoch: number;
    controller: ImpairmentController;
    sentStamps: number[];
    /** send → the patch that carried its resolution, as the CLIENT saw it (cadence included). */
    resolutionLatencyMs: number[];
    /** stamp → the instant its send left the seat, kept for the whole run. */
    sentAtMs: Map<number, number>;
    /** stamp → the instant its send left the seat, until a patch resolves it. */
    pending: Map<number, number>;
    stallResolvedThroughAtStart: number | null;
    stallDequeuesAtStart: number | null;
  }

  const first = await connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema);
  const roomId = first.room.roomId;
  const created = [first];
  for (let index = 1; index < specs.length; index += 1) {
    created.push(await connectSeatById<ProbeRegionState>(stack, server.endpoint, roomId, identity, RegionSchema));
  }

  const seats: SeatRecord[] = [];
  for (const [index, spec] of specs.entries()) {
    const seat = created[index];
    if (seat === undefined) throw new Error(`seat ${spec.label} never connected`);
    const epoch = await waitForIssuedEpoch(seat.room as unknown as SdkRoom<ProbeRegionState>);
    const controller = installImpairment(seat.room as unknown as Parameters<typeof installImpairment>[0], spec.options);
    const record: SeatRecord = {
      spec,
      room: seat.room,
      handle: seat.handle as unknown as InputHandle,
      entityId: seat.room.sessionId,
      epoch,
      controller,
      sentStamps: [],
      resolutionLatencyMs: [],
      sentAtMs: new Map<number, number>(),
      pending: new Map<number, number>(),
      stallResolvedThroughAtStart: null,
      stallDequeuesAtStart: null,
    };
    (seat.room as unknown as { onStateChange(callback: (state: ProbeRegionState) => void): void })
      .onStateChange((state) => {
        const row = state.players?.get(seat.room.sessionId);
        const resolvedThrough = row?.inputResolvedThrough ?? 0;
        for (const [stamp, sentAtMs] of [...record.pending.entries()]) {
          if (stamp <= resolvedThrough) {
            record.resolutionLatencyMs.push(nowMs() - sentAtMs);
            record.pending.delete(stamp);
          }
        }
      });
    seats.push(record);
    if (spec.arm) controller.arm();
  }

  const frame = {
    generation: 1,
    directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
    moveX: 0,
    moveZ: 1,
  };
  const releases: (() => void)[] = [];
  const streamStartMs = nowMs();
  // All four seats stream together: an impairment that bled into a neighbour would show up as the unarmed
  // baseline seat's RTT moving, and that movement is one of the controls below.
  await Promise.all(seats.map(async (seat) => {
    for (let sent = 0; sent < FRAMES_PER_SEAT; sent += 1) {
      if (seat.spec.label === 'delivery-stall' && sent === 10) {
        const row = seat.room.state.players?.get(seat.room.sessionId);
        seat.stallResolvedThroughAtStart = row?.inputResolvedThrough ?? 0;
        // What the room had already dequeued for this seat, counted at the same instant: the difference
        // against the end-of-run count is "frames the room decided while this seat was not being told".
        const liveRoom = RegionRoomModule.RegionRoom.liveRooms()[0];
        seat.stallDequeuesAtStart = liveRoom === undefined
          ? null
          : flattenConsumed(liveRoom.tickRecords).filter((entry) => entry.entityId === seat.entityId).length;
        releases.push(seat.controller.withholdInbound(STALL_MS));
      }
      const stamp = Number(stampAndSend(seat.handle as never, { ...frame, sessionEpoch: seat.epoch }));
      seat.sentStamps.push(stamp);
      seat.sentAtMs.set(stamp, nowMs());
      seat.pending.set(stamp, nowMs());
      await sleep(FRAME_INTERVAL_MS);
    }
  }));
  for (const release of releases) release();
  // Drain the tail, and the stalled seat's withheld backlog.
  await sleep(1_200);
  const streamDurationMs = nowMs() - streamStartMs;

  const rooms = RegionRoomModule.RegionRoom.liveRooms().filter((candidate) => candidate.evidence()['refused'] !== true);
  const room = rooms[0];
  const rows = room?.journal().rows ?? [];
  const tickRecords = room?.tickRecords ?? [];
  const consumedAll = flattenConsumed(tickRecords);
  const evidence = room?.evidence() ?? {};
  const samples = (evidence['metricsSamples'] ?? []) as readonly {
    tick: number;
    depths: readonly { entityId: string; size: number }[];
  }[];

  const perSeat = seats.map((seat) => {
    const accounting = streamAccounting({
      journalRows: rows,
      consumed: consumedAll,
      entityId: seat.entityId,
      sentStamps: seat.sentStamps,
      collidedStamps: 0,
    });
    const counters = seat.controller.counters();
    const seatRows = rows.filter((row) => row['type'] === 'observation'
      && row['entityId'] === seat.entityId
      && row['origin'] === 'client-payload');
    const arrivalGaps: number[] = [];
    let previousAtMs: number | null = null;
    for (const row of seatRows) {
      const atMs = Number(row['atMs'] ?? Number.NaN);
      if (Number.isFinite(atMs)) {
        if (previousAtMs !== null) arrivalGaps.push(atMs - previousAtMs);
        previousAtMs = atMs;
      }
    }
    const median = histogram(arrivalGaps).p50 ?? 0;
    const overrunTicks = samples.filter((sample) => sample.depths
      .some((depth) => depth.entityId === seat.entityId && depth.size > 1)).length;
    const withheld = seat.spec.label === 'withheld-deliveries' ? WITHHELD_ORDINALS : [];
    const consumedSet = new Set(accounting.consumedStamps);
    // One-way arrival latency at the intake, per stamp. Server and client share this process, so the two
    // clocks are the same clock and the subtraction is a measurement rather than a comparison of guesses.
    // Stamps are paired to rows in FIFO order — the same pairing rule `accounting.ts` uses and for the
    // same reason: the journal carries no wire stamp, and a seat drains one frame per tick. If the counts
    // disagree the pairing has broken, and the honest answer is `null`, not a best guess.
    const withheldSet = new Set(withheld);
    // Ordinal equals stamp here, so "the transport withheld ordinal 7" and "stamp 7 never reached the room"
    // are the same sentence. What the harness STAMPED is a third number again: the SDK owns the client-side
    // buffer, and a seat whose resolutions come back slower than it sends can retire frames before they
    // ever hit the wire. That count is published, never folded into a latency.
    const stampedButUnsent = Math.max(0, seat.sentStamps.length - counters.sentTotal);
    const deliveredStamps = seat.sentStamps
      .filter((_stamp, index) => !withheldSet.has(index + 1))
      .slice(0, Math.max(0, counters.deliveredTotal));
    const arrivalLatencyMs: number[] = [];
    let paired = true;
    if (seatRows.length === deliveredStamps.length) {
      seatRows.forEach((row, index) => {
        const atMs = Number(row['atMs'] ?? Number.NaN);
        const sentAt = seat.sentAtMs.get(deliveredStamps[index] as number);
        if (Number.isFinite(atMs) && sentAt !== undefined) arrivalLatencyMs.push(atMs - sentAt);
        else paired = false;
      });
    } else {
      paired = false;
    }
    const rowNow = seat.room.state.players?.get(seat.room.sessionId);
    const dequeuesNow = consumedAll.filter((entry) => entry.entityId === seat.entityId).length;
    return {
      label: seat.spec.label,
      purpose: seat.spec.purpose,
      entityId: seat.entityId,
      epoch: seat.epoch,
      framesSent: seat.sentStamps.length,
      impairment: counters,
      discriminator: seat.controller.discriminator(),
      measuresDefined: {
        sendToJournalledArrivalMs: 'one way: the instant the send left the seat to the instant the room journalled the arrival. Same process, so the clocks are the same clock. The floor is one simulation step, because the arrival is journalled BY the tick rather than by the socket callback, and the artefact says so instead of pretending the number is a wire time-of-flight. It is quantised as well as floored: see layerFindings, because a delay that does not move an arrival past a tick boundary is INVISIBLE in this figure, so it is not a delay meter and no control is built on it.',
        sendToObservedResolutionMs: 'what a client can actually see: send to the patch that carried the resolution. It necessarily contains the tick wait (simulationStepSeconds, 50 ms here) and the publish wait (statePatchIntervalMs, 100 ms), so it is NOT a network round trip and is not offered as one.',
        withheldStampPairing: 'ordinal equals stamp because stampAndSend stamps sentCount + 1; rows are paired to delivered stamps in FIFO order, the same rule accounting.ts uses',
      },
      sendToJournalledArrivalMs: paired ? histogram(arrivalLatencyMs) : null,
      arrivalPairing: paired
        ? 'stamps paired to rows one-for-one'
        : `NOT PAIRED: ${String(seatRows.length)} rows against ${String(deliveredStamps.length)} delivered stamps`,
      framesStamped: seat.sentStamps.length,
      transportSends: counters.sentTotal,
      transportDelivered: counters.deliveredTotal,
      retiredByTheSdkBufferBeforeTheWire: stampedButUnsent,
      sdkBufferNote:
        'the client-side input buffer belongs to the pinned SDK (bufferMaxSize frames). A seat acknowledged more slowly than it sends retires frames there, before this layer and before the wire; the count is published because a latency population that silently excludes those frames is a nicer lie than the run deserves',
      sendToObservedResolutionMs: histogram(seat.resolutionLatencyMs),
      resolutionSamples: seat.resolutionLatencyMs.length,
      unresolvedAtEnd: seat.pending.size,
      stampsStillUnresolved: [...seat.pending.keys()],
      refusalReasons: accounting.refusedBy as Record<string, number>,
      roomSide: {
        stampsConsumed: accounting.stampsConsumed,
        stampsRefused: accounting.stampsRefused,
        stampsDroppedAtClose: accounting.stampsDroppedAtClose,
        consumedStamps: accounting.consumedStamps,
        missingStamps: accounting.missingStamps,
        pairingConsistent: accounting.pairingConsistent,
        movedMeters: Number(accounting.movedMeters.toFixed(6)),
        allSentStampsConsumed: accounting.allSentStampsConsumed,
      },
      arrival: {
        arrivalsAtIntake: seatRows.length,
        interArrivalMs: histogram(arrivalGaps),
        deviationFromMedianMs: histogram(arrivalGaps.map((gap) => Math.abs(gap - median))),
        overrunTicksDepthGreaterThanOne: overrunTicks,
      },
      withheldStampsNamed: withheld,
      withheldNeverConsumed: withheld.length > 0 && withheld.every((stamp) => !consumedSet.has(stamp)),
      deliveriesAfterTheHoleConsumed: withheld.length === 0
        ? null
        : withheld.every((stamp) => consumedSet.has(stamp + 1) || consumedSet.has(stamp + 2)),
      stall: seat.spec.label === 'delivery-stall'
        ? {
          withheldPatchWindowMs: STALL_MS,
          resolvedThroughAtStallStart: seat.stallResolvedThroughAtStart,
          resolvedThroughAtEnd: rowNow?.inputResolvedThrough ?? -1,
          framesTheRoomConsumedWhileTheSeatSawNothing: seat.stallDequeuesAtStart === null
            ? null
            : dequeuesNow - seat.stallDequeuesAtStart,
          note: 'the room kept deciding while the client kept not being told; the client-side deadline that would act on this is production behaviour and belongs to UDG-008, so this row records the observation and stops',
        }
        : null,
    };
  });

  const baseline = perSeat.find((entry) => entry.label === 'baseline');
  const imposed = perSeat.find((entry) => entry.label === 'imposed-delay');
  const loss = perSeat.find((entry) => entry.label === 'withheld-deliveries');
  const stalled = perSeat.find((entry) => entry.label === 'delivery-stall');
  const midTickArrivals = tickRecords.filter((tickRecord) => consumedAll
    .filter((entry) => entry.tick === tickRecord.tick).length > 1).length;

  const controls = {
    baselineSeatHadNoImpairment: (baseline?.impairment.droppedTotal ?? -1) === 0
      && (baseline?.impairment.forwardDelayAppliedMs.count ?? -1) === 0,
    // The loopback floor, measured rather than assumed. With nothing imposed, a frame is journalled within
    // about one simulation step of leaving the seat; if this ever fails, this is not the runner the rest of
    // the artefact is describing.
    loopbackBaselineArrivesInsideAboutATick: (() => {
      // Two simulation steps, plus one honest allowance. A runner that is late handing out patches is a
      // late runner, and that is a fact about the machine rather than about the layer: this control is
      // here to notice a runner so slow that the imposed figures would mean nothing, not to fail a good
      // run on a busy hosted box. The allowance is therefore whatever lateness this run's own UNARMED seat
      // measured against the room's declared patch interval (100 ms, the hashed default this room runs).
      // On a quiet runner it is zero and the bound is the two steps it always was.
      const baselinePatches = baseline?.impairment.patchArrivalsMs ?? [];
      const patchGaps = baselinePatches.slice(1).map((atMs: number, index: number) => atMs - (baselinePatches[index] ?? atMs));
      const runnerLatenessMs = patchGaps.length > 0 ? Math.max(0, (histogram(patchGaps).p99 ?? 0) - 100) : 0;
      return (baseline?.sendToJournalledArrivalMs?.p99 ?? Number.POSITIVE_INFINITY)
        <= 2 * FRAME_INTERVAL_MS + runnerLatenessMs;
    })(),
    // The imposed delay is measured as a DIFFERENCE against the seat that had none, because the absolute
    // figure contains the tick floor. Asserting the absolute number instead would have the artefact
    // credit itself for the room's own cadence.
    //
    // And the difference is taken on the CLIENT-OBSERVED measure, not on send-to-journalled-arrival. That
    // is not a preference, it is a correction this run paid for: an arrival is journalled by the next
    // consuming tick, so the one-way figure is `delay + (tick boundary - phase)`, which for a phase that
    // does not cross a boundary equals the undelayed figure exactly. A control built on it passed when
    // the delay happened to push an arrival over a tick boundary and failed when it did not, which is a
    // coin flip wearing a threshold. The layer's own applied-delay accounting is asserted alongside, so
    // the artefact cannot pass by measuring nothing.
    imposedDelayIsTheDifferenceBetweenTheSeats: (() => {
      const baselineSeen = baseline?.sendToObservedResolutionMs?.p50 ?? Number.NaN;
      const imposedSeen = imposed?.sendToObservedResolutionMs?.p50 ?? Number.NaN;
      const delta = imposedSeen - baselineSeen;
      const applied = imposed?.impairment.forwardDelayAppliedMs;
      return Number.isFinite(delta)
        && delta >= IMPOSED_DELAY_MS * 0.6
        && delta <= 2 * (IMPOSED_DELAY_MS + IMPOSED_JITTER_MS) + FRAME_INTERVAL_MS
        && (applied?.count ?? 0) > 0
        && (applied?.min ?? 0) >= IMPOSED_DELAY_MS;
    })(),
    // No frame anywhere arrived epoch-less. The first version of this seat jittered the OUTBOUND path,
    // which reorders deliveries, and a reordered input stream on the pinned protocol presents no
    // association epoch: 31 of its 40 frames came back `refused:epoch`. The control is the proof that the
    // run being reported is not that run.
    noFrameArrivedWithoutAnAssociationEpoch: perSeat.every((entry) => (entry.refusalReasons['refused:epoch'] ?? 0) === 0),
    imposedDelayAlsoLiftsWhatTheClientSees: (imposed?.sendToObservedResolutionMs.p50 ?? 0)
      > (baseline?.sendToObservedResolutionMs.p50 ?? Number.POSITIVE_INFINITY),
    everySeatReportsBothMeasures: perSeat.every((entry) => entry.sendToJournalledArrivalMs !== null
      && entry.sendToJournalledArrivalMs.count > 0 && entry.resolutionSamples > 0),
    // A negative latency is a clock error, not a fast network. Stated as a control because the first run of
    // this script passed a "<= 50 ms" check on -1.8e12 ms values.
    latenciesArePhysicallyPossible: perSeat.every((entry) => entry.sendToJournalledArrivalMs === null
      || (entry.sendToJournalledArrivalMs.min ?? -1) >= 0),
    withheldDeliveriesAreNamedAndNeverConsumed: (loss?.withheldStampsNamed.length ?? 0) === WITHHELD_ORDINALS.length
      && loss?.withheldNeverConsumed === true,
    laterDeliveriesStillArrived: loss?.deliveriesAfterTheHoleConsumed === true,
    lossDidNotEscapeItsSeat: baseline?.roomSide.allSentStampsConsumed === true
      && (loss?.roomSide.stampsRefused ?? 1) === 0,
    stallSeatCaughtUpAfterRelease: (stalled?.roomSide.allSentStampsConsumed ?? false) === true,
    socketNeverBrokeAnywhere: perSeat.every((entry) => entry.impairment.socketClosedDuring === 0
      && entry.impairment.reconnectEvents === 0),

  };

  const artefact = {
    taskId: 'UDG-003',
    phase: 'phase-2',
    criterion: ['W-10', 'GA-11'],
    producer: 'tests/runtime/udg-003-phase-2/impairment-population.ts',
    statement:
      'W-10 as amended (OD-2): RTT, jitter, application-layer delivery loss and arrival-phase populations over a real WebSocket round trip, with the loopback baseline reported separately. Phase 2 records the populations; evaluating the two GA-11 inequalities and selecting production values belong to UDG-SPIKE-001.',
    impairmentLayer: {
      name: 'application-layer delivery impairment (tests/support/client-harness/impairment.mjs)',
      impairmentSource: 'harness',
      seam: 'room.connection.transport.send (outbound) and room.connection.events.onmessage (inbound), wrapped per seat after the join — the pinned SDK\'s own paths (@colyseus/sdk 0.18.9 Room.mjs:126-127, Connection.mjs:36, transport/WebSocketTransport.mjs:79)',
      noProxyAndNoNewDependency: 'a relay would need `ws`, which pnpm does not expose to apps/server (transitive-only in pnpm-lock.yaml); the wrapper adds nothing to the dependency set',
      streamDurationMs,
      framesPerSeat: FRAMES_PER_SEAT,
      frameIntervalMs: FRAME_INTERVAL_MS,
      imposedDelayMs: IMPOSED_DELAY_MS,
      imposedJitterMs: IMPOSED_JITTER_MS,
      envelope: 'hashed defaults; only the region bounds are declared, and they move no envelope number',
      seats: specs.map((spec) => ({ label: spec.label, purpose: spec.purpose, armed: spec.arm, options: spec.options })),
    },
    pairingPolicy: {
      rule: 'arrival latencies are published only where stamps and rows pair one-for-one; a seat that does not pair publishes `arrivalPairing` with both counts instead of a number averaged over a mismatch',
      unpairedSeats: perSeat.filter((entry) => entry.sendToJournalledArrivalMs === null).map((entry) => entry.label),
    },
    populations: {
      roundTrip: {
        note: 'both measures are published for every seat. Neither is a network round trip: one is one-way to the intake, the other is what a client observes and contains the tick and publish waits. The clause asks for "imposed RTT over a real WebSocket round trip with the loopback baseline reported separately", and this is that, with the names it can bear.',
        baselineSeat: baseline?.label ?? null,
        perSeat: perSeat.map((entry) => ({
          seat: entry.label,
          sendToJournalledArrivalMs: entry.sendToJournalledArrivalMs,
          sendToObservedResolutionMs: entry.sendToObservedResolutionMs,
          resolutionSamples: entry.resolutionSamples,
          unresolvedAtEnd: entry.unresolvedAtEnd,
          arrivalPairing: entry.arrivalPairing,
        })),
        cadenceIncludedInClientObservedFigure: {
          simulationStepMs: 50,
          statePatchIntervalMs: 100,
          source: 'hashed defaults: network.simulationStepSeconds and network.statePatchIntervalMs',
        },
      },
      jitter: perSeat.map((entry) => ({
        seat: entry.label,
        imposedForwardDelayMs: entry.impairment.forwardDelayAppliedMs,
        imposedInboundDelayMs: entry.impairment.inboundDelayAppliedMs,
        interArrivalAtIntakeMs: entry.arrival.interArrivalMs,
        deviationFromMedianMs: entry.arrival.deviationFromMedianMs,
        overrunTicksDepthGreaterThanOne: entry.arrival.overrunTicksDepthGreaterThanOne,
      })),
      loss: perSeat.filter((entry) => entry.withheldStampsNamed.length > 0).map((entry) => ({
        seat: entry.label,
        withheldStamps: entry.withheldStampsNamed,
        withheldNeverConsumed: entry.withheldNeverConsumed,
        deliveriesAfterTheHoleConsumed: entry.deliveriesAfterTheHoleConsumed,
        stampsStillUnresolvedAtEnd: entry.stampsStillUnresolved,
        discriminator: entry.discriminator,
      })),
      arrivalPhase: {
        ticksWithMoreThanOneDequeueAcrossTheRoom: midTickArrivals,
        interArrivalBySeat: perSeat.map((entry) => ({ seat: entry.label, ...entry.arrival })),
        note: 'the per-tick depth trace for the busier room is buffer-depth.csv; this artefact keeps the impairment-labelled arrivals, and the two instruments are named apart',
      },
    },
    seats: perSeat,
    controls,
    verdict: Object.values(controls).every((value) => value === true) ? 'pass' : 'fail',
    layerFindings: [
      {
        finding: 'jitter on the outbound path reorders deliveries, and a reordered input stream is refused here',
        measured: 'the first version of the imposed seat jittered the client-to-server direction too; 31 of its 40 frames were journalled as `refused:epoch` with `epoch: 0`, because the pinned input protocol carries the association epoch on the stream\'s first frame and the reordered frames arrived without one',
        response: 'the layer now imposes a fixed delay outbound and jitters only the delivery direction, and the control noFrameArrivedWithoutAnAssociationEpoch is what proves this run is not that run',
        whyItMatters: 'a real TCP path cannot reorder a stream: it stalls until retransmission. A layer that can reorder is therefore not only a different loss model from a network, it is a different ORDERING model, which is the second independent reason the label on this artefact is not decoration',
      },
      {
        finding: 'resolution is observed by the client only at a patch boundary',
        measured: 'client-observed latency is roughly one tick plus one patch interval above the one-way figure on every seat, baseline included',
        response: 'the two figures are published separately and named differently; the client-observed one is never called a round trip',
        whyItMatters: 'the GA-11 inequality multiplies a measured p99 RTT, and a figure inflated by publish cadence would make the deadline look safer than the path is',
      },
    ],
    doesNotEstablish: [
      'TCP-loss behaviour of any kind: every drop in this run is an application-layer withheld delivery, with the head-of-line-blocking discriminator recorded beside it',
      'production tuning, or any evaluation of B + J·λ + stall ≤ bufferMaxSize or clientSnapshotDeadlineMs ≥ 4 × patch + 2 × p99 RTT (GA-11 and UDG-SPIKE-001 own both)',
      'a GA-6 or GA-7 verdict: the stall row records what the seat observed while patches were withheld; the client-local deadline machine is production client behaviour and belongs to UDG-008',
      'a network path: RTT here is imposed over a measured loopback baseline, and that baseline is published beside it so the imposed component stays visible',
    ],
    gateAOwns: [
      'evaluating both production inequalities on measured values',
      'naming production values beside the provisional ones and explaining any change',
      'recording whether the Gate A runner could produce network-layer impairment at all',
    ],
    settingsNote:
      'Provisional test settings on a loopback transport (D-P2-4). Every seat carries tcpLossModelled: false with the runner reason and the discriminator attached.',
  };

  for (const seat of seats) seat.controller.restore();
  await Promise.all(seats.map((seat) => seat.room.leave(true).catch(() => undefined)));

  writeFileSync(resolve(OUT_DIR, 'transport-impairment.json'), `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  if (artefact.verdict !== 'pass') {
    // Same reason as the stage sequence: the capture keeps stderr, and a failing timing control has to
    // arrive with the number that went false rather than with an exit code.
    process.stderr.write(`[impairment][fail] ${Object.entries(artefact.controls as Record<string, boolean>).filter(([, value]) => value !== true).map(([key, value]) => `${key}=${String(value)}`).join(', ')}\n`);
  }
  process.stdout.write(
    `[impairment] ${artefact.verdict as string}: baseline intake p99 ${String(baseline?.sendToJournalledArrivalMs?.p99 ?? '-')} ms, `
    + `imposed intake p50 ${String(imposed?.sendToJournalledArrivalMs?.p50 ?? '-')} ms, `
    + `client-observed p50 baseline ${String(baseline?.sendToObservedResolutionMs.p50 ?? '-')} / imposed ${String(imposed?.sendToObservedResolutionMs.p50 ?? '-')} ms, `
    + `withheld ${String(loss?.withheldStampsNamed.length ?? 0)} (never consumed: ${String(loss?.withheldNeverConsumed ?? false)}, `
    + `later arrived: ${String(loss?.deliveriesAfterTheHoleConsumed ?? false)}), `
    + `stall caught up: ${String(stalled?.roomSide.allSentStampsConsumed ?? false)}\n`,
  );
  await Promise.race([server.close().catch(() => undefined), sleep(4_000)]);
  if (artefact.verdict !== 'pass') process.exitCode = 2;
}

await main();
// The pinned stack keeps sockets and timers reachable after main returns; the evidence is on disk.
process.exit(process.exitCode ?? 0);
