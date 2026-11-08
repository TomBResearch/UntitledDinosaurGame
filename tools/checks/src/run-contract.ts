/**
 * Task suite dispatcher (UDG-001).
 *
 * `pnpm test:contract -- --task UDG-002` must do one of two honest things: run the task's own
 * suite, or refuse with the reason. It never reports success for a suite that does not exist, and
 * it accepts every task id in this contracts edition so a typo cannot silently select nothing.
 *
 * See docs/contracts/repository.md 3.2 and 3.3.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CONTRACT_TASK_IDS,
  isContractTaskId,
  isMainModule,
  parseArgs,
  runCommand,
  type RunResult,
} from './support.js';

export interface DispatchPlan {
  readonly taskId: string;
  readonly suitePath: string;
  readonly command: readonly string[];
}

/** Resolve a task id to its suite path without touching the filesystem. */
export const planContractRun = (taskId: string): DispatchPlan => ({
  taskId,
  suitePath: `tests/contracts/${taskId}.test.ts`,
  command: ['pnpm', 'exec', 'vitest', 'run', `tests/contracts/${taskId}.test.ts`],
});

const usage = (): string =>
  [
    'usage: pnpm test:contract -- --task <TASK_ID>',
    `valid task ids in this contracts edition: ${CONTRACT_TASK_IDS.join(', ')}`,
    '',
  ].join('\n');

export interface ContractOutcome {
  readonly exitCode: number;
  readonly message: string;
}

/** Decide, without running anything, what a given --task value should do. */
export const decideContractRun = (root: string, rawTask: string | undefined): ContractOutcome & { plan?: DispatchPlan } => {
  if (rawTask === undefined || rawTask === '') {
    return { exitCode: 2, message: `--task is required.\n${usage()}` };
  }
  if (!isContractTaskId(rawTask)) {
    return {
      exitCode: 2,
      message: `"${rawTask}" is not a task id in UDG-CONTRACTS-M0-001 v1.0.\n${usage()}`,
    };
  }
  const plan = planContractRun(rawTask);
  if (!existsSync(join(resolve(root), plan.suitePath))) {
    return {
      exitCode: 2,
      message:
        `Task ${rawTask} has no suite at ${plan.suitePath}.\n` +
        `That suite is created by ${rawTask} itself (docs/contracts/${rawTask}.md). ` +
        'The dispatcher refuses to report success for an absent suite; see docs/contracts/repository.md 3.2.',
    };
  }
  return { exitCode: 0, message: `running ${plan.suitePath}`, plan };
};

const main = (): number => {
  const root = process.cwd();
  const flags = parseArgs(process.argv.slice(2)).flags;
  const rawTask = typeof flags['task'] === 'string' ? flags['task'] : undefined;
  const decision = decideContractRun(root, rawTask);

  if (decision.plan === undefined) {
    process.stderr.write(decision.message.endsWith('\n') ? decision.message : `${decision.message}\n`);
    return decision.exitCode;
  }

  process.stdout.write(`test:contract ${rawTask ?? ''} -> ${decision.plan.suitePath}\n`);
  const result: RunResult = runCommand(decision.plan.command, { cwd: root, timeoutMs: 30 * 60 * 1000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.timedOut) {
    process.stderr.write(`test:contract ${rawTask ?? ''} timed out after 30 minutes\n`);
  }
  if (result.exitCode !== 0) {
    process.stderr.write(`test:contract ${rawTask ?? ''} FAILED with exit code ${String(result.exitCode)}\n`);
  }
  return result.exitCode;
};

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
