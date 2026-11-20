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
  readonly epoch: number;
  readonly authorityTick: number;
}

/** The immutable per-delivery record the predictor keeps about every patch (VerifiedDelivery). */
export interface DeliveryLike {
  readonly accepted: boolean;
  readonly delivery: { readonly atMs: number; readonly epoch: number; readonly authorityTick: number; readonly ack: number };
}

export interface PhaseWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * A matched measurement is ONE row per matched acknowledgement DELIVERY — the actual
 * population. The covered input-stamp count is a different quantity and can never substitute
 * for it: a single giant batch delivery would inflate stamps while contributing one boundary.
 * Review of 7c1ec03: bind eligible measurement to an immutable same-delivery key
 * (`epoch:authorityTick:ackTo`) inside the exact phase, exactly once, reconciled against the
 * opportunity ledger (accepted deliveries whose immutable ack field ADVANCED, derived from the
 * delivery rows alone) with NO unexplained tolerance: a missing or duplicate eligible
 * measurement, an overlapping measured/invalidated claim, or an unbound row FAILS — never a
 * counted zero, never a quietly shortened population. Exclusions are tracked only when
 * independently labelled (row timestamps vs the window; anchored rows whose delivery carried a
 * NON-advancing ack).
 */
export interface AckLedgerReport {
  readonly rowsTotal: number;
  readonly rowsInWindow: number;
  readonly excludedBeforeWindow: number;
  readonly excludedAfterWindow: number;
  readonly opportunityDeliveries: number;
  readonly matchedBoundariesInWindow: number;
  readonly measuredBoundaries: number;
  readonly zeroMeasured: number;
  readonly nonzeroMeasured: number;
  readonly anchoredBoundaries: number;
  readonly invalidatedBoundaries: number;
  /** Distinct INPUT STAMPS covered by measured rows — reported, never used as the N. */
  readonly coveredInputStamps: number;
  readonly duplicateKeys: number;
  /** Keys claimed by BOTH a measured/anchored and an invalidated row. */
  readonly overlapKeys: number;
  /** Opportunity deliveries with no matched row at all in the phase. */
  readonly missingMeasurements: number;
  /** Rows whose key matches no accepted delivery (independently-labelled cases excluded). */
  readonly unboundRows: number;
  /** Anchored rows on independently-labelled non-advancing-ack deliveries (tracked, not eligible). */
  readonly excludedNonAdvancing: number;
  readonly truncated: boolean;
  readonly complete: boolean;
  readonly correctionPercentiles: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly count: number } | null;
}

const keyOf = (epoch: number, authorityTick: number, ackTo: number): string => `${epoch}:${authorityTick}:${ackTo}`;

export const analyzeAckLedger = (
  rows: readonly LedgerRowLike[],
  deliveries: readonly DeliveryLike[],
  window: PhaseWindow,
  ledgerLimit: number,
): AckLedgerReport => {
  const inWindow = rows.filter((row) => row.atMs >= window.startMs && row.atMs < window.endMs);
  const excludedBefore = rows.filter((row) => row.atMs < window.startMs).length;
  const excludedAfter = rows.filter((row) => row.atMs >= window.endMs).length;

  // Opportunity ledger: accepted deliveries whose immutable ack field ADVANCED relative to
  // every earlier accepted delivery (computed across the full history, so the window's first
  // delivery is judged against pre-window state). Keys are first-seen delivery identity —
  // epoch:authorityTick:ackTo — the same immutable triple the matched rows carry.
  const accepted = deliveries.filter((d) => d.accepted).sort((a, b) => a.delivery.atMs - b.delivery.atMs);
  let maxAckSoFar = -1;
  const keyAdvanced = new Map<string, boolean>();
  const keyInWindow = new Map<string, boolean>();
  for (const d of accepted) {
    const advanced = d.delivery.ack > maxAckSoFar;
    maxAckSoFar = Math.max(maxAckSoFar, d.delivery.ack);
    const key = keyOf(d.delivery.epoch, d.delivery.authorityTick, d.delivery.ack);
    if (!keyAdvanced.has(key)) {
      keyAdvanced.set(key, advanced);
      keyInWindow.set(key, d.delivery.atMs >= window.startMs && d.delivery.atMs < window.endMs);
    } else if (d.delivery.atMs >= window.startMs && d.delivery.atMs < window.endMs) {
      keyInWindow.set(key, true);
    }
  }
  const opportunitiesInWindow = [...keyAdvanced.keys()].filter((k) => keyAdvanced.get(k) === true && keyInWindow.get(k) === true).length;

  const rowKeys = new Map<string, { measured: number; anchored: number; invalidated: number }>();
  for (const row of inWindow) {
    const key = keyOf(row.epoch, row.authorityTick, row.ackTo);
    const entry = rowKeys.get(key) ?? { measured: 0, anchored: 0, invalidated: 0 };
    if (row.status === 'measured') entry.measured += 1;
    else if (row.status === 'anchored') entry.anchored += 1;
    else if (row.status === 'invalidated-missing-frames') entry.invalidated += 1;
    rowKeys.set(key, entry);
  }

  let duplicates = 0;
  let overlaps = 0;
  let unbound = 0;
  let excludedNonAdvancing = 0;
  let measuredBoundaries = 0;
  let anchoredBoundaries = 0;
  let invalidatedBoundaries = 0;
  const measuredMagnitudes: number[] = [];
  const coveredSeqs = new Set<number>();
  const measuredByRank: { key: string; magnitude: number; seqs: readonly number[] }[] = [];
  for (const [key, entry] of rowKeys) {
    const claims = entry.measured + entry.anchored + entry.invalidated;
    if (entry.measured > 1) duplicates += entry.measured - 1;
    if (claims > 1) overlaps += 1; // multiple rows claiming ONE eligible boundary
    const advanced = keyAdvanced.get(key);
    if (advanced === undefined) {
      unbound += claims; // row whose key matches no accepted delivery at all
      continue;
    }
    if (advanced === false) {
      excludedNonAdvancing += claims; // independently labelled: the delivery's ack did not advance
      continue;
    }
    if (entry.measured > 0) {
      measuredBoundaries += 1;
      const row = inWindow.find((r) => keyOf(r.epoch, r.authorityTick, r.ackTo) === key && r.status === 'measured');
      if (row !== undefined) measuredByRank.push({ key, magnitude: row.magnitude, seqs: row.seqs });
    } else if (entry.anchored > 0) anchoredBoundaries += 1;
    else if (entry.invalidated > 0) invalidatedBoundaries += 1;
  }
  for (const m of measuredByRank) {
    measuredMagnitudes.push(m.magnitude);
    for (const seq of m.seqs) coveredSeqs.add(seq);
  }
  let missing = 0;
  for (const [key, advanced] of keyAdvanced) {
    if (advanced !== true || keyInWindow.get(key) !== true) continue;
    if (!rowKeys.has(key)) missing += 1;
  }

  const truncated = rows.length >= ledgerLimit;
  const magnitudes = measuredMagnitudes; // zeros RETAINED
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
    opportunityDeliveries: opportunitiesInWindow,
    matchedBoundariesInWindow: rowKeys.size,
    measuredBoundaries,
    zeroMeasured: magnitudes.filter((m) => m === 0).length,
    nonzeroMeasured: magnitudes.filter((m) => m !== 0).length,
    anchoredBoundaries,
    invalidatedBoundaries,
    coveredInputStamps: coveredSeqs.size,
    duplicateKeys: duplicates,
    overlapKeys: overlaps,
    missingMeasurements: missing,
    unboundRows: unbound,
    excludedNonAdvancing,
    truncated,
    complete: !truncated && duplicates === 0 && overlaps === 0 && missing === 0 && unbound === 0,
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
