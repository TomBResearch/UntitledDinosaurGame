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

import { UNAVAILABLE_SUITES, isMainModule, parseArgs } from './support.js';

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

const main = (): number => {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0];
  const forwarded = Object.entries(flags).map(([key, value]) =>
    value === true ? `--${key}` : `--${key}=${value}`,
  );
  const result = guardUnavailable(command, forwarded);
  if (result.exitCode === 0) return 0;
  process.stderr.write(result.message.endsWith('\n') ? result.message : `${result.message}\n`);
  return result.exitCode;
};

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
