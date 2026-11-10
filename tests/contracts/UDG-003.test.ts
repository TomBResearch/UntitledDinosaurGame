/**
 * UDG-003 contract suite — Phase 0 group only.
 *
 * Phase 0 assigns one thing: find out whether the pinned Colyseus stack can carry the adopted
 * architecture, and report honestly. This suite therefore *builds what it asserts* — it emits the
 * probe project, executes the emitted JavaScript in separate processes and reads the recorded result
 * files — instead of asserting a description of a run.
 *
 * One rule governs this file: **a diagnostic suite that reproduces a failure has not established
 * compatibility.** Five probes measuring real behaviour on emitted JavaScript is not a working stack, so
 * the compiler verdict is carried separately and asserted separately:
 *
 * - **PH0-B1** is **closed by exception, not by a fix**. The pinned third-party declarations reference a
 *   DOM-only global (`HeadersInit`), default-import `node:http` under `esModuleInterop: false`, and contain
 *   one generic constraint TypeScript rejects. [ADR-0002](../../docs/adr/0002-server-declaration-checking-exception.md)
 *   accepts `skipLibCheck: true` for `apps/server/tsconfig.json` and `apps/server/tsconfig.probes.json` only,
 *   so **PR-0 now claims exactly one thing**: first-party code typechecks against the pinned declarations
 *   under that documented exception. What this file used to prove about the vendor defects is retained in a
 *   different place: the retained full check (`typecheck:probes:full`) still produces them, the inventory
 *   below is pinned in **both** documents - here and
 *   `docs/integration/colyseus-declaration-inventory.json` - and PR-0 fails if the two ever disagree, so an
 *   added vendor defect stays a build failure even though the accepted gate no longer sees it.
 *   `stackCompatibility` stays **not-established**: ADR-0002 changes what the compiler looks at, not whether
 *   the stack works. `--noCheck` still appears on an explicit emit command only and is excluded from `build`.
 * - **PH0-B2** is **reclassified, not a blocker**: `sessionEpoch` is a UDG protocol concept that UDG
 *   owns. Colyseus 0.18 has no epoch concept and is not expected to have one, so this is a design
 *   obligation for Phase 2, not a library defect. PR-12 records the supported lifecycle primitives, the
 *   renewal procedure still required, and what remains unproved.
 *
 * Nothing here claims a gate. Gate A stays Not Run, and D-7 is decided by the owner from PR-8's
 * identity-level evidence, not by this file.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTRACT_TASK_IDS } from '@udg/checks';

import {
  PROBE_FILES,
  PROBE_IDS,
  probeSources,
  runColyseusProbes,
  stripNonCode,
  type ProbeId,
  type ProbeRecord,
  type ProbeRun,
} from '../probes/colyseus-server.probe.js';

const TASK = 'UDG-003';
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const EVIDENCE_DIR = process.env['UDG_EVIDENCE_OUT'];
const EVIDENCE_TASK = process.env['UDG_EVIDENCE_TASK'];
const OWNS_EVIDENCE_RUN = EVIDENCE_DIR !== undefined && EVIDENCE_TASK === TASK;
// Relative is what a workflow step naturally writes (UDG_PROBE_OUT=artifacts/probes), and the probes
// run with a different working directory than the suite, so the value is anchored here once.
const PROBE_OUT = resolve(ROOT, process.env['UDG_PROBE_OUT'] ?? join('artifacts', 'probes'));

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
      verdict: record.result?.verdict ?? (record.result === undefined ? 'error' : record.result.ok ? 'pass' : 'fail'),
      blockedReason: record.result?.blockedReason,
      checks: record.result?.checks ?? [],
      observations: record.result?.observations ?? {},
      limitations: record.result?.limitations ?? [],
      failureDetail: record.failureDetail,
    })),
  });
  keepArtefact('probe-project-typecheck.json', {
    command: run.typecheck.command,
    exitCode: run.typecheck.exitCode,
    compilerPolicy: 'ADR-0002 exception (skipLibCheck: true) in the two apps/server projects only',
    history: 'PH0-B1 closed by exception, not by a fix; the defects below are still produced by the retained full check',
    fullCheckCommand: run.fullCheck.command,
    fullCheckExitCode: run.fullCheck.exitCode,
    repositoryDiagnostics: run.repositoryDiagnostics,
    thirdPartyDiagnostics: run.thirdPartyDiagnostics,
    firstPartyDeclarationCheck: { command: run.declarations.command, exitCode: run.declarations.exitCode },
    pinnedInventory: PH0_B1.map(([file, code, count]) => ({ file, code, count })),
  });
  keepArtefact('compatibility-verdict.json', run.compatibility);
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
  it('runs the assigned probe ids plus the authorised overflow investigation, and nothing else', () => {
    expect(PROBE_IDS).toEqual(['PR-0', 'PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12', 'PR-13']);
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
  it('keeps the shared compiler policy, with ADR-0002 as its only server-scoped exception', () => {
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
    // Everything except the approved exception stays unrelaxed. Widening it further is the owner's decision,
    // not this suite's.
    for (const flag of ['allowSyntheticDefaultImports', 'noImplicitAny', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'esModuleInterop']) {
      expect(probe.compilerOptions?.[flag], `probe project must not set ${flag}`).toBeUndefined();
    }
    // ADR-0002 is the only setting the two server projects may set, and only with the ADR named beside it.
    for (const name of ['tsconfig.json', 'tsconfig.probes.json']) {
      const text = readFileSync(join(ROOT, 'apps', 'server', name), 'utf8');
      expect(text, `apps/server/${name} must apply the approved exception`).toContain('"skipLibCheck": true');
      expect(text, `apps/server/${name} must name ADR-0002 where it relaxes the policy`).toContain('ADR-0002');
      expect(text, 'DOM globals remain prohibited (D-12)').not.toMatch(/"DOM(\.Iterable)?"/);
    }
    // The repository's whole exception surface: two server projects under ADR-0002, plus the root tooling
    // project under UDG-001 decision D1 (playwright-core/vitest declarations). A fourth is a policy change.
    const excepted = [
      'tsconfig.json',
      'tsconfig.base.json',
      'tsconfig.declarations.json',
      'apps/server/tsconfig.json',
      'apps/server/tsconfig.probes.json',
    ].filter((name) => readFileSync(join(ROOT, name), 'utf8').includes('"skipLibCheck": true'));
    expect(excepted.sort()).toEqual(['apps/server/tsconfig.json', 'apps/server/tsconfig.probes.json', 'tsconfig.json']);
    // `--noCheck` appears only in the emit command, never in a config file.
    const serverManifest = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const noCheckInConfig = ['tsconfig.json', 'tsconfig.probes.json'].some((name) =>
      readFileSync(join(ROOT, 'apps', 'server', name), 'utf8').includes('noCheck'),
    );
    expect(noCheckInConfig, '--noCheck must stay visible on a command line, not hidden in a config').toBe(false);
    expect(serverManifest.scripts?.['build:probes']).toContain('--noCheck');
    expect(serverManifest.scripts?.['typecheck:probes']).toContain('--noEmit');
  });

  it('keeps --noCheck out of the accepted build path', () => {
    const serverManifest = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    // `build` is what CI runs and what a release would ship. Unchecked probe JavaScript must never be
    // part of it; it exists only so the measurement probes can run while PH0-B1 is open.
    expect(serverManifest.scripts?.['build'] ?? '', 'the accepted build path must not contain --noCheck').not.toContain('--noCheck');
    expect(serverManifest.scripts?.['build'] ?? '').toContain('tsc -p tsconfig.json');
    expect(serverManifest.scripts?.['build:probes'] ?? '').toContain('--noCheck');
  });

  it('has no first-party type errors of its own', () => {
    expect(
      run.repositoryDiagnostics.map((d) => `${d.relativeFile}(${String(d.line)},${String(d.column)}) ${d.code}: ${d.message}`),
    ).toEqual([]);
  });

  it('still produces the vendor declaration defects through the retained full check', () => {
    // The accepted gate no longer looks inside declarations; the retained check does, and must still find
    // exactly what was recorded. A clean full check would mean the pins moved and nobody updated the record.
    expect(run.typecheck.exitCode, 'the accepted gate passes under ADR-0002').toBe(0);
    expect(run.fullCheck.exitCode, 'the retained full check must still fail, or these defects are gone and the record is stale').not.toBe(0);
    const inventory = describeInventory(run.thirdPartyDiagnostics);
    const expected = PH0_B1.map(([file, code, count]) => `${file}|${code} x${String(count)}`).sort().join('\n');
    expect(inventory).toBe(expected);
    // The same inventory is pinned in a document PR-0 compares against, so suite and probe cannot drift.
    const pinnedPath = join(ROOT, 'docs', 'integration', 'colyseus-declaration-inventory.json');
    expect(existsSync(pinnedPath), 'the pinned declaration inventory is an ADR-0002 condition').toBe(true);
    const pinned = JSON.parse(readFileSync(pinnedPath, 'utf8')) as {
      adr: string;
      totalDiagnostics: number;
      entries: { origin: string; code: string; count: number }[];
    };
    expect(pinned.adr).toContain('0002');
    expect(pinned.totalDiagnostics).toBe(27);
    const fromDocument = pinned.entries
      .map((entry) => `${entry.origin.split('::')[1] ?? entry.origin}|${entry.code} x${String(entry.count)}`)
      .sort()
      .join('\n');
    expect(fromDocument).toBe(expected);
    // UDG's own emitted declarations keep a strict check that never imports the problematic stack.
    expect(run.declarations.exitCode, 'UDG-owned declarations must typecheck under skipLibCheck: false').toBe(0);
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

  it('reports every probe but PR-0 as passing on its own terms', () => {
    const failures = run.probes
      .filter((record) => record.id !== 'PR-0')
      .flatMap((record) =>
        record.result === undefined
          ? [`${record.id}: ${record.failureDetail ?? 'no result'}`]
          : record.result.ok
            ? []
            : record.result.checks.filter((check) => !check.ok).map((check) => `${record.id} ${check.name} :: ${check.detail}`),
      );
    expect(failures).toEqual([]);
  });

  it('reports PR-0 as passing on its restated claim, and never beyond it', () => {
    const record = byId.get('PR-0');
    expect(record?.result, 'PR-0 must produce a result file').toBeDefined();
    const result = record?.result as NonNullable<ProbeRecord['result']>;
    expect(result.verdict).toBe('pass');
    expect(result.ok).toBe(true);
    // The claim itself, in the probe's own words, next to the list of things it refuses to claim.
    const gate = JSON.stringify(result.observations['acceptedGate']);
    expect(gate).toContain('first-party code typechecks against the pinned declarations');
    expect(gate).toContain('runtime behaviour, reconciliation or transport compatibility follows from compilation');
    expect(gate).toContain('apps/client');
    expect(result.observations['acceptedGate']).toMatchObject({ exitCode: 0, inRepositoryCode: 0, diagnostics: 0 });
    // The vendor defects are still measured, and still equal to the pinned document.
    expect(result.observations['fullDeclarationCheck']).toMatchObject({ totalDiagnostics: 27, inRepositoryCode: 0, inThirdPartyDeclarations: 27 });
    expect(result.observations['udgEmittedDeclarations']).toMatchObject({ exitCode: 0, diagnostics: 0 });
    const names = result.checks.map((check) => check.name);
    for (const required of [
      'accepted-typecheck-passes-under-the-exception',
      'exception-confined-to-the-approved-projects',
      'adr-0002-tags-exactly-its-two-projects',
      'exception-projects-name-the-adr-and-load-no-dom-lib',
      'exception-projects-use-no-suppression-or-shims',
      'vendor-declaration-inventory-matches-the-pinned-inventory',
      'the-exception-hides-no-repository-diagnostics',
      'udg-emitted-declarations-typecheck-with-skiplibcheck-false',
    ]) {
      expect(names, `PR-0 must assert ${required}`).toContain(required);
    }
    expect(result.checks.filter((check) => !check.ok).map((check) => `${check.name} :: ${check.detail}`)).toEqual([]);
    // The superseded posture must not survive as a hidden assertion: PR-0 no longer claims the vendor
    // declarations compile, and it must not be readable as though it did.
    expect(names).not.toContain('strict-typecheck-passes');
    expect(names).not.toContain('compatibility-blocked');
    expect(result.blockedReason).toBeUndefined();
  });

  it('publishes a compatibility verdict that a compiler exception cannot turn into a compatibility claim', () => {
    expect(run.compatibility.stackCompatibility, 'a compiler-policy exception is not a compatibility result').toBe('not-established');
    expect(run.compatibility.pr0).toBe('pass');
    expect(run.compatibility.acceptedGate.exitCode).toBe(0);
    expect(run.compatibility.acceptedGate.diagnostics.total).toBe(0);
    expect(run.compatibility.fullDeclarationCheck.totalDiagnostics).toBe(27);
    expect(run.compatibility.fullDeclarationCheck.exitCode).not.toBe(0);
    expect(run.compatibility.firstPartyDeclarations.exitCode).toBe(0);
    expect(run.compatibility.compilerPolicy.approvedProjects).toEqual([
      'apps/server/tsconfig.json',
      'apps/server/tsconfig.probes.json',
    ]);
    expect(run.compatibility.acceptedBuildPath).toContain('build');
    expect(run.compatibility.acceptedBuildPath).not.toContain('--noCheck');
    expect(run.compatibility.diagnosticEmission).toContain('--noCheck');
    expect(run.compatibility.probes.find((probe) => probe.id === 'PR-0')?.verdict).toBe('pass');
    const verdictPath = join(PROBE_OUT, 'compatibility-verdict.json');
    expect(existsSync(verdictPath), 'the machine-readable verdict is a deliverable').toBe(true);
    const written = JSON.parse(readFileSync(verdictPath, 'utf8')) as {
      taskId: string;
      stackCompatibility: string;
      pr0: string;
      reading: string;
      acceptedGate: { claim: string; notClaimed: string[] };
    };
    expect(written.taskId).toBe(TASK);
    expect(written.stackCompatibility).toBe('not-established');
    expect(written.pr0).toBe('pass');
    expect(written.reading).toContain('not-established');
    expect(written.acceptedGate.notClaimed.join(' ')).toContain('runtime behaviour');
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

describe('UDG-003 Phase 0 — PR-8 acknowledgement semantics, traced by frame identity (D-7 evidence)', () => {
  it('does not acknowledge a frame that was merely received', () => {
    const buffered = observation<{
      sent: { seq: number; generation: number }[];
      pendingGenerations: number[];
      serverConsumedCount: number;
      clientLastProcessed: number;
      clientSent: number;
      appliedKinds: string[];
    }>('PR-8', 'S1_bufferedNotConsumed');
    expect(buffered.clientSent).toBe(3);
    expect(buffered.sent.map((entry) => entry.generation)).toEqual([1, 2, 3]);
    expect(buffered.pendingGenerations).toEqual([1, 2, 3]);
    expect(buffered.serverConsumedCount).toBe(0);
    expect(buffered.clientLastProcessed).toBe(0);
    expect(buffered.appliedKinds).toEqual([]);
  });

  it('acknowledges the frame the room applied, and names that frame by sequence', () => {
    const applied = observation<{
      serverConsumedCount: number;
      clientLastProcessed: number;
      appliedLog: { kind: string; generation: number; seq: number }[];
      retiredGenerations: number[];
      stillPendingGenerations: number[];
    }>('PR-8', 'S2_consumedAndApplied');
    expect(applied.appliedLog.at(-1)).toMatchObject({ kind: 'frame', generation: 1 });
    expect(applied.clientLastProcessed).toBe(1);
    expect(applied.retiredGenerations).toEqual([1]);
    expect(applied.stillPendingGenerations).toEqual([2, 3]);
  });

  it('acknowledges a consumed frame the application refused, while state still advanced on neutral input', () => {
    const refused = observation<{
      serverConsumedCount: number;
      clientLastProcessed: number;
      refusedWasRecorded: boolean;
      refusedGeneration: number;
      appliedLog: { kind: string; generation: number }[];
    }>('PR-8', 'S3_consumedThenRefused');
    expect(refused.refusedWasRecorded).toBe(true);
    expect(refused.serverConsumedCount).toBe(1);
    expect(refused.clientLastProcessed).toBe(1);
    // A refusal is not a no-step: the authoritative neutral input advanced state in its place.
    expect(refused.appliedLog.at(-1)).toMatchObject({ kind: 'neutral', generation: refused.refusedGeneration });
    expect(refused.appliedLog.at(-1)?.generation).toBe(1);
  });

  it('has no public surface that withholds or retracts an acknowledgement', () => {
    expect(observation<string[]>('PR-8', 'inputHandleAckRelatedMembers')).toEqual([]);
    expect(observation<number>('PR-8', 'inputHandleMemberCount')).toBeGreaterThan(0);
  });

  it('traces overflow by identity: the evicted frames are retired by the ack and never represented in state', () => {
    const overflow = observation<{
      bufferMaxSize: number;
      sent: { seq: number; generation: number }[];
      pendingGenerations: number[];
      serverConsumedCount: number;
      clientLastProcessed: number;
      clientSent: number;
      clientPendingCount: number;
      applicationConsumeCalls: number;
      retiredByWatermark: number[];
      stillUnacked: number[];
      clientReplayableGenerations: number[];
      appliedLog: unknown[];
    }>('PR-8', 'S4_overflowIdentityTrace');
    expect(overflow.sent.map((entry) => entry.generation)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(overflow.bufferMaxSize).toBe(2);
    expect(overflow.pendingGenerations).toEqual([5, 6]);
    // Nothing was consumed by the application, so every retirement came from overflow eviction.
    expect(overflow.applicationConsumeCalls).toBe(0);
    expect(overflow.serverConsumedCount).toBe(4);
    expect(overflow.clientLastProcessed).toBe(4);
    expect(overflow.retiredByWatermark).toEqual([1, 2, 3, 4]);
    expect(overflow.stillUnacked).toEqual([5, 6]);
    expect(overflow.clientPendingCount).toBe(overflow.clientSent - overflow.clientLastProcessed);
    expect(observation<number[]>('PR-8', 'S4_droppedByOverflow')).toEqual([1, 2, 3, 4]);
    expect(overflow.appliedLog).toEqual([]);
    // The client prunes on the watermark alone: it cannot tell a dropped frame from an applied one.
    expect(overflow.clientReplayableGenerations).toEqual([5, 6]);
  });

  it('keeps the first submission\u2019s reading on the record as a superseded conclusion', () => {
    const superseded = observation<{
      previousObservation: Record<string, number>;
      previousExpression: string;
      previousConclusion: string;
      whyThatWasWrong: string;
      correctedConclusion: string;
      preservedEvidence: string;
    }>('PR-8', 'S4_supersededFirstReading');
    expect(superseded.previousObservation).toMatchObject({ clientSent: 6, bufferSize: 2, serverConsumed: 4, clientLastProcessed: 4 });
    expect(superseded.previousExpression).toContain('clientLastProcessed + bufferSize < clientSent');
    expect(superseded.previousConclusion).toContain('never acknowledged');
    expect(superseded.whyThatWasWrong).toContain('4 + 2 = 6');
    expect(superseded.correctedConclusion).toContain('covers them');
    expect(superseded.preservedEvidence).toContain('42678254682');
  });

  it('does not acknowledge a synthesised idle frame', () => {
    const idle = observation<{ serverBefore: number; serverAfter: number; clientBefore: number; clientAfter: number }>('PR-8', 'S5_idleSynthesis');
    expect(idle).toMatchObject({ serverBefore: 0, serverAfter: 0, clientBefore: 0, clientAfter: 0 });
  });

  it('states what one acknowledgement means, and what it cannot say', () => {
    const semantics = observation<{
      kind: string;
      valueEquivalences: Record<string, boolean>;
      retirementRuleObserved: string;
      countedAsConsumed: string[];
      refusedFrameRetired: boolean;
      droppedFrameRetired: boolean;
      synthesisedIdleAdvancesNeither: boolean;
      distinguishesAppliedFromRefused: boolean;
      distinguishesAppliedFromDropped: boolean;
    }>('PR-8', 'acknowledgementSemantics');
    expect(semantics.kind).toContain('sequence watermark');
    expect(Object.values(semantics.valueEquivalences)).toEqual([true, true]);
    expect(semantics.retirementRuleObserved).toContain('seq <= 4');
    expect(semantics.countedAsConsumed).toEqual([
      'next() applied to state',
      'next() consumed then refused by the application',
      'overflow eviction',
    ]);
    expect(semantics.refusedFrameRetired).toBe(true);
    expect(semantics.droppedFrameRetired).toBe(true);
    expect(semantics.synthesisedIdleAdvancesNeither).toBe(true);
    expect(semantics.distinguishesAppliedFromRefused).toBe(false);
    expect(semantics.distinguishesAppliedFromDropped).toBe(false);
  });

  it('answers D-7 from identities, distinguishes refused from dropped, and leaves the decision to the owner', () => {
    const answer = observation<{
      answer: string;
      evidence: string[];
      distinctionTheAckCannotMake: string;
      distinctionTheApplicationCanMake: string;
      whatThatRecordDoesNotProve: string;
      decision: string;
    }>('PR-8', 'd7Answer');
    expect(answer.answer).toBe('no, not by itself');
    expect(answer.evidence.join(' ')).toContain('generations 1, 2, 3, 4');
    expect(answer.distinctionTheAckCannotMake).toContain('applied vs refused vs dropped');
    expect(answer.distinctionTheApplicationCanMake).toContain('per-frame');
    // An application journal is server-side evidence; it does not prove the client stops predicting.
    expect(answer.whatThatRecordDoesNotProve).toContain('UDG-SPIKE-001');
    expect(answer.decision).toContain('owner');
  });
});

describe('UDG-003 Phase 0 — PR-12 epoch and identity (PH0-B2 reclassified: the epoch is UDG-owned)', () => {
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
    expect(record?.result?.checks.find((check) => check.name === 'epoch-renewal-is-outside-library-scope')?.ok).toBe(true);
  });

  it('separates the SDK input-handle epoch from the UDG protocol epoch', () => {
    const separation = observation<{
      sdkInputEpoch: { owns: string };
      udgSessionEpoch: { owns: string; declaredIn: string };
      mustNotBeConfused: string;
    }>('PR-12', 'sdkEpochAndUdgEpochAreDistinct');
    expect(separation.sdkInputEpoch.owns).toContain('client input handle');
    expect(separation.udgSessionEpoch.declaredIn).toContain('@udg/protocol');
    expect(separation.mustNotBeConfused).toContain('does not renew');
  });

  it('records the supported lifecycle primitives an application epoch can build on', () => {
    const primitives = observation<Record<string, unknown>>('PR-12', 'supportedLifecyclePrimitives');
    expect(Object.keys(primitives).sort()).toEqual([
      'inputHandleReset',
      'joinIssuesIdentity',
      'reconnectionPreservesIdentity',
      'reconnectionRequiresServerConsent',
      'transportDropCallback',
    ]);
    expect(primitives['reconnectionPreservesIdentity']).toBe(true);
  });

  it('names the renewal procedure UDG still has to build, without building it', () => {
    const procedure = observation<{ status: string; steps: string[] }>('PR-12', 'applicationRenewalProcedureStillRequired');
    expect(procedure.status).toContain('implemented nowhere');
    expect(procedure.steps.length).toBeGreaterThanOrEqual(4);
    expect(procedure.steps.join(' ')).toContain('RESYNC_REQUIRED');
    expect(procedure.steps.join(' ')).toContain('4_294_967_295');
    expect(observation<string[]>('PR-12', 'remainsUnproved').length).toBeGreaterThanOrEqual(4);
  });

  it('no longer reports the absent epoch API as a blocker or a library defect', () => {
    const record = byId.get('PR-12');
    expect(observation<unknown>('PR-12', 'blocked')).toBeUndefined();
    expect(record?.result?.verdict).toBe('pass');
    const text = JSON.stringify(record?.result ?? {});
    expect(text).not.toContain('BLOCKED');
    expect(text).toContain('rather than a library defect');
    // No failing check may blame the library for a concept it never claimed to own.
    expect(record?.result?.checks.filter((check) => !check.ok)).toEqual([]);
    expect(record?.result?.limitations.join(' ')).toContain('does not implement renewal');
    // The reset counter is measured where it is defined, and leaves the session identity alone.
    expect(observation<{ before: number; after: number; sessionIdUnchanged: boolean }>('PR-12', 'inputHandleEpoch')).toEqual({
      before: 0,
      after: 1,
      sessionIdUnchanged: true,
    });
  });

  it('records only that a reconnection token exists, never its value', () => {
    const serialized = JSON.stringify(byId.get('PR-12')?.result ?? {});
    const tokenSerialised = /"reconnectionToken"\s*:\s*"[^"]+"/.test(serialized);
    expect(tokenSerialised, 'a reconnection token must never reach evidence').toBe(false);
  });
});

describe('UDG-003 Phase 0 — PR-13 overflow postures (the owner-authorised remedy investigation)', () => {
  interface Scenario {
    sent: number[];
    simulated: number[];
    ackedUnrepresented: number[];
    unackedUnrepresented: number[];
    maxBuffered: number;
    bufferMaxSize: number;
    ackedCount: number;
    clientLastProcessed: number;
    clientSent: number;
    clientPending: number;
    throttleSignals: number;
    signalsReceived: number;
    drainedWithoutStep: number[];
    sanitizeCalls: number;
    sanitizedFramesStepped: number;
    disconnects: { kind: string; sessionId: string; code: number | undefined }[];
    clientLeaveCode: number | null;
    error: string | null;
  }

  const scenario = (key: string): Scenario => observation<Scenario>('PR-13', key);

  it('reproduces the finding it starts from, and shows the bound is real', () => {
    const none = scenario('N1_baseline');
    expect(none.error).toBeNull();
    expect(none.ackedUnrepresented.length).toBeGreaterThan(0);
    expect(none.ackedUnrepresented.length).toBeLessThanOrEqual(none.ackedCount);
    expect(none.maxBuffered).toBeLessThanOrEqual(none.bufferMaxSize);
  });

  it('shows clear() moves the acknowledgement watermark rather than protecting frames', () => {
    const cleared = scenario('N2_clear');
    const bookkeeping = observation<{ clearCalls: number; consumedCountBeforeClear: number; consumedCountAfterClear: number }>('PR-13', 'N2_clear');
    expect(bookkeeping.clearCalls).toBeGreaterThan(0);
    expect(bookkeeping.consumedCountAfterClear).toBeGreaterThan(bookkeeping.consumedCountBeforeClear);
    expect(cleared.ackedUnrepresented.length).toBeGreaterThan(0);
  });

  it('proves a disconnect stops the watermark lying but arrives too late for a fast sender', () => {
    const leave = scenario('N3_leave');
    expect(leave.error).toBeNull();
    expect(leave.disconnects.length).toBeGreaterThan(0);
    expect(leave.clientLeaveCode).toBe(4008);
    // The watermark never passes the end of the seat.
    expect(leave.clientLastProcessed).toBeLessThan(leave.clientSent);
    // The residue is explicitly unacknowledged rather than silently represented.
    expect(leave.unackedUnrepresented.length).toBeGreaterThan(0);
    expect(leave.clientPending).toBeGreaterThan(0);
    // And the violation still happened before the tick could act: this is enforcement, not prevention.
    expect(leave.maxBuffered).toBe(leave.bufferMaxSize);
    expect(leave.ackedUnrepresented.length).toBeGreaterThan(0);
  });

  it('proves the library rate ceiling cuts an offender off but must sit against the consume rate', () => {
    const rate = scenario('N4_rate');
    expect(rate.error).toBeNull();
    expect(rate.disconnects.length).toBeGreaterThan(0);
    expect(rate.disconnects.every((entry) => entry.code === 4002)).toBe(true);
    expect(rate.ackedUnrepresented.length).toBeGreaterThan(0);
  });

  it('shows a declared sequence field leaves the acknowledgement a send-order watermark', () => {
    const seqField = scenario('N5_seqField');
    expect(seqField.error).toBeNull();
    expect(seqField.clientLastProcessed).toBeLessThanOrEqual(seqField.clientSent);
    expect(seqField.ackedUnrepresented.length).toBeGreaterThan(0);
  });

  it('proves a server signal plus an obeying sender keeps every acknowledgement matched by a step', () => {
    const signal = scenario('N6_signal');
    expect(signal.error).toBeNull();
    expect(signal.throttleSignals).toBeGreaterThan(0);
    expect(signal.signalsReceived).toBeGreaterThan(0);
    expect(signal.ackedUnrepresented).toEqual([]);
    expect(signal.unackedUnrepresented).toEqual([]);
    expect(signal.disconnects).toEqual([]);
    const window = observation<{ framesSentInsideSignalWindow: number; headroom: number }>('PR-13', 'N6_signalWindow');
    expect(window.framesSentInsideSignalWindow).toBeLessThanOrEqual(window.headroom);
  });

  it('measures the drain() ack jump the pinned declarations warn about, and rejects it', () => {
    const drain = observation<Scenario>('PR-13', 'N7_drain');
    expect(drain.error).toBeNull();
    expect(drain.drainedWithoutStep.length).toBeGreaterThan(0);
    expect(drain.ackedUnrepresented.length).toBeGreaterThan(0);
    const rejected = byId.get('PR-13')?.result?.checks.find((check) => check.name === 'N7-drain-then-apply-latest-is-rejected-as-a-remedy');
    expect(rejected?.ok).toBe(true);
    expect(rejected?.detail).toContain('prohibition');
  });

  it('proves the consume budget, not a rejection lever, is what prevents the violation', () => {
    const below = scenario('N8_takeBudgetOne');
    const above = scenario('N8_takeBudgetAboveRatio');
    const rule = observation<{
      arrivalFramesPerSecond: number;
      stepRatePerSecond: number;
      minimumBudget: number;
      budgetOne: { ackedUnrepresented: number[] };
      budgetAboveRatio: { ackedUnrepresented: number[]; maxBuffered: number; disconnects: number };
    }>('PR-13', 'N8_takeBudget');
    expect(rule.minimumBudget).toBe(2);
    expect(rule.budgetOne.ackedUnrepresented.length).toBeGreaterThan(0);
    expect(rule.budgetAboveRatio.ackedUnrepresented).toEqual([]);
    expect(rule.budgetAboveRatio.disconnects).toBe(0);
    expect(below.error).toBeNull();
    expect(above.error).toBeNull();
    expect(above.ackedUnrepresented).toEqual([]);
    expect(above.unackedUnrepresented).toEqual([]);
    expect(above.simulated.length).toBe(above.sent.length);
  });

  it('shows the only admission-time hook can rewrite but cannot refuse', () => {
    const sanitise = observation<Scenario>('PR-13', 'N9_sanitize');
    expect(sanitise.error).toBeNull();
    expect(sanitise.sanitizeCalls).toBeGreaterThan(0);
    expect(sanitise.sanitizedFramesStepped).toBeGreaterThan(0);
    expect(sanitise.ackedUnrepresented.length).toBeGreaterThan(0);
  });

  it('states the mechanism verdict without claiming compatibility, a gate, or client reconciliation', () => {
    const verdict = observation<{
      answer: string;
      whatPreventsTheViolation: string[];
      whatOnlyCutsAnOffenderOff: string[];
      whatDoesNotWork: string[];
      smallestArchitecturalDecision: string[];
      sdkProofVersusSpikeProof: { sdkProves: string[]; spikeMustStillProve: string[] };
    }>('PR-13', 'mechanismVerdict');
    expect(verdict.answer).toContain('take(n)');
    expect(verdict.answer).toContain('no');
    expect(verdict.whatDoesNotWork.join(' ')).toContain('clear()');
    expect(verdict.whatDoesNotWork.join(' ')).toContain('seqField');
    expect(verdict.whatDoesNotWork.join(' ')).toContain('sanitize()');
    expect(verdict.whatDoesNotWork.join(' ')).toContain('drain()');
    expect(verdict.smallestArchitecturalDecision.length).toBeGreaterThanOrEqual(3);
    // The SDK proves server-side accounting only; client convergence stays UDG-SPIKE-001 work.
    expect(verdict.sdkProofVersusSpikeProof.spikeMustStillProve.join(' ')).toContain('converges');
    expect(verdict.sdkProofVersusSpikeProof.spikeMustStillProve.join(' ')).toContain('no part of this probe observes client reconciliation');

    const text = JSON.stringify(byId.get('PR-13')?.result ?? {});
    expect(text).not.toContain('compatible');
    expect(text).not.toContain('Gate A');
    // Nothing in this investigation changes the Phase 0 verdict surface.
    expect(run.compatibility.stackCompatibility).toBe('not-established');
    expect(byId.get('PR-0')?.result?.verdict, 'PR-0 passes on its restated claim, which is not a compatibility claim').toBe('pass');
    expect(byId.get('PR-13')?.result?.verdict).toBe('pass');
  });
});

describe('UDG-003 Phase 0 — boundary and evidence hygiene', () => {
  it('keeps the probe tree free of escape hatches and private package paths', () => {
    const sources = probeSources(ROOT);
    expect(sources.length).toBeGreaterThan(0);
    const directive = '@' + 'ts-';
    const anyPattern = new RegExp([':', '\\s*an', 'y\\b|\\bas an', 'y\\b|<an', 'y>|\\ban', 'y\\[\\]'].join(''));
    // Comments and literal text are removed first: the probe sources quote declaration paths and quote the
    // casts they ban while banning them, and a scanner that flags prose gets ignored.
    const offenders: string[] = [];
    for (const source of sources) {
      const code = stripNonCode(source.text);
      if (anyPattern.test(code)) offenders.push(`${source.path}: any in a type position`);
      for (const marker of [`${directive}ignore`, `${directive}expect-error`, `${directive}nocheck`, 'as ' + 'unknown', 'as ' + 'never', 'eslint-' + 'disable']) {
        if (code.includes(marker)) offenders.push(`${source.path}: ${marker}`);
      }
      // Importing an internal path is the escape hatch; quoting one as evidence is not.
      if (new RegExp("from\\s+['\"]@col" + 'yseus/[a-z-]+/(build|src)/').test(code)) offenders.push(`${source.path}: private package import`);
    }
    expect(offenders).toEqual([]);
  });

  it('uses the declared client type in the reconnection callback, never a cast to never', () => {
    const rooms = probeSources(ROOT).find((source) => source.path.endsWith('rooms.ts'));
    expect(rooms, 'rooms.ts is part of the probe tree').toBeDefined();
    const code = stripNonCode(rooms?.text ?? '');
    expect(code).toContain('override onLeave(client: ServerClient');
    expect(code).not.toContain('as ' + 'never');
    // The typed parameter is handed over as declared — no cast, no wrapper.
    expect(code.match(/allowReconnection\(([^)]*)\)/)?.[1]).toMatch(/^client,\s*\d+$/);
    // PR-0 bans the same pattern, so the rule is enforced by the compile-facing probe as well as here.
    const patterns = observation<string[]>('PR-0', 'escapeHatchPatterns');
    expect(patterns).toContain('never-cast');
    expect(byId.get('PR-0')?.result?.checks.find((check) => check.name === 'no-escape-hatches')?.ok).toBe(true);
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
    // The map must carry the compiler status unambiguously, not leave it to be inferred from prose.
    expect(map).toContain('not-established');
    expect(map).toContain('ADR-0002');
    expect(map).toContain('colyseus-declaration-inventory.json');
    expect(map).toContain('typecheck:probes:full');
    expect(map).toContain('--noCheck');
  });

  it('writes probe evidence only when this task owns the run', () => {
    const index = JSON.parse(readFileSync(join(PROBE_OUT, 'probe-run-index.json'), 'utf8')) as {
      probes: { id: string; ok: boolean; verdict: string }[];
      emit: { purpose: string };
      typecheck: { purpose: string };
      fullCheck: { purpose: string };
      compatibility: { stackCompatibility: string; pr0: string; fullCheckDiagnostics: number };
    };
    expect(index.probes.map((probe) => probe.id)).toEqual([...PROBE_IDS]);
    expect(index.probes.map((probe) => probe.verdict)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(index.probes.filter((probe) => probe.ok).map((probe) => probe.id)).toEqual(['PR-0', 'PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12', 'PR-13']);
    expect(index.compatibility.stackCompatibility).toBe('not-established');
    expect(index.compatibility.pr0).toBe('pass');
    expect(index.compatibility.fullCheckDiagnostics).toBe(27);
    expect(index.emit.purpose).toContain('--noCheck');
    expect(index.typecheck.purpose).toContain('accepted compiler gate');
    expect(index.fullCheck.purpose).toContain('full declaration check');

    if (!OWNS_EVIDENCE_RUN) {
      // A run this task does not own must not receive this task's artefacts.
      expect(EVIDENCE_TASK === TASK && EVIDENCE_DIR !== undefined).toBe(false);
      return;
    }
    const directory = resolve(ROOT, EVIDENCE_DIR as string);
    for (const name of ['probe-results.json', 'probe-project-typecheck.json', 'compatibility-verdict.json', 'dependency-graph.json']) {
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

/**
 * Phase 1 — the transport-independent movement authority core.
 *
 * Phase 1 is assigned the authority core and nothing that touches a socket: no SDK transport, no
 * `RegionRoom`, no lifecycle transport wiring, no physics, no navigation, no client prediction and no
 * multiple-input consumption. That makes the assertions here mostly *negative*, so they are written the
 * same way the Phase 0 boundary suite is: scan the code that is actually shipped, after comments and
 * literal text are removed, and additionally **execute the emitted module** in a child process with ports
 * this file owns. A unit test that imports TypeScript source through a transform proves the transform
 * works; running `dist/authority/*.js` under plain Node proves the artefact does.
 */

const AUTHORITY_SOURCE_DIRECTORY = join(ROOT, 'apps', 'server', 'src', 'authority');
const AUTHORITY_MODULES = [
  'types',
  'determinism',
  'clock',
  'arrival',
  'bounded',
  'entity',
  'admit',
  'screen',
  'commit',
  'step',
  'journal',
  'replay',
] as const;

/** A child-process script that runs the *emitted* core against ports written here, independently. */
const EMITTED_RUN_SCRIPT = `
import { pathToFileURL } from 'node:url';

const [, , dist, libraries, boundsJson] = process.argv;
const load = async (relative) => import(pathToFileURL(\`\${dist}/\${relative}\`).href);
const stepModule = await load('authority/step.js');
const journalModule = await load('authority/journal.js');
const replayModule = await load('authority/replay.js');
const clockModule = await load('authority/clock.js');
const configModule = await import(pathToFileURL(\`\${libraries}/config/dist/index.js\`).href);

const config = configModule.withConfigOverrides(configModule.DEFAULT_SERVER_CONFIG, {
  region: { bounds: JSON.parse(boundsJson) },
});

let nowMs = 0;
let handle = 0;
const tasks = new Map();
const time = { nowMs: () => nowMs };
const scheduler = {
  set: (callback, delayMs) => {
    handle += 1;
    tasks.set(handle, { at: nowMs + delayMs, callback });
    return { scheduledBy: 'contract-suite', id: handle };
  },
  clear: (given) => {
    tasks.delete(given.id);
  },
};
const advance = (ms) => {
  const target = nowMs + ms;
  for (;;) {
    const due = [...tasks.entries()]
      .filter(([, task]) => task.at <= target)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (due === undefined) break;
    nowMs = Math.max(nowMs, due[1].at);
    tasks.delete(due[0]);
    due[1].callback();
  }
  nowMs = target;
};

const speed = config.movement.speed;
let stepCalls = 0;
const stepper = {
  step: (request) => {
    stepCalls += 1;
    // The flat reference relation only: this script proves the emitted artefact runs and counts, not
    // that any locomotion model exists (UDG-005 owns locomotion, UDG-006 owns collision).
    const dx = request.input.moveX * speed * request.dtSeconds;
    const dz = request.input.moveZ * speed * request.dtSeconds;
    const position = request.state.kinematic.position;
    return {
      state: {
        ...request.state,
        kinematic: {
          ...request.state.kinematic,
          position: { x: position.x + dx, y: position.y, z: position.z + dz },
        },
      },
      horizontalDisplacement: Math.hypot(dx, dz),
    };
  },
};

const clock = clockModule.FixedStepClock.create({ network: config.network, scheduler, time, tickOrigin: 0 });
const core = stepModule.AuthorityCore.build({
  config,
  stepper,
  time,
  clock,
  runId: 'udg-003-emitted-run',
  regionProvenance: 'test-only-synthetic',
});

core.join('e1', 1, { x: 0, y: 0, z: 0 });
clock.start(() => {
  core.step();
});

// The wire shape, exactly as the transport would deliver it: the core classifies on declared fields and
// the adopted protocol validators decide validity.
const frame = (sessionEpoch, generation, moveX, moveZ) => ({
  sessionEpoch,
  generation,
  directIntent: true,
  moveX,
  moveZ,
});
const keepalive = (sessionEpoch, generation) => ({
  sessionEpoch,
  generation,
  directIntent: false,
  moveX: 0,
  moveZ: 0,
});

const seen = [];
const tick = (payloads) => {
  for (const payload of payloads) core.ingest('e1', payload);
  advance(config.network.tickRate === 0 ? 0 : 1000 / config.network.tickRate);
  const entity = core.view('e1');
  seen.push({ tick: core.tick, watermark: entity?.watermark ?? null, balanced: core.reconciliation('e1').balanced });
};

// Generation 1 is a driven frame; 2 is a keepalive; 3 carries a discrete cancel that supersedes a queued
// frame; a move request must be refused without ever becoming a candidate.
tick([frame(1, 1, 1, 0)]);
tick([frame(1, 2, 0, 1), keepalive(1, 2)]);
tick([
  frame(1, 3, 1, 1),
  { requestId: 'emit-cancel', sessionEpoch: 1, generation: 4 },
  { requestId: 'emit-move', sessionEpoch: 1, generation: 4, x: 1, y: 1, z: 1 },
]);
tick([]);

// Counted before the replay shares the stepper: this is the original run's step count.
const originalSteps = stepCalls;
const originalTip = core.chainTip;
const originalRows = core.journalRows.length;

const rows = core.journalRows;
const codes = rows
  .filter((row) => row.type === 'observation' && row.requestId === 'emit-move')
  .map((row) => row.reason ?? row.disposition);
const moveCandidates = rows
  .filter((row) => row.type === 'intention')
  .flatMap((row) => row.candidates ?? [])
  .filter((candidate) => candidate.kind === 'path');

const replayed = replayModule.replayRun({
  prologue: core.prologue(),
  inputs: journalModule.toReplayInputs(rows, core.chain),
  config,
  stepper,
  time,
  clock: clockModule.FixedStepClock.create({ network: config.network, scheduler, time, tickOrigin: 0 }),
  runId: 'udg-003-emitted-replay',
});

process.stdout.write(
  JSON.stringify({
    ok: true,
    tickCount: seen.length,
    watermark: core.view('e1')?.watermark ?? null,
    latchedKind: core.view('e1')?.latchedKind ?? null,
    held: core.view('e1')?.heldDirectGeneration ?? null,
    stepCalls: originalSteps,
    moveRefusal: codes,
    moveCandidates: moveCandidates.length,
    routeFieldIsNull: core.view('e1')?.state.locomotion.route === null,
    dispositionsBalanced: core.reconciliation('e1').balanced,
    replayOk: replayed.ok === true,
    originalTip,
    replayTip: replayed.ok === true ? replayed.core.chainTip : null,
    rows: originalRows,
    journalRowTypes: [...new Set(rows.map((row) => row.type))].sort(),
    routeStatusRows: rows.filter((row) => row.type === 'routeStatus').length,
    replayRows: replayed.ok === true ? replayed.rows.length : 0,
    terminalCacheRecords: core.stats().cacheDepth,
  }),
);
`;

describe('UDG-003 Phase 1 — the authority core exists and stays off the package surface', () => {
  it('has exactly the modules the Phase 1 record names', () => {
    const present = readdirSync(AUTHORITY_SOURCE_DIRECTORY).filter((name) => name.endsWith('.ts')).sort();
    expect(present).toEqual([...AUTHORITY_MODULES].map((name) => `${name}.ts`).sort());
    for (const name of AUTHORITY_MODULES) {
      const text = readFileSync(join(AUTHORITY_SOURCE_DIRECTORY, `${name}.ts`), 'utf8');
      expect(text.length, name).toBeGreaterThan(200);
    }
  });

  it('leaves the workspace entry point and public surface exactly as UDG-001 pinned them', () => {
    const entry = stripNonCode(readFileSync(join(ROOT, 'apps', 'server', 'src', 'index.ts'), 'utf8'))
      .replace(/\/\/# sourceMappingURL=.*/g, '')
      .trim();
    expect(entry).toBe('export {};');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'package.json'), 'utf8')) as {
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
    };
    // Declared-but-unimplemented is still the state: the entry map row is the one UDG-001 recorded.
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    // The entry map is the whole public surface (protocol-v1.md). Phase 1 must not appear in it.
    const entryMap = readFileSync(join(ROOT, 'docs', 'contracts', 'protocol-v1.md'), 'utf8');
    const table = entryMap.slice(
      entryMap.indexOf('<!-- entry-map:begin -->'),
      entryMap.indexOf('<!-- entry-map:end -->'),
    );
    expect(table.length).toBeGreaterThan(0);
    expect(table).not.toContain('@udg/server');
    expect(table).not.toContain('authority');
    // And the source tree the map would have to point at is not reachable as a subpath export.
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.']);
  });

  it('runs the emitted module in a child process against ports this file owns', () => {
    // Build first: the accepted build path is fully typechecked, so a green build is part of the claim.
    const environment = { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env['PATH'] ?? ''}` };
    const built = spawnSync('pnpm', ['--filter', '@udg/server', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: environment,
      shell: process.platform === 'win32',
    });
    expect(built.status, `build failed: ${built.stderr}`).toBe(0);
    const emittedEntry = join(ROOT, 'apps', 'server', 'dist', 'index.js');
    expect(existsSync(emittedEntry), 'dist/index.js').toBe(true);
    const emitted = stripNonCode(readFileSync(emittedEntry, 'utf8'))
      .replace(/\/\/# sourceMappingURL=.*/g, '')
      .trim();
    expect(emitted).toBe('export {};');
    // The declaration file is equally empty: nothing in the workspace becomes importable.
    const declarations = stripNonCode(
      readFileSync(join(ROOT, 'apps', 'server', 'dist', 'index.d.ts'), 'utf8'),
    ).trim();
    expect(declarations).toBe('export {};');

    const directory = join(ROOT, 'artifacts', 'udg-003-phase-1');
    mkdirSync(directory, { recursive: true });
    const script = join(directory, 'emitted-run.mjs');
    writeFileSync(script, EMITTED_RUN_SCRIPT, 'utf8');
    const bounds = JSON.stringify({
      x: { min: -50, max: 50 },
      y: { min: -5, max: 20 },
      z: { min: -50, max: 50 },
    });
    const run = spawnSync(
      process.execPath,
      [script, join(ROOT, 'apps', 'server', 'dist'), join(ROOT, 'packages'), bounds],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(run.status, `emitted run failed: ${run.stderr}`).toBe(0);
    const result = JSON.parse(run.stdout) as {
      tickCount: number;
      watermark: number;
      latchedKind: string;
      held: number | null;
      stepCalls: number;
      moveRefusal: string[];
      moveCandidates: number;
      routeFieldIsNull: boolean;
      dispositionsBalanced: boolean;
      replayOk: boolean;
      originalTip: string;
      replayTip: string | null;
      rows: number;
      journalRowTypes: string[];
      routeStatusRows: number;
      replayRows: number;
      terminalCacheRecords: number;
    };
    // Three ticks of work and one idle tick; the last driven frame is superseded, the cancel wins.
    expect(result.tickCount).toBe(4);
    expect(result.watermark).toBe(4);
    expect(result.latchedKind).toBe('cancel');
    expect(result.held).toBeNull();
    // Every connected entity steps exactly once per tick, whatever the input did.
    expect(result.stepCalls).toBe(4);
    expect(result.moveRefusal).toEqual(['NAVIGATION_BUSY']);
    expect(result.moveCandidates).toBe(0);
    // `route` is the adopted protocol field and it stays null: Phase 1 constructs no route, and no
    // UDG_ROUTE_STATUS-shaped state appears anywhere in the journal.
    expect(result.routeFieldIsNull).toBe(true);
    expect(result.routeStatusRows).toBe(0);
    expect(result.journalRowTypes).not.toContain('routeStatus');
    expect(result.journalRowTypes).toContain('observation');
    expect(result.dispositionsBalanced).toBe(true);
    expect(result.replayOk).toBe(true);
    expect(result.replayTip).toBe(result.originalTip);
    expect(result.replayRows).toBe(result.rows);
    // One record per request with a terminal disposition: the accepted cancel and the refused move.
    expect(result.terminalCacheRecords).toBe(2);
    expect(result.originalTip).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('UDG-003 Phase 1 — what the authority source may not contain', () => {
  const sources = AUTHORITY_MODULES.map((name) => ({
    name,
    text: readFileSync(join(AUTHORITY_SOURCE_DIRECTORY, `${name}.ts`), 'utf8'),
  }));

  it('imports no transport, engine, browser, or platform module', () => {
    const offenders: string[] = [];
    for (const source of sources) {
      const code = stripNonCode(source.text);
      const specifiers = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
      for (const specifier of specifiers) {
        const allowed =
          specifier === '@udg/config' ||
          specifier === '@udg/protocol' ||
          specifier.startsWith('./') ||
          specifier.startsWith('../');
        if (!allowed) offenders.push(`${source.name}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reaches for no wall clock, entropy, timer, filesystem, network or environment', () => {
    const forbidden = [
      'Date.now',
      'new Date',
      'performance.now',
      'Math.random',
      'setTimeout',
      'setInterval',
      'node:fs',
      'node:net',
      'node:http',
      'process.env',
      'globalThis',
    ];
    const offenders: string[] = [];
    for (const source of sources) {
      const code = stripNonCode(source.text);
      for (const marker of forbidden) if (code.includes(marker)) offenders.push(`${source.name}: ${marker}`);
    }
    expect(offenders).toEqual([]);
  });

  it('uses no escape hatch, no locale collation and no DOM global', () => {
    const directive = '@' + 'ts-';
    const anyPattern = new RegExp([':', '\\s*an', 'y\\b|\\bas an', 'y\\b|<an', 'y>|\\ban', 'y\\[\\]'].join(''));
    const offenders: string[] = [];
    for (const source of sources) {
      const code = stripNonCode(source.text);
      if (anyPattern.test(code)) offenders.push(`${source.name}: any in a type position`);
      for (const marker of [
        `${directive}ignore`,
        `${directive}expect-error`,
        `${directive}nocheck`,
        'as ' + 'unknown',
        'as ' + 'never',
        'eslint-' + 'disable',
        'declare ' + 'global',
        'module.' + 'augmentation',
        'declare ' + 'module',
        'localeCompare',
        'document.',
        'window.',
        'localStorage',
      ]) {
        if (code.includes(marker)) offenders.push(`${source.name}: ${marker}`);
      }
      // A non-null assertion is the other way to silence a bound you refused to prove.
      if (/!\s*[.)\]]/.test(code)) offenders.push(`${source.name}: non-null assertion`);
    }
    expect(offenders).toEqual([]);
  });

  it('names the stage order P03 states and no stage it has not reached', () => {
    // String literals are stripped by `stripNonCode`, so the literal itself is read from the raw source.
    const raw = sources.find((source) => source.name === 'types')?.text ?? '';
    const literal = raw.match(/export const STAGE_ORDER[^\n]*=\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect([...literal.matchAll(/'([A-Z])'/g)].map((match) => match[1])).toEqual([
      'F',
      'L',
      'Q',
      'S',
      'A',
      'C',
      'R',
      'X',
    ]);
    // The executor names each stage where it runs it, so the single-letter literals in source order are
    // the stage order as executed. Anything outside the assigned eight - M and P above all - is a failure.
    const rawStep = sources.find((source) => source.name === 'step')?.text ?? '';
    expect([...rawStep.matchAll(/'([A-Z])'/g)].map((match) => match[1])).toEqual([
      'F',
      'L',
      'Q',
      'S',
      'A',
      'C',
      'R',
      'X',
    ]);
  });

  it('enters no room, no SDK type and no navigation implementation', () => {
    const offenders: string[] = [];
    for (const source of sources) {
      const code = stripNonCode(source.text);
      // A word-boundary test, because `discretePerRoom` is a queue capacity and not an SDK room.
      for (const pattern of [/\bRoom\b/, /\bColyseus\b/, /matchMake/, /NavMesh/, /pathfind/, /\bnavigate\(/]) {
        if (pattern.test(code)) offenders.push(`${source.name}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
    // And the phase-1 record says the same thing about the parts it did not build.
    const record = readFileSync(join(ROOT, 'docs', 'contracts', 'assignments', 'UDG-003-phase-1.md'), 'utf8');
    for (const phrase of ['RegionRoom', 'MovementAuthorityAdapter', 'unassigned', 'D-7']) {
      expect(record, phrase).toContain(phrase);
    }
  });
});
