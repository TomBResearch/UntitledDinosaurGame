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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/**
 * Standalone protocol fixture kinds (UDG-002).
 *
 * docs/contracts/UDG-002.md names `tests/fixtures/protocol/{valid,malformed,ordering}.json`: three
 * files, not three directories. That is a second legitimate layout under the same fixture root, and the
 * choice is the contract's rather than the tool's, so the tool learned the layout instead of the
 * contract being reshaped to fit a directory walk that would otherwise skip the files silently.
 */
export const STANDALONE_KINDS = new Set(['protocol-valid', 'protocol-wire-negative', 'protocol-ordering']);

/** Where a fixture's region extents came from. `region-asset` is not available before UDG-007. */
export const BOUNDS_PROVENANCE = ['test-only-synthetic', 'region-asset', 'not-required'] as const;

/** Validators and mapping functions a case can target. */
export const FIXTURE_TARGETS = [
  'validateDirectFrame',
  'validateMoveTo',
  'validateCancelPath',
  'validateJoin',
  'validateRouteStatus',
  'admitGeneration',
  'compareRequestIdentity',
  'toReplica',
  'fromReplica',
  'roundTrip',
  'roundTripRegion',
] as const;

/** Encodings a case body may use. `binary` is a hand-built byte payload, not JSON. */
export const FIXTURE_ENCODINGS = ['json', 'json-tagged', 'binary'] as const;

/** Catalog file that declares every fixture of both layouts. */
export const CATALOG_FILE = 'catalog.json';
export const CATALOG_SCHEMA_VERSION = 1;

export interface FixtureCatalogEntry {
  readonly path: string;
  readonly layout: string;
  readonly fixtureId: string;
  readonly requiredCaseIds: readonly string[];
  /**
   * The digest of the fixture's exact bytes. Required for a standalone fixture, whose cases are data:
   * without it the file could be edited into a different case set that still validates structurally, and
   * the run would report success over fixtures nobody reviewed.
   */
  readonly sha256?: string;
}

export interface FixtureCatalog {
  readonly schemaVersion: number;
  readonly ownerTask: string;
  readonly note: string;
  readonly fixtures: readonly FixtureCatalogEntry[];
  readonly groups: Readonly<Record<string, { readonly requiresBinaryCase: boolean }>>;
}

export interface StandaloneFixture {
  readonly fixtureVersion: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly ownerTask: string;
  readonly protocolVersion: string;
  readonly configHash: string;
  readonly seed: number | null;
  readonly boundsProvenance: string;
  readonly note: string;
  readonly caseIds: readonly string[];
  readonly binaryCaseCount: number;
  readonly taggedNegativeOnly: boolean;
}

/**
 * Read the built protocol and configuration modules.
 *
 * A protocol fixture pins the `configHash` and `protocolVersion` it was authored against, and the only
 * honest source of those two values is the code that produces them. `@udg/checks` may not depend on a
 * game workspace, so this reaches the built modules through a child process instead of an import edge:
 * the check stays independent in the dependency graph while still refusing to guess a hash.
 */
interface ProtocolProbe {
  readonly configHash: string;
  readonly protocolVersion: string;
  readonly rejectionCodes: readonly string[];
}

const protocolProbeCache = new Map<string, ProtocolProbe>();

const protocolProbe = (root: string): ProtocolProbe => {
  const cached = protocolProbeCache.get(root);
  if (cached !== undefined) return cached;
  const configPath = pathToFileURL(join(root, 'packages', 'config', 'dist', 'index.js')).href;
  const protocolPath = pathToFileURL(join(root, 'packages', 'protocol', 'dist', 'index.js')).href;
  const script =
    `const config = await import(${JSON.stringify(configPath)});\n` +
    `const protocol = await import(${JSON.stringify(protocolPath)});\n` +
    `process.stdout.write(JSON.stringify({\n` +
    `  configHash: config.computeConfigHash(config.DEFAULT_SERVER_CONFIG),\n` +
    `  protocolVersion: protocol.PROTOCOL_VERSION,\n` +
    `  rejectionCodes: protocol.REJECTION_CODES,\n` +
    `}));\n`;
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  } catch (error) {
    throw new Error(
      'Cannot read the protocol and configuration build output to verify fixture hashes. Run `pnpm build` first.',
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`The protocol probe produced unreadable output: ${stdout.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The protocol probe produced no object');
  const record = parsed as Record<string, unknown>;
  if (typeof record['configHash'] !== 'string' || typeof record['protocolVersion'] !== 'string') {
    throw new Error('The protocol probe did not report a configHash and protocolVersion');
  }
  if (!Array.isArray(record['rejectionCodes']) || record['rejectionCodes'].some((code) => typeof code !== 'string')) {
    throw new Error('The protocol probe did not report the rejection-code vocabulary');
  }
  const probe: ProtocolProbe = {
    configHash: record['configHash'],
    protocolVersion: record['protocolVersion'],
    rejectionCodes: record['rejectionCodes'] as string[],
  };
  protocolProbeCache.set(root, probe);
  return probe;
};

const isTaggedNonFinite = (value: unknown): boolean =>
  isRecord(value) && typeof value['number'] === 'string' && ['NaN', 'Infinity', '-Infinity'].includes(value['number']);

const containsTaggedValue = (value: unknown): boolean => {
  if (isTaggedNonFinite(value)) return true;
  if (Array.isArray(value)) return value.some((entry) => containsTaggedValue(entry));
  if (isRecord(value)) return Object.values(value).some((entry) => containsTaggedValue(entry));
  return false;
};

/**
 * Validate one standalone protocol fixture.
 *
 * This is structural: it proves the envelope states what it must, that every case names its target,
 * encoding and expected outcome, and that a case which expects success is not smuggled in through a
 * tagged `NaN`. Executing the cases is the UDG-002 suite's job; the checker's job is to make an
 * under-specified fixture impossible to commit.
 */
export const validateStandaloneFixture = (root: string, absoluteFile: string): FixtureValidation => {
  const fixturePath = toRepoPath(root, absoluteFile);
  const base = { fixtureDir: fixturePath, fixtureId: '<invalid>', kind: '<invalid>', ok: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absoluteFile, 'utf8')) as unknown;
  } catch (error) {
    return { ...base, problems: [`fixture file is not readable JSON: ${String(error)}`] };
  }
  if (!isRecord(parsed)) return { ...base, problems: ['fixture file must be an object'] };

  const problems: string[] = [];
  const text = (key: string): string => {
    const value = parsed[key];
    if (typeof value !== 'string' || value.length === 0) {
      problems.push(`${key} must be a non-empty string`);
      return '';
    }
    return value;
  };

  const fixtureVersion = text('fixtureVersion');
  const fixtureId = text('fixtureId');
  const kind = text('kind');
  const ownerTask = text('ownerTask');
  const protocolVersion = text('protocolVersion');
  const configHash = text('configHash');
  const boundsProvenance = text('boundsProvenance');
  const note = text('note');

  if (!('seed' in parsed)) problems.push('seed must be present (null when the fixture uses no random sampling)');
  else if (parsed['seed'] !== null && typeof parsed['seed'] !== 'number') problems.push('seed must be null or a number');

  if (!STANDALONE_KINDS.has(kind)) {
    problems.push(`kind "${kind}" is not one of ${[...STANDALONE_KINDS].join(', ')}`);
  }
  if (fixtureId !== '' && !fixtureId.startsWith(`${ownerTask}-`)) {
    problems.push(`fixtureId "${fixtureId}" must start with ownerTask "${ownerTask}-"`);
  }
  if (!/^[0-9a-f]{64}$/.test(configHash)) problems.push('configHash must be 64 lowercase hexadecimal characters');
  if (!(BOUNDS_PROVENANCE as readonly string[]).includes(boundsProvenance)) {
    problems.push(`boundsProvenance "${boundsProvenance}" is not one of ${BOUNDS_PROVENANCE.join(', ')}`);
  }

  const probe = protocolProbe(root);
  if (configHash.length === 64 && configHash !== probe.configHash) {
    problems.push(`configHash ${configHash.slice(0, 12)}… does not match the current configuration ${probe.configHash.slice(0, 12)}…`);
  }
  if (protocolVersion.length > 0 && protocolVersion !== probe.protocolVersion) {
    problems.push(`protocolVersion "${protocolVersion}" does not match the built protocol "${probe.protocolVersion}"`);
  }

  const cases = parsed['cases'];
  const caseIds: string[] = [];
  let binaryCaseCount = 0;
  let taggedUsedOnPositive = false;
  if (!Array.isArray(cases) || cases.length === 0) {
    problems.push('cases must be a non-empty array');
  } else {
    cases.forEach((entry, index) => {
      const where = `cases[${String(index)}]`;
      if (!isRecord(entry)) {
        problems.push(`${where} must be an object`);
        return;
      }
      const caseId = entry['caseId'];
      if (typeof caseId !== 'string' || !/^[PV]\d{2,3}$/.test(caseId)) {
        problems.push(`${where}.caseId must look like P01 or V01`);
      } else if (caseIds.includes(caseId)) {
        problems.push(`duplicate caseId ${caseId}`);
      } else {
        caseIds.push(caseId);
      }
      if (typeof entry['note'] !== 'string' || entry['note'].length === 0) problems.push(`${where}.note must be a non-empty string`);
      const target = entry['target'];
      if (typeof target !== 'string' || !(FIXTURE_TARGETS as readonly string[]).includes(target)) {
        problems.push(`${where}.target must be one of ${FIXTURE_TARGETS.join(', ')}`);
      }
      const encoding = entry['encoding'];
      if (typeof encoding !== 'string' || !(FIXTURE_ENCODINGS as readonly string[]).includes(encoding)) {
        problems.push(`${where}.encoding must be one of ${FIXTURE_ENCODINGS.join(', ')}`);
      } else if (encoding === 'binary') {
        binaryCaseCount += 1;
        const bytes = entry['bytes'];
        const recipe = entry['binary'];
        if (typeof bytes === 'string') {
          if (!/^[0-9a-f]*$/.test(bytes)) {
            problems.push(`${where} with binary encoding must carry lowercase hexadecimal "bytes"`);
          }
        } else if (!isRecord(recipe) || typeof recipe['codec'] !== 'string' || typeof recipe['schema'] !== 'string') {
          problems.push(
            `${where} must carry either hexadecimal "bytes" or a "binary" recipe naming codec and schema`,
          );
        }
      }
      const expect = entry['expect'];
      if (!isRecord(expect) || typeof expect['ok'] !== 'boolean') {
        problems.push(`${where}.expect.ok must be a boolean`);
        return;
      }
      const codes = expect['errorCodes'];
      if (expect['ok'] === false) {
        if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => typeof code !== 'string')) {
          problems.push(`${where}.expect.errorCodes must be a non-empty array of codes for a rejecting case`);
        } else {
          for (const code of codes as string[]) {
            if (!probe.rejectionCodes.includes(code)) {
              problems.push(`${where} expects ${code}, which is not in the declared rejection vocabulary`);
            }
          }
        }
      } else if (codes !== undefined && (!Array.isArray(codes) || codes.length > 0)) {
        problems.push(`${where}.expect.errorCodes must be absent or empty when the case must succeed`);
      }
      if (expect['ok'] === true && containsTaggedValue(entry)) {
        taggedUsedOnPositive = true;
        problems.push(`${where} expects success but carries a tagged non-finite value; tagged values belong to negative cases only`);
      }
      if (
        typeof entry['input'] === 'undefined' &&
        typeof entry['operations'] === 'undefined' &&
        typeof entry['bytes'] === 'undefined' &&
        typeof entry['binary'] === 'undefined'
      ) {
        problems.push(`${where} must carry input, operations, bytes or a binary recipe`);
      }
    });
  }

  const validation: FixtureValidation = {
    fixtureDir: fixturePath,
    fixtureId,
    kind,
    ok: problems.length === 0,
    problems,
  };
  standaloneDetails.set(absoluteFile, {
    fixtureVersion,
    fixtureId,
    kind,
    ownerTask,
    protocolVersion,
    configHash,
    seed: (parsed['seed'] as number | null) ?? null,
    boundsProvenance,
    note,
    caseIds,
    binaryCaseCount,
    taggedNegativeOnly: !taggedUsedOnPositive,
  });
  return validation;
};

const standaloneDetails = new Map<string, StandaloneFixture>();

/** Details captured by the last validation pass, used by the catalog check and `--write`. */
export const standaloneFixtureDetails = (fixturePath: string): StandaloneFixture | undefined =>
  standaloneDetails.get(fixturePath);


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

/** The configuration digest a protocol fixture must pin. */
export const protocolConfigHash = (root: string): string => protocolProbe(root).configHash;

/** The protocol version a protocol fixture must pin. */
export const protocolVersionOf = (root: string): string => protocolProbe(root).protocolVersion;

export type FixtureLayout = 'manifest-directory' | 'standalone-json';

export interface DiscoveredFixture {
  readonly path: string;
  readonly layout: FixtureLayout;
  readonly absolutePath: string;
  readonly group: string;
}

/**
 * Find every fixture under a fixture root, in both layouts.
 *
 * Anything that is neither a directory holding `fixture.json` nor a `.json` file directly inside a group
 * directory is reported rather than skipped. A checker that quietly ignored an unrecognised layout would
 * report a green run over a fixture nobody executed, which is the failure mode this whole file exists to
 * prevent.
 */
export const discoverFixtures = (root: string, fixturesRoot: string): { fixtures: DiscoveredFixture[]; unknown: string[] } => {
  const absoluteRoot = resolve(root, fixturesRoot);
  const fixtures: DiscoveredFixture[] = [];
  const unknown: string[] = [];
  if (!existsSync(absoluteRoot)) return { fixtures, unknown };

  const groups = readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const group of groups) {
    const groupDir = join(absoluteRoot, group.name);
    for (const entry of readdirSync(groupDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        const fixtureDir = join(groupDir, entry.name);
        if (existsSync(join(fixtureDir, 'fixture.json'))) {
          fixtures.push({
            path: `${group.name}/${entry.name}`,
            layout: 'manifest-directory',
            absolutePath: fixtureDir,
            group: group.name,
          });
        } else {
          unknown.push(`${group.name}/${entry.name}`);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        fixtures.push({
          path: `${group.name}/${entry.name}`,
          layout: 'standalone-json',
          absolutePath: join(groupDir, entry.name),
          group: group.name,
        });
        continue;
      }
      unknown.push(`${group.name}/${entry.name}`);
    }
  }

  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== CATALOG_FILE) {
      unknown.push(entry.name);
    }
  }
  return { fixtures, unknown };
};

export const readCatalog = (root: string, fixturesRoot: string): { catalog?: FixtureCatalog; problems: string[] } => {
  const catalogPath = join(resolve(root, fixturesRoot), CATALOG_FILE);
  if (!existsSync(catalogPath)) {
    return { problems: [`FIXTURE-CATALOG-MISSING: ${fixturesRoot}/${CATALOG_FILE} is required; every fixture must be declared`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
  } catch (error) {
    return { problems: [`FIXTURE-CATALOG-INVALID: ${String(error)}`] };
  }
  if (!isRecord(parsed)) return { problems: ['FIXTURE-CATALOG-INVALID: catalog must be an object'] };
  const problems: string[] = [];
  if (parsed['schemaVersion'] !== CATALOG_SCHEMA_VERSION) problems.push(`catalog schemaVersion must be ${String(CATALOG_SCHEMA_VERSION)}`);
  if (typeof parsed['ownerTask'] !== 'string' || parsed['ownerTask'].length === 0) problems.push('catalog ownerTask must be a non-empty string');
  if (typeof parsed['note'] !== 'string' || parsed['note'].length === 0) problems.push('catalog note must be a non-empty string');

  const entries = parsed['fixtures'];
  const fixtures: FixtureCatalogEntry[] = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push('catalog fixtures must be a non-empty array');
  } else {
    entries.forEach((entry, index) => {
      const where = `fixtures[${String(index)}]`;
      if (!isRecord(entry)) {
        problems.push(`${where} must be an object`);
        return;
      }
      const path = entry['path'];
      const layout = entry['layout'];
      const fixtureId = entry['fixtureId'];
      const required = entry['requiredCaseIds'];
      const sha256 = entry['sha256'];
      if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('..')) {
        problems.push(`${where}.path must be a safe relative path`);
        return;
      }
      if (layout !== 'manifest-directory' && layout !== 'standalone-json') {
        problems.push(`${where}.layout must be manifest-directory or standalone-json`);
      }
      if (typeof fixtureId !== 'string' || fixtureId.length === 0) problems.push(`${where}.fixtureId must be a non-empty string`);
      if (!Array.isArray(required) || required.some((id) => typeof id !== 'string')) {
        problems.push(`${where}.requiredCaseIds must be an array of case ids`);
      }
      if (layout === 'standalone-json' && (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))) {
        problems.push(`${where}.sha256 is required for a standalone fixture and must be 64 hexadecimal characters`);
      }
      fixtures.push({
        path,
        layout: typeof layout === 'string' ? layout : '<invalid>',
        fixtureId: typeof fixtureId === 'string' ? fixtureId : '<invalid>',
        requiredCaseIds: Array.isArray(required) ? (required as string[]) : [],
        ...(typeof sha256 === 'string' ? { sha256 } : {}),
      });
    });
  }

  const groups: Record<string, { requiresBinaryCase: boolean }> = {};
  const rawGroups = parsed['groups'];
  if (rawGroups !== undefined) {
    if (!isRecord(rawGroups)) problems.push('catalog groups must be an object');
    else {
      for (const [name, value] of Object.entries(rawGroups)) {
        if (!isRecord(value) || typeof value['requiresBinaryCase'] !== 'boolean') {
          problems.push(`catalog groups.${name}.requiresBinaryCase must be a boolean`);
        } else {
          groups[name] = { requiresBinaryCase: value['requiresBinaryCase'] as boolean };
        }
      }
    }
  }

  if (problems.length > 0) return { problems };
  return {
    catalog: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      ownerTask: parsed['ownerTask'] as string,
      note: parsed['note'] as string,
      fixtures,
      groups,
    },
    problems: [],
  };
};

/**
 * Check the catalog against what is actually on disk.
 *
 * The catalog is the required-case list from docs/validation/fixtures.md 7.2 expressed in a form a
 * machine can hold the repository to. Required cases are therefore not provable by a fixture merely
 * existing: P01 to P20 must be present by id, every fixture on disk must be declared, and a group that
 * needs a binary case cannot satisfy that with JSON alone, because JSON cannot carry `NaN`.
 */
export const validateCatalog = (root: string, fixturesRoot: string): FixtureValidation[] => {
  const { catalog, problems } = readCatalog(root, fixturesRoot);
  if (catalog === undefined) {
    return [{ fixtureDir: `${fixturesRoot}/${CATALOG_FILE}`, fixtureId: '<catalog>', kind: 'catalog', ok: false, problems }];
  }
  const { fixtures: discovered } = discoverFixtures(root, fixturesRoot);
  const byPath = new Map(discovered.map((fixture) => [fixture.path, fixture]));
  const results: FixtureValidation[] = [];
  const groupBinary = new Map<string, number>();

  for (const entry of catalog.fixtures) {
    const found = byPath.get(entry.path);
    const entryProblems: string[] = [];
    if (found === undefined) {
      entryProblems.push(`catalog declares ${entry.path} but no fixture exists there`);
    } else {
      if (found.layout !== entry.layout) {
        entryProblems.push(`${entry.path} is a ${found.layout} on disk but the catalog declares ${entry.layout}`);
      }
      if (found.layout === 'standalone-json') {
        // Validate first when the caller did not, so the catalog never fails over a fixture that is
        // actually fine but was simply not walked in this invocation.
        let details = standaloneDetails.get(found.absolutePath);
        if (details === undefined) {
          validateStandaloneFixture(root, found.absolutePath);
          details = standaloneDetails.get(found.absolutePath);
        }
        // The pinned digest is checked before anything else, because it is the one check that still
        // works when a fixture's contents have been replaced wholesale: an edited file that happens to
        // remain structurally valid would otherwise pass while running different cases than the ones
        // this repository reviewed.
        const recorded = sha256File(found.absolutePath);
        const pinned = entry.sha256 ?? '';
        if (pinned === '') {
          entryProblems.push(`FIXTURE-CATALOG-HASH: ${CATALOG_FILE} declares no sha256 for ${entry.path}; a standalone fixture must be pinned`);
        } else if (recorded !== pinned) {
          entryProblems.push(
            `FIXTURE-CATALOG-HASH: ${entry.path} is ${recorded.slice(0, 12)}… but ${CATALOG_FILE} pins ${pinned.slice(0, 12)}… `
              + '(run `pnpm test:fixtures -- --write` after an intentional edit)',
          );
        }
        if (details === undefined) {
          entryProblems.push(`${entry.path} has no validated details; the fixture must validate before the catalog can vouch for it`);
        } else {
          if (details.fixtureId !== entry.fixtureId) {
            entryProblems.push(`${entry.path} declares fixtureId ${details.fixtureId} but the catalog says ${entry.fixtureId}`);
          }
          for (const required of entry.requiredCaseIds) {
            if (!details.caseIds.includes(required)) {
              entryProblems.push(`${entry.path} is missing required case ${required}`);
            }
          }
          groupBinary.set(found.group, (groupBinary.get(found.group) ?? 0) + details.binaryCaseCount);
        }
      } else if (entry.requiredCaseIds.length > 0) {
        entryProblems.push(`${entry.path} is a manifest directory and cannot carry case ids`);
      }
    }
    results.push({
      fixtureDir: `${fixturesRoot}/${entry.path}`,
      fixtureId: entry.fixtureId,
      kind: 'catalog-entry',
      ok: entryProblems.length === 0,
      problems: entryProblems,
    });
  }

  const declared = new Set(catalog.fixtures.map((entry) => entry.path));
  for (const fixture of discovered) {
    if (!declared.has(fixture.path)) {
      results.push({
        fixtureDir: `${fixturesRoot}/${fixture.path}`,
        fixtureId: '<undeclared>',
        kind: 'catalog-entry',
        ok: false,
        problems: [`FIXTURE-CATALOG-INCOMPLETE: ${fixture.path} exists but is not declared in ${CATALOG_FILE}`],
      });
    }
  }

  for (const [group, rule] of Object.entries(catalog.groups)) {
    if (rule.requiresBinaryCase && (groupBinary.get(group) ?? 0) === 0) {
      results.push({
        fixtureDir: `${fixturesRoot}/${group}`,
        fixtureId: `<group:${group}>`,
        kind: 'catalog-group',
        ok: false,
        problems: [`the ${group} group must contain at least one binary-encoded case; JSON cannot represent NaN, so a JSON-only negative set is a false pass`],
      });
    }
  }

  return results;
};

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
  const { fixtures, unknown } = discoverFixtures(root, fixturesRoot);
  const results: FixtureValidation[] = [];
  for (const fixture of fixtures) {
    results.push(
      fixture.layout === 'manifest-directory'
        ? validateFixtureDir(root, fixture.absolutePath)
        : validateStandaloneFixture(root, fixture.absolutePath),
    );
  }
  for (const path of unknown) {
    results.push({
      fixtureDir: `${fixturesRoot}/${path}`,
      fixtureId: '<unknown-layout>',
      kind: '<unknown-layout>',
      ok: false,
      problems: [
        `FIXTURE-LAYOUT-UNKNOWN: neither a fixture directory containing fixture.json nor a standalone .json fixture; the checker refuses to ignore an unrecognised layout`,
      ],
    });
  }
  results.push(...validateCatalog(root, fixturesRoot));
  return results;
};

/**
 * Re-pin a standalone fixture's pinned identity and the catalog's file hashes.
 *
 * `--write` is how an intentional fixture edit is recorded rather than smuggled in: the file keeps its
 * own `configHash` and `protocolVersion`, and the catalog keeps the hash of the final bytes, so the
 * re-pinned state is reproducible from the checked-in sources.
 */
export const writeStandaloneFixtures = (root: string, fixturesRoot: string): string[] => {
  const { fixtures } = discoverFixtures(root, fixturesRoot);
  const changed: string[] = [];
  const probe = protocolProbe(root);
  for (const fixture of fixtures) {
    if (fixture.layout !== 'standalone-json') continue;
    const raw = JSON.parse(readFileSync(fixture.absolutePath, 'utf8')) as Record<string, unknown>;
    raw['configHash'] = probe.configHash;
    raw['protocolVersion'] = probe.protocolVersion;
    const serialised = `${JSON.stringify(raw, null, 2)}\n`;
    if (readFileSync(fixture.absolutePath, 'utf8') !== serialised) {
      writeFileSync(fixture.absolutePath, serialised);
      changed.push(toRepoPath(root, fixture.absolutePath));
    }
  }

  const catalogPath = join(resolve(root, fixturesRoot), CATALOG_FILE);
  if (existsSync(catalogPath)) {
    const catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;
    const entries = Array.isArray(catalogRaw['fixtures']) ? catalogRaw['fixtures'] : [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry['path'] !== 'string') continue;
      if (entry['layout'] !== 'standalone-json') continue;
      const absolute = join(resolve(root, fixturesRoot), entry['path']);
      if (!existsSync(absolute)) continue;
      const digest = sha256File(absolute);
      if (entry['sha256'] !== digest) {
        entry['sha256'] = digest;
        if (!changed.includes(toRepoPath(root, catalogPath))) changed.push(toRepoPath(root, catalogPath));
      }
    }
    const serialised = `${JSON.stringify(catalogRaw, null, 2)}\n`;
    if (readFileSync(catalogPath, 'utf8') !== serialised) writeFileSync(catalogPath, serialised);
  }
  return changed;
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
    const changed = [...writeFixtureManifests(root, fixturesRoot), ...writeStandaloneFixtures(root, fixturesRoot)];
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
