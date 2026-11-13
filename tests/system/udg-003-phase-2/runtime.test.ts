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

const runScript = (relative: string, args: readonly string[] = []): void => {
  const executed = run([process.execPath, relative, ...args], 240_000);
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

  it('re-runs PR-14 so the replay reads a journal this commit produced (R-1)', () => {
    // The probe's journal travels inside its own result file. Replaying a result left over from an earlier
    // commit would be replaying a room this commit never ran, so the suite runs the probe here first.
    runScript('tests/probes/pr14-gate-a.probe.ts', ['--out', join(ROOT, 'artifacts', 'probes', 'PR-14.probe-result.json')]);
    const resultPath = join(ROOT, 'artifacts', 'probes', 'PR-14.probe-result.json');
    expect(existsSync(resultPath), 'PR-14 must write its probe result').toBe(true);
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      verdict: string;
      checks: { name: string; ok: boolean; detail: string }[];
      observations: Record<string, unknown>;
    };
    expect(result.verdict).toBe('pass');
    expect(result.checks.filter((entry) => !entry.ok).map((entry) => entry.name)).toEqual([]);
    for (const name of [
      'the-rooms-journal-replays-to-the-same-dispositions-state-and-tip',
      'the-digest-blanked-journal-replays-to-the-same-tip',
      'a-tampered-prologue-is-refused-rather-than-replayed',
    ]) {
      expect(result.checks.some((entry) => entry.name === name), `PR-14 check ${name}`).toBe(true);
    }
    // The journal is retained INSIDE the result: rows, chain, prologue and the configuration it ran on.
    const record = (result.observations['journalRecord'] ?? {}) as {
      rows: unknown[];
      chain: unknown[];
      prologue: Record<string, unknown> | null;
      configDocument: Record<string, unknown> | null;
    };
    expect(record.rows.length).toBeGreaterThan(0);
    expect(record.chain.length).toBeGreaterThan(0);
    expect(record.prologue).not.toBeNull();
    expect(record.configDocument).not.toBeNull();
  }, 300_000);

  it('replays every retained journal in a process that never saw a room (R-1: GA-13, AC-3d, AC-20)', () => {
    runScript('tests/runtime/udg-003-phase-2/journal-replay.ts');
    const replay = JSON.parse(readFileSync(join(OUT_DIR, 'journal-replay.json'), 'utf8')) as {
      verdict: string;
      rooms: {
        source: string;
        replayed: boolean;
        equal: boolean;
        blankedEqual: boolean;
        tamperedPrologueRefused: boolean;
        integrityIssues: string[];
        controls: { wrongStepper: string; editedDispositionDetected: boolean; changedChainHashDetected: boolean };
        mismatches: unknown[];
      }[];
      scenarios: { scenario: string; replayed: boolean; coverage: string }[];
      summary: { scenariosAccountedFor: number; scenariosReplayed: number };
      missingInputs: unknown[];
    };
    expect(replay.verdict).toBe('pass');
    // Population + recovery rooms + the probe's room.
    expect(replay.rooms.length).toBeGreaterThanOrEqual(6);
    for (const room of replay.rooms) {
      expect(room.replayed, `${room.source} was not replayed`).toBe(true);
      expect(room.equal, `${room.source}: dispositions, canonical state or chain hashes differ from the retained journal`).toBe(true);
      expect(room.blankedEqual, `${room.source}: the digest-blanked journal did not replay to the same outcome`).toBe(true);
      expect(room.tamperedPrologueRefused, `${room.source}: a tampered prologue was accepted`).toBe(true);
      expect(room.integrityIssues, `${room.source}: the journal is incomplete, unsanitised or untrusted`).toEqual([]);
      expect(room.controls.editedDispositionDetected, `${room.source}: an edited disposition went unnoticed`).toBe(true);
      expect(room.controls.changedChainHashDetected, `${room.source}: a changed chain hash went unnoticed`).toBe(true);
      expect(room.controls.wrongStepper, `${room.source}: a wrong stepper went unnoticed`).not.toBe('not-detected');
      expect(room.mismatches, `${room.source}: mismatches were recorded`).toEqual([]);
    }
    // Every scenario in the Phase 2 inventory is accounted for, replayed or named with a reason.
    expect(replay.summary.scenariosAccountedFor).toBeGreaterThanOrEqual(16);
    expect(replay.summary.scenariosReplayed).toBeGreaterThanOrEqual(10);
    expect(replay.scenarios.every((entry) => typeof entry.coverage === 'string' && entry.coverage !== '')).toBe(true);
    expect(replay.missingInputs).toEqual([]);
  }, 300_000);

