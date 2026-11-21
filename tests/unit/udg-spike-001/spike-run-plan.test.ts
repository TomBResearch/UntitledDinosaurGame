/**
 * UDG-SPIKE-001 — run planning and the harness input producer.
 *
 * The producer rule is the A-2 regression written as code: a generation sequence restarts ONLY
 * on a fresh issued epoch/snapshot — never on a stall, a late delivery or any timer (the class
 * holds no timer, which is the structural half of the proof) — and refuses to send into a domain
 * it has not seen a snapshot for. The plan rules are the official-matrix guards: adopted profiles,
 * seeds 1001/1002/1003, 20 s + 120 s, and any deviation only under a labelled diagnostic.
 */

import { describe, expect, it } from 'vitest';

import {
  InputProducer,
  MEASURE_MS,
  OFFICIAL_SEEDS,
  SPIKE_PROFILES,
  WARMUP_MS,
  captureEnvironmentRecord,
  impairmentFor,
  impairmentSourceRecord,
  planSpikeRun,
} from '../../../tools/load-test/src/run-spike.ts';

describe('UDG-SPIKE-001 input producer (restart ONLY on the fresh issued epoch/snapshot)', () => {
  it('counts generations up within one domain and restarts at a fresh epoch', () => {
    const p = new InputProducer();
    expect(p.notifySnapshot({ epoch: 3, boundary: 100 })).toBe('initial');
    expect(p.next(1, 0).generation).toBe(1);
    expect(p.next(1, 0).generation).toBe(2);
    expect(p.next(0, 0).generation).toBe(3);
    expect(p.notifySnapshot({ epoch: 4, boundary: 140 })).toBe('restart');
    expect(p.next(1, 0)).toEqual({ epoch: 4, generation: 1, seq: 4, moveX: 1, moveZ: 0 });
    expect(p.state().restarts).toBe(1);
  });

  it('a re-snapshot of the SAME epoch at a strictly newer boundary is also a fresh domain (recovery)', () => {
    const p = new InputProducer();
    p.notifySnapshot({ epoch: 5, boundary: 20 });
    p.next(1, 0);
    expect(p.notifySnapshot({ epoch: 5, boundary: 21 })).toBe('restart');
    expect(p.next(0, 1).generation).toBe(1);
  });

  it('stale or duplicate snapshots NEVER restart the sequence — the A-2 breach class', () => {
    const p = new InputProducer();
    p.notifySnapshot({ epoch: 7, boundary: 50 });
    p.next(1, 0);
    p.next(1, 0);
    expect(p.notifySnapshot({ epoch: 7, boundary: 50 })).toBe('duplicate');
    expect(p.notifySnapshot({ epoch: 6, boundary: 999 })).toBe('duplicate');
    const frame = p.next(1, 0);
    expect(frame.generation, 'generation continues — a stale snapshot must not reset the watermark domain').toBe(3);
    expect(frame.epoch).toBe(7);
    expect(p.state().restarts).toBe(0);
  });

  it('stalls cannot restart: noteStallObserved counts, generations keep climbing (no timer exists in the class)', () => {
    const p = new InputProducer();
    p.notifySnapshot({ epoch: 2, boundary: 0 });
    for (let i = 0; i < 10; i += 1) {
      p.noteStallObserved();
      p.noteStallObserved();
      const frame = p.next(1, 0);
      expect(frame.generation).toBe(i + 1);
    }
    expect(p.state().restarts).toBe(0);
    expect(p.state().stalls).toBe(20);
  });

  it('sends refused before any snapshot — nobody produces frames into an unseen domain', () => {
    const p = new InputProducer();
    expect(() => p.next(1, 0)).toThrow(/refuses to send blind/);
  });

  it('drive axes are validated (finite, bounded) before anything could reach a wire', () => {
    const p = new InputProducer();
    p.notifySnapshot({ epoch: 1, boundary: 0 });
    expect(() => p.next(Number.NaN, 0)).toThrow(/finite/);
    expect(() => p.next(2, 0)).toThrow(/bounded|finite and within/);
    const after = p.state();
    expect(after.generation, 'a refused frame consumes no generation').toBe(0);
  });
});

describe('UDG-SPIKE-001 run plan (official matrix guards; deviations need a diagnostic label)', () => {
  it('the adopted profiles and windows are the constants of record', () => {
    expect(Object.keys(SPIKE_PROFILES).sort()).toEqual(['elevated', 'lan', 'moderate', 'poor']);
    expect(SPIKE_PROFILES.elevated.rttMs).toBe(100);
    expect(SPIKE_PROFILES.elevated.jitterBudgetMs).toBe(20);
    expect(SPIKE_PROFILES.elevated.carriesCorrectionGate).toBe(true);
    expect(SPIKE_PROFILES.moderate.rttMs).toBe(50);
    expect(SPIKE_PROFILES.poor.rttMs).toBe(200);
    expect(WARMUP_MS).toBe(20_000);
    expect(MEASURE_MS).toBe(120_000);
    expect(OFFICIAL_SEEDS).toEqual([1001, 1002, 1003]);
  });

  it('an official plan is symmetric half-RTT with the declared jitter budget and the named impairment source', () => {
    const plan = planSpikeRun({ profile: 'elevated', seed: 1002 });
    expect(plan.official).toBe(true);
    expect(plan.label).toBe('official:elevated:1002');
    expect(plan.impairment).toEqual({ name: 'elevated', oneWayMs: 50, jitterBudgetMs: 20, seed: 1002 });
    expect(plan.impairmentSource.tcpLossModelled).toBe(false);
    expect(plan.impairmentSource.stallModel).toContain('tcp-stream-stall');
  });

  it('refuses an unknown profile, and any non-official cell WITHOUT a diagnostic label', () => {
    expect(() => planSpikeRun({ profile: 'plaid', seed: 1001 })).toThrow(/unknown profile/);
    expect(() => planSpikeRun({ profile: 'elevated', seed: 1004 })).toThrow(/diagnostic/);
    expect(() => planSpikeRun({ profile: 'elevated', seed: 1001, measureMs: 5_000 })).toThrow(/diagnostic/);
    const diag = planSpikeRun({ profile: 'elevated', seed: 1001, measureMs: 5_000, diagnostic: { reason: 'smoke' } });
    expect(diag.official).toBe(false);
    expect(diag.label).toBe('diagnostic:elevated:1001:smoke');
  });

  it('the environment record states the fields §7.4 demands of this process, and only those', () => {
    const env = captureEnvironmentRecord();
    expect(env.node).toBe(process.version);
    expect(env.monotonicClockSource).toContain('hrtime');
    expect(env.cpuCount).toBeGreaterThan(0);
    expect(env.memoryTotalBytes).toBeGreaterThan(0);
    expect(env.headed).toBe('not-applicable'); // the browser composition appends its own headed/headless fact
  });

  it('impairmentFor halves the RTT (symmetric) and the no-proxy source record says so honestly', () => {
    expect(impairmentFor(SPIKE_PROFILES.lan, 1001).oneWayMs).toBe(SPIKE_PROFILES.lan.rttMs / 2);
    expect(impairmentSourceRecord(false).impairment).toContain('no proxy');
  });
});
