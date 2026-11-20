/**
 * T-7 preparation — the aggregation binder, mock end-to-end.
 *
 * The binder is the only new authority the manual gate-a workflow gains: it decides whether an
 * externally collected artefact tree is complete, unique, candidate-bound and green, and whether a
 * bundle may be published. These tests build the exact twelve-coordinate tree, then break it in
 * every way the grant named — omitted, duplicated, wrong-SHA, dirty, tampered kind/coordinate/
 * windows, red checks, mixed toolchains, unexpected seeds, scenario statuses that lie — and assert
 * each breakage is NAMED. They also assert the ceiling: with the declared gaps standing, the
 * report's Gate A field is NOT-PASS even over a perfect green matrix, and the string PASS never
 * appears as a verdict anywhere in the bytes.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { aggregateGateA, GATE_A_PROFILES, GATE_A_SEEDS, GATE_A_THRESHOLDS } from '../../../tools/checks/dist/gate-a-aggregate.js';

const CANDIDATE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

interface RowOptions {
  candidate?: string; dirty?: boolean; kind?: string; checks?: { name: string; ok: boolean }[];
  profile?: string; seed?: number; node?: string; warmupMs?: number; measureMs?: number;
  guardTripped?: boolean; contexts?: number; attempt?: number; retries?: number;
  rttMs?: number; jitterMs?: number;
}

const rowDoc = (profile: string, seed: number, options: RowOptions = {}): Record<string, unknown> => ({
  schemaVersion: 3,
  kind: options.kind ?? 'GATE-A',
  implementationSha: options.candidate ?? CANDIDATE,
  identity: {
    commit: options.candidate ?? CANDIDATE, dirty: options.dirty ?? false,
    node: options.node ?? 'v24.22.2', pnpm: '12.18.0', playwright: '1.56.1', seed,
  },
  coordinate: { cell: 'full-window', profile, seed, profileSource: 'explicit' },
  regime: {
    requestedRttMs: options.rttMs ?? GATE_A_THRESHOLDS[profile as keyof typeof GATE_A_THRESHOLDS]!.rttMs,
    declaredJitterBudgetMs: options.jitterMs ?? GATE_A_THRESHOLDS[profile as keyof typeof GATE_A_THRESHOLDS]!.jitterBudgetMs,
    official: true,
  },
  attempts: { attempt: options.attempt ?? 1, automaticRetries: options.retries ?? 0 },
  windows: {
    warmupMsBrowserMeasured: options.warmupMs ?? 20_005,
    measureMsBrowser: options.measureMs ?? 120_004,
    measureGuard: { targetMs: 120_000, capMs: 150_000, tripped: options.guardTripped ?? false },
  },
  isolation: { contexts: options.contexts ?? 2 },
  checks: options.checks ?? [{ name: 'everything', ok: true }],
});

const writeRow = (root: string, profile: string, seed: number, doc: Record<string, unknown>): void => {
  const dir = join(root, `cell-full-window-${profile}-${String(seed)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spike-cell.json'), JSON.stringify(doc, null, 2));
};

const perfectRows = (mutate?: (docs: Map<string, Record<string, unknown>>, root: string) => void): string => {
  const root = mkdtempSync(join(tmpdir(), 'gate-a-rows-'));
  const docs = new Map<string, Record<string, unknown>>();
  for (const profile of GATE_A_PROFILES) {
    for (const seed of GATE_A_SEEDS) {
      const doc = rowDoc(profile, seed);
      docs.set(`${profile}/${String(seed)}`, doc);
      writeRow(root, profile, seed, doc);
    }
  }
  mutate?.(docs, root);
  return root;
};

const perfectScenarios = (status: 'run-green' | 'run-red' | 'not-run' = 'run-green', extraGaps: string[] = []): string => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-a-scen-'));
  writeFileSync(join(dir, 'spike-cell-ga9-ga13.json'), JSON.stringify({ identity: { commit: CANDIDATE }, checks: [{ name: 'ga9', ok: true }] }));
  writeFileSync(join(dir, 'spike-cell-ga-scenarios.json'), JSON.stringify({ implementationSha: CANDIDATE, checks: [{ name: 'ga6a', ok: true }] }));
  writeFileSync(join(dir, 'spike-cell-ga11-calibration.json'), JSON.stringify({ identity: { commit: CANDIDATE }, checks: [{ name: 'inequality', ok: true }] }));
  writeFileSync(join(dir, 'gate-a-scenario-status.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'GATE-A-SCENARIO-STATUS',
    cells: [
      { cell: 'ga9-ga13', status, redChecks: status === 'run-red' ? 1 : 0, proofOnlyRedControls: 2, gaps: ['GA-5b blocked on PE-1', ...extraGaps] },
      { cell: 'ga-scenarios', status, redChecks: 0, proofOnlyRedControls: 0, gaps: ['GA-12 blocked on PE-1'] },
      { cell: 'ga11-calibration', status, redChecks: 0, proofOnlyRedControls: 0, gaps: ['GA-11 production populations Not-Run'] },
    ],
  }));
  return dir;
};

const codesOf = (violations: readonly { readonly code: string }[]): string[] => violations.map((violation) => violation.code);

describe('gate-a binder — a perfect tree binds, and STILL says Gate A is NOT-PASS', () => {
  it('binds all twelve coordinates to candidate, coordinate, bytes and toolchain', () => {
    const report = aggregateGateA({ rootDir: perfectRows(), scenariosDir: perfectScenarios(), candidateSha: CANDIDATE, runId: 'manual-1' });
    expect(report.violations).toEqual([]);
    expect(report.rows).toHaveLength(12);
    expect(report.matrixVerdict).toBe('ROWS-COMPLETE-ALL-GREEN');
    // The declared gaps stand: GA-11 production, GA-5b/GA-12 PE-1 — the binder cannot clear them.
    expect(report.gateA).toBe('NOT-PASS (open gaps)');
    expect(report.gaps.length).toBeGreaterThanOrEqual(3);
    expect(report.rows.every((row) => row.sha256.length === 64)).toBe(true);
    expect(report.toolchain).toEqual({ node: 'v24.22.2', pnpm: '12.18.0', playwright: '1.56.1' });
    // proof-only red controls are carried distinctly, never as lane failures.
    expect(report.proofOnlyRedControls.join(' ')).toContain('ga9-ga13: 2');
    // the ceiling: the Gate A field is NOT-PASS and never anything else while gaps stand.
    expect(String(report.gateA).startsWith('NOT-PASS')).toBe(true);
  });

  it('refuses a non-40-hex candidate by name', () => {
    const report = aggregateGateA({ rootDir: perfectRows(), scenariosDir: perfectScenarios(), candidateSha: 'abc123' });
    expect(codesOf(report.violations)).toContain('GATEA-AGG-CANDIDATE');
  });
});

describe('gate-a binder — missing, duplicate, omitted, unexpected', () => {
  it('an omitted coordinate is MISSING (blocked, not passed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-a-rows-'));
    for (const profile of GATE_A_PROFILES) for (const seed of GATE_A_SEEDS) if (!(profile === 'poor' && seed === 1003)) writeRow(root, profile, seed, rowDoc(profile, seed));
    const report = aggregateGateA({ rootDir: root, scenariosDir: perfectScenarios(), candidateSha: CANDIDATE });
    const missing = report.violations.filter((violation) => violation.code === 'GATEA-AGG-MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.detail).toContain('poor/1003');
    expect(report.matrixVerdict).toBe('INCOMPLETE-OR-RED');
  });

  it('two artefacts for one coordinate are DUPLICATES', () => {
    const root = perfectRows((_docs, r) => writeRow(join(r, 'reroll'), 'elevated', 1002, rowDoc('elevated', 1002)));
    const report = aggregateGateA({ rootDir: root, scenariosDir: perfectScenarios(), candidateSha: CANDIDATE });
    expect(report.violations.some((violation) => violation.code === 'GATEA-AGG-DUPLICATE' && violation.detail.includes('elevated/1002'))).toBe(true);
  });

  it('a coordinate outside the twelve official pairs is UNEXPECTED', () => {
    const root = perfectRows((_docs, r) => writeRow(r, 'elevated', 1004, rowDoc('elevated', 1004)));
    const report = aggregateGateA({ rootDir: root, scenariosDir: perfectScenarios(), candidateSha: CANDIDATE });
    expect(codesOf(report.violations)).toContain('GATEA-AGG-UNEXPECTED');
  });
});

describe('gate-a binder — tamper refusals (bytes must agree with everything else)', () => {
  const tamper = (name: string, mutate: (docs: Map<string, Record<string, unknown>>, root: string) => void, code: string): void => {
    it(name, () => {
      const report = aggregateGateA({ rootDir: perfectRows(mutate), scenariosDir: perfectScenarios(), candidateSha: CANDIDATE });
      expect(codesOf(report.violations)).toContain(code);
    });
  };

  tamper('wrong candidate SHA in the identity', (_docs, root) => writeRow(root, 'lan', 1001, rowDoc('lan', 1001, { candidate: OTHER })), 'GATEA-AGG-IDENTITY');
  tamper('dirty tree identity on a formal row', (_docs, root) => writeRow(root, 'lan', 1002, rowDoc('lan', 1002, { dirty: true })), 'GATEA-AGG-DIRTY');
  tamper('kind downgraded below GATE-A', (_docs, root) => writeRow(root, 'moderate', 1001, rowDoc('moderate', 1001, { kind: 'DIAGNOSTIC-NOT-GATE-A' })), 'GATEA-AGG-KIND');
  tamper('bytes disagree with the path coordinate', (_docs, root) => writeRow(root, 'poor', 1001, rowDoc('elevated', 1001, { profile: 'elevated' })), 'GATEA-AGG-COORD');
  tamper('a red internal check stays red', (_docs, root) => writeRow(root, 'elevated', 1003, rowDoc('elevated', 1003, { checks: [{ name: 'windows enforced', ok: false }] })), 'GATEA-AGG-ROW-RED');
  tamper('a rerolled attempt (attempt 2 / retried) is refused', (_docs, root) => writeRow(root, 'lan', 1003, rowDoc('lan', 1003, { attempt: 2, retries: 1 })), 'GATEA-AGG-ATTEMPTS');
  tamper('window short of the declared 120 s', (_docs, root) => writeRow(root, 'lan', 1001, rowDoc('lan', 1001, { measureMs: 119_990 })), 'GATEA-AGG-WINDOWS');
  tamper('guard tripped (cap reached, named failure)', (_docs, root) => writeRow(root, 'moderate', 1002, rowDoc('moderate', 1002, { guardTripped: true })), 'GATEA-AGG-WINDOWS');
  tamper('one browser context instead of two', (_docs, root) => writeRow(root, 'poor', 1002, rowDoc('poor', 1002, { contexts: 1 })), 'GATEA-AGG-CONTEXTS');
  tamper('thresholds that do not match the adopted profile table', (_docs, root) => writeRow(root, 'poor', 1003, rowDoc('poor', 1003, { rttMs: 50 })), 'GATEA-AGG-THRESHOLDS');
  tamper('mixed toolchains across the matrix', (_docs, root) => writeRow(root, 'elevated', 1001, rowDoc('elevated', 1001, { node: 'v20.19.0' })), 'GATEA-AGG-TOOLCHAIN');

  it('a scenario artefact from another candidate is refused by name', () => {
    const dir = perfectScenarios();
    writeFileSync(join(dir, 'spike-cell-ga9-ga13.json'), JSON.stringify({ identity: { commit: OTHER }, checks: [] }));
    const report = aggregateGateA({ rootDir: perfectRows(), scenariosDir: dir, candidateSha: CANDIDATE });
    expect(codesOf(report.violations)).toContain('GATEA-AGG-SCENARIO-IDENTITY');
  });

  it('a scenario lane that says red stays red; a status it invents is refused', () => {
    const redReport = aggregateGateA({ rootDir: perfectRows(), scenariosDir: perfectScenarios('run-red'), candidateSha: CANDIDATE });
    expect(codesOf(redReport.violations)).toContain('GATEA-AGG-SCENARIO-RED');
    const dir = perfectScenarios();
    writeFileSync(join(dir, 'gate-a-scenario-status.json'), JSON.stringify({ cells: [{ cell: 'ga9-ga13', status: 'vibes-green', gaps: [] }] }));
    const invented = aggregateGateA({ rootDir: perfectRows(), scenariosDir: dir, candidateSha: CANDIDATE });
    expect(codesOf(invented.violations)).toContain('GATEA-AGG-SCENARIO-STATUS');
  });

  it('no scenario status file means no inferred scenario lane', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-a-scen-empty-'));
    const report = aggregateGateA({ rootDir: perfectRows(), scenariosDir: dir, candidateSha: CANDIDATE });
    expect(codesOf(report.violations)).toContain('GATEA-AGG-SCENARIO-STATUS');
  });
});

describe('gate-a binder — thresholds mirror the adopted profile table', () => {
  it('GATE_A_THRESHOLDS equals SPIKE_PROFILES exactly (no runner-private drift)', async () => {
    const loadTest = (await import('../../../tools/load-test/dist/run-spike.js')) as {
      SPIKE_PROFILES: Record<string, { rttMs: number; jitterBudgetMs: number }>;
    };
    for (const profile of GATE_A_PROFILES) {
      expect(GATE_A_THRESHOLDS[profile]).toEqual({
        rttMs: loadTest.SPIKE_PROFILES[profile]!.rttMs,
        jitterBudgetMs: loadTest.SPIKE_PROFILES[profile]!.jitterBudgetMs,
      });
    }
  });
});
