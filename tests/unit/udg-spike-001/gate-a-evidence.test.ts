/**
 * UDG-SPIKE-001 slice 10 — Gate A evidence wiring POLICY tests (offline, no network, no browser).
 *
 * These prove the T-5 wiring refuses to lie, without running anything formal:
 *  1. append-only (M-2): the five accepted capture plans are byte-identical to the digests
 *     recorded at this revision, and UDG-SPIKE-001 arrives as a NEW key beside them;
 *  2. the Gate A plan's own policy: candidate binding, toolchain pins, formal-schedule env,
 *     NO automatic-retry machinery in any eligible formal cell, and the register/verdict rule;
 *  3. every anti-masquerade negative: a short/mismatched candidate sha, a dirty tree, the wrong
 *     toolchain, a PASS citing a DIAGNOSTIC artefact, a PASS verdict beside non-PASS rows, a
 *     missing register row, GA-10a/b OUTSTANDING without the named owner, an implementer-signed
 *     decision, a non-exact replay leg, a machine path in a Gate A artefact — each refused;
 *  4. the register builder DEMOTES a PASS that cites a non-GATE-A artefact instead of writing it;
 *  5. the HONEST bundle (rows honestly NOT_RUN/BLOCKED/OUTSTANDING, verdict NOT-PASS) produces
 *     ZERO issues — so the negatives above are the detector firing, not a vacuous red.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const evidenceModulePath = new URL('../../../tools/checks/dist/evidence.js', import.meta.url).href;

type EvidenceModule = {
  CAPTURE_PLANS: Readonly<Record<string, unknown>>;
  EVIDENCE_SCHEMA_VERSION: number;
  GA_ROW_REGISTER: readonly { id: string; note: string }[];
  GATE_A_CF_ROWS: readonly { id: string; note: string }[];
  GATE_A_ROW_STATUSES: readonly string[];
  gateAVerdictFor: (rows: readonly { status: string }[], cfRows?: readonly { status: string }[]) => string;
  buildGateARegister: (options: {
    readonly candidateSha: string;
    readonly runId?: string;
    readonly rowsFile: string;
    readonly bundleDir?: string;
  }) => { register: Record<string, unknown>; demotions: readonly string[] };
  gateACandidateIssues: (
    absoluteRunDir: string,
    options: { readonly candidateSha: string; readonly headSha?: string },
  ) => readonly { code: string; detail: string }[];
};

let evidence: EvidenceModule;
try {
  evidence = (await import(evidenceModulePath)) as EvidenceModule;
} catch (error) {
  throw new Error(
    'tools/checks/dist/evidence.js is missing: build it with `pnpm --filter @udg/checks build` before the unit suite',
    { cause: error },
  );
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Digests of the FIVE accepted plans, recorded at the revision that appended the Gate A plan.
 * They are the M-2 tripwire: if anyone edits an accepted plan's bytes, the digest moves and this
 * test goes red naming the plan. (The retained bundles themselves keep verifying via
 * `pnpm evidence:verify`; this guards the plan source directly.)
 */
const ACCEPTED_PLAN_DIGESTS: Readonly<Record<string, string>> = {
  'UDG-001': 'e6beb3f3d10abc33028be586dc960416ae98ad57b2c19148e631d2c965f0e238',
  'UDG-002': 'f327136643f0fd161987873eacb2c6ce05d2ac5b831533bce7edd182ea6e5440',
  'UDG-003': '0e8b52d221120c7d2c843d704a27da4b08519ff71885faf8f3f0232cf87aa8bd',
  'UDG-003-TASK': 'ed1debe0b1bda6d62c434fc61aaad5cfd4347315e2e91e52874db3c4c12ae5cf',
  'UDG-004': '2b1352be727b0a467b380c54b1b358f19f6122459f91bf73629d1b58403bb6fb',
};

const CANDIDATE = 'f'.repeat(40);
const OTHER = '0'.repeat(40);

let workspace: string;

const writeJson = (file: string, value: unknown): void => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
};

const honestRows = (): Record<string, unknown> => ({
  candidateSha: CANDIDATE,
  networkValidity: 'NOT_MEASURED',
  rows: evidence.GA_ROW_REGISTER.map((spec) => {
    if (spec.id === 'GA-10a' || spec.id === 'GA-10b') {
      return { id: spec.id, status: 'OUTSTANDING', reason: 'requires a committed discrete effect; no such effect exists on the pre-UDG-007 substrate', owner: 'UDG-007' };
    }
    if (spec.id === 'GA-5b' || spec.id === 'GA-12') {
      return { id: spec.id, status: 'BLOCKED', reason: 'PE-1 unmet: the pre-buffer decline has no observable signature on the pinned stack (blocked-with-proof, PROPOSED-0003a rev 3)' };
    }
    return { id: spec.id, status: 'NOT_RUN', reason: 'no formal artefact exists yet' };
  }),
  cfRows: evidence.GATE_A_CF_ROWS.map((spec) => ({ id: spec.id, status: 'NOT_RUN', reason: 'not yet resolved by Gate A evidence' })),
});

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'gate-a-policy-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('UDG-SPIKE-001 Gate A evidence wiring (T-5, offline policy negatives)', () => {
  it('append-only (M-2): the five accepted plans are byte-identical; UDG-SPIKE-001 is a NEW key', () => {
    for (const [taskId, digest] of Object.entries(ACCEPTED_PLAN_DIGESTS)) {
      expect(sha256(JSON.stringify(evidence.CAPTURE_PLANS[taskId])), `${taskId} plan bytes moved`).toBe(digest);
    }
    expect(Object.keys(evidence.CAPTURE_PLANS)).toContain('UDG-SPIKE-001');
  });

  it('the Gate A plan declares candidate binding, pins, the formal schedule env, and NO retry machinery', () => {
    const plan = evidence.CAPTURE_PLANS['UDG-SPIKE-001'] as unknown as {
      taskId: string;
      phase: { label: string; measurementsScope: string };
      identityArtefacts: string[];
      requiresMeasurements: boolean;
      commands: { label: string; argv: string[]; env?: Record<string, string> }[];
      thresholds: Record<string, string>;
    };
    expect(plan.taskId).toBe('UDG-SPIKE-001');
    expect(plan.phase.label).toBe('gate-a');
    expect(plan.phase.measurementsScope).toBe('gate-a');
    expect(plan.identityArtefacts).toContain('ga-rows.json');
    expect(plan.identityArtefacts).toContain('ga-replays.json');
    expect(plan.requiresMeasurements).toBe(true);
    const text = JSON.stringify(plan);
    expect(text).toContain('UDG_GATE_A_FORMAL');
    expect(text).toContain('CANDIDATE_SHA');
    // Automatic retries are OUT of eligible formal cells.
    expect(text).not.toContain('--retries');
    expect(text).not.toContain('last-failed');
    const check = plan.commands.find((c) => c.argv.includes('gate-a-check'));
    expect(check, 'the plan must gate itself with gate-a-check').toBeDefined();
    expect(plan.thresholds['gateA.verdict']).toContain('NOT-PASS');
    expect(plan.thresholds['retries.forbidden']).toContain('DIAGNOSTIC');
  });

  it('gateAVerdictFor: PASS needs EVERY row PASS; one non-PASS row forces NOT-PASS', () => {
    const pass = { status: 'PASS' };
    expect(evidence.gateAVerdictFor([pass, pass])).toBe('PASS');
    expect(evidence.gateAVerdictFor([pass, { status: 'DIAGNOSTIC' }])).toBe('NOT-PASS');
    expect(evidence.gateAVerdictFor([pass], [{ status: 'BLOCKED' }])).toBe('NOT-PASS');
    expect(evidence.gateAVerdictFor([])).toBe('NOT-PASS');
  });

  it('the register builder DEMOTES a PASS citing a DIAGNOSTIC artefact instead of writing it', () => {
    const cellsDir = join(workspace, 'cells');
    mkdirSync(cellsDir, { recursive: true });
    const diagnosticArtefact = join(cellsDir, 'spike-cell-ga9-ga13.json');
    writeJson(diagnosticArtefact, { schemaVersion: 1, kind: 'DIAGNOSTIC-NOT-GATE-A', taskId: 'UDG-SPIKE-001' });
    const rowsFile = join(workspace, 'rows-masquerade.json');
    const rows = honestRows();
    (rows['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!['status'] = 'PASS';
    (rows['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!['artefactPath'] = diagnosticArtefact;
    writeJson(rowsFile, rows);
    const built = evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile });
    const ga9 = (built.register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    expect(ga9['status'], 'a diagnostic artefact can never carry a PASS row').toBe('DIAGNOSTIC');
    expect(built.demotions.join('\n')).toContain('GA-9');
    expect(built.register['verdict']).toBe('NOT-PASS');
    // And a PASS row with NO artefact at all is demoted to NOT_RUN, never written as PASS.
    const rows2 = honestRows();
    (rows2['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-1')!['status'] = 'PASS';
    const rowsFile2 = join(workspace, 'rows-noartefact.json');
    writeJson(rowsFile2, rows2);
    const built2 = evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile: rowsFile2 });
    const ga1 = (built2.register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-1')!;
    expect(ga1['status']).toBe('NOT_RUN');
    // A rows manifest bound to another candidate is refused outright.
    const rowsFile3 = join(workspace, 'rows-mismatch.json');
    writeJson(rowsFile3, { ...honestRows(), candidateSha: OTHER });
    expect(() => evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile: rowsFile3 })).toThrow(/not the declared candidate/);
  });

  it('an honest bundle — rows NOT_RUN/BLOCKED/OUTSTANDING, verdict NOT-PASS — produces ZERO issues (the negatives below are teeth, not theatre)', () => {
    const bundle = buildHonestBundle(join(workspace, 'honest'));
    expect(evidence.gateACandidateIssues(bundle, { candidateSha: CANDIDATE })).toEqual([]);
  });

  it('negatives: short sha, mismatched sha, dirty tree, wrong toolchain, checkout mismatch — each refused', () => {
    const bundle = buildHonestBundle(join(workspace, 'neg1'));
    const codes = (dir: string, opts: { candidateSha: string; headSha?: string }): string[] =>
      evidence.gateACandidateIssues(dir, opts).map((i) => i.code);
    expect(codes(bundle, { candidateSha: 'abc' })).toContain('GATEA-CANDIDATE-SHA');
    expect(codes(bundle, { candidateSha: CANDIDATE, headSha: OTHER })).toContain('GATEA-CHECKOUT-MISMATCH');
    const dirty = buildHonestBundle(join(workspace, 'neg-dirty'));
    writeJson(join(dirty, 'report.json'), { ...JSON.parse(readJson(join(dirty, 'report.json'))), workingTreeDirty: true });
    expect(codes(dirty, { candidateSha: CANDIDATE })).toContain('GATEA-DIRTY');
    const toolchain = buildHonestBundle(join(workspace, 'neg-tool'));
    writeJson(join(toolchain, 'environment.json'), { nodeVersion: 'v24.22.3', pnpmVersion: '12.18.0' });
    expect(codes(toolchain, { candidateSha: CANDIDATE })).toContain('GATEA-TOOLCHAIN');
    // A pinned-24.22.2 claim without the environment file is refused, not assumed.
    rmSync(join(toolchain, 'environment.json'));
    expect(codes(toolchain, { candidateSha: CANDIDATE })).toContain('GATEA-TOOLCHAIN');
  });

  it('negatives: masquerade shapes — PASS on a diagnostic artefact, PASS verdict beside non-PASS rows, missing row, GA-10a/b misuse, implementer decision, non-exact replay, machine path', () => {
    const codesOf = (dir: string): string[] => evidence.gateACandidateIssues(dir, { candidateSha: CANDIDATE }).map((i) => i.code);

    const verdictBundle = buildHonestBundle(join(workspace, 'neg-verdict'));
    const reg = JSON.parse(readJson(join(verdictBundle, 'ga-rows.json'))) as Record<string, unknown>;
    reg['verdict'] = 'PASS';
    writeJson(join(verdictBundle, 'ga-rows.json'), reg);
    expect(codesOf(verdictBundle)).toContain('GATEA-VERDICT-MASQUERADE');

    const missingRow = buildHonestBundle(join(workspace, 'neg-row'));
    const reg2 = JSON.parse(readJson(join(missingRow, 'ga-rows.json'))) as Record<string, unknown>;
    reg2['rows'] = (reg2['rows'] as Record<string, unknown>[]).filter((r) => r['id'] !== 'GA-13');
    writeJson(join(missingRow, 'ga-rows.json'), reg2);
    expect(codesOf(missingRow)).toContain('GATEA-ROW-MISSING');

    const passRow = buildHonestBundle(join(workspace, 'neg-passrow'));
    const reg3 = JSON.parse(readJson(join(passRow, 'ga-rows.json'))) as Record<string, unknown>;
    const ga9 = (reg3['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    ga9['status'] = 'PASS';
    ga9['artefact'] = { kind: 'DIAGNOSTIC-NOT-GATE-A', sha256: 'a'.repeat(64) };
    writeJson(join(passRow, 'ga-rows.json'), reg3);
    const passCodes = codesOf(passRow);
    expect(passCodes).toContain('GATEA-ROW-MASQUERADE');

    const tena = buildHonestBundle(join(workspace, 'neg-10a'));
    const reg4 = JSON.parse(readJson(join(tena, 'ga-rows.json'))) as Record<string, unknown>;
    const ga10a = (reg4['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-10a')!;
    delete ga10a['owner'];
    writeJson(join(tena, 'ga-rows.json'), reg4);
    expect(codesOf(tena)).toContain('GATEA-OUTSTANDING-INCOMPLETE');
    const reg5 = JSON.parse(readJson(join(tena, 'ga-rows.json'))) as Record<string, unknown>;
    const ga10b = (reg5['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-10b')!;
    ga10b['status'] = 'PASS';
    ga10b['artefact'] = { kind: 'GATE-A', sha256: 'b'.repeat(64) };
    delete ga10b['owner'];
    writeJson(join(tena, 'ga-rows.json'), reg5);
    expect(codesOf(tena)).toContain('GATEA-OUTSTANDING-INCOMPLETE'); // GA-10a/b cannot be PASS at this gate

    const decision = buildHonestBundle(join(workspace, 'neg-decision'));
    writeJson(join(decision, 'decisions', 'gate-a.json'), { actor: 'implementer', decision: 'NOT-PASS' });
    expect(codesOf(decision)).toContain('GATEA-ROLE');
    writeJson(join(decision, 'decisions', 'gate-a.json'), { actor: 'codex-delegated', decision: 'PASS' });
    expect(codesOf(decision)).toContain('GATEA-DECISION-MASQUERADE');

    const replay = buildHonestBundle(join(workspace, 'neg-replay'));
    const rep = JSON.parse(readJson(join(replay, 'ga-replays.json'))) as Record<string, unknown>;
    (rep['legs'] as Record<string, unknown>[])[0]!['exactEqual'] = false;
    writeJson(join(replay, 'ga-replays.json'), rep);
    expect(codesOf(replay)).toContain('GATEA-REPLAYS');

    const leaked = buildHonestBundle(join(workspace, 'neg-path'));
    const reg6 = JSON.parse(readJson(join(leaked, 'ga-rows.json'))) as Record<string, unknown>;
    reg6['operatorNote'] = 'as measured on /home/someone/machine by token=aXq3secret';
    writeJson(join(leaked, 'ga-rows.json'), reg6);
    const leakCodes = codesOf(leaked);
    expect(leakCodes).toContain('GATEA-SECRETS');

    const identity = buildHonestBundle(join(workspace, 'neg-identity'));
    const reg7 = JSON.parse(readJson(join(identity, 'ga-rows.json'))) as Record<string, unknown>;
    reg7['taskId'] = 'UDG-003';
    writeJson(join(identity, 'ga-rows.json'), reg7);
    expect(codesOf(identity)).toContain('GATEA-IDENTITY');
  });
});

function readJson(file: string): string {
  return readFileSync(file, 'utf8');
}

function buildHonestBundle(directory: string): string {
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, 'report.json'), {
    schemaVersion: evidence.EVIDENCE_SCHEMA_VERSION,
    runId: 'unit-honest-dryrun',
    taskId: 'UDG-SPIKE-001',
    phase: 'gate-a',
    implementationSha: CANDIDATE,
    workingTreeDirty: false,
    status: 'FAIL',
  });
  writeJson(join(directory, 'environment.json'), { nodeVersion: 'v24.22.2', pnpmVersion: '12.18.0' });
  const rowsFile = join(directory, 'rows-source.json');
  writeJson(rowsFile, honestRows());
  const register = evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile });
  writeJson(join(directory, 'ga-rows.json'), register.register);
  const bytes = ['{"entityId":"e","locomotion":{}}'];
  writeJson(join(directory, 'ga-replays.json'), {
    schemaVersion: evidence.EVIDENCE_SCHEMA_VERSION,
    kind: 'DIAGNOSTIC-NOT-GATE-A',
    taskId: 'UDG-SPIKE-001',
    implementationSha: CANDIDATE,
    legs: [{ tag: 'solo', ok: true, exactEqual: true, tipEqual: true, liveTip: 't', replayedTip: 't', originalBytes: bytes, replayedBytes: [...bytes] }],
  });
  return directory;
}

/* ------------------------------------------------------------------ slice 11: artefact BYTE binding
 *
 * The register's row entries cite files; the checker must RE-DERIVE the claim from the bytes:
 * confined bundle-relative path (no escape, no absolute, no symlink), file present, SHA-256
 * re-computed, and the artefact's OWN bytes carrying kind + candidate sha + attestation + zero
 * retries for PASS. A `kind: "GATE-A"` string — in the register or even in the artefact — is not
 * evidence by itself. And the rows manifest binding (register.source ↔ ga-rows-source.json) must
 * re-hash and its path bindings must match the register.
 */
describe('UDG-SPIKE-001 Gate A artefact byte binding (slice 11, offline negatives)', () => {
  const gateArtefact = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    schemaVersion: 1,
    kind: 'GATE-A',
    taskId: 'UDG-SPIKE-001',
    implementationSha: CANDIDATE,
    checks: [{ name: 'the leg was exact', ok: true }],
    rotations: [],
    ...over,
  });

  /** A bundle whose GA-9 row is PASS citing a REAL in-bundle artefact, built with bundleDir so the
   * source manifest binding travels too. Everything else stays the honest NOT_RUN shape. */
  function buildBoundBundle(directory: string): string {
    mkdirSync(directory, { recursive: true });
    writeJson(join(directory, 'report.json'), {
      schemaVersion: evidence.EVIDENCE_SCHEMA_VERSION,
      runId: 'unit-bound-dryrun',
      taskId: 'UDG-SPIKE-001',
      phase: 'gate-a',
      implementationSha: CANDIDATE,
      workingTreeDirty: false,
      status: 'FAIL',
    });
    writeJson(join(directory, 'environment.json'), { nodeVersion: 'v24.22.2', pnpmVersion: '12.18.0' });
    mkdirSync(join(directory, 'spike'), { recursive: true });
    writeJson(join(directory, 'spike', 'ga9.json'), gateArtefact());
    const rows = honestRows();
    const ga9 = (rows['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    ga9['status'] = 'PASS';
    ga9['artefactPath'] = join(directory, 'spike', 'ga9.json');
    const rowsFile = join(directory, 'rows-input.json');
    writeJson(rowsFile, rows);
    const built = evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile, bundleDir: directory });
    writeJson(join(directory, 'ga-rows.json'), built.register);
    writeJson(join(directory, 'ga-replays.json'), {
      schemaVersion: evidence.EVIDENCE_SCHEMA_VERSION,
      kind: 'DIAGNOSTIC-NOT-GATE-A',
      taskId: 'UDG-SPIKE-001',
      implementationSha: CANDIDATE,
      legs: [{ tag: 'solo', ok: true, exactEqual: true, tipEqual: true, originalBytes: ['x'], replayedBytes: ['x'] }],
    });
    return directory;
  }

  const codesOf = (dir: string): string[] => evidence.gateACandidateIssues(dir, { candidateSha: CANDIDATE }).map((i) => i.code);
  const resha = (bundle: string, relPath: string): void => {
    const register = JSON.parse(readJson(join(bundle, 'ga-rows.json'))) as Record<string, unknown>;
    const ga9 = (register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    (ga9['artefact'] as Record<string, unknown>)['sha256'] = sha256(readFileSync(join(bundle, relPath), 'utf8'));
    writeJson(join(bundle, 'ga-rows.json'), register);
  };
  const setRegisterPath = (bundle: string, rel: string): void => {
    const register = JSON.parse(readJson(join(bundle, 'ga-rows.json'))) as Record<string, unknown>;
    const ga9 = (register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    (ga9['artefact'] as Record<string, unknown>)['path'] = rel;
    writeJson(join(bundle, 'ga-rows.json'), register);
  };

  it('a bound PASS row whose bytes carry everything produces ZERO issues (the negatives below are teeth)', () => {
    expect(evidence.gateACandidateIssues(buildBoundBundle(join(workspace, 'bound')), { candidateSha: CANDIDATE })).toEqual([]);
  });

  it('altered bytes, wrong candidate, kind downgrade, missing file, escape paths and symlinks are each refused', () => {
    const altered = buildBoundBundle(join(workspace, 'bound-altered'));
    writeJson(join(altered, 'spike', 'ga9.json'), gateArtefact({ note: 'edited after the register digested it' }));
    expect(codesOf(altered)).toContain('GATEA-ARTEFACT-DIGEST');

    const wrongCandidate = buildBoundBundle(join(workspace, 'bound-candidate'));
    writeJson(join(wrongCandidate, 'spike', 'ga9.json'), gateArtefact({ implementationSha: OTHER }));
    resha(wrongCandidate, 'spike/ga9.json');
    const candidateCodes = codesOf(wrongCandidate);
    expect(candidateCodes).toContain('GATEA-ARTEFACT-BYTES'); // cross-candidate evidence refuses

    const downgraded = buildBoundBundle(join(workspace, 'bound-downgrade'));
    writeJson(join(downgraded, 'spike', 'ga9.json'), gateArtefact({ kind: 'DIAGNOSTIC-NOT-GATE-A' }));
    resha(downgraded, 'spike/ga9.json');
    expect(codesOf(downgraded)).toContain('GATEA-ARTEFACT-BYTES'); // a hand-edited register cannot outvote the bytes

    const missing = buildBoundBundle(join(workspace, 'bound-missing'));
    rmSync(join(missing, 'spike', 'ga9.json'));
    expect(codesOf(missing)).toContain('GATEA-ARTEFACT-PATH');

    const escaping = buildBoundBundle(join(workspace, 'bound-escape'));
    setRegisterPath(escaping, '../outside.json');
    expect(codesOf(escaping)).toContain('GATEA-ARTEFACT-PATH');
    setRegisterPath(escaping, '/etc/hosts');
    expect(codesOf(escaping)).toContain('GATEA-ARTEFACT-PATH');

    const symlink = buildBoundBundle(join(workspace, 'bound-symlink'));
    const target = join(workspace, 'symlink-target.json');
    writeJson(target, gateArtefact());
    symlinkSync(target, join(symlink, 'spike', 'link.json'));
    setRegisterPath(symlink, 'spike/link.json');
    (function reshaLink(): void {
      const register = JSON.parse(readJson(join(symlink, 'ga-rows.json'))) as Record<string, unknown>;
      const ga9 = (register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
      (ga9['artefact'] as Record<string, unknown>)['sha256'] = sha256(readFileSync(target, 'utf8'));
      writeJson(join(symlink, 'ga-rows.json'), register);
    })();
    expect(codesOf(symlink)).toContain('GATEA-ARTEFACT-PATH');
  });

  it('PASS needs bytes that ATTEST: a red check inside the artefact, recorded retries, or a path-less citation all refuse', () => {
    const redInside = buildBoundBundle(join(workspace, 'bound-red'));
    writeJson(join(redInside, 'spike', 'ga9.json'), gateArtefact({ checks: [{ name: 'the leg was exact', ok: true }, { name: 'p95 correction', ok: false }] }));
    resha(redInside, 'spike/ga9.json');
    expect(codesOf(redInside)).toContain('GATEA-ARTEFACT-BYTES');

    const retried = buildBoundBundle(join(workspace, 'bound-retry'));
    writeJson(join(retried, 'spike', 'ga9.json'), gateArtefact({ rotations: [{ tag: 'solo-retry1', contamination: 'rotation' }] }));
    resha(retried, 'spike/ga9.json');
    expect(codesOf(retried)).toContain('GATEA-ARTEFACT-BYTES'); // a retry-selected green cannot carry PASS

    const noPath = buildBoundBundle(join(workspace, 'bound-nopath'));
    const register = JSON.parse(readJson(join(noPath, 'ga-rows.json'))) as Record<string, unknown>;
    const ga9 = (register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    delete (ga9['artefact'] as Record<string, unknown>)['path'];
    writeJson(join(noPath, 'ga-rows.json'), register);
    expect(codesOf(noPath)).toContain('GATEA-ARTEFACT-PATH');
  });

  it('the source-manifest binding re-hashes: an altered ga-rows-source.json is named, and the builder refuses artefacts outside the bundle', () => {
    const bundle = buildBoundBundle(join(workspace, 'bound-source'));
    const register = JSON.parse(readJson(join(bundle, 'ga-rows.json'))) as Record<string, unknown>;
    expect((register['source'] as Record<string, unknown>)['sha256'], 'the register carries the manifest digest').toMatch(/^[0-9a-f]{64}$/);
    writeJson(join(bundle, 'ga-rows-source.json'), { schemaVersion: 1, taskId: 'UDG-SPIKE-001', candidateSha: CANDIDATE, rows: [{ id: 'GA-9', status: 'PASS', artefactPath: 'spike/other.json' }] });
    expect(codesOf(bundle)).toContain('GATEA-SOURCE-MANIFEST');

    // Builder side: a PASS citing a file OUTSIDE the bundle dir is demoted, not laundered.
    const outsideDir = join(workspace, 'outside-target');
    mkdirSync(outsideDir, { recursive: true });
    const bundleDir = join(workspace, 'bound-outside');
    mkdirSync(bundleDir, { recursive: true });
    writeJson(join(outsideDir, 'ga9.json'), gateArtefact());
    const rows = honestRows();
    const ga9 = (rows['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    ga9['status'] = 'PASS';
    ga9['artefactPath'] = join(outsideDir, 'ga9.json');
    const rowsFile = join(workspace, 'rows-outside.json');
    writeJson(rowsFile, rows);
    const built = evidence.buildGateARegister({ candidateSha: CANDIDATE, rowsFile, bundleDir: bundleDir });
    const row = (built.register['rows'] as Record<string, unknown>[]).find((r) => r['id'] === 'GA-9')!;
    expect(row['status'], 'evidence that lives outside the bundle is not that bundle\'s evidence').toBe('NOT_RUN');
    expect(built.demotions.join(' ')).toContain('confined to the bundle');
  });
});
