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

export interface TickScheduleSample {
  readonly scheduledDelayMs: number;
  readonly driftMs: number;
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
  #lastSample: TickScheduleSample | null = null;
  #boundReached = false;
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

  /** `true` once the counter has stopped rather than wrapped (protocol.md 4.4). */
  get boundReached(): boolean {
    return this.#boundReached;
  }

  /** The most recent arming decision, recorded so the clamp is assertable rather than asserted. */
  get lastSample(): TickScheduleSample | null {
    return this.#lastSample;
  }

  /** The patch schedule is independent of the tick schedule; only its cadence is derived here (PR-10). */
  shouldPatchAfter(tick: ServerTick): boolean {
    return (tick - this.tickOrigin + 1) % this.ticksPerPatch === 0;
  }

  /** Begin arming ticks. The first callback fires one full period from now. */
  start(onTick: (tick: ServerTick) => void): void {
    if (this.#running) return;
    this.#running = true;
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
      this.#boundReached = true;
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

  #arm(onTick: (tick: ServerTick) => void): void {
    const nowMs = this.#time.nowMs();
    const remainingMs = this.#deadlineMs + this.tickDurationMs - nowMs;
    const delayMs = Math.min(this.tickDurationMs, Math.max(MIN_DELAY_MS, remainingMs));
    this.#lastSample = { scheduledDelayMs: delayMs, driftMs: nowMs - this.#deadlineMs };
    this.#handle = this.#scheduler.set(() => {
      this.#fire(onTick);
    }, delayMs);
  }

  #fire(onTick: (tick: ServerTick) => void): void {
    if (!this.#running) return;
    const firedAtMs = this.#time.nowMs();
    const driftMs = firedAtMs - (this.#deadlineMs + this.tickDurationMs);
    this.#lastFireAtMs = firedAtMs;
    // One callback, one tick. A late callback is a single late tick: the elapsed time beyond the
    // period is deliberately not converted into extra steps (P03-a). The counter itself is advanced by
    // the authority step, so the tick it executed and the tick it recorded are the same value.
    onTick(this.#tick);
    if (this.#boundReached) return;
    this.#deadlineMs = firedAtMs + this.tickDurationMs;
    this.#lastSample = { scheduledDelayMs: this.#lastSample?.scheduledDelayMs ?? 0, driftMs };
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
