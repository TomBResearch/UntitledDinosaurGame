/**
 * UDG-SPIKE-001 — spike statistics (assignment §2.2, measurement.md §7.4 as adopted).
 *
 * Every rule here is the adopted text turned into code, with the code deliberately dumb and
 * deterministic so a reviewer can re-derive any number from the raw samples:
 *
 * - **Nearest-rank percentiles**: sort ascending, take the sample at index `ceil(p * N) - 1`
 *   (the measurement doc's "sorted sample at ceiling(p times N)"). No interpolation, no weighting:
 *   a percentile returned here is always an OBSERVED sample, never a constructed value.
 * - **Zero values are retained.** A zero correction is an eligible acknowledgement and participates
 *   in N and in every percentile. Nothing in this file may filter a sample because it is zero.
 * - **Missing samples fail.** The caller states the eligible-acknowledgement opportunity count;
 *   if fewer corrections were measured than there were opportunities, the population is invalid
 *   with reason `missing-samples` — a missing sample is never silently treated as zero, and never
 *   quietly shrinks N.
 * - **The 100-acknowledgement floor.** N below 100 measured acknowledgements fails the run as
 *   `insufficient-evidence`; percentiles of such a population are reported for diagnosis only and
 *   can never carry a gate verdict.
 * - **Requested-versus-achieved network record.** Both are kept as raw sample arrays. The achieved
 *   record decides the INVALID rule exactly as written: achieved median RTT more than 10 ms from
 *   the requested RTT, or achieved (p95 − p50) more than 10 ms over the declared jitter budget.
 */

/** One measured value. NaN/Infinity are rejected at the boundary, never coerced. */
export type Sample = number;

/** Adopted floor: a run with fewer measured eligible acknowledgements fails (§2.2). */
export const MIN_ELIGIBLE_ACKS_PER_RUN = 100;

/** Adopted achieved-network tolerances (§2.2): both limbs are "more than 10 ms". */
export const RTT_MEDIAN_TOLERANCE_MS = 10;
export const RTT_JITTER_TOLERANCE_MS = 10;

export interface NonFiniteReport {
  readonly index: number;
  readonly value: Sample;
}

/** Every sample must be a finite number. Returns the offenders; empty means the population is clean. */
export const findNonFinite = (samples: readonly Sample[]): readonly NonFiniteReport[] => {
  const bad: NonFiniteReport[] = [];
  samples.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) bad.push({ index, value });
  });
  return bad;
};

const ascending = (a: number, b: number): number => a - b;

/**
 * Nearest-rank percentile: the sorted sample at `ceil(p * N)`, 1-based. `p` is a fraction in
 * (0, 1]. Empty populations throw — a caller that has no samples has no percentile to report,
 * and a thrown Error cannot be misread as a zero.
 */
export const nearestRank = (samples: readonly Sample[], p: number): Sample => {
  if (samples.length === 0) throw new Error('nearest-rank of an empty population is undefined');
  if (!(p > 0 && p <= 1)) throw new Error(`percentile p must be in (0, 1], got ${String(p)}`);
  const nonFinite = findNonFinite(samples);
  if (nonFinite.length > 0) throw new Error(`non-finite sample at index ${String(nonFinite[0]?.index)}`);
  const sorted = [...samples].sort(ascending);
  const rank = Math.ceil(p * sorted.length);
  const value = sorted[rank - 1];
  if (value === undefined) throw new Error('nearest-rank index escaped the sorted population');
  return value;
};

export interface PercentileSet {
  readonly n: number;
  readonly p50: Sample;
  readonly p95: Sample;
  readonly p99: Sample;
  readonly max: Sample;
}

/** p50/p95/p99/max of a non-empty population, all nearest-rank, plus the sample count. */
export const percentiles = (samples: readonly Sample[]): PercentileSet => {
  if (samples.length === 0) throw new Error('percentiles of an empty population are undefined');
  return {
    n: samples.length,
    p50: nearestRank(samples, 0.5),
    p95: nearestRank(samples, 0.95),
    p99: nearestRank(samples, 0.99),
    max: nearestRank(samples, 1),
  };
};

/** One measured eligible acknowledgement at its matched input boundary. */
export interface CorrectionSample {
  /** Raw predicted-versus-authoritative horizontal magnitude at the matched acknowledged boundary. */
  readonly magnitudeMetres: Sample;
  /** True when this ack carried a labelled correction teleport: excluded from SMOOTHNESS statistics only. */
  readonly labelledReset?: boolean;
}

export type CorrectionFailureReason = 'missing-samples' | 'non-finite-samples' | 'insufficient-evidence' | 'negative-magnitude';

export interface CorrectionSummary {
  /** Declared eligible authoritative acknowledgement opportunities for the run. */
  readonly opportunities: number;
  /** Corrections actually measured, INCLUDING zero values. */
  readonly measured: number;
  readonly missing: number;
  readonly zeroValues: number;
  readonly nonzeroValues: number;
  readonly excludedLabelledResets: number;
  readonly failures: readonly CorrectionFailureReason[];
  readonly ok: boolean;
  /** Percentiles over the retained (unfiltered) magnitudes; absent only when nothing was measured. */
  readonly percentiles: PercentileSet | null;
  /**
   * Smoothness view: the same population MINUS labelled correction teleports, which the contract
   * excludes from smoothness statistics while keeping their raw corrections in `percentiles`.
   */
  readonly smoothness: PercentileSet | null;
}

/**
 * The correction-population rule in one call. `opportunities` is the eligible-ack count the
 * authority owes the run; the caller must derive it from the authority ledger, not from the
 * number of samples it happens to have collected — that asymmetry is what makes a missing
 * sample fail instead of hiding.
 */
export const summarizeCorrections = (
  samples: readonly CorrectionSample[],
  opportunities: number,
): CorrectionSummary => {
  const magnitudes = samples.map((s) => s.magnitudeMetres);
  const failures = new Set<CorrectionFailureReason>();
  if (!Number.isInteger(opportunities) || opportunities < 0) failures.add('missing-samples');
  const missing = opportunities - samples.length;
  if (missing > 0) failures.add('missing-samples');
  if (findNonFinite(magnitudes).length > 0) failures.add('non-finite-samples');
  if (magnitudes.some((m) => m < 0)) failures.add('negative-magnitude');
  const measured = samples.length;
  if (measured < MIN_ELIGIBLE_ACKS_PER_RUN) failures.add('insufficient-evidence');

  const zeroValues = magnitudes.filter((m) => m === 0).length;
  const excludedLabelledResets = samples.filter((s) => s.labelledReset === true).length;
  const smoothnessPopulation = samples.filter((s) => s.labelledReset !== true).map((s) => s.magnitudeMetres);

  return {
    opportunities,
    measured,
    missing: Math.max(missing, 0),
    zeroValues,
    nonzeroValues: magnitudes.length - zeroValues,
    excludedLabelledResets,
    failures: [...failures],
    ok: failures.size === 0,
    percentiles: magnitudes.length > 0 && findNonFinite(magnitudes).length === 0 ? percentiles(magnitudes) : null,
    smoothness: smoothnessPopulation.length > 0 && findNonFinite(smoothnessPopulation).length === 0
      ? percentiles(smoothnessPopulation)
      : null,
  };
};

/** One requested/achieved raw pair: what the profile asked for and what the path actually did. */
export interface DelayPair {
  readonly requestedMs: Sample;
  readonly achievedMs: Sample;
}

export interface RequestedAchieved {
  readonly requested: PercentileSet | null;
  readonly achieved: PercentileSet | null;
  readonly samples: number;
}

/** Keep both populations side by side; neither is derived from the other. Empty gives nulls, not zeros. */
export const summarizeDelays = (pairs: readonly DelayPair[]): RequestedAchieved => {
  if (pairs.length === 0) return { requested: null, achieved: null, samples: 0 };
  const requested = pairs.map((p) => p.requestedMs);
  const achieved = pairs.map((p) => p.achievedMs);
  if (findNonFinite(requested).length > 0 || findNonFinite(achieved).length > 0) {
    throw new Error('delay samples must all be finite');
  }
  return { requested: percentiles(requested), achieved: percentiles(achieved), samples: pairs.length };
};

export interface NetworkValidityInput {
  /** The profile's requested RTT in ms — the number the run declared before it started. */
  readonly requestedRttMs: number;
  /** The declared jitter budget for the achieved RTT distribution (p95 − p50), in ms. */
  readonly declaredJitterBudgetMs: number;
  /** Raw achieved RTT samples in ms (paired one-way delays or equivalent; rule is distribution-only). */
  readonly achievedRttSamples: readonly Sample[];
}

export interface NetworkValidity {
  readonly achieved: PercentileSet | null;
  readonly achievedMedianDeltaMs: number | null;
  readonly achievedJitterMs: number | null;
  /** True only when neither INVALID limb fired AND at least one achieved sample exists. */
  readonly valid: boolean;
  readonly reasons: readonly string[];
}

/**
 * The achieved-network validity rule, §2.2 as written: achieved median RTT differing by more than
 * 10 ms from the request, or measured p95 − p50 exceeding the declared budget by more than 10 ms,
 * marks the profile INVALID. A profile with zero achieved samples cannot be valid either — it has
 * no achieved record to be valid about.
 */
export const networkValidity = (input: NetworkValidityInput): NetworkValidity => {
  const reasons: string[] = [];
  if (input.achievedRttSamples.length === 0) {
    return {
      achieved: null,
      achievedMedianDeltaMs: null,
      achievedJitterMs: null,
      valid: false,
      reasons: ['no-achieved-samples'],
    };
  }
  const achieved = percentiles(input.achievedRttSamples);
  const medianDelta = achieved.p50 - input.requestedRttMs;
  const jitter = achieved.p95 - achieved.p50;
  if (Math.abs(medianDelta) > RTT_MEDIAN_TOLERANCE_MS) {
    reasons.push(`achieved-median-rtt-off-by-${Math.abs(medianDelta).toFixed(3)}-ms`);
  }
  if (jitter - input.declaredJitterBudgetMs > RTT_JITTER_TOLERANCE_MS) {
    reasons.push(`achieved-jitter-${jitter.toFixed(3)}-ms-exceeds-budget-${String(input.declaredJitterBudgetMs)}-ms-by-more-than-10-ms`);
  }
  return {
    achieved,
    achievedMedianDeltaMs: medianDelta,
    achievedJitterMs: jitter,
    valid: reasons.length === 0,
    reasons,
  };
};
