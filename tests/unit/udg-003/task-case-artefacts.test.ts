/**
 * UDG-003 Phase 3, W-A-3: the artefacts a red case read cannot be replaced by a later green production.
 *
 * The reviewer approved W-A-3 with three requirements, and each is asserted here rather than described:
 *
 *   1. **retain the exact bytes** the whole-task test invocation produced and read, in their own directory,
 *      separate from the capture's own later Phase 2 reproductions;
 *   2. **bind them** to the invocation that read them and to the commit that ran it;
 *   3. **a failing control** proving a later passing reproduction can neither replace nor mask the original
 *      failure — a green re-production of the same producer over the same filenames must leave the retained
 *      bytes, their manifest, and the diagnosis they support exactly as they were.
 *
 * A bundle captured before W-A-3 carries no such directory, and the verifier must not mention one: that half
 * of the behaviour is asserted too, because 142 historical bundles have to verify exactly as they did.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CASE_ARTEFACT_DIR,
  CASE_ARTEFACT_FILES,
  CASE_ARTEFACT_MANIFEST,
  TASK_SELECTOR,
  captureCaseArtefacts,
  caseArtefactIssues,
  CAPTURE_PLANS,
} from '../../../tools/checks/dist/evidence.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TOOL = join(ROOT, 'tools', 'checks', 'dist', 'evidence.js');
const FIXTURE = join(ROOT, 'tests', 'support', 'udg-003', 'wa-audit-clean-artefact.json');
const AUDIT = join(ROOT, 'tests', 'system', 'udg-003-phase-3', 'wa-assertion-audit.ts');
const scratch: string[] = [];

const temporary = (prefix = 'udg-case-'): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(directory);
  return directory;
};

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** The impairment artefact with the accepted W-7 signature: 701 false, 702 zero, 704 one. */
const redArtefact = (): string => {
  const artefact = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  const ga = artefact['ga6Ga7'] as Record<string, unknown>;
  const episode = ga['ga6cEpisodeDeadline'] as Record<string, unknown>;
  const absence = episode['snapshotAbsence'] as Record<string, unknown>;
  absence['freshAuthoritativeSnapshotArrived'] = false;
  absence['deliveriesReachingTheSeatDuringTheEpisode'] = 0;
  absence['stateApplicationsDuringTheEpisode'] = 1;
  const file = join(temporary('udg-case-src-'), 'transport-impairment.json');
  writeFileSync(file, `${JSON.stringify(artefact, null, 2)}\n`);
  return file;
};

/** A source directory shaped like `artifacts/udg-003-phase-2` after a test invocation. */
const sourceDirectory = (impairment: string): string => {
  const directory = temporary('udg-case-src-');
  copyFileSync(impairment, join(directory, 'transport-impairment.json'));
  writeFileSync(join(directory, 'abuse-results.json'), '{"verdict":"pass"}\n');
  writeFileSync(join(directory, 'room-lifecycle.json'), '{"closures":[]}\n');
  writeFileSync(join(directory, 'buffer-depth.csv'), 'tick,entityId,maxDepth\n1,seat-a,7\n');
  return directory;
};

const runTool = (args: readonly string[]): { status: number; output: string } => {
  const executed = spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  return { status: executed.status ?? -1, output: `${executed.stdout ?? ''}${executed.stderr ?? ''}` };
};

const manifestIn = (directory: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(directory, CASE_ARTEFACT_MANIFEST), 'utf8')) as Record<string, unknown>;

const request = (from: string, to: string) => ({
  taskId: 'UDG-003',
  captureSelector: TASK_SELECTOR,
  fromDirectory: from,
  intoDirectory: to,
  readByCommand: 'test',
  files: CASE_ARTEFACT_FILES,
  runId: 'run-under-test',
});

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

describe('UDG-003 Phase 3 W-A-3 — the bytes a case read are retained, bound, and unreplaceable', () => {
  it('retains the invocation’s own bytes with the binding fields, in a directory of their own', () => {
    const red = redArtefact();
    const source = sourceDirectory(red);
    const target = join(temporary('udg-case-bundle-'), CASE_ARTEFACT_DIR);
    const issues = captureCaseArtefacts(ROOT, { ...request(source, target), fromDirectory: source });
    expect(issues, JSON.stringify(issues)).toEqual([]);

    const manifest = manifestIn(target);
    expect(manifest['taskId']).toBe('UDG-003');
    expect(manifest['captureSelector']).toBe(TASK_SELECTOR);
    expect(manifest['readByCommand']).toBe('test');
    expect(manifest['reproduction']).toBe(false);
    expect(String(manifest['distinctFrom'])).toContain('vectors-phase-2');
    expect(String(manifest['implementationSha'])).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest['runId']).toBe('run-under-test');

    // The retained bytes are byte-for-byte the artefact the invocation read, not a re-production of it.
    const retainedImpairment = readFileSync(join(target, 'transport-impairment.json'));
    expect(sha256Of(retainedImpairment)).toBe(sha256Of(readFileSync(red)));
    for (const name of CASE_ARTEFACT_FILES) {
      expect(existsSync(join(target, name)), `${name} retained`).toBe(true);
    }
    // And it is a different directory from the capture's own reproduction, which is where vectors-phase-2 lands.
    expect(target).not.toContain('vectors-phase-2/');
  });

  it('refuses to retain nothing: a missing or empty source is a refusal, not a manifest over a gap', () => {
    const empty = temporary('udg-case-empty-');
    const target = join(temporary('udg-case-bundle-'), CASE_ARTEFACT_DIR);
    const issues = captureCaseArtefacts(ROOT, request(empty, target));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === 'CASE-ARTEFACTS-MISSING')).toBe(true);
    expect(existsSync(join(target, CASE_ARTEFACT_MANIFEST)), 'a refusal writes no manifest').toBe(false);
  });

  it('a later passing reproduction cannot replace the retained bytes or mask the original failure', () => {
    const red = redArtefact();
    const source = sourceDirectory(red);
    const bundle = temporary('udg-case-bundle-');
    const target = join(bundle, CASE_ARTEFACT_DIR);
    expect(captureCaseArtefacts(ROOT, request(source, target))).toEqual([]);
    const originalBytes = readFileSync(join(target, 'transport-impairment.json'));
    const originalManifest = readFileSync(join(target, CASE_ARTEFACT_MANIFEST), 'utf8');

    // The diagnosis the retained bytes carry, before anything else runs.
    const auditBefore = join(target, 'wa-assertion-audit.json');
    const auditBeforeRun = spawnSync(process.execPath, [AUDIT, '--dir', target, '--out', auditBefore], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    });
    expect(auditBeforeRun.status, 'the audit refuses the red artefact').not.toBe(0);
    const namedBefore = (JSON.parse(readFileSync(auditBefore, 'utf8')) as {
      failing: { id: string; defect: string }[];
    }).failing.map((entry) => `${entry.defect}:${entry.id}`);
    expect(namedBefore).toEqual(['W-7:w7-state-applications']);

    // A later reproduction — the same producer, the same filenames, this time green — overwrites the source.
    copyFileSync(FIXTURE, join(source, 'transport-impairment.json'));
    const second = runTool([
      'case-artefacts', '--task', 'UDG-003', '--capture-selector', TASK_SELECTOR,
      '--from', source, '--to', target, '--read-by-command', 'test',
    ]);

    // It cannot replace them.
    expect(second.status, 'a divergent re-capture must be refused').toBe(1);
    expect(second.output).toContain('CASE-ARTEFACTS-DRIFT');
    expect(sha256Of(readFileSync(join(target, 'transport-impairment.json')))).toBe(sha256Of(originalBytes));
    expect(readFileSync(join(target, CASE_ARTEFACT_MANIFEST), 'utf8')).toBe(originalManifest);

    // And it cannot mask the failure: the retained bytes still say what the case saw.
    const auditAfter = join(target, 'wa-assertion-audit-after.json');
    spawnSync(process.execPath, [AUDIT, '--dir', target, '--out', auditAfter, '--report-only'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    });
    expect(
      (JSON.parse(readFileSync(auditAfter, 'utf8')) as { failing: { id: string }[] }).failing.map((e) => e.id),
      'a green reproduction elsewhere must not make the retained red artefact audit clean',
    ).toEqual(['w7-state-applications']);
    // The source really is green now, which is the whole point of the control.
    const cleanOfSource = temporary('udg-case-clean-');
    copyFileSync(join(source, 'transport-impairment.json'), join(cleanOfSource, 'transport-impairment.json'));
    expect(spawnSync(process.execPath, [AUDIT, '--dir', cleanOfSource, '--out', join(cleanOfSource, 'a.json')], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    }).status, 'the later reproduction audits clean, and still cannot touch the retained copy').toBe(0);
  });

  it('accepts a byte-identical re-invocation as a confirmation and writes nothing new', () => {
    const source = sourceDirectory(redArtefact());
    const target = join(temporary('udg-case-bundle-'), CASE_ARTEFACT_DIR);
    expect(captureCaseArtefacts(ROOT, request(source, target))).toEqual([]);
    const manifest = readFileSync(join(target, CASE_ARTEFACT_MANIFEST), 'utf8');
    const again = runTool([
      'case-artefacts', '--task', 'UDG-003', '--capture-selector', TASK_SELECTOR,
      '--from', source, '--to', target, '--read-by-command', 'test',
    ]);
    expect(again.status, `identical bytes change nothing: ${again.output}`).toBe(0);
    expect(readFileSync(join(target, CASE_ARTEFACT_MANIFEST), 'utf8')).toBe(manifest);
  });

  it('the verifier binds the bytes to the manifest, the command order and the commit, and refuses each break', () => {
    const source = sourceDirectory(redArtefact());
    const bundle = temporary('udg-case-bundle-');
    const target = join(bundle, CASE_ARTEFACT_DIR);
    expect(captureCaseArtefacts(ROOT, request(source, target))).toEqual([]);
    const commit = String(manifestIn(target)['implementationSha']);

    const commands = {
      commands: [
        { label: 'test', argv: ['pnpm', 'test'], exitCode: 1 },
        { label: 'test-case-artefacts', argv: ['node', 'tools/checks/dist/evidence.js', 'case-artefacts'] },
        { label: 'test-case-audit', argv: ['node', 'wa-assertion-audit.ts'] },
        { label: 'phase-2-impairment-population', argv: ['node', 'impairment-population.ts'] },
      ],
    };
    const report = { taskId: 'UDG-003', phase: 'task', implementationSha: commit, workingTreeDirty: false };
    const writeFrame = (): void => {
      writeFileSync(join(bundle, 'commands.json'), `${JSON.stringify(commands, null, 2)}\n`);
      writeFileSync(join(bundle, 'report.json'), `${JSON.stringify({ ...report }, null, 2)}\n`);
    };
    writeFrame();

    expect(caseArtefactIssues(bundle, report), 'a well-formed claim raises nothing').toEqual([]);

    // Break 1: the retained bytes are replaced by a later production.
    copyFileSync(FIXTURE, join(target, 'transport-impairment.json'));
    const replaced = caseArtefactIssues(bundle, report).map((issue) => issue.code);
    expect(replaced).toContain('EVIDENCE-CASE-ARTEFACT-HASH');
    expect(caseArtefactIssues(bundle, report).find((i) => i.code === 'EVIDENCE-CASE-ARTEFACT-HASH')?.detail)
      .toContain('a later production cannot stand in');

    // Break 2: the manifest is rebound to a commit this run did not execute.
    copyFileSync(join(source, 'transport-impairment.json'), join(target, 'transport-impairment.json'));
    const rebound = { ...report, implementationSha: 'f'.repeat(40) };
    writeFileSync(join(bundle, 'report.json'), `${JSON.stringify(rebound, null, 2)}\n`);
    expect(caseArtefactIssues(bundle, rebound).map((issue) => issue.code)).toContain('EVIDENCE-CASE-ARTEFACT-SHA');
    writeFrame();

    // Break 3: the recording command is made to precede the invocation that read the bytes.
    const reordered = {
      commands: [commands.commands[1], ...commands.commands.slice(0, 1), ...commands.commands.slice(2)],
    };
    writeFileSync(join(bundle, 'commands.json'), `${JSON.stringify(reordered, null, 2)}\n`);
    expect(caseArtefactIssues(bundle, report).map((issue) => issue.code)).toContain('EVIDENCE-CASE-ARTEFACT-ORDER');
    writeFrame();

    // The bundle-level refusal (`EVIDENCE-CASE-ARTEFACT-MISSING` on a real bundle, through `evidence.js
    // verify`) is demonstrated on a captured bundle rather than a fabricated one: docs/contracts/assignments/
    // evidence/UDG-003-phase-3-wa3-local-capture.md carries the command and the output. A synthetic bundle
    // would only have proved that this file agrees with itself.
  });

  it('says nothing about a bundle that makes no such claim, and refuses one that ran the step and retained nothing', () => {
    const historical = temporary('udg-historical-');
    writeFileSync(join(historical, 'report.json'), JSON.stringify({ taskId: 'UDG-003', implementationSha: 'a'.repeat(40) }));
    expect(caseArtefactIssues(historical, { taskId: 'UDG-003', implementationSha: 'a'.repeat(40) }))
      .toEqual([]);
    // Same bundle, plus the commands.json of a capture that ran the retention step: now the silence is a refusal.
    writeFileSync(join(historical, 'commands.json'), JSON.stringify({
      commands: [{ label: 'test' }, { label: 'test-case-artefacts' }, { label: 'test-case-audit' }],
    }));
    const issues = caseArtefactIssues(historical, { taskId: 'UDG-003', implementationSha: 'a'.repeat(40) });
    expect(issues.map((issue) => issue.code)).toContain('EVIDENCE-CASE-ARTEFACT-MISSING');

    const taskPlan = CAPTURE_PLANS[TASK_SELECTOR];
    const phasePlan = CAPTURE_PLANS['UDG-003'];
    if (taskPlan === undefined || phasePlan === undefined) throw new Error('both plans must exist for this assertion');
    // No requirement list is applied retroactively: a bundle may only be judged against the requirements that
    // existed when it was captured. The obligation is the command's, asserted next.
    expect(taskPlan.requiredFiles.some((file) => file.includes(CASE_ARTEFACT_DIR)),
      'the case claim is not a retroactive requirement list').toBe(false);
    expect(phasePlan.requiredFiles.some((file) => file.includes(CASE_ARTEFACT_DIR)), 'the accepted phase plan is untouched').toBe(false);
    const labels = (taskPlan.commands ?? []).map((command) => String(command.label));
    expect(labels.indexOf('test-case-artefacts'), 'captured after the invocation that read the bytes')
      .toBeGreaterThan(labels.indexOf('test'));
    expect(labels.indexOf('test-case-audit')).toBeGreaterThan(labels.indexOf('test-case-artefacts'));
    expect(labels.indexOf('phase-2-impairment-population'), 'and before the capture reproduces Phase 2')
      .toBeGreaterThan(labels.indexOf('test-case-artefacts'));
  });
});
