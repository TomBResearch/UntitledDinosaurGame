/**
 * Journal completeness, sanitisation, the tick chain and replay from inputs alone
 * (PA1-14; AC-14, AC-20, AC-3d).
 *
 * The property that matters is not "the hashes match" but "the decisions come from the inputs": a journal
 * with every digest blanked must still replay to the same rows, because a digest is a comparison output
 * and never an input. Every equivalence here is therefore asserted twice, once with digests and once
 * without them.
 */

import { describe, expect, it } from 'vitest';

import { canonicalHash } from '../../../packages/config/dist/index.js';
import { withConfigOverrides } from '../../../packages/config/dist/index.js';
import { SPAWN, TEST_BOUNDS, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { frame, frameWithNonFiniteAxis, keepalive, moveTo, unknownMessage } from '../../support/authority/payloads.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import { cancel } from '../../support/authority/payloads.js';
import { toReplayInputs, withDigestsBlanked } from '../../../apps/server/src/authority/journal.js';
import {
  GENESIS_HASH,
  journalCompletenessIssues,
  sanitisationIssues,
} from '../../../apps/server/src/authority/journal.js';
import {
  firstJournalDifference,
  firstStateDigestDifference,
} from '../../../apps/server/src/authority/replay.js';
import type { JournalRow, ObservationRow } from '../../../apps/server/src/authority/types.js';
import { stateRows } from '../../support/authority/scenarios.js';

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

const build = (runId: string): Harness => {
  const built = createHarness({ runId });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

/**
 * A run that exercises every stage's journal output: input, refusal, keepalive, a committed cancel, a
 * refused request, a control event, and quiet ticks with no input at all.
 */
const scenario = (label: string): Harness => {
  const harness = build(nextRun(label));
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  harness.core.ingest('e1', frame(1, 1, 1, 0));
  harness.step();
  harness.core.ingest('e1', frame(1, 2, 0, 1));
  harness.core.ingest('e1', keepalive(1, 2));
  harness.step();
  harness.core.ingest('e1', moveTo('r-journal', 1, 3, { x: 1, y: 1, z: 1 }));
  harness.core.ingest('e1', cancel('c-journal', 1, 4));
  harness.step();
  harness.core.ingest('e1', frame(1, 5, 1, 1));
  harness.core.ingest('e1', unknownMessage());
  harness.core.ingest('e1', frameWithNonFiniteAxis(1, 6));
  harness.step();
  harness.step();
  harness.core.leave('e1');
  harness.step();
  return harness;
};

describe('journal completeness (AC-14, P03-g)', () => {
  it('carries every required row type for a run with activity', () => {
    const harness = scenario('udg-003-journal-complete');
    // The prologue is the run-level record P03-g puts first: it names every entity's initial canonical
    // state, which is only fully known once the run's joins have happened, so `AuthorityCore` produces it
    // as `prologue()` rather than as tick 0's row. The replayable record is the two together.
    const record: readonly JournalRow[] = [harness.core.prologue(), ...harness.rows()];
    const rows = record;
    const types: readonly string[] = rows.map((row) => row.type);
    for (const required of ['prologue', 'event', 'observation', 'intention', 'result', 'state', 'tick', 'meta']) {
      expect(types, required).toContain(required);
    }
    expect(journalCompletenessIssues(rows)).toEqual([]);
  });

  it('refuses a journal that carries only state digests', () => {
    const harness = scenario('udg-003-journal-state-only');
    const stateOnly = stateRows(harness.rows()).slice(0, 3);
    expect(stateOnly.length).toBeGreaterThan(0);
    const issues = journalCompletenessIssues(stateOnly);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('no input, lifecycle or ordering record');
  });

  it('names an input row for every observed arrival, including malformed ones', () => {
    const harness = scenario('udg-003-journal-malformed');
    const observations = harness.rows().filter((row) => row.type === 'observation');
    const malformed = observations.filter((row) => row.type === 'observation' && row.malformed.length > 0);
    // The same arrival is described twice across two ticks — once as still queued, once as refused — and
    // both rows carry the rendering, because a reader must be able to re-run screening from either tick.
    const ordinals = new Set(malformed.map((row) => (row.type === 'observation' ? row.arrivalOrdinal : -1)));
    expect(ordinals.size).toBe(1);
    expect(malformed.map((row) => (row.type === 'observation' ? row.disposition : ''))).toEqual([
      'queued',
      'refused:structural',
    ]);
    for (const row of malformed) expect(row.type === 'observation' && row.malformed).toContain('moveX');
    const unknown = observations.filter((row) => row.type === 'observation' && row.kind === 'unknownMessage');
    expect(unknown.length).toBe(1);
    expect(unknown[0]?.disposition).toBe('refused:structural');
    // The raw payload is recorded well enough to re-run screening from the journal alone.
    for (const row of observations) {
      if (row.type !== 'observation') continue;
      expect(Object.keys(row.raw).length).toBeGreaterThan(0);
      expect(row.rawHash.length).toBe(64);
    }
  });
});

describe('sanitisation (evidence rules)', () => {
  it('reports nothing for a real journal, and reports a planted credential or path', () => {
    const harness = scenario('udg-003-journal-sanitise');
    const rows: readonly JournalRow[] = [harness.core.prologue(), ...harness.rows()];
    expect(sanitisationIssues(rows)).toEqual([]);
    expect(sanitisationIssues(harness.chain())).toEqual([]);

    const observation = harness.rows().find((row) => row.type === 'observation');
    if (observation === undefined || observation.type !== 'observation') throw new Error('no observation row');
    const planted: ObservationRow = {
      ...observation,
      raw: { ...observation.raw, token: { kind: 'value', value: 'a-credential' } },
    };
    expect(sanitisationIssues([planted])).toEqual([
      'journal row of type observation carries the key "token"',
    ]);

    // A machine path can only arrive through a rendered field, which is also where the evidence rules
    // most need it caught: the raw payload is copied verbatim from whatever the transport decoded.
    const second = harness.rows().filter((row) => row.type === 'observation')[1];
    if (second === undefined || second.type !== 'observation') throw new Error('no second observation row');
    const leaked: ObservationRow = {
      ...second,
      raw: { ...second.raw, note: { kind: 'value', value: '/home/dev/machine/secret' } },
    };
    expect(sanitisationIssues([leaked])).toEqual([
      'journal row of type observation contains an absolute machine path',
    ]);
  });
});

describe('the tick chain (P03-g)', () => {
  it('links each tick to the one before it and recomputes from what it records', () => {
    const harness = scenario('udg-003-chain');
    const chain = harness.chain();
    expect(chain.length).toBeGreaterThan(3);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1];
      const record = chain[index];
      if (previous === undefined || record === undefined) continue;
      expect(record.prevHash).toBe(previous.hash);
      expect(record.tick).toBe(previous.tick + 1);
    }
    for (const record of chain) {
      expect(record.hash).toBe(
        canonicalHash({
          prevHash: record.prevHash,
          transitionHash: record.transitionHash,
          stateHash: record.stateHash,
        }),
      );
    }
  });

  it('gives two independent identical runs the same tip, and a different decision a different tip', () => {
    const first = scenario('udg-003-chain-run-a');
    const second = scenario('udg-003-chain-run-b');
    expect(first.chain().at(-1)?.hash).toBe(second.chain().at(-1)?.hash);

    const diverging = build(nextRun('udg-003-chain-run-c'));
    diverging.core.join('e1', 1, SPAWN);
    diverging.step();
    diverging.core.ingest('e1', frame(1, 1, 1, 0));
    diverging.step();
    const sameButDifferent = build(nextRun('udg-003-chain-run-d'));
    sameButDifferent.core.join('e1', 1, SPAWN);
    sameButDifferent.step();
    sameButDifferent.core.ingest('e1', frame(1, 1, 0, 1));
    sameButDifferent.step();
    expect(diverging.chain().at(-1)?.hash).not.toBe(sameButDifferent.chain().at(-1)?.hash);
  });
});

describe('replay reproduces the run from inputs (AC-20, AC-3d)', () => {
  it('reproduces every journal row and every state digest', () => {
    const harness = scenario('udg-003-replay-exact');
    const outcome = harness.replay();
    if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);
    expect(firstJournalDifference(harness.rows(), outcome.rows)).toBeNull();
    expect(firstStateDigestDifference(harness.rows(), outcome.rows)).toBeNull();
    expect(outcome.chain.at(-1)?.hash).toBe(harness.chain().at(-1)?.hash);
    expect(outcome.outcomes.length).toBeGreaterThan(0);
  });

  it('reproduces the same decisions from a journal with every digest blanked', () => {
    const harness = scenario('udg-003-replay-blank');
    const original = harness.rows();
    const blanked = withDigestsBlanked(original);

    // The inputs a replay may read are identical, which is the whole point: digests are not inputs.
    const chain = harness.chain();
    expect(toReplayInputs(blanked, chain)).toEqual(toReplayInputs(original, chain));

    const outcome = harness.replayWithoutDigests();
    if (outcome.ok === false) throw new Error(`digest-free replay refused: ${JSON.stringify(outcome)}`);
    const replayed = outcome.rows;
    expect(firstStateDigestDifference(original, replayed)).toBeNull();
    // Compare the non-digest content of every row.
    const strip = (rows: readonly JournalRow[]): readonly string[] =>
      withDigestsBlanked(rows).map((row) => JSON.stringify(row));
    expect(strip(replayed)).toEqual(strip(withDigestsBlanked(original)));
    // And the digests the replay recomputes are the originals', not blanks.
    expect(replayed.some((row) => row.type === 'state' && row.stateHash.length === 64)).toBe(true);
  });

  it('replays refusals identically, including malformed payloads', () => {
    const harness = scenario('udg-003-replay-refusals');
    const outcome = harness.replay();
    if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);
    const dispositions = (rows: readonly JournalRow[]): readonly string[] =>
      rows
        .filter((row) => row.type === 'observation')
        .map((row) => `${String(row.arrivalOrdinal)}:${row.disposition}:${row.reason ?? ''}`);
    expect(dispositions(outcome.rows)).toEqual(dispositions(harness.rows()));
    expect(dispositions(harness.rows()).join()).toContain('refused:structural');
  });

  it('refuses to replay against a different configuration', () => {
    const harness = scenario('udg-003-replay-config');
    const other = createHarness({
      runId: nextRun('udg-003-replay-config-other'),
      config: withConfigOverrides(harness.config, { region: { bounds: { ...TEST_BOUNDS, x: { min: -1, max: 1 } } } }),
    });
    if ('failure' in other) throw new Error(`second harness refused to build: ${other.failure}`);
    const outcome = replayFromInputs({
      prologue: harness.core.prologue(),
      inputs: toReplayInputs(harness.core.journalRows, harness.core.chain),
      config: other.config,
      stepper: other.stepper,
      time: other.time,
      clock: other.clock,
      runId: nextRun('udg-003-replay-config-replay'),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false && outcome.reason !== 'prologue-mismatch') {
      throw new Error(`expected a prologue mismatch, got ${JSON.stringify(outcome)}`);
    }
    if (outcome.ok === false && outcome.reason === 'prologue-mismatch') {
      expect(outcome.actual.configHash).not.toBe(outcome.expected.configHash);
    }
  });

  it('carries the prologue forward, so a replay starts from the same configuration and state', () => {
    const harness = scenario('udg-003-prologue');
    const prologue = harness.core.prologue();
    expect(prologue.runId).not.toBe('');
    expect(prologue.configHash).toHaveLength(64);
    expect(prologue.movementHash).toHaveLength(64);
    expect(prologue.regionHash).toHaveLength(64);
    expect(prologue.initialEntities.length).toBeGreaterThan(0);
    expect(harness.rows()[0]?.type).not.toBe('prologue');
    expect(harness.replay().ok).toBe(true);
  });
});
