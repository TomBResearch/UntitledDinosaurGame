/**
 * `ColyseusInputAdapter` — the only module that talks to the SDK input API
 * (UDG-003 Phase 2, W-4/W-5; ADR-0003 §3.1–§3.3).
 *
 * Everything the transport decides is decided from the accessor's own public counters, in the
 * room's tick, and nothing is inferred from a client payload (§8.3 invariant 5). The adapter is
 * deliberately independent of the Colyseus `Room` object so the retirement arithmetic is testable
 * against a scripted `InputPort`; the room supplies the real accessor, which structurally
 * satisfies the same port.
 *
 * The retirement identity, verbatim from ADR-0003 §3.1 and implemented per connection domain:
 *
 * ```text
 * retiredUnrepresented += (consumedDelta − dequeuedCount)
 * consumedDelta  = accessor.consumedCount − previous sample (domain-base at domain start)
 * dequeuedCount  = accessor.next() results with accessor.wasIdle === false
 * ```
 *
 * Consequences this code is obliged to honour, each with its clause:
 *
 * - a tick that dequeues nothing contributes nothing (the subtraction runs on the counter delta
 *   only when a dequeue attempt happened the counter actually moved on);
 * - a frame dequeued and then refused by UDG rules still counts as dequeued — the adapter hands
 *   every dequeued frame to the authority for its neutral step and disposition (GA-4);
 * - `clear()` is charged, because it advances the same acknowledgement watermark an eviction moves
 *   — the subtraction sees it exactly like an eviction, which is the point of doing the arithmetic
 *   on counters rather than on returned frames;
 * - the three close observations (`retiredUnrepresented`, `outstandingAtClose`,
 *   `serverQueuedAtClose`) are recorded separately and never summed (§3.1).
 */

import type { DirectWireFrame } from '@udg/protocol';

import type { InputEnvelopeConfig } from '@udg/config';

/**
 * The public surface of `InputAccessor` this adapter uses.
 *
 * The real accessor has more members; naming only what is read keeps the seam honest — a test
 * double that drifts from the real counter semantics fails the same way the real stack would.
 */
export interface InputPort {
  next(): DirectWireFrame | undefined;
  readonly wasIdle: boolean;
  readonly size: number;
  readonly consumedCount: number;
  readonly latest: DirectWireFrame | undefined;
  peek(): readonly DirectWireFrame[];
  at(value: number): DirectWireFrame | undefined;
  clear(): void;
}

/** One dequeued frame as the transport saw it. The authority sees the projected five-field core frame. */
export interface DequeuedFrame {
  readonly seq: number;
  readonly frame: DirectWireFrame;
}

/** The disposition record for one entity, exactly the shape `applyDisposition` publishes (protocol-v1 §6.5). */
export interface DispositionRecordState {
  inputResolvedThrough: number;
  gap: { readonly start: number; readonly end: number } | null;
  inputRetiredUnrepresented: number;
  effectCount: number;
  lastAppliedRequestId: string | null;
}

/** Signals a tick may raise. `STRAND_SUSPECTED` is diagnostic and the type cannot express closure for it (W-6). */
export type InputSignal = 'QUEUE_PRESSURE' | 'RETIRED_UNREPRESENTED' | 'STRAND_SUSPECTED' | 'RATE_CEILING';

/** The three close observations, recorded separately; never summed, never inferred from one another. */
export interface CloseObservation {
  readonly retiredUnrepresented: number;
  readonly serverQueuedAtClose: number;
  readonly consumedCountAtClose: number;
  readonly dequeuedTotal: number;
  readonly sampledAtMs: number;
}

/** What one `observe()` call decided for one session in one tick. */
export interface TickObservation {
  readonly dequeued: DequeuedFrame | undefined;
  readonly retiredUnrepresented: number;
  readonly retiredDelta: number;
  readonly signals: readonly InputSignal[];
  readonly sizeAfter: number;
  readonly consumedCount: number;
}

/**
 * Per-connection-domain transport state for one entity.
 *
 * A domain is one seat's continuous connection: first join, or each rejoin. The stamp domain and
 * every counter restart with it (§3.1 "snapshotted at domain start and reset on domain change") —
 * `InputHandle.epoch` does not move across a rejoin, which is exactly why the adapter keeps its own
 * domain boundary instead of borrowing the library's.
 */
export class SessionInputState {
  /** Highest stamp whose every predecessor has an explicit disposition; `0` = nothing resolved. */
  resolvedThrough = 0;
  /** The named observed hole; `null` while no range has been named (wire sentinel `0 / 0`). */
  gap: { readonly start: number; readonly end: number } | null = null;
  /** §3.1 retirement count within this domain. */
  retiredUnrepresented = 0;
  /** GA-10 effect ledger, published beside the disposition record. */
  effectCount = 0;
  lastAppliedRequestId: string | null = null;

  #previousConsumedCount = 0;
  #lastConsumedSeq = 0;
  #dequeuedTotal = 0;
  #pressureLatched = false;
  #strandStreakMs = 0;
  #strandAt = 0;
  #rateWindow: { atMs: number; arrivals: number }[] = [];
  #lastArrivalCount = 0;

  /**
   * Open a domain against the accessor's counters as they stand.
   *
   * The base snapshot is the whole reset: nothing before this point can charge this domain, which
   * is what keeps a rejoin's stamp domain from inheriting the old seat's arithmetic.
   */
  beginDomain(accessor: InputPort): void {
    this.#previousConsumedCount = accessor.consumedCount;
    this.#lastConsumedSeq = 0;
    this.#dequeuedTotal = 0;
    this.#strandStreakMs = 0;
    this.#strandAt = 0;
    this.#rateWindow = [];
    this.#lastArrivalCount = accessor.consumedCount + accessor.size;
    this.resolvedThrough = 0;
    this.gap = null;
    this.retiredUnrepresented = 0;
    this.#pressureLatched = false;
  }

  /** Stamps dequeued in this domain, oldest first — the transport's own record for evidence. */
  readonly consumed: { seq: number; tick: number }[] = [];

  /**
   * One tick of transport observation for one session.
   *
   * Consumes at most one frame (the adopted FIFO posture, one observation per entity per tick),
   * runs the §3.1 subtraction against the counter movement this tick, names a gap when a dequeued
   * stamp is not adjacent, and evaluates the §3.3 signals from accessor state only.
   */
  observe(
    accessor: InputPort,
    envelope: InputEnvelopeConfig,
    tick: number,
    nowMs: number,
    patchIntervalMs: number,
  ): TickObservation {
    // Sampling order is part of the arithmetic: the counter is read **around** the dequeue, because
    // `next()` is what advances it. Reading it before the call and comparing against a dequeue that
    // has not happened yet charges the next tick with this tick's frame — a guaranteed phantom
    // retirement on every first frame. (Live-measured on the real transport, 2026-11-12.)
    const consumedBefore = this.#previousConsumedCount;

    const frame = accessor.next();
    // The `wasIdle === false` guard is §3.1's, verbatim: a synthesised idle frame is not a dequeue.
    const dequeuedCount = frame !== undefined && accessor.wasIdle === false ? 1 : 0;

    const consumedNow = accessor.consumedCount;
    this.#previousConsumedCount = consumedNow;
    const consumedDelta = consumedNow - consumedBefore;
    if (process.env['UDG_INPUT_DEBUG'] !== undefined && (consumedDelta !== 0 || frame !== undefined)) {
      process.stderr.write(`[input] tick=${String(tick)} consumedBefore=${String(consumedBefore)} consumedNow=${String(consumedNow)} delta=${String(consumedDelta)} dequeued=${String(dequeuedCount)} wasIdle=${String(accessor.wasIdle)} seq=${String(frame?.seq ?? -1)} size=${String(accessor.size)}\n`);
    }

    // The subtraction, charged per tick. Counter movement with no dequeued frame is the eviction
    // and clear() case; frames discarded before the buffer are invisible here by construction and
    // are named nowhere (§3.1's stated coverage limits).
    const retiredDelta = Math.max(0, consumedDelta - dequeuedCount);
    this.retiredUnrepresented += retiredDelta;

    const signals: InputSignal[] = [];
    let dequeued: DequeuedFrame | undefined;

    if (frame !== undefined && dequeuedCount === 1) {
      this.#dequeuedTotal += 1;
      const seq = frame.seq;
      dequeued = { seq, frame };
      this.consumed.push({ seq, tick });
      if (this.#lastConsumedSeq > 0 && seq > this.#lastConsumedSeq + 1) {
        // A hole between two consumed stamps: nameable precisely because a later stamp arrived.
        this.gap = { start: this.#lastConsumedSeq + 1, end: seq - 1 };
      }
      if (seq === this.resolvedThrough + 1) {
        // The watermark advances only over stamps that themselves have a disposition; a retired
        // stamp never gets one, so the prefix stops there whether or not a gap names it (ADR-0003 §4).
        this.resolvedThrough = seq;
      }
      this.#lastConsumedSeq = Math.max(this.#lastConsumedSeq, seq);
    }

    // §3.3 pressure: depth alone. Never closure — the room's consequence table treats it as
    // throttle-only, and latching keeps the signal from flickering per tick inside one episode.
    if (accessor.size >= envelope.bufferMaxSize - envelope.bufferPressureMargin) {
      if (!this.#pressureLatched) {
        this.#pressureLatched = true;
        signals.push('QUEUE_PRESSURE');
      }
    } else {
      this.#pressureLatched = false;
    }

    if (retiredDelta > 0) signals.push('RETIRED_UNREPRESENTED');

    // §3.3 strand suspicion: empty buffer, newest stamp beyond the resolved watermark, unmoved for
    // one patch interval (`patchIntervalMs` — the §3.3 signal names the patch cadence, not the
    // closure window). Diagnostic only (W-6, GA-12): this code path cannot close, and the room's
    // consequence table has no closure row for it.
    const latestSeq = accessor.latest?.seq ?? 0;
    if (accessor.size === 0 && latestSeq > this.resolvedThrough) {
      if (this.#strandAt === 0) this.#strandAt = nowMs;
      this.#strandStreakMs = nowMs - this.#strandAt;
      if (this.#strandStreakMs >= patchIntervalMs && latestSeq > 0) {
        signals.push('STRAND_SUSPECTED');
      }
    } else {
      this.#strandAt = 0;
      this.#strandStreakMs = 0;
    }

    // §3.3 rate ceiling: observed arrivals per second, where an arrival is a dequeued frame or a
    // frame still waiting — the growth of (consumedCount + size) is everything the buffer ever held.
    // The measurement is a rate, not a tick count: at a 20 Hz tick the moving-tick count is capped
    // at 20/s and could never cross a 30/s ceiling no matter how fast the sender was. (Measured
    // live by the W-10 rate scenario, which sent 44 frames/s forever and saw nothing — the signal,
    // not the sender, was wrong.) Arrivals are sampled per tick and differenced across a trailing
    // one-second window; the span needs 250 ms of history so a single tight burst is attributed to
    // the buffer consequences it actually has, not to a rate the window cannot yet show.
    const arrivals = accessor.consumedCount + accessor.size;
    const lastWindow = this.#rateWindow[this.#rateWindow.length - 1];
    if (lastWindow === undefined || arrivals > lastWindow.arrivals) this.#rateWindow.push({ atMs: nowMs, arrivals });
    if (arrivals > this.#lastArrivalCount) this.#lastArrivalCount = arrivals;
    this.#rateWindow = this.#rateWindow.filter((sample, index) => index === 0 || nowMs - sample.atMs < 1_000);
    if (this.#rateWindow.length >= 2) {
      const oldest = this.#rateWindow[0] as { atMs: number; arrivals: number };
      const newest = this.#rateWindow[this.#rateWindow.length - 1] as { atMs: number; arrivals: number };
      const spanMs = newest.atMs - oldest.atMs;
      if (spanMs >= 250) {
        const arrivalsPerSecond = ((newest.arrivals - oldest.arrivals) * 1_000) / spanMs;
        if (arrivalsPerSecond > envelope.rateCeilingMessagesPerSecond) signals.push('RATE_CEILING');
      }
    }

    return {
      dequeued,
      retiredUnrepresented: this.retiredUnrepresented,
      retiredDelta,
      signals,
      sizeAfter: accessor.size,
      consumedCount: consumedNow,
    };
  }

  /** The current disposition record, in the exact shape the protocol publishes. */
  record(): DispositionRecordState {
    return {
      inputResolvedThrough: this.resolvedThrough,
      gap: this.gap,
      inputRetiredUnrepresented: this.retiredUnrepresented,
      effectCount: this.effectCount,
      lastAppliedRequestId: this.lastAppliedRequestId,
    };
  }

  /** Record one committed discrete effect identity (GA-10 ledger; driven only from authority outcomes). */
  recordEffect(requestId: string): void {
    this.effectCount += 1;
    this.lastAppliedRequestId = requestId;
  }

  /** §3.1's three separate close observations, sampled at seat close. Never summed with each other. */
  closeObservation(accessor: InputPort | undefined, nowMs: number): CloseObservation {
    return {
      retiredUnrepresented: this.retiredUnrepresented,
      serverQueuedAtClose: accessor?.size ?? 0,
      consumedCountAtClose: accessor?.consumedCount ?? this.#previousConsumedCount,
      dequeuedTotal: this.#dequeuedTotal,
      sampledAtMs: nowMs,
    };
  }
}
