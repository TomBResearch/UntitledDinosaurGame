/**
 * UDG-001 contract suite (Workspace and CI).
 *
 * Every assertion maps to an acceptance line in docs/contracts/UDG-001.md. Negative checks assert
 * the expected rejection reason, never merely that something threw, and each destructive check
 * runs in a disposable temporary directory so the main tree is never broken to prove a point.
 *
 * When evidence capture sets UDG_EVIDENCE_MEASUREMENTS, the measured values collected here are
 * written to that path and embedded into report.json by tools/checks/src/evidence.ts.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CAPTURE_PLANS,
  boundaryConfigHash,
  buildDependencyRegister,
  checkWorkspace,
  decideContractRun,
  guardUnavailable,
  machineRoots,
  parseJunit,
  planContractRun,
  ruleTableHash,
  sanitiseMachineText,
  verify,
  writeBundleArtifacts,
  CONTRACT_TASK_IDS,
  type CapturePlan,
  type DependencyRegister,
  type EvidenceStatus,
  type RepoPath,
  type VerifyCode,
} from '@udg/checks';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'tools/checks', 'dist');

const measured: Record<string, unknown> = {
  taskId: 'UDG-001',
  toolchain: {
    node: process.version,
    packageManagerField: 'pending',
    pnpmCli: 'pending',
    typescript: 'pending',
  },
};

const record = (path: string, value: unknown): void => {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return;
  if (rest.length === 0) {
    measured[head] = value;
    return;
  }
  const bucket = (measured[head] ??= {}) as Record<string, unknown>;
  let cursor = bucket;
  for (let i = 0; i < rest.length - 1; i += 1) {
    const key = rest[i] as string;
    cursor = (cursor[key] ??= {}) as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1] as string] = value;
};

const sha256File = (absolutePath: string): string =>
  createHash('sha256').update(readFileSync(absolutePath)).digest('hex');

const json = <T>(relative: string): T => JSON.parse(readFileSync(join(ROOT, relative), 'utf8')) as T;

const run = (command: readonly string[], cwd: string, timeoutMs = 240_000) =>
  spawnSync(command[0] as string, command.slice(1), { cwd, encoding: 'utf8', timeout: timeoutMs });

const tempDir = (label: string): string => mkdtempSync(join(tmpdir(), `udg-001-${label}-`));

const WORKSPACES = [
  { dir: 'packages/protocol', name: '@udg/protocol', ownerTask: 'UDG-002' },
  { dir: 'packages/config', name: '@udg/config', ownerTask: 'UDG-002' },
  { dir: 'packages/simulation', name: '@udg/simulation', ownerTask: 'UDG-005' },
  { dir: 'packages/physics', name: '@udg/physics', ownerTask: 'UDG-006' },
  { dir: 'packages/navigation', name: '@udg/navigation', ownerTask: 'UDG-007' },
  { dir: 'apps/server', name: '@udg/server', ownerTask: 'UDG-003' },
  { dir: 'apps/client', name: '@udg/client', ownerTask: 'UDG-004' },
  { dir: 'tools/checks', name: '@udg/checks', ownerTask: 'UDG-001' },
] as const;

interface Manifest {
  readonly name: string;
  readonly private: boolean;
  readonly type: string;
  readonly engines: { readonly node: string; readonly pnpm: string };
  readonly exports: Readonly<Record<string, { readonly types?: string; readonly default?: string } | string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

interface TsConfig {
  readonly compilerOptions: { readonly lib?: readonly string[]; readonly types?: readonly string[] };
}

describe('toolchain pins (owner clarification C-01)', () => {
  it('pins Node 24.22.2 and pnpm 12.18.0 exactly, and runs on them', () => {
    expect(readFileSync(join(ROOT, '.node-version'), 'utf8').trim()).toBe('24.22.2');
    const rootManifest = json<{ packageManager: string; engines: { node: string; pnpm: string } }>('package.json');
    expect(rootManifest.packageManager).toBe('pnpm@12.18.0');
    expect(rootManifest.engines.node).toBe('24.22.2');
    expect(rootManifest.engines.pnpm).toBe('12.18.0');
    expect(process.version).toBe('v24.22.2');

    const pnpm = run(['pnpm', '--version'], ROOT);
    expect(pnpm.status, pnpm.stderr).toBe(0);
    expect(pnpm.stdout.trim()).toBe('12.18.0');

    const tsc = run(['pnpm', 'exec', 'tsc', '--version'], ROOT);
    expect(tsc.status, tsc.stderr).toBe(0);

    record('toolchain.node', process.version);
    record('toolchain.packageManagerField', rootManifest.packageManager);
    record('toolchain.pnpmCli', pnpm.stdout.trim());
    record('toolchain.typescript', tsc.stdout.trim());
  });

  it('declares exact versions only, with no ranges or tags', () => {
    const offenders: string[] = [];
    const manifests = ['package.json', ...WORKSPACES.map((workspace) => `${workspace.dir}/package.json`)];
    for (const manifest of manifests) {
      const parsed = json<Manifest>(manifest);
      for (const [key, table] of [
        ['dependencies', parsed.dependencies ?? {}],
        ['devDependencies', parsed.devDependencies ?? {}],
      ] as const) {
        for (const [name, spec] of Object.entries(table)) {
          const allowed = spec === 'workspace:*' || /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec);
          if (!allowed) offenders.push(`${manifest} ${key}: ${name}@${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    record('pins.exactVersionSpecsOnly', offenders.length === 0);
  });

  it('enables the four strict compiler flags required by the contract', () => {
    const base = json<{ compilerOptions: Record<string, unknown> }>('tsconfig.base.json');
    for (const flag of ['strict', 'noImplicitAny', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes']) {
      expect(base.compilerOptions[flag], flag).toBe(true);
    }
    expect(base.compilerOptions['module']).toBe('NodeNext');
    expect(base.compilerOptions['types']).toEqual([]);
    record('compiler.strictFlagsPresent', true);
  });

  it('keeps the DOM library out of every workspace except the client', () => {
    const domEnabled: string[] = [];
    for (const workspace of WORKSPACES) {
      const config = json<TsConfig>(`${workspace.dir}/tsconfig.json`);
      const lib = config.compilerOptions.lib ?? [];
      if (lib.some((entry) => entry.startsWith('DOM'))) domEnabled.push(workspace.name);
    }
    expect(domEnabled).toEqual(['@udg/client']);
    record('compiler.domWorkspaces', domEnabled);
  });

  it('gives the client DOM types and no workspace ambient Node types except the server and tools', () => {
    const allowed: Readonly<Record<string, readonly string[]>> = {
      '@udg/server': ['node'],
      '@udg/checks': ['node'],
    };
    const offenders: string[] = [];
    for (const workspace of WORKSPACES) {
      const config = json<TsConfig>(`${workspace.dir}/tsconfig.json`);
      const types = config.compilerOptions.types ?? [];
      for (const entry of types) {
        if (!(allowed[workspace.name] ?? []).includes(entry)) offenders.push(`${workspace.name} -> ${entry}`);
      }
      if (types.includes('dom') || types.includes('browser')) offenders.push(`${workspace.name} -> ${types.join(',')}`);
    }
    expect(offenders).toEqual([]);
    record('compiler.ambientTypePolicy', offenders.length === 0);
  });
});

describe('workspace shape', () => {
  it('has eight populated workspaces whose names match their directories', () => {
    const names = WORKSPACES.map((workspace) => {
      const manifest = json<Manifest>(`${workspace.dir}/package.json`);
      expect(manifest.name, workspace.dir).toBe(workspace.name);
      expect(manifest.private, workspace.dir).toBe(true);
      expect(manifest.type, workspace.dir).toBe('module');
      expect(manifest.engines.node, workspace.dir).toBe('24.22.2');
      expect(manifest.scripts['typecheck'], workspace.dir).toBeTruthy();
      expect(manifest.scripts['build'], workspace.dir).toBeTruthy();
      const leaf = workspace.dir.split('/').pop() as string;
      expect(workspace.name).toBe(`@udg/${leaf}`);
      return workspace.name;
    });
    expect(new Set(names).size).toBe(8);
    record('workspaces.populated', names.length);
    record('workspaces.eachHasTypecheckAndBuild', true);
  });

  it('exports a single empty module per game workspace and the documented entry map', () => {
    for (const workspace of WORKSPACES) {
      const manifest = json<Manifest>(`${workspace.dir}/package.json`);
      const entry = manifest.exports['.'];
      expect(typeof entry, `${workspace.name} exports "."`).toBe('object');
      if (typeof entry === 'object') {
        expect(entry.types, workspace.name).toBe('./dist/index.d.ts');
        expect(entry.default, workspace.name).toBe('./dist/index.js');
      }
      expect(Object.keys(manifest.exports), workspace.name).toEqual(['.']);
    }
    // Game workspaces are skeletons: they must export nothing until their owning task runs.
    for (const workspace of WORKSPACES.filter((entry) => entry.name !== '@udg/checks')) {
      const source = readFileSync(join(ROOT, workspace.dir, 'src', 'index.ts'), 'utf8');
      expect(source, workspace.name).toContain('export {};');
      expect(source, workspace.name).toContain(workspace.ownerTask);
    }
    record('workspaces.emptySkeletons', true);
  });

  it('keeps @udg/checks independent of every other workspace', () => {
    const checks = json<Manifest>('tools/checks/package.json');
    const deps = { ...checks.dependencies, ...checks.devDependencies };
    const firstParty = Object.keys(deps).filter((name) => name.startsWith('@udg/'));
    expect(firstParty).toEqual([]);
    record('checks.independentOfGameWorkspaces', true);
  });

  it('records the dependency register and keeps game libraries unselected (clarification C-02)', () => {
    const registerPath = 'docs/integration/dependencies.json';
    expect(existsSync(join(ROOT, registerPath)), registerPath).toBe(true);
    const register = json<DependencyRegister>(registerPath);
    expect(register.schemaVersion).toBe(1);
    expect(register.lockfile.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(register.runtime.node.version).toBe(process.version);
    expect(register.runtime.pnpm.cliVersion).toBe('12.18.0');
    expect(register.packages.length).toBeGreaterThan(0);

    for (const pending of register.pendingGameLibraries) {
      expect(pending.status, pending.name).toBe('not-selected');
      expect(pending.ownerTask, pending.name).toMatch(/^UDG-/);
    }
    const schema = register.pendingGameLibraries.find((entry) => entry.name === '@colyseus/schema');
    expect(schema?.ownerTask).toBe('UDG-002');

    const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
    for (const forbidden of ['@colyseus/', '@dimforge/', 'recast-navigation', '@babylonjs/']) {
      expect(lockfile.includes(forbidden), forbidden).toBe(false);
      expect(existsSync(join(ROOT, 'node_modules', forbidden.replace(/\/$/, ''))), forbidden).toBe(false);
    }

    for (const action of register.ciActions) {
      expect(action.pinnedCommit, action.repo).toMatch(/^[0-9a-f]{40}$/);
      expect(action.pinnedByCommitSha, action.repo).toBe(true);
    }

    // The register must describe the graph that is actually installed right now.
    const fresh = buildDependencyRegister(ROOT, 'tests/contracts/UDG-001.test.ts');
    expect(fresh.lockfile.sha256).toBe(register.lockfile.sha256);
    expect(fresh.runtime.pnpm.packageManagerField).toBe(register.runtime.pnpm.packageManagerField);
    expect(fresh.packages.map((entry) => `${entry.name}@${entry.installedVersion}`)).toEqual(
      register.packages.map((entry) => `${entry.name}@${entry.installedVersion}`),
    );
    expect(fresh.pendingGameLibraries.length).toBe(register.pendingGameLibraries.length);
    record('dependencyRegister.current', true);
    record('dependencyRegister.pendingLibraryGroups', register.pendingGameLibraries.length);
    record('dependencyRegister.ciActionsPinned', register.ciActions.length);
  });

  it('verifies the register on a foreign host while still refusing real drift (CI regression)', () => {
    // GitHub-hosted runners are linux/x64; a developer checkout may be linux/arm64 or macOS. The
    // register describes the repository, so only the recording host may differ between them.
    const scratch = tempDir('register');
    try {
      const register = json<DependencyRegister>('docs/integration/dependencies.json');
      expect(register.verification.excludes).toContain('runtime.host.arch');
      expect(register.verification.excludes).toContain('generated.at');

      const writeCopy = (name: string, value: unknown): string => {
        const path = join(scratch, name);
        writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
        return path;
      };
      const verifyRegister = (path: string) =>
        run(['node', join(DIST, 'evidence.js'), 'dependencies', '--verify', '--out', path], ROOT);

      const foreignHost = {
        ...register,
        runtime: { ...register.runtime, host: { platform: 'linux', arch: 'x64' } },
        generated: { ...register.generated, at: '2020-01-01T00:00:00.000Z', commit: '0'.repeat(40) },
      };
      const foreign = verifyRegister(writeCopy('foreign-host.json', foreignHost));
      expect(foreign.status, `${foreign.stdout}${foreign.stderr}`).toBe(0);

      const versionDrift = {
        ...register,
        packages: register.packages.map((entry) =>
          entry.name === 'typescript' ? { ...entry, installedVersion: '5.0.0' } : entry,
        ),
      };
      const drifted = verifyRegister(writeCopy('version-drift.json', versionDrift));
      expect(drifted.status).not.toBe(0);
      expect(`${drifted.stdout}${drifted.stderr}`).toContain('is stale');

      const actionDrift = {
        ...register,
        ciActions: register.ciActions.map((entry, index) =>
          index === 0 ? { ...entry, pinnedCommit: 'f'.repeat(40) } : entry,
        ),
      };
      expect(verifyRegister(writeCopy('action-drift.json', actionDrift)).status).not.toBe(0);

      const missing = verifyRegister(join(scratch, 'does-not-exist.json'));
      expect(missing.status).toBe(1);
      expect(`${missing.stdout}${missing.stderr}`).toContain('is missing');

      // A mutated pin must still be reported, so the exclusion cannot mask an engine change.
      const engineDrift = {
        ...register,
        runtime: { ...register.runtime, pnpm: { ...register.runtime.pnpm, cliVersion: '9.0.0' } },
      };
      expect(verifyRegister(writeCopy('engine-drift.json', engineDrift)).status).not.toBe(0);
      record('dependencyRegister.hostIndependent', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('dependency boundary checker', () => {
  it('runs every boundary fixture to its declared expectation', () => {
    const result = run(['node', join(DIST, 'boundaries.js'), '--fixtures', 'tests/fixtures/boundaries'], ROOT);
    const lines = result.stdout.trim().split('\n').filter((line) => line.length > 0);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.every((line) => line.startsWith('PASS'))).toBe(true);

    const negative = lines.filter((line) => line.includes('[reject]'));
    const positive = lines.filter((line) => line.includes('[allow]'));
    expect(positive.length).toBe(1);
    expect(negative.length).toBeGreaterThanOrEqual(5);
    // Every reject fixture must be justified by at least one concrete rule id, not a bare failure.
    for (const line of negative) {
      expect(line).toMatch(/actual=[A-Z-]+(?:\|[A-Z-]+)*/);
    }
    record('boundaryFixtures.total', lines.length);
    record('boundaryFixtures.negative', negative.length);
    record('boundaryFixtures.allMatched', true);
    record('boundaryFixtures.ruleTableHash', ruleTableHash());
    record('boundaryFixtures.configHash', boundaryConfigHash(ROOT));
  });

  it('reports a forbidden edge injected into a copy of the allowed fixture', () => {
    const scratch = tempDir('inject');
    try {
      const copyTarget = join(scratch, 'workspace');
      cpSync(join(ROOT, 'tests/fixtures/boundaries/allowed'), copyTarget, { recursive: true });
      expect(checkWorkspace(copyTarget).violations).toEqual([]);

      const dir = join(copyTarget, 'packages/simulation/src');
      writeFileSync(
        join(dir, 'injected.ts'),
        `import { World } from '@dimforge/rapier3d-compat';\n\nexport const worldType = typeof World;\n`,
      );
      const violations = checkWorkspace(copyTarget).violations;
      expect(violations.map((violation) => violation.ruleId)).toEqual(['BOUNDARY-ENGINE-FORBIDDEN']);
      expect(violations[0]?.file).toBe('packages/simulation/src/injected.ts');
      expect(typeof violations[0]?.line).toBe('number');
      record('boundaryChecker.liveDetection', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('fails when a reject fixture no longer produces its expected rule', () => {
    const scratch = tempDir('stale-expectation');
    try {
      const fixtures = join(scratch, 'fixtures');
      mkdirSync(fixtures, { recursive: true });
      cpSync(join(ROOT, 'tests/fixtures/boundaries/cycle'), join(fixtures, 'cycle'), { recursive: true });
      writeFileSync(join(fixtures, 'cycle/packages/navigation/src/b.ts'), `export function describe(value: number): string {\n  return value > 0 ? 'b' : 'c';\n}\n`);
      // Both cycles must disappear, otherwise BOUNDARY-CYCLE still fires for the wrong reason.
      writeFileSync(join(fixtures, 'cycle/packages/simulation/src/direct.ts'), `export function go(value: number): number {\n  return value + 1;\n}\n`);

      const result = run(['node', join(DIST, 'boundaries.js'), '--fixtures', fixtures], ROOT);
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status, output).toBe(1);
      expect(output).toContain('FAIL UDG-001-boundaries-cycle [reject]');
      expect(output).toContain('expected a rejection, got no violations');
      expect(output).toContain('missing expected rule ids: BOUNDARY-CYCLE');
      record('boundaryChecker.staleExpectationFails', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps the real tree free of violations', () => {
    const result = run(['node', join(DIST, 'boundaries.js'), '--workspace-root', '.'], ROOT);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('0 violations');
    record('realTree.boundaryViolations', 0);
  });
});

describe('fixture manifests', () => {
  it('validates every manifest, pinned file hash and configuration hash', () => {
    const result = run(['node', join(DIST, 'fixtures.js'), '--root', 'tests/fixtures'], ROOT);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('fixture validation OK: 7 fixture(s)');
    record('fixtureManifests.total', 7);
    record('fixtureManifests.allValid', true);
  });

  it('detects an edited fixture file and an undeclared fixture file', () => {
    const scratch = tempDir('tamper');
    try {
      const fixtures = join(scratch, 'fixtures');
      mkdirSync(fixtures, { recursive: true });
      cpSync(join(ROOT, 'tests/fixtures/boundaries/allowed'), join(fixtures, 'boundaries/allowed'), { recursive: true });
      writeFileSync(join(fixtures, 'boundaries/allowed/packages/config/src/index.ts'), 'export const tampered = 1;\n');
      writeFileSync(join(fixtures, 'boundaries/allowed/packages/config/src/extra.ts'), 'export const extra = 1;\n');

      const result = run(['node', join(DIST, 'fixtures.js'), '--root', fixtures], ROOT);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain('hash mismatch for packages/config/src/index.ts');
      expect(result.stdout + result.stderr).toContain('undeclared fixture file: packages/config/src/extra.ts');
      record('fixtureManifests.tamperDetected', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('strict compiler enforcement', () => {
  it('rejects the invalid TypeScript fixture with exactly the expected diagnostics', () => {
    const fixtureDir = join(ROOT, 'tests/fixtures/boundaries/strict-type-errors');
    const manifest = json<{ expectedDiagnosticCodes: string[] }>('tests/fixtures/boundaries/strict-type-errors/fixture.json');

    const result = run(['pnpm', 'exec', 'tsc', '-p', join(fixtureDir, 'tsconfig.json'), '--noEmit'], ROOT);
    expect(result.status, 'the strict fixture must not compile').not.toBe(0);

    const output = `${result.stdout}${result.stderr}`;
    const codes = [...output.matchAll(/\bTS\d{4,5}\b/g)].map((match) => match[0]);
    const unique = [...new Set(codes)].sort();
    for (const code of manifest.expectedDiagnosticCodes) {
      expect(unique, `expected ${code} in:\n${output}`).toContain(code);
    }
    expect(unique).toEqual([...manifest.expectedDiagnosticCodes].sort());
    expect(output).toContain('Cannot find name');
    record('strictFixture.rejected', true);
    record('strictFixture.diagnosticCodes', unique);
  });
});

describe('task and suite dispatch', () => {
  it('plans the existing UDG-001 suite and refuses every suite that does not exist yet', () => {
    const plans: string[] = [];
    const refusals: string[] = [];
    for (const taskId of CONTRACT_TASK_IDS) {
      const decision = decideContractRun(ROOT, taskId);
      if (decision.plan !== undefined) {
        plans.push(taskId);
        expect(taskId).toBe('UDG-001');
        expect(planContractRun(taskId).suitePath).toBe('tests/contracts/UDG-001.test.ts');
        continue;
      }
      refusals.push(taskId);
      expect(decision.exitCode, taskId).toBe(2);
      expect(decision.message, taskId).toContain(taskId);
      expect(decision.message, taskId).toContain('refuses to report success');
    }
    expect(plans).toEqual(['UDG-001']);
    expect(refusals.length).toBe(CONTRACT_TASK_IDS.length - 1);
    record('dispatch.refusedTasks', refusals.length);
  });

  it('rejects an unknown task id and a missing --task value', () => {
    expect(decideContractRun(ROOT, 'UDG-999').exitCode).toBe(2);
    expect(decideContractRun(ROOT, 'nonsense').message).toContain('not a task id');
    expect(decideContractRun(ROOT, undefined).exitCode).toBe(2);

    const cli = run(['node', join(DIST, 'run-contract.js'), '--task', 'UDG-999'], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('valid task ids');
    record('dispatch.unknownTaskRejected', true);
  });

  it('refuses commands owned by later tasks with an attributed reason', () => {
    const guarded = ['test:e2e', 'test:spike', 'test:unit', 'assets:build', 'assets:verify'] as const;
    for (const command of guarded) {
      const guard = guardUnavailable(command, ['--suite', 'camera']);
      expect(guard.exitCode, command).toBe(1);
      expect(guard.message, command).toContain('owning task');
      expect(guard.message, command).toContain('never reported as a pass');
      expect(guard.message, command).toContain('UDG-');

      const cli = run(['node', join(DIST, 'dispatch.js'), command], ROOT);
      expect(cli.status, command).toBe(1);
    }
    expect(guardUnavailable('test:whatever', []).exitCode).toBe(2);
    record('dispatch.guardedCommands', guarded.length);
  });

  it('refuses an unpopulated task suite through the real command line', () => {
    const cli = run(['node', join(DIST, 'run-contract.js'), '--task', 'UDG-002'], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('UDG-002');
    expect(cli.stderr).toContain('docs/contracts/UDG-002.md');
    expect(cli.stdout).not.toContain('Test Files  1 passed');
    record('missingSuite.refused', true);
    record('missingSuite.exitCode', cli.status);
  });
});

describe('frozen installation', () => {
  const minimalProject = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    for (const file of ['package.json', 'pnpm-workspace.yaml', '.npmrc', '.node-version']) {
      cpSync(join(ROOT, file), join(dir, file));
    }
    for (const workspace of WORKSPACES) {
      const target = join(dir, workspace.dir);
      mkdirSync(target, { recursive: true });
      cpSync(join(ROOT, workspace.dir, 'package.json'), join(target, 'package.json'));
    }
    cpSync(join(ROOT, 'pnpm-lock.yaml'), join(dir, 'pnpm-lock.yaml'));
  };

  it('installs the committed lockfile without mutation', () => {
    const scratch = tempDir('frozen-ok');
    try {
      minimalProject(scratch);
      const result = run(['pnpm', 'install', '--frozen-lockfile'], scratch, 600_000);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      record('frozenLockfile.cleanInstall', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a lockfile whose pinned version was modified', () => {
    const scratch = tempDir('frozen-version');
    try {
      minimalProject(scratch);
      const lockPath = join(scratch, 'pnpm-lock.yaml');
      const mutated = readFileSync(lockPath, 'utf8').replaceAll('typescript@5.9.3', 'typescript@5.9.2').replaceAll('typescript: 5.9.3', 'typescript: 5.9.2');
      expect(mutated).not.toBe(readFileSync(lockPath, 'utf8'));
      writeFileSync(lockPath, mutated);

      const result = run(['pnpm', 'install', '--frozen-lockfile'], scratch, 600_000);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/ERR_PNPM_|lockfile/i);
      record('frozenLockfile.rejected', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a manifest that adds a dependency the lockfile does not contain', () => {
    const scratch = tempDir('frozen-manifest');
    try {
      minimalProject(scratch);
      const manifestPath = join(scratch, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { devDependencies: Record<string, string> };
      manifest.devDependencies['left-pad'] = '1.3.0';
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = run(['pnpm', 'install', '--frozen-lockfile'], scratch, 600_000);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/frozen lockfile|lockfile is not up to date|ERR_PNPM_/i);
      record('frozenLockfile.manifestMutationRejected', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('leaves tracked files unchanged when the root installation is repeated', () => {
    const tracked = (raw: string): string[] =>
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('??')); // untracked paths are not installation output
    const before = run(['git', 'status', '--porcelain'], ROOT);
    expect(before.status, before.stderr).toBe(0);
    const preExisting = new Set(tracked(before.stdout));

    const first = run(['pnpm', 'install', '--frozen-lockfile'], ROOT, 600_000);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const second = run(['pnpm', 'install', '--frozen-lockfile'], ROOT, 600_000);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);

    const after = run(['git', 'status', '--porcelain'], ROOT);
    const newlyChanged = tracked(after.stdout).filter((line) => !preExisting.has(line));
    expect(newlyChanged, `installation changed tracked files: ${newlyChanged.join(', ')}`).toEqual([]);
    record('secondInstall.trackedFilesUnchanged', true);
    record('secondInstall.workingTreeWasClean', preExisting.size === 0);
  });
});

describe('evidence capture schema and verification', () => {
  const plan: CapturePlan = CAPTURE_PLANS['UDG-001'] as CapturePlan;

  const environment = (): Record<string, unknown> => ({
    schemaVersion: 1,
    runnerAlias: 'runner-0123456789ab',
    workingDirectory: 'REPO_ROOT',
    osPlatform: process.platform,
    osRelease: 'test',
    osArch: process.arch,
    cpuCount: 1,
    cpuModels: ['test cpu'],
    memoryTotalGb: 1,
    nodeVersion: process.version,
    pnpmVersion: '12.18.0',
    expectedNodeVersion: '24.22.2',
    packageManagerField: 'pnpm@12.18.0',
    ci: false,
    timezone: 'UTC',
    monotonicClock: 'node:process.hrtime.bigint',
    gitCommit: '0'.repeat(40),
    gitBranch: 'test',
    gitDirty: false,
  });

  const commands = (exitCode = 0): Record<string, unknown> => ({
    schemaVersion: 1,
    runId: 'synthetic',
    taskId: 'UDG-001',
    workingDirectory: 'REPO_ROOT',
    allSucceeded: exitCode === 0,
    commands: plan.commands.map((step) => ({
      label: step.label,
      argv: step.argv,
      workingDirectory: 'REPO_ROOT',
      start: '2026-11-08T00:00:00.000Z',
      end: '2026-11-08T00:00:01.000Z',
      exitCode,
      durationMs: 1000,
      stdoutPath: step.buildLog === true ? 'build.log' : `logs/${step.label}.stdout.log`,
      stderrPath: step.buildLog === true ? null : `logs/${step.label}.stderr.log`,
      timeout: 'none',
      environmentKeys: Object.keys(step.env ?? {}).sort(),
    })),
  });

  const junit = (tests: number, failures = 0, skipped = 0, duplicate = false): string => {
    const cases = Array.from({ length: Math.max(tests, 0) }, (_unused, index) => index)
      .map((index) => `    <testcase classname="synthetic" name="case ${String(index)}" time="0.01"/>`)
      .join('\n');
    const extra = duplicate ? `    <testcase classname="synthetic" name="case 0" time="0.01"/>\n` : '';
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuites name="synthetic" tests="${String(tests)}" failures="${String(failures)}" skipped="${String(skipped)}">`,
      `  <testsuite name="synthetic" tests="${String(tests)}" failures="${String(failures)}" errors="0" skipped="${String(skipped)}">`,
      cases,
      extra.trimEnd(),
      `  </testsuite>`,
      `</testsuites>`,
      ``,
    ].join('\n');
  };

  interface BundleOptions {
    readonly tests?: number;
    readonly failures?: number;
    readonly skipped?: number;
    readonly duplicateCaseNames?: readonly string[];
    readonly commandExitCode?: number;
    readonly status?: EvidenceStatus;
    readonly measurements?: Record<string, unknown>;
    readonly dropFile?: RepoPath;
  }

  /** Build a bundle with the same writer the capture path uses, then verify it. */
  const buildBundle = (scratch: string, options: BundleOptions = {}): { dir: string; runId: string } => {
    const runId = 'UDG-001-synthetic-00000000';
    const dir = join(scratch, runId);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const tests = options.tests ?? 24;
    const failures = options.failures ?? 0;
    const skipped = options.skipped ?? 0;

    writeFileSync(join(dir, 'junit.xml'), junit(tests, failures, skipped));
    writeFileSync(join(dir, 'build.log'), 'build output\n');
    writeFileSync(join(dir, 'boundary-report.json'), `${JSON.stringify({ schemaVersion: 1, ok: true, violations: [] }, null, 2)}\n`);
    for (const step of plan.commands) {
      if (step.buildLog === true) continue;
      writeFileSync(join(dir, `logs/${step.label}.stdout.log`), `${step.label} stdout\n`);
      writeFileSync(join(dir, `logs/${step.label}.stderr.log`), `${step.label} stderr\n`);
    }
    writeFileSync(join(dir, 'environment.json'), `${JSON.stringify(environment(), null, 2)}\n`);
    writeFileSync(join(dir, 'commands.json'), `${JSON.stringify(commands(options.commandExitCode ?? 0), null, 2)}\n`);

    const status: EvidenceStatus =
      options.status ?? (tests > 0 && failures === 0 && (options.commandExitCode ?? 0) === 0 ? 'PASS' : 'FAIL');
    writeBundleArtifacts(ROOT, plan, dir, runId, {
      runStart: '2026-11-08T00:00:00.000Z',
      runEnd: '2026-11-08T00:00:20.000Z',
      suites: [
        {
          name: 'synthetic',
          tests,
          failures,
          errors: 0,
          skipped,
          quarantined: 0,
          duplicateCaseNames: options.duplicateCaseNames ?? [],
        },
      ],
      testCounts: { tests, failures, errors: 0, skipped },
      status,
      measurements: options.measurements ?? { boundaryFixtures: { total: 6, allMatched: true } },
    });
    if (options.dropFile !== undefined) rmSync(join(dir, options.dropFile), { force: true });
    return { dir, runId };
  };

  const codesOf = (issues: readonly { code: VerifyCode }[]): string[] => issues.map((issue) => issue.code);

  it('accepts a well-formed bundle written by the real writer', () => {
    const scratch = tempDir('evidence-ok');
    try {
      const { dir, runId } = buildBundle(scratch);
      const result = verify(ROOT, dir);
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);

      const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as {
        taskId: string;
        contractHash: string;
        baselineSpecHash: string;
        dependencyLockHash: string;
        prerequisiteShas: string[];
        status: string;
        files: { path: string }[];
      };
      expect(report.taskId).toBe('UDG-001');
      expect(report.contractHash).toMatch(/^[0-9a-f]{64}$/);
      expect(report.baselineSpecHash).toMatch(/^[0-9a-f]{64}$/);
      expect(report.dependencyLockHash).toMatch(/^[0-9a-f]{64}$/);
      expect(report.prerequisiteShas[0]).toMatch(/^[0-9a-f]{40}$/);
      expect(report.status).toBe('PASS');
      const paths = report.files.map((file) => file.path);
      for (const required of plan.requiredFiles) {
        if (required === 'report.json') continue;
        expect(paths, required).toContain(required);
      }
      expect(paths).not.toContain('checksums.sha256');
      expect(readFileSync(join(dir, 'checksums.sha256'), 'utf8')).toContain(runId.length > 0 ? 'junit.xml' : '');
      record('evidence.acceptsWellFormedBundle', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a mutated evidence file', () => {
    const scratch = tempDir('evidence-mutate');
    try {
      const { dir } = buildBundle(scratch);
      writeFileSync(join(dir, 'build.log'), 'build output tampered\n');
      const result = verify(ROOT, dir);
      expect(result.ok).toBe(false);
      const codes = codesOf(result.issues);
      expect(codes).toContain('EVIDENCE-FILE-HASH');
      expect(codes).toContain('EVIDENCE-CHECKSUM-MISMATCH');
      record('evidence.rejectsMutatedFile', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a missing required artefact', () => {
    const scratch = tempDir('evidence-missing');
    try {
      const { dir } = buildBundle(scratch, { dropFile: 'boundary-report.json' });
      const codes = codesOf(verify(ROOT, dir).issues);
      expect(codes).toContain('EVIDENCE-FILE-MISSING');
      expect(codes).toContain('EVIDENCE-CHECKSUM-INCOMPLETE');
      record('evidence.rejectsMissingArtefact', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects zero discovered tests', () => {
    const scratch = tempDir('evidence-zero');
    try {
      const { dir } = buildBundle(scratch, { tests: 0 });
      const codes = codesOf(verify(ROOT, dir).issues);
      expect(codes).toContain('EVIDENCE-ZERO-TESTS');
      record('evidence.rejectsZeroTests', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects skipped tests and a rerun case name', () => {
    const scratch = tempDir('evidence-skip');
    try {
      const skipped = buildBundle(scratch, { skipped: 3 });
      expect(codesOf(verify(ROOT, skipped.dir).issues)).toContain('EVIDENCE-SKIP-PRESENT');

      const flakyDir = join(scratch, 'flaky');
      mkdirSync(flakyDir, { recursive: true });
      const base = buildBundle(scratch);
      cpSync(base.dir, flakyDir, { recursive: true });
      writeFileSync(join(flakyDir, 'junit.xml'), junit(24, 0, 0, true));
      const codes = codesOf(verify(ROOT, flakyDir).issues);
      expect(codes).toContain('EVIDENCE-FLAKY');
      record('evidence.rejectsSkipsAndReruns', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a PASS status whose recorded command failed', () => {
    const scratch = tempDir('evidence-exit');
    try {
      const { dir } = buildBundle(scratch, { commandExitCode: 1, status: 'PASS' });
      const codes = codesOf(verify(ROOT, dir).issues);
      // A failed command makes the recorded PASS inconsistent.
      expect(codes).toContain('EVIDENCE-COMMAND-FAILED');
      record('evidence.rejectsInconsistentStatus', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects unsanitised credential material and private paths', () => {
    const scratch = tempDir('evidence-secret');
    try {
      const { dir } = buildBundle(scratch);
      writeFileSync(join(dir, 'logs/lint.stdout.log'), 'token ghp_0123456789abcdefghij0123 logged\n');
      let codes = codesOf(verify(ROOT, dir).issues);
      expect(codes).toContain('EVIDENCE-SECRET');

      const pathDir = join(scratch, 'paths');
      mkdirSync(pathDir, { recursive: true });
      cpSync(dir, pathDir, { recursive: true });
      writeFileSync(join(pathDir, 'logs/lint.stderr.log'), 'read /home/developer/private/notes.txt\n');
      codes = codesOf(verify(ROOT, pathDir).issues);
      expect(codes).toContain('EVIDENCE-SECRET');
      record('evidence.rejectsSecretsAndPaths', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a bundle without measured values for its own thresholds', () => {
    const scratch = tempDir('evidence-measured');
    try {
      const { dir } = buildBundle(scratch, { measurements: {} });
      expect(codesOf(verify(ROOT, dir).issues)).toContain('EVIDENCE-MEASUREMENTS-MISSING');
      record('evidence.requiresMeasurements', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a report that references a path outside the bundle', () => {
    const scratch = tempDir('evidence-escape');
    try {
      const { dir } = buildBundle(scratch);
      const reportPath = join(dir, 'report.json');
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        files: { path: string; sha256: string; bytes: number; required: boolean }[];
      };
      report.files.push({ path: '../../../etc/passwd', sha256: '0'.repeat(64), bytes: 1, required: false });
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      expect(codesOf(verify(ROOT, dir).issues)).toContain('EVIDENCE-PATH-ESCAPE');
      record('evidence.rejectsPathEscape', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a bundle whose own capture reported unsanitised artefacts', () => {
    const scratch = tempDir('evidence-sanitise-selfreport');
    try {
      const { dir } = buildBundle(scratch, {
        status: 'PASS',
        measurements: { capture: { commandsRun: 8, failingCommands: [], sanitisationFailures: ['logs/test.stdout.log (1 machine path(s))'] } },
      });
      expect(codesOf(verify(ROOT, dir).issues)).toContain('EVIDENCE-SECRET');
      record('evidence.rejectsSelfReportedSanitisationFailure', true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('aliases every machine path before it can enter a bundle (clarification C-03)', () => {
    const roots = machineRoots('/checkout/repo', '/evidence/store/RUN-1', '/cache/pnpm-store/v11');
    const raw =
      'wrote /evidence/store/RUN-1/junit.xml from /checkout/repo/tools/checks with store /cache/pnpm-store/v11 ' +
      'and a developer file /home/example/notes.txt';
    const out = sanitiseMachineText(raw, roots);
    for (const [path] of roots) expect(out, path).not.toContain(path);
    expect(out).not.toContain('/home/example');
    expect(out).toContain('BUNDLE_ROOT/junit.xml');
    expect(out).toContain('REPO_ROOT/tools/checks');
    expect(out).toContain('PNPM_STORE');
    expect(out).toContain('<HOME>');
    record('evidence.machinePathAliasing', true);
  });

  it('parses junit counts and flags duplicate case names', () => {
    const counts = parseJunit(junit(3));
    expect(counts).toEqual({ tests: 3, failures: 0, errors: 0, skipped: 0, duplicateCaseNames: [] });
    expect(parseJunit(junit(3, 1, 2)).failures).toBe(1);
    expect(parseJunit(junit(2, 0, 0, true)).duplicateCaseNames).toEqual(['case 0']);
    record('evidence.junitParser', true);
  });
});

describe('planning records stay consistent with the implementation', () => {
  it('keeps the contract checksum manifest matching tracked planning files', () => {
    const manifest = json<{ algorithm: string; excluded: string[]; files: Record<string, string> }>('docs/contracts/checksums.json');
    expect(manifest.algorithm).toBe('sha256');
    const mismatched: string[] = [];
    for (const [path, hash] of Object.entries(manifest.files)) {
      if (!existsSync(join(ROOT, path))) {
        mismatched.push(`${path}: missing`);
        continue;
      }
      if (sha256File(join(ROOT, path)) !== hash) mismatched.push(`${path}: hash differs`);
    }
    expect(mismatched).toEqual([]);

    // The committed generator must agree that nothing moved.
    const cli = run(['node', join(DIST, 'evidence.js'), 'checksums'], ROOT);
    expect(cli.status, `${cli.stdout}${cli.stderr}`).toBe(0);
    expect(cli.stdout).toContain('in sync');
    expect(manifest.excluded).toContain('docs/contracts/checksums.json');
    record('planning.checksumsMatch', true);
    record('planning.checksummedFiles', Object.keys(manifest.files).length);
  });

  it('records the UDG-001 assignment against the reviewed prerequisite commit', () => {
    const assignment = readFileSync(join(ROOT, 'docs/contracts/assignments/UDG-001.md'), 'utf8');
    const prerequisite = /Prerequisite commit:\s*([0-9a-f]{40})/.exec(assignment)?.[1];
    expect(prerequisite).toMatch(/^[0-9a-f]{40}$/);
    const exists = run(['git', 'cat-file', '-t', prerequisite as string], ROOT);
    expect(exists.status, exists.stderr).toBe(0);
    expect(exists.stdout.trim()).toBe('commit');

    const adoption = readFileSync(join(ROOT, 'docs/contracts/adoption.md'), 'utf8');
    expect(adoption).toContain('| P01 | **Approved** |');
    for (const pending of ['P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']) {
      expect(adoption).toContain(`| ${pending} | Pending |`);
    }
    record('planning.prerequisiteCommit', prerequisite ?? 'missing');
  });

  it('commits a sanitised evidence summary whose integrity fields are complete (C-03)', () => {
    const path = 'docs/contracts/assignments/UDG-001-evidence.json';
    expect(existsSync(join(ROOT, path)), path).toBe(true);
    const summary = json<{
      schemaVersion: number;
      taskId: string;
      runId: string;
      durableStorage: { location: string; note: string };
      verification: { command: string; ok: boolean; issueCount: number };
      status: string;
      implementationSha: string;
      workingTreeDirty: boolean;
      prerequisiteShas: string[];
      contractHash: string;
      baselineSpecHash: string;
      dependencyLockHash: string;
      configHashes: Record<string, string>;
      testCounts: { tests: number; failures: number; errors: number; skipped: number };
      commands: { label: string; exitCode: number; durationMs: number }[];
      ci: { status: string; note: string; url?: string };
      artifacts: { path: string; sha256: string; bytes: number }[];
    }>(path);

    const hex64 = /^[0-9a-f]{64}$/;
    expect(summary.taskId).toBe('UDG-001');
    expect(summary.runId).toMatch(/^UDG-001-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(summary.implementationSha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.prerequisiteShas[0]).toBe('555735b6b3b2b72ec23fb99f2db26cbe3cef67a2');
    expect(summary.contractHash).toMatch(hex64);
    expect(summary.baselineSpecHash).toBe('b51e7afdd6810c377d2d2702d7673119521a59cd0d6b91686700bf9149b73fcf');
    expect(summary.dependencyLockHash).toMatch(hex64);
    for (const [name, hash] of Object.entries(summary.configHashes)) expect(hash, name).toMatch(hex64);

    // The summary must describe a real, verified, non-empty run, and must not claim CI success.
    expect(summary.testCounts.tests).toBeGreaterThan(0);
    expect(summary.testCounts.skipped).toBe(0);
    expect(summary.commands.length).toBe(8);
    expect(summary.commands.every((command) => command.exitCode === 0)).toBe(true);
    expect(summary.verification.ok).toBe(true);
    expect(summary.verification.issueCount).toBe(0);
    // CI is either explicitly pending or an evidenced GitHub Actions success; a vague claim fails.
    const ciGreen = /^success\b/.test(summary.ci.status);
    expect(ciGreen || summary.ci.status === 'pending-owner-run').toBe(true);
    if (ciGreen) expect(summary.ci.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/);
    else expect(summary.ci.url).toBeUndefined();
    record('evidence.ciClaim', ciGreen ? `success (${summary.ci.url ?? 'missing url'})` : 'pending-owner-run');
    expect(summary.artifacts.length).toBeGreaterThan(0);
    for (const artifact of summary.artifacts) {
      expect(artifact.sha256, artifact.path).toMatch(hex64);
      // A successful command writes nothing to stderr, so that stream may legitimately be empty.
      const mayBeNull = /^logs\/[^/]+\.stderr\.log$/.test(artifact.path);
      expect(artifact.bytes, artifact.path).toBeGreaterThanOrEqual(mayBeNull ? 0 : 1);
      expect(artifact.path).not.toContain('..');
    }
    for (const required of ['report.json', 'junit.xml', 'environment.json', 'commands.json', 'checksums.sha256']) {
      expect(summary.artifacts.some((artifact) => artifact.path === required), required).toBe(true);
    }
    expect(summary.workingTreeDirty).toBe(false);

    // The committed summary itself must carry no credential or private path.
    const raw = readFileSync(join(ROOT, path), 'utf8');
    expect(raw).not.toMatch(/\/(?:home|Users)\/[A-Za-z0-9._-]+\//);
    expect(raw).not.toMatch(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/);
    expect(raw).not.toMatch(/"(?:password|secret|clientSecret|token)"\s*:\s*"[^"]{4,}"/i);
    expect(raw).not.toContain(homedir());
    record('evidence.summaryCommitted', true);
    record('evidence.summaryArtefacts', summary.artifacts.length);
  });

  it('ships an ADR template and an environment example with no secrets', () => {
    expect(existsSync(join(ROOT, 'docs/adr/0000-template.md'))).toBe(true);
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(example).not.toMatch(/(password|secret|token)\s*=\s*\S/i);
    expect(example).toContain('UDG_SERVER_PORT=2567');
    expect(example).toContain('UDG_CLIENT_PORT=5173');
    expect(example).toContain('UDG_HOST=127.0.0.1');
    record('planning.envExampleLoopbackOnly', true);
  });

  it('documents every root command and its availability in the README', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
      'pnpm test:boundaries',
      'pnpm test:fixtures',
      'pnpm test:contract',
      'pnpm test:e2e',
      'pnpm test:spike',
      'pnpm test:unit',
      'pnpm assets:build',
      'pnpm assets:verify',
      'pnpm evidence:verify',
      'pnpm evidence:summary',
      'pnpm contracts:checksums',
    ]) {
      expect(readme, command).toContain(command);
    }
    expect(readme).toContain('24.22.2');
    expect(readme).toContain('12.18.0');
    expect(readme).toContain('2567');
    expect(readme).toContain('5173');
    record('planning.readmeCommands', true);
  });

  it('authorship: the CI workflow runs the same scripts and pins third-party actions', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    for (const command of ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build', 'pnpm test:boundaries', 'pnpm test:fixtures', 'pnpm test:contract', 'pnpm contracts:checksums', 'pnpm dependencies:verify']) {
      expect(workflow, command).toContain(command);
    }
    expect(workflow).toContain('24.22.2');
    expect(workflow).toContain('12.18.0');
    for (const match of workflow.matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g)) {
      expect(match[2], match[1]).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(workflow).not.toMatch(/secrets\./);
    record('planning.ciMirrorsLocalCommands', true);
  });
});

afterAll(() => {
  const target = process.env['UDG_EVIDENCE_MEASUREMENTS'];
  if (target === undefined || target.length === 0) return;
  const absolute = resolve(target);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(measured, null, 2)}\n`);
  if (!existsSync(absolute)) {
    throw new Error(`measurements were not written to ${absolute}`);
  }
});
