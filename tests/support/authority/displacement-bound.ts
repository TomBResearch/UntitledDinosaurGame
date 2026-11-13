/**
 * AC-3c: "bounded displacement: as AC-2, re-asserted per tick over the abuse population so a burst
 * cannot buy extra travel per tick" (T-2).
 *
 * Two separate claims, because the population makes them easy to conflate:
 *
 * 1. **per tick** — every tick that resolved an accepted frame moved the entity by at most
 *    `speed × simulationStepSeconds + 1e-6` metres. This is where a burst would show up if the drain
 *    rule ever leaked more than one frame into one step.
 * 2. **per seat** — the metres a seat travelled cannot exceed its accepted stamps × the per-tick bound.
 *    That is what "a burst cannot buy extra travel" means arithmetically: the budget's denominator is
 *    the stamps the authority *accepted*, never the frames the client sent, so F-1's shape (a seat whose
 *    frames were all refused travelling 12 m) violates it by construction.
 *
 * Ticks are separated by the authority's own rules, not by the metres figure, because three different
 * states all read 0 m:
 *
 * * `accepted-input` — a `tick` row with `consumed` non-null;
 * * `refused-input` — an `observation` row whose disposition starts `refused:` for that entity with
 *   `eligibleTick` equal to the tick (GA-4: a refusal neutralises the step and is journalled once);
 * * `no-input` — a `tick` row whose `inputSource` is `neutral` with no refused observation at that tick.
 *
 * Every control mutates rows and says whether the same arithmetic caught it. The beyond-tolerance
 * control exceeds the ACTUAL tolerance (0.2 + 1e-6) rather than a rounded approximation of it, and the
 * within-tolerance control sits inside that tolerance and must NOT be reported: a checker that silently
 * compared against the bare bound would pass the second control only if the tolerance were honoured.
 */

export interface DisplacementViolation {
  readonly tick: number;
  readonly entityId: string;
  readonly displacement: number;
  readonly excessOverTolerance: number;
}

export interface TravelBudgetRow {
  readonly entityId: string;
  readonly acceptedStamps: number;
  readonly metresTravelled: number;
  readonly budgetMetres: number;
  readonly exceeded: boolean;
}

export interface DisplacementControl {
  readonly name: string;
  readonly mutation: string;
  readonly expectedDetected: boolean;
  readonly detected: boolean;
  readonly detail: string;
}

export interface DisplacementAudit {
  readonly classification: {
    readonly acceptedTicks: number;
    readonly refusedTicks: number;
    readonly noInputTicks: number;
    readonly totalTickRows: number;
  };
  readonly boundMetres: number;
  readonly toleranceMetres: number;
  readonly maxAcceptedDisplacement: number;
  readonly outOfBound: readonly DisplacementViolation[];
  readonly travelBudget: readonly TravelBudgetRow[];
  readonly controls: readonly DisplacementControl[];
  readonly passed: boolean;
}

export interface DisplacementAuditInput {
  readonly journalRows: readonly Record<string, unknown>[];
  /** The per-tick bound of the relation under test: `speed × simulationStepSeconds`. */
  readonly boundMetres: number;
  readonly toleranceMetres: number;
  /** Accepted stamp counts per entity, from `streamAccounting` — never from a watermark. */
  readonly acceptedStampsByEntity: Readonly<Record<string, number>>;
  /** Entities known to have sent nothing that was accepted; the travel credit control uses one. */
  readonly zeroAcceptedEntity?: string;
}

interface TickRowView {
  readonly tick: number;
  readonly entityId: string;
  readonly consumed: number | null;
  readonly inputSource: string;
  readonly displacement: number;
}

const tickRows = (rows: readonly Record<string, unknown>[]): TickRowView[] =>
  rows
    .filter((row) => row['type'] === 'tick')
    .map((row) => ({
      tick: Number(row['tick']),
      entityId: String(row['entityId']),
      consumed: row['consumed'] === null || row['consumed'] === undefined ? null : Number(row['consumed']),
      inputSource: String(row['inputSource'] ?? 'unknown'),
      displacement: Number(row['resolvedDisplacement']) || 0,
    }));

const refusedKeys = (rows: readonly Record<string, unknown>[]): Set<string> =>
  new Set(
    rows
      .filter((row) => row['type'] === 'observation' && String(row['disposition'] ?? '').startsWith('refused:'))
      .map((row) => `${String(row['entityId'])}@${String(row['eligibleTick'])}`),
  );

const boundViolations = (
  rows: readonly TickRowView[],
  boundMetres: number,
  toleranceMetres: number,
): DisplacementViolation[] =>
  rows
    .filter((row) => row.consumed !== null && row.displacement > boundMetres + toleranceMetres)
    .map((row) => ({
      tick: row.tick,
      entityId: row.entityId,
      displacement: row.displacement,
      excessOverTolerance: row.displacement - (boundMetres + toleranceMetres),
    }));

export const computeDisplacementBounds = (input: DisplacementAuditInput): DisplacementAudit => {
  const { journalRows, boundMetres, toleranceMetres, acceptedStampsByEntity } = input;
  const ticks = tickRows(journalRows);
  const refused = refusedKeys(journalRows);

  const accepted = ticks.filter((row) => row.consumed !== null);
  const refusedTicks = ticks.filter((row) => row.consumed === null && refused.has(`${row.entityId}@${row.tick}`));
  const noInput = ticks.filter(
    (row) => row.consumed === null && row.inputSource === 'neutral' && !refused.has(`${row.entityId}@${row.tick}`),
  );

  const outOfBound = boundViolations(ticks, boundMetres, toleranceMetres);
  const maxAcceptedDisplacement = accepted.reduce((max, row) => Math.max(max, row.displacement), 0);

  // ── per-seat travel budget ───────────────────────────────────────────────────────────────────
  const travelled = new Map<string, number>();
  for (const row of accepted) travelled.set(row.entityId, (travelled.get(row.entityId) ?? 0) + row.displacement);
  const entities = new Set([...travelled.keys(), ...Object.keys(acceptedStampsByEntity)]);
  const travelBudget: TravelBudgetRow[] = [...entities].sort().map((entityId) => {
    const acceptedStamps = acceptedStampsByEntity[entityId] ?? 0;
    const metresTravelled = Math.round((travelled.get(entityId) ?? 0) * 1e9) / 1e9;
    const budgetMetres = acceptedStamps * boundMetres + toleranceMetres;
    return { entityId, acceptedStamps, metresTravelled, budgetMetres, exceeded: metresTravelled > budgetMetres };
  });

  // ── controls: each one breaks a rule, and the same arithmetic has to say so ──────────────────
  const controls: DisplacementControl[] = [];
  const push = (name: string, mutation: string, expectedDetected: boolean, detected: boolean, detail: string): void => {
    controls.push({ name, mutation, expectedDetected, detected, detail });
  };
  const sample = accepted[0] ?? null;

  // C1 — beyond the ACTUAL tolerance. 0.2000021 against a threshold of 0.200001 is over by 1.1e-6 m,
  // and the report has to name the tick and the entity, because "some tick somewhere moved too far" is
  // not something a reviewer can act on.
  if (sample !== null) {
    const mutated = ticks.map((row) => (row === sample ? { ...row, displacement: 0.2000021 } : row));
    const found = boundViolations(mutated, boundMetres, toleranceMetres);
    const hit = found.find((violation) => violation.tick === sample.tick && violation.entityId === sample.entityId);
    push(
      'beyond-tolerance-tick-is-reported-with-tick-and-entity',
      `one accepted tick: 0.2 m -> 0.2000021 m (threshold ${boundMetres + toleranceMetres})`,
      true,
      hit !== undefined,
      hit === undefined
        ? 'not reported'
        : `tick ${String(hit.tick)} of ${hit.entityId} exceeds the tolerance by ${hit.excessOverTolerance.toExponential(2)} m`,
    );

    // C2 — INSIDE the tolerance: 0.2000005 is 0.5e-6 m over the bound and within AC-1's 1e-6, so the
    // checker must leave it alone. Without this control, a comparison against the bare bound looks like
    // a stricter reading of the same rule instead of a wrong one.
    const inside = ticks.map((row) => (row === sample ? { ...row, displacement: 0.2000005 } : row));
    push(
      'within-tolerance-tick-is-not-reported',
      `the same tick at 0.2000005 m (+0.5e-6, inside 1e-6)`,
      false,
      boundViolations(inside, boundMetres, toleranceMetres).length > 0,
      'the declared tolerance is honoured, not silently replaced by the bare bound',
    );

    // C3 — gross: a doubled drive for one tick. The protocol normalises axes, so this cannot arrive
    // through a real client; it is here to prove the checker is not merely comparing floats to floats.
    const gross = ticks.map((row) => (row === sample ? { ...row, displacement: boundMetres * 2 } : row));
    push(
      'gross-overshoot-is-reported',
      `one accepted tick: 0.2 m -> ${String(boundMetres * 2)} m (a doubled step)`,
      true,
      boundViolations(gross, boundMetres, toleranceMetres).length > 0,
      'a doubled step is over the bound by the bound itself',
    );

    // C4 — the travel credit: give one tick's travel to a seat with nothing accepted. This is F-1 in
    // arithmetic: 12 m of travel with zero accepted stamps is exactly the claim the old evidence made.
    const creditEntity = input.zeroAcceptedEntity ?? 'synthetic-zero-accepted-seat';
    const credited = travelBudget.map((row) =>
      row.entityId === creditEntity
        ? { ...row, acceptedStamps: 0, metresTravelled: row.metresTravelled + boundMetres }
        : row,
    );
    const creditedExceeded = credited.some((row) => row.entityId === creditEntity && row.metresTravelled > row.budgetMetres);
    push(
      'travel-without-accepted-stamps-violates-the-budget',
      `credit ${boundMetres} m of travel to ${creditEntity}, which has 0 accepted stamps`,
      true,
      creditedExceeded,
      'the budget denominator is accepted stamps, so unearned travel cannot be hidden by a watermark',
    );
  }

  const passed =
    outOfBound.length === 0
    && travelBudget.every((row) => !row.exceeded)
    && accepted.length > 0
    && controls.every((control) => control.detected === control.expectedDetected);

  return {
    classification: {
      acceptedTicks: accepted.length,
      refusedTicks: refusedTicks.length,
      noInputTicks: noInput.length,
      totalTickRows: ticks.length,
    },
    boundMetres,
    toleranceMetres,
    maxAcceptedDisplacement,
    outOfBound,
    travelBudget,
    controls,
    passed,
  };
};
