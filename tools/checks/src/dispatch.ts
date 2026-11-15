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

const main = (): number => {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  const forwarded = Object.entries(flags).map(([key, value]) =>
    value === true ? `--${key}` : `--${key}=${value}`,
  );
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
