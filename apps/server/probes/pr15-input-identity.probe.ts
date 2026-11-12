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

/**
 * Bounded settle for the client's acknowledgement: wait until it **stops moving**.
 *
 * The room-side settle answers "has the server finished consuming"; it cannot answer "has the client
 * heard", because the ack rides a later patch. Waiting for `pendingCount === 0` would be wrong here: the
 * strand this probe measures leaves the acknowledgement permanently below `sentCount`, so the honest
 * condition is that the counter has stopped changing. Three consecutive unchanged samples at 50 ms,
 * capped at 60 samples — bounded in both directions, and reported rather than assumed.
 */
async function ackSettled(handle: InputHandle<SequencedInputFrame>): Promise<{ lastProcessed: number; stableSamples: number; timedOut: boolean }> {
  let previous = handle.lastProcessed;
  let stable = 0;
  let samples = 0;
  for (; samples < 60; samples += 1) {
    await sleep(50);
    const now = handle.lastProcessed;
    stable = now === previous ? stable + 1 : 0;
    previous = now;
    if (stable >= 3) return { lastProcessed: now, stableSamples: stable, timedOut: false };
  }
  return { lastProcessed: handle.lastProcessed, stableSamples: stable, timedOut: true };
}

/** The client-side surface the step gate needs: send a message type, read the field it echoes. */
interface GateableRoom {
  readonly sessionId: string;
  readonly state: InputTraceState;
  send(type: string, payload?: unknown): void;
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

      // ── S2 — retirement visibility, measured on settled, by-value snapshots ──────────────────────
      //
      // Three scenarios, because one scenario cannot show both shapes and the previous single scenario
      // produced an artefact that contradicted itself (CI run 43053089415: `gaps` non-empty beside
      // `skipped: 0`). Every scenario now (a) stops the sender, (b) waits on a **bounded server-side**
      // settle condition — `accessor.size === 0`, not the client ack, which eviction can satisfy while the
      // room is still stepping — and (c) reads one `IdentityRoom.snapshot(sessionId)`, whose collections
      // are copies and whose totals are derived inside the copy.
      //
      //   S2a  controlled interior gap   — steps withheld at the probe's request, so the burst lands
      //                                    inside one step window and the gap is arithmetic, not luck.
      //   S2b  leading-only retirement   — retirement before the first consumed frame: counted, not
      //                                    nameable, and the test must pass with no interior gap at all.
      //   S2c  over-rate observation     — the original unsynchronised 2×-rate sender, asserted only on
      //                                    invariants, because its interleaving genuinely varies.

      // Handshake helpers. `suspend`/`resume` are ordinary room messages; the room gates its own step
      // callback, and the state field lets the probe wait for confirmation instead of assuming it.
      const gate = async (target: GateableRoom, value: 0 | 1): Promise<void> => {
        await target.send(value === 1 ? 'suspend' : 'resume');
        const seen = await until(() => target.state.suspended === value, 3000);
        if (!seen) throw new Error(`the identity room never acknowledged suspended=${String(value)}`);
      };

      // ── S2a — a controlled interior gap: exact values, no timing dependence ──────────────────────
      const gapRoom = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 4, tickRate: TICK_RATE }, InputTraceStateSchema);
      const gap = lastOf(identityRooms);
      const gapHandle: InputHandle<SequencedInputFrame> = gapRoom.input<SequencedInputFrame>();
      const gapSentFirst = await send(gapHandle, 1, 0);
      const gapSettled = gap !== undefined && await until(() => gap.drained(gapRoom.sessionId) && gap.consumedSeqs.length >= 1, 4000);
      const beforeInterior = gap === undefined ? undefined : gap.snapshot(gapRoom.sessionId);

      await gate(gapRoom, 1);
      // Hold the gate until a step has actually been withheld. Without this wait the window is only
      // the length of two loopback messages, and whether it contains a step at all is the scheduler's
      // decision — §7's reliability rule allows exact assertions only where the construction controls
      // the case, and the withheld window is part of this construction. Observed live as a false
      // failure of `I2a-the-step-gate-held-a-window-without-counting-it-as-a-tick` (suspended 0, ticks
      // 5) under probe load on 2026-11-12; the assertion itself did not move, the construction did.
      const windowHeld = await until(() => (gap?.suspendedSkips ?? 0) >= 1, 2000);
      // One synchronous burst: no `await` between sends, so nothing else on the client can interleave,
      // and the room's own gate means no step can consume while the buffer is filling.
      const gapBurst = await send(gapHandle, 6, 0);
      await gate(gapRoom, 0);
      const gapDrained = gap !== undefined && await until(() => gap.drained(gapRoom.sessionId), 4000);
      const interior = gap === undefined ? undefined : gap.snapshot(gapRoom.sessionId);
      const interiorGap = interior?.gaps[0];
      const evictedSeq = interiorGap === undefined ? 0 : interiorGap.from + 1;
      const evictedFindable = gap !== undefined && evictedSeq > 0 ? gap.lookup(gapRoom.sessionId, evictedSeq) : false;
      const interiorGapTotal = gapSentFirst.length + gapBurst.length;

      checks.observe('S2a_interiorGap', {
        sentTotal: interiorGapTotal,
        settledBeforeGate: gapSettled,
        windowHeld,
        withheldWindows: gap?.suspendedSkips ?? 0,
        drainedAfterResume: gapDrained,
        before: beforeInterior ?? null,
        after: interior ?? null,
        evictedSeq,
        evictedFindable,
      });
      checks.check(
        'I2a-the-step-gate-held-a-window-without-counting-it-as-a-tick',
        (interior?.suspendedSkips ?? 0) >= 1 && (interior?.ticks ?? 0) > 0,
        `the room withheld ${String(interior?.suspendedSkips ?? -1)} step(s) during the gate and still counted ${String(interior?.ticks ?? -1)} real ticks — a withheld window is not a tick that consumed nothing`,
      );
      checks.check(
        'I2a-the-controlled-gap-is-named-exactly',
        interiorGap !== undefined
          && interiorGap.from === 1
          && interiorGap.to === 4
          && interiorGap.skipped === 2
          && (interior?.gaps.length ?? 0) === 1,
        interiorGap === undefined
          ? 'no gap recorded — the controlled construction failed, which is a real finding, not a flake'
          : `consumed ${String(interiorGap.from)} then ${String(interiorGap.to)} at tick ${String(interiorGap.tick)}: exactly ${String(interiorGap.skipped)} sequences never stepped, and it is the only gap`,
      );
      checks.check(
        'I2a-consumption-order-is-exactly-what-the-construction-predicts',
        (interior?.consumedSeqs.join(',') ?? '') === '1,4,5,6,7',
        `expected 1,4,5,6,7 from a bound of 4 and a 1+6 burst; observed ${interior?.consumedSeqs.join(',') ?? 'nothing'}`,
      );
      checks.check(
        'I2a-the-snapshot-derives-its-own-total',
        (interior?.skipped ?? -1) === (interior?.gaps.reduce((total, entry) => total + entry.skipped, 0) ?? -1)
          && (interior?.skipped ?? 0) === 2,
        `skipped ${String(interior?.skipped ?? -1)} derived inside the snapshot from the copied array, so no caller can pair a grown array with a stale total`,
      );
      checks.check(
        'I2a-evicted-frames-are-not-retrievable-through-the-accessor',
        !evictedFindable && evictedSeq === 2,
        `accessor.at(${String(evictedSeq)}) for a skipped sequence returned ${evictedFindable ? 'a frame' : 'nothing'} — the server cannot re-read what overflow dropped`,
      );
      checks.check(
        'I2a-buffer-depth-never-exceeded-its-bound',
        (interior?.peakSize ?? 99) <= 4 && (interior?.bufferMaxSize ?? 0) === 4,
        `peak observed depth ${String(interior?.peakSize ?? -1)} against bufferMaxSize 4; depth is observable, but PR-13 measured that observing it is not prevention`,
      );
      checks.check(
        'I2a-the-acknowledgement-counts-frames-that-were-never-stepped',
        (interior?.retiredUnrepresented ?? -1) === 2 && (interior?.consumedSeqs.length ?? 0) === 5,
        `${String(interior?.consumedSeqs.length ?? -1)} frames entered state while accessor.consumedCount reached ${String(interior?.accessorConsumedCount ?? -1)}: ${String(interior?.retiredUnrepresented ?? -1)} retired unrepresented, and the ack treats them as consumed`,
      );

      // ── S2b — leading-only retirement: known count, no observable interior gap ──────────────────
      // A gap needs two endpoints. Retirements before the room's first consumed frame have no earlier
      // endpoint, so the room cannot name them; it can only count them. This scenario exists so the suite
      // proves the count is trustworthy *without* an interior gap, which is the shape the previous
      // scenario conflated: it sometimes produced a leading-only run and then failed an exact-gap
      // assertion that should never have applied to it.
      const leadRoom = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 4, tickRate: TICK_RATE }, InputTraceStateSchema);
      const lead = lastOf(identityRooms);
      const leadHandle: InputHandle<SequencedInputFrame> = leadRoom.input<SequencedInputFrame>();
      await gate(leadRoom, 1);
      const leadSent = await send(leadHandle, 8, 0);
      await gate(leadRoom, 0);
      const leadDrained = lead !== undefined && await until(() => lead.drained(leadRoom.sessionId), 4000);
      const leading = lead === undefined ? undefined : lead.snapshot(leadRoom.sessionId);

      checks.observe('S2b_leadingOnly', {
        sent: leadSent.length,
        drainedAfterResume: leadDrained,
        snapshot: leading ?? null,
      });
      checks.check(
        'I2b-leading-retirement-is-counted-and-not-nameable',
        (leading?.unnamedLeading ?? 0) === 4 && (leading?.gaps.length ?? 1) === 0 && (leading?.firstConsumedSeq ?? 0) === 5,
        leading === undefined
          ? 'no snapshot'
          : `first consumed sequence ${String(leading.firstConsumedSeq)}, so ${String(leading.unnamedLeading)} retirements have no earlier endpoint; interior gaps recorded: ${String(leading.gaps.length)} — the count is exact while the identities are unnameable`,
      );
      checks.check(
        'I2b-the-count-agrees-from-both-sides-without-any-gap-evidence',
        (leading?.retiredUnrepresented ?? -1) === leadSent.length - (leading?.consumedSeqs.length ?? 0)
          && (leading?.retiredUnrepresented ?? 0) > 0,
        `accessor.consumedCount ${String(leading?.accessorConsumedCount ?? -1)} minus ${String(leading?.consumedSeqs.length ?? -1)} stepped = ${String(leading?.retiredUnrepresented ?? -1)}, matching the client's own ${String(leadSent.length - (leading?.consumedSeqs.length ?? 0))} with zero nameable gaps`,
      );
      checks.check(
        'I2b-a-drained-room-accounts-for-every-retirement-exactly-once',
        leadDrained
          && (leading?.accessorConsumedCount ?? -1) === (leading?.consumedSeqs.length ?? -1) + (leading?.skipped ?? -1) + (leading?.unnamedLeading ?? -1),
        `consumedCount ${String(leading?.accessorConsumedCount ?? -1)} = stepped ${String(leading?.consumedSeqs.length ?? -1)} + named skips ${String(leading?.skipped ?? -1)} + unnameable leading ${String(leading?.unnamedLeading ?? -1)} — once the accessor has drained, every retirement is accounted exactly once`,
      );

      // ── S2c — the unsynchronised over-rate sender, asserted on invariants only ───────────────────
      const overRoom = await client.create<InputTraceState>('udg-pr15-identity', { bufferMaxSize: 4, tickRate: TICK_RATE }, InputTraceStateSchema);
      const over = lastOf(identityRooms);
      const overHandle: InputHandle<SequencedInputFrame> = overRoom.input<SequencedInputFrame>();
      const overSent = await send(overHandle, 12, 5);
      const overDrained = over !== undefined && await until(() => over.drained(overRoom.sessionId), 6000);
      const overAck = await ackSettled(overHandle);
      const overSnap = over === undefined ? undefined : over.snapshot(overRoom.sessionId);
      const overStepped = overSnap?.consumedSeqs.length ?? 0;
      const overMonotonic = (overSnap?.consumedSeqs ?? []).every((seq, index) => index === 0 || seq > (overSnap?.consumedSeqs[index - 1] ?? -1));

      checks.observe('S2c_overRateObservation', {
        sent: overSent.length,
        drained: overDrained,
        snapshot: overSnap ?? null,
        lastProcessed: overHandle.lastProcessed,
        sentCount: overHandle.sentCount,
        pendingCount: overHandle.pendingCount,
        ackSettle: overAck,
      });
      checks.check(
        'I2c-the-over-rate-run-stays-inside-its-bound-and-accounts-exactly',
        overDrained
          && (overSnap?.peakSize ?? 99) <= 4
          && overMonotonic
          && (overSnap?.accessorConsumedCount ?? -1) === overStepped + (overSnap?.skipped ?? -1) + (overSnap?.unnamedLeading ?? -1),
        `peak depth ${String(overSnap?.peakSize ?? -1)} of 4, consumption strictly increasing, and consumedCount ${String(overSnap?.accessorConsumedCount ?? -1)} = stepped ${String(overStepped)} + named ${String(overSnap?.skipped ?? -1)} + leading ${String(overSnap?.unnamedLeading ?? -1)}. Exact positions are not asserted: which frames survive to the first step genuinely depends on arrival interleaving`,
      );
      checks.check(
        'I2c-the-acknowledgement-reached-everything-sent-though-little-was-stepped',
        overAck.timedOut === false
          && overAck.lastProcessed === overSent.length
          && overStepped < overSent.length,
        `lastProcessed ${String(overHandle.lastProcessed)} equals frames sent (${String(overSent.length)}) while ${String(overStepped)} entered state; ${String(overSent.length - overStepped)} retired unrepresented and the ack counts them as consumed`,
      );

      // ── S3 — the second drop path: seqField dedupe discards a replayed sequence before the buffer ──
      // Controlled the same way, on the S2a room, so the revealing frame is exactly one ahead of the
      // replayed stamp and the named gap it produces is exact.
      const beforeDedupe = gap === undefined ? undefined : gap.snapshot(gapRoom.sessionId);
      const dedupeStart = gapHandle.sentCount;
      const replayedStamp = beforeDedupe?.consumedSeqs[1] ?? 4;
      await gate(gapRoom, 1);
      Object.assign(gapHandle.data, frame(950, replayedStamp));
      const replayedWire = gapHandle.send();
      Object.assign(gapHandle.data, frame(951, gapHandle.sentCount + 1));
      const freshWire = gapHandle.send();
      await gate(gapRoom, 0);
      const dedupeDrained = gap !== undefined && await until(() => gap.drained(gapRoom.sessionId), 4000);
      const dedupeAck = await ackSettled(gapHandle);
      const afterDedupe = gap === undefined ? undefined : gap.snapshot(gapRoom.sessionId);
      const dedupeGap = afterDedupe?.gaps[afterDedupe.gaps.length - 1];
      const replayedFindable = gap !== undefined ? gap.lookup(gapRoom.sessionId, freshWire - 1) : false;

      checks.observe('S3_replayedSequence', {
        replayedStamp,
        replayedWire,
        freshWire,
        sendsBefore: dedupeStart,
        sendsAfter: gapHandle.sentCount,
        drainedAfterResume: dedupeDrained,
        ackSettle: dedupeAck,
        before: beforeDedupe ?? null,
        after: afterDedupe ?? null,
        lastProcessed: gapHandle.lastProcessed,
        pendingCount: gapHandle.pendingCount,
      });
      checks.check(
        'I3-a-replayed-sequence-is-dropped-before-the-buffer',
        (afterDedupe?.consumedSeqs.includes(freshWire - 1) ?? true) === false
          && replayedFindable === false
          && dedupeDrained,
        `stamped ${String(replayedStamp)} again at wire ${String(replayedWire)}, then a fresh stamp at ${String(freshWire)}: the accessor consumed no frame for ${String(freshWire - 1)} and cannot retrieve it — dedupe runs before buffering, so the room never sees it`,
      );
      checks.check(
        'I3-a-dropped-replay-surfaces-as-a-named-gap-only-when-a-later-frame-arrives',
        dedupeGap !== undefined
          && dedupeGap.from === (beforeDedupe?.consumedSeqs[beforeDedupe.consumedSeqs.length - 1] ?? -1)
          && dedupeGap.to === freshWire
          && dedupeGap.skipped === 1,
        dedupeGap === undefined
          ? 'no gap recorded after the replayed stamp'
          : `consumed ${String(dedupeGap.from)} then ${String(dedupeGap.to)}: exactly ${String(dedupeGap.skipped)} sequence skipped, which is the hole the dedupe left`,
      );
      checks.check(
        'I3-pre-buffer-discard-is-invisible-to-the-retirement-count',
        (afterDedupe?.retiredUnrepresented ?? -1) === (beforeDedupe?.retiredUnrepresented ?? -2),
        `retiredUnrepresented stayed ${String(afterDedupe?.retiredUnrepresented ?? -1)} (was ${String(beforeDedupe?.retiredUnrepresented ?? -1)}) across a real discard: consumedCount never saw the frame, so only the named gap records it`,
      );
      checks.check(
        'I3-dedupe-desynchronises-the-ack-from-the-client-sequence',
        dedupeAck.timedOut === false
          && dedupeAck.lastProcessed === gapHandle.sentCount - 1
          && gapHandle.pendingCount === 1,
        dedupeAck.timedOut
          ? 'the acknowledgement was still moving when the bound expired — the strand claim cannot be made from a unsettled counter'
          : `after one pre-buffer drop: lastProcessed ${String(dedupeAck.lastProcessed)} sits permanently one below sentCount ${String(gapHandle.sentCount)} with pendingCount ${String(gapHandle.pendingCount)} — pruning on "seq <= lastProcessed" would strand an input the server already discarded`,
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
        // Measured where the claim is about: the pre-buffer drop in S3 leaves the acknowledgement
        // permanently one below the client's own count. The over-rate case is not evidence here — its
        // acknowledgement does catch up, because it is a send-order watermark, not a disposition.
        preBufferDedupeBreaksSeqEqualsAck: dedupeAck.timedOut === false
          && dedupeAck.lastProcessed < gapHandle.sentCount,
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
