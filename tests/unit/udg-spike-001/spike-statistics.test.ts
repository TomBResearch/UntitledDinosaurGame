/**
 * UDG-SPIKE-001 — statistics kernel for the spike harness (measurement.md §7.4 as adopted).
 *
 * Nearest-rank percentiles on hand-computed populations, the zero-retention / missing-sample /
 * 100-ack rules, the seeded jitter stream's determinism and bounds, and the achieved-network
 * INVALID rule — every boundary the Gate A matrix will lean on, checked before any browser runs.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_ELIGIBLE_ACKS_PER_RUN,
  RTT_JITTER_TOLERANCE_MS,
  RTT_MEDIAN_TOLERANCE_MS,
  nearestRank,
  networkValidity,
  percentiles,
  summarizeCorrections,
  summarizeDelays,
} from '../../../tools/load-test/src/statistics.ts';
import { boundedUniformStall, laneSeedRng, mulberry32 } from '../../../tools/load-test/src/ws-delay-proxy.ts';

describe('UDG-SPIKE-001 spike statistics (nearest rank, §7.4)', () => {
  it('takes the sorted sample at ceil(p*N) — the observed value, never an interpolated one', () => {
    // 1..20 sorted; N=20: p50 → rank 10 → value 10; p95 → rank 19 → value 19; p99 → rank 20 → 20.
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(nearestRank(samples, 0.5)).toBe(10);
    expect(nearestRank(samples, 0.95)).toBe(19);
    expect(nearestRank(samples, 0.99)).toBe(20);
    expect(nearestRank(samples, 1)).toBe(20);
    // Unsorted input, same answers: sorting is the writer's job, not the caller's assumption.
    const shuffled = [13, 1, 20, 7, 19, 2, 10, 5, 17, 3, 11, 15, 8, 4, 12, 18, 6, 14, 9, 16];
    expect(nearestRank(shuffled, 0.5)).toBe(10);
    expect(nearestRank(shuffled, 0.95)).toBe(19);
  });

  it('handles the exact-rank boundaries where ceil bites', () => {
    // N=100, p=0.95 → rank 95 exactly (the 95th smallest, 1-based).
    const hundred = Array.from({ length: 100 }, (_, i) => i);
    expect(nearestRank(hundred, 0.95)).toBe(94); // value i where i = rank-1 = 94
    // N=40, p=0.5 → rank 20; any p just above a rank fraction steps to the next sample.
    expect(nearestRank(hundred.slice(0, 40), 0.5)).toBe(19);
    expect(nearestRank([5], 0.5)).toBe(5);
    expect(nearestRank([5], 0.99)).toBe(5);
  });

  it('refuses empty, non-finite and out-of-range percentiles rather than inventing a value', () => {
    expect(() => nearestRank([], 0.95)).toThrow(/empty/);
    expect(() => nearestRank([1, Number.NaN], 0.95)).toThrow(/non-finite/);
    expect(() => nearestRank([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(/non-finite/);
    expect(() => nearestRank([1], 0)).toThrow(/must be in/);
    expect(() => nearestRank([1], 1.5)).toThrow(/must be in/);
    expect(() => percentiles([])).toThrow(/empty/);
  });

  it('summarizeDelays keeps requested and achieved side by side as raw populations', () => {
    const pairs = [
      { requestedMs: 50, achievedMs: 51 },
      { requestedMs: 50, achievedMs: 49 },
      { requestedMs: 50, achievedMs: 55 },
    ];
    const s = summarizeDelays(pairs);
    expect(s.samples).toBe(3);
    expect(s.requested?.p50).toBe(50);
    expect(s.achieved?.p50).toBe(51);
    expect(s.achieved?.max).toBe(55);
    const empty = summarizeDelays([]);
    expect(empty.requested).toBeNull();
    expect(empty.achieved).toBeNull();
    expect(empty.samples).toBe(0);
  });
});

describe('UDG-SPIKE-001 correction population rules (zero retention, missing fails, floor)', () => {
  const many = (n: number, value: number) => Array.from({ length: n }, () => ({ magnitudeMetres: value }));

  it('retains zero values in N and in every percentile — a zero correction is evidence, not noise', () => {
    const samples = [...many(60, 0), ...many(60, 0.1)];
    const s = summarizeCorrections(samples, 120);
    expect(s.ok, JSON.stringify(s.failures)).toBe(true);
    expect(s.zeroValues).toBe(60);
    expect(s.nonzeroValues).toBe(60);
    expect(s.measured).toBe(120);
    expect(s.percentiles?.n).toBe(120);
    // Nearest rank over 120: p50 → rank 60 → the 60th sample is still a zero.
    expect(s.percentiles?.p50).toBe(0);
  });

  it('FAILS as missing-samples when fewer corrections were measured than the authority owed', () => {
    const s = summarizeCorrections(many(119, 0.01), 120);
    expect(s.ok).toBe(false);
    expect(s.failures).toContain('missing-samples');
    expect(s.missing).toBe(1);
    // The failure is independent of the floor: even past 100 samples, a hole fails.
  });

  it('fails as insufficient-evidence at N < 100 and flips exactly at the floor', () => {
    const below = summarizeCorrections(many(MIN_ELIGIBLE_ACKS_PER_RUN - 1, 0.01), MIN_ELIGIBLE_ACKS_PER_RUN - 1);
    expect(below.failures).toContain('insufficient-evidence');
    const at = summarizeCorrections(many(MIN_ELIGIBLE_ACKS_PER_RUN, 0.01), MIN_ELIGIBLE_ACKS_PER_RUN);
    expect(at.ok, JSON.stringify(at.failures)).toBe(true);
  });

  it('refuses non-finite and negative magnitudes, and never rewrites a missing sample as zero', () => {
    const s = summarizeCorrections([...many(99, 0.01), { magnitudeMetres: Number.NaN }], 100);
    expect(s.failures).toContain('non-finite-samples');
    const neg = summarizeCorrections([...many(99, 0.01), { magnitudeMetres: -0.001 }], 100);
    expect(neg.failures).toContain('negative-magnitude');
  });

  it('excludes labelled resets from the SMOOTHNESS view while keeping their raw corrections', () => {
    const samples = [
      ...many(80, 0.02),
      ...many(20, 5), // labelled teleports: raw corrections stay, smoothness excludes
    ].map((sample, index) => (index >= 80 ? { ...sample, labelledReset: true } : sample));
    const s = summarizeCorrections(samples, 100);
    expect(s.excludedLabelledResets).toBe(20);
    expect(s.percentiles?.n).toBe(100);
    expect(s.percentiles?.max).toBe(5);
    expect(s.smoothness?.n).toBe(80);
    expect(s.smoothness?.max).toBe(0.02);
  });
});

describe('UDG-SPIKE-001 seeded bounded jitter (determinism the seeds 1001/1002/1003 rely on)', () => {
  it('mulberry32 is deterministic per seed and independent across seeds', () => {
    const a = mulberry32(1001);
    const b = mulberry32(1001);
    const c = mulberry32(1002);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    const seqC = Array.from({ length: 16 }, () => c());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA) expect(v).toBeLessThan(1);
  });

  it('the lane derivation gives c2s and s2c independent streams from one seed', () => {
    const fwd = laneSeedRng(1001, 1);
    const rev = laneSeedRng(1001, 2);
    const a = Array.from({ length: 8 }, () => fwd());
    const b = Array.from({ length: 8 }, () => rev());
    expect(a).not.toEqual(b);
  });

  it('boundedUniformStall stays inside [base, base+budget] for every draw, including the edges', () => {
    expect(boundedUniformStall(50, 10, 0)).toBe(50);
    expect(boundedUniformStall(50, 10, 0.999999)).toBeLessThan(60);
    const rng = mulberry32(1003);
    for (let i = 0; i < 2000; i += 1) {
      const v = boundedUniformStall(50, 10, rng());
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThan(60);
    }
    expect(() => boundedUniformStall(50, 10, 1)).toThrow();
    expect(() => boundedUniformStall(-1, 10, 0.5)).toThrow();
  });

  it('jitter 0 is the exact-boundary case: every stall equals the base', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i += 1) expect(boundedUniformStall(25, 0, rng())).toBe(25);
  });
});

describe('UDG-SPIKE-001 achieved-network validity (§2.2 INVALID rule)', () => {
  const samples = (values: readonly number[]) => values.map((v) => v);

  it('accepts a profile whose achieved median and spread stay inside both tolerances', () => {
    const v = networkValidity({ requestedRttMs: 100, declaredJitterBudgetMs: 20, achievedRttSamples: samples([95, 98, 100, 102, 105, 108, 99, 101, 97, 103]) });
    expect(v.valid, JSON.stringify(v.reasons)).toBe(true);
    expect(v.achieved?.n).toBe(10);
  });

  it('fires the median limb past 10 ms of drift and NOT at exactly 10', () => {
    const justInside = networkValidity({ requestedRttMs: 100, declaredJitterBudgetMs: 20, achievedRttSamples: samples(Array.from({ length: 20 }, (_, i) => 109 + (i % 2))) });
    expect(justInside.valid, JSON.stringify(justInside.reasons)).toBe(true); // p50 = 109 or 110: delta ≤ 10
    const outside = networkValidity({ requestedRttMs: 100, declaredJitterBudgetMs: 20, achievedRttSamples: samples(Array.from({ length: 20 }, () => 111)) });
    expect(outside.valid).toBe(false);
    expect(outside.reasons.some((r) => /achieved-median-rtt/.test(r))).toBe(true);
    expect(Math.abs(111 - 100)).toBeGreaterThan(RTT_MEDIAN_TOLERANCE_MS);
  });

  it('fires the jitter limb only when (p95 − p50) exceeds the budget by MORE than 10 ms', () => {
    // p50 = 100, p95 = budget + 10 exactly → still valid ("more than" is strict).
    const base = Array.from({ length: 19 }, () => 100);
    const exact = networkValidity({ requestedRttMs: 100, declaredJitterBudgetMs: 20, achievedRttSamples: [...base, 130].sort((x, y) => x - y) });
    // N=20: p95 → rank 19 → the 19th smallest = 100. p50 → 100. jitter 0 ≤ 30. Valid.
    expect(exact.valid, JSON.stringify(exact.reasons)).toBe(true);
    // Build a population whose p95−p50 is 31 over budget: 50% at 100, then a hard step.
    const spread = [...Array.from({ length: 50 }, () => 100), ...Array.from({ length: 44 }, () => 121), ...Array.from({ length: 6 }, () => 151)];
    const over = networkValidity({ requestedRttMs: 100, declaredJitterBudgetMs: 20, achievedRttSamples: spread });
    expect(over.achievedJitterMs).toBe(51);
    expect(over.valid).toBe(false);
    expect(over.reasons.some((r) => /achieved-jitter/.test(r))).toBe(true);
    expect(51 - 20).toBeGreaterThan(RTT_JITTER_TOLERANCE_MS);
  });

  it('a profile with zero achieved samples is NOT valid (there is nothing to be valid about)', () => {
    const v = networkValidity({ requestedRttMs: 50, declaredJitterBudgetMs: 10, achievedRttSamples: [] });
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('no-achieved-samples');
  });
});
