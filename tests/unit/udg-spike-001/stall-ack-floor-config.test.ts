/**
 * UDG-SPIKE-001 slice 28 — the §D-design CONFIGURABLE path validates FAIL CLOSED, and the client
 * never selects a wait value on its own. Pure validation tests (no clocks, no network): the
 * seat-level behaviour and the trigger-vs-episode clock-origin separation are pinned in
 * predictor.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { resolveStallAckFloorOption, WAIT_SANITY_CEILING_MS } from '../../../apps/client/src/network/stallAckFloor.ts';

describe('UDG-SPIKE-001 — stallAckFloor config validation (fail closed; no numeric chosen by the product)', () => {
  it('absent values are NOT this function\\u2019s business: it refuses rather than inventing a default', () => {
    for (const absent of [null, undefined]) {
      const r = resolveStallAckFloorOption(absent);
      expect(r.ok).toBe(false);
    }
  });

  it('an unprovenanced wait is refused — provenance is REQUIRED, named in the reason', () => {
    const r = resolveStallAckFloorOption({ waitMs: 500 } as never);
    expect(r.ok).toBe(false);
    expect((r as unknown as { reasons: string[] }).reasons.some((x) => /provenance is REQUIRED/i.test(x))).toBe(true);
  });

  it('numeric nonsense fails closed: NaN, Infinity, zero, negatives, strings and absurd values', () => {
    const bad: unknown[] = [{ waitMs: Number.NaN, provenance: 'p' }, { waitMs: Number.POSITIVE_INFINITY, provenance: 'p' }, { waitMs: 0, provenance: 'p' }, { waitMs: -5, provenance: 'p' }, { waitMs: '400', provenance: 'p' }, { waitMs: WAIT_SANITY_CEILING_MS + 1, provenance: 'p' }];
    for (const b of bad) {
      const r = resolveStallAckFloorOption(b as never);
      expect(r.ok, JSON.stringify(b)).toBe(false);
    }
    const legacy = resolveStallAckFloorOption(-1);
    expect(legacy.ok).toBe(false);
  });

  it('unknown keys, array payloads and budgets UNDER their own wait all fail closed with reasons', () => {
    const unknownKey = resolveStallAckFloorOption({ waitMs: 500, provenance: 'p', waitms: 1 } as never);
    expect(unknownKey.ok).toBe(false);
    expect((unknownKey as unknown as { reasons: string[] }).reasons.some((x) => /unknown config key/i.test(x))).toBe(true);
    expect(resolveStallAckFloorOption([500] as never).ok).toBe(false);
    const shortBudget = resolveStallAckFloorOption({ waitMs: 500, provenance: 'p', matchedBudgetMs: 400 });
    expect(shortBudget.ok).toBe(false);
    expect((shortBudget as unknown as { reasons: string[] }).reasons.some((x) => /at least COVER the wait/i.test(x))).toBe(true);
  });

  it('a valid measured wait resolves with honest, overclaim-free status fields', () => {
    const r = resolveStallAckFloorOption({ waitMs: 480, provenance: 'measured same-room epoch 7 path: p95 RTT 218 ms + declared service allowance (synthetic unit stand-in)' });
    expect(r.ok).toBe(true);
    const ok = r as Extract<typeof r, { ok: true }>;
    expect(ok.source).toBe('config-object');
    expect(ok.waitMs).toBe(480);
    expect(ok.budgetStatus).toBe('not-declared');
    expect(ok.matchedBudgetMs).toBeNull();
    expect(ok.appliedEpoch).toBeNull();
    expect(ok.clockOrigin).toContain('seat-declared-clock'); // the DECLARED trigger origin, never inferred
  });

  it('a matched budget is recorded as declared, NOT independently verified; legacy numerics stay labelled as the legacy harness option', () => {
    const r = resolveStallAckFloorOption({ waitMs: 480, provenance: 'p', matchedBudgetMs: 4_500, appliedEpoch: 7, clockOrigin: 'room monotonic (declared)' });
    expect(r.ok).toBe(true);
    const ok = r as Extract<typeof r, { ok: true }>;
    expect(ok.budgetStatus).toBe('declared-matched-not-independently-verified');
    expect(ok.appliedEpoch).toBe(7);
    const legacy = resolveStallAckFloorOption(400);
    expect(legacy.ok).toBe(true);
    const lok = legacy as Extract<typeof legacy, { ok: true }>;
    expect(lok.source).toBe('legacy-numeric');
    expect(lok.provenance).toMatch(/legacy option/);
  });
});
