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
  it('OD-10: every authority scenario is replayed with its window recomputed, and no-authority scenarios are shown, not replayed', () => {
    const replay = JSON.parse(readFileSync(join(OUT_DIR, 'journal-replay.json'), 'utf8')) as {
      verdict: string;
      falseClaims: string[];
      coverageGaps: { scenario: string; gap: string }[];
      summary: {
        authorityScenarios: number;
        authorityWindowsVerified: number;
        authorityWindowGaps: string[];
        authorityNegativeWindowsVerified: string[];
        authorityAbsenceAccounted: string[];
        authorityAbsenceCountedAsReplays: number;
        noAuthorityScenarios: number;
        noAuthorityVerified: number;
        noAuthorityWithoutEvidence: string[];
        noAuthorityCountedAsReplays: number;
        scenariosAccountedFor: number;
      };
      scenarios: { scenario: string; coverage: string }[];
      ga13: {
        verdict: string;
        replayLimb: { roomsReplayed: number; roomsEqual: number; mismatches: unknown[]; attributionFalseClaims: unknown[]; noAuthorityFalseClaims: unknown[] };
        attributionLimb: { remainingGaps: string[]; noAuthorityWithoutEvidence: string[]; absencesAccountedByTransportEvidence: number };
        carriedUnverified: { item: string; why: string }[];
        partialBecause: string[];
      };
      scenarioWindows: {
        scenario: string; journal: string; pass: boolean; stampsMatch: boolean;
        dispositionsMatch: boolean; acceptedTicksMatchObservations: boolean;
        attributionGap: string | null; journalReplayEqual: boolean | null; aliases: string[];
      }[];
      noAuthorityCoverage: { scenario: string; countedAsReplay: boolean; pass: boolean; recomputed: { pass: boolean }[]; recordedOnly: string[] }[];
    };
    // Bytes that contradict their own summary fail the artefact; a gap does not, and the two are counted
    // apart so a reviewer never has to guess which kind of short they are reading.
    expect(replay.verdict).toBe('pass');
    expect(replay.falseClaims).toEqual([]);

    // Authority-bearing half: one window per scenario, every recorded value recomputed from the rows.
    expect(replay.scenarioWindows.length).toBeGreaterThanOrEqual(10);
    for (const window of replay.scenarioWindows) {
      expect(window.stampsMatch, `stamps of ${window.scenario}`).toBe(true);
      expect(window.dispositionsMatch, `dispositions of ${window.scenario}`).toBe(true);
      expect(window.acceptedTicksMatchObservations, `tick/observation count of ${window.scenario}`).toBe(true);
      expect(window.pass, `window ${window.scenario}`).toBe(true);
    }
    expect(replay.summary.authorityScenarios).toBe(15);
    expect(replay.summary.authorityWindowsVerified).toBeGreaterThanOrEqual(8);

    // The burst is only a replayed case because its OWN room's journal is retained. Without that file the
    // scenario would have been counted as replayed on another room's rows.
    const burstWindow = replay.scenarioWindows.find((entry) => entry.scenario.startsWith('b8-burst'));
    expect(burstWindow, 'the burst scenario carries a window').toBeDefined();
    expect(burstWindow!.journal).toBe('burst');
    expect(burstWindow!.journalReplayEqual).toBe(true);
    expect(burstWindow!.aliases.length).toBe(1);

    // P-3 (OD-3, owner-approved) closed both of the gaps this rule first surfaced, and it closed them with
    // evidence rather than by deleting the requirement. The compliant control now has its negative window
    // recomputed from the rows — nothing arrived, and the rows say so — and the retired offender's
    // evictions, which produce no authority rows by construction, are accounted for by that room's own
    // captured transport evidence.
    //
    // What must NOT happen is an absence being promoted into a replay, so the guards below are the point
    // of the assertion rather than decoration: the offender is counted in `authorityAbsenceAccounted` and
    // `authorityAbsenceCountedAsReplays` stays zero. The four things the transport bytes still cannot
    // settle are listed by name, and the count is pinned: a future run that quietly drops one of them has
    // lost an obligation rather than earned one.
    expect(replay.summary.authorityWindowGaps).toEqual([]);
    for (const gap of replay.coverageGaps) expect(gap.gap.length).toBeGreaterThan(40);

    const offender = replay.scenarioWindows.find((entry) => entry.scenario === 'retired-offender-closes-in-bounded-window');
    expect(offender, 'the offender still carries its own replayed window: the absence account is about its evictions, not an excuse to skip it').toBeDefined();
    expect(offender!.journalReplayEqual).toBe(true);
    expect(replay.summary.authorityAbsenceAccounted).toEqual(['retired-offender-closes-in-bounded-window']);
    expect(replay.summary.authorityAbsenceCountedAsReplays).toBe(0);
    expect(replay.summary.authorityNegativeWindowsVerified).toEqual(['offenders-never-touch-the-compliant-population']);
    expect(
      replay.scenarios.find((row) => row.scenario === 'retired-offender-closes-in-bounded-window')?.coverage,
    ).toBe('authority-absence-accounted');
    expect(
      replay.scenarios.find((row) => row.scenario === 'offenders-never-touch-the-compliant-population')?.coverage,
    ).toBe('authority-negative-window-verified');

    // GA-13 as revised: two limbs, kept apart, with the residue named instead of smoothed over.
    expect(replay.ga13.verdict).toBe('pass');
    expect(replay.ga13.replayLimb.mismatches).toEqual([]);
    expect(replay.ga13.replayLimb.attributionFalseClaims).toEqual([]);
    expect(replay.ga13.attributionLimb.remainingGaps).toEqual([]);
    expect(replay.ga13.attributionLimb.absencesAccountedByTransportEvidence).toBe(1);
    expect(replay.ga13.partialBecause).toEqual([]);
    // The four residues, matched by what they are rather than by a count that could drift: the collision
    // item names a number that belongs to the run, and pinning it here would make the test fragile about
    // the wrong thing.
    expect(replay.ga13.carriedUnverified.length).toBe(4);
    expect(replay.ga13.carriedUnverified.map((entry) => entry.item)).toEqual([
      'the identity of each evicted stamp',
      'whether the acknowledgement advanced over retired frames',
      'that the retirement caused this closure rather than coinciding with it',
      expect.stringMatching(/collided stamps collided$/),
    ]);
    for (const entry of replay.ga13.carriedUnverified) {
      expect(entry.why.length, `the reason for "${entry.item}" must be a reason`).toBeGreaterThan(40);
    }

    // No-authority half: visible in the census, never counted as a replay, and each with checks that
    // could have failed.
    expect(replay.summary.noAuthorityScenarios).toBe(4);
    expect(replay.summary.noAuthorityVerified).toBe(4);
    expect(replay.summary.noAuthorityWithoutEvidence).toEqual([]);
    expect(replay.summary.noAuthorityCountedAsReplays).toBe(0);
    expect(replay.noAuthorityCoverage.length).toBe(4);
    for (const entry of replay.noAuthorityCoverage) {
      expect(entry.countedAsReplay).toBe(false);
      expect(entry.pass, entry.scenario).toBe(true);
      expect(entry.recomputed.length).toBeGreaterThanOrEqual(3);
      expect(entry.recomputed.every((check) => check.pass)).toBe(true);
      expect(replay.scenarios.some((row) => row.scenario === entry.scenario && row.coverage === 'no-authority-verified')).toBe(true);
    }
  });

});

describe('UDG-003 Phase 2 runtime — the P-batch: impairment (OD-2) and the stage sequence (OD-4)', () => {
  it('runs the bounded impairment layer and refuses it to claim TCP loss (W-10 as amended, GA-11)', () => {
    runScript('tests/runtime/udg-003-phase-2/impairment-population.ts');
    const impairment = JSON.parse(readFileSync(join(OUT_DIR, 'transport-impairment.json'), 'utf8')) as {
      verdict: string;
      controls: Record<string, boolean>;
      impairmentLayer: { impairmentSource: string; seam: string; noProxyAndNoNewDependency: string };
      seats: {
        label: string;
        discriminator?: { tcpLossModelled: boolean; outOfOrderHoleObserved?: boolean; whyThatRulesTcpOut?: string };
        withheldStampsNamed?: number[];
        withheldNeverConsumed?: boolean;
        deliveriesAfterTheHoleConsumed?: boolean;
        stall?: { withheldPatchWindowMs: number; framesTheRoomConsumedWhileTheSeatSawNothing: number };
      }[];
      populations: { loss: { withheldNeverConsumed: boolean; deliveriesAfterTheHoleConsumed: boolean }[] };
      doesNotEstablish: string[];
      gateAOwns: string[];
    };
    expect(impairment.verdict).toBe('pass');
    // Every control the layer wrote has to be true, and the set is pinned by name: a check quietly
    // dropped from the artefact is the same trick as a criterion quietly dropped from a clause.
    expect(Object.values(impairment.controls).every((value) => value === true)).toBe(true);
    expect(Object.keys(impairment.controls).length).toBeGreaterThanOrEqual(11);
    for (const name of [
      'baselineSeatHadNoImpairment',
      'imposedDelayIsTheDifferenceBetweenTheSeats',
      'noFrameArrivedWithoutAnAssociationEpoch',
      'withheldDeliveriesAreNamedAndNeverConsumed',
      'laterDeliveriesStillArrived',
      'lossDidNotEscapeItsSeat',
      'stallSeatCaughtUpAfterRelease',
      'socketNeverBrokeAnywhere',
    ]) {
      expect(impairment.controls[name], `the impairment layer must assert ${name}`).toBe(true);
    }

    // The two things this batch exists to stop: calling an application-layer withhold a packet-loss
    // measurement, and letting a deferred production inequality be read as a passed one.
    expect(impairment.impairmentLayer.impairmentSource).toBe('harness');
    expect(impairment.impairmentLayer.seam).toContain('transport.send');
    expect(impairment.impairmentLayer.seam).toContain('events.onmessage');
    expect(impairment.impairmentLayer.noProxyAndNoNewDependency).toContain('ws');
    expect(impairment.doesNotEstablish.join(' ')).toContain('GA-11');
    expect(impairment.gateAOwns.join(' ')).toContain('inequalities');

    // Every seat carries the label, not one representative seat: a single `false` next to a table of
    // numbers is how a claim comes back by inference.
    expect(impairment.seats.length).toBe(4);
    for (const seat of impairment.seats) {
      expect(seat.discriminator?.tcpLossModelled, `${seat.label} must say loss is not modelled`).toBe(false);
    }

    // The discriminator, stated as data: named deliveries withheld and never consumed, and later frames
    // still arriving. An out-of-order hole is unreachable over one ordered TCP stream, which is exactly
    // why this is not a loss measurement.
    const lossSeat = impairment.seats.find((seat) => seat.label === 'withheld-deliveries');
    expect(lossSeat?.withheldStampsNamed?.length).toBeGreaterThan(0);
    expect(lossSeat?.withheldNeverConsumed).toBe(true);
    expect(lossSeat?.deliveriesAfterTheHoleConsumed).toBe(true);
    expect(lossSeat?.discriminator?.outOfOrderHoleObserved).toBe(true);
    expect((lossSeat?.discriminator?.whyThatRulesTcpOut ?? '').length).toBeGreaterThan(60);
    expect(impairment.populations.loss.length).toBeGreaterThanOrEqual(1);
    expect(impairment.populations.loss[0]?.withheldNeverConsumed).toBe(true);

    // The stall row is observation, not a verdict: the room kept deciding while the seat was not told.
    const stallSeat = impairment.seats.find((seat) => seat.label === 'delivery-stall');
    expect((stallSeat?.stall?.withheldPatchWindowMs ?? 0)).toBeGreaterThan(0);
    expect((stallSeat?.stall?.framesTheRoomConsumedWhileTheSeatSawNothing ?? 0)).toBeGreaterThan(0);
  });

  it('P-2b, reopened for the harness only, exercises GA-6a, GA-6b, GA-6c and GA-7 at the declared test values', () => {
    const impairment = JSON.parse(readFileSync(join(OUT_DIR, 'transport-impairment.json'), 'utf8')) as {
      criterion: string[];
      ga6Ga7: {
        boundary: string[];
        envelope: { clientSnapshotDeadlineMs: number; clientRecoveryDeadlineMs: number; rejoinWindowAllowance: number; closureMaxMs: number };
        reconnectFailures: { case: string; message: string }[];
        controls: Record<string, boolean>;
        ga6a: {
          trigger: string | null;
          deadlineElapsedFromLastDeliveryMs: number;
          sendsAttemptedAfterExpiryWhileGateAllowed: number;
          recoveredEpoch: number;
          epochBefore: number;
          predictionBuffer: string;
        };
        ga6b: {
          socketOpenAtCheck: boolean;
          socketClosedDuring: number;
          publicationsSilentlyDropped: number;
          deliveriesAtCheck: number;
          deliveriesBeforeSilence: number;
        };
        ga6c: {
          actualRejoins: { epochBefore: number; epochAfter: number; rowReadableAfterRejoin: boolean; allowanceUsed: number }[];
          suspension?: { reason?: string } | null;
          sendsWhileGateClosedAfterSuspension: number;
          stateApplicationsAfterSuspension: number;
        };
        ga7: {
          publicationsSwallowedDuringTheSilence: number;
          publicationsReachingTheSeatAfterTheSilence: number;
          closed: boolean;
          acceptedCodes: number[];
          closureCode: number | null;
          serverObservation: { serverQueuedAtClose: number; consumedCountAtClose: number; dequeuedTotal: number; retiredUnrepresented: number };
          seatEnvelope?: { room: string; rateCeilingMessagesPerSecond: number; why: string; configHashDiffersFromMainRoom: boolean };
          retiredAtClose: number;
          refusedFramesForThisSeat: number;
          lossSignalThatSatisfiedTheControl: string;
          clientDeadlineElapsedFromLastDeliveryMs: number;
          recoveryPath: string;
          epochAfterRejoin: number;
          appliedRegressions: number;
          duplicateApplications: number;
          tokenReconnectRefusalsRecorded?: string[];
        };
      };
    };
    expect(impairment.criterion).toEqual(expect.arrayContaining(['GA-6a', 'GA-6b', 'GA-6c', 'GA-7']));
    const ga = impairment.ga6Ga7;
    for (const name of Object.keys(ga.controls)) {
      expect(ga.controls[name], `the recovery exercise must assert ${name}`).toBe(true);
    }
    expect(Object.keys(ga.controls).length).toBeGreaterThanOrEqual(13);
    // An empty list is the right expectation everywhere EXCEPT GA-7, and the exception is the finding
    // rather than an allowance: the SDK refuses to reconnect a session the server retired
    // ("reconnection token invalid or expired."), which is why that case recovers through matchmaking.
    // Asserting `[]` there would assert the two-path result away.
    for (const failure of ga.reconnectFailures) {
      expect(failure.case, 'only GA-7 may be refused a reconnect').toBe('GA-7');
    }
    const firstRefusal = ga.reconnectFailures[0];
    if (firstRefusal !== undefined) {
      expect(firstRefusal.message).toMatch(/token/i);
      expect(ga.ga7.recoveryPath).toBe('matchmaking-rejoin');
      expect((ga.ga7.tokenReconnectRefusalsRecorded ?? []).length).toBeGreaterThan(0);
    }

    // The numbers behind the controls, pinned so a future run cannot satisfy a renamed control instead.
    expect(ga.envelope.clientSnapshotDeadlineMs).toBe(500);
    expect(ga.envelope.clientRecoveryDeadlineMs).toBe(4000);
    expect(ga.envelope.rejoinWindowAllowance).toBe(2);
    expect(ga.ga6a.trigger).toBe('deadline');
    expect(ga.ga6a.deadlineElapsedFromLastDeliveryMs).toBeGreaterThan(0);
    expect(ga.ga6a.deadlineElapsedFromLastDeliveryMs).toBeLessThanOrEqual(650);
    expect(ga.ga6a.sendsAttemptedAfterExpiryWhileGateAllowed).toBe(0);
    expect(ga.ga6a.recoveredEpoch).toBeGreaterThan(ga.ga6a.epochBefore);

    // GA-6b's whole claim is that no server event was involved; the socket is the instrument that says so.
    expect(ga.ga6b.socketOpenAtCheck).toBe(true);
    expect(ga.ga6b.socketClosedDuring).toBe(0);
    expect(ga.ga6b.publicationsSilentlyDropped).toBeGreaterThan(0);
    expect(ga.ga6b.deliveriesAtCheck).toBe(ga.ga6b.deliveriesBeforeSilence);

    // GA-6c: the rolling allowance is spent on real rejoins, then refused, and the seat stays stopped.
    expect(ga.ga6c.actualRejoins.length).toBeGreaterThanOrEqual(ga.envelope.rejoinWindowAllowance);
    for (const rejoin of ga.ga6c.actualRejoins) {
      expect(rejoin.rowReadableAfterRejoin, 'a rejoin counted against the allowance must land on a readable row').toBe(true);
      expect(rejoin.epochAfter).toBeGreaterThanOrEqual(1);
    }
    expect(ga.ga6c.suspension?.reason).toBe('allowance-exhausted');
    expect(ga.ga6c.sendsWhileGateClosedAfterSuspension).toBe(0);
    expect(ga.ga6c.stateApplicationsAfterSuspension).toBe(0);

    // GA-7: the server recorded the loss while the seat was never told, the client acted inside the closure
    // window, and the recovery ended with a readable snapshot.
    expect(ga.ga7.publicationsSwallowedDuringTheSilence).toBeGreaterThan(0);
    expect(ga.ga7.publicationsReachingTheSeatAfterTheSilence).toBe(0);
    expect(ga.ga7.closed).toBe(true);
    expect(ga.ga7.acceptedCodes).toContain(ga.ga7.closureCode);
    // GA-7 is about a retirement the seat was never told about, so the seat's room is configured so that
    // the retirement is the only closure it can meet (run 43581033563 showed why: on the default envelope
    // the rate ceiling and the buffer race, and a control that demands one of them is a coin toss). The
    // difference is published rather than quietly relied on.
    expect(ga.ga7.closureCode).toBe(4100);
    expect(ga.ga7.retiredAtClose).toBeGreaterThanOrEqual(1);
    expect(ga.ga7.seatEnvelope?.room).toContain('regionGa7');
    expect(ga.ga7.seatEnvelope?.why).toContain('43581033563');
    expect(typeof ga.ga7.serverObservation.serverQueuedAtClose).toBe('number');
    expect(typeof ga.ga7.serverObservation.consumedCountAtClose).toBe('number');
    expect(typeof ga.ga7.serverObservation.dequeuedTotal).toBe('number');
    // "the server recorded the loss" is satisfied by whatever the arriving closure actually writes —
    // retirements when the buffer evicts, refusals when the ceiling rejects first. One named field would
    // make the control a bet on that race; this is the part that must not be zero either way.
    expect(ga.ga7.retiredAtClose + ga.ga7.refusedFramesForThisSeat).toBeGreaterThanOrEqual(1);
    expect(ga.ga7.lossSignalThatSatisfiedTheControl).toMatch(/retired|refused/);
    expect(ga.ga7.clientDeadlineElapsedFromLastDeliveryMs).toBeLessThanOrEqual(ga.envelope.closureMaxMs);
    expect(['sdk-reconnect', 'matchmaking-rejoin']).toContain(ga.ga7.recoveryPath);
    expect(ga.ga7.epochAfterRejoin).toBeGreaterThanOrEqual(1);
    expect(ga.ga7.appliedRegressions).toBe(0);
    expect(ga.ga7.duplicateApplications).toBe(0);

    // The two boundaries the owner restated on reopening are asserted as the artefact's own words: this is
    // the harness, Gate A stays Not Run, and the production client machine is UDG-008's.
    expect(ga.boundary.join(' ')).toContain('UDG-008');
    expect(ga.boundary.join(' ')).toContain('Not Run');
    expect(ga.ga6a.predictionBuffer).toContain('absent');
    expect(JSON.stringify(ga)).not.toMatch(/"gateA":\s*"pass/);
  });

  it('W-7: the 4000 ms episode deadline expires with no fresh snapshot, and the three limits stay distinct', () => {
    const impairment = JSON.parse(readFileSync(join(OUT_DIR, 'transport-impairment.json'), 'utf8')) as {
      criterion: string[];
      ga6Ga7: {
        episodeDeadlineDiscrimination: {
          closeReasonsObservedAcrossTheCases: { episodeDeadline: string | null; allowanceBranch: string | null; snapshotDeadlineTrigger: string | null };
          distinct: boolean;
        };
        controls: Record<string, boolean>;
        ga6c: { suspension?: { reason?: string } | null };
        ga6cEpisodeDeadline: {
          whichLimit: string;
          threeLimitsDistinguished: {
            snapshotDeadline: { value: number; closedTheClient: boolean };
            rollingRejoinAllowance: { value: number; closedTheClient: boolean; contrastWithTheAllowanceCase: string };
            episodeDeadline: { value: number; closedTheClient: boolean; reason: string | null };
          };
          snapshotAbsence: {
            freshAuthoritativeSnapshotArrived: boolean;
            deliveriesReachingTheSeatDuringTheEpisode: number;
            publicationsSwallowedAtTheWrapper: number;
            stateApplicationsDuringTheEpisode: number;
            resolvedThroughAtSilence: number;
            resolvedThroughAtClose: number;
            epochAtSilence: number;
            epochAtClose: number;
            recoveryEvents: number;
          };
          surfacedError: { code: number | null; expectedCode: number; reason: string | null; serverClosedTheSeatAnywhereInThisCase: boolean; policyStateAtClose: string; policyStateAfter: string; note: string };
          stayedStopped: { sendingAllowedAtClose: boolean; sendingAllowedAfter: boolean; ladderAttemptsAfterClose: number; recoveriesAfterClose: number };
          noFurtherInput: { sendsAttemptedWhileGateWasConsulted: number; transportSendsObservedAfterClose: number; roomJournalledClientFramesAtClose: number; roomJournalledClientFramesAfter: number; roomJournalledRefusalsAtClose: number; roomJournalledRefusalsAfter: number };
          roomSide: { keptRunning: boolean };
          timing: { episodeAgeMs: number; episodeDeadlineMs: number; snapshotDeadlineElapsedMs: number; ladderAttemptsBeforeClose: number; allowanceRefusedEventsBeforeClose: number };
          controls: Record<string, boolean>;
        };
      };
    };
    expect(impairment.criterion).toContain('GA-6c-episode-deadline');
    const ga = impairment.ga6Ga7;
    const ep = ga.ga6cEpisodeDeadline;
    for (const name of Object.keys(ep.controls)) {
      expect(ep.controls[name], `the episode-deadline case must assert ${name}`).toBe(true);
    }

    // The deadline that closed the client is the 4000 ms episode deadline, and it closed it LATE enough to
    // be that one: the 500 ms snapshot deadline had already fired ~4.5 s earlier and only opened the episode.
    expect(ep.timing.episodeDeadlineMs).toBe(4000);
    expect(ep.threeLimitsDistinguished.episodeDeadline.closedTheClient).toBe(true);
    expect(ep.threeLimitsDistinguished.snapshotDeadline.closedTheClient).toBe(false);
    expect(ep.threeLimitsDistinguished.rollingRejoinAllowance.closedTheClient).toBe(false);
    expect(ep.timing.episodeAgeMs).toBeGreaterThanOrEqual(4000);
    expect(ep.timing.snapshotDeadlineElapsedMs).toBeGreaterThan(0);
    expect(ep.timing.snapshotDeadlineElapsedMs).toBeLessThanOrEqual(650);
    expect(ep.surfacedError.reason).toBe('episode-deadline');

    // Still no fresh authoritative snapshot at the moment of expiry: nothing arrived, nothing was applied,
    // the watermark and the epoch did not move, and the silence is counted rather than assumed.
    expect(ep.snapshotAbsence.freshAuthoritativeSnapshotArrived).toBe(false);
    expect(ep.snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode).toBe(0);
    expect(ep.snapshotAbsence.publicationsSwallowedAtTheWrapper).toBeGreaterThan(0);
    expect(ep.snapshotAbsence.stateApplicationsDuringTheEpisode).toBe(0);
    expect(ep.snapshotAbsence.resolvedThroughAtClose).toBe(ep.snapshotAbsence.resolvedThroughAtSilence);
    expect(ep.snapshotAbsence.epochAtClose).toBe(ep.snapshotAbsence.epochAtSilence);
    expect(ep.snapshotAbsence.recoveryEvents).toBe(0);

    // The error is the client's own: INPUT_RECOVERY, a terminal `closed` state, no server close anywhere.
    expect(ep.surfacedError.code).toBe(4102);
    expect(ep.surfacedError.expectedCode).toBe(4102);
    expect(ep.surfacedError.serverClosedTheSeatAnywhereInThisCase).toBe(false);
    expect(ep.surfacedError.policyStateAtClose).toBe('closed');
    expect(ep.surfacedError.policyStateAfter).toBe('closed');
    expect(ep.stayedStopped.sendingAllowedAtClose).toBe(false);
    expect(ep.stayedStopped.sendingAllowedAfter).toBe(false);
    expect(ep.stayedStopped.ladderAttemptsAfterClose).toBe(0);
    expect(ep.stayedStopped.recoveriesAfterClose).toBe(0);

    // Nothing further reached the room, counted on the side that would have had to process it.
    expect(ep.noFurtherInput.sendsAttemptedWhileGateWasConsulted).toBe(0);
    expect(ep.noFurtherInput.transportSendsObservedAfterClose).toBe(0);
    expect(ep.noFurtherInput.roomJournalledClientFramesAfter).toBe(ep.noFurtherInput.roomJournalledClientFramesAtClose);
    expect(ep.noFurtherInput.roomJournalledRefusalsAfter).toBe(ep.noFurtherInput.roomJournalledRefusalsAtClose);
    expect(ep.roomSide.keptRunning).toBe(true);

    // The discrimination, pinned: this case closes on the episode deadline, the sibling case closes on the
    // allowance, and the snapshot deadline only ever appears as the stall trigger.
    expect(ga.episodeDeadlineDiscrimination.distinct).toBe(true);
    expect(ga.episodeDeadlineDiscrimination.closeReasonsObservedAcrossTheCases).toEqual({
      episodeDeadline: 'episode-deadline',
      allowanceBranch: 'allowance-exhausted',
      snapshotDeadlineTrigger: 'deadline',
    });
    expect(ep.timing.allowanceRefusedEventsBeforeClose).toBe(0);
    expect(ep.timing.ladderAttemptsBeforeClose).toBeGreaterThan(0);
    expect(ga.ga6c.suspension?.reason).toBe('allowance-exhausted');
    expect(JSON.stringify(ep.surfacedError.note)).toContain('UDG-008');
  });

  it('runs the stage sequence and keeps AC-6 qualified rather than overclaiming it (AC-6 under OD-4)', () => {
    runScript('tests/runtime/udg-003-phase-2/stage-sequence.ts');
    const stages = JSON.parse(readFileSync(join(OUT_DIR, 'stage-sequence.json'), 'utf8')) as {
      verdict: string;
      checks: Record<string, boolean>;
      ac6Verdict: string;
      ac6VerdictNote: string;
      definitions: { quotedFrom: string; M: string; P: string; order: string; ownerRuling: string; amendedClause?: string };
      mappingStageM: {
        byValueControl: { ran: boolean; canonicalFieldsMatch: boolean; mutatingTheMappedStateMovedTheRow: boolean; mappingIsTheOnlyWriter: boolean };
        refusalControl: { watermarkAdvanced: boolean; movementFieldsUnchanged: boolean; refusedRowsJournalled: number };
        perEntityNegative: { departed: { resolvedThroughAfterLeave: number | null; resolvedThroughAtEnd: number | null } };
      };
      publicationStageP: {
        observableAtSeat: { medianIntervalMs: number | null; declaredIntervalMs: number; tickIntervalMs: number };
        resultsHalf: { status: string; owner: string; resultsAccepted: number; obligation?: string };
      };
      doesNotClaim: string[];
    };
    expect(stages.verdict).toBe('pass');
    expect(Object.values(stages.checks).every((value) => value === true)).toBe(true);

    // M: the mapping is by value, the mapping is the writer, and a refusal moves the watermark and the
    // disposition but not the body.
    expect(stages.mappingStageM.byValueControl.ran).toBe(true);
    expect(stages.mappingStageM.byValueControl.canonicalFieldsMatch).toBe(true);
    expect(stages.mappingStageM.byValueControl.mutatingTheMappedStateMovedTheRow).toBe(false);
    expect(stages.mappingStageM.byValueControl.mappingIsTheOnlyWriter).toBe(true);
    expect(stages.mappingStageM.refusalControl.watermarkAdvanced).toBe(true);
    expect(stages.mappingStageM.refusalControl.movementFieldsUnchanged).toBe(true);
    expect(stages.mappingStageM.refusalControl.refusedRowsJournalled).toBeGreaterThan(0);

    // M is not P: the departed entity stopped being mapped while its neighbours kept advancing.
    const departed = stages.mappingStageM.perEntityNegative.departed;
    expect(departed.resolvedThroughAfterLeave).not.toBeNull();
    expect(departed.resolvedThroughAtEnd).toBe(departed.resolvedThroughAfterLeave);

    // P's cadence is the declared knob, and measurably not the tick.
    const seat = stages.publicationStageP.observableAtSeat;
    expect(seat.medianIntervalMs).not.toBeNull();
    expect(Math.abs((seat.medianIntervalMs ?? 0) - seat.declaredIntervalMs)).toBeLessThanOrEqual(40);
    expect(Math.abs((seat.medianIntervalMs ?? 0) - seat.tickIntervalMs)).toBeGreaterThanOrEqual(25);

    // The half that cannot be measured here stays open, named, and owned. This is the assertion that
    // stops OD-4 from being read as "AC-6 done": the artefact itself says `outstanding` and `UDG-007`.
    expect(stages.publicationStageP.resultsHalf.status).toBe('outstanding');
    expect(stages.publicationStageP.resultsHalf.owner).toBe('UDG-007');
    expect(stages.publicationStageP.resultsHalf.resultsAccepted).toBe(0);
    // The verdict moved on 2026-11-14 because the CRITERION moved, not because this artefact got more
    // confident: the owner's OD-4 ruling was applied to AC-6, which now scores Phase 2 against F…X, M and
    // P's publication, and carries P's results half to UDG-007 as an acceptance obligation. The two
    // assertions either side of it are what keep that from reading as "AC-6 done".
    expect(stages.ac6Verdict).toBe('pass-for-the-stages-scored-here');
    expect(stages.ac6VerdictNote).toContain('outstanding');
    expect(stages.definitions.amendedClause).toContain('acceptance obligation of UDG-007');
    expect(stages.publicationStageP.resultsHalf.obligation).toContain('exactly once');
    expect(stages.doesNotClaim.join(' ')).toContain('results half');
    // The letters are quoted from the record that defines them, not restated in whatever shape suits the
    // run that needed them.
    expect(stages.definitions.quotedFrom).toContain('UDG-003-phase-1');
    expect(stages.definitions.M).toContain('map canonical state to the replica');
    expect(stages.definitions.P).toContain('publish results, metrics, flush');
    expect(stages.definitions.ownerRuling).toContain('OD-4');
  });

});
