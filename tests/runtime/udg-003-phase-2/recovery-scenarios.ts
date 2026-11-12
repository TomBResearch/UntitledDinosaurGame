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
  type RegisteredHandler,
  type Seat,
} from '../../support/client-harness/transport.mjs';
import { RecoveryPolicy, type Delivery, type RecoveryEvent } from '../../support/client-harness/recovery.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

interface RegionRoomModule {
  RegionRoom: { liveRooms(): readonly { evidence(): Record<string, unknown> }[] };
  defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
}

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
    const seat = await withTimeout(connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'S1 create');
    const s1Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s1Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const s1Deliveries = wire(seat, s1Policy, s1Events);
    const s1Clock = startClock(s1Policy, s1Events);
    for (let i = 0; i < 5; i += 1) {
      stampAndSend(seat.handle, {
        sessionEpoch: 1,
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
    scenarios.push({
      name: 'same-delivery-pairing-on-the-wire',
      expectation: 'R-A: the acknowledgement and the disposition record arrive in one delivery and never disagree (ack <= resolvedThrough); a compliant stream produces no stall',
      observed: { deliveries: s1Deliveries.length, allPairsConsistent: consistent, events: s1Events.map((e) => e.event.type), state: s1Policy.snapshot().state },
      pass: consistent && s1Deliveries.length > 0 && s1Events.length === 0,
    });

    // ── S2 the 500 ms deadline runs with zero deliveries; a rejoin recovers through the record ──
    const s2Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s2Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const seat2 = await withTimeout(connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'S2 create');
    const s2DeliveriesRef = wire(seat2, s2Policy, s2Events);
    const s2Clock = startClock(s2Policy, s2Events);
    for (let i = 0; i < 3; i += 1) {
      stampAndSend(seat2.handle, {
        sessionEpoch: 1,
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
      },
      pass: stalled && stopSending && discarded && attempted && recovered
        && stallTriggerIsDeadline(stallEvent)
        // The deadline expired on or after lastDelivery + 500 ms; the 10 ms clock granularity is
        // the only tolerance, and it is named rather than hidden.
        && stallDelayFromLastDeliveryMs >= inputConfig.clientSnapshotDeadlineMs,
    });

    // ── S3 the 4000 ms episode deadline closes the client itself ────────────────────────────────
    const s3Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s3Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const seat3 = await withTimeout(connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'S3 create');
    wire(seat3, s3Policy, s3Events);
    const s3Clock = startClock(s3Policy, s3Events);
    stampAndSend(seat3.handle, {
      sessionEpoch: 1,
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
      },
      pass: episodeClosed
        && closeEvent !== undefined && closeEvent.event.type === 'client-close'
        && closeEvent.event.reason === 'episode-deadline'
        && closeEvent.event.code === inputConfig.closeCodes.INPUT_RECOVERY
        && episodeAgeMs >= inputConfig.clientRecoveryDeadlineMs,
    });

    // ── S4 the rolling allowance: two actual rejoins in 60 s, the third attempt is refused ───────
    const s4Events: { atMs: number; event: RecoveryEvent }[] = [];
    const s4Policy = new RecoveryPolicy(inputConfig, () => performance.now());
    const seat4 = await withTimeout(connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'S4 create');
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
      // A frame under the NEW epoch re-arms the delivery stream so the episode resolves.
      stampAndSend(workingSeat.handle, {
        sessionEpoch: (room.state.players.get(room.sessionId)?.sessionEpoch ?? 1),
        generation: 1,
        directIntent: { kind: 'continuous', drive: 1, strafing: 0, vertical: 0 },
        moveX: 0,
        moveZ: 1,
      });
      await until(() => s4Events.some((e) => e.event.type === 'recovered'), 4_000);
      return true;
    };
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
      },
      pass: first && second && refused && s4Closed
        && s4Close !== undefined && s4Close.event.type === 'client-close' && s4Close.event.reason === 'allowance-exhausted'
        && totalAttempts === inputConfig.rejoinWindowAllowance
        && s4Policy.snapshot().state === 'closed',
    });
  } finally {
    mkdirSync(OUT_DIR, { recursive: true });
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
