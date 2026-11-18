/**
 * C-07: the two workflow files, asserted as one policy.
 *
 * Splitting CI into a routed lane and a dispatched acceptance run creates exactly one new way to be wrong:
 * the routing table and the job list drifting apart. A group the router can emit but no job consumes is a
 * check that silently stops running; a job conditioned on a group the router cannot emit is a job that
 * silently never runs. Both directions are asserted here, on the same source of truth
 * (`ROUTE_FLAGS` in the router) that the router's own suite uses.
 *
 * The rest of the file keeps the policies that were written for one workflow honest across two: the
 * `continue-on-error` prohibition, immutable action pins, the frozen installation, the artefact policy, and
 * the property that motivated the split — **a routine run captures no evidence, so a routine green can never
 * satisfy milestone acceptance.**
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROUTE_FLAGS } from '../../../tools/ci/route-checks.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const ROUTINE_FILE = '.github/workflows/ci.yml';
const ACCEPTANCE_FILE = '.github/workflows/acceptance.yml';
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const routine = read(ROUTINE_FILE);
const acceptance = read(ACCEPTANCE_FILE);
const files = [
  { file: ROUTINE_FILE, text: routine },
  { file: ACCEPTANCE_FILE, text: acceptance },
] as const;

/** Job ids of a workflow: the two-space-indented mapping keys under `jobs:`. */
const jobIds = (text: string): string[] => {
  const jobsBlock = text.slice(text.indexOf('\njobs:\n'));
  const ids: string[] = [];
  for (const line of jobsBlock.split('\n')) {
    const job = /^ {2}([a-z][\w-]*):\s*$/u.exec(line);
    if (job?.[1] !== undefined) ids.push(job[1]);
  }
  return ids;
};

/** The group a conditional job is keyed on, from `needs.route.outputs.<flag> == 'true'`. */
const gatedGroups = (text: string): string[] =>
  [...text.matchAll(/needs\.route\.outputs\.([A-Za-z]+)\s*==\s*'true'/gu)].map((match) => match[1] as string);

const workflowName = (text: string): string => /^name:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? '';

describe('CI workflows — the routing table and the job list are one design', () => {
  it('has exactly one conditional job per group the router can emit', () => {
    const jobs = jobIds(routine);
    const gated = gatedGroups(routine);

    for (const flag of ROUTE_FLAGS) {
      expect(gated, `no job in ${ROUTINE_FILE} is gated on the group ${flag}`).toContain(flag);
    }
    for (const group of gated) {
      expect(ROUTE_FLAGS, `${ROUTINE_FILE} gates a job on ${group}, which the router cannot emit`).toContain(group);
    }
    // And the job list is exactly those groups plus `route` and `outcome`: a lane job nobody can trigger, or a
    // group with no lane to run in, fails here rather than showing up as coverage that is not happening.
    const jobIdForGroup = (flag: string): string => flag.replace(/([A-Z])/gu, '-$1').toLowerCase();
    const lanes = jobs.filter((id) => id !== 'route' && id !== 'outcome').sort();
    expect(lanes).toEqual(ROUTE_FLAGS.map(jobIdForGroup).sort());
  });

  it('exports every group from the route job, so a new group cannot be added unwired', () => {
    const outputs = routine.slice(routine.indexOf('\n    outputs:\n'), routine.indexOf('\n    steps:\n'));
    for (const flag of ROUTE_FLAGS) {
      // A group that the router can emit but the route job does not export would be gated on an empty string,
      // which is false in every `if:` — a lane that quietly never runs.
      expect(outputs, `the route job does not export ${flag}`).toContain(`${flag}: \${{ steps.route.outputs.${flag} }}`);
    }
  });

  it('gates the final outcome on every lane, and refuses a run that checked nothing', () => {
    const outcome = routine.slice(routine.indexOf('  outcome:'));
    const needs = /needs:\s*\[([^\]]+)\]/u.exec(outcome)?.[1] ?? '';
    for (const id of jobIds(routine).filter((job) => job !== 'outcome')) {
      expect(needs, `outcome does not wait on ${id}`).toContain(id);
    }
    expect(outcome).toContain('if: ${{ always() }}');
    expect(outcome).toContain('failure|cancelled');
    expect(outcome).toContain('nothing was checked');
    expect(outcome).toContain('no evidence was captured on this route');
  });

  it('declares a timeout on every job, so a hung lane cannot hold the outcome open', () => {
    for (const entry of files) {
      const blocks = entry.text.split('\n').filter((line) => /^ {4}(runs-on:|timeout-minutes:)/u.test(line));
      const runners = blocks.filter((line) => line.includes('runs-on:')).length;
      const timeouts = blocks.filter((line) => line.includes('timeout-minutes:')).length;
      expect(timeouts, `${entry.file} has ${runners} jobs and ${timeouts} timeouts`).toBe(runners);
    }
  });

  it('fetches the whole history in every lane that checks the repository out', () => {
    // Not caution: `44371657860` failed two lanes because a shallow checkout could not resolve
    // `git show <sha>:docs/interfaces/movement-authority.md` (UDG-003) or `git cat-file` a cited prerequisite
    // (UDG-001). A suite that cannot see history fails for a reason unrelated to the change, in whichever lane
    // happens to run it, which is the worst kind of red.
    const jobBlocks = routine.split(/\n(?= {2}[a-z][\w-]*:\n)/u);
    const checkouts = jobBlocks.filter((block) => /uses: actions\/checkout@/u.test(block));
    expect(checkouts.length).toBeGreaterThan(5);
    for (const block of checkouts) {
      const id = /^ {2}([a-z][\w-]*):/u.exec(block)?.[1] ?? '<unknown>';
      expect(block, `${id} checks out a shallow clone`).toContain('fetch-depth: 0');
    }
  });
});

describe('CI workflows — one policy across both files', () => {
  it('names the two lanes differently, and neither is the bare `ci`', () => {
    const routineName = workflowName(routine);
    const acceptanceName = workflowName(acceptance);
    expect(routineName).toBe('ci (routine)');
    expect(acceptanceName).toBe("ci (acceptance — full evidence capture)");
    expect(routineName).not.toBe(acceptanceName);
    for (const name of [routineName, acceptanceName]) {
      expect(name).not.toBe('ci');
      expect(name).not.toBe('');
    }
  });

  it('allows no step to fail without failing the run, in either file', () => {
    for (const entry of files) {
      expect(entry.text, entry.file).not.toMatch(/^\s*continue-on-error:/mu);
      expect(entry.text, entry.file).toContain('runs-on: ubuntu-24.04');
    }
  });

  it('pins every third-party action by commit sha and reads the toolchain pins from the same place', () => {
    const shas = new Set<string>();
    const acceptancePins: string[] = [];
    for (const entry of files) {
      const uses = [...entry.text.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/gu)];
      expect(uses.length, entry.file).toBeGreaterThan(2);
      for (const use of uses) {
        const repo = use[1] as string;
        const sha = use[2] as string;
        expect(sha, `${entry.file} ${repo}`).toMatch(/^[0-9a-f]{40}$/u);
        shas.add(`${repo}@${sha}`);
        if (entry.file === ACCEPTANCE_FILE) acceptancePins.push(repo);
      }
      expect(entry.text, `${entry.file} Node pin`).toContain('24.22.2');
      expect(entry.text, `${entry.file} pnpm pin`).toContain('12.18.0');
      expect(entry.text, `${entry.file} frozen install`).toContain('pnpm install --frozen-lockfile');
      expect(entry.text, entry.file).not.toMatch(/secrets\./u);
      expect(entry.text, `${entry.file} must not keep credentials`).toContain('persist-credentials: false');
    }

    // The dependency register reads only `ci.yml` (R-2 stays deferred), so an action that appears solely in
    // the acceptance workflow cannot be recorded there. That gap is closed here rather than left open: the pin
    // is written out below, and a bump to it fails this test until the reviewer says so in the same change.
    const acceptanceOnlyPins: Readonly<Record<string, string>> = {
      'actions/upload-artifact': 'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
    };
    const register = JSON.parse(read('docs/integration/dependencies.json')) as {
      ciActions: readonly { repo: string; pinnedCommit: string; pinnedByCommitSha: boolean }[];
    };
    const recorded = new Set(register.ciActions.map((entry) => `${entry.repo}@${entry.pinnedCommit}`));
    // One entry per distinct pin, in the routine workflow too: the register is the reviewer's list, and eleven
    // lanes installing the same two actions is two pins, not twenty-two records of them.
    expect(register.ciActions.length, 'the register repeats a pin').toBe(recorded.size);
    for (const entry of register.ciActions) {
      expect(entry.pinnedByCommitSha, entry.repo).toBe(true);
    }
    const routinePins = new Set([...routine.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/gu)].map((use) => `${use[1]}@${use[2]}`));
    expect(recorded, 'the register is not the set of pins ci.yml uses').toEqual(routinePins);
    for (const sha of shas) {
      const repo = sha.split('@')[0] as string;
      const pin = sha.split('@')[1] as string;
      if (Object.hasOwn(acceptanceOnlyPins, repo)) {
        expect(acceptanceOnlyPins[repo], `${repo} is pinned to a different sha than this file records`).toBe(pin);
        continue;
      }
      expect([...recorded], sha).toContain(sha);
    }
    // The allow-list must not quietly grow into the place pins go to escape being checked: it holds exactly the
    // actions that appear in the acceptance workflow and nowhere in `ci.yml`, and nothing else.
    const onlyInAcceptance = [...new Set(acceptancePins)].filter(
      (repo) => ![...routinePins].some((pin) => pin.startsWith(`${repo}@`)),
    );
    expect(onlyInAcceptance.sort()).toEqual(Object.keys(acceptanceOnlyPins).sort());
  });
});

describe('CI workflows — full capture is an explicit act, and a routine run is not evidence', () => {
  it('reaches acceptance only through workflow_dispatch', () => {
    const triggers = acceptance.slice(acceptance.indexOf('\non:\n'), acceptance.indexOf('\npermissions:\n'));
    expect(triggers).toContain('workflow_dispatch:');
    for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'repository_dispatch:', 'release:']) {
      expect(triggers, `acceptance must not be triggerable by ${forbidden}`).not.toContain(forbidden);
    }
    expect(acceptance).toContain('candidate_sha');
    expect(acceptance).toContain('Assert the exact candidate commit');
    expect(acceptance).toContain('Assert every bundle names the candidate');
    // A discarded capture retains nothing; two candidates are two pieces of evidence.
    expect(acceptance).toContain('cancel-in-progress: false');
  });

  it('keeps every evidence step in the acceptance workflow and out of the routine one', () => {
    const evidenceSteps = [
      'Capture the evidence bundles',
      'Assert the required evidence artefacts exist',
      'Verify the captured evidence bundles',
      'Publish logs and machine-readable results',
    ];
    for (const step of evidenceSteps) {
      expect(acceptance, step).toContain(`- name: ${step}`);
      expect(routine, `${step} does not belong in the routine lane`).not.toContain(step);
    }
    for (const forbidden of ['evidence:capture', 'evidence:verify', 'evidence:summary', 'capture-plans.sh', 'upload-artifact']) {
      expect(routine, forbidden).not.toContain(forbidden);
    }
    expect(acceptance).toContain("bash tools/ci/capture-plans.sh");
    expect(acceptance).toContain('if-no-files-found: error');
    expect(acceptance).toContain('retention-days: 30');
    expect(acceptance).toContain('success (acceptance capture');
  });

  it('routes the cross-suite command and the runtime suites, and refuses a zero-test pass there', () => {
    const job = (id: string): string => {
      const start = routine.indexOf(`\n  ${id}:\n`);
      expect(start, `no job ${id} in ${ROUTINE_FILE}`).toBeGreaterThan(-1);
      // Skip the job's own key line before looking for the next one, or the slice is empty.
      const rest = routine.slice(start + 1);
      const next = /^ {2}[a-z][\w-]*:$/mu.exec(rest.slice(1))?.index;
      return next === undefined ? rest : rest.slice(0, next + 1);
    };

    const fullSuite = job('full-suite');
    expect(fullSuite).toContain('pnpm test');
    expect(fullSuite).toContain('pnpm test:e2e -- --suite camera');

    // Every lane that drives a browser or reads emitted output builds what it reads first. `44363878340` learned
    // this the slow way: without the libraries emitted, the dev server the camera suite drives never serves the
    // client, and the lane waited out its whole timeout instead of failing.
    for (const id of ['unit', 'camera', 'runtime', 'full-suite']) {
      const body = job(id);
      expect(body, `${id} runs a suite before building what it reads`).toContain(
        id === 'camera' || id === 'full-suite' ? 'run: pnpm build:libraries' : 'run: pnpm build\n',
      );
    }

    const runtime = job('runtime');
    expect(runtime).toContain('node tests/reference/flat-direct-step.ts');
    expect(runtime).toContain('pnpm exec vitest run tests/system');
    expect(runtime).toContain('system-junit.xml');
    expect(runtime).toContain('discovered zero cases');
  });

  it('names the invocation it runs probes under, differently from the acceptance job', () => {
    // R-7 stands: probe bytes are only evidence if they say which invocation wrote them, and the routine lane
    // must not be able to be mistaken for one of the acceptance job's two named invocations.
    expect(routine).toContain('UDG_PROBE_INVOCATION: ci-routine');
    expect(routine).not.toContain('ci-full-test');
    expect(routine).not.toContain('ci-test-step');
    expect(acceptance).toContain('UDG_PROBE_INVOCATION: ci-full-test');
    expect(acceptance).toContain('UDG_PROBE_INVOCATION: ci-test-step');
    expect(routine).toContain('pnpm evidence:probes -- --dir artifacts/.routine/probes');
  });
});
