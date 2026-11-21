/**
 * UDG-SPIKE-001 — the RTT probe's slot-reservation state machine, deterministically.
 *
 * The review of 4db1a0f named the exact failure: the SDK stores ONE ping callback slot and the
 * PING frame has no request id, so a late echo arriving AFTER a fixed grace would fire the
 * FOLLOWING ping's callback — a sample attributed to the wrong send. These tests drive the
 * state machine with injected time and ping delivery and assert the new contract:
 * - a retirement keeps the slot RESERVED: NO send happens until the original echo is positively
 *   observed (even one that arrives later than the old 1500 ms grace);
 * - a never-arriving echo POISONS the slot at the confirm cap: the window stops, remaining
 *   opportunities are counted as not-sent, and NO further ping is ever sent afterwards;
 * - recovery after a positively-confirmed late echo continues sampling;
 * - a socket epoch replacement mid-window stops the window (`epoch-changed`);
 * - a refused send on a closed socket stops the window as `socket-closed`, not as poison.
 * Every assertion about "no new ping on the poisoned slot" is made against the RECORDED send
 * schedule, not against prose.
 */

import { describe, expect, it } from 'vitest';

import { runProbeWindow, type ProbeDeps, type ProbeOptions } from '../../../tools/load-test/src/rtt-probe.ts';

/** A controllable harness: virtual clock, manual echo delivery, recorded send schedule. */
class Harness {
  now = 0;
  sends: { atMs: number; index: number }[] = [];
  echoDeliveries: { atMs: number; forSend: number }[] = [];
  private callbacks: ((ms: number) => void)[] = [];
  private pending: { resolve: () => void }[] = [];
  epoch = 1;

  private timers: { due: number; cb: () => void; cancelled: boolean }[] = [];

  deps(): ProbeDeps {
    return {
      nowMs: () => this.now,
      sleep: async (ms) => {
        this.advance(ms);
      },
      after: (ms, cb) => {
        const timer = { due: this.now + ms, cb, cancelled: false };
        this.timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      sendPing: (onEcho) => {
        const index = this.sends.length;
        this.sends.push({ atMs: this.now, index });
        this.callbacks[index] = onEcho;
      },
      epochNow: () => this.epoch,
    };
  }

  /** Deliver the echo for send #index at the current virtual time. */
  deliverEcho(index: number): void {
    this.echoDeliveries.push({ atMs: this.now, forSend: index });
    this.callbacks[index]?.(this.now);
  }

  /** Move the virtual clock, resolving any sleeping continuations in time order. */
  advance(ms: number): void {
    this.now += ms;

    const due = this.timers.filter((timer) => !timer.cancelled && timer.due <= this.now);
    this.timers = this.timers.filter((timer) => !timer.cancelled && timer.due > this.now);
    for (const timer of due) timer.cb();
    for (const waiter of this.pending.splice(0)) waiter.resolve();
  }

  /** Assert helper: number of sends issued so far. */
  get sent(): number {
    return this.sends.length;
  }
}

const opts = (over: Partial<ProbeOptions> = {}): ProbeOptions => ({
  pings: 4,
  cadenceMs: 100,
  deadlineMs: 200,
  confirmCapMs: 2_000,
  ...over,
});

describe('UDG-SPIKE-001 rtt-probe slot reservation', () => {
  it('a late echo LATER than the old 1500 ms grace is confirmed before the next send — no crossing', async () => {
    const h = new Harness();
    const options = opts({ pings: 3, confirmCapMs: 5_000 });
    const running = runProbeWindow(h.deps(), options);
    // ping 0: normal echo
    for (let i = 0; h.sent < 1 && i < 50; i += 1) { await Promise.resolve(); }
    h.deliverEcho(0);
    // ping 1: retires (deadline 200), echo arrives at +3000 — LATER than the old 1500 grace.
    for (let i = 0; h.sent < 2 && i < 200; i += 1) { h.advance(50); await Promise.resolve(); }
    const sentAtPing2 = h.sent;
    h.advance(3_000); // past the old grace, still no echo
    await Promise.resolve();
    expect(h.sent, 'no second send while a retired slot is unconfirmed (the 1500 ms hole is closed)').toBe(sentAtPing2);
    h.deliverEcho(1); // the ORIGINAL echo is positively observed late
    for (let i = 0; h.sent < 3 && i < 200; i += 1) { h.advance(50); await Promise.resolve(); }
    h.deliverEcho(2);
    const outcome = await running;
    expect(h.sent, 'exactly one send per opportunity; the reserved slot delayed ping 2, never crossed it').toBe(3);
    expect(outcome.lateDiscarded).toBe(1);
    expect(outcome.slotPoisoned).toBe(false);
    expect(outcome.samples.length, 'the retired ping contributes NO sample; the other two do').toBe(2);
    expect(outcome.retiredUnconfirmed).toBe(0);
  });

  it('NO ECHO at all: the slot poisons at the confirm cap, remaining opportunities are not-sent, and NOTHING is ever sent after', async () => {
    const h = new Harness();
    const options = opts({ pings: 5, confirmCapMs: 1_000 });
    const running = runProbeWindow(h.deps(), options);
    for (let i = 0; h.sent < 1 && i < 50; i += 1) { await Promise.resolve(); }
    h.deliverEcho(0); // ping 0 answers normally
    for (let i = 0; h.sent < 2 && i < 100; i += 1) { h.advance(50); await Promise.resolve(); }
    // ping 1 never echoes: deadline retires it, the confirm cap burns, the window must STOP.
    const sentAtPoison = h.sent;
    for (let i = 0; i < 200; i += 1) { h.advance(50); await Promise.resolve(); }
    const outcome = await running;
    expect(outcome.slotPoisoned, 'no positive echo observation is available by the cap').toBe(true);
    expect(outcome.abortedReason).toBe('slot-poisoned');
    expect(outcome.retiredUnconfirmed).toBe(1);
    expect(outcome.notSent, 'pings 2..4 are marked not-sent, never sent on the poisoned slot').toBe(3);
    expect(h.sent, 'the poisoned slot receives NO further sends — ever').toBe(sentAtPoison);
    expect(outcome.samples.length).toBe(1);
  });

  it('recovery: after a positively-confirmed late echo the same window continues and completes', async () => {
    const h = new Harness();
    const options = opts({ pings: 3, confirmCapMs: 3_000 });
    const running = runProbeWindow(h.deps(), options);
    for (let i = 0; h.sent < 1 && i < 50; i += 1) { await Promise.resolve(); }
    h.deliverEcho(0);
    for (let i = 0; h.sent < 2 && i < 100; i += 1) { h.advance(50); await Promise.resolve(); }
    h.advance(400); // ping 1 retires
    h.deliverEcho(1); // confirmed late -> discard, slot free, continue
    for (let i = 0; h.sent < 3 && i < 200; i += 1) { h.advance(50); await Promise.resolve(); }
    h.deliverEcho(2);
    const outcome = await running;
    expect(outcome.samples.length).toBe(2);
    expect(outcome.lateDiscarded).toBe(1);
    expect(outcome.abortedReason).toBe(null);
    expect(outcome.notSent).toBe(0);
  });

  it('a socket epoch replacement mid-window STOPS the window (slot continuity across a rejoin is unknown)', async () => {
    const h = new Harness();
    const options = opts({ pings: 4 });
    const running = runProbeWindow(h.deps(), options);
    for (let i = 0; h.sent < 1 && i < 50; i += 1) { await Promise.resolve(); }
    h.deliverEcho(0);
    h.epoch = 2; // a rejoin swapped the domain between opportunities
    const outcome = await running;
    expect(outcome.epochChanged).toBe(true);
    expect(outcome.abortedReason).toBe('epoch-changed');
    expect(h.sent, 'no ping is issued on the swapped epoch from the old window').toBe(1);
    expect(outcome.notSent).toBe(3);
    expect(outcome.samples.length).toBe(1);
  });

  it('a refused send on a closed socket stops as socket-closed — never as a retirement cascade', async () => {
    const h = new Harness();
    const closedAfter = 1;
    let n = 0;
    const base = h.deps();
    const deps: ProbeDeps = {
      ...base,
      sleep: async (ms) => { h.advance(ms); },
      sendPing: (onEcho) => {
        n += 1;
        if (n > closedAfter) throw new Error('rtt-probe-socket-closed');
        h.deps().sendPing(onEcho);
      },
    };
    const running = runProbeWindow(deps, opts({ pings: 4 }));
    for (let i = 0; h.sent < 1 && i < 50; i += 1) { await Promise.resolve(); }
    h.deliverEcho(0);
    const outcome = await running;
    expect(outcome.socketClosed).toBe(true);
    expect(outcome.abortedReason).toBe('socket-closed');
    expect(outcome.slotPoisoned).toBe(false);
    expect(outcome.retiredUnconfirmed).toBe(0);
    expect(outcome.notSent).toBe(2);
  });

  it('invariant under a mixed storm: samples are always bracketed by their OWN send→echo and no send overlaps a reserved slot', async () => {
    const h = new Harness();
    const options = opts({ pings: 8, deadlineMs: 200, confirmCapMs: 1_500 });
    const running = runProbeWindow(h.deps(), options);
    const echoScript = [true, false, 'late', true, 'late', false, true, true] as const;
    let idx = 0;
    for (let guard = 0; guard < 4_000 && idx < echoScript.length; guard += 1) {
      h.advance(60);
      await Promise.resolve();
      const mode = echoScript[idx];
      if (mode === true) {
        if (h.sent > idx) { h.deliverEcho(idx); idx += 1; }
      } else if (mode === 'late') {
        if (h.sent > idx) {
          const sentIdx = idx;
          h.advance(300); // past the deadline: it retires
          h.deliverEcho(sentIdx); // then arrives late while the slot is still reserved
          idx += 1;
        }
      } else {
        // 'false': no echo for this ping — wait out deadline + confirm so the machine moves on/poisons
        if (h.sent > idx) {
          h.advance(1_800);
          idx += 1;
        }
      }
    }
    const outcome = await running;
    for (const sample of outcome.samples) {
      expect(sample.rttMs, 'every sample is its own bracket').toBeGreaterThan(0);
      expect(sample.receivedAtMs, 'every sample received after it sent').toBeGreaterThan(sample.sentAtMs);
    }
    const totalSends = h.sent;
    const totalUsed = outcome.samples.length + outcome.lateDiscarded + outcome.retiredUnconfirmed;
    expect(totalSends, 'every send is accounted: sampled, discarded-after-confirmation, or the unconfirmed poison stop').toBe(totalUsed);
    if (outcome.slotPoisoned) {
      expect(outcome.abortedReason).toBe('slot-poisoned');
    }
  });
});
