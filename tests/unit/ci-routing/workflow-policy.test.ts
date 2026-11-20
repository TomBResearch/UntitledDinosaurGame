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

interface DependencyRegisterCiActions {
  readonly ciActions: readonly { readonly repo: string; readonly pinnedCommit: string; readonly pinnedByCommitSha: boolean }[];
}

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
    const key = /^ {2}([a-z][\w-]*):\s*$/u.exec(line);
    if (key?.[1] !== undefined) ids.push(key[1]);
  }
  return ids;
};

/** The group a conditional job is keyed on, from `needs.route.outputs.<flag> == 'true'`. */
const gatedGroups = (text: string): string[] =>
  [...text.matchAll(/needs\.route\.outputs\.([A-Za-z]+)\s*==\s*'true'/gu)].map((match) => match[1] as string);

const workflowName = (text: string): string => /^name:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? '';

/** One job's YAML text, from its key to the next job's key. */
const job = (text: string, id: string): string => {
  const start = text.indexOf(`\n  ${id}:\n`);
  expect(start, `no job ${id} in the workflow`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = /^ {2}[a-z][\w-]*:$/mu.exec(rest.slice(1))?.index;
  return next === undefined ? rest : rest.slice(0, next + 1);
};

/**
 * The actions the acceptance workflow references that the dependency register cannot see, pinned here by sha.
 *
 * `pnpm dependencies:record` reads `.github/workflows/ci.yml` and nothing else (R-2 stays deferred), so an action
 * that lives only in `acceptance.yml` is outside `pnpm dependencies:verify`'s reach. This map is where such an
 * action is approved instead: adding an action to a workflow without adding it here fails
 * `reports an acceptance-only action that is not on the allow-list`, and the entry itself names the sha, so a pin
 * bump has to be a deliberate edit in a reviewable place.
 */
const ACCEPTANCE_ONLY_PINS: Readonly<Record<string, string>> = {
  'actions/upload-artifact': 'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
};

interface PinRules {
  readonly registered: ReadonlySet<string>;
  readonly acceptanceOnly: Readonly<Record<string, string>>;
  readonly file: string;
}

/**
 * Every `uses:` reference in `text`, checked as a pin and as an approved pin. Returns human-readable violations;
 * an empty array means the workflow's third-party actions are all 40-hex and all approved.
 */
const pinViolations = (text: string, rules: PinRules): string[] => {
  const violations: string[] = [];
  const refs = [...text.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/gu)].map((match) => ({
    repo: match[1] as string,
    sha: match[2] as string,
  }));
  for (const ref of refs) {
    if (!/^[0-9a-f]{40}$/u.test(ref.sha)) {
      violations.push(`${rules.file}: ${ref.repo}@${ref.sha} is not pinned to a 40-character commit sha`);
      continue;
    }
    if (rules.registered.has(`${ref.repo}@${ref.sha}`)) continue;
    if (rules.acceptanceOnly[ref.repo] === ref.sha) continue;
    violations.push(
      `${rules.file}: ${ref.repo}@${ref.sha} is neither recorded by the dependency register nor approved as an acceptance-only pin`,
    );
  }
  return violations;
};

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

  it('gates the outcome on the router, on every selected lane passing, and on unselected lanes staying skipped', () => {
    const outcome = job(routine, 'outcome');
    const needs = /needs:\s*\[([^\]]+)\]/u.exec(outcome)?.[1] ?? '';
    for (const id of jobIds(routine).filter((job) => job !== 'outcome')) {
      expect(needs, `outcome does not wait on ${id}`).toContain(id);
    }
    expect(routine.slice(routine.indexOf('  outcome:'))).toContain('if: ${{ always() }}');

    // (a) the router itself has to have succeeded: every lane condition is one of its outputs, so a router that
    // failed means nothing was routed, and "nothing routed, nothing failed" must not read as green.
    expect(outcome).toContain('RESULT_ROUTE: ${{ needs.route.result }}');
    expect(outcome).toContain('"${RESULT_ROUTE}" != "success"');
    expect(outcome).toContain('nothing was routed');

    // (b) a lane the router selected must report `success` — `skipped` included. This is the assertion that turns
    // "the route asked for the camera suite and the camera suite did not happen" into a red run.
    for (const flag of ROUTE_FLAGS) {
      const env = flag === 'fullSuite' ? 'SELECTED_FULL_SUITE' : `SELECTED_${flag.toUpperCase()}`;
      expect(outcome, `outcome does not read the route's ${flag} decision`).toContain(`${env}: \${{ needs.route.outputs.${flag} }}`);
    }
    expect(outcome).toContain('was selected by the route but did not pass');
    expect(outcome).toContain('a selected check that did not run is not a pass');

    // (c) a lane the router did NOT select must be `skipped` — running off-table is the other half of the same
    // drift the table/job-list assertions above watch for.
    expect(outcome).toContain('was not selected by the route but reported');
    expect(outcome).toContain('an unselected lane must be skipped');

    // (d) a run that selected nothing at all is still refused, and the run still says what it did not do.
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

  it('keeps every shell continuation a continuation, in either file', () => {
    // `#` inside a backslash-continued command does not comment the line out, it ends the command there. An
    // explanatory comment placed in the middle of a multi-line `pnpm evidence:summary …` invocation therefore
    // turns the next argument into a command name: `44374610247` failed after five bundles had been captured and
    // verified, with `--ci-status: command not found`. Thirty-five minutes for a comment.
    const problems: string[] = [];
    for (const entry of files) {
      const lines = entry.text.split('\n');
      let inRun = false;
      let runIndent = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] as string;
        const runKey = /^(\s*)run:\s*[|>]/u.exec(line);
        if (runKey?.[1] !== undefined) {
          inRun = true;
          runIndent = runKey[1].length;
          continue;
        }
        const indent = line.search(/\S/u);
        if (inRun && line.trim() !== '' && indent <= runIndent) inRun = false;
        if (!inRun || !line.trimEnd().endsWith('\\')) continue;
        const next = (lines[index + 1] ?? '').trim();
        if (next.startsWith('#')) problems.push(`${entry.file} line ${String(index + 2)}: ${next.slice(0, 60)}`);
      }
    }
    expect(problems, 'a comment inside a continued shell command ends that command').toEqual([]);
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

    // Both files, one rule: every third-party reference is a 40-hex sha, and every sha is either recorded by the
    // register or approved as an acceptance-only pin at exactly the recorded sha.
    for (const entry of files) {
      expect(
        pinViolations(entry.text, { registered: recorded, acceptanceOnly: ACCEPTANCE_ONLY_PINS, file: entry.file }),
        entry.file,
      ).toEqual([]);
    }
    // The allow-list must not quietly grow into the place pins go to escape being checked: it holds exactly the
    // actions that appear in the acceptance workflow and nowhere in `ci.yml`, and nothing else.
    const onlyInAcceptance = [...new Set(acceptancePins)].filter(
      (repo) => ![...routinePins].some((pin) => pin.startsWith(`${repo}@`)),
    );
    expect(onlyInAcceptance.sort()).toEqual(Object.keys(ACCEPTANCE_ONLY_PINS).sort());
    expect(shas.size).toBeGreaterThan(2);
  });

  it('refuses an acceptance-only action that nobody approved (failing control)', () => {
    // A guard nobody has seen fail is a guard that may be vacuous. This feeds the pin rule workflows it has to
    // refuse: an action outside the register and outside the allow-list, a ref that is a tag rather than a sha, and
    // an allow-listed action pinned to a sha that is not the approved one. The same rule then has to accept the
    // real files, which the test above asserts — so the rule is known to discriminate, in both directions.
    const register = JSON.parse(read('docs/integration/dependencies.json')) as DependencyRegisterCiActions;
    const recorded = new Set(register.ciActions.map((entry) => `${entry.repo}@${entry.pinnedCommit}`));
    const approved = recorded.values().next().value as string;
    const [approvedRepo, approvedSha] = (approved as string).split('@');
    const rules = { registered: recorded, acceptanceOnly: ACCEPTANCE_ONLY_PINS, file: 'control.yml' };

    expect(pinViolations(`      - uses: ${approvedRepo}@${approvedSha}\n`, rules), 'a recorded pin must pass').toEqual([]);

    const unapproved = pinViolations('      - uses: actions/cache@d2cb44f01f20cb1b854a620e9d91747669c107e4\n', rules);
    expect(unapproved).toHaveLength(1);
    expect(unapproved[0]).toContain('actions/cache@');
    expect(unapproved[0]).toContain('neither recorded by the dependency register nor approved as an acceptance-only pin');

    const unpinned = pinViolations('      - uses: actions/checkout@v5\n', rules);
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0]).toContain('not pinned to a 40-character commit sha');

    const rebased = pinViolations(`      - uses: actions/upload-artifact@${'0'.repeat(40)}\n`, rules);
    expect(rebased, 'an allow-listed action at a different sha is not an approved pin').toHaveLength(1);

    // And the control is only meaningful because the real acceptance workflow passes the same rule.
    expect(pinViolations(acceptance, { ...rules, file: ACCEPTANCE_FILE })).toEqual([]);
  });
});

describe('CI workflows — full capture is an explicit act, and a routine run is not evidence', () => {
  it('runs the spike fast smoke in the runtime lane only, and nowhere that captures (grants T-6/T-8)', () => {
    const runtimeBlock = job(routine, 'runtime');
    expect(runtimeBlock).toContain('test:spike');
    expect(runtimeBlock).toContain('--cell lan-smoke');
    // Exactly one lane runs the smoke: no other job may invoke the spike runner, so a netcode
    // change cannot accidentally start browser work in four lanes.
    for (const id of jobIds(routine)) {
      if (id === 'runtime') continue;
      expect(job(routine, id), `${id} must not run the spike smoke`).not.toContain('test:spike');
    }
    // The smoke declares its artefact home under artifacts/.local — and C-07 still holds over the
    // whole routine file: a routine run captures nothing.
    expect(runtimeBlock).toContain('artifacts/.local');
    expect(routine).not.toContain('evidence:capture');
    // The dispatched workflow is untouched by the smoke: T-7 (the full grid) belongs there and is
    // not implemented in this slice; the ONLY spike invocation in the routine file is the smoke —
    // a routed file must not have grown a matrix runner (comment mentions aside).
    const spikeRuns = [...routine.matchAll(/run:.*test:spike[^\n]*/gu)].map((match) => match[0]);
    expect(spikeRuns.length).toBe(1);
    expect(spikeRuns[0]).toContain('--cell lan-smoke');
    // The routine file may MENTION the formal-mode variable in a comment; what it must never do is
    // SET it — nothing routed can execute under the formal schedule policy.
    expect(routine).not.toMatch(/^\s*UDG_GATE_A_FORMAL:/mu);
  });

  it('reaches acceptance only through workflow_dispatch', () => {
    const triggers = acceptance.slice(acceptance.indexOf('\non:\n'), acceptance.indexOf('\npermissions:\n'));
    expect(triggers).toContain('workflow_dispatch:');
    for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'repository_dispatch:', 'release:']) {
      expect(triggers, `acceptance must not be triggerable by ${forbidden}`).not.toContain(forbidden);
    }
    expect(acceptance).toContain('Assert the exact candidate commit');
    expect(acceptance).toContain('Assert every bundle names the candidate');

    // The candidate is an argument that must be given, not a blank that means "whatever the branch is now". The
    // entry is read as its own block, because `purpose` below it is allowed to have a default and this one is not.
    const inputs = acceptance.slice(acceptance.indexOf('  workflow_dispatch:'), acceptance.indexOf('\npermissions:'));
    const candidateInput = inputs.slice(inputs.indexOf('candidate_sha:'), inputs.indexOf('purpose:'));
    expect(candidateInput, 'candidate_sha must be required').toContain('required: true');
    expect(candidateInput, 'candidate_sha must not default to blank').not.toContain('default:');
    expect(candidateInput.toLowerCase()).toContain('required');

    const guard = acceptance.slice(acceptance.indexOf('- name: Assert the exact candidate commit'));
    // blank, wrong shape, and mismatch are three different refusals, all before install and before capture —
    // a refused dispatch has to write no bundle, which is what the retained refusal runs show.
    expect(guard).toContain('-z "${REQUESTED}"');
    expect(guard).toContain('candidate_sha is required');
    expect(guard).toContain('^[0-9a-f]{40}$');
    expect(guard).toContain('must be a full 40-character sha');
    expect(guard).toContain('"${REQUESTED}" != "${checked_out}"');
    expect(guard.indexOf('candidate_sha is required')).toBeLessThan(guard.indexOf('exit 1'));
    const capture = acceptance.indexOf('- name: Capture the evidence bundles');
    expect(acceptance.indexOf('- name: Assert the exact candidate commit')).toBeLessThan(capture);
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
    const fullSuite = job(routine, 'full-suite');
    expect(fullSuite).toContain('pnpm test');
    expect(fullSuite).toContain('pnpm test:e2e -- --suite camera');

    // Every lane that drives a browser or reads emitted output builds what it reads first. `44363878340` learned
    // this the slow way: without the libraries emitted, the dev server the camera suite drives never serves the
    // client, and the lane waited out its whole timeout instead of failing.
    for (const id of ['unit', 'camera', 'runtime', 'full-suite']) {
      const body = job(routine, id);
      expect(body, `${id} runs a suite before building what it reads`).toContain(
        id === 'camera' || id === 'full-suite' ? 'run: pnpm build:libraries' : 'run: pnpm build\n',
      );
    }

    const runtime = job(routine, 'runtime');
    expect(runtime).toContain('node tests/reference/flat-direct-step.ts');
    expect(runtime).toContain('pnpm exec vitest run tests/system');
    expect(runtime).toContain('system-junit.xml');
    expect(runtime).toContain('discovered zero cases');
  });

  it('installs the browser in the lanes that need it and leaves the system-package install to acceptance', () => {
    // Measured on `44374825713`: `playwright install --with-deps chromium` cost 7 min 38 s, of which 6 min 47 s
    // was apt fetching 32.1 MB at 78.8 kB/s for fonts and mesa updates on an image that already ships the pinned
    // chromium and its libraries (the browser itself was never downloaded). The routine lanes that select a browser
    // are unit, camera and full-suite; they now install the browser only. Acceptance keeps `--with-deps`, so the
    // invocation the retained bundles record is unchanged.
    for (const id of ['unit', 'camera', 'full-suite']) {
      const runs = job(routine, id)
        .split('\n')
        .filter((line) => line.trim().startsWith('run: '))
        .join('\n');
      expect(runs, `${id} drives a browser but never installs it`).toContain('run: pnpm exec playwright install chromium');
      expect(runs, `${id} still pays for --with-deps`).not.toContain('--with-deps');
    }
    // The acceptance lane's invocation is what the retained bundles record, so it is asserted unchanged rather
    // than optimised: one 30-minute job can afford the apt traffic three parallel lanes cannot.
    expect(acceptance).toContain('run: pnpm exec playwright install --with-deps chromium');
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
