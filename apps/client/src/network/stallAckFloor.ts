/**
 * UDG-SPIKE-001 slice 24 — DIAGNOSTIC PROTOTYPE (candidate ONLY, nothing adopted): a minimum
 * acknowledgement-OPPORTUNITY WAIT in front of the ADR-0003 §3.2 INPUT_ACK_STALLED trigger.
 *
 * WHAT THE WAIT IS, EXACTLY: the estimate (same-socket RTT + delivery/authority service
 * allowance, assembled per plan §19 from NAMED retained measurements) is a MEASURED CONSERVATIVE
 * WAIT/ENVELOPE — a wait chosen from observed distributions so a genuine ack has had a credible
 * opportunity to arrive. It is explicitly NOT a mathematical lower bound for every
 * acknowledgement: no claim survives that an ack CANNOT exist before the wait elapses; a fire
 * UNDER the wait could still be a true loss. What the wait buys is the elimination of the
 * STRUCTURAL false-positive class the ack-window diagnostic evidenced: a delivery-count streak
 * (G messages, fast arrivals included) that can COMPLETE before any ack is causally possible at
 * the profile's envelope.
 *
 * The function is PURE and clock-INJECTED so the adversarial cases run on synthetic clocks.
 * It NEVER touches the snapshot deadline, the episode deadline, or the rolling cap: an actually
 * missing delivery still expires through its own independent timers. It knows nothing about
 * server liveness — the wait requires NO timed activity from the server.
 *
 * STATUS: PROPOSED/CANDIDATE. Not adopted by the ADR, not the product default (the predictor
 * keeps the current count-only rule whenever floorMs is null), not wired into any formal lane.
 */

export type StallFloorDecision = 'fire' | 'held' | 'no-condition';

export interface StallFloorInput {
  /** The declared TEST WAIT for the run (null = prototype OFF → exactly today's rule). */
  readonly floorMs: number | null;
  readonly streak: number;
  readonly deliveriesRequired: number;
  /**
   * Sent instant of the OLDEST ACTUAL outstanding input in the CURRENT epoch, or null when
   * nothing genuinely outstanding exists in it. Obsolete entries (another domain's journal,
   * retired or pruned identities) are NOT passed: they never hold the recovery condition.
   */
  readonly oldestOutstandingSameEpochSentAtMs: number | null;
  readonly nowMs: number;
}

export const stalledAckFloorDecision = (input: StallFloorInput): StallFloorDecision => {
  if (input.streak < input.deliveriesRequired) return 'no-condition';
  if (input.floorMs === null) return 'fire'; // product rule unchanged when the prototype is off
  if (input.oldestOutstandingSameEpochSentAtMs === null) return 'no-condition';
  const ageMs = input.nowMs - input.oldestOutstandingSameEpochSentAtMs;
  return ageMs > input.floorMs ? 'fire' : 'held';
};

/* ── SLICE-28 (pre-staging implementation path for the §D design ADOPTED AS DESIGN, plan §21 /
 * ADR-0005): the CONFIGURABLE path, with no numeric chosen by the product.
 *
 * The default stays PROVISIONAL: an absent option means the shipped count-only rule continues —
 * the client NEVER silently selects a local wait value. Supplying a wait is an explicit opt-in
 * that must arrive VALIDATED: a wait alone is accepted only with a non-empty PROVENANCE (what was
 * measured, where); an optional MATCHED RECOVERY BUDGET is accepted only if it at least covers
 * the wait itself (the design's fuller coverage clause — budget covering measured
 * detection-PLUS-RECOVERY under the ACTUAL intended clock origin — needs real GA-11/deployment
 * measurements no client can fabricate, so a declared budget is always labelled
 * `declared-matched-not-independently-verified`). Invalid opt-ins FAIL CLOSED at the
 * config-validation stage (predictor construction): the seat never exists, the reasons are
 * named, and nothing degrades silently to count-only. The trigger-side age is measured on the
 * seat's DECLARED clock (the injected PredictorClock — the trigger origin); the recovery/episode
 * budgets keep their OWN timer origin; the status surface says so instead of assuming one clock.
 * NO production value exists here: WAIT_SANITY_CEILING_MS is a measurement-sanity bound that
 * refuses obviously-wrong inputs (0, negative, absurd), NOT a wait anyone chose to wait.        */

export const WAIT_SANITY_CEILING_MS = 60_000;
export const DEFAULT_DECLARED_CLOCK_ORIGIN = 'seat-declared-clock (the injected PredictorClock; trigger origin)';

export interface StallAckFloorConfig {
  /** The configured acknowledgement-opportunity wait, ms. Measured, provenanced, NOT defaulted. */
  readonly waitMs: number;
  /** Required: what measurement produced this wait (source, epoch/room scope, clock origin). */
  readonly provenance: string;
  /** Optional recovery-budget pairing; must at least cover the wait; coverage beyond that is a
   * real-environment measurement the client cannot verify. */
  readonly matchedBudgetMs?: number | undefined;
  /** The domain epoch the measurement was scoped to, when the supplier scoped it. */
  readonly appliedEpoch?: number | undefined;
  /** Declaration of the measurement's clock origin (never inferred). */
  readonly clockOrigin?: string | undefined;
}

export interface StallAckFloorResolved {
  readonly ok: true;
  readonly source: 'config-object' | 'legacy-numeric';
  readonly waitMs: number;
  readonly provenance: string;
  readonly matchedBudgetMs: number | null;
  readonly budgetStatus: 'declared-matched-not-independently-verified' | 'not-declared';
  readonly appliedEpoch: number | null;
  readonly clockOrigin: string;
}

export interface StallAckFloorRefused {
  readonly ok: false;
  readonly reasons: readonly string[];
}

/** Validate ONE opt-in. `raw` may be a number (the legacy harness option — kept working, provenance
 * honestly labelled) or a StallAckFloorConfig. Nothing is guessed: absent callers pass null/undefined. */
export const resolveStallAckFloorOption = (raw: number | StallAckFloorConfig | null | undefined): StallAckFloorResolved | StallAckFloorRefused => {
  if (raw === null || raw === undefined) {
    return { ok: false, reasons: ['resolveStallAckFloorOption is only for SUPPLIED values; absent means the provisional default'] };
  }
  if (typeof raw === 'number') {
    const reasons: string[] = [];
    if (!Number.isFinite(raw)) reasons.push('wait must be a finite number');
    else if (raw <= 0) reasons.push('wait must be strictly positive');
    else if (raw > WAIT_SANITY_CEILING_MS) reasons.push(`wait exceeds the ${String(WAIT_SANITY_CEILING_MS)} ms measurement-sanity ceiling (sanity bound, not a chosen value)`);
    if (reasons.length > 0) return { ok: false, reasons };
    return {
      ok: true, source: 'legacy-numeric', waitMs: raw,
      provenance: 'harness-supplied numeric (legacy option; supply a config object for a provenanced wait)',
      matchedBudgetMs: null, budgetStatus: 'not-declared', appliedEpoch: null, clockOrigin: DEFAULT_DECLARED_CLOCK_ORIGIN,
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reasons: ['wait must be a config object or a number'] };
  const input = raw as unknown as Record<string, unknown>;
  const reasons: string[] = [];
  const allowed = new Set(['waitMs', 'provenance', 'matchedBudgetMs', 'appliedEpoch', 'clockOrigin']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) reasons.push(`unknown config key '${key}' (fail closed: no silent fields)`);
  const waitMs = input['waitMs'];
  if (typeof waitMs !== 'number' || !Number.isFinite(waitMs)) reasons.push('waitMs must be a finite number');
  else if (waitMs <= 0) reasons.push('waitMs must be strictly positive');
  else if (waitMs > WAIT_SANITY_CEILING_MS) reasons.push(`waitMs exceeds the ${String(WAIT_SANITY_CEILING_MS)} ms measurement-sanity ceiling (sanity bound, not a chosen value)`);
  const provenance = input['provenance'];
  if (typeof provenance !== 'string' || provenance.trim() === '') reasons.push('provenance is REQUIRED and must be a non-empty description of the measurement');
  const budget = input['matchedBudgetMs'];
  if (budget !== undefined) {
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) reasons.push('matchedBudgetMs, when supplied, must be a finite positive number');
    else if (typeof waitMs === 'number' && Number.isFinite(waitMs) && waitMs > 0 && budget < waitMs) reasons.push('matchedBudgetMs must at least COVER the wait — a budget under its own wait is incoherent; detection+recovery coverage needs real-environment measurement and is never assumed');
  }
  const epoch = input['appliedEpoch'];
  if (epoch !== undefined && (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0)) reasons.push('appliedEpoch, when supplied, must be a non-negative integer');
  const origin = input['clockOrigin'];
  if (origin !== undefined && (typeof origin !== 'string' || origin.trim() === '')) reasons.push('clockOrigin, when supplied, must be a non-empty declaration');
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true, source: 'config-object', waitMs: waitMs as number, provenance: (provenance as string).trim(),
    matchedBudgetMs: budget === undefined ? null : (budget as number),
    budgetStatus: budget === undefined ? 'not-declared' : 'declared-matched-not-independently-verified',
    appliedEpoch: epoch === undefined ? null : (epoch as number),
    clockOrigin: origin === undefined ? DEFAULT_DECLARED_CLOCK_ORIGIN : (origin as string).trim(),
  };
};
