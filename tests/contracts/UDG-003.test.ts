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
 * - **PH0-B1** keeps **PR-0 blocked**. The probe project does not typecheck, because the pinned
 *   third-party declarations reference a DOM-only global (`HeadersInit`), default-import `node:http`
 *   under `esModuleInterop: false`, and contain one generic constraint that TypeScript rejects. PR-0
 *   therefore reports `verdict: "blocked"` and fails; `ok: true` for PR-0 would mean PH0-B1 was closed
 *   without this file being updated. The third-party inventory below is pinned in both directions, so a
 *   fix is as loud as a regression and nobody can widen the compiler policy to make it disappear.
 *   `--noCheck` appears on an explicit emit command only, is excluded from the package `build` script,
 *   and is asserted to be exactly that: a way to obtain measurable JavaScript, never a build path.
 * - **PH0-B2** is **reclassified, not a blocker**: `sessionEpoch` is a UDG protocol concept that UDG
 *   owns. Colyseus 0.18 has no epoch concept and is not expected to have one, so this is a design
 *   obligation for Phase 2, not a library defect. PR-12 records the supported lifecycle primitives, the
 *   renewal procedure still required, and what remains unproved.
 *
 * Nothing here claims a gate. Gate A stays Not Run, and D-7 is decided by the owner from PR-8's
 * identity-level evidence, not by this file.
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
    blocker: 'PH0-B1',
    repositoryDiagnostics: run.repositoryDiagnostics,
    thirdPartyDiagnostics: run.thirdPartyDiagnostics,
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

  it('reports PR-0 as blocked rather than passed while PH0-B1 is open', () => {
    const record = byId.get('PR-0');
    expect(record?.result, 'PR-0 must produce a result file').toBeDefined();
    const result = record?.result as NonNullable<ProbeRecord['result']>;
    expect(result.ok, 'a blocked PR-0 is a failed probe, never a green one').toBe(false);
    expect(result.verdict).toBe('blocked');
    expect(result.blockedReason).toContain('PH0-B1');
    expect(result.blockedReason).toContain('NOT established');
    const failing = result.checks.filter((check) => !check.ok).map((check) => check.name);
    expect(failing).toContain('strict-typecheck-passes');
    expect(failing).toContain('compatibility-blocked');
    // The block must come from the strict typecheck, not from a probe inventing its own verdict.
    expect(result.observations['strictTypecheck']).toMatchObject({ exitCode: 2, inRepositoryCode: 0 });
    expect(result.observations['strictTypecheck']).toHaveProperty('inThirdPartyDeclarations');
  });

  it('publishes a compatibility verdict that refuses to call the stack compatible', () => {
    expect(run.compatibility.stackCompatibility).toBe('not-established');
    expect(run.compatibility.pr0).toBe('blocked');
    expect(run.compatibility.diagnostics.inRepositoryCode).toBe(0);
    expect(run.compatibility.acceptedBuildPath).toContain('typecheck:probes');
    expect(run.compatibility.diagnosticEmission).toContain('--noCheck');
    expect(run.compatibility.probes.find((probe) => probe.id === 'PR-0')?.verdict).toBe('blocked');
    const verdictPath = join(PROBE_OUT, 'compatibility-verdict.json');
    expect(existsSync(verdictPath), 'the machine-readable verdict is a deliverable').toBe(true);
    const written = JSON.parse(readFileSync(verdictPath, 'utf8')) as {
      taskId: string;
      stackCompatibility: string;
      pr0: string;
      reading: string;
    };
    expect(written.taskId).toBe(TASK);
    expect(written.stackCompatibility).toBe('not-established');
    expect(written.pr0).toBe('blocked');
    expect(written.reading).toContain('not-established');
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
    expect(map).toContain('BLOCKED');
    expect(map).toContain('--noCheck');
  });

  it('writes probe evidence only when this task owns the run', () => {
    const index = JSON.parse(readFileSync(join(PROBE_OUT, 'probe-run-index.json'), 'utf8')) as {
      probes: { id: string; ok: boolean; verdict: string }[];
      compatibility: { stackCompatibility: string; pr0: string };
      emit: { purpose: string };
      typecheck: { purpose: string };
    };
    expect(index.probes.map((probe) => probe.id)).toEqual([...PROBE_IDS]);
    expect(index.probes.map((probe) => probe.verdict)).toEqual(['blocked', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(index.probes.filter((probe) => probe.ok).map((probe) => probe.id)).toEqual(['PR-1', 'PR-2', 'PR-3', 'PR-8', 'PR-12']);
    expect(index.compatibility.stackCompatibility).toBe('not-established');
    expect(index.compatibility.pr0).toBe('blocked');
    expect(index.emit.purpose).toContain('--noCheck');
    expect(index.typecheck.purpose).toContain('accepted compiler gate');

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
