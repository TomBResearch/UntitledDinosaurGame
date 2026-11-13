/**
 * AC-1's reference trace producer (UDG-003 Phase 2, T-1).
 *
 * AC-1: "200 valid direct ticks produce the specified 40 m flat trace within 1e-6 m in pure simulation,
 * labelled reset segments excluded."
 *
 * Where this lives, and why (OD-8, owner-ruled): the Phase 2 assignment grants `tests/reference/` for
 * exactly this file, and AC-1's home is therefore here for Phase 2. The Phase 1 assignment's line that
 * assigns AC-1 to `apps/server/reference/` describes a *production* reference producer; this one is
 * test-only evidence and reaches the authority the way every other runtime evidence script does — over
 * the built workspace output — so it needs no workspace-membership change.
 *
 * "Pure simulation" is taken literally: the authority core is stepped directly with a virtual clock and
 * a stub scheduler. No socket, no room, no wall clock — AC-1 is a statement about the movement relation,
 * and mixing a transport into it would make a timing failure look like a movement failure.
 *
 * The reference distance is derived FROM THE ROWS. The number AC-1 is scored against is the sum of the
 * `resolvedDisplacement` the authority journalled for the accepted ticks — what actually happened — and
 * the `speed × step × ticks` product is kept separately, clearly labelled, as a cross-check. If those
 * two ever disagree, the trace is telling us something and the arithmetic is not.
 *
 * Outputs (all three are named in the Phase 2 artefact list):
 *   reference-trace.json  the summary, the tolerance policy, and every control result
 *   ticks.jsonl           the trace rows the summary is summed from
 *   inputs.jsonl          the accepted frames behind those rows, each with its disposition
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? resolve(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/** AC-1's stated tolerance, in metres. Nothing here tightens it and nothing here widens it. */
const TOLERANCE_METRES = 1e-6;
/** AC-1's stated tick count. */
const REFERENCE_TICKS = 200;
/** The labelled reset segment: driven ticks AFTER the entity is removed and re-seated at spawn. */
const RESET_SEGMENT_TICKS = 25;

interface JournalRowLike {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The authority's `JournalSink`, implemented as the tiny collector the core needs and nothing more. */
class Collector {
  #rows: JournalRowLike[] = [];
  #chain: Record<string, unknown>[] = [];

  recordRow(row: JournalRowLike): void {
    this.#rows.push(row);
  }

  recordTickChain(record: Record<string, unknown>): void {
    this.#chain.push(record);
  }

  rows(): readonly JournalRowLike[] {
    return this.#rows;
  }

  chain(): readonly Record<string, unknown>[] {
    return this.#chain;
  }
}

/** A scheduler that never fires: this run is stepped by hand, so cadence is not part of what is measured. */
const stubScheduler = {
  set: () => 0,
  clear: (_handle: number): void => undefined,
};

const stubTime = { nowMs: () => 0 };

interface TraceRow {
  readonly tick: number;
  readonly stamp: number;
  readonly dtSeconds: number;
  readonly inputSource: string;
  readonly intentionCommitted: boolean;
  readonly drive: unknown;
  readonly resolvedDisplacement: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly stateHash: string;
  readonly segment: string;
}

interface RunResult {
  readonly rows: readonly TraceRow[];
  readonly inputs: readonly Record<string, unknown>[];
  readonly resetTick: number;
  readonly collector: Collector;
}

async function run(label: string): Promise<RunResult> {
  const [stepMod, clockMod, movementMod, configMod] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/step.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/authority/clock.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'apps/server/dist/movement/MovementAuthorityAdapter.js')).href) as Promise<Record<string, unknown>>,
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
  ]);

  const bounds = { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } };
  const config = (configMod['withConfigOverrides'] as (c: unknown, o: unknown) => unknown)(
    configMod['DEFAULT_SERVER_CONFIG'],
    { region: { bounds } },
  );
  const AuthorityCore = stepMod['AuthorityCore'] as { build(options: Record<string, unknown>): Record<string, unknown> };
  const FixedStepClock = clockMod['FixedStepClock'] as { create(options: Record<string, unknown>): Record<string, unknown> };
  const FlatReferenceStepper = movementMod['FlatReferenceStepper'] as new (speed: number) => unknown;

  const clock = FixedStepClock.create({
    network: (config as { network: unknown }).network,
    scheduler: stubScheduler,
    time: stubTime,
    tickOrigin: 0,
  });
  if (!('dtSeconds' in clock)) throw new Error(`the reference clock refused to build: ${JSON.stringify(clock)}`);

  const collector = new Collector();
  const core = AuthorityCore.build({
    config,
    stepper: new FlatReferenceStepper((config as { movement: { speed: number } }).movement.speed),
    time: stubTime,
    clock,
    runId: `udg-003-ac1-${label}`,
    sink: collector,
    regionProvenance: 'test-only-synthetic',
  }) as {
    join(entityId: string, epoch: number, spawn: { x: number; y: number; z: number }): unknown;
    leave(entityId: string): unknown;
    ingest(entityId: string, payload: Record<string, unknown>): unknown;
    step(): unknown;
  };

  const step = (config as { network: { simulationStepSeconds: number } }).network.simulationStepSeconds;
  void step;

  // The reference window: one accepted direct frame per tick, from the entity's own join.
  const move = (generation: number): Record<string, unknown> => ({
    sessionEpoch: 1,
    generation,
    directIntent: true,
    moveX: 0,
    moveZ: 1,
  });

  core.join('e1', 1, { x: 0, y: 0, z: 0 });
  core.step();
  for (let i = 1; i <= REFERENCE_TICKS; i += 1) {
    core.ingest('e1', move(i));
    core.step();
  }

  // A labelled reset segment. The entity is removed and re-seated at spawn — the pure-simulation shape
  // of "respawn" — and then driven again. AC-1 excludes these ticks, and the artefact has to SHOW that
  // the exclusion is doing work rather than assert it, so the with-resets total is reported too.
  core.leave('e1');
  core.join('e1', 2, { x: 0, y: 0, z: 0 });
  const resetTick = Number((core.step() as { tick: number }).tick);
  for (let i = 1; i <= RESET_SEGMENT_TICKS; i += 1) {
    core.ingest('e1', { ...move(i), sessionEpoch: 2 });
    core.step();
  }

  const rows = collector.rows();
  const statesByTick = new Map<number, string>();
  const positionsByTick = new Map<number, { x: number; y: number; z: number }>();
  for (const row of rows) {
    if (row['type'] !== 'state') continue;
    statesByTick.set(Number(row['tick']), String(row['stateHash']));
    const position = (row['state'] as { locomotion?: { kinematic?: { position?: { x: number; y: number; z: number } } } })?.locomotion
      ?.kinematic?.position;
    if (position !== undefined) positionsByTick.set(Number(row['tick']), position);
  }

  const trace: TraceRow[] = [];
  for (const row of rows) {
    if (row['type'] !== 'tick' || row['consumed'] === null || row['consumed'] === undefined) continue;
    const tick = Number(row['tick']);
    trace.push({
      tick,
      stamp: Number(row['consumed']),
      dtSeconds: Number(row['dtSeconds']),
      inputSource: String(row['inputSource']),
      intentionCommitted: row['intentionCommitted'] === true,
      drive: row['horizontalDrive'],
      resolvedDisplacement: Number(row['resolvedDisplacement']),
      position: positionsByTick.get(tick) ?? { x: 0, y: 0, z: 0 },
      stateHash: statesByTick.get(tick) ?? '',
      segment: tick <= resetTick ? 'reference' : 'labelled-reset',
    });
  }

  const inputs = rows
    .filter((row) => row['type'] === 'observation' && row['kind'] === 'direct' && row['origin'] === 'client-payload')
    .map((row) => ({
      eligibleTick: Number(row['eligibleTick']),
      stamp: Number(row['generation']),
      sessionEpoch: Number(row['epoch']),
      disposition: String(row['disposition']),
      payloadHash: String(row['rawHash'] ?? ''),
    }));

  return { rows: trace, inputs, resetTick, collector };
}

/** The bound AC-2 puts on one tick's travel, read from the configuration actually under test. */
const boundFor = (speed: number, stepSeconds: number): number => speed * stepSeconds;

const sum = (rows: readonly TraceRow[]): number => rows.reduce((total, row) => total + row.resolvedDisplacement, 0);

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const [configMod, primary] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, 'packages/config/dist/index.js')).href) as Promise<Record<string, unknown>>,
    run('primary'),
  ]);
  const config = (configMod['withConfigOverrides'] as (c: unknown, o: unknown) => unknown)(
    configMod['DEFAULT_SERVER_CONFIG'],
    { region: { bounds: { x: { min: -50, max: 50 }, y: { min: -5, max: 20 }, z: { min: -50, max: 50 } } } },
  ) as { movement: { speed: number }; network: { simulationStepSeconds: number; tickRate: number } };
  const speed = config.movement.speed;
  const stepSeconds = config.network.simulationStepSeconds;
  const bound = boundFor(speed, stepSeconds);

  const reference = primary.rows.filter((row) => row.segment === 'reference');
  const resetRows = primary.rows.filter((row) => row.segment === 'labelled-reset');

  // ── The measurements AC-1 is scored on, all of them from the rows ─────────────────────────────
  const referenceMetresFromRows = sum(reference);
  const withResetsMetres = sum(primary.rows);
  const perTickMax = reference.reduce((max, row) => Math.max(max, row.resolvedDisplacement), 0);
  const settingsProduct = speed * stepSeconds * REFERENCE_TICKS;
  const finalPosition = reference.length > 0 ? (reference[reference.length - 1] as TraceRow).position : { x: 0, y: 0, z: 0 };
  const stateRowTravel = Math.hypot(finalPosition.x, finalPosition.z);

  const acceptedEveryRow = reference.every((row) => row.inputSource === 'direct' && row.intentionCommitted);
  const monotone = reference.every((row, index) => index === 0 || row.position.z >= (reference[index - 1] as TraceRow).position.z);
  const dtEveryRow = reference.every((row) => row.dtSeconds === stepSeconds);
  // Two independent journal row types have to agree: the per-tick displacements and the entity's own
  // state positions. They are accumulated by different code paths, so a disagreement is a real defect.
  const stateAgreesWithTrace = Math.abs(stateRowTravel - referenceMetresFromRows) <= TOLERANCE_METRES;
  const stateDeltaSum = reference.reduce(
    (total, row, index) => total + Math.max(0, row.position.z - (index === 0 ? 0 : (reference[index - 1] as TraceRow).position.z)),
    0,
  );
  const stateDeltasAgreeWithTickRows = Math.abs(stateDeltaSum - referenceMetresFromRows) <= TOLERANCE_METRES;

  // Determinism: a second, independent run must produce byte-identical decision rows.
  const second = await run('repeat');
  const digest = (rows: readonly TraceRow[]): string =>
    rows.map((row) => `${row.tick}:${row.stamp}:${row.resolvedDisplacement}:${row.stateHash}`).join('|');
  const deterministic = digest(primary.rows) === digest(second.rows);

  // ── Controls: each one mutates the ROWS and must be caught by the same arithmetic ─────────────
  // These are the falsification half. A trace check that cannot fail is not a check, so every control
  // states what it breaks and whether the checker said so.
  type Control = {
    readonly name: string;
    readonly mutation: string;
    readonly expectedDetected: boolean;
    readonly detected: boolean;
    readonly detail: string;
  };
  const controls: Control[] = [];
  const push = (name: string, mutation: string, expectedDetected: boolean, detected: boolean, detail: string): void => {
    controls.push({ name, mutation, expectedDetected, detected, detail });
  };

  const totalCheck = (rows: readonly TraceRow[]): boolean => Math.abs(sum(rows) - referenceMetresFromRows) > TOLERANCE_METRES;
  const boundCheck = (rows: readonly TraceRow[]): boolean =>
    rows.some((row) => row.resolvedDisplacement > bound + TOLERANCE_METRES);

  // C1 — one tick missing: the sum moves, so an incomplete trace cannot pass as 40 m.
  const dropped = reference.slice(0, reference.length - 1);
  push(
    'dropped-tick-changes-the-distance',
    `drop the last accepted tick (${String(dropped.length)} rows instead of ${String(reference.length)})`,
    true,
    totalCheck(dropped),
    `sum ${sum(dropped).toFixed(6)} m against ${referenceMetresFromRows.toFixed(6)} m`,
  );

  // C2 — beyond tolerance: 0.2 m scaled to 0.2000021 m exceeds 0.2 + 1e-6 by 1.1e-6 m and MUST be
  // reported, naming the tick and the entity. This is the control that proves the bound is a bound.
  const overshootTick = 7;
  const overshoot = reference.map((row) => (row.tick === overshootTick ? { ...row, resolvedDisplacement: 0.2000021 } : row));
  const overshootExcess = 0.2000021 - (bound + TOLERANCE_METRES);
  push(
    'beyond-tolerance-displacement-is-reported',
    `tick ${String(overshootTick)} displacement 0.2 -> 0.2000021 m`,
    true,
    boundCheck(overshoot),
    `exceeds the tolerance by ${overshootExcess.toExponential(2)} m on tick ${String(overshootTick)} of entity e1`,
  );

  // C3 — within tolerance: 0.2000008 m is 0.8e-6 m over the bound, inside AC-1's 1e-6, and MUST NOT be
  // reported. Without this control a checker that silently compared against the bare bound would look
  // like a stricter, safer version of the same rule.
  const inside = reference.map((row) => (row.tick === overshootTick ? { ...row, resolvedDisplacement: 0.2000008 } : row));
  push(
    'within-tolerance-displacement-is-not-reported',
    `tick ${String(overshootTick)} displacement 0.2 -> 0.2000008 m (+0.8e-6, inside 1e-6)`,
    false,
    boundCheck(inside),
    `the tolerance is honoured, not silently tightened to the bare bound`,
  );

  // C4 — the timestep is the other half of the product: 1/19.9 s buys 201 ms of travel per tick.
  const retimed = reference.map((row) => ({ ...row, resolvedDisplacement: row.resolvedDisplacement * (20 / 19.9) }));
  push(
    'a-slower-timestep-inflates-the-trace',
    'every dt 0.05 -> 1/19.9 s',
    true,
    totalCheck(retimed),
    `sum ${sum(retimed).toFixed(6)} m against ${referenceMetresFromRows.toFixed(6)} m`,
  );

  // C5 — a refused tick is not a movement tick: dropping it from the accepted set changes the count,
  // which is the F-1 class of error expressed in the reference trace's own terms.
  const refusedLike = reference.filter((_row, index) => index !== 3);
  push(
    'a-refused-frame-is-not-an-accepted-tick',
    'remove one accepted row (the shape a `refused:*` disposition produces)',
    true,
    refusedLike.length !== REFERENCE_TICKS || totalCheck(refusedLike),
    `${String(refusedLike.length)} accepted rows, sum ${sum(refusedLike).toFixed(6)} m`,
  );

  // C6 — the diagonal case: (1, 1) is normalised by the protocol, so one tick is exactly at the bound.
  // It must pass the bound, and the same row inflated past the tolerance must be caught: this is where a
  // tolerance of zero would break, and where a tolerance that is too large would hide a real overshoot.
  const diagonalRow: TraceRow = { ...(reference[0] as TraceRow), resolvedDisplacement: bound };
  const diagonalOver: TraceRow = { ...diagonalRow, resolvedDisplacement: bound + 2e-6 };
  push(
    'diagonal-travel-sits-on-the-bound-and-overshoot-is-caught',
    'one tick at the normalised bound 0.2 m, and the same tick at 0.200002 m',
    true,
    !boundCheck([diagonalRow]) && boundCheck([diagonalOver]),
    '0.2 m is inside `bound + 1e-6`; 0.200002 m is not',
  );

  // C7 — reset exclusion must be load-bearing: the same run with its labelled reset segment included
  // does not equal the reference distance, and the excluded window still does.
  push(
    'labelled-reset-segments-are-excluded-and-that-matters',
    `include the ${String(RESET_SEGMENT_TICKS)} driven ticks after the re-seat`,
    true,
    Math.abs(withResetsMetres - referenceMetresFromRows) > TOLERANCE_METRES
      && Math.abs(referenceMetresFromRows - settingsProduct) <= TOLERANCE_METRES,
    `with resets ${withResetsMetres.toFixed(6)} m; reference window ${referenceMetresFromRows.toFixed(6)} m`,
  );

  const checks = {
    referenceTickCount: reference.length,
    referenceMetresFromRows,
    referenceMetresFromSettingsProduct: settingsProduct,
    toleranceMetres: TOLERANCE_METRES,
    ac1WithinTolerance: Math.abs(referenceMetresFromRows - settingsProduct) <= TOLERANCE_METRES,
    perTickMaxDisplacement: perTickMax,
    perTickBound: bound,
    withinPerTickBound: perTickMax <= bound + TOLERANCE_METRES,
    everyRowAcceptedDirectIntent: acceptedEveryRow,
    positionMonotoneAlongZ: monotone,
    everyRowUsesConfiguredStep: dtEveryRow,
    traceMatchesJournalledStateTravel: stateAgreesWithTrace,
    // The sum of the position deltas between consecutive state rows, which must reproduce the same
    // 40 m the tick rows add up to. Two journal row types, two code paths, one number.
    stateDeltaSumAcrossReferenceRows: stateDeltaSum,
    stateDeltasAgreeWithTickRows,
    deterministicAcrossRuns: deterministic,
    labelledResetMetres: withResetsMetres,
    resetSegmentTickCount: resetRows.length,
  };

  const controlsOk = controls.every((control) => control.detected === control.expectedDetected);
  const verdict =
    Object.values(checks).every((value) => value !== false)
    && reference.length === REFERENCE_TICKS
    && controlsOk
      ? 'pass'
      : 'fail';

  const ticksPath = resolve(OUT_DIR, 'ticks.jsonl');
  const inputsPath = resolve(OUT_DIR, 'inputs.jsonl');
  writeFileSync(ticksPath, `${reference.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(
    inputsPath,
    `${primary.inputs
      .filter((entry) => Number(entry['eligibleTick']) <= primary.resetTick)
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
    'utf8',
  );
  writeFileSync(
    resolve(OUT_DIR, 'reference-trace.json'),
    `${JSON.stringify(
      {
        taskId: 'UDG-003',
        phase: 'phase-2',
        criterion: ['AC-1'],
        producer: 'tests/reference/flat-direct-step.ts',
        verdict,
        statement:
          'AC-1: 200 valid direct ticks produce the specified 40 m flat trace within 1e-6 m in pure simulation, labelled reset segments excluded.',
        simulation: {
          kind: 'pure authority core, virtual clock, stub scheduler: no socket, no room, no wall clock',
          stepper: 'FlatReferenceStepper (the flat reference relation: drive x speed x dt)',
          configHash: (configMod['computeConfigHash'] as (c: unknown) => string)(config),
          movementHash: (configMod['movementHash'] as (c: unknown) => string)(config),
          regionHash: (configMod['regionHash'] as (c: unknown) => string)(config),
          speedMetresPerSecond: speed,
          simulationStepSeconds: stepSeconds,
          tickRate: config.network.tickRate,
        },
        checks,
        controls,
        derivation:
          'referenceMetresFromRows is the sum of the authority\'s own journalled per-tick resolved displacement over the accepted '
          + 'reference ticks; the settings product is reported beside it as a cross-check and is never the measured value. '
          + 'A trace whose rows are re-summed at review time must reproduce referenceMetresFromRows from ticks.jsonl exactly.',
        reviewRecomputation: {
          file: 'ticks.jsonl',
          field: 'resolvedDisplacement',
          expectedRows: reference.length,
          expectedSum: referenceMetresFromRows,
        },
        limitations: [
          'This is the reference relation, not locomotion: UDG-005 owns movement and UDG-006 owns collision.',
          'A labelled reset segment is modelled as leave + re-seat at spawn, the pure-simulation shape of a respawn; the transport-level '
            + 'rejoin path is evidenced separately by the recovery scenarios.',
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // stdout, not stderr: the capture runner records each stream separately and refuses an EMPTY stdout
  // record, because a step that reported nothing is a step whose run nobody can attribute. The first CI
  // attempt at this step wrote its only line to stderr and the bundle was refused for it.
  const summary = `[reference] ${verdict} — ${String(reference.length)} ticks, ${referenceMetresFromRows.toFixed(6)} m from rows `
    + `(product ${settingsProduct.toFixed(6)}), per-tick max ${perTickMax.toFixed(9)} of bound ${bound.toFixed(6)}, `
    + `controls ${String(controls.filter((control) => control.detected === control.expectedDetected).length)}/${String(controls.length)}`;
  process.stdout.write(`${summary}\n`);
  if (verdict !== 'pass') {
    process.exitCode = 2;
    process.stderr.write(`[reference][fail] ${summary}\n`);
  }
}

await main();
process.exit(process.exitCode ?? 0);
