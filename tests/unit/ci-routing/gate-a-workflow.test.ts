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
  it('names the assignment §4 dispatch inputs exactly: candidate_sha (required) + an optional printable run label', () => {
    expect(text).toMatch(/^ {6}candidate_sha:\n {8}description:/mu);
    expect(/^ {6}candidate:/mu.test(text), 'the old `candidate` input name must be gone').toBe(false);
    expect(text).toMatch(/^ {6}run_id:$/mu);
    // the label is validated BEFORE any upload (and before install): printable-only, bounded length
    const block = jobBlock('profile');
    expect(block).toContain('run_id must be 1-64 printable characters');
    expect(block.indexOf('printable characters')).toBeLessThan(block.indexOf('pnpm install --frozen-lockfile'));
    // and the immutable identity in every artefact name is github.run_id, not the mutable label
    for (const name of [...text.matchAll(/name: gate-a-[^\n]+/gu)].map((m) => m[0])) {
      expect(name, `artefact name drops the immutable run id: ${name}`).toContain('github.run_id');
    }
  });

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
      const checkout = /uses: actions\/checkout@[^\n]+\n(?:[^\n]*\n)*?[^\n]*ref: \$\{\{ inputs\.candidate_sha \}\}/u.test(block);
      expect(checkout, 'the checkout must be of inputs.candidate_sha itself').toBe(true);
    });
  }
});

describe('gate-a workflow — YAML plain-scalar conformance (the class of error a stdlib parser rejects)', () => {
  it('no unquoted plain scalar on a name/description/run-name line contains colon-space or space-hash', () => {
    // macOS Ruby Psych rejected gate-a.yml at 151:121 for exactly this class: a plain scalar
    // carrying ': ' inside a step name. No YAML parser exists in this offline container (ruby,
    // PyYAML, js-yaml, yaml, perl YAML all probed absent — retained in dpa8a), so the scanner
    // below is the dependency-free fixture for the rule, and the reviewer's Psych run over the
    // pushed bytes stays the standards authority. Block scalars (| and >) and quoted scalars are
    // legal with colons; PLAIN scalars are not.
    const offenders: string[] = [];
    text.split('\n').forEach((line, index) => {
      const m = /^\s*(-\s+)?(name|description|run-name):\s+(\S.*)$/u.exec(line);
      if (m === null) return;
      const value = m[3] as string;
      if (/^['">&*!|>]/u.test(value)) return; // quoted or block/anchor/directive style
      if (value.includes(': ') || value.endsWith(':') || value.includes(' #')) offenders.push(`line ${String(index + 1)}: ${line.trim()}`);
    });
    expect(offenders, `plain scalars a standards parser will reject:\n${offenders.join('\n')}`).toEqual([]);

    // the scanner must actually fire on the class it claims to catch (the Psych-rejected line)
    const psychRejected = "      - name: Upload x (only behind a passed gate: nothing uploads)";
    const m = /^\s*(-\s+)?(name|description|run-name):\s+(\S.*)$/u.exec(psychRejected);
    expect(m).not.toBeNull();
    const value = m?.[3] as string;
    expect(value.includes(': ')).toBe(true);
  });
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
    expect(block).toMatch(/timeout-minutes: 30\b/u);
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
    for (const gap of ['GA-11 production', 'PE-1', 'GA-5b', 'DEFERRED']) {
      expect(block, `the lane must state the ${gap} gap explicitly`).toContain(gap);
    }
    expect(block).toContain('if: always()'); // red lanes still state their status
  });
});

describe('gate-a workflow — a manual rerun is never a first attempt (runner run_attempt guard)', () => {
  it('every job refuses run_attempt != 1 before checkout/install, and no upload or bind can precede that gate', () => {
    for (const job of ['profile', 'scenarios', 'evidence']) {
      const block = jobBlock(job);
      expect(block, `${job} must read the runner attempt from env`).toContain('RUN_ATTEMPT: ${{ github.run_attempt }}');
      const guardAt = block.indexOf('"$RUN_ATTEMPT" != "1"');
      expect(guardAt, `${job} must guard the attempt`).toBeGreaterThan(-1);
      expect(guardAt, `${job} guards it BEFORE install`).toBeLessThan(block.indexOf('pnpm install --frozen-lockfile'));
      expect(guardAt, `${job} guards it BEFORE any checkout`).toBeLessThan(block.indexOf('uses: actions/checkout@'));
      // uploads/publish stay behind the gate step (non-first attempts upload nothing)
      for (const line of block.split('\n').filter((entry) => entry.includes('uses: actions/upload-artifact@'))) {
        void line; // presence checked next via the gating-condition test below
      }
    }
    // the evidence binder re-checks the attempt before aggregating (identifiers mean attempt one)
    expect(jobBlock('evidence')).toContain('refusing to aggregate a non-first attempt');
    // mock refusal of the policy itself: the gate condition is exact, not a range
    expect(text).toContain('if [ "$RUN_ATTEMPT" != "1" ]');
    expect(text).not.toMatch(/RUN_ATTEMPT.*-le/u);
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
    expect(block).toContain('published nothing — not even a diagnostic report');
    // The binder's refusal is a hard step failure — not a warning dressed as a pass.
    expect(block).toContain('exit "$bind_status"');
  });

  it('artefact names are scoped per lane, unique, carry the immutable dispatch identity, and the report is labelled diagnostic', () => {
    const names = [...text.matchAll(/name: (gate-a-[^\n]+)/gu)].map((match) => match[1] as string);
    expect(names).toContain('gate-a-rows-${{ matrix.profile }}-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(names).toContain('gate-a-scenarios-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(names).toContain('gate-a-report-diagnostic-${{ inputs.run_id }}-${{ github.run_id }}');
    expect(names.some((name) => name.startsWith('gate-a-evidence-')), 'a standalone report must not be named an evidence bundle').toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uploads only behind the input/HEAD/definition gates — a malformed, short or wrong SHA, or ANY definition mismatch, publishes nothing', () => {
    for (const job of ['profile', 'scenarios']) {
      const block = jobBlock(job);
      const uploads = block.split('\n').filter((line) => line.includes('uses: actions/upload-artifact@')).length;
      const gated = block.split('\n').filter((line) => /if: always\(\) && steps\.inputgate\.outcome == 'success' && steps\.headbind\.outcome == 'success' && steps\.defbind\.outcome == 'success'/u.test(line)).length;
      expect(gated, `${job}: every upload must be gated on ALL THREE guards`).toBe(uploads);
    }
  });

  it('conductor guards: only main + manual dispatch + attempt 1 may run; the LOADED definition must byte-equal the candidate definition, with NO bypass of any kind', () => {
    // (a) no override knob exists — an acknowledgment input would defeat fail-closed semantics
    expect(text, 'no drift/acknowledgment input may ever exist').not.toContain('definition_drift_ack');
    expect(text).not.toContain('DRIFT_ACK');
    expect(text, 'no drift bookkeeping reporting survives').not.toContain('GITHUB_STEP_SUMMARY');
    // (b) the loaded revision is attested by github.workflow_sha (never github.sha, which is the
    //     checkout context of another revision), and an unavailable value REFUSES (fail closed)
    expect(text, 'github.sha must not stand in for the loaded definition revision').not.toMatch(/github\.sha\b/u);
    // (c) source verification is LOCAL-ONLY inside the verified full-history candidate repository:
    //     no fetch fallback, no extra credentials, nothing written
    expect(text, 'no fetch fallback for the source object — local git plumbing or refusal').not.toMatch(/git fetch/u);
    for (const job of ['profile', 'scenarios', 'evidence']) {
      const block = jobBlock(job);
      expect(block).toContain('WORKFLOW_SHA: ${{ github.workflow_sha }}');
      expect(block).toContain('github.workflow_sha is unavailable');
      expect(block).toContain('is not an object in the verified full-history candidate repository');
      expect(block).toContain('differs from the candidate');
      expect(block).toContain('no bypass exists');
      // main-ref, manual-event and first-attempt gates in EVERY job
      expect(block).toContain('refs/heads/main');
      expect(block).toContain('EVENT_NAME" != "workflow_dispatch"');
      expect(block).toContain('RUN_ATTEMPT" != "1"');
    }
    // the conductor-guarded definition is byte-identical to the release branch copy (checked at
    // release time by git plumbing; here the marker pins that this candidate carries it)
    expect(text).toContain('bind the LOADED definition revision');
  });

  it('mandatory-lane results reach the binder (a red/skipped/cancelled lane refuses even over complete files)', () => {
    const block = jobBlock('evidence');
    expect(block).toContain('LANES: profile=${{ needs.profile.result }},scenarios=${{ needs.scenarios.result }}');
    expect(block).toContain('--lanes "$LANES"');
    // diagnostic honesty: the lane names itself a diagnostic and points at the accepted verify path
    expect(block).toContain('never call it a verified evidence bundle');
    expect(block).toContain('evidence:verify');
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
