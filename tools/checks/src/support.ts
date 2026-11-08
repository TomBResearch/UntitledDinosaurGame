/**
 * Shared support code for the @udg/checks tool workspace created by UDG-001.
 *
 * Every module in this package is a static, source-only analysis tool: it reads files and runs
 * commands. It must never import a game workspace, because the checker has to be able to fail a
 * game package that is itself broken. See docs/contracts/ownership.md 2.3.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Repository-relative path with forward slashes, always. */
export type RepoPath = string;

export interface PackageInfo {
  /** Package directory relative to the analysed root, e.g. "packages/protocol". */
  readonly dir: RepoPath;
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

export interface DiscoveredWorkspace {
  readonly root: string;
  readonly packages: readonly PackageInfo[];
}

/** The eleven assignable task IDs in UDG-CONTRACTS-M0-001 v1.0. */
export const CONTRACT_TASK_IDS = [
  'UDG-001',
  'UDG-002',
  'UDG-003',
  'UDG-004',
  'UDG-SPIKE-001',
  'UDG-005',
  'UDG-006',
  'UDG-SPIKE-002',
  'UDG-007',
  'UDG-008',
  'UDG-SPIKE-003',
] as const;

export type ContractTaskId = (typeof CONTRACT_TASK_IDS)[number];

export const isContractTaskId = (value: string): value is ContractTaskId =>
  (CONTRACT_TASK_IDS as readonly string[]).includes(value);

/** Which task creates each suite that UDG-001 must not fake. */
export interface SuiteOwnership {
  readonly command: string;
  readonly owningTask: string;
  readonly contractPath: string;
  readonly requiredArtefact: string;
}

export const UNAVAILABLE_SUITES: Readonly<Record<string, SuiteOwnership>> = {
  'test:e2e': {
    command: 'pnpm test:e2e -- --suite <camera|netcode|physics|input|hybrid>',
    owningTask: 'UDG-004 (camera), UDG-SPIKE-001 (netcode), UDG-006 (physics), UDG-008 (input), UDG-SPIKE-003 (hybrid)',
    contractPath: 'docs/contracts/repository.md#33-test-and-script-implementation-paths',
    requiredArtefact: 'tests/e2e/<suite>.spec.ts plus installed Playwright browsers',
  },
  'test:spike': {
    command: 'pnpm test:spike -- --id <UDG-SPIKE-00N> --profile <profile> --seed <seed>',
    owningTask: 'UDG-SPIKE-001, UDG-SPIKE-002, UDG-SPIKE-003',
    contractPath: 'docs/contracts/repository.md#33-test-and-script-implementation-paths',
    requiredArtefact: 'tools/load-test/src/run-spike.ts and tests/spikes/spike-00N.test.ts',
  },
  'assets:build': {
    command: 'pnpm assets:build -- --region region-greybox-001',
    owningTask: 'UDG-007',
    contractPath: 'docs/contracts/UDG-007.md',
    requiredArtefact: 'tools/asset-pipeline/src/build-region.ts',
  },
  'assets:verify': {
    command: 'pnpm assets:verify -- --region region-greybox-001',
    owningTask: 'UDG-007',
    contractPath: 'docs/contracts/UDG-007.md',
    requiredArtefact: 'tools/asset-pipeline/src/verify-region.ts and a built region manifest',
  },
  'test:unit': {
    command: 'pnpm test:unit',
    owningTask: 'UDG-002 and every task that first adds logic under test',
    contractPath: 'docs/contracts/repository.md',
    requiredArtefact:
      'Unit suites under tests/unit/<task>/. Point this command at vitest with an explicit include when the first one lands; zero discovered unit tests is never a pass.',
  },
};

/** sha256 of exact file bytes, hex. */
export const sha256File = (absolutePath: string): string =>
  sha256Bytes(readFileSync(absolutePath));

export const sha256Bytes = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

/**
 * Canonical JSON used for hash inputs. UTF-8, object keys sorted, array order preserved, no
 * insignificant whitespace. UDG-002 owns the protocol-side canonical serialisation contract;
 * this helper is the tooling-local equivalent used for rule tables and evidence records.
 */
export const canonicalJson = (value: unknown): string => {
  const encode = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) {
        throw new Error('canonicalJson refuses non-finite numbers');
      }
      return String(input);
    }
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'string') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(encode).join(',')}]`;
    if (typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v)}`).join(',')}}`;
    }
    throw new Error(`canonicalJson refuses ${typeof input}`);
  };
  return encode(value);
};

export const sha256Canonical = (value: unknown): string => sha256Bytes(canonicalJson(value));

/** Normalise any OS separator to the repository-relative form used in reports. */
export const toRepoPath = (root: string, absoluteOrRelative: string): RepoPath => {
  const absolute = resolve(root, absoluteOrRelative);
  const relativePath = absolute.startsWith(root) ? absolute.slice(root.length) : absolute;
  return relativePath.replace(/^[/\\]+/, '').replaceAll('\\', '/');
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const readOptional = (absolutePath: string): string | undefined => {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

const packageGlob = '{packages,apps,tools}/*/package.json';

/** Discover first-party workspaces below a root by their package.json position. */
export const discoverWorkspace = (root: string): DiscoveredWorkspace => {
  const absoluteRoot = resolve(root);
  const matches = globSync(packageGlob, { cwd: absoluteRoot, exclude: (p) => p.includes('node_modules') })
    .filter((p) => !p.includes('node_modules'))
    .sort();
  const packages: PackageInfo[] = [];
  for (const match of matches) {
    const absolute = join(absoluteRoot, match);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(`Unreadable package.json at ${match}`, { cause: error });
    }
    const record = parsed as {
      name?: unknown;
      dependencies?: unknown;
      devDependencies?: unknown;
    };
    if (typeof record.name !== 'string') {
      throw new Error(`${match} has no package name`);
    }
    packages.push({
      dir: dirname(toRepoPath(absoluteRoot, match)),
      name: record.name,
      dependencies: stringRecord(record.dependencies),
      devDependencies: stringRecord(record.devDependencies),
    });
  }
  return { root: absoluteRoot, packages };
};

const stringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
};

/** Source files that belong to a package or workspace directory. */
export const sourceFiles = (root: string, dir: RepoPath): RepoPath[] => {
  const absoluteDir = join(root, dir);
  if (!isDirectory(absoluteDir)) return [];
  const found: string[] = [];
  const walk = (relativeDir: RepoPath): void => {
    const absolute = join(root, relativeDir);
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        found.push(child);
      }
    }
  };
  walk(dir);
  return found.sort();
};

export interface ExtractedImport {
  readonly specifier: string;
  readonly line: number;
  readonly kind: 'value' | 'type' | 'side-effect' | 'dynamic' | 'require';
}

interface MaskedSource {
  /**
   * Source with comments removed and string/template interiors blanked, with the same byte
   * offsets and the quote characters preserved. Keywords are therefore visible only where they
   * are real code, while a quoted specifier can still be read from the original text by offset.
   */
  readonly masked: string;
  readonly original: string;
}

/**
 * Blank comments and string interiors without changing byte offsets.
 *
 * Known limitation, exercised by tests/fixtures/boundaries/allowed: a regular-expression literal
 * that itself contains a quote character can shift the mask. Import extraction only looks at
 * `from`/`import()`/`require()` positions, so the effect is limited to that narrow case, and the
 * fixture asserts the tricky content is ignored rather than trusted.
 */
export const maskSource = (original: string): MaskedSource => {
  const out = original.split('');
  let index = 0;
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  while (index < original.length) {
    const ch = original[index] as string;
    const next = original[index + 1] ?? '';
    if (ch === '/' && next === '/') {
      const end = original.indexOf('\n', index);
      const stop = end === -1 ? original.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = original.indexOf('*/', index + 2);
      const stop = end === -1 ? original.length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let i = index + 1;
      while (i < original.length) {
        const c = original[i] as string;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === ch) break;
        i += 1;
      }
      blank(index + 1, i);
      index = i + 1;
      continue;
    }
    index += 1;
  }
  return { masked: out.join(''), original };
};

export const lineAt = (text: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
};

const STATIC_IMPORT = /(?:\bimport\b|\bexport\b)[^;\n]*?\bfrom\s*(['"])([^'"]*)\1/dg;
const BARE_IMPORT = /\bimport\s*(['"])([^'"]*)\1/dg;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"]*)\1/dg;
const REQUIRE = /\brequire\s*\(\s*(['"])([^'"]*)\1/dg;

/**
 * Extract every import specifier: value, type, side-effect, dynamic and require forms.
 *
 * Patterns run against the masked copy so a keyword inside a comment or inside another string is
 * invisible, while the specifier text is read from the original source using match group indices.
 */
export const extractImports = (source: string): ExtractedImport[] => {
  const { masked } = maskSource(source);
  const found: ExtractedImport[] = [];

  const collect = (
    pattern: RegExp,
    kind: ExtractedImport['kind'] | 'type-or-value',
    filter?: (matched: string) => boolean,
  ): void => {
    for (const match of iterate(masked, pattern)) {
      if (filter !== undefined && !filter(match[0])) continue;
      const range = match.indices?.[2];
      if (range === undefined) continue;
      const specifier = source.slice(range[0], range[1]);
      if (specifier.length === 0) continue;
      const kind2: ExtractedImport['kind'] =
        kind === 'type-or-value' ? (/\bimport\s+type\b/.test(match[0]) ? 'type' : 'value') : kind;
      found.push({ specifier, line: lineAt(masked, range[0]), kind: kind2 });
    }
  };

  collect(STATIC_IMPORT, 'type-or-value');
  collect(BARE_IMPORT, 'side-effect', (matched) => !/\bfrom\b/.test(matched));
  collect(DYNAMIC_IMPORT, 'dynamic');
  collect(REQUIRE, 'require');

  return found.sort((a, b) => a.line - b.line);
};

function* iterate(text: string, pattern: RegExp): Generator<RegExpExecArray> {
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    yield match;
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
}

/** Identifiers that only exist in a browser document. */
export const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'WebGLRenderingContext',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'alert',
] as const;

/** Find browser-global identifier uses, ignoring member access, strings, comments and keys. */
export const findBrowserGlobals = (source: string): { name: string; line: number }[] => {
  const { masked } = maskSource(source);
  const hits: { name: string; line: number }[] = [];
  const pattern = new RegExp(`(?:^|[^$.\\w])\\b(${BROWSER_GLOBALS.join('|')})\\b`, 'g');
  for (const match of iterate(masked, pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    const offset = match.index + match[0].indexOf(name);
    const rest = masked.slice(offset + name.length).match(/^\s*([:(=,)\]}.;]|$)/);
    // Object literal keys such as `{ document: x }` are not global reads.
    if (rest !== null && (rest[1] === ':' || rest[1] === ',')) {
      const before = masked.slice(Math.max(0, offset - 40), offset).trimEnd();
      if (before === '' || /[{,]$/.test(before)) continue;
    }
    hits.push({ name, line: lineAt(masked, offset) });
  }
  return hits;
};

export interface RunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface RunResult {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

/** Run a command and capture its output. Never throws on a nonzero exit code. */
export const runCommand = (command: readonly string[], options: RunOptions): RunResult => {
  const [binary, ...args] = command;
  if (binary === undefined) throw new Error('runCommand needs a binary');
  const started = Date.now();
  const result = spawnSync(binary, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const exitCode = result.status ?? (timedOut ? 124 : 1);
  return {
    command,
    exitCode,
    stdout,
    stderr,
    timedOut,
    durationMs: Date.now() - started,
  };
};

export const isMainModule = (importMetaUrl: string): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return importMetaUrl === pathToFileURL(resolve(entry)).href;
};

export interface CliArgs {
  readonly positionals: string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/** Minimal deterministic argument parser: `--flag`, `--key value`, `--key=value`, positionals. */
export const parseArgs = (argv: readonly string[]): CliArgs => {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === '--') continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positionals, flags };
};

export const flagString = (flags: CliArgs['flags'], key: string): string | undefined => {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
};

export const requireFlag = (flags: CliArgs['flags'], key: string, usage: string): string => {
  const value = flagString(flags, key);
  if (value === undefined) {
    process.stderr.write(`${usage}\n`);
    throw new Error(`missing required --${key}`);
  }
  return value;
};

export const writeJson = (absolutePath: string, value: unknown): void => {
  writeFileSyncEnsuring(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeFileSyncEnsuring = (absolutePath: string, data: string): void => {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, data);
};

export const git = (root: string, args: readonly string[]): string =>
  runCommand(['git', ...args], { cwd: root }).stdout.trim();

/**
 * Replace machine-specific paths with stable aliases before anything is written into an evidence
 * bundle (docs/validation/evidence-requirements.md 19.1 forbids private machine paths).
 */
export const sanitiseMachineText = (text: string, extraRoots: readonly string[] = []): string => {
  const home = homedir();
  const tmp = tmpdir();
  const repo = process.cwd();
  const pairs: readonly (readonly [string, string])[] = [
    [repo, 'REPO_ROOT'],
    [home, '<HOME>'],
    [tmp, '<TMP>'],
    ...extraRoots.map((root): readonly [string, string] => [root, 'REPO_ROOT']),
  ];
  let out = text;
  for (const [path, alias] of pairs) {
    if (path.length > 2) out = out.split(path).join(alias);
  }
  out = out.replaceAll(/\\/g, '/');
  out = out.replace(/\/home\/[A-Za-z0-9._-]+/g, '<HOME>');
  out = out.replace(/\/Users\/[A-Za-z0-9._-]+/g, '<HOME>');
  out = out.replace(/[A-Za-z]:\/Users\/[A-Za-z0-9._-]+/g, '<HOME>');
  return out;
};

