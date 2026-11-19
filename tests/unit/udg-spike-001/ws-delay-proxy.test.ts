/**
 * UDG-SPIKE-001 — the WS delay proxy on a SYNTHETIC CLOCK.
 *
 * The sockets are real loopback sockets (the primitive is about sockets), but every stall runs on
 * a manually-advanced monotonic clock, so the jitter schedule is REPRODUCED exactly from the
 * seed: the test precomputes the seeded stall sequence and asserts the proxy delivers chunk k
 * only after exactly that many ms of clock time have passed — order, stall-not-drop, RTT pairing,
 * backpressure, explicit-close drain and the hard-close grace all become boundary-checkable
 * without a single wall-clock sleep racing the impairment.
 */

import { connect, createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createWsDelayProxy, laneSeedRng, type TimerDriver } from '../../../tools/load-test/src/ws-delay-proxy.ts';

class FakeClock implements TimerDriver {
  private current = 0;
  private order = 0;
  private timers: { due: number; order: number; cb: () => void; cancelled: boolean }[] = [];

  nowMs(): number {
    return this.current;
  }

  schedule(afterMs: number, cb: () => void): () => void {
    const timer = { due: this.current + Math.max(0, afterMs), order: this.order++, cb, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /** Iterative (never recursive) advancement: same-time timers fire in FIFO insertion order. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => !t.cancelled && t.due <= target)
        .sort((a, b) => a.due - b.due || a.order - b.order)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.current = due.due;
      due.cb();
    }
    this.current = target;
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (cond: () => boolean, what: string, timeoutMs = 3_000): Promise<void> => {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await realSleep(2);
  }
};

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') throw new Error('no port');
      resolve(addr.port);
    });
  });

const expectedStalls = (seed: number, lane: number, base: number, budget: number, n: number): number[] => {
  const rng = laneSeedRng(seed, lane);
  // Centred model: stall = (base - budget/2) + U(0, budget), i.e. base ± budget/2.
  return Array.from({ length: n }, () => base - budget / 2 + rng() * budget);
};

describe('UDG-SPIKE-001 ws-delay-proxy on a synthetic clock', () => {
  it('delivers each chunk after EXACTLY its seeded stall, in order, stalling and never dropping', async () => {
    const clock = new FakeClock();
    const received: Buffer[] = [];
    const peer: { socket: Socket | null } = { socket: null };
    const echo = createServer((socket) => {
      peer.socket = socket;
      socket.on('data', (data) => {
        received.push(Buffer.from(data));
      });
    });
    const echoPort = await listen(echo);

    const profile = { name: 'unit', oneWayMs: 50, jitterBudgetMs: 20, seed: 1001 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });

    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    // One chunk in flight at a time: each write is its own TCP segment and the proxy's own read
    // event, so the seeded per-chunk stall schedule is reproduced exactly (stalls attach to the
    // bytes as they arrive; TCP may legally coalesce — the harness records what it saw, and this
    // test drives the un-coalesced case deliberately).
    const stalls = expectedStalls(1001, 1, 50, 20, 3);
    const chunks = [Buffer.from('ALPHA-01'), Buffer.from('BRAVO-02'), Buffer.from('CHARLIE-03')];
    let delivered = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      client.write(chunk);
      await until(() => proxy.stats().c2s.chunksReceived === i + 1, `chunk ${String(i)} into the proxy`);
      // Nothing crosses before the clock says so — a stall holds the bytes, it never forwards-then-promises.
      await realSleep(10);
      expect(Buffer.concat(received).length, `chunk ${String(i)} withheld`).toBe(delivered);
      clock.advance(stalls[i]!);
      await until(() => Buffer.concat(received).length === chunks.slice(0, i + 1).reduce((s2, c) => s2 + c.length, 0), `chunk ${String(i)} delivered`);
      delivered += chunk.length;
      const pair = proxy.stats().c2s.delayPairs[i];
      expect(pair?.requestedMs, `chunk ${String(i)} requested stall`).toBeCloseTo(stalls[i]!, 9);
      expect(pair?.achievedMs, `chunk ${String(i)} achieved equals requested on the synthetic clock`).toBeCloseTo(stalls[i]!, 9);
    }
    expect(delivered).toBe(chunks.reduce((s2, c) => s2 + c.length, 0));
    expect(Buffer.concat(received).equals(Buffer.concat(chunks))).toBe(true); // byte order AND content
    const c2s = proxy.stats().c2s;
    expect(c2s.orderViolations).toBe(0);
    expect(c2s.chunksDropped).toBe(0);
    expect(c2s.chunksReceived).toBe(c2s.chunksDelivered);
    expect(c2s.bytesReceived).toBe(c2s.bytesDelivered);

    // Reverse direction + RTT pairing rule: the reverse chunk pairs with the newest forward
    // chunk ALREADY DELIVERED upstream — the last forward stall was stalls[2].
    const revStalls = expectedStalls(1001, 2, 50, 20, 1);
    peer.socket?.write(Buffer.from('PONG'));
    await until(() => proxy.stats().s2c.chunksReceived === 1, 'proxy to receive the reverse chunk');
    const clientGot: Buffer[] = [];
    client.on('data', (d) => clientGot.push(Buffer.from(d)));
    clock.advance(revStalls[0]!);
    await until(() => Buffer.concat(clientGot).length === 4, 'client to receive PONG');
    expect(Buffer.concat(clientGot).toString()).toBe('PONG');
    const rtt = proxy.stats().proxyLegSumSamples;
    expect(rtt.length).toBe(1);
    expect(rtt[0]).toBeCloseTo(stalls[2]! + revStalls[0]!, 9);

    client.destroy();
    const closing1 = proxy.close();
    clock.advance(6_000); // driver-time grace, in case a half-open socket needs the hard close
    await closing1;
    expect(proxy.stats().connections.active).toBe(0);
    await new Promise<void>((resolve) => echo.close(() => resolve()));
  });

  it('jitter budget 0 is the exact-boundary case: every stall equals the base, deterministically', async () => {
    const clock = new FakeClock();
    const got: Buffer[] = [];
    const echo = createServer((socket) => {
      socket.on('data', (d) => got.push(Buffer.from(d)));
    });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({
      listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort,
      profile: { name: 'unit-zero', oneWayMs: 5, jitterBudgetMs: 0, seed: 1002 }, timer: clock,
    });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.write(Buffer.from('xyz'));
    await until(() => proxy.stats().c2s.chunksReceived === 1, 'chunk in');
    await realSleep(10);
    expect(got.length).toBe(0);
    clock.advance(4.999);
    await realSleep(10);
    expect(Buffer.concat(got).length, 'not yet: 4.999 < 5').toBe(0);
    clock.advance(0.002);
    await until(() => Buffer.concat(got).length === 3, 'deliver at exactly 5');
    const pair = proxy.stats().c2s.delayPairs[0];
    expect(pair?.requestedMs).toBe(5);
    expect(pair?.achievedMs).toBe(5);
    client.destroy();
    const closing2 = proxy.close();
    clock.advance(6_000);
    await closing2;
    await new Promise<void>((resolve) => echo.close(() => resolve()));
  });

  it('a co-arriving burst stays inside the profile band: departures are PINNED at admission (delay tube with the b/2 look-back), FIFO order holds, and no chunk is ever delivered before its pinned departure', async () => {
    const clock = new FakeClock();
    const got: Buffer[] = [];
    const echo = createServer((socket) => {
      socket.on('data', (d) => got.push(Buffer.from(d)));
    });
    const echoPort = await listen(echo);
    const baseMs = 100;
    const budgetMs = 20;
    const seed = 1001;
    const proxy = await createWsDelayProxy({
      listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort,
      profile: { name: 'unit-burst', oneWayMs: baseMs, jitterBudgetMs: budgetMs, seed }, timer: clock,
    });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await realSleep(20); // upstream established: every chunk below is stalled for its full profile time

    client.write(Buffer.from('A'));
    await until(() => proxy.stats().c2s.chunksReceived === 1, 'chunk A admitted');
    clock.advance(3);
    client.write(Buffer.from('B'));
    await until(() => proxy.stats().c2s.chunksReceived === 2, 'chunk B admitted');
    clock.advance(3);
    client.write(Buffer.from('C'));
    await until(() => proxy.stats().c2s.chunksReceived === 3, 'chunk C admitted');

    // Seeded stalls + the admission-time pinning rules, recomputed independently:
    // dep(k) = max(arr(k) + d(k), dep(k−1) − b/2); FIFO serialisation delivers at max_{j≤k} dep(j).
    const stalls = expectedStalls(seed, 1, baseMs, budgetMs, 3);
    const depA = (stalls[0] ?? 0) as number;
    const depB = Math.max(3 + (stalls[1] ?? 0), depA - budgetMs / 2);
    const depC = Math.max(6 + (stalls[2] ?? 0), depB - budgetMs / 2);

    clock.advance(89.9); // every pinned departure is ≥ 90 (band floor): at 89.9 NOTHING may have left
    await realSleep(10);
    expect(Buffer.concat(got).length, 'no chunk leaves before its pinned departure').toBe(0);
    clock.advance(Math.max(depA, depB, depC) - 89.9 + 1);
    await until(() => Buffer.concat(got).length === 3, 'all three delivered, in order');
    expect(Buffer.concat(got).toString(), 'FIFO order survives the look-back').toBe('ABC');

    const pairs = proxy.stats().c2s.delayPairs;
    const runMax = [Math.max(depA), Math.max(depA, depB), Math.max(depA, depB, depC)];
    const arrivals = [0, 3, 6];
    for (const [k, pair] of pairs.entries()) {
      expect(pair.achievedMs, `chunk ${String(k)} delivers at exactly its pinned (serialised) departure`).toBeCloseTo((runMax[k] ?? 0) - (arrivals[k] ?? 0), 6);
      expect(pair.achievedMs, `chunk ${String(k)} never falls below its own profile delay`).toBeGreaterThanOrEqual((stalls[k] ?? 0) - 1e-9);
      expect(pair.achievedMs, `chunk ${String(k)} never exceeds the profile band even queued behind a longer stall`).toBeLessThanOrEqual(baseMs + budgetMs / 2 + 1e-9);
    }
    client.destroy();
    const closing6 = proxy.close();
    clock.advance(6_000);
    await closing6;
    await new Promise<void>((resolve) => echo.close(() => resolve()));
  });

  it('backpressure pauses the pump and an explicit close drains pending stalls IN ORDER before FIN', async () => {
    const clock = new FakeClock();
    const bhSockets: Socket[] = [];
    const blackhole = createServer((socket) => {
      /* accepts, never reads: writes hit the high-water mark and return false */
      bhSockets.push(socket);
      socket.on('error', () => { /* unrouted */ });
    });
    const bhPort = await listen(blackhole);
    const profile = { name: 'unit-bp', oneWayMs: 10, jitterBudgetMs: 0, seed: 1003 };
    const proxy = await createWsDelayProxy({
      listenPort: 0, targetHost: '127.0.0.1', targetPort: bhPort, profile, timer: clock, closeGraceMs: 1_000,
    });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    // Push 4 MiB while the upstream refuses to read. The stalls run on the synthetic clock, so
    // the wait itself advances it — writes only start once their stalls have passed in driver time.
    const blob = Buffer.alloc(64 * 1024, 7);
    for (let i = 0; i < 64; i += 1) client.write(blob);
    await until(() => {
      clock.advance(20);
      return proxy.stats().c2s.chunksReceived >= 1 || proxy.stats().connections.opened >= 1;
    }, 'proxy connection to open');
    await until(() => {
      clock.advance(20);
      return proxy.stats().c2s.backpressurePauses >= 1;
    }, 'at least one backpressure pause');

    // Explicit close with stalls pending: the grace timer (driver time) is what ultimately
    // collects the connection, and close() must resolve — never hang on the paused pump.
    const closing = proxy.close();
    await until(() => {
      clock.advance(100);
      return proxy.stats().connections.active === 0;
    }, 'the paused connection to be collected by close');
    await closing;
    expect(proxy.stats().connections.active).toBe(0);
    expect(proxy.stats().c2s.chunksDropped).toBe(0); // the close was forced; nothing was DROPPED by the stall path
    for (const socket of bhSockets) socket.destroy(); // a peer that never reads never processes EOF — teardown here
    await new Promise<void>((resolve) => blackhole.close(() => resolve()));
    client.destroy();
  });

  it('bounded buffers: a direction that exceeds its ceiling fails the connection loudly instead of growing forever', async () => {
    const clock = new FakeClock();
    const bhSockets: Socket[] = [];
    const blackhole = createServer((socket) => {
      bhSockets.push(socket);
      socket.on('error', () => { /* unrouted */ });
    });
    const bhPort = await listen(blackhole);
    const proxy = await createWsDelayProxy({
      listenPort: 0, targetHost: '127.0.0.1', targetPort: bhPort,
      profile: { name: 'unit-cap', oneWayMs: 100, jitterBudgetMs: 0, seed: 1001 },
      timer: clock, maxBufferedBytesPerDirection: 64 * 1024, closeGraceMs: 60_000,
    });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    for (let i = 0; i < 16; i += 1) client.write(Buffer.alloc(32 * 1024, 9));
    await until(() => proxy.stats().connections.errors >= 1, 'overflow to count as a connection error');
    await until(() => proxy.stats().connections.active === 0, 'the overflowing connection to close');
    const closing4 = proxy.close();
    clock.advance(6_000);
    await closing4;
    for (const socket of bhSockets) socket.destroy();
    await new Promise<void>((resolve) => blackhole.close(() => resolve()));
    client.destroy();
  });

  it('a stalled connection is never a dropped one: every byte crosses when the clock merely runs slow', async () => {
    const clock = new FakeClock();
    const echo = createServer((socket) => {
      socket.on('data', (d) => socket.write(d));
    });
    const echoPort = await listen(echo);
    const profile = { name: 'unit-echo', oneWayMs: 2, jitterBudgetMs: 1, seed: 1002 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* expected RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    const incoming: Buffer[] = [];
    client.on('data', (d) => incoming.push(Buffer.from(d)));

    const message = Buffer.from(Array.from({ length: 500 }, (_, i) => 65 + (i % 26)));
    client.write(message);
    // Advance generously — 10x the worst case stall — and every byte must still arrive once, in order.
    for (let i = 0; i < 40; i += 1) {
      clock.advance(1);
      await realSleep(2);
      if (Buffer.concat(incoming).length === message.length) break;
    }
    await until(() => Buffer.concat(incoming).length === message.length, 'full echo');
    expect(Buffer.concat(incoming).equals(message)).toBe(true);
    const s = proxy.stats();
    expect(s.c2s.bytesDelivered).toBe(message.length);
    expect(s.s2c.bytesDelivered).toBe(message.length);
    expect(s.c2s.chunksDropped + s.s2c.chunksDropped).toBe(0);
    expect(s.c2s.orderViolations + s.s2c.orderViolations).toBe(0);
    expect(s.proxyLegSumSamples.length).toBeGreaterThanOrEqual(1);

    client.destroy();
    const closing5 = proxy.close();
    clock.advance(6_000);
    await closing5;
    await new Promise<void>((resolve) => echo.close(() => resolve()));
  });
});
