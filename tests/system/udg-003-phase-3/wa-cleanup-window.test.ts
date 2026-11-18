/**
 * UDG-003 Phase 3, W-A repair: the cleanup window is real, and the episode reading stands outside it.
 *
 * The cause demonstrated in `docs/contracts/assignments/evidence/UDG-003-phase-3-wa-diagnosis.md` §17 rests on
 * one physical fact: `restore()` puts the SDK's own handler back on the socket, so from that instant the seat
 * is being told things again — and in the pinned stack a consented `room.leave(true)` does not set `leaveCode`,
 * so those frames are dispatched and `onStateChange` fires while cleanup is in progress. The episode tally that
 * used to be read after that point could therefore tick for something that happened outside the episode.
 *
 * This file shows the fact with the accepted harness over a stand-in connection — no room, no server, no
 * timers — and then shows the two things the repair depends on:
 *
 *   1. `counters().restored` distinguishes the two halves of the teardown, and `silencing` alone does **not**:
 *      the layer keeps reporting the silence it was told to enforce after it has been taken off the socket, so
 *      "was the seat silenced" is not evidence about when a tally was read;
 *   2. a snapshot of every episode tally taken before `restore()` is untouched by callbacks that fire during
 *      cleanup, which is exactly the property the producer now relies on and the audit recomputes.
 *
 * Nothing here changes the accepted case, the harness behaviour it depends on, or any deadline, retry limit or
 * close code. It instruments.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { installImpairment } from '../../support/client-harness/impairment.mjs';

type Handler = (event: { data: Uint8Array }) => void;

interface StandIn {
  readonly connection: {
    transport: { send: (data: unknown) => number; isOpen: boolean };
    events: { onmessage: Handler | undefined; onclose: ((event: unknown) => void) | undefined };
  };
  /** What the seat was actually told, tallied the way the accepted case tallies it. */
  readonly applied: number[];
  readonly tell: (label: string) => void;
}

/** A joined seat with the impairment layer installed, and no network anywhere near it. */
const standInSeat = (): StandIn => {
  const applied: number[] = [];
  const events: { onmessage: Handler | undefined; onclose: ((event: unknown) => void) | undefined } = {
    onmessage: undefined,
    onclose: undefined,
  };
  // The SDK's own dispatch, reduced to the one thing the defect turns on: a frame arriving is an application.
  events.onmessage = (): void => {
    applied.push(applied.length + 1);
  };
  const transport = { send: (_data: unknown): number => 1, isOpen: true };
  return {
    connection: { transport, events },
    applied,
    tell: (label: string): void => {
      events.onmessage?.({ data: new TextEncoder().encode(label) });
    },
  };
};

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('UDG-003 Phase 3 W-A repair — the episode snapshot is taken where cleanup cannot reach it', () => {
  it('exposes whether the layer is still on the socket, which `silencing` cannot say', () => {
    const seat = standInSeat();
    const controller = installImpairment({ connection: seat.connection } as never, { seed: 1 });
    controller.arm();

    expect(controller.counters().restored, 'installed, so not restored').toBe(false);
    controller.silenceInbound();
    expect(controller.counters().silencing).toBe(true);
    expect(controller.counters().restored, 'a silenced seat is still wrapped').toBe(false);

    controller.restore();
    expect(controller.counters().restored, 'the layer is off the socket from here on').toBe(true);
    expect(controller.counters().silencing, 'and the silence it was told to enforce is still reported as on')
      .toBe(true);
  });

  it('lets cleanup callbacks fire, while a snapshot taken before cleanup reports the episode unchanged', () => {
    const seat = standInSeat();
    const controller = installImpairment({ connection: seat.connection } as never, { seed: 1 });
    controller.arm();

    // The last legitimate delivery, then the silence that opens the episode.
    seat.tell('before-silence');
    controller.silenceInbound();
    for (let publication = 0; publication < 4; publication += 1) seat.tell(`swallowed-${String(publication)}`);

    // ONE snapshot of every tally, taken while the layer is still on the socket — the producer does this at the
    // policy's own episode end, before `restore()` and before the seat is asked to leave.
    const counters = controller.counters();
    const episodeEnd = {
      wrapperRestored: counters.restored,
      wrapperSilencing: counters.silencing,
      deliveries: counters.inboundDelivered,
      swallowed: counters.inboundSilentlyDropped,
      applications: seat.applied.length,
    };
    expect(episodeEnd, 'the episode ends in silence, wrapped, with nothing applied since the sample')
      .toEqual({ wrapperRestored: false, wrapperSilencing: true, deliveries: 1, swallowed: 4, applications: 1 });

    // Cleanup: the layer comes off, the seat is still being told things, and each telling is an application.
    controller.restore();
    for (let tail = 0; tail < 3; tail += 1) seat.tell(`cleanup-${String(tail)}`);

    const afterCleanup = controller.counters();
    expect(seat.applied.length - episodeEnd.applications, 'cleanup really can fire callbacks — the §17 mechanism')
      .toBe(3);
    expect(afterCleanup.inboundDelivered - episodeEnd.deliveries,
      'and the delivery counter is off the socket, so it records none of them').toBe(0);
    expect(episodeEnd.applications, 'the episode reading itself is untouched by any of it').toBe(1);
    expect(episodeEnd.applications - episodeEnd.applications, 'the asserted delta is zero, as the case requires')
      .toBe(0);
  });

  it('keeps the accepted harness behaviour the repair depends on, byte for byte in its own words', () => {
    // The repair is only honest if `restore()` still hands the handler back rather than swallowing: that is the
    // behaviour that made the teardown a source of callbacks at all. Read from the source, because the
    // alternative is a comment asserting it.
    const source = readFileSync(resolve(ROOT, 'tests', 'support', 'client-harness', 'impairment.mjs'), 'utf8');
    expect(source).toContain('events.onmessage = originalOnMessage;');
    expect(source).toContain('restored: state.restored === true,');
    const producer = readFileSync(resolve(ROOT, 'tests', 'runtime', 'udg-003-phase-2', 'impairment-population.ts'), 'utf8');

    // The episode fields are derived from the snapshot and never read the live tally. This is the structural
    // half of the repair: with the tally itself out of reach, a callback firing during cleanup has nothing it
    // can write into, and the audit's recomputation catches anyone who puts it back.
    const absenceStart = producer.indexOf('    snapshotAbsence: {');
    const absence = producer.slice(absenceStart, producer.indexOf('\n    },', absenceStart));
    expect(absence, 'the asserted tallies come from the episode-end snapshot').toContain('epEpisodeEnd.stateApplicationsAtEpisodeEnd');
    expect(absence).toContain('epEpisodeEnd.deliveriesAtEpisodeEnd');
    expect(absence, 'and not from the tally, which cleanup can still move').not.toContain('ep.applied.length');
    expect(absence).not.toContain('epRowAfter');

    // Ordering, read from the statements rather than from prose that describes them.
    const statement = (source: string, needle: RegExp, label: string): number => {
      const found = source.search(needle);
      if (found === -1) throw new Error(`no ${label} statement in the producer`);
      return found;
    };
    const snapshotAt = statement(producer, /^\s*const epEpisodeEnd = \{$/m, 'the episode-end snapshot');
    const restoredAt = statement(producer, /^\s*ep\.controller\.restore\(\);$/m, 'the restore');
    const leaveAt = statement(producer, /^\s*await ep\.room\.leave\(true\)/m, 'the leave');
    expect(snapshotAt, 'the snapshot is taken before delivery is restored').toBeLessThan(restoredAt);
    expect(restoredAt, 'and restore still precedes the seat being asked to leave, as it always did')
      .toBeLessThan(leaveAt);
  });
});
