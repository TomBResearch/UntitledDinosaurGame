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
