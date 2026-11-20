/**
 * UDG-SPIKE-001 slice 6e — deterministic pins for the phase-window ack-ledger analyzer and the
 * motion auditor. The review of f87f8cf demanded CONTROLS that CATCH warm-up leakage, ledger
 * gaps, stationary and clipped samples — these tests are that control surface: every detector is
 * shown firing on a synthetic defect and silent on the honest shape, so the cell's green verdict
 * means something.
 */

import { describe, expect, it } from 'vitest';

import { analyzeAckLedger, auditMotion, canonicalRoute, type LedgerRowLike } from '../../../tools/load-test/src/ack-ledger.ts';

const row = (over: Partial<LedgerRowLike> & { atMs: number; seqs: readonly number[] }): LedgerRowLike => ({
  ackFrom: Math.min(...over.seqs),
  ackTo: Math.max(...over.seqs),
  status: 'measured',
  magnitude: 0,
  ...over,
});

const window = { startMs: 1_000, endMs: 5_000 };

describe('UDG-SPIKE-001 ack-ledger phase-window analyzer', () => {
  it('counts every eligible ack EXACTLY ONCE inside the window, zeros retained, warm-up rows EXCLUDED and counted', () => {
    const rows = [
      row({ atMs: 200, seqs: [1, 2, 3] }), // WARM-UP: before the window — must be excluded, counted
      row({ atMs: 1_100, seqs: [4] }),
      row({ atMs: 1_200, seqs: [5] }),
      row({ atMs: 1_300, seqs: [6], magnitude: 0 }), // zero RETAINED
      row({ atMs: 4_900, seqs: [7, 8], magnitude: 0.02 }),
      row({ atMs: 5_100, seqs: [9] }), // after the window — excluded, counted
    ];
    const report = analyzeAckLedger(rows, window, 5, 20_000);
    expect(report.rowsInWindow).toBe(4);
    expect(report.excludedBeforeWindow, 'warm-up leakage is COUNTED, not silently present').toBe(1);
    expect(report.excludedAfterWindow).toBe(1);
    expect(report.eligibleAcks).toBe(5);
    expect(report.zeroRetainedInWindow, 'zero corrections are retained in the sample set').toBe(3);
    expect(report.complete).toBe(true);
    expect(report.completenessDelta).toBe(0);
    expect(report.correctionPercentiles?.count).toBe(4);
    expect(report.correctionPercentiles?.max).toBeCloseTo(0.02);
  });

  it('a LEAKED window boundary changes the eligible count — the exclusion is doing real work (positive control for warm-up leakage)', () => {
    const rows = [
      row({ atMs: 200, seqs: [1, 2, 3] }),
      row({ atMs: 1_100, seqs: [4] }),
    ];
    const honest = analyzeAckLedger(rows, window, 1, 20_000);
    const leaked = analyzeAckLedger(rows, { startMs: 0, endMs: 5_000 }, 4, 20_000);
    expect(honest.eligibleAcks).toBe(1);
    expect(leaked.eligibleAcks, 'shifting the boundary earlier ADDS the warm-up acks — so the leak would be visible').toBe(4);
  });

  it('a DUPLICATE seq across two measured rows fails completeness', () => {
    const rows = [row({ atMs: 1_100, seqs: [4, 5] }), row({ atMs: 1_200, seqs: [5, 6] })];
    const report = analyzeAckLedger(rows, window, 3, 20_000);
    expect(report.duplicateAcks).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('a GAP — an acked seq covered by no measured and no invalidated row — fails completeness', () => {
    const rows = [row({ atMs: 1_100, seqs: [4] }), row({ atMs: 1_200, seqs: [6] })]; // seq 5 missing
    const report = analyzeAckLedger(rows, window, 3, 20_000);
    expect(report.gapAcks).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('invalidated rows count APART and consume their seqs (a gap must not be invented around them)', () => {
    const rows = [
      row({ atMs: 1_100, seqs: [4] }),
      row({ atMs: 1_200, seqs: [5], status: 'invalidated-missing-frames', magnitude: 0 }),
      row({ atMs: 1_300, seqs: [6] }),
    ];
    const report = analyzeAckLedger(rows, window, 3, 20_000);
    expect(report.eligibleAcks).toBe(2);
    expect(report.invalidatedAcks).toBe(1);
    expect(report.invalidatedInWindow).toBe(1);
    expect(report.gapAcks).toBe(0);
    expect(report.complete).toBe(true);
  });

  it('a ledger at its CAP is TRUNCATION — completeness fails even when the visible rows reconcile', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ atMs: 1_000 + i, seqs: [i + 1] }));
    const report = analyzeAckLedger(rows, window, 6, 6); // limit reached
    expect(report.truncated).toBe(true);
    expect(report.complete).toBe(false);
  });

  it('reconciliation against OPPORTUNITIES catches a silently dropped row the per-row checks cannot see', () => {
    const rows = [row({ atMs: 1_100, seqs: [4] })]; // one row, but the mover saw five acks
    const report = analyzeAckLedger(rows, window, 5, 20_000);
    expect(report.completenessDelta).toBe(4);
    expect(report.complete, 'the delta exceeds the tolerance — the ledger lost track, completeness FAILS').toBe(false);
  });
});

describe('UDG-SPIKE-001 motion auditor', () => {
  const bounds = { x: { min: -50, max: 50 }, z: { min: -50, max: 50 } };
  const speed = 4; // m/s authored

  it('a canonical inside-bounds route is clean: no stationary interval, no plateau, in range', () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({ atMs: i * 2_000, x: -40 + (i * 2_000) / 1_000 * speed, z: -40 })); // ends at x=48 — inside bounds
    const report = auditMotion(samples, bounds, speed, 4_000);
    expect(report.stationaryIntervals).toBe(0);
    expect(report.boundaryPlateaus).toBe(0);
    expect(report.outOfBounds).toBe(0);
    expect(report.medianSpeedMps).toBeCloseTo(speed, 0);
  });

  it('a STATIONARY stretch fires the detector (positive control for motion death)', () => {
    const moving = Array.from({ length: 6 }, (_, i) => ({ atMs: i * 2_000, x: i * 8, z: 0 }));
    const stuck = [{ atMs: 12_000, x: 40, z: 0 }, { atMs: 14_000, x: 40, z: 0 }];
    const moving2 = [{ atMs: 16_000, x: 48, z: 0 }];
    const report = auditMotion([...moving, ...stuck, ...moving2], bounds, speed, 4_000);
    expect(report.stationaryIntervals, 'two zero-displacement intervals are counted').toBe(2);
  });

  it('a CLIPPED path — position pinned at the boundary while motion presses on — fires the plateau detector and out-of-bounds never fires for a legal route', () => {
    const approach = Array.from({ length: 5 }, (_, i) => ({ atMs: i * 2_000, x: 34 + i * 4, z: 0 })); // ends at x=50
    const clipped = Array.from({ length: 3 }, (_, i) => ({ atMs: 10_000 + i * 2_000, x: 50, z: i * 8 })); // x pinned at bound, z moving
    const report = auditMotion([...approach, ...clipped], bounds, speed, 4_000);
    expect(report.boundaryPlateaus, 'x pinned AT the bound while z keeps moving is the clamp signature').toBeGreaterThan(0);
    const legal = auditMotion(approach.map((s) => ({ ...s, x: s.x - 2 })), bounds, speed, 4_000);
    expect(legal.boundaryPlateaus, 'the same shape 2 m inside the bound is silent — the detector fires on CLAMPS, not on turning').toBe(0);
  });

  it('the canonical route: 48 m legs, four directions, and the leg schedule is a pure function of elapsed time', () => {
    expect(canonicalRoute.legDirectionAt(0)).toBe('+x');
    expect(canonicalRoute.legDirectionAt(12_000)).toBe('+z');
    expect(canonicalRoute.legDirectionAt(24_000)).toBe('-x');
    expect(canonicalRoute.legDirectionAt(36_000)).toBe('-z');
    expect(canonicalRoute.legDirectionAt(48_000), 'the square closes and repeats').toBe('+x');
    expect(canonicalRoute.legMetres, 'authored speed 4 m/s × 12 s').toBe(48);
  });
});
