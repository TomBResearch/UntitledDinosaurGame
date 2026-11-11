/**
 * Receipt order across both admission paths (PA1-C9; reviewer instruction of 2026-11-15).
 *
 * Revision 4 kept an arrival received during a tick in the deferred intake and admitted it at the next tick
 * boundary. That closed the intra-tick divergence but left a second one open: a *newer* arrival received
 * between two ticks went straight into the entity queue, so it could overtake the *older* arrival still
 * waiting in the intake. Live execution then differed from replay in two observable ways — which arrival stage
 * Q selects, and which arrival gets the last free slot when there is exactly one — because replay feeds both
 * arrivals in ordinal order and therefore never overtakes.
 *
 * The rule now: the intake is flushed in receipt order at every core entry point, not only at a tick boundary.
 * A between-ticks arrival is admitted after everything already waiting, so the live order equals the ordinal
 * order a replay feeds in. Every case below is verified from **persisted** evidence — rows and chain round-
 * tripped through JSON, replayed through the production replay path — and compared for consumed identity,
 * overflow disposition, canonical state and chain tip.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { roundTripChain, roundTripRows } from '../../support/authority/journal-collector.js';
import { replayFromInputs } from '../../support/authority/replay-helpers.js';
import type { ReplayedRun } from '../../support/authority/replay-helpers.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import { frame } from '../../support/authority/payloads.js';
import { observationRows } from '../../support/authority/scenarios.js';
import { CAPACITIES } from '../../../apps/server/src/authority/step.js';
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';
import type { ArrivalOrdinal } from '../../../apps/server/src/authority/types.js';
import type { AuthorityCore } from '../../../apps/server/src/authority/step.js';

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

const build = (label: string): Harness => {
  const built = createHarness({ runId: nextRun(label) });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  built.core.join('e1', 1, SPAWN, built.time.nowMs());
  built.step();
  return built;
};

/** Land an arrival *while the next tick is running*, on the tick's own clock reading. */
const injectDuringTick = (harness: Harness, generation: number): (() => ArrivalOrdinal) => {
  let ordinal: ArrivalOrdinal | null = null;
  harness.time.onRead(() => {
    ordinal = harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs()).arrival.ordinal;
  });
  return () => {
    if (ordinal === null) throw new Error('no arrival was injected — the tick took no clock reading');
    return ordinal;
  };
};

/** Replay from bytes that have been through JSON, as a caller recovering the run from storage. */
const replayPersisted = (harness: Harness): ReplayedRun => {
  const outcome = replayFromInputs({
    prologue: harness.core.prologue(),
    inputs: toReplayInputs(roundTripRows(harness.rows()), roundTripChain(harness.chain())),
    config: harness.config,
    stepper: harness.stepper,
    scheduler: new VirtualScheduler(new VirtualTime(0)),
    runId: nextRun(`${harness.core.runId}-persisted`),
  });
  if (outcome.ok === false) throw new Error(`replay refused: ${JSON.stringify(outcome)}`);
  return outcome;
};

const rowsAsText = (rows: readonly unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join('\n');

const canonical = (core: AuthorityCore): unknown => {
  const view = core.view('e1');
  if (view === undefined) return null;
  return {
    position: view.state.locomotion.kinematic.position,
    mode: view.state.locomotion.mode,
    connected: view.connected,
    watermark: view.watermark,
    queued: view.continuous.map((arrival) => arrival.ordinal),
  };
};

const dispositionsFor = (harness: Harness, ordinal: number): readonly string[] =>
  observationRows(harness.rows())
    .filter((row) => row.arrivalOrdinal === ordinal)
    .map((row) => row.disposition);

/**
 * A `join` is itself journalled as a consumed observation of kind `control`, so identity assertions about
 * client arrivals have to say so; otherwise the lifecycle event that opened the association is read as the
 * first frame the tick consumed.
 */
const clientConsumedOrdinals = (rows: readonly unknown[]): readonly number[] =>
  rows
    .map((row) => row as { type?: string; kind?: string; disposition?: string; arrivalOrdinal?: number })
    .filter((row) => row.type === 'observation' && row.kind !== 'control' && row.disposition === 'consumed')
    .map((row) => row.arrivalOrdinal ?? -1);

/** Which arrivals carry an overflow refusal, in journal order. */
const refusedOrdinals = (rows: readonly unknown[]): readonly number[] =>
  rows
    .map((row) => row as { type?: string; disposition?: string; arrivalOrdinal?: number })
    .filter((row) => row.type === 'observation' && row.disposition === 'refused:overflow')
    .map((row) => row.arrivalOrdinal ?? -1);

const consumedOrdinalIn = (harness: Harness, tick: number): number | null => {
  const row = observationRows(harness.rows()).find(
    (candidate) =>
      candidate.kind !== 'control' && candidate.disposition === 'consumed' && candidate.eligibleTick === tick,
  );
  return row === undefined ? null : row.arrivalOrdinal;
};

/**
 * The shape both cases share: an older arrival lands during tick T, a newer one lands between T and T+1, and
 * the run continues for two more ticks so selection and capacity are both decided on the record.
 */
const overtake = (label: string, fillQueue: number): {
  harness: Harness;
  older: number;
  newer: number;
  tickAfter: number;
} => {
  const harness = build(label);
  // Frames queued between ticks, before T. They are eligible at T and consume slots normally.
  for (let generation = 1; generation <= fillQueue; generation += 1) {
    harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs());
  }
  const injected = injectDuringTick(harness, fillQueue + 1);
  harness.step();
  const older = injected();
  expect(harness.core.retention().deferredIntake, label).toBe(1);
  // The newer arrival, received between T and T+1, must not overtake the older one.
  const newer = harness.core.ingest('e1', frame(1, fillQueue + 2, 1, 0), harness.time.nowMs()).arrival.ordinal;
  expect(newer).toBeGreaterThan(older);
  expect(harness.core.retention().deferredIntake, label).toBe(0);
  const tickAfter = harness.step().tick;
  harness.step();
  return { harness, older, newer, tickAfter };
};

describe('a between-ticks arrival cannot overtake one waiting in the intake (PA1-C9)', () => {
  it('with queue space available, the older arrival is the one stage Q consumes', () => {
    const { harness, older, newer, tickAfter } = overtake('udg-003-order-space', 0);

    // Stage Q takes the oldest eligible observation, and "oldest" means arrival order, not "first into a queue".
    expect(consumedOrdinalIn(harness, tickAfter)).toBe(older);
    expect(dispositionsFor(harness, older)).toEqual(['consumed']);
    // The newer arrival waited its turn: journalled as still queued on the tick that passed it over, then
    // consumed on the next. It was never refused for arriving out of order.
    expect(dispositionsFor(harness, newer)).toEqual(['queued', 'consumed']);
    expect(consumedOrdinalIn(harness, tickAfter + 1)).toBe(newer);
    expect(harness.core.view('e1')?.watermark).toBe(2);
  });

  it('with queue space available, persisted replay agrees on identity, state and tip', () => {
    const { harness, older } = overtake('udg-003-order-space-replay', 0);
    const replay = replayPersisted(harness);
    expect(rowsAsText(replay.rows)).toBe(rowsAsText(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    expect(canonical(harness.core)).not.toBeNull();
    // The identity the two paths must never disagree about.
    const replayConsumed = clientConsumedOrdinals(replay.rows);
    const liveConsumed = clientConsumedOrdinals(harness.rows());
    expect(replayConsumed).toEqual(liveConsumed);
    expect(liveConsumed).toEqual([older, older + 1]);
  });

  it('with exactly one free slot, the older arrival takes it and the newer one is refused', () => {
    // Fill the continuous queue to its declared capacity, then let a tick consume one so exactly one slot is
    // free when the two arrivals race: the older from the intake, the newer straight from the transport.
    const { harness, older, newer } = overtake('udg-003-order-slot', CAPACITIES.continuousPerClient);

    expect(dispositionsFor(harness, newer)).toEqual(['refused:overflow']);
    expect(dispositionsFor(harness, older)).toContain('queued');
    expect(dispositionsFor(harness, older)).not.toContain('refused:overflow');
    expect(harness.core.stats().overflowCauses['continuous-capacity']).toBe(1);
    // Drop-newest is the declared policy, and it can only be honest if admission kept the newest last.
    const refused = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:overflow');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.arrivalOrdinal).toBe(newer);
    expect(refused[0]?.reason).toBe('RATE_LIMITED');
  });

  it('with exactly one free slot, persisted replay agrees on the refusal, state and tip', () => {
    const { harness, newer } = overtake('udg-003-order-slot-replay', CAPACITIES.continuousPerClient);
    const replay = replayPersisted(harness);
    expect(rowsAsText(replay.rows)).toBe(rowsAsText(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    // Which arrival carries the overflow refusal is the whole question: a run that let the newer arrival take
    // the slot refuses the older one instead, and both runs still look internally consistent.
    expect(refusedOrdinals(replay.rows)).toEqual(refusedOrdinals(harness.rows()));
    expect(refusedOrdinals(harness.rows())).toEqual([newer]);
  });

  it('a lifecycle control received between ticks also waits behind the intake', () => {
    // The flush rule is at every entry point, so a `leave` cannot be processed ahead of an older observation
    // that is still waiting: the observation belongs to the association that is ending and is disposed as its
    // backlog exactly once, rather than admitted after the entity has gone.
    const harness = build('udg-003-order-leave');
    const injected = injectDuringTick(harness, 1);
    harness.step();
    const older = injected();
    expect(harness.core.retention().deferredIntake).toBe(1);
    harness.core.leave('e1', harness.time.nowMs());
    expect(harness.core.retention().deferredIntake, 'the control flushed the intake first').toBe(0);
    harness.step();
    expect(dispositionsFor(harness, older)).toEqual(['dropped:lifecycle']);
    expect(harness.core.stats().counters['dropped:lifecycle'] ?? 0).toBe(1);
    expect(harness.core.view('e1')).toBeUndefined();

    const replay = replayPersisted(harness);
    expect(rowsAsText(replay.rows)).toBe(rowsAsText(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
  });

  it('keeps every arrival it holds in ordinal order, whichever path delivered it', () => {
    // Two older arrivals from a running tick, then three between ticks: the queue must read as one ordered
    // sequence, because that ordering is what stage Q and the capacity policy are both defined over.
    const harness = build('udg-003-order-mixed');
    const during: number[] = [];
    harness.time.onRead(() => {
      for (const generation of [1, 2]) {
        during.push(harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs()).arrival.ordinal);
      }
    });
    harness.step();
    const after: number[] = [];
    for (const generation of [3, 4, 5]) {
      after.push(harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs()).arrival.ordinal);
    }
    expect(during).toHaveLength(2);
    const view = harness.core.view('e1');
    if (view === undefined) throw new Error('the entity went away');
    const queued = view.continuous.map((arrival) => arrival.ordinal);
    expect(queued).toEqual([...during, ...after].sort((left, right) => left - right));
    expect(harness.core.retention().deferredIntake).toBe(0);

    harness.step();
    const first = observationRows(harness.rows()).find(
      (row) => row.kind !== 'control' && row.disposition === 'consumed',
    );
    if (first === undefined) throw new Error('nothing was consumed');
    expect(first.arrivalOrdinal).toBe(Math.min(...during, ...after));
  });
});
