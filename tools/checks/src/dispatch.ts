/**
 * Unavailable-suite guard (UDG-001).
 *
 * Commands owned by tasks that have not started must fail with an attributed reason instead of
 * reaching a tool that has nothing to run. docs/contracts/repository.md 3.2: the dispatcher
 * "fails clearly for unavailable suites; it must never treat a missing suite or zero discovered
 * tests as success".
 *
 * This module is a declared addition to the UDG-001 file list so the message is written once
 * rather than duplicated across the five root scripts that forward to it.
 */

import { join } from 'node:path';

import {
  E2E_SUITES,
  UNAVAILABLE_SUITES,
  e2eSuiteNames,
  e2eSuiteUsage,
  isMainModule,
  parseArgs,
  runCommand,
  suiteArgument,
} from './support.js';

export interface GuardResult {
  readonly exitCode: number;
  readonly message: string;
}

export const guardUnavailable = (command: string | undefined, forwarded: readonly string[]): GuardResult => {
  if (command === undefined || command === '') {
    return {
      exitCode: 2,
      message: `usage: ${Object.keys(UNAVAILABLE_SUITES).sort().join(' | ')}\n`,
    };
  }
  const ownership = UNAVAILABLE_SUITES[command];
  if (ownership === undefined) {
    const known = Object.keys(UNAVAILABLE_SUITES).sort().join(', ');
    return {
      exitCode: 2,
      message: `"${command}" is not a guarded command. Guarded commands: ${known}.\n`,
    };
  }
  // The browser command is guarded per suite: UDG-004 created `camera`, and the other four suites are still
  // owed. A caller that names nothing, or names something that is not a suite at all, gets a usage error that
  // still says who owns each suite — a refusal that cannot tell you what to read next is not a refusal.
  if (command === 'test:e2e') return guardE2eSuite(ownership.contractPath, forwarded);

  const args = forwarded.length > 0 ? ` (arguments received: ${forwarded.join(' ')})` : '';
  return {
    exitCode: 1,
    message:
      `${ownership.command} is unavailable: its suite has not been implemented yet.${args}\n` +
      `  owning task:      ${ownership.owningTask}\n` +
      `  required artefact: ${ownership.requiredArtefact}\n` +
      `  contract:          ${ownership.contractPath}\n` +
      '  The dispatcher exits non-zero on purpose. A missing suite is never reported as a pass.\n',
  };
};

/**
 * The per-suite half of the `test:e2e` guard.
 *
 * Exit codes keep their existing meaning: 0 dispatch the suite, 1 a command or suite the dispatcher will not
 * run because a task has not implemented it, 2 a call naming a suite that does not exist at all.
 */
const guardE2eSuite = (contractPath: string, forwarded: readonly string[]): GuardResult => {
  const requested = suiteArgument(forwarded);
  if (requested === undefined || requested === '') {
    // Exit 1, not 2. A bare `pnpm test:e2e` is the guarded command itself refusing, and UDG-001's accepted
    // dispatch contract is the thing that says what a refusal looks like: exit 1, the owning task named, and
    // the sentence "a missing suite is never reported as a pass". An unknown suite name stays 2, because
    // there is no owner to name there. What a caller needs from this refusal is who owns which suite.
    return {
      exitCode: 1,
      message:
        'pnpm test:e2e is unavailable without --suite: no single task owns "every browser suite", and a browser '
        + 'run that does not name its suite cannot say what it proved.\n'
        + `  owning task:      ${e2eSuiteNames()
          .map((name) => `${E2E_SUITES[name]?.owningTask ?? 'unknown'} (${name})`)
          .join(', ')}\n`
        + `  contract:          ${contractPath}\n`
        + e2eSuiteUsage()
        + '  The dispatcher exits non-zero on purpose. A missing suite is never reported as a pass.\n',
    };
  }
  const suite = E2E_SUITES[requested];
  if (suite === undefined) {
    return { exitCode: 2, message: `"${requested}" is not a browser suite.\n${e2eSuiteUsage()}` };
  }
  if (suite.implemented) {
    return {
      exitCode: 0,
      message:
        `pnpm test:e2e -- --suite ${suite.suite} is implemented by ${suite.owningTask} `
        + `and runs ${suite.specPath}.\n`,
    };
  }
  return {
    exitCode: 1,
    message:
      `pnpm test:e2e -- --suite ${suite.suite} is unavailable: its suite has not been implemented yet.\n`
      + `  owning task:      ${suite.owningTask}\n`
      + `  required artefact: ${suite.requiredArtefact}\n`
      + `  contract:          ${contractPath}\n`
      + e2eSuiteUsage()
      + '  The dispatcher exits non-zero on purpose. A missing suite is never reported as a pass.\n',
  };
};

/** Everything the caller passed except the suite selector itself, which Playwright would not recognise. */
const forwardedToPlaywright = (forwarded: readonly string[]): string[] =>
  forwarded
    .filter((entry) => entry !== '--suite' && !entry.startsWith('--suite='))
    .filter((entry) => E2E_SUITES[entry] === undefined);

/**
 * Run the suite the guard just vouched for, and answer with its exit code.
 *
 * The dispatcher is the only route to the browser suites, so the refusal and the run are the same code path and
 * no caller can reach Playwright around the guard. Playwright's own failure to find a test is a non-zero exit
 * (verified), and `tests/contracts/UDG-004.test.ts` additionally refuses a results artefact whose case count
 * is zero, so "the command succeeded and proved nothing" stays impossible.
 */
const runImplementedSuite = (command: string, forwarded: readonly string[]): number => {
  const suite = E2E_SUITES[suiteArgument(forwarded) ?? ''];
  if (command !== 'test:e2e' || suite === undefined || !suite.implemented) {
    process.stderr.write(`"${command}" has no implemented suite to run.\n`);
    return 2;
  }
  const argv = ['pnpm', 'exec', 'playwright', 'test', suite.specPath, '--project=chromium', ...forwardedToPlaywright(forwarded)];
  const result = runCommand(argv, { cwd: process.cwd(), timeoutMs: 30 * 60 * 1000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.timedOut) {
    process.stderr.write(`test:e2e --suite ${suite.suite} timed out after 30 minutes\n`);
    return 124;
  }
  if (result.exitCode !== 0) {
    process.stderr.write(`test:e2e --suite ${suite.suite} FAILED with exit code ${String(result.exitCode)}\n`);
  }
  return result.exitCode;
};

/* ------------------------------------------------------------------ UDG-SPIKE-001 spike dispatch (grant T-1b)
 *
 * `pnpm test:spike -- --id UDG-SPIKE-001 [cell] [profile] [seed]` is the ONLY spike dispatch that
 * exists. The refusal for every other id is UNTOUCHED: UDG-SPIKE-002 and UDG-SPIKE-003 own no
 * harness, and their `test:spike` guard still answers with the owning task and never a pass.
 * Cells: `self-check` (default) is the pure-Node proxy/statistics/trace loop; `elevated-full` is
 * the candidate-bound Gate A LOCAL DIAGNOSTIC cell (20 s warmup + 120 s measure, two browser
 * contexts, accepted-socket RTT, matched-ack corrections) inside tests/e2e/netcode.spec.ts.
 * Neither is an official matrix cell — the harness labels every run it produces as diagnostic.
 */
export const SPIKE_DISPATCH_ID = 'UDG-SPIKE-001';

const stringFlag = (flags: Record<string, string | boolean>, key: string): string | null =>
  typeof flags[key] === 'string' ? String(flags[key]) : null;

/**
 * The spike cell and coordinate contract (slice 11). ONE real full-profile matrix runner —
 * `full-window` — is parameterized by an EXPLICIT --profile and --seed: it takes no defaults at
 * all, formal or otherwise, because a matrix coordinate that silently inherits a profile is not
 * the coordinate it labels. Under `UDG_GATE_A_FORMAL=1` NOTHING is defaulted: every cell names
 * its profile and seed, matrix seeds are the official set, `self-check` (a pure-Node smoke) and
 * the legacy `elevated-full` alias (baked-in elevated profile) are refused as formal cells. The
 * scenario cells (ga9-ga13, ga-scenarios, ga11-calibration, ab-controls) stay SEPARATE coverage
 * and never substitute for a matrix coordinate.
 */
export const SPIKE_CELLS = ['self-check', 'full-window', 'elevated-full', 'ab-controls', 'ga-scenarios', 'ga11-calibration', 'ga9-ga13', 'lan-smoke'] as const;
export const SPIKE_MATRIX_CELLS = ['full-window'] as const;
export const SPIKE_SCENARIO_CELLS = ['ab-controls', 'ga-scenarios', 'ga11-calibration', 'ga9-ga13'] as const;
/** The routine-CI fast smoke (grant T-6): never formal, never a matrix coordinate, no capture. */
export const SPIKE_SMOKE_CELLS = ['lan-smoke'] as const;
/** Mirrors tools/load-test/src/run-spike.ts SPIKE_PROFILES; a unit test pins the two lists equal. */
export const SPIKE_PROFILE_NAMES = ['lan', 'moderate', 'elevated', 'poor'] as const;
export const SPIKE_OFFICIAL_SEEDS = [1001, 1002, 1003] as const;

export interface SpikeRequest {
  readonly cell: string;
  /** The runner cell the browser spec greps on (elevated-full maps onto the full-window runner). */
  readonly runnerCell: string;
  readonly profile: string;
  readonly seed: number;
  readonly env: Readonly<Record<string, string>>;
}

export type SpikeValidation =
  | { readonly ok: true; readonly request: SpikeRequest }
  | { readonly ok: false; readonly reason: string };

export const validateSpikeRequest = (
  flags: Record<string, string | boolean>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SpikeValidation => {
  const formal = env['UDG_GATE_A_FORMAL'] === '1';
  const cell = stringFlag(flags, 'cell') ?? 'self-check';
  if (!(SPIKE_CELLS as readonly string[]).includes(cell)) {
    return { ok: false, reason: `unknown cell "${cell}". Cells: ${SPIKE_CELLS.join(' | ')}` };
  }
  const profileRaw = stringFlag(flags, 'profile');
  const seedRaw = stringFlag(flags, 'seed');
  if (profileRaw !== null && !(SPIKE_PROFILE_NAMES as readonly string[]).includes(profileRaw)) {
    return { ok: false, reason: `unknown profile "${profileRaw}"; the adopted set is ${SPIKE_PROFILE_NAMES.join('|')}` };
  }
  if (seedRaw !== null && !/^\d+$/.test(seedRaw)) {
    return { ok: false, reason: `--seed must be an integer, got "${seedRaw}"` };
  }
  if (cell === 'elevated-full') {
    if (formal) {
      return { ok: false, reason: 'elevated-full is the legacy alias with a BAKED-IN elevated profile and is not a formal matrix runner; formal matrix legs run --cell full-window with an explicit --profile and --seed' };
    }
    if (profileRaw !== null && profileRaw !== 'elevated') {
      return { ok: false, reason: `elevated-full takes no --profile other than elevated (got "${profileRaw}"); it is the legacy elevated runner — use --cell full-window for a parameterized coordinate` };
    }
    const seed = seedRaw === null ? 1001 : Number(seedRaw);
    return {
      ok: true,
      request: {
        cell, runnerCell: 'full-window', profile: 'elevated', seed,
        env: { UDG_SPIKE_CELL: 'full-window', UDG_SPIKE_PROFILE: 'elevated', UDG_SPIKE_PROFILE_SOURCE: 'legacy-elevated-full', UDG_SPIKE_SEED: String(seed) },
      },
    };
  }
  if (cell === 'self-check') {
    if (formal) return { ok: false, reason: 'self-check is the pure-Node proxy smoke, not a formal cell' };
    const profile = profileRaw ?? 'lan';
    const seed = seedRaw === null ? 1001 : Number(seedRaw);
    return { ok: true, request: { cell, runnerCell: cell, profile, seed, env: {} } };
  }
  if ((SPIKE_SMOKE_CELLS as readonly string[]).includes(cell)) {
    if (formal) {
      return { ok: false, reason: `${cell} is the routine CI fast smoke (grant T-6) — it never runs under UDG_GATE_A_FORMAL=1; formal legs run --cell full-window or a scenario cell` };
    }
    if (profileRaw === null) return { ok: false, reason: `cell ${cell} requires an explicit --profile — no silent defaults` };
    if (seedRaw === null) return { ok: false, reason: `cell ${cell} requires an explicit --seed — no silent defaults` };
    return {
      ok: true,
      request: {
        cell, runnerCell: cell, profile: profileRaw, seed: Number(seedRaw),
        env: { UDG_SPIKE_CELL: cell, UDG_SPIKE_PROFILE: profileRaw, UDG_SPIKE_PROFILE_SOURCE: 'explicit', UDG_SPIKE_SEED: seedRaw },
      },
    };
  }
  // From here: the matrix runner and the scenario cells. NO silent defaults for these — explicit
  // profile and seed always; formal additionally pins the matrix seed to the official set.
  if (profileRaw === null) {
    return { ok: false, reason: `cell ${cell} requires an explicit --profile (${SPIKE_PROFILE_NAMES.join('|')}) — no silent defaults: a run whose regime was not named cannot report under it` };
  }
  if (seedRaw === null) {
    return { ok: false, reason: `cell ${cell} requires an explicit --seed — no silent defaults` };
  }
  const seed = Number(seedRaw);
  if ((SPIKE_MATRIX_CELLS as readonly string[]).includes(cell) && formal && !(SPIKE_OFFICIAL_SEEDS as readonly number[]).includes(seed)) {
    return { ok: false, reason: `formal matrix seed ${String(seed)} is not in the adopted official set (${SPIKE_OFFICIAL_SEEDS.join(', ')})` };
  }
  return {
    ok: true,
    request: {
      cell, runnerCell: cell, profile: profileRaw, seed,
      env: { UDG_SPIKE_CELL: cell, UDG_SPIKE_PROFILE: profileRaw, UDG_SPIKE_PROFILE_SOURCE: 'explicit', UDG_SPIKE_SEED: String(seed) },
    },
  };
};

export const spikeHandled = (flags: Record<string, string | boolean>): boolean =>
  stringFlag(flags, 'id') === SPIKE_DISPATCH_ID;

export const spikeDispatch = (flags: Record<string, string | boolean>): number => {
  const root = process.cwd();
  const validated = validateSpikeRequest(flags);
  if (validated.ok !== true) {
    process.stderr.write(`test:spike --id ${SPIKE_DISPATCH_ID}: ${validated.reason}\n`);
    return 2;
  }
  const request = validated.request;
  const build = runCommand(['node', join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tools', 'load-test', 'tsconfig.json')], { cwd: root, timeoutMs: 180_000 });
  if (build.exitCode !== 0) {
    process.stderr.write('test:spike: the load-test harness failed to build:\n');
    process.stdout.write(build.stdout);
    process.stderr.write(build.stderr);
    return build.exitCode;
  }
  if (request.cell === 'self-check') {
    const result = runCommand(['node', join(root, 'tools', 'load-test', 'dist', 'run-spike.js'), '--self-check', '--profile', request.profile, '--seed', String(request.seed)], { cwd: root, timeoutMs: 10 * 60 * 1000 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.timedOut) process.stderr.write('test:spike self-check timed out after 10 minutes\n');
    return result.timedOut ? 124 : result.exitCode;
  }
  const result = runCommand(
    ['pnpm', 'exec', 'playwright', 'test', 'tests/e2e/netcode.spec.ts', '--project=chromium', '-g', `spike cell: ${request.runnerCell}`],
    { cwd: root, timeoutMs: 30 * 60 * 1000, env: { ...request.env } },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.timedOut) process.stderr.write(`test:spike ${request.cell} cell timed out after 30 minutes\n`);
  return result.timedOut ? 124 : result.exitCode;
};

const main = (): number => {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  const forwarded = Object.entries(flags).map(([key, value]) =>
    value === true ? `--${key}` : `--${key}=${value}`,
  );
  if (command === 'test:spike' && spikeHandled(flags)) {
    // Announce loudly that THIS is the spike harness dispatch and that what it produces is a
    // diagnostic — never a Gate A matrix cell, never a merge, never a verdict.
    process.stdout.write(`dispatching the ${SPIKE_DISPATCH_ID} spike harness (cell=${stringFlag(flags, 'cell') ?? 'self-check'}; DIAGNOSTIC only — never an official matrix cell, never Gate A)\n`);
    return spikeDispatch(flags);
  }
  const result = guardUnavailable(command, forwarded);
  if (result.exitCode === 0) {
    // Announce the dispatch, then hand the terminal to Playwright: the first line is what a reader of a CI log
    // uses to tell "the suite ran" apart from "the guard let something through".
    process.stdout.write(result.message);
    return runImplementedSuite(command ?? '', forwarded);
  }
  process.stderr.write(result.message.endsWith('\n') ? result.message : `${result.message}\n`);
  return result.exitCode;
};

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
