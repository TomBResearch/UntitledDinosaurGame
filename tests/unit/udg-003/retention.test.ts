/**
 * Bounded retained state (reviewer correction 3).
 *
 * The journal and the tick chain are **streamed** to an injected sink, and the bookkeeping of a departed
 * entity is released once its evidence exists. What the core keeps is the working set it actually needs:
 * live entities, their declared queue capacities, the control queue, the current tick's rows and the chain
 * tip. A run of thousands of ticks with repeated joins and expiries must not grow with its own history —
 * and must not lose anything either, so the same run is replayed and compared.
 *
 * The flat lines below are measured against a growing line in the same test: the sink's totals. A retention
 * claim that came with a journal that had also stopped growing would prove nothing.
 */

import { describe, expect, it } from 'vitest';

import { AuthorityCore, CAPACITIES } from '../../../apps/server/src/authority/step.js';
import type { RetainedState } from '../../../apps/server/src/authority/step.js';
import { discardingSink } from '../../../apps/server/src/authority/journal.js';
import { FixedStepClock } from '../../../apps/server/src/authority/clock.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { cancel, frame } from '../../support/authority/payloads.js';
import { JournalCollector } from '../../support/authority/journal-collector.js';
import { ReferenceStepper } from '../../support/authority/reference-stepper.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';
import { CONFIG_WITH_BOUNDS } from '../../support/authority/harness.js';

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

/**
 * A population churn: one entity stays for the whole run, a new one joins and leaves on a cycle.
 *
 * `arrivals` counts every message offered, including the lifecycle calls, so the totals at the end can be
 * checked against what the core still reports after releasing the departed entities' bookkeeping.
 */
interface Churn {
  readonly harness: Harness;
  readonly arrivals: number;
  readonly departed: number;
}

const churn = (label: string, cycles: number, sampleAt?: (harness: Harness, cycle: number) => void): Churn => {
  const harness = build(label);
  harness.core.join('stay', 1, SPAWN);
  harness.step();
  let arrivals = 1; // the join above
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    // The resident entity keeps working, so the run is never idle.
    harness.core.ingest('stay', frame(1, cycle, cycle % 2, 0));
    arrivals += 1;

    const transient = `visitor-${String(cycle)}`;
    harness.core.join(transient, 1, SPAWN);
    harness.core.ingest(transient, frame(1, 1, 1, 0));
    harness.core.ingest(transient, frame(1, 2, 0, 1));
    harness.core.ingest(transient, cancel(`c-${String(cycle)}`, 1, 3));
    arrivals += 4;
    harness.step();

    harness.core.leave(transient);
    arrivals += 1;
    harness.step();
    sampleAt?.(harness, cycle);
  }
  return { harness, arrivals, departed: cycles };
};

const samples = new Map<string, RetainedState>();

describe('the core retains a working set, not its history (correction 3)', () => {
  it('streams every row and chain record to the injected sink', () => {
    // Assembled directly, with a collector this test owns, so "injected sink" is demonstrated rather than
    // described: the core is given somewhere to put its journal and keeps nothing for itself.
    const collector = new JournalCollector();
    const clock = FixedStepClock.create({
      network: CONFIG_WITH_BOUNDS.network,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      time: new VirtualTime(0),
      tickOrigin: 0,
    });
    if (!('dtSeconds' in clock)) throw new Error(`clock refused: ${clock.error}`);
    const core = AuthorityCore.build({
      config: CONFIG_WITH_BOUNDS,
      stepper: new ReferenceStepper(CONFIG_WITH_BOUNDS.movement.speed),
      time: new VirtualTime(0),
      clock,
      runId: nextRun('udg-003-retention-sink'),
      sink: collector,
    });
    if (!('view' in core)) throw new Error(`core refused to build: ${core.detail}`);

    core.join('e1', 1, SPAWN);
    core.ingest('e1', frame(1, 1, 1, 0));
    core.step();

    expect(collector.rowCount).toBeGreaterThan(0);
    expect(collector.chainLength).toBe(1);
    const retained = core.retention();
    expect(retained.tickRowBuffer).toBe(0);
    expect(retained.streamedRows).toBe(collector.rowCount);
    expect(retained.streamedChainRecords).toBe(collector.chainLength);
    // The only history the core holds is the chain tip.
    expect(core.chainTip).toHaveLength(64);

    // Streaming is continuous, not only at tick boundaries: a refusal at the gate is journalled where it
    // happens, while an accepted message waits to be decided. Both are true in the same breath.
    const beforeIngest = collector.rowCount;
    core.ingest('e1', cancel('c-direct', 1, 2));
    expect(collector.rowCount).toBe(beforeIngest);
    const refusedAtGate = core.ingest('nobody', frame(1, 1, 1, 0));
    expect(refusedAtGate.decision.ok).toBe(false);
    expect(collector.rowCount).toBeGreaterThan(beforeIngest);
    expect(core.retention().tickRowBuffer).toBe(0);

    // And a caller that wants no evidence at all can say so; the core still runs.
    const quietClock = FixedStepClock.create({
      network: CONFIG_WITH_BOUNDS.network,
      scheduler: new VirtualScheduler(new VirtualTime(0)),
      time: new VirtualTime(0),
      tickOrigin: 0,
    });
    if (!('dtSeconds' in quietClock)) throw new Error('clock refused for the quiet core');
    const quiet = AuthorityCore.build({
      config: CONFIG_WITH_BOUNDS,
      stepper: new ReferenceStepper(CONFIG_WITH_BOUNDS.movement.speed),
      time: new VirtualTime(0),
      clock: quietClock,
      runId: nextRun('udg-003-retention-discarding'),
      sink: discardingSink(),
    });
    if (!('view' in quiet)) throw new Error('quiet core refused to build');
    quiet.join('e1', 1, SPAWN);
    quiet.ingest('e1', frame(1, 1, 1, 0));
    quiet.step();
    expect(quiet.retention().streamedRows).toBeGreaterThan(0);
    expect(quiet.retention().entities).toBe(1);
  });

  it('keeps a flat working set across churn while the journal grows', () => {
    const seen: Record<number, RetainedState> = {};
    const run = churn('udg-003-retention-churn', 120, (harness, cycle) => {
      if (cycle === 20 || cycle === 120) seen[cycle] = harness.core.retention();
    });
    const harness = run.harness;
    const early = seen['20'];
    const late = seen['120'];
    if (early === undefined || late === undefined) throw new Error('sampling did not run');
    samples.set('early', early);
    samples.set('late', late);

    // Only the resident entity is still known.
    expect(early.entities).toBe(1);
    expect(late.entities).toBe(1);
    expect(late.releasedEntities).toBe(run.departed);
    // The quantity that must not grow: arrivals reachable from the core's own state.
    expect(late.reachableArrivals).toBeLessThanOrEqual(early.reachableArrivals + 4);
    expect(late.queuedArrivals).toBe(0);
    expect(late.controlQueue).toBe(0);
    expect(late.cacheRecords).toBeLessThanOrEqual(early.cacheRecords);
    expect(late.tickRowBuffer).toBe(0);
    // Alias memory is bounded even though 121 associations were labelled.
    expect(late.aliasRecords).toBeLessThanOrEqual(64);
    expect(late.aliasRecords).toBeGreaterThan(0);
    // Meanwhile the evidence kept growing, in the sink, which is where growth is allowed to live.
    expect(late.streamedRows).toBeGreaterThan(early.streamedRows);
    expect(late.streamedChainRecords).toBe(241);
    expect(late.streamedRows).toBe(harness.rows().length);
    expect(harness.rows().length).toBeGreaterThan(2_000);
  });

  it('loses no arithmetic when departed bookkeeping is released', () => {
    const run = churn('udg-003-retention-arithmetic', 40);
    const stats = run.harness.core.stats();
    // Every arrival the run offered is still counted, including those of released entities.
    expect(stats.observed).toBe(run.arrivals);
    expect(stats.releasedEntities).toBe(run.departed);
    // A released entity reports no live bookkeeping, and the AC-17 arithmetic for it stays balanced at zero.
    const released = run.harness.core.reconciliation('visitor-3');
    expect(released.known).toBe(false);
    expect(released.balanced).toBe(true);
    // The resident entity is still fully accounted for, by name.
    const resident = run.harness.core.reconciliation('stay');
    expect(resident.known).toBe(true);
    expect(resident.balanced).toBe(true);
    expect(resident.observed).toBe(41);
  });

  it('bounds the terminal-request cache per entity whatever the traffic', () => {
    const harness = build('udg-003-retention-cache');
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    for (let index = 1; index <= 400; index += 1) {
      harness.core.ingest('e1', cancel(`flood-${String(index)}`, 1, index));
      harness.step();
      expect(harness.core.retention().cacheRecords).toBeLessThanOrEqual(CAPACITIES.terminalCacheRecords);
    }
    expect(harness.core.retention().cacheRecords).toBe(CAPACITIES.terminalCacheRecords);
    expect(harness.core.stats().cacheDepth).toBe(CAPACITIES.terminalCacheRecords);
  });

  it('replays the churned run from the streamed journal, loss-free', () => {
    const run = churn('udg-003-retention-replay', 25);
    const harness = run.harness;
    const outcome = harness.replay();
    if (outcome.ok === false) throw new Error(`churn replay refused: ${JSON.stringify(outcome)}`);
    expect(outcome.rowsWritten).toBe(outcome.rows.length);
    expect(outcome.rows.length).toBe(harness.rows().length);
    expect(outcome.chain.length).toBe(harness.chain().length);
    expect(outcome.chain.at(-1)?.hash).toBe(harness.chain().at(-1)?.hash);
    // The replayed core releases on the same schedule, so it retains the same working set.
    expect(outcome.core.retention().entities).toBe(1);
    expect(outcome.core.retention().releasedEntities).toBe(run.departed);
    expect(outcome.core.view('stay')).toBeDefined();
    expect(outcome.core.view('visitor-1')).toBeUndefined();
  });

  it('does not resurrect a departed entity through a later message, and keeps saying so', () => {
    const harness = build('udg-003-retention-late');
    harness.core.join('gone', 1, SPAWN);
    harness.step();
    harness.core.leave('gone');
    harness.step();
    expect(harness.core.view('gone')).toBeUndefined();

    const late = harness.core.ingest('gone', frame(1, 2, 1, 0));
    expect(late.decision.ok).toBe(false);
    if (late.decision.ok === false) expect(late.decision.code).toBe('EPOCH_MISMATCH');
    const tick = harness.step();
    expect(tick.entities).toEqual([]);
    expect(harness.core.retention().entities).toBe(0);
    // The refusal is journalled under an alias, so the evidence still correlates.
    const rows = harness.rows().filter((row) => row.type === 'observation' && row.entityId === 'gone');
    expect(rows.length).toBeGreaterThan(0);
    const aliases = new Set(rows.map((row) => (row.type === 'observation' ? row.alias : '')));
    expect(aliases.size).toBe(1);
  });
});
