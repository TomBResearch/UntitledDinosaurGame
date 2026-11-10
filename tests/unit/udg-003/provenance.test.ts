/**
 * Trusted event provenance (reviewer correction 1).
 *
 * The rule this suite exists to hold: **a lifecycle operation is never read out of a payload.** A client
 * message that carries a `control` field is a client message; it is refused by the admission gate, it is
 * journalled as a client observation, and a replay must refuse it again for the same reason. Before this
 * correction the replay projected its lifecycle operation from `raw.control`, so exactly this message —
 * refused live — became a real `leave()` on the second run and changed entity state.
 *
 * Every assertion here goes through the real ingest and replay paths. Nothing writes a field to fake a
 * provenance; the forged cases build replay *inputs* the way a tampered artefact would, and assert the
 * replay refuses them outright.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame } from '../../support/authority/payloads.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import {
  roundTripChain,
  roundTripRows,
  JournalCollector,
} from '../../support/authority/journal-collector.js';
import {
  firstStateDigestDifference,
  provenanceIssues,
  toReplayInputs,
} from '../../../apps/server/src/authority/journal.js';
import { replayRun } from '../../../apps/server/src/authority/replay.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import type { ObservationRow } from '../../../apps/server/src/authority/types.js';

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

const build = (label: string): Harness => {
  const built = createHarness({ runId: nextRun(label) });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

/** A live entity with two committed generations, so a lifecycle look-alike has something to corrupt. */
const running = (label: string): Harness => {
  const harness = build(label);
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  harness.core.ingest('e1', frame(1, 1, 1, 0));
  harness.step();
  return harness;
};

/** A refused client message that is shaped as if it were a server lifecycle call. */
const forgedLeave = (generation: number): Record<string, unknown> => ({
  control: 'leave',
  sessionEpoch: 1,
  generation,
  directIntent: true,
  moveX: 1,
  moveZ: 0,
});

const forgedJoin = (generation: number): Record<string, unknown> => ({
  control: 'join',
  sessionEpoch: 9,
  generation,
  spawnX: 999,
  spawnY: 999,
  spawnZ: 999,
});

const observationsFor = (harness: Harness, ordinal: number): readonly ObservationRow[] =>
  harness
    .rows()
    .filter((row): row is ObservationRow => row.type === 'observation' && row.arrivalOrdinal === ordinal);

const dispositions = (harness: Harness): readonly string[] =>
  harness
    .rows()
    .filter((row) => row.type === 'observation')
    .map((row) => (row.type === 'observation' ? `${String(row.arrivalOrdinal)}:${row.disposition}:${row.reason ?? ''}` : ''));

describe('lifecycle provenance is the server’s, never the payload’s (correction 1)', () => {
  it('refuses a lifecycle look-alike live, and changes nothing while refusing it', () => {
    const harness = running('udg-003-provenance-live');
    const before = harness.core.view('e1');
    if (before === undefined) throw new Error('entity missing');
    const position = before.state.locomotion.kinematic.position;
    const calls = harness.stepper.calls.length;

    const outcome = harness.core.ingest('e1', forgedLeave(2));
    expect(outcome.decision.ok).toBe(false);
    if (outcome.decision.ok === false) {
      expect(outcome.decision.code).toBe('INVALID_PAYLOAD');
      expect(outcome.decision.disposition).toBe('refused:structural');
    }

    const tick = harness.step();
    const after = harness.core.view('e1');
    // Refused, and the association is untouched: still active, still connected, same position, same watermark.
    expect(after).toBeDefined();
    expect(after?.lifecycle).toBe('active');
    expect(after?.state.connected).toBe(true);
    expect(after?.state.locomotion.kinematic.position).toEqual(position);
    expect(after?.watermark).toBe(before.watermark);
    expect(tick.entities.find((entry) => entry.entityId === 'e1')?.lifecycle).toBe('active');
    // No lifecycle ran: not one extra step, and no lifecycle event row anywhere in the journal.
    expect(harness.stepper.calls.length).toBe(calls + 1);
    expect(harness.rows().filter((row) => row.type === 'event')).toHaveLength(1);

    const rows = observationsFor(harness, outcome.arrival.ordinal);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.origin).toBe('client-payload');
      expect(row.control).toBeNull();
      // The payload keeps what it said - the journal must not hide the attempt - while the typed control
      // field stays null. That difference is the whole correction.
      const attempted = row.raw['control'];
      expect(attempted?.kind).toBe('value');
      if (attempted?.kind !== 'value') throw new Error('the attempt was not journalled');
      expect(attempted.value).toBe('leave');
    }
    expect(provenanceIssues(harness.rows())).toEqual([]);
  });

  it('refuses the same message again on replay, with the same state on both sides', () => {
    const harness = running('udg-003-provenance-replay');
    const forged = harness.core.ingest('e1', forgedLeave(2));
    harness.step();
    harness.core.ingest('e1', frame(1, 2, 1, 0));
    harness.step();

    const inputs = harness.replayInputs();
    const projected = inputs.observations.find((entry) => entry.ordinal === forged.arrival.ordinal);
    expect(projected).toBeDefined();
    expect(projected?.control).toBeNull();
    expect(projected?.origin).toBe('client-payload');

    const outcome = harness.replay();
    if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);

    const originalEventKinds = harness
      .rows()
      .filter((row) => row.type === 'event')
      .map((row) => (row.type === 'event' ? row.kind : ''));
    const replayedEventKinds = outcome.rows
      .filter((row) => row.type === 'event')
      .map((row) => (row.type === 'event' ? row.kind : ''));
    expect(replayedEventKinds).toEqual(originalEventKinds);
    expect(replayedEventKinds).not.toContain('leave');

    // Same refusals, same dispositions, same canonical state digests.
    const replayedDispositions = outcome.rows
      .filter((row) => row.type === 'observation')
      .map((row) => (row.type === 'observation' ? `${String(row.arrivalOrdinal)}:${row.disposition}:${row.reason ?? ''}` : ''));
    expect(replayedDispositions).toEqual(dispositions(harness));
    expect(replayedDispositions.join()).toContain(`${String(forged.arrival.ordinal)}:refused:structural:INVALID_PAYLOAD`);
    expect(firstStateDigestDifference(harness.rows(), outcome.rows)).toBeNull();

    // And the replayed run still has a live entity: the message did not remove it on the second run either.
    expect(outcome.core.view('e1')?.lifecycle).toBe('active');
    expect(outcome.core.view('e1')?.state.connected).toBe(true);
  });

  it('reproduces the refusal from persisted evidence, byte for byte through JSON', () => {
    const harness = running('udg-003-provenance-persisted');
    const forged = harness.core.ingest('e1', forgedJoin(2));
    harness.step();

    // "Persisted" means it survived serialisation: the artefact a reviewer would actually be handed.
    const rows = roundTripRows(harness.rows());
    const chain = roundTripChain(harness.chain());
    const outcome = replayFromInputs({
      prologue: harness.core.prologue(),
      inputs: toReplayInputs(rows, chain),
      config: harness.config,
      stepper: harness.stepper,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      runId: nextRun('udg-003-provenance-persisted-replay'),
    });
    if (outcome.ok === false) throw new Error(`persisted replay refused: ${JSON.stringify(outcome)}`);

    const row = outcome.rows.find(
      (entry) => entry.type === 'observation' && entry.arrivalOrdinal === forged.arrival.ordinal,
    );
    expect(row?.type).toBe('observation');
    if (row?.type !== 'observation') return;
    expect(row.origin).toBe('client-payload');
    expect(row.control).toBeNull();
    expect(row.disposition).toBe('refused:structural');
    expect(row.reason).toBe('INVALID_PAYLOAD');
    // A forged `join` at epoch 9 did not create an association, and did not move the epoch.
    expect(outcome.rows.filter((entry) => entry.type === 'event')).toHaveLength(1);
    expect(outcome.core.view('e1')?.epoch).toBe(1);
    expect(firstStateDigestDifference(harness.rows(), outcome.rows)).toBeNull();
  });

  it('refuses an artefact that hands a lifecycle operation to a client row', () => {
    const harness = running('udg-003-provenance-forged-input');
    harness.core.ingest('e1', cancel('c1', 1, 2));
    harness.step();

    const inputs = harness.replayInputs();
    const client = inputs.observations.find((entry) => entry.origin === 'client-payload');
    expect(client).toBeDefined();
    if (client === undefined) return;
    // Exactly what a tampered artefact would look like: a control value with no server provenance.
    const tampered = {
      events: inputs.events,
      ticks: inputs.ticks,
      observations: inputs.observations.map((entry) =>
        entry.ordinal === client.ordinal ? { ...entry, control: 'leave' as const } : entry,
      ),
    };
    const collector = new JournalCollector();
    const result = replayRun({
      prologue: harness.core.prologue(),
      inputs: tampered,
      config: harness.config,
      stepper: harness.stepper,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      sink: collector,
      runId: nextRun('udg-003-provenance-forged-replay'),
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('provenance-inconsistent');
      if (result.reason === 'provenance-inconsistent') {
        expect(result.issues.join()).toContain('without server provenance');
      }
    }
    // Refusing means not running: nothing was journalled by a replay that never started.
    expect(collector.rowCount).toBe(0);
  });

  it('labels every arrival by how it actually entered, in one mixed run', () => {
    const harness = build('udg-003-provenance-mixed');
    harness.core.join('e1', 1, SPAWN);
    harness.core.ingest('e1', frame(1, 1, 1, 0));
    harness.core.ingest('e1', cancel('c1', 1, 1));
    harness.step();
    harness.core.leave('e1');
    harness.step();
    harness.core.join('e2', 2, SPAWN);
    harness.core.ingest('e2', frame(2, 1, 0, 1));
    harness.step();

    const server = harness.rows().filter((row) => row.type === 'observation' && row.origin === 'server-lifecycle');
    const client = harness.rows().filter((row) => row.type === 'observation' && row.origin === 'client-payload');
    expect(server.length).toBeGreaterThan(0);
    expect(client.length).toBeGreaterThan(0);
    for (const row of server) {
      if (row.type !== 'observation') continue;
      expect(row.kind).toBe('control');
      expect(row.control === null).toBe(false);
    }
    for (const row of client) {
      if (row.type !== 'observation') continue;
      expect(row.control).toBeNull();
      expect(row.kind).not.toBe('control');
    }
    expect(provenanceIssues(harness.rows())).toEqual([]);
    // Lifecycle rows carry the state a join started from, which is where a departed entity's origin now lives.
    const joins = harness.rows().filter((row) => row.type === 'event' && row.kind === 'join');
    expect(joins).toHaveLength(2);
  });
});
