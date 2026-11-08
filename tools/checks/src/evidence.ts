/**
 * Evidence bundle schema, capture and verification (UDG-001).
 *
 * Implements docs/validation/evidence-requirements.md 19.1 for the only run this task produces:
 * its own foundation run. The schema and the verifier are task-agnostic so later tasks reuse them
 * unchanged; a bundle that is empty, skipped, unsanitised or internally inconsistent cannot pass.
 *
 *   evidence.js capture   --task UDG-001 [--out artifacts] [--keep-going]
 *   evidence.js verify    --run artifacts/RUN_ID [--report <file>]
 *   evidence.js dependencies [--out docs/integration/dependencies.json] [--verify]
 *   evidence.js checksums [--write]
 *   evidence.js summary   --run <bundle> [--out <file>] [--storage <location>] [--ci-status <s>] [--ci-url <u>]
 *
 * verify and summary are gates, not neutral audits: a bundle whose own record says FAIL, BLOCKED or
 * INVALID is refused (EVIDENCE-GATE-NOT-PASS) even when every stored hash matches, because a
 * self-consistent record of a failing run proves nothing about completion.
 *
 * Sanitisation rules (19.1): no bearer or reconnect tokens, cookies, credentials or private
 * machine paths. The environment record therefore contains no variable dump, the working
 * directory is the alias REPO_ROOT, and the host name is replaced by a per-run alias.
 */

import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { cpus, release, arch, platform, machine, totalmem, homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  CONTRACT_TASK_IDS,
  git,
  isMainModule,
  parseArgs,
  readOptional,
  requireFlag,
  runCommand,
  machineRoots,
  sha256Bytes,
  sha256Canonical,
  sha256File,
  sanitiseMachineText,
  flagString,
  toRepoPath,
  writeJson,
  writeFileSyncEnsuring,
  type CliArgs,
  type RepoPath,
  type RunResult,
} from './support.js';

import { baseTsconfigHash, boundaryConfigHash, ruleTableHash } from './boundaries.js';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const CONTRACT_ID = 'UDG-CONTRACTS-M0-001';
export const CONTRACT_VERSION = '1.0';
export const BASELINE_SPEC_ID = 'UDG-SPEC-M0-002';

export type EvidenceStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID';

export interface CommandRecord {
  readonly label: string;
  readonly argv: readonly string[];
  readonly workingDirectory: 'REPO_ROOT';
  readonly start: string;
  readonly end: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdoutPath: RepoPath | null;
  readonly stderrPath: RepoPath | null;
  readonly timeout: 'none' | 'exceeded';
  readonly environmentKeys: readonly string[];
}

export interface SuiteRecord {
  readonly name: string;
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  readonly quarantined: number;
  readonly duplicateCaseNames: readonly string[];
}

export interface EvidenceFileRef {
  readonly path: RepoPath;
  readonly sha256: string;
  readonly bytes: number;
  readonly required: boolean;
}

export interface EvidenceReport {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly taskId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
  readonly baselineSpecId: string;
  readonly baselineSpecHash: string;
  readonly implementationSha: string;
  readonly branch: string;
  readonly workingTreeDirty: boolean;
  readonly prerequisiteShas: readonly string[];
  readonly dependencyLockHash: string;
  readonly configHashes: Readonly<Record<string, string>>;
  readonly fixtureHashes: Readonly<Record<string, string>>;
  readonly assetHashes: Readonly<Record<string, string>>;
  readonly runStart: string;
  readonly runEnd: string;
  readonly seeds: readonly number[];
  readonly profiles: Readonly<{ requested: readonly string[]; achieved: readonly string[]; note: string }>;
  readonly suites: readonly SuiteRecord[];
  readonly testCounts: Readonly<{ tests: number; failures: number; errors: number; skipped: number }>;
  readonly thresholds: Readonly<Record<string, string>>;
  readonly measured: Readonly<Record<string, unknown>>;
  readonly status: EvidenceStatus;
  readonly files: readonly EvidenceFileRef[];
  readonly notApplicable: readonly { path: string; reason: string }[];
  readonly sanitisation: Readonly<{ removed: readonly string[]; aliases: Readonly<Record<string, string>> }>;
}

export interface CapturePlan {
  readonly taskId: string;
  readonly requiredFiles: readonly string[];
  readonly thresholds: Readonly<Record<string, string>>;
  readonly commands: readonly {
    readonly label: string;
    readonly argv: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly buildLog?: boolean;
    readonly junit?: boolean;
    readonly measurements?: boolean;
  }[];
}

/** What a foundation run has to prove, in the order the repository contract lists it. */
export const CAPTURE_PLANS: Readonly<Record<string, CapturePlan>> = {
  'UDG-001': {
    taskId: 'UDG-001',
    requiredFiles: [
      'environment.json',
      'commands.json',
      'junit.xml',
      'boundary-report.json',
      'build.log',
      'report.json',
    ],
    thresholds: {
      'toolchain.node': '=== "v24.22.2" (owner clarification C-01)',
      'toolchain.pnpmCli': '=== "12.18.0" (owner clarification C-01)',
      'pins.exactVersionSpecsOnly': '=== true (no range or tag specifier in any workspace manifest)',
      'workspaces.populated': '=== 8 workspaces, each typechecked and built by the root commands',
      'boundaryFixtures.total': '=== 6 dependency-boundary fixtures, each matching its declared expectation (the 7th directory under tests/fixtures/boundaries is the strict-compile fixture, asserted separately)',
      'boundaryFixtures.negative': '>= 5 reject fixtures, each matched by its expected rule ids',
      'realTree.boundaryViolations': '=== 0 on the repository tree',
      'fixtureManifests.allValid': '=== true (manifest schema, pinned file hashes and configuration hash)',
      'strictFixture.rejected': '=== true, with the diagnostic code set matching the fixture manifest',
      'missingSuite.refused': '=== true and exit code 2 (an absent task suite never reports success)',
      'dispatch.refusedTasks': '=== 10 (every contract task except UDG-001 refuses)',
      'dispatch.guardedCommands': '=== 5 guarded later-task commands refusing with an attributed reason',
      'frozenLockfile.cleanInstall': '=== true',
      'frozenLockfile.rejected': '=== true (a mutated lockfile must be refused)',
      'frozenLockfile.manifestMutationRejected': '=== true (an unlocked manifest addition is refused)',
      'secondInstall.trackedFilesUnchanged': '=== true',
      'evidence.acceptsWellFormedBundle': '=== true, and every corrupted copy must be rejected',
      'capture.commandsRun': '=== 8 commands, capture.failingCommands === []',
    },
    commands: [
      { label: 'install-frozen', argv: ['pnpm', 'install', '--frozen-lockfile'] },
      { label: 'typecheck', argv: ['pnpm', 'typecheck'] },
      { label: 'lint', argv: ['pnpm', 'lint'], env: { UDG_BOUNDARY_REPORT: 'BUNDLE/boundary-report.json' } },
      {
        label: 'test',
        argv: ['pnpm', 'test'],
        env: { UDG_EVIDENCE_JUNIT: 'BUNDLE/junit.xml', UDG_EVIDENCE_MEASUREMENTS: 'MEAS/UDG-001.json' },
        junit: true,
        measurements: true,
      },
      { label: 'build', argv: ['pnpm', 'build'], buildLog: true },
      { label: 'test-boundaries', argv: ['pnpm', 'test:boundaries'] },
      { label: 'test-fixtures', argv: ['pnpm', 'test:fixtures'] },
      { label: 'test-contract-UDG-001', argv: ['pnpm', 'test:contract', '--', '--task', 'UDG-001'] },
    ],
  },
};

const SECRET_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/ },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { id: 'bearer-authorization', pattern: /\bAuthorization\s*:\s*Bearer\s+\S+/i },
  { id: 'cookie-header', pattern: /\bCookie\s*:\s*\S*=[^;\s]/i },
  { id: 'reconnection-token-field', pattern: /"(?:reconnectionToken|reconnectToken|sessionToken|accessToken)"\s*:\s*"[^"]{8,}"/i },
  { id: 'password-field', pattern: /"(?:password|secret|clientSecret)"\s*:\s*"[^"]{4,}"/i },
  { id: 'home-directory-path', pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]{2,}\// },
  { id: 'ssh-directory-path', pattern: /\/\.ssh\// },
  { id: 'npmrc-auth-line', pattern: /\/\/[^\s]*:_authToken=/ },
];

const SCANNABLE = /\.(?:json|xml|log|txt|csv|md|ya?ml|ts|js)$/;

export interface SecretHit {
  readonly file: RepoPath;
  readonly pattern: string;
  readonly line: number;
}

/** Scan bundle text for credential-shaped or machine-specific content. */
export const scanForSecrets = (root: string, files: readonly RepoPath[]): SecretHit[] => {
  const hits: SecretHit[] = [];
  for (const relative of files) {
    if (!SCANNABLE.test(relative)) continue;
    const absolute = join(root, relative);
    const text = readOptional(absolute);
    if (text === undefined) continue;
    if (statSync(absolute).size > 8 * 1024 * 1024) continue;
    const lines = text.split('\n');
    for (const { id, pattern } of SECRET_PATTERNS) {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        // The scanner must not fire on its own pattern definitions or on documented aliases.
        if (line.includes('SECRET_PATTERNS') || line.includes('runner-alias')) continue;
        if (pattern.test(line)) {
          hits.push({ file: relative, pattern: id, line: i + 1 });
          break;
        }
      }
    }
  }
  return hits;
};

export interface JunitCounts {
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  readonly duplicateCaseNames: readonly string[];
}

/** Sum every <testsuite> element. Duplicate case names indicate a rerun, i.e. a flaky test. */
export const parseJunit = (xml: string): JunitCounts => {
  const suites = [...xml.matchAll(/<testsuite\s[^>]*>/g)].map((match) => match[0]);
  const attribute = (tag: string, name: string): number => {
    const found = new RegExp(`${name}="(\\d+)"`).exec(tag);
    return found?.[1] === undefined ? 0 : Number.parseInt(found[1], 10);
  };
  const caseNames: string[] = [];
  for (const match of xml.matchAll(/<testcase\s[^>]*name="([^"]*)"/g)) {
    if (match[1] !== undefined) caseNames.push(match[1]);
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of caseNames) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return {
    tests: suites.reduce((total, tag) => total + attribute(tag, 'tests'), 0),
    failures: suites.reduce((total, tag) => total + attribute(tag, 'failures'), 0),
    errors: suites.reduce((total, tag) => total + attribute(tag, 'errors'), 0),
    skipped: suites.reduce((total, tag) => total + attribute(tag, 'skipped'), 0),
    duplicateCaseNames: [...duplicates].sort(),
  };
};

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const shortSha = (sha: string): string => (sha === '' ? 'nosha' : sha.slice(0, 8));

const listFiles = (absoluteDir: string, prefix = ''): RepoPath[] => {
  if (!existsSync(absoluteDir)) return [];
  const out: RepoPath[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(absoluteDir, entry.name), relative));
    else out.push(relative);
  }
  return out;
};

const environmentRecord = (root: string, runAlias: string): Record<string, unknown> => {
  const cpuList: readonly { model: string; speed: number }[] = cpus().map((cpu) => ({
    model: cpu.model,
    speed: cpu.speed,
  }));
  const uniqueModels = [...new Set(cpuList.map((cpu) => cpu.model))];
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    runnerAlias: `runner-${runAlias}`,
    workingDirectory: 'REPO_ROOT',
    osPlatform: platform(),
    osRelease: release(),
    osArch: arch(),
    machineAlias: `machine-${sha256Bytes(machine()).slice(0, 8)}`,
    cpuCount: cpuList.length,
    cpuModels: uniqueModels,
    memoryTotalGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    nodeVersion: process.version,
    pnpmVersion: runCommand(['pnpm', '--version'], { cwd: root }).stdout.trim(),
    expectedNodeVersion: readOptional(join(root, '.node-version'))?.trim() ?? 'missing',
    packageManagerField: readPackageManagerField(root),
    ci: process.env['CI'] === 'true',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    monotonicClock: 'node:process.hrtime.bigint for durations; Date ISO-8601 for records',
    gitCommit: git(root, ['rev-parse', 'HEAD']),
    gitBranch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitDirty: git(root, ['status', '--porcelain']) !== '',
  };
};

const readPackageManagerField = (root: string): string => {
  const raw = readOptional(join(root, 'package.json'));
  if (raw === undefined) return 'missing';
  try {
    const parsed = JSON.parse(raw) as { packageManager?: unknown };
    return typeof parsed.packageManager === 'string' ? parsed.packageManager : 'missing';
  } catch {
    return 'unparseable';
  }
};

const hashOf = (root: string, relative: string): string => {
  const absolute = join(root, relative);
  return existsSync(absolute) ? sha256File(absolute) : 'missing';
};

const safeJson = (raw: string | undefined): unknown => {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const fixtureHashes = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const groupsDir = join(root, 'tests', 'fixtures');
  if (!existsSync(groupsDir)) return out;
  for (const group of readdirSync(groupsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const fixture of readdirSync(join(groupsDir, group.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const manifestPath = join(groupsDir, group.name, fixture.name, 'fixture.json');
      if (!existsSync(manifestPath)) continue;
      const raw = readFileSync(manifestPath, 'utf8');
      try {
        const parsed = JSON.parse(raw) as { fixtureId?: unknown; configHash?: unknown };
        if (typeof parsed.fixtureId === 'string') {
          out[parsed.fixtureId] = `${sha256Bytes(raw)}:${typeof parsed.configHash === 'string' ? parsed.configHash.slice(0, 16) : 'no-config-hash'}`;
        }
      } catch {
        out[`${group.name}/${fixture.name}`] = 'unparseable';
      }
    }
  }
  return out;
};

const measurementsPath = (root: string, taskId: string): string =>
  join(root, 'artifacts', '.local', 'measurements', `${taskId}.json`);

/** The pnpm content-addressable store path, used to keep absolute store paths out of logs. */
const pnpmStorePath = (root: string): string | undefined => {
  try {
    const result = runCommand(['pnpm', 'store', 'path'], { cwd: root });
    const path = result.stdout.trim();
    return result.exitCode === 0 && path.length > 2 ? path : undefined;
  } catch {
    return undefined;
  }
};

const readMeasurements = (root: string, taskId: string): Record<string, unknown> => {
  const raw = readOptional(measurementsPath(root, taskId));
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { error: 'measurements file is not valid JSON' };
  }
};

export interface CaptureResult {
  readonly runDir: RepoPath;
  readonly status: EvidenceStatus;
  readonly failingCommands: readonly string[];
  readonly sanitisationFailures: readonly string[];
}

export const capture = (root: string, taskId: string, outDir: string, keepGoing: boolean): CaptureResult => {
  const plan = CAPTURE_PLANS[taskId];
  if (plan === undefined) {
    throw new Error(
      `No capture plan for ${taskId}. Add one only when that task's required commands are defined by its contract.`,
    );
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  const runId = `${taskId}-${timestamp()}-${shortSha(head)}`;
  const absoluteRunDir = join(resolve(root, outDir), runId);
  const runAlias = sha256Bytes(`${runId}-${machine()}`).slice(0, 8);
  const storePath = pnpmStorePath(root);
  const roots = machineRoots(root, absoluteRunDir, storePath);
  // Every artefact is sanitised; a leftover root is a capture failure, not a warning.
  const sanitisationFailures: string[] = [];
  const clean = (label: string, text: string): string => {
    const sanitised = sanitiseMachineText(text, roots);
    const leaked = [absoluteRunDir, root, homedir(), tmpdir(), ...(storePath === undefined ? [] : [storePath])].filter(
      (path) => path.length > 2 && sanitised.includes(path),
    );
    if (leaked.length > 0) sanitisationFailures.push(`${label} (${String(leaked.length)} machine path(s))`);
    return sanitised;
  };

  writeFileSyncEnsuring(join(absoluteRunDir, 'logs', '.keep'), '');

  const records: CommandRecord[] = [];
  const failing: string[] = [];
  const runStart = new Date().toISOString();

  for (const step of plan.commands) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.env ?? {})) {
      env[key] = value
        .replace('BUNDLE/', `${absoluteRunDir}/`)
        .replace('MEAS/', `${join(root, 'artifacts', '.local', 'measurements')}/`);
    }
    const start = new Date().toISOString();
    const result: RunResult = runCommand(step.argv, {
      cwd: root,
      env,
      timeoutMs: 60 * 60 * 1000,
    });
    const end = new Date().toISOString();

    let stdoutPath: RepoPath | null = null;
    let stderrPath: RepoPath | null = null;
    if (step.buildLog === true) {
      writeFileSyncEnsuring(join(absoluteRunDir, 'build.log'), clean('build.log', `${result.stdout}${result.stderr}`));
    } else {
      stdoutPath = `logs/${step.label}.stdout.log`;
      stderrPath = `logs/${step.label}.stderr.log`;
      writeFileSyncEnsuring(join(absoluteRunDir, stdoutPath), clean(stdoutPath, result.stdout));
      writeFileSyncEnsuring(join(absoluteRunDir, stderrPath), clean(stderrPath, result.stderr));
    }
    records.push({
      label: step.label,
      argv: step.argv,
      workingDirectory: 'REPO_ROOT',
      start,
      end,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutPath: step.buildLog === true ? 'build.log' : stdoutPath,
      stderrPath: step.buildLog === true ? null : stderrPath,
      timeout: result.timedOut ? 'exceeded' : 'none',
      environmentKeys: Object.keys(env).sort(),
    });
    if (result.exitCode !== 0) {
      failing.push(`${step.label} (exit ${String(result.exitCode)})`);
      if (!keepGoing) break;
    }
  }

  const runEnd = new Date().toISOString();

  // Reporters can print absolute paths; sanitise before hashing so the bundle stays portable.
  const junitAbsolute = join(absoluteRunDir, 'junit.xml');
  if (existsSync(junitAbsolute)) {
    writeFileSyncEnsuring(junitAbsolute, clean('junit.xml', readFileSync(junitAbsolute, 'utf8')));
  }

  writeJson(join(absoluteRunDir, 'environment.json'), environmentRecord(root, runAlias));
  writeJson(join(absoluteRunDir, 'commands.json'), {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    runId,
    taskId,
    workingDirectory: 'REPO_ROOT',
    commands: records,
    allSucceeded: failing.length === 0,
  });

  const junitRaw = readOptional(join(absoluteRunDir, 'junit.xml'));
  const counts = junitRaw === undefined ? { tests: 0, failures: 0, errors: 0, skipped: 0, duplicateCaseNames: [] } : parseJunit(junitRaw);
  const suites: SuiteRecord[] = [
    {
      name: 'vitest',
      tests: counts.tests,
      failures: counts.failures,
      errors: counts.errors,
      skipped: counts.skipped,
      quarantined: 0,
      duplicateCaseNames: counts.duplicateCaseNames,
    },
  ];

  const status: EvidenceStatus =
    failing.length === 0 &&
    sanitisationFailures.length === 0 &&
    counts.tests > 0 &&
    counts.failures === 0
      ? 'PASS'
      : 'FAIL';
  writeBundleArtifacts(root, plan, absoluteRunDir, runId, {
    runStart,
    runEnd,
    suites,
    testCounts: { tests: counts.tests, failures: counts.failures, errors: counts.errors, skipped: counts.skipped },
    status,
    measurements: {
      ...readMeasurements(root, taskId),
      capture: {
        commandsRun: records.length,
        failingCommands: failing,
        sanitisationFailures: sanitisationFailures,
        pnpmStoreRecorded: storePath !== undefined,
        totalDurationMs: records.reduce((total, record) => total + record.durationMs, 0),
        keepGoing,
      },
    },
  });

  // Pointer so CI can verify the bundle without parsing the run id out of stdout.
  writeFileSyncEnsuring(join(resolve(root, outDir), `latest-${taskId}.txt`), `${toRepoPath(root, absoluteRunDir)}\n`);

  return { runDir: toRepoPath(root, absoluteRunDir), status, failingCommands: failing, sanitisationFailures };
};

/**
 * Write report.json and checksums.sha256 for a bundle directory. Captured runs call this, and the
 * contract suite uses the same writer so the verifier is tested against the real report shape
 * rather than a hand-written imitation.
 */
export const writeBundleArtifacts = (
  root: string,
  plan: CapturePlan,
  absoluteRunDir: string,
  runId: string,
  input: ReportInput,
): void => {
  writeReport(root, plan, absoluteRunDir, runId, input);
  writeChecksums(absoluteRunDir);
};

export interface ReportInput {
  readonly runStart: string;
  readonly runEnd: string;
  readonly suites: readonly SuiteRecord[];
  readonly testCounts: { tests: number; failures: number; errors: number; skipped: number };
  readonly status: EvidenceStatus;
  readonly measurements: Readonly<Record<string, unknown>>;
}

const writeReport = (root: string, plan: CapturePlan, absoluteRunDir: string, runId: string, input: ReportInput): void => {
  const files: EvidenceFileRef[] = [];
  for (const relative of listFiles(absoluteRunDir)) {
    if (relative === 'report.json' || relative === 'checksums.sha256' || basename(relative) === '.keep') continue;
    const absolute = join(absoluteRunDir, relative);
    files.push({
      path: relative,
      sha256: sha256File(absolute),
      bytes: statSync(absolute).size,
      required: plan.requiredFiles.includes(relative),
    });
  }

  const report: EvidenceReport = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    runId,
    taskId: plan.taskId,
    contractId: CONTRACT_ID,
    contractVersion: CONTRACT_VERSION,
    contractHash: hashOf(root, 'docs/contracts/README.md'),
    baselineSpecId: BASELINE_SPEC_ID,
    baselineSpecHash: hashOf(root, 'docs/specifications/UDG-SPEC-M0-002.md'),
    implementationSha: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    workingTreeDirty: git(root, ['status', '--porcelain']) !== '',
    prerequisiteShas: prerequisiteShas(root),
    dependencyLockHash: hashOf(root, 'pnpm-lock.yaml'),
    configHashes: {
      taskContract: hashOf(root, `docs/contracts/${plan.taskId}.md`),
      tsconfigBase: baseTsconfigHash(root),
      boundaryRuleTable: ruleTableHash(),
      boundaryFixtures: boundaryConfigHash(root),
      envExample: hashOf(root, '.env.example'),
      npmrc: hashOf(root, '.npmrc'),
      ciWorkflow: hashOf(root, '.github/workflows/ci.yml'),
    },
    fixtureHashes: fixtureHashes(root),
    assetHashes: {},
    runStart: input.runStart,
    runEnd: input.runEnd,
    seeds: [],
    profiles: {
      requested: [],
      achieved: [],
      note: 'No network profile applies to a foundation run. Spike runs record LAN, moderate, elevated and poor profiles with achieved RTT and jitter statistics.',
    },
    suites: input.suites,
    testCounts: input.testCounts,
    thresholds: plan.thresholds,
    measured: input.measurements,
    status: input.status,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    notApplicable: [
      { path: 'traces/', reason: 'No gameplay trace exists for a foundation run; no movement, network or asset behaviour is produced.' },
      { path: 'metrics/', reason: 'No numeric sampling is performed by UDG-001; spike runs produce raw CSV samples here.' },
      { path: 'browser/', reason: 'No browser suite exists yet; UDG-004 creates tests/e2e/camera.spec.ts.' },
      { path: 'decisions/', reason: 'No gate decision belongs to a Foundation task; Gates A, B and C remain Not Run.' },
    ],
    sanitisation: {
      removed: ['environment variable dump', 'absolute local paths', 'user name', 'host name', 'git remote URL', 'any credential or token'],
      aliases: { workingDirectory: 'REPO_ROOT', runner: 'runner-<8 hex derived from the run id>', machine: 'machine-<8 hex>' },
    },
  };
  writeJson(join(absoluteRunDir, 'report.json'), report);
};

const prerequisiteShas = (root: string): string[] => {
  const raw = readOptional(join(root, 'docs', 'contracts', 'assignments', 'UDG-001.md'));
  if (raw === undefined) return [];
  const found = /Prerequisite commit:\s*([0-9a-f]{40})/.exec(raw);
  return found?.[1] === undefined ? [] : [found[1]];
};

const writeChecksums = (absoluteRunDir: string): void => {
  const lines = listFiles(absoluteRunDir)
    .filter((relative) => relative !== 'checksums.sha256' && basename(relative) !== '.keep')
    .map((relative) => `${sha256File(join(absoluteRunDir, relative))}  ${relative}`)
    .sort();
  writeFileSyncEnsuring(join(absoluteRunDir, 'checksums.sha256'), `${lines.join('\n')}\n`);
};

export type VerifyCode =
  | 'EVIDENCE-RUN-MISSING'
  | 'EVIDENCE-REPORT-MISSING'
  | 'EVIDENCE-REPORT-UNPARSEABLE'
  | 'EVIDENCE-SCHEMA-FIELD'
  | 'EVIDENCE-STATUS-INVALID'
  | 'EVIDENCE-GATE-NOT-PASS'
  | 'EVIDENCE-FILE-MISSING'
  | 'EVIDENCE-FILE-EMPTY'
  | 'EVIDENCE-FILE-HASH'
  | 'EVIDENCE-CHECKSUM-MISMATCH'
  | 'EVIDENCE-CHECKSUM-INCOMPLETE'
  | 'EVIDENCE-ZERO-TESTS'
  | 'EVIDENCE-SKIP-PRESENT'
  | 'EVIDENCE-FLAKY'
  | 'EVIDENCE-COUNT-MISMATCH'
  | 'EVIDENCE-COMMAND-FAILED'
  | 'EVIDENCE-COMMAND-MISSING'
  | 'EVIDENCE-ENVIRONMENT-FIELD'
  | 'EVIDENCE-SECRET'
  | 'EVIDENCE-MEASUREMENTS-MISSING'
  | 'EVIDENCE-PATH-ESCAPE';

export interface VerifyIssue {
  readonly code: VerifyCode;
  readonly detail: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly issues: readonly VerifyIssue[];
}

const REQUIRED_REPORT_FIELDS: readonly (keyof EvidenceReport)[] = [
  'schemaVersion',
  'runId',
  'taskId',
  'contractId',
  'contractVersion',
  'contractHash',
  'baselineSpecId',
  'baselineSpecHash',
  'implementationSha',
  'prerequisiteShas',
  'dependencyLockHash',
  'configHashes',
  'fixtureHashes',
  'runStart',
  'runEnd',
  'profiles',
  'suites',
  'testCounts',
  'thresholds',
  'measured',
  'status',
  'files',
  'sanitisation',
];

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/** Verify a bundle against the contract rules. Never trusts the recorded status alone. */
export const verify = (root: string, runRelative: string): VerifyResult => {
  const issues: VerifyIssue[] = [];
  const absoluteRunDir = resolve(root, runRelative);
  if (!existsSync(absoluteRunDir) || !statSync(absoluteRunDir).isDirectory()) {
    return { ok: false, issues: [{ code: 'EVIDENCE-RUN-MISSING', detail: `${runRelative} is not a directory` }] };
  }

  const reportRaw = readOptional(join(absoluteRunDir, 'report.json'));
  if (reportRaw === undefined) {
    return { ok: false, issues: [{ code: 'EVIDENCE-REPORT-MISSING', detail: 'report.json is absent' }] };
  }
  let report: EvidenceReport;
  try {
    report = JSON.parse(reportRaw) as EvidenceReport;
  } catch (error) {
    return { ok: false, issues: [{ code: 'EVIDENCE-REPORT-UNPARSEABLE', detail: String(error) }] };
  }

  for (const field of REQUIRED_REPORT_FIELDS) {
    if (report[field] === undefined || report[field] === null || report[field] === '') {
      issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: `${String(field)} is missing or empty` });
    }
  }
  if (!CONTRACT_TASK_IDS.includes(report.taskId as (typeof CONTRACT_TASK_IDS)[number])) {
    issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: `taskId "${report.taskId}" is not a contract task id` });
  }
  if (!['PASS', 'FAIL', 'BLOCKED', 'INVALID'].includes(report.status)) {
    issues.push({ code: 'EVIDENCE-STATUS-INVALID', detail: `status "${report.status}" is not PASS, FAIL, BLOCKED or INVALID` });
  } else if (report.status !== 'PASS') {
    // `verify` is the gate command that CI and the reviewer run, not a neutral audit. A bundle can
    // be perfectly self-consistent and still record a failing run - probe run 42509775271 showed a
    // capture step failing while its own verification step stayed green - so a non-PASS status must
    // refuse here as well, otherwise a red gate could be reported as verified evidence.
    issues.push({
      code: 'EVIDENCE-GATE-NOT-PASS',
      detail:
        `status "${report.status}" is not PASS: the bundle is internally consistent but records a failing gate, `
        + 'so verification cannot report success',
    });
  }
  if (!HEX64.test(report.contractHash)) issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'contractHash is not 64 hex characters' });
  if (!HEX64.test(report.baselineSpecHash)) issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'baselineSpecHash is not 64 hex characters' });
  if (!HEX64.test(report.dependencyLockHash)) issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'dependencyLockHash is not 64 hex characters' });
  if (!HEX40.test(report.implementationSha)) issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'implementationSha is not 40 hex characters' });
  for (const sha of report.prerequisiteShas) {
    if (!HEX40.test(sha)) issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: `prerequisite sha "${sha}" is not 40 hex characters` });
  }
  if (report.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: `schemaVersion ${String(report.schemaVersion)} is not ${String(EVIDENCE_SCHEMA_VERSION)}` });
  }

  // Referenced files must resolve, be non-empty and match the recorded hash.
  for (const ref of report.files) {
    if (ref.path.startsWith('/') || ref.path.includes('..')) {
      issues.push({ code: 'EVIDENCE-PATH-ESCAPE', detail: ref.path });
      continue;
    }
    const absolute = join(absoluteRunDir, ref.path);
    if (!existsSync(absolute)) {
      issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: ref.path });
      continue;
    }
    const size = statSync(absolute).size;
    // An empty stderr stream is the expected result of a successful command, and the logs
    // directory keeps a .keep marker so an all-empty bundle still has a traceable directory.
    const legitimatelyEmpty = /^logs\/[^/]+\.stderr\.log$/.test(ref.path) || basename(ref.path) === '.keep';
    if (size === 0 && !legitimatelyEmpty) issues.push({ code: 'EVIDENCE-FILE-EMPTY', detail: ref.path });
    if (size !== ref.bytes) {
      issues.push({ code: 'EVIDENCE-FILE-HASH', detail: `${ref.path}: recorded ${String(ref.bytes)} bytes, found ${String(size)}` });
    }
    if (sha256File(absolute) !== ref.sha256) {
      issues.push({ code: 'EVIDENCE-FILE-HASH', detail: `${ref.path}: content hash does not match report.json` });
    }
  }

  // Required artefacts for the task's own contract.
  const plan = CAPTURE_PLANS[report.taskId];
  if (plan !== undefined) {
    for (const required of plan.requiredFiles) {
      if (!existsSync(join(absoluteRunDir, required))) {
        issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: `required artefact ${required} is absent` });
      }
    }
  }

  // checksums.sha256 covers every evidence file except itself.
  const checksumsRaw = readOptional(join(absoluteRunDir, 'checksums.sha256'));
  if (checksumsRaw === undefined) {
    issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: 'checksums.sha256 is absent' });
  } else {
    const covered = new Map<string, string>();
    for (const line of checksumsRaw.trim().split('\n')) {
      // sha256sum writes two spaces between the hash and the path.
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) covered.set(match[2], match[1]);
    }
    const present = listFiles(absoluteRunDir).filter((relative) => relative !== 'checksums.sha256' && basename(relative) !== '.keep');
    for (const relative of present) {
      const expected = covered.get(relative);
      if (expected === undefined) {
        issues.push({ code: 'EVIDENCE-CHECKSUM-INCOMPLETE', detail: `${relative} is not covered by checksums.sha256` });
        continue;
      }
      if (sha256File(join(absoluteRunDir, relative)) !== expected) {
        issues.push({ code: 'EVIDENCE-CHECKSUM-MISMATCH', detail: relative });
      }
    }
    for (const relative of covered.keys()) {
      if (!present.includes(relative)) {
        issues.push({ code: 'EVIDENCE-CHECKSUM-INCOMPLETE', detail: `checksums.sha256 lists ${relative}, which is not in the bundle` });
      }
    }
  }

  // Test evidence: non-zero counts, no skips, no reruns, consistent with junit.xml.
  if (report.testCounts.tests === 0) {
    issues.push({ code: 'EVIDENCE-ZERO-TESTS', detail: 'report.json claims zero tests' });
  }
  for (const suite of report.suites) {
    if (suite.tests === 0) issues.push({ code: 'EVIDENCE-ZERO-TESTS', detail: `suite ${suite.name} has zero tests` });
    if (suite.skipped > 0 || suite.quarantined > 0) {
      issues.push({ code: 'EVIDENCE-SKIP-PRESENT', detail: `suite ${suite.name} skipped ${String(suite.skipped)} / quarantined ${String(suite.quarantined)}` });
    }
    if (suite.duplicateCaseNames.length > 0) {
      issues.push({ code: 'EVIDENCE-FLAKY', detail: `repeated case names: ${suite.duplicateCaseNames.join(', ')}` });
    }
  }
  const junitRaw = readOptional(join(absoluteRunDir, 'junit.xml'));
  if (junitRaw === undefined) {
    issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: 'junit.xml is absent' });
  } else {
    const counts = parseJunit(junitRaw);
    if (counts.tests !== report.testCounts.tests || counts.failures !== report.testCounts.failures || counts.skipped !== report.testCounts.skipped) {
      issues.push({
        code: 'EVIDENCE-COUNT-MISMATCH',
        detail: `junit tests=${String(counts.tests)} failures=${String(counts.failures)} skipped=${String(counts.skipped)} vs report tests=${String(report.testCounts.tests)} failures=${String(report.testCounts.failures)} skipped=${String(report.testCounts.skipped)}`,
      });
    }
    if (counts.duplicateCaseNames.length > 0) {
      issues.push({ code: 'EVIDENCE-FLAKY', detail: `junit repeated case names: ${counts.duplicateCaseNames.join(', ')}` });
    }
  }

  // Commands: every recorded command must be accounted for, and PASS needs clean exits.
  const commandsRaw = readOptional(join(absoluteRunDir, 'commands.json'));
  if (commandsRaw === undefined) {
    issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: 'commands.json is absent' });
  } else {
    const parsed = safeJson(commandsRaw);
    if (parsed === undefined) {
      issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'commands.json is not valid JSON' });
    }
    const commands = (asRecord(parsed)['commands'] as CommandRecord[] | undefined) ?? [];
    if (commands.length === 0) issues.push({ code: 'EVIDENCE-COMMAND-MISSING', detail: 'commands.json lists no commands' });
    for (const command of commands) {
      if (command.exitCode !== 0 && report.status === 'PASS') {
        issues.push({ code: 'EVIDENCE-COMMAND-FAILED', detail: `${command.label} exited ${String(command.exitCode)} but status is PASS` });
      }
      for (const path of [command.stdoutPath, command.stderrPath]) {
        if (path !== null && !existsSync(join(absoluteRunDir, path))) {
          issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: `${command.label} references ${path}, which is absent` });
        }
      }
    }
    if (plan !== undefined) {
      const recorded = new Set(commands.map((command) => command.label));
      for (const step of plan.commands) {
        if (!recorded.has(step.label)) {
          issues.push({ code: 'EVIDENCE-COMMAND-MISSING', detail: `${step.label} was never run` });
        }
      }
    }
  }

  const environmentRaw = readOptional(join(absoluteRunDir, 'environment.json'));
  if (environmentRaw === undefined) {
    issues.push({ code: 'EVIDENCE-FILE-MISSING', detail: 'environment.json is absent' });
  } else {
    const environmentParsed = safeJson(environmentRaw);
    if (environmentParsed === undefined) {
      issues.push({ code: 'EVIDENCE-SCHEMA-FIELD', detail: 'environment.json is not valid JSON' });
    }
    const environment = asRecord(environmentParsed);
    for (const field of ['nodeVersion', 'pnpmVersion', 'osPlatform', 'cpuCount', 'runnerAlias', 'workingDirectory', 'gitCommit']) {
      if (environment[field] === undefined || environment[field] === '') {
        issues.push({ code: 'EVIDENCE-ENVIRONMENT-FIELD', detail: `${field} is missing from environment.json` });
      }
    }
    if (environment['workingDirectory'] !== 'REPO_ROOT') {
      issues.push({ code: 'EVIDENCE-ENVIRONMENT-FIELD', detail: 'workingDirectory must be the alias REPO_ROOT, not a local path' });
    }
  }

  if (report.taskId === 'UDG-001' && Object.keys(report.measured).length === 0) {
    issues.push({ code: 'EVIDENCE-MEASUREMENTS-MISSING', detail: 'UDG-001 thresholds require measured values from the contract suite' });
  }

  const scanned = new Set<string>([...report.files.map((ref) => ref.path), ...presentFiles(absoluteRunDir)]);
  const hits = scanForSecrets(absoluteRunDir, [...scanned]);
  for (const hit of hits) {
    issues.push({ code: 'EVIDENCE-SECRET', detail: `${hit.file}:${String(hit.line)} matches ${hit.pattern}` });
  }

  // A run that recorded its own sanitisation failures cannot claim PASS.
  const captureRecord: unknown = report.measured['capture'];
  if (typeof captureRecord === 'object' && captureRecord !== null) {
    const recorded = (captureRecord as { readonly sanitisationFailures?: unknown }).sanitisationFailures;
    if (Array.isArray(recorded) && recorded.length > 0 && report.status === 'PASS') {
      issues.push({
        code: 'EVIDENCE-SECRET',
        detail: `capture recorded ${String(recorded.length)} artefact(s) with unaliased machine paths`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
};

const presentFiles = (absoluteRunDir: string): RepoPath[] =>
  listFiles(absoluteRunDir).filter((relative) => relative !== 'checksums.sha256' && basename(relative) !== '.keep');

const captureMain = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const taskId = requireFlag(flags, 'task', 'usage: evidence.js capture --task <TASK_ID> [--out artifacts]');
  const outDir = flagString(flags, 'out') ?? 'artifacts';
  const result = capture(root, taskId, outDir, flags['keep-going'] === true);
  process.stdout.write(`${result.status} ${result.runDir}\n`);
  if (result.failingCommands.length > 0) {
    process.stderr.write(`failing commands: ${result.failingCommands.join(', ')}\n`);
  }
  if (result.sanitisationFailures.length > 0) {
    process.stderr.write(`unsanitised artefacts: ${result.sanitisationFailures.join(', ')}\n`);
  }
  process.stdout.write(
    `verify with: pnpm evidence:verify -- --run ${result.runDir}\n` +
      `durable copy: copy ${result.runDir} to the owner-reachable evidence store (clarification C-03)\n`,
  );
  return result.status === 'PASS' ? 0 : 1;
};

const verifyMain = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const run = requireFlag(flags, 'run', 'usage: evidence.js verify --run artifacts/RUN_ID [--report <file>]');
  const result = verify(root, run);
  const summary = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    run: run,
    ok: result.ok,
    issueCount: result.issues.length,
    issues: result.issues,
    verifiedAt: new Date().toISOString(),
  };
  const reportPath = flagString(flags, 'report');
  if (reportPath !== undefined) writeJson(resolve(root, reportPath), summary);
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} evidence verify ${run} (${String(result.issues.length)} issue(s))\n`);
  for (const issue of result.issues) {
    process.stderr.write(`${issue.code} ${issue.detail}\n`);
  }
  return result.ok ? 0 : 1;
};

// ---------------------------------------------------------------------------
// Dependency register (docs/integration/dependencies.json)
// ---------------------------------------------------------------------------

interface DependencyEntry {
  readonly name: string;
  readonly declared: string;
  readonly installedVersion: string | null;
  readonly licence: string | null;
  readonly licenceSource: string | null;
  readonly importedBy: readonly string[];
}

interface GithubActionEntry {
  readonly repo: string;
  readonly ref: string;
  readonly pinnedCommit: string;
  readonly pinnedByCommitSha: boolean;
}

export interface DependencyRegister {
  readonly schemaVersion: number;
  readonly generated: Readonly<{ at: string; taskId: string; command: string; commit: string }>;
  readonly runtime: Readonly<{
    node: Readonly<{ version: string; pinnedIn: readonly string[] }>;
    pnpm: Readonly<{ packageManagerField: string; cliVersion: string }>;
    host: Readonly<{ platform: string; arch: string }>;
  }>;
  readonly lockfile: Readonly<{ path: string; sha256: string }>;
  readonly workspaces: readonly { readonly name: string; readonly dir: string; readonly dependencies: Readonly<Record<string, string>> }[];
  readonly packages: readonly DependencyEntry[];
  readonly pendingGameLibraries: readonly { readonly name: string; readonly status: string; readonly ownerTask: string; readonly reason: string }[];
  readonly toolchainNotes: readonly string[];
  readonly ciActions: readonly GithubActionEntry[];
  readonly thirdPartyReferences: readonly { readonly subject: string; readonly source: string; readonly inspectedOn: string }[];
  readonly verification: Readonly<{ excludes: readonly string[]; note: string }>;
  readonly sanitisation: Readonly<{ note: string }>;
}

const PENDING_GAME_LIBRARIES = [
  {
    name: '@colyseus/schema',
    status: 'not-selected',
    ownerTask: 'UDG-002',
    reason: 'Owner clarification C-02: UDG-002 selects and tests the schema dependency against real encode/decode fixtures.',
  },
  {
    name: '@colyseus/core',
    status: 'not-selected',
    ownerTask: 'UDG-003',
    reason: 'Owner clarification C-02: server and fixed-step input integration belongs to UDG-003 and UDG-SPIKE-001.',
  },
  {
    name: '@colyseus/sdk',
    status: 'not-selected',
    ownerTask: 'UDG-SPIKE-001',
    reason: 'Owner clarification C-02: the client SDK and prediction adapter are proven by the Gate A probes.',
  },
  {
    name: '@colyseus/testing',
    status: 'not-selected',
    ownerTask: 'UDG-003',
    reason: 'Optional per docs/integration/colyseus.md; chosen only if the UDG-003 probes need it.',
  },
  {
    name: '@dimforge/rapier3d-compat (or equivalent Rapier package)',
    status: 'not-selected',
    ownerTask: 'UDG-006',
    reason: 'Rapier version and WASM identity are frozen at Gate B with binary hashes.',
  },
  {
    name: 'recast-navigation-js package family',
    status: 'not-selected',
    ownerTask: 'UDG-007',
    reason: 'Recast version and WASM hashes are recorded with the asset pipeline and Gate C evidence.',
  },
  {
    name: '@babylonjs/* and react',
    status: 'not-selected',
    ownerTask: 'UDG-004',
    reason: 'Client rendering and UI dependencies are chosen by the browser client task.',
  },
];

const installedPackageInfo = (
  root: string,
  workspaceDirs: readonly string[],
  name: string,
): { version: string | null; licence: string | null; source: string | null } => {
  const candidates: string[] = [];
  for (const dir of workspaceDirs) {
    candidates.push(join(root, dir === '.' ? '' : dir, 'node_modules', name, 'package.json'));
  }
  candidates.push(join(root, 'node_modules', name, 'package.json'));
  for (const candidate of candidates) {
    const raw = readOptional(candidate);
    if (raw === undefined) continue;
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; license?: unknown; licences?: unknown };
      const licence =
        typeof parsed.license === 'string'
          ? parsed.license
          : Array.isArray(parsed.licences) && typeof parsed.licences[0] === 'string'
            ? (parsed.licences[0] as string)
            : null;
      return {
        version: typeof parsed.version === 'string' ? parsed.version : null,
        licence,
        source: `node_modules/${name}/package.json`,
      };
    } catch {
      continue;
    }
  }
  return { version: null, licence: null, source: null };
};

const parseCiActions = (root: string): GithubActionEntry[] => {
  const raw = readOptional(join(root, '.github', 'workflows', 'ci.yml'));
  if (raw === undefined) return [];
  const entries: GithubActionEntry[] = [];
  for (const match of raw.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s@]+)@([^\s#]+)/gm)) {
    const repo = match[1];
    const reference = match[2];
    if (repo === undefined || reference === undefined) continue;
    entries.push({
      repo,
      ref: reference,
      pinnedCommit: reference,
      pinnedByCommitSha: /^[0-9a-f]{40}$/.test(reference),
    });
  }
  return entries;
};

export const buildDependencyRegister = (root: string, command: string): DependencyRegister => {
  const workspaceManifests = [
    { name: '@udg/workspace (root)', dir: '.', manifest: join(root, 'package.json') },
  ];
  for (const dir of ['packages/protocol', 'packages/config', 'packages/simulation', 'packages/physics', 'packages/navigation', 'apps/server', 'apps/client', 'tools/checks']) {
    const manifest = join(root, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
    workspaceManifests.push({ name: typeof parsed.name === 'string' ? parsed.name : dir, dir, manifest });
  }

  const declaredByPackage = new Map<string, { declared: string; importedBy: Set<string> }>();
  const workspaces: { name: string; dir: string; dependencies: Record<string, string> }[] = [];
  for (const workspace of workspaceManifests) {
    const parsed = JSON.parse(readFileSync(workspace.manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    workspaces.push({ name: workspace.name, dir: workspace.dir, dependencies });
    for (const [name, declared] of Object.entries(dependencies)) {
      const existing = declaredByPackage.get(name);
      if (existing === undefined) {
        declaredByPackage.set(name, { declared, importedBy: new Set([workspace.dir]) });
      } else {
        existing.importedBy.add(workspace.dir);
        if (existing.declared !== declared) existing.declared = `${existing.declared} | ${declared}`;
      }
    }
  }

  const packages: DependencyEntry[] = [...declaredByPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => {
      const info = installedPackageInfo(root, [...entry.importedBy], name);
      return {
        name,
        declared: entry.declared,
        installedVersion: info.version,
        licence: info.licence,
        licenceSource: info.source,
        importedBy: [...entry.importedBy].sort(),
      };
    });

  const typescriptEslintPeer = (() => {
    const raw = readOptional(join(root, 'node_modules', 'typescript-eslint', 'package.json'));
    if (raw === undefined) return undefined;
    try {
      const parsed = JSON.parse(raw) as { peerDependencies?: { typescript?: unknown } };
      const value = parsed.peerDependencies?.typescript;
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  })();

  const nodeVersion = readOptional(join(root, '.node-version'))?.trim() ?? 'missing';
  const rootManifestRaw = readFileSync(join(root, 'package.json'), 'utf8');
  const packageManagerField = (JSON.parse(rootManifestRaw) as { packageManager?: string }).packageManager ?? 'missing';

  const ciActions = parseCiActions(root);
  const typescriptVersion = packages.find((entry) => entry.name === 'typescript')?.installedVersion ?? 'unknown';

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    generated: {
      at: new Date().toISOString(),
      taskId: 'UDG-001',
      command,
      commit: git(root, ['rev-parse', 'HEAD']),
    },
    runtime: {
      node: { version: process.version, pinnedIn: ['.node-version', 'package.json engines', '.github/workflows/ci.yml'] },
      pnpm: { packageManagerField, cliVersion: runCommand(['pnpm', '--version'], { cwd: root }).stdout.trim() },
      host: { platform: platform(), arch: arch() },
    },
    lockfile: { path: 'pnpm-lock.yaml', sha256: hashOf(root, 'pnpm-lock.yaml') },
    workspaces,
    packages,
    pendingGameLibraries: PENDING_GAME_LIBRARIES,
    toolchainNotes: [
      `Node ${nodeVersion} and pnpm 12.18.0 are pinned by owner clarification C-01 and enforced by package.json engines plus .npmrc engine-strict.`,
      `TypeScript is pinned to ${typescriptVersion}. TypeScript 7.x exists on the registry but the installed typescript-eslint release declares peer typescript "${typescriptEslintPeer ?? 'unknown'}", so the newer compiler line is deferred until the lint toolchain supports it. Changing the compiler line is a dependency-pin decision, not a routine edit.`,
      'Game libraries are listed under pendingGameLibraries and are deliberately absent from the lockfile until their owning task can prove them (clarification C-02).',
      'onlyBuiltDependencies in pnpm-workspace.yaml is the allowlist for dependency build scripts; an unlisted build script fails the install.',
      ciActions.length === 0
        ? 'No CI workflow found yet, so no third-party actions are recorded.'
        : `Every actions/* reference in .github/workflows/ci.yml is pinned to an immutable commit sha (${ciActions.map((entry) => entry.repo).join(', ')}).`,
    ],
    ciActions,
    thirdPartyReferences: [
      { subject: 'Node.js LTS index', source: 'https://nodejs.org/dist/index.json', inspectedOn: '2026-11-08' },
      { subject: 'npm registry (package metadata)', source: 'https://registry.npmjs.org/', inspectedOn: '2026-11-08' },
      { subject: 'GitHub git refs API (action commit pins)', source: 'https://api.github.com/repos/{owner}/{repo}/git/ref/tags/{tag}', inspectedOn: '2026-11-08' },
    ],
    verification: {
      excludes: VERIFICATION_EXCLUDES,
      note:
        'pnpm dependencies:verify compares the repository-controlled fields only: engine pins, lockfile hash, ' +
        'workspace dependency tables, direct package versions and licences, deferred library groups and CI action pins. ' +
        'The recording host and the generation timestamp describe one machine, so a Linux arm64 laptop and a ' +
        'GitHub-hosted Linux x64 runner must both verify the same register.',
    },
    sanitisation: {
      note: 'No registry auth tokens, machine paths outside the repository alias, user names or environment dumps are recorded here.',
    },
  };
};

/**
 * Fields that describe the machine that ran pnpm dependencies:record rather than the repository.
 * They are kept for provenance and excluded from the staleness comparison; excluding everything
 * else is what makes the register meaningful on a different host architecture.
 */
const VERIFICATION_EXCLUDES: readonly string[] = ['generated.at', 'generated.commit', 'runtime.host.platform', 'runtime.host.arch'];

const HOST_PLACEHOLDER = 'not-verified-host-provenance';

const withoutVolatile = (register: DependencyRegister): unknown =>
  sha256Canonical({
    ...register,
    generated: { taskId: register.generated.taskId, command: register.generated.command },
    runtime: {
      ...register.runtime,
      host: { platform: HOST_PLACEHOLDER, arch: HOST_PLACEHOLDER },
    },
  });

const dependenciesMain = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const outPath = flagString(flags, 'out') ?? 'docs/integration/dependencies.json';
  const register = buildDependencyRegister(root, 'pnpm dependencies:record');

  if (flags['verify'] === true) {
    const existingRaw = readOptional(resolve(root, outPath));
    if (existingRaw === undefined) {
      process.stderr.write(`${outPath} is missing. Run pnpm dependencies:record.\n`);
      return 1;
    }
    let existing: DependencyRegister;
    try {
      existing = JSON.parse(existingRaw) as DependencyRegister;
    } catch (error) {
      process.stderr.write(`${outPath} is not valid JSON: ${String(error)}\n`);
      return 1;
    }
    if (withoutVolatile(existing) !== withoutVolatile(register)) {
      process.stderr.write(
        `${outPath} is stale: the installed dependency graph, engine pins or CI actions differ from the recorded register.\nRun pnpm dependencies:record and commit the result.\n`,
      );
      return 1;
    }
    process.stdout.write(`${outPath} matches the installed dependency graph\n`);
    return 0;
  }

  writeJson(resolve(root, outPath), register);
  process.stdout.write(
    `wrote ${outPath}: ${String(register.packages.length)} declared package(s), ${String(register.pendingGameLibraries.length)} deferred library group(s)\n`,
  );
  const unpinned = register.ciActions.filter((entry) => !entry.pinnedByCommitSha);
  if (unpinned.length > 0) {
    process.stderr.write(`CI actions are not pinned by commit sha: ${unpinned.map((entry) => entry.repo).join(', ')}\n`);
    return 1;
  }
  return 0;
};

/**
 * Contract checksum manifest (docs/contracts/repository.md section 5).
 *
 * The manifest pins the sha256 of every tracked planning document so an evidence bundle can be tied
 * to one contract edition. Regeneration lives here instead of in an ad-hoc script so the owner can
 * reproduce the committed manifest with one command and see exactly which documents moved.
 */
export const DEFAULT_MANIFEST_EXCLUSIONS: readonly string[] = [
  'docs/contracts/checksums.json',
  'docs/contracts/assignments/',
  'docs/integration/dependencies.json',
];

export interface ChecksumManifest {
  readonly algorithm: 'sha256';
  readonly excluded: readonly string[];
  readonly files: Readonly<Record<string, string>>;
}

/** Planning documents are docs/**, every AGENTS.md and the root README. */
const isPlanningDocument = (relative: string): boolean =>
  relative.startsWith('docs/') || relative === 'README.md' || relative === 'AGENTS.md' || relative.endsWith('/AGENTS.md');

const isExcluded = (relative: string, exclusions: readonly string[]): boolean =>
  exclusions.some((pattern) => relative === pattern || relative.startsWith(pattern));

export const buildChecksumManifest = (root: string, previous: ChecksumManifest | undefined): ChecksumManifest => {
  const excluded = previous?.excluded ?? DEFAULT_MANIFEST_EXCLUSIONS;
  const tracked = git(root, ['-c', 'core.quotepath=false', 'ls-files', '-z'])
    .split('\0')
    .filter((entry) => entry.length > 0)
    .filter((entry) => isPlanningDocument(entry) && !isExcluded(entry, excluded))
    .filter((entry) => existsSync(join(root, entry)))
    .sort();

  const files: Record<string, string> = {};
  for (const relative of tracked) files[relative] = sha256File(join(root, relative));

  return { algorithm: 'sha256', excluded, files };
};

export interface ChecksumResult {
  readonly path: RepoPath;
  readonly tracked: number;
  readonly drifted: readonly string[];
  readonly written: boolean;
}

export const updateContractChecksums = (root: string, write: boolean): ChecksumResult => {
  const path = 'docs/contracts/checksums.json' as RepoPath;
  const absolute = join(root, path);
  const previous = existsSync(absolute) ? (JSON.parse(readFileSync(absolute, 'utf8')) as ChecksumManifest) : undefined;
  const next = buildChecksumManifest(root, previous);

  const drifted: string[] = [];
  for (const [relative, hash] of Object.entries(next.files)) {
    const before = previous?.files[relative];
    if (before === undefined) drifted.push(`${relative}: new`);
    else if (before !== hash) drifted.push(`${relative}: hash changed`);
  }
  for (const relative of Object.keys(previous?.files ?? {})) {
    if (next.files[relative] === undefined) drifted.push(`${relative}: removed`);
  }

  if (write && drifted.length > 0) writeJson(absolute, next);
  return { path, tracked: Object.keys(next.files).length, drifted, written: write && drifted.length > 0 };
};

/**
 * Committed evidence summary (owner clarification C-03).
 *
 * The raw bundle lives in owner-reachable durable storage; the repository keeps a sanitised,
 * machine-readable summary with the integrity hashes so a reviewer can confirm that the retained
 * bundle is the one this task produced. Secrets and private paths abort the write.
 */
export interface EvidenceSummary {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly runId: string;
  readonly generatedAt: string;
  readonly generatorCommand: string;
  readonly durableStorage: { readonly location: string; readonly note: string };
  readonly verification: { readonly command: string; readonly ok: boolean; readonly issueCount: number };
  readonly status: EvidenceStatus;
  readonly implementationSha: string;
  readonly branch: string;
  readonly workingTreeDirty: boolean;
  readonly prerequisiteShas: readonly string[];
  readonly contractHash: string;
  readonly baselineSpecHash: string;
  readonly dependencyLockHash: string;
  readonly configHashes: Readonly<Record<string, string>>;
  readonly fixtureHashes: Readonly<Record<string, string>>;
  readonly testCounts: { readonly tests: number; readonly failures: number; readonly errors: number; readonly skipped: number };
  readonly suites: readonly SuiteRecord[];
  readonly commands: readonly { readonly label: string; readonly exitCode: number; readonly durationMs: number }[];
  readonly measured: Readonly<Record<string, unknown>>;
  readonly ci: { readonly status: string; readonly note: string; readonly url?: string };
  readonly artifacts: readonly { readonly path: RepoPath; readonly sha256: string; readonly bytes: number }[];
}

export const buildEvidenceSummary = (
  root: string,
  absoluteRunDir: string,
  durableLocation: string,
  ci: { readonly status: string; readonly url?: string } = { status: 'pending-owner-run' },
): { readonly summary: EvidenceSummary; readonly issueCount: number } => {
  const report = JSON.parse(readFileSync(join(absoluteRunDir, 'report.json'), 'utf8')) as EvidenceReport;
  const commands = JSON.parse(readFileSync(join(absoluteRunDir, 'commands.json'), 'utf8')) as {
    readonly commands: readonly { readonly label: string; readonly exitCode: number; readonly durationMs: number }[];
  };
  const verification = verify(root, absoluteRunDir);
  const runId = basename(absoluteRunDir);

  const artifacts = listFiles(absoluteRunDir)
    .filter((relative) => basename(relative) !== '.keep')
    .map((relative) => ({
      path: relative,
      sha256: sha256File(join(absoluteRunDir, relative)),
      bytes: statSync(join(absoluteRunDir, relative)).size,
    }));

  return {
    issueCount: verification.issues.length,
    summary: {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      taskId: report.taskId,
      runId: report.runId,
      generatedAt: new Date().toISOString(),
      generatorCommand: `pnpm evidence:summary -- --run <bundle> --out <file> (bundle ${runId})`,
      durableStorage: {
        location: durableLocation,
        note:
          'Raw bundle retained outside Git per clarification C-03. The hashes below identify the retained bytes; ' +
          'a mismatch means the stored bundle is not the run this summary describes.',
      },
      verification: {
        command: `pnpm evidence:verify -- --run <bundle>`,
        ok: verification.ok,
        issueCount: verification.issues.length,
      },
      status: report.status,
      implementationSha: report.implementationSha,
      branch: report.branch,
      workingTreeDirty: report.workingTreeDirty,
      prerequisiteShas: report.prerequisiteShas,
      contractHash: report.contractHash,
      baselineSpecHash: report.baselineSpecHash,
      dependencyLockHash: report.dependencyLockHash,
      configHashes: report.configHashes,
      fixtureHashes: report.fixtureHashes,
      testCounts: report.testCounts,
      suites: report.suites,
      commands: commands.commands.map((record) => ({
        label: record.label,
        exitCode: record.exitCode,
        durationMs: record.durationMs,
      })),
      measured: report.measured,
      ci: {
        status: ci.status,
        ...(ci.url === undefined ? {} : { url: ci.url }),
        note:
          ci.url === undefined
            ? 'Clarification C-05: UDG-001 stays In Review until .github/workflows/ci.yml runs green on the pushed commit; CI reproduction is not claimed by this summary.'
            : 'Workflow ci on the pushed commit, identified by the url field. UDG-001 still stays In Review until the reviewer accepts the work (clarification C-05).',
      },
      artifacts,
    },
  };
};

const summaryMain = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const run = requireFlag(flags, 'run', 'usage: evidence.js summary --run <bundle> [--out <file>] [--storage <location>] [--ci-status <s>] [--ci-url <u>]');
  const out = flagString(flags, 'out');
  const absoluteRunDir = resolve(root, run);
  const ciUrl = flagString(flags, 'ci-url');
  const { summary, issueCount } = buildEvidenceSummary(root, absoluteRunDir, flagString(flags, 'storage') ?? absoluteRunDir, {
    status: flagString(flags, 'ci-status') ?? 'pending-owner-run',
    ...(ciUrl === undefined ? {} : { url: ciUrl }),
  });
  const text = `${JSON.stringify(summary, null, 2)}\n`;

  // A summary is a completion claim, so a bundle that does not verify is never written out at all:
  // the refusal is the output, and the exit code is non-zero whatever else happens.
  if (!summary.verification.ok) {
    process.stderr.write(
      `refused to produce a summary for ${run}: verification reported ${String(issueCount)} issue(s), `
        + `status ${summary.status}\n` // e.g. EVIDENCE-GATE-NOT-PASS for a bundle that records a failing run
        + 'A summary is only written for a bundle that verifies as PASS.\n',
    );
    return 1;
  }

  if (out !== undefined) {
    const absoluteOut = resolve(root, out);
    writeFileSyncEnsuring(absoluteOut, text);
    const hits = scanForSecrets(dirname(absoluteOut), [basename(absoluteOut) as RepoPath]);
    if (hits.length > 0) {
      rmSync(absoluteOut, { force: true });
      process.stderr.write(
        `refused to write ${out}: ${hits.map((hit) => `${hit.pattern} at line ${String(hit.line)}`).join(', ')}\n` +
          'A summary containing credentials or private paths is never committed.\n',
      );
      return 1;
    }
    process.stdout.write(
      `wrote ${out}: ${String(summary.artifacts.length)} artefact(s), verification PASS `
        + `(0 issue(s)), status ${summary.status}\n`,
    );
    return 0;
  }

  process.stdout.write(text);
  return 0;
};

const main = (): number => {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const mode = positionals[0];
  if (mode === 'capture') return captureMain(flags);
  if (mode === 'verify') return verifyMain(flags);
  if (mode === 'dependencies') return dependenciesMain(flags);
  if (mode === 'summary') return summaryMain(flags);
  if (mode === 'checksums') {
    const write = flags['write'] === true;
    const result = updateContractChecksums(process.cwd(), write);
    process.stdout.write(
      `${result.written ? 'rewrote' : result.drifted.length === 0 ? 'in sync' : 'drift detected'}: ${result.path} `
        + `(${String(result.tracked)} file(s), ${String(result.drifted.length)} change(s))\n`,
    );
    for (const line of result.drifted) process.stdout.write(`  ${line}\n`);
    return write || result.drifted.length === 0 ? 0 : 1;
  }
  process.stderr.write(
    'usage:\n' +
      '  evidence.js capture   --task <TASK_ID> [--out artifacts] [--keep-going]\n' +
      '  evidence.js verify    --run artifacts/RUN_ID [--report <file>]\n' +
      '  evidence.js dependencies [--out docs/integration/dependencies.json] [--verify]\n' +
      '  evidence.js summary   --run <bundle> [--out <file>] [--storage <location>] [--ci-status <s>] [--ci-url <u>]\n' +
      '  evidence.js checksums [--write]\n',
  );
  return 2;
};

if (isMainModule(import.meta.url)) {
  process.exit(main());
}

