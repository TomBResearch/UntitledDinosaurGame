/**
 * UDG-SPIKE-001 slice 22 — the SAME-FRAME render rule must decline an intentionally-ahead
 * observer and accept a delayed one (the reviewer's mandated demonstration), and it must name
 * backwards jumps separately from delay. Pure unit level: no browser, no timers.
 */
import { describe, expect, it } from 'vitest';
import { assessObserverRenderSeries, type ObserverRenderFrame } from '../../../tools/load-test/src/render-lag.js';

const frame = (over: Partial<ObserverRenderFrame>): ObserverRenderFrame => ({
  atMs: 0, sessionId: 'seat-m', epoch: 1,
  authorityTick: 100, fromTick: 99, toTick: 99, alpha: 0.5,
  holding: false, howOldMs: 50, ...over,
});

describe('UDG-SPIKE-001 render-lag — same-frame boundary assessment', () => {
  it('an INTENTIONALLY AHEAD observer (render target past the latest validated authority) FAILS', () => {
    const ahead = assessObserverRenderSeries([
      frame({ atMs: 0, authorityTick: 100, toTick: 101, holding: true }),
      frame({ atMs: 16, authorityTick: 100, toTick: 102, holding: true }),
    ]);
    expect(ahead.aheadFrames).toBe(2);
    expect(ahead.noExtrapolation).toBe(false);
    expect(ahead.minLagTicks).toBe(-2); // negative lag IS the aheadness, visible not hidden
  });

  it('an alpha > 1 pose (blend beyond the second sample) is extrapolation and FAILS', () => {
    const s = assessObserverRenderSeries([frame({ alpha: 1.25, toTick: 100 })]);
    expect(s.aheadFrames).toBe(1);
    expect(s.noExtrapolation).toBe(false);
  });

  it('a DELAYED observer (pose behind validated authority, holding included) PASSES with delay recorded', () => {
    const delayed = assessObserverRenderSeries([
      frame({ atMs: 0, authorityTick: 100, toTick: 96, alpha: 1, holding: true, howOldMs: 120 }),
      frame({ atMs: 100, authorityTick: 101, toTick: 98, alpha: 0.4 }),
      frame({ atMs: 200, authorityTick: 102, toTick: 100, alpha: 0.9 }),
    ]);
    expect(delayed.noExtrapolation).toBe(true);
    expect(delayed.aheadFrames).toBe(0);
    expect(delayed.minLagTicks).toBe(2);
    expect(delayed.maxLagTicks).toBe(4);
    expect(delayed.discontinuities).toBe(0); // behind-but-advancing is delay, NOT discontinuity
  });

  it('a backwards render-target jump inside one epoch is a DISCONTINUITY, reported apart from delay', () => {
    const back = assessObserverRenderSeries([
      frame({ atMs: 0, authorityTick: 100, toTick: 95 }),
      frame({ atMs: 100, authorityTick: 101, toTick: 99 }),
      frame({ atMs: 200, authorityTick: 102, toTick: 97 }), // regressed render target
    ]);
    expect(back.discontinuities).toBe(1);
    expect(back.noExtrapolation).toBe(true); // delay semantics unaffected — reported separately
  });

  it('a tick regression ACROSS an epoch boundary is a new timeline, not a discontinuity', () => {
    const epochChange = assessObserverRenderSeries([
      frame({ atMs: 0, epoch: 1, authorityTick: 100, toTick: 100, holding: true }),
      frame({ atMs: 100, epoch: 2, authorityTick: 3, toTick: 3, holding: true }),
    ]);
    expect(epochChange.discontinuities).toBe(0);
    expect(epochChange.epochs).toEqual([1, 2]);
  });

  it('a mixed-identity series is REFUSED outright, never averaged', () => {
    expect(() => assessObserverRenderSeries([
      frame({}), frame({ sessionId: 'seat-other' }),
    ])).toThrow(/identities/u);
  });

  it('an EMPTY series can never present as a passing window', () => {
    const empty = assessObserverRenderSeries([]);
    expect(empty.frames).toBe(0);
    expect(empty.noExtrapolation).toBe(false);
  });
});
