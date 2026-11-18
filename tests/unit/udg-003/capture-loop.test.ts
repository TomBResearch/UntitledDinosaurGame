/**
 * UDG-003 Phase 3, W-C: an earlier failed capture cannot prevent a later plan's evidence from existing.
 *
 * The behaviour under test is `tools/ci/capture-plans.sh`, and the reason it is a file rather than an inline
 * loop in `.github/workflows/ci.yml` is observable: three hosted jobs on 2026-11-18 aborted the capture step at
 * the second plan and produced no `UDG-003`, `UDG-003-TASK` or `UDG-004` bundle at all, including the run whose
 * `W-7` red was the reason whole-task evidence was wanted. Two properties have to hold together, and a loop that
 * satisfies only one of them is wrong:
 *
 *   1. every plan is attempted and its bundle retained, whatever failed before it;
 *   2. the job still fails, because a required capture that failed must not be able to pass.
 *
 * The loop is driven through `--plans-cmd` and `--capture-cmd` against a stub in a temporary directory, so the
 * failure being simulated is a real non-zero capture exit against real files on disk — not a mock of the tool's
 * internals. The defaults of those two flags are the production commands, and no test changes what CI runs.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const LOOP = join(ROOT, 'tools', 'ci', 'capture-plans.sh');
// C-07 moved full evidence capture into its own dispatched workflow, so the loop CI actually runs lives in
// `acceptance.yml`. `ci.yml` is read too, to prove the routine lane cannot reach the loop at all.
const CI = join(ROOT, '.github', 'workflows', 'acceptance.yml');
const ROUTINE_CI = join(ROOT, '.github', 'workflows', 'ci.yml');
const scratch: string[] = [];

const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-capture-loop-'));
  scratch.push(directory);
  return directory;
};

/**
 * A stub capture: writes the same shape of output the real tool writes — a bundle directory with a file and a
 * run pointer — then exits with the status the scenario asks for. `UDG_STUB_FAIL` is the comma-separated list of
 * tasks that must fail.
 */
const writeStub = (directory: string): string => {
  const file = join(directory, 'stub-capture.sh');
  writeFileSync(file, `#!/usr/bin/env bash
set -uo pipefail
task=""
out="artifacts"
while [ $# -gt 0 ]; do
  case "$1" in
    --task) task="$2"; shift 2 ;;
    --out)  out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$out/$task"
printf 'bundle for %s\\n' "$task" > "$out/$task/report.json"
mkdir -p "$out"
printf 'artifacts/%s\\n' "$task" > "$out/latest-$task.txt"
case ",\${UDG_STUB_FAIL}," in
  *",$task,"*) exit 1 ;;
  *) exit 0 ;;
esac
`);
  chmodSync(file, 0o755);
  return file;
};

const runLoop = (tasks: readonly string[], failFor: readonly string[]): {
  status: number;
  output: string;
  directory: string;
  out: string;
} => {
  const directory = temporary();
  const out = join(directory, 'artifacts');
  mkdirSync(out, { recursive: true });
  const plansFile = join(directory, 'plans.txt');
  writeFileSync(plansFile, `${tasks.join('\n')}\n`);
  const stub = writeStub(directory);
  const executed = spawnSync('bash', [
    LOOP,
    '--plans-cmd', `cat ${plansFile}`,
    '--capture-cmd', `bash ${stub}`,
    '--out', out,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, UDG_STUB_FAIL: failFor.join(',') },
  });
  return { status: executed.status ?? -1, output: `${executed.stdout ?? ''}${executed.stderr ?? ''}`, directory, out };
};

const retained = (out: string, task: string): boolean => {
  try {
    return readFileSync(join(out, task, 'report.json'), 'utf8').includes(task)
      && readFileSync(join(out, `latest-${task}.txt`), 'utf8').includes(task);
  } catch {
    return false;
  }
};

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

describe('UDG-003 Phase 3 W-C — the capture loop attempts every plan and still fails the job', () => {
  it('retains a later plan’s evidence when an earlier plan fails, and exits non-zero anyway', () => {
    const tasks = ['UDG-001', 'UDG-002', 'UDG-003', 'UDG-003-TASK', 'UDG-004'];
    const run = runLoop(tasks, ['UDG-002']);

    // (2) the job fails: a required capture that failed cannot be swallowed.
    expect(run.status, `the loop must fail when a plan failed:\n${run.output}`).toBe(1);
    expect(run.output).toContain('evidence capture failed for UDG-002');

    // (1) and every plan still ran, so every bundle still exists — including the whole-task one, which is the
    // bundle that the failed plan's own red would otherwise have made undiagnosable.
    for (const task of tasks) {
      expect(retained(run.out, task), `${task}'s bundle must exist even though UDG-002 failed before it`).toBe(true);
    }
    expect(run.output.match(/capturing the evidence bundle for/g)?.length, 'every plan is attempted').toBe(tasks.length);
  });

  it('keeps the bundles of plans that ran before a later failure, and names every failed plan', () => {
    const run = runLoop(['UDG-001', 'UDG-003-TASK', 'UDG-004'], ['UDG-004']);
    expect(run.status).toBe(1);
    for (const task of ['UDG-001', 'UDG-003-TASK', 'UDG-004']) {
      expect(retained(run.out, task), `${task} evidence`).toBe(true);
    }
    expect(run.output).toContain('evidence capture failed for 1 of 3 plans: UDG-004=1');
  });

  it('exits 0 when every plan succeeds, and refuses an empty plan list', () => {
    const clean = runLoop(['UDG-001', 'UDG-003-TASK'], []);
    expect(clean.status, `a green loop must exit 0:\n${clean.output}`).toBe(0);
    expect(clean.output).toContain('2 plan(s), none failing');

    const empty = spawnSync('bash', [LOOP, '--plans-cmd', 'true', '--out', temporary()], {
      cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    });
    expect(empty.status, 'no plans is not a pass').toBe(1);
    expect(`${empty.stdout}${empty.stderr}`).toContain('no task has a capture plan');
  });

  it('is the loop CI actually runs, and CI names the invocation the accepted contract requires', () => {
    const workflow = readFileSync(CI, 'utf8');
    expect(workflow, 'CI must call the loop rather than an inline abort-on-first-failure loop')
      .toContain('bash tools/ci/capture-plans.sh');
    // CI names the per-plan invocation in the step, because the accepted UDG-001 requirement that the capture
    // step runs `pnpm evidence:capture` is checked against ci.yml and not against this script. It must be the
    // production invocation — the same one the script falls back to — with TASK substituted per plan.
    const invocation = workflow.match(/--capture-cmd '([^']+)'/)?.[1] ?? '';
    expect(invocation).toBe('pnpm evidence:capture -- --task TASK --out artifacts --keep-going');
    const script = readFileSync(LOOP, 'utf8');
    expect(script).toContain("plans_cmd='node tools/checks/dist/evidence.js plans'");
    expect(script).toContain("capture_cmd='pnpm evidence:capture'");
    // The routine lane is capture-free by construction: no routing, no dispatch and no comment can bring the
    // loop back into it, because a routine green must never be mistaken for captured evidence (A-P3-8).
    const routine = readFileSync(ROUTINE_CI, 'utf8');
    expect(routine, 'ci.yml must not run the capture loop').not.toContain('capture-plans.sh');
    expect(routine, 'ci.yml captures no bundles').not.toContain('evidence:capture');
    expect(workflow, 'the stub is never reachable from CI').not.toMatch(/UDG_CI_(STUB|FAIL_BEFORE|PASS_BEFORE|PASS_AFTER)/);
    expect(script, 'the script must not abort the loop on the first non-zero capture').not.toMatch(/^set -euo/m);
  });
});
