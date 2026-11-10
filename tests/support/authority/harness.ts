/**
 * The Phase 1 harness: assemble an authority core from validated configuration, drive it with a virtual
 * clock, and replay it through the production replay path.
 *
 * Time never moves by itself. The virtual clock only advances when a test advances it or when the
 * scheduler runs a due callback, so cache-TTL behaviour, cadence and the late-firing clamp are all
 * observable instead of incidental.
 */

import { DEFAULT_SERVER_CONFIG, withConfigOverrides } from '../../../packages/config/dist/index.js';
import type { ServerConfig } from '../../../packages/config/dist/index.js';
import type { RegionBounds, Vec3 } from '../../../packages/protocol/dist/index.js';

import { FixedStepClock } from '../../../apps/server/src/authority/clock.js';
import type { AuthorityCore, RouteCompletion, TickOutcome } from '../../../apps/server/src/authority/step.js';
import { AuthorityCore as AuthorityCoreClass } from '../../../apps/server/src/authority/step.js';
import { toReplayInputs } from '../../../apps/server/src/authority/journal.js';
import type { ReplayInputs, TickChainRecord } from '../../../apps/server/src/authority/journal.js';
import { replayFromInputs, withDigestsBlankedForReplay } from './replay-helpers.js';
import type { ReplayOutcome } from './replay-helpers.js';
import { ReferenceStepper } from './reference-stepper.js';
import { VirtualScheduler, VirtualTime } from './virtual-scheduler.js';
import type { JournalRow } from '../../../apps/server/src/authority/types.js';

/** Explicit test extents. There is no production default, and none is invented here (D5). */
export const TEST_BOUNDS: Readonly<RegionBounds> = {
  x: { min: -50, max: 50 },
  y: { min: -5, max: 20 },
  z: { min: -50, max: 50 },
};

export const SPAWN: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

/** The default configuration plus the test bounds: a different, correct `configHash` by design. */
export const CONFIG_WITH_BOUNDS: Readonly<ServerConfig> = withConfigOverrides(DEFAULT_SERVER_CONFIG, {
  region: { bounds: TEST_BOUNDS },
});

export interface HarnessOptions {
  readonly config?: Readonly<ServerConfig>;
  readonly tickOrigin?: number;
  readonly runId?: string;
  readonly routeCompletions?: () => readonly RouteCompletion[];
  readonly startArmed?: boolean;
}

export interface Harness {
  readonly core: AuthorityCore;
  readonly clock: FixedStepClock;
  readonly scheduler: VirtualScheduler;
  readonly time: VirtualTime;
  readonly stepper: ReferenceStepper;
  readonly config: Readonly<ServerConfig>;
  /** Run one tick directly, without involving the scheduler. */
  step(): TickOutcome;
  run(ticks: number): readonly TickOutcome[];
  /** Arm the clock on the scheduler, so cadence assertions can be made against real callbacks. */
  start(): void;
  stop(): void;
  replay(runId?: string): ReplayOutcome;
  /** Replay from a journal with every digest blanked, which must produce the same decisions (AC-20). */
  replayWithoutDigests(runId?: string): ReplayOutcome;
  replayInputs(): ReplayInputs;
  rows(): readonly JournalRow[];
  chain(): readonly TickChainRecord[];
}

export type HarnessResult = { readonly ok: true; readonly harness: Harness } | { readonly ok: false; readonly failure: string };

export const tryHarness = (options: HarnessOptions = {}): HarnessResult => {
  const built = createHarness(options);
  if ('failure' in built) return { ok: false, failure: built.failure };
  return { ok: true, harness: built };
};

export const createHarness = (
  options: HarnessOptions = {},
): Harness | { readonly failure: string } => {
  const time = new VirtualTime(0);
  const scheduler = new VirtualScheduler(time);
  const config = options.config ?? CONFIG_WITH_BOUNDS;
  const tickOrigin = options.tickOrigin ?? 0;
  const clockOptions = { network: config.network, scheduler, time, tickOrigin };
  const clock = FixedStepClock.create(clockOptions);
  if (!('dtSeconds' in clock)) return { failure: clock.error };

  const stepper = new ReferenceStepper(config.movement.speed);
  const completions = options.routeCompletions;
  const core = AuthorityCoreClass.build({
    config,
    stepper,
    time,
    clock,
    runId: options.runId ?? 'udg-003-phase-1-run',
    regionProvenance: 'test-only-synthetic',
    ...(completions === undefined ? {} : { routeCompletions: completions }),
  });
  if (!('view' in core)) return { failure: `${core.reason}: ${core.detail}` };

  const harness: Harness = {
    core,
    clock,
    scheduler,
    time,
    stepper,
    config,
    step: () => core.step(),
    run: (ticks: number) => core.run(ticks),
    start: () => {
      clock.start(() => {
        core.step();
      });
    },
    stop: () => clock.stop(),
    replay: (runId = `${options.runId ?? 'udg-003-phase-1-run'}-replay`) =>
      replayFrom(harness, core.prologue(), toReplayInputs(core.journalRows, core.chain), runId, completions),
    replayWithoutDigests: (runId = `${options.runId ?? 'udg-003-phase-1-run'}-stripped-replay`) =>
      replayFrom(
        harness,
        core.prologue(),
        withDigestsBlankedForReplay(core.journalRows, core.chain),
        runId,
        completions,
      ),
    replayInputs: () => toReplayInputs(core.journalRows, core.chain),
    rows: () => core.journalRows,
    chain: () => core.chain,
  };
  if (options.startArmed === true) harness.start();
  return harness;
};

const replayFrom = (
  original: Harness,
  prologue: ReturnType<AuthorityCore['prologue']>,
  inputs: ReplayInputs,
  runId: string,
  completions: (() => readonly RouteCompletion[]) | undefined,
): ReplayOutcome => {
  const time = new VirtualTime(0);
  const scheduler = new VirtualScheduler(time);
  const clock = FixedStepClock.create({
    network: original.config.network,
    scheduler,
    time,
    tickOrigin: prologue.tickOrigin,
  });
  if (!('dtSeconds' in clock)) return { ok: false, reason: 'replay-clock-not-derivable', detail: clock.error };
  const stepper = new ReferenceStepper(original.config.movement.speed);
  return replayFromInputs({
    prologue,
    inputs,
    config: original.config,
    stepper,
    time,
    clock,
    runId,
    ...(completions === undefined ? {} : { routeCompletions: completions }),
  });
};
