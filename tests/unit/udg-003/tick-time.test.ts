/**
 * One time value per tick (PA1-C6).
 *
 * The terminal-request cache answers "is this record still alive?", and the answer has to be the one the tick
 * recorded — otherwise a replay restores a journal that describes a decision the live run never made. That
 * only holds if the tick captures a single reading and every cache question uses it: the lookup, the write
 * that follows it, the row that pairs the two, and the sink's expiry pass. The existing time-basis suite
 * moves the clock *between* ticks; this suite moves it *inside* one, which is where a stray second reading
 * used to hide.
 *
 * The TTL itself is unchanged: 30 s, measured from the record's own `storedAtMs`.
 */

import { describe, expect, it } from 'vitest';

import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { roundTripChain, roundTripRows } from '../../support/authority/journal-collector.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import type { ReplayedRun } from '../../support/authority/replay-helpers.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import { cancel } from '../../support/authority/payloads.js';
import { observationRows, resultRows, stepOne } from '../../support/authority/scenarios.js';
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';

const TTL_MS = CAPACITIES.terminalCacheTtlMs;
const START = 1_000_000;

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

const build = (runId: string, startMs = START): Harness => {
  const built = createHarness({ runId, startMs });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

/**
 * The single reading the last completed tick recorded. It lives on the tick's chain record — one per tick,
 * inside the hash — rather than on the per-entity tick rows, which describe movement, not time.
 */
const recordedTickTime = (harness: Harness): number => {
  const chain = harness.chain().at(-1);
  if (chain === undefined) throw new Error('no tick chain record');
  expect(Number.isFinite(chain.atMs)).toBe(true);
  return chain.atMs;
};

/** Replay from persisted bytes (JSON round trip through a collector), as a caller would after a restart. */
const replayPersisted = (harness: Harness): ReplayedRun => {
  const outcome = replayFromInputs({
    prologue: harness.core.prologue(),
    inputs: toReplayInputs(roundTripRows(harness.rows()), roundTripChain(harness.chain())),
    config: harness.config,
    stepper: harness.stepper,
    scheduler: new VirtualScheduler(new VirtualTime(0)),
    runId: nextRun(`${harness.core.runId}-persisted-replay`),
  });
  if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);
  return outcome;
};

const identityRowFor = (harness: Harness, requestId: string) => {
  const row = observationRows(harness.rows())
    .filter((entry) => entry.requestId === requestId)
    .at(-1);
  if (row === undefined) throw new Error(`no observation row for ${requestId}`);
  return row;
};

describe('the tick decides cache questions on one captured time (PA1-C6)', () => {
  it('answers from the cache on the recorded time when the next reading would already be past the TTL', () => {
    const harness = build(nextRun('udg-003-tick-time-cache'));
    harness.core.join('e1', 1, SPAWN);
    harness.step();

    // A request is refused and cached at a known instant.
    const storedAt = START + 20_000;
    harness.core.ingest('e1', cancel('r-boundary', 1, 1), storedAt);
    harness.time.set(storedAt);
    harness.step();
    const record = harness.core.view('e1')?.identities.lookup('e1', 1, 'r-boundary', storedAt);
    expect(record?.identity.storedAtMs).toBe(storedAt);
    const expiresAt = storedAt + TTL_MS;

    // From here the injected clock moves on every reading, so a second reading in one tick is a different
    // instant from the first. Place the tick's reading 10 s before the record dies and the next reading on
    // the death itself.
    harness.time.advancingPerRead(10_000);
    harness.time.set(storedAt + TTL_MS - 5_000);
    harness.core.ingest('e1', cancel('r-boundary', 1, 1), storedAt + TTL_MS - 5_000);
    const outcome = stepOne(harness, 'e1');

    const recorded = recordedTickTime(harness);
    expect(recorded).toBe(storedAt + TTL_MS - 5_000);
    // The scenario really does straddle the boundary within one tick: the recorded reading is inside the
    // window and the very next reading is past it.
    expect(expiresAt - recorded).toBe(5_000);
    expect(expiresAt - (recorded + 10_000)).toBeLessThanOrEqual(0);

    // The decision is the one the recorded time supports.
    expect(outcome.answered.map((entry) => entry.dedupe)).toEqual(['cache']);
    expect(outcome.watermark).toBe(1);
    const row = identityRowFor(harness, 'r-boundary');
    expect(row.disposition).toBe('answered');
    expect(row.atMs).toBe(recorded);
    expect(resultRows(harness.rows()).at(-1)?.dedupe).toBe('cache');

    // The cache agrees with the recorded instant and with no other: the same question one reading later
    // would have been answered "expired".
    const after = harness.core.view('e1');
    expect(after?.identities.lookup('e1', 1, 'r-boundary', recorded)).toBeDefined();
    expect(after?.identities.lookup('e1', 1, 'r-boundary', recorded + 10_000)).toBeUndefined();
  });

  it('writes a new record with the time the tick recorded, not with a separate reading', () => {
    const harness = build(nextRun('udg-003-tick-time-write'));
    harness.core.join('e1', 1, SPAWN);
    harness.step();

    harness.time.advancingPerRead(7_000);
    harness.time.set(START + 100_000);
    harness.core.ingest('e1', cancel('r-write', 1, 1), START + 99_000);
    harness.step();

    const recorded = recordedTickTime(harness);
    expect(recorded).toBe(START + 100_000);
    const record = harness.core.view('e1')?.identities.lookup('e1', 1, 'r-write', recorded);
    expect(record?.identity.storedAtMs).toBe(recorded);
    expect(record?.expiresAtMs).toBe(recorded + TTL_MS);
  });

  it('replays both sides of the boundary from persisted evidence, matching the live disposition and tip', () => {
    const harness = build(nextRun('udg-003-tick-time-replay'));
    harness.core.join('e1', 1, SPAWN);
    harness.step();

    const storedAt = START + 30_000;
    harness.core.ingest('e1', cancel('r-side', 1, 1), storedAt);
    harness.time.set(storedAt);
    harness.step();

    // Two retries of the same request, decided by a clock that advances inside each tick: the first tick's
    // reading lands inside the window, a later tick's lands beyond it.
    harness.time.advancingPerRead(TTL_MS);
    harness.time.set(storedAt + 15_000);
    harness.core.ingest('e1', cancel('r-side', 1, 1), storedAt + 15_000);
    const inside = stepOne(harness, 'e1');
    expect(recordedTickTime(harness)).toBe(storedAt + 15_000);
    expect(inside.answered.map((entry) => entry.dedupe)).toEqual(['cache']);

    harness.core.ingest('e1', cancel('r-side', 1, 1), storedAt + TTL_MS + 15_000);
    const outside = stepOne(harness, 'e1');
    expect(recordedTickTime(harness)).toBe(storedAt + 15_000 + TTL_MS);
    expect(outside.answered).toHaveLength(0);

    const insideRow = observationRows(harness.rows()).filter((entry) => entry.requestId === 'r-side').at(-2);
    const outsideRow = identityRowFor(harness, 'r-side');
    expect(insideRow?.disposition).toBe('answered');
    expect(outsideRow.disposition).toBe('refused:generation');
    expect(outsideRow.reason).toBe('INVALID_GENERATION');

    // Persisted replay reproduces both dispositions and reaches the same chain tip. It can only do that if
    // the recorded readings are the ones that decided them.
    const replay = replayPersisted(harness);
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    const replayedRows = observationRows(replay.rows).filter((entry) => entry.requestId === 'r-side');
    const replayedSides = replayedRows.slice(-2).map((entry) => `${entry.disposition}/${entry.reason ?? ''}`);
    expect(replayedSides).toEqual([
      `${String(insideRow?.disposition)}/`,
      `${outsideRow.disposition}/${String(outsideRow.reason)}`,
    ]);
    // And the replay did not invent its own zero-origin clock.
    expect(replay.time.nowMs()).toBeGreaterThanOrEqual(storedAt);

    // The same inputs, projected through the shared helper, agree with the direct call.
    const viaHelper = harness.replay(nextRun(`${harness.core.runId}-helper-replay`));
    expect(viaHelper.ok === true ? viaHelper.core.chainTip : viaHelper.reason).toBe(harness.core.chainTip);
    expect(toReplayInputs(harness.rows(), harness.chain()).observations.length).toBe(
      toReplayInputs(replay.rows, replay.chain).observations.length,
    );
  });

  it('refuses to restore a recorded clock that runs backwards', () => {
    const harness = build(nextRun('udg-003-tick-time-backwards'));
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    harness.time.set(START - 1);
    harness.step();

    const replay = harness.replay(nextRun(`${harness.core.runId}-backwards-replay`));
    expect(replay.ok).toBe(false);
    if (replay.ok === false) expect(replay.reason).toBe('recorded-time-not-monotonic');
  });
});
