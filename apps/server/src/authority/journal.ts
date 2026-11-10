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
  ArrivalOrigin,
  ControlKind,
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

/**
 * Where a journal and its tick chain go (reviewer correction 3, Phase 1).
 *
 * The authority must not be the thing that remembers its own history: a long run with repeated joins and
 * expiries would otherwise grow an array of every row ever written, which is exactly the "state that grows
 * with the run" P03-g forbids inside the step. The core therefore hands each row to an injected sink the
 * moment it exists and retains only the chain tip.
 *
 * A sink that keeps everything in an array is a legitimate *consumer* - the test harness and the evidence
 * capture both are one - but it is a consumer, and its growth is its own business, not the authority's.
 */
export interface JournalSink {
  recordRow(row: JournalRow): void;
  recordTickChain(record: TickChainRecord): void;
}

/** A sink that discards everything: the shape a caller uses when it wants cadence, not evidence. */
export const discardingSink = (): JournalSink => ({
  recordRow: () => undefined,
  recordTickChain: () => undefined,
});

/** The per-tick chain record. It is a comparison output, so it is deliberately not a `JournalRow`. */
export interface TickChainRecord {
  readonly type: 'tickChain';
  readonly tick: ServerTick;
  readonly ordinal: number;
  readonly prevHash: string;
  readonly transitionHash: string;
  readonly stateHash: string;
  readonly hash: string;
  /**
   * The `TimeSource` reading the tick body ran under (reviewer correction 2).
   *
   * It is carried here rather than in the `tick` rows because the chain has exactly one entry per executed
   * tick while `tick` rows exist only for entities that consumed something. It is deliberately **not** mixed
   * into `hash`: the chain hashes state and decisions, and two runs that decided identically under different
   * clock readings must still agree.
   */
  readonly atMs: number;
}

export interface ReplayObservation {
  readonly ordinal: number;
  readonly entityId: string;
  readonly kind: ObservationKind;
  /**
   * The lifecycle operation to replay, and nothing else can supply it: `null` unless the row says it came
   * from the server. A client payload that carries a `control` field is fed back as a client message and is
   * refused again for the same reason (reviewer correction 1).
   */
  readonly control: ControlKind | null;
  readonly origin: ArrivalOrigin;
  readonly declaredEpoch: number | null;
  readonly declaredGeneration: number | null;
  readonly raw: ArrivalRecord['raw'];
  /** The reading the original recorded this arrival at, restored before it is fed again. */
  readonly atMs: number;
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
      case 'event': {
        if (events.some((entry) => entry.arrivalOrdinal === row.arrivalOrdinal)) break;
        events.push({
          type: 'event',
          arrivalOrdinal: row.arrivalOrdinal,
          alias: row.alias,
          entityId: row.entityId,
          kind: row.kind,
          epochBefore: row.epochBefore,
          epochAfter: row.epochAfter,
          eligibleTick: row.eligibleTick,
          origin: row.origin,
          atMs: row.atMs,
          initialState: row.initialState,
          initialStateHash: row.initialStateHash,
        });
        break;
      }
      case 'observation': {
        // One arrival is described by as many rows as it took dispositions across ticks. The *input* is
        // the arrival, so the first description is the one to replay and later ones are deduplicated —
        // otherwise a replay would ingest the same message twice and decide differently.
        if (observations.some((entry) => entry.ordinal === row.arrivalOrdinal)) break;
        observations.push({
          ordinal: row.arrivalOrdinal,
          entityId: row.entityId,
          kind: row.kind,
          // Trusted provenance only. `raw` is a payload, and a payload never decides that a message is a
          // lifecycle operation - not here, not on replay, not for a message the admission gate refused.
          control: row.origin === 'server-lifecycle' ? row.control : null,
          origin: row.origin,
          declaredEpoch: row.epoch,
          declaredGeneration: row.generation,
          raw: row.raw,
          atMs: row.atMs,
        });
        break;
      }
      default:
        break;
    }
  }
  for (const record of chain) ticks.push({ tick: record.tick, cutoffOrdinal: record.ordinal, atMs: record.atMs });
  observations.sort((a, b) => a.ordinal - b.ordinal);
  events.sort((a, b) => a.arrivalOrdinal - b.arrivalOrdinal);
  ticks.sort((a, b) => a.tick - b.tick);
  return { events, observations, ticks };
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
  // Every join names the canonical state it started from. The prologue cannot do that for an entity that
  // arrived later, and the core does not remember departed entities to try (reviewer correction 3).
  for (const row of rows) {
    if (row.type === 'event' && row.kind === 'join' && row.initialState === null) {
      issues.push(`join event ${String(row.arrivalOrdinal)} does not carry the initial canonical state`);
    }
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
  /**
   * The request-identity hash, from stage S. `null` for a continuous observation, an unvalidated identity
   * or a request that has not been screened yet (P03-g).
   */
  readonly payloadHash: string | null;
}

/**
 * Cross-check the provenance a journal claims (reviewer correction 1).
 *
 * The rule is one-directional on purpose: a lifecycle operation needs server provenance, and server
 * provenance only ever accompanies a lifecycle observation kind. A row that claims to be a server event while
 * carrying a client payload shape - the shape a forged or corrupted artefact would have - is reported, and
 * `replayRun` refuses to run a journal that contains one.
 */
export const provenanceIssues = (rows: readonly JournalRow[]): readonly string[] => {
  const issues: string[] = [];
  for (const row of rows) {
    if (row.type !== 'observation') continue;
    if (row.origin === 'client-payload' && row.control !== null) {
      issues.push(`observation ${String(row.arrivalOrdinal)} carries a control value without server provenance`);
    }
    if (row.origin === 'server-lifecycle' && row.kind !== 'control') {
      issues.push(`observation ${String(row.arrivalOrdinal)} claims server provenance but is not a control observation`);
    }
  }
  return issues;
};

/** The run's journal: rows and the tick hash chain, both handed straight to the injected sink. */
export class Journal {
  readonly #sink: JournalSink;
  #prevHash: string = GENESIS_HASH;

  constructor(sink: JournalSink) {
    this.#sink = sink;
  }

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

  /** Hand a row to the sink. The journal retains nothing: the chain tip is the only running state. */
  push(row: JournalRow): JournalRow {
    this.#sink.recordRow(row);
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
      payloadHash: input.payloadHash,
      disposition: input.disposition,
      reason: input.reason,
      screened: input.screened,
      // There is no transport in Phase 1, so there is no SDK frame identity to record. The limitation
      // is stated rather than filled in with a counter (P03-f, D-7).
      sdkFrameIdentity: null,
      // Provenance comes from how the arrival was created, never from what it contains.
      origin: arrival.control === null ? 'client-payload' : 'server-lifecycle',
      control: arrival.control,
      atMs: arrival.receivedAtMs,
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
  chainTick(tick: ServerTick, ordinal: number, rows: readonly JournalRow[], atMs: number): TickChainRecord {
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
      atMs,
    };
    this.#sink.recordTickChain(record);
    this.#prevHash = hash;
    return record;
  }

  /** The chain tip, or the genesis value for an empty run. */
  get tip(): string {
    return this.#prevHash;
  }
}

/**
 * Compare two journals row by row, ignoring nothing: the suites assert equality, not similarity (AC-3d).
 *
 * These live with the journal rather than with the replay because they compare *outputs*. A replay never
 * reads them; a reviewer does.
 */
export interface JournalDifference {
  readonly index: number;
  readonly original: JournalRow | null;
  readonly replayed: JournalRow | null;
}

export const firstJournalDifference = (
  original: readonly JournalRow[],
  replayed: readonly JournalRow[],
): JournalDifference | null => {
  const length = Math.max(original.length, replayed.length);
  for (let index = 0; index < length; index += 1) {
    const a = original[index];
    const b = replayed[index];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    return { index, original: a ?? null, replayed: b ?? null };
  }
  return null;
};

/** Compare the recorded state digests against the replayed ones (AC-3d). */
export const firstStateDigestDifference = (
  original: readonly JournalRow[],
  replayed: readonly JournalRow[],
): { readonly tick: number; readonly entityId: string; readonly original: string; readonly replayed: string } | null => {
  const key = (row: JournalRow): string | null =>
    row.type === 'state' ? `${String(row.tick)}:${row.entityId}` : null;
  const before = new Map<string, { tick: number; entityId: string; hash: string }>();
  for (const row of original) {
    const id = key(row);
    if (id !== null && row.type === 'state') before.set(id, { tick: row.tick, entityId: row.entityId, hash: row.stateHash });
  }
  for (const row of replayed) {
    const id = key(row);
    if (id === null || row.type !== 'state') continue;
    const expected = before.get(id);
    if (expected === undefined) {
      return { tick: row.tick, entityId: row.entityId, original: '<missing>', replayed: row.stateHash };
    }
    if (expected.hash !== row.stateHash) {
      return { tick: row.tick, entityId: row.entityId, original: expected.hash, replayed: row.stateHash };
    }
  }
  return null;
};

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
