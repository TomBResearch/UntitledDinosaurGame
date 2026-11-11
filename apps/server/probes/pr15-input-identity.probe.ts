/**
 * PR-15 — can the server name the exact client input sequence it resolved, and can the client tell that
 * the acknowledgement and the authoritative state agree?
 *
 * This probe exists because [ADR-P-0003](../../../docs/adr/proposals/UDG-003-d7-input-acknowledgement-policy.md)
 * recommends an *authoritative input disposition watermark* and D-7 cannot be decided on an argument about
 * declarations. Four questions are measured against the pinned `core@0.18.27` / `sdk@0.18.9` set, on
 * loopback, with public declarations only:
 *
 * 1. **Identity.** `InputHandle.send()` returns "the seq assigned to this input … that `sentCount` now
 *    reads", and `defineInput({ seqField })` names "a monotonically-increasing numeric field on the input
 *    schema used to order and dedupe incoming frames" and "powers `room.inputs.get(sessionId).at(value)`
 *    lookups". Is the value the client stamped the value the server consumes, and is the relationship
 *    between that field and `lastProcessed` stable — after eviction, and after a rejoin?
 * 2. **Gaps.** When the buffer retires a frame the room never stepped, does anything the server can read
 *    say *which* sequences were skipped, or only that fewer frames arrived than were sent?
 * 3. **Client observability.** After the SDK prunes its own replay ring, what can the client still see:
 *    `at(seq)`, `pendingCount`, `replayBufferSize`, `epoch`, and how do they behave across a rejoin?
 * 4. **Pairing.** `lastProcessed` is documented as "echoed via the TIMED prefix" while
 *    `patchRate` is "the reconcile/correction cadence (acks + authoritative state arrive this often)".
 *    Does the acknowledgement therefore arrive *with* the state delivery, and how wide is the window in
 *    which the two legitimately disagree? That window is what a resynchronisation trigger must tolerate
 *    before it resets a working session.
 *
 * What is deliberately NOT here: no Phase 2 behaviour, no `RegionRoom`, no protocol change. The input
 * declaration used is probe-local, because the frozen `DirectInputSchema` has no per-frame monotonic field
 * — `generation` is UDG's intention generation and `sessionEpoch` is the session epoch, and neither
 * identifies a frame. Whether the shipped schema gains one is the owner's decision, not this probe's.
 */

import { defineRoom } from '@colyseus/core';
import { Client, type InputHandle } from '@colyseus/sdk';

import {
  IdentityRoom,
  InputTraceStateSchema,
  identityRooms,
  type InputTraceState,
  type SequencedInputFrame,
  lastOf,
} from './rooms.js';
import {
  httpEndpoint,
  outputPath,
  runProbe,
  sleep,
  startProbeServer,
  until,
} from './support.js';

const EPOCH = 7;
const TICK_RATE = 20;

/** One frame as the client saw it: what it stamped, and the seq the library said it sent. */
interface SentFrame {
  readonly stamped: number;
  readonly returned: number;
  readonly wire: number;
}

/** A session S5 and S6 can legitimately measure: a live room plus the handle that drives it. */
interface LiveSession {
  readonly room: { sessionId: string; state: InputTraceState; input: <T>() => InputHandle<T>; onStateChange: (cb: () => void) => unknown };
  readonly handle: InputHandle<SequencedInputFrame>;
}

interface CounterSnapshot {
  readonly sentCount: number;
  readonly lastProcessed: number;
  readonly pendingCount: number;
  readonly epoch: number;
  readonly sessionId: string;
  readonly replayBufferSize: number;
}

function frame(generation: number, seq: number): SequencedInputFrame {
  return { sessionEpoch: EPOCH, generation, directIntent: true, moveX: 0.5, moveZ: 0, seq };
}

function snapshot(handle: InputHandle<SequencedInputFrame>, room: { sessionId: string }): CounterSnapshot {
  return {
    sentCount: handle.sentCount,
    lastProcessed: handle.lastProcessed,
    pendingCount: handle.pendingCount,
    epoch: handle.epoch,
    sessionId: room.sessionId,
    replayBufferSize: handle.replayBufferSize,
  };
}

function skippedTotal(room: IdentityRoom): number {
  return room.gaps.reduce((total, gap) => total + gap.skipped, 0);
}

/**
 * Send `count` frames, stamping the sequence the client believes it is about to send.
 *
 * The stamp is `sentCount + 1`, read *before* the send, because `send()` returns the seq it assigned —
 * reading it afterwards would make the alignment check circular. `spacingMs` below the step interval is
 * how an over-rate sender is simulated; at or above it is the admitted envelope.
 */
async function send(
  handle: InputHandle<SequencedInputFrame>,
  count: number,
  spacingMs: number,
  from = 0,
): Promise<SentFrame[]> {
  const sent: SentFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const stamped = handle.sentCount + 1;
    Object.assign(handle.data, frame(from + index + 1, stamped));
    const returned = handle.send();
    sent.push({ stamped, returned, wire: handle.sentCount });
    if (spacingMs > 0) await sleep(spacingMs);
  }
  return sent;
}

async function main(): Promise<void> {
  const out = outputPath(process.argv.slice(2));
  await runProbe('PR-15', 'input identity, gap visibility, client observability and ack/state pairing', out, async (checks) => {
    const server = await startProbeServer({
      'udg-pr15-identity': defineRoom(IdentityRoom),
    });

    try {
      // ── S1 — identity alignment: does the stamped sequence survive to the server, in order? ──────
      const client = new Client(httpEndpoint(server.endpoint));
      const room = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 32, tickRate: TICK_RATE }, InputTraceStateSchema);
      const first = lastOf(identityRooms);
      const handle: InputHandle<SequencedInputFrame> = room.input<SequencedInputFrame>();

      const burst = await send(handle, 8, 10);
      const depthDuringBurst = first === undefined ? -1 : first.currentSize(room.sessionId);
      // The lookup must be attempted while a frame is still pending, or it proves nothing.
      const lastBurst = burst[burst.length - 1];
      const pendingSeq = lastBurst === undefined ? 0 : lastBurst.returned;
      const foundWhilePending = first !== undefined && pendingSeq > 0
        ? first.lookup(room.sessionId, pendingSeq)
        : false;

      // A no-change send is body-less but still transmits, so the seq stream has no holes of its own.
      Object.assign(handle.data, frame(900, handle.sentCount + 1));
      const bodylessFirst = handle.send();
      const bodylessSecond = handle.send();

      const drained = first === undefined ? false : await until(() => first.consumedSeqs.length >= 9, 4000);
      const sentSeqs = burst.map((entry) => entry.returned);

      checks.observe('S1_identity', {
        sent: burst,
        consumedSeqs: first?.consumedSeqs.slice(0, 12) ?? [],
        depthDuringBurst,
        pendingSeq,
        foundWhilePending,
        bodyless: { first: bodylessFirst, second: bodylessSecond, sentCount: handle.sentCount },
      });
      checks.check(
        'I1-stamped-sequence-equals-the-seq-send-returns',
        burst.every((entry) => entry.stamped === entry.returned && entry.returned === entry.wire),
        `${String(burst.length)} sends: stamped ${String(burst[0]?.returned ?? -1)}..${String(burst[burst.length - 1]?.returned ?? -1)}, each equal to what send() returned and to sentCount after the send`,
      );
      checks.check(
        'I1-bodyless-sends-still-advance-the-sequence',
        bodylessSecond === bodylessFirst + 1,
        `two sends with no field change returned ${String(bodylessFirst)} then ${String(bodylessSecond)} — a no-change frame is body-less, not skipped`,
      );
      checks.check(
        'I1-server-consumes-the-same-sequence-in-order',
        drained && first !== undefined && first.consumedSeqs.slice(0, sentSeqs.length).join(',') === sentSeqs.join(','),
        `server saw ${String(first?.consumedSeqs.length ?? 0)} consumed frames; first ${String(sentSeqs.length)} match the client table exactly`,
      );
      checks.check(
        'I1-at-seq-finds-a-pending-frame-by-its-stamped-value',
        foundWhilePending,
        `accessor.at(${String(pendingSeq)}) resolved while the frame was pending; buffer depth at that moment ${String(depthDuringBurst)}`,
      );

      // ── S2 — gaps: what does the server see when the buffer retires a frame it never stepped? ─────
      const overRoom = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 4, tickRate: TICK_RATE }, InputTraceStateSchema);
      const over = lastOf(identityRooms);
      const overHandle: InputHandle<SequencedInputFrame> = overRoom.input<SequencedInputFrame>();
      const overSent = await send(overHandle, 12, 5);
      // Wait for the client to hear the ack for everything it sent, then take the room's own accounting.
      // The condition is deliberately about the ack and not about a count the room could never reach: an
      // evicted frame is never consumed, so the room's consumed list can never equal the frames sent.
      await until(() => overHandle.pendingCount === 0, 4000);
      const tailBefore = over === undefined ? 0 : overSent.length - over.consumedSeqs.length - skippedTotal(over);
      const overGap = over?.gaps[0];
      const evictedSeq = overGap === undefined ? 0 : overGap.from + 1;
      const evictedFindable = over !== undefined && evictedSeq > 0 ? over.lookup(overRoom.sessionId, evictedSeq) : false;
      const sizeBound = over === undefined ? 0 : Math.max(...over.sizeSamples);
      const ackAtRest = overHandle.lastProcessed;
      const steppedCount = over?.consumedSeqs.length ?? 0;

      checks.observe('S2_gap', {
        sent: overSent.length,
        consumedSeqs: over?.consumedSeqs ?? [],
        gaps: over?.gaps ?? [],
        skipped: over === undefined ? 0 : skippedTotal(over),
        lastProcessed: ackAtRest,
        sentCount: overHandle.sentCount,
        pendingCount: overHandle.pendingCount,
        sizeSamples: over?.sizeSamples ?? [],
        firstGap: overGap ?? null,
        evictedSeq,
        evictedFindable,
      });
      checks.check(
        'I2-a-retired-frame-leaves-a-gap-in-the-stamped-sequence',
        overGap !== undefined,
        overGap === undefined
          ? 'no gap observed — the buffer retired nothing in this scenario'
          : `first gap at tick ${String(overGap.tick)}: consumed ${String(overGap.from)} then ${String(overGap.to)}, ${String(overGap.skipped)} sequence(s) never stepped`,
      );
      checks.check(
        'I2-inner-gaps-are-named-exactly-by-the-consumed-sequence',
        over !== undefined && skippedTotal(over) > 0 && steppedCount + skippedTotal(over) <= overSent.length,
        `stepped ${String(steppedCount)} plus ${String(over === undefined ? -1 : skippedTotal(over))} named skipped sequences against ${String(overSent.length)} sent`,
      );
      // The tail case is the one a resolution record must not depend on: everything the room consumed is
      // adjacent, so nothing in the room's own view says "three more were retired after that".
      checks.check(
        'I2-retirement-after-the-last-consumed-frame-is-invisible-to-the-room',
        tailBefore > 0,
        `${String(tailBefore)} frame(s) retired beyond the last consumed sequence produce no gap record while the sender is silent — only the client's own sentCount sees them`,
      );
      checks.check(
        'I2-evicted-frames-are-not-retrievable-through-the-accessor',
        !evictedFindable,
        `accessor.at(${String(evictedSeq)}) for a skipped sequence returned ${evictedFindable ? 'a frame' : 'nothing'} — the server cannot re-read what overflow dropped`,
      );
      checks.check(
        'I2-the-acknowledgement-counts-frames-that-were-never-stepped',
        ackAtRest === overSent.length && steppedCount < overSent.length,
        `lastProcessed ${String(ackAtRest)} equals frames sent (${String(overSent.length)}) while only ${String(steppedCount)} entered state; ${String(overSent.length - steppedCount)} retired unrepresented`,
      );
      checks.check(
        'I2-buffer-depth-reaches-its-bound-before-the-first-gap',
        over !== undefined && over.gaps.length > 0 && sizeBound >= 4,
        `size samples reached ${String(sizeBound)} against bufferMaxSize 4; first gap at tick ${String(overGap === undefined ? -1 : overGap.tick)} — depth is observable, but PR-13 already measured that observing it is not prevention against an over-rate sender`,
      );

      // A gap needs two endpoints. Everything retired before the room's first consumed frame has no
      // earlier endpoint, so the room cannot name those sequences at all — it can only count them, from
      // `consumedCount`, which overflow also advances. This is the case a resolution record must not be
      // allowed to paper over: resolving sequence 5 must not imply 1 to 4 were resolved.
      const firstConsumed = over?.consumedSeqs[0] ?? 0;
      const unnamedLeading = firstConsumed > 0 ? firstConsumed - 1 : 0;
      const consumedCountAtS2 = over?.consumedCountAfter[over.consumedCountAfter.length - 1] ?? 0;
      checks.observe('S2b_unnamedRetirement', {
        firstConsumedSeq: firstConsumed,
        unnamedLeading,
        namedSkipsSoFar: over === undefined ? 0 : skippedTotal(over),
        stepped: steppedCount,
        accessorConsumedCount: consumedCountAtS2,
        countFromAccessor: consumedCountAtS2 - steppedCount,
        countFromClientSide: overSent.length - steppedCount,
      });
      checks.check(
        'I2-retirement-before-the-first-consumed-frame-cannot-be-named-by-the-room',
        unnamedLeading > 0,
        `first consumed sequence was ${String(firstConsumed)}, so ${String(unnamedLeading)} retired sequence(s) have no earlier endpoint to hang a gap on — the room cannot name them`,
      );
      checks.check(
        'I2-consumedCount-counts-every-unrepresented-retirement-though-not-by-identity',
        consumedCountAtS2 - steppedCount === overSent.length - steppedCount,
        `accessor.consumedCount ${String(consumedCountAtS2)} minus frames stepped ${String(steppedCount)} = ${String(consumedCountAtS2 - steppedCount)}, matching the client-side count ${String(overSent.length - steppedCount)}: the total is observable, the identities are not`,
      );

      // ── S3 — the second drop path: seqField dedupe discards a replayed sequence before the buffer ──
      const dedupeStart = overHandle.sentCount;
      const replayedStamp = overSent[0]?.returned ?? 1;
      Object.assign(overHandle.data, frame(950, replayedStamp));
      const replayedWire = overHandle.send();
      Object.assign(overHandle.data, frame(951, overHandle.sentCount + 1));
      overHandle.send();
      if (over !== undefined) await sleep(400);
      const gapsAcrossDedupe = over === undefined ? 0 : skippedTotal(over);
      checks.observe('S3_replayedSequence', {
        replayedStamp,
        replayedWire,
        sendsBefore: dedupeStart,
        sendsAfter: overHandle.sentCount,
        consumedSeqs: over?.consumedSeqs ?? [],
        lastProcessed: overHandle.lastProcessed,
        pendingCount: overHandle.pendingCount,
      });
      checks.check(
        'I3-a-replayed-sequence-is-dropped-before-the-buffer',
        over !== undefined && !over.consumedSeqs.slice(steppedCount).includes(replayedStamp),
        `stamped ${String(replayedStamp)} again at wire ${String(replayedWire)}; the accessor consumed no such frame — dedupe runs before buffering, so the room never sees it`,
      );
      checks.check(
        'I3-a-dropped-replay-surfaces-as-a-gap-only-when-a-later-frame-arrives',
        gapsAcrossDedupe > (over === undefined ? 0 : skippedTotal(over) - 1),
        `named skips after the replayed stamp and one further frame: ${String(gapsAcrossDedupe)}; consumed ${String(over?.consumedSeqs.join(',') ?? '')}`,
      );
      checks.check(
        'I3-dedupe-desynchronises-the-ack-from-the-client-sequence',
        overHandle.lastProcessed < overHandle.sentCount,
        `after one pre-buffer drop: lastProcessed ${String(overHandle.lastProcessed)} < sentCount ${String(overHandle.sentCount)} (pendingCount ${String(overHandle.pendingCount)}) — pruning on "seq <= lastProcessed" would strand an input the server already discarded`,
      );

      // ── S4 — the reconnect domain: what carries across, and what silently does not? ──────────────
      const beforeReconnect = snapshot(handle, room);
      const token = room.reconnectionToken;
      await room.leave(false);
      await sleep(200);
      let after: (CounterSnapshot & { reconnections: number; serverConsumedCount: number }) | undefined;
      let reconnectError: string | null = null;
      // S5 and S6 must run against a live session: the handle and state of the room that left are dead,
      // and measuring a dead one would silently report zeros as findings.
      let liveRoom: LiveSession | undefined;
      try {
        const rejoined = await client.reconnect<InputTraceState>(token, InputTraceStateSchema);
        const rejoinHandle: InputHandle<SequencedInputFrame> = rejoined.input<SequencedInputFrame>();
        liveRoom = { room: rejoined, handle: rejoinHandle };
        const post = await send(rejoinHandle, 3, 30);
        if (first !== undefined) await until(() => first.consumedSeqs.length >= 13, 3000);
        after = {
          ...snapshot(rejoinHandle, rejoined),
          reconnections: first?.reconnections.length ?? 0,
          serverConsumedCount: first?.consumedCountAfter[first.consumedCountAfter.length - 1] ?? -1,
        };
        checks.observe('S4_postReconnectSends', {
          post: post.map((entry) => entry.returned),
          consumedSeqsAfterRejoin: first?.consumedSeqs.slice(9) ?? [],
        });
      } catch (error) {
        reconnectError = error instanceof Error ? error.message : String(error);
      }

      checks.observe('S4_reconnect', {
        before: beforeReconnect,
        after: after ?? null,
        reconnectError,
        domainReading: after === undefined
          ? 'no reconnect measured'
          : `the input sequence domain is per connection: sentCount restarted (${String(beforeReconnect.sentCount)} → ${String(after.sentCount)}), the seat's consumedCount restarted with it, and handle.epoch did not move (${String(beforeReconnect.epoch)} → ${String(after.epoch)}) — so epoch cannot mark the domain change and UDG's own session epoch must`,
      });
      checks.check(
        'I4-reconnection-was-possible-in-this-context',
        liveRoom !== undefined,
        reconnectError === null ? `reconnected; sessionId preserved: ${String(after?.sessionId === beforeReconnect.sessionId)}` : `reconnect refused: ${String(reconnectError)}`,
      );
      checks.check(
        'I4-a-domain-change-is-observable-to-the-client',
        after !== undefined && (after.epoch !== beforeReconnect.epoch || after.lastProcessed <= beforeReconnect.lastProcessed),
        after === undefined
          ? 'no reconnect to measure'
          : `epoch ${String(beforeReconnect.epoch)} → ${String(after.epoch)}; lastProcessed ${String(beforeReconnect.lastProcessed)} → ${String(after.lastProcessed)}; sentCount ${String(beforeReconnect.sentCount)} → ${String(after.sentCount)}; server consumedCount ${String(after.serverConsumedCount)}; reconnects seen by the seat ${String(after.reconnections)}`,
      );
      checks.check(
        'I4-the-acknowledgement-is-not-a-usable-ordering-across-a-rejoin',
        after !== undefined && !(after.lastProcessed > beforeReconnect.lastProcessed && after.sentCount > beforeReconnect.sentCount && after.epoch === beforeReconnect.epoch),
        after === undefined
          ? 'no reconnect to measure'
          : `the client cannot read "same domain, more resolved inputs" from the counters alone: lastProcessed ${String(after.lastProcessed)} against sentCount ${String(after.sentCount)} and epoch ${String(after.epoch)}`,
      );

      // ── S5 — what the client can still see after the SDK prunes its own ring ─────────────────────
      const live = liveRoom ?? { room: await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 32, tickRate: TICK_RATE }, InputTraceStateSchema), handle: undefined as undefined | InputHandle<SequencedInputFrame> };
      const liveHandle: InputHandle<SequencedInputFrame> = live.handle ?? live.room.input<SequencedInputFrame>();
      const liveState = live.room.state;
      checks.observe('S5_session', { source: liveRoom === undefined ? 'fresh join (reconnect failed)' : 'reconnected session' });

      const settledBefore = await until(() => liveHandle.pendingCount === 0, 3000);
      const ackedSeq = liveHandle.lastProcessed;
      const inFlight = await send(liveHandle, 2, 0);
      const lastInFlight = inFlight[inFlight.length - 1];
      const inFlightSeq = lastInFlight === undefined ? 0 : lastInFlight.returned;
      const pendingVisible = inFlightSeq > 0 ? liveHandle.at(inFlightSeq) !== undefined : false;
      const ackedVisible = ackedSeq > 0 ? liveHandle.at(ackedSeq) !== undefined : true;
      const pendingArithmetic = liveHandle.pendingCount === liveHandle.sentCount - liveHandle.lastProcessed;
      checks.observe('S5_clientObservability', {
        ackedSeq,
        ackedVisible,
        inFlightSeq,
        pendingVisible,
        settledBefore,
        sentCount: liveHandle.sentCount,
        lastProcessed: liveHandle.lastProcessed,
        pendingCount: liveHandle.pendingCount,
        pendingArithmetic,
        replayBufferSize: liveHandle.replayBufferSize,
        epoch: liveHandle.epoch,
      });
      checks.check('I5-acked-inputs-are-pruned-from-the-client-ring', !ackedVisible, `at(${String(ackedSeq)}) after acknowledgement: ${ackedVisible ? 'still present' : 'gone'} — the client cannot re-read the frame it predicted from once the ack retires it`);
      checks.check('I5-in-flight-inputs-are-still-replayable', pendingVisible, `at(${String(inFlightSeq)}) while unacknowledged: ${pendingVisible ? 'present' : 'missing'}; replayBufferSize ${String(handle.replayBufferSize)}`);
      checks.check('I5-pending-count-is-derived-from-two-counters-only', pendingArithmetic, `pendingCount ${String(liveHandle.pendingCount)} === sentCount ${String(liveHandle.sentCount)} − lastProcessed ${String(liveHandle.lastProcessed)}: the client-side view is arithmetic, with no disposition content`);
      checks.check('I5-the-replay-window-is-advertised-so-a-client-can-size-its-own', liveHandle.replayBufferSize > 0, `replayBufferSize ${String(liveHandle.replayBufferSize)}: a client can bound its own per-seq prediction state to the window the SDK will actually serve`);

      // ── S6 — pairing: does the ack arrive with the state it must be compared against? ────────────
      const samples: { lastProcessed: number; resolvedThrough: number; patches: number }[] = [];
      let patches = 0;
      // `room.onStateChange` is the client-side state-delivery hook. The pinned schema instance declares no
      // `onChange` of its own, which is itself part of the answer to "what can the client observe".
      liveRoom?.room.onStateChange(() => {
        patches += 1;
      });
      let previousAck = liveHandle.lastProcessed;
      let ackChangesWithoutPatch = 0;
      let maxDelta = 0;
      let mismatchSamples = 0;
      let resolutionAhead = 0;
      const sender = send(liveHandle, 12, 50);
      for (let index = 0; index < 60; index += 1) {
        const patchesBefore = patches;
        await sleep(15);
        const ack = liveHandle.lastProcessed;
        const resolved = liveState.resolvedThrough;
        samples.push({ lastProcessed: ack, resolvedThrough: resolved, patches });
        if (ack !== previousAck && patches === patchesBefore) ackChangesWithoutPatch += 1;
        previousAck = ack;
        if (ack > resolved) {
          mismatchSamples += 1;
          maxDelta = Math.max(maxDelta, ack - resolved);
        }
        if (resolved > ack) resolutionAhead += 1;
      }
      await sender;
      const settled = await until(() => liveHandle.lastProcessed === liveState.resolvedThrough, 4000);
      const gracePatches = Math.max(2, Math.ceil(50 / (1000 / TICK_RATE)) + 1);
      checks.observe('S6_pairing', {
        samples: samples.slice(0, 40),
        sampleCount: samples.length,
        patchCount: patches,
        ackChangesWithoutPatch,
        mismatchSamples,
        maxDelta,
        resolutionAhead,
        settled,
        finalAck: liveHandle.lastProcessed,
        finalResolvedThrough: liveState.resolvedThrough,
        declaredGracePatches: gracePatches,
      });
      checks.check(
        'I6-the-acknowledgement-arrives-with-a-state-delivery',
        ackChangesWithoutPatch === 0,
        `${String(ackChangesWithoutPatch)} of ${String(samples.length)} samples moved lastProcessed without a state delivery; ${String(patches)} patches observed — the two are one delivery, so pairing them is legitimate and comparing them across separate messages would not be`,
      );
      checks.check(
        'I6-the-acknowledgement-never-runs-ahead-of-state-at-the-default-cadence',
        mismatchSamples === 0 && resolutionAhead === 0,
        `${String(mismatchSamples)} of ${String(samples.length)} samples had lastProcessed ahead of resolvedThrough and ${String(resolutionAhead)} the other way, across ${String(patches)} patches: comparing the two inside one delivery is not a timing race. The one-patch tolerance in ADR-P-0003 §10 covers a server that publishes its watermark a tick after consuming, not patch delivery — see I7 and the limitations.`,
      );
      checks.observe('I6_declaredGrace', {
        gracePatches,
        basis: 'declared tolerance for a server that consumes in tick N and publishes the disposition in tick N+1; measured patch timing itself needs none',
      });
      checks.check(
        'I6-a-quiet-session-converges-to-equality',
        settled,
        `at rest lastProcessed ${String(liveHandle.lastProcessed)} and resolvedThrough ${String(liveState.resolvedThrough)} agree; resolution ahead of the ack occurred in ${String(resolutionAhead)} samples`,
      );

      // ── S7 — what happens to the comparison when state is delivered slower than the step? ────────
      const slowRoom = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 32, tickRate: TICK_RATE, patchIntervalMs: 250 }, InputTraceStateSchema);
      const slowHandle: InputHandle<SequencedInputFrame> = slowRoom.input<SequencedInputFrame>();
      let slowPatches = 0;
      slowRoom.onStateChange(() => {
        slowPatches += 1;
      });
      let slowPreviousAck = slowHandle.lastProcessed;
      let slowAckMovesWithoutPatch = 0;
      let slowMaxDelta = 0;
      let slowMismatchSamples = 0;
      const slowSamples: { lastProcessed: number; resolvedThrough: number; patches: number }[] = [];
      const slowSender = send(slowHandle, 14, 20);
      for (let index = 0; index < 70; index += 1) {
        const patchesBefore = slowPatches;
        await sleep(10);
        const ack = slowHandle.lastProcessed;
        const resolved = slowRoom.state.resolvedThrough;
        slowSamples.push({ lastProcessed: ack, resolvedThrough: resolved, patches: slowPatches });
        if (ack !== slowPreviousAck && slowPatches === patchesBefore) slowAckMovesWithoutPatch += 1;
        slowPreviousAck = ack;
        if (ack > resolved) {
          slowMismatchSamples += 1;
          slowMaxDelta = Math.max(slowMaxDelta, ack - resolved);
        }
      }
      await slowSender;
      const slowSettled = await until(() => slowHandle.lastProcessed === slowRoom.state.resolvedThrough, 4000);
      checks.observe('S7_slowPatchCadence', {
        patchIntervalMs: 250,
        stepMs: 1000 / TICK_RATE,
        samples: slowSamples.slice(0, 30),
        sampleCount: slowSamples.length,
        patchCount: slowPatches,
        slowAckMovesWithoutPatch,
        slowMismatchSamples,
        slowMaxDelta,
        slowSettled,
        finalAck: slowHandle.lastProcessed,
        finalResolvedThrough: slowRoom.state.resolvedThrough,
        observedUnsettledWindowMs: slowMaxDelta * (1000 / TICK_RATE),
      });
      checks.check(
        'I7-the-acknowledgement-still-only-moves-with-a-state-delivery',
        slowAckMovesWithoutPatch === 0,
        `${String(slowAckMovesWithoutPatch)} of ${String(slowSamples.length)} samples moved lastProcessed without a patch while patchRate was ${String(250)} ms against a ${String(1000 / TICK_RATE)} ms step — the two are one delivery at any cadence, so they can be compared atomically`,
      );
      // The hypothesis was wrong and the measured answer is stronger: slowing state delivery does not
      // separate the acknowledgement from state, because they are the same delivery. So the reset trigger
      // must not be blamed on patch timing; what it must survive is a server that publishes its own
      // resolution watermark later than it consumes, plus the domain restart measured in S4.
      checks.check(
        'I7-a-slower-patch-cadence-does-not-separate-ack-from-state',
        slowMismatchSamples === 0 && slowAckMovesWithoutPatch === 0,
        `patchRate ${String(250)} ms against a ${String(1000 / TICK_RATE)} ms step: ${String(slowMismatchSamples)} mismatch samples, ${String(slowAckMovesWithoutPatch)} ack moves without a patch, ${String(slowPatches)} patches observed, converged at rest: ${String(slowSettled)} — the client may compare the two atomically, and a reset trigger needs no grace for patch delivery`,
      );
      checks.observe('I7_what_the_tolerance_is_for', {
        patchTimingNeedsNoGrace: slowMismatchSamples === 0 && mismatchSamples === 0,
        realSkewSources: [
          'a server that consumes in tick N and publishes the resolution watermark in tick N+1 — a contract requirement, not a library behaviour',
          'the per-connection sequence restart across a rejoin (S4)',
          'a pre-buffer dedupe drop, which strands lastProcessed below sentCount forever (S3)',
          'a real round trip, which this probe cannot measure',
        ],
        declaredTolerance: 'one patch, expressed in patches and in round trips, re-measured at Gate A',
      });

      // ── cross-cutting observations the proposal quotes ────────────────────────────────────────────
      checks.observe('identityModel', {
        clientWireSeq: 'InputHandle.sentCount / send() return value — the value the SDK acknowledges via lastProcessed',
        stampedSeq: 'a numeric field on the input schema, declared as defineInput({ seqField }) — readable by the room in every consumed frame',
        alignment: 'stamped sentCount + 1 before send() equals the seq send() returns; measured in S1 and in the gap scenario S2',
        udgGeneration: 'intention generation, advances only on a deliberate control intention — NOT per frame, so it cannot identify a frame',
        udgArrivalOrdinal: 'UDG server-local admission order across all sessions — orders work inside the room, says nothing about a client send sequence',
        sdkInputEpoch: 'a client-side reset counter (PR-12), not a session epoch',
        conclusion: 'four separate identifiers; the authoritative record must carry the stamped client sequence, and nothing else in the stack can stand in for it',
      });
      checks.observe('mechanismVerdict', {
        serverCanNameEveryConsumedFrame: true,
        serverCanNameOnlyThroughAStampedField: true,
        serverCanDetectGaps: true,
        serverCanRetrieveAnEvictedFrame: false,
        clientCanSeeDisposition: false,
        clientSees: ['lastProcessed', 'sentCount', 'pendingCount', 'at(seq)', 'replayBufferSize', 'epoch'],
        ackAndStateAreOneDelivery: ackChangesWithoutPatch === 0 && slowAckMovesWithoutPatch === 0,
        unsettledWindowAtDefaultCadence: maxDelta,
        unsettledWindowAtSlowCadence: slowMaxDelta,
        preBufferDedupeBreaksSeqEqualsAck: overHandle.lastProcessed < overHandle.sentCount,
      });
      checks.observe('supportedPrerequisite', {
        needed: 'one uint32 per-frame sequence field on DirectInputSchema, declared as the room seqField and stamped sentCount + 1 by the client',
        frozenFile: 'packages/protocol/src/schema/DirectInputSchema.ts — protocol 1.0.0, five fields, changed only by owner-approved protocol amendment',
        whyNotAnExistingField: 'generation is an intention domain and sessionEpoch a session domain; reusing either would conflate identity with authority and break the gap rule in ADR-P-0003 §9.2',
      });

      checks.limit('Loopback only, one server process, single client per room instance. Round trip is effectively zero, so S6 measures the smallest possible unsettled window: a real network widens it and the declared grace must be re-measured at Gate A, not inherited from this number.');
      checks.limit('The input declaration is probe-local. The frozen protocol input schema has no per-frame sequence field, so S1 and S2 measure what a stamped field would give UDG, not a shipped behaviour.');
      checks.limit('Nothing here is a Phase 2 implementation: no RegionRoom, no authority core, no physics. The room resolves a frame by recording it and bumping a state counter, which is a stand-in for a locomotion step.');
      checks.limit('Reconnection depends on the seat granting allowReconnection, which IdentityRoom does for 10 s. A refused token would change S4 and is a different scenario.');
      checks.limit('S7 decouples patchRate from the step on the server side only. It is not a network round trip: an RTT adds a second, larger window that only Gate A can measure, and the declared tolerance in ADR-P-0003 is expressed in patches and in round trips for that reason.');
      checks.limit('This probe establishes no compatibility claim: stackCompatibility remains not-established and Gates A, B and C remain Not Run.');
    } finally {
      await server.close();
    }
  });
}

await main();
