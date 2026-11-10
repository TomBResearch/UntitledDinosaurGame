/**
 * Scenario helpers shared by the Phase 1 suites.
 *
 * `advanceWatermark` exists because P03's traces are written from states such as "H = 19, latchedKind =
 * direct". Reaching those states must be done the way the rules allow — one accepted generation at a
 * time through the real ingest path — rather than by writing the field, which would test nothing about
 * how the watermark got there.
 */

import type { Generation, SessionEpoch } from '../../../packages/protocol/dist/index.js';
import type { Harness } from './harness.js';
import type { EntityTickOutcome } from '../../../apps/server/src/authority/step.js';
import type {
  EventRow,
  IntentionRow,
  JournalRow,
  MetaRow,
  ObservationRow,
  ResultRow,
  StateRow,
  TickRow,
} from '../../../apps/server/src/authority/types.js';
import { frame } from './payloads.js';

/**
 * How far a scenario may walk the watermark one generation at a time.
 *
 * The adopted forward window admits at most `MAX_GENERATION_FORWARD_GAP` per accepted frame, so a test
 * that wanted a watermark near `GENERATION_MAX` would need tens of millions of accepted frames. This
 * guard stops a scenario from attempting that by accident; where the domain top itself matters, the
 * suite asserts the reachable halves directly and records the rest as not exercised.
 */
export const MAX_WATERMARK_WALK = 512;

/** Accept one generation per tick until `H` reaches `generation`. */
export const advanceWatermark = (
  harness: Harness,
  entityId: string,
  sessionEpoch: SessionEpoch,
  generation: Generation,
): void => {
  if (generation - (harness.core.view(entityId)?.watermark ?? 0) > MAX_WATERMARK_WALK) {
    throw new Error(
      `refusing to walk the watermark to ${String(generation)}: no seam exists to skip ahead, ` +
        'assert the reachable property instead',
    );
  }
  for (let next = (harness.core.view(entityId)?.watermark ?? 0) + 1; next <= generation; next += 1) {
    harness.core.ingest(entityId, frame(sessionEpoch, next, 1, 0));
    harness.step();
  }
};

/** Run one tick and return the single entity's outcome. */
export const stepOne = (harness: Harness, entityId: string): EntityTickOutcome => {
  const outcome = harness.step();
  const found = outcome.entities.find((entry) => entry.entityId === entityId);
  if (found === undefined) throw new Error(`no tick outcome recorded for ${entityId}`);
  return found;
};

export const rowsOfType = <T extends JournalRow>(rows: readonly JournalRow[], type: T['type']): readonly T[] =>
  rows.filter((row): row is T => row.type === type);

export const tickRows = (rows: readonly JournalRow[]): readonly TickRow[] => rowsOfType<TickRow>(rows, 'tick');
export const intentionRows = (rows: readonly JournalRow[]): readonly IntentionRow[] =>
  rowsOfType<IntentionRow>(rows, 'intention');
export const observationRows = (rows: readonly JournalRow[]): readonly ObservationRow[] =>
  rowsOfType<ObservationRow>(rows, 'observation');
export const resultRows = (rows: readonly JournalRow[]): readonly ResultRow[] =>
  rowsOfType<ResultRow>(rows, 'result');
export const stateRows = (rows: readonly JournalRow[]): readonly StateRow[] =>
  rowsOfType<StateRow>(rows, 'state');
export const metaRows = (rows: readonly JournalRow[]): readonly MetaRow[] => rowsOfType<MetaRow>(rows, 'meta');
export const eventRows = (rows: readonly JournalRow[]): readonly EventRow[] =>
  rowsOfType<EventRow>(rows, 'event');

/** Every disposition recorded for one arrival ordinal, across the whole run. */
export const dispositionsFor = (
  rows: readonly JournalRow[],
  ordinal: number,
): readonly { disposition: string; reason: string | null }[] =>
  observationRows(rows)
    .filter((row) => row.arrivalOrdinal === ordinal)
    .map((row) => ({ disposition: row.disposition, reason: row.reason }));

/** A readable summary of the watermark trajectory, for trace assertions. */
export const watermarkTrajectory = (rows: readonly JournalRow[]): readonly number[] =>
  intentionRows(rows).map((row) => row.watermarkAfter);

export const metadataTrajectory = (
  rows: readonly JournalRow[],
): readonly { watermark: number; latchedKind: string; held: number | null }[] =>
  intentionRows(rows).map((row) => ({
    watermark: row.watermarkAfter,
    latchedKind: row.latchedKindAfter,
    held: row.heldAfter,
  }));
