/**
 * Deterministic replay from the journal's **inputs** (P03-g, AC-3d, AC-20).
 *
 * A replay rebuilds state and decisions from the prologue, the validated configuration and bounds, the
 * tick schedule with its ingest boundaries, each observation's payload, and the clock readings those
 * decisions were made under. Digests and candidate summaries are comparison outputs, so the comparison
 * functions in `journal.ts` read them while the feeder here cannot: {@link toReplayInputs} is the only
 * projection this module consumes, and it is written field by field for exactly that reason.
 *
 * Three refusals are deliberate rather than defensive:
 *
 * - a prologue whose configuration digests disagree with the running configuration, because a replay
 *   against a different build proves nothing (AC-20);
 * - an input that hands a lifecycle operation to a row without server provenance, because that is a client
 *   asking to change entity state through the artefact after the transport refused it (correction 1);
 * - a time basis this replay cannot reconstruct, or recorded readings that run backwards, because the
 *   terminal-request cache expires on that clock and a silent guess would change decisions (correction 2).
 */

import { computeConfigHash, movementHash, regionHash } from '@udg/config';
import type { ServerConfig } from '@udg/config';
import type { Vec3 } from '@udg/protocol';

import { payloadFromRendered } from './arrival.js';
import { FixedStepClock } from './clock.js';
import { RecordedTime, type Scheduler } from './determinism.js';
import type { JournalSink, ReplayInputs, ReplayObservation } from './journal.js';
import { AuthorityCore } from './step.js';
import type { RouteCompletion, TickOutcome } from './step.js';
import type { EntityStepper, PrologueRow } from './types.js';

export type ReplayRefusal =
  | {
      readonly ok: false;
      readonly reason: 'prologue-mismatch';
      readonly expected: {
        readonly configHash: string;
        readonly movementHash: string;
        readonly regionHash: string;
      };
      readonly actual: {
        readonly configHash: string;
        readonly movementHash: string;
        readonly regionHash: string;
      };
    }
  | { readonly ok: false; readonly reason: 'replay-clock-not-derivable'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'provenance-inconsistent'; readonly issues: readonly string[] }
  | { readonly ok: false; readonly reason: 'recorded-time-not-monotonic'; readonly detail: string };

export interface ReplaySuccess {
  readonly ok: true;
  readonly core: AuthorityCore;
  readonly outcomes: readonly TickOutcome[];
  /** The time basis the replay ran on, so a suite can assert which readings were restored. */
  readonly time: RecordedTime;
  /**
   * How many rows and chain records the replay handed to the caller's sink. The content lives with the
   * consumer - a replayed core retains nothing, exactly like a live one (reviewer correction 3).
   */
  readonly rowsWritten: number;
  readonly chainRecordsWritten: number;
}

export type ReplayResult = ReplaySuccess | ReplayRefusal;

export interface ReplayOptions {
  readonly prologue: PrologueRow;
  readonly inputs: ReplayInputs;
  readonly config: Readonly<ServerConfig>;
  readonly stepper: EntityStepper;
  /** The scheduling facility for the replay clock. Replay steps ticks itself; it never waits. */
  readonly scheduler: Scheduler;
  /** Where the replayed journal goes. Required: the replayed core retains nothing either. */
  readonly sink: JournalSink;
  readonly runId: string;
  readonly routeCompletions?: () => readonly RouteCompletion[];
}

/** The digests a running core would advertise. */
export const configurationDigests = (config: Readonly<ServerConfig>): {
  readonly configHash: string;
  readonly movementHash: string;
  readonly regionHash: string;
} => ({
  configHash: computeConfigHash(config),
  movementHash: movementHash(config),
  regionHash: regionHash(config),
});

/**
 * Replay a recorded run.
 *
 * Three rules shape the feeder:
 *
 * 1. **Inputs only.** The prologue, the configuration, the tick boundaries and each arrival's payload.
 *    Digests and candidate summaries are compared, never read.
 * 2. **Trusted provenance.** A lifecycle operation is replayed only when the row says the *server* created
 *    it. A client payload that carries a `control` field is re-offered as a client message and refused again
 *    for the same reason it was refused the first time (reviewer correction 1).
 * 3. **The recorded time basis.** Each arrival and each tick boundary carries the `TimeSource` reading that
 *    was in force when the original decided, and the replay restores those readings before it feeds, because
 *    the terminal-request cache expires on that clock (reviewer correction 2).
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

  // An artefact that hands a lifecycle operation to a row without server provenance is not a journal this
  // replay will run: it would be a request to change entity state that no client is allowed to make.
  const provenance = inputsProvenanceIssues(options.inputs);
  if (provenance.length > 0) {
    return { ok: false, reason: 'provenance-inconsistent', issues: provenance };
  }

  if (options.prologue.timeBasis !== 'recorded-clock-readings') {
    return {
      ok: false,
      reason: 'replay-clock-not-derivable',
      detail: `the journal claims the time basis "${options.prologue.timeBasis}", which this replay cannot reconstruct`,
    };
  }
  const time = new RecordedTime(options.prologue.timeOriginMs);
  const clock = FixedStepClock.create({
    network: options.config.network,
    scheduler: options.scheduler,
    time,
    tickOrigin: options.prologue.tickOrigin,
  });
  if (!('dtSeconds' in clock)) {
    return { ok: false, reason: 'replay-clock-not-derivable', detail: clock.error };
  }

  let rowsWritten = 0;
  let chainRecordsWritten = 0;
  const countingSink: JournalSink = {
    recordRow: (row) => {
      rowsWritten += 1;
      options.sink.recordRow(row);
    },
    recordTickChain: (record) => {
      chainRecordsWritten += 1;
      options.sink.recordTickChain(record);
    },
  };

  const completions = options.routeCompletions;
  const built = AuthorityCore.build({
    config: options.config,
    stepper: options.stepper,
    time,
    clock,
    runId: options.runId,
    sink: countingSink,
    regionProvenance: options.prologue.regionProvenance,
    ...(completions === undefined ? {} : { routeCompletions: completions }),
  });
  if (!(built instanceof AuthorityCore)) {
    // Without validated bounds there is nothing to replay against; refuse rather than partially compare.
    return {
      ok: false,
      reason: 'replay-clock-not-derivable',
      detail: built.detail,
    };
  }
  const core = built;

  const arrivals = [...options.inputs.observations].sort((a, b) => a.ordinal - b.ordinal);
  let cursor = 0;
  const outcomes: TickOutcome[] = [];

  for (const boundary of [...options.inputs.ticks].sort((a, b) => a.tick - b.tick)) {
    while (cursor < arrivals.length) {
      const arrival = arrivals[cursor];
      if (arrival === undefined || arrival.ordinal > boundary.cutoffOrdinal) break;
      time.restore(arrival.atMs);
      feed(core, arrival);
      cursor += 1;
    }
    time.restore(boundary.atMs);
    outcomes.push(core.step());
  }

  if (time.refusedRestorations > 0) {
    return {
      ok: false,
      reason: 'recorded-time-not-monotonic',
      detail: `${String(time.refusedRestorations)} recorded reading(s) sat behind the clock and were not obeyed`,
    };
  }

  return {
    ok: true,
    core,
    outcomes,
    time,
    rowsWritten,
    chainRecordsWritten,
  };
};

/** The provenance cross-check over replay inputs, which are rows projected down to inputs. */
const inputsProvenanceIssues = (inputs: ReplayInputs): readonly string[] => {
  const issues: string[] = [];
  for (const arrival of inputs.observations) {
    if (arrival.control !== null && arrival.origin !== 'server-lifecycle') {
      issues.push(`arrival ${String(arrival.ordinal)} carries "${arrival.control}" without server provenance`);
    }
    if (arrival.origin === 'server-lifecycle' && arrival.kind !== 'control') {
      issues.push(`arrival ${String(arrival.ordinal)} claims server provenance but is not a control observation`);
    }
  }
  return issues;
};

/**
 * Re-offer one recorded arrival to a fresh core.
 *
 * Ordering comes from the arrival ordinal and the cutoff, which is the only ordering the rules recognise
 * (P03-b); the restored clock reading is the *time* the original saw, not a re-labelled ordinal.
 */
const feed = (core: AuthorityCore, arrival: ReplayObservation): void => {
  const payload = payloadFromRendered(arrival.raw);
  if (arrival.origin === 'server-lifecycle') {
    switch (arrival.control) {
      case 'join': {
        const spawn: Vec3 = {
          x: numberField(payload, 'spawnX'),
          y: numberField(payload, 'spawnY'),
          z: numberField(payload, 'spawnZ'),
        };
        core.join(arrival.entityId, arrival.declaredEpoch ?? 1, spawn);
        return;
      }
      case 'leave':
        core.leave(arrival.entityId);
        return;
      case 'expiry':
        core.expire(arrival.entityId);
        return;
      case 'epochChange':
        core.epochChange(arrival.entityId, arrival.declaredEpoch ?? 1);
        return;
      case null:
        // Server provenance with no operation cannot be executed as lifecycle; it is offered as what it
        // is, and the admission gate decides it again.
        break;
    }
  }
  // The rendered map travels with the payload so a field JSON cannot carry is described the same way twice.
  core.ingest(arrival.entityId, payload, undefined, arrival.raw);
};

const numberField = (payload: Readonly<Record<string, unknown>>, key: string): number => {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export type { ReplayInputs, ReplayObservation };
