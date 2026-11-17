/**
 * UDG-003 Phase 3 — the whole-task vectors (assignment §5 W-B and §5.1 W-C).
 *
 * These are the artefacts that let the task be captured and gated **as a task**: a bundle whose label says
 * `task` has to be able to say, from bytes it carries, what the whole of UDG-003 claims, what it re-uses
 * from the accepted phases, and what it refuses to claim. The phase vectors stay where they are — this set
 * does not restate them, it attributes them (their digests, their manifests, their phase labels) and then
 * adds the Phase 3 measurement.
 *
 * Nothing here invents a number. Every value is read from a committed record (the W-A declaration, the
 * retained W-A streak) or from an artefact the same run produced (the abuse population, the buffer-depth
 * ledger, the phase manifests). Where an input is absent the suite fails rather than substituting a
 * plausible figure: a whole-task bundle with a hole in it would be worse than no bundle.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_CONFIG, computeConfigHash } from '../../../packages/config/dist/index.js';

export const PHASE_3_VECTOR_FILES: readonly string[] = [
  'wa-declaration.json',
  'wa-streak.json',
  'wa-audit-falsification.json',
  'task-abuse-summary.json',
  'task-attribution.json',
  'task-non-claims.json',
];

const OUTPUT_DIRECTORY =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? join(process.cwd(), 'artifacts', 'udg-003-phase-3')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

/** The bundle under capture, when this suite runs inside one. */
const BUNDLE = process.env['UDG_EVIDENCE_OUT'];

const DECLARATION_FILE = join(
  'docs',
  'contracts',
  'assignments',
  'evidence',
  'UDG-003-phase-3-wa-declaration.json',
);
const STREAK_FILE =
  process.env['UDG_WA_STREAK'] === undefined
    ? join('docs', 'contracts', 'assignments', 'evidence', 'UDG-003-phase-3-wa-streak.json')
    : // A reading-only override, recorded in the vector it produces (`sourceFile` and `sourceSha256` are
      // taken from whatever was read, and the capture plan never sets it). It exists so the reading code
      // could be exercised against a throwaway fixture BEFORE the evidential streak had produced a real
      // file: a 10-iteration streak is 35 minutes, and discovering a parse bug afterwards would invalidate
      // the tree it ran on. Nothing outside a hand-set environment variable can point the gate elsewhere.
      resolve(process.cwd(), process.env['UDG_WA_STREAK']);
const AUDIT_SCRIPT = join('tests', 'system', 'udg-003-phase-3', 'wa-assertion-audit.ts');
const IMPAIRMENT_ARTEFACT = join('artifacts', 'udg-003-phase-2', 'transport-impairment.json');

/**
 * A pinned artefact that is known to audit clean, used as the base of the falsification controls.
 *
 * Why it is pinned rather than "whatever this run produced". `artifacts/udg-003-phase-2/transport-impairment.json`
 * is *rewritten* during a run by the accepted Phase 2 runtime case, and that case is the very thing W-A is
 * watching: when W-7 fires, the live artefact genuinely records `deliveriesReachingTheSeatDuringTheEpisode: 1`,
 * and a control that demanded a clean audit of it would turn one real red into a second and a third red in
 * unrelated files. That is amplification of the defect, which the assignment forbids, so the controls are run
 * against a fixed base whose bytes cannot move, and the live artefact is read for what it is and *recorded*
 * rather than required.
 *
 * It lives under `tests/support/`, not `tests/fixtures/`: every json under `tests/fixtures/` is the UDG-001 fixture
 * registry, whose validator requires a protocol fixture envelope (`fixtureId`, `kind`, `cases`, …) and refuses
 * anything else — which the first placement of this file did, locally, before it was pushed.
 *
 * Provenance: `UDG-003-2026-11-17T22-02-59-469Z-f3d30626/vectors-phase-2/transport-impairment.json`, from
 * hosted run 44183269571 (the submitted head, every bundle verifying with zero issues). Its digest is
 * asserted below, so the base cannot drift silently.
 */
const CLEAN_FIXTURE = join('tests', 'support', 'udg-003', 'wa-audit-clean-artefact.json');
const CLEAN_FIXTURE_SHA256 = 'd9e1dce3cec976f9bb5ae1dca2271e0d8a87ecd6c75b1bb990a9e83ebc26f647';

/** Prefer the bundle's own gated copy of a phase vector; fall back to the local run directory. */
const phaseVector = (phase: string, name: string): string =>
  BUNDLE !== undefined && existsSync(join(BUNDLE, `vectors-${phase}`, name))
    ? join(BUNDLE, `vectors-${phase}`, name)
    : join('artifacts', phase === 'phase-1' ? 'udg-003-phase-1' : 'udg-003-phase-2', name);

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8')) as unknown;

const sha256Of = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

const scratch: string[] = [];

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const write = (name: string, value: unknown): void => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  // The bundle sanitizer would strip a machine path anyway; failing here says which vector tried to
  // carry one instead of quietly rewriting a claim.
  expect(
    /(^|[\s"/(])(\/home\/|\/Users\/|\/workspace\/|\/tmp\/|\/var\/|\/private\/)/.test(text),
    `${name} would carry a machine path`,
  ).toBe(false);
  writeFileSync(join(OUTPUT_DIRECTORY, name), text, 'utf8');
};

const git = (args: readonly string[]): string =>
  spawnSync('git', [...args], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();

interface Declaration {
  schemaVersion: number;
  task: string;
  caseIds: string[];
  load: { spinners: number; kind: string };
  testOrder: { command: string; scope: string };
  rule: { passes: number; consecutive: boolean; hosted: string };
  preservedUnchanged: Record<string, unknown>;
}

interface StreakSummary {
  schemaVersion: number;
  task: string;
  started: string;
  finished: string;
  machineClass: Record<string, unknown>;
  declaredLoad: Declaration['load'];
  declaredOrder: Declaration['testOrder'];
  iterations: number;
  w7: { reached: number; firstRedIteration: number | null };
  p2b: { reached: number; firstRedIteration: number | null };
  results: {
    iteration: number;
    suiteExit: number;
    seconds: number;
    w7: string;
    p2b: string;
    probeVerdict: string;
    probeControlsFailing: string[];
    auditChecks: number;
    auditFailing: { id: string; defect: string }[];
  }[];
}

/**
 * Everything this set is derived from. Ordering across vitest files is not a thing to depend on (the
 * accepted Phase 2 vectors suite says the same), so on a fresh checkout the phase artefacts may not exist
 * yet when this file executes. The honest branch is the gate's own: no inputs, no manifest — and the test
 * below asserts that absence instead of writing a manifest over a half-run.
 */
const INPUTS = [
  STREAK_FILE,
  DECLARATION_FILE,
  IMPAIRMENT_ARTEFACT,
  phaseVector('phase-1', 'vectors-manifest.json'),
  phaseVector('phase-2', 'vectors-manifest.json'),
  phaseVector('phase-2', 'abuse-results.json'),
  phaseVector('phase-2', 'room-lifecycle.json'),
  phaseVector('phase-2', 'buffer-depth.csv'),
];
const READY = INPUTS.every((file) => existsSync(file));
/**
 * The half-run branch, in the shape the accepted Phase 2 vectors suite uses: the test still *runs* and
 * asserts the negative, instead of registering a skipped test. A skipped test inside a capture is refused by
 * `EVIDENCE-SKIP-PRESENT`, and it should be — but the honest reading of "the inputs are not here yet" is a
 * passing assertion that no manifest was written, not a skip that a reader has to explain.
 */
const halfRun = (): boolean => {
  if (READY) return false;
  const absent = INPUTS.filter((file) => !existsSync(file)).map((file) => file.replace(process.cwd(), '.'));
  expect(
    existsSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json')),
    `inputs ${absent.join(', ')} are absent — a manifest over a partial set is a half-run, not evidence, and must not exist`,
  ).toBe(false);
  return true;
};

const auditOn = (mutate?: (artefact: Record<string, unknown>) => void): {
  status: number;
  failing: { id: string; defect: string }[];
} => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-task-vectors-'));
  scratch.push(directory);
  copyFileSync(CLEAN_FIXTURE, join(directory, 'transport-impairment.json'));
  const file = join(directory, 'transport-impairment.json');
  if (mutate !== undefined) {
    const artefact = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    mutate(artefact);
    writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  }
  const executed = spawnSync(process.execPath, [AUDIT_SCRIPT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const report = existsSync(join(directory, 'audit.json'))
    ? (JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as { failing: { id: string; defect: string }[] })
    : { failing: [] };
  return { status: executed.status ?? -1, failing: report.failing };
};

/** Audit the artefact this run actually produced, for measurement only — never as a control. */
const auditLive = (): { present: boolean; status: number; failing: { id: string; defect: string }[] } => {
  if (!existsSync(IMPAIRMENT_ARTEFACT)) return { present: false, status: -1, failing: [] };
  const directory = mkdtempSync(join(tmpdir(), 'udg-task-live-'));
  scratch.push(directory);
  copyFileSync(IMPAIRMENT_ARTEFACT, join(directory, 'transport-impairment.json'));
  const executed = spawnSync(process.execPath, [AUDIT_SCRIPT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const report = existsSync(join(directory, 'audit.json'))
    ? (JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as { failing: { id: string; defect: string }[] })
    : { failing: [] };
  return { present: true, status: executed.status ?? -1, failing: report.failing };
};

const setLeaf = (artefact: Record<string, unknown>, dotted: string, value: unknown): void => {
  const keys = dotted.split('.');
  let walked = artefact;
  for (const key of keys.slice(0, -1)) {
    const next = walked[key];
    if (typeof next !== 'object' || next === null) throw new Error(`no object at ${key} in ${dotted}`);
    walked = next as Record<string, unknown>;
  }
  walked[keys[keys.length - 1] ?? ''] = value;
};

/**
 * Re-hash every file a manifest directory lists and say whether the bytes still match — rule R-1 of
 * section 8.2.1, measured from the bytes rather than copied from the manifest being checked.
 */
const digestsMatchIn = (directory: string): boolean => {
  const manifest = readJson(join(directory, 'vectors-manifest.json')) as { files?: { name: string; sha256: string }[] };
  const listed = manifest.files ?? [];
  return listed.length > 0
    && listed.every((entry) => {
      try {
        return sha256Of(readFileSync(join(directory, entry.name))) === entry.sha256;
      } catch {
        return false;
      }
    });
};


describe('UDG-003 Phase 3 task vectors', () => {
  it('writes the W-A declaration as a vector, with the order and load the streak had to honour', () => {
    if (halfRun()) return;
    const declaration = readJson(DECLARATION_FILE) as Declaration;
    expect(declaration.task, 'the declaration belongs to this task').toBe('UDG-003');
    expect(declaration.rule.passes, 'the assignment fixes the streak at ten').toBe(10);
    expect(declaration.caseIds.length, 'both defects are named').toBe(2);
    // The preserve-list is part of the declaration; a declaration that stopped naming the values it
    // preserves would let a later edit preserve something else.
    const preserved = JSON.stringify(declaration.preservedUnchanged);
    for (const needle of ['500', '4000', '"rejoinWindowAllowance"', '4100', '4101', '4102']) {
      expect(preserved, `the declaration must preserve ${needle}`).toContain(needle);
    }
    write('wa-declaration.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      sourceFile: DECLARATION_FILE,
      sourceSha256: sha256Of(readFileSync(DECLARATION_FILE)),
      committedAt: git(['log', '-1', '--format=%cI', '--', DECLARATION_FILE]),
      declaration,
    });
  });

  it('reads the retained W-A streak and demands the declared consecutive passes per defect', () => {
    if (halfRun()) return;
    expect(existsSync(STREAK_FILE), `${STREAK_FILE} must exist: no streak, no whole-task bundle`).toBe(true);
    const declaration = readJson(DECLARATION_FILE) as Declaration;
    const streak = readJson(STREAK_FILE) as StreakSummary;

    // The streak must be the one the declaration describes — same load, same order, same case ids — or the
    // ten passes are a different experiment's number.
    expect(JSON.stringify(streak.declaredLoad)).toBe(JSON.stringify(declaration.load));
    expect(JSON.stringify(streak.declaredOrder)).toBe(JSON.stringify(declaration.testOrder));
    expect(streak.iterations, 'the retained streak ran the declared iteration count').toBe(declaration.rule.passes);
    expect(streak.results.length, 'every iteration is retained').toBe(declaration.rule.passes);
    for (const row of streak.results) {
      expect(row.w7, `iteration ${String(row.iteration)} W-7`).toBe('passed');
      expect(row.p2b, `iteration ${String(row.iteration)} P-2b`).toBe('passed');
      expect(row.auditFailing, `iteration ${String(row.iteration)} per-assertion audit`).toEqual([]);
    }
    expect(streak.w7.reached, 'W-7 consecutive passes').toBe(declaration.rule.passes);
    expect(streak.p2b.reached, 'P-2b consecutive passes').toBe(declaration.rule.passes);
    expect(streak.w7.firstRedIteration).toBeNull();
    expect(streak.p2b.firstRedIteration).toBeNull();

    const committedAt = git(['log', '-1', '--format=%cI', '--', DECLARATION_FILE]);
    const declaredBeforeStreak = committedAt !== '' && Date.parse(committedAt) <= Date.parse(streak.started);

    write('wa-streak.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      // The committed path is recorded as a path; an override is recorded as what it is, because an
      // absolute path outside the repository is exactly the machine path the bundle sanitizer exists to
      // refuse, and a vector that quietly carried one would make a fixture look like a record.
      sourceFile: process.env['UDG_WA_STREAK'] === undefined
        ? STREAK_FILE
        : 'overridden by UDG_WA_STREAK: not the committed W-A streak record',
      sourceSha256: sha256Of(readFileSync(STREAK_FILE)),
      declaredBeforeStreak,
      // The ordering proof is a comparison of two timestamps the repository holds, not of a claim in prose.
      declaredAt: committedAt,
      streakStartedAt: streak.started,
      streakFinishedAt: streak.finished,
      machineClass: streak.machineClass,
      declaredLoad: streak.declaredLoad,
      declaredOrder: streak.declaredOrder,
      consecutivePasses: { w7: streak.w7.reached, p2b: streak.p2b.reached },
      iterations: streak.results.map((row) => ({
        iteration: row.iteration,
        w7: row.w7,
        p2b: row.p2b,
        seconds: row.seconds,
        suiteExit: row.suiteExit,
        probeVerdict: row.probeVerdict,
        probeControlsFailing: row.probeControlsFailing,
        auditChecks: row.auditChecks,
        auditFailing: row.auditFailing.map((entry) => `${entry.defect}:${entry.id}`),
      })),
      // Retained honestly: a red in an unrelated file (a toolchain pin the container cannot satisfy, a
      // browser result this host cannot produce) leaves a non-zero suite exit that the per-case scoring
      // deliberately does not treat as a W-7 or P-2b result. Hiding it would be the cleaner-looking lie.
      iterationsWithNonZeroSuiteExit: streak.results.filter((row) => row.suiteExit !== 0).map((row) => row.iteration),
    });
  });

  it('proves the audit is falsifiable, per defect, from a base whose bytes cannot move', () => {
    if (halfRun()) return;
    expect(sha256Of(readFileSync(CLEAN_FIXTURE)), 'the falsification base is the pinned artefact').toBe(CLEAN_FIXTURE_SHA256);
    const clean = auditOn();
    expect(clean.status, 'the pinned base audits clean').toBe(0);
    const live = auditLive();

    const w7 = auditOn((artefact) => {
      setLeaf(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode', 1);
    });
    const p2b = auditOn((artefact) => {
      setLeaf(artefact, 'ga6Ga7.reconnectFailures', [{ case: 'GA-7', message: 'Seat reservation expired.' }]);
    });

    expect(w7.status, 'a mutated W-7 counter must not exit clean').not.toBe(0);
    expect(w7.failing.map((entry) => entry.id)).toContain('w7-deliveries-in-window');
    expect(p2b.status, 'a mutated P-2b refusal must not exit clean').not.toBe(0);
    expect(p2b.failing.map((entry) => entry.id)).toContain('p2b-first-refusal-matches-token');

    write('wa-audit-falsification.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      falsifiable: true,
      note:
        'A per-assertion audit that has only ever been seen passing is not a control. This vector mutates a copy ' +
        'of a pinned impairment artefact that is known to audit clean, once per defect, and requires the audit to ' +
        'name the defect it guards. The copies live in a temporary directory; nothing under the tree or the store ' +
        'is mutated. The base is pinned deliberately: the live artefact is rewritten during the run by the very ' +
        'case W-A watches, so requiring it to audit clean here would report one real W-7 as three failures.',
      controlBase: {
        file: CLEAN_FIXTURE.replace(process.cwd(), '.'),
        sha256: CLEAN_FIXTURE_SHA256,
        provenance:
          'UDG-003-2026-11-17T22-02-59-469Z-f3d30626/vectors-phase-2/transport-impairment.json, hosted run ' +
          '44183269571 (submitted head; all five bundles verify with zero issues)',
      },
      clean: { exitCode: clean.status, failing: clean.failing },
      // Read from the artefact this run produced, and carried as a measurement. When W-7 fires this is where
      // a reader sees it, and the suite does not turn red over it a second time.
      liveArtefactAudit: {
        file: IMPAIRMENT_ARTEFACT.replace(process.cwd(), '.'),
        present: live.present,
        exitCode: live.status,
        failing: live.failing.map((entry) => `${entry.defect}:${entry.id}`),
      },
      mutations: {
        w7: {
          path: 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode',
          to: 1,
          recordedHostedMessage: 'expected 1 to be 0',
          exitCode: w7.status,
          namedChecks: w7.failing.map((entry) => `${entry.defect}:${entry.id}`),
        },
        p2b: {
          path: 'ga6Ga7.reconnectFailures',
          to: '[{ case: "GA-7", message: "Seat reservation expired." }]',
          recordedHostedMessage: "expected 'seat reservation expired.' to match /token/i",
          exitCode: p2b.status,
          namedChecks: p2b.failing.map((entry) => `${entry.defect}:${entry.id}`),
        },
      },
    });
  });

  it('summarises the task-level abuse and buffer-depth claims the whole task is measured on', () => {
    if (halfRun()) return;
    const abuse = readJson(phaseVector('phase-2', 'abuse-results.json')) as Record<string, unknown>;
    const lifecycle = readJson(phaseVector('phase-2', 'room-lifecycle.json')) as {
      joins?: number;
      joinRefusals?: number;
      closures?: { entityId: string; code: number }[];
      reconnections?: unknown[];
      ticksAtEnd?: number;
    };
    const csv = readFileSync(phaseVector('phase-2', 'buffer-depth.csv'), 'utf8').trim().split(/\r?\n/);
    const header = (csv[0] ?? '').split(',');
    const depthColumn = header.indexOf('maxDepth');
    expect(depthColumn, `buffer-depth.csv must carry a maxDepth column, got ${header.join(',')}`).toBeGreaterThanOrEqual(0);
    const depths = csv
      .slice(1)
      .map((row) => Number(row.split(',')[depthColumn]))
      .filter((value) => Number.isFinite(value));
    expect(depths.length, 'the buffer ledger has rows').toBeGreaterThan(0);
    const declaredBufferCap = 32;
    const highWater = Math.max(...depths);

    // Observer isolation, read from the room's own closure list rather than from a scenario's summary:
    // every closure this room recorded must be an attributed offender closure. A compliant seat that was
    // closed would appear here as a code that is not 4100/4101, and that is the whole claim.
    const closures = lifecycle.closures ?? [];
    const offenderCodes = new Set([4100, 4101]);
    const nonOffenderClosures = closures.filter((entry) => !offenderCodes.has(entry.code));
    // What is asserted here is the *derivation*, not the outcome. `offendersClosedWithAttributedCodes === 2`
    // is a property of a run, and a run under load can legitimately close fewer seats — the accepted runtime
    // case is the authority on the population's verdict, and it already fails there when the premise breaks.
    // Asserting the counts a second time in a vector file would only relocate the same red into a file whose
    // name suggests a capture defect. The numbers are written into the vector either way, so a reader sees
    // what actually happened rather than a green tick over an unstated assumption.
    expect(typeof highWater, 'the buffer high-water is a number').toBe('number');
    expect(Number.isInteger(highWater), 'the buffer high-water is a whole number of frames').toBe(true);
    expect(closures.every((entry) => typeof entry.code === 'number' && typeof entry.entityId === 'string'),
      'every closure row names a seat and a numeric code').toBe(true);
    expect(offenderCodes.size, 'the offender pair is the pinned pair').toBe(2);

    write('task-abuse-summary.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      sourceFiles: {
        abuse: phaseVector('phase-2', 'abuse-results.json').replace(process.cwd(), '.'),
        lifecycle: phaseVector('phase-2', 'room-lifecycle.json').replace(process.cwd(), '.'),
        bufferDepth: phaseVector('phase-2', 'buffer-depth.csv').replace(process.cwd(), '.'),
      },
      sourceDigests: {
        abuse: sha256Of(readFileSync(phaseVector('phase-2', 'abuse-results.json'))),
        lifecycle: sha256Of(readFileSync(phaseVector('phase-2', 'room-lifecycle.json'))),
        bufferDepth: sha256Of(readFileSync(phaseVector('phase-2', 'buffer-depth.csv'))),
      },
      // Carried as data, not as this file's claim: the accepted runtime case reads the same verdict and
      // fails the suite on it. Re-asserting it here would hide where a red actually arrived.
      abusePopulationVerdict: abuse['verdict'] ?? null,
      room: {
        joins: lifecycle.joins ?? null,
        joinRefusals: lifecycle.joinRefusals ?? null,
        ticksAtEnd: lifecycle.ticksAtEnd ?? null,
        closures,
        reconnections: lifecycle.reconnections ?? [],
      },
      offendersClosedWithAttributedCodes: closures.filter((entry) => offenderCodes.has(entry.code)).length,
      // Measured from the room's own closure list: a compliant seat that had been closed would be a
      // closure whose code is not 4100/4101, and there are none.
      compliantSeatClosures: nonOffenderClosures.length,
      clientFrameQueue: {
        declaredCap: declaredBufferCap,
        highWater,
        rows: depths.length,
        boundRespected: highWater <= declaredBufferCap,
        meaning:
          'the transport buffer per the room tick record, sampled per tick in buffer-depth.csv; the authority ' +
          'queue in abuse-results.json#queues.authorityQueue is a different queue and the two are not comparable',
      },
      // Named rather than smoothed: the discrete 1 MiB / 60-second half of the buffer bound is UDG-007's,
      // because the server-side encoder that would produce those bytes does not exist at this task.
      outstandingWithUdg007: [
        'discrete 1 MiB / 60-second backlog measured against the server-side encoder (UDG-007, UDG-003 §8.2.2)',
      ],
    });
  });

  it('attributes the accepted phases and the config-hash era this bundle was produced under', () => {
    if (halfRun()) return;
    const phase1 = readJson(phaseVector('phase-1', 'vectors-manifest.json')) as Record<string, unknown>;
    const phase2 = readJson(phaseVector('phase-2', 'vectors-manifest.json')) as Record<string, unknown>;
    const prePhase2 = '948f8c10142239a2f3118795e8afa71a749ed09b316961b671d9b915d024cb01';
    const currentHash = computeConfigHash(DEFAULT_SERVER_CONFIG);

    write('task-attribution.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      implementationSha: git(['rev-parse', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      workingTreeDirty: git(['status', '--porcelain']) !== '',
      configHash: {
        prePhase2Baseline: prePhase2,
        current: currentHash,
        note:
          'UDG-002 baseline bytes hash to the pre-Phase-2 digest; everything in this bundle was produced under the ' +
          'current digest. History keeps its own value (§6.4 rule R-1), which is why both digests are named.',
      },
      acceptedPhases: {
        phase1: {
          label: phase1['phase'] ?? null,
          sha256: sha256Of(readFileSync(phaseVector('phase-1', 'vectors-manifest.json'))),
          files: (phase1['files'] as unknown[])?.length ?? null,
        },
        phase2: {
          label: phase2['phase'] ?? null,
          sha256: sha256Of(readFileSync(phaseVector('phase-2', 'vectors-manifest.json'))),
          files: (phase2['files'] as unknown[])?.length ?? null,
        },
      },
      carriedObligations: {
        'GA-10a': 'UDG-007 (real region-greybox-001, real scene transition)',
        'GA-10b': 'UDG-007 (navigation-result publication, §8.2.2)',
        'AC-6 results half': 'UDG-007 (the navigation result the camera consumes)',
        'GA-11': 'UDG-SPIKE-001 (network-condition profiles; not evaluated by UDG-003)',
        'formal Gate A': 'UDG-SPIKE-001 (UDG-003 provides the substrate it will run on)',
        'production client': 'UDG-008 (the harness here is a test double, by design)',
      },
    });
  });

  it('records what the task refuses to claim, as gated bytes', () => {
    if (halfRun()) return;
    write('task-non-claims.json', {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      gateA: 'Not Run',
      gateB: 'Not Run',
      gateC: 'Not Run',
      ga11: 'not evaluated by UDG-003 — network-condition profiles belong to UDG-SPIKE-001',
      stackCompatibility: 'not-established; no compatibility claim is made from a pinned local harness',
      deduplicationTriggeredClosure: 'disabled (owner decision: no auto-close on dedupe in Phase 3)',
      decisionD4: 'open (evidence stays in the existing store; no archive, tag, release or second destination)',
      implementationStatus:
        'In Review on submission — the task stays In Progress until the reviewer accepts it',
      productionClient: 'UDG-008 owns the production client; the client harness here is a test double',
      note:
        'This file exists so a whole-task bundle cannot be read as a gate pass by a reader who never opens the ' +
        'contract. The verifier does not interpret it; it requires it to be present, hash-covered and to declare ' +
        'this task.',
    });
  });

  it('writes the phase-3 manifest that gates this set, and refuses a stale or partial one', () => {
    if (halfRun()) return;
    for (const name of PHASE_3_VECTOR_FILES) {
      expect(existsSync(join(OUTPUT_DIRECTORY, name)), `${name} must be written before the manifest`).toBe(true);
    }
    const files = PHASE_3_VECTOR_FILES.map((name) => {
      const bytes = readFileSync(join(OUTPUT_DIRECTORY, name));
      return { name, bytes: bytes.length, sha256: sha256Of(bytes) };
    });
    const manifest = {
      schemaVersion: 1,
      taskId: 'UDG-003',
      phase: 'phase-3',
      runId: process.env['UDG_RUN_ID'] ?? null,
      scopeNote:
        'These vectors cover UDG-003 Phase 3 (the W-A defect work, the task-level abuse and buffer-depth reading, ' +
        'and the whole-task capture) and they attribute the accepted phase vector sets rather than restating them. ' +
        'They are not a third-party stack compatibility claim, not a Gate A, B or C pass, and not UDG-008 ' +
        'production client recovery.',
      implementationSha: git(['rev-parse', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      workingTreeDirty: git(['status', '--porcelain']) !== '',
      toolchain: { node: process.version },
      files,
    };
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    expect(/(^|[\s"'])\/(?:home|Users|workspace|tmp|var|private)\//.test(text), 'manifest machine path').toBe(false);
    writeFileSync(join(OUTPUT_DIRECTORY, 'vectors-manifest.json'), text, 'utf8');

    // The gate the capture plan invokes, run here on the directory it just wrote. A dirty working tree is
    // passed `--allow-dirty` because this file's own artefacts are untracked; the plan's own
    // `phase-3-vectors-verify` command runs the same gate WITHOUT that flag, so a captured bundle still
    // requires a clean tree, and the manifest records `workingTreeDirty` either way.
    const dirty = git(['status', '--porcelain']) !== '';
    const gated = spawnSync(
      process.execPath,
      [
        join('tools', 'checks', 'dist', 'evidence.js'),
        'vectors',
        '--dir',
        OUTPUT_DIRECTORY,
        '--expect-phase',
        'phase-3',
        ...(dirty ? ['--allow-dirty'] : []),
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
    );
    expect(gated.status, `${gated.stdout}${gated.stderr}`).toBe(0);
  });

  it('writes the task-scope measurement block the whole-task bundle pairs with', () => {
    if (halfRun()) return;
    const target = process.env['UDG_EVIDENCE_MEASUREMENTS'];
    const ownsRun = process.env['UDG_EVIDENCE_TASK'] === 'UDG-003-TASK' && target !== undefined;
    if (!ownsRun) {
      // Outside a whole-task capture this suite produces no measurement block; the phase block stays the
      // phase suite's own. Saying so beats writing a file no bundle was asked to carry.
      return;
    }
    const streak = readJson(STREAK_FILE) as StreakSummary;
    const declaration = readJson(DECLARATION_FILE) as Declaration;
    const committedAt = git(['log', '-1', '--format=%cI', '--', DECLARATION_FILE]);
    const falsification = readJson(join(OUTPUT_DIRECTORY, 'wa-audit-falsification.json')) as { falsifiable: boolean };
    const abuse = readJson(join(OUTPUT_DIRECTORY, 'task-abuse-summary.json')) as {
      offendersClosedWithAttributedCodes: number;
      compliantSeatClosures: number;
      abusePopulationVerdict: string | null;
      clientFrameQueue: { highWater: number; declaredCap: number; rows: number };
    };

    const phase1Manifest = readJson(phaseVector('phase-1', 'vectors-manifest.json')) as { files?: unknown[] };
    const phase2Manifest = readJson(phaseVector('phase-2', 'vectors-manifest.json')) as { files?: unknown[] };
    const phase1Files = (phase1Manifest.files ?? []).length;
    const phase2Files = (phase2Manifest.files ?? []).length;
    // `report.measured` IS this object (the collector does not unwrap a `measured` key), so the plan's
    // threshold keys are dotted paths INTO it: `wa.streakPerDefect.w7` resolves through `wa` and
    // `streakPerDefect`. Flat dotted keys would resolve to nothing and every threshold would read as
    // unmeasured decoration.
    const block = {
      schemaVersion: 1,
      // The identity the bundle verifies against is the task, not the selector: `UDG-003-TASK.json` is a
      // file name, and the report inside says which task it is evidence for.
      taskId: 'UDG-003',
      phase: { scope: 'task' },
      generatedAt: new Date().toISOString(),
      toolchain: { node: process.version },
      vectors: {
        artefacts: phase1Files + phase2Files + PHASE_3_VECTOR_FILES.length,
        // Recomputed here from the bytes on disk, not copied from a manifest: a digest that matches the
        // manifest but not the file is exactly what the gate exists to catch.
        digestsMatchBytes:
          digestsMatchIn(dirname(phaseVector('phase-1', 'vectors-manifest.json')))
          && digestsMatchIn(dirname(phaseVector('phase-2', 'vectors-manifest.json')))
          && digestsMatchIn(OUTPUT_DIRECTORY),
      },
      wa: {
        declaredBeforeStreak: committedAt !== '' && Date.parse(committedAt) <= Date.parse(streak.started),
        declaredPasses: declaration.rule.passes,
        auditFalsifiable: falsification.falsifiable === true,
        streakPerDefect: { w7: streak.w7.reached, p2b: streak.p2b.reached },
        iterationsWithNonZeroSuiteExit: streak.results.filter((row) => row.suiteExit !== 0).length,
      },
      task: {
        bufferHighWater: abuse.clientFrameQueue.highWater,
        bufferDeclaredCap: abuse.clientFrameQueue.declaredCap,
        bufferBound: abuse.clientFrameQueue.highWater <= abuse.clientFrameQueue.declaredCap,
        bufferLedgerRows: abuse.clientFrameQueue.rows,
        offendersClosedAttributed: abuse.offendersClosedWithAttributedCodes,
        compliantSeatClosures: abuse.compliantSeatClosures,
        observerIsolation: abuse.compliantSeatClosures === 0 && abuse.offendersClosedWithAttributedCodes >= 2,
        // Carried because the accepted runtime case reads the same field and fails on it; naming it here
        // means a red says which probe it arrived in instead of surfacing only as a bundle failure.
        abusePopulationVerdict: abuse.abusePopulationVerdict,
        noGateAClaim: true,
      },
    };
    mkdirSync(dirname(target as string), { recursive: true });
    writeFileSync(target as string, `${JSON.stringify(block, null, 2)}\n`, 'utf8');
  });
});
