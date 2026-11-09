/**
 * UDG-003 contract suite — Phase 0 group only.
 *
 * Phase 0 assigns one thing: find out whether the pinned Colyseus stack can carry the adopted
 * architecture, and report honestly. This suite therefore *builds what it asserts* — it emits the
 * probe project, executes the emitted JavaScript in separate processes and reads the recorded result
 * files — instead of asserting a description of a run.
 *
 * Two things are deliberately true at the time of writing, and both are asserted rather than waived:
 *
 * - **PH0-B1**: the probe project does not typecheck, because the pinned third-party declarations
 *   reference a DOM-only global (`HeadersInit`), default-import `node:http` under
 *   `esModuleInterop: false`, and contain one generic constraint that TypeScript 5.9.3 rejects. The
 *   inventory below is pinned: the suite fails if the set changes in either direction, so a fix is
 *   as loud as a regression, and nobody can quietly widen the compiler policy to make it disappear.
 * - **PH0-B2**: there is no epoch-renewal API in the pinned set, so the application owns epochs.
 *
 * Nothing here claims a gate. Gate A stays Not Run, and D-7 is decided by the owner from PR-8's
 * recorded observation, not by this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTRACT_TASK_IDS } from '@udg/checks';

import {
  PROBE_FILES,
  PROBE_IDS,
  probeSources,
  runColyseusProbes,
  type ProbeId,
  type ProbeRecord,
  type ProbeRun,
} from '../probes/colyseus-server.probe.js';

const TASK = 'UDG-003';
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const EVIDENCE_DIR = process.env['UDG_EVIDENCE_OUT'];
const EVIDENCE_TASK = process.env['UDG_EVIDENCE_TASK'];
const OWNS_EVIDENCE_RUN = EVIDENCE_DIR !== undefined && EVIDENCE_TASK === TASK;
const PROBE_OUT = process.env['UDG_PROBE_OUT'] ?? join(ROOT, 'artifacts', 'probes');

/**
 * Blocker PH0-B1, recorded exactly as produced on 2026-11-09 at commit 1e9bd1b with the pins in
 * apps/server/package.json. Keyed by declaration file and error code.
 */
const PH0_B1: readonly (readonly [string, string, number])[] = [
  ['@colyseus/better-call/dist/context.d.mts', 'TS2304', 18],
  ['@colyseus/better-call/dist/endpoint.d.mts', 'TS2304', 1],
  ['@colyseus/better-call/dist/error.d.mts', 'TS2304', 3],
  ['@colyseus/core/build/router/node.d.ts', 'TS1192', 1],
  ['@colyseus/sdk/build/HTTP.d.ts', 'TS2304', 1],
  ['@colyseus/sdk/build/HTTP.d.ts', 'TS2344', 2],
  ['@colyseus/ws-transport/build/WebSocketTransport.d.ts', 'TS1192', 1],
];

let run: ProbeRun;
const byId = new Map<ProbeId, ProbeRecord>();

/** Evidence artefacts declare which task and which run they belong to. */
const artefacts = new Map<string, unknown>();

const keepArtefact = (name: string, body: unknown): void => {
  artefacts.set(name, { schemaVersion: 1, taskId: TASK, ...((body ?? {}) as object) });
};

const writeArtefacts = (): void => {
  if (!OWNS_EVIDENCE_RUN) return;
  const directory = resolve(ROOT, EVIDENCE_DIR as string);
  mkdirSync(directory, recursiveDirectory);
  for (const [name, body] of artefacts) writeFileSync(join(directory, name), `${JSON.stringify(body, null, 2)}\n`);
};

const recursiveDirectory = { recursive: true } as const;

beforeAll(() => {
  run = runColyseusProbes(ROOT, PROBE_OUT);
  for (const record of run.probes) byId.set(record.id, record);

  keepArtefact('probe-results.json', {
    outDir: relative(ROOT, PROBE_OUT),
    probes: run.probes.map((record) => ({
      id: record.id,
      subject: record.subject,
      command: record.command,
      exitCode: record.exitCode,
      ok: record.result?.ok ?? false,
      checks: record.result?.checks ?? [],
      observations: record.result?.observations ?? {},
      limitations: record.result?.limitations ?? [],
      failureDetail: record.failureDetail,
    })),
  });
  keepArtefact('probe-project-typecheck.json', {
    command: run.typecheck.command,
    exitCode: run.typecheck.exitCode,
    blocker: 'PH0-B1',
    repositoryDiagnostics: run.repositoryDiagnostics,
    thirdPartyDiagnostics: run.thirdPartyDiagnostics,
    pinnedInventory: PH0_B1.map(([file, code, count]) => ({ file, code, count })),
  });
  keepArtefact('dependency-graph.json', byId.get('PR-1')?.result?.observations ?? {});
}, 900_000);

afterAll(() => {
  writeArtefacts();
});

const observation = <T>(id: ProbeId, key: string): T => {
  const record = byId.get(id);
  const value = record?.result?.observations[key];
  return value as T;
};

/** Strip pnpm's virtual-store prefix so a diagnostic is identified by its package-relative file. */
const packageRelative = (relativeFile: string): string => {
  const marker = 'node_modules/';
  const index = relativeFile.lastIndexOf(marker);
  return index === -1 ? relativeFile : relativeFile.slice(index + marker.length);
};

const describeInventory = (entries: readonly { readonly relativeFile: string; readonly code: string }[]): string => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${packageRelative(entry.relativeFile)}|${entry.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => `${key} x${String(count)}`).sort().join('\n');
};

describe('UDG-003 Phase 0 — probe harness', () => {
  it('runs the assigned probe ids and nothing else', () => {
    expect(PROBE_IDS).toEqual(['PR-0', 'PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12']);
    expect(run.probes.map((record) => record.id)).toEqual([...PROBE_IDS]);
  });

  it('emits the probe project so the assertions below are about executed code', () => {
    expect(run.emit.exitCode, `emit failed: ${run.emit.stdout}${run.emit.stderr}`).toBe(0);
    for (const id of PROBE_IDS) {
      const emitted = join(ROOT, 'apps', 'server', 'probes', 'dist', 'probes', PROBE_FILES[id]);
      expect(existsSync(emitted), `${id} emitted file ${emitted}`).toBe(true);
    }
  });

  it('writes each result file where the index says it is', () => {
    for (const record of run.probes) {
      expect(existsSync(record.resultPath), `${record.id} result`).toBe(true);
      expect(record.result, `${record.id} result parses`).toBeDefined();
    }
  });
});

describe('UDG-003 Phase 0 — PR-0 compiler policy and blocker PH0-B1', () => {
  it('keeps the shared compiler policy unrelaxed for the probe project', () => {
    const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };
    const probe = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'tsconfig.probes.json'), 'utf8')) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
    };
    expect(probe.extends).toBe('../../tsconfig.base.json');
    expect(base.compilerOptions['strict']).toBe(true);
    expect(base.compilerOptions['noImplicitAny']).toBe(true);
    expect(base.compilerOptions['exactOptionalPropertyTypes']).toBe(true);
    expect(base.compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(base.compilerOptions['skipLibCheck']).toBe(false);
    expect(base.compilerOptions['esModuleInterop']).toBe(false);
    // Relaxing these is the owner's D-2 decision, not this suite's.
    for (const flag of ['skipLibCheck', 'allowSyntheticDefaultImports', 'noImplicitAny', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'esModuleInterop']) {
      expect(probe.compilerOptions?.[flag], `probe project must not set ${flag}`).toBeUndefined();
    }
    // `--noCheck` appears only in the emit command, never in a config file.
    const serverManifest = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const noCheckInConfig = ['tsconfig.json', 'tsconfig.probes.json'].some((name) =>
      readFileSync(join(ROOT, 'apps', 'server', name), 'utf8').includes('noCheck'),
    );
    expect(noCheckInConfig, '--noCheck must stay visible on a command line, not hidden in a config').toBe(false);
    expect(serverManifest.scripts?.['build:probes']).toContain('--noCheck');
    expect(serverManifest.scripts?.['typecheck:probes']).toContain('--noEmit');
  });

  it('has no first-party type errors of its own', () => {
    expect(
      run.repositoryDiagnostics.map((d) => `${d.relativeFile}(${String(d.line)},${String(d.column)}) ${d.code}: ${d.message}`),
    ).toEqual([]);
  });

  it('records third-party declaration failures as the pinned blocker PH0-B1', () => {
    expect(run.typecheck.exitCode, 'PH0-B1 is open, so a clean typecheck would mean the inventory below is stale').not.toBe(0);
    const inventory = describeInventory(run.thirdPartyDiagnostics);
    const expected = PH0_B1.map(([file, code, count]) => `${file}|${code} x${String(count)}`).sort().join('\n');
    expect(inventory).toBe(expected);
    // Every diagnostic is inside an installed declaration file: nothing is being blamed on the repo.
    for (const diagnostic of run.thirdPartyDiagnostics) {
      expect(diagnostic.file).toContain('node_modules');
      expect(diagnostic.relativeFile).toMatch(/\.d\.(ts|mts)$/);
      expect(packageRelative(diagnostic.relativeFile)).toMatch(/^@colyseus\//);
    }
  });

  it('names PH0-B1 causes so the owner can decide a remedy', () => {
    const byCode = new Map<string, Set<string>>();
    for (const diagnostic of run.thirdPartyDiagnostics) {
      const bucket = byCode.get(diagnostic.code) ?? new Set<string>();
      bucket.add(diagnostic.message);
      byCode.set(diagnostic.code, bucket);
    }
    expect([...byCode.keys()].sort()).toEqual(['TS1192', 'TS2304', 'TS2344']);
    // Three causes, each mapping to a decision the owner owns rather than this suite: a DOM-only
    // global that `lib: ["ES2024"]` deliberately excludes; a default import of a builtin that
    // `esModuleInterop: false` rejects; and a declaration that fails its own constraint. Recorded in
    // docs/integration/colyseus-0.18-api-map.md 5.
    expect([...(byCode.get('TS2304') ?? [])]).toEqual(["Cannot find name 'HeadersInit'."]);
    expect([...(byCode.get('TS1192') ?? [])]).toEqual(['Module \'"http"\' has no default export.']);
    const constraint = [...(byCode.get('TS2344') ?? [])];
    expect(constraint.length).toBe(1);
    expect(constraint[0]).toContain('UnionToIntersection<MethodOptions<API');
    expect(constraint[0]).toContain('does not satisfy the constraint');
  });

  it('reports each probe as passing on its own terms', () => {
    const failures = run.probes.flatMap((record) =>
      record.result === undefined
        ? [`${record.id}: ${record.failureDetail ?? 'no result'}`]
        : record.result.ok
          ? []
          : record.result.checks.filter((check) => !check.ok).map((check) => `${record.id} ${check.name} :: ${check.detail}`),
    );
    expect(failures).toEqual([]);
  });
});

describe('UDG-003 Phase 0 — PR-1 resolved graph', () => {
  it('resolves exactly one @colyseus/schema runtime for every consumer', () => {
    const resolution = observation<{ consumer: string; path: string; version: string }[]>('PR-1', 'schemaResolution');
    expect(resolution.map((entry) => entry.consumer).sort()).toEqual(
      ['@colyseus/core', '@colyseus/sdk', '@colyseus/ws-transport', '@udg/protocol'].sort(),
    );
    expect(new Set(resolution.map((entry) => entry.path)).size).toBe(1);
    expect(new Set(resolution.map((entry) => entry.version))).toEqual(new Set(['5.0.45']));
  });

  it('pins the schema version the accepted UDG-002 declaration used', () => {
    expect(observation<string[]>('PR-1', 'lockfileSchemaVersions')).toEqual(['5.0.45']);
    expect(observation<string[]>('PR-1', 'storeSchemaEntries').length).toBeGreaterThan(0);
  });

  it('denies every dependency build script and names the native extractor', () => {
    const policy = observation<{ topLevelKeys: string[]; allowBuildsEntries: string[] }>('PR-1', 'buildScriptPolicy');
    expect(policy.topLevelKeys).not.toContain('onlyBuiltDependencies');
    expect(policy.allowBuildsEntries).toEqual(['msgpackr-extract: false']);
  });

  it('records the transitive runtime packages and their licences', () => {
    const transitive = observation<{ name: string; version: string; licence: string | null }[]>('PR-1', 'transitiveRuntime');
    const names = transitive.map((entry) => entry.name).sort();
    expect(names).toEqual(['@colyseus/shared-types', 'debug', 'express', 'msgpackr', 'ws']);
    for (const entry of transitive) expect(entry.licence, entry.name).not.toBeNull();
  });

  it('keeps undeclared packages invisible to the server workspace, and declared ones visible', () => {
    const environment = observation<{
      nodePath: string | null;
      visibility: { name: string; declared: boolean; resolvesWithoutAmbientPaths: boolean }[];
    }>('PR-1', 'resolutionEnvironment');
    const entries = environment.visibility;
    const visible = entries.filter((entry) => entry.resolvesWithoutAmbientPaths).map((entry) => entry.name).sort();
    const invisible = entries.filter((entry) => !entry.resolvesWithoutAmbientPaths).map((entry) => entry.name).sort();
    expect(visible).toEqual(['@colyseus/core', '@colyseus/sdk', '@colyseus/ws-transport', '@udg/protocol']);
    expect(invisible).toEqual(['@colyseus/schema', 'express', 'msgpackr']);
    // Visibility must track the manifest exactly; anything else means an import the register does not own.
    for (const entry of entries) {
      expect(entry.resolvesWithoutAmbientPaths, `${entry.name} visibility vs declaration`).toBe(entry.declared);
    }
  });
});

describe('UDG-003 Phase 0 — PR-2 fixed step', () => {
  it('steps at the advertised dt from the public facility', () => {
    const contexts = observation<{ dt: number; dtMs: number; tick: number; subSteps: number }[]>('PR-2', 'firstContexts');
    expect(observation<number[]>('PR-2', 'distinctDtValues')).toEqual([0.05]);
    expect(contexts[0]).toMatchObject({ dt: 0.05, dtMs: 50, tick: 0 });
    expect(observation<number>('PR-2', 'observedRateHz')).toBeGreaterThan(19);
    expect(observation<number>('PR-2', 'observedRateHz')).toBeLessThan(21);
    expect(observation<number>('PR-2', 'patchRateMs')).toBe(50);
  });

  it('offers no measured wall-clock delta, so authority code cannot drift with the host clock', () => {
    const names = ['dt', 'dtMs', 'tick', 'subSteps', 'subDt'];
    const context = observation<Record<string, unknown>>('PR-2', 'firstContexts')[0] as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual([...names].sort());
  });
});

describe('UDG-003 Phase 0 — PR-3 input declaration and codec', () => {
  it('declares the adopted five fields in order', () => {
    const record = byId.get('PR-3');
    const detail = (record?.result?.checks.find((check) => check.name === 'declaration-is-the-adopted-one')?.detail ?? '')
      .replaceAll(', ', ',');
    expect(detail).toContain('sessionEpoch,generation,directIntent,moveX,moveZ');
  });

  it('preserves all five values through the wire codec', () => {
    const record = byId.get('PR-3');
    const names = ['all-five-fields-preserved', 'float64-carries-exactly', 'neutral-frame-preserved'];
    for (const name of names) {
      expect(record?.result?.checks.find((check) => check.name === name)?.ok, `${name}: ${record?.result?.checks.find((c) => c.name === name)?.detail}`).toBe(true);
    }
  });

  it('truncates out-of-domain wire values and lets the validator, not the schema, refuse them', () => {
    const sent = observation<{ sessionEpoch: number; generation: number; moveZ: number | null }>('PR-3', 'hostileWireSent');
    const decoded = observation<{ sessionEpoch: number; generation: number; moveZ: number | null }>('PR-3', 'hostileWireDecoded');
    expect(sent.sessionEpoch).toBe(2 ** 32 + 7);
    expect(decoded.sessionEpoch).toBe(7);
    expect(decoded.generation).toBe(1);
    expect(decoded.moveZ).toBeNull();
    expect(observation<string>('PR-3', 'hostileValidatorOutcome')).toBe('INVALID_PAYLOAD');
  });
});

describe('UDG-003 Phase 0 — PR-8 acknowledgement semantics (D-7 evidence)', () => {
  it('does not acknowledge a frame that was merely received', () => {
    const buffered = observation<{ serverConsumed: number; clientLastProcessed: number; clientSent: number }>('PR-8', 'S1_bufferedNotConsumed');
    expect(buffered.clientSent).toBe(3);
    expect(buffered.serverConsumed).toBe(0);
    expect(buffered.clientLastProcessed).toBe(0);
  });

  it('acknowledges a frame that was consumed, even when the application then refused it', () => {
    const refused = observation<{ serverConsumed: number; clientLastProcessed: number; refusedWasRecorded: boolean }>('PR-8', 'S3_consumedThenRefused');
    expect(refused.refusedWasRecorded).toBe(true);
    expect(refused.serverConsumed).toBe(1);
    expect(refused.clientLastProcessed).toBe(1);
  });

  it('does not acknowledge frames the buffer dropped', () => {
    expect(observation<boolean>('PR-8', 'S4-droppedFramesAcked')).toBe(false);
  });

  it('does not acknowledge a synthesised idle frame', () => {
    const idle = observation<{ serverBefore: number; serverAfter: number; clientBefore: number; clientAfter: number }>('PR-8', 'S5_idleSynthesis');
    expect(idle).toMatchObject({ serverBefore: 0, serverAfter: 0, clientBefore: 0, clientAfter: 0 });
  });

  it('answers D-7 with what the counter actually tracks', () => {
    expect(observation<string>('PR-8', 'acknowledgementTracks')).toBe('consumed');
    const answer = observation<{
      tracksConsumed: boolean;
      distinguishesAppliedFromConsumed: boolean;
      publicApiToWithholdOrRetract: string;
    }>('PR-8', 'd7Answer');
    expect(answer.tracksConsumed).toBe(true);
    expect(answer.distinguishesAppliedFromConsumed).toBe(false);
    expect(answer.publicApiToWithholdOrRetract).toContain('none found');
  });
});

describe('UDG-003 Phase 0 — PR-12 epoch and identity (blocker PH0-B2)', () => {
  it('has no public epoch-renewal declaration', () => {
    const hits = observation<string[]>('PR-12', 'epochDeclarations');
    expect(hits.filter((entry) => entry.includes(': decl ')).map((entry) => entry.split(': decl ')[1])).toEqual(['readonly epoch: number;']);
  });

  it('treats the input handle epoch as a client-side reset counter, not a session epoch', () => {
    expect(observation<{ before: number; after: number }>('PR-12', 'inputHandleEpoch')).toMatchObject({ before: 0, after: 1 });
  });

  it('reconnection preserves the session identity, which is the opposite of renewing an epoch', () => {
    expect(observation<boolean>('PR-12', 'reconnectPreservesIdentity')).toBe(true);
    expect(observation<number>('PR-12', 'serverSideReconnections')).toBe(1);
    expect(observation<string | null>('PR-12', 'reconnectError')).toBeNull();
  });

  it('issues a distinct identity per join, the primitive an application-level epoch must hang off', () => {
    const record = byId.get('PR-12');
    expect(record?.result?.checks.find((check) => check.name === 'new-session-yields-a-new-identity')?.ok).toBe(true);
  });

  it('records only that a reconnection token exists, never its value', () => {
    const serialized = JSON.stringify(byId.get('PR-12')?.result ?? {});
    const tokenSerialised = /"reconnectionToken"\s*:\s*"[^"]+"/.test(serialized);
    expect(tokenSerialised, 'a reconnection token must never reach evidence').toBe(false);
  });
});

describe('UDG-003 Phase 0 — boundary and evidence hygiene', () => {
  it('keeps the probe tree free of escape hatches and private package paths', () => {
    const sources = probeSources(ROOT);
    expect(sources.length).toBeGreaterThan(0);
    const directive = '@' + 'ts-';
    const anyPattern = new RegExp([':', '\\s*an', 'y\\b|\\bas an', 'y\\b|<an', 'y>|\\ban', 'y\\[\\]'].join(''));
    const offenders: string[] = [];
    for (const source of sources) {
      if (anyPattern.test(source.text)) offenders.push(`${source.path}: any in a type position`);
      for (const marker of [`${directive}ignore`, `${directive}expect-error`, `${directive}nocheck`, 'as ' + 'unknown as', 'eslint-' + 'disable']) {
        if (source.text.includes(marker)) offenders.push(`${source.path}: ${marker}`);
      }
      if (new RegExp('@colyseus' + '/[a-z-]+/(build|src)/').test(source.text)) offenders.push(`${source.path}: private package path`);
    }
    expect(offenders).toEqual([]);
  });

  it('gives the probe entry point no third-party import', () => {
    const text = readFileSync(join(ROOT, 'tests', 'probes', 'colyseus-server.probe.ts'), 'utf8');
    const specifiers = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:'), specifier).toBe(true);
    }
  });

  it('ships no server behaviour in Phase 0', () => {
    const source = readFileSync(join(ROOT, 'apps', 'server', 'src', 'index.ts'), 'utf8');
    expect(source).toContain('export {};');
    expect(source).not.toContain('@colyseus');
  });

  it('documents every assigned probe in the api map, with files that exist', () => {
    const mapPath = join(ROOT, 'docs', 'integration', 'colyseus-0.18-api-map.md');
    expect(existsSync(mapPath), 'the api map is a Phase 0 deliverable').toBe(true);
    const map = readFileSync(mapPath, 'utf8');
    for (const id of PROBE_IDS) expect(map.includes(id), `api map row for ${id}`).toBe(true);
    const citedProbes = [...map.matchAll(/`(apps\/server\/probes\/[^`]+\.ts)`/g)].map((match) => match[1] ?? '');
    expect(citedProbes.length).toBeGreaterThan(0);
    for (const path of citedProbes) expect(existsSync(join(ROOT, path)), `api map cites ${path}`).toBe(true);
    const citedDocs = [...map.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`/g)].map((match) => match[1] ?? '');
    expect(citedDocs.length).toBeGreaterThan(0);
    for (const path of citedDocs) expect(existsSync(join(ROOT, path)), `api map cites ${path}`).toBe(true);
    for (const id of PROBE_IDS) {
      const file = PROBE_FILES[id].replace('.js', '.ts');
      expect(citedProbes, `api map cites the module for ${id}`).toContain(`apps/server/probes/${file}`);
    }
    expect(map).toContain('PH0-B1');
    expect(map).toContain('PH0-B2');
    expect(map).toContain('provisional');
  });

  it('writes probe evidence only when this task owns the run', () => {
    const index = JSON.parse(readFileSync(join(PROBE_OUT, 'probe-run-index.json'), 'utf8')) as { probes: { id: string; ok: boolean }[] };
    expect(index.probes.map((probe) => probe.id)).toEqual([...PROBE_IDS]);
    expect(index.probes.every((probe) => probe.ok)).toBe(true);

    if (!OWNS_EVIDENCE_RUN) {
      // A run this task does not own must not receive this task's artefacts.
      expect(EVIDENCE_TASK === TASK && EVIDENCE_DIR !== undefined).toBe(false);
      return;
    }
    const directory = resolve(ROOT, EVIDENCE_DIR as string);
    for (const name of ['probe-results.json', 'probe-project-typecheck.json', 'dependency-graph.json']) {
      const path = join(directory, name);
      expect(existsSync(path), name).toBe(true);
      const body = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion: number; taskId: string };
      expect(body.taskId, name).toBe(TASK);
      expect(body.schemaVersion, name).toBe(1);
    }
  });

  it('is a task id the dispatcher accepts', () => {
    expect(CONTRACT_TASK_IDS).toContain(TASK);
  });
});
