/**
 * UDG-SPIKE-001 slice 11 — the spike CLI coordinate contract (offline, no browser, no network).
 *
 * The rule these pin: the 12 formal matrix rows are TWELVE DISTINCT coordinates run by ONE real
 * full-profile runner, each row's --profile/--seed matching BOTH its label and the adopted regime
 * in tools/load-test (the runner cannot silently inherit a profile that is not the one its label
 * names), scenario cells are separate rows that never substitute for a matrix coordinate, and the
 * CLI refuses — exit-2 style, reason first — unknown cells, unknown profiles, defaulted
 * coordinates on matrix/scenario cells, the legacy elevated-full alias in formal mode, non-official
 * formal matrix seeds, and the pure-Node self-check as a formal cell.
 */

import { describe, expect, it } from 'vitest';

import { SPIKE_PROFILES } from '../../../tools/load-test/src/run-spike.ts';

const dispatchModulePath = new URL('../../../tools/checks/dist/dispatch.js', import.meta.url).href;
const evidenceModulePath = new URL('../../../tools/checks/dist/evidence.js', import.meta.url).href;

type Validation =
  | { ok: true; request: { cell: string; runnerCell: string; profile: string; seed: number; env: Record<string, string> } }
  | { ok: false; reason: string };

type DispatchModule = {
  SPIKE_CELLS: readonly string[];
  SPIKE_MATRIX_CELLS: readonly string[];
  SPIKE_SCENARIO_CELLS: readonly string[];
  SPIKE_PROFILE_NAMES: readonly string[];
  SPIKE_OFFICIAL_SEEDS: readonly number[];
  validateSpikeRequest: (flags: Record<string, string | boolean>, env?: Record<string, string | undefined>) => Validation;
};

type EvidenceModule = {
  CAPTURE_PLANS: Readonly<Record<string, { commands: { label: string; argv: string[]; env?: Record<string, string> }[] }>>;
};

let dispatch: DispatchModule;
let evidence: EvidenceModule;
try {
  dispatch = (await import(dispatchModulePath)) as DispatchModule;
  evidence = (await import(evidenceModulePath)) as EvidenceModule;
} catch (error) {
  throw new Error(
    'tools/checks/dist/{dispatch,evidence}.js are missing: build with `pnpm --filter @udg/checks build` before the unit suite',
    { cause: error },
  );
}

const FORMAL = { UDG_GATE_A_FORMAL: '1' };

const flagsFor = (argv: string[]): Record<string, string | boolean> => {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[token.slice(2)] = next;
        i += 1;
      } else {
        flags[token.slice(2)] = true;
      }
    }
  }
  return flags;
};

const planCommands = evidence.CAPTURE_PLANS['UDG-SPIKE-001']!.commands;
const matrixRows = planCommands.filter((command) => /^spike-(lan|moderate|elevated|poor)-\d{4}$/.test(command.label));

describe('UDG-SPIKE-001 spike CLI coordinate contract (slice 11)', () => {
  it('the profile list mirrors the adopted SPIKE_PROFILES exactly (no runner-private drift)', () => {
    expect([...dispatch.SPIKE_PROFILE_NAMES].sort()).toEqual(Object.keys(SPIKE_PROFILES).sort());
  });

  it('the plan has EXACTLY twelve matrix rows on ONE runner cell, and every pair is distinct', () => {
    expect(matrixRows.map((row) => row.label).sort()).toEqual(
      ['lan', 'moderate', 'elevated', 'poor'].flatMap((profile) => ['1001', '1002', '1003'].map((seed) => `spike-${profile}-${seed}`)).sort(),
    );
    const pairs = matrixRows.map((row) => {
      const flags = flagsFor(row.argv);
      expect(flags['cell'], `${row.label}: every matrix row runs the ONE parameterized runner`).toBe('full-window');
      return `${String(flags['profile'])}/${String(flags['seed'])}`;
    });
    expect(new Set(pairs).size, 'twelve DISTINCT profile+seed coordinates').toBe(12);
    // No matrix row runs a scenario cell, and no scenario cell claims a matrix label.
    for (const row of matrixRows) expect(row.argv.join(' ')).not.toMatch(/ga9-ga13|ga-scenarios|ga11-calibration|ab-controls|elevated-full/);
  });

  it('every matrix row validates formally and its profile/seed match BOTH its label and the ADOPTED regime of that coordinate', () => {
    for (const row of matrixRows) {
      const flags = flagsFor(row.argv);
      const profile = String(flags['profile']);
      const seed = Number(flags['seed']);
      expect(row.label).toBe(`spike-${profile}-${String(seed)}`);
      const validated = dispatch.validateSpikeRequest(flags, FORMAL);
      expect(validated.ok, `${row.label}: ${validated.ok === true ? '' : validated.reason}`).toBe(true);
      if (validated.ok !== true) continue;
      expect(validated.request.profile, `${row.label}: the runner executes the profile its label names`).toBe(profile);
      expect(validated.request.seed).toBe(seed);
      // The regime the run executes is the ADOPTED regime of the coordinate: the same profile spec
      // the statistics/validity gates consume (tools/load-test), not a per-run invention.
      const spec = SPIKE_PROFILES[profile as keyof typeof SPIKE_PROFILES];
      expect(validated.request.env['UDG_SPIKE_PROFILE']).toBe(profile);
      expect(spec.rttMs, `${row.label}: RTT regime comes from the adopted profile table`).toBe(
        { lan: 4, moderate: 50, elevated: 100, poor: 200 }[profile],
      );
      expect(spec.jitterBudgetMs).toBe({ lan: 2, moderate: 10, elevated: 20, poor: 40 }[profile]);
      expect(spec.carriesCorrectionGate, 'only elevated carries the correction gate').toBe(profile === 'elevated');
      expect(dispatch.SPIKE_OFFICIAL_SEEDS).toContain(seed);
    }
  });

  it('scenario cells are SEPARATE rows and never matrix labels; the matrix cells never name them', () => {
    const scenario = planCommands.filter((row) => row.label.startsWith('scenario-'));
    expect(scenario.length >= 3, 'ga9-ga13, ga-scenarios and ga11-calibration keep their own coverage rows').toBe(true);
    for (const row of scenario) {
      expect(row.label).not.toMatch(/^spike-/);
      const validated = dispatch.validateSpikeRequest(flagsFor(row.argv), FORMAL);
      expect(validated.ok, `${row.label}: ${validated.ok === true ? '' : validated.reason}`).toBe(true);
    }
    const ga9 = scenario.find((row) => row.label === 'scenario-ga9-ga13');
    expect(ga9, 'the determinism/replay scenario is an explicit-coordinate formal row').toBeDefined();
    expect(JSON.stringify(ga9?.env ?? {})).toContain('UDG_GATE_A_REPLAYS_OUT');
  });

  it('no silent defaults, formal or not: matrix and scenario cells refuse missing profile or seed', () => {
    const reasons = (flags: Record<string, string | boolean>, env: Record<string, string | undefined> = {}): string => {
      const result = dispatch.validateSpikeRequest(flags, env);
      return result.ok === true ? 'ACCEPTED' : result.reason;
    };
    expect(reasons({ id: 'UDG-SPIKE-001', cell: 'full-window' })).toMatch(/explicit --profile/);
    expect(reasons({ id: 'UDG-SPIKE-001', cell: 'full-window', profile: 'lan' })).toMatch(/explicit --seed/);
    expect(reasons({ id: 'UDG-SPIKE-001', cell: 'ga9-ga13', profile: 'elevated' })).toMatch(/explicit --seed/);
    // ...also without the formal flag — the runner has NO defaults in any mode.
    expect(reasons({ id: 'UDG-SPIKE-001', cell: 'full-window', seed: '1001' })).toMatch(/explicit --profile/);
  });

  it('unknown or out-of-policy coordinates are refused with the reason named', () => {
    const refusal = (flags: Record<string, string | boolean>, env: Record<string, string | undefined> = {}): string => {
      const result = dispatch.validateSpikeRequest(flags, env);
      expect(result.ok, 'expected a refusal').toBe(false);
      return result.ok === true ? '' : result.reason;
    };
    expect(refusal({ cell: 'ludicrous-speed', profile: 'lan', seed: '1001' })).toMatch(/unknown cell/);
    expect(refusal({ cell: 'full-window', profile: 'ludicrous', seed: '1001' })).toMatch(/unknown profile/);
    expect(refusal({ cell: 'full-window', profile: 'lan', seed: 'not-a-number' })).toMatch(/integer/);
    expect(refusal({ cell: 'full-window', profile: 'elevated', seed: '1004' }, FORMAL)).toMatch(/official set/);
    expect(refusal({ cell: 'self-check' }, FORMAL)).toMatch(/not a formal cell/);
    expect(refusal({ cell: 'elevated-full' }, FORMAL)).toMatch(/BAKED-IN elevated profile/);
    expect(refusal({ cell: 'elevated-full', profile: 'lan' })).toMatch(/takes no --profile other than elevated/);
  });

  it('the legacy elevated-full alias maps onto THE full-window runner with the profile named by the dispatcher, and the scenario cells execute under their declared regime', () => {
    const legacy = dispatch.validateSpikeRequest({ cell: 'elevated-full' });
    expect(legacy.ok).toBe(true);
    if (legacy.ok !== true) return;
    expect(legacy.request.runnerCell).toBe('full-window');
    expect(legacy.request.profile).toBe('elevated');
    expect(legacy.request.env['UDG_SPIKE_PROFILE_SOURCE']).toBe('legacy-elevated-full');
    const scenario = dispatch.validateSpikeRequest({ cell: 'ga9-ga13', profile: 'poor', seed: '1002' }, FORMAL);
    expect(scenario.ok).toBe(true);
    if (scenario.ok !== true) return;
    expect(scenario.request.env['UDG_SPIKE_PROFILE']).toBe('poor');
    expect(scenario.request.env['UDG_SPIKE_SEED']).toBe('1002');
  });

  it('the routine fast smoke cell (grant T-6) needs an explicit coordinate and is NEVER formal, never a matrix/scenario cell', () => {
    const accepted = dispatch.validateSpikeRequest({ cell: 'lan-smoke', profile: 'lan', seed: '1001' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok !== true) return;
    expect(accepted.request.env['UDG_SPIKE_CELL']).toBe('lan-smoke');
    expect(accepted.request.env['UDG_GATE_A_FORMAL']).toBeUndefined();
    // Same no-silent-defaults discipline as every real cell.
    expect(dispatch.validateSpikeRequest({ cell: 'lan-smoke', profile: 'lan' }).ok).toBe(false);
    expect(dispatch.validateSpikeRequest({ cell: 'lan-smoke', seed: '1001' }).ok).toBe(false);
    // Never formal: the formal schedule is the 12-cell matrix plus scenarios; the smoke is neither,
    // and a formal run must never mistake 12 miniature pings for a measured window.
    expect(dispatch.validateSpikeRequest({ cell: 'lan-smoke', profile: 'lan', seed: '1001' }, FORMAL).ok).toBe(false);
    expect(dispatch.SPIKE_MATRIX_CELLS).not.toContain('lan-smoke');
    expect(dispatch.SPIKE_SCENARIO_CELLS).not.toContain('lan-smoke');
  });
});
