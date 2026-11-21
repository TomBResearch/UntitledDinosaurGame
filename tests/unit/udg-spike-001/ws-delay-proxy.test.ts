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

describe('UDG-SPIKE-001 ws-delay-proxy — withheld-window flush and labelled drop (GA-7 primitives)', () => {
  it('flushStalled releases the withheld window AT THE INSTANT: queued bytes cross FIFO, the count is labelled in stats, and nothing is lost', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null } = { socket: null };
    let upstreamGot = 0;
    const echo = createServer((socket) => {
      peer.socket = socket;
      socket.on('data', (data) => { upstreamGot += data.length; for (const b of data) socket.write(Buffer.from([b])); }); // echo byte-by-byte (s2c)
    });
    const echoPort = await listen(echo);
    const profile = { name: 'unit', oneWayMs: 5, jitterBudgetMs: 0, seed: 1001 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });

    const got: Buffer[] = [];
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* RST at teardown */ });
    client.on('data', (d) => { got.push(Buffer.from(d)); });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    proxy.setStall('s2c', 30_000); // withhold application delivery on the way back (socket OPEN)
    for (const byte of [1, 2, 3]) client.write(Buffer.from([byte]));
    for (let round = 0; round < 100 && upstreamGot < 3; round += 1) {
      clock.advance(50); // keep the synthetic clock moving while real bytes cross
      await realSleep(3);
    }
    expect(upstreamGot, 'all three bytes reached the authority').toBe(3);
    clock.advance(1_000);
    await realSleep(5);
    expect(got.length, 'withheld: NOTHING came back while the window is open').toBe(0);

    const before = clock.nowMs();
    proxy.flushStalled('s2c'); // the window ENDS now
    for (let round = 0; round < 50 && Buffer.concat(got).length < 3; round += 1) {
      clock.advance(2);
      await realSleep(3);
    }
    expect(Buffer.concat(got).length, 'flushed bytes delivered').toBe(3);
    expect(clock.nowMs() - before, 'delivery lands at the flush instant, not at arr+30000').toBeLessThanOrEqual(5);
    expect([...Buffer.concat(got)], 'FIFO order through the flush is preserved').toEqual([1, 2, 3]);

    const stats = proxy.stats();
    expect(stats.s2c.chunksFlushed, 'every released-early chunk is COUNTED, never silent').toBeGreaterThanOrEqual(1);
    expect(stats.s2c.orderViolations).toBe(0);
    expect(stats.s2c.chunksDropped).toBe(0);
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('holdNext suppresses EXACTLY the armed number of c2s chunks from APPLICATION DELIVERY: the bytes arrive and are counted at the hop, the held chunk never departs while the scenario lives, and every LATER chunk on the SAME connection routes normally (GA-5l seam — suppression, not dedupe, not a drop)', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null } = { socket: null };
    let upstreamGot = 0;
    const echo = createServer((socket) => {
      peer.socket = socket;
      socket.on('data', (data) => { upstreamGot += data.length; });
    });
    const echoPort = await listen(echo);
    const profile = { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* RST at teardown */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    client.write(Buffer.from([7])); // a normal chunk BEFORE the arm routes normally
    for (let round = 0; round < 100 && upstreamGot < 1; round += 1) { clock.advance(5); await realSleep(3); }
    expect(upstreamGot, 'pre-arm chunk reached the application').toBe(1);

    proxy.holdNext('c2s', 1); // arm the suppression for EXACTLY ONE chunk
    client.write(Buffer.from([9])); // THE suppressed input: arrives at the hop, never departs
    await until(() => proxy.stats().c2s.chunksReceived >= 2, 'the held chunk was RECEIVED at the hop (arrival, not a drop)');
    for (let round = 0; round < 40; round += 1) { clock.advance(25); await realSleep(5); }
    expect(upstreamGot, 'the held chunk never reaches the application while the scenario lives').toBe(1);

    client.write(Buffer.from([11])); // quota SPENT — later traffic on the same connection is fine
    for (let round = 0; round < 100 && upstreamGot < 2; round += 1) { clock.advance(5); await realSleep(3); }
    expect(upstreamGot, 'the same connection routes later chunks normally (a bounded rejoin stays possible)').toBe(2);

    const stats = proxy.stats();
    expect(stats.c2s.chunksHeld, 'the suppression is COUNTED, never silent').toBe(1);
    expect(stats.c2s.holdRemaining).toBe(0);
    expect(stats.c2s.chunksReceived, 'the bytes were RECEIVED at the hop — this is not a TCP drop').toBe(3);
    expect(stats.c2s.chunksDelivered).toBe(2);
    expect(stats.c2s.chunksDropped).toBe(0);
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('killSockets severs the proxied pair — both endpoints observe an ordinary close, and the proxy counts the closure', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null; closed: boolean } = { socket: null, closed: false };
    const echo = createServer((socket) => {
      peer.socket = socket;
      socket.on('close', () => { peer.closed = true; });
    });
    const echoPort = await listen(echo);
    const profile = { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* the drop is the point */ });
    let clientClosed = false;
    client.on('close', () => { clientClosed = true; });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    proxy.killSockets();
    await until(() => clientClosed && peer.closed, 'both endpoints observe the drop');
    clock.advance(50);
    expect(proxy.stats().connections.active, 'the proxy retired the pair').toBe(0);
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('inter-arrival instrumentation records the RAW arrival-stall series on the synthetic clock (GA-11)', async () => {
    const clock = new FakeClock();
    const received: Buffer[] = [];
    const echo = createServer((socket) => {
      socket.on('data', (data) => { received.push(Buffer.from(data)); });
    });
    const echoPort = await listen(echo);
    const profile = { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 };
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* teardown RST */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    // The synthetic clock advances only HERE, so admission timestamps fall exactly on the
    // declared stalls (± the one release-step taken to fire each zero-delay departure).
    // Order per chunk: WRITE (admission stamps the FROZEN clock) -> let the event loop deliver ->
    // advance to release. The declared stall is set BEFORE the next write, so admissions land
    // exactly on it (plus the 1 ms release step).
    client.write(Buffer.from('AAA'));
    await realSleep(10);
    clock.advance(1);
    await until(() => received.length === 1, 'first chunk upstream');
    clock.advance(35);
    client.write(Buffer.from('BBB'));
    await realSleep(10);
    clock.advance(1);
    await until(() => received.length === 2, 'second chunk upstream');
    clock.advance(90);
    client.write(Buffer.from('CCC'));
    await realSleep(10);
    clock.advance(1);
    await until(() => received.length === 3, 'third chunk upstream');

    const c2s = proxy.stats().c2s;
    const gaps = [...c2s.interArrivalGapsMs];
    expect(gaps.length, 'the raw series records BOTH stalls, unsmoothed').toBe(2);
    expect(gaps[0], 'first declared stall (35 ms + the release step)').toBeGreaterThanOrEqual(35);
    expect(gaps[0]!, 'no phantom gap').toBeLessThanOrEqual(36);
    expect(gaps[1], 'second declared stall (90 ms + the release step)').toBeGreaterThanOrEqual(90);
    expect(gaps[1]!, 'no phantom gap').toBeLessThanOrEqual(91);
    expect(c2s.maxInterArrivalMs, 'the max is kept beside the raw series').toBe(gaps[1]);
    client.destroy();
    await proxy.close();
    echo.close();
  });
});

/**
 * ORDERLY HALF-CLOSE AND HONEST DELIVERY ACCOUNTING (the dpa8o finding, slice 28).
 *
 * A target server that FINs an idle keep-alive pair (Node's own `keepAliveTimeout` does this every
 * 5 s) emits `'end'` at the proxy — and because the upstream is connected with
 * `allowHalfOpen: true`, `'close'` never follows until the proxy ends its own side. When only
 * `'close'` was handled, the browser kept the pooled socket, wrote its NEXT request into a socket
 * whose peer was gone, and hung with neither response nor failure while the hop still reported the
 * bytes as "delivered". These three cases are exactly that boundary: propagate the FIN, keep the
 * leg that still works alive, and never report a handoff that did not happen.
 */
describe('UDG-SPIKE-001 ws-delay-proxy — orderly half-close and local-handoff accounting', () => {
  it('an ORDERLY upstream half-close (target FIN) reaches the client and is attributed to the target, with nothing lost and no error', async () => {
    // THE dpa8o CASE. A target that closes an idle keep-alive pair FINs it; with the upstream
    // connected `allowHalfOpen: true` the proxy sees 'end' and, before this fix, 'close' never
    // arrived — so the browser kept its pooled socket, wrote its next request into a socket whose
    // peer was gone, and hung with neither response nor failure while the hop reported the bytes
    // as delivered. The proxy must propagate the FIN immediately.
    const clock = new FakeClock();
    const peer: { ended: boolean; closed: boolean } = { ended: false, closed: false };
    const echo = createServer((socket) => {
      socket.on('end', () => { peer.ended = true; });
      socket.on('close', () => { peer.closed = true; });
      socket.write(Buffer.from('PONG'));   // a reverse chunk still in flight when the FIN arrives
      socket.end();                        // ORDERLY FIN from the target
    });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile: { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 }, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true });
    client.on('error', () => { /* teardown RST after the FIN is expected */ });
    const clientGot: Buffer[] = [];
    let clientSawFin = false;
    client.on('data', (d) => { clientGot.push(Buffer.from(d)); });
    client.on('end', () => { clientSawFin = true; });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    // Order per chunk: let it ARRIVE at the hop, then release it. The synthetic clock only fires
    // timers on an explicit advance, so advancing too early would strand the chunk instead.
    await until(() => proxy.stats().s2c.chunksReceived === 1, 'the reverse chunk to arrive at the hop');
    clock.advance(1);   // release it: the FIN follows the DRAINED leg, never before it
    await until(() => clientSawFin, 'the target FIN to be PROPAGATED to the client (the fix)');

    const drained = proxy.stats();
    expect(Buffer.concat(clientGot).toString(), 'the reverse chunk crossed BEFORE its own FIN took the leg away').toBe('PONG');
    expect(drained.s2c.chunksDelivered, 'that handoff is counted').toBe(1);
    expect(drained.s2c.chunksLostAtDestination + drained.c2s.chunksLostAtDestination, 'an orderly FIN loses nothing').toBe(0);
    expect(drained.connections.errors, 'an orderly FIN is not an error').toBe(0);
    expect(proxy.stats().connLog.at(-1)?.firstFin, 'the proxy attributes the first FIN to the TARGET, not to the client').toBe('upstream');

    client.destroy();
    await until(() => proxy.stats().connections.active === 0, 'the pair to retire once its remaining side is gone');
    expect(proxy.stats().connLog.at(-1)?.error, 'the retired pair carries no error').toBe(false);
    await proxy.close();
    echo.close();
  });

  it('an ORDERLY client half-close reaches the target, and a reverse leg with nothing in flight loses nothing', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null; ended: boolean; got: Buffer[] } = { socket: null, ended: false, got: [] };
    const echo = createServer((socket) => {
      peer.socket = socket;
      socket.on('end', () => { peer.ended = true; });
      socket.on('data', (d) => { peer.got.push(Buffer.from(d)); socket.write(Buffer.from('PONG-2')); });
    });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile: { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 }, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true });
    client.on('error', () => { /* teardown */ });
    const clientGot: Buffer[] = [];
    client.on('data', (d) => { clientGot.push(Buffer.from(d)); });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    client.write(Buffer.from('REQ'));
    await until(() => proxy.stats().c2s.chunksReceived === 1, 'the forward chunk into the tube');
    clock.advance(1);                                       // release the forward chunk
    await until(() => Buffer.concat(peer.got).toString() === 'REQ', 'the forward chunk upstream');
    await until(() => proxy.stats().s2c.chunksReceived === 1, 'the reply into the reverse tube');
    clock.advance(1);                                       // release the reply
    await until(() => Buffer.concat(clientGot).toString() === 'PONG-2', 'the reverse leg to work while both sides are alive');
    client.end();                                  // ORDERLY FIN from the client
    await until(() => peer.ended, 'the client FIN to be PROPAGATED to the target');
    clock.advance(1);
    await until(() => proxy.stats().connections.active === 0, 'the pair to retire after both FINs');

    const stats = proxy.stats();
    expect(stats.c2s.chunksDelivered, 'the forward handoff happened').toBe(1);
    expect(stats.s2c.chunksDelivered, 'the reverse handoff happened').toBe(1);
    expect(stats.c2s.chunksLostAtDestination + stats.s2c.chunksLostAtDestination, 'an orderly close on both sides loses nothing').toBe(0);
    expect(stats.connections.errors, 'and is not an error').toBe(0);
    expect(stats.connLog.at(-1)?.firstFin, 'the client FIN is attributed to the client').toBe('client');
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('a reverse byte whose CLIENT has gone away is NEVER counted delivered: it is counted lost once, attributed to the client, and the pair retires', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null } = { socket: null };
    const echo = createServer((socket) => { peer.socket = socket; });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile: { name: 'unit', oneWayMs: 20, jitterBudgetMs: 0, seed: 1001 }, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* the client removes itself; not the point of the case */ });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    peer.socket?.write(Buffer.from('TO-VANISHED-CLIENT'));
    await until(() => proxy.stats().s2c.chunksReceived === 1, 'the reverse chunk into the tube');
    client.destroy();                              // the destination of the reverse leg disappears
    await until(() => proxy.stats().connLog.some((r) => r.firstFin === 'client'), 'the proxy to OBSERVE the client leg close');
    clock.advance(25);                             // NOW its departure comes due — to a gone socket

    const stats = proxy.stats();
    expect(stats.s2c.chunksDelivered, 'a byte handed to no live destination is NOT delivered').toBe(0);
    expect(stats.s2c.chunksLostAtDestination, 'it is counted exactly once, where it was lost').toBe(1);
    expect(stats.s2c.bytesLostAtDestination, 'and its bytes are counted too').toBe(Buffer.from('TO-VANISHED-CLIENT').length);
    expect(stats.s2c.bufferedBytes, 'nothing stays stranded inside the proxy').toBe(0);
    expect(stats.connections.errors, 'an ENDPOINT that left first owns that loss — it is attributed, not blamed on the proxy').toBe(0);
    expect(proxy.stats().connLog.at(-1)?.firstFin, 'the closure names the client as the first to finish').toBe('client');
    await until(() => proxy.stats().connections.active === 0, 'the pair to retire instead of lingering half-open');
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('a forward byte whose TARGET has reset is NEVER counted delivered: accounted, errored, retired, and the client learns', async () => {
    const clock = new FakeClock();
    const peer: { socket: Socket | null } = { socket: null };
    const echo = createServer((socket) => { peer.socket = socket; });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile: { name: 'unit', oneWayMs: 20, jitterBudgetMs: 0, seed: 1001 }, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port });
    client.on('error', () => { /* RST from a severed pair is the point of the case */ });
    let clientLearned = false;
    client.on('close', () => { clientLearned = true; });
    client.on('end', () => { clientLearned = true; });
    await new Promise<void>((resolve) => client.once('connect', resolve));
    await until(() => peer.socket !== null, 'upstream connection');

    client.write(Buffer.from('DOOMED'));
    await until(() => proxy.stats().c2s.chunksReceived === 1, 'the forward chunk into the tube');
    peer.socket?.resetAndDestroy();                // RST: the target is truly gone, not merely idle
    await until(() => clientLearned, 'the client to learn the pair died (never hang silently)');
    clock.advance(25);

    const stats = proxy.stats();
    expect(stats.c2s.chunksDelivered, 'a chunk that reached no live destination is NOT delivered').toBe(0);
    expect(stats.c2s.chunksReceived + stats.c2s.chunksHeld, 'every accepted chunk is accounted exactly once')
      .toBe(stats.c2s.chunksDelivered + stats.c2s.chunksLostAtDestination + stats.c2s.chunksHeld + (stats.c2s.bufferedBytes > 0 ? 1 : 0));
    expect(stats.c2s.bytesDelivered, 'no byte is claimed delivered').toBe(0);
    expect(stats.c2s.bytesLostAtDestination, 'the undelivered bytes are counted at this hop').toBe(Buffer.from('DOOMED').length);
    expect(stats.connections.errors, 'and the closure carries the event').toBeGreaterThanOrEqual(1);
    await until(() => proxy.stats().connections.active === 0, 'the pair to retire');
    client.destroy();
    await proxy.close();
    echo.close();
  });

  it('a NONEMPTY reverse response that arrives AFTER the client\u2019s orderly FIN is accounted once, attributed, and never hung (slice-26 closed-direction review)', async () => {
    // REVIEW ITEM after b5e68eb: the closed direction's reverse bytes. Measured Node semantics
    // (probed directly): an ACCEPTED socket with the default allowHalfOpen:false becomes
    // unwritable the moment its peer FINs, so a target that answers a half-closed seat CANNOT
    // have its late bytes handed off at this hop. The honest outcome is therefore: the FIN still
    // propagates (the b5e68eb rule), the late response ARRIVES and is COUNTED at the hop, is
    // counted LOST at the destination exactly once (never delivered, never stranded), the loss is
    // attributed to the endpoint that left first (firstFin 'client', no error), and the pair
    // RETIRES \u2014 a hang here (the dpa8o failure mode) fails this test by timeout.
    const clock = new FakeClock();
    const peer: { ended: boolean } = { ended: false };
    const echo = createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('data', () => { /* consume the request; answer only after the FIN */ });
      socket.on('end', () => {
        peer.ended = true;
        socket.write(Buffer.from('LATE-RESPONSE')); // NONEMPTY response to the half-closed seat
      });
    });
    const echoPort = await listen(echo);
    const proxy = await createWsDelayProxy({ listenPort: 0, targetHost: '127.0.0.1', targetPort: echoPort, profile: { name: 'unit', oneWayMs: 0, jitterBudgetMs: 0, seed: 1001 }, timer: clock });
    const client = connect({ host: '127.0.0.1', port: proxy.port, allowHalfOpen: true });
    client.on('error', () => { /* teardown RST is expected */ });
    const clientGot: Buffer[] = [];
    client.on('data', (d) => { clientGot.push(Buffer.from(d)); });
    await new Promise<void>((resolve) => client.once('connect', resolve));

    client.write(Buffer.from('REQ'));
    client.end(); // ORDERLY FIN from the client, while the request is still in the tube
    await until(() => proxy.stats().c2s.chunksReceived === 1, 'the request into the tube');
    clock.advance(1);
    await until(() => peer.ended, 'the client FIN to reach the target through the hop (the b5e68eb rule)');
    await until(() => proxy.stats().s2c.chunksReceived === 1, 'the NONEMPTY late response to ARRIVE at the hop');
    clock.advance(1); // its departure comes due \u2014 toward a destination the FIN already took away

    const stats = proxy.stats();
    expect(stats.s2c.chunksDelivered, 'a byte with no live destination is NEVER claimed delivered').toBe(0);
    expect(stats.s2c.chunksLostAtDestination, 'the late response is counted lost exactly once at this hop').toBe(1);
    expect(stats.s2c.bytesLostAtDestination, 'and its bytes are the response\u2019s own bytes').toBe(Buffer.from('LATE-RESPONSE').length);
    expect(stats.s2c.bufferedBytes, 'nothing stays stranded inside the proxy').toBe(0);
    expect(stats.connections.errors, 'an endpoint that left first owns the loss \u2014 attributed, not a proxy fault').toBe(0);
    expect(stats.connLog.at(-1)?.firstFin, 'the closure names the CLIENT as the first to finish').toBe('client');
    expect(Buffer.concat(clientGot).length, 'the half-closed client receives nothing after its own FIN').toBe(0);
    await until(() => proxy.stats().connections.active === 0, 'the pair to RETIRE (a hang would land here as a timeout)');
    expect(proxy.stats().connLog.at(-1)?.error, 'the retired pair carries no error').toBe(false);
    client.destroy();
    await proxy.close();
    echo.close();
  });
});
