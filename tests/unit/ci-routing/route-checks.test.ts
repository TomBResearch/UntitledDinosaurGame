/**
 * C-07: the changed-path router, under test before anything uses it.
 *
 * The routine CI lane runs the checks a change can make red and nothing else. That makes this table the
 * thing that decides what is covered, so it is tested the way the checkers are: as data, with the failure
 * modes named explicitly rather than hoped away.
 *
 * Two properties carry the change:
 *
 *   1. **a route never loses coverage silently.** An unrecognised path, an unresolvable diff, an empty diff
 *      or a diff too large to summarise runs everything. The cost of a wrong route must be minutes, never a
 *      missing check — the repository has already paid for the second kind once, in
 *      `tests/unit/udg-003/capture-loop.test.ts`, where a step quietly stopped running plans.
 *   2. **every rule has a reader.** Each rule names the suite that reads the paths it matches, and the
 *      probe map below proves each rule actually matches something. A rule that can never fire, or whose
 *      reader no longer opens the file, is a rule that pretends to give coverage.
 *
 * The diff-resolution tests build a throwaway git repository so renames, deletions and a multi-commit push
 * are exercised against real `git diff` output rather than a fixture string.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ESCALATION_RULES,
  ROUTE_FLAGS,
  ROUTE_RULES,
  changedPaths,
  globToRegExp,
  parseNameStatus,
  routePaths,
} from '../../../tools/ci/route-checks.mjs';
import type { RouteFlag, RouteFlags } from '../../../tools/ci/route-checks.mjs';

const scratch: string[] = [];

const temporary = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `udg-ci-route-${label}-`));
  scratch.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const flagsOf = (paths: readonly string[] | undefined, options?: { pathLimit?: number }): RouteFlags =>
  routePaths(paths, options).flags;

const groupsOf = (paths: readonly string[] | undefined, options?: { pathLimit?: number }): RouteFlag[] =>
  ROUTE_FLAGS.filter((flag) => flagsOf(paths, options)[flag]).sort();

/** The groups a route must *not* turn on, named so a widening is a deliberate edit and not a slip. */
const expectOnly = (paths: readonly string[], expected: readonly string[]): void => {
  expect(groupsOf(paths)).toEqual([...expected].sort());
};

describe('CI router — the table decides, and never silently narrows', () => {
  it('routes a records-only change to the records lane alone', () => {
    expectOnly(
      [
        'docs/contracts/adoption.md',
        'docs/contracts/assignments/ci-routing-proposal.md',
        'README.md',
        'docs/contracts/UDG-003.md',
      ],
      // UDG-003's contract suite reads Phase 1's record and the Colyseus map, so a UDG-003 contract edit
      // is not a pure records change: its suite runs. That is coverage, not padding.
      ['records', 'runtime', 'server'],
    );
    expectOnly(['docs/contracts/adoption.md', 'docs/contracts/assignments/ci-routing-proposal.md'], ['records']);
  });

  it('routes a records change that regenerates the checksum manifest without widening past records', () => {
    // The shape of an acceptance-record commit: prose plus the manifest that pins it.
    expectOnly(
      ['docs/contracts/adoption.md', 'docs/contracts/checksums.json', 'docs/contracts/assignments/ci-routing-submission.md'],
      ['records'],
    );
    // A record belonging to a task whose suite reads its own records is not a pure records change: UDG-003's
    // suite opens Phase 1's record and the Colyseus map, so editing them re-runs that suite. That is
    // coverage, not padding, and it is named here so nobody mistakes it for the records lane being slow.
    expect(groupsOf(['docs/contracts/assignments/UDG-003-phase-3-submission.md'])).toEqual(
      ['records', 'runtime', 'server'],
    );
    // The dependency register is a different case: only `pnpm dependencies:verify` gates it.
    expect(flagsOf(['docs/integration/dependencies.json']).tooling).toBe(true);
    expect(flagsOf(['docs/integration/dependencies.json']).records).toBe(true);
  });

  it('routes a camera change to the browser lane and not past it', () => {
    expectOnly(['apps/client/src/rendering/OrbitCamera.ts'], ['camera', 'static', 'unit']);
    expectOnly(['tests/e2e/camera.spec.ts'], ['camera', 'static']);
    expectOnly(['playwright.config.ts'], ['camera', 'fullSuite', 'static']);
  });

  it('routes a server change to the suites that can fail on it, and runs the runtime they assert', () => {
    expectOnly(['apps/server/src/rooms/RegionRoom.ts'], ['runtime', 'server', 'static', 'unit']);
    // A shared-package edit is a wider claim than a room edit: `pnpm test` runs the whole suite graph over
    // the simulation core, so the cross-suite lane joins it.
    expectOnly(['packages/simulation/src/step.ts'], ['fullSuite', 'runtime', 'server', 'static', 'unit']);
    // A change to the runtime suites themselves runs them; it does not pull in the browser.
    expectOnly(['tests/system/udg-003-phase-2/runtime.test.ts'], ['runtime', 'static']);
    expectOnly(['tests/reference/flat-direct-step.ts'], ['runtime', 'static']);
  });

  it('routes a protocol change wider than either app, because both depend on it', () => {
    // apps/client/package.json and apps/server/package.json each declare @udg/protocol, so a schema edit is
    // a client change and a server change at once. This is the case that must never be routed narrowly.
    const flags = flagsOf(['packages/protocol/src/schema/input.ts']);
    expect({ camera: flags.camera, server: flags.server, protocol: flags.protocol, fullSuite: flags.fullSuite }).toEqual({
      camera: true,
      server: true,
      protocol: true,
      fullSuite: true,
    });
    expect(groupsOf(['packages/config/src/limits.ts']).includes('camera')).toBe(true);
    // Simulation is not a client dependency, so it does not drag the browser in.
    expect(flagsOf(['packages/simulation/src/step.ts']).camera).toBe(false);
  });

  it('routes the shared checker package to everything that is dispatched through it', () => {
    const groups = groupsOf(['tools/checks/src/evidence.ts']);
    for (const group of ['protocol', 'server', 'runtime', 'tooling', 'fullSuite', 'unit']) {
      expect(groups, group).toContain(group);
    }
  });

  it.each([
    ['pnpm-lock.yaml', 'root-manifest'],
    ['package.json', 'root-manifest'],
    ['pnpm-workspace.yaml', 'root-manifest'],
    ['.node-version', 'root-manifest'],
    ['tsconfig.base.json', 'root-tsconfig'],
    ['eslint.config.mjs', 'root-tooling-config'],
    ['vitest.config.ts', 'root-tooling-config'],
    ['.github/workflows/ci.yml', 'ci-tooling'],
    ['tools/ci/route-checks.mjs', 'ci-tooling'],
  ])('escalates %s to every group through %s', (path, ruleId) => {
    const result = routePaths([path]);
    expect(result.all, path).toBe(true);
    expect(result.reason, path).toBe(`path:${ruleId}`);
    expect(groupsOf([path])).toEqual([...ROUTE_FLAGS].sort());
  });

  it('escalates an unknown path, an empty diff, an unresolvable diff and a diff too large to summarise', () => {
    expect(routePaths(['newdir/x.txt']).reason).toBe('unknown-path');
    expect(routePaths([]).reason).toBe('empty-diff');
    expect(routePaths(undefined).reason).toBe('unresolved-diff');
    const many = Array.from({ length: 41 }, (_value, index) => `packages/simulation/src/file${String(index)}.ts`);
    expect(routePaths(many).reason).toBe('too-many-paths');
    for (const paths of [['newdir/x.txt'], [], undefined, many]) {
      expect(groupsOf(paths)).toEqual([...ROUTE_FLAGS].sort());
    }
  });

  it('is deterministic and does not let one path hide another', () => {
    const first = routePaths(['apps/client/src/a.ts', 'docs/x.md', 'packages/simulation/src/step.ts']);
    const second = routePaths(['packages/simulation/src/step.ts', 'docs/x.md', 'apps/client/src/a.ts']);
    expect(JSON.stringify(first.flags)).toBe(JSON.stringify(second.flags));
    // Both lanes survive the union: the camera path cannot be masked by the simulation path.
    expect(first.flags.camera).toBe(true);
    expect(first.flags.runtime).toBe(true);
    expect(first.flags.records).toBe(true);
  });

  it('routes a Markdown file under tests/ as a record, not as a suite', () => {
    expectOnly(['tests/AGENTS.md'], ['records']);
  });
});

describe('CI router — spike/netcode/load-test paths route to existing lanes (grant T-8)', () => {
  it('routes the netcode suite to the unit and runtime lanes while keeping its pre-existing camera/static routing', () => {
    // Before the rule, a netcode.spec change fired only camera + static. Those still fire — the
    // rule ADDS the lanes where the fast spike checks actually live; it removes nothing.
    expectOnly(['tests/e2e/netcode.spec.ts'], ['camera', 'runtime', 'static', 'unit']);
    expect(routePaths(['tests/e2e/netcode.spec.ts']).reason).toBe('routed');
  });

  it('routes the load-test tooling, spike tests, spike unit tests and the client probe to unit + runtime (plus their pre-existing static/camera groups)', () => {
    expectOnly(['tools/load-test/src/run-spike.ts'], ['runtime', 'static', 'unit']);
    expectOnly(['tests/spikes/any-lab.test.ts'], ['runtime', 'static', 'unit']);
    expectOnly(['tests/unit/udg-spike-001/gate-a-evidence.test.ts'], ['runtime', 'static', 'unit']);
    // The client probe keeps its camera routing (pre-existing apps/client/** rule) and gains the
    // spike lanes; a client SOURCE change outside network/ is unchanged.
    expectOnly(['apps/client/src/network/flatStep.ts'], ['camera', 'runtime', 'static', 'unit']);
    expectOnly(['apps/client/src/rendering/OrbitCamera.ts'], ['camera', 'static', 'unit']);
  });

  it('does NOT match lookalike paths — the patterns are exact globs, not prefixes', () => {
    // A sibling directory of the load-test tool is not a spike path: it stays a plain tooling
    // source change (source-static), and cannot join the spike lane by prefix similarity.
    const sibling = flagsOf(['tools/load-test2/src/x.ts']);
    expect(sibling.static).toBe(true);
    expect(sibling.runtime).toBe(false);
    expect(sibling.unit).toBe(false);
    // `networking/` is not `network/`: the client probe rule must not spread over the app.
    const lookalike = flagsOf(['apps/client/src/networking/extra.ts']);
    expect(lookalike.camera).toBe(true);
    expect(lookalike.runtime).toBe(false);
    // A near-miss filename for the spec is just another e2e path (camera), not a spike path.
    const nearName = flagsOf(['tests/e2e/netcode.spec.tsx']);
    expect(nearName.runtime).toBe(false);
    // Markdown beside the spikes is a record, never a suite (the docs carve-out wins). 
    expectOnly(['tests/spikes/notes.md'], ['records']);
  });

  it('a spike route can never select evidence capture, the acceptance lane, or the full Gate A matrix (C-07, T-8)', () => {
    const spikePaths = [
      'tests/e2e/netcode.spec.ts',
      'tests/spikes/any-lab.test.ts',
      'tests/unit/udg-spike-001/gate-a-evidence.test.ts',
      'tools/load-test/src/run-spike.ts',
      'apps/client/src/network/flatStep.ts',
    ];
    for (const path of spikePaths) {
      const result = routePaths([path]);
      expect(result.all, `${path} must route, not escalate`).toBe(false);
      const flags = result.flags as Record<string, boolean>;
      // The group names the workflow jobs are keyed on; capture/acceptance/evidence are not
      // groups at all (they live in the DISPATCHED acceptance workflow), and fullSuite — the one
      // group whose runner executes the whole Gate A matrix — is never set by a spike path.
      for (const forbidden of ['capture', 'acceptance', 'evidence']) {
        expect(flags, `${path} set a forbidden group ${forbidden}`).not.toHaveProperty(forbidden);
      }
      expect(flags['fullSuite'], `${path} selected the full-matrix group`).toBe(false);
    }
  });
});

describe('CI router — every rule matches something real', () => {
  /**
   * One representative path per rule, taken from what the rule's reader actually opens. A rule missing from
   * this map is a rule nobody has shown can fire, which is exactly how a routing table accumulates coverage
   * it does not have.
   */
  const RULE_PROBES: Readonly<Record<string, string>> = {
    'docs-records': 'docs/contracts/adoption.md',
    'docs-dependency-register': 'docs/integration/dependencies.json',
    'docs-protocol': 'docs/contracts/protocol-v1.md',
    'docs-server': 'docs/integration/colyseus-0.18-api-map.md',
    'docs-camera': 'docs/integration/client-stack-v1.md',
    'source-static': 'packages/simulation/src/step.ts',
    'source-unit': 'tests/unit/udg-002/config.test.ts',
    protocol: 'packages/protocol/src/domain/movement.ts',
    camera: 'apps/client/src/rendering/camera-math.ts',
    server: 'apps/server/src/authority/step.ts',
    runtime: 'tests/system/udg-003-phase-2/runtime.test.ts',
    tooling: 'tests/unit/udg-003/capture-loop.test.ts',
    'spike-netcode-fast': 'tests/e2e/netcode.spec.ts',
    'shared-app-dependency': 'packages/config/src/limits.ts',
    'shared-checks': 'tools/checks/src/evidence.ts',
    'shared-full-suite': 'tests/fixtures/protocol/valid.json',
  };

  it('has a probe for every rule, and fires on it', () => {
    const ruleIds = ROUTE_RULES.map((rule) => rule.id);
    expect(ruleIds).toEqual([...new Set(ruleIds)]);
    expect(Object.keys(RULE_PROBES).sort()).toEqual([...ruleIds].sort());

    for (const rule of ROUTE_RULES) {
      const probe = RULE_PROBES[rule.id];
      expect(probe, `${rule.id} has no probe path`).toBeDefined();
      const decision = routePaths([probe as string]).decisions.find((entry) => entry.path === probe);
      expect(decision?.rules, `${rule.id} does not match ${String(probe)}`).toContain(rule.id);
      expect(rule.patterns.length, rule.id).toBeGreaterThan(0);
      expect(rule.reader, rule.id).toMatch(/\S/);
      for (const flag of rule.flags) {
        expect(ROUTE_FLAGS, `${rule.id} sets an unknown group ${flag}`).toContain(flag);
      }
    }
  });

  it('has no escalation rule that can never fire', () => {
    for (const rule of ESCALATION_RULES) {
      const fired = rule.patterns.some((pattern) => globToRegExp(pattern).test(pattern.replace(/\*\*/g, 'x').replace(/\*/g, 'y')));
      expect(fired, rule.id).toBe(true);
      expect(rule.patterns.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('names the group set the workflow jobs are keyed on, and never a capture group', () => {
    // Capture is deliberately absent: no route may produce or withhold evidence. That gate lives in
    // acceptance.yml, which is dispatched, not routed.
    expect([...ROUTE_FLAGS].sort()).toEqual(
      ['camera', 'fullSuite', 'protocol', 'records', 'runtime', 'server', 'static', 'tooling', 'unit'].sort(),
    );
    for (const forbidden of ['capture', 'acceptance', 'evidence']) {
      expect(ROUTE_FLAGS).not.toContain(forbidden);
    }
  });
});

describe('CI router — reading a real diff', () => {
  const git = (cwd: string, ...args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      // `merge-base --is-ancestor` signals with its exit code, so the suite needs that failure as a value
      // rather than as an exception escaping the test body.
      const status = (error as { status?: number }).status;
      if (status === undefined) throw error;
      return `__exit_${String(status)}`;
    }
  };

  const repo = (): string => {
    const dir = temporary('git');
    // `init.defaultBranch` and signing are pinned so the scratch history is the same on a runner, in CI and
    // on a developer machine with an unusual global config.
    git(dir, '-c', 'init.defaultBranch=main', 'init', '-q');
    git(dir, 'config', 'user.email', 'route-test@example.invalid');
    git(dir, 'config', 'user.name', 'route test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    return dir;
  };

  const commit = (dir: string, message: string): string => {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    return git(dir, 'rev-parse', 'HEAD');
  };

  const write = (dir: string, path: string, text: string): void => {
    const target = join(dir, path);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, text);
  };

  it('keeps both sides of a rename and the path a deletion removed', () => {
    expect(parseNameStatus('M\tpackages/simulation/src/step.ts')).toEqual(['packages/simulation/src/step.ts']);
    const renamed = parseNameStatus('R100\tapps/client/src/a.ts\ttests/e2e/a.ts\nD\tdocs/x.md');
    expect(renamed).toEqual(['apps/client/src/a.ts', 'docs/x.md', 'tests/e2e/a.ts']);
    // The old path and the new path are both routed: a move out of the camera lane cannot escape it.
    const flags = flagsOf(renamed);
    expect(flags.camera).toBe(true);
    expect(flags.records).toBe(true);
  });

  it('routes the union across a push of several commits', () => {
    const dir = repo();
    write(dir, 'README.md', '# base\n');
    const base = commit(dir, 'base');
    write(dir, 'apps/client/src/rendering/OrbitCamera.ts', 'export const a = 1;\n');
    commit(dir, 'camera change');
    write(dir, 'apps/server/src/authority/step.ts', 'export const b = 2;\n');
    const head = commit(dir, 'server change');

    const paths = changedPaths({ cwd: dir, base, head });
    expect(paths).toEqual([
      'apps/client/src/rendering/OrbitCamera.ts',
      'apps/server/src/authority/step.ts',
    ]);
    const flags = flagsOf(paths as string[]);
    expect({ camera: flags.camera, server: flags.server, runtime: flags.runtime }).toEqual({
      camera: true,
      server: true,
      runtime: true,
    });
  });

  it('routes a pull request against its merge base, not against the merge commit', () => {
    const dir = repo();
    write(dir, 'packages/simulation/src/step.ts', 'export const base = 1;\n');
    const base = commit(dir, 'base');
    git(dir, 'checkout', '-qb', 'feature');
    write(dir, 'tests/e2e/camera.spec.ts', 'export const case1 = 1;\n');
    const head = commit(dir, 'camera change on the branch');
    git(dir, 'checkout', '-q', 'main');
    write(dir, 'docs/records-added.md', 'main moved on, and the PR did not touch it\n');
    commit(dir, 'unrelated main change');

    const threeDot = changedPaths({ cwd: dir, base, head, threeDot: true });
    expect(threeDot).toEqual(['tests/e2e/camera.spec.ts']);
    expect(flagsOf(threeDot as string[]).records).toBe(false);
  });

  it('refuses to invent a diff after a force-push, and reports no paths for an unusable base', () => {
    const dir = repo();
    write(dir, 'README.md', '# one\n');
    commit(dir, 'one');
    write(dir, 'README.md', '# two\n');
    const abandoned = commit(dir, 'two');
    git(dir, 'reset', '--hard', 'HEAD~1');
    write(dir, 'apps/client/src/a.ts', 'export const a = 1;\n');
    const rewritten = commit(dir, 'rewritten history');

    // `abandoned` is reachable from no commit on the branch any more, so diffing it against the new head
    // would report history that does not exist.
    expect(git(dir, 'merge-base', '--is-ancestor', abandoned, rewritten)).toBe('__exit_1');
    expect(changedPaths({ cwd: dir, base: abandoned, head: rewritten })).toBeUndefined();
    expect(changedPaths({ cwd: dir, base: '0000000000000000000000000000000000000000', head: rewritten })).toBeUndefined();
    expect(changedPaths({ cwd: dir, base: undefined, head: rewritten })).toBeUndefined();
    expect(changedPaths({ cwd: dir, base: 'not-a-commit', head: rewritten })).toBeUndefined();
    // …and the router turns that into the broad answer, not the narrow one.
    expect(groupsOf(changedPaths({ cwd: dir, base: abandoned, head: rewritten }))).toEqual(
      [...ROUTE_FLAGS].sort(),
    );
  });
});

describe('CI router — the glob language the table is written in', () => {
  it('matches a documented pattern against the paths its author meant', () => {
    const docs = globToRegExp('docs/**');
    expect(docs.test('docs/x.md')).toBe(true);
    expect(docs.test('docs/contracts/assignments/UDG-003-phase-3.md')).toBe(true);
    expect(docs.test('README.md')).toBe(false);

    expect(globToRegExp('**/*.md').test('tests/AGENTS.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('tests/unit/a.test.ts')).toBe(false);
    expect(globToRegExp('tests/unit/udg-002/**').test('tests/unit/udg-002/config.test.ts')).toBe(true);
    expect(globToRegExp('tests/unit/udg-002/**').test('tests/unit/udg-003/clock.test.ts')).toBe(false);
    expect(globToRegExp('apps/client/**').test('apps/client/src/game/ClientRuntime.ts')).toBe(true);
    expect(globToRegExp('apps/client/**').test('apps/server/src/main.ts')).toBe(false);
    // A literal dot is a dot, not "any character": package.json must not route on packageXjson.
    expect(globToRegExp('package.json').test('packageXjson')).toBe(false);
  });
});
