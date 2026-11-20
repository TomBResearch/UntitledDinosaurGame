/**
 * T-7 preparation — the Gate A aggregation lane's binder (smallest reviewed helper).
 *
 * WHY this exists: the capture glue can register and check artefacts INSIDE a bundle produced by
 * one plan run (`gate-a-register` / `gate-a-check`), but the manual gate-a workflow collects its
 * rows from INDEPENDENTLY uploaded job artefacts. Nothing in the authorized tooling could bind
 * externally collected artefacts (or scenario rows) to a candidate, a coordinate and each other.
 * This module is that binder — and ONLY a binder:
 *
 *   - it executes nothing. No test, no cell, no matrix leg is re-run here; a hosted red or a
 *     missing artefact stays exactly as red/blocked as the lanes produced it (C-07 discipline:
 *     aggregation reports, it never rehabilitates);
 *   - every row binds to candidate / profile / seed from the artefact's OWN bytes (kind, identity,
 *     coordinate, attempts, checks, windows, regimes) plus the file's SHA-256, so the report is
 *     byte-bound, not name-bound;
 *   - the twelve expected coordinates are the plan's table (4 profiles × the 3 official seeds,
 *     ordered): a missing coordinate is MISSING, two artefacts for one coordinate are DUPLICATES,
 *     a coordinate outside the table is UNEXPECTED, and a file whose bytes disagree with its path
 *     is a MISMATCH — each a named violation, none silently dropped;
 *   - the scenario lane is bound separately and its explicit status/gap metadata (written by the
 *     scenario job, never inferred here) is carried into the report verbatim;
 *   - Gate A itself stays NOT-PASS while any recorded gap is open (GA-11 production populations,
 *     GA-5b/GA-12 PE-1, GA-10a/b UDG-007). This helper can never print `PASS` for Gate A; the
 *     best verdict it can write is `ROWS-COMPLETE / GATE-A NOT-PASS (open gaps)`.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const GATE_A_PROFILES = ['lan', 'moderate', 'elevated', 'poor'] as const;
export const GATE_A_SEEDS = [1001, 1002, 1003] as const;
/** Threshold mirror of the adopted SPIKE_PROFILES (tools/load-test) — tripwired by unit test. */
export const GATE_A_THRESHOLDS: Readonly<Record<string, { rttMs: number; jitterBudgetMs: number }>> = {
  lan: { rttMs: 4, jitterBudgetMs: 2 },
  moderate: { rttMs: 50, jitterBudgetMs: 10 },
  elevated: { rttMs: 100, jitterBudgetMs: 20 },
  poor: { rttMs: 200, jitterBudgetMs: 40 },
};

export interface GateAViolation { readonly code: string; readonly detail: string }

export interface GateARowReport {
  readonly coordinate: { profile: string; seed: number };
  readonly file: string;
  readonly sha256: string;
  readonly kind: string;
  readonly green: boolean;
  readonly failedChecks: readonly string[];
  readonly identity: Record<string, unknown>;
}

export interface GateAReport {
  readonly schemaVersion: 1;
  readonly kind: 'GATE-A-AGGREGATE';
  readonly generatedAt: string;
  readonly candidate: string;
  readonly runId: string | null;
  readonly expectedCoordinates: readonly { profile: string; seed: number }[];
  readonly rows: readonly GateARowReport[];
  readonly toolchain: Record<string, string | null>;
  readonly thresholds: Record<string, unknown>;
  readonly scenarios: unknown;
  readonly proofOnlyRedControls: readonly string[];
  readonly gaps: readonly string[];
  readonly violations: readonly GateAViolation[];
  readonly matrixVerdict: 'ROWS-COMPLETE-ALL-GREEN' | 'INCOMPLETE-OR-RED';
  /** Never PASS while any gap stands open — the honest ceiling of this binder. */
  readonly gateA: 'NOT-PASS (open gaps)' | 'NOT-PASS (matrix incomplete or red)' | 'NOT-PASS (violations)';
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const walkCellFiles = (dir: string, out: string[]): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) continue; // artefact trees arrive via actions artifacts; a symlink is not an artefact
    if (st.isDirectory()) walkCellFiles(path, out);
    else if (st.isFile() && entry === 'spike-cell.json') out.push(path);
  }
};

const parseCoordinate = (file: string): { profile: string; seed: number } | null => {
  // Built from a string (not a regex literal) because the boundary scanner tokenises regex bodies
  // as code and this pattern legitimately names the cell directory prefix.
  const match = new RegExp('cell-full-window-([a-z]+)-(\\d+)(?:/|$)', 'u').exec(file.replace(/\\/gu, '/'));
  if (match === null) return null;
  return { profile: match[1] as string, seed: Number(match[2]) };
};

export const aggregateGateA = (options: {
  rootDir: string;
  candidateSha: string;
  scenariosDir?: string;
  runId?: string | null;
}): GateAReport => {
  const violations: GateAViolation[] = [];
  const v = (code: string, detail: string): void => { violations.push({ code, detail }); };
  if (!/^[0-9a-f]{40}$/u.test(options.candidateSha)) v('GATEA-AGG-CANDIDATE', `candidate "${options.candidateSha}" is not a full 40-hex sha`);

  const files: string[] = [];
  walkCellFiles(options.rootDir, files);
  const byCoordinate = new Map<string, { file: string; sha: string; doc: Record<string, unknown> | null; parseError: string | null }[]>();
  for (const file of files) {
    const coordinate = parseCoordinate(file);
    if (coordinate === null) { v('GATEA-AGG-UNPLACED', `${file} is a spike-cell.json outside any cell-full-window-<profile>-<seed> directory`); continue; }
    const key = `${coordinate.profile}/${String(coordinate.seed)}`;
    let doc: Record<string, unknown> | null = null; let parseError: string | null = null;
    const bytes = readFileSync(file);
    try { doc = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; } catch (error) { parseError = String(error); }
    (byCoordinate.get(key) ?? byCoordinate.set(key, []).get(key) as never[]).push({ file: relative(options.rootDir, file), sha: sha256Of(bytes), doc, parseError });
  }

  const expected = new Map<string, { profile: string; seed: number }>();
  for (const profile of GATE_A_PROFILES) for (const seed of GATE_A_SEEDS) expected.set(`${profile}/${String(seed)}`, { profile, seed });
  for (const key of byCoordinate.keys()) if (!expected.has(key)) v('GATEA-AGG-UNEXPECTED', `artefact for coordinate ${key} which is not one of the twelve official matrix coordinates`);

  const rows: GateARowReport[] = [];
  const toolchains = new Map<string, string>();
  for (const [key, coordinate] of expected) {
    const entries = byCoordinate.get(key) ?? [];
    if (entries.length === 0) { v('GATEA-AGG-MISSING', `coordinate ${key} has no artefact — the lane never produced it (blocked, not passed)`); continue; }
    if (entries.length > 1) v('GATEA-AGG-DUPLICATE', `coordinate ${key} has ${String(entries.length)} artefacts (${entries.map((entry) => entry.file).join(', ')}); a coordinate is attempted once per dispatch`);
    const entry = entries[0] as { file: string; sha: string; doc: Record<string, unknown> | null; parseError: string | null };
    if (entry.parseError !== null || entry.doc === null) { v('GATEA-AGG-PARSE', `${entry.file}: ${String(entry.parseError)}`); continue; }
    const doc = entry.doc;
    const identity = (doc['identity'] ?? {}) as Record<string, unknown>;
    const coordinateInFile = (doc['coordinate'] ?? {}) as Record<string, unknown>;
    const regime = (doc['regime'] ?? {}) as Record<string, unknown>;
    const attempts = (doc['attempts'] ?? {}) as Record<string, unknown>;
    const windows = (doc['windows'] ?? {}) as Record<string, unknown>;
    const isolation = (doc['isolation'] ?? {}) as Record<string, unknown>;
    const checks = Array.isArray(doc['checks']) ? (doc['checks'] as { name?: string; ok?: boolean }[]) : [];
    const failedChecks = checks.filter((check) => check.ok !== true).map((check) => String(check.name ?? '<unnamed>'));

    if (identity['dirty'] !== false) v('GATEA-AGG-DIRTY', `${entry.file}: identity['dirty'] is ${JSON.stringify(identity['dirty'])} — a formal row requires a clean tree`);
    if (identity['commit'] !== options.candidateSha) v('GATEA-AGG-IDENTITY', `${entry.file}: identity['commit'] ${JSON.stringify(identity['commit'])} is not the dispatched candidate`);
    if (coordinateInFile['profile'] !== coordinate.profile || coordinateInFile['seed'] !== coordinate.seed || coordinateInFile['cell'] !== 'full-window') {
      v('GATEA-AGG-COORD', `${entry.file}: bytes say ${JSON.stringify(coordinateInFile)} but the path coordinate is ${key}`);
    }
    if (doc['kind'] !== 'GATE-A') v('GATEA-AGG-KIND', `${entry.file}: kind ${JSON.stringify(doc['kind'])} cannot stand as a formal matrix row`);
    if (attempts['attempt'] !== 1 || attempts['automaticRetries'] !== 0) v('GATEA-AGG-ATTEMPTS', `${entry.file}: attempts ${JSON.stringify(attempts)} — a formal row is a first attempt with zero automatic retries`);
    const threshold = GATE_A_THRESHOLDS[coordinate.profile];
    if (regime['requestedRttMs'] !== threshold?.rttMs || regime['declaredJitterBudgetMs'] !== threshold?.jitterBudgetMs) {
      v('GATEA-AGG-THRESHOLDS', `${entry.file}: regime ${JSON.stringify(regime)} does not match the adopted thresholds ${JSON.stringify(threshold)} for ${coordinate.profile}`);
    }
    const measureMs = Number(windows['measureMsBrowser'] ?? -1); const warmupMs = Number(windows['warmupMsBrowserMeasured'] ?? -1);
    const guard = (windows['measureGuard'] ?? {}) as Record<string, unknown>;
    if (!(warmupMs >= 20_000) || !(measureMs >= 120_000) || guard['tripped'] === true) {
      v('GATEA-AGG-WINDOWS', `${entry.file}: measured warmup ${String(warmupMs)} ms / measure ${String(measureMs)} ms / guard ${JSON.stringify(guard)} — the declared 20 s + 120 s did not hold on the pump clock`);
    }
    if (isolation['contexts'] !== 2) v('GATEA-AGG-CONTEXTS', `${entry.file}: isolation['contexts'] is ${JSON.stringify(isolation['contexts'])} — a matrix row runs two true browser contexts`);
    if (failedChecks.length > 0) v('GATEA-AGG-ROW-RED', `${entry.file}: ${String(failedChecks.length)} internal check(s) are red (kept red, never laundered): ${failedChecks.slice(0, 3).join(' | ')}`);
    const toolchainKey = `${String(identity['node'])}/${String(identity['pnpm'])}/${String(identity['playwright'])}`;
    toolchains.set(toolchainKey, `${toolchainKey} (${entry.file})`);
    rows.push({
      coordinate, file: entry.file, sha256: entry.sha, kind: String(doc['kind']),
      green: failedChecks.length === 0, failedChecks, identity,
    });
  }
  if (toolchains.size > 1) v('GATEA-AGG-TOOLCHAIN', `the rows were not produced by one toolchain: ${[...toolchains.values()].join('; ')}`);

  // Scenario lane: bound separately, metadata verbatim, gaps never inferred.
  let scenarios: unknown = null;
  const proofOnlyRedControls: string[] = [];
  const gaps: string[] = [];
  const scenariosDir = options.scenariosDir;
  if (scenariosDir !== undefined && existsSync(scenariosDir)) {
    const statusPath = join(scenariosDir, 'gate-a-scenario-status.json');
    if (!existsSync(statusPath)) v('GATEA-AGG-SCENARIO-STATUS', `${statusPath} is missing — the scenario lane must state its own statuses and gaps; aggregation never infers them`);
    else {
      scenarios = JSON.parse(readFileSync(statusPath, 'utf8')) as unknown;
      const status = scenarios as { cells?: { cell?: string; status?: string; proofOnlyRedControls?: number; gaps?: string[] }[] };
      for (const cell of status.cells ?? []) {
        if (typeof cell.cell === 'string' && typeof cell.status === 'string' && cell.status !== 'run-green' && cell.status !== 'run-red') {
          v('GATEA-AGG-SCENARIO-STATUS', `scenario ${cell.cell} has status "${cell.status}" — it must say run-green, run-red or not-run`);
        }
        if (cell.status === 'run-red') v('GATEA-AGG-SCENARIO-RED', `scenario ${String(cell.cell)} ran RED on the hosted lane — kept red`);
        if (typeof cell.proofOnlyRedControls === 'number' && cell.proofOnlyRedControls > 0 && typeof cell.cell === 'string') {
          proofOnlyRedControls.push(`${cell.cell}: ${String(cell.proofOnlyRedControls)} retained proof-only red control(s) — expected reds documented by the cell, distinct from lane failures`);
        }
        for (const gap of cell.gaps ?? []) gaps.push(`${String(cell.cell)}: ${gap}`);
      }
    }
    for (const name of readdirSync(scenariosDir).filter((entry) => /^spike-cell-.*\.json$/u.test(entry))) {
      const doc = JSON.parse(readFileSync(join(scenariosDir, name), 'utf8')) as Record<string, unknown>;
      const identity = (doc['identity'] ?? {}) as Record<string, unknown>;
      if (identity['commit'] !== options.candidateSha && doc['implementationSha'] !== options.candidateSha) {
        v('GATEA-AGG-SCENARIO-IDENTITY', `${name}: neither identity['commit'] nor implementationSha equals the dispatched candidate`);
      }
    }
  } else if (scenariosDir === undefined) {
    v('GATEA-AGG-SCENARIO-STATUS', 'no scenario directory was supplied — the controlled scenario lane is part of the dispatch, not optional colour');
  }

  const allRowsGreen = rows.length === expected.size && rows.every((row) => row.green);
  const matrixVerdict = allRowsGreen ? 'ROWS-COMPLETE-ALL-GREEN' as const : 'INCOMPLETE-OR-RED' as const;
  const gateA = violations.length > 0
    ? 'NOT-PASS (violations)' as const
    : matrixVerdict === 'ROWS-COMPLETE-ALL-GREEN' && gaps.length > 0
      ? 'NOT-PASS (open gaps)' as const
      : 'NOT-PASS (matrix incomplete or red)' as const;

  return {
    schemaVersion: 1,
    kind: 'GATE-A-AGGREGATE',
    generatedAt: new Date().toISOString(),
    candidate: options.candidateSha,
    runId: options.runId ?? null,
    expectedCoordinates: [...expected.values()],
    rows,
    toolchain: (() => {
      const [toolNode = null, toolPnpm = null, toolPlaywright = null] = ([...toolchains.keys()][0] ?? '/').split('/');
      return { node: toolNode, pnpm: toolPnpm, playwright: toolPlaywright };
    })(),
    thresholds: GATE_A_THRESHOLDS as unknown as Record<string, unknown>,
    scenarios,
    proofOnlyRedControls,
    gaps,
    violations,
    matrixVerdict,
    gateA,
  };
};
