/**
 * Replay helpers for the Phase 1 suites.
 *
 * Two variants are exercised deliberately: a replay from the journal as recorded, and a replay from a
 * journal with **every digest blanked** (AC-20). Both go through the production `replayRun`, so a suite
 * can never accidentally test a test-only replay implementation.
 *
 * The caller supplies a scheduler and gets back the journal the replay wrote. Rows come from a sink, because
 * the replayed core retains none (reviewer correction 3); the time basis is restored inside `replayRun` from
 * the readings the original recorded (reviewer correction 2), so nothing here can pass a fake clock in.
 */

import { toReplayInputs, withDigestsBlanked } from '../../../apps/server/src/authority/journal.js';
import type { JournalSink, ReplayInputs, TickChainRecord } from '../../../apps/server/src/authority/journal.js';
import { replayRun } from '../../../apps/server/src/authority/replay.js';
import type { ReplayRefusal, ReplaySuccess } from '../../../apps/server/src/authority/replay.js';
import type { RouteCompletion } from '../../../apps/server/src/authority/step.js';
import type { Scheduler } from '../../../apps/server/src/authority/determinism.js';
import type { EntityStepper, JournalRow, PrologueRow } from '../../../apps/server/src/authority/types.js';
import { JournalCollector } from './journal-collector.js';
import type { ServerConfig } from '../../../packages/config/dist/index.js';

/** A successful replay plus the journal the replay's sink collected. */
export type ReplayedRun = ReplaySuccess & {
  readonly rows: readonly JournalRow[];
  readonly chain: readonly TickChainRecord[];
};

/** `ReplaySuccess` from the production path with its collected journal, or a refusal naming why nothing ran. */
export type ReplayOutcome = ReplayedRun | ReplayRefusal;

/** Project a digest-free journal into replay inputs. The inputs must be identical to the original's. */
export const withDigestsBlankedForReplay = (
  rows: readonly JournalRow[],
  chain: readonly TickChainRecord[],
): ReplayInputs => toReplayInputs(withDigestsBlanked(rows), chain);

export interface RunReplayOptions {
  readonly prologue: PrologueRow;
  readonly inputs: ReplayInputs;
  readonly config: Readonly<ServerConfig>;
  readonly stepper: EntityStepper;
  readonly scheduler: Scheduler;
  readonly runId: string;
  /** Receive the replayed journal as well as the helper's copy; forwarding is never a replacement. */
  readonly sink?: JournalSink;
  readonly routeCompletions?: () => readonly RouteCompletion[];
}

/** Call the production replay entry point, with the optional completion source handled explicitly. */
export const replayFromInputs = (options: RunReplayOptions): ReplayOutcome => {
  const completions = options.routeCompletions;
  // Mirror into a collector while forwarding to whatever sink the caller brought, so `rows` and `chain` are
  // always the journal that was actually written rather than an empty stand-in.
  const mirror = new JournalCollector();
  const sink: JournalSink = {
    recordRow: (row) => {
      mirror.recordRow(row);
      options.sink?.recordRow(row);
    },
    recordTickChain: (record) => {
      mirror.recordTickChain(record);
      options.sink?.recordTickChain(record);
    },
  };
  const result = replayRun({
    prologue: options.prologue,
    inputs: options.inputs,
    config: options.config,
    stepper: options.stepper,
    scheduler: options.scheduler,
    sink,
    runId: options.runId,
    ...(completions === undefined ? {} : { routeCompletions: completions }),
  });
  if (result.ok === false) return result;
  return { ...result, rows: mirror.rows(), chain: mirror.chain() };
};
