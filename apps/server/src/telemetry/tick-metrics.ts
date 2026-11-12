/**
 * Tick, queue-depth and disposition metrics (UDG-003 Phase 2, W-11; GA-1, GA-2, GA-11 evidence).
 *
 * P03-a places wall-clock readings in telemetry, never in the authority step: this module may read
 * the server clock precisely because nothing it records can change a decision. It records what the
 * transport and the accepted core already reported; it computes no new authority fact. Depth
 * history is what GA-1 (`depth < 32` throughout) and GA-11 (jitter/overrun populations) are
 * measured from, so the samples are ring-buffered rather than aggregated away.
 */

import type { InputSignal } from '../network/ColyseusInputAdapter.js';

export interface TickSample {
  readonly tick: number;
  readonly atMs: number;
  readonly stepDurationMs: number;
  readonly entities: number;
  readonly depths: readonly { readonly entityId: string; readonly size: number }[];
  readonly maxDepth: number;
  readonly consumed: readonly string[];
  readonly retiredTotal: number;
  readonly signals: readonly { readonly entityId: string; readonly signal: InputSignal }[];
  readonly closedSeats: readonly string[];
}

/** Bounded so a long run's telemetry cannot become its own leak (mirrors the core's own discipline). */
export class TickMetrics {
  readonly #samples: TickSample[] = [];
  readonly #limit: number;
  #maxDepthEver = 0;
  #ticks = 0;
  #consumedTotal = 0;
  #closedTotal = 0;
  readonly #signalCounts = new Map<InputSignal, number>();

  constructor(sampleLimit = 4096) {
    this.#limit = sampleLimit;
  }

  record(sample: TickSample): void {
    this.#ticks += 1;
    this.#consumedTotal += sample.consumed.length;
    this.#closedTotal += sample.closedSeats.length;
    if (sample.maxDepth > this.#maxDepthEver) this.#maxDepthEver = sample.maxDepth;
    for (const entry of sample.signals) {
      this.#signalCounts.set(entry.signal, (this.#signalCounts.get(entry.signal) ?? 0) + 1);
    }
    this.#samples.push(sample);
    if (this.#samples.length > this.#limit) this.#samples.shift();
  }

  get ticks(): number {
    return this.#ticks;
  }

  get consumedTotal(): number {
    return this.#consumedTotal;
  }

  get closedTotal(): number {
    return this.#closedTotal;
  }

  get maxDepthEver(): number {
    return this.#maxDepthEver;
  }

  signalCount(signal: InputSignal): number {
    return this.#signalCounts.get(signal) ?? 0;
  }

  /** Every retained sample, oldest first (copies: readers never see live arrays). */
  samples(): readonly TickSample[] {
    return this.#samples.map((sample) => ({ ...sample, depths: [...sample.depths], consumed: [...sample.consumed], signals: [...sample.signals], closedSeats: [...sample.closedSeats] }));
  }

  /** The machine-readable shape the Phase 2 vectors commit. No wall-clock values beyond relative durations. */
  summary(): Record<string, unknown> {
    return {
      ticks: this.#ticks,
      consumedTotal: this.#consumedTotal,
      closedTotal: this.#closedTotal,
      maxDepthEver: this.#maxDepthEver,
      signals: Object.fromEntries([...this.#signalCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    };
  }
}
