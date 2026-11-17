/**
 * UDG-003 Phase 3, W-A step 2: the repeatability loop for the `W-7` and `P-2b` cases.
 *
 * One iteration = one live impairment probe into its own artefact directory + one per-assertion audit of
 * that artefact (`wa-assertion-audit.ts`). The loop is what turns "it failed once on a runner" into a rate,
 * and the rate is what the diagnosis has to be measured against. `--load <n>` starts `n` busy-spinners for
 * the duration of the loop, which is how the declared load is applied: the hosted failures arrived on a
 * contended 4-vCPU runner, and a diagnosis that cannot reproduce under contention cannot claim to fix it.
 *
 * Nothing here changes behaviour: the spinners compete for CPU, the probe runs unmodified, and every
 * iteration's artefact directory, audit and exit status are retained.
 *
 * Usage: node tests/system/udg-003-phase-3/wa-loop.ts --iterations <n> [--load <spinners>] --out <dir>
 *        [--label <text>] [--only w7|p2b|all]
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

interface Audit {
  checked?: number;
  passed?: number;
  failing?: { id: string; defect: string; expectation: string; actual: unknown }[];
  [key: string]: unknown;
}

const objectOf = (value: unknown): Audit =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Audit) : {};

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};

const iterations = Number(flag('iterations', '1'));
const spinners = Number(flag('load', '0'));
const outDir = resolve(flag('out', join('artifacts', 'udg-003-phase-3', 'wa-loop')));
const label = flag('label', 'unlabelled');
const only = flag('only', 'all');

mkdirSync(outDir, { recursive: true });
const resultsPath = join(outDir, 'iterations.jsonl');
const summaryPath = join(outDir, 'summary.json');

const spinnerPath = join(outDir, 'spinner.mjs');
writeFileSync(
  spinnerPath,
  "const stopAt = Date.now() + 45 * 60 * 1000;\nwhile (Date.now() < stopAt) { Math.sqrt(Math.random()); }\n",
);

const started = new Date().toISOString();
const loads: ReturnType<typeof spawn>[] = [];
for (let index = 0; index < spinners; index += 1) {
  loads.push(spawn(process.execPath, [spinnerPath], { stdio: 'ignore', detached: false }));
}

const auditFor = (directory: string, file: string): Audit => {
  const audited = spawnSync(process.execPath, ['tests/system/udg-003-phase-3/wa-assertion-audit.ts', '--dir', directory, '--out', file], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const parsed = objectOf(JSON.parse(readFileSync(file, 'utf8')));
  return { ...parsed, exitCode: audited.status ?? -1 };
};

interface Iteration {
  iteration: number;
  probeExit: number;
  probeSeconds: number;
  auditExit: number;
  checked: number;
  passed: number;
  failing: { id: string; defect: string; expectation: string; actual: unknown }[];
  w7Failing: string[];
  p2bFailing: string[];
}

const results: Iteration[] = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const directory = join(outDir, `iter-${String(iteration).padStart(3, '0')}`);
  mkdirSync(directory, { recursive: true });
  const probeStarted = Date.now();
  const probe = spawnSync(process.execPath, ['tests/runtime/udg-003-phase-2/impairment-population.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 240_000,
    env: { ...process.env, UDG_VECTORS_OUT: directory },
  });
  const probeSeconds = (Date.now() - probeStarted) / 1000;
  const audit = auditFor(directory, join(directory, 'wa-assertion-audit.json'));
  const failing = (audit['failing'] as Iteration['failing']) ?? [];
  const row: Iteration = {
    iteration,
    probeExit: probe.status ?? -1,
    probeSeconds: Number(probeSeconds.toFixed(1)),
    auditExit: typeof audit['exitCode'] === 'number' ? audit['exitCode'] : -1,
    checked: typeof audit['checked'] === 'number' ? audit['checked'] : 0,
    passed: typeof audit['passed'] === 'number' ? audit['passed'] : 0,
    failing,
    w7Failing: failing.filter((entry) => entry.defect === 'W-7').map((entry) => entry.id),
    p2bFailing: failing.filter((entry) => entry.defect === 'P-2b').map((entry) => entry.id),
  };
  results.push(row);
  appendFileSync(resultsPath, `${JSON.stringify({ ...row, label, spinners })}\n`);
  process.stdout.write(
    `[wa-loop] ${label} iter ${String(iteration)}/${String(iterations)} probe ${row.probeExit} in ` +
      `${String(row.probeSeconds)}s audit ${String(audit['passed'])}/${String(audit['checked'])}` +
      `${row.w7Failing.length + row.p2bFailing.length === 0 ? '' : ` FAILING ${[...row.w7Failing, ...row.p2bFailing].join(',')}`}\n`,
  );
  if (only === 'w7' && row.p2bFailing.length > 0) {
    // Still recorded; the filter only affects what the caller is asked to care about.
  }
}

for (const load of loads) load.kill('SIGKILL');

const summary = {
  schemaVersion: 1,
  task: 'UDG-003',
  phase: 'phase-3',
  label,
  started,
  finished: new Date().toISOString(),
  nodeVersion: process.version,
  cpus: cpus().length,
  loadSpinners: spinners,
  iterations,
  probeFailures: results.filter((row) => row.probeExit !== 0).length,
  auditFailures: results.filter((row) => row.auditExit !== 0).length,
  w7Failures: results.filter((row) => row.w7Failing.length > 0).length,
  p2bFailures: results.filter((row) => row.p2bFailing.length > 0).length,
  failingIds: [
    ...new Set(results.flatMap((row) => [...row.w7Failing, ...row.p2bFailing])),
  ],
  perIterationFailing: results.map((row) => ({
    iteration: row.iteration,
    failing: [...row.w7Failing, ...row.p2bFailing],
  })).filter((entry) => entry.failing.length > 0),
  results,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `[wa-loop] ${label}: ${String(iterations)} iterations, W-7 reds ${String(summary.w7Failures)}, ` +
    `P-2b reds ${String(summary.p2bFailures)}, probe errors ${String(summary.probeFailures)}; ` +
    `ids ${summary.failingIds.length === 0 ? 'none' : summary.failingIds.join(',')}\n`,
);
process.exit(0);
