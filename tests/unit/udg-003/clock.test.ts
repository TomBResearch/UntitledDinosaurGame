/**
 * The fixed-step clock and the movement step (PA1-13; AC-1, AC-2, AC-3, AC-6, AC-7, protocol.md 4.4).
 *
 * Time reaches the authority only through the injected ports, so every cadence assertion here is made
 * against the virtual scheduler rather than against wall-clock waiting. A late callback is asserted to be
 * one late tick, not a burst, and the step is asserted to happen once per connected entity in ascending
 * identifier order — the ordering rule that makes a multi-entity tick reproducible.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_CONFIG } from '../../../packages/config/dist/index.js';
import type { NetworkConfig } from '../../../packages/config/dist/index.js';
import { UINT32_MAX } from '../../../packages/protocol/dist/index.js';
import { FixedStepClock } from '../../../apps/server/src/authority/clock.js';
import { SPAWN, createHarness } from '../../support/authority/harness.js';
import type { Harness } from '../../support/authority/harness.js';
import { frame } from '../../support/authority/payloads.js';
import { VirtualScheduler, VirtualTime } from '../../support/authority/virtual-scheduler.js';

let runCounter = 0;
const build = (options: Parameters<typeof createHarness>[0] = {}): Harness => {
  runCounter += 1;
  const built = createHarness({ runId: `udg-003-clock-${String(runCounter)}`, ...options });
  if ('failure' in built) throw new Error(`harness refused to build: ${built.failure}`);
  return built;
};

describe('the clock derives its timing from validated configuration (AC-7)', () => {
  it('takes dt, period and patch cadence from the configuration block', () => {
    const harness = build();
    const network = harness.config.network;
    expect(harness.clock.dtSeconds).toBe(network.simulationStepSeconds);
    expect(harness.clock.tickDurationMs).toBe(1000 / network.tickRate);
    expect(harness.clock.patchIntervalMs).toBe(network.statePatchIntervalMs);
    expect(harness.clock.ticksPerPatch).toBe(network.statePatchIntervalMs / harness.clock.tickDurationMs);
    expect(harness.clock.dtSeconds).toBe(0.05);
    expect(harness.clock.tickDurationMs).toBe(50);
    expect(harness.clock.ticksPerPatch).toBe(2);
    expect(harness.clock.advertised()).toEqual(network);
  });

  it('refuses a patch interval that is not a whole number of ticks', () => {
    const network: NetworkConfig = { ...DEFAULT_SERVER_CONFIG.network, statePatchIntervalMs: 75 };
    const time = new VirtualTime(0);
    const scheduler = new VirtualScheduler(time);
    const built = FixedStepClock.create({ network, scheduler, time });
    expect('error' in built).toBe(true);
    if (!('error' in built)) throw new Error('expected the clock to refuse');
    expect(built.error).toBe('patch-interval-not-a-whole-number-of-ticks');
  });

  it('refuses a tick rate that gives no whole-millisecond period', () => {
    const network: NetworkConfig = { ...DEFAULT_SERVER_CONFIG.network, tickRate: 0 };
    const time = new VirtualTime(0);
    const scheduler = new VirtualScheduler(time);
    const built = FixedStepClock.create({ network, scheduler, time });
    expect('error' in built).toBe(true);
  });
});

describe('cadence (AC-6, AC-3)', () => {
  it('runs exactly one tick per period and reports the patch cadence', () => {
    const harness = build();
    harness.core.join('e1', 1, SPAWN);
    harness.start();
    const period = harness.clock.tickDurationMs;
    harness.scheduler.advance(period * 200);

    expect(harness.clock.tick).toBe(200);
    expect(harness.core.tick).toBe(200);
    // One step per tick for the one connected entity, and every step carries the same dt.
    expect(harness.stepper.calls).toHaveLength(200);
    for (const call of harness.stepper.calls) expect(call.dtSeconds).toBe(0.05);

    // 20 Hz with a 100 ms patch interval is a patch every other tick, and it is derived not counted.
    // Tick rows are emitted only for ticks that reached an input decision, so cadence is asserted
    // against the clock's own rule for every tick rather than against a row count.
    expect(harness.rows().some((row) => row.type === 'tick')).toBe(true);
    for (let tick = 0; tick < 200; tick += 1) {
      expect(harness.clock.shouldPatchAfter(tick)).toBe((tick + 1) % 2 === 0);
    }
    harness.stop();
    const before = harness.clock.tick;
    harness.scheduler.advance(period * 10);
    expect(harness.clock.tick).toBe(before);
  });

  it('treats a late callback as one late tick, never as a burst (P03-a)', () => {
    const harness = build();
    harness.core.join('e1', 1, SPAWN);
    harness.start();
    harness.scheduler.advance(50);
    expect(harness.clock.tick).toBe(1);
    const sample = harness.clock.lastSample;
    expect(sample).toEqual({ scheduledDelayMs: 50, driftMs: 0, clamped: false });

    // Time passes without the callback running: a real event loop stall.
    harness.time.advance(1_000);
    harness.scheduler.advance(0);
    expect(harness.clock.tick).toBe(2);
    // One callback ran, and the missed elapsed time was not converted into extra steps.
    expect(harness.stepper.calls).toHaveLength(2);
    const late = harness.clock.lastSample;
    // The callback was due at 100 ms and ran at 1050 ms, so the lateness is exactly the stall.
    expect(late?.driftMs).toBe(950);
    // The next callback is armed a whole period after the late fire: the missed periods are skipped,
    // not replayed, because each tick stands for exactly dt.
    expect(late?.scheduledDelayMs).toBe(50);
    expect(late?.clamped).toBe(false);
    // The next delay is clamped into [1, tickDurationMs], so the clock does not spin to catch up.
    harness.scheduler.advance(50);
    expect(harness.clock.tick).toBe(3);
    expect(harness.stepper.calls).toHaveLength(3);
    // And every step still used exactly dt.
    for (const call of harness.stepper.calls) expect(call.dtSeconds).toBe(0.05);
  });

  it('floors the next delay when the tick body itself ate the period, and still runs one tick at a time', () => {
    const time = new VirtualTime(0);
    const scheduler = new VirtualScheduler(time);
    const clock = FixedStepClock.create({ network: DEFAULT_SERVER_CONFIG.network, scheduler, time });
    if ('error' in clock) throw new Error(`clock refused: ${clock.error}`);
    let ticks = 0;
    clock.start(() => {
      ticks += 1;
      // A tick body that overran its whole period: the clock must not spin trying to recover.
      time.advance(60);
    });
    scheduler.advance(50);
    expect(ticks).toBe(1);
    expect(clock.lastSample).toEqual({ scheduledDelayMs: 1, driftMs: 0, clamped: true });
    scheduler.advance(1);
    expect(ticks).toBe(2);
    clock.stop();
    scheduler.advance(1_000);
    expect(ticks).toBe(2);
  });

  it('stops at the uint32 bound instead of wrapping (protocol.md 4.4)', () => {
    const harness = build({ tickOrigin: UINT32_MAX - 1 });
    harness.core.join('e1', 1, SPAWN);

    const first = harness.step();
    expect(first.tick).toBe(UINT32_MAX - 1);
    expect(first.stopped).toBe(false);
    // The tick *at* the bound is the last one that can exist: `atBound` is a property of the counter, and
    // the tick body declines to run rather than wrap (protocol.md 4.4).
    const second = harness.step();
    expect(second.tick).toBe(UINT32_MAX);
    expect(second.stopped).toBe(true);

    expect(harness.clock.boundReached).toBe(true);
    const calls = harness.stepper.calls.length;
    const rows = harness.rows().length;
    const third = harness.step();
    expect(third.stopped).toBe(true);
    expect(harness.clock.tick).toBe(UINT32_MAX);
    expect(harness.core.tick).toBe(UINT32_MAX);
    // No further tick body runs at all: no step, no new journal rows.
    expect(harness.stepper.calls.length).toBe(calls);
    expect(harness.rows().length).toBe(rows);
    // The armed clock stops too, so nothing keeps firing into a stopped counter.
    expect(harness.clock.running).toBe(false);
  });
});

describe('the movement step (AC-3, AC-2)', () => {
  it('steps every connected entity exactly once, in ascending entityId order', () => {
    const harness = build();
    // Deliberately joined out of order, so the ordering rule is what decides the sequence.
    for (const entityId of ['charlie', 'alpha', 'bravo']) harness.core.join(entityId, 1, SPAWN);
    harness.step();
    const joinedOrder = harness.stepper.calls.map((call) => call.entityId);
    expect(joinedOrder).toEqual(['alpha', 'bravo', 'charlie']);

    harness.stepper.calls.length = 0;
    harness.core.ingest('alpha', frame(1, 1, 1, 0));
    harness.core.ingest('bravo', frame(1, 1, 0, 1));
    const outcome = harness.step();
    expect(outcome.entities.map((entry) => entry.entityId)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(harness.stepper.calls.map((call) => call.entityId)).toEqual(['alpha', 'bravo', 'charlie']);
    for (const entityId of ['alpha', 'bravo', 'charlie']) {
      expect(harness.stepper.calls.filter((call) => call.entityId === entityId)).toHaveLength(1);
    }
    expect(outcome.entities.every((entry) => entry.stepped)).toBe(true);
  });

  it('does not step a disconnected entity, and steps the rest', () => {
    const harness = build();
    harness.core.join('a', 1, SPAWN);
    harness.core.join('b', 1, SPAWN);
    harness.step();
    harness.core.leave('a');
    harness.step();
    harness.stepper.calls.length = 0;

    harness.core.ingest('a', frame(1, 2, 1, 0));
    harness.core.ingest('b', frame(1, 2, 1, 0));
    const outcome = harness.step();
    expect(harness.stepper.calls.map((call) => call.entityId)).toEqual(['b']);
    const outcomes = new Map(outcome.entities.map((entry) => [entry.entityId, entry]));
    expect(outcomes.get('a')?.stepped).toBe(false);
    expect(outcomes.get('b')?.stepped).toBe(true);
    expect(outcomes.get('a')?.consumed).toBeNull();
  });

  it('reports the displacement it resolved, so AC-2 is measured and not assumed', () => {
    const harness = build();
    harness.core.join('e1', 1, SPAWN);
    harness.step();
    harness.core.ingest('e1', frame(1, 1, 1, 0));
    const outcome = harness.step();
    const entity = outcome.entities[0];
    const speed = harness.config.movement.speed;
    expect(entity?.desiredDisplacement).toBeCloseTo(speed * harness.clock.dtSeconds, 12);
    expect(entity?.displacement).toBe(entity?.desiredDisplacement);
    const position = harness.core.view('e1')?.state.locomotion.kinematic.position;
    expect(position).toEqual({ x: entity?.displacement ?? 0, y: 0, z: 0 });
    // The velocity the state carries is horizontal only (AC-4).
    const velocity = harness.core.view('e1')?.state.locomotion.kinematic.velocity;
    expect(velocity?.y).toBe(0);
  });
});
