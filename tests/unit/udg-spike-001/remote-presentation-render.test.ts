/**
 * UDG-SPIKE-001 slice 4 — read-only peer INTERPOLATION.
 *
 * The rule under test: remote presentation follows the PUBLISHED samples and never authors
 * motion. Between two arrived samples the render pose is their blend; before the first it is the
 * first; past the newest it HOLDS — extrapolation would be prediction wearing an observer's
 * clothes. Delay and discontinuity are reported as separate metrics, because "how far behind am
 * I rendering" and "how big was the biggest visual jump" are different failure modes.
 */

import { describe, expect, it } from 'vitest';

import { createRemotePresentation } from '../../../apps/client/src/network/RemotePresentation.js';
import type { RegionSnapshot, SeatObservation } from '../../../apps/client/src/network/ColyseusPredictionAdapter.js';

const peer = (tick: number, x: number, z: number): SeatObservation => ({
  key: 'peer-1',
  entityId: 'peer-1',
  sessionEpoch: 7,
  lastAuthorityTick: tick,
  x,
  y: 0,
  z,
  movementMode: 1,
  movementModeName: 'direct',
  connected: true,
  inputResolvedThrough: 0,
  inputGapStart: 0,
  inputGapEnd: 0,
  inputRetiredUnrepresented: 0,
});

const snapshot = (rows: readonly SeatObservation[]): RegionSnapshot => ({
  serverTick: rows.length,
  deliveries: rows.length,
  self: null,
  peers: rows,
  issues: [],
});

describe('UDG-SPIKE-001 — peer interpolation follows published samples and never extrapolates', () => {
  const scenario = () => {
    let now = 0;
    const presentation = createRemotePresentation(64, () => now);
    now = 100;
    presentation.observe(snapshot([peer(10, 0, 0)]));
    now = 300;
    presentation.observe(snapshot([peer(11, 1, 0)]));
    return { presentation, setNow: (value: number) => { now = value; } };
  };

  it('blends linearly between the two published samples', () => {
    const { presentation, setNow } = scenario();
    setNow(300);
    const mid = presentation.renderPose('peer-1', 300, 100);
    expect(mid).toBeDefined();
    // target 200 sits halfway between arrivals at 100 and 300.
    expect(mid?.alpha).toBeCloseTo(0.5, 10);
    expect(mid?.x).toBeCloseTo(0.5, 10);
    expect(mid?.holding).toBe(false);
    expect(mid?.fromTick).toBe(10);
    expect(mid?.toTick).toBe(11);
  });

  it('never extrapolates past the newest sample; it holds', () => {
    const { presentation, setNow } = scenario();
    setNow(10_000);
    const held = presentation.renderPose('peer-1', 10_000, 0);
    expect(held?.holding).toBe(true);
    expect(held?.x).toBe(1);
    expect(held?.alpha).toBe(1);
    const stats = presentation.renderStats('peer-1');
    expect(stats?.holds).toBe(1);
    expect(stats?.maxHoldMs).toBe(10_000 - 300);
  });

  it('clamps before the oldest arrival instead of inventing motion backwards', () => {
    const { presentation, setNow } = scenario();
    setNow(150);
    const early = presentation.renderPose('peer-1', 150, 100);
    expect(early?.x).toBe(0);
    expect(early?.holding).toBe(false);
    expect(early?.alpha).toBe(0);
  });

  it('reports render discontinuity separately from delay', () => {
    const { presentation, setNow } = scenario();
    setNow(310);
    presentation.renderPose('peer-1', 310, 0); // holds at x=1
    // A teleport: the publisher moves 100 m in one sample.
    setNow(500);
    presentation.observe(snapshot([peer(12, 101, 0)]));
    setNow(510);
    presentation.renderPose('peer-1', 510, 0);
    const stats = presentation.renderStats('peer-1');
    expect(stats?.maxRenderJump).toBeCloseTo(100, 6);
    expect(stats?.renders).toBe(2);
  });

  it('serves no pose for an unseen peer and mutates nothing it received', () => {
    const { presentation } = scenario();
    expect(presentation.renderPose('ghost', 100, 0)).toBeUndefined();
    const track = presentation.trackOf('peer-1');
    const before = JSON.stringify(track?.samples ?? []);
    presentation.renderPose('peer-1', 250, 50);
    expect(JSON.stringify(presentation.trackOf('peer-1')?.samples ?? [])).toBe(before);
  });
});
