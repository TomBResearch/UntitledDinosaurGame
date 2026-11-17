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
});
