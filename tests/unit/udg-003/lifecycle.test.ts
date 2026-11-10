/**
 * Lifecycle ordering inside the frozen set (PA1-12; P03-c stage L, AC-3a, AC-5, O09).
 *
 * Join, leave, expiry and epoch change are applied in stage L, in arrival order, inside the cutoff. The
 * consequences that matter are that a departure drops what was queued, that a departed entity is not
 * stepped, and that an epoch change accepts nothing from the epoch it replaced.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame } from '../../support/authority/payloads.js';
import { advanceWatermark, eventRows, observationRows, stateRows, stepOne } from '../../support/authority/scenarios.js';

let runCounter = 0;
const build = (runId: string): Harness => {
  runCounter += 1;
  const built = createHarness({ runId: `${runId}-${String(runCounter)}` });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string, entityId = 'e1', epoch = 1): Harness => {
  const harness = build(runId);
  harness.core.join(entityId, epoch, SPAWN);
  harness.step();
  return harness;
};

describe('join (P03-c L)', () => {
  it('is applied in the tick whose cutoff covers it, and nothing is consumed before it', () => {
    const harness = build('udg-003-join');
    // Nothing exists yet, so a frame has nowhere to go: it is refused at ingest and queues nothing.
    const early = harness.core.ingest('e1', frame(1, 1, 1, 0));
    expect(early.decision.ok).toBe(false);
    if (early.decision.ok === false) {
      expect(early.decision.code).toBe('EPOCH_MISMATCH');
      expect(early.decision.disposition).toBe('refused:epoch');
    }
    expect(harness.core.view('e1')).toBeUndefined();

    const join = harness.core.join('e1', 1, SPAWN);
    const outcome = harness.step();
    expect(harness.core.view('e1')?.lifecycle).toBe('active');
    expect(harness.core.view('e1')?.epoch).toBe(1);
    expect(harness.core.view('e1')?.watermark).toBe(0);
    expect(outcome.entities[0]?.events).toEqual(['join']);
    const row = eventRows(harness.rows()).find((entry) => entry.kind === 'join');
    expect(row?.arrivalOrdinal).toBe(join.arrival.ordinal);
    expect(row?.eligibleTick).toBe(outcome.tick);
    expect(row?.epochBefore).toBeNull();
    expect(row?.epochAfter).toBe(1);
    // The spawn position is server-assigned, and the entity is stepped from the tick it exists.
    expect(harness.core.view('e1')?.state.locomotion.kinematic.position).toEqual(SPAWN);
    expect(outcome.entities[0]?.stepped).toBe(true);
  });

  it('defers a control that arrives after the cutoff to the next tick', () => {
    const harness = joined('udg-003-join-defer');
    const first = harness.step();
    const leave = harness.core.leave('e1');
    // The leave arrived after `first` captured its cutoff, so it cannot have been applied by it.
    expect(leave.arrival.ordinal).toBeGreaterThan(first.cutoff.ordinal);
    expect(first.entities[0]?.events).not.toContain('leave');

    const second = harness.step();
    expect(second.entities[0]?.events).toEqual(['leave']);
    const row = eventRows(harness.rows()).find((entry) => entry.kind === 'leave');
    expect(row?.eligibleTick).toBe(second.tick);
  });
});

describe('leave and expiry (AC-3a, P03-c L)', () => {
  it('drops the queued backlog as dropped-not-consumed and stops stepping the entity', () => {
    const harness = joined('udg-003-leave-drops');
    advanceWatermark(harness, 'e1', 1, 2);
    const parked = harness.core.view('e1')?.state.locomotion.kinematic.position;
    // Queue work that will never be decided.
    harness.core.ingest('e1', frame(1, 3, 1, 0));
    harness.core.ingest('e1', frame(1, 4, 1, 0));
    harness.core.ingest('e1', cancel('c-pending', 1, 5));

    const calls = harness.stepper.calls.length;
    harness.core.leave('e1');
    const outcome = harness.step();

    expect(outcome.entities[0]?.lifecycle).toBe('idle');
    expect(outcome.entities[0]?.dropped).toHaveLength(3);
    const dropped = observationRows(harness.rows()).filter((row) => row.disposition === 'dropped:lifecycle');
    expect(dropped).toHaveLength(3);
    // Not stepped: a disconnected entity receives no movement step at all.
    expect(outcome.entities[0]?.stepped).toBe(false);
    expect(harness.stepper.calls.length).toBe(calls);
    // The final canonical state is journalled rather than reset or invented - and the journal, not the
    // core, is where it lives. Reviewer correction 3: a departed entity's bookkeeping is released once its
    // evidence exists, so `view` reports nothing while the state row still names the parked position.
    const lastState = stateRows(harness.rows()).filter((row) => row.entityId === 'e1').at(-1);
    expect(lastState?.state.locomotion.kinematic.position).toEqual(parked);
    expect(lastState?.state.connected).toBe(false);
    expect(harness.core.view('e1')).toBeUndefined();
    expect(harness.core.retention().entities).toBe(0);
    // Releasing the bookkeeping must not lose the arithmetic: the entity is reported as no longer known,
    // and the run's totals are in `stats()`, not in a per-entity map the core would have to keep forever.
    const released = harness.core.reconciliation('e1');
    expect(released.known).toBe(false);
    expect(released.balanced).toBe(true);
    expect(harness.core.stats().releasedEntities).toBe(1);
  });

  it('accepts no movement source after a leave', () => {
    const harness = joined('udg-003-leave-refuses');
    harness.core.leave('e1');
    const calls = harness.stepper.calls.length;
    harness.step();
    for (const payload of [frame(1, 3, 1, 0), cancel('c1', 1, 3)]) {
      const outcome = harness.core.ingest('e1', payload);
      expect(outcome.decision.ok).toBe(false);
      if (outcome.decision.ok === false) {
        expect(outcome.decision.code).toBe('EPOCH_MISMATCH');
        expect(outcome.decision.disposition).toBe('refused:epoch');
      }
    }
    const after = harness.step();
    // The entity is gone from the core, so the tick reports no entity work at all: no consumption, no step.
    expect(after.entities).toEqual([]);
    const refusedAfterLeave = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:epoch');
    expect(refusedAfterLeave).toHaveLength(2);
    expect(harness.stepper.calls.length).toBe(calls);
  });

  it('expiry departs the entity and keeps its final state for the journal', () => {
    const harness = joined('udg-003-expiry');
    advanceWatermark(harness, 'e1', 1, 3);
    const parked = harness.core.view('e1')?.state.locomotion.kinematic.position;
    harness.core.expire('e1');
    const outcome = harness.step();
    expect(outcome.entities[0]?.lifecycle).toBe('departed');
    expect(outcome.entities[0]?.events).toEqual(['expiry']);
    expect(outcome.entities[0]?.stepped).toBe(false);
    const lastState = stateRows(harness.rows()).filter((row) => row.entityId === 'e1').at(-1);
    expect(lastState?.state.locomotion.kinematic.position).toEqual(parked);
    expect(lastState?.state.connected).toBe(false);
    expect(harness.core.view('e1')).toBeUndefined();
    // A departed entity is never stepped again, whatever arrives afterwards.
    const calls = harness.stepper.calls.length;
    const refusal = harness.core.ingest('e1', frame(1, 9, 1, 0));
    expect(refusal.decision.ok).toBe(false);
    harness.step();
    expect(harness.stepper.calls.length).toBe(calls);
  });

  it('rejoining stays one entity and stays idle until the rejoin tick', () => {
    const harness = joined('udg-003-rejoin');
    advanceWatermark(harness, 'e1', 1, 2);
    harness.core.leave('e1');
    const left = harness.step();
    expect(left.entities[0]?.lifecycle).toBe('idle');

    harness.core.join('e1', 2, SPAWN);
    // The rejoin is a later arrival, so the next tick applies it — and only that tick.
    const rejoined = harness.step();
    expect(rejoined.entities[0]?.events).toEqual(['join']);
    expect(harness.core.entityIds).toEqual(['e1']);
    expect(harness.core.view('e1')?.lifecycle).toBe('active');
    // A new epoch restarts the generation sequence: the old watermark does not carry over.
    expect(harness.core.view('e1')?.epoch).toBe(2);
    expect(harness.core.view('e1')?.watermark).toBe(0);
    expect(harness.core.view('e1')?.latchedKind).toBe('none');
    expect(harness.core.view('e1')?.heldDirectGeneration).toBeNull();
    // And it is steppable again from the rejoin tick onwards.
    const calls = harness.stepper.calls.length;
    harness.core.ingest('e1', frame(2, 1, 1, 0));
    const driven = stepOne(harness, 'e1');
    expect(driven.watermark).toBe(1);
    expect(driven.drive).toEqual({ moveX: 1, moveZ: 0 });
    expect(harness.stepper.calls.length - calls).toBe(1);
  });
});

describe('epoch renewal refuses the replaced epoch entirely (O09, AC-5)', () => {
  it('refuses every old-epoch arrival, resets the sequence and admits the new epoch', () => {
    const harness = joined('udg-003-epoch-change');
    advanceWatermark(harness, 'e1', 1, 7);
    // Backlog from the epoch that is about to be replaced.
    harness.core.ingest('e1', frame(1, 8, 1, 0));
    harness.core.ingest('e1', frame(1, 9, 0, 1));
    harness.core.ingest('e1', cancel('c-old', 1, 10));

    harness.core.epochChange('e1', 8);
    const outcome = harness.step();

    const epochRefusals = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:epoch');
    expect(epochRefusals).toHaveLength(3);
    for (const row of epochRefusals) expect(row.reason).toBe('EPOCH_MISMATCH');
    // Not one old-epoch arrival was consumed, and none advanced anything.
    const consumed = observationRows(harness.rows()).filter(
      (row) => row.disposition === 'consumed' && row.epoch === 1 && row.kind !== 'control',
    );
    const consumedAfterRenewal = consumed.filter((row) => row.eligibleTick === outcome.tick);
    expect(consumedAfterRenewal).toHaveLength(0);

    expect(outcome.entities[0]?.watermark).toBe(0);
    expect(outcome.entities[0]?.latchedKind).toBe('none');
    expect(outcome.entities[0]?.held).toBeNull();
    expect(harness.core.view('e1')?.epoch).toBe(8);

    // The new epoch starts from zero and is admitted normally.
    harness.core.ingest('e1', frame(8, 1, 1, 0));
    const next = stepOne(harness, 'e1');
    expect(next.watermark).toBe(1);
    expect(next.drive).toEqual({ moveX: 1, moveZ: 0 });
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });
});
