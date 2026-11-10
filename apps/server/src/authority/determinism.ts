/**
 * The injected determinism ports (P03-a).
 *
 * P03-a puts `Date.now()`, `performance.now()`, `Math.random()`, filesystem and network access in the
 * scheduler adapter and telemetry modules, never in the authority step. In Phase 1 there is no
 * production adapter yet — Phase 2 writes one — so the core is written against these two ports and
 * the test suite drives a virtual scheduler. A file inside `src/authority/**` that imports a timer,
 * a clock or `node:*` would make this directory non-reproducible, which is the property AC-3d and
 * AC-20 depend on.
 */

/**
 * The handle {@link Scheduler.set} returns.
 *
 * It carries only an identity the core never inspects: the core hands it back to `clear` and nothing
 * else, so a production adapter can map it onto whatever facility it uses.
 */
export interface ScheduledHandle {
  readonly scheduledBy: 'udg-authority-clock';
  readonly id: number;
}

/** The scheduling facility. In production this is the pinned server's declared fixed-step facility
 *  (PR-2), never a hand-rolled loop substitute. */
export interface Scheduler {
  set(callback: () => void, delayMs: number): ScheduledHandle;
  clear(handle: ScheduledHandle): void;
}

/** A monotonic millisecond source. Monotonicity is the adapter's obligation; the core only
 *  ever compares values it obtained from the same source. */
export interface TimeSource {
  nowMs(): number;
}

/**
 * A `TimeSource` whose readings are **restored from the journal** rather than measured (reviewer
 * correction 2, Phase 1).
 *
 * The terminal-request cache expires after 30 s of this source, so whether a retry lands inside the window is
 * a function of the clock, not of the message. A replay that started a fresh clock at zero would silently
 * move every retry back inside the window and could answer a request the original refused - or vice versa.
 * `toReplayInputs` therefore carries the readings the original used, and a replay drives one of these.
 *
 * Restorations are monotonic by construction: a recorded value behind the current one is counted as refused
 * rather than obeyed, so a journal with a garbled time basis fails a comparison instead of quietly replaying
 * in a different order.
 */
export class RecordedTime implements TimeSource {
  readonly #originMs: number;
  #now: number;
  #restored = 0;
  #refused = 0;

  constructor(originMs = 0) {
    this.#originMs = originMs;
    this.#now = originMs;
  }

  nowMs(): number {
    return this.#now;
  }

  get originMs(): number {
    return this.#originMs;
  }

  /** How many recorded readings have been restored, and how many were refused as non-monotonic. */
  get restoredReadings(): number {
    return this.#restored;
  }

  get refusedRestorations(): number {
    return this.#refused;
  }

  /** Restore one recorded reading. Returns `false` when it would have moved time backwards. */
  restore(atMs: number): boolean {
    if (!Number.isFinite(atMs) || atMs < this.#now) {
      this.#refused += 1;
      return false;
    }
    this.#now = atMs;
    this.#restored += 1;
    return true;
  }
}
