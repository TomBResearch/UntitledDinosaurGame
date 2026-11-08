/**
 * Fixture manifest validation (UDG-001).
 *
 * A fixture manifest is the contract between a fixture directory and the checker that consumes
 * it. It states the expected outcome up front and pins the exact bytes of every fixture file, so
 * a later edit to a fixture cannot quietly change what "passed" means. This is the UDG-001 slice
 * of docs/validation/fixtures.md 7.1; UDG-002 owns protocol fixture schemas and extends the
 * validator rather than duplicating it.
 *
 *   fixtures.js --root tests/fixtures            validate
 *   fixtures.js --root tests/fixtures --write    re-pin hashes after an intentional fixture edit
 *
 * The recorded configHash is derived from the live rule table and tsconfig.base.json, so
 * weakening a rule or the strict compiler settings makes existing fixtures fail.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { baseTsconfigHash, boundaryConfigHash } from './boundaries.js';
import {
  isMainModule,
  parseArgs,
  sha256File,
  flagString,
  toRepoPath,
  writeJson,
  type CliArgs,
} from './support.js';

export const FIXTURE_SCHEMA_VERSION = 1;

export interface FixtureManifest {
  readonly schemaVersion: number;
  readonly fixtureVersion: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly ownerTask: string;
  readonly configHash: string;
  readonly seed: number | null;
  readonly note: string;
  readonly expectation: string;
  readonly expectedRuleIds?: readonly string[];
  readonly expectedDiagnosticCodes?: readonly string[];
  readonly files?: readonly FixtureFile[];
}

export interface FixtureFile {
  readonly path: string;
  readonly sha256: string;
}

export interface FixtureValidation {
  readonly fixtureDir: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
}

const SUPPORTED_KINDS = new Set(['dependency-boundaries', 'strict-compile']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readManifest = (absolutePath: string): { manifest?: FixtureManifest; problems: string[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    return { problems: [`fixture.json is not readable JSON: ${String(error)}`] };
  }
  if (!isRecord(parsed)) return { problems: ['fixture.json must be an object'] };

  const problems: string[] = [];
  const requireString = (key: string): string => {
    const value = parsed[key];
    if (typeof value !== 'string' || value.length === 0) {
      problems.push(`${key} must be a non-empty string`);
      return '';
    }
    return value;
  };

  const schemaVersion = parsed['schemaVersion'];
  if (schemaVersion !== FIXTURE_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${String(FIXTURE_SCHEMA_VERSION)}`);
  }
  const fixtureId = requireString('fixtureId');
  const kind = requireString('kind');
  const ownerTask = requireString('ownerTask');
  const configHash = requireString('configHash');
  const expectation = requireString('expectation');
  const note = requireString('note');
  const fixtureVersion = requireString('fixtureVersion');

  if (!('seed' in parsed)) {
    problems.push('seed must be present (null when the fixture uses no random sampling)');
  } else if (parsed['seed'] !== null && typeof parsed['seed'] !== 'number') {
    problems.push('seed must be null or a number');
  }
  if (!SUPPORTED_KINDS.has(kind)) {
    problems.push(`kind "${kind}" is not one of ${[...SUPPORTED_KINDS].join(', ')}`);
  }
  if (!fixtureId.startsWith(`${ownerTask}-`)) {
    problems.push(`fixtureId "${fixtureId}" must start with ownerTask "${ownerTask}-"`);
  }
  if (expectation !== 'allow' && expectation !== 'reject') {
    problems.push('expectation must be "allow" or "reject"');
  }
  if (kind === 'dependency-boundaries') {
    const ids = parsed['expectedRuleIds'];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      problems.push('expectedRuleIds must be an array of rule id strings');
    } else if (expectation === 'reject' && ids.length === 0) {
      problems.push('a reject fixture must name at least one expected rule id');
    } else if (expectation === 'allow' && ids.length > 0) {
      problems.push('an allow fixture must declare an empty expectedRuleIds list');
    }
  }
  if (kind === 'strict-compile') {
    const codes = parsed['expectedDiagnosticCodes'];
    if (!Array.isArray(codes) || codes.some((code) => typeof code !== 'string')) {
      problems.push('expectedDiagnosticCodes must be an array of TypeScript diagnostic codes');
    } else if (expectation !== 'reject') {
      problems.push('a strict-compile fixture must expect rejection');
    }
  }
  const files = parsed['files'];
  if (!Array.isArray(files) || files.length === 0) {
    problems.push('files must be a non-empty array of {path, sha256}');
  } else if (files.some((entry) => !isRecord(entry) || typeof entry['path'] !== 'string' || typeof entry['sha256'] !== 'string')) {
    problems.push('every files[] entry needs a string path and sha256');
  }

  if (problems.length > 0) return { problems };
  return {
    manifest: {
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      fixtureVersion,
      fixtureId,
      kind,
      ownerTask,
      configHash,
      seed: (parsed['seed'] as number | null) ?? null,
      note,
      expectation,
      ...(kind === 'dependency-boundaries' ? { expectedRuleIds: (parsed['expectedRuleIds'] as string[]) } : {}),
      ...(kind === 'strict-compile' ? { expectedDiagnosticCodes: (parsed['expectedDiagnosticCodes'] as string[]) } : {}),
      files: files as readonly FixtureFile[],
    },
    problems: [],
  };
};

/** Files that belong to the fixture, excluding the manifest itself and generated directories. */
export const fixtureFiles = (absoluteFixtureDir: string): string[] => {
  const out: string[] = [];
  const walk = (relativeDir: string): void => {
    const absolute = join(absoluteFixtureDir, relativeDir);
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (child !== 'fixture.json') {
        out.push(child);
      }
    }
  };
  walk('');
  return out.sort();
};

export const expectedConfigHash = (root: string, kind: string): string =>
  kind === 'dependency-boundaries' ? boundaryConfigHash(root) : baseTsconfigHash(root);

export const validateFixtureDir = (root: string, absoluteFixtureDir: string): FixtureValidation => {
  const manifestPath = join(absoluteFixtureDir, 'fixture.json');
  const fixtureDir = toRepoPath(root, absoluteFixtureDir);
  if (!existsSync(manifestPath)) {
    return { fixtureDir, fixtureId: '<missing>', kind: '<missing>', ok: false, problems: ['fixture.json is missing'] };
  }
  const { manifest, problems } = readManifest(manifestPath);
  if (manifest === undefined) {
    return { fixtureDir, fixtureId: '<invalid>', kind: '<invalid>', ok: false, problems };
  }

  const found: string[] = [];
  const declared = new Map((manifest.files ?? []).map((entry) => [entry.path, entry.sha256]));
  for (const relativePath of fixtureFiles(absoluteFixtureDir)) {
    const expected = declared.get(relativePath);
    if (expected === undefined) {
      found.push(`undeclared fixture file: ${relativePath}`);
      continue;
    }
    const actual = sha256File(join(absoluteFixtureDir, relativePath));
    if (actual !== expected) {
      found.push(`hash mismatch for ${relativePath}: manifest ${expected.slice(0, 12)}…, actual ${actual.slice(0, 12)}…`);
    }
  }
  for (const entry of manifest.files ?? []) {
    if (entry.path.startsWith('/') || entry.path.includes('..') || entry.path.includes('\\')) {
      found.push(`unsafe fixture path: ${entry.path}`);
      continue;
    }
    if (!existsSync(join(absoluteFixtureDir, entry.path))) {
      found.push(`declared fixture file is absent: ${entry.path}`);
    }
  }

  const expectedHash = expectedConfigHash(root, manifest.kind);
  if (manifest.configHash !== expectedHash) {
    found.push(
      `configHash ${manifest.configHash.slice(0, 12)}… does not match the current ${manifest.kind} configuration ${expectedHash.slice(0, 12)}… (rules or strict settings changed)`,
    );
  }

  return {
    fixtureDir,
    fixtureId: manifest.fixtureId,
    kind: manifest.kind,
    ok: found.length === 0,
    problems: found,
  };
};

export const validateFixtures = (root: string, fixturesRoot: string): FixtureValidation[] => {
  const absoluteRoot = resolve(root, fixturesRoot);
  const results: FixtureValidation[] = [];
  if (!existsSync(absoluteRoot)) return results;
  for (const group of readdirSync(absoluteRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const groupDir = join(absoluteRoot, group.name);
    for (const entry of readdirSync(groupDir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const fixtureDir = join(groupDir, entry.name);
      if (existsSync(join(fixtureDir, 'fixture.json'))) {
        results.push(validateFixtureDir(root, fixtureDir));
      }
    }
  }
  return results;
};

/** Re-pin hashes and config hashes after an intentional fixture edit. */
export const writeFixtureManifests = (root: string, fixturesRoot: string): string[] => {
  const absoluteRoot = resolve(root, fixturesRoot);
  const changed: string[] = [];
  for (const group of readdirSync(absoluteRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const groupDir = join(absoluteRoot, group.name);
    for (const entry of readdirSync(groupDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const fixtureDir = join(groupDir, entry.name);
      const manifestPath = join(fixtureDir, 'fixture.json');
      if (!existsSync(manifestPath)) continue;
      // Re-pin from the raw envelope so a freshly written stub manifest can be completed.
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const kind = raw['kind'];
      if (typeof kind !== 'string' || !SUPPORTED_KINDS.has(kind)) {
        throw new Error(`Refusing to rewrite a manifest with an unknown kind: ${toRepoPath(root, manifestPath)}`);
      }
      const files = fixtureFiles(fixtureDir)
        .map((path) => ({ path, sha256: sha256File(join(fixtureDir, path)) }))
        .sort((a, b) => a.path.localeCompare(b.path));
      const next: Record<string, unknown> = {
        schemaVersion: FIXTURE_SCHEMA_VERSION,
        fixtureVersion: raw['fixtureVersion'],
        fixtureId: raw['fixtureId'],
        kind,
        ownerTask: raw['ownerTask'],
        configHash: expectedConfigHash(root, kind),
        seed: raw['seed'] ?? null,
        note: raw['note'],
        expectation: raw['expectation'],
        ...(kind === 'dependency-boundaries' ? { expectedRuleIds: raw['expectedRuleIds'] ?? [] } : {}),
        ...(kind === 'strict-compile' ? { expectedDiagnosticCodes: raw['expectedDiagnosticCodes'] ?? [] } : {}),
        files,
      };
      const serialised = `${JSON.stringify(next, null, 2)}\n`;
      if (readFileSync(manifestPath, 'utf8') !== serialised) {
        writeFileSync(manifestPath, serialised);
        changed.push(toRepoPath(root, manifestPath));
      }
    }
  }
  return changed;
};

const main = (flags: CliArgs['flags']): number => {
  const root = process.cwd();
  const fixturesRoot = flagString(flags, 'root') ?? 'tests/fixtures';

  if (flags['write'] === true) {
    const changed = writeFixtureManifests(root, fixturesRoot);
    process.stdout.write(
      changed.length === 0 ? 'fixture manifests already pinned\n' : `re-pinned:\n${changed.map((p) => `  ${p}`).join('\n')}\n`,
    );
    return 0;
  }

  const results = validateFixtures(root, fixturesRoot);
  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.fixtureId} [${result.kind}] ${result.fixtureDir}${result.problems.length > 0 ? `\n  problems: ${result.problems.join('; ')}` : ''}\n`,
    );
  }
  if (results.length === 0) {
    process.stderr.write(`No fixture manifests found under ${fixturesRoot}. A missing fixture set is not a pass.\n`);
    return 1;
  }
  const summary = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fixturesRoot,
    total: results.length,
    failed: failed.length,
    ok: failed.length === 0,
    results,
  };
  const reportPath = flagString(flags, 'report');
  if (reportPath !== undefined) writeJson(resolve(root, reportPath), summary);
  if (failed.length > 0) {
    process.stderr.write(`fixture validation FAILED: ${String(failed.length)} of ${String(results.length)} fixture(s)\n`);
    return 1;
  }
  process.stdout.write(`fixture validation OK: ${String(results.length)} fixture(s)\n`);
  return 0;
};

if (isMainModule(import.meta.url)) {
  process.exit(main(parseArgs(process.argv.slice(2)).flags));
}
