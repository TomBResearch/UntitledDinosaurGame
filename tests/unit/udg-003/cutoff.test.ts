/**
 * Cutoff, stage order and consumption (PA1-1, PA1-2; P03-b, P03-c, AC-3a, AC-6).
 *
 * The cutoff is what makes a tick reproducible, so this suite asserts the properties an observer can
 * actually see: which arrivals a tick was allowed to consider, how many it consumed, and in which stage
 * order it acted. Timestamps are deliberately scrambled in one case, because "order is never inferred
 * from client timestamps" (P03-b) is only a real claim if a test breaks it.
 */

import { describe, expect, it } from 'vitest';

import { arbitrate, screenContinuous } from '../../../apps/server/src/authority/screen.js';
import { planCommit } from '../../../apps/server/src/authority/commit.js';
import { canonicalHash } from '../../../packages/config/dist/index.js';
import { frame, keepalive } from '../../support/authority/payloads.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';

const build = () => {
  const built = createHarness({ runId: 'udg-003-cutoff' });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

describe('authority cutoff (P03-b)', () => {
  it('runs the adopted stage order and stops at X, deferring M and P to Phase 2', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    const outcome = h.step();
    expect(outcome.stages).toEqual(['F', 'L', 'Q', 'S', 'A', 'C', 'R', 'X']);
    // M maps canonical state to a replica and P publishes; both need a room, which is Phase 2.
    expect(outcome.stages).not.toContain('M');
    expect(outcome.stopped).toBe(false);
    expect(outcome.tick).toBe(0);
  });

  it('freezes eligibility at the cutoff, so an arrival after it waits for the next tick', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    h.step(); // tick 0 applies the join.

    const first = h.core.ingest('e1', frame(1, 1, 1, 0));
    const firstTick = h.step();
    const firstTickRow = firstTick.journalRows.find((row) => row.type === 'tick');
    expect(firstTickRow?.type === 'tick' ? firstTickRow.ordinal : -1).toBe(first.arrival.ordinal);
    expect(firstTick.entities[0]?.consumed).toBe(first.arrival.ordinal);

    // Ingested after tick 1 captured its cutoff, so tick 1 could not have seen it.
    expect(firstTick.cutoff.ordinal).toBeLessThan(firstTick.cutoff.ordinal + 1);
    const second = h.core.ingest('e1', frame(1, 2, 0, 1));
    expect(second.arrival.ordinal).toBeGreaterThan(firstTick.cutoff.ordinal);

    const secondTick = h.step();
    const secondTickRow = secondTick.journalRows.find((row) => row.type === 'tick');
    expect(secondTickRow?.type === 'tick' ? secondTickRow.ordinal : -1).toBe(second.arrival.ordinal);
    expect(secondTick.entities[0]?.consumed).toBe(second.arrival.ordinal);

    // And the frame that arrived before the cutoff of tick 1 was never recorded as waiting.
    const queued = firstTick.journalRows.filter(
      (row) => row.type === 'observation' && row.disposition === 'queued',
    );
    expect(queued).toHaveLength(0);
  });

  it('orders by arrival ordinal, never by a received timestamp', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    h.step();

    // Two held samples at one generation, received in the opposite order to their timestamps: the
    // smaller timestamp arrives second, so ordering by timestamp would move z before x.
    h.core.ingest('e1', frame(1, 1, 0, 1), 900); // ordinal A: drive +z
    h.core.ingest('e1', frame(1, 1, 1, 0), 100); // ordinal B: drive +x

    const first = h.step();
    // FIFO by ordinal: the +z sample was ingested first, so it is the one this tick consumed.
    expect(h.core.view('e1')?.state.locomotion.kinematic.position).toEqual({ x: 0, y: 0, z: 0.2 });
    h.step();
    expect(h.core.view('e1')?.state.locomotion.kinematic.position).toEqual({ x: 0.2, y: 0, z: 0.2 });
    expect(first.entities[0]?.consumed).not.toBeNull();
    const consumedOrdinals = h
      .rows()
      .filter((row) => row.type === 'intention' && row.consumed !== null)
      .map((row) => (row.type === 'intention' ? row.consumed : -1));
    expect(consumedOrdinals).toHaveLength(2);
    expect((consumedOrdinals[0] ?? 0) < (consumedOrdinals[1] ?? 0)).toBe(true);
  });

  it('consumes at most one continuous observation per entity per tick under a burst', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    h.step();

    for (let generation = 1; generation <= 40; generation += 1) {
      const outcome = h.core.ingest('e1', frame(1, generation, 1, 0));
      if (!outcome.decision.ok) break;
    }
    const stats = h.core.stats();
    const accepted = stats.observed - (stats.counters['refused:overflow'] ?? 0);
    expect(accepted).toBeLessThanOrEqual(33); // 1 join + a 32-frame continuous queue

    const consumedPerTick: number[] = [];
    for (let tick = 0; tick < 5; tick += 1) {
      const outcome = h.step();
      const consumed = outcome.entities.filter((entry) => entry.consumed !== null).length;
      consumedPerTick.push(consumed);
    }
    expect(consumedPerTick).toEqual([1, 1, 1, 1, 1]);
    // Six ticks ran in total (the join tick plus five), and each stepped the entity exactly once.
    expect(h.stepper.calls.length).toBe(6);
  });

  it('never consumes for an entity that has no eligible observation', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    h.step();
    const outcome = h.step();
    expect(outcome.entities[0]?.consumed).toBeNull();
    expect(outcome.entities[0]?.stepped).toBe(true);
    expect(outcome.entities[0]?.inputSource).toBe('neutral');
  });
});

describe('purity of the stages that must not mutate (P03-b)', () => {
  it('leaves admission state, queues and the journal untouched when asked the same question twice', () => {
    const h = build();
    h.core.join('e1', 1, SPAWN);
    h.step();
    h.core.ingest('e1', frame(1, 1, 1, 0));
    h.core.ingest('e1', keepalive(1, 1));

    const before = h.core.view('e1');
    if (before === undefined) throw new Error('entity missing before the pure calls');
    const digestBefore = canonicalHash(before.state);
    const rowsBefore = h.rows().length;

    const context = { bounds: h.core.bounds, gapWindow: 64, nowMs: 0, tick: 1 };
    const selected = before.continuous[0];
    if (selected === undefined) throw new Error('no queued observation to screen');
    const firstScreening = screenContinuous(before, selected, context);
    const secondScreening = screenContinuous(before, selected, context);
    const decision = arbitrate(firstScreening.candidate === null ? [] : [firstScreening.candidate]);

    const plan = planCommit({
      view: before,
      cutoff: { tick: 1, ordinal: before.continuous.length },
      continuous: firstScreening,
      discrete: { candidates: [], refusals: [], answers: [], cacheWrites: [] },
      arbitration: decision,
      tick: 1,
      remainingContinuous: before.continuous.slice(1),
      discreteQueue: before.discrete,
    });
    const secondPlan = planCommit({
      view: before,
      cutoff: { tick: 1, ordinal: before.continuous.length },
      continuous: secondScreening,
      discrete: { candidates: [], refusals: [], answers: [], cacheWrites: [] },
      arbitration: decision,
      tick: 1,
      remainingContinuous: before.continuous.slice(1),
      discreteQueue: before.discrete,
    });

    const after = h.core.view('e1');
    expect(canonicalHash(after?.state)).toBe(digestBefore);
    expect(after?.watermark).toBe(0);
    expect(after?.latchedKind).toBe('none');
    expect(after?.continuousDepth).toBe(2);
    expect(after?.discreteDepth).toBe(0);
    expect(h.rows().length).toBe(rowsBefore);
    expect(plan.watermarkAfter).toBe(secondPlan.watermarkAfter);
    expect(plan.drive).toEqual(secondPlan.drive);
    expect(plan.purge.map((item) => item.arrival.ordinal)).toEqual(secondPlan.purge.map((item) => item.arrival.ordinal));
  });
});
