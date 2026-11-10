/**
 * Machine-readable vectors for the Phase 1 acceptance list (assignment §6.2–§6.6).
 *
 * Every scenario here is asserted against the outcome P03 states and *also* written out under
 * `artifacts/udg-003-phase-1/` as a JSON vector, so the completion record points at values a reviewer can
 * diff instead of at a sentence. The artefacts stay out of Git (repository rule); their SHA-256 digests are
 * quoted in the record. Nothing here can pass by omission: each vector is compared against an expectation
 * written from the adopted text before the run.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_CONFIG, canonicalHash, withConfigOverrides } from '../../../packages/config/dist/index.js';
import { MAX_GENERATION_FORWARD_GAP } from '../../../packages/protocol/dist/index.js';
import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { sanitisationIssues, withDigestsBlanked } from '../../../apps/server/src/authority/journal.js';
import { SPAWN, TEST_BOUNDS, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame, frameWithNonFiniteAxis, keepalive, moveTo } from '../../support/authority/payloads.js';
import { advanceWatermark, metaRows, resultRows } from '../../support/authority/scenarios.js';
import type { TickOutcome } from '../../../apps/server/src/authority/step.js';
import type { JournalRow } from '../../../apps/server/src/authority/types.js';

const OUTPUT_DIRECTORY = join(process.cwd(), 'artifacts', 'udg-003-phase-1');

const write = (name: string, value: unknown): void => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  // The artefacts must be safe to publish, so the same rule that guards the journal guards them.
  const absolute = /(^|[\s"/(])(\/home\/|\/Users\/|\/workspace\/|\/tmp\/|\/var\/|\/private\/)/.test(text);
  expect(absolute, `${name} would carry a machine path`).toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, name), text, 'utf8');
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
      const identityAfterConflict = harness.core.view('e1')?.identities.lookup('e1', 1, 'r9');
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
      scenarios: Object.keys(scenarios).sort(),
    };
    write('summary.json', summary);
    expect(Object.keys(vectors).length).toBeGreaterThanOrEqual(11);
  });
});
