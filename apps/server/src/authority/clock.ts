/**
 * One fixed-step owner (P03-a).
 *
 * The room owns exactly one 20 Hz step and one 100 ms patch schedule, both read from validated
 * `ServerConfig.network`; no literal tick or patch rate appears in server source. `serverTick` is a
 * room-local counter that stops before `uint32` overflow instead of wrapping (protocol.md 4.4).
 *
 * The clock is driven through the injected {@link Scheduler}, so a test can prove the cadence, the
 * late-arrival clamp and the overflow bound without a real timer.
 */

import { UINT32_MAX } from '@udg/protocol';
import type { ServerTick } from '@udg/protocol';
import type { NetworkConfig } from '@udg/config';

import type { ScheduledHandle, Scheduler, TimeSource } from './determinism.js';

/** The smallest delay the clock will ever request, so a late tick cannot collapse into a burst. */
const MIN_DELAY_MS = 1;

export interface FixedStepClockOptions {
  readonly network: Readonly<NetworkConfig>;
  readonly scheduler: Scheduler;
  readonly time: TimeSource;
  /** Phase 1 exposes the origin so the `uint32` bound is testable; production starts at 0. */
  readonly tickOrigin?: ServerTick | undefined;
}

export type ClockFailure = 'tick-rate-not-integer-milliseconds' | 'patch-interval-not-a-whole-number-of-ticks';

/** What the clock did last: how long it armed the callback for, and how late that callback ran. */
export interface TickScheduleSample {
  readonly scheduledDelayMs: number;
  /** How far past its due time the most recent callback fired. `0` is exactly on time. */
  readonly driftMs: number;
  /** Whether the delay was clamped, which is the only way it can differ from a whole period. */
  readonly clamped: boolean;
}

/**
 * The fixed-step owner.
 *
 * `advance()` is the only thing that moves `serverTick`, and it moves it by exactly one. A late
 * callback never produces a second step, and never a catch-up run: the correction is clamped into
 * `[MIN_DELAY_MS, tickDurationMs]`, which is what "one step per tick" means when the scheduler is
 * imprecise.
 */
export class FixedStepClock {
  readonly dtSeconds: number;
  readonly tickDurationMs: number;
  readonly patchIntervalMs: number;
  readonly ticksPerPatch: number;
  readonly tickOrigin: ServerTick;

  #tick: ServerTick;
  #running = false;
  #handle: ScheduledHandle | null = null;
  #deadlineMs: number;
  #lastFireAtMs: number | null = null;
  #lastDelayMs: number | null = null;
  #lastDriftMs: number | null = null;
  readonly #network: Readonly<NetworkConfig>;
  readonly #scheduler: Scheduler;
  readonly #time: TimeSource;

  private constructor(options: FixedStepClockOptions) {
    const network = options.network;
    const origin = options.tickOrigin ?? 0;
    this.#network = network;
    this.#scheduler = options.scheduler;
    this.#time = options.time;
    this.dtSeconds = network.simulationStepSeconds;
    this.tickDurationMs = 1000 / network.tickRate;
    this.patchIntervalMs = network.statePatchIntervalMs;
    this.ticksPerPatch = this.patchIntervalMs / this.tickDurationMs;
    this.tickOrigin = origin;
    this.#tick = origin;
    this.#deadlineMs = this.#time.nowMs() + this.tickDurationMs;
  }

  /**
   * Validate the timing block before building.
   *
   * `validateNetworkConfig` has already proved `simulationStepSeconds === 1 / tickRate` for a
   * configuration that came from `@udg/config`; this check is the additional one the clock needs, that
   * the patch interval is a whole number of ticks, so the patch cadence is derived rather than rounded.
   */
  static create(options: FixedStepClockOptions): FixedStepClock | { readonly error: ClockFailure } {
    const { network } = options;
    if (!Number.isFinite(network.tickRate) || network.tickRate <= 0 || !Number.isFinite(1000 / network.tickRate)) {
      return { error: 'tick-rate-not-integer-milliseconds' };
    }
    const durationMs = 1000 / network.tickRate;
    const ticksPerPatch = network.statePatchIntervalMs / durationMs;
    if (!Number.isInteger(ticksPerPatch) || ticksPerPatch <= 0) {
      return { error: 'patch-interval-not-a-whole-number-of-ticks' };
    }
    return new FixedStepClock(options);
  }

  get tick(): ServerTick {
    return this.#tick;
  }

  get running(): boolean {
    return this.#running;
  }

  /**
   * `true` when the counter is at the bound and cannot advance, which is the state in which no further
   * tick body may run (protocol.md 4.4). It is a property of the counter, not of an attempted advance.
   */
  get boundReached(): boolean {
    return this.#tick >= UINT32_MAX;
  }

  /**
   * The most recent arming decision and the lateness of the tick that ran under it.
   *
   * Both are recorded rather than derived on demand, so a suite can assert what the clock actually asked
   * the scheduler for instead of trusting a comment about clamping (P03-a).
   */
  get lastSample(): TickScheduleSample | null {
    if (this.#lastDelayMs === null || this.#lastDriftMs === null) return null;
    return {
      scheduledDelayMs: this.#lastDelayMs,
      driftMs: this.#lastDriftMs,
      clamped: this.#lastDelayMs !== this.tickDurationMs,
    };
  }

  /** The patch schedule is independent of the tick schedule; only its cadence is derived here (PR-10). */
  shouldPatchAfter(tick: ServerTick): boolean {
    return (tick - this.tickOrigin + 1) % this.ticksPerPatch === 0;
  }

  /** Begin arming ticks. The first callback fires one full period from now. */
  start(onTick: (tick: ServerTick) => void): void {
    if (this.#running) return;
    this.#running = true;
    // The deadline is the time the next callback is due.
    this.#deadlineMs = this.#time.nowMs() + this.tickDurationMs;
    this.#arm(onTick);
  }

  stop(): void {
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.clear(this.#handle);
      this.#handle = null;
    }
  }

  /**
   * Move to the next tick, or stop at the bound instead of wrapping (protocol.md 4.4).
   *
   * Called by the authority step **after** a tick body has run, so the value the body recorded is the
   * value it executed. Returns `false` when no further tick can exist; that is the only way the loop
   * stops for a reason other than `stop()`.
   */
  advance(): boolean {
    if (this.#tick >= UINT32_MAX) {
      this.stop();
      return false;
    }
    this.#tick += 1;
    return true;
  }

  /** Whether the counter can still advance, without changing anything. */
  get atBound(): boolean {
    return this.#tick >= UINT32_MAX;
  }

  /**
   * Arm the next callback for a whole period after the deadline, which is the time the most recent tick
   * actually ran.
   *
   * That is deliberate: a stalled clock skips the periods it missed instead of running them late, because
   * every tick stands for exactly `dt` of simulated time and a burst of steps would advance the simulation
   * further than its inputs justify (P03-a). The clamp is the backstop for a scheduler that fires *early*:
   * the delay can never be zero or negative, so the loop cannot spin.
   */
  #arm(onTick: (tick: ServerTick) => void): void {
    const delayMs = Math.min(this.tickDurationMs, Math.max(MIN_DELAY_MS, this.#deadlineMs - this.#time.nowMs()));
    this.#lastDelayMs = delayMs;
    if (this.#lastDriftMs === null) this.#lastDriftMs = 0;
    this.#handle = this.#scheduler.set(() => {
      this.#fire(onTick);
    }, delayMs);
  }

  #fire(onTick: (tick: ServerTick) => void): void {
    if (!this.#running) return;
    const firedAtMs = this.#time.nowMs();
    const driftMs = firedAtMs - this.#deadlineMs;
    this.#lastFireAtMs = firedAtMs;
    this.#lastDriftMs = driftMs;
    // One callback, one tick. A late callback is a single late tick: the elapsed time beyond the
    // period is deliberately not converted into extra steps (P03-a). The counter itself is advanced by
    // the authority step, so the tick it executed and the tick it recorded are the same value.
    onTick(this.#tick);
    // At the bound there is no next tick to arm for: the loop stops here rather than firing into a
    // counter that refuses to move (protocol.md 4.4).
    if (this.boundReached) {
      this.stop();
      return;
    }
    this.#deadlineMs = firedAtMs + this.tickDurationMs;
    this.#arm(onTick);
  }

  /** The configuration this clock actually runs on, so a suite can compare advertised against used. */
  advertised(): Readonly<NetworkConfig> {
    return this.#network;
  }

  /** Elapsed whole ticks for an instant, used by telemetry rather than by the step itself. */
  elapsedTicksSince(startMs: number): number {
    const lastFireMs = this.#lastFireAtMs ?? startMs;
    return Math.max(0, Math.floor((lastFireMs - startMs) / this.tickDurationMs));
  }
}
