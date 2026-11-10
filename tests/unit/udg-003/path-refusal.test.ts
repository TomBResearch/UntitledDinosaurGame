/**
 * Navigation refusal and the vacuous route stages (PA1-11; AC-8).
 *
 * UDG-003 has no navigation, and the honest expression of that is not a missing stage but a stage that
 * refuses: `UDG_MOVE_TO` reaches screening and is refused there, so no route, revision or status can
 * exist to leak into a journal. These tests assert the refusal *and* the absence, because "nothing
 * happened" has to be measured rather than claimed by omission.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, TEST_BOUNDS, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame, moveTo } from '../../support/authority/payloads.js';
import {
  advanceWatermark,
  intentionRows,
  observationRows,
  resultRows,
  stepOne,
} from '../../support/authority/scenarios.js';
import type { RouteCompletion } from '../../../apps/server/src/authority/step.js';

const INSIDE = { x: 5, y: 1, z: -5 };
const OUTSIDE = { x: TEST_BOUNDS.x.max + 1, y: 0, z: 0 };

const build = (runId: string, routeCompletions?: () => readonly RouteCompletion[]): Harness => {
  const built = createHarness(routeCompletions === undefined ? { runId } : { runId, routeCompletions });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string): Harness => {
  const harness = build(runId);
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  return harness;
};

/** Ingest one payload and run the tick that screens it. */
const ingestAndStep = (harness: Harness, payload: unknown) => {
  harness.core.ingest('e1', payload);
  return stepOne(harness, 'e1');
};

describe('UDG_MOVE_TO is refused before it can become an intention (AC-8)', () => {
  it('refuses an in-bounds destination with NAVIGATION_BUSY and creates no route state', () => {
    const harness = joined('udg-003-moveto-refused');
    advanceWatermark(harness, 'e1', 1, 3);
    const before = harness.core.view('e1');
    const calls = harness.stepper.calls.length;

    const outcome = ingestAndStep(harness, moveTo('r1', 1, 4, INSIDE));

    expect(outcome.refused.map((entry) => `${entry.code}:${entry.disposition}:${String(entry.screened)}`)).toEqual([
      'NAVIGATION_BUSY:refused:navigation:true',
    ]);
    expect(outcome.answered).toHaveLength(0);
    expect(outcome.candidates).toHaveLength(0);
    expect(outcome.latchedKind).not.toBe('path');
    expect(outcome.latchedKind).toBe(before?.latchedKind);
    expect(outcome.watermark).toBe(before?.watermark);
    expect(outcome.held).toBe(before?.heldDirectGeneration);
    // One step for the tick, driven by nothing: the refused request moved no entity.
    expect(harness.stepper.calls.length - calls).toBe(1);
    expect(outcome.drive).toBe('NONE');
    expect(outcome.mode).toBe('idle');

    const rows = harness.rows();
    const refusal = observationRows(rows).find((row) => row.requestId === 'r1');
    expect(refusal?.disposition).toBe('refused:navigation');
    expect(refusal?.reason).toBe('NAVIGATION_BUSY');
    expect(refusal?.kind).toBe('moveTo');
    expect(refusal?.screened).toBe(true);
    expect(refusal?.eligibleTick).not.toBeNull();
    // And an unnameable identity records no hash, rather than an invented one.
    const unnamed = observationRows(rows).filter((row) => row.requestId === null);
    for (const row of unnamed) expect(row.payloadHash).toBeNull();

    // P03-g: a discrete observation row carries the request-identity hash, and it is the same identity
    // the terminal result was published under.
    expect(refusal?.payloadHash).not.toBeNull();
    const result = resultRows(rows).find((row) => row.requestId === 'r1');
    expect(result?.payloadHash).toBe(refusal?.payloadHash ?? null);
    expect(result?.accepted).toBe(false);
    expect(result?.reason).toBe('NAVIGATION_BUSY');
    expect(result?.appliedTick).toBeNull();
    expect(result?.routeRevision).toBeNull();
    expect(result?.dedupe).toBe('none');

    // AC-8 in the state itself: there is no route to report.
    expect(harness.core.view('e1')?.state.locomotion.route).toBeNull();
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });

  it('refuses an out-of-bounds destination with OUT_OF_BOUNDS, before navigation is reached', () => {
    const harness = joined('udg-003-moveto-out-of-bounds');
    advanceWatermark(harness, 'e1', 1, 3);
    const outcome = ingestAndStep(harness, moveTo('r-oob', 1, 4, OUTSIDE));
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['OUT_OF_BOUNDS']);
    const result = resultRows(harness.rows()).find((row) => row.requestId === 'r-oob');
    expect(result?.accepted).toBe(false);
    expect(result?.reason).toBe('OUT_OF_BOUNDS');
    expect(result?.routeRevision).toBeNull();
  });

  it('refuses an unnameable request with a journal row and no cache record (P03-d refuse)', () => {
    // A requestId the protocol would not name cannot authorise a dedupe record, so this is the one
    // refusal shape that must *not* write a terminal record.
    const harness = joined('udg-003-moveto-unnameable');
    advanceWatermark(harness, 'e1', 1, 3);
    const depthBefore = harness.core.stats().cacheDepth;
    harness.core.ingest('e1', { requestId: 'r!not-allowed', sessionEpoch: 1, generation: 4, x: 1, y: 1, z: 1 });
    const outcome = stepOne(harness, 'e1');
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['INVALID_PAYLOAD']);
    expect(harness.core.stats().cacheDepth).toBe(depthBefore);
    expect(resultRows(harness.rows()).filter((row) => row.requestId === 'r!not-allowed')).toHaveLength(0);
  });

  it('writes one terminal record for an identified request that failed validation, and replays it', () => {
    // P03-d: "for a discrete request whose requestId parsed, it writes exactly ONE terminal record",
    // so an out-of-bounds retry answers from the cache instead of being decided twice.
    const harness = joined('udg-003-moveto-out-of-bounds-replay');
    advanceWatermark(harness, 'e1', 1, 3);
    ingestAndStep(harness, moveTo('r-oob', 1, 4, OUTSIDE));
    const depth = harness.core.stats().cacheDepth;
    const replay = ingestAndStep(harness, moveTo('r-oob', 1, 4, OUTSIDE));
    expect(replay.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(harness.core.stats().cacheDepth).toBe(depth);
    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'r-oob');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.reason).toBe('OUT_OF_BOUNDS');
    expect(rows[1]?.payloadHash).toBe(rows[0]?.payloadHash);
  });

  it('replays the same refusal from the terminal cache without a second transition', () => {
    const harness = joined('udg-003-moveto-replay');
    advanceWatermark(harness, 'e1', 1, 3);
    ingestAndStep(harness, moveTo('r1', 1, 4, INSIDE));
    const afterFirst = harness.core.view('e1');
    const watermark = afterFirst?.watermark ?? -1;

    const replay = ingestAndStep(harness, moveTo('r1', 1, 4, INSIDE));
    // A matching identity replays the cached terminal; `code` is reserved for a conflict.
    expect(replay.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(replay.answered[0]?.code).toBeNull();
    expect(replay.refused).toHaveLength(0);
    expect(replay.watermark).toBe(watermark);
    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'r1');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.dedupe).toBe('cache');
    expect(rows[1]?.accepted).toBe(false);
    expect(rows[1]?.reason).toBe(rows[0]?.reason);
    expect(rows[1]?.payloadHash).toBe(rows[0]?.payloadHash);
  });

  it('never lets a moveTo become a candidate or a path intention, in any mix', () => {
    const harness = joined('udg-003-moveto-never-candidate');
    advanceWatermark(harness, 'e1', 1, 2);
    harness.core.ingest('e1', moveTo('r-a', 1, 3, INSIDE));
    harness.core.ingest('e1', frame(1, 3, 1, 0));
    harness.core.ingest('e1', cancel('c-1', 1, 4));
    harness.core.ingest('e1', moveTo('r-b', 1, 5, INSIDE));
    stepOne(harness, 'e1');
    harness.core.ingest('e1', moveTo('r-c', 1, 6, OUTSIDE));
    stepOne(harness, 'e1');

    const rows = harness.rows();
    const kinds = intentionRows(rows).map((row) => row.winner?.kind ?? 'none');
    expect(kinds).not.toContain('path');
    expect(kinds).toContain('direct');
    expect(kinds).toContain('cancel');
    const consumedMoveTos = observationRows(rows).filter(
      (row) => row.kind === 'moveTo' && (row.disposition === 'consumed' || row.disposition === 'queued'),
    );
    expect(consumedMoveTos).toHaveLength(0);
    expect(resultRows(rows).every((row) => row.routeRevision === null)).toBe(true);
    expect(harness.core.view('e1')?.state.locomotion.route).toBeNull();
  });
});

describe('UDG_CANCEL_PATH is an ordinary intention (AC-8, AC-12)', () => {
  it('commits, clears the direct latch and leaves the route field alone', () => {
    const harness = joined('udg-003-cancel-commits');
    advanceWatermark(harness, 'e1', 1, 4);
    expect(harness.core.view('e1')?.latchedKind).toBe('direct');

    const outcome = ingestAndStep(harness, cancel('c1', 1, 5));
    expect(outcome.watermark).toBe(5);
    expect(outcome.latchedKind).toBe('cancel');
    expect(outcome.held).toBeNull();
    expect(outcome.drive).toBe('NONE');
    expect(outcome.mode).toBe('idle');
    expect(outcome.candidates.map((candidate) => candidate.kind)).toEqual(['cancel']);

    const row = intentionRows(harness.rows()).at(-1);
    expect(row?.winner).toEqual({ kind: 'cancel', generation: 5, ordinal: row?.winner?.ordinal ?? -1 });
    expect(row?.watermarkAfter).toBe(5);
    expect(row?.latchedKindAfter).toBe('cancel');
    expect(row?.heldAfter).toBeNull();

    const state = harness.core.view('e1')?.state.locomotion;
    expect(state?.route).toBeNull();
    expect(state?.mode).toBe('idle');
    expect(state?.intentGeneration).toBe(5);
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });

  it('is answered from the cache on retry rather than re-run', () => {
    const harness = joined('udg-003-cancel-replay');
    advanceWatermark(harness, 'e1', 1, 4);
    ingestAndStep(harness, cancel('c1', 1, 5));
    const replay = ingestAndStep(harness, cancel('c1', 1, 5));
    expect(replay.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(replay.watermark).toBe(5);
    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'c1');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.accepted).toBe(true);
    // The replay is the *recorded* result, applied tick included: protocol.md 4.3 returns the cached
    // result rather than recomputing one that would claim a second transition.
    expect(rows[1]?.appliedTick).toBe(rows[0]?.appliedTick);
    expect(rows[1]?.dedupe).toBe('cache');
    expect(rows[0]?.appliedTick).not.toBeNull();
  });
});

describe('stage R is real and vacuous in UDG-003 (O12 seam, AC-8)', () => {
  it('reports no completions at all when no source is supplied', () => {
    const harness = joined('udg-003-stage-r-vacuous');
    advanceWatermark(harness, 'e1', 1, 3);
    const outcome = harness.step();
    expect(outcome.routeCompletionsCommitted).toBe(0);
    expect(outcome.routeCompletionsDiscarded).toBe(0);
    expect(harness.core.stats().routeCompletionsCommitted).toBe(0);
    expect(harness.core.stats().routeCompletionsDiscarded).toBe(0);
    expect(harness.core.view('e1')?.state.locomotion.route).toBeNull();
  });

  it('defers a completion that arrives after the cutoff, commits a current one, discards a stale one', () => {
    // The source is driven from a mutable list because a real completion arrives asynchronously; the
    // point under test is the cutoff and currency rules, not the transport that would deliver them.
    let offered: RouteCompletion[] = [];
    const harness = build('udg-003-stage-r-seam', () => offered);
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    advanceWatermark(harness, 'e1', 1, 7);

    // After the current cutoff: neither committed nor discarded, so nothing is asserted about an input
    // the tick was not allowed to see.
    offered = [{ entityId: 'e1', generation: 7, ordinal: Number.MAX_SAFE_INTEGER }];
    const deferred = harness.step();
    expect(deferred.routeCompletionsCommitted).toBe(0);
    expect(deferred.routeCompletionsDiscarded).toBe(0);

    // Current: the completion names the watermark this tick already committed.
    offered = [{ entityId: 'e1', generation: 7, ordinal: 1 }];
    const committed = harness.step();
    expect(committed.routeCompletionsCommitted).toBe(1);
    expect(committed.routeCompletionsDiscarded).toBe(0);

    // Stale: the input decision moved on, so the completion is discarded, not committed late.
    harness.core.ingest('e1', frame(1, 8, 1, 0));
    const advanced = stepOne(harness, 'e1');
    expect(advanced.watermark).toBe(8);
    offered = [{ entityId: 'e1', generation: 7, ordinal: 1 }];
    const stale = harness.step();
    expect(stale.routeCompletionsDiscarded).toBe(1);
    expect(stale.routeCompletionsCommitted).toBe(0);
    // A discarded completion is not an observed arrival, so AC-17 must still balance.
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
    expect(harness.core.view('e1')?.state.locomotion.route).toBeNull();
  });
});
