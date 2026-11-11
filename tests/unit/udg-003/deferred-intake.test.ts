/**
 * Deterministic admission for arrivals that land during a tick (PA1-C8; reviewer instruction of 2026-11-14).
 *
 * A message received while a tick is running cannot be admitted honestly: the association it is addressed to
 * may be about to end, or may have ended before stage L ran, and the journal records an ordinal and a cutoff
 * — not the instant inside the tick — so a replay would re-derive a different state and answer differently.
 * That is exactly the mismatch revision 3 disclosed. The core now holds such a message in a bounded deferred
 * intake and admits it at the next tick boundary, in receipt order, against the association state that
 * boundary sees. A replay feeds the same journal in the same order before the same tick, so the two agree by
 * construction rather than by luck.
 *
 * Every case below is verified from **persisted** evidence: the rows and the chain are round-tripped through
 * JSON, replayed through the production replay path, and compared for dispositions, canonical state and chain
 * tip.
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
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';
import type { ArrivalOrdinal } from '../../../apps/server/src/authority/types.js';
import type { AuthorityCore } from '../../../apps/server/src/authority/step.js';

/** Kept in step with `DEFERRED_INTAKE_LIMIT` in the core; the contract suite refuses a silent change. */
export const INTAKE_LIMIT = 64;

let runCounter = 0;
const nextRun = (label: string): string => {
  runCounter += 1;
  return `${label}-${String(runCounter)}`;
};

const build = (label: string, epoch = 1): Harness => {
  const built = createHarness({ runId: nextRun(label) });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  built.core.join('e1', epoch, SPAWN, built.time.nowMs());
  built.step();
  return built;
};

/**
 * Land an arrival *while the next tick is running*: the injection runs on the tick's own clock reading, taken
 * immediately after the cutoff is frozen.
 */
const injectDuringTick = (harness: Harness, generation: number, sessionEpoch = 1): (() => ArrivalOrdinal) => {
  let ordinal: ArrivalOrdinal | null = null;
  harness.time.onRead(() => {
    ordinal = harness.core.ingest('e1', frame(sessionEpoch, generation, 1, 0), harness.time.nowMs()).arrival.ordinal;
  });
  return () => {
    if (ordinal === null) throw new Error('no arrival was injected — the tick took no clock reading');
    return ordinal;
  };
};

/** Replay from bytes that have been through JSON, as a caller recovering a run from storage. */
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

const shape = (rows: readonly { type: string }[]): readonly string[] =>
  rows.map((row) => {
    const entry = row as unknown as {
      arrivalOrdinal?: number;
      disposition?: string;
      reason?: string | null;
      kind?: string;
      tick?: number;
      mode?: string;
    };
    return [
      row.type,
      String(entry.arrivalOrdinal ?? entry.tick ?? ''),
      String(entry.disposition ?? entry.kind ?? entry.mode ?? ''),
      String(entry.reason ?? ''),
    ].join(':');
  });

/** The projection a reviewer compares: where the entity is, what it is doing, whether it is still here. */
const canonical = (core: AuthorityCore): unknown => {
  const view = core.view('e1');
  if (view === undefined) return null;
  return {
    position: view.state.locomotion.kinematic.position,
    mode: view.state.locomotion.mode,
    connected: view.connected,
  };
};

/** The four lifecycles whose mid-tick arrival used to diverge; each must now replay to the same run. */
const lifecycleRun = (label: string, lifecycle: 'leave' | 'expiry' | 'epoch' | 'rejoin'): Harness => {
  const harness = build(`udg-003-intake-${label}`, lifecycle === 'epoch' ? 7 : 1);
  harness.core.ingest('e1', frame(lifecycle === 'epoch' ? 7 : 1, 1, 1, 0), harness.time.nowMs());
  // Armed last on purpose: the lifecycle calls below read the clock for their own stamps, and a pending
  // injection would fire on the first of them instead of inside the tick.
  switch (lifecycle) {
    case 'leave': {
      harness.core.leave('e1', harness.time.nowMs());
      break;
    }
    case 'expiry': {
      harness.core.expire('e1', harness.time.nowMs());
      break;
    }
    case 'epoch': {
      harness.core.epochChange('e1', 8, harness.time.nowMs());
      break;
    }
    case 'rejoin': {
      harness.core.leave('e1', harness.time.nowMs());
      harness.core.join('e1', 1, SPAWN, harness.time.nowMs());
      break;
    }
  }
  const injected = injectDuringTick(
    harness,
    lifecycle === 'epoch' ? 5 : 2,
    lifecycle === 'epoch' ? 6 : 1,
  );
  harness.step();
  expect(injected()).toBeGreaterThan(0);
  // The message waited; the tick that was running never decided it.
  expect(harness.core.retention().deferredIntake).toBe(1);
  harness.step();
  return harness;
};

describe('an arrival received during a tick is admitted at the next boundary (PA1-C8)', () => {
  it('is not decided by the tick that was running, and is decided by the boundary that follows', () => {
    const harness = build('udg-003-intake-defer');
    const injected = injectDuringTick(harness, 1);
    const during = harness.step();
    const ordinal = injected();

    // No disposition of any kind names it inside the tick that was running.
    expect(observationRows(during.journalRows).filter((row) => row.arrivalOrdinal === ordinal)).toHaveLength(0);
    expect(harness.core.retention().deferredIntake).toBe(1);
    // And it never entered a gameplay queue, so no queue can hold work outside its own cutoff.
    const view = harness.core.view('e1');
    expect(view?.continuous.every((arrival) => arrival.ordinal <= during.cutoff.ordinal)).toBe(true);

    const after = harness.step();
    const rows = observationRows(harness.rows()).filter((row) => row.arrivalOrdinal === ordinal);
    expect(rows).toHaveLength(1);
    expect(rows.at(-1)?.disposition).toBe('consumed');
    expect(rows.at(-1)?.eligibleTick).toBe(after.tick);
    expect(harness.core.view('e1')?.watermark).toBe(1);
    expect(harness.core.retention().deferredIntake).toBe(0);
  });

  it('keeps receipt order through the intake, and admits in that order', () => {
    const harness = build('udg-003-intake-order');
    const ordinals: number[] = [];
    // Three arrivals land while one tick runs; the intake must not reorder them.
    harness.time.onRead(() => {
      for (const generation of [1, 2, 3]) {
        ordinals.push(harness.core.ingest('e1', frame(1, generation, 1, 0), harness.time.nowMs()).arrival.ordinal);
      }
    });
    harness.step();
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(harness.core.retention().deferredIntake).toBe(3);

    harness.step();
    const admitted = observationRows(harness.rows())
      .filter((row) => ordinals.includes(row.arrivalOrdinal))
      .map((row) => row.arrivalOrdinal);
    expect(admitted).toEqual(ordinals);
    // Only the oldest was eligible for consumption on that tick; the rest wait their turn, unrefused.
    expect(harness.core.retention().deferredIntake).toBe(0);
    expect(harness.core.view('e1')?.watermark).toBe(1);
  });

  it('bounds the intake and accounts every rejection without journalling one', () => {
    const harness = build('udg-003-intake-overflow');
    const rowsBefore = harness.rows().length;
    const accepted: number[] = [];
    const rejections: string[] = [];
    harness.time.onRead(() => {
      for (let generation = 1; generation <= INTAKE_LIMIT + 3; generation += 1) {
        const outcome = harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
        if (outcome.decision.ok === true && outcome.decision.queue === 'intake') {
          accepted.push(outcome.arrival.ordinal);
        } else if (outcome.decision.ok === false) {
          rejections.push(`${outcome.decision.code}/${outcome.decision.disposition}`);
        }
      }
    });
    harness.step();

    expect(accepted).toHaveLength(INTAKE_LIMIT);
    expect(rejections).toEqual(['RATE_LIMITED/refused:overflow', 'RATE_LIMITED/refused:overflow', 'RATE_LIMITED/refused:overflow']);
    expect(harness.core.retention().deferredIntake).toBe(INTAKE_LIMIT);
    expect(harness.core.retention().deferredIntakeRejections).toBe(3);
    expect(harness.core.stats().overflowCauses['deferred-intake']).toBe(3);
    // A rejection the replay could not reach is kept out of the journal's arithmetic on purpose: it names no
    // row, consumes no ordinal and moves no disposition counter. `rowsBefore` is compared against the
    // observation rows only, because the tick itself always journals state and metadata.
    expect(
      observationRows(harness.rows()).filter((row) => row.disposition === 'refused:overflow'),
    ).toHaveLength(0);
    expect(harness.rows().length).toBeGreaterThan(rowsBefore);
    expect(harness.core.stats().counters['refused:overflow'] ?? 0).toBe(0);

    harness.step();
    expect(harness.core.retention().deferredIntake).toBe(0);
    // The admitted arrivals are decided normally: the oldest becomes this tick's input, the rest queue or
    // overflow under the declared capacities, and each is journalled exactly once.
    const journalled = observationRows(harness.rows()).filter((row) => accepted.includes(row.arrivalOrdinal));
    expect(journalled).toHaveLength(accepted.length);
    expect(new Set(journalled.map((row) => row.arrivalOrdinal)).size).toBe(accepted.length);
  });

  it('replays the leave run from persisted evidence with matching dispositions, state and tip', () => {
    const harness = lifecycleRun('leave', 'leave');
    const replay = replayPersisted(harness);
    expect(shape(replay.rows)).toEqual(shape(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    expect(canonical(harness.core)).toBeNull();
    // The mid-tick arrival is refused at the boundary by both runs, once, for the same reason.
    const refused = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:epoch');
    expect(refused).toHaveLength(1);
  });

  it('replays the expiry run from persisted evidence with matching dispositions, state and tip', () => {
    const harness = lifecycleRun('expiry', 'expiry');
    const replay = replayPersisted(harness);
    expect(shape(replay.rows)).toEqual(shape(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    expect(observationRows(harness.rows()).filter((row) => row.disposition === 'dropped:lifecycle')).toHaveLength(1);
  });

  it('replays the epoch-change run from persisted evidence with matching dispositions, state and tip', () => {
    const harness = lifecycleRun('epoch', 'epoch');
    const replay = replayPersisted(harness);
    expect(shape(replay.rows)).toEqual(shape(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    expect(harness.core.view('e1')?.epoch).toBe(8);
    expect(harness.core.view('e1')?.watermark).toBe(0);
    const epochRefusals = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:epoch');
    expect(epochRefusals.length).toBeGreaterThan(0);
    expect(
      observationRows(replay.rows)
        .filter((row) => row.disposition === 'refused:epoch')
        .map((row) => `${String(row.arrivalOrdinal)}:${String(row.reason)}`),
    ).toEqual(epochRefusals.map((row) => `${String(row.arrivalOrdinal)}:${String(row.reason)}`));
  });

  it('replays the leave-then-rejoin run from persisted evidence with matching dispositions, state and tip', () => {
    const harness = lifecycleRun('rejoin', 'rejoin');
    const replay = replayPersisted(harness);
    expect(shape(replay.rows)).toEqual(shape(harness.rows()));
    expect(replay.core.chainTip).toBe(harness.core.chainTip);
    expect(canonical(replay.core)).toEqual(canonical(harness.core));
    // The association that is live at the boundary owns the deferred arrival: it is input, not backlog.
    const view = harness.core.view('e1');
    expect(view?.connected).toBe(true);
    expect(view?.watermark).toBe(2);
    expect(observationRows(harness.rows()).filter((row) => row.disposition === 'dropped:lifecycle')).toHaveLength(1);
  });

  it('never lets a queue hold work outside its own cutoff, whatever the lifecycle', () => {
    // The invariant the bounded sweep in `#disposeEligible` enforces, asserted rather than assumed: no queued
    // arrival can have an ordinal the tick that holds it has already frozen past.
    for (const lifecycle of ['leave', 'expiry', 'epoch', 'rejoin'] as const) {
      const harness = lifecycleRun(`invariant-${lifecycle}`, lifecycle);
      const cutoff = harness.chain().at(-1);
      if (cutoff === undefined) throw new Error('no tick recorded');
      const view = harness.core.view('e1');
      expect(
        (view?.continuous ?? []).every((arrival) => arrival.ordinal <= cutoff.ordinal) &&
          (view?.discrete ?? []).every((arrival) => arrival.ordinal <= cutoff.ordinal),
        lifecycle,
      ).toBe(true);
      expect(harness.core.retention().deferredIntake, lifecycle).toBe(0);
    }
  });
});
