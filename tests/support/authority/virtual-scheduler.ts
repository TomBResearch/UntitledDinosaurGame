/**
 * Test support for the UDG-003 Phase 1 authority core.
 *
 * P03-a puts timers and wall clocks in the scheduler adapter, so the Phase 1 suites drive these two
 * objects instead: a monotonic virtual clock and a scheduler that only fires when a test advances it.
 * Nothing here reads the real clock, which is what lets the suites assert cadence, late-firing clamps
 * and the `uint32` tick bound as measurements.
 */

import type { ScheduledHandle, Scheduler, TimeSource } from '../../../apps/server/src/authority/determinism.js';

/** A clock the test moves. */
export class VirtualTime implements TimeSource {
  #nowMs: number;

  constructor(startMs = 0) {
    this.#nowMs = startMs;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  advance(ms: number): void {
    this.#nowMs += ms;
  }

  set(ms: number): void {
    this.#nowMs = ms;
  }
}

interface ScheduledTask {
  readonly id: number;
  atMs: number;
  readonly callback: () => void;
  cancelled: boolean;
}

/** A scheduler that runs nothing until told to. */
export class VirtualScheduler implements Scheduler {
  readonly #time: VirtualTime;
  readonly #tasks: ScheduledTask[] = [];
  #nextId = 1;
  readonly history: { readonly id: number; readonly scheduledAtMs: number; readonly delayMs: number }[] = [];

  constructor(time: VirtualTime) {
    this.#time = time;
  }

  set(callback: () => void, delayMs: number): ScheduledHandle {
    const id = this.#nextId;
    this.#nextId += 1;
    const task: ScheduledTask = { id, atMs: this.#time.nowMs() + delayMs, callback, cancelled: false };
    this.#tasks.push(task);
    this.history.push({ id, scheduledAtMs: this.#time.nowMs(), delayMs });
    return { scheduledBy: 'udg-authority-clock', id };
  }

  clear(handle: ScheduledHandle): void {
    const task = this.#tasks.find((candidate) => candidate.id === handle.id);
    if (task === undefined) return;
    task.cancelled = true;
    this.#tasks.splice(this.#tasks.indexOf(task), 1);
  }

  get pending(): number {
    return this.#tasks.length;
  }

  /** Run every task that becomes due within `ms`, in deadline order, one at a time. */
  advance(ms: number): void {
    const target = this.#time.nowMs() + ms;
    for (;;) {
      const due = this.#tasks
        .filter((task) => !task.cancelled && task.atMs <= target)
        .sort((a, b) => a.atMs - b.atMs)[0];
      if (due === undefined) break;
      this.#tasks.splice(this.#tasks.indexOf(due), 1);
      this.#time.set(Math.max(this.#time.nowMs(), due.atMs));
      due.callback();
    }
    // Never backwards: a callback may itself move virtual time on, and a clock that rewinds would let a
    // suite observe an ordering the real clock could not produce.
    this.#time.set(Math.max(this.#time.nowMs(), target));
  }
}
