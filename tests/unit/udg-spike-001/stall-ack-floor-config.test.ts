/**
 * UDG-SPIKE-001 slice 28 — the §D-design CONFIGURABLE path validates FAIL CLOSED, and the client
 * never selects a wait value on its own. Pure validation tests (no clocks, no network): the
 * seat-level behaviour and the trigger-vs-episode clock-origin separation are pinned in
 * predictor.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { resolveStallAckFloorOption, validateMeasuredWaitReceipt, WAIT_SANITY_CEILING_MS } from '../../../apps/client/src/network/stallAckFloor.ts';

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

/* ── slice 29: the MEASURED-CONFIG PATH — machine validation of receipt RECORDS. Every record
 * below is an explicitly SYNTHETIC test fixture: no real deployment value is admitted anywhere,
 * and nothing here proves or enables anything. */

const SYN = 'unit:synthetic test receipt (declared stand-in, no real values)';
const seg = (durationMs: number, over: Record<string, unknown> = {}) => ({
  durationMs, clockOrigin: 'seat-declared-clock', basis: 'from-fire', ...over,
});
const receipt = (over: Record<string, unknown> = {}) => ({
  kind: 'measured-wait-receipt', waitMs: 900, provenance: SYN, roomScope: 'room-synth-1', epochScope: 7,
  detection: seg(200), recovery: seg(700),
  budget: { availableMs: 1_000, clockOrigin: 'seat-declared-clock', basis: 'from-fire' },
  ...over,
});

describe('UDG-SPIKE-001 slice 29 — measured-wait receipt validation (synthetic records; below/equal/above budget, origins, provenance, scope)', () => {
  it('EQUAL budget: recorded detection+recovery exactly filling the declared budget validates on matching origins', () => {
    const r = validateMeasuredWaitReceipt(receipt({ detection: seg(200), recovery: seg(800) })); // 1000 == 1000
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.validation.comparison).toBe('within-budget');
      expect(r.validation.comparedMs).toBe(1_000);
      expect(r.validation.availableBudgetMs).toBe(1_000);
      expect(r.validation.normalized).toBe(false);
      expect(r.validation.roomScope).toBe('room-synth-1');
      expect(r.validation.epochScope).toBe(7);
    }
  });

  it('ABOVE headroom (recorded duration well under budget) validates the same way', () => {
    const r = validateMeasuredWaitReceipt(receipt({ detection: seg(100), recovery: seg(300) }));
    expect(r.ok && r.validation.comparison).toBe('within-budget');
  });

  it('BELOW-budget claims are REFUSED: a budget that cannot contain its own measured duration is not a supportable wait', () => {
    const r = validateMeasuredWaitReceipt(receipt({ detection: seg(400), recovery: seg(800) })); // 1200 > 1000
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join('; ')).toMatch(/under-budget claim refused/);
  });

  it('unrelated clocks are NEVER summed: detection and recovery must declare the same origin AND basis', () => {
    const r = validateMeasuredWaitReceipt(receipt({ recovery: seg(700, { clockOrigin: 'room-side-stopwatch' }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join('; ')).toMatch(/do not sum unrelated clocks/);
    const basis = validateMeasuredWaitReceipt(receipt({ recovery: seg(700, { basis: 'from-oldest-send' }) }));
    expect(basis.ok).toBe(false);
    if (!basis.ok) expect(basis.reasons.join('; ')).toMatch(/do not sum unrelated clocks/);
  });

  it('a from-fire episode vs a from-oldest-send budget may NOT be compared unnormalized; explicit declared offsets normalize, and the offset can flip the verdict', () => {
    const unnormalized = validateMeasuredWaitReceipt(receipt({
      budget: { availableMs: 1_100, clockOrigin: 'seat-declared-clock', basis: 'from-oldest-send' },
    }));
    expect(unnormalized.ok).toBe(false);
    if (!unnormalized.ok) expect(unnormalized.reasons.join('; ')).toMatch(/may not be compared unnormalized/);
    const normalized = validateMeasuredWaitReceipt(receipt({
      budget: { availableMs: 1_100, clockOrigin: 'seat-declared-clock', basis: 'from-oldest-send' },
      sendToFireOffsetMs: 150, // 900 + 150 = 1050 <= 1100
    }));
    expect(normalized.ok && normalized.validation.comparison).toBe('within-budget-normalized');
    expect(normalized.ok && normalized.validation.normalized).toBe(true);
    const flipped = validateMeasuredWaitReceipt(receipt({
      budget: { availableMs: 1_100, clockOrigin: 'seat-declared-clock', basis: 'from-oldest-send' },
      sendToFireOffsetMs: 250, // 900 + 250 = 1150 > 1100 — normalization exposes the under-budget claim
    }));
    expect(flipped.ok).toBe(false);
    if (!flipped.ok) expect(flipped.reasons.join('; ')).toMatch(/under-budget claim refused/);
  });

  it('cross-CLOCK comparisons are refused outright — no offset normalizes across clocks; an unneeded offset is an inconsistent record', () => {
    const cross = validateMeasuredWaitReceipt(receipt({
      budget: { availableMs: 1_200, clockOrigin: 'host-monotonic-clock', basis: 'from-fire' },
    }));
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reasons.join('; ')).toMatch(/DIFFERENT clock origin/);
    const crossWithOffset = validateMeasuredWaitReceipt(receipt({
      budget: { availableMs: 1_200, clockOrigin: 'host-monotonic-clock', basis: 'from-oldest-send' },
      sendToFireOffsetMs: 100,
    }));
    expect(crossWithOffset.ok).toBe(false);
    if (!crossWithOffset.ok) expect(crossWithOffset.reasons.join('; ')).toMatch(/DIFFERENT clock origin/);
    const unneeded = validateMeasuredWaitReceipt(receipt({ sendToFireOffsetMs: 100 })); // bases already match
    expect(unneeded.ok).toBe(false);
    if (!unneeded.ok) expect(unneeded.reasons.join('; ')).toMatch(/unneeded normalization/);
  });

  it('unsupported, missing, nonfinite or placeholder fields are each refused with their OWN named reason', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [receipt({ provenance: '   ' }), /provenance is REQUIRED/],
      [receipt({ roomScope: '' }), /roomScope is REQUIRED/],
      [receipt({ roomScope: '*' }), /may not be a wildcard/],
      [receipt({ epochScope: undefined }), /epochScope is REQUIRED/], // must be an explicit int or an explicit null
      [receipt({ epochScope: 1.5 }), /epochScope is REQUIRED/],
      [receipt({ detection: seg(Number.NaN) }), /detection\.durationMs must be a finite number/],
      [receipt({ detection: seg(200, { clockOrigin: '' }) }), /detection\.clockOrigin is REQUIRED/],
      [receipt({ detection: seg(200, { basis: undefined }) }), /detection\.basis is REQUIRED/],
      [receipt({ detection: seg(0), recovery: seg(0) }), /totals 0 ms/],
      [receipt({ budget: undefined }), /budget is REQUIRED/],
      [receipt({ budget: { availableMs: 0, clockOrigin: 'seat-declared-clock', basis: 'from-fire' } }), /budget must declare/],
      [receipt({ bogusField: 1 }), /unknown receipt field 'bogusField'/],
      [receipt({ kind: 'something-else' }), /kind must be 'measured-wait-receipt'/],
      [receipt({ waitMs: 0 }), /waitMs must be a finite positive number/],
      [receipt({ waitMs: WAIT_SANITY_CEILING_MS + 1 }), /measurement-sanity ceiling/],
    ];
    for (const [input, pattern] of cases) {
      const r = validateMeasuredWaitReceipt(input);
      expect(r.ok, `must refuse ${JSON.stringify(input)}`).toBe(false);
      if (!r.ok) expect(r.reasons.join('; '), `reason for ${JSON.stringify(input)}`).toMatch(pattern);
    }
  });

  it('resolveStallAckFloorOption routes receipts to their OWN source and labels the budget honestly; the legacy/config paths are untouched', () => {
    const r = resolveStallAckFloorOption(receipt() as never);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('measured-receipt');
      expect(r.budgetStatus).toBe('machine-validated-recorded-durations-not-production-enabled');
      expect(r.roomScope).toBe('room-synth-1');
      expect(r.appliedEpoch).toBe(7);
      expect(r.receiptValidation?.comparison).toBe('within-budget');
    }
    const bad = resolveStallAckFloorOption(receipt({ detection: seg(Number.NaN) }) as never);
    expect(bad.ok).toBe(false);
    const legacy = resolveStallAckFloorOption(400);
    expect(legacy.ok && legacy.source === 'legacy-numeric' && legacy.roomScope === null).toBe(true);
    const config = resolveStallAckFloorOption({ waitMs: 500, provenance: 'unit: p' });
    expect(config.ok && config.source === 'config-object' && config.receiptValidation === null).toBe(true);
  });
});
