/**
 * UDG-SPIKE-001 slice 6e/6f — deterministic pins for the phase-window ack-ledger analyzer and
 * the motion auditor. The review of 7c1ec03 named the accounting defects, so every RED control
 * below is a positive demonstration that the detector fires:
 *  - percentiles are per matched acknowledgement DELIVERY — a giant batch covering 150 input
 *    stamps contributes ONE boundary, and a >=100 gate on boundaries cannot be satisfied by
 *    stamps (fewer than 100 measured boundaries despite >100 covered frames FAILS the gate);
 *  - eligible measurement is bound to the immutable same-delivery key (epoch:authorityTick:ackTo)
 *    exactly once in the exact phase; a MISSING first/last boundary row, a DUPLICATE claim, an
 *    overlapping measured/invalidated claim, or an UNBOUND row fails completeness with no
 *    numeric tolerance;
 *  - exclusions are tracked only when independently labelled (row timestamps vs the window;
 *    anchored rows on non-advancing-ack deliveries).
 * The motion auditor is shown firing on stationary and clipped series and silent on the honest
 * shapes, so the cell's green verdict means something.
 */

import { describe, expect, it } from 'vitest';

import { analyzeAckLedger, auditMotion, canonicalRoute, type DeliveryLike, type LedgerRowLike } from '../../../tools/load-test/src/ack-ledger.ts';

const row = (over: Partial<LedgerRowLike> & { atMs: number; authorityTick: number; ackTo: number; seqs: readonly number[] }): LedgerRowLike => ({
  ackFrom: Math.min(...over.seqs),
  status: 'measured',
  magnitude: 0,
  epoch: 1,
  ...over,
});

const delivery = (atMs: number, authorityTick: number, ack: number, accepted = true): DeliveryLike => ({
  accepted,
  delivery: { atMs, epoch: 1, authorityTick, ack },
});

const window = { startMs: 1_000, endMs: 5_000 };

/** n matched boundaries, one delivery each, ack advancing 1 per tick, spaced 100 ms. */
const honestPair = (n: number, startAt = 1_050): { rows: LedgerRowLike[]; deliveries: DeliveryLike[] } => {
  const rows: LedgerRowLike[] = [];
  const deliveries: DeliveryLike[] = [];
  for (let i = 0; i < n; i += 1) {
    const atMs = startAt + i * 100;
    deliveries.push(delivery(atMs, 100 + i, i + 1));
    rows.push(row({ atMs: atMs + 2, authorityTick: 100 + i, ackTo: i + 1, seqs: [i + 1], magnitude: i % 7 === 0 ? 0 : i / 1000 }));
  }
  return { rows, deliveries };
};

describe('UDG-SPIKE-001 ack-ledger: deliveries are the population', () => {
  it('one row per matched delivery, counted once, zeros retained, warm-up rows excluded and COUNTED', () => {
    const { rows, deliveries } = honestPair(12);
    const warmRow = row({ atMs: 200, authorityTick: 50, ackTo: 0, seqs: [], status: 'anchored' });
    const warmDelivery = delivery(190, 50, 0);
    const report = analyzeAckLedger([warmRow, ...rows], [warmDelivery, ...deliveries], window, 20_000);
    expect(report.opportunityDeliveries).toBe(12);
    expect(report.measuredBoundaries).toBe(12);
    expect(report.excludedBeforeWindow, 'the warm-up row is COUNTED as excluded, never silently present').toBe(1);
    expect(report.zeroMeasured + report.nonzeroMeasured).toBe(12);
    expect(report.coveredInputStamps).toBe(12);
    expect(report.complete).toBe(true);
    expect(report.correctionPercentiles?.count).toBe(12);
  });

  it('RED CONTROL — a giant batch covering 150 input stamps is ONE measured boundary: stamps can never satisfy a >=100 boundary gate', () => {
    const deliveries = [delivery(1_100, 200, 150)];
    const rows = [
      row({ atMs: 1_105, authorityTick: 200, ackTo: 150, seqs: Array.from({ length: 150 }, (_, i) => i + 1) }),
      row({ atMs: 1_200, authorityTick: 201, ackTo: 151, seqs: [151] }),
    ];
    deliveries.push(delivery(1_195, 201, 151));
    const report = analyzeAckLedger(rows, deliveries, window, 20_000);
    expect(report.coveredInputStamps, 'stamps are REPORTED separately').toBe(151);
    expect(report.measuredBoundaries, 'the POPULATION is boundaries — two deliveries, two boundaries').toBe(2);
    expect(report.measuredBoundaries >= 100, 'a >=100 gate on boundaries FAILS here even though stamps exceed 100').toBe(false);
    expect(report.complete).toBe(true);
  });

  it('RED CONTROL — a MISSING FIRST eligible boundary in the phase fails completeness (no quiet shortened population)', () => {
    const { rows, deliveries } = honestPair(4);
    const first = rows[0] as LedgerRowLike;
    const withoutFirst = rows.filter((r) => r !== first);
    const report = analyzeAckLedger(withoutFirst, deliveries, window, 20_000);
    expect(report.opportunityDeliveries).toBe(4);
    expect(report.missingMeasurements).toBe(1);
    expect(report.complete, 'a missing measurement is an EXPLICIT FAIL, never a counted zero').toBe(false);
  });

  it('RED CONTROL — a MISSING LAST eligible boundary fails too (edge rows are not exempt)', () => {
    const { rows, deliveries } = honestPair(4);
    const report = analyzeAckLedger(rows.slice(0, 3), deliveries, window, 20_000);
    expect(report.missingMeasurements).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('RED CONTROL — an overlapping measured + invalidated claim on ONE delivery key fails', () => {
    const deliveries = [delivery(1_100, 200, 5)];
    const rows = [
      row({ atMs: 1_105, authorityTick: 200, ackTo: 5, seqs: [5] }),
      row({ atMs: 1_106, authorityTick: 200, ackTo: 5, seqs: [5], status: 'invalidated-missing-frames' }),
    ];
    const report = analyzeAckLedger(rows, deliveries, window, 20_000);
    expect(report.overlapKeys).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('RED CONTROL — a DUPLICATE measured row on one key fails (exactly-once is enforced, not assumed)', () => {
    const deliveries = [delivery(1_100, 200, 5)];
    const rows = [
      row({ atMs: 1_105, authorityTick: 200, ackTo: 5, seqs: [5] }),
      row({ atMs: 1_107, authorityTick: 200, ackTo: 5, seqs: [5] }),
    ];
    const report = analyzeAckLedger(rows, deliveries, window, 20_000);
    expect(report.duplicateKeys).toBe(1);
    expect(report.complete).toBe(false);
  });

  it('a row on a NON-advancing-ack delivery is an INDEPENDENTLY LABELLED exclusion, not eligible and not a failure', () => {
    const deliveries = [delivery(1_050, 100, 7), delivery(1_100, 101, 7)]; // second delivery repeats the ack
    const rows = [
      row({ atMs: 1_060, authorityTick: 100, ackTo: 7, seqs: [7] }),
      row({ atMs: 1_110, authorityTick: 101, ackTo: 7, seqs: [], status: 'anchored' }),
    ];
    const report = analyzeAckLedger(rows, deliveries, window, 20_000);
    expect(report.opportunityDeliveries).toBe(1);
    expect(report.measuredBoundaries).toBe(1);
    expect(report.excludedNonAdvancing).toBe(1);
    expect(report.complete).toBe(true);
  });

  it('RED CONTROL — an UNBOUND row (key matches no accepted delivery) fails; rejected deliveries do not create opportunities', () => {
    const deliveries = [delivery(1_100, 200, 5), delivery(1_200, 201, 6, false)];
    const rows = [
      row({ atMs: 1_105, authorityTick: 200, ackTo: 5, seqs: [5] }),
      row({ atMs: 1_205, authorityTick: 201, ackTo: 6, seqs: [6] }), // row for a REJECTED delivery
    ];
    const report = analyzeAckLedger(rows, deliveries, window, 20_000);
    expect(report.unboundRows).toBe(1);
    expect(report.opportunityDeliveries).toBe(1);
    expect(report.complete, 'no unexplained tolerance: an unbound row fails, it is not subtracted').toBe(false);
  });

  it('a ledger at its CAP is TRUNCATION — completeness fails even when keys reconcile', () => {
    const { rows, deliveries } = honestPair(6);
    const report = analyzeAckLedger(rows, deliveries, window, 6);
    expect(report.truncated).toBe(true);
    expect(report.complete).toBe(false);
  });

  it('a LEAKED window boundary changes both populations — warm-up rows only exist outside the honest window (positive control for leakage)', () => {
    const { rows, deliveries } = honestPair(8, 200); // all deliveries BEFORE the honest window start
    const honest = analyzeAckLedger(rows, deliveries, window, 20_000);
    const leaked = analyzeAckLedger(rows, deliveries, { startMs: 0, endMs: 5_000 }, 20_000);
    expect(honest.opportunityDeliveries).toBe(0);
    expect(honest.measuredBoundaries).toBe(0);
    expect(honest.excludedBeforeWindow).toBe(8);
    expect(leaked.measuredBoundaries, 'widening the boundary ADDS the warm-up boundaries — the exclusion does real work').toBe(8);
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

  it('a CLIPPED path — position pinned at the boundary while motion presses on — fires the plateau detector', () => {
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
