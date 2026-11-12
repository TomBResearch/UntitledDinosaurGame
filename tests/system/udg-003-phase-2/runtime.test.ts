/**
 * The Phase 2 runtime suites inside `pnpm test` (assignment §8.1: a zero-test or skipped suite is
 * not evidence; the population and recovery scenarios must therefore run in the suite, not only in
 * the capture plan).
 *
 * The scripts themselves are bare-Node TypeScript — the same runtime PR-14 uses — because the
 * pinned packages resolve exactly as `apps/server` resolves them and vitest's module pipeline is a
 * second, different set of semantics nobody needs here. This wrapper builds the server first (the
 * CI job runs `pnpm test` before its build step, and the scripts import the emitted room), spawns
 * each script, and reads back its verdict from the artefacts it wrote. A script that fails, hangs,
 * or writes an artefact that says `fail` fails this suite.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? join(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

const run = (argv: readonly string[], timeoutMs: number) => {
  const started = spawnSync(argv[0] ?? '', argv.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
  return {
    exitCode: started.status ?? (started.error !== undefined ? -1 : 0),
    stdout: started.stdout ?? '',
    stderr: started.stderr ?? '',
    timedOut: started.error !== undefined && String(started.error.message).includes('timed out'),
  };
};

const runScript = (relative: string): void => {
  const executed = run([process.execPath, relative], 240_000);
  const tail = executed.stderr.split('\n').filter((line) => line.includes('[')).slice(-6).join('\n');
  expect(executed.timedOut, `${relative} timed out`).toBe(false);
  expect(executed.exitCode, `${relative} exited ${String(executed.exitCode)}\n${tail}`).toBe(0);
};

describe('UDG-003 Phase 2 runtime — the population and the recovery scenarios', () => {
  it('builds the server the scripts drive (the suite runs before the job builds it)', () => {
    const built = run(['pnpm', '--filter', '@udg/server', 'build'], 240_000);
    expect(built.exitCode, `server build failed: ${built.stdout}${built.stderr}`).toBe(0);
    expect(existsSync(join(ROOT, 'apps', 'server', 'dist', 'rooms', 'RegionRoom.js'))).toBe(true);
  });

  it('runs the adversarial population and reads back a passing verdict (W-10, W-9)', () => {
    runScript('tests/runtime/udg-003-phase-2/abuse-population.ts');
    const resultsPath = join(OUT_DIR, 'abuse-results.json');
    expect(existsSync(resultsPath), 'the population must write abuse-results.json').toBe(true);
    const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
      verdict: string;
      scenarios: { scenario: string; pass: boolean }[];
    };
    expect(results.verdict).toBe('pass');
    expect(results.scenarios.filter((entry) => !entry.pass).map((entry) => entry.scenario)).toEqual([]);
    const w9 = JSON.parse(readFileSync(join(OUT_DIR, 'close-path-accounting.json'), 'utf8')) as { measurement: Record<string, unknown> };
    expect(typeof w9.measurement['serverQueuedAtClose']).toBe('number');
  }, 300_000);

  it('runs the recovery scenarios and reads back a passing verdict (W-7)', () => {
    runScript('tests/runtime/udg-003-phase-2/recovery-scenarios.ts');
    const harnessPath = join(OUT_DIR, 'recovery-harness.json');
    expect(existsSync(harnessPath), 'the scenarios must write recovery-harness.json').toBe(true);
    const harness = JSON.parse(readFileSync(harnessPath, 'utf8')) as {
      verdict: string;
      scenarios: { name: string; pass: boolean }[];
    };
    expect(harness.verdict).toBe('pass');
    expect(harness.scenarios.filter((entry) => !entry.pass).map((entry) => entry.name)).toEqual([]);
  }, 300_000);
});
