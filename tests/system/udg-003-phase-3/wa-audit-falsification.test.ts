/**
 * UDG-003 Phase 3, W-A: the audit's own failing control.
 *
 * §6.5(1) requires "a targeted reproducer or a failing control" for each defect: something that fails when
 * the assertion it guards is not satisfied. A per-assertion audit that has only ever been seen passing is
 * not evidence — it might simply be reading fields that no run can move. This suite moves them, on a copy,
 * and requires the audit to name the defect it is supposed to name.
 *
 * It mutates a **copy** under `os.tmpdir()`, never anything in the tree or the store, and it asserts the two
 * messages the hosted attempts recorded: `expected 1 to be 0`-shaped W-7 counter movement, and the
 * `seat reservation expired.` refusal wording that made P-2b red in the container.
 *
 * Why the base is a pinned fixture and not "the artefact this run produced". `transport-impairment.json` is
 * rewritten *during* a run by the accepted Phase 2 runtime case — the case W-A exists to watch. When W-7
 * fires, the live artefact really does record the red counter, and a control that demanded a clean audit of it
 * reported one real defect as three failures: that is exactly what run `44191978254` did, and it is recorded
 * in `docs/contracts/assignments/evidence/UDG-003-phase-3-hosted-sighting-run-44191978254.json`. Amplifying a
 * defect into unrelated red files is forbidden by the assignment, so the controls stand on bytes that cannot
 * move, and the live artefact is audited and **reported** rather than required.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const LIVE =
  process.env['UDG_WA_LIVE_ARTEFACT'] === undefined
    ? join(ROOT, 'artifacts', 'udg-003-phase-2', 'transport-impairment.json')
    : // Reading-only override for `wa-no-amplification.test.ts`, which points it at a synthetic artefact that
      // records the W-7 red condition to prove this file stays green when the accepted case moves. Nothing
      // else sets it, and no assertion in this file is decided by whatever it points at.
      resolve(process.cwd(), process.env['UDG_WA_LIVE_ARTEFACT']);
/** The pinned known-clean base for every control in this file (provenance: `task-vectors.test.ts`). */
const FIXTURE = join(ROOT, 'tests', 'support', 'udg-003', 'wa-audit-clean-artefact.json');
const FIXTURE_SHA256 = 'd9e1dce3cec976f9bb5ae1dca2271e0d8a87ecd6c75b1bb990a9e83ebc26f647';
const AUDIT = join(ROOT, 'tests', 'system', 'udg-003-phase-3', 'wa-assertion-audit.ts');
const directories: string[] = [];

interface AuditReport {
  checked: number;
  passed: number;
  failing: { id: string; defect: string; expectation: string; actual: unknown }[];
  checks: { id: string; defect: string; passed: boolean }[];
}

/** Run the audit over a mutated copy and return its report. */
const auditMutated = (mutate: (artefact: Record<string, unknown>) => void): AuditReport => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-audit-'));
  directories.push(directory);
  copyFileSync(FIXTURE, join(directory, 'transport-impairment.json'));
  const file = join(directory, 'transport-impairment.json');
  const artefact = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  mutate(artefact);
  writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  const executed = spawnSync(process.execPath, [AUDIT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  expect(exists(file), 'the mutated artefact must exist').toBe(true);
  const report = JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as AuditReport;
  // The audit's exit status is part of the control: a report that names a failure while exiting 0 would
  // let a red run through the streak runner.
  expect(executed.status, 'the audit must exit non-zero when a check fails').toBe(1);
  return report;
};

/** Audit an untouched copy of a given artefact file and return its report. */
const auditCopy = (source: string): AuditReport => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-copy-'));
  directories.push(directory);
  copyFileSync(source, join(directory, 'transport-impairment.json'));
  const executed = spawnSync(process.execPath, [AUDIT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (!existsSync(join(directory, 'audit.json'))) {
    throw new Error(`the audit wrote no report for ${source} (exit ${String(executed.status)}): ${executed.stderr.slice(0, 300)}`);
  }
  return JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as AuditReport;
};

const auditClean = (): AuditReport => auditCopy(FIXTURE);

/** Run the audit over an arbitrarily mutated copy and return the report **and** its exit status. */
const auditOf = (source: string, mutate?: (artefact: Record<string, unknown>) => void): {
  report: AuditReport;
  status: number;
} => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-any-'));
  directories.push(directory);
  copyFileSync(source, join(directory, 'transport-impairment.json'));
  const file = join(directory, 'transport-impairment.json');
  if (mutate !== undefined) {
    const artefact = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    mutate(artefact);
    writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  }
  const executed = spawnSync(process.execPath, [AUDIT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
  });
  return {
    report: JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as AuditReport,
    status: executed.status ?? -1,
  };
};

/**
 * The repaired producer publishes the single episode-end snapshot its assertions are derived from, beside a
 * separate `cleanup` block. These controls need bytes of that shape, so the pinned clean artefact is given the
 * blocks the repair writes, with every reading taken from what that artefact already records — the recorded
 * deltas are 0 deliveries and 0 applications, so at-silence and at-episode-end agree, and the swallow count,
 * watermark, epoch and recovery count are copied. That keeps the control about *structure* (which reading the
 * asserted number came from) rather than about inventing values, and it keeps the base pinned: the digest of
 * `FIXTURE` is asserted elsewhere in this file.
 */
const repairedShape = (artefact: Record<string, unknown>): void => {
  const ga = artefact['ga6Ga7'] as Record<string, unknown>;
  const episode = ga['ga6cEpisodeDeadline'] as Record<string, unknown>;
  const absence = episode['snapshotAbsence'] as Record<string, unknown>;
  const swallowed = Number(absence['publicationsSwallowedAtTheWrapper']);
  const watermark = Number(absence['resolvedThroughAtSilence']);
  const epoch = Number(absence['epochAtSilence']);
  const snapshot = {
    takenAtMs: 14000,
    wrapperRestored: false,
    wrapperSilencing: true,
    deliveriesAtSilence: 7,
    deliveriesAtEpisodeEnd: 7,
    swallowedAtEpisodeEnd: swallowed,
    socketClosesAtEpisodeEnd: 0,
    stateApplicationsAtSilence: 3,
    stateApplicationsAtEpisodeEnd: 3,
    resolvedThroughAtEpisodeEnd: watermark,
    sessionEpochAtEpisodeEnd: epoch,
    recoveryEventsAtEpisodeEnd: Number(absence['recoveryEvents']),
    policyStateAtEpisodeEnd: 'closed',
  };
  absence['episodeEndSnapshot'] = snapshot;
  episode['cleanup'] = {
    wrapperRestoredBeforeEpisodeSnapshot: false,
    stateApplicationsAtEpisodeEnd: snapshot['stateApplicationsAtEpisodeEnd'],
    stateApplicationsObservedDuringCleanup: 0,
    deliveriesObservedDuringCleanup: 0,
    swallowedObservedDuringCleanup: 0,
    socketClosesObservedDuringCleanup: 0,
    resolvedThroughAtEpisodeEnd: watermark,
    resolvedThroughObservedDuringCleanup: 0,
    sessionEpochObservedDuringCleanup: 0,
    wrapperSilencingAtEpisodeEnd: true,
    whyThisIsSeparate: 'control fixture',
  };
};

/** A temporary artefact file in the repaired shape, derived from the pinned clean base. */
const repairedArtefact = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-repaired-'));
  directories.push(directory);
  const file = join(directory, 'transport-impairment.json');
  const artefact = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  repairedShape(artefact);
  writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  return file;
};

const exists = (file: string): boolean => {
  try {
    return readFileSync(file).length > 0;
  } catch {
    return false;
  }
};

/** Walk a dotted path **including** its last segment and write `value` there. */
const setAt = (artefact: Record<string, unknown>, dotted: string, value: unknown): void => {
  const keys = dotted.split('.');
  let walked = artefact;
  for (const key of keys.slice(0, -1)) {
    const next = walked[key];
    if (typeof next !== 'object' || next === null) throw new Error(`no object at ${key} in ${dotted}`);
    walked = next as Record<string, unknown>;
  }
  walked[keys[keys.length - 1] ?? ''] = value;
};

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('UDG-003 Phase 3 W-A — the audit is falsifiable, per defect', () => {
  it('refuses to run without the artefact it audits', () => {
    const missing = mkdtempSync(join(tmpdir(), 'udg-wa-empty-'));
    directories.push(missing);
    const executed = spawnSync(process.execPath, [AUDIT, '--dir', missing, '--out', join(missing, 'audit.json')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(executed.status ?? -1, 'an absent artefact is not a pass').not.toBe(0);
  });

  it('names the W-7 counter when a snapshot delivery lands inside the silent window', () => {
    // The recorded hosted message is `expected 1 to be 0`; this is the shape that produces it.
    const report = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.deliveriesReachingTheSeatDuringTheEpisode', 1);
    });
    const named = report.failing.map((entry) => entry.id);
    expect(named).toContain('w7-deliveries-in-window');
    expect(report.failing.find((entry) => entry.id === 'w7-deliveries-in-window')?.defect).toBe('W-7');
  });

  it('names the W-7 counter when a late ladder event surfaces after the close', () => {
    const report = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.stayedStopped.ladderAttemptsAfterClose', 1);
    });
    expect(report.failing.map((entry) => entry.id)).toContain('w7-ladder-after-close');
  });

  it('names the W-7 claims when the three limits stop being distinguishable', () => {
    // Two checks, two mutations: `distinct` is the probe's own conclusion and the map is the pinned
    // close-reason triple the accepted case compares with a literal. They are separate assertions in the
    // accepted case, so the control moves them separately rather than assuming one implies the other.
    const report = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.episodeDeadlineDiscrimination.distinct', false);
      setAt(artefact, 'ga6Ga7.episodeDeadlineDiscrimination.closeReasonsObservedAcrossTheCases', {
        episodeDeadline: 'allowance-exhausted',
        allowanceBranch: 'allowance-exhausted',
        snapshotDeadlineTrigger: 'deadline',
      });
    });
    const named = report.failing.map((entry) => entry.id);
    expect(named).toContain('w7-three-limits-distinct');
    expect(named).toContain('w7-discrimination-map');
  });

  it('names the P-2b refusal when the SDK refuses the rejoin with the other wording', () => {
    // The container-local P-2b red, quoted: `expected 'seat reservation expired.' to match /token/i`.
    const report = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.reconnectFailures', [{ case: 'GA-7', message: 'Seat reservation expired.' }]);
    });
    const named = report.failing.map((entry) => entry.id);
    expect(named).toContain('p2b-first-refusal-matches-token');
    expect(report.failing.find((entry) => entry.id === 'p2b-first-refusal-matches-token')?.defect).toBe('P-2b');
  });

  it('names the P-2b control when a refusal escapes GA-7', () => {
    const report = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.reconnectFailures', [
        { case: 'GA-7', message: 'reconnection token invalid or expired.' },
        { case: 'GA-6a', message: 'reconnection token invalid or expired.' },
      ]);
    });
    expect(report.failing.map((entry) => entry.id)).toContain('p2b-refusals-only-ga7');
  });

  it('names the moved deadline on each side, P-2b envelope and W-7 timing, separately', () => {
    // The preserve-list, proven falsifiable. The two cases read the deadline from two different places —
    // the envelope the probe declares and the timing block of its own episode case — so a mutation of one
    // must be named by that case and not silently credited to the other.
    const envelope = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.envelope.clientRecoveryDeadlineMs', 4500);
    });
    expect(envelope.failing.map((entry) => entry.id)).toContain('p2b-recovery-deadline-4000');
    const timing = auditMutated((artefact) => {
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.timing.episodeDeadlineMs', 4500);
    });
    expect(timing.failing.map((entry) => entry.id)).toContain('w7-episode-deadline-value');
  });

  it('reports the unmutated base clean, so the controls above measure mutation and not the tool', () => {
    expect(createHash('sha256').update(readFileSync(FIXTURE)).digest('hex'), 'the control base is the pinned artefact')
      .toBe(FIXTURE_SHA256);
    const report = auditClean();
    expect(report.failing).toEqual([]);
    expect(report.checked).toBeGreaterThanOrEqual(80);
  });

  it('audits the artefact this run produced and reports it, without inheriting its verdict', () => {
    // This is the instrument that saw W-7 fire in run 44191978254. Its output is a *measurement*: if the
    // accepted case moved, the correct report is one failure in the accepted case plus this line naming
    // which check moved — not three reds across three files, which is what an assertion here would cause.
    if (!existsSync(LIVE)) {
      expect(existsSync(LIVE), 'no live artefact yet: the Phase 2 runtime case has not run on this checkout').toBe(false);
      return;
    }
    const report = auditCopy(LIVE);
    expect(report.checked, 'the live audit evaluates the same number of checks').toBeGreaterThanOrEqual(80);
    for (const entry of report.failing) {
      expect(['W-7', 'P-2b'], `a live failing check must be attributed to a defect, got ${entry.defect}`).toContain(entry.defect);
    }
  });

  // ── the repair's own controls ─────────────────────────────────────────────────────────────────────────
  // The reviewer's direction: the episode readings come from one snapshot taken at the policy-defined episode
  // end, before delivery is restored or cleanup starts; cleanup observations are retained separately; a
  // callback during cleanup must not be able to alter the episode result; and an application *during* the
  // episode must still fail. The cause this repairs is demonstrated in
  // docs/contracts/assignments/evidence/UDG-003-phase-3-wa-diagnosis.md §17, on a retained artefact whose own
  // two readings of one tally disagreed.

  it('cannot be made red by a callback during cleanup, because cleanup is not what the episode reads', () => {
    const base = repairedArtefact();
    const activity = auditOf(base, (artefact) => {
      // The teardown does everything the demonstrated defect does: applications fire, a delivery arrives,
      // publications flow again, the row moves. It is recorded, and the episode does not consult it.
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.stateApplicationsObservedDuringCleanup', 3);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.stateApplicationsAtEpisodeEnd', 3);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.deliveriesObservedDuringCleanup', 1);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.swallowedObservedDuringCleanup', 16);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.resolvedThroughObservedDuringCleanup', 1);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.sessionEpochObservedDuringCleanup', 1);
    });
    expect(activity.status, `cleanup activity must not fail the audit: ${JSON.stringify(activity.report.failing)}`).toBe(0);
    expect(activity.report.failing).toEqual([]);
    expect(activity.report.checked, 'the repair adds checks rather than removing any')
      .toBeGreaterThan(auditClean().checked);
  });

  it('still fails on a state application during the episode, and names it as an episode movement', () => {
    const base = repairedArtefact();
    const inside = auditOf(base, (artefact) => {
      // One application inside the window: the snapshot itself moves, so the asserted delta and the
      // recomputation agree that this happened during the episode rather than in the teardown.
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.episodeEndSnapshot.stateApplicationsAtEpisodeEnd', 4);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.stateApplicationsDuringTheEpisode', 1);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.stateApplicationsAtEpisodeEnd', 4);
    });
    const ids = inside.report.failing.map((entry) => entry.id);
    expect(inside.status).toBe(1);
    expect(ids, 'the accepted reading must still refuse an application in the window').toContain('w7-state-applications');
    expect(ids, 'and the recomputation must agree that it happened inside the episode, not in cleanup')
      .not.toContain('w7-state-applications-recompute-from-snapshot');
  });

  it('refuses a teardown application folded into the episode tally, by recomputing the delta itself', () => {
    const base = repairedArtefact();
    const folded = auditOf(base, (artefact) => {
      // The shape the repair removes: the asserted number written from a teardown reading while the snapshot
      // says the window was clean. The audit does not take the number on trust.
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.stateApplicationsDuringTheEpisode', 1);
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.cleanup.stateApplicationsObservedDuringCleanup', 1);
    });
    const ids = folded.report.failing.map((entry) => entry.id);
    expect(folded.status).toBe(1);
    expect(ids).toContain('w7-state-applications');
    expect(ids, 'a value that disagrees with the snapshot it claims to come from is named as well')
      .toContain('w7-state-applications-recompute-from-snapshot');
  });

  it('refuses an episode snapshot taken after the impairment layer came off the socket', () => {
    const base = repairedArtefact();
    const late = auditOf(base, (artefact) => {
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.episodeEndSnapshot.wrapperRestored', true);
    });
    expect(late.report.failing.map((entry) => entry.id)).toContain('w7-episode-end-before-restore');

    const noisy = auditOf(base, (artefact) => {
      setAt(artefact, 'ga6Ga7.ga6cEpisodeDeadline.snapshotAbsence.episodeEndSnapshot.wrapperSilencing', false);
    });
    expect(noisy.report.failing.map((entry) => entry.id)).toContain('w7-episode-end-still-silenced');
  });

  it('claims nothing of an artefact captured before the repair, and everything of one after it', () => {
    const before = auditClean();
    const newIds = ['w7-episode-end-before-restore', 'w7-deliveries-recompute-from-snapshot',
      'w7-cleanup-taken-after-episode-end'];
    for (const id of newIds) {
      expect(before.checks.map((entry) => entry.id), 'a historical artefact is not retro-judged').not.toContain(id);
    }
    const after = auditOf(repairedArtefact());
    for (const id of newIds) {
      expect(after.report.checks.map((entry) => entry.id), `the repaired shape is checked by ${id}`).toContain(id);
    }
    expect(after.status, 'a repaired clean artefact audits clean').toBe(0);
  });
});
