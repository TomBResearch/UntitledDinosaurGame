/**
 * T-7 preparation — the manual gate-a workflow, asserted as policy before it can ever run.
 *
 * Same discipline as workflow-policy.test.ts, pointed at the new file: every rule here is a rule
 * the grant stated (manual-only, pinned actions, read-only, no input in shell, candidate bound
 * BEFORE install, one job per profile running ONLY its coordinates, ordered seeds, no retries,
 * aggregation that never re-executes, publish only on a complete green matrix). A workflow edit
 * that quietly widens one of these fails this suite on the spot.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const dispatchModule = await import('../../../tools/checks/dist/dispatch.js') as { SPIKE_OFFICIAL_SEEDS: readonly number[] };

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const text = readFileSync(join(ROOT, '.github/workflows/gate-a.yml'), 'utf8');
const ciText = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const acceptanceText = readFileSync(join(ROOT, '.github/workflows/acceptance.yml'), 'utf8');
/** the code a step ACTUALLY runs: YAML text with pure comment lines removed (comments may NAME a forbidden command while forbidding it). */
const executable = (block: string): string => block.split('\n').filter((line) => !/^\s*#/u.test(line)).join('\n');

const jobBlock = (id: string): string => {
  const start = text.indexOf(`\n  ${id}:\n`);
  expect(start, `no job ${id} in gate-a.yml`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = /^ {2}[a-z][\w-]*:$/mu.exec(rest.slice(1))?.index;
  return next === undefined ? rest : rest.slice(0, next + 1);
};

/** The literal text of every `run: |` block in the file (shell code, as the runner sees it). */
const runBlocks = (block: string): string[] => {
  const out: string[] = [];
  const lines = block.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s+run:\s*\|\s*$/u.test(lines[index] as string)) {
      const body: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && (/^\s{8,}/u.test(lines[cursor] as string) || (lines[cursor] as string).trim() === '')) { body.push(lines[cursor] as string); cursor += 1; }
      out.push(body.join('\n'));
      index = cursor - 1;
    }
  }
  return out;
};

describe('gate-a workflow — manual, pinned, read-only', () => {
  it('triggers ONLY on a manual dispatch (never push, never pull_request, never a schedule)', () => {
    const triggerBlock = /^\s*on:\n(?:[^\n]*\n)*?(?=\n[a-z])/mu.exec(text) ?? /^\non:\n((?:.|\n)*?)\npermissions:/u.exec(text);
    const onSection = text.slice(text.indexOf('\non:\n'), text.indexOf('\npermissions:'));
    expect(triggerBlock).not.toBeNull();
    expect(onSection).toContain('workflow_dispatch');
    for (const forbidden of ['push', 'pull_request', 'schedule', 'repository_dispatch']) {
      expect(onSection, `gate-a must never trigger on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('uses exactly the three already-pinned official actions, full 40-hex, identical to the pins ci.yml carries', () => {
    const specs = [...text.matchAll(/uses:\s*(\S+)/gu)].map((match) => match[1] as string);
    expect(specs.length).toBeGreaterThan(5);
    const approved = [...new Set([...`${ciText}\n${acceptanceText}`.matchAll(/uses:\s*(\S+)/gu)].map((match) => match[1] as string))];
    for (const spec of specs) {
      expect(spec, `${spec} is not the repo's pinned pattern`).toMatch(/^[^@]+@[0-9a-f]{40}$/u);
      expect(approved, `${spec} is an action ci.yml has never carried`).toContain(spec);
    }
    // persist-credentials is false on every checkout, and permissions stay read-only at the top.
    expect((text.match(/persist-credentials: false/gu) ?? []).length).toBe((text.match(/uses: actions\/checkout@/gu) ?? []).length);
    const permissionsBlock = /^\npermissions:\n((?: {2}[a-z-]+: [a-z]+\n)+)/mu.exec(text);
    expect(permissionsBlock?.[1]?.trim()).toBe('contents: read');
  });

  it('interpolates NO workflow expression into any shell body — inputs reach steps only through env', () => {
    for (const block of runBlocks(text)) {
      expect(block, `shell body leaks an expression: ${block.slice(0, 80)}`).not.toContain('${{');
      // and every $-name a shell body reads must have been exported via env: somewhere in the file
      for (const [, name] of block.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\b/gu)) {
        if (name === undefined) continue;
        if (['GITHUB_OUTPUT', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN', 'HOME', 'PATH'].includes(name)) continue;
        expect(new RegExp(`^\\s*${name}:`, 'mu').test(text), `${name} is read by shell but never declared in env:`).toBe(true);
      }
    }
  });
});

describe('gate-a workflow — the candidate is bound before anything executes', () => {
  for (const job of ['profile', 'scenarios', 'evidence']) {
    it(`${job}: refuses a non-40-hex candidate and binds HEAD to it BEFORE install/test`, () => {
      const block = jobBlock(job);
      const shapeAt = block.indexOf('40 hex characters');
      const installAt = block.indexOf('pnpm install --frozen-lockfile');
      const headBindAt = block.indexOf('git rev-parse HEAD');
      expect(shapeAt).toBeGreaterThan(-1);
      expect(headBindAt, 'HEAD must be compared to the candidate').toBeGreaterThan(-1);
      expect(installAt).toBeGreaterThan(-1);
      expect(shapeAt).toBeLessThan(installAt);
      expect(headBindAt).toBeLessThan(installAt);
      const checkout = /uses: actions\/checkout@[^\n]+\n(?:[^\n]*\n)*?[^\n]*ref: \$\{\{ inputs\.candidate \}\}/u.test(block);
      expect(checkout, 'the checkout must be of inputs.candidate itself').toBe(true);
    });
  }
});

describe('gate-a workflow — the matrix shape the grant fixed', () => {
  it('four profile jobs over independent legs, fail-fast off, ordered official seeds, and NEVER the whole capture plan', () => {
    const block = jobBlock('profile');
    expect(block).toContain('fail-fast: false');
    const profiles = /profile: \[([^\]]+)\]/u.exec(block)?.[1]?.split(',').map((entry) => entry.trim()) ?? [];
    expect(profiles).toEqual(['lan', 'moderate', 'elevated', 'poor']);
    // The seeds: exactly the adopted official set, ordered, pinned against the dispatcher's own list.
    const seeds = /GATE_A_SEEDS: '([^']+)'/u.exec(text)?.[1]?.split(' ').map(Number) ?? [];
    expect(seeds).toEqual([...dispatchModule.SPIKE_OFFICIAL_SEEDS]);
    // Each leg dispatches ONLY its own coordinate; no capture-plan label appears anywhere.
    expect(block).toContain('--cell full-window --profile "$PROFILE" --seed "$seed"');
    for (const label of ['spike-lan-1001', 'elevated-full', 'evidence:capture', 'run-contract']) {
      expect(executable(text), `gate-a must never run ${label}`).not.toContain(label);
    }
    // No retry machinery, and the formal policy is set only where a cell may honour it.
    expect(text).not.toMatch(/retries:\s*\d/u);
    expect(text).not.toContain('--repeat');
    expect(block).toContain('UDG_GATE_A_FORMAL');
  });

  it('the scenario lane is separate, states its statuses and every declared gap', () => {
    const block = jobBlock('scenarios');
    expect(block).toContain('gate-a-scenario-status.json');
    for (const gap of ['GA-11 production', 'PE-1', 'UDG-007', 'GA-5b']) {
      expect(block, `the lane must state the ${gap} gap explicitly`).toContain(gap);
    }
    expect(block).toContain('if: always()'); // red lanes still upload: a red row's bytes are evidence
  });
});

describe('gate-a workflow — aggregation binds and never launders', () => {
  it('the evidence job executes no suite, binds via the helper, and publishes ONLY through the binder verdict', () => {
    const block = executable(jobBlock('evidence'));
    for (const forbidden of ['pnpm test', 'test:spike', 'vitest', 'playwright install', 'run: pnpm build']) {
      expect(block, `aggregation must never re-execute ${forbidden}`).not.toContain(forbidden);
    }
    expect(block).not.toContain('UDG_GATE_A_FORMAL');
    expect(block).toContain('gate-a-aggregate');
    expect(block).toContain('publishable=true');
    expect(block).toContain("if: steps.bind.outputs.publishable == 'true'");
    expect(block).toContain('no publishable evidence bundle');
    // The binder's refusal is a hard step failure — not a warning dressed as a pass.
    expect(block).toContain('exit "$bind_status"');
  });

  it('artefact names are scoped per lane, unique, and carry the dispatch identity', () => {
    const names = [...text.matchAll(/name: (gate-a-[^\n]+)/gu)].map((match) => match[1] as string);
    expect(names).toContain('gate-a-rows-${{ matrix.profile }}-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(names).toContain('gate-a-scenarios-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(names).toContain('gate-a-evidence-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(new Set(names).size).toBe(names.length);
  });

  it('every job bounds its wall clock, and the whole file prints no secret', () => {
    for (const job of ['profile', 'scenarios', 'evidence']) {
      expect(jobBlock(job)).toMatch(/timeout-minutes: \d+/u);
    }
    // The only token referenced is the runner's own, handed to gh through env — never echoed.
    expect(text).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    expect(text).not.toMatch(/echo.*secrets\./u);
    expect(text).not.toMatch(/::debug::.*secrets\./u);
  });
});
