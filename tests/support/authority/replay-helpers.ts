/**
 * Replay helpers for the Phase 1 suites.
 *
 * Two variants are exercised deliberately: a replay from the journal as recorded, and a replay from a
 * journal with **every digest blanked** (AC-20). Both go through the production `replayRun`, so a suite
 * can never accidentally test a test-only replay implementation.
 */

import { toReplayInputs, withDigestsBlanked } from '../../../apps/server/src/authority/journal.js';
import type { ReplayInputs, TickChainRecord } from '../../../apps/server/src/authority/journal.js';
import { replayRun } from '../../../apps/server/src/authority/replay.js';
import type { ReplayRefusal, ReplaySuccess } from '../../../apps/server/src/authority/replay.js';
import type { RouteCompletion } from '../../../apps/server/src/authority/step.js';
import type { EntityStepper, JournalRow, PrologueRow } from '../../../apps/server/src/authority/types.js';
import type { FixedStepClock } from '../../../apps/server/src/authority/clock.js';
import type { TimeSource } from '../../../apps/server/src/authority/determinism.js';
import type { ServerConfig } from '../../../packages/config/dist/index.js';

/** `ReplaySuccess` from the production path, or a refusal naming why nothing was replayed. */
export type ReplayOutcome =
  | ReplaySuccess
  | ReplayRefusal
  | { readonly ok: false; readonly reason: 'replay-clock-not-derivable'; readonly detail: string };

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
  readonly time: TimeSource;
  readonly clock: FixedStepClock;
  readonly runId: string;
  readonly routeCompletions?: () => readonly RouteCompletion[];
}

/** Call the production replay entry point, with the optional completion source handled explicitly. */
export const replayFromInputs = (options: RunReplayOptions): ReplayOutcome => {
  const completions = options.routeCompletions;
  return replayRun({
    prologue: options.prologue,
    inputs: options.inputs,
    config: options.config,
    stepper: options.stepper,
    time: options.time,
    clock: options.clock,
    runId: options.runId,
    ...(completions === undefined ? {} : { routeCompletions: completions }),
  });
};
