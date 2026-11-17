/**
 * UDG-003 Phase 3, W-A: the red must stay in one place.
 *
 * What this guards, and why it exists as a file of its own. Hosted run `44191978254` was a records-only push
 * whose only difference from the green head was documents, and it went red with three failures: the accepted
 * `W-7` case, and then **two Phase 3 files of this author's own** — `wa-audit-falsification.test.ts` and
 * `task-vectors.test.ts` — both of which demanded that `artifacts/udg-003-phase-2/transport-impairment.json`
 * audit clean. That file is rewritten during the run by the accepted Phase 2 runtime case, so when `W-7`
 * fires the artefact really is red, and a control that requires it to be clean reports one defect three times
 * in three unrelated files. Retained bytes:
 * `docs/contracts/assignments/evidence/UDG-003-phase-3-hosted-sighting-run-44191978254.json`.
 *
 * That is defect **WA-5**, and it is an amplification defect: the assignment forbids making the red more
 * likely, and turning one red into three makes the suite harder to read without making the defect any clearer.
 * The controls now stand on a pinned artefact whose bytes cannot move, and the live artefact is audited and
 * *reported*. This file proves the difference, by pointing the live-artefact override at a synthetic artefact
 * that records exactly the condition `W-7` fails on:
 *
 *  - the audit, run on that artefact, **must** go red and name `w7-deliveries-in-window` — otherwise the
 *    suppression below would be suppressing nothing and this file would be theatre;
 *  - the suite that reads that artefact **must** still pass — otherwise the amplification is back.
 *
 * The second half re-runs the falsification suite in a child process. That is slow by design (a nested run is
 * the only way to observe what the suite does rather than what this file hopes it does); the accepted
 * contract suite already spawns vitest the same way (`tests/contracts/UDG-003.test.ts`).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const AUDIT = join('tests', 'system', 'udg-003-phase-3', 'wa-assertion-audit.ts');
const SUBJECT = join('tests', 'system', 'udg-003-phase-3', 'wa-audit-falsification.test.ts');
const FIXTURE = join(ROOT, 'tests', 'support', 'udg-003', 'wa-audit-clean-artefact.json');
const FIXTURE_SHA256 = 'd9e1dce3cec976f9bb5ae1dca2271e0d8a87ecd6c75b1bb990a9e83ebc26f647';

const scratch: string[] = [];
const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-amp-'));
  scratch.push(directory);
  return directory;
};

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** An artefact that records the condition the accepted W-7 assertion fails on: one delivery inside the episode. */
const redArtefact = (): string => {
  const artefact = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  const ga = artefact['ga6Ga7'] as Record<string, unknown>;
  const episode = ga['ga6cEpisodeDeadline'] as Record<string, unknown>;
  const absence = episode['snapshotAbsence'] as Record<string, unknown>;
  absence['deliveriesReachingTheSeatDuringTheEpisode'] = 1;
  const file = join(temporary(), 'transport-impairment.json');
  writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  return file;
};

const cleanArtefact = (): string => {
  const file = join(temporary(), 'transport-impairment.json');
  copyFileSync(FIXTURE, file);
  return file;
};

/** Run the audit over one artefact file and report its exit status plus the checks it named. */
const auditOf = (artefactFile: string): { status: number; failing: { id: string; defect: string }[] } => {
  const directory = mkdtempSync(join(tmpdir(), 'udg-wa-amp-audit-'));
  scratch.push(directory);
  const target = join(directory, 'transport-impairment.json');
  copyFileSync(artefactFile, target);
  const executed = spawnSync(process.execPath, [AUDIT, '--dir', directory, '--out', join(directory, 'audit.json')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const report = JSON.parse(readFileSync(join(directory, 'audit.json'), 'utf8')) as {
    failing: { id: string; defect: string }[];
  };
  return { status: executed.status ?? -1, failing: report.failing };
};

/** Run the falsification suite against a chosen live artefact and return its exit status and output. */
const runSubject = (liveArtefact: string): { status: number; output: string } => {
  const executed = spawnSync('pnpm', ['exec', 'vitest', 'run', SUBJECT, '--reporter=dot'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, UDG_WA_LIVE_ARTEFACT: liveArtefact },
  });
  return { status: executed.status ?? -1, output: `${executed.stdout ?? ''}${executed.stderr ?? ''}` };
};

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

describe('UDG-003 Phase 3 W-A — a W-7 red moves one case, not the phase that measures it', () => {
  it('holds the pin this file is written against: the base is the pinned artefact', () => {
    expect(sha256Of(readFileSync(FIXTURE))).toBe(FIXTURE_SHA256);
  });

  it('the audit does go red on the synthetic artefact, so the suppression below is suppressing something real', () => {
    const red = auditOf(redArtefact());
    expect(red.status, 'the audit must refuse an artefact that records a delivery inside the episode').not.toBe(0);
    expect(red.failing.map((entry) => entry.id)).toEqual(['w7-deliveries-in-window']);
    expect(red.failing[0]?.defect).toBe('W-7');
    // And the same audit, on the same code path, is clean on the pinned base: the difference is the artefact.
    const clean = auditOf(cleanArtefact());
    expect(clean.status).toBe(0);
    expect(clean.failing).toEqual([]);
  });

  it('the falsification suite passes whether the live artefact is clean or records the W-7 condition', () => {
    const cleanRun = runSubject(cleanArtefact());
    expect(cleanRun.status, `the suite must pass on a clean live artefact:\n${cleanRun.output.slice(-2000)}`).toBe(0);

    const redRun = runSubject(redArtefact());
    expect(
      redRun.status,
      'WA-5 regression: the suite must not inherit the live artefact\u2019s verdict. A red here means a Phase 3 '
        + `control again requires the accepted artefact to be clean, which reports one W-7 as two failures:\n${redRun.output.slice(-3000)}`,
    ).toBe(0);
    expect(redRun.output, 'and the run must not report failures').not.toMatch(/failed/);
  });
});
