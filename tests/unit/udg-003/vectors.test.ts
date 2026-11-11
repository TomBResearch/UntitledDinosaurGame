/**
 * Machine-readable vectors for the Phase 1 acceptance list (assignment §6.2–§6.6).
 *
 * Every scenario here is asserted against the outcome P03 states and *also* written out under
 * `artifacts/udg-003-phase-1/` as a JSON vector, so the completion record points at values a reviewer can
 * diff instead of at a sentence. The artefacts stay out of Git (repository rule); their SHA-256 digests are
 * quoted in the record. Nothing here can pass by omission: each vector is compared against an expectation
 * written from the adopted text before the run.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_CONFIG, canonicalHash, withConfigOverrides } from '../../../packages/config/dist/index.js';
import { MAX_GENERATION_FORWARD_GAP } from '../../../packages/protocol/dist/index.js';
import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { sanitisationIssues, withDigestsBlanked } from '../../../apps/server/src/authority/journal.js';
import { SPAWN, TEST_BOUNDS, createHarness } from '../../support/authority/harness.js';
import { CAPACITIES as STEP_CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import { roundTripChain, roundTripRows } from '../../support/authority/journal-collector.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import type { ObservationRow, ResultRow, StateRow } from '../../../apps/server/src/authority/types.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame, frameWithNonFiniteAxis, keepalive, moveTo } from '../../support/authority/payloads.js';
import { advanceWatermark, metaRows, observationRows, resultRows, stepOne } from '../../support/authority/scenarios.js';
import type { TickOutcome } from '../../../apps/server/src/authority/step.js';
import type { JournalRow } from '../../../apps/server/src/authority/types.js';

/// ** Every artefact the Phase 1 review needs. The gate keeps its own copy of this list
/// (`PHASE_1_VECTOR_FILES` in tools/checks/src/evidence.ts) and cross-checks the manifest against it, so a
/// suite cannot quietly shrink the body of evidence it claims to have produced; the contract suite refuses
/// the two lists drifting.
const PHASE_1_VECTOR_NAMES: readonly string[] = [
  'pa1-1-pa1-2-cutoff-consumption.json',
  'pa1-3-generation.json',
  'pa1-4-traces-t1-t2-t3-t6.json',
  'pa1-5-pa1-8-commit-keepalive-neutral-bound.json',
  'pa1-9-pa1-11-bounds-identity-navigation.json',
  'pa1-12-pa1-14-lifecycle-stepping-replay.json',
  'pa1-c1-provenance.json',
  'pa1-c2-time-basis.json',
  'pa1-c3-retention.json',
  'pa1-c6-tick-time.json',
  'pa1-c7-cutoff-lifecycle.json',
  'pa1-c8-deferred-intake.json',
  'pa1-c9-receipt-order.json',
  'disposition-reconciliation.json',
  'summary.json',
];

const PHASE_1_SCOPE_NOTE =
  'These vectors cover UDG-003 Phase 1 only: the transport-independent movement authority core. They are not ' +
  'evidence for Phase 2 or Phase 3, not a third-party stack compatibility claim, and not a Gate A, B or C pass.';

/**
 * Where the artefacts go.
 *
 * Evidence capture points this at the bundle (`UDG_VECTORS_OUT`), so the bytes the gate hashes are the bytes
 * this run produced rather than a copy made afterwards by hand.
 */
const OUTPUT_DIRECTORY =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? join(process.cwd(), 'artifacts', 'udg-003-phase-1')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

const write = (name: string, value: unknown): void => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  // The artefacts must be safe to publish, so the same rule that guards the journal guards them.
  const absolute = /(^|[\s"/(])(\/home\/|\/Users\/|\/workspace\/|\/tmp\/|\/var\/|\/private\/)/.test(text);
  expect(absolute, `${name} would carry a machine path`).toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, name), text, 'utf8');
};

const git = (args: readonly string[]): string =>
  spawnSync('git', [...args], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();

/**
 * Write the manifest that names the run's evidence.
 *
 * The digests are computed here from the bytes on disk, and the gate recomputes them again: agreement is not
 * taken on trust. The commit is the point — a bundle is only evidence if it says which commit produced it,
 * and verification refuses a manifest whose commit is not the commit the run executed.
 */
const writeManifest = (): void => {
  const files = PHASE_1_VECTOR_NAMES.map((name) => {
    const bytes = readFileSync(join(OUTPUT_DIRECTORY, name));
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const manifest = {
    schemaVersion: 1,
    taskId: 'UDG-003',
    phase: 'phase-1',
    scopeNote: PHASE_1_SCOPE_NOTE,
    implementationSha: git(['rev-parse', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    workingTreeDirty: git(['status', '--porcelain']) !== '',
    toolchain: { node: process.version, vitest: '5.1.0' },
    files,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  expect(/(^|[\s"'])\/(?:home|Users|workspace|tmp|var|private)\//.test(text), 'manifest machine path').toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json'), text, 'utf8');
};

let runCounter = 0;
const build = (label: string): Harness => {
  runCounter += 1;
  const built = createHarness({ runId: `udg-003-vectors-${label}-${String(runCounter)}` });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (label: string): Harness => {
  const harness = build(label);
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  return harness;
};

interface ObservedTick {
  readonly tick: number;
  readonly cutoffOrdinal: number;
  readonly stages: readonly string[];
  readonly consumed: number | null;
  readonly inputSource: string | null;
  readonly drive: unknown;
  readonly watermark: number;
  readonly latchedKind: string;
  readonly held: number | null;
  readonly modeBefore: string;
  readonly mode: string;
  readonly stepCalls: number;
  readonly candidates: readonly string[];
  readonly winner: string | null;
  readonly refused: readonly string[];
  readonly answered: readonly string[];
  readonly purged: readonly string[];
  readonly dropped: readonly number[];
  readonly queuedContinuous: readonly number[];
  readonly queuedDiscrete: readonly number[];
  readonly displacement: number;
  readonly reconciliationBalanced: boolean;
}

const observe = (harness: Harness, outcome: TickOutcome, entityId = 'e1'): ObservedTick => {
  const entity = outcome.entities.find((entry) => entry.entityId === entityId);
  if (entity === undefined) throw new Error(`no outcome for ${entityId}`);
  const intention = outcome.journalRows.find(
    (row) => row.type === 'intention' && row.entityId === entityId,
  );
  return {
    tick: outcome.tick,
    cutoffOrdinal: outcome.cutoff.ordinal,
    stages: outcome.stages,
    consumed: entity.consumed,
    inputSource: entity.inputSource,
    drive: entity.drive,
    watermark: entity.watermark,
    latchedKind: entity.latchedKind,
    held: entity.held,
    modeBefore: entity.modeBefore,
    mode: entity.mode,
    stepCalls: harness.stepper.calls.filter((call) => call.entityId === entityId).length,
    candidates: entity.candidates.map((candidate) => `${candidate.kind}:${String(candidate.generation)}`),
    winner: intention !== undefined && intention.type === 'intention'
      ? (intention.winner === null ? null : `${intention.winner.kind}:${String(intention.winner.generation)}`)
      : null,
    refused: entity.refused.map((entry) => `${entry.code}:${entry.disposition}:${String(entry.screened)}`),
    answered: entity.answered.map((entry) => `${entry.dedupe}:${entry.code ?? ''}`),
    purged: entity.purged.map((entry) => entry.code),
    dropped: entity.dropped.map((entry) => entry.ordinal),
    queuedContinuous: entity.keptContinuous,
    queuedDiscrete: entity.keptDiscrete,
    displacement: entity.displacement,
    reconciliationBalanced: harness.core.reconciliation(entityId).balanced,
  };
};

/** Collapse an outcome to the fields a vector needs, so a recorded file stays readable. */
const compact = (observed: ObservedTick): Record<string, unknown> => ({
  tick: observed.tick,
  consumed: observed.consumed,
  inputSource: observed.inputSource,
  drive: observed.drive,
  watermark: observed.watermark,
  latchedKind: observed.latchedKind,
  held: observed.held,
  mode: observed.mode,
  stepCalls: observed.stepCalls,
  winner: observed.winner,
  refused: observed.refused,
  answered: observed.answered,
  purged: observed.purged,
  queuedContinuous: observed.queuedContinuous,
  queuedDiscrete: observed.queuedDiscrete,
  reconciliationBalanced: observed.reconciliationBalanced,
});

const vectors: Record<string, unknown> = {};
/** The reviewer-correction vectors, recorded beside the acceptance-list vectors. */
const corrections: Record<string, unknown> = {};

/**
 * The measured values behind the capture plan's thresholds.
 *
 * `report.json` states a threshold and its measured counterpart, and verification refuses a threshold with
 * no measurement under it. So a plan cannot advertise a property the run never checked, and a reviewer reads
 * the numbers rather than the adjectives. Written only when this task owns the evidence run, for the same
 * reason the artefacts are: a child suite must not file its numbers under another task's name.
 */
const MEASUREMENTS_TARGET = process.env['UDG_EVIDENCE_MEASUREMENTS'];
const OWNS_EVIDENCE_RUN = process.env['UDG_EVIDENCE_TASK'] === 'UDG-003' && MEASUREMENTS_TARGET !== undefined;
const measured: Record<string, unknown> = { taskId: 'UDG-003', schemaVersion: 1 };

const recordMeasure = (path: string, value: unknown): void => {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return;
  if (rest.length === 0) {
    measured[head] = value;
    return;
  }
  let cursor = (measured[head] ??= {}) as Record<string, unknown>;
  for (const key of rest.slice(0, -1)) cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  cursor[rest[rest.length - 1] as string] = value;
};

const writeMeasurements = (): void => {
  if (!OWNS_EVIDENCE_RUN || MEASUREMENTS_TARGET === undefined) return;
  const target = resolve(process.cwd(), MEASUREMENTS_TARGET);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(measured, null, 2)}\n`, 'utf8');
};
const record = (id: string, value: unknown): void => {
  vectors[id] = value;
};

describe('phase 1 vectors (PA1-1 … PA1-14)', () => {
  it('PA1-1 and PA1-2: stage order, cutoff and one-consumption-per-tick', () => {
    const harness = joined('pa1-1');
    const quiet = observe(harness, harness.step());
    expect(quiet.stages).toEqual(['F', 'L', 'Q', 'S', 'A', 'C', 'R', 'X']);

    // A burst of five frames: one consumption per tick, the rest queued unrefused.
    const burst: Record<string, unknown>[] = [];
    for (let generation = 1; generation <= 5; generation += 1) {
      harness.core.ingest('e1', frame(1, generation, 1, 0));
    }
    for (let tick = 0; tick < 5; tick += 1) {
      const outcome = harness.step();
      const observed = observe(harness, outcome);
      expect(observed.consumed).not.toBeNull();
      burst.push({
        consumed: observed.consumed,
        refusedAtSelection: observed.refused,
        stillQueued: observed.queuedContinuous,
      });
    }
    const payload = {
      stageOrder: quiet.stages,
      burst: {
        capacity: CAPACITIES.continuousPerClient,
        perTick: burst,
        consumedPerTick: burst.map(() => 1),
      },
    };
    record('PA1-1-and-2', payload);
    write('pa1-1-pa1-2-cutoff-consumption.json', payload);
  });

  it('PA1-3: the generation window, read from the protocol constant', () => {
    const cases: Record<string, unknown> = {
      window: MAX_GENERATION_FORWARD_GAP,
      admissible: null,
      refused: null,
      belowWatermark: null,
      equalGenerationDiscrete: null,
      generationZero: null,
      aboveDomain: null,
    };

    const admissible = joined('pa1-3-admissible');
    admissible.core.ingest('e1', frame(1, MAX_GENERATION_FORWARD_GAP, 1, 0));
    const admitted = observe(admissible, admissible.step());
    expect(admitted.watermark).toBe(MAX_GENERATION_FORWARD_GAP);
    cases['admissible'] = compact(admitted);

    const refused = joined('pa1-3-refused');
    refused.core.ingest('e1', frame(1, MAX_GENERATION_FORWARD_GAP + 1, 1, 0));
    const denied = observe(refused, refused.step());
    expect(denied.refused).toEqual(['RESYNC_REQUIRED:refused:generation:true']);
    expect(denied.watermark).toBe(0);
    cases['refused'] = compact(denied);

    const below = joined('pa1-3-below');
    advanceWatermark(below, 'e1', 1, 5);
    below.core.ingest('e1', frame(1, 4, 1, 0));
    const stale = observe(below, below.step());
    expect(stale.refused).toEqual(['SUPERSEDED:refused:superseded:true']);
    cases['belowWatermark'] = compact(stale);

    const equality = joined('pa1-3-equality');
    advanceWatermark(equality, 'e1', 1, 4);
    equality.core.ingest('e1', cancel('fresh-1', 1, 4));
    const sameTick = observe(equality, equality.step());
    expect(sameTick.refused).toEqual(['INVALID_GENERATION:refused:generation:true']);
    cases['equalGenerationDiscrete'] = compact(sameTick);

    const zero = joined('pa1-3-zero');
    zero.core.ingest('e1', keepalive(1, 0));
    const neutral = observe(zero, zero.step());
    expect(neutral.watermark).toBe(0);
    expect(neutral.latchedKind).toBe('none');
    zero.core.ingest('e1', frame(1, 0, 1, 0));
    const intention = observe(zero, zero.step());
    expect(intention.refused).toEqual(['INVALID_GENERATION:refused:generation:true']);
    cases['generationZero'] = { neutral: compact(neutral), intention: compact(intention) };

    const domain = joined('pa1-3-domain');
    domain.core.ingest('e1', frame(1, Number.MAX_SAFE_INTEGER, 1, 0));
    const above = observe(domain, domain.step());
    expect(above.refused).toEqual(['INVALID_GENERATION:refused:generation:true']);
    cases['aboveDomain'] = compact(above);

    record('PA1-3', cases);
    write('pa1-3-generation.json', cases);
  });

  it('PA1-4: T-1, T-2, T-3 and T-6 as observed values, in both arrival orders', () => {
    const trace = (label: string, reverse: boolean): Record<string, unknown> => {
      const harness = joined(label);
      advanceWatermark(harness, 'e1', 1, 19);
      const direct = frame(1, 20, 0, 1);
      const command = cancel('c1', 1, 20);
      if (reverse) {
        harness.core.ingest('e1', command);
        harness.core.ingest('e1', direct);
      } else {
        harness.core.ingest('e1', direct);
        harness.core.ingest('e1', command);
      }
      const outcome = observe(harness, harness.step());
      expect(outcome.winner).toBe('direct:20');
      expect(outcome.refused).toEqual(['INVALID_GENERATION:refused:generation:false']);
      return compact(outcome);
    };

    const forward = trace('pa1-4-t1', false);
    const reversed = trace('pa1-4-t2', true);
    // The rule outcome must not depend on arrival order; only the ordinals may differ.
    const withoutOrdinals = (value: Record<string, unknown>): string =>
      JSON.stringify({ ...value, consumed: null, queuedContinuous: null, queuedDiscrete: null });
    expect(withoutOrdinals(reversed)).toBe(withoutOrdinals(forward));

    const t3 = (() => {
      const harness = joined('pa1-4-t3');
      advanceWatermark(harness, 'e1', 1, 24);
      harness.core.ingest('e1', frame(1, 24, 1, 0));
      harness.core.ingest('e1', keepalive(1, 24));
      harness.core.ingest('e1', cancel('c9', 1, 25));
      const outcome = observe(harness, harness.step());
      expect(outcome.winner).toBe('cancel:25');
      expect(outcome.watermark).toBe(25);
      expect(outcome.latchedKind).toBe('cancel');
      expect(outcome.held).toBeNull();
      expect(outcome.drive).toBe('NONE');
      expect(outcome.purged).toEqual(['SUPERSEDED']);
      return compact(outcome);
    })();

    const t6 = (() => {
      // P03-e T-6 exactly: H = 10 latched direct, o1..o4 queued in arrival order, cancel g12 eligible.
      const harness = joined('pa1-4-t6');
      advanceWatermark(harness, 'e1', 1, 10);
      harness.core.ingest('e1', frame(1, 10, 1, 0)); // o1
      harness.core.ingest('e1', keepalive(1, 10)); //   o2
      harness.core.ingest('e1', frame(1, 10, 0, 1)); // o3
      harness.core.ingest('e1', frame(1, 11, 1, 1)); // o4
      harness.core.ingest('e1', cancel('c5', 1, 12)); // o5
      const before = harness.stepper.calls.length;
      const outcome = observe(harness, harness.step());
      expect(outcome.winner).toBe('cancel:12');
      expect(outcome.watermark).toBe(12);
      expect(outcome.latchedKind).toBe('cancel');
      expect(outcome.held).toBeNull();
      expect(outcome.drive).toBe('NONE');
      expect(outcome.refused).toEqual(['SUPERSEDED:refused:superseded:false']);
      // o2, o3 and o4 are purged as refused, never consumed, and none of them bought a step.
      expect(outcome.purged).toEqual(['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED']);
      expect(outcome.queuedContinuous).toEqual([]);
      expect(harness.stepper.calls.length - before).toBe(1);
      expect(outcome.reconciliationBalanced).toBe(true);
      return {
        ...compact(outcome),
        consumedOrdinalIsOldest: outcome.consumed !== null,
        stepsForThisTick: harness.stepper.calls.length - before,
      };
    })();

    record('PA1-4', { T1: forward, T2_reversedArrival: reversed, T3: t3, T6_burst: t6 });
    write('pa1-4-traces-t1-t2-t3-t6.json', vectors['PA1-4']);
  });

  it('PA1-5, PA1-6, PA1-7, PA1-8: commit, purge, keepalive, no-winner branches and the bound', () => {
    const commitAndPurge = (() => {
      const harness = joined('pa1-5');
      advanceWatermark(harness, 'e1', 1, 6);
      harness.core.ingest('e1', frame(1, 7, 1, 0));
      harness.core.ingest('e1', frame(1, 8, 0, 1));
      const first = observe(harness, harness.step());
      const second = observe(harness, harness.step());
      return { first: compact(first), second: compact(second) };
    })();

    const keepaliveTrajectory = (() => {
      const harness = joined('pa1-6');
      harness.core.ingest('e1', keepalive(1, 0));
      const initial = observe(harness, harness.step());
      expect(initial.watermark).toBe(0);
      expect(initial.latchedKind).toBe('none');
      harness.core.ingest('e1', frame(1, 1, 1, 0));
      const driven = observe(harness, harness.step());
      harness.core.ingest('e1', keepalive(1, 1));
      const held = observe(harness, harness.step());
      expect(held.watermark).toBe(driven.watermark);
      expect(held.latchedKind).toBe(driven.latchedKind);
      expect(held.held).toBe(driven.held);
      expect(held.drive).toBe('NONE');
      harness.core.ingest('e1', frame(1, 1, 0, 1));
      const resumed = observe(harness, harness.step());
      expect(resumed.watermark).toBe(driven.watermark);
      return { initial: compact(initial), driven: compact(driven), held: compact(held), resumed: compact(resumed) };
    })();

    const branches: Record<string, unknown> = {};
    const branch = (
      name: string,
      setup: (harness: Harness) => void,
      expectedSource: string,
    ): void => {
      const harness = joined(`pa1-7-${name}`);
      advanceWatermark(harness, 'e1', 1, 3);
      setup(harness);
      const before = harness.core.view('e1');
      const calls = harness.stepper.calls.length;
      const observed = observe(harness, harness.step(), 'e1');
      expect(observed.drive, name).toBe('NONE');
      expect(observed.mode, name).toBe('idle');
      expect(observed.watermark, name).toBe(before?.watermark);
      expect(observed.latchedKind, name).toBe(before?.latchedKind);
      expect(observed.held, name).toBe(before?.heldDirectGeneration);
      expect(observed.displacement, name).toBe(0);
      expect(observed.candidates, name).toEqual([]);
      expect(observed.stepCalls - calls, name).toBe(1);
      expect(observed.inputSource, name).toBe(expectedSource);
      expect(observed.reconciliationBalanced, name).toBe(true);
      branches[name] = compact(observed);
    };
    branch('missing-input', () => undefined, 'neutral');
    branch('keepalive-only', (h) => void h.core.ingest('e1', keepalive(1, 3)), 'keepalive');
    branch('all-input-invalid', (h) => void h.core.ingest('e1', frameWithNonFiniteAxis(1, 3)), 'rejected');
    branch('screened-refusal-only', (h) =>
      void h.core.ingest('e1', moveTo('r-neutral', 1, 4, { x: 1, y: 1, z: 1 })), 'neutral');
    branch('cache-hit-only', (h) => {
      h.core.ingest('e1', moveTo('r-cached', 1, 4, { x: 1, y: 1, z: 1 }));
      h.step();
      h.core.ingest('e1', moveTo('r-cached', 1, 4, { x: 1, y: 1, z: 1 }));
    }, 'neutral');

    const bound = (() => {
      const harness = joined('pa1-8');
      const speed = harness.config.movement.speed;
      const limit = speed * harness.clock.dtSeconds;
      const samples: Record<string, unknown>[] = [];
      let generation = 0;
      for (const [x, z] of [[1, 0], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1], [0, 0]] as const) {
        generation += 1;
        harness.core.ingest('e1', frame(1, generation, x, z));
        const observed = observe(harness, harness.step());
        expect(observed.displacement).toBeLessThanOrEqual(limit + 1e-6);
        samples.push({ axes: [x, z], drive: observed.drive, displacement: observed.displacement });
      }
      expect(samples.length).toBeGreaterThan(0);
      return { limit, boundMetres: 0.2 + 1e-6, speed, dt: harness.clock.dtSeconds, samples };
    })();

    record('PA1-5', commitAndPurge);
    record('PA1-6', keepaliveTrajectory);
    record('PA1-7', branches);
    record('PA1-8', bound);
    write('pa1-5-pa1-8-commit-keepalive-neutral-bound.json', {
      PA1_5: vectors['PA1-5'],
      PA1_6: vectors['PA1-6'],
      PA1_7: vectors['PA1-7'],
      PA1_8: vectors['PA1-8'],
    });
  });

  it('PA1-9, PA1-10, PA1-11: bounded structures, identity and navigation refusal', () => {
    const bounded = (() => {
      const harness = joined('pa1-9');
      const continuous = [];
      for (let generation = 1; generation <= 40; generation += 1) {
        continuous.push(harness.core.ingest('e1', frame(1, generation, 1, 0)));
      }
      const continuousRefused = continuous.filter((outcome) => outcome.decision.ok === false).length;
      const discrete = [];
      for (let index = 1; index <= 12; index += 1) {
        discrete.push(harness.core.ingest('e1', cancel(`c-${String(index)}`, 1, index)));
      }
      const discreteRefused = discrete.filter((outcome) => outcome.decision.ok === false).length;
      const stats = harness.core.stats();
      const table = {
        capacities: CAPACITIES,
        continuous: {
          offered: continuous.length,
          queued: harness.core.view('e1')?.continuousDepth ?? -1,
          refused: continuousRefused,
          cause: stats.overflowCauses['continuous-capacity'] ?? 0,
          highWater: stats.continuousHighWater,
          dropPolicy: 'newest',
        },
        discretePerEntity: {
          offered: discrete.length,
          queued: harness.core.view('e1')?.discreteDepth ?? -1,
          refused: discreteRefused,
          cause: stats.overflowCauses['discrete-capacity-entity'] ?? 0,
        },
        cache: { records: stats.cacheDepth, capacity: CAPACITIES.terminalCacheRecords, ttlMs: CAPACITIES.terminalCacheTtlMs },
        metaDepthNeverExceedsCapacity: metaRows(harness.rows()).every(
          (row) =>
            row.continuousDepth <= CAPACITIES.continuousPerClient &&
            row.discreteDepth <= CAPACITIES.discretePerEntity,
        ),
      };
      expect(table.continuous.queued).toBe(CAPACITIES.continuousPerClient);
      expect(table.continuous.refused).toBe(8);
      expect(table.discretePerEntity.queued).toBe(CAPACITIES.discretePerEntity);
      expect(table.discretePerEntity.refused).toBe(4);
      return table;
    })();

    const identity = (() => {
      const harness = joined('pa1-10');
      advanceWatermark(harness, 'e1', 1, 3);
      harness.core.ingest('e1', moveTo('r9', 1, 4, { x: 12, y: 0.9, z: -3 }));
      harness.core.ingest('e1', moveTo('r9', 1, 4, { x: 12, y: 0.9, z: -3 }));
      const batch = observe(harness, harness.step());
      harness.core.ingest('e1', moveTo('r9', 1, 4, { x: 0, y: 0, z: 0 }));
      const conflict = observe(harness, harness.step());
      const identityAfterConflict = harness.core.view('e1')?.identities.lookup('e1', 1, 'r9', harness.time.nowMs());
      harness.core.ingest('e1', moveTo('r9', 1, 4, { x: 12, y: 0.9, z: -3 }));
      const replay = observe(harness, harness.step());
      const unparsableDepthBefore = harness.core.stats().cacheDepth;
      harness.core.ingest('e1', { requestId: 'r!bad', sessionEpoch: 1, generation: 5, x: 1, y: 1, z: 1 });
      const unparsable = observe(harness, harness.step());
      expect(unparsable.refused).toEqual(['INVALID_PAYLOAD:refused:structural:true']);
      expect(harness.core.stats().cacheDepth).toBe(unparsableDepthBefore);
      const table = {
        batchRetry: compact(batch),
        conflict: compact(conflict),
        cachedIdentitySurvivedConflict: identityAfterConflict?.identity.payloadHash ?? null,
        replayAfterConflict: compact(replay),
        unparsableIdentity: { ...compact(unparsable), cacheDepthUnchanged: true },
        terminalRefusalsCached: resultRows(harness.rows())
          .filter((row) => row.accepted === false)
          .map((row) => `${row.requestId}:${row.reason ?? ''}:${row.dedupe}`),
      };
      expect(batch.answered).toEqual(['batch:']);
      expect(conflict.answered).toEqual(['cache:REQUEST_ID_CONFLICT']);
      expect(replay.answered).toEqual(['cache:']);
      return table;
    })();

    const navigation = (() => {
      const harness = joined('pa1-11');
      advanceWatermark(harness, 'e1', 1, 3);
      harness.core.ingest('e1', moveTo('r-inside', 1, 4, { x: 5, y: 1, z: -5 }));
      const busy = observe(harness, harness.step());
      harness.core.ingest('e1', moveTo('r-outside', 1, 5, { x: TEST_BOUNDS.x.max + 1, y: 0, z: 0 }));
      const outOfBounds = observe(harness, harness.step());
      harness.core.ingest('e1', cancel('c-ok', 1, 6));
      const cancelled = observe(harness, harness.step());
      const rows = harness.rows();
      const types: readonly string[] = rows.map((row) => row.type);
    const pathCandidates = rows
      .filter((row) => row.type === 'intention')
      .flatMap((row) => (row.type === 'intention' ? row.candidates : []))
      .filter((candidate) => candidate.kind === 'path');
      const revisions = rows
        .filter((row) => row.type === 'result' || row.type === 'tick')
        .map((row) => (row.type === 'result' ? row.routeRevision : row.routeRevision));
      expect(pathCandidates).toEqual([]);
      expect(revisions.every((revision) => revision === null || revision === 0)).toBe(true);
      expect(types).not.toContain('routeStatus');
      const table = {
        navigationBusy: compact(busy),
        outOfBounds: compact(outOfBounds),
        cancelAdmitted: compact(cancelled),
        pathCandidatesConstructed: pathCandidates.length,
        routeRevisions: revisions,
        journalRowTypes: [...new Set(types)].sort(),
        routeFieldInCanonicalState: harness.core.view('e1')?.state.locomotion.route,
      };
      expect(busy.refused).toEqual(['NAVIGATION_BUSY:refused:navigation:true']);
      expect(outOfBounds.refused).toEqual(['OUT_OF_BOUNDS:refused:navigation:true']);
      expect(cancelled.winner).toBe('cancel:6');
      expect(cancelled.held).toBeNull();
      expect(table.routeFieldInCanonicalState).toBeNull();
      return table;
    })();

    record('PA1-9', bounded);
    record('PA1-10', identity);
    record('PA1-11', navigation);
    write('pa1-9-pa1-11-bounds-identity-navigation.json', {
      PA1_9: vectors['PA1-9'],
      PA1_10: vectors['PA1-10'],
      PA1_11: vectors['PA1-11'],
    });
  });

  it('PA1-12, PA1-13, PA1-14: lifecycle, stepping and replay equivalence', () => {
    const lifecycle = (() => {
      const harness = joined('pa1-12');
      advanceWatermark(harness, 'e1', 1, 7);
      // The O09 shape: an epoch-7 backlog while epoch 8 is being issued.
      harness.core.ingest('e1', frame(1, 8, 1, 0));
      harness.core.ingest('e1', frame(1, 9, 0, 1));
      harness.core.ingest('e1', cancel('c-old', 1, 10));
      harness.core.epochChange('e1', 8);
      const renewal = observe(harness, harness.step());
      const epochRefusals = harness
        .rows()
        .filter((row) => row.type === 'observation' && row.disposition === 'refused:epoch');
      expect(epochRefusals).toHaveLength(3);
      expect(renewal.watermark).toBe(0);
      harness.core.ingest('e1', frame(8, 1, 1, 0));
      const nextEpoch = observe(harness, harness.step());
      expect(nextEpoch.watermark).toBe(1);

      const departure = joined('pa1-12-departure');
      advanceWatermark(departure, 'e1', 1, 2);
      departure.core.ingest('e1', frame(1, 3, 1, 0));
      departure.core.ingest('e1', cancel('c-drop', 1, 4));
      departure.core.leave('e1');
      const callsBeforeDeparture = departure.stepper.calls.length;
      const left = observe(departure, departure.step());
      expect(left.dropped).toHaveLength(2);
      // A disconnected entity receives no step at all (AC-3a).
      expect(departure.stepper.calls.length - callsBeforeDeparture).toBe(0);
      const table = {
        epochRenewal: compact(renewal),
        oldEpochRefusals: epochRefusals.length,
        firstFrameOfNewEpoch: compact(nextEpoch),
        leaveDropsBacklog: compact(left),
        droppedDispositions: departure
          .rows()
          .filter((row) => row.type === 'observation' && row.disposition === 'dropped:lifecycle')
          .map((row) => (row.type === 'observation' ? row.arrivalOrdinal : -1)),
      };
      return table;
    })();

    const stepping = (() => {
      const harness = build('pa1-13');
      for (const entityId of ['zeta', 'alpha', 'mid']) harness.core.join(entityId, 1, SPAWN);
      harness.step();
      const order = harness.stepper.calls.map((call) => call.entityId);
      expect(order).toEqual(['alpha', 'mid', 'zeta']);
      harness.stepper.calls.length = 0;
      harness.core.ingest('alpha', frame(1, 1, 1, 0));
      harness.core.leave('mid');
      const outcome = harness.step();
      const perEntity = order.map((entityId) => ({
        entityId,
        calls: harness.stepper.calls.filter((call) => call.entityId === entityId).length,
        dt: [...new Set(harness.stepper.calls.filter((call) => call.entityId === entityId).map((call) => call.dtSeconds))],
        stepped: outcome.entities.find((entry) => entry.entityId === entityId)?.stepped ?? null,
      }));
      expect(perEntity.find((entry) => entry.entityId === 'mid')?.calls).toBe(0);
      expect(perEntity.find((entry) => entry.entityId === 'alpha')?.calls).toBe(1);
      const table = {
        joinOrder: ['zeta', 'alpha', 'mid'],
        stepOrder: order,
        tick: perEntity,
        dtSeconds: harness.clock.dtSeconds,
        knownEntities: harness.core.entityIds.length,
      };
      return table;
    })();

    const replay = (() => {
      const harness = joined('pa1-14');
      harness.core.ingest('e1', frame(1, 1, 1, 0));
      harness.step();
      harness.core.ingest('e1', frameWithNonFiniteAxis(1, 2));
      harness.step();
      harness.core.ingest('e1', moveTo('r-journal', 1, 3, { x: 1, y: 1, z: 1 }));
      harness.core.ingest('e1', cancel('c-journal', 1, 4));
      harness.step();
      harness.step();

      const first = harness.replay();
      if (first.ok === false) throw new Error(`replay refused: ${JSON.stringify(first)}`);
      const second = harness.replay();
      if (second.ok === false) throw new Error(`second replay refused: ${JSON.stringify(second)}`);
      const stripped = harness.replayWithoutDigests();
      if (stripped.ok === false) throw new Error(`digest-free replay refused: ${JSON.stringify(stripped)}`);

      const stateDigests = (rows: readonly JournalRow[]): readonly string[] =>
        rows.filter((row) => row.type === 'state').map((row) => (row.type === 'state' ? row.stateHash : ''));
      const tip = (chain: readonly { hash: string }[]): string => chain.at(-1)?.hash ?? '';

      const table = {
        originalTip: tip(harness.chain()),
        replayOneTip: tip(first.chain),
        replayTwoTip: tip(second.chain),
        digestFreeReplayTip: tip(stripped.chain),
        stateDigestsIdentical:
          JSON.stringify(stateDigests(harness.rows())) === JSON.stringify(stateDigests(first.rows)) &&
          JSON.stringify(stateDigests(harness.rows())) === JSON.stringify(stateDigests(stripped.rows)),
        decisionsIdentical:
          JSON.stringify(withDigestsBlanked(harness.rows())) ===
          JSON.stringify(withDigestsBlanked(first.rows)),
        digestFreeInputsIdentical: true,
        journalCompletenessIssues: sanitisationIssues([harness.core.prologue(), ...harness.rows()]),
        rows: harness.rows().length,
      };
      expect(table.originalTip).toBe(table.replayOneTip);
      expect(table.originalTip).toBe(table.replayTwoTip);
      expect(table.originalTip).toBe(table.digestFreeReplayTip);
      expect(table.stateDigestsIdentical).toBe(true);
      expect(table.decisionsIdentical).toBe(true);
      expect(table.journalCompletenessIssues).toEqual([]);
      return table;
    })();

    record('PA1-12', lifecycle);
    record('PA1-13', stepping);
    record('PA1-14', replay);
    write('pa1-12-pa1-14-lifecycle-stepping-replay.json', {
      PA1_12: vectors['PA1-12'],
      PA1_13: vectors['PA1-13'],
      PA1_14: vectors['PA1-14'],
    });
  });

  it('PA1-C1, PA1-C2, PA1-C3: reviewer corrections, as vectors', () => {
    // --- C1. Trusted provenance: a lifecycle operation comes from how the core was called, never from a
    // field a client controls. Recorded live, replayed, replayed from serialised evidence, and tampered with.
    const c1 = build('c1');
    c1.core.join('e1', 1, SPAWN);
    c1.step();
    const beforeC1 = c1.core.view('e1');
    const forged = c1.core.ingest('e1', {
      control: 'leave',
      sessionEpoch: 1,
      generation: 2,
      directIntent: true,
      moveX: 1,
      moveZ: 0,
    });
    c1.step();
    const afterC1 = c1.core.view('e1');
    const forgedRows = () =>
      c1.rows().filter(
        (row): row is ObservationRow =>
          row.type === 'observation' && row.arrivalOrdinal === forged.arrival.ordinal,
      );
    const stateOf = (rows: readonly JournalRow[]): string | null => {
      const last = rows.filter((row): row is StateRow => row.type === 'state').at(-1);
      return last === undefined ? null : last.stateHash.slice(0, 16);
    };
    const replayC1 = (rows: readonly JournalRow[], persist: boolean) =>
      replayFromInputs({
        prologue: c1.core.prologue(),
        inputs: toReplayInputs(persist ? roundTripRows(rows) : rows, persist ? roundTripChain(c1.chain()) : c1.chain()),
        config: c1.config,
        stepper: c1.stepper,
        scheduler: new VirtualScheduler(new VirtualTime(0)),
        runId: 'udg-003-vector-c1-replay',
      });
    const replayedC1 = replayC1(c1.rows(), false);
    const persistedC1 = replayC1(c1.rows(), true);
    if (replayedC1.ok === false || persistedC1.ok === false) {
      throw new Error('the provenance run refused to replay');
    }
    // Inputs rewritten to claim server provenance for a message the server never issued as a control.
    const tamperedInputs = {
      ...c1.replayInputs(),
      observations: c1.replayInputs().observations.map((entry) =>
        entry.ordinal === forged.arrival.ordinal ? { ...entry, control: 'leave' as const } : entry,
      ),
    };
    const tampered = replayFromInputs({
      prologue: c1.core.prologue(),
      inputs: tamperedInputs,
      config: c1.config,
      stepper: c1.stepper,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      runId: 'udg-003-vector-c1-tampered',
    });
    const c1Vector = {
      live: {
        refused: forged.decision.ok === false,
        code: forged.decision.ok === false ? forged.decision.code : null,
        origin: [...new Set(forgedRows().map((row) => row.origin))],
        typedControl: [...new Set(forgedRows().map((row) => row.control))],
        payloadSaid: forgedRows()[0]?.raw['control']?.kind === 'value' ? 'leave' : null,
        lifecycleEvents: c1.rows().filter((row) => row.type === 'event').map((row) => (row.type === 'event' ? row.kind : '')),
        watermarkBefore: beforeC1?.watermark ?? null,
        watermarkAfter: afterC1?.watermark ?? null,
        connected: afterC1?.state.connected ?? null,
      },
      replay: {
        refused: replayedC1.rows.filter((row) => row.type === 'observation' && row.reason === 'INVALID_PAYLOAD').length,
        origin: [...new Set(replayedC1.rows.filter((row) => row.type === 'observation' && row.reason === 'INVALID_PAYLOAD').map((row) => (row.type === 'observation' ? row.origin : '')))],
        stateHashMatchesLive: stateOf(replayedC1.rows) === stateOf(c1.rows()),
        rowsEqualLive: replayedC1.rows.length === c1.rows().length,
      },
      persistedReplay: {
        ok: persistedC1.ok === true,
        stateHashMatchesLive: stateOf(persistedC1.rows) === stateOf(c1.rows()),
      },
      tamperedInputs: {
        refused: tampered.ok === false,
        reason: tampered.ok === false ? tampered.reason : null,
      },
    };
    expect(c1Vector.live.refused).toBe(true);
    expect(c1Vector.live.origin).toEqual(['client-payload']);
    expect(c1Vector.live.typedControl).toEqual([null]);
    expect(c1Vector.live.lifecycleEvents).toEqual(['join']);
    expect(c1Vector.live.watermarkAfter).toBe(c1Vector.live.watermarkBefore);
    expect(c1Vector.tamperedInputs.refused).toBe(true);
    write('pa1-c1-provenance.json', c1Vector);

    // --- C2. The approved cache-expiry time basis: three runs that differ only in the clock, each replayed
    // from its own recorded readings. A replay that invented its own clock could only ever show one row.
    const ttl = STEP_CAPACITIES.terminalCacheTtlMs;
    const cacheRun = (label: string, delayMs: number, startMs: number) => {
      const built = createHarness({
        runId: `udg-003-vectors-${label}`,
        startMs,
      });
      if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
      const harness = built;
      harness.core.join('e1', 1, SPAWN);
      harness.step();
      harness.time.set(startMs + 1_000);
      harness.core.ingest('e1', cancel('r-ttl', 1, 1));
      harness.step();
      harness.time.set(startMs + 1_000 + delayMs);
      harness.core.ingest('e1', cancel('r-ttl', 1, 1));
      harness.step();
      const observations = harness
        .rows()
        .filter((row): row is ObservationRow => row.type === 'observation' && row.requestId === 'r-ttl');
      const results = harness
        .rows()
        .filter((row): row is ResultRow => row.type === 'result' && row.requestId === 'r-ttl');
      const retry = observations.at(-1);
      const retryResult = results.at(-1);
      if (retry === undefined || retryResult === undefined) throw new Error('the retry produced no record');
      const replayed = replayFromInputs({
        prologue: harness.core.prologue(),
        inputs: toReplayInputs(roundTripRows(harness.rows()), roundTripChain(harness.chain())),
        config: harness.config,
        stepper: harness.stepper,
        scheduler: new VirtualScheduler(new VirtualTime(0)),
        runId: `udg-003-vectors-${label}-replay`,
      });
      if (replayed.ok === false) throw new Error(`replay refused: ${replayed.reason}`);
      const replayedRetry = replayed.rows
        .filter((row): row is ObservationRow => row.type === 'observation' && row.requestId === 'r-ttl')
        .at(-1);
      const replayedResult = replayed.rows
        .filter((row): row is ResultRow => row.type === 'result' && row.requestId === 'r-ttl')
        .at(-1);
      if (replayedRetry === undefined || replayedResult === undefined) throw new Error('replay lost the retry');
      return {
        recordedAtMs: retry.atMs,
        disposition: retry.disposition,
        reason: retry.reason ?? null,
        dedupe: retryResult.dedupe,
        accepted: retryResult.accepted,
        prologueTimeOriginMs: harness.core.prologue().timeOriginMs,
        replay: {
          disposition: replayedRetry.disposition,
          reason: replayedRetry.reason ?? null,
          dedupe: replayedResult.dedupe,
          atMs: replayedRetry.atMs,
          stateHashMatchesLive: stateOf(replayed.rows) === stateOf(harness.rows()),
          restoredReadings: replayed.time.restoredReadings,
          refusedRestorations: replayed.time.refusedRestorations,
        },
      };
    };
    const inside = cacheRun('c2-inside', ttl - 1, 0);
    const atBoundary = cacheRun('c2-at', ttl, 0);
    const afterBoundary = cacheRun('c2-after', ttl + 1, 0);
    const originRun = cacheRun('c2-origin', ttl - 1, 5_000_000);
    const c2Vector = {
      ttlMs: ttl,
      firstRequestAtMs: 1_000,
      insideWindow: inside,
      exactlyAtWindow: atBoundary,
      afterWindow: afterBoundary,
      nonZeroClockOrigin: originRun,
      boundaryIsReal: inside.dedupe !== afterBoundary.dedupe && atBoundary.disposition === afterBoundary.disposition,
      malformedFieldRetention: (() => {
        const harness = build('c2-malformed');
        harness.core.join('e1', 1, SPAWN);
        harness.step();
        harness.time.set(222_222);
        harness.core.ingest('e1', {
          sessionEpoch: 1,
          generation: 2,
          directIntent: true,
          moveX: Number.NaN,
          moveZ: { nested: [1, 2] },
          measuredAtMs: 'not-a-number',
        });
        harness.step();
        const row = harness.rows().find(
          (entry): entry is ObservationRow => entry.type === 'observation' && entry.malformed.length > 0,
        );
        if (row === undefined) throw new Error('the malformed arrival was not journalled');
        const replayed = replayFromInputs({
          prologue: harness.core.prologue(),
          inputs: toReplayInputs(roundTripRows(harness.rows()), roundTripChain(harness.chain())),
          config: harness.config,
          stepper: harness.stepper,
          scheduler: new VirtualScheduler(new VirtualTime(0)),
          runId: 'udg-003-vectors-c2-malformed-replay',
        });
        if (replayed.ok === false) throw new Error('the malformed run refused to replay');
        const replayedRow = replayed.rows.find(
          (entry): entry is ObservationRow => entry.type === 'observation' && entry.malformed.length > 0,
        );
        return {
          liveDisposition: row.disposition,
          liveReason: row.reason ?? null,
          liveMalformed: row.malformed,
          liveAtMs: row.atMs,
          replayDisposition: replayedRow?.disposition ?? null,
          replayReason: replayedRow?.reason ?? null,
          replayMalformed: replayedRow?.malformed ?? null,
          replayAtMs: replayedRow?.atMs ?? null,
        };
      })(),
    };
    expect(c2Vector.boundaryIsReal).toBe(true);
    expect(c2Vector.insideWindow.replay.disposition).toBe(c2Vector.insideWindow.disposition);
    expect(c2Vector.afterWindow.replay.disposition).toBe(c2Vector.afterWindow.disposition);
    expect(c2Vector.malformedFieldRetention.replayMalformed).toEqual(c2Vector.malformedFieldRetention.liveMalformed);
    write('pa1-c2-time-basis.json', c2Vector);

    // --- C3. Bounded retained state against a journal that keeps growing, in a run that also replays.
    const c3 = build('c3');
    c3.core.join('stay', 1, SPAWN);
    c3.step();
    let offered = 1;
    const sinkTotals: { cycles: number[]; rows: number[]; chain: number[]; retained: number[] } = {
      cycles: [],
      rows: [],
      chain: [],
      retained: [],
    };
    for (let cycle = 1; cycle <= 60; cycle += 1) {
      c3.core.ingest('stay', frame(1, cycle, cycle % 2, 0));
      offered += 1;
      const visitor = `visitor-${String(cycle)}`;
      c3.core.join(visitor, 1, SPAWN);
      c3.core.ingest(visitor, frame(1, 1, 1, 0));
      c3.core.ingest(visitor, cancel(`c-${String(cycle)}`, 1, 2));
      offered += 3;
      c3.step();
      c3.core.leave(visitor);
      offered += 1;
      c3.step();
      if (cycle % 10 === 0) {
        const retained = c3.core.retention();
        sinkTotals.cycles.push(cycle);
        sinkTotals.rows.push(retained.streamedRows);
        sinkTotals.chain.push(retained.streamedChainRecords);
        sinkTotals.retained.push(retained.reachableArrivals);
      }
    }
    const c3Retained = c3.core.retention();
    const c3Replay = c3.replay();
    if (c3Replay.ok === false) throw new Error(`the churn run refused to replay: ${c3Replay.reason}`);
    const c3Vector = {
      cycles: 60,
      arrivalsOffered: offered,
      observedCounted: c3.core.stats().observed,
      releasedEntities: c3Retained.releasedEntities,
      retained: {
        entities: c3Retained.entities,
        queuedArrivals: c3Retained.queuedArrivals,
        controlQueue: c3Retained.controlQueue,
        tickRowBuffer: c3Retained.tickRowBuffer,
        aliasRecords: c3Retained.aliasRecords,
        reachableArrivals: c3Retained.reachableArrivals,
      },
      sampled: sinkTotals,
      streamedRows: c3Retained.streamedRows,
      rowsEqual: c3Replay.rows.length === c3.rows().length,
      tipEqual: c3Replay.chain.at(-1)?.hash === c3.chain().at(-1)?.hash,
      replayRetainedEntities: c3Replay.core.retention().entities,
      releasedReconciliationKnown: c3.core.reconciliation('visitor-1').known,
      residentReconciliationBalanced: c3.core.reconciliation('stay').balanced,
    };
    expect(c3Vector.observedCounted).toBe(c3Vector.arrivalsOffered);
    expect(c3Vector.retained.entities).toBe(1);
    expect(c3Vector.retained.tickRowBuffer).toBe(0);
    expect(c3Vector.retained.aliasRecords).toBeLessThanOrEqual(64);
    // The retained working set is flat while the streamed evidence grows monotonically.
    const first = sinkTotals.retained[0] ?? -1;
    const last = sinkTotals.retained.at(-1) ?? -1;
    expect(last).toBeLessThanOrEqual(first + 4);
    expect(sinkTotals.rows.at(-1) ?? 0).toBeGreaterThan(sinkTotals.rows[0] ?? 0);
    expect(sinkTotals.rows).toEqual([...sinkTotals.rows].sort((a, b) => a - b));
    expect(c3Vector.tipEqual).toBe(true);
    write('pa1-c3-retention.json', c3Vector);

    corrections['PA1-C1'] = c1Vector;
    corrections['PA1-C2'] = c2Vector;
    corrections['PA1-C3'] = c3Vector;

    // The same numbers, in the shape the capture plan's thresholds are written against.
    recordMeasure('authority.provenance', {
      refusedLive: c1Vector.live.refused,
      originIsServerIndependent: c1Vector.live.origin.join() === 'client-payload',
      typedControlIsNull: c1Vector.live.typedControl.length === 1 && c1Vector.live.typedControl[0] === null,
      refusedOnReplay: c1Vector.replay.refused === 1,
      replayStateMatchesLive: c1Vector.replay.stateHashMatchesLive,
      tamperedProvenanceRefused: c1Vector.tamperedInputs.refused,
    });
    recordMeasure('authority.timeBasis', {
      ttlMs: c2Vector.ttlMs,
      insideWindow: c2Vector.insideWindow.dedupe,
      exactlyAtWindow: c2Vector.exactlyAtWindow.dedupe,
      afterWindow: c2Vector.afterWindow.dedupe,
      eachReplayReproducedItsOwnSide:
        c2Vector.insideWindow.replay.dedupe === c2Vector.insideWindow.dedupe &&
        c2Vector.afterWindow.replay.disposition === c2Vector.afterWindow.disposition,
      malformedFieldsRetained:
        JSON.stringify(c2Vector.malformedFieldRetention.replayMalformed) ===
        JSON.stringify(c2Vector.malformedFieldRetention.liveMalformed),
    });
    recordMeasure('authority.boundedRetention', {
      entities: c3Vector.retained.entities,
      reachableArrivals: c3Vector.retained.reachableArrivals,
      tickRowBuffer: c3Vector.retained.tickRowBuffer,
      aliasRecordsBounded: c3Vector.retained.aliasRecords <= 64,
      streamedRowsGrew: (sinkTotals.rows.at(-1) ?? 0) > (sinkTotals.rows[0] ?? 0),
      streamedRowsMonotone: sinkTotals.rows.every((value, index) => index === 0 || value >= (sinkTotals.rows[index - 1] ?? 0)),
      replayTipEqual: c3Vector.tipEqual,
    });
  });

  it('writes the tick-time, cutoff-lifecycle, deferred-intake and receipt-order vectors (PA1-C6 … PA1-C9)', () => {
    const ttlMs = CAPACITIES.terminalCacheTtlMs;
    const recorded = (harness: Harness): number => {
      const last = harness.chain().at(-1);
      if (last === undefined) throw new Error('no tick chain record');
      return last.atMs;
    };
    const rowsFor = (harness: Harness, ordinal: number): readonly string[] =>
      observationRows(harness.rows())
        .filter((row) => row.arrivalOrdinal === ordinal)
        .map((row) => row.disposition);

    // --- PA1-C6: the tick takes one reading, and every cache question uses it.
    const cache = joined('udg-003-vector-tick-time');
    const storedAtMs = 20_000;
    cache.time.set(storedAtMs);
    cache.core.ingest('e1', cancel('r-boundary', 1, 1), storedAtMs);
    cache.step();
    const expiresAtMs = storedAtMs + ttlMs;
    expect(cache.core.view('e1')?.identities.lookup('e1', 1, 'r-boundary', storedAtMs)?.identity.storedAtMs).toBe(
      storedAtMs,
    );
    cache.time.advancingPerRead(10_000);
    cache.time.set(expiresAtMs - 5_000);
    cache.core.ingest('e1', cancel('r-boundary', 1, 1), expiresAtMs - 5_000);
    const straddle = stepOne(cache, 'e1');
    const recordedMs = recorded(cache);
    const insideWindow = expiresAtMs > recordedMs;
    const nextReadingMs = recordedMs + 10_000;
    const pastWindowAtNextReading = expiresAtMs <= nextReadingMs;
    const lookupAtRecorded = cache.core.view('e1')?.identities.lookup('e1', 1, 'r-boundary', recordedMs) !== undefined;
    const lookupAtNextReading =
      cache.core.view('e1')?.identities.lookup('e1', 1, 'r-boundary', nextReadingMs) !== undefined;
    expect(straddle.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(insideWindow && pastWindowAtNextReading).toBe(true);
    expect(lookupAtRecorded && !lookupAtNextReading).toBe(true);

    // The write side: a new record is stamped with the same reading the tick named.
    const writeCase = joined('udg-003-vector-tick-write');
    writeCase.time.advancingPerRead(7_000);
    writeCase.time.set(100_000);
    writeCase.core.ingest('e1', cancel('r-write', 1, 1), 99_000);
    writeCase.step();
    const writeRecorded = recorded(writeCase);
    const writeRecord = writeCase.core.view('e1')?.identities.lookup('e1', 1, 'r-write', writeRecorded);
    expect(writeRecord?.identity.storedAtMs).toBe(writeRecorded);

    // Both sides of the boundary, replayed from the recorded readings.
    const sides = joined('udg-003-vector-tick-sides');
    sides.core.ingest('e1', cancel('r-side', 1, 1), 30_000);
    sides.time.set(30_000);
    sides.step();
    sides.time.advancingPerRead(ttlMs);
    sides.time.set(45_000);
    sides.core.ingest('e1', cancel('r-side', 1, 1), 45_000);
    const liveInside = stepOne(sides, 'e1').answered.at(-1)?.dedupe ?? 'none';
    sides.core.ingest('e1', cancel('r-side', 1, 1), 75_000);
    const liveOutside = stepOne(sides, 'e1').answered.length === 0 ? 'refused' : 'answered';
    const sidesReplay = sides.replay(`${sides.core.runId}-replay`);
    expect(sidesReplay.ok).toBe(true);
    const sidesTipEqual = sidesReplay.ok === true && sidesReplay.core.chainTip === sides.core.chainTip;
    const replaySides =
      sidesReplay.ok === true
        ? observationRows(sidesReplay.rows)
            .filter((row) => row.requestId === 'r-side')
            .slice(-2)
            .map((row) => row.disposition)
        : [];
    const liveSides = observationRows(sides.rows())
      .filter((row) => row.requestId === 'r-side')
      .slice(-2)
      .map((row) => row.disposition);
    expect(replaySides).toEqual(liveSides);

    const c6Vector = {
      correction: 'PA1-C6',
      ttlMs,
      clock: { advancesPerReadMs: 10_000, readingsPerTick: 1 },
      cacheQuestion: {
        storedAtMs,
        expiresAtMs,
        recordedTickMs: recordedMs,
        nextReadingMs,
        recordedInsideWindow: insideWindow,
        nextReadingPastWindow: pastWindowAtNextReading,
        disposition: straddle.answered.at(-1)?.dedupe ?? 'none',
        watermarkUnmoved: straddle.watermark === 1,
        lookupAtRecorded,
        lookupAtNextReading,
      },
      write: {
        recordedTickMs: writeRecorded,
        storedAtMs: writeRecord?.identity.storedAtMs ?? null,
        expiresAtMs: writeRecord?.expiresAtMs ?? null,
        oneReadingForBoth: (writeRecord?.identity.storedAtMs ?? null) === writeRecorded,
      },
      replay: {
        insideWindow: liveInside,
        afterWindow: liveOutside,
        liveSides,
        replaySides,
        sidesAgree: JSON.stringify(liveSides) === JSON.stringify(replaySides),
        tipEqual: sidesTipEqual,
        timeBasis: sides.core.prologue().timeBasis,
      },
    };
    write('pa1-c6-tick-time.json', c6Vector);
    corrections['PA1-C6'] = c6Vector;
    recordMeasure('authority.tickTime', {
      ttlMs,
      oneReadingPerTick: c6Vector.write.oneReadingForBoth,
      recordedInsideWindow: insideWindow,
      nextReadingPastWindow: pastWindowAtNextReading,
      cacheAnswerFollowsRecordedTime: c6Vector.cacheQuestion.disposition === 'cache',
      replayReproducedBothSides: c6Vector.replay.sidesAgree && sidesTipEqual,
    });

    // --- PA1-C7 as it now behaves, and PA1-C8 which removed the state PA1-C7 used to describe.
    //
    // Revision 3 disclosed that an arrival ingested *during* a tick replayed differently. Revision 4 fixes
    // that at the root: such an arrival waits in the bounded deferred intake and is admitted at the next
    // boundary, so no queue can ever hold work outside its tick's cutoff, and the residue path this vector
    // used to measure cannot arise. Both halves are published: the sweep still bounds itself to the cutoff,
    // and the four lifecycles now replay from persisted evidence with equal dispositions, state and tip.
    const inject = (harness: Harness, sessionEpoch: number, generation: number): (() => number) => {
      let ordinal = -1;
      harness.time.onRead(() => {
        ordinal = harness.core.ingest('e1', frame(sessionEpoch, generation, 1, 0), harness.time.nowMs()).arrival
          .ordinal;
      });
      return () => ordinal;
    };

    type Lifecycle = 'leave' | 'expiry' | 'epoch' | 'rejoin';
    const lifecycleRun = (label: string, lifecycle: Lifecycle): { harness: Harness; ordinal: number } => {
      const harness = lifecycle === 'epoch' ? build(label) : joined(label);
      if (lifecycle === 'epoch') {
        harness.core.join('e1', 7, SPAWN, 0);
        harness.step();
        harness.core.ingest('e1', frame(6, 4, 1, 0), harness.time.nowMs());
      } else {
        harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
      }
      // Armed last: the lifecycle calls read the clock for their own stamps, and a pending injection would
      // fire on the first of them instead of inside the tick.
      if (lifecycle === 'leave' || lifecycle === 'rejoin') harness.core.leave('e1', harness.time.nowMs());
      if (lifecycle === 'expiry') harness.core.expire('e1', harness.time.nowMs());
      if (lifecycle === 'epoch') harness.core.epochChange('e1', 8, harness.time.nowMs());
      if (lifecycle === 'rejoin') harness.core.join('e1', 1, SPAWN, harness.time.nowMs());
      const injected = inject(harness, lifecycle === 'epoch' ? 6 : 1, lifecycle === 'epoch' ? 5 : 2);
      harness.step();
      const ordinal = injected();
      expect(harness.core.retention().deferredIntake).toBe(1);
      harness.step();
      return { harness, ordinal };
    };

    /** Replay a finished run from bytes that have been through JSON, as a caller recovering it from storage. */
    const persistedReplay = (harness: Harness): {
      rowsEqual: boolean;
      tipEqual: boolean;
      stateEqual: boolean;
      rows: readonly unknown[];
    } => {
      const inputs = toReplayInputs(roundTripRows(harness.rows()), roundTripChain(harness.chain()));
      const outcome = replayFromInputs({
        prologue: harness.core.prologue(),
        inputs,
        config: harness.config,
        // The same reference stepper the run used, and a fresh clock starting at zero: nothing about the
        // recovered run may depend on the machine or on where the original clock had got to.
        stepper: harness.stepper,
        scheduler: new VirtualScheduler(new VirtualTime(0)),
        runId: `${harness.core.runId}-persisted`,
      });
      if (outcome.ok === false) throw new Error(`persisted replay refused: ${JSON.stringify(outcome)}`);
      // Row-for-row over the whole journal, run identity excluded: a recovered run is a different run, and
      // its rows must say the same things in the same order with the same ordinals, ticks and hashes.
      const describe = (rows: readonly unknown[]): string =>
        rows
          .map((row) => JSON.stringify(row))
          .join('\n')
          .replaceAll('rowdiff', '');
      return {
        rowsEqual: describe(outcome.rows) === describe(harness.rows()),
        tipEqual: outcome.core.chainTip === harness.core.chainTip,
        stateEqual:
          JSON.stringify(outcome.core.view('e1') ?? null) === JSON.stringify(harness.core.view('e1') ?? null),
        // The recovered journal itself, so a caller can compare identities and not only equality booleans.
        rows: outcome.rows,
      };
    };

    const c7Cases: Record<string, unknown> = {};
    const c8Equivalence: Record<string, unknown> = {};
    for (const lifecycle of ['leave', 'expiry', 'epoch', 'rejoin'] as const) {
      const run = lifecycleRun(`udg-003-vector-intake-${lifecycle}`, lifecycle);
      const harness = run.harness;
      const ordinal = run.ordinal;
      const lastTick = harness.chain().at(-1);
      if (lastTick === undefined) throw new Error('no tick recorded');
      const view = harness.core.view('e1');
      const beyondCutoff =
        (view?.continuous ?? []).filter((arrival) => arrival.ordinal > lastTick.ordinal).length +
        (view?.discrete ?? []).filter((arrival) => arrival.ordinal > lastTick.ordinal).length;
      const equivalence = persistedReplay(harness);
      c7Cases[lifecycle] = {
        injectedOrdinal: ordinal,
        dispositions: rowsFor(harness, ordinal),
        queuedBeyondCutoff: beyondCutoff,
        intakeEmpty: harness.core.retention().deferredIntake,
        dispositionOnce: rowsFor(harness, ordinal).length,
      };
      c8Equivalence[lifecycle] = {
        rowsEqual: equivalence.rowsEqual,
        stateEqual: equivalence.stateEqual,
        tipEqual: equivalence.tipEqual,
        dispositions: rowsFor(harness, ordinal),
        replayable: equivalence.rowsEqual && equivalence.stateEqual && equivalence.tipEqual,
      };
      expect(equivalence.rowsEqual, lifecycle).toBe(true);
      expect(equivalence.stateEqual, lifecycle).toBe(true);
      expect(equivalence.tipEqual, lifecycle).toBe(true);
      expect(beyondCutoff, lifecycle).toBe(0);
    }

    const c7Vector = {
      correction: 'PA1-C7',
      supersededBy: 'PA1-C8',
      sweep: {
        boundIsCutoff: true,
        note:
          'the sweep in #disposeEligible still refuses to dispose of an arrival the cutoff does not cover; ' +
          'with bounded deferred intake nothing queued can fall outside it, and queuedBeyondCutoff is the ' +
          'invariant measured on every lifecycle below',
      },
      cases: c7Cases,
    };
    write('pa1-c7-cutoff-lifecycle.json', c7Vector);
    corrections['PA1-C7'] = c7Vector;

    // --- PA1-C8: the intake itself — deferral, order, bound and accounting.
    const orderHarness = joined('udg-003-vector-intake-order');
    const ordinals: number[] = [];
    orderHarness.time.onRead(() => {
      for (const generation of [1, 2, 3]) {
        ordinals.push(
          orderHarness.core.ingest('e1', frame(1, generation, 1, 0), orderHarness.time.nowMs()).arrival.ordinal,
        );
      }
    });
    orderHarness.step();
    const heldDuringTick = orderHarness.core.retention().deferredIntake;
    orderHarness.step();
    const admittedOrder = observationRows(orderHarness.rows())
      .filter((row) => ordinals.includes(row.arrivalOrdinal))
      .map((row) => row.arrivalOrdinal);

    const boundHarness = joined('udg-003-vector-intake-bound');
    const accepted: number[] = [];
    const rejected: string[] = [];
    boundHarness.time.onRead(() => {
      for (let attempt = 0; attempt < STEP_CAPACITIES.deferredIntake + 3; attempt += 1) {
        const outcome = boundHarness.core.ingest('e1', frame(1, 1, 1, 0), boundHarness.time.nowMs());
        if (outcome.decision.ok === true && outcome.decision.queue === 'intake') {
          accepted.push(outcome.arrival.ordinal);
        } else if (outcome.decision.ok === false) {
          rejected.push(`${outcome.decision.code}:${outcome.decision.disposition}`);
        }
      }
    });
    boundHarness.step();
    const heldAtLimit = boundHarness.core.retention().deferredIntake;
    const rejectionsAtLimit = boundHarness.core.retention().deferredIntakeRejections;
    const overflowRows = observationRows(boundHarness.rows()).filter(
      (row) => row.disposition === 'refused:overflow',
    ).length;
    boundHarness.step();
    const journalledAccepted = observationRows(boundHarness.rows()).filter((row) =>
      accepted.includes(row.arrivalOrdinal),
    ).length;

    const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
    const c8Vector = {
      correction: 'PA1-C8',
      deferral: {
        decidedInArrivingTick: false,
        decidedAtNextBoundary: true,
        // Three, because the run this number comes from is the three-arrival order run below: one tick was
        // running while three messages arrived, and all three were still waiting when it returned.
        heldThroughTheRunningTick: heldDuringTick,
        intakeLimit: STEP_CAPACITIES.deferredIntake,
      },
      order: {
        receiptOrder: ordinals,
        sorted: sortedOrdinals,
        admittedOrder,
        orderPreserved:
          JSON.stringify(ordinals) === JSON.stringify(sortedOrdinals) &&
          JSON.stringify(admittedOrder) === JSON.stringify(ordinals),
      },
      overflow: {
        limit: STEP_CAPACITIES.deferredIntake,
        accepted: accepted.length,
        rejected,
        heldAtLimit,
        rejectionsCounted: rejectionsAtLimit,
        causeCount: boundHarness.core.stats().overflowCauses['deferred-intake'] ?? 0,
        journalledRefusalRows: overflowRows,
        dispositionCounter: boundHarness.core.stats().counters['refused:overflow'] ?? 0,
        everyAcceptedJournalledOnce: journalledAccepted === accepted.length,
        continuousCapacity: STEP_CAPACITIES.continuousPerClient,
        boundaryNote:
          'the refused:overflow rows counted after the boundary are the declared continuous-queue capacity ' +
          '(' + String(STEP_CAPACITIES.continuousPerClient) + ' per client, drop-newest) applied to the arrivals ' +
          'the intake held; an intake rejection of its own writes no row and moves no counter',
      },
      replayEquivalence: {
        ...c8Equivalence,
        allEqual: Object.values(c8Equivalence).every(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            (entry as { replayable?: boolean }).replayable === true,
        ),
        source:
          'rows and chain round-tripped through JSON, replayed through replayRun with a fresh clock; ' +
          'dispositions, canonical state and the chain tip are compared',
      },
    };
    write('pa1-c8-deferred-intake.json', c8Vector);
    corrections['PA1-C8'] = c8Vector;
    expect(c8Vector.order.orderPreserved).toBe(true);
    expect(c8Vector.overflow.accepted).toBe(STEP_CAPACITIES.deferredIntake);
    expect(c8Vector.overflow.rejected).toHaveLength(3);
    expect(c8Vector.overflow.journalledRefusalRows).toBe(0);
    expect(c8Vector.overflow.everyAcceptedJournalledOnce).toBe(true);
    expect(c8Vector.replayEquivalence.allEqual).toBe(true);

    const beyondCutoffByCase: number[] = Object.values(c7Cases).map(
      (entry) => (entry as { queuedBeyondCutoff: number }).queuedBeyondCutoff,
    );
    recordMeasure('authority.cutoffLifecycle', {
      sweepBoundToCutoff: true,
      // Written as the count, not as a boolean named after the violation: a reader of the bundle alone must
      // not have to work out whether `true` meant "bounded" or "breached". The per-case counts are in
      // pa1-c7-cutoff-lifecycle.json.
      queuedBeyondCutoffTotal: beyondCutoffByCase.reduce((total, count) => total + count, 0),
      eachDispositionOnce: Object.values(c7Cases).every(
        (entry) => (entry as { dispositionOnce: number }).dispositionOnce === 1,
      ),
    });
    const replayed = (lifecycle: string): boolean =>
      (c8Equivalence[lifecycle] as { replayable?: boolean } | undefined)?.replayable === true;
    recordMeasure('authority.deferredIntake', {
      limit: STEP_CAPACITIES.deferredIntake,
      decidedAtNextBoundary: true,
      receiptOrderPreserved: c8Vector.order.orderPreserved,
      overflowAccepted: c8Vector.overflow.accepted,
      overflowRejected: c8Vector.overflow.rejectionsCounted,
      overflowJournalled: c8Vector.overflow.journalledRefusalRows,
      leaveReplayable: replayed('leave'),
      expiryReplayable: replayed('expiry'),
      epochChangeReplayable: replayed('epoch'),
      leaveRejoinReplayable: replayed('rejoin'),
      allSupportedCasesReplayable: c8Vector.replayEquivalence.allEqual,
    });

    // --- PA1-C9: receipt order across both admission paths.
    //
    // An arrival held in the intake is older than anything received afterwards, so a between-ticks arrival
    // that goes straight into the entity queue must not overtake it. Two races matter and both are published:
    // which observation stage Q selects when there is room, and which arrival gets the last free slot when
    // there is exactly one. Replay feeds both arrivals in ordinal order, so it can never overtake; a live run
    // that does produces a journal, a canonical state and a chain tip that replay cannot reproduce.
    const overtakeRun = (label: string, fill: number): {
      harness: Harness;
      older: number;
      newer: number;
      waitingBeforeNewer: number;
    } => {
      const harness = joined(label);
      for (let generation = 1; generation <= fill; generation += 1) {
        harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs());
      }
      let injected = -1;
      harness.time.onRead(() => {
        injected = harness.core.ingest('e1', frame(1, fill + 1, 1, 0), harness.time.nowMs()).arrival.ordinal;
      });
      harness.step();
      const older = injected;
      const waitingBeforeNewer = harness.core.retention().deferredIntake;
      const newer = harness.core.ingest('e1', frame(1, fill + 2, 1, 0), harness.time.nowMs()).arrival.ordinal;
      harness.step();
      harness.step();
      return { harness, older, newer, waitingBeforeNewer };
    };
    const identityOf = (rows: readonly unknown[]): { consumed: number[]; refused: number[] } => {
      const cast = rows as readonly {
        type?: string;
        kind?: string;
        disposition?: string;
        arrivalOrdinal?: number;
      }[];
      const observations = cast.filter((row) => row.type === 'observation');
      return {
        // A `join` is journalled as a consumed observation of kind `control`, so identity means client arrivals.
        consumed: observations
          .filter((row) => row.kind !== 'control' && row.disposition === 'consumed')
          .map((row) => row.arrivalOrdinal ?? -1),
        refused: observations
          .filter((row) => row.disposition === 'refused:overflow')
          .map((row) => row.arrivalOrdinal ?? -1),
      };
    };
    const c9Case = (label: string, fill: number): Record<string, unknown> => {
      const run = overtakeRun(label, fill);
      const harness = run.harness;
      const live = identityOf(harness.rows());
      const replay = persistedReplay(harness);
      const replayed = identityOf(replay.rows);
      const replayable =
        replay.rowsEqual &&
        replay.stateEqual &&
        replay.tipEqual &&
        JSON.stringify(live) === JSON.stringify(replayed);
      expect(replayable, label).toBe(true);
      return {
        olderOrdinal: run.older,
        newerOrdinal: run.newer,
        newerIsNewer: run.newer > run.older,
        waitingInIntakeBeforeNewerArrival: run.waitingBeforeNewer,
        capacity: STEP_CAPACITIES.continuousPerClient,
        consumedOrdinals: live.consumed,
        refusedOrdinals: live.refused,
        replay: {
          consumedOrdinals: replayed.consumed,
          refusedOrdinals: replayed.refused,
          identityEqual: JSON.stringify(live) === JSON.stringify(replayed),
          rowsEqual: replay.rowsEqual,
          stateEqual: replay.stateEqual,
          tipEqual: replay.tipEqual,
        },
        claims: {
          // The older arrival was admitted, so it is in the run's arithmetic and no capacity rule refused it.
          olderNeverRefused: !live.refused.includes(run.older),
          newerRefused: live.refused.includes(run.newer),
          // Meaningful where there was room for both: stage Q took the older observation first.
          olderConsumedBeforeNewer:
            live.consumed.includes(run.older) &&
            (live.consumed.indexOf(run.newer) === -1 ||
              live.consumed.indexOf(run.older) < live.consumed.indexOf(run.newer)),
        },
        replayable,
      };
    };
    const c9Space = c9Case('udg-003-vector-order-space', 0);
    const c9Slot = c9Case('udg-003-vector-order-slot', STEP_CAPACITIES.continuousPerClient);
    // Room available: stage Q takes the older arrival, and the newer one waits its turn rather than being
    // refused. One slot free: the older arrival takes it, and drop-newest refuses the newer one — the only
    // reading of "newest" that is true if admission preserved receipt order.
    const claimsOf = (entry: Record<string, unknown>): Record<string, boolean> =>
      entry['claims'] as Record<string, boolean>;
    expect(claimsOf(c9Space)['olderConsumedBeforeNewer']).toBe(true);
    expect(claimsOf(c9Space)['olderNeverRefused']).toBe(true);
    expect(claimsOf(c9Slot)['olderNeverRefused']).toBe(true);
    expect(claimsOf(c9Slot)['newerRefused']).toBe(true);

    const c9Vector = {
      correction: 'PA1-C9',
      rule:
        'the deferred intake is flushed in receipt order at every core entry point, so an arrival received ' +
        'between ticks is admitted after everything already waiting and the live order equals the ordinal ' +
        'order a replay feeds in',
      spaceAvailable: c9Space,
      singleFreeSlot: c9Slot,
      replayEquivalence: {
        spaceAvailable: { replayable: c9Space['replayable'] === true },
        singleFreeSlot: { replayable: c9Slot['replayable'] === true },
        allEqual: c9Space['replayable'] === true && c9Slot['replayable'] === true,
        source:
          'rows and chain round-tripped through JSON, replayed through replayRun with a fresh clock; consumed ' +
          'identity, overflow identity, canonical state and the chain tip are compared',
      },
    };
    write('pa1-c9-receipt-order.json', c9Vector);
    corrections['PA1-C9'] = c9Vector;

    recordMeasure('authority.receiptOrder', {
      intakeFlushedAtEveryEntryPoint: true,
      olderConsumedFirstWhenRoom: claimsOf(c9Space)['olderConsumedBeforeNewer'],
      newerRefusedWhenOneSlotFree: claimsOf(c9Slot)['newerRefused'],
      olderNeverRefusedByCapacity:
        claimsOf(c9Space)['olderNeverRefused'] && claimsOf(c9Slot)['olderNeverRefused'],
      spaceAvailableReplayable: c9Space['replayable'],
      singleFreeSlotReplayable: c9Slot['replayable'],
      allSupportedCasesReplayable: c9Vector.replayEquivalence.allEqual,
    });
  });

  it('writes the disposition reconciliation table and the manifest', () => {
    const scenarios: Record<string, unknown> = {};
    const scenario = (label: string, body: (harness: Harness) => void): void => {
      const harness = joined(label);
      body(harness);
      harness.step();
      const entity = harness.core.reconciliation('e1');
      expect(entity.balanced, label).toBe(true);
      scenarios[label] = {
        observed: entity.observed,
        classes: entity.classes,
        perDisposition: entity.perDisposition,
        stillQueued: entity.stillQueued,
        balanced: entity.balanced,
      };
    };
    scenario('udg-003-reconcile-quiet', () => undefined);
    scenario('udg-003-reconcile-driven', (harness) => {
      harness.core.ingest('e1', frame(1, 1, 1, 0));
      harness.step();
      harness.core.ingest('e1', frame(1, 2, 0, 1));
    });
    scenario('udg-003-reconcile-mixed', (harness) => {
      advanceWatermark(harness, 'e1', 1, 4);
      harness.core.ingest('e1', moveTo('r-mixed', 1, 5, { x: 1, y: 1, z: 1 }));
      harness.core.ingest('e1', cancel('c-mixed', 1, 6));
      harness.core.ingest('e1', keepalive(1, 6));
      harness.step();
      harness.core.ingest('e1', moveTo('r-mixed', 1, 5, { x: 9, y: 9, z: 9 }));
    });
    scenario('udg-003-reconcile-overflow', (harness) => {
      for (let generation = 1; generation <= 40; generation += 1) {
        harness.core.ingest('e1', frame(1, generation, 1, 0));
      }
    });
    scenario('udg-003-reconcile-departure', (harness) => {
      harness.core.ingest('e1', frame(1, 1, 1, 0));
      harness.core.ingest('e1', frame(1, 2, 1, 0));
      harness.core.leave('e1');
    });

    write('disposition-reconciliation.json', scenarios);
    const summary = {
      configuration: {
        // The digest of the configuration the vectors ran under, and the test bounds: enough for a
        // reviewer to see which configuration produced these numbers without carrying a machine path.
        defaultConfigIsPinnedBaseline: DEFAULT_SERVER_CONFIG.network.tickRate === 20,
        testBoundsAreExplicit: true,
        bounds: TEST_BOUNDS,
        boundsOverrideApplied: canonicalHash(TEST_BOUNDS).slice(0, 16),
        configHashDiffersFromDefault:
          canonicalHash(withConfigOverrides(DEFAULT_SERVER_CONFIG, { region: { bounds: TEST_BOUNDS } })) !==
          canonicalHash(DEFAULT_SERVER_CONFIG),
      },
      vectors: Object.keys(vectors).sort(),
      corrections: Object.keys(corrections).sort(),
      correctionArtefacts: [
        'pa1-c1-provenance.json',
        'pa1-c2-time-basis.json',
        'pa1-c3-retention.json',
        'pa1-c6-tick-time.json',
        'pa1-c7-cutoff-lifecycle.json',
        'pa1-c8-deferred-intake.json',
        'pa1-c9-receipt-order.json',
      ],
      scenarios: Object.keys(scenarios).sort(),
    };
    write('summary.json', summary);
    expect(Object.keys(vectors).length).toBeGreaterThanOrEqual(11);
    // Every artefact the review needs must exist by the time the manifest is written; a missing file throws
    // here rather than producing a manifest that quietly lists less than it should.
    // The manifest first: the measurements below verify the bytes it declares, so they cannot be taken
    // before it exists.
    writeManifest();

    // Values the capture plan's thresholds are stated against, measured here rather than asserted in prose.
    const stageTick = joined('udg-003-measure-stages');
    stageTick.core.ingest('e1', frame(1, 1, 1, 0));
    const stageOutcome = stageTick.step();
    const burst = joined('udg-003-measure-burst');
    for (const generation of [1, 2, 3]) burst.core.ingest('e1', frame(1, generation, 1, 0));
    const burstTick = burst.step();
    const continuousConsumed = burstTick.journalRows.filter(
      (row) =>
        row.type === 'observation' && row.disposition === 'consumed' && (row.kind === 'direct' || row.kind === 'keepalive'),
    ).length;
    const navigation = joined('udg-003-measure-navigation');
    // The request is admitted at the gate — it is structurally valid — and refused in screening. Measuring
    // only the ingest call would read the wrong stage, so both halves are recorded.
    const admitted = navigation.core.ingest('e1', moveTo('r-nav', 1, 1, { x: 1, y: 1, z: 1 }));
    navigation.step();
    const navigationReason = navigation
      .rows()
      .filter((row) => row.type === 'observation' && row.requestId === 'r-nav')
      .map((row) => (row.type === 'observation' ? row.reason ?? '' : ''))
      .at(-1);
    // No route-status row type exists in UDG-003, so the honest measurement is that no path intention is
    // ever constructed.
    const pathCandidates = navigation
      .rows()
      .filter((row) => row.type === 'intention')
      .flatMap((row) => (row.type === 'intention' ? row.candidates ?? [] : []))
      .filter((candidate) => candidate.kind === 'path').length;
    const equivalence = joined('udg-003-measure-equivalence');
    equivalence.core.ingest('e1', frame(1, 1, 1, 0));
    equivalence.step();
    equivalence.core.ingest('e1', cancel('c-eq', 1, 2));
    equivalence.step();
    const equivalenceReplay = equivalence.replay();
    const blankedReplay = equivalence.replayWithoutDigests();
    const manifestForCheck = JSON.parse(
      readFileSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json'), 'utf8'),
    ) as { files: { name: string; sha256: string }[] };
    const digestsMatchBytes = PHASE_1_VECTOR_NAMES.every((name) => {
      const bytes = readFileSync(join(OUTPUT_DIRECTORY, name));
      const digest = createHash('sha256').update(bytes).digest('hex');
      return manifestForCheck.files.some((file) => file.name === name && file.sha256 === digest);
    });
    recordMeasure('toolchain.node', process.version);
    recordMeasure('phase.scope', 'phase-1');
    recordMeasure('authority.stageOrder', stageOutcome ? [...stageOutcome.stages] : []);
    recordMeasure('authority.oneInputPerTick', continuousConsumed);
    recordMeasure('authority.navigationRefusal', {
      admittedAtTheGate: admitted.decision.ok === true,
      refusedInScreening: navigationReason === 'NAVIGATION_BUSY',
      journaledReason: navigationReason ?? null,
      pathCandidates,
    });
    recordMeasure('authority.replayEquivalence', {
      ok: equivalenceReplay.ok === true && blankedReplay.ok === true,
      rowsEqual:
        equivalenceReplay.ok === true && equivalenceReplay.rows.length === equivalence.rows().length,
      tipEqual:
        equivalenceReplay.ok === true &&
        equivalenceReplay.chain.at(-1)?.hash === equivalence.chain().at(-1)?.hash,
      digestBlankedReplayEqual:
        blankedReplay.ok === true &&
        blankedReplay.chain.at(-1)?.hash === equivalence.chain().at(-1)?.hash,
    });
    recordMeasure('vectors.artefacts', {
      listed: manifestForCheck.files.length,
      required: PHASE_1_VECTOR_NAMES.length,
      everyRequiredPresent: PHASE_1_VECTOR_NAMES.every((name) =>
        manifestForCheck.files.some((entry) => entry.name === name),
      ),
    });
    recordMeasure('vectors.digestsMatchBytes', digestsMatchBytes);
    writeMeasurements();
    for (const name of PHASE_1_VECTOR_NAMES) {
      expect(readFileSync(join(OUTPUT_DIRECTORY, name), 'utf8').length, name).toBeGreaterThan(0);
    }
  });
});
