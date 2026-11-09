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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The probes Phase 0 was assigned. Order is the order they are reported in. */
export const PROBE_IDS = ['PR-0', 'PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12'] as const;

export type ProbeId = (typeof PROBE_IDS)[number];

/** Emitted file name per probe id, relative to `apps/server/probes/dist/probes/`. */
export const PROBE_FILES: Readonly<Record<ProbeId, string>> = {
  'PR-0': 'pr0-compile.probe.js',
  'PR-1': 'pr1-graph.probe.js',
  'PR-2': 'pr2-fixed-step.probe.js',
  'PR-3': 'pr3-input-schema.probe.js',
  'PR-8': 'pr8-ack.probe.js',
  'PR-12': 'pr12-epoch.probe.js',
};

export const PROBE_SUBJECTS: Readonly<Record<ProbeId, string>> = {
  'PR-0': 'the pinned stack compiles under the repository compiler policy',
  'PR-1': 'the resolved dependency graph and a single schema runtime',
  'PR-2': 'the public fixed-step facility at the advertised dt',
  'PR-3': 'DirectInputSchema as the room input declaration, five fields preserved',
  'PR-8': 'what the acknowledgement tracks: received, consumed or applied',
  'PR-12': 'epoch renewal lifecycle in the public API',
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
  readonly strictTypecheckCommand: string;
  readonly strictTypecheckExitCode: number;
  readonly diagnostics: { readonly total: number; readonly inRepositoryCode: number; readonly inThirdPartyDeclarations: number };
  readonly acceptedBuildPath: string;
  readonly diagnosticEmission: string;
  readonly probes: readonly { readonly id: ProbeId; readonly verdict: string; readonly ok: boolean }[];
  readonly reading: string;
}

export interface ProbeRun {
  readonly emit: CommandResult;
  readonly compatibility: CompatibilityVerdict;
  readonly typecheck: CommandResult;
  readonly diagnostics: readonly ProbeDiagnostic[];
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

/** Typecheck the probe project with the shared policy. Currently expected to fail on PH0-B1. */
export const typecheckProbes = (root: string): CommandResult =>
  run([process.execPath, compilerPath(root), '-p', 'tsconfig.probes.json', '--noEmit'], serverDirectory(root), PROBE_TIMEOUT_MS);

const resultPathFor = (outDir: string, id: ProbeId): string => join(outDir, `${id.replace('/', '-')}.probe-result.json`);

/** Run one emitted probe in its own process and read back the result file it wrote. */
export function runProbe(root: string, outDir: string, id: ProbeId, typecheckReport?: string): ProbeRecord {
  const emitted = join(serverDirectory(root), 'probes', 'dist', 'probes', PROBE_FILES[id]);
  const out = resultPathFor(outDir, id);
  mkdirSync(outDir, { recursive: true });
  if (existsSync(out)) rmSync(out);

  const argv = [process.execPath, emitted, '--out', out];
  if (typecheckReport !== undefined) argv.push('--typecheck-report', typecheckReport);
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
    command: `${process.execPath} ${relative(root, emitted)} --out ${relative(root, out)}${typecheckReport === undefined ? '' : ` --typecheck-report ${relative(root, typecheckReport)}`}`,
    exitCode: executed.exitCode,
    timedOut: executed.timedOut,
    resultPath: out,
    result,
    failureDetail,
  };
}

/** Emit, typecheck and run every assigned probe. Nothing here judges the outcome. */
export function runColyseusProbes(root: string, outDir: string): ProbeRun {
  // Each probe runs with apps/server as its working directory, so a relative output directory would
  // mean two different places depending on who asked. Anchor it once, here.
  outDir = resolve(root, outDir);
  const emit = emitProbes(root);
  const typecheck = typecheckProbes(root);
  const diagnostics = parseDiagnostics(`${typecheck.stdout}\n${typecheck.stderr}`, serverDirectory(root), root);
  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, 'probe-project-typecheck.json'), {
    command: typecheck.command,
    cwd: relative(root, typecheck.cwd),
    exitCode: typecheck.exitCode,
    diagnostics,
    rawOutput: `${typecheck.stdout}${typecheck.stderr}`.slice(0, 200_000),
  });

  const reportPath = join(outDir, 'probe-project-typecheck.json');
  const probes = PROBE_IDS.map((id) => runProbe(root, outDir, id, reportPath));

  const inRepositoryCode = diagnostics.filter((diagnostic) => diagnostic.insideRepository).length;
  const pr0 = probes.find((record) => record.id === 'PR-0');
  const compatibility: CompatibilityVerdict = {
    stackCompatibility: typecheck.exitCode === 0 && diagnostics.length === 0 ? 'established' : 'not-established',
    pr0: pr0?.result?.verdict ?? (pr0 === undefined ? 'missing' : pr0.result?.ok === true ? 'pass' : 'fail'),
    strictTypecheckCommand: typecheck.command,
    strictTypecheckExitCode: typecheck.exitCode,
    diagnostics: {
      total: diagnostics.length,
      inRepositoryCode,
      inThirdPartyDeclarations: diagnostics.length - inRepositoryCode,
    },
    acceptedBuildPath: 'pnpm --filter @udg/server typecheck:probes (strict, --noEmit) — currently failing with PH0-B1',
    diagnosticEmission: 'pnpm --filter @udg/server build:probes uses tsc --noCheck to obtain runnable JavaScript only; it is not a compatibility result and must not become the accepted build path',
    probes: probes.map((record) => ({
      id: record.id,
      verdict: record.result?.verdict ?? (record.result === undefined ? 'error' : record.result.ok ? 'pass' : 'fail'),
      ok: record.result?.ok ?? false,
    })),
    reading:
      'Five probes measuring real behaviour is not a compatible stack. PR-0 carries the compiler verdict; while it is blocked, stackCompatibility stays not-established regardless of the other results.',
  };
  writeJson(join(outDir, 'compatibility-verdict.json'), { schemaVersion: 1, taskId: 'UDG-003', ...compatibility });
  writeJson(join(outDir, 'probe-run-index.json'), {
    emit: { command: emit.command, exitCode: emit.exitCode, timedOut: emit.timedOut, purpose: 'diagnostic emission only (--noCheck)' },
    typecheck: { command: typecheck.command, exitCode: typecheck.exitCode, diagnosticCount: diagnostics.length, purpose: 'the accepted compiler gate' },
    compatibility: {
      stackCompatibility: compatibility.stackCompatibility,
      pr0: compatibility.pr0,
      strictTypecheckExitCode: compatibility.strictTypecheckExitCode,
      diagnostics: compatibility.diagnostics,
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
      failureDetail: record.failureDetail,
    })),
  });
  return {
    emit,
    compatibility,
    typecheck,
    diagnostics,
    repositoryDiagnostics: diagnostics.filter((diagnostic) => diagnostic.insideRepository),
    thirdPartyDiagnostics: diagnostics.filter((diagnostic) => !diagnostic.insideRepository),
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
