/**
 * UDG-SPIKE-001 slice 6e — the phase-window ack-ledger analyzer and the motion auditor.
 *
 * The review of f87f8cf named the defects precisely: taking every row of the LAST ledger
 * snapshot (a) includes warm-up rows, (b) silently loses rows when the ledger hits its cap, and
 * (c) never reconciles against what was actually acknowledged. This module is the correction,
 * as a PURE function over the browser monotonic clock (the adapter stamps matched rows with
 * `performance.now()` — the same clock that brackets the phase marks):
 *
 *  - every measurement-phase eligible ack is counted EXACTLY ONCE, zeros included;
 *  - rows outside the phase window are counted as EXCLUSIONS, never silently present;
 *  - duplicates (a seq covered by two measured rows), gaps (an acked seq covered by nothing and
 *    invalidated by nothing) and truncation (ledger at its cap) FAIL completeness;
 *  - completeness also reconciles against the ack OPPORTUNITIES the mover saw (the delta of the
 *    transport's acknowledged counter across the window);
 *  - percentiles are p50/p95/p99/max by the same nearest-rank convention as everything else.
 *
 * The motion auditor separates a ROUTE from a CLAMP: canonical authored motion that stays inside
 * the region bounds cannot be clamped, and the auditor says so from the observer's samples —
 * range inside bounds, no stationary interval, no boundary plateau. Both modules run in Node
 * (unit-tested with deliberate warm-up leakage, gaps, duplicates, truncation, stationary and
 * clipped series) and in the page (the cell evaluates THIS compiled module).
 */

import { nearestRank } from './statistics.js';

export interface LedgerRowLike {
  readonly atMs: number;
  readonly ackFrom: number;
  readonly ackTo: number;
  readonly seqs: readonly number[];
  readonly status: string;
  readonly magnitude: number;
}

export interface PhaseWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface AckLedgerReport {
  readonly rowsTotal: number;
  readonly rowsInWindow: number;
  readonly excludedBeforeWindow: number;
  readonly excludedAfterWindow: number;
  readonly measuredInWindow: number;
  readonly zeroRetainedInWindow: number;
  readonly anchoredInWindow: number;
  readonly invalidatedInWindow: number;
  /** Unique seqs covered by in-window MEASURED rows — every eligible ack counted once. */
  readonly eligibleAcks: number;
  readonly invalidatedAcks: number;
  readonly duplicateAcks: number;
  /** Seqs inside the observed ack range covered by no measured and no invalidated row. */
  readonly gapAcks: number;
  readonly truncated: boolean;
  /** opportunities − (eligible + invalidated + anchored rows' acks). Anchored rows consume an
   * ack with no pending frames, so they belong to the reconciliation, not to eligibility. */
  readonly completenessDelta: number;
  readonly complete: boolean;
  readonly correctionPercentiles: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly count: number } | null;
}

export const analyzeAckLedger = (
  rows: readonly LedgerRowLike[],
  window: PhaseWindow,
  opportunities: number,
  ledgerLimit: number,
  completenessTolerance: number = 2,
): AckLedgerReport => {
  const inWindow = rows.filter((row) => row.atMs >= window.startMs && row.atMs < window.endMs);
  const excludedBefore = rows.filter((row) => row.atMs < window.startMs).length;
  const excludedAfter = rows.filter((row) => row.atMs >= window.endMs).length;

  const measured = inWindow.filter((row) => row.status === 'measured');
  const anchored = inWindow.filter((row) => row.status === 'anchored');
  const invalidated = inWindow.filter((row) => row.status === 'invalidated-missing-frames');

  const seqOwner = new Map<number, number>();
  let duplicates = 0;
  for (const row of measured) {
    for (const seq of row.seqs) {
      if (seqOwner.has(seq)) duplicates += 1;
      else seqOwner.set(seq, 1);
    }
  }
  const invalidatedSeqs = new Set<number>(invalidated.flatMap((row) => [...row.seqs]));
  const covered = new Set<number>([...seqOwner.keys(), ...invalidatedSeqs]);
  const seqList = [...covered];
  let gaps = 0;
  if (seqList.length > 0) {
    const lo = Math.min(...seqList);
    const hi = Math.max(...seqList);
    for (let seq = lo; seq <= hi; seq += 1) if (!covered.has(seq)) gaps += 1;
  }

  const truncated = rows.length >= ledgerLimit;
  const anchoredAcks = anchored.length;
  const delta = opportunities - (seqOwner.size + invalidatedSeqs.size + anchoredAcks);

  const magnitudes = measured.map((row) => row.magnitude); // zeros RETAINED
  const percentiles = magnitudes.length > 0
    ? {
      p50: nearestRank(magnitudes, 0.5),
      p95: nearestRank(magnitudes, 0.95),
      p99: nearestRank(magnitudes, 0.99),
      max: Math.max(...magnitudes),
      count: magnitudes.length,
    }
    : null;

  return {
    rowsTotal: rows.length,
    rowsInWindow: inWindow.length,
    excludedBeforeWindow: excludedBefore,
    excludedAfterWindow: excludedAfter,
    measuredInWindow: measured.length,
    zeroRetainedInWindow: magnitudes.filter((m) => m === 0).length,
    anchoredInWindow: anchored.length,
    invalidatedInWindow: invalidated.length,
    eligibleAcks: seqOwner.size,
    invalidatedAcks: invalidatedSeqs.size,
    duplicateAcks: duplicates,
    gapAcks: gaps,
    truncated,
    completenessDelta: delta,
    complete: !truncated && duplicates === 0 && gaps === 0 && Math.abs(delta) <= completenessTolerance,
    correctionPercentiles: percentiles,
  };
};

/* ------------------------------------------------------------------ motion auditor */

export interface MotionSample {
  readonly atMs: number;
  readonly x: number;
  readonly z: number;
}

export interface MotionReport {
  readonly count: number;
  readonly range: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Consecutive-sample intervals whose implied speed is below half the authored speed. */
  readonly stationaryIntervals: number;
  /** Samples at/inside the boundary band while motion presses toward it (clamp signature). */
  readonly boundaryPlateaus: number;
  /** Samples outside the region (structurally impossible without a clamp escape). */
  readonly outOfBounds: number;
  readonly maxSpeedMps: number;
  readonly medianSpeedMps: number;
}

/**
 * Audit the observer's view of the mover across the measurement window. `expectedSpeedMps` is
 * the authored speed; a stationary interval is any consecutive pair (sampled at most
 * `maxSampleGapMs` apart) that moved less than 40% of the expected distance — turns are
 * instantaneous direction changes in this harness, so a legitimate sample pair never goes
 * below that. A boundary plateau is two consecutive samples inside `clampBandMetres` of a
 * bound on an axis, meaning the position stopped advancing where it should have.
 */
export const auditMotion = (
  samples: readonly MotionSample[],
  bounds: { x: { min: number; max: number }; z: { min: number; max: number } },
  expectedSpeedMps: number,
  maxSampleGapMs: number,
  clampBandMetres: number = 2,
): MotionReport => {
  const sorted = [...samples].sort((a, b) => a.atMs - b.atMs);
  let stationary = 0;
  let plateau = 0;
  let outOfBounds = 0;
  const speeds: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i] as MotionSample;
    if (s.x < bounds.x.min || s.x > bounds.x.max || s.z < bounds.z.min || s.z > bounds.z.max) outOfBounds += 1;
    if (i === 0) continue;
    const p = sorted[i - 1] as MotionSample;
    const dtMs = s.atMs - p.atMs;
    if (dtMs <= 0 || dtMs > maxSampleGapMs) continue;
    const dist = Math.hypot(s.x - p.x, s.z - p.z);
    const speed = dist / (dtMs / 1000);
    speeds.push(speed);
    if (dist < expectedSpeedMps * (dtMs / 1000) * 0.4) stationary += 1;
    const nearX = Math.min(Math.abs(s.x - bounds.x.min), Math.abs(s.x - bounds.x.max)) <= clampBandMetres;
    const nearZ = Math.min(Math.abs(s.z - bounds.z.min), Math.abs(s.z - bounds.z.max)) <= clampBandMetres;
    const movedX = Math.abs(s.x - p.x) < 0.05;
    const movedZ = Math.abs(s.z - p.z) < 0.05;
    if ((nearX && movedX && Math.abs(s.z - p.z) > 0.05) || (nearZ && movedZ && Math.abs(s.x - p.x) > 0.05)) plateau += 1;
  }
  const xs = sorted.map((s) => s.x);
  const zs = sorted.map((s) => s.z);
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  return {
    count: sorted.length,
    range: {
      minX: xs.length > 0 ? Math.min(...xs) : 0,
      maxX: xs.length > 0 ? Math.max(...xs) : 0,
      minZ: zs.length > 0 ? Math.min(...zs) : 0,
      maxZ: zs.length > 0 ? Math.max(...zs) : 0,
    },
    stationaryIntervals: stationary,
    boundaryPlateaus: plateau,
    outOfBounds,
    maxSpeedMps: sortedSpeeds.length > 0 ? (sortedSpeeds.at(-1) ?? 0) : 0,
    medianSpeedMps: sortedSpeeds.length > 0 ? (sortedSpeeds[Math.floor(sortedSpeeds.length / 2)] ?? 0) : 0,
  };
};

/**
 * The canonical predeclared route: 12 s legs on a 48 m square, +x → +z → −x → −z, repeating.
 * Authored speed 4 m/s × 12 s = 48 m per leg; the loop occupies [start, start+48] on each axis,
 * which the cell verifies against the region bounds before the window runs (a route that could
 * reach a bound is a route that can be clamped — this one provably cannot, from spawn).
 */
export const canonicalRoute = {
  legMs: 12_000,
  legMetres: 48,
  directions: ['+x', '+z', '-x', '-z'] as const,
  legDirectionAt(elapsedMs: number): '+x' | '+z' | '-x' | '-z' {
    const leg = Math.floor(elapsedMs / this.legMs) % 4;
    return this.directions[leg] as '+x' | '+z' | '-x' | '-z';
  },
};
