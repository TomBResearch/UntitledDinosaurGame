/**
 * Bounded queues, overflow accounting and the terminal-request cache bounds
 * (PA1-9, PA1-10; AC-3e, AC-19, AC-20).
 *
 * The capacities are asserted twice on purpose: once against `CAPACITIES`, so a change to the code is
 * visible, and once against the numbers P03 and protocol.md 4.3 pin, so a change to the constant cannot
 * quietly move the rule.
 */

import { describe, expect, it } from 'vitest';

import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import { cancel, frame, moveTo } from '../../support/authority/payloads.js';
import { advanceWatermark, metaRows, resultRows, stepOne } from '../../support/authority/scenarios.js';

const build = (runId: string) => {
  const built = createHarness({ runId });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string, entityId = 'e1', epoch = 1) => {
  const harness = build(runId);
  harness.core.join(entityId, epoch, SPAWN);
  harness.step();
  return harness;
};

describe('the capacities are the adopted numbers (P03-f, protocol.md 4.3)', () => {
  it('matches the pinned values, not a local literal', () => {
    expect(CAPACITIES).toEqual({
      continuousPerClient: 32,
      discretePerEntity: 8,
      discretePerRoom: 64,
      controlPerRoom: 64,
      terminalCacheRecords: 128,
      terminalCacheTtlMs: 30_000,
    });
  });
});

describe('continuous queue bound (AC-3e)', () => {
  it('holds 32 frames, drops the newest and keeps the oldest', () => {
    const harness = joined('udg-003-continuous-capacity');
    const outcomes = [];
    for (let generation = 1; generation <= 40; generation += 1) {
      outcomes.push(harness.core.ingest('e1', frame(1, generation, 1, 0)));
    }
    const view = harness.core.view('e1');
    expect(view?.continuousDepth).toBe(CAPACITIES.continuousPerClient);
    const accepted = outcomes.filter((outcome) => outcome.decision.ok);
    const refused = outcomes.filter((outcome) => outcome.decision.ok === false);
    expect(accepted).toHaveLength(32);
    expect(refused).toHaveLength(8);
    // Drop-newest, not drop-oldest: the survivors are the eight *earliest* generations in order.
    expect(view?.continuous.map((arrival) => arrival.declaredGeneration)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ]);
    for (const outcome of refused) {
      if (outcome.decision.ok === false) {
        expect(outcome.decision.code).toBe('RATE_LIMITED');
        expect(outcome.decision.disposition).toBe('refused:overflow');
      }
      expect(outcome.overflowCause).toBe('continuous-capacity');
    }
    expect(harness.core.stats().continuousHighWater).toBe(32);
    expect(harness.core.stats().overflowCauses['continuous-capacity']).toBe(8);

    // The refusals are journaled at ingest, so AC-17 still balances after they drain.
    harness.run(40);
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });

  it('never lets a meta row report a depth above the bound', () => {
    const harness = joined('udg-003-depth-samples');
    for (let generation = 1; generation <= 45; generation += 1) {
      harness.core.ingest('e1', frame(1, generation, 1, 0));
      if (generation % 5 === 0) harness.step();
    }
    harness.run(40);
    for (const row of metaRows(harness.rows())) {
      expect(row.continuousDepth).toBeLessThanOrEqual(CAPACITIES.continuousPerClient);
      expect(row.discreteDepth).toBeLessThanOrEqual(CAPACITIES.discretePerEntity);
    }
    expect(metaRows(harness.rows()).length).toBeGreaterThan(0);
  });
});

describe('discrete queue bounds (AC-3e)', () => {
  it('holds 8 requests per entity and refuses the rest with the entity cause', () => {
    const harness = joined('udg-003-discrete-capacity-entity');
    const outcomes = [];
    for (let index = 1; index <= 12; index += 1) {
      outcomes.push(harness.core.ingest('e1', cancel(`c-${String(index)}`, 1, index)));
    }
    expect(harness.core.view('e1')?.discreteDepth).toBe(CAPACITIES.discretePerEntity);
    expect(outcomes.filter((outcome) => outcome.decision.ok)).toHaveLength(8);
    const refused = outcomes.filter((outcome) => outcome.decision.ok === false);
    expect(refused).toHaveLength(4);
    for (const outcome of refused) expect(outcome.overflowCause).toBe('discrete-capacity-entity');
    expect(harness.core.stats().overflowCauses['discrete-capacity-entity']).toBe(4);
  });

  it('holds 64 requests room-wide, whatever the per-entity headroom', () => {
    const harness = build('udg-003-discrete-capacity-room');
    const entityIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (const entityId of entityIds) harness.core.join(entityId, 1, SPAWN);
    harness.step();

    let accepted = 0;
    let roomRefusals = 0;
    for (const entityId of entityIds) {
      for (let index = 1; index <= 8; index += 1) {
        const outcome = harness.core.ingest(entityId, cancel(`${entityId}-${String(index)}`, 1, index));
        if (outcome.decision.ok) accepted += 1;
        else if (outcome.overflowCause === 'discrete-capacity-room') roomRefusals += 1;
      }
    }
    expect(accepted).toBe(CAPACITIES.discretePerRoom);
    expect(roomRefusals).toBe(16);
    expect(harness.core.stats().overflowCauses['discrete-capacity-room']).toBe(16);
    // The bound is room-wide, so no single client can exhaust it for the others.
    let queued = 0;
    for (const entityId of entityIds) queued += harness.core.view(entityId)?.discreteDepth ?? 0;
    expect(queued).toBe(CAPACITIES.discretePerRoom);
  });
});

describe('terminal-request cache bounds (protocol.md 4.3, AC-19)', () => {
  const cacheWith = (harness: ReturnType<typeof build>, count: number, firstGeneration: number) => {
    for (let index = 0; index < count; index += 1) {
      harness.core.ingest('e1', moveTo(`fill-${String(index)}`, 1, firstGeneration + index, { x: 1, y: 1, z: 1 }));
      harness.step();
    }
  };

  it('keeps at most 128 records and evicts the oldest deterministically', () => {
    const harness = joined('udg-003-cache-capacity');
    advanceWatermark(harness, 'e1', 1, 1);
    cacheWith(harness, 130, 2);
    expect(harness.core.stats().cacheDepth).toBe(CAPACITIES.terminalCacheRecords);
    const view = harness.core.view('e1');
    // The first two records are gone and the newest survive: eviction is oldest-first.
    expect(view?.identities.lookup('e1', 1, 'fill-0')).toBeUndefined();
    expect(view?.identities.lookup('e1', 1, 'fill-2')).toBeDefined();
    expect(view?.identities.lookup('e1', 1, 'fill-129')).toBeDefined();
  });

  it('T-4: an evicted identity cannot replay, because stale generation admission still refuses it', () => {
    const harness = joined('udg-003-cache-evicted-replay');
    advanceWatermark(harness, 'e1', 1, 3);
    // r7 is refused and cached while its generation is still current.
    harness.core.ingest('e1', moveTo('r7', 1, 4, { x: 12, y: 0.9, z: -3 }));
    stepOne(harness, 'e1');
    expect(resultRows(harness.rows()).at(-1)?.requestId).toBe('r7');

    // While cached, the retry is answered from the record rather than re-decided.
    harness.core.ingest('e1', moveTo('r7', 1, 4, { x: 12, y: 0.9, z: -3 }));
    const cached = stepOne(harness, 'e1');
    expect(cached.answered.map((entry) => entry.dedupe)).toEqual(['cache']);

    // The watermark moves on, and the record is pushed out of the cache.
    advanceWatermark(harness, 'e1', 1, 10);
    cacheWith(harness, CAPACITIES.terminalCacheRecords, 11);
    expect(harness.core.view('e1')?.identities.lookup('e1', 1, 'r7')).toBeUndefined();

    // The retry now has no record to answer it. It is refused by the generation window, and it moves
    // nothing: eviction removes a reply, never a protection.
    harness.core.ingest('e1', moveTo('r7', 1, 4, { x: 12, y: 0.9, z: -3 }));
    const evicted = stepOne(harness, 'e1');
    expect(evicted.answered).toHaveLength(0);
    expect(evicted.refused.map((entry) => entry.code)).toEqual(['SUPERSEDED']);
    expect(evicted.watermark).toBe(10);
    expect(evicted.latchedKind).not.toBe('path');
  });

  it('answers from the cache only inside the 30-second window', () => {
    const harness = joined('udg-003-cache-ttl');
    advanceWatermark(harness, 'e1', 1, 5);
    // A committed cancel writes an accepted terminal record at generation 6.
    harness.core.ingest('e1', cancel('c-ttl', 1, 6));
    stepOne(harness, 'e1');
    harness.core.ingest('e1', cancel('c-ttl', 1, 6));
    const inside = stepOne(harness, 'e1');
    expect(inside.answered.map((entry) => entry.dedupe)).toEqual(['cache']);

    harness.time.advance(CAPACITIES.terminalCacheTtlMs);
    harness.core.ingest('e1', cancel('c-ttl', 1, 6));
    const expired = stepOne(harness, 'e1');
    // Past the window there is no record: the request is decided on its own terms, and equality with
    // the watermark is never a new discrete intention (T-8).
    expect(expired.answered).toHaveLength(0);
    expect(expired.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);
    expect(expired.watermark).toBe(6);
  });
});
