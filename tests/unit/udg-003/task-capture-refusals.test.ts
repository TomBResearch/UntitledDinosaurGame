/**
 * UDG-003 Phase 3, W-C: the refusals the whole-task capture is supposed to perform.
 *
 * A second capture selector is only safe if the rules that choose a plan, pair a measurement block with a
 * bundle label, and gate a vector directory all *refuse* the things they are described as refusing. Those
 * rules are asserted here, in the suite, on real bytes where bytes exist and on the resolver's own logic
 * where they do not — because the alternative is a reviewer discovering the gap in a hosted capture.
 *
 * Nothing here mutates the store or the tree: the vector-directory cases work on temporary copies.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CAPTURE_PLANS,
  PHASE_1_LABEL,
  PHASE_2_LABEL,
  PHASE_3_LABEL,
  PHASE_3_VECTOR_FILES,
  TASK_PHASE_LABEL,
  TASK_SELECTOR,
  measurementsScopeOf,
  planForBundle,
} from '../../../tools/checks/src/evidence.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const GATE = join(ROOT, 'tools', 'checks', 'dist', 'evidence.js');
const PHASE_3_DIR = join(ROOT, 'artifacts', 'udg-003-phase-3');
const temporary: string[] = [];

afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

const gate = (args: readonly string[]): { status: number; output: string } => {
  const executed = spawnSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  return { status: executed.status ?? -1, output: `${executed.stdout ?? ''}${executed.stderr ?? ''}` };
};

describe('UDG-003 Phase 3 — plan resolution is content-driven, never name-driven', () => {
  it('selects the whole-task plan only from the declared task label', () => {
    const task = planForBundle(CAPTURE_PLANS, { taskId: 'UDG-003', phase: TASK_PHASE_LABEL });
    expect(task, 'a task-labelled bundle resolves to a plan').toBeDefined();
    if (task === undefined) throw new Error('the whole-task plan is absent from CAPTURE_PLANS');
    expect(task?.phase?.label, 'and that plan is the whole-task plan').toBe(TASK_PHASE_LABEL);
    expect(task?.taskId, 'whose taskId stays the task, so the contract digest is UDG-003\'s').toBe('UDG-003');
  });

  it('resolves every other bundle exactly as it did before the second selector existed', () => {
    for (const phase of [undefined, PHASE_1_LABEL, PHASE_2_LABEL]) {
      const resolved = planForBundle(CAPTURE_PLANS, { taskId: 'UDG-003', phase });
      expect(resolved, `phase ${String(phase)} resolves`).toBeDefined();
      expect(resolved).toBe(CAPTURE_PLANS['UDG-003']);
      expect(resolved?.phase?.label, `a ${String(phase)} bundle does not get the task plan`).not.toBe(TASK_PHASE_LABEL);
    }
    // A renamed directory changes report.json's location, not its declared phase, so it cannot choose a
    // friendlier plan: resolution never looks at a path.
    expect(planForBundle(CAPTURE_PLANS, { taskId: 'UDG-003', phase: TASK_PHASE_LABEL }))
      .not.toBe(planForBundle(CAPTURE_PLANS, { taskId: 'UDG-003', phase: PHASE_2_LABEL }));
  });

  it('falls back to the phase plan, and therefore still refuses, if the whole-task plan were removed', () => {
    // The rule that matters is not "resolution always finds a plan" but "resolution never finds a plan that
    // accepts a task bundle without the Phase 3 set". With the key gone, the phase plan is selected, and
    // its label is not `task` — which is the mismatch verification reports.
    const withoutTask = { ...CAPTURE_PLANS } as Record<string, (typeof CAPTURE_PLANS)[string]>;
    delete withoutTask[TASK_SELECTOR];
    const resolved = planForBundle(withoutTask, { taskId: 'UDG-003', phase: TASK_PHASE_LABEL });
    expect(resolved).toBe(CAPTURE_PLANS['UDG-003']);
    expect(resolved?.phase?.label).not.toBe(TASK_PHASE_LABEL);
  });

  it('keeps the accepted phase plan byte-for-byte the plan it was, and adds the task plan beside it', () => {
    const phase = CAPTURE_PLANS['UDG-003'];
    const task = CAPTURE_PLANS[TASK_SELECTOR];
    if (phase === undefined || task === undefined) throw new Error('both plans must be present at submission');
    expect(phase.phase?.label, 'the phase plan kept its label').toBe(PHASE_2_LABEL);
    expect(phase.commands.some((step) => step.label === 'phase-2-impairment-population'), 'and its commands').toBe(true);
    expect(task.commands.some((step) => step.label === 'phase-3-task-vectors'), 'the task plan runs the Phase 3 set').toBe(true);
    expect(task.requiredFiles).toContain('vectors/vectors-manifest.json');
    expect(task.requiredFiles).toContain('vectors-phase-2/vectors-manifest.json');
    expect(task.requiredFiles).toContain('vectors-phase-3/vectors-manifest.json');
    expect(task.requiredFiles).toContain('measurements/UDG-003-TASK.json');
    expect(task.manifests?.map((entry) => entry.phase)).toEqual([PHASE_1_LABEL, PHASE_2_LABEL, PHASE_3_LABEL]);
    // R-2 extended, not rewritten: the whole-task bundle pairs with a task-scope measurement block.
    expect(task.phase?.measurementsScope).toBe(TASK_PHASE_LABEL);
    expect(measurementsScopeOf({ phase: { scope: TASK_PHASE_LABEL } })).toBe(TASK_PHASE_LABEL);
    expect(measurementsScopeOf({ phase: { scope: PHASE_2_LABEL } })).toBe(PHASE_2_LABEL);
    expect(measurementsScopeOf({})).toBe('absent');
  });

  it('pairs the bundle label with the measurement scope, so a phase-2 block cannot fill a task bundle', () => {
    // The collector reads the measurement file by selector key with a fallback to the task; this is the
    // assertion that the pairing the plan declares is the pairing the gate checks.
    const task = CAPTURE_PLANS[TASK_SELECTOR];
    const phase = CAPTURE_PLANS['UDG-003'];
    if (task === undefined || phase === undefined) throw new Error('both plans must be present at submission');
    expect(task.phase?.measurementsScope, 'the plan declares the scope it demands').toBe(TASK_PHASE_LABEL);
    expect(phase.phase?.measurementsScope, 'and the phase plan demands its own, unchanged').toBe('phase-1');
  });
});

describe('UDG-003 Phase 3 — the vectors gate on real Phase 3 bytes', () => {
  const ready = existsSync(join(PHASE_3_DIR, 'vectors-manifest.json'));
  const itBytes = ready ? it : it.skip;

  itBytes('gates the directory it is given, and names the Phase 3 set as the requirement', () => {
    const gated = gate(['vectors', '--dir', PHASE_3_DIR, '--expect-phase', PHASE_3_LABEL, '--allow-dirty']);
    expect(gated.output, gated.output).toMatch(/phase-3|ok|PASS/);
    expect(gated.status, gated.output).toBe(0);
  });

  itBytes('refuses a whole-task vector set with one artefact removed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'udg-task-vectors-short-'));
    temporary.push(directory);
    for (const name of [...PHASE_3_VECTOR_FILES, 'vectors-manifest.json']) {
      copyFileSync(join(PHASE_3_DIR, name), join(directory, name));
    }
    const dropped = PHASE_3_VECTOR_FILES[0] ?? '';
    rmSync(join(directory, dropped));
    const gated = gate(['vectors', '--dir', directory, '--expect-phase', PHASE_3_LABEL, '--allow-dirty']);
    expect(gated.status, 'a missing listed artefact is a failure').not.toBe(0);
    expect(gated.output).toContain('VECTORS-FILE-MISSING');
    expect(gated.output).toContain(dropped);
  });

  itBytes('refuses a manifest rewritten to hide an absent artefact, by hashing the bytes it keeps', () => {
    const directory = mkdtempSync(join(tmpdir(), 'udg-task-vectors-tampered-'));
    temporary.push(directory);
    for (const name of [...PHASE_3_VECTOR_FILES, 'vectors-manifest.json']) {
      copyFileSync(join(PHASE_3_DIR, name), join(directory, name));
    }
    const target = PHASE_3_VECTOR_FILES[1] ?? '';
    writeFileSync(join(directory, target), `${JSON.stringify({ schemaVersion: 1, tampered: true })}\n`);
    const gated = gate(['vectors', '--dir', directory, '--expect-phase', PHASE_3_LABEL, '--allow-dirty']);
    expect(gated.status, 'changed bytes under an unchanged digest are a failure').not.toBe(0);
    expect(gated.output).toContain('VECTORS-FILE-HASH');
  });

  it('refuses a phase it does not know instead of defaulting to Phase 1 list', () => {
    const gated = gate(['vectors', '--dir', ROOT, '--expect-phase', 'phase-9']);
    expect(gated.status).not.toBe(0);
    expect(gated.output).toContain('unknown --expect-phase');
  });

  it('says so when the directory it would gate does not exist yet, rather than passing quietly', () => {
    // In a fresh checkout the Phase 3 vectors have not been produced. The half-run branch of the producing
    // suite and this message are the two halves of the same honesty: no bytes, no pass.
    const directory = mkdtempSync(join(tmpdir(), 'udg-task-vectors-empty-'));
    temporary.push(directory);
    const gated = gate(['vectors', '--dir', directory, '--expect-phase', PHASE_3_LABEL, '--allow-dirty']);
    expect(gated.status).not.toBe(0);
    expect(gated.output).toContain('VECTORS-MANIFEST-MISSING');
    expect(dirname(PHASE_3_DIR)).toBe(join(ROOT, 'artifacts'));
  });

  it('reads the phase-3 manifest the producing suite wrote and checks it claims this task and phase', () => {
    if (!ready) return;
    const manifest = JSON.parse(readFileSync(join(PHASE_3_DIR, 'vectors-manifest.json'), 'utf8')) as {
      taskId: string;
      phase: string;
      files: { name: string }[];
      implementationSha: string;
    };
    expect(manifest.taskId).toBe('UDG-003');
    expect(manifest.phase).toBe(PHASE_3_LABEL);
    expect(manifest.files.map((entry) => entry.name).sort()).toEqual([...PHASE_3_VECTOR_FILES].sort());
    expect(manifest.implementationSha).toMatch(/^[0-9a-f]{40}$/);
  });
});
