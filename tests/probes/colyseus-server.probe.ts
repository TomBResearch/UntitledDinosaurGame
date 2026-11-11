/**
 * UDG-003 Phase 0 probe entry point.
 *
 * This module owns *how* a probe is executed, never *what* a probe claims. It emits the probe
 * project, runs each emitted probe module in its own process, and returns the recorded result file
 * together with the command and exit status that produced it, so a reviewer can re-run any single
 * probe by hand.
 *
 * It imports node builtins only. The third-party surface lives in `apps/server/probes/**`, which is
 * the workspace that declares the dependencies, so this file cannot accidentally become a place
 * where an unproven API is used.
 *
 * Two commands are deliberately separate:
 *
 * - `emit` runs `tsc --noCheck`, which writes JavaScript without consulting declarations. It is the
 *   only way to obtain runnable probes while blocker PH0-B1 (third-party declarations do not
 *   typecheck) is open, and it says so on the command line rather than in a config file.
 * - `typecheck` runs the same project with `--noEmit` and full checking. That command currently
 *   fails; the failure is the Phase 0 result, and the UDG-003 suite asserts its exact inventory
 *   instead of waiving it.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The probes Phase 0 was assigned, plus PR-13 and PR-15.
 *
 * Neither extra probe is part of the assigned Phase 0 set. **PR-13** is the overflow/acknowledgement
 * remedy investigation the owner authorised on 2026-11-09. **PR-15** is the input-identity and
 * ack/state-pairing feasibility probe the owner authorised for the D-7 decision in ADR-P-0003. Both run
 * against the same pins and are reported in the same index so one artefact carries all of them, and
 * neither changes any Phase 0 verdict. **PR-14 is deliberately absent: that identifier is reserved** for
 * the Gate A real-state probe specified in ADR-P-0003 §11, which must not be attempted until the owner
 * approves the policy it depends on.
 */
export const PROBE_IDS = ['PR-0', 'PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12', 'PR-13', 'PR-15'] as const;

export type ProbeId = (typeof PROBE_IDS)[number];

/** Emitted file name per probe id, relative to `apps/server/probes/dist/probes/`. */
export const PROBE_FILES: Readonly<Record<ProbeId, string>> = {
  'PR-0': 'pr0-compile.probe.js',
  'PR-1': 'pr1-graph.probe.js',
  'PR-2': 'pr2-fixed-step.probe.js',
  'PR-3': 'pr3-input-schema.probe.js',
  'PR-8': 'pr8-ack.probe.js',
  'PR-12': 'pr12-epoch.probe.js',
  'PR-13': 'pr13-overflow-policy.probe.js',
  'PR-15': 'pr15-input-identity.probe.js',
};

export const PROBE_SUBJECTS: Readonly<Record<ProbeId, string>> = {
  'PR-0': 'the pinned stack compiles under the repository compiler policy',
  'PR-1': 'the resolved dependency graph and a single schema runtime',
  'PR-2': 'the public fixed-step facility at the advertised dt',
  'PR-3': 'DirectInputSchema as the room input declaration, five fields preserved',
  'PR-8': 'what the acknowledgement tracks: received, consumed or applied',
  'PR-12': 'epoch renewal lifecycle in the public API',
  'PR-13': 'overflow postures: can a supported API prevent unrepresented retirement?',
  'PR-15': 'input identity, gap visibility, client observability and ack/state pairing',
};

/** One line of compiler output, resolved to an absolute path and classified by origin. */
export interface ProbeDiagnostic {
  readonly file: string;
  readonly relativeFile: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
  readonly insideRepository: boolean;
}

export interface CommandResult {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CheckRecord {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ProbeResultFile {
  readonly probeId: string;
  readonly subject: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Which invocation wrote this file. Absent only on bytes produced before attribution existed. */
  readonly invocationId?: string;
  readonly ok: boolean;
  readonly verdict?: 'pass' | 'fail' | 'blocked';
  readonly blockedReason?: string;
  readonly checks: readonly CheckRecord[];
  readonly observations: Readonly<Record<string, unknown>>;
  readonly limitations: readonly string[];
}

export interface ProbeRecord {
  readonly id: ProbeId;
  readonly subject: string;
  readonly command: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly resultPath: string;
  /** The invocation this record's bytes came from, read back from the file the probe wrote. */
  readonly invocationId: string | undefined;
  readonly result: ProbeResultFile | undefined;
  readonly failureDetail: string | undefined;
}

/**
 * What Phase 0 as a whole establishes about the pinned stack.
 *
 * Kept separate from the probe outcomes on purpose: five probes can pass while the stack remains
 * unproven, and a reader must not have to infer that from context.
 */
export interface CompatibilityVerdict {
  readonly stackCompatibility: 'not-established' | 'established';
  readonly pr0: 'pass' | 'blocked' | 'fail' | 'missing';
  /** ADR-0002: declaration checking is excepted in exactly these projects, and in no others. */
  readonly compilerPolicy: {
    readonly exception: string;
    readonly approvedProjects: readonly string[];
    readonly everythingElse: string;
  };
  /** The accepted gate: first-party code checked against the pinned declarations. */
  readonly acceptedGate: {
    readonly command: string;
    readonly exitCode: number;
    readonly diagnostics: { readonly total: number; readonly inRepositoryCode: number; readonly inThirdPartyDeclarations: number };
    readonly claim: string;
    readonly notClaimed: readonly string[];
  };
  /** The retained full check, which still reports the vendor declaration defects. */
  readonly fullDeclarationCheck: {
    readonly command: string;
    readonly exitCode: number;
    readonly totalDiagnostics: number;
    readonly inventoryEntries: number;
    readonly pinnedInventory: string;
  };
  /** UDG's own emitted declarations, checked strictly and without the server/SDK stack. */
  readonly firstPartyDeclarations: { readonly command: string; readonly exitCode: number; readonly purpose: string };
  readonly acceptedBuildPath: string;
  readonly diagnosticEmission: string;
  readonly probes: readonly { readonly id: ProbeId; readonly verdict: string; readonly ok: boolean }[];
  readonly reading: string;
}

/** One declaration-error class, normalised so a peer-hash directory change cannot masquerade as a new defect. */
export interface DeclarationInventoryEntry {
  readonly origin: string;
  readonly code: string;
  readonly count: number;
  readonly message: string;
}

export interface ProbeRun {
  readonly emit: CommandResult;
  readonly compatibility: CompatibilityVerdict;
  readonly typecheck: CommandResult;
  readonly diagnostics: readonly ProbeDiagnostic[];
  readonly fullCheck: CommandResult;
  readonly fullDiagnostics: readonly ProbeDiagnostic[];
  readonly declarations: CommandResult;
  readonly declarationInventory: readonly DeclarationInventoryEntry[];
  readonly repositoryDiagnostics: readonly ProbeDiagnostic[];
  readonly thirdPartyDiagnostics: readonly ProbeDiagnostic[];
  readonly probes: readonly ProbeRecord[];
}

const PROBE_TIMEOUT_MS = 420_000;

const serverDirectory = (root: string): string => join(root, 'apps', 'server');

/** The pinned compiler, resolved from the workspace that declares it. */
const compilerPath = (root: string): string => {
  const requireFromServer = createRequire(join(serverDirectory(root), 'index.js'));
  try {
    return requireFromServer.resolve('typescript/bin/tsc');
  } catch {
    return createRequire(join(root, 'index.js')).resolve('typescript/bin/tsc');
  }
};

const run = (
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
): CommandResult => {
  const spawned = spawnSync(argv[0] ?? '', argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
  const stdout = spawned.stdout ?? '';
  const stderr = spawned.stderr ?? '';
  return {
    command: argv.join(' '),
    cwd,
    exitCode: spawned.status ?? (spawned.error !== undefined ? -1 : 0),
    stdout,
    stderr,
    timedOut: spawned.error !== undefined && (spawned.signal !== undefined || String(spawned.error.message).includes('timed out')),
  };
};

/**
 * Parse `file(line,column): error TSxxxx: message` output.
 *
 * Continuation lines (the indented elaborations TypeScript prints under a diagnostic) are attached
 * to the diagnostic above them, because the inventory the UDG-003 suite pins is per diagnostic, not
 * per printed line.
 */
export function parseDiagnostics(output: string, cwd: string, root: string): readonly ProbeDiagnostic[] {
  const parsed: ProbeDiagnostic[] = [];
  for (const rawLine of output.split('\n')) {
    const match = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) (?<code>TS\d+): (?<message>.*)$/.exec(rawLine);
    if (match?.groups === undefined) continue;
    const file = resolve(cwd, match.groups['file'] ?? '');
    parsed.push({
      file,
      relativeFile: isAbsolute(file) ? relative(root, file) : file,
      line: Number(match.groups['line'] ?? '0'),
      column: Number(match.groups['column'] ?? '0'),
      code: match.groups['code'] ?? '',
      message: match.groups['message'] ?? '',
      insideRepository: !file.includes(`${sep}node_modules${sep}`) && !relative(root, file).startsWith('..'),
    });
  }
  return parsed;
}

/** Emit the probe project without consulting third-party declarations. */
export const emitProbes = (root: string): CommandResult =>
  run([process.execPath, compilerPath(root), '-p', 'tsconfig.probes.json', '--noCheck'], serverDirectory(root), PROBE_TIMEOUT_MS);

/**
 * The accepted compiler gate. Since ADR-0002 the two `apps/server` projects set `skipLibCheck: true`, so this
 * checks first-party code and every application call against the pinned declarations while no longer checking
 * inside those declarations. It is a weaker claim than the pre-exception one and PR-0 labels it as such.
 */
export const typecheckProbes = (root: string): CommandResult =>
  run([process.execPath, compilerPath(root), '-p', 'tsconfig.probes.json', '--noEmit'], serverDirectory(root), PROBE_TIMEOUT_MS);

/**
 * The retained full declaration check (ADR-0002 condition 4).
 *
 * Same project, `skipLibCheck: false`, so the vendor defects keep being produced even though the accepted gate no
 * longer sees them. The output is inventoried and PR-0 compares it against
 * `docs/integration/colyseus-declaration-inventory.json`, which makes a new vendor diagnostic a review event.
 */
export const fullCheckProbes = (root: string): CommandResult =>
  run(
    [process.execPath, compilerPath(root), '-p', 'tsconfig.probes.json', '--noEmit', '--skipLibCheck', 'false'],
    serverDirectory(root),
    PROBE_TIMEOUT_MS,
  );

/** Strict check of UDG-owned emitted declarations, which never imports the server or SDK stack (ADR-0002 condition 5). */
export const checkFirstPartyDeclarations = (root: string): CommandResult =>
  run([process.execPath, compilerPath(root), '-p', 'tsconfig.declarations.json', '--noEmit'], root, PROBE_TIMEOUT_MS);

/**
 * `package@version::path-in-package` for a declaration file.
 *
 * The pnpm store directory carries a peer-dependency suffix that changes whenever an unrelated pin moves, so the
 * suffix is dropped: an inventory diff then means a real change in the vendor type surface, not a reshuffle of
 * store paths.
 */
export function declarationOrigin(relativeFile: string): string {
  const store = /node_modules\/\.pnpm\/([^/]+)\/node_modules\/(.+)$/.exec(relativeFile);
  if (store?.[1] !== undefined && store[2] !== undefined) {
    return `${store[1].split('_')[0]!.replace(/\+/g, '/')}::${store[2]}`;
  }
  const index = relativeFile.lastIndexOf('node_modules/');
  return index === -1 ? `repository::${relativeFile}` : `unpacked::${relativeFile.slice(index + 'node_modules/'.length)}`;
}

/** Group parsed diagnostics into the inventory that is compared against the pinned document. */
export function buildDeclarationInventory(diagnostics: readonly ProbeDiagnostic[]): readonly DeclarationInventoryEntry[] {
  const grouped = new Map<string, DeclarationInventoryEntry>();
  for (const diagnostic of diagnostics) {
    const origin = declarationOrigin(diagnostic.relativeFile);
    const key = `${origin}|${diagnostic.code}`;
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { origin, code: diagnostic.code, count: 1, message: diagnostic.message });
    } else {
      grouped.set(key, { ...existing, count: existing.count + 1 });
    }
  }
  return [...grouped.values()].sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.code.localeCompare(b.code),
  );
}

/**
 * One probe run inside one process, identified so its bytes can never be confused with another's.
 *
 * The workflow runs the probe suite more than once per job — the contract suite runs it, and evidence
 * capture runs `pnpm test` again — and until now both wrote the same files, so a passing invocation could
 * overwrite a failing one. CI run 43053089415 published `PR-15 pass` for a run whose test step had failed.
 * Every invocation now gets its own directory and identifier, the top level keeps a copy of the latest
 * view for readers, and `probe-invocations.json` is an append-only ledger that retains every invocation
 * in the run, including the failures.
 */
export interface ProbeInvocationRecord {
  readonly invocationId: string;
  readonly requestedId: string;
  readonly purpose: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly allPass: boolean;
  readonly failedProbes: readonly string[];
  /** Directory holding this invocation's own bytes, relative to the repository root. */
  readonly directory: string;
  readonly indexFile: string;
}

export interface ProbeInvocationLedger {
  readonly schemaVersion: 1;
  readonly invocations: readonly ProbeInvocationRecord[];
}

export const PROBE_LEDGER_FILE = 'probe-invocations.json';

const resultPathFor = (outDir: string, id: ProbeId): string => join(outDir, `${id.replace('/', '-')}.probe-result.json`);

/** The ledger for a probe output directory, or an empty one. A malformed ledger is treated as absent. */
export function readProbeLedger(outDir: string): ProbeInvocationLedger {
  const raw = readOptional(join(outDir, PROBE_LEDGER_FILE));
  if (raw === undefined) return { schemaVersion: 1, invocations: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ProbeInvocationLedger>;
    const invocations = Array.isArray(parsed.invocations) ? parsed.invocations.filter(isInvocationRecord) : [];
    return { schemaVersion: 1, invocations };
  } catch {
    return { schemaVersion: 1, invocations: [] };
  }
}

function isInvocationRecord(value: unknown): value is ProbeInvocationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['invocationId'] === 'string'
    && typeof record['directory'] === 'string'
    && typeof record['allPass'] === 'boolean';
}

/**
 * Append one invocation to the ledger, replacing only an entry with the identical identifier.
 *
 * Earlier invocations are never removed: a later passing run must not be able to delete the evidence that
 * an earlier one failed.
 */
export function recordProbeInvocation(outDir: string, record: ProbeInvocationRecord): ProbeInvocationLedger {
  const ledger = readProbeLedger(outDir);
  const invocations = ledger.invocations.filter((entry) => entry.invocationId !== record.invocationId);
  invocations.push(record);
  const next: ProbeInvocationLedger = { schemaVersion: 1, invocations };
  writeJson(join(outDir, PROBE_LEDGER_FILE), next);
  return next;
}

/** A unique identifier for this invocation, derived from the requested one. */
export function nextInvocationId(existing: readonly ProbeInvocationRecord[], requested: string): string {
  const taken = new Set(existing.map((entry) => entry.invocationId));
  if (!taken.has(requested)) return requested;
  let suffix = 2;
  while (taken.has(`${requested}-${String(suffix)}`)) suffix += 1;
  return `${requested}-${String(suffix)}`;
}

const readOptional = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;

/** Reports a probe may be handed, because no probe can see the exit status of the command that built it. */
export interface ProbeReports {
  readonly typecheck?: string;
  readonly declaration?: string;
}

/** Run one emitted probe in its own process and read back the result file it wrote. */
export function runProbe(root: string, outDir: string, id: ProbeId, reports?: ProbeReports, invocationId?: string): ProbeRecord {
  const emitted = join(serverDirectory(root), 'probes', 'dist', 'probes', PROBE_FILES[id]);
  const out = resultPathFor(outDir, id);
  mkdirSync(outDir, { recursive: true });
  if (existsSync(out)) rmSync(out);

  const argv = [process.execPath, emitted, '--out', out];
  if (reports?.typecheck !== undefined) argv.push('--typecheck-report', reports.typecheck);
  if (reports?.declaration !== undefined) argv.push('--declaration-report', reports.declaration);
  if (invocationId !== undefined) argv.push('--invocation', invocationId);
  const executed = run(argv, serverDirectory(root), PROBE_TIMEOUT_MS);
  let result: ProbeResultFile | undefined;
  let failureDetail: string | undefined;
  if (existsSync(out)) {
    try {
      result = JSON.parse(readFileSync(out, 'utf8')) as ProbeResultFile;
    } catch (error) {
      failureDetail = `result file is not readable JSON: ${String(error)}`;
    }
  } else {
    failureDetail = executed.stderr.trim().slice(0, 800) || 'the probe wrote no result file';
  }
  if (executed.timedOut) failureDetail = `timed out after ${String(PROBE_TIMEOUT_MS)} ms; ${failureDetail ?? ''}`.trim();

  return {
    id,
    subject: PROBE_SUBJECTS[id],
    command: [
      process.execPath,
      relative(root, emitted),
      '--out',
      relative(root, out),
      ...(reports?.typecheck === undefined ? [] : ['--typecheck-report', relative(root, reports.typecheck)]),
      ...(reports?.declaration === undefined ? [] : ['--declaration-report', relative(root, reports.declaration)]),
    ].join(' '),
    exitCode: executed.exitCode,
    timedOut: executed.timedOut,
    resultPath: out,
    invocationId: result?.invocationId,
    result,
    failureDetail,
  };
}

/** Options for one probe run. Both fields exist so the caller can say who is asking. */
export interface ProbeRunOptions {
  /** Identifier for this invocation. Defaults to `UDG_PROBE_INVOCATION`, then to a process-stamped id. */
  readonly invocationId?: string;
  /** Who ran it — `contract-suite`, `ci-test-step`, `evidence-capture`. Recorded, never inferred. */
  readonly purpose?: string;
}

/** Emit, typecheck and run every assigned probe. Nothing here judges the outcome. */
export function runColyseusProbes(root: string, outDir: string, options: ProbeRunOptions = {}): ProbeRun {
  // Each probe runs with apps/server as its working directory, so a relative output directory would
  // mean two different places depending on who asked. Anchor it once, here.
  outDir = resolve(root, outDir);
  mkdirSync(outDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const purpose = options.purpose ?? 'unspecified';
  const requestedInvocation = options.invocationId
    ?? process.env['UDG_PROBE_INVOCATION']
    ?? `inv-${startedAt.replace(/[:.]/g, '-')}-${String(process.pid)}`;
  const ledgerBefore = readProbeLedger(outDir);
  const invocationId = nextInvocationId(ledgerBefore.invocations, requestedInvocation);
  // The invocation's own bytes live here and are never overwritten by a later invocation. The top level
  // of outDir holds a copy of the most recent view, because that is the path every existing reader names.
  const invocationDir = join(outDir, 'invocations', invocationId);
  mkdirSync(invocationDir, { recursive: true });

  const emit = emitProbes(root);

  // The accepted compiler gate (ADR-0002): first-party code checked against the pinned declarations.
  const typecheck = typecheckProbes(root);
  const diagnostics = parseDiagnostics(`${typecheck.stdout}\n${typecheck.stderr}`, serverDirectory(root), root);
  writeJson(join(invocationDir, 'probe-project-typecheck.json'), {
    command: typecheck.command,
    cwd: relative(root, typecheck.cwd),
    exitCode: typecheck.exitCode,
    policy: 'apps/server/tsconfig.probes.json as accepted, including the ADR-0002 declaration-checking exception',
    claim: 'first-party probe code typechecks against the pinned declarations under the documented ADR-0002 exception',
    diagnostics,
    rawOutput: `${typecheck.stdout}${typecheck.stderr}`.slice(0, 200_000),
  });

  // The retained full check: the vendor declaration defects are still produced, inventoried and compared.
  const fullCheck = fullCheckProbes(root);
  const fullDiagnostics = parseDiagnostics(`${fullCheck.stdout}\n${fullCheck.stderr}`, serverDirectory(root), root);
  const declarationInventory = buildDeclarationInventory(fullDiagnostics);
  const inRepositoryCode = fullDiagnostics.filter((diagnostic) => diagnostic.insideRepository).length;
  writeJson(join(invocationDir, 'declaration-inventory.json'), {
    schemaVersion: 1,
    command: fullCheck.command,
    exitCode: fullCheck.exitCode,
    pinnedInventory: 'docs/integration/colyseus-declaration-inventory.json',
    adr: 'ADR-0002',
    totalDiagnostics: fullDiagnostics.length,
    inRepositoryCode,
    inThirdPartyDeclarations: fullDiagnostics.length - inRepositoryCode,
    entries: declarationInventory,
    rawOutput: `${fullCheck.stdout}${fullCheck.stderr}`.slice(0, 200_000),
  });

  // UDG's own emitted declarations, checked strictly and without the server/SDK stack.
  const declarations = checkFirstPartyDeclarations(root);
  const declarationDiagnostics = parseDiagnostics(`${declarations.stdout}\n${declarations.stderr}`, root, root);
  writeJson(join(invocationDir, 'first-party-declarations.json'), {
    schemaVersion: 1,
    command: declarations.command,
    exitCode: declarations.exitCode,
    policy: 'skipLibCheck: false in tsconfig.declarations.json; no @colyseus/core, @colyseus/sdk or @colyseus/ws-transport',
    purpose: 'a mistake in UDG-owned emitted declarations must stay a build failure despite the server exception',
    diagnostics: declarationDiagnostics,
    rawOutput: `${declarations.stdout}${declarations.stderr}`.slice(0, 200_000),
  });

  const probes = PROBE_IDS.map((id) =>
    runProbe(root, invocationDir, id, {
      typecheck: join(invocationDir, 'probe-project-typecheck.json'),
      declaration: join(invocationDir, 'declaration-inventory.json'),
    }, invocationId),
  );

  const invocationFailed = probes.some((record) => (record.result?.verdict ?? 'error') !== 'pass');
  const ledger = recordProbeInvocation(outDir, {
    invocationId,
    requestedId: requestedInvocation,
    purpose,
    startedAt,
    finishedAt: new Date().toISOString(),
    allPass: !invocationFailed,
    failedProbes: probes
      .filter((record) => (record.result?.verdict ?? 'error') !== 'pass')
      .map((record) => `${record.id}:${record.result?.verdict ?? 'error'}`),
    directory: relative(root, invocationDir),
    indexFile: relative(root, join(invocationDir, 'probe-run-index.json')),
  });
  const invocation = {
    invocationId,
    requestedId: requestedInvocation,
    purpose,
    startedAt,
    finishedAt: new Date().toISOString(),
    directory: relative(root, invocationDir),
    ledgerFile: relative(root, join(outDir, PROBE_LEDGER_FILE)),
    sequence: ledger.invocations.length,
  };
  // Every invocation that ever failed, this one included. An index that hides one is refused by
  // `evidence.js probes`, so a later green cannot launder an earlier red.
  const failedInvocations = ledger.invocations.filter((entry) => !entry.allPass).map((entry) => entry.invocationId);

  const pr0 = probes.find((record) => record.id === 'PR-0');
  const compatibility: CompatibilityVerdict = {
    // Compilation cannot establish runtime compatibility, and since ADR-0002 the accepted gate no longer even
    // looks inside the vendor declarations. The previous formula (accepted gate clean => established) would have
    // flipped this field on the strength of a compiler flag, so the claim is no longer derived from it at all:
    // only Phase 1 behaviour plus the UDG-SPIKE-001 gate can move this, by owner decision.
    stackCompatibility: 'not-established',
    pr0: pr0?.result?.verdict ?? (pr0 === undefined ? 'missing' : pr0.result?.ok === true ? 'pass' : 'fail'),
    compilerPolicy: {
      exception: 'ADR-0002: skipLibCheck true, accepted by the owner on 2026-11-10',
      approvedProjects: ['apps/server/tsconfig.json', 'apps/server/tsconfig.probes.json'],
      everythingElse:
        'tsconfig.base.json keeps skipLibCheck: false; the only other project carrying the setting is the root tooling project tsconfig.json, under UDG-001 decision D1 and unrelated to ADR-0002',
    },
    acceptedGate: {
      command: typecheck.command,
      exitCode: typecheck.exitCode,
      diagnostics: {
        total: diagnostics.length,
        inRepositoryCode: diagnostics.filter((diagnostic) => diagnostic.insideRepository).length,
        inThirdPartyDeclarations: diagnostics.filter((diagnostic) => !diagnostic.insideRepository).length,
      },
      claim: 'first-party code typechecks against the pinned declarations under the documented ADR-0002 exception',
      notClaimed: [
        'the vendor declaration defects are fixed - they are inventoried, not resolved',
        'runtime behaviour, reconciliation or transport compatibility follows from compilation',
        'apps/client or any other project is covered by this exception',
        'this project is the accepted build path, which is `pnpm run build` with no --noCheck',
      ],
    },
    fullDeclarationCheck: {
      command: fullCheck.command,
      exitCode: fullCheck.exitCode,
      totalDiagnostics: fullDiagnostics.length,
      inventoryEntries: declarationInventory.length,
      pinnedInventory: 'docs/integration/colyseus-declaration-inventory.json',
    },
    firstPartyDeclarations: {
      command: declarations.command,
      exitCode: declarations.exitCode,
      purpose: 'strict check of UDG-owned emitted declarations without importing the server or SDK stack',
    },
    acceptedBuildPath:
      'pnpm --filter @udg/server build — `tsc -p tsconfig.json`, fully typechecked; the unchecked emit is never part of it, and the typecheck scripts are the compile assertions',
    diagnosticEmission:
      'pnpm --filter @udg/server build:probes uses tsc --noCheck to obtain runnable JavaScript only; it is not a compatibility result and must not become the accepted build path',
    probes: probes.map((record) => ({
      id: record.id,
      verdict: record.result?.verdict ?? (record.result === undefined ? 'error' : record.result.ok ? 'pass' : 'fail'),
      ok: record.result?.ok ?? false,
    })),
    reading:
      'PR-0 claims only that first-party code typechecks against the pinned declarations under the ADR-0002 exception. ' +
      'The vendor declaration diagnostics remain, runtime behaviour is unproven, and stackCompatibility stays ' +
      'not-established regardless of what the compiler reports.',
  };
  const indexBody = {
    invocation,
    failedInvocations,
    invocationCount: ledger.invocations.length,
    emit: { command: emit.command, exitCode: emit.exitCode, timedOut: emit.timedOut, purpose: 'diagnostic emission only (--noCheck)' },
    typecheck: {
      command: typecheck.command,
      exitCode: typecheck.exitCode,
      diagnosticCount: diagnostics.length,
      purpose: 'the accepted compiler gate under the ADR-0002 exception: first-party code against the pinned declarations',
    },
    fullCheck: {
      command: fullCheck.command,
      exitCode: fullCheck.exitCode,
      diagnosticCount: fullDiagnostics.length,
      purpose: 'the retained full declaration check, inventoried and compared against the pinned inventory',
    },
    declarations: {
      command: declarations.command,
      exitCode: declarations.exitCode,
      diagnosticCount: declarationDiagnostics.length,
      purpose: 'strict check of UDG-owned emitted declarations, without the server/SDK stack',
    },
    compatibility: {
      stackCompatibility: compatibility.stackCompatibility,
      pr0: compatibility.pr0,
      acceptedGateExitCode: compatibility.acceptedGate.exitCode,
      fullCheckExitCode: compatibility.fullDeclarationCheck.exitCode,
      fullCheckDiagnostics: compatibility.fullDeclarationCheck.totalDiagnostics,
      declarationInventoryEntries: compatibility.fullDeclarationCheck.inventoryEntries,
    },
    probes: probes.map((record) => ({
      id: record.id,
      subject: record.subject,
      command: record.command,
      exitCode: record.exitCode,
      ok: record.result?.ok ?? false,
      verdict: record.result?.verdict ?? (record.result === undefined ? 'error' : record.result.ok ? 'pass' : 'fail'),
      blockedReason: record.result?.blockedReason,
      checks: record.result?.checks.length ?? 0,
      failures: (record.result?.checks ?? []).filter((check) => !check.ok).map((check) => `${check.name} :: ${check.detail}`),
      resultFile: relative(root, record.resultPath),
      invocationId: record.invocationId,
      failureDetail: record.failureDetail,
    })),
  };
  writeJson(join(invocationDir, 'compatibility-verdict.json'), { schemaVersion: 1, taskId: 'UDG-003', ...compatibility });
  writeJson(join(invocationDir, 'probe-run-index.json'), indexBody);

  // The latest view, at the paths every existing reader already names. These are copies of one named
  // invocation, and the attribution inside each file says which — so a partial overwrite is detectable.
  writeJson(join(outDir, 'compatibility-verdict.json'), { schemaVersion: 1, taskId: 'UDG-003', ...compatibility });
  writeJson(join(outDir, 'probe-run-index.json'), indexBody);
  for (const name of [
    'probe-project-typecheck.json',
    'declaration-inventory.json',
    'first-party-declarations.json',
    'compatibility-verdict.json',
    'probe-run-index.json',
    ...PROBE_IDS.map((id) => `${id.replace('/', '-')}.probe-result.json`),
  ]) {
    const source = join(invocationDir, name);
    if (existsSync(source)) copyFileSync(source, join(outDir, name));
  }

  return {
    emit,
    compatibility,
    typecheck,
    diagnostics,
    fullCheck,
    fullDiagnostics,
    declarations,
    declarationInventory,
    repositoryDiagnostics: fullDiagnostics.filter((diagnostic) => diagnostic.insideRepository),
    thirdPartyDiagnostics: fullDiagnostics.filter((diagnostic) => !diagnostic.insideRepository),
    probes,
  };
}

/**
 * Remove comments and literal text before an escape-hatch scan, mirroring `stripNonCode` in
 * `apps/server/probes/support.ts`.
 *
 * The probe sources quote declaration paths and quote the very casts they ban while explaining them, so a
 * raw-text scan reports clean files as offenders. PR-0 applies the probe-side copy to the same tree and
 * reports its own verdict; this copy keeps the suite's independent check honest about prose.
 */
export function stripNonCode(text: string): string {
  let output = '';
  let state: 'code' | 'lineComment' | 'blockComment' | 'singleQuote' | 'doubleQuote' | 'template' = 'code';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const next = text[index + 1] ?? '';
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'lineComment';
        index += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'blockComment';
        index += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = char === "'" ? 'singleQuote' : char === '"' ? 'doubleQuote' : 'template';
        continue;
      }
      output += char;
      continue;
    }
    if (state === 'lineComment') {
      if (char === '\n') {
        state = 'code';
        output += char;
      }
      continue;
    }
    if (state === 'blockComment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }
    if ((state === 'singleQuote' && char === "'") || (state === 'doubleQuote' && char === '"') || (state === 'template' && char === '`')) {
      state = 'code';
    }
  }
  return output;
}

/** The probe modules as they exist on disk, for the escape-hatch and api-map assertions. */
export function probeSources(root: string): readonly { readonly path: string; readonly text: string }[] {
  const directory = join(serverDirectory(root), 'probes');
  const found: { path: string; text: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'dist') walk(path);
        continue;
      }
      if (entry.name.endsWith('.ts')) found.push({ path: relative(root, path), text: readFileSync(path, 'utf8') });
    }
  };
  if (existsSync(directory)) walk(directory);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
