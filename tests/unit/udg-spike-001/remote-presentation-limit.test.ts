/**
 * UDG-SPIKE-001 review fix (2) — the initial sample limit of `createRemotePresentation` is validated with
 * the same rule the `sampleLimit` setter has always enforced: a positive integer.
 *
 * Before this, the constructor argument went straight into the retention budget. A **negative** limit made
 * the trim loop in `fold` (`while samples.length > limit, shift`) never end — shifting an empty array keeps
 * length 0, which is still greater than a negative number — and a **zero** limit trimmed every sample, so
 * `trackOf` threw "track … has no samples" on the first read. Both are boundary errors, and the boundary
 * now refuses them with the setter's error instead. The design (one bounded ring per peer, latest-first
 * window) is unchanged; these tests pin the refusal and the bounded retention itself.
 */

import { describe, expect, it } from 'vitest';

import { createRemotePresentation } from '../../../apps/client/src/network/RemotePresentation.js';
import type { RegionSnapshot, SeatObservation } from '../../../apps/client/src/network/ColyseusPredictionAdapter.js';

const peer = (tick: number, x: number): SeatObservation => ({
  key: 'peer-1',
  entityId: 'peer-1',
  sessionEpoch: 7,
  lastAuthorityTick: tick,
  x,
  y: 0,
  z: 0,
  movementMode: 1,
  movementModeName: 'direct',
  connected: true,
});

const snapshotOf = (peers: readonly SeatObservation[]): RegionSnapshot => ({
  serverTick: 1,
  deliveries: 1,
  self: null,
  peers,
  issues: [],
});

const LIMIT_ERROR = 'sampleLimit must be a positive integer';

describe('UDG-SPIKE-001 — the initial sample limit obeys the setter rule', () => {
  it('refuses every invalid initial limit at construction, before any track or trim can exist', () => {
    // A negative value previously hung the first `observe` in the trim loop and a zero left every track
    // unreadable; both are now named at the boundary, so neither state can be reached.
    for (const bad of [0, -1, -256, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createRemotePresentation(bad), `limit ${String(bad)}`).toThrow(LIMIT_ERROR);
    }
  });

  it('bounds retained samples at the initial limit and keeps the latest window', () => {
    const remote = createRemotePresentation(3);
    for (let tick = 1; tick <= 5; tick += 1) remote.observe(snapshotOf([peer(tick, tick * 0.2)]));
    const track = remote.trackOf('peer-1');
    expect(track, 'the track is readable').toBeDefined();
    if (track === undefined) return;
    expect(track.samples.length, 'retention is bounded by the initial limit').toBe(3);
    expect(track.firstSample.tick, 'the oldest two deliveries were trimmed').toBe(3);
    expect(track.lastSample.tick, 'the latest delivery is retained').toBe(5);
    expect(track.distinctTicks).toBe(3);
    expect(track.samples.map((sample) => sample.tick)).toEqual([3, 4, 5]);
  });

  it('the setter shares the rule, keeps the old limit when it refuses, and trims an existing track', () => {
    const remote = createRemotePresentation(5);
    for (let tick = 1; tick <= 5; tick += 1) remote.observe(snapshotOf([peer(tick, tick * 0.2)]));
    for (const bad of [0, -3, 2.5, Number.NaN]) {
      expect(() => remote.sampleLimit(bad), `setter refuses ${String(bad)}`).toThrow(LIMIT_ERROR);
    }
    // The refusals changed nothing: the old limit still holds and the track still reads.
    remote.observe(snapshotOf([peer(6, 1.2)]));
    expect(remote.trackOf('peer-1')?.samples.length).toBe(5);
    remote.sampleLimit(2);
    remote.observe(snapshotOf([peer(7, 1.4)]));
    const track = remote.trackOf('peer-1');
    expect(track?.samples.length, 'the tightened limit trims on the next fold').toBe(2);
    expect(track?.samples.map((sample) => sample.tick)).toEqual([6, 7]);
    expect(track?.lastSample.x).toBeCloseTo(1.4, 10);
  });

  it('the default limit constructs without an argument and still observes', () => {
    const remote = createRemotePresentation();
    remote.observe(snapshotOf([peer(1, 0.2)]));
    const track = remote.trackOf('peer-1');
    expect(track?.samples.length).toBe(1);
    expect(track?.firstSample.tick).toBe(1);
  });
});
