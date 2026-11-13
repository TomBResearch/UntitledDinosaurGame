/**
 * The Phase 2 runtime suites inside `pnpm test` (assignment §8.1: a zero-test or skipped suite is
 * not evidence; the population and recovery scenarios must therefore run in the suite, not only in
 * the capture plan).
 *
 * The scripts themselves are bare-Node TypeScript — the same runtime PR-14 uses — because the
 * pinned packages resolve exactly as `apps/server` resolves them and vitest's module pipeline is a
 * second, different set of semantics nobody needs here. This wrapper builds the server first (the
 * CI job runs `pnpm test` before its build step, and the scripts import the emitted room), spawns
 * each script, and reads back its verdict from the artefacts it wrote. A script that fails, hangs,
 * or writes an artefact that says `fail` fails this suite.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR =
  process.env['UDG_VECTORS_OUT'] === undefined
    ? join(ROOT, 'artifacts', 'udg-003-phase-2')
    : resolve(process.cwd(), process.env['UDG_VECTORS_OUT']);

const run = (argv: readonly string[], timeoutMs: number, extraEnv: Record<string, string> = {}) => {
  const started = spawnSync(argv[0] ?? '', argv.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, ...extraEnv },
  });
  return {
    exitCode: started.status ?? (started.error !== undefined ? -1 : 0),
    stdout: started.stdout ?? '',
    stderr: started.stderr ?? '',
    timedOut: started.error !== undefined && String(started.error.message).includes('timed out'),
  };
};

const runScript = (relative: string, args: readonly string[] = [], extraEnv: Record<string, string> = {}): void => {
  const executed = run([process.execPath, relative, ...args], 240_000, extraEnv);
  const tail = executed.stderr.split('\n').filter((line) => line.includes('[')).slice(-6).join('\n');
  expect(executed.timedOut, `${relative} timed out`).toBe(false);
  expect(executed.exitCode, `${relative} exited ${String(executed.exitCode)}\n${tail}`).toBe(0);
};

describe('UDG-003 Phase 2 runtime — the population and the recovery scenarios', () => {
  it('builds the server the scripts drive (the suite runs before the job builds it)', () => {
    const built = run(['pnpm', '--filter', '@udg/server', 'build'], 240_000);
    expect(built.exitCode, `server build failed: ${built.stdout}${built.stderr}`).toBe(0);
    expect(existsSync(join(ROOT, 'apps', 'server', 'dist', 'rooms', 'RegionRoom.js'))).toBe(true);
  });

  it('runs the adversarial population and reads back a passing verdict (W-10, W-9)', () => {
    runScript('tests/runtime/udg-003-phase-2/abuse-population.ts');
    const resultsPath = join(OUT_DIR, 'abuse-results.json');
    expect(existsSync(resultsPath), 'the population must write abuse-results.json').toBe(true);
    const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
      verdict: string;
      scenarios: { scenario: string; pass: boolean; observed: Record<string, unknown> }[];
    };
    expect(results.verdict).toBe('pass');
    expect(results.scenarios.filter((entry) => !entry.pass).map((entry) => entry.scenario)).toEqual([]);

    // ── T-0 / F-1: the population's compliant seats are CONSUMED, not merely represented ──────────
    const seatRows = (results.scenarios.find((entry) => entry.scenario === 'compliant-control-population')!
      .observed['seats'] as Record<string, unknown>[]);
    expect(seatRows.length).toBe(3);
    for (const seat of seatRows) {
      expect(seat['allSentStampsConsumed'], `control seat ${String(seat['sessionId'])} consumed every stamp`).toBe(true);
      expect(seat['missingStamps']).toEqual([]);
      expect(seat['stampsRefused']).toBe(0);
      expect(seat['pairingConsistent']).toBe(true);
      expect(seat['movedMeters']).toBe(seat['expectedMeters']);
    }

    // The control that makes the assertion above falsifiable: identical frames, one epoch apart. The
    // compliant-stream check has to FAIL for the wrong-epoch seat while the old watermark check still
    // passes for it — if either half of that flips, consumption is not what is being measured.
    const epochControl = results.scenarios.find((entry) => entry.scenario === 'wrong-epoch-stream-fails-the-compliant-assertion');
    expect(epochControl, 'the wrong-epoch control must run').toBeDefined();
    const control = epochControl!.observed;
    expect(control['compliantAssertionPassedForCorrectSeat']).toBe(true);
    expect(control['compliantAssertionPassedForWrongSeat']).toBe(false);
    const wrongSeat = control['wrongSeat'] as Record<string, unknown>;
    expect(wrongSeat['stampsConsumed']).toBe(0);
    expect(wrongSeat['stampsRefused']).toBe(8);
    expect(wrongSeat['movedMeters']).toBe(0);
    expect(control['watermarkWouldHaveCalledItCompliant']).toBe(true);

    // An offender that is closed for the right reason: its frames were valid, so the closure can only
    // be the rate ceiling and the retirement, never a screen refusal.
    const rate = results.scenarios.find((entry) => entry.scenario === 'rate-ceiling-closes-directly')!;
    expect((rate.observed['rateWindow'] as Record<string, unknown>)['stampsRefused']).toBe(0);

    const w9 = JSON.parse(readFileSync(join(OUT_DIR, 'close-path-accounting.json'), 'utf8')) as { measurement: Record<string, unknown> };
    expect(typeof w9.measurement['serverQueuedAtClose']).toBe('number');
  }, 300_000);

  it('runs the recovery scenarios and reads back a passing verdict (W-7)', () => {
    runScript('tests/runtime/udg-003-phase-2/recovery-scenarios.ts');
    const harnessPath = join(OUT_DIR, 'recovery-harness.json');
    expect(existsSync(harnessPath), 'the scenarios must write recovery-harness.json').toBe(true);
    const harness = JSON.parse(readFileSync(harnessPath, 'utf8')) as {
      verdict: string;
      scenarios: { name: string; pass: boolean }[];
    };
    expect(harness.verdict).toBe('pass');
    expect(harness.scenarios.filter((entry) => !entry.pass).map((entry) => entry.name)).toEqual([]);
  }, 300_000);
});

  // ── T-0b … T-4: the repair batch's own assertions ─────────────────────────────────────────────
  it('T-0b: every recovery seat waits for its epoch binding and its accepted input is asserted', () => {
    const harness = JSON.parse(readFileSync(join(OUT_DIR, 'recovery-harness.json'), 'utf8')) as {
      verdict: string;
      scenarios: { name: string; observed: Record<string, unknown> }[];
    };
    expect(harness.verdict).toBe('pass');
    const byName = new Map(harness.scenarios.map((entry) => [entry.name, entry.observed]));

    // The three scenarios that need accepted input each carry a stream record: the stamps they sent,
    // the dispositions the authority journalled, and the metres that follows. Before T-0b the recovery
    // rooms had 4, 2, 0 and 0 accepted frames; a refusal advances the watermark all the same, which is
    // exactly why the claim has to be about dispositions.
    for (const name of [
      'same-delivery-pairing-on-the-wire',
      'client-deadline-fires-with-zero-deliveries-and-the-record-recovers',
      'episode-deadline-closes-the-client-at-4000ms',
    ]) {
      const stream = byName.get(name)?.['stream'] as Record<string, unknown>;
      expect(stream, `${name} carries a stream record`).toBeDefined();
      expect(stream['allSentStampsConsumed'], `${name} had every stamp consumed`).toBe(true);
      expect(stream['stampsRefused']).toBe(0);
      expect((stream['journal'] as Record<string, unknown>)['allClientFramesConsumed']).toBe(true);
      expect(Number(stream['movedMeters'])).toBeGreaterThan(0);
    }

    // The allowance scenario spans stamp domains, so its claim is per-domain and measured while each
    // room was still live. Nothing here pretends a disposed domain leaves rows behind.
    const allowance = byName.get('two-actual-rejoins-per-rolling-window-and-the-third-is-refused')!;
    const domains = allowance['rejoinStreams'] as { epoch: number; accepted: boolean }[];
    expect(domains.length).toBe(2);
    expect(domains.every((domain) => domain.accepted)).toBe(true);
    expect(new Set(domains.map((domain) => domain.epoch)).size).toBe(2);
  });

  it('T-1: AC-1 derives 40 m from the trace rows, with both tolerance controls', () => {
    runScript('tests/reference/flat-direct-step.ts');
    const trace = JSON.parse(readFileSync(join(OUT_DIR, 'reference-trace.json'), 'utf8')) as {
      verdict: string;
      checks: Record<string, unknown>;
      controls: { name: string; expectedDetected: boolean; detected: boolean }[];
    };
    expect(trace.verdict).toBe('pass');
    expect(trace.checks['referenceTickCount']).toBe(200);
    expect(Math.abs(Number(trace.checks['referenceMetresFromRows']) - 40)).toBeLessThanOrEqual(1e-6);
    expect(trace.checks['ac1WithinTolerance']).toBe(true);
    expect(trace.checks['deterministicAcrossRuns']).toBe(true);
    expect(trace.controls.every((control) => control.detected === control.expectedDetected)).toBe(true);
    // The pair the owner asked for specifically: a displacement inside 1e-6 must NOT be reported and one
    // beyond it must be.
    expect(trace.controls.some((c) => c.name === 'within-tolerance-displacement-is-not-reported' && c.expectedDetected === false && c.detected === false)).toBe(true);
    expect(trace.controls.some((c) => c.name === 'beyond-tolerance-displacement-is-reported' && c.expectedDetected === true && c.detected === true)).toBe(true);

    // The summary is recomputable from the rows it names, so a summary that disagrees with its own trace
    // cannot survive review — or this test.
    const rows = readFileSync(join(OUT_DIR, 'ticks.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { resolvedDisplacement: number });
    expect(rows.length).toBe(200);
    expect(Math.abs(rows.reduce((total, row) => total + row.resolvedDisplacement, 0) - Number(trace.checks['referenceMetresFromRows']))).toBeLessThanOrEqual(1e-9);
    const inputs = readFileSync(join(OUT_DIR, 'inputs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { disposition: string });
    expect(inputs.every((entry) => entry.disposition === 'consumed')).toBe(true);
  }, 300_000);

  it('T-2 and T-3: AC-3c holds per tick over the population, and the B=8 burst proves its queue', () => {
    // The population run in this same file wrote both artefacts; re-running it here would double a
    // minute of runtime for no additional claim.
    const audit = JSON.parse(readFileSync(join(OUT_DIR, 'displacement-bound.json'), 'utf8')) as {
      verdict: string;
      classification: Record<string, number>;
      outOfBound: unknown[];
      travelBudget: { exceeded: boolean }[];
      controls: { expectedDetected: boolean; detected: boolean }[];
    };
    expect(audit.verdict).toBe('pass');
    expect(audit.outOfBound).toEqual([]);
    expect(audit.travelBudget.every((row) => !row.exceeded)).toBe(true);
    expect(audit.classification['acceptedTicks']).toBeGreaterThan(0);
    expect(audit.controls.every((control) => control.detected === control.expectedDetected)).toBe(true);

    const burst = JSON.parse(readFileSync(join(OUT_DIR, 'burst-b8.json'), 'utf8')) as {
      passed: boolean;
      observed: Record<string, unknown>;
    };
    expect(burst.passed).toBe(true);
    // The proof is arithmetic on the room's own post-drain record: 7 remaining after a one-frame drain
    // means 8 were there, and the unbroken run proves nothing arrived in between.
    expect(burst.observed['subtractionProof']).toBe(true);
    expect(burst.observed['postDrainDepthSeries']).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(burst.observed['distinctStampCount']).toBe(8);
    expect(burst.observed['consecutiveDrain']).toBe(true);
    expect(burst.observed['retiredUnrepresented']).toBe(0);
    expect(burst.observed['watermarkReachedHighestStamp']).toBe(true);
    expect(burst.observed['signalsForThisSeat']).toEqual([]);
    expect(burst.observed['closuresForThisSeat']).toEqual([]);
    expect(Number(burst.observed['maxDepthSeen'])).toBeLessThan(32);

    // Per-seat depth rows in the file that already carried the aggregate (OD-9: no new artefact).
    const csv = readFileSync(join(OUT_DIR, 'buffer-depth.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('tick,entityId,maxDepth,consumedCount,signalCount,closureCount,source');
    expect(csv.some((line) => line.split(',')[1] !== 'all')).toBe(true);
  });

  it('T-4: the compliant projection is identical solo and among offenders, and ordinals are checked separately', () => {
    runScript('tests/runtime/udg-003-phase-2/projection-isolation.ts');
    const isolation = JSON.parse(readFileSync(join(OUT_DIR, 'projection-isolation.json'), 'utf8')) as {
      verdict: string;
      checks: Record<string, boolean>;
      design: { roomCensus: { distinctRooms: number; neighbours: Record<string, boolean> } };
      failures: string[];
    };
    expect(isolation.failures).toEqual([]);
    expect(isolation.verdict).toBe('pass');
    expect(isolation.checks['projectionSequencesEqual']).toBe(true);
    expect(isolation.checks['observerTraceIdentical']).toBe(true);
    expect(isolation.checks['everyExpectedStampConsumedInBothRuns']).toBe(true);
    expect(isolation.checks['equivalentEligibility']).toBe(true);
    expect(isolation.checks['populationOrdinalAhead']).toBe(true);
    // A population comparison is only a population comparison if the seats shared a room.
    expect(isolation.design.roomCensus.distinctRooms).toBe(4);
    expect(Object.values(isolation.design.roomCensus.neighbours).every(Boolean)).toBe(true);
  }, 300_000);

  it('re-runs PR-14 so the replay reads a journal this commit produced (R-1)', () => {
    // The probe's journal travels inside its own result file. Replaying a result left over from an earlier
    // commit would be replaying a room this commit never ran, so the suite runs the probe here first.
    runScript('tests/probes/pr14-gate-a.probe.ts', ['--out', join(ROOT, 'artifacts', 'probes', 'PR-14.probe-result.json')]);
    const resultPath = join(ROOT, 'artifacts', 'probes', 'PR-14.probe-result.json');
    expect(existsSync(resultPath), 'PR-14 must write its probe result').toBe(true);
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      verdict: string;
      checks: { name: string; ok: boolean; detail: string }[];
      observations: Record<string, unknown>;
    };
    expect(result.verdict).toBe('pass');
    expect(result.checks.filter((entry) => !entry.ok).map((entry) => entry.name)).toEqual([]);
    for (const name of [
      'the-rooms-journal-replays-to-the-same-dispositions-state-and-tip',
      'the-digest-blanked-journal-replays-to-the-same-tip',
      'a-tampered-prologue-is-refused-rather-than-replayed',
    ]) {
      expect(result.checks.some((entry) => entry.name === name), `PR-14 check ${name}`).toBe(true);
    }
    // The journal is retained INSIDE the result: rows, chain, prologue and the configuration it ran on.
    const record = (result.observations['journalRecord'] ?? {}) as {
      rows: unknown[];
      chain: unknown[];
      prologue: Record<string, unknown> | null;
      configDocument: Record<string, unknown> | null;
    };
    expect(record.rows.length).toBeGreaterThan(0);
    expect(record.chain.length).toBeGreaterThan(0);
    expect(record.prologue).not.toBeNull();
    expect(record.configDocument).not.toBeNull();
  }, 300_000);

  it('replays every retained journal in a process that never saw a room (R-1: GA-13, AC-3d, AC-20)', () => {
    // Named, not searched. CI's own finding: the probe's result is attributed evidence, so the replay reads
    // the file this suite just wrote rather than hunting for whatever copy a directory happens to hold.
    runScript('tests/runtime/udg-003-phase-2/journal-replay.ts', [], {
      UDG_PR14_RESULT: join(ROOT, 'artifacts', 'probes', 'PR-14.probe-result.json'),
    });
    const replay = JSON.parse(readFileSync(join(OUT_DIR, 'journal-replay.json'), 'utf8')) as {
      verdict: string;
      rooms: {
        source: string;
        replayed: boolean;
        equal: boolean;
        blankedEqual: boolean;
        tamperedPrologueRefused: boolean;
        integrityIssues: string[];
        controls: { wrongStepper: string; editedDispositionDetected: boolean; changedChainHashDetected: boolean };
        mismatches: unknown[];
      }[];
      scenarios: { scenario: string; replayed: boolean; coverage: string; reason: string }[];
      summary: { scenariosAccountedFor: number; scenariosReplayed: number; scenariosNotReplayed: number };
      missingInputs: unknown[];
    };
    expect(replay.verdict).toBe('pass');
    // Population + recovery rooms + the probe's room.
    expect(replay.rooms.length).toBeGreaterThanOrEqual(6);
    for (const room of replay.rooms) {
      expect(room.replayed, `${room.source} was not replayed`).toBe(true);
      expect(room.equal, `${room.source}: dispositions, canonical state or chain hashes differ from the retained journal`).toBe(true);
      expect(room.blankedEqual, `${room.source}: the digest-blanked journal did not replay to the same outcome`).toBe(true);
      expect(room.tamperedPrologueRefused, `${room.source}: a tampered prologue was accepted`).toBe(true);
      expect(room.integrityIssues, `${room.source}: the journal is incomplete, unsanitised or untrusted`).toEqual([]);
      expect(room.controls.editedDispositionDetected, `${room.source}: an edited disposition went unnoticed`).toBe(true);
      expect(room.controls.changedChainHashDetected, `${room.source}: a changed chain hash went unnoticed`).toBe(true);
      expect(room.controls.wrongStepper, `${room.source}: a wrong stepper went unnoticed`).not.toBe('not-detected');
      expect(room.mismatches, `${room.source}: mismatches were recorded`).toEqual([]);
    }
    // Every scenario in the Phase 2 inventory is accounted for, replayed or named with a reason.
    expect(replay.summary.scenariosAccountedFor).toBeGreaterThanOrEqual(16);
    expect(replay.summary.scenariosReplayed).toBeGreaterThanOrEqual(10);
    expect(replay.scenarios.every((entry) => typeof entry.coverage === 'string' && entry.coverage !== '')).toBe(true);
    // A scenario replay did not reach is not omitted: it is listed, and the listing says why.
    const notReplayed = replay.scenarios.filter((entry) => !entry.replayed);
    expect(notReplayed.length).toBe(replay.scenarios.length - replay.summary.scenariosReplayed);
    for (const entry of notReplayed) {
      expect(entry.reason.length, `${entry.scenario} is unreplayed without a reason`).toBeGreaterThan(0);
      expect(entry.coverage).not.toBe('replayed-in-room-journal');
    }
    expect(replay.missingInputs).toEqual([]);
  }, 300_000);

describe('UDG-003 Phase 2 runtime — GA-13 window attribution', () => {
  it('GA-13: the shared-journal windows are attributed by seat, tick and stamp in the replay', () => {
    const replay = JSON.parse(readFileSync(join(OUT_DIR, 'journal-replay.json'), 'utf8')) as {
      verdict: string;
      scenarioWindows: { scenario: string; pass: boolean; stampsMatch: boolean; acceptedTicksMatchObservations: boolean; dispositionsAllowed: boolean; noRefusals: boolean }[];
    };
    expect(replay.verdict).toBe('pass');
    const names = replay.scenarioWindows.map((entry) => entry.scenario);
    for (const expected of ['rate-ceiling-closes-directly', 'compliant-control-population-frames-are-all-consumed', 'offenders-never-touch-the-compliant-population']) {
      expect(names, `window for ${expected}`).toContain(expected);
    }
    for (const window of replay.scenarioWindows) {
      expect(window.pass, `window ${window.scenario}`).toBe(true);
      expect(window.stampsMatch).toBe(true);
      expect(window.acceptedTicksMatchObservations).toBe(true);
      expect(window.dispositionsAllowed).toBe(true);
      expect(window.noRefusals).toBe(true);
    }
  });
});
