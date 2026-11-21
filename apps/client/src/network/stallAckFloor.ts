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
  readonly source: 'config-object' | 'legacy-numeric' | 'measured-receipt';
  readonly waitMs: number;
  readonly provenance: string;
  readonly matchedBudgetMs: number | null;
  readonly budgetStatus: 'declared-matched-not-independently-verified' | 'not-declared' | 'machine-validated-recorded-durations-not-production-enabled';
  readonly appliedEpoch: number | null;
  readonly clockOrigin: string;
  /** Measured receipts only: the concrete room scope and the machine validation outcome. */
  readonly roomScope: string | null;
  readonly receiptValidation: ReceiptValidation | null;
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
      roomScope: null, receiptValidation: null,
    };
  }
  // MEASURED-CONFIG PATH (slice 29): a receipt record, machine-validated in full before anything
  // can use it. Distinct source label; the seat additionally enforces its room/epoch scope at use.
  if (typeof raw === 'object' && !Array.isArray(raw) && (raw as unknown as Record<string, unknown>)['kind'] === MEASURED_WAIT_RECEIPT_KIND) {
    const verdict = validateMeasuredWaitReceipt(raw);
    if (!verdict.ok) return verdict;
    const v = verdict.validation;
    const r = raw as unknown as Record<string, unknown>;
    return {
      ok: true, source: 'measured-receipt', waitMs: r['waitMs'] as number, provenance: (r['provenance'] as string).trim(),
      matchedBudgetMs: v.availableBudgetMs, budgetStatus: 'machine-validated-recorded-durations-not-production-enabled',
      appliedEpoch: v.epochScope, clockOrigin: `receipt segments on ${v.segmentsClockOrigin}/${v.segmentsBasis}; declared budget on ${v.budgetClockOrigin}/${v.budgetBasis}`,
      roomScope: v.roomScope, receiptValidation: v,
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
    roomScope: null, receiptValidation: null,
  };
};

/* ── SLICE-29 (pre-staging, reviewer-shaped): the MEASURED-CONFIG PATH for future representative
 * receipts — clearly distinct from the legacy numeric/local declared experimental path above,
 * which stays exactly as it is (harness option, PROTOTYPE-labelled, honestly unprovenanced).
 *
 * A MEASURED WAIT RECEIPT is a record of what a measurement observed, supplied by whoever owns the
 * measurement (today: synthetic test records ONLY; later: representative-deployment receipts from
 * GA-11-class evidence). The validator is a MACHINE check over the record, never a rubber stamp:
 *   - every duration must be present, finite, plausible, and > 0 in total;
 *   - detection and recovery durations are summed ONLY when they declare the SAME clock origin and
 *     the SAME timer basis — unrelated clocks are never summed;
 *   - the recorded detection+recovery duration is compared against the DECLARED available budget
 *     only on MATCHING origins; a timer-from-fire against a budget-from-send is compared ONLY with
 *     an explicit declared send→fire offset, and the comparison is then labelled normalized;
 *   - a budget that cannot CONTAIN its own measured duration (under-budget claim) is refused;
 *   - provenance and a CONCRETE roomScope are mandatory (no wildcard scope exists in this shape);
 *     epochScope is either an explicit epoch or an explicit null (declared epoch-agnostic).
 * Scope at USE is enforced by the seat (ColyseusPredictionAdapter): a receipt whose room or epoch
 * does not match the live seat is NEVER silently activated — the shipped count-only default
 * continues, the trigger detail names why, and stallAckFloorStatus() reports it. Where no room
 * identity exists at the public entry point, the receipt stays explicitly INELIGIBLE until bound
 * with the actual supported identity (the joined room id) — no guessed IDs, ever.
 * NOTHING here admits a real deployment value, proves anything, or changes the product default.  */

export const MEASURED_WAIT_RECEIPT_KIND = 'measured-wait-receipt';
/** Sanity bound for RECORDED durations (refuses obviously-wrong records; not a chosen value). */
export const RECORDED_DURATION_CEILING_MS = 600_000;
/** The clock origin/basis an APPLIED seat episode reconciliation can legitimately claim: the
 * seat's declared clock, measured from trigger fire to first accepted snapshot delivery. */
export const EPISODE_CLOCK_ORIGIN = 'seat-declared-clock';
export const EPISODE_BASIS_FROM_FIRE = 'from-fire';
export const EPISODE_BASIS_FROM_OLDEST_SEND = 'from-oldest-send';

export interface MeasuredInterval {
  /** Recorded duration, ms. */
  readonly durationMs: number;
  /** REQUIRED declaration of the clock the duration was measured on (never inferred). */
  readonly clockOrigin: string;
  /** REQUIRED declaration of the timer basis the duration starts/ends on (e.g. 'from-fire'). */
  readonly basis: string;
}

export interface MeasuredWaitReceipt {
  readonly kind: typeof MEASURED_WAIT_RECEIPT_KIND;
  /** The acknowledgement-opportunity wait the measurement supports (measured conservative envelope). */
  readonly waitMs: number;
  /** REQUIRED: which measurement produced this record (representative receipt identity). */
  readonly provenance: string;
  /** REQUIRED concrete room identity the measurement is scoped to. No wildcards. */
  readonly roomScope: string;
  /** REQUIRED declaration: the domain epoch measured at, or null meaning declared epoch-agnostic. */
  readonly epochScope: number | null;
  /** Recorded detection duration (trigger condition → fire decision). */
  readonly detection: MeasuredInterval;
  /** Recorded recovery duration; must share detection's declared origin AND basis to be summed. */
  readonly recovery: MeasuredInterval;
  /** The DECLARED available budget the measurement was taken against. */
  readonly budget: { readonly availableMs: number; readonly clockOrigin: string; readonly basis: string };
  /** Explicit normalization, used ONLY when segments are from-fire and the budget is
   * from-oldest-send: the declared send→fire offset. Declared, never re-measured here. */
  readonly sendToFireOffsetMs?: number | undefined;
}

export interface ReceiptValidation {
  readonly observedDetectionPlusRecoveryMs: number;
  readonly comparedMs: number;
  readonly availableBudgetMs: number;
  readonly comparison: 'within-budget' | 'within-budget-normalized';
  readonly normalized: boolean;
  readonly segmentsClockOrigin: string;
  readonly segmentsBasis: string;
  readonly budgetClockOrigin: string;
  readonly budgetBasis: string;
  readonly sendToFireOffsetMs: number | null;
  readonly roomScope: string;
  readonly epochScope: number | null;
  readonly basisNote: string;
}

export interface ReceiptRefused { readonly ok: false; readonly reasons: readonly string[] }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const readInterval = (raw: unknown, label: string, reasons: string[]): MeasuredInterval | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    reasons.push(`${label} must be an object recording durationMs + clockOrigin + basis`);
    return null;
  }
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== 'durationMs' && key !== 'clockOrigin' && key !== 'basis') reasons.push(`${label}: unknown field '${key}'`);
  }
  const d = o['durationMs'];
  if (!num(d)) reasons.push(`${label}.durationMs must be a finite number`);
  else if (d < 0) reasons.push(`${label}.durationMs must be >= 0`);
  else if (d > RECORDED_DURATION_CEILING_MS) reasons.push(`${label}.durationMs exceeds the ${String(RECORDED_DURATION_CEILING_MS)} ms recorded-duration sanity ceiling`);
  if (!str(o['clockOrigin'])) reasons.push(`${label}.clockOrigin is REQUIRED (declared measurement clock; never inferred)`);
  if (!str(o['basis'])) reasons.push(`${label}.basis is REQUIRED (declared timer basis; e.g. '${EPISODE_BASIS_FROM_FIRE}' or '${EPISODE_BASIS_FROM_OLDEST_SEND}')`);
  if (!num(d) || !str(o['clockOrigin']) || !str(o['basis'])) return null;
  return { durationMs: d, clockOrigin: (o['clockOrigin'] as string).trim(), basis: (o['basis'] as string).trim() };
};

/** MACHINE validation of one measured-wait receipt record. Pure; refuses loudly; admits nothing
 * it cannot check and invents nothing it was not given. */
export const validateMeasuredWaitReceipt = (raw: unknown): { ok: true; validation: ReceiptValidation } | ReceiptRefused => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reasons: ['receipt must be an object'] };
  const r = raw as Record<string, unknown>;
  const reasons: string[] = [];
  const allowed = new Set(['kind', 'waitMs', 'provenance', 'roomScope', 'epochScope', 'detection', 'recovery', 'budget', 'sendToFireOffsetMs']);
  for (const key of Object.keys(r)) if (!allowed.has(key)) reasons.push(`unknown receipt field '${key}' (fail closed: no silent fields)`);
  if (r['kind'] !== MEASURED_WAIT_RECEIPT_KIND) reasons.push(`kind must be '${MEASURED_WAIT_RECEIPT_KIND}'`);
  const wait = r['waitMs'];
  if (!num(wait) || wait <= 0) reasons.push('waitMs must be a finite positive number');
  else if (wait > WAIT_SANITY_CEILING_MS) reasons.push(`waitMs exceeds the ${String(WAIT_SANITY_CEILING_MS)} ms measurement-sanity ceiling`);
  if (!str(r['provenance'])) reasons.push('provenance is REQUIRED (the representative measurement this receipt records)');
  const roomScope = r['roomScope'];
  if (!str(roomScope)) reasons.push('roomScope is REQUIRED and must be a CONCRETE room identity — a measured profile has a scope or it is not admitted');
  else if (roomScope.trim() === '*' || roomScope.trim().toLowerCase() === 'all') reasons.push('roomScope may not be a wildcard — an unscoped measured profile is exactly the silent activation this path exists to prevent');
  const epochScope = r['epochScope'];
  if (epochScope !== null && (!num(epochScope) || !Number.isInteger(epochScope) || epochScope < 0)) reasons.push('epochScope is REQUIRED as a non-negative integer or an explicit null (declared epoch-agnostic)');
  const detection = readInterval(r['detection'], 'detection', reasons);
  const recovery = readInterval(r['recovery'], 'recovery', reasons);
  let budgetOk = false;
  let budget = { availableMs: 0, clockOrigin: '', basis: '' };
  if (typeof r['budget'] === 'object' && r['budget'] !== null && !Array.isArray(r['budget'])) {
    const b = r['budget'] as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (key !== 'availableMs' && key !== 'clockOrigin' && key !== 'basis') reasons.push(`budget: unknown field '${key}'`);
    }
    if (num(b['availableMs']) && b['availableMs'] > 0 && b['availableMs'] <= RECORDED_DURATION_CEILING_MS
      && str(b['clockOrigin']) && str(b['basis'])) {
      budget = { availableMs: b['availableMs'], clockOrigin: (b['clockOrigin'] as string).trim(), basis: (b['basis'] as string).trim() };
      budgetOk = true;
    } else reasons.push('budget must declare a finite positive availableMs within the sanity ceiling plus non-empty clockOrigin and basis');
  } else reasons.push('budget is REQUIRED (the declared available budget the measurement was taken against)');
  const offset = r['sendToFireOffsetMs'];
  const offsetSane = offset === undefined || (num(offset) && offset >= 0);
  const offsetMs: number | null = num(offset) && offset >= 0 ? offset : null;
  if (!offsetSane) reasons.push('sendToFireOffsetMs, when supplied, must be a finite non-negative declared offset');
  if (reasons.length > 0 || detection === null || recovery === null || !budgetOk) return { ok: false, reasons };

  // NEVER sum unrelated clocks: the two recorded segments must share one declared origin AND basis.
  if (detection.clockOrigin !== recovery.clockOrigin || detection.basis !== recovery.basis) {
    return {
      ok: false,
      reasons: [`do not sum unrelated clocks: detection was recorded on '${detection.clockOrigin}/${detection.basis}' and recovery on '${recovery.clockOrigin}/${recovery.basis}' — only same-origin, same-basis segments may be added`],
    };
  }
  const observed = detection.durationMs + recovery.durationMs;
  if (observed <= 0) return { ok: false, reasons: ['inconsistent record: recorded detection+recovery totals 0 ms — a duration-0 measurement supports no wait claim'] };

  // Compare on MATCHING origins, or normalize EXPLICITLY, or refuse. Never mix silently.
  let comparedMs = observed;
  let normalized = false;
  let basisNote = 'budget origin and basis match the recorded segments; no normalization applied';
  if (budget.clockOrigin === detection.clockOrigin && budget.basis === detection.basis) {
    if (offset !== undefined) return { ok: false, reasons: ['sendToFireOffsetMs supplied although the bases already match — an unneeded normalization is an inconsistent record'] };
  } else if (detection.basis === EPISODE_BASIS_FROM_FIRE && budget.basis === EPISODE_BASIS_FROM_OLDEST_SEND && budget.clockOrigin === detection.clockOrigin && offsetMs !== null && offsetMs >= 0) {
    comparedMs = observed + offsetMs;
    normalized = true;
    basisNote = `normalized with the DECLARED send→fire offset ${String(offsetMs)} ms (budget basis '${EPISODE_BASIS_FROM_OLDEST_SEND}', segment basis '${EPISODE_BASIS_FROM_FIRE}'); the offset is declared by the supplier, not re-measured here`;
  } else if (budget.clockOrigin !== detection.clockOrigin) {
    return { ok: false, reasons: [`budget was declared on a DIFFERENT clock origin ('${budget.clockOrigin}') than the recorded segments ('${detection.clockOrigin}') — cross-clock comparisons are refused, no offset normalizes across clocks`] };
  } else if (offsetMs !== null && budget.clockOrigin === detection.clockOrigin) {
    return { ok: false, reasons: [`cannot normalize '${detection.basis}' segments against a '${budget.basis}' budget — the only declared normalization is a send→fire offset for from-fire segments vs a from-oldest-send budget`] };
  } else {
    return { ok: false, reasons: [`budget basis '${budget.basis}' does not match the recorded segments' basis '${detection.basis}' and no explicit normalization was supplied — a timer-from-fire and a budget-from-send may not be compared unnormalized; declare matching origins or supply sendToFireOffsetMs`] };
  }

  if (comparedMs > budget.availableMs) {
    return {
      ok: false,
      reasons: [`under-budget claim refused: recorded detection+recovery${normalized ? ' plus the declared offset' : ''} (${String(comparedMs)} ms compared) exceeds the declared available budget (${String(budget.availableMs)} ms) — a budget that cannot contain its own measured duration is not a supportable wait`],
    };
  }
  return {
    ok: true,
    validation: {
      observedDetectionPlusRecoveryMs: observed, comparedMs, availableBudgetMs: budget.availableMs,
      comparison: normalized ? 'within-budget-normalized' : 'within-budget',
      normalized, segmentsClockOrigin: detection.clockOrigin, segmentsBasis: detection.basis,
      budgetClockOrigin: budget.clockOrigin, budgetBasis: budget.basis,
      sendToFireOffsetMs: offsetMs,
      roomScope: (roomScope as string).trim(),
      epochScope: epochScope === null ? null : (epochScope as number),
      basisNote,
    },
  };
};
