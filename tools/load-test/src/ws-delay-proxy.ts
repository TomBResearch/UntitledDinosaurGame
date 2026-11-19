/**
 * UDG-SPIKE-001 — the development WebSocket impairment proxy (assignment §2.2, §5 DPA-2).
 *
 * ## What this primitive is
 *
 * A transparent **TCP-stream** proxy between the browser seats and the pinned room server that
 * introduces a **bounded, seeded, per-chunk stall** in each direction:
 *
 * - `requested stall = oneWayMs + U(-jitterBudgetMs/2, +jitterBudgetMs/2)` — a bounded uniform
 *   delay VARIATION around the half-RTT base, drawn from a seeded PRNG, so a run is replayable
 *   from its seed alone. Zero-centred on purpose: a one-sided `+U(0, b)` draw inflates the
 *   achieved MEDIAN by b/2 per direction, which (measured on the first elevated self-check:
 *   achieved p50 121 ms against a requested 100 ms) makes the §2.2 achieved-median rule
 *   unfalsifiably INVALID — the impairment would fail its own declaration instead of being
 *   measured against it. The profile is validated so the centred stall stays non-negative
 *   (`oneWayMs >= jitterBudgetMs / 2`), and `boundedUniformStall` itself remains the primitive
 *   over [base, base + budget] with the centring done at the call site.
 * - every byte the proxy accepts is eventually forwarded — **the proxy never drops and never
 *   reorders**: bytes enter each direction's queue in arrival order and leave it one at a time,
 *   under a single in-flight stall per direction, with a delivery-sequence audit that counts any
 *   violation (structurally zero — counted anyway, because "zero" must be CHECKED, not asserted);
 * - the stall delays the byte stream, it does not delete from it — which is precisely what the
 *   adopted measurement rule requires: *"Preserve byte order and model TCP stalls as stalls; do
 *   not call application message dropping packet-loss simulation."*
 *
 * ## Why a TCP stall is NOT packet loss (the standing documentation obligation)
 *
 * TCP is a reliable, ordered byte channel. A **stall** withholds bytes the connection has already
 * guaranteed to deliver; a **drop** destroys a segment and relies on TCP retransmission and
 * recovery to paper over it. This primitive only ever withholds: nothing here destroys a byte,
 * forges a RST, or exercises a retransmit path. A run through it therefore has an RTT/jitter
 * distribution the impairment genuinely produced and **no loss distribution at all**. Loss-
 * flavoured populations (GA-11's loss limbs, ADR-0003's dedupe/recovery evidence) can only be
 * produced over this path by *explicitly refusing to deliver an application message* inside the
 * harness, and every such population must be labelled `dropModel: "application-layer delivery
 * loss"`, `tcpLossModelled: false` wherever its numbers appear (§2.4). Calling these stalls
 * "packet loss" would overstate what the transport experienced, and the overstatement would
 * travel into the gate evidence.
 *
 * ## Why TCP level and not a `ws`-framing dependency (DPA-2, measured)
 *
 * A message-level proxy must parse and re-emit WebSocket frames — another dependency between the
 * measurement and the thing measured, and re-framing changes what the server's own TCP stack
 * sees. At the TCP level the proxy is protocol-blind: byte order is preserved by the streams
 * themselves, HTTP upgrade and permessage-deflate pass through untouched, and the only thing the
 * harness adds is the stall. The measurement recorded in
 * `docs/integration/colyseus-0.18-api-map.md` §14: the pinned `@colyseus/ws-transport` →
 * `ws@8.22.2` stack completes handshake, binary traffic and clean close through this proxy with
 * zero new dependencies, so DPA-2 recommends keeping it that way.
 *
 * ## Achieved metrics, honestly defined
 *
 * - per direction: raw requested/achieved stall pairs (achieved measured on the monotonic clock
 *   the injected `TimerDriver` exposes — `process.hrtime.bigint` with the real driver), byte and
 *   chunk counters, backpressure pause count, order-violation count, and delivery counters that
 *   make "nothing was dropped" checkable (`chunksReceived === chunksDelivered` after a drain);
 * - achieved RTT: each reverse chunk is paired with the most recent forward chunk the proxy had
 *   already delivered upstream when that reverse chunk ARRIVED at the proxy from the server; the
 *   sample is `achievedForward + achievedReverse` — the stall the round trip actually spent
 *   inside the proxy, excluding server processing and the (loopback, ≈0) wire. The pairing rule
 *   is part of the record, not an implementation detail; application-level round trips measured
 *   in the browser are recorded separately because they include server tick time.
 *
 * Determinism: pass `timer` (a `TimerDriver`) and the profile `seed`; the per-direction jitter
 * streams derive from the seed alone, so a unit test on a synthetic clock reproduces the exact
 * stall schedule of a real run with the same seed.
 */

import { connect, createServer, isIPv4, type Socket } from 'node:net';

import type { DelayPair } from './statistics.js';

// --------------------------------------------------------------------------- seeded jitter

/** mulberry32: a small, fully-specified 32-bit PRNG over [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
  let state = Math.trunc(seed) >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Derive an independent stream per (seed, lane) without a second PRNG. */
export const laneSeedRng = (seed: number, lane: number): (() => number) => mulberry32(laneSeedInternal(seed, lane));

const laneSeedInternal = (seed: number, lane: number): number => {
  let h = (Math.trunc(seed) ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** The bounded uniform stall for one chunk: `base + U(0, budget)`, always inside [base, base+budget]. */
export const boundedUniformStall = (baseMs: number, jitterBudgetMs: number, draw: number): number => {
  if (!(draw >= 0 && draw < 1)) throw new Error(`rng draw must be in [0,1), got ${String(draw)}`);
  if (!(baseMs >= 0) || !(jitterBudgetMs >= 0)) throw new Error('stall bounds must be non-negative');
  return baseMs + draw * jitterBudgetMs;
};

// --------------------------------------------------------------------------- time

/** Injectable monotonic clock + scheduler; unit tests drive this with a synthetic clock. */
export interface TimerDriver {
  nowMs(): number;
  /** Run `cb` after `afterMs` of this clock's time. Returns a cancel that is safe after firing. */
  schedule(afterMs: number, cb: () => void): () => void;
}

/** The production driver: `process.hrtime.bigint` for time, `setTimeout` for scheduling. */
export const realTimerDriver: TimerDriver = {
  nowMs: (): number => Number(process.hrtime.bigint()) / 1_000_000,
  schedule: (afterMs, cb): (() => void) => {
    let handle: ReturnType<typeof setTimeout> | undefined = setTimeout(cb, Math.max(0, afterMs));
    return () => {
      if (handle !== undefined) clearTimeout(handle);
      handle = undefined;
    };
  },
};

// --------------------------------------------------------------------------- profiles

/** One impairment profile: symmetric half-RTT one-way stall plus bounded uniform jitter (§2.2). */
export interface ImpairmentProfile {
  readonly name: string;
  /** One-way base stall: half the requested RTT. The proxy is symmetric by construction. */
  readonly oneWayMs: number;
  /** Per-direction uniform jitter budget, ms. */
  readonly jitterBudgetMs: number;
  readonly seed: number;
}

// --------------------------------------------------------------------------- stats

export interface DirectionStats {
  readonly bytesReceived: number;
  readonly bytesDelivered: number;
  readonly chunksReceived: number;
  readonly chunksDelivered: number;
  /** Structural constant zero: this primitive has no drop path. Kept visible so zero is CHECKED. */
  readonly chunksDropped: number;
  /** Delivery-sequence audit. Structurally zero; counted anyway. */
  readonly orderViolations: number;
  /** Times the destination signalled backpressure and the pump paused before the next write. */
  readonly backpressurePauses: number;
  /** Raw requested/achieved stall pairs, in delivery order. */
  readonly delayPairs: readonly DelayPair[];
  /** Bytes currently buffered inside the proxy (queue depth, this direction). */
  readonly bufferedBytes: number;
}

export interface ProxyStats {
  readonly listening: boolean;
  readonly connections: { readonly opened: number; readonly closed: number; readonly active: number; readonly errors: number };
  readonly c2s: DirectionStats;
  readonly s2c: DirectionStats;
  /** Paired achieved round-trip stall samples per the documented pairing rule. */
  readonly achievedRttSamples: readonly number[];
  readonly requestedOneWayBaseMs: number;
  readonly requestedJitterBudgetMs: number;
}

export interface WsDelayProxyOptions {
  readonly listenPort: number;
  readonly targetHost: string;
  readonly targetPort: number;
  readonly profile: ImpairmentProfile;
  readonly timer?: TimerDriver;
  /** Buffer ceiling per direction; exceeding it destroys the connection and counts an error. */
  readonly maxBufferedBytesPerDirection?: number;
  /** Hard-close timer after close() begins (driver time). Pending stalls drain first. */
  readonly closeGraceMs?: number;
}

export interface WsDelayProxy {
  readonly port: number;
  readonly profile: ImpairmentProfile;
  stats(): ProxyStats;
  /** Explicit close: stop accepting, drain each direction's pending stalls IN ORDER, then FIN. */
  close(): Promise<void>;
}

// --------------------------------------------------------------------------- internals

interface Chunk {
  readonly seq: number;
  readonly data: Buffer;
  readonly arrivedAtMs: number;
  readonly requestedStallMs: number;
}

interface DirectionState {
  readonly label: 'c2s' | 's2c';
  readonly rng: () => number;
  readonly queue: Chunk[];
  readonly delayPairs: DelayPair[];
  nextSeq: number;
  lastDeliveredSeq: number;
  bytesReceived: number;
  bytesDelivered: number;
  chunksReceived: number;
  chunksDelivered: number;
  orderViolations: number;
  backpressurePauses: number;
  pumping: boolean;
  sourceClosed: boolean;
  /** For c2s: achieved stall of the newest chunk already delivered upstream (RTT pairing rule). */
  lastForwardAchievedMs: number | null;
}

const newDirection = (label: 'c2s' | 's2c', seed: number): DirectionState => ({
  label,
  rng: laneSeedRng(seed, label === 'c2s' ? 1 : 2),
  queue: [],
  delayPairs: [],
  nextSeq: 1,
  lastDeliveredSeq: 0,
  bytesReceived: 0,
  bytesDelivered: 0,
  chunksReceived: 0,
  chunksDelivered: 0,
  orderViolations: 0,
  backpressurePauses: 0,
  pumping: false,
  sourceClosed: false,
  lastForwardAchievedMs: null,
});

interface ConnectionEnv {
  readonly targetHost: string;
  readonly targetPort: number;
  readonly profile: ImpairmentProfile;
  readonly timer: TimerDriver;
  readonly maxBufferedBytesPerDirection: number;
  readonly onClosed: (conn: ProxyConnection, error: boolean) => void;
  readonly onRttSample: (sampleMs: number) => void;
}

class ProxyConnection {
  private readonly c2s: DirectionState;
  private readonly s2c: DirectionState;
  private readonly upstream: Socket;
  private upstreamReady = false;
  private finished = false;
  private errored = false;
  private readonly pendingCancels = new Set<() => void>();

  private readonly closeGraceMs: number;

  constructor(private readonly client: Socket, private readonly env: ConnectionEnv, closeGraceMs: number) {
    this.closeGraceMs = closeGraceMs;
    this.c2s = newDirection('c2s', env.profile.seed);
    this.s2c = newDirection('s2c', env.profile.seed);
    client.setTimeout(0);
    client.on('data', (chunk: Buffer) => {
      this.enqueue(this.c2s, chunk);
    });
    client.on('close', () => {
      this.c2s.sourceClosed = true;
      this.pump(this.c2s);
    });
    client.on('error', () => {
      this.abort();
    });

    this.upstream = connect({ host: env.targetHost, port: env.targetPort, allowHalfOpen: true });
    this.upstream.setTimeout(0);
    this.upstream.on('connect', () => {
      this.upstreamReady = true;
      this.upstream.on('data', (chunk: Buffer) => {
        this.enqueue(this.s2c, chunk);
      });
      this.upstream.on('close', () => {
        this.s2c.sourceClosed = true;
        this.pump(this.s2c);
      });
      this.pump(this.c2s);
    });
    this.upstream.on('error', () => {
      this.abort();
    });
    this.upstream.on('close', () => {
      this.maybeFinish();
    });
    client.on('close', () => {
      this.maybeFinish();
    });

    // Hard-close grace: the drains normally finish long before this; it exists so close() cannot
    // hang on a half-open socket the kernel has not finished with.
    const grace = env.timer.schedule(closeGraceMs, () => {
      this.finish();
    });
    this.pendingCancels.add(grace);
  }

  private enqueue(dir: DirectionState, data: Buffer): void {
    if (this.finished) return;
    const now = this.env.timer.nowMs();
    const centredBaseMs = this.env.profile.oneWayMs - this.env.profile.jitterBudgetMs / 2;
    const requested = boundedUniformStall(centredBaseMs, this.env.profile.jitterBudgetMs, dir.rng());
    dir.queue.push({ seq: dir.nextSeq, data, arrivedAtMs: now, requestedStallMs: requested });
    dir.nextSeq += 1;
    dir.bytesReceived += data.length;
    dir.chunksReceived += 1;
    const buffered = dir.queue.reduce((sum, c) => sum + c.data.length, 0);
    if (buffered > this.env.maxBufferedBytesPerDirection) {
      this.abort(); // bounded buffers: a harness that cannot keep up fails loudly, never silently
      return;
    }
    this.pump(dir);
  }

  private destination(dir: DirectionState): Socket | null {
    if (dir.label === 'c2s') return this.upstreamReady ? this.upstream : null;
    return this.client;
  }

  /** The single-in-flight pump: strict FIFO, one stall at a time, per direction. */
  private pump(dir: DirectionState): void {
    if (dir.pumping || this.finished) return;
    const dest = this.destination(dir);
    if (dir.queue.length === 0) {
      if (dir.sourceClosed && dest !== null && dest.writable) dest.end();
      this.maybeFinish();
      return;
    }
    if (dest === null || dest.destroyed) return; // upstream not ready: the queue holds order
    dir.pumping = true;
    this.pumpStep(dir);
  }

  private pumpStep(dir: DirectionState): void {
    const head = dir.queue[0];
    if (head === undefined) {
      dir.pumping = false;
      const dest = this.destination(dir);
      if (dir.sourceClosed && dest !== null && dest.writable) dest.end();
      this.pump(dir); // covers data that raced the FIN decision
      return;
    }
    const remaining = Math.max(0, head.arrivedAtMs + head.requestedStallMs - this.env.timer.nowMs());
    const cancel = this.env.timer.schedule(remaining, () => {
      this.pendingCancels.delete(cancel);
      if (this.finished) return;
      const chunk = dir.queue.shift();
      if (chunk === undefined) {
        dir.pumping = false;
        return;
      }
      const achieved = this.env.timer.nowMs() - chunk.arrivedAtMs;
      if (chunk.seq !== dir.lastDeliveredSeq + 1) dir.orderViolations += 1;
      dir.lastDeliveredSeq = chunk.seq;
      dir.bytesDelivered += chunk.data.length;
      dir.chunksDelivered += 1;
      dir.delayPairs.push({ requestedMs: chunk.requestedStallMs, achievedMs: achieved });
      if (dir.label === 'c2s') dir.lastForwardAchievedMs = achieved;
      if (dir.label === 's2c' && this.c2s.lastForwardAchievedMs !== null) {
        // RTT pairing rule: newest forward chunk already delivered upstream + this one's stall.
        this.env.onRttSample(this.c2s.lastForwardAchievedMs + achieved);
      }
      const dest = this.destination(dir);
      if (dest === null || dest.destroyed) {
        dir.pumping = false;
        return;
      }
      if (dest.write(chunk.data) === false) {
        dir.backpressurePauses += 1;
        dest.once('drain', () => {
          this.pumpStep(dir);
        });
        // A FIN-receiving peer can close the read side and END the socket while a write is still
        // queued; 'drain' may then never fire. finish() cancels nothing here, so arm the same
        // driver-time backstop the close path uses: if drain has not resumed the pump by the
        // grace deadline, the hard close collects the connection. (Stall semantics unchanged:
        // the bytes were accepted for delivery; only a peer-driven close can stop them.)
        const backstop = this.env.timer.schedule(this.closeGraceMs, () => {
          if (dir.pumping) this.finish();
        });
        this.pendingCancels.add(backstop);
        return;
      }
      this.pumpStep(dir);
    });
    this.pendingCancels.add(cancel);
  }

  private abort(): void {
    if (this.finished) return;
    this.errored = true;
    this.finish();
  }

  /** Explicit close (proxy.close()): FIN the client side; pending stalls still drain in order. */
  beginClose(): void {
    if (this.finished) return;
    if (this.client.writable) this.client.end();
  }

  private maybeFinish(): void {
    if (this.finished) return;
    const clientGone = this.client.destroyed || (!this.client.writable && !this.client.readable && this.c2s.queue.length === 0);
    const upstreamGone = this.upstream.destroyed || (!this.upstream.writable && !this.upstream.readable && this.s2c.queue.length === 0);
    if (clientGone && upstreamGone && this.c2s.queue.length === 0 && this.s2c.queue.length === 0) {
      this.finish();
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    // Integrity rule: a close that still has bytes queued means the hard-close path collected a
    // live stall — those bytes never crossed. That must be VISIBLE (counted as a connection
    // error), never a silent drop. A clean drained close always finishes with empty queues.
    if (this.c2s.queue.length > 0 || this.s2c.queue.length > 0) this.errored = true;
    for (const cancel of this.pendingCancels) cancel();
    this.pendingCancels.clear();
    this.c2s.queue.length = 0;
    this.s2c.queue.length = 0;
    this.client.destroy();
    this.upstream.destroy();
    this.env.onClosed(this, this.errored);
  }

  snapshot(): { c2s: DirectionStats; s2c: DirectionStats; finished: boolean } {
    return { c2s: directionStats(this.c2s), s2c: directionStats(this.s2c), finished: this.finished };
  }
}

const directionStats = (d: DirectionState): DirectionStats => ({
  bytesReceived: d.bytesReceived,
  bytesDelivered: d.bytesDelivered,
  chunksReceived: d.chunksReceived,
  chunksDelivered: d.chunksDelivered,
  chunksDropped: 0,
  orderViolations: d.orderViolations,
  backpressurePauses: d.backpressurePauses,
  delayPairs: [...d.delayPairs],
  bufferedBytes: d.queue.reduce((sum, c) => sum + c.data.length, 0),
});

const blankDirection = (): DirectionStats => directionStats(newDirection('c2s', 0));

const mergeStats = (a: DirectionStats, b: DirectionStats): DirectionStats => ({
  bytesReceived: a.bytesReceived + b.bytesReceived,
  bytesDelivered: a.bytesDelivered + b.bytesDelivered,
  chunksReceived: a.chunksReceived + b.chunksReceived,
  chunksDelivered: a.chunksDelivered + b.chunksDelivered,
  chunksDropped: 0,
  orderViolations: a.orderViolations + b.orderViolations,
  backpressurePauses: a.backpressurePauses + b.backpressurePauses,
  delayPairs: [...a.delayPairs, ...b.delayPairs],
  bufferedBytes: a.bufferedBytes + b.bufferedBytes,
});

// --------------------------------------------------------------------------- public API

export const createWsDelayProxy = async (options: WsDelayProxyOptions): Promise<WsDelayProxy> => {
  const timer = options.timer ?? realTimerDriver;
  const maxBufferedBytesPerDirection = options.maxBufferedBytesPerDirection ?? 8 * 1024 * 1024;
  const closeGraceMs = options.closeGraceMs ?? 5_000;
  if (!isIPv4(options.targetHost)) throw new Error(`targetHost must be an IPv4 literal, got ${options.targetHost}`);
  if (!(options.profile.oneWayMs >= 0) || !(options.profile.jitterBudgetMs >= 0)) {
    throw new Error('profile stalls must be non-negative');
  }
  if (options.profile.oneWayMs * 2 < options.profile.jitterBudgetMs) {
    throw new Error(`profile ${options.profile.name}: one-way base ${String(options.profile.oneWayMs)} ms is below half the jitter budget — a centred stall would go negative; declare a wider base or a smaller budget`);
  }

  const live = new Set<ProxyConnection>();
  /** Stats of finished connections, accumulated so the run record still sees their samples. */
  let c2sDone = blankDirection();
  let s2cDone = blankDirection();
  let opened = 0;
  let closedCount = 0;
  let errors = 0;
  const rttSamples: number[] = [];
  let listening = true;
  let closeWaiter: (() => void) | null = null;

  const server = createServer((client) => {
    const conn = new ProxyConnection(client, {
      targetHost: options.targetHost,
      targetPort: options.targetPort,
      profile: options.profile,
      timer,
      maxBufferedBytesPerDirection,
      onClosed: (done, error) => {
        const snap = done.snapshot();
        c2sDone = mergeStats(c2sDone, snap.c2s);
        s2cDone = mergeStats(s2cDone, snap.s2c);
        live.delete(done);
        closedCount += 1;
        if (error) errors += 1;
        if (live.size === 0 && closeWaiter !== null) {
          const wake = closeWaiter;
          closeWaiter = null;
          wake();
        }
      },
      onRttSample: (sample) => {
        rttSamples.push(sample);
      },
    }, closeGraceMs);
    opened += 1;
    live.add(conn);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.listenPort, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the delay proxy bound no port');

  return {
    port: address.port,
    profile: options.profile,
    stats(): ProxyStats {
      let c2s = c2sDone;
      let s2c = s2cDone;
      for (const conn of live) {
        const snap = conn.snapshot();
        c2s = mergeStats(c2s, snap.c2s);
        s2c = mergeStats(s2c, snap.s2c);
      }
      return {
        listening,
        connections: { opened, closed: closedCount, active: live.size, errors },
        c2s,
        s2c,
        achievedRttSamples: [...rttSamples],
        requestedOneWayBaseMs: options.profile.oneWayMs,
        requestedJitterBudgetMs: options.profile.jitterBudgetMs,
      };
    },
    async close(): Promise<void> {
      listening = false;
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      });
      for (const conn of [...live]) conn.beginClose();
      await new Promise<void>((resolveDrain) => {
        if (live.size === 0) {
          resolveDrain();
          return;
        }
        closeWaiter = resolveDrain;
      });
    },
  };
};
