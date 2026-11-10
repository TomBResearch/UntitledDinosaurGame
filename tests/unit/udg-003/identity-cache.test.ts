/**
 * Request identity: the persistent cache and the frozen-batch registry (PA1-10; P03-e T-4, T-8, AC-19).
 *
 * The properties under test are the ones a dedupe implementation most often gets wrong: a conflict must
 * not overwrite the identity that authorises the dedupe, a duplicate must not cause a second transition,
 * and `REQUEST_ID_CONFLICT` is an *answer* rather than a refusal, so it is counted as one.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame, moveTo } from '../../support/authority/payloads.js';
import { advanceWatermark, observationRows, resultRows, stepOne } from '../../support/authority/scenarios.js';

const DEST = { x: 12, y: 0.9, z: -3 };
const OTHER = { x: 12, y: 0.9, z: 4 };

const build = (): Harness => {
  runCounter += 1;
  const built = createHarness({ runId: `udg-003-identity-${String(runCounter)}` });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  built.core.join('e1', 1, SPAWN);
  built.step();
  advanceWatermark(built, 'e1', 1, 3);
  return built;
};

// A stable per-test run label. A module counter is enough, and it keeps `Date.now` out of the suites,
// which is the same reason the authority itself cannot reach for a clock.
let runCounter = 0;

describe('identical retry inside one frozen batch (P03-e T-4)', () => {
  it('shares one disposition, writes one record and never transitions twice', () => {
    const harness = build();
    const depthBefore = harness.core.stats().cacheDepth;
    const callsBefore = harness.stepper.calls.length;

    harness.core.ingest('e1', moveTo('r9', 1, 4, DEST));
    harness.core.ingest('e1', moveTo('r9', 1, 4, DEST));
    const outcome = stepOne(harness, 'e1');

    // The first is screened and refused; the second hits the batch registry and is answered.
    expect(outcome.refused.map((entry) => entry.code)).toEqual(['NAVIGATION_BUSY']);
    expect(outcome.answered.map((entry) => `${entry.dedupe}:${String(entry.code)}`)).toEqual(['batch:null']);
    expect(outcome.watermark).toBe(3);
    expect(outcome.latchedKind).not.toBe('path');
    // One new cache record for the two arrivals.
    expect(harness.core.stats().cacheDepth).toBe(depthBefore + 1);
    // Exactly one step for the tick: no second transition happened.
    expect(harness.stepper.calls.length - callsBefore).toBe(1);

    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'r9');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.dedupe).toBe('batch');
    expect(rows[1]?.payloadHash).toBe(rows[0]?.payloadHash);
    expect(rows[1]?.reason).toBe(rows[0]?.reason);
    // The shared arrival is disposed once, as `answered`.
    const observations = observationRows(harness.rows()).filter((row) => row.requestId === 'r9');
    expect(observations.map((row) => row.disposition)).toEqual(['refused:navigation', 'answered']);
    expect(harness.core.reconciliation('e1').balanced).toBe(true);
  });
});

describe('same identity, different payload (T-4, T-8)', () => {
  it('answers REQUEST_ID_CONFLICT without overwriting the cached identity, in the same tick', () => {
    const harness = build();
    harness.core.ingest('e1', moveTo('r5', 1, 4, DEST));
    harness.core.ingest('e1', moveTo('r5', 1, 4, OTHER));
    const conflict = stepOne(harness, 'e1');
    expect(conflict.answered.map((entry) => `${entry.dedupe}:${entry.code ?? ''}`)).toEqual([
      'batch:REQUEST_ID_CONFLICT',
    ]);

    const view = harness.core.view('e1');
    const stored = view?.identities.lookup('e1', 1, 'r5');
    const storedHash = stored?.identity.payloadHash ?? null;
    expect(storedHash).not.toBeNull();

    // A later retry of the *original* payload is still answered from the original identity, which
    // proves the conflict did not replace it.
    harness.core.ingest('e1', moveTo('r5', 1, 4, DEST));
    const replay = stepOne(harness, 'e1');
    expect(replay.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(harness.core.view('e1')?.identities.lookup('e1', 1, 'r5')?.identity.payloadHash).toBe(storedHash);

    // And a conflict is counted as an answer, never as a refusal (P03-d `dispositionForCode`).
    const conflicts = observationRows(harness.rows()).filter((row) => row.reason === 'REQUEST_ID_CONFLICT');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.disposition).toBe('answered');
  });

  it('answers REQUEST_ID_CONFLICT from the persistent cache on a later tick too', () => {
    const harness = build();
    harness.core.ingest('e1', moveTo('r6', 1, 4, DEST));
    stepOne(harness, 'e1');
    harness.core.ingest('e1', moveTo('r6', 1, 4, OTHER));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.answered.map((entry) => `${entry.dedupe}:${entry.code ?? ''}`)).toEqual([
      'cache:REQUEST_ID_CONFLICT',
    ]);
    // A conflict publishes the conflict itself, and writes no record.
    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'r6');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.accepted).toBe(false);
    expect(rows[1]?.reason).toBe('REQUEST_ID_CONFLICT');
    expect(rows[1]?.payloadHash).not.toBe(rows[0]?.payloadHash);
  });
});

describe('an arbitration loser is cached as a terminal refusal (T-1, T-8)', () => {
  it('replays the loser code identically instead of re-deciding it', () => {
    const harness = build();
    // A direct frame at generation 4 wins, so the cancel at the same generation loses.
    harness.core.ingest('e1', cancel('c1', 1, 4));
    harness.core.ingest('e1', frame(1, 4, 1, 0));
    const first = stepOne(harness, 'e1');
    expect(first.latchedKind).toBe('direct');
    expect(first.refused.map((entry) => entry.code)).toEqual(['INVALID_GENERATION']);

    harness.core.ingest('e1', cancel('c1', 1, 4));
    const second = stepOne(harness, 'e1');
    // `code` names a conflict; a matching identity replays the recorded terminal, whose reason is the
    // loser code the arbitration gave it.
    expect(second.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    const rows = resultRows(harness.rows()).filter((row) => row.requestId === 'c1');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.accepted).toBe(false);
    expect(rows[1]?.reason).toBe('INVALID_GENERATION');
  });
});

describe('identity is scoped to the epoch (protocol.md 4.3)', () => {
  it('does not answer an old-epoch request identity from the new epoch', () => {
    const harness = build();
    harness.core.ingest('e1', cancel('c-shared', 1, 4));
    stepOne(harness, 'e1');
    expect(harness.core.view('e1')?.identities.lookup('e1', 1, 'c-shared')).toBeDefined();

    harness.core.epochChange('e1', 8);
    stepOne(harness, 'e1');
    expect(harness.core.view('e1')?.epoch).toBe(8);
    expect(harness.core.view('e1')?.watermark).toBe(0);

    // Same requestId, new epoch: no record may answer it. It is decided on its own terms instead.
    harness.core.ingest('e1', cancel('c-shared', 8, 1));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.answered).toHaveLength(0);
    expect(outcome.watermark).toBe(1);
    expect(outcome.latchedKind).toBe('cancel');
    // The old record is still there as an inert diagnostic, never as a reply.
    expect(harness.core.view('e1')?.identities.lookup('e1', 1, 'c-shared')).toBeDefined();
  });
});
