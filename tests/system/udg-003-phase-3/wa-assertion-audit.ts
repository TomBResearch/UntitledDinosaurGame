/**
 * UDG-003 Phase 3, W-A step 1/2: the assertion audit for the two `W-7`/`P-2b` symptoms.
 *
 * Why this file exists. `tests/system/udg-003-phase-2/runtime.test.ts` asserts over 90 things against one
 * artefact, `transport-impairment.json`, and a hosted failure reports ONE message — `expected 1 to be 0`
 * matches at least six of them. The assignment (§5 W-A step 1, owner direction "identify the exact failing
 * assertions from retained attempts") therefore needs a tool that evaluates every assertion of the two
 * affected cases *individually* and names which one moved. This script mirrors the accepted case bodies
 * field for field and comparison for comparison, and reports per-check instead of stopping at the first
 * failure. It never edits the accepted file, and it never relaxes anything: each check here is the accepted
 * assertion, evaluated in isolation, and the accepted case remains the authority over what passes.
 *
 * Usage:  node tests/system/udg-003-phase-3/wa-assertion-audit.ts --dir <artefactDirectory> [--out <file>] [--report-only]
 *
 * `--report-only` writes the report and exits 0 whatever it finds. The capture's `test-case-audit` step uses
 * it: the accepted case is the gate, and a second failing command over the same defect is the WA-5
 * amplification this phase already had to fix. Without the flag the exit status is the verdict, which is what
 * the falsification controls and the streak runner depend on.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type Json = string | number | boolean | null | undefined | Json[] | { [key: string]: Json };

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};

const directory = resolve(flag('dir', join('artifacts', 'udg-003-phase-2')));
const outFile = resolve(flag('out', join(directory, 'wa-assertion-audit.json')));

const object = (value: Json): Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
const list = (value: Json): Json[] => (Array.isArray(value) ? value : []);
const text = (value: Json): string => (typeof value === 'string' ? value : String(value ?? 'null'));
const root = object(JSON.parse(readFileSync(join(directory, 'transport-impairment.json'), 'utf8')) as Json);
const at = (source: Record<string, Json>, dotted: string): Json =>
  dotted.split('.').reduce<Json>((walked, key) => object(walked)[key], source);

const ga = object(at(root, 'ga6Ga7'));
const ep = object(at(ga, 'ga6cEpisodeDeadline'));

interface Check {
  readonly id: string;
  readonly defect: 'W-7' | 'P-2b';
  readonly expectation: string;
  readonly actual: Json;
  readonly passed: boolean;
}

const checks: Check[] = [];
const check = (id: string, defect: Check['defect'], expectation: string, actual: Json, passed: boolean): void => {
  checks.push({ id, defect, expectation, actual, passed });
};
const eq = (id: string, defect: Check['defect'], actual: Json, want: Json): void => {
  check(id, defect, `=== ${JSON.stringify(want)}`, actual, actual === want);
};
const lt = (id: string, defect: Check['defect'], actual: Json, bound: Json): void => {
  check(id, defect, `<= ${text(bound)}`, actual, typeof actual === 'number' && typeof bound === 'number' && actual <= bound);
};
const gt = (id: string, defect: Check['defect'], actual: Json, bound: Json): void => {
  check(id, defect, `> ${text(bound)}`, actual, typeof actual === 'number' && typeof bound === 'number' && actual > bound);
};
const allTrue = (entries: [string, Json][]): boolean => entries.every(([, value]) => value === true);

// ── P-2b — the GA-6a/6b/6c + GA-7 exercise, mirroring the accepted case ────────────────────────────────
const criterion = list(root['criterion']);
for (const name of ['GA-6a', 'GA-6b', 'GA-6c', 'GA-7'] as const) {
  eq(`p2b-criterion-${name}`, 'P-2b', criterion.includes(name), true);
}
const controls = list(Object.entries(object(ga['controls'])).map(([name, value]) => [name, value] as [string, Json]));
const controlsFailing = controls.filter((entry) => list(entry)[1] !== true);
check('p2b-controls-all-true', 'P-2b', 'every ga6Ga7.controls entry === true', controlsFailing, controlsFailing.length === 0);
gt('p2b-control-count', 'P-2b', controls.length, 12);
// The recorded red is one of these two: `expected 'seat reservation expired.' to match /token/i`.
const reconnectFailures = list(at(ga, 'reconnectFailures'));
eq(
  'p2b-refusals-only-ga7',
  'P-2b',
  reconnectFailures.every((failure) => object(failure)['case'] === 'GA-7'),
  true,
);
const firstRefusal = reconnectFailures[0];
check(
  'p2b-first-refusal-matches-token',
  'P-2b',
  '/token/i (when a refusal was recorded at all)',
  firstRefusal === undefined ? 'no-refusal' : text(object(firstRefusal)['message']),
  firstRefusal === undefined || /token/i.test(text(object(firstRefusal)['message'])),
);
eq('p2b-ga7-recovery-via-matchmaking', 'P-2b', at(ga, 'ga7.recoveryPath'), 'matchmaking-rejoin');
gt('p2b-token-refusals-recorded', 'P-2b', list(at(ga, 'ga7.tokenReconnectRefusalsRecorded')).length, 0);
eq('p2b-snapshot-deadline-500', 'P-2b', at(ga, 'envelope.clientSnapshotDeadlineMs'), 500);
eq('p2b-recovery-deadline-4000', 'P-2b', at(ga, 'envelope.clientRecoveryDeadlineMs'), 4000);
eq('p2b-rejoin-allowance-2', 'P-2b', at(ga, 'envelope.rejoinWindowAllowance'), 2);
eq('p2b-ga6a-trigger', 'P-2b', at(ga, 'ga6a.trigger'), 'deadline');
gt('p2b-ga6a-elapsed-positive', 'P-2b', at(ga, 'ga6a.deadlineElapsedFromLastDeliveryMs'), 0);
lt('p2b-ga6a-elapsed-bounded', 'P-2b', at(ga, 'ga6a.deadlineElapsedFromLastDeliveryMs'), 650);
eq('p2b-ga6a-sends-after-expiry', 'P-2b', at(ga, 'ga6a.sendsAttemptedAfterExpiryWhileGateAllowed'), 0);
check(
  'p2b-ga6a-epoch-advanced',
  'P-2b',
  '> epochBefore',
  at(ga, 'ga6a.recoveredEpoch'),
  Number(at(ga, 'ga6a.recoveredEpoch')) > Number(at(ga, 'ga6a.epochBefore')),
);
eq('p2b-ga6b-socket-open', 'P-2b', at(ga, 'ga6b.socketOpenAtCheck'), true);
eq('p2b-ga6b-socket-closed-during', 'P-2b', at(ga, 'ga6b.socketClosedDuring'), 0);
gt('p2b-ga6b-swallowed', 'P-2b', at(ga, 'ga6b.publicationsSilentlyDropped'), 0);
eq('p2b-ga6b-deliveries-held', 'P-2b', at(ga, 'ga6b.deliveriesAtCheck'), at(ga, 'ga6b.deliveriesBeforeSilence'));
check(
  'p2b-ga6c-rejoin-count',
  'P-2b',
  '>= rejoinWindowAllowance',
  list(at(ga, 'ga6c.actualRejoins')).length,
  list(at(ga, 'ga6c.actualRejoins')).length >= Number(at(ga, 'envelope.rejoinWindowAllowance')),
);
eq('p2b-ga6c-suspension-reason', 'P-2b', at(ga, 'ga6c.suspension.reason'), 'allowance-exhausted');
eq('p2b-ga6c-sends-after-suspension', 'P-2b', at(ga, 'ga6c.sendsWhileGateClosedAfterSuspension'), 0);
eq('p2b-ga6c-applications-after-suspension', 'P-2b', at(ga, 'ga6c.stateApplicationsAfterSuspension'), 0);
gt('p2b-ga7-swallowed', 'P-2b', at(ga, 'ga7.publicationsSwallowedDuringTheSilence'), 0);
eq('p2b-ga7-none-after-silence', 'P-2b', at(ga, 'ga7.publicationsReachingTheSeatAfterTheSilence'), 0);
eq('p2b-ga7-closed', 'P-2b', at(ga, 'ga7.closed'), true);
eq('p2b-ga7-closure-code', 'P-2b', at(ga, 'ga7.closureCode'), 4100);
gt('p2b-ga7-retired', 'P-2b', at(ga, 'ga7.retiredAtClose'), 0);
check(
  'p2b-ga7-seat-room',
  'P-2b',
  'contains regionGa7',
  text(at(ga, 'ga7.seatEnvelope.room')),
  text(at(ga, 'ga7.seatEnvelope.room')).includes('regionGa7'),
);
check(
  'p2b-ga7-seat-why',
  'P-2b',
  'contains 43581033563',
  text(at(ga, 'ga7.seatEnvelope.why')),
  text(at(ga, 'ga7.seatEnvelope.why')).includes('43581033563'),
);
for (const field of ['serverQueuedAtClose', 'consumedCountAtClose', 'dequeuedTotal'] as const) {
  eq(`p2b-ga7-${field}-typed`, 'P-2b', typeof at(ga, `ga7.serverObservation.${field}`), 'number');
}
check(
  'p2b-ga7-loss-recorded',
  'P-2b',
  '>= 1 (retired + refused)',
  Number(at(ga, 'ga7.retiredAtClose')) + Number(at(ga, 'ga7.refusedFramesForThisSeat')),
  Number(at(ga, 'ga7.retiredAtClose')) + Number(at(ga, 'ga7.refusedFramesForThisSeat')) >= 1,
);
check(
  'p2b-ga7-loss-signal-worded',
  'P-2b',
  '/retired|refused/',
  at(ga, 'ga7.lossSignalThatSatisfiedTheControl'),
  /retired|refused/.test(text(at(ga, 'ga7.lossSignalThatSatisfiedTheControl'))),
);
lt('p2b-ga7-client-deadline-inside-cap', 'P-2b', at(ga, 'ga7.clientDeadlineElapsedFromLastDeliveryMs'), at(ga, 'envelope.closureMaxMs'));
check(
  'p2b-ga7-recovery-path-named',
  'P-2b',
  'sdk-reconnect | matchmaking-rejoin',
  at(ga, 'ga7.recoveryPath'),
  at(ga, 'ga7.recoveryPath') === 'sdk-reconnect' || at(ga, 'ga7.recoveryPath') === 'matchmaking-rejoin',
);
gt('p2b-ga7-epoch-after-rejoin', 'P-2b', at(ga, 'ga7.epochAfterRejoin'), 0);
eq('p2b-ga7-applied-regressions', 'P-2b', at(ga, 'ga7.appliedRegressions'), 0);
eq('p2b-ga7-duplicate-applications', 'P-2b', at(ga, 'ga7.duplicateApplications'), 0);
check('p2b-boundary-udg-008', 'P-2b', 'contains UDG-008', undefined, list(ga['boundary']).map(text).join(' ').includes('UDG-008'));
check('p2b-boundary-not-run', 'P-2b', 'contains "Not Run"', undefined, list(ga['boundary']).map(text).join(' ').includes('Not Run'));
check('p2b-ga6a-buffer-absent', 'P-2b', 'contains absent', at(ga, 'ga6a.predictionBuffer'), text(at(ga, 'ga6a.predictionBuffer')).includes('absent'));
check(
  'p2b-no-gate-a-pass',
  'P-2b',
  'no "gateA":"pass" anywhere in ga6Ga7',
  undefined,
  !/"gateA":\s*"pass/.test(JSON.stringify(ga)),
);

// ── W-7 — the episode-deadline case, mirroring the accepted case ───────────────────────────────────────
eq('w7-criterion', 'W-7', criterion.includes('GA-6c-episode-deadline'), true);
const epControls = Object.entries(object(ep['controls'])).map(([name, value]) => [name, value] as [string, Json]);
check('w7-controls-all-true', 'W-7', 'every ga6cEpisodeDeadline.controls entry === true', epControls.filter(([, value]) => value !== true), allTrue(epControls));
eq('w7-episode-deadline-value', 'W-7', at(ep, 'timing.episodeDeadlineMs'), 4000);
eq('w7-episode-deadline-closed', 'W-7', at(ep, 'threeLimitsDistinguished.episodeDeadline.closedTheClient'), true);
eq('w7-snapshot-deadline-did-not-close', 'W-7', at(ep, 'threeLimitsDistinguished.snapshotDeadline.closedTheClient'), false);
eq('w7-allowance-did-not-close', 'W-7', at(ep, 'threeLimitsDistinguished.rollingRejoinAllowance.closedTheClient'), false);
check('w7-episode-age', 'W-7', '>= 4000', at(ep, 'timing.episodeAgeMs'), Number(at(ep, 'timing.episodeAgeMs')) >= 4000);
gt('w7-snapshot-elapsed-positive', 'W-7', at(ep, 'timing.snapshotDeadlineElapsedMs'), 0);
lt('w7-snapshot-elapsed-bounded', 'W-7', at(ep, 'timing.snapshotDeadlineElapsedMs'), 650);
eq('w7-surfaced-reason', 'W-7', at(ep, 'surfacedError.reason'), 'episode-deadline');
eq('w7-no-fresh-snapshot', 'W-7', at(ep, 'snapshotAbsence.freshAuthoritativeSnapshotArrived'), false);
// The recorded hosted red is one of these `=== 0` readings: `expected 1 to be 0`.
eq('w7-deliveries-in-window', 'W-7', at(ep, 'snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode'), 0);
gt('w7-publications-swallowed', 'W-7', at(ep, 'snapshotAbsence.publicationsSwallowedAtTheWrapper'), 0);
eq('w7-state-applications', 'W-7', at(ep, 'snapshotAbsence.stateApplicationsDuringTheEpisode'), 0);
eq('w7-watermark-held', 'W-7', at(ep, 'snapshotAbsence.resolvedThroughAtClose'), at(ep, 'snapshotAbsence.resolvedThroughAtSilence'));
eq('w7-epoch-held', 'W-7', at(ep, 'snapshotAbsence.epochAtClose'), at(ep, 'snapshotAbsence.epochAtSilence'));
eq('w7-recovery-events', 'W-7', at(ep, 'snapshotAbsence.recoveryEvents'), 0);

// W-A repair controls, reviewer-directed after the cause was demonstrated (diagnosis §17): the case's episode
// readings must come from ONE snapshot taken at the policy-defined episode end — before the impairment layer is
// restored and before cleanup starts — and the teardown observations must be structurally unable to reach them.
// The producer now publishes the snapshot it read, so these checks recompute the two `=== 0` tallies above from
// that snapshot instead of trusting the number the producer chose to write: a state application folded in from
// the teardown changes the recomputation and is named here. An artefact captured before the repair records
// neither block, so nothing is claimed and nothing is retro-judged — the same rule that keeps 222 historical
// bundles verifying exactly as they did.
const episodeEnd = object(at(ep, 'snapshotAbsence.episodeEndSnapshot'));
const cleanupBlock = object(at(ep, 'cleanup'));
if (Object.keys(episodeEnd).length > 0) {
  eq('w7-episode-end-before-restore', 'W-7', episodeEnd['wrapperRestored'], false);
  eq('w7-episode-end-still-silenced', 'W-7', episodeEnd['wrapperSilencing'], true);
  const recomputedDeliveries = typeof episodeEnd['deliveriesAtEpisodeEnd'] === 'number'
    && typeof episodeEnd['deliveriesAtSilence'] === 'number'
    ? (episodeEnd['deliveriesAtEpisodeEnd'] as number) - (episodeEnd['deliveriesAtSilence'] as number)
    : null;
  eq('w7-deliveries-recompute-from-snapshot', 'W-7', recomputedDeliveries,
    at(ep, 'snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode'));
  const recomputedApplications = typeof episodeEnd['stateApplicationsAtEpisodeEnd'] === 'number'
    && typeof episodeEnd['stateApplicationsAtSilence'] === 'number'
    ? (episodeEnd['stateApplicationsAtEpisodeEnd'] as number) - (episodeEnd['stateApplicationsAtSilence'] as number)
    : null;
  eq('w7-state-applications-recompute-from-snapshot', 'W-7', recomputedApplications,
    at(ep, 'snapshotAbsence.stateApplicationsDuringTheEpisode'));
}
if (Object.keys(cleanupBlock).length > 0) {
  // The teardown was observed *after* the snapshot, which is the ordering that makes the episode reading
  // trustworthy, and the cleanup block agrees with that snapshot rather than replacing it.
  eq('w7-cleanup-taken-after-episode-end', 'W-7', cleanupBlock['wrapperRestoredBeforeEpisodeSnapshot'], false);
  eq('w7-cleanup-agrees-with-episode-end', 'W-7', cleanupBlock['stateApplicationsAtEpisodeEnd'],
    episodeEnd['stateApplicationsAtEpisodeEnd']);
  check('w7-cleanup-observations-recorded', 'W-7', 'a number, whatever the teardown did',
    cleanupBlock['stateApplicationsObservedDuringCleanup'],
    typeof cleanupBlock['stateApplicationsObservedDuringCleanup'] === 'number');
}
eq('w7-code-4102', 'W-7', at(ep, 'surfacedError.code'), 4102);
eq('w7-expected-code', 'W-7', at(ep, 'surfacedError.expectedCode'), 4102);
eq('w7-no-server-close', 'W-7', at(ep, 'surfacedError.serverClosedTheSeatAnywhereInThisCase'), false);
eq('w7-policy-state-at-close', 'W-7', at(ep, 'surfacedError.policyStateAtClose'), 'closed');
eq('w7-policy-state-after', 'W-7', at(ep, 'surfacedError.policyStateAfter'), 'closed');
eq('w7-sending-at-close', 'W-7', at(ep, 'stayedStopped.sendingAllowedAtClose'), false);
eq('w7-sending-after', 'W-7', at(ep, 'stayedStopped.sendingAllowedAfter'), false);
eq('w7-ladder-after-close', 'W-7', at(ep, 'stayedStopped.ladderAttemptsAfterClose'), 0);
eq('w7-recoveries-after-close', 'W-7', at(ep, 'stayedStopped.recoveriesAfterClose'), 0);
eq('w7-sends-consulted', 'W-7', at(ep, 'noFurtherInput.sendsAttemptedWhileGateWasConsulted'), 0);
eq('w7-transport-sends-after', 'W-7', at(ep, 'noFurtherInput.transportSendsObservedAfterClose'), 0);
eq('w7-journal-held', 'W-7', at(ep, 'noFurtherInput.roomJournalledClientFramesAfter'), at(ep, 'noFurtherInput.roomJournalledClientFramesAtClose'));
eq('w7-refusals-held', 'W-7', at(ep, 'noFurtherInput.roomJournalledRefusalsAfter'), at(ep, 'noFurtherInput.roomJournalledRefusalsAtClose'));
eq('w7-room-kept-running', 'W-7', at(ep, 'roomSide.keptRunning'), true);
eq('w7-three-limits-distinct', 'W-7', at(ga, 'episodeDeadlineDiscrimination.distinct'), true);
const discriminationWant = JSON.stringify({
  episodeDeadline: 'episode-deadline',
  allowanceBranch: 'allowance-exhausted',
  snapshotDeadlineTrigger: 'deadline',
});
const discriminationActual = JSON.stringify(at(ga, 'episodeDeadlineDiscrimination.closeReasonsObservedAcrossTheCases'));
check('w7-discrimination-map', 'W-7', discriminationWant, discriminationActual, discriminationActual === discriminationWant);

eq('w7-allowance-refused-before-close', 'W-7', at(ep, 'timing.allowanceRefusedEventsBeforeClose'), 0);
gt('w7-ladder-before-close', 'W-7', at(ep, 'timing.ladderAttemptsBeforeClose'), 0);
eq('w7-ga6c-suspension-reason', 'W-7', at(ga, 'ga6c.suspension.reason'), 'allowance-exhausted');
check('w7-note-udg-008', 'W-7', 'note contains UDG-008', at(ep, 'surfacedError.note'), JSON.stringify(at(ep, 'surfacedError.note')).includes('UDG-008'));

const failing = checks.filter((entry) => !entry.passed);
const report = {
  schemaVersion: 1,
  task: 'UDG-003',
  phase: 'phase-3',
  purpose: 'W-A step 1/2: per-assertion audit of the accepted W-7 and P-2b cases, evaluated in isolation so a failure names itself',
  artefactDirectory: directory.replace(/^\/+/, ''),
  checked: checks.length,
  passed: checks.length - failing.length,
  failing: failing.map((entry) => ({
    id: entry.id,
    defect: entry.defect,
    expectation: entry.expectation,
    actual: entry.actual,
  })),
  checks,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `[wa-audit] ${String(report.passed)}/${String(report.checked)} checks pass; failing: ` +
    `${failing.length === 0 ? 'none' : failing.map((entry) => `${entry.id} (${entry.defect}) expected ${entry.expectation}, actual ${JSON.stringify(entry.actual)}`).join(' · ')}\n`,
);
// `--report-only`: the measurement is the point, the verdict is somebody else's gate.
const reportOnly = args.includes('report-only') || args.includes('--report-only');
process.exit(reportOnly || failing.length === 0 ? 0 : 1);
