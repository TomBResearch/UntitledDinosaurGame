/**
 * Journal construction (P03-g, AC-14, AC-20).
 *
 * The journal is the authority record and doubles as evidence. Two properties are structural here:
 *
 * - **Replay reads inputs, never summaries.** {@link toReplayInputs} is the only projection a replay
 *   may read, and it is written field by field so that a digest cannot be read by accident. The test
 *   suite proves the property by blanking every digest in a journal and showing the replay inputs are
 *   unchanged.
 * - **Sanitisation is checked, not assumed.** Aliases replace client identity, and the scan refuses
 *   absolute paths and credential-shaped keys before a row is ever written to evidence.
 */

import { canonicalHash, computeConfigHash, movementHash, regionHash } from '@udg/config';
import type { ServerConfig } from '@udg/config';
import type { PlayerSimulationState, RejectionCode, ServerTick } from '@udg/protocol';

import type {
  ArrivalRecord,
  Disposition,
  EventRow,
  IntentionRow,
  JournalRow,
  MetaRow,
  ObservationKind,
  ObservationRow,
  PrologueRow,
  ReplayTickBoundary,
  ResultRow,
  StateRow,
  TickRow,
} from './types.js';

/** The chain starts from a fixed, content-free value so two runs with the same inputs agree. */
export const GENESIS_HASH = canonicalHash({ genesis: 'udg-003-phase-1-authority' });

/** The per-tick chain record. It is a comparison output, so it is deliberately not a `JournalRow`. */
export interface TickChainRecord {
  readonly type: 'tickChain';
  readonly tick: ServerTick;
  readonly ordinal: number;
  readonly prevHash: string;
  readonly transitionHash: string;
  readonly stateHash: string;
  readonly hash: string;
}

export interface ReplayObservation {
  readonly ordinal: number;
  readonly entityId: string;
  readonly kind: ObservationKind;
  readonly control: ArrivalRecord['control'];
  readonly declaredEpoch: number | null;
  readonly declaredGeneration: number | null;
  readonly raw: ArrivalRecord['raw'];
}

export interface ReplayInputs {
  readonly events: readonly EventRow[];
  readonly observations: readonly ReplayObservation[];
  readonly ticks: readonly ReplayTickBoundary[];
}

/** Fields whose value is a derived digest. They are outputs, so a replay must never read them. */
const DIGEST_FIELDS = ['stateHash', 'rawHash', 'hash', 'prevHash', 'transitionHash'] as const;

/** Remove every digest from a journal, for the AC-20 fixture. */
export const withDigestsBlanked = (rows: readonly JournalRow[]): readonly JournalRow[] =>
  rows.map((row) => blankDigests(row)) as readonly JournalRow[];

const blankDigests = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => blankDigests(item));
  if (typeof value !== 'object' || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((DIGEST_FIELDS as readonly string[]).includes(key)) {
      output[key] = key === 'stateHash' || key === 'rawHash' ? '' : GENESIS_HASH;
      continue;
    }
    output[key] = blankDigests(item);
  }
  return output;
};

/**
 * The only fields a replay may read (P03-g "inputs, not summaries").
 *
 * Tick boundaries come from the chain rather than the `tick` rows, because the chain has one entry per
 * executed tick even when no entity consumed anything, and a replay that silently skipped those ticks
 * would not reproduce the same watermark trajectory.
 */
export const toReplayInputs = (
  rows: readonly JournalRow[],
  chain: readonly TickChainRecord[],
): ReplayInputs => {
  const events: EventRow[] = [];
  const observations: ReplayObservation[] = [];
  const ticks: ReplayTickBoundary[] = [];
  for (const row of rows) {
    switch (row.type) {
      case 'event':
        events.push({
          type: 'event',
          arrivalOrdinal: row.arrivalOrdinal,
          alias: row.alias,
          entityId: row.entityId,
          kind: row.kind,
          epochBefore: row.epochBefore,
          epochAfter: row.epochAfter,
          eligibleTick: row.eligibleTick,
        });
        break;
      case 'observation':
        observations.push({
          ordinal: row.arrivalOrdinal,
          entityId: row.entityId,
          kind: row.kind,
          control: controlFromRaw(row),
          declaredEpoch: row.epoch,
          declaredGeneration: row.generation,
          raw: row.raw,
        });
        break;
      default:
        break;
    }
  }
  for (const record of chain) ticks.push({ tick: record.tick, cutoffOrdinal: record.ordinal });
  observations.sort((a, b) => a.ordinal - b.ordinal);
  events.sort((a, b) => a.arrivalOrdinal - b.arrivalOrdinal);
  ticks.sort((a, b) => a.tick - b.tick);
  return { events, observations, ticks };
};

const controlFromRaw = (row: ObservationRow): ArrivalRecord['control'] => {
  const control = row.raw['control'];
  if (control === undefined || control.kind !== 'value') return null;
  const value = control.value;
  return value === 'join' || value === 'leave' || value === 'expiry' || value === 'epochChange'
    ? value
    : null;
};

/**
 * AC-14: a journal of state digests alone is not a journal.
 *
 * Any run that consumed input must have produced the input, lifecycle and ordering rows P03-g names.
 * A run with no observations at all legitimately has none, so the check is conditioned on the run
 * having entity activity.
 */
export const journalCompletenessIssues = (rows: readonly JournalRow[]): readonly string[] => {
  const present = new Set(rows.map((row) => row.type));
  const issues: string[] = [];
  const hasActivity = present.has('observation') || present.has('event');
  if (present.has('state') && !hasActivity) {
    issues.push('a journal containing only state digests carries no input, lifecycle or ordering record');
  }
  if (!hasActivity) return issues;
  for (const required of ['observation', 'intention', 'tick', 'state', 'meta'] as const) {
    if (!present.has(required)) issues.push(`P03-g row type "${required}" is missing from the journal`);
  }
  return issues;
};

const FORBIDDEN_KEYS = ['token', 'cookie', 'secret', 'reconnection', 'reconnect', 'authorization', 'password'];

/** Refuse a journal that would leak a machine path or a credential into evidence. */
export const sanitisationIssues = (rows: readonly (JournalRow | TickChainRecord)[]): readonly string[] => {
  const issues: string[] = [];
  for (const row of rows) {
    const text = JSON.stringify(row);
    for (const key of FORBIDDEN_KEYS) {
      if (new RegExp(`"${key}"\\s*:`, 'i').test(text)) {
        issues.push(`journal row of type ${row.type} carries the key "${key}"`);
      }
    }
    if (/(^|["\s,])\/(home|Users|private|var|tmp|workspace)\//.test(text)) {
      issues.push(`journal row of type ${row.type} contains an absolute machine path`);
    }
  }
  return issues;
};

export interface ObservationRowInput {
  readonly alias: string;
  readonly eligibleTick: ServerTick | null;
  readonly disposition: Disposition;
  readonly reason: RejectionCode | null;
  readonly screened: boolean;
}

/** The run's journal: rows, the tick hash chain and the hashing helpers. */
export class Journal {
  readonly rows: JournalRow[] = [];
  readonly chain: TickChainRecord[] = [];
  #prevHash: string = GENESIS_HASH;

  digest(value: unknown): string {
    return canonicalHash(value);
  }

  configHash(config: Readonly<ServerConfig>): string {
    return computeConfigHash(config);
  }

  movementHash(config: Readonly<ServerConfig>): string {
    return movementHash(config);
  }

  regionHash(config: Readonly<ServerConfig>): string {
    return regionHash(config);
  }

  push(row: JournalRow): JournalRow {
    this.rows.push(row);
    return row;
  }

  observationRow(arrival: ArrivalRecord, input: ObservationRowInput): ObservationRow {
    return {
      type: 'observation',
      arrivalOrdinal: arrival.ordinal,
      eligibleTick: input.eligibleTick,
      alias: input.alias,
      entityId: arrival.entityId,
      kind: arrival.observationKind,
      epoch: arrival.declaredEpoch,
      generation: arrival.declaredGeneration,
      directIntent: directIntentOf(arrival),
      raw: arrival.raw,
      rawHash: arrival.rawHash,
      malformed: arrival.malformed,
      requestId: requestIdOf(arrival),
      payloadHash: null,
      disposition: input.disposition,
      reason: input.reason,
      screened: input.screened,
      // There is no transport in Phase 1, so there is no SDK frame identity to record. The limitation
      // is stated rather than filled in with a counter (P03-f, D-7).
      sdkFrameIdentity: null,
    };
  }

  stateRow(tick: ServerTick, entityId: string, state: Readonly<PlayerSimulationState>): StateRow {
    return { type: 'state', tick, entityId: entityId as string, state, stateHash: canonicalHash(state) };
  }

  resultRow(row: Omit<ResultRow, 'type'>): ResultRow {
    return { type: 'result', ...row };
  }

  tickRow(row: Omit<TickRow, 'type'>): TickRow {
    return { type: 'tick', ...row };
  }

  intentionRow(row: Omit<IntentionRow, 'type'>): IntentionRow {
    return { type: 'intention', ...row };
  }

  metaRow(row: Omit<MetaRow, 'type'>): MetaRow {
    return { type: 'meta', ...row };
  }

  eventRow(row: Omit<EventRow, 'type'>): EventRow {
    return { type: 'event', ...row };
  }

  prologue(row: Omit<PrologueRow, 'type'>): PrologueRow {
    return { type: 'prologue', ...row };
  }

  /** `hash = canonical(prevHash ∥ transition ∥ state)` over the tick's rows (P03-g). */
  chainTick(tick: ServerTick, ordinal: number, rows: readonly JournalRow[]): TickChainRecord {
    const transition = rows.filter((row) => row.type !== 'state');
    const states = rows.filter((row) => row.type === 'state');
    const transitionHash = canonicalHash(transition);
    const stateHash = canonicalHash(states);
    const hash = canonicalHash({ prevHash: this.#prevHash, transitionHash, stateHash });
    const record: TickChainRecord = {
      type: 'tickChain',
      tick,
      ordinal,
      prevHash: this.#prevHash,
      transitionHash,
      stateHash,
      hash,
    };
    this.chain.push(record);
    this.#prevHash = hash;
    return record;
  }

  /** The chain tip, or the genesis value for an empty run. */
  get tip(): string {
    return this.#prevHash;
  }
}

const directIntentOf = (arrival: ArrivalRecord): boolean | null => {
  const rendered = arrival.raw['directIntent'];
  if (rendered === undefined || rendered.kind !== 'value') return null;
  return typeof rendered.value === 'boolean' ? rendered.value : null;
};

const requestIdOf = (arrival: ArrivalRecord): string | null => {
  const rendered = arrival.raw['requestId'];
  if (rendered === undefined || rendered.kind !== 'value') return null;
  return typeof rendered.value === 'string' ? rendered.value : null;
};
