/**
 * The replayed time basis (reviewer correction 2).
 *
 * The terminal-request cache expires after 30 s of the injected `TimeSource`, so whether an identical retry
 * is answered from the cache or decided afresh is a fact about the **clock**, not about the message. A replay
 * that started its own clock at zero would move every retry back inside the window and answer a request the
 * original had refused - a replay that lies about nothing except the one input that mattered.
 *
 * The journal therefore records the readings each decision was made under (`observation.atMs`,
 * `event.atMs`, the tick chain's `atMs`) and `replayRun` restores them. These tests put a retry just before,
 * exactly at and just after the boundary, in three separate runs, and require each run's replay to reproduce
 * **its own** side of the boundary - including from serialised evidence.
 */

import { describe, expect, it } from 'vitest';

import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame, keepalive } from '../../support/authority/payloads.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import { roundTripChain, roundTripRows } from '../../support/authority/journal-collector.js';
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import type { JournalRow, ObservationRow, ResultRow, StateRow } from '../../../apps/server/src/authority/types.js';

const TTL_MS = CAPACITIES.terminalCacheTtlMs;
const FIRST_REQUEST_AT_MS = 1_000;

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

/**
 * One accepted request, then the identical retry `retryDelayMs` later.
 *
 * "Identical" means the same `requestId`, epoch, generation and payload - the only variable is the clock.
 */
const retryRun = (label: string, retryDelayMs: number, startMs = 0): Harness => {
  const built = createHarness({ runId: nextRun(label), startMs });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  const harness = built;
  harness.core.join('e1', 1, SPAWN);
  harness.step();

  harness.time.set(startMs + FIRST_REQUEST_AT_MS);
  harness.core.ingest('e1', cancel('r-ttl', 1, 1));
  harness.step();

  harness.time.set(startMs + FIRST_REQUEST_AT_MS + retryDelayMs);
  harness.core.ingest('e1', cancel('r-ttl', 1, 1));
  harness.step();
  return harness;
};

/** How the retry was decided: the cache record it answered from, or the code that refused it. */
interface RetryOutcome {
  readonly disposition: string;
  readonly reason: string;
  readonly dedupe: string;
  readonly accepted: boolean;
  readonly atMs: number;
}

const retryOutcomeIn = (rows: readonly JournalRow[]): RetryOutcome => {
  const results = rows.filter((row): row is ResultRow => row.type === 'result' && row.requestId === 'r-ttl');
  const last = results.at(-1);
  const observations = rows.filter(
    (row): row is ObservationRow => row.type === 'observation' && row.requestId === 'r-ttl',
  );
  const lastRow = observations.at(-1);
  if (last === undefined || lastRow === undefined) {
    throw new Error('the retry produced no terminal record');
  }
  return {
    disposition: lastRow.disposition,
    reason: lastRow.reason ?? '',
    dedupe: last.dedupe,
    accepted: last.accepted,
    atMs: lastRow.atMs,
  };
};

/** The same reading, taken from a harness rather than from a replay's collected rows. */
const retryOutcome = (harness: Harness): RetryOutcome => retryOutcomeIn(harness.rows());

const replayOf = (harness: Harness, persisted: boolean) => {
  const rows = persisted ? roundTripRows(harness.rows()) : harness.rows();
  const chain = persisted ? roundTripChain(harness.chain()) : harness.chain();
  const outcome = replayFromInputs({
    prologue: harness.core.prologue(),
    inputs: toReplayInputs(rows, chain),
    config: harness.config,
    stepper: harness.stepper,
    scheduler: new VirtualScheduler(new VirtualTime(0)),
    runId: nextRun(`${harness.core.runId}-replay`),
  });
  if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);
  return outcome;
};

describe('replay reproduces the approved cache-expiry time basis (correction 2)', () => {
  it('records the clock reading beside every decision it makes', () => {
    const harness = retryRun('udg-003-time-records', 5_000);
    const observations = harness.rows().filter((row) => row.type === 'observation');
    expect(observations.length).toBeGreaterThan(0);
    for (const row of observations) {
      if (row.type !== 'observation') continue;
      expect(Number.isFinite(row.atMs)).toBe(true);
    }
    const events = harness.rows().filter((row) => row.type === 'event');
    expect(events.length).toBeGreaterThan(0);
    for (const row of events) {
      if (row.type !== 'event') continue;
      expect(Number.isFinite(row.atMs)).toBe(true);
    }
    const chain = harness.chain();
    expect(chain.length).toBeGreaterThan(0);
    for (const record of chain) expect(Number.isFinite(record.atMs)).toBe(true);
    // The recorded readings move with the clock and never backwards: the basis is a history, not a constant.
    const atMs = chain.map((record) => record.atMs);
    expect([...atMs].sort((a, b) => a - b)).toEqual(atMs);
    expect(new Set(atMs).size).toBeGreaterThan(1);
    expect(harness.core.prologue().timeBasis).toBe('recorded-clock-readings');
  });

  it('answers inside the window, decides afresh at and after it, and replays each side as itself', () => {
    const inside = retryRun('udg-003-time-inside', TTL_MS - 1);
    const at = retryRun('udg-003-time-at', TTL_MS);
    const after = retryRun('udg-003-time-after', TTL_MS + 1);

    const insideOutcome = retryOutcome(inside);
    const atOutcome = retryOutcome(at);
    const afterOutcome = retryOutcome(after);

    // The boundary is real, and it is the clock that crosses it: same message, different decision.
    expect(insideOutcome.dedupe).toBe('cache');
    expect(insideOutcome.disposition).toBe('answered');
    expect(atOutcome.dedupe).toBe('none');
    expect(atOutcome.disposition).toBe('refused:generation');
    expect(atOutcome.reason).toBe('INVALID_GENERATION');
    expect(afterOutcome.disposition).toBe(atOutcome.disposition);
    expect(insideOutcome.atMs).toBe(FIRST_REQUEST_AT_MS + TTL_MS - 1);
    expect(afterOutcome.atMs).toBe(FIRST_REQUEST_AT_MS + TTL_MS + 1);

    // Each run's replay reproduces its own side. A replay that invented its own clock could only ever
    // produce the first row, which is exactly how the old behaviour stayed invisible.
    for (const [harness, expected] of [
      [inside, insideOutcome],
      [at, atOutcome],
      [after, afterOutcome],
    ] as const) {
      for (const persisted of [false, true]) {
        const outcome = replayOf(harness, persisted);
        const replayed = retryOutcomeIn(outcome.rows);
        expect(replayed.disposition, `persisted=${String(persisted)}`).toBe(expected.disposition);
        expect(replayed.reason).toBe(expected.reason);
        expect(replayed.dedupe).toBe(expected.dedupe);
        expect(replayed.accepted).toBe(expected.accepted);
        expect(replayed.atMs).toBe(expected.atMs);
        // The replay restored readings rather than guessing them, and none of them ran backwards.
        expect(outcome.time.restoredReadings).toBeGreaterThan(0);
        expect(outcome.time.refusedRestorations).toBe(0);
        expect(outcome.rows.length).toBe(harness.rows().length);
        expect(outcome.chain.at(-1)?.hash).toBe(harness.chain().at(-1)?.hash);
      }
    }
  });

  it('carries a non-zero clock origin through the prologue and the replay', () => {
    const origin = 5_000_000;
    const harness = retryRun('udg-003-time-origin', TTL_MS - 1, origin);
    const prologue = harness.core.prologue();
    expect(prologue.timeOriginMs).toBe(origin);
    expect(retryOutcome(harness).dedupe).toBe('cache');

    const outcome = replayOf(harness, false);
    expect(outcome.time.originMs).toBe(origin);
    expect(retryOutcomeIn(outcome.rows).dedupe).toBe('cache');
  });

  it('refuses a journal whose recorded time basis runs backwards', () => {
    const harness = retryRun('udg-003-time-backwards', 5_000);
    const inputs = harness.replayInputs();
    // The shape of a corrupted artefact: an arrival stamped before the tick that already ran.
    const tampered = {
      ...inputs,
      observations: inputs.observations.map((entry, index) =>
        index === inputs.observations.length - 1 ? { ...entry, atMs: 0 } : entry,
      ),
    };
    const outcome = replayFromInputs({
      prologue: harness.core.prologue(),
      inputs: tampered,
      config: harness.config,
      stepper: harness.stepper,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      runId: nextRun('udg-003-time-backwards-replay'),
    });
    // The recorded reading was refused rather than obeyed, and the run is reported as not reproducible
    // instead of silently replaying in a different time order.
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toBe('recorded-time-not-monotonic');
    }
  });

  it('keeps enough of a malformed message to refuse it again after a round trip', () => {
    const built = createHarness({ runId: nextRun('udg-003-time-malformed'), startMs: 12_345 });
    if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
    const harness = built;
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    harness.time.set(222_222);
    const accepted = harness.core.ingest('e1', frame(1, 1, 1, 0));
    harness.step();

    const malformed = harness.core.ingest('e1', {
      sessionEpoch: 1,
      generation: 2,
      directIntent: true,
      // Three kinds of unrepresentable value: a non-finite number, an object and a bigint-shaped string.
      moveX: Number.NaN,
      moveZ: { nested: [1, 2] },
      measuredAtMs: 'not-a-number',
    });
    harness.step();
    expect(malformed.decision.ok).toBe(false);

    const row = harness
      .rows()
      .find((entry) => entry.type === 'observation' && entry.arrivalOrdinal === malformed.arrival.ordinal);
    if (row === undefined || row.type !== 'observation') throw new Error('the malformed arrival was not journalled');
    expect(row.disposition).toBe('refused:structural');
    expect(row.reason).toBe('INVALID_PAYLOAD');
    expect(row.malformed).toEqual(['moveX', 'moveZ']);
    expect(row.atMs).toBe(222_222);
    // The record names what was wrong, not merely that something was.
    const moveX = row.raw['moveX'];
    const moveZ = row.raw['moveZ'];
    expect(moveX?.kind).toBe('invalid');
    expect(moveZ?.kind).toBe('invalid');
    if (moveX?.kind !== 'invalid' || moveZ?.kind !== 'invalid') throw new Error('the fields were not journalled');
    expect(moveX.type).toBe('non-finite NaN');
    expect(moveZ.type).toBe('object');
    expect(row.raw['measuredAtMs']).toEqual({ kind: 'value', value: 'not-a-number' });

    const outcome = replayOf(harness, true);
    const replayed = outcome.rows.find(
      (entry) => entry.type === 'observation' && entry.arrivalOrdinal === malformed.arrival.ordinal,
    );
    if (replayed === undefined || replayed.type !== 'observation') throw new Error('replay lost the malformed arrival');
    expect(replayed.disposition).toBe('refused:structural');
    expect(replayed.reason).toBe('INVALID_PAYLOAD');
    // The malformed field list survives the artefact unchanged, so the refusal is reproducible from it.
    expect(replayed.malformed).toEqual(row.malformed);
    expect(replayed.atMs).toBe(row.atMs);
    expect(replayed.raw).toEqual(row.raw);
    // The accepted frame before it is unaffected, and the canonical state digests still agree.
    expect(accepted.decision.ok).toBe(true);
    const states = (rows: readonly { type: string }[]): readonly StateRow[] =>
      rows.filter((entry): entry is StateRow => entry.type === 'state');
    expect(states(outcome.rows).length).toBe(states(harness.rows()).length);
    expect(states(outcome.rows).at(-1)?.stateHash).toBe(states(harness.rows()).at(-1)?.stateHash);
  });

  it('keeps a keepalive neutral at every point on the time basis, live and replayed', () => {
    const built = createHarness({ runId: nextRun('udg-003-time-keepalive'), startMs: 777 });
    if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
    const harness = built;
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    harness.core.ingest('e1', frame(1, 1, 1, 0));
    harness.step();
    harness.time.set(999_999);
    harness.core.ingest('e1', keepalive(1, 1));
    const before = harness.core.view('e1');
    harness.step();
    const after = harness.core.view('e1');
    expect(after?.watermark).toBe(before?.watermark);
    expect(after?.latchedKind).toBe(before?.latchedKind);

    const outcome = replayOf(harness, true);
    expect(outcome.rows.length).toBe(harness.rows().length);
    expect(outcome.chain.at(-1)?.hash).toBe(harness.chain().at(-1)?.hash);
    expect(outcome.core.view('e1')?.watermark).toBe(after?.watermark);
  });
});
