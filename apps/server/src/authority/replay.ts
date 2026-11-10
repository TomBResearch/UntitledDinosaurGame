/**
 * Deterministic replay from the journal's **inputs** (P03-g, AC-3d, AC-20).
 *
 * A replay rebuilds state and decisions from the prologue, the validated configuration and bounds, the
 * tick schedule with its ingest boundaries, and each observation's payload. Digests and candidate
 * summaries are comparison outputs, so the comparison functions read them while the replay code above
 * them cannot: {@link toReplayInputs} is the only projection the feeder consumes, and it is written
 * field by field for exactly that reason.
 *
 * A prologue whose configuration digests disagree with the running configuration is refused outright
 * rather than partially compared — a replay against a different build proves nothing (AC-20).
 */

import { computeConfigHash, movementHash, regionHash } from '@udg/config';
import type { ServerConfig } from '@udg/config';
import type { Vec3 } from '@udg/protocol';

import { payloadFromRendered } from './arrival.js';
import type { FixedStepClock } from './clock.js';
import type { TimeSource } from './determinism.js';
import type { ReplayInputs, ReplayObservation, TickChainRecord } from './journal.js';
import { AuthorityCore } from './step.js';
import type { RouteCompletion, TickOutcome } from './step.js';
import type { EntityStepper, JournalRow, PrologueRow } from './types.js';

export interface ReplayRefusal {
  readonly ok: false;
  readonly reason: 'prologue-mismatch';
  readonly expected: { readonly configHash: string; readonly movementHash: string; readonly regionHash: string };
  readonly actual: { readonly configHash: string; readonly movementHash: string; readonly regionHash: string };
}

export interface ReplaySuccess {
  readonly ok: true;
  readonly core: AuthorityCore;
  readonly outcomes: readonly TickOutcome[];
  readonly rows: readonly JournalRow[];
  readonly chain: readonly TickChainRecord[];
}

export type ReplayResult = ReplaySuccess | ReplayRefusal;

export interface ReplayOptions {
  readonly prologue: PrologueRow;
  readonly inputs: ReplayInputs;
  readonly config: Readonly<ServerConfig>;
  readonly stepper: EntityStepper;
  readonly time: TimeSource;
  readonly clock: FixedStepClock;
  readonly runId: string;
  readonly routeCompletions?: () => readonly RouteCompletion[];
}

/** The digests a running core would advertise. */
export const configurationDigests = (config: Readonly<ServerConfig>): ReplayRefusal['actual'] => ({
  configHash: computeConfigHash(config),
  movementHash: movementHash(config),
  regionHash: regionHash(config),
});

/**
 * Replay a recorded run.
 *
 * The feeder walks the recorded tick boundaries in order and ingests, in ascending arrival order, every
 * arrival the boundary's cutoff would have admitted. Controls are replayed through the same
 * server-generated join/leave/expiry/epoch-change paths the original used, so lifecycle still lands
 * inside the frozen set.
 */
export const replayRun = (options: ReplayOptions): ReplayResult => {
  const actual = configurationDigests(options.config);
  const expected = {
    configHash: options.prologue.configHash,
    movementHash: options.prologue.movementHash,
    regionHash: options.prologue.regionHash,
  };
  if (
    actual.configHash !== expected.configHash ||
    actual.movementHash !== expected.movementHash ||
    actual.regionHash !== expected.regionHash
  ) {
    return { ok: false, reason: 'prologue-mismatch', expected, actual };
  }

  const built = AuthorityCore.build({
    config: options.config,
    stepper: options.stepper,
    time: options.time,
    clock: options.clock,
    runId: options.runId,
    regionProvenance: options.prologue.regionProvenance,
    ...(options.routeCompletions === undefined ? {} : { routeCompletions: options.routeCompletions }),
  });
  if (!(built instanceof AuthorityCore)) {
    // Without validated bounds there is nothing to replay against; refuse rather than partially compare.
    return { ok: false, reason: 'prologue-mismatch', expected, actual };
  }
  const core = built;

  const arrivals = [...options.inputs.observations].sort((a, b) => a.ordinal - b.ordinal);
  let cursor = 0;
  const outcomes: TickOutcome[] = [];

  for (const boundary of [...options.inputs.ticks].sort((a, b) => a.tick - b.tick)) {
    while (cursor < arrivals.length) {
      const arrival = arrivals[cursor];
      if (arrival === undefined || arrival.ordinal > boundary.cutoffOrdinal) break;
      feed(core, arrival);
      cursor += 1;
    }
    outcomes.push(core.step());
  }

  return { ok: true, core, outcomes, rows: core.journalRows, chain: core.chain };
};

/**
 * Re-offer one recorded arrival to a fresh core.
 *
 * The replay clock starts at zero and is advanced only by the tick boundaries below, so no arrival is fed
 * with a received timestamp: ordering comes from the arrival ordinal and the cutoff, which is the only
 * ordering the rules recognise (P03-b). Passing the ordinal here would be a lie about time that happens
 * to be invisible in the journal.
 */
const feed = (core: AuthorityCore, arrival: ReplayObservation): void => {
  const payload = payloadFromRendered(arrival.raw);
  if (arrival.control === 'join') {
    const spawn: Vec3 = {
      x: numberField(payload, 'spawnX'),
      y: numberField(payload, 'spawnY'),
      z: numberField(payload, 'spawnZ'),
    };
    core.join(arrival.entityId, arrival.declaredEpoch ?? 1, spawn);
    return;
  }
  if (arrival.control === 'leave') {
    core.leave(arrival.entityId);
    return;
  }
  if (arrival.control === 'expiry') {
    core.expire(arrival.entityId);
    return;
  }
  if (arrival.control === 'epochChange') {
    core.epochChange(arrival.entityId, arrival.declaredEpoch ?? 1);
    return;
  }
  core.ingest(arrival.entityId, payload);
};

const numberField = (payload: Readonly<Record<string, unknown>>, key: string): number => {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/** Compare two runs row by row, ignoring nothing: the fixture asserts equality, not similarity. */
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

export type { ReplayInputs, ReplayObservation };
