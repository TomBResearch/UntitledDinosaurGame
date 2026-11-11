/**
 * The frozen cutoff bounds lifecycle cleanup (PA1-C7).
 *
 * Stage L runs inside the frozen set, so the observations it disposes of are the ones the cutoff covers. An
 * arrival that lands after the cutoff — here, while lifecycle work is already in progress — is not this
 * tick's to drop: it keeps its place, and the next eligible tick accounts for it. That has a consequence the
 * previous behaviour hid: an entity that departs with residue still queued cannot have its bookkeeping
 * released in the same tick, or the residue would have nowhere to be journalled from. It is retired for one
 * tick and released once its queue is genuinely empty.
 *
 * Every case below asserts the arithmetic as well as the row: one arrival, one disposition, no double count
 * and no silent disappearance.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { frame } from '../../support/authority/payloads.js';
import { observationRows } from '../../support/authority/scenarios.js';
import type { AdmissionOutcome } from '../../../apps/server/src/authority/step.js';

let runCounter = 0;
const build = (runId: string): Harness => {
  runCounter += 1;
  const built = createHarness({ runId: `${runId}-${String(runCounter)}` });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string, entityId = 'e1', epoch = 1): Harness => {
  const harness = build(runId);
  harness.core.join(entityId, epoch, SPAWN, 0);
  harness.step();
  return harness;
};

/**
 * Land an arrival *inside* the next tick, after the cutoff has been taken. The core reads its clock once per
 * tick, immediately after the cutoff, so an injection attached to that reading is an arrival that appears
 * while stage L is running.
 */
const injectDuringTick = (harness: Harness, entityId: string, sessionEpoch: number, generation: number): () => AdmissionOutcome => {
  let outcome: AdmissionOutcome | null = null;
  harness.time.onRead(() => {
    // Stamped with the run's own reading — the one the tick just took — so the recorded time basis stays
    // monotonic and the arrival remains replayable.
    outcome = harness.core.ingest(entityId, frame(sessionEpoch, generation, 1, 0), harness.time.nowMs());
  });
  return () => {
    if (outcome === null) throw new Error('the arrival was never injected — the tick took no clock reading');
    return outcome;
  };
};

const rowsFor = (harness: Harness, ordinal: number) =>
  observationRows(harness.rows()).filter((row) => row.arrivalOrdinal === ordinal);

describe('a departure disposes only of what the cutoff covers (PA1-C7)', () => {
  it('preserves an arrival that lands after the cutoff, then accounts for it at the next tick', () => {
    const harness = joined('udg-003-cutoff-leave');
    const queued = harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
    harness.core.leave('e1', harness.time.nowMs());
    const injected = injectDuringTick(harness, 'e1', 1, 2);

    const first = harness.step();
    const arrived = injected();

    // The premise: the injection really did fall outside the frozen set.
    expect(arrived.decision.ok).toBe(true);
    expect(arrived.arrival.ordinal).toBeGreaterThan(first.cutoff.ordinal);
    expect(queued.arrival.ordinal).toBeLessThanOrEqual(first.cutoff.ordinal);

    // This tick disposes of the eligible arrival only.
    const dropped = observationRows(harness.rows()).filter((row) => row.disposition === 'dropped:lifecycle');
    expect(dropped.map((row) => row.arrivalOrdinal)).toEqual([queued.arrival.ordinal]);
    expect(dropped.at(-1)?.eligibleTick).toBe(first.tick);

    // Nothing has been said about the post-cutoff arrival yet, and its bookkeeping is still held.
    expect(rowsFor(harness, arrived.arrival.ordinal)).toHaveLength(0);
    const held = harness.core.retention();
    expect(held.retiring).toBe(1);
    expect(held.queuedArrivals).toBe(1);
    expect(harness.core.view('e1')?.connected).toBe(false);
    expect(harness.core.view('e1')?.lifecycle).toBe('idle');

    // The arithmetic already balances while the residue is held: it is `stillQueued`, not lost.
    const whileHeld = harness.core.reconciliation('e1');
    expect(whileHeld.known).toBe(true);
    expect(whileHeld.stillQueued).toBe(1);
    expect(whileHeld.balanced).toBe(true);

    const aliasBefore = harness.core.aliasFor('e1');
    const second = harness.step();

    // The next eligible tick accounts for it, exactly once.
    const residue = rowsFor(harness, arrived.arrival.ordinal);
    expect(residue).toHaveLength(1);
    expect(residue.at(-1)?.disposition).toBe('dropped:lifecycle');
    expect(residue.at(-1)?.eligibleTick).toBe(second.tick);

    const settled = harness.core.retention();
    expect(settled.retiring).toBe(0);
    expect(settled.queuedArrivals).toBe(0);
    expect(settled.entities).toBe(0);
    expect(harness.core.stats().counters['dropped:lifecycle']).toBe(2);
    // The alias is not re-issued by the deferred release.
    expect(harness.core.aliasFor('e1')).toBe(aliasBefore);
    // And the entity is now gone rather than half-present.
    expect(harness.core.reconciliation('e1').known).toBe(false);
  });

  it('preserves the residue when the entity expires, and releases it one tick later', () => {
    const harness = joined('udg-003-cutoff-expiry');
    harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
    harness.core.expire('e1', harness.time.nowMs());
    const injected = injectDuringTick(harness, 'e1', 1, 2);

    const first = harness.step();
    const arrived = injected();

    expect(rowsFor(harness, arrived.arrival.ordinal)).toHaveLength(0);
    expect(harness.core.retention().retiring).toBe(1);
    expect(harness.core.view('e1')?.lifecycle).toBe('departed');
    // A departed entity is not stepped, and the residue did not make it look alive.
    expect(first.entities.at(-1)?.stepped).toBe(false);

    harness.step();
    const residue = rowsFor(harness, arrived.arrival.ordinal);
    expect(residue).toHaveLength(1);
    expect(residue.at(-1)?.disposition).toBe('dropped:lifecycle');
    expect(harness.core.retention().retiring).toBe(0);
    expect(harness.core.retention().queuedArrivals).toBe(0);
  });

  it('refuses a post-cutoff old-epoch frame on its own next tick, once', () => {
    const harness = joined('udg-003-cutoff-epoch', 'e1', 7);
    const stale = harness.core.ingest('e1', frame(6, 4, 1, 0), harness.time.nowMs());
    harness.core.epochChange('e1', 8, harness.time.nowMs());
    const injected = injectDuringTick(harness, 'e1', 6, 5);

    const first = harness.step();
    const arrived = injected();

    // The eligible old-epoch frame is refused inside the frozen set.
    const refusedNow = observationRows(harness.rows()).filter((row) => row.disposition === 'refused:epoch');
    expect(refusedNow.map((row) => row.arrivalOrdinal)).toEqual([stale.arrival.ordinal]);
    // The post-cutoff old-epoch frame is not refused by this tick. It is journalled as `queued`, which is
    // the evidence that it was preserved rather than silently dropped.
    const held = rowsFor(harness, arrived.arrival.ordinal);
    expect(held.map((row) => row.disposition)).toEqual(['queued']);
    expect(harness.core.view('e1')?.epoch).toBe(8);

    harness.step();
    const residue = rowsFor(harness, arrived.arrival.ordinal);
    expect(residue.map((row) => row.disposition)).toEqual(['queued', 'refused:epoch']);
    expect(residue.at(-1)?.reason).toBe('EPOCH_MISMATCH');
    expect(residue.at(-1)?.eligibleTick).toBe(2);
    expect(harness.core.stats().counters['refused:epoch']).toBe(2);
    // Nothing from the replaced epoch was ever stepped.
    expect(harness.core.view('e1')?.watermark).toBe(0);
    expect(first.entities.at(-1)?.stepped).toBe(true);
  });

  it('keeps a post-cutoff arrival for the association that is live when the residue settles', () => {
    // Leave and rejoin in the same tick: the residue belongs to the ended association, but the arrival that
    // landed after the cutoff belongs to whichever association is live when it settles.
    const harness = joined('udg-003-cutoff-rejoin');
    const queued = harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
    harness.core.leave('e1', harness.time.nowMs());
    harness.core.join('e1', 1, SPAWN, harness.time.nowMs());
    const injected = injectDuringTick(harness, 'e1', 1, 2);

    const first = harness.step();
    const arrived = injected();

    expect(first.entities.at(-1)?.events).toEqual(['leave', 'join']);
    // The ended association's backlog went; the post-cutoff arrival stayed.
    expect(queued.arrival.ordinal).toBeLessThanOrEqual(first.cutoff.ordinal);
    const dropped = observationRows(harness.rows()).filter((row) => row.disposition === 'dropped:lifecycle');
    expect(dropped.map((row) => row.arrivalOrdinal)).toEqual([queued.arrival.ordinal]);
    expect(rowsFor(harness, arrived.arrival.ordinal).map((row) => row.disposition)).toEqual(['queued']);
    expect(harness.core.view('e1')?.connected).toBe(true);

    const second = harness.step();
    // It is now the live association's own input: consumed, not dropped, and it moved the watermark.
    const rows = rowsFor(harness, arrived.arrival.ordinal);
    expect(rows.map((entry) => entry.disposition)).toEqual(['queued', 'consumed']);
    const row = rows.at(-1);
    expect(row?.disposition).toBe('consumed');
    expect(row?.eligibleTick).toBe(second.tick);
    expect(observationRows(harness.rows()).filter((entry) => entry.disposition === 'dropped:lifecycle')).toHaveLength(
      1,
    );
    expect(harness.core.view('e1')?.watermark).toBe(2);
    expect(harness.core.retention().retiring).toBe(0);
  });

  /**
   * Replay reproduces everything the journal can express, and this test pins the one thing it cannot.
   *
   * An arrival injected *inside* a tick has an ordinal, which places it after the departure control, but it
   * entered the queue before stage L ran, which places it before. The journal records the ordinal and the
   * cutoff — the only ordering the rules recognise — so a replay re-derives queue membership from the ordinal
   * and finds the association already released. The live run therefore holds the arrival as the ended
   * association's residue and disposes of it at the next tick; the replay refuses it at admission. Both say
   * so once, and the difference is asserted here rather than left to be discovered later: it is a property of
   * re-entrant ingest during a tick, not of the cutoff bound, and it is a Phase 2 transport obligation
   * (a host must not ingest while a tick is running) rather than something Phase 1 papers over.
   */
  it('replays the departure run and pins what an intra-tick arrival cannot reproduce', () => {
    const harness = joined('udg-003-cutoff-replay');
    const queued = harness.core.ingest('e1', frame(1, 1, 1, 0), harness.time.nowMs());
    harness.core.leave('e1', harness.time.nowMs());
    const injected = injectDuringTick(harness, 'e1', 1, 2);
    harness.step();
    const arrived = injected();
    harness.step();
    expect(harness.core.retention().queuedArrivals).toBe(0);

    const replay = harness.replay();
    expect(replay.ok).toBe(true);
    if (replay.ok === false) return;

    const shape = (rows: readonly { type: string }[]): readonly string[] =>
      rows.map((row) => {
        const entry = row as unknown as { arrivalOrdinal?: number; disposition?: string; kind?: string };
        return `${String(row.type)}:${String(entry.arrivalOrdinal ?? '')}:${String(entry.disposition ?? entry.kind ?? '')}`;
      });

    // Everything decided from the frozen set reproduces identically: the join, the eligible arrival's drop,
    // the leave event and the states and metadata of both ticks.
    const live = shape(harness.rows());
    const replayed = shape(replay.rows);
    const shared = live.indexOf(`observation:${String(queued.arrival.ordinal)}:dropped:lifecycle`) + 1;
    expect(shared).toBeGreaterThan(1);
    expect(replayed.slice(0, shared)).toEqual(live.slice(0, shared));

    // The intra-tick arrival is the disclosed divergence, and it is exactly one disposition either way.
    const liveResidue = rowsFor(harness, arrived.arrival.ordinal).map((row) => row.disposition);
    const replayResidue = observationRows(replay.rows)
      .filter((row) => row.arrivalOrdinal === arrived.arrival.ordinal)
      .map((row) => row.disposition);
    expect(liveResidue).toEqual(['dropped:lifecycle']);
    expect(replayResidue).toHaveLength(1);
    expect(replayResidue[0]).not.toBe('consumed');
    // Which is why the tips differ: an identical tip would mean the divergence had been hidden.
    expect(replay.core.chainTip).not.toBe(harness.core.chainTip);
    expect(harness.core.stats().counters['dropped:lifecycle']).toBe(2);
  });
});
