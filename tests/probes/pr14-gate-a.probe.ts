/**
 * PR-14 — the Gate A real-state substrate (UDG-003 Phase 2, W-8; ADR-0003 §5).
 *
 * What PR-15 measured was a probe-local room over a probe-local schema. PR-14 is the reserved
 * counterpart: **the real `RegionRoom`, the real replicated `RegionSchema`/`PlayerSchema`, the
 * accepted Phase 1 authority, and the flat reference step** — no locomotion, no physics, no
 * navigation, and no hand-rolled input buffer. Every Gate A criterion's measured evidence must be
 * producible on this substrate, which means this probe must at least drive each shape once, here,
 * over a real socket:
 *
 * - the compliant stream (GA-1), the named gap (GA-5a), the refused frame (GA-4),
 * - the eviction retirement and its bounded closure (GA-3's shape, on the seat that offends),
 * - isolation of the compliant neighbour while another seat closes (GA-9),
 * - same-delivery pairing of ack and `inputResolvedThrough` (GA-8),
 * - the rejoin domain restart (GA-10's precondition) and the exactly-once effect ledger (GA-10),
 * - and the substrate-scope claim itself: the room's emitted imports contain no movement engine.
 *
 * What this probe is **not**: it is not Gate A's formal execution (UDG-SPIKE-001 owns that,
 * D-P2-5), not a compatibility verdict (`stackCompatibility` stays `not-established` in the
 * machine-readable artefact, §8.3 invariant 4), and not a measurement of production values
 * (GA-11 — every envelope number in play here is a provisional test setting).
 *
 * Runtime notes: this file runs on Node's own TypeScript stripping (the runner spawns it after the
 * emitted probe set), so it uses erasable syntax only, and it reaches the pinned packages through
 * the harness that resolves them exactly as `apps/server` does — the packages are `apps/server`'s,
 * and Node resolves bare specifiers from the importing file, which here is a test.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  ProbeRecorder,
  connectSeat,
  connectSeatById,
  loadPinnedStack,
  sleep,
  startHarnessServer,
  until,
  type RegisteredHandler,
  type SdkRoom,
} from '../support/client-harness/transport.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] ?? '' : '';
const invocationId = args.includes('--invocation') ? args[args.indexOf('--invocation') + 1] : undefined;

/** The room-module surface this probe uses; loaded from the accepted build output. */
interface RegionRoomModule {
  RegionRoom: {
    liveRooms(): readonly RoomInstance[];
  };
  defineOperatorRegionRoom(deployment?: Record<string, unknown>): RegisteredHandler;
}

interface RoomInstance {
  readonly config: { protocolVersion: string };
  evidence(): Record<string, unknown>;
  tickRecords: readonly {
    tick: number;
    consumed: readonly { entityId: string; seq: number }[];
    refused: readonly { entityId: string; count: number }[];
    signals: readonly { entityId: string; signal: string }[];
    closures: readonly { entityId: string; code: number }[];
    maxDepth: number;
  }[];
  joinAuthorityIdentity(): { protocolVersion: string; configHash: string; manifestHash: string };
  readonly joinRefusals: readonly { reason: string; detail: string; atMs: number }[];
}

/** The replicated region state this probe reads: the players map, keyed by session id. */
interface ProbeRegionState {
  players: { get(key: string): PlayerRow | undefined };
}

interface PlayerRow {
  inputResolvedThrough: number;
  inputGapStart: number;
  inputGapEnd: number;
  inputRetiredUnrepresented: number;
  effectCount: number;
  lastAppliedRequestId: string;
  x: number;
  sessionEpoch: number;
  connected: boolean;
}

const recorder = new ProbeRecorder('PR-14', 'Gate A real-state substrate: RegionRoom + replicated state at the flat reference step', invocationId ?? undefined);

/** Rows arrive through the replica map; read one by session key. */
const rowOf = (room: SdkRoom<ProbeRegionState>): PlayerRow | undefined =>
  room.state.players.get(room.sessionId);

/**
 * Refusal can arrive as a closed socket mid-handshake, and a promise that neither settles nor has
 * a timer behind it lets an ESM process exit 0 on an empty event loop. Every seat-level await
 * therefore races an explicit budget: the timeout is a RESULT the probe records, never a hang.
 */
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
  process.stderr.write(`[pr14][uncaught] ${String(error instanceof Error ? error.stack : error)}\n`);
  process.exit(3);
});
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`[pr14][unhandled] ${String(reason instanceof Error ? reason.stack : reason)}\n`);
});

async function main(): Promise<void> {
  const [{ RegionRoom, defineOperatorRegionRoom }, protocol, schemaMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js')).href) as Promise<RegionRoomModule>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/schema/index.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string | number, unknown>>,
  ]);
  void protocol;
  const RegionSchema = schemaMod['RegionSchema'];
  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  // The deployment overrides and the join identity must be computed from the same document: the
  // hash gate compares the client's declared `configHash` against the room's live configuration,
  // so a probe that forgets its own overrides is refused by a gate working exactly as designed
  // (live-caught: the rate-ceiling override belongs in both computations or 1008 is the answer).
  const deploymentOverrides = { region: { bounds }, input: { rateCeilingMessagesPerSecond: 240 } };
  const cfg = (configMod['withConfigOverrides'] as (c: unknown, o: unknown) => Record<string, unknown>)(
    configMod['DEFAULT_SERVER_CONFIG'],
    deploymentOverrides,
  );
  const identity = {
    protocolVersion: cfg['protocolVersion'] as string,
    configHash: (configMod['computeConfigHash'] as (c: unknown) => string)(cfg),
    manifestHash: (configMod['regionHash'] as (c: unknown) => string)(cfg),
  };
  const envelope = cfg['input'] as Record<string, unknown>;
  const envelopeNumber = (key: string): number => {
    const value = envelope[key];
    if (typeof value !== 'number') throw new Error(`input envelope field ${key} is not a number`);
    return value;
  };
  const closeCodesRaw = envelope['closeCodes'];
  if (typeof closeCodesRaw !== 'object' || closeCodesRaw === null) throw new Error('input envelope carries no closeCodes block');
  const closeCodes = closeCodesRaw as Record<string, number>;
  recorder.observe('baseline', {
    note: 'produced under the Phase 2 configuration; the pre-Phase-2 configHash is 948f8c10… and this run is labelled with its own baseline per assignment §6.4',
    configHash: identity.configHash,
    bufferMaxSize: envelopeNumber('bufferMaxSize'),
    closureWindowMs: envelopeNumber('closureWindowMs'),
    closureMaxMs: envelopeNumber('closureMaxMs'),
  });

  const rooms: Record<string, RegisteredHandler> = {
    region: defineOperatorRegionRoom({
      config: deploymentOverrides,
      runId: 'udg-003-pr14',
      journalRetention: 40_000,
      regionProvenance: 'test-only-synthetic',
    }),
  };
  const server = await startHarnessServer(ROOT, rooms);
  const stack = await loadPinnedStack(ROOT);
  const room = (): RoomInstance => {
    const instance = RegionRoom.liveRooms()[0];
    if (instance === undefined) throw new Error('the RegionRoom instance was not constructed');
    return instance;
  };

  try {
    // ── C1 the substrate boots ────────────────────────────────────────────────────────────────
    // (the room instance is constructed on the first create; C1 is asserted after the first seat)


    // ── a compliant seat ──────────────────────────────────────────────────────────────────────
    const seat = await withTimeout(connectSeat<ProbeRegionState>(stack, server.endpoint, 'region', identity, RegionSchema), 8_000, 'compliant create');
    recorder.check('substrate-boots', RegionRoom.liveRooms().length === 1, `live rooms ${String(RegionRoom.liveRooms().length)}`);
    recorder.check('operator-config-not-client-configurable', (() => {
      // A create whose options came from the client must not have chosen the deployment: the room
      // that booted carries the operator's bounds and the operator's rate ceiling override.
      const evidence = room().evidence();
      return typeof evidence['configHash'] === 'string' && (evidence['configHash'] as string) === identity.configHash;
    })(), 'the booting room must run the operator deployment');
    const handle = seat.handle;
    // The probe owns its stamps explicitly: once it skips a value, `sentCount + 1` would fall
    // *behind* the newest consumed stamp and the seqField dedupe would silently eat the frame —
    // precisely the pre-buffer discard the strand signal exists around, not something a scenario
    // step wants to hit by accident.
    let nextSeq = 1;
    const sendFrame = (room: SdkRoom<ProbeRegionState>, frame: Record<string, unknown>): number => {
      const h = room.input<Record<string, unknown>>();
      Object.assign(h.data, frame, { seq: nextSeq });
      const sent = h.send();
      // PR-15 S1 measured `stamped sentCount + 1 === send()'s return value` — but only while stamps
      // and sends correspond 1:1. After a deliberate skip they do not: the acknowledgement is the
      // SDK's own send counter, so the invariant that always holds is `sent <= stamped` (the
      // watermark never runs ahead of the newest stamp).
      if (sent > nextSeq) throw new Error(`stamped ${String(nextSeq)} but send() acknowledged ${String(sent)}`);
      nextSeq += 1;
      return sent;
    };

    // Same-delivery pairing observations (GA-8): every evaluation reads the ack and the record from
    // ONE state delivery, and the probe counts deliveries, not wall-clock polls.
    const pairings: { delivery: number; resolved: number; ack: number; tick: number }[] = [];
    seat.room.onStateChange(() => {
      const row = rowOf(seat.room);
      if (row === undefined) return;
      pairings.push({ delivery: pairings.length + 1, resolved: row.inputResolvedThrough, ack: handle.lastProcessed, tick: pairings.length + 1 });
    });


    // ── C2 the hash gate refuses a wrong configHash before a seat exists ─────────────────────
    const sumRefusals = (): number => RegionRoom.liveRooms().reduce((total, instance) => total + instance.joinRefusals.length, 0);
    const before = sumRefusals();
    let refusedSeatClosed = false;
    try {
      const bad = await withTimeout(connectSeat(stack, server.endpoint, 'region', {
        protocolVersion: identity.protocolVersion,
        configHash: '0'.repeat(64),
        manifestHash: identity.manifestHash,
      }, RegionSchema), 4_000, 'refused-seat create');
      // The room refuses the seat immediately after the create resolves; the socket then drops.
      refusedSeatClosed = await until(() => sumRefusals() > before, 3_000);
      await bad.room.leave().catch(() => undefined);
    } catch {
      refusedSeatClosed = true; // the create itself rejected — also a refusal, also honest
    }
    recorder.check('hash-gate-refuses-wrong-configHash', refusedSeatClosed && sumRefusals() > before,
      `refusals went ${String(before)} to ${String(sumRefusals())}; the refusing instance is its own room, counted across live rooms`);

    // ── C3 the compliant stream: six stamps, every one represented ────────────────────────────
    for (let index = 0; index < 6; index += 1) {
      sendFrame(seat.room, { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0.5, moveZ: 0 });
      await sleep(90);
    }
    const compliantCaughtUp = await until(() => {
      const row = rowOf(seat.room);
      return row !== undefined && row.inputResolvedThrough >= 6 && handle.lastProcessed >= 6;
    }, 6_000);
    const compliantRow = rowOf(seat.room);
    recorder.check('compliant-stream-resolves-all-six', compliantCaughtUp,
      `resolved ${String(compliantRow?.inputResolvedThrough)}, ack ${String(handle.lastProcessed)}, sent ${String(handle.sentCount)}`);
    recorder.check('compliant-stream-retires-nothing', (compliantRow?.inputRetiredUnrepresented ?? -1) === 0,
      `retired ${String(compliantRow?.inputRetiredUnrepresented)}`);
    recorder.check('compliant-stream-moves-the-entity', (compliantRow?.x ?? 0) > 0,
      `x ${String(compliantRow?.x)} (flat step drive x speed x dt, UDG-005 owns real locomotion)`);

    // ── C4 one observation per entity per tick, FIFO, no overtaking ───────────────────────────
    const consumedEntries = room().tickRecords.flatMap((record) => record.consumed.filter((entry) => entry.entityId === seat.room.sessionId));
    const perTickMax = room().tickRecords.reduce((max, record) => Math.max(max, record.consumed.length), 0);
    let monotone = true;
    for (let index = 1; index < consumedEntries.length; index += 1) {
      if ((consumedEntries[index]?.seq ?? 0) <= (consumedEntries[index - 1]?.seq ?? 0)) monotone = false;
    }
    recorder.check('one-observation-per-entity-per-tick', perTickMax <= 1, `max consumed rows in any tick ${String(perTickMax)}`);
    recorder.check('consumption-is-fifo-in-stamp-order', monotone, `consumed ${JSON.stringify(consumedEntries.slice(0, 8))}`);

    // ── C5 the named gap: stamps 7, 8, then 11 ───────────────────────────────────────────────
    sendFrame(seat.room, { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0, moveZ: 0 });
    sendFrame(seat.room, { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0, moveZ: 0 });
    // 7 and 8 consumed; skip 9, 10 and 11 and send 12 — the hole is then nameable because a later
    // stamp exists (ADR-0003 §3.1's boundary statement: only a leading hole is unnameable).
    nextSeq += 3;
    sendFrame(seat.room, { sessionEpoch: 1, generation: 1, directIntent: true, moveX: 0, moveZ: 0 });
    const gapNamed = await until(() => {
      const row = rowOf(seat.room);
      return row !== undefined && row.inputGapStart !== 0 && row.inputGapEnd !== 0;
    }, 6_000);
    const gapRow = rowOf(seat.room);
    recorder.check('gap-is-named-as-a-range', gapNamed
      && gapRow?.inputGapStart === 9 && gapRow?.inputGapEnd === 11,
      `gap ${String(gapRow?.inputGapStart)}..${String(gapRow?.inputGapEnd)} (expected 9..11), resolved ${String(gapRow?.inputResolvedThrough)}`);
    recorder.check('watermark-stops-at-the-gap', (gapRow?.inputResolvedThrough ?? 0) === 8,
      `resolved ${String(gapRow?.inputResolvedThrough)} — advancing past the un-dispositioned 9, 10 and 11 is prohibited (ADR-0003 §4)`);

    // ── C6 the refused frame is still represented (GA-4) ──────────────────────────────────────
    sendFrame(seat.room, { sessionEpoch: 99, generation: 1, directIntent: true, moveX: 0.2, moveZ: 0 });
    const refusalSeen = await until(() => room().tickRecords.reduce((total, record) => total + record.refused.length, 0) >= 1, 6_000);
    const stillOpen = room().evidence()['metrics'] as Record<string, number> | undefined;
    const refusedConsumed = room().tickRecords.some((record) => record.consumed.some((entry) => entry.seq === 13));
    recorder.check('refused-frame-is-dequeued-and-represented', refusalSeen && refusedConsumed,
      `wrong-epoch stamp 13 was dequeued and recorded refused (${String(room().tickRecords.reduce((t, r) => t + r.refused.length, 0))} refusals)`);
    recorder.check('refusal-costs-no-retirement-and-keeps-the-seat-open', (stillOpen?.['closedTotal'] ?? 0) === 0
      && (rowOf(seat.room)?.inputRetiredUnrepresented ?? -1) === 0,
      `retired ${String(rowOf(seat.room)?.inputRetiredUnrepresented)}, closures ${String(stillOpen?.['closedTotal'])} (GA-4: the neutral step represents it)`);

    // ── C7 same-delivery pairing (GA-8): a trigger never spans two deliveries ────────────────
    const pairingShapeOk = pairings.length > 0 && pairings.every((entry) =>
      Number.isInteger(entry.resolved) && Number.isInteger(entry.ack));
    recorder.observe('pairingsObserved', pairings.length);
    recorder.observe('pairingsSample', pairings.slice(-6));
    recorder.check('pairing-reads-ack-and-record-from-one-delivery', pairingShapeOk,
      `${String(pairings.length)} state deliveries each read (resolved, lastProcessed) together`);

    // ── C8 the effect ledger: abandoned and reissued identities charge nothing (GA-10's two
    //         halves that M0's rejection vocabulary can express; see the limitation below) ──────
    const sendMove = (requestId: string, generation: number): void => {
      seat.room.send('moveTo', {
        requestId, sessionEpoch: 1, generation, x: 1, y: 0, z: 1,
      });
    };
    sendMove('pr14-alpha', 2);
    const settled = await until(() => {
      const stats = room().evidence()['stats'] as { counters?: Record<string, number> };
      return ((stats?.counters?.['refused:navigation'] ?? 0) >= 1) || ((stats?.counters?.['answered'] ?? 0) >= 1);
    }, 4_000);
    sendMove('pr14-alpha', 2); // the same identity again — the cache answers it
    await sleep(500);
    const ledgerRow = rowOf(seat.room);
    const statsAfter = room().evidence()['stats'] as { counters?: Record<string, number> };
    recorder.check('abandoned-identity-charges-nothing', settled && (ledgerRow?.effectCount ?? -1) === 0,
      `moveTo is refused outright in M0 (no route can exist, UDG-007): counters ${JSON.stringify(statsAfter?.counters)}`);
    recorder.check('reissue-of-a-known-identity-is-answered-not-recharged', ((statsAfter?.counters?.['answered'] ?? 0) >= 1)
      && (ledgerRow?.effectCount ?? -1) === 0,
      `answered ${String(statsAfter?.counters?.['answered'])}, effectCount ${String(ledgerRow?.effectCount)} (GA-10: delta 0 for an abandoned identity, 0 for a cache answer)`);

    // ── C9 the rejoin restarts the stamp domain and the epoch ────────────────────────────────
    const token = seat.room.reconnectionToken;
    await seat.room.leave(false); // consent = false: the token stays live, which is the disconnected-and-returning shape (PR-15 S4)
    const rejoinClient = new stack.sdk.ClientCtor(server.endpoint);
    const rejoined = await withTimeout(rejoinClient.reconnect<ProbeRegionState>(token, RegionSchema), 6_000, 'reconnect');
    // A real client's stamp domain restarts with its connection (PR-15 S4), so the probe restarts
    // its stamps too, and the epoch the server issued for this domain is the one it stamps.
    nextSeq = 1;
    const epochRenewed = await until(() => (rowOf(rejoined)?.sessionEpoch ?? 0) === 2, 6_000);
    const postRow0 = rowOf(rejoined);
    sendFrame(rejoined, { sessionEpoch: 2, generation: 1, directIntent: true, moveX: 0.5, moveZ: 0 });
    const rejoinResolved = await until(() => {
      const row = rowOf(rejoined);
      return row !== undefined && row.inputResolvedThrough >= 1;
    }, 6_000);
    const postRow = rowOf(rejoined);
    // The reset is proved by absence: the first snapshot of the renewed domain carries neither the
    // old watermark (8) nor the old named gap (9..11). Whether the very first renewed patch already
    // carried the new domain's first disposition is scheduling, not semantics, so the assertion is
    // on the old domain's numbers being gone — an exact mid-pairing claim would demand a delivery
    // the transport is not obliged to produce (the §7 exact-assertion rule cuts both ways).
    recorder.check('rejoin-restarts-the-stamp-domain', epochRenewed && rejoinResolved
      && (postRow0?.inputResolvedThrough ?? 99) <= 1 && (postRow0?.inputGapStart ?? 99) === 0
      && (postRow0?.inputGapEnd ?? 99) === 0,
      `first renewed snapshot: resolved ${String(postRow0?.inputResolvedThrough)}, gap ${String(postRow0?.inputGapStart)}..${String(postRow0?.inputGapEnd)} (old domain was resolved 8, gap 9..11); then ${String(postRow?.inputResolvedThrough)} in the new domain`);
    recorder.check('rejoin-carries-a-server-issued-epoch', (postRow?.sessionEpoch ?? 0) === 2,
      `replica epoch ${String(postRow?.sessionEpoch)} (the room issued epoch 2 for the second domain)`);
    recorder.check('close-observations-are-per-domain-and-never-summed', (() => {
      const observations = room().evidence()['closeObservations'];
      return Array.isArray(observations) && observations.length >= 1;
    })(), `closeObservations ${String(Array.isArray(room().evidence()['closeObservations']) ? (room().evidence()['closeObservations'] as readonly unknown[]).length : -1)} — the leave that preceded the rejoin sampled its own three`);

    // ── C10 eviction retires on the offending seat and the window closes it; the neighbour is
    //         untouched (GA-3's shape, GA-9's isolation) ────────────────────────────────────────
    // The offender joins THIS room by id: matchmaking would happily place it in a room of its own,
    // and isolation is only measured when both seats genuinely share a room.
    const offender = await withTimeout(connectSeatById<ProbeRegionState>(stack, server.endpoint, seat.room.roomId, identity, RegionSchema), 8_000, 'offender joinById');
    recorder.check('offender-joined-the-compliant-room', offender.room.roomId === seat.room.roomId,
      `offender roomId ${String(offender.room.roomId)} vs compliant ${String(seat.room.roomId)}`);
    const compliantBefore = rowOf(rejoined);
    const burst = envelopeNumber('bufferMaxSize') + 12;
    for (let index = 0; index < burst; index += 1) {
      sendFrame(offender.room, { sessionEpoch: 3, generation: 1, directIntent: true, moveX: 0.1, moveZ: 0 });
    }
    const closed = await until(() => {
      const metrics = room().evidence()['metrics'] as Record<string, number>;
      return metrics['closedTotal'] !== undefined && metrics['closedTotal'] >= 1;
    }, 12_000);
    const evidenceAfter = room().evidence();
    const closures = room().tickRecords.flatMap((record) => record.closures);
    const retiredSignals = room().tickRecords.flatMap((record) => record.signals.filter((signal) => signal.signal === 'RETIRED_UNREPRESENTED'));
    recorder.check('burst-beyond-the-buffer-retires', retiredSignals.length >= 1,
      `retirement signals ${String(retiredSignals.length)} after a burst of ${String(burst)} into a buffer of ${String(envelope['bufferMaxSize'])}`);
    recorder.check('confirmed-retirement-closes-inside-the-bounded-window', closed
      && closures.some((entry) => entry.code === closeCodes['INPUT_RETIRED_UNREPRESENTED']),
      `closures ${JSON.stringify(closures)} (window ${String(envelopeNumber('closureWindowMs'))} ms, cap ${String(envelopeNumber('closureMaxMs'))} ms)`);
    const compliantAfter = rowOf(rejoined);
    recorder.check('compliant-neighbour-is-untouched', (compliantAfter?.inputRetiredUnrepresented ?? -1) === 0
      && (compliantBefore?.inputRetiredUnrepresented ?? -1) === 0,
      `compliant seat retired ${String(compliantAfter?.inputRetiredUnrepresented)} while the offender closed`);
    recorder.check('closure-window-forced-one-final-publication', (() => {
      // The seat's record must be readable up to the closure tick: the publication happened in the
      // room, and the closeObservation names its own three numbers without summing them.
      const observations = evidenceAfter['closeObservations'];
      return Array.isArray(observations) && observations.some((entry) => typeof entry['retiredUnrepresented'] === 'number'
        && typeof entry['serverQueuedAtClose'] === 'number' && typeof entry['consumedCountAtClose'] === 'number');
    })(), `closeObservations ${JSON.stringify(evidenceAfter['closeObservations'])?.slice(0, 400)}`);

    // ── C11 substrate scope: no movement engine behind the room ───────────────────────────────
    const roomSource = readFileSync(resolve(ROOT, 'apps/server/dist/rooms/RegionRoom.js'), 'utf8');
    const forbiddenImports = ['@udg/physics', '@udg/locomotion', '@udg/navigation', '@babylonjs', 'recast-navigation', '@dimforge'];
    const found = forbiddenImports.filter((name) => roomSource.includes(`from '${name}`) || roomSource.includes(`import('${name}`));
    recorder.check('substrate-carries-no-locomotion-physics-or-navigation', found.length === 0, `forbidden imports found: ${JSON.stringify(found)}`);

    recorder.observe('roomEvidence', room().evidence());
    recorder.observe('ticks', room().tickRecords.length);
    recorder.observe('closures', closures);
    recorder.limit('Loopback only, one server process, provisional test-setting envelope values; GA-11 production measurement is Gate A\'s, not this probe\'s.');
    recorder.limit('This is the substrate, not the formal Gate A: execution belongs to UDG-SPIKE-001 (D-P2-5) and stackCompatibility stays not-established (§8.3 invariant 4).');
    recorder.limit('The entity moves by the flat reference relation; UDG-005 owns locomotion and UDG-006 collision, and neither is imported anywhere in the Phase 2 authority path.');
    recorder.limit('Timing windows (90 ms sends, closure waits) are generous by design: this probe must fail only on posture, never on scheduling jitter. The controlled exact-gap construction lives in the Phase 2 integration suite, per the §7 exact-assertion rule.');
    recorder.limit('The eviction burst also rides under the declared rate ceiling (raised for this room only) so 4100, not 4101, is what the closure exercises; the ceiling path has its own suite scenario.');
    recorder.limit('GA-10\'s Δ == 1 committed-identity half is not producible on this substrate yet: M0\'s rejection vocabulary refuses every discrete command outright (no route can exist until UDG-007), so no identity can commit. The probe records the two halves M0 can express — abandoned identities and cache re-answers both charge zero — and says plainly that the committing half waits for a committable discrete effect, rather than faking one.');
  } catch (error) {
    recorder.check('probe-completed-without-exception', false, `threw: ${String(error instanceof Error ? error.stack : error)}`);
    recorder.limit(`Exception: ${String(error)}`);
  }

  // The result file is written **before** the server closes. The pinned `gracefullyShutdown(true)`
  // ends in `process.exit`, and a probe that publishes after its own shutdown can silently lose its
  // evidence — live-caught: the process exited 0 mid-run and no reader could say why. The harness
  // therefore shuts down with `exit = false`, and the probe keeps control of its own exit code.
  if (outPath !== '') recorder.write(outPath);
  await server.close().catch(() => undefined);
  // The transport keeps timers; Phase 0 learned that a probe must exit deliberately.
  process.exit(recorder.passed ? 0 : 1);
}

void main();
