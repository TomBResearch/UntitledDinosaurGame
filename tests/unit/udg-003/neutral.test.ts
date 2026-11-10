/**
 * The neutral rule, keepalive invariance and the per-tick displacement bound
 * (PA1-6, PA1-7, PA1-8; AC-2, AC-4, AC-11).
 *
 * The neutral rule is the safety property that makes UDG-003's authority honest without locomotion: an
 * entity with no committed direct intention this tick must stop, and the only lever that could make it
 * drift is a latch or a held sample being re-applied. Every scenario here therefore measures the
 * displacement the reference stepper reported, not a claim in a comment.
 */

import { describe, expect, it } from 'vitest';

import { SPAWN, createHarness } from '../../support/authority/harness.js';
import { cancel, frame, keepalive, moveTo } from '../../support/authority/payloads.js';
import { advanceWatermark, stepOne } from '../../support/authority/scenarios.js';

const build = (runId: string) => {
  const built = createHarness({ runId });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

const joined = (runId: string) => {
  const harness = build(runId);
  harness.core.join('e1', 1, SPAWN);
  harness.step();
  return harness;
};

describe('keepalive invariance (P03-d, T-5, AC-11)', () => {
  it('a keepalive is consumed as an observation and changes no authority metadata', () => {
    const harness = joined('udg-003-keepalive-invariant');

    harness.core.ingest('e1', keepalive(1, 0));
    const quiet = stepOne(harness, 'e1');
    expect(quiet.consumed).not.toBeNull();
    expect(quiet.inputSource).toBe('keepalive');
    expect(quiet.drive).toBe('NONE');
    expect(quiet.mode).toBe('idle');
    expect(quiet.watermark).toBe(0);
    expect(quiet.latchedKind).toBe('none');
    expect(quiet.held).toBeNull();
    expect(quiet.displacement).toBe(0);

    // An ordinary direct frame advances the watermark and latches direct.
    harness.core.ingest('e1', frame(1, 1, 1, 0));
    const driven = stepOne(harness, 'e1');
    expect(driven.watermark).toBe(1);
    expect(driven.latchedKind).toBe('direct');
    expect(driven.held).toBe(1);
    expect(driven.drive).toEqual({ moveX: 1, moveZ: 0 });

    // A keepalive at the held generation: consumed, and metadata is exactly as it was.
    const before = harness.core.view('e1');
    harness.core.ingest('e1', keepalive(1, 1));
    const held = stepOne(harness, 'e1');
    expect(held.consumed).not.toBeNull();
    expect(held.inputSource).toBe('keepalive');
    expect(held.drive).toBe('NONE');
    expect(held.mode).toBe('idle');
    expect(held.watermark).toBe(before?.watermark);
    expect(held.latchedKind).toBe(before?.latchedKind);
    expect(held.held).toBe(before?.heldDirectGeneration);
    expect(held.displacement).toBe(0);

    // And because the held sample survives, the same generation can drive again afterwards.
    harness.core.ingest('e1', frame(1, 1, 0, 1));
    const resumed = stepOne(harness, 'e1');
    expect(resumed.drive).toEqual({ moveX: 0, moveZ: 1 });
    expect(resumed.watermark).toBe(1);
  });

  it('a zero-axis frame is an ordinary observation and produces no drive (AC-11)', () => {
    const harness = joined('udg-003-zero-axis');
    harness.core.ingest('e1', frame(1, 1, 0, 0));
    const outcome = stepOne(harness, 'e1');
    expect(outcome.consumed).not.toBeNull();
    expect(outcome.drive).toBe('NONE');
    expect(outcome.mode).toBe('idle');
    expect(outcome.displacement).toBe(0);
    // It is not a keepalive: it declares an intention, so the latch is not revived by it.
    expect(outcome.inputSource).not.toBe('keepalive');
  });
});

describe('neutral rule and input removal (AC-4, T-7)', () => {
  it('removing the input stops the entity on the next tick, with no drift', () => {
    const harness = joined('udg-003-input-removed');
    harness.core.ingest('e1', frame(1, 1, 1, 1));
    const driven = stepOne(harness, 'e1');
    expect(driven.displacement).toBeGreaterThan(0);
    const afterDrive = harness.core.view('e1')?.state.locomotion;

    const idle = stepOne(harness, 'e1');
    expect(idle.stepped).toBe(true); // AC-3: the entity is still stepped, with no input
    expect(idle.drive).toBe('NONE');
    expect(idle.mode).toBe('idle');
    expect(idle.displacement).toBe(0);

    const state = harness.core.view('e1')?.state.locomotion;
    expect(state?.kinematic.position).toEqual(afterDrive?.kinematic.position);
    expect(state?.kinematic.yaw).toBe(afterDrive?.kinematic.yaw);
    expect(state?.kinematic.velocity).toEqual({ x: 0, y: 0, z: 0 });
    // No vertical motion is invented by the authority (AC-4).
    expect(state?.kinematic.position.y).toBe(0);
    expect(state?.kinematic.verticalVelocity).toBe(0);
  });

  it('T-7: every no-winner branch steps once, reports NONE and changes no metadata', () => {
    const cases: readonly {
      readonly name: string;
      readonly setup: (harness: ReturnType<typeof build>) => void;
      readonly inputSource: string;
    }[] = [
      { name: 'no observation at all', setup: () => undefined, inputSource: 'neutral' },
      { name: 'keepalive only', setup: (h) => h.core.ingest('e1', keepalive(1, 3)), inputSource: 'keepalive' },
      {
        name: 'observation refused by the generation window',
        setup: (h) => h.core.ingest('e1', frame(1, 1, 1, 0)),
        inputSource: 'rejected',
      },
      {
        // `inputSource` describes the continuous observation this tick consumed. A discrete request
        // consumes none, so the source is 'neutral' even though the request itself was refused.
        name: 'discrete request refused by navigation',
        setup: (h) => h.core.ingest('e1', moveTo('r-neutral', 1, 4, { x: 1, y: 1, z: 1 })),
        inputSource: 'neutral',
      },
      {
        name: 'discrete request answered from the terminal cache',
        setup: (h) => {
          h.core.ingest('e1', moveTo('r-cached', 1, 4, { x: 1, y: 1, z: 1 }));
          h.step();
          h.core.ingest('e1', moveTo('r-cached', 1, 4, { x: 1, y: 1, z: 1 }));
        },
        inputSource: 'neutral',
      },
    ];

    for (const scenario of cases) {
      const harness = joined(`udg-003-t7-${scenario.name.replace(/[^a-z0-9]+/g, '-')}`);
      advanceWatermark(harness, 'e1', 1, 3);
      // The snapshot is taken *after* the setup, because some setups legitimately run a tick of their
      // own (the cached case must first produce the record it will later replay).
      scenario.setup(harness);
      const before = harness.core.view('e1');
      const calls = harness.stepper.calls.length;
      const outcome = stepOne(harness, 'e1');

      expect(harness.stepper.calls.length - calls, scenario.name).toBe(1);
      expect(outcome.drive, scenario.name).toBe('NONE');
      expect(outcome.mode, scenario.name).toBe('idle');
      // The mode the tick *started* in is the recorded one; what the neutral rule guarantees is that it
      // ends idle. Reaching these scenarios through accepted input leaves 'direct' behind, which is the
      // case worth asserting rather than hiding.
      expect(outcome.modeBefore, scenario.name).toBe(before?.state.locomotion.mode);
      expect(outcome.watermark, scenario.name).toBe(before?.watermark);
      expect(outcome.latchedKind, scenario.name).toBe(before?.latchedKind);
      expect(outcome.held, scenario.name).toBe(before?.heldDirectGeneration);
      expect(outcome.displacement, scenario.name).toBe(0);
      expect(outcome.inputSource, scenario.name).toBe(scenario.inputSource);
      expect(outcome.candidates, scenario.name).toHaveLength(0);
      expect(harness.core.reconciliation('e1').balanced, scenario.name).toBe(true);
    }
  });

  it('a committed cancel clears the latch so the following tick is neutral', () => {
    const harness = joined('udg-003-cancel-then-neutral');
    advanceWatermark(harness, 'e1', 1, 2);
    harness.core.ingest('e1', cancel('c1', 1, 3));
    const cancelled = stepOne(harness, 'e1');
    expect(cancelled.watermark).toBe(3);
    expect(cancelled.latchedKind).toBe('cancel');
    expect(cancelled.held).toBeNull();
    expect(cancelled.drive).toBe('NONE');

    const next = stepOne(harness, 'e1');
    expect(next.drive).toBe('NONE');
    expect(next.displacement).toBe(0);
    expect(next.mode).toBe('idle');
  });
});

describe('per-tick displacement bound (AC-2)', () => {
  it('never exceeds speed x dt for any admitted drive', () => {
    const harness = joined('udg-003-displacement-bound');
    const speed = harness.config.movement.speed;
    const bound = speed * harness.clock.dtSeconds;
    const axes: readonly [number, number][] = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [0, 0],
    ];
    let generation = 0;
    for (const [x, z] of axes) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        generation += 1;
        harness.core.ingest('e1', frame(1, generation, x, z));
        const outcome = stepOne(harness, 'e1');
        expect(outcome.desiredDisplacement, `${String(x)},${String(z)} x${String(repeat)}`).toBeLessThanOrEqual(
          bound + 1e-12,
        );
        expect(outcome.displacement).toBeLessThanOrEqual(bound + 1e-12);
        expect(outcome.dtSeconds).toBe(harness.clock.dtSeconds);
      }
    }
    // A diagonal drive is normalised, so it does not move faster than an axis drive.
    const diagonal = harness.stepper.calls.filter((call) => call.driveX !== 0 && call.driveZ !== 0);
    expect(diagonal.length).toBeGreaterThan(0);
    for (const call of diagonal) {
      expect(Math.hypot(call.driveX, call.driveZ)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});
