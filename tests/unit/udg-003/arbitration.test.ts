/**
 * Deterministic arbitration and the P03 §5 traces (PA1-4; AC-10, AC-12).
 *
 * Every scenario here asserts the *rule outcome* — watermark, latch, drive, mode — and separately asserts
 * that AC-17 reconciles, because a scenario whose dispositions do not add up has not been demonstrated
 * to have been decided at all.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import { cancel, frame, keepalive } from '../../support/authority/payloads.js';
import {
  advanceWatermark,
  intentionRows,
  metadataTrajectory,
  resultRows,
  stepOne,
} from '../../support/authority/scenarios.js';

const build = (runId: string) => {
  const built = createHarness({ runId });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

/** A client that has been sending ordinary direct input up to `generation`. */
const latchedDirectAt = (runId: string, generation: number) => {
  const harness = build(runId);
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  advanceWatermark(harness, 'e1', 1, generation);
  return harness;
};

/** AC-8: nothing in UDG-003 may report a route revision, so every terminal result must say `null`. */
const noRouteRevision = (harness: ReturnType<typeof build>): boolean =>
  resultRows(harness.rows()).every((row) => row.routeRevision === null);

const snapshot = (harness: ReturnType<typeof build>) => {
  const view = harness.core.view('e1');
  if (view === undefined) throw new Error('entity missing');
  return {
    watermark: view.watermark,
    latchedKind: view.latchedKind,
    held: view.heldDirectGeneration,
    continuous: view.continuous.map((arrival) => arrival.ordinal),
    discrete: view.discrete.map((arrival) => arrival.ordinal),
    rows: harness.rows().length,
    streamedRows: harness.core.retention().streamedRows,
  };
};

describe('arbitration order (P03 §3 A, AC-10)', () => {
  it('T-1: a later-arriving cancel cannot preempt an already-eligible direct intention', () => {
    const harness = latchedDirectAt('udg-003-t1', 19);
    expect(harness.core.view('e1')?.watermark).toBe(19);
    expect(harness.core.view('e1')?.latchedKind).toBe('direct');
    expect(harness.core.view('e1')?.heldDirectGeneration).toBe(19);

    harness.core.ingest('e1', frame(1, 20, 0, 1));
    harness.core.ingest('e1', cancel('c1', 1, 20));

    const outcome = stepOne(harness, 'e1');
    expect(outcome.watermark).toBe(20);
    expect(outcome.latchedKind).toBe('direct');
    expect(outcome.held).toBe(20);
    expect(outcome.drive).toEqual({ moveX: 0, moveZ: 1 });
    expect(outcome.refused.map((entry) => `${entry.code}:${entry.disposition}`)).toEqual([
      'INVALID_GENERATION:refused:generation',
    ]);
    expect(outcome.answered).toHaveLength(0);
    expect(noRouteRevision(harness)).toBe(true);
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });

  it('T-2: the same scenario with the arrivals reversed produces the same rule outcome', () => {
    const forward = latchedDirectAt('udg-003-t2-forward', 19);
    forward.core.ingest('e1', frame(1, 20, 0, 1));
    forward.core.ingest('e1', cancel('c1', 1, 20));
    const forwardOutcome = stepOne(forward, 'e1');

    const reversed = latchedDirectAt('udg-003-t2-reversed', 19);
    reversed.core.ingest('e1', cancel('c1', 1, 20));
    reversed.core.ingest('e1', frame(1, 20, 0, 1));
    const reversedOutcome = stepOne(reversed, 'e1');

    expect(reversedOutcome.watermark).toBe(forwardOutcome.watermark);
    expect(reversedOutcome.latchedKind).toBe(forwardOutcome.latchedKind);
    expect(reversedOutcome.held).toBe(forwardOutcome.held);
    expect(reversedOutcome.drive).toEqual(forwardOutcome.drive);
    // What differs is only the arrival bookkeeping, which is what "deterministic" has to mean here.
    const forwardCandidate = intentionRows(forward.rows()).at(-1);
    const reversedCandidate = intentionRows(reversed.rows()).at(-1);
    expect(forwardCandidate?.winner?.ordinal).not.toBe(reversedCandidate?.winner?.ordinal);
    expect(forwardCandidate?.winner?.kind).toBe('direct');
    expect(reversedCandidate?.winner?.kind).toBe('direct');
  });

  it('T-3: the higher generation wins and the older held sample never moves the entity', () => {
    const harness = latchedDirectAt('udg-003-t3', 24);
    // A held sample at the latched generation, a keepalive beside it, and a cancel one generation higher.
    const parked = harness.core.view('e1')?.state.locomotion.kinematic.position;
    if (parked === undefined) throw new Error('entity missing');
    harness.core.ingest('e1', frame(1, 24, 1, 0));
    harness.core.ingest('e1', keepalive(1, 24));
    harness.core.ingest('e1', cancel('c9', 1, 25));
    harness.core.ingest('e1', frame(1, 24, 1, 0));

    const before = harness.stepper.calls.length;
    const outcome = stepOne(harness, 'e1');

    expect(outcome.watermark).toBe(25);
    expect(outcome.latchedKind).toBe('cancel');
    expect(outcome.held).toBeNull();
    expect(outcome.drive).toBe('NONE');
    expect(outcome.mode).toBe('idle');
    // Exactly one movement step: the higher generation won once and the losers were refused, not replayed.
    expect(harness.stepper.calls.length - before).toBe(1);
    // The selected frame lost arbitration and the two frames still queued behind it were purged as
    // inadmissible once generation 25 committed. Purged is refused-not-consumed, so it is counted
    // separately from the arbitration loser and never as a consumption.
    expect(outcome.purged).toHaveLength(2);
    expect(outcome.purged.map((entry) => entry.code)).toEqual(['SUPERSEDED', 'SUPERSEDED']);
    expect(outcome.refused.map((entry) => `${entry.code}:${entry.disposition}`)).toEqual([
      'SUPERSEDED:refused:superseded',
    ]);
    expect(outcome.consumed).not.toBeNull();
    expect(outcome.answered).toHaveLength(0);
    expect(noRouteRevision(harness)).toBe(true);
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
    // The position is exactly where generation 24 left it: the refused and purged samples displaced
    // nothing. Compared against the recorded position rather than an arithmetic product, so the
    // assertion is about "no further movement" and not about float accumulation order.
    expect(harness.core.view('e1')?.state.locomotion.kinematic.position).toEqual(parked);
  });

  it('orders by kind precedence before arrival order within one generation', () => {
    const harness = latchedDirectAt('udg-003-kind-precedence', 5);
    // Three candidates at generation 6: a direct frame arrives first, then a cancel.
    harness.core.ingest('e1', frame(1, 6, 1, 0));
    harness.core.ingest('e1', cancel('c1', 1, 6));
    const outcome = stepOne(harness, 'e1');
    // Equal generation, so the direct intention wins regardless of arrival order (P03 §3 A).
    expect(outcome.latchedKind).toBe('direct');
    expect(outcome.drive).toEqual({ moveX: 1, moveZ: 0 });
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);

    // And with the latch cleared, the same cancel at the same generation as a fresh direct loses again.
    const other = latchedDirectAt('udg-003-kind-precedence-2', 5);
    other.core.ingest('e1', cancel('c2', 1, 6));
    other.core.ingest('e1', frame(1, 6, 0, 1));
    expect(stepOne(other, 'e1').drive).toEqual({ moveX: 0, moveZ: 1 });
  });

  it('refuses an equal-generation loser with INVALID_GENERATION and a lower-generation loser with SUPERSEDED', () => {
    const equal = latchedDirectAt('udg-003-loser-equal', 8);
    equal.core.ingest('e1', cancel('c-equal', 1, 9));
    equal.core.ingest('e1', frame(1, 9, 1, 0));
    const equalOutcome = stepOne(equal, 'e1');
    expect(equalOutcome.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);

    const lower = latchedDirectAt('udg-003-loser-lower', 8);
    lower.core.ingest('e1', frame(1, 9, 1, 0));
    lower.core.ingest('e1', cancel('c-higher', 1, 10));
    const lowerOutcome = stepOne(lower, 'e1');
    expect(lowerOutcome.refused.map((entry) => entry.code)).toEqual(['SUPERSEDED']);
    expect(lowerOutcome.watermark).toBe(10);
  });

  it('never constructs a path candidate, whatever the queue holds', () => {
    const harness = latchedDirectAt('udg-003-no-path-candidate', 3);
    harness.core.ingest('e1', {
      requestId: 'r1',
      sessionEpoch: 1,
      generation: 4,
      x: 1,
      y: 1,
      z: 1,
    });
    harness.core.ingest('e1', frame(1, 4, 1, 0));
    const outcome = stepOne(harness, 'e1');
    const kinds = intentionRows(harness.rows()).map((row) => row.winner?.kind ?? 'none');
    expect(kinds).not.toContain('path');
    expect(outcome.latchedKind).toBe('direct');
    expect(noRouteRevision(harness)).toBe(true);
  });

  it('asks the same question twice and gets the same answer, having changed nothing (P03-b)', () => {
    const harness = latchedDirectAt('udg-003-arbitration-repeat', 2);
    harness.core.ingest('e1', frame(1, 3, 1, 0));
    harness.core.ingest('e1', cancel('c1', 1, 3));
    const lastOrdinal = harness.rows().length; // the cutoff only has to cover what is queued
    const cutoff = { tick: 99, ordinal: Number.MAX_SAFE_INTEGER };
    expect(lastOrdinal).toBeGreaterThan(0);
    const first = harness.core.askStagesQSA('e1', cutoff, harness.time.nowMs());
    const afterFirst = snapshot(harness);
    const second = harness.core.askStagesQSA('e1', cutoff, harness.time.nowMs());
    const afterSecond = snapshot(harness);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.arbitration).toEqual(first?.arbitration);
    expect(first?.candidates.map((candidate) => `${candidate.kind}:${candidate.generation}`)).toEqual([
      'direct:3',
      'cancel:3',
    ]);
    // Asking is not doing: the queues, watermark, latch, journal and retained state are exactly as they
    // were after the first ask - which is only a real assertion because each side is read twice, once per ask.
    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.rows).toBe(afterFirst.rows);
    expect(afterSecond.streamedRows).toBe(afterFirst.streamedRows);
  });
});

describe('metadata trajectory across a scenario (AC-12)', () => {
  it('records one transition per committed intention and nothing else', () => {
    const harness = latchedDirectAt('udg-003-metadata-trajectory', 3);
    const before = harness.rows().length;
    harness.core.ingest('e1', keepalive(1, 3));
    stepOne(harness, 'e1');
    const trajectory = metadataTrajectory(harness.rows().slice(before));
    expect(trajectory).toEqual([{ watermark: 3, latchedKind: 'direct', held: 3 }]);
  });
});
