/**
 * A `JournalSink` that keeps everything (test support only).
 *
 * The authority core retains no journal of its own — rows and tick-chain records are handed to an injected
 * sink as they are produced (reviewer correction 3). Suites still need the whole journal to compare, replay
 * and hash, so they inject this collector and read it back. The distinction is the point: growth here is a
 * test's own choice, not a property of the running authority.
 */

import type { JournalSink, TickChainRecord } from '../../../apps/server/src/authority/journal.js';
import type { JournalRow } from '../../../apps/server/src/authority/types.js';

export class JournalCollector implements JournalSink {
  #rows: JournalRow[] = [];
  #chain: TickChainRecord[] = [];

  recordRow(row: JournalRow): void {
    this.#rows.push(row);
  }

  recordTickChain(record: TickChainRecord): void {
    this.#chain.push(record);
  }

  rows(): readonly JournalRow[] {
    return this.#rows;
  }

  chain(): readonly TickChainRecord[] {
    return this.#chain;
  }

  get rowCount(): number {
    return this.#rows.length;
  }

  get chainLength(): number {
    return this.#chain.length;
  }

  /** Every row of one type, in the order it was written. */
  ofType<K extends JournalRow['type']>(type: K): Extract<JournalRow, { type: K }>[] {
    return this.#rows.filter((row) => row.type === type) as Extract<JournalRow, { type: K }>[];
  }

  /** Forget everything: the collector's own retention is a test concern, not the core's. */
  reset(): void {
    this.#rows = [];
    this.#chain = [];
  }
}

/** Serialise a collected journal and read it back, which is what "persisted evidence" means in a test. */
export const roundTripRows = (rows: readonly JournalRow[]): readonly JournalRow[] =>
  JSON.parse(JSON.stringify(rows)) as readonly JournalRow[];

/** The same for the tick chain, whose `atMs` the replay needs. */
export const roundTripChain = (chain: readonly TickChainRecord[]): readonly TickChainRecord[] =>
  JSON.parse(JSON.stringify(chain)) as readonly TickChainRecord[];
