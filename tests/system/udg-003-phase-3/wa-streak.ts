/**
 * UDG-003 Phase 3, W-A: the declared repeatability streak.
 *
 * One iteration = one full `pnpm test` (the declared test order: the pinned vitest config, serial files,
 * the two affected cases running inside the suite exactly as CI runs them) under the declared load, plus a
 * per-assertion audit of the artefact that iteration produced. Pass/fail is read out of the iteration's own
 * junit, per case id — not from the suite's exit code — so a red in another file cannot mask or manufacture
 * a result for W-7 or P-2b.
 *
 * The load and order are declared in
 * docs/contracts/assignments/evidence/UDG-003-phase-3-wa-declaration.json before the first run, and this
 * script reads that file so a run cannot quietly disagree with its own declaration.
 *
 * Usage: node tests/system/udg-003-phase-3/wa-streak.ts --out <dir> [--iterations 10] [--declaration <file>]
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

interface Declaration {
  caseIds: string[];
  load: { spinners: number };
  rule: { passes: number };
  testOrder: { command: string };
  junitScoring?: { file: string };
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1] ?? fallback;
};

const outDir = resolve(flag('out', join('artifacts', 'udg-003-phase-3', 'wa-streak')));
const declarationPath = resolve(
  flag(
    'declaration',
    join('docs', 'contracts', 'assignments', 'evidence', 'UDG-003-phase-3-wa-declaration.json'),
  ),
);
const iterations = Number(flag('iterations', String(JSON.parse(readFileSync(declarationPath, 'utf8')).rule.passes)));

const declaration = JSON.parse(readFileSync(declarationPath, 'utf8')) as Declaration;
const w7Id = declaration.caseIds.find((id) => id.includes('W-7:')) ?? '';
const p2bId = declaration.caseIds.find((id) => id.includes('P-2b,')) ?? '';

/**
 * The streak is evidence about a tree, so it records which tree and refuses to pretend. A run started on a
 * dirty working tree cannot be attributed to a commit, and one aborted attempt was exactly that: it was
 * killed at iteration 1 and no iteration of it is counted. `UDG_WA_ALLOW_DIRTY=1` overrides the refusal for
 * a diagnostic run, which then carries `workingTreeDirty: true` in its own summary.
 */
const git = (args: readonly string[]): string =>
  spawnSync('git', [...args], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();

const implementationSha = git(['rev-parse', 'HEAD']);
const workingTreeDirty = git(['status', '--porcelain']) !== '';
if (workingTreeDirty && process.env['UDG_WA_ALLOW_DIRTY'] !== '1') {
  process.stderr.write(
    '[wa-streak] refusing to run: the working tree is dirty, so no iteration of this run would be attributable to a commit\n'
      + '[wa-streak] commit the tree or set UDG_WA_ALLOW_DIRTY=1 for a run that will be labelled diagnostic\n',
  );
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'declaration.json'), `${JSON.stringify(declaration, null, 2)}\n`);

const spinnerPath = join(outDir, 'spinner.mjs');
writeFileSync(spinnerPath, "const stopAt = Date.now() + 90 * 60 * 1000;\nwhile (Date.now() < stopAt) { Math.sqrt(Math.random()); }\n");

const started = new Date().toISOString();
const loads: ReturnType<typeof spawnSync>[] = [];
for (let index = 0; index < declaration.load.spinners; index += 1) {
  // Detached background load: spawnSync with `detached` + unref, so the spinner outlives this call and is
  // killed by pid at the end.
  // stdout/stderr go to a file, not the inherited pipe: a detached spinner that holds the pipe would make
  // spawnSync wait for the load it was supposed to leave running.
  const child = spawnSync('sh', ['-c', `node ${spinnerPath} >${join(outDir, `spinner-${String(index)}.log`)} 2>&1 & echo $!`], {
    encoding: 'utf8',
  });
  loads.push({ pid: Number((child.stdout ?? '0').trim()) } as never);
}
const spinnerPids = loads.map((entry) => (entry as unknown as { pid: number }).pid);

/** The case outcomes of one iteration, read from that iteration's junit. */
/**
 * The declared cases, scored out of one iteration's junit by file and full case name.
 *
 * Not the suite's exit code (five unrelated local reds coexisted with both named cases passing), and not a
 * substring search for `W-7` (Phase 3 adds its own tests whose names contain that token). A case passes only
 * when a testcase whose `classname` is the declared file has a `name` ending in the declared case name and
 * carries no `<failure>`/`<error>`; absent, skipped or uncollected is `missing`, and `missing` is not a pass.
 */
const casesFromJunit = (file: string): Map<string, 'passed' | 'failed' | 'missing'> => {
  const outcomes = new Map<string, 'passed' | 'failed' | 'missing'>();
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return new Map([
      [w7Id, 'missing'],
      [p2bId, 'missing'],
    ]);
  }
  const declaredFile = declaration.junitScoring?.file ?? 'tests/system/udg-003-phase-2/runtime.test.ts';
  // Split on the element boundary rather than matching a whole element with one regex: the attributes
  // carry `&gt;` escaped, never a raw `>`, so the first raw `>` after `<testcase` ends them.
  const unescape = (value: string): string =>
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const attribute = (chunk: string, name: string): string => {
    // `(?:^|\s)` is not decoration: a bare `name="` also occurs inside `classname="`, and without the
    // boundary every case's name came back as its file, which reads as "the case never ran".
    const found = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(chunk);
    return found?.[1] === undefined ? '' : unescape(found[1]);
  };
  const collected: { classname: string; name: string; failed: boolean }[] = [];
  for (const piece of raw.split('<testcase').slice(1)) {
    const section = piece.split('</testcase>')[0] ?? '';
    const openEnd = section.indexOf('>');
    if (openEnd === -1) continue;
    const head = section.slice(0, openEnd);
    collected.push({
      classname: attribute(head, 'classname'),
      name: attribute(head, 'name'),
      failed: /<(failure|error)\b/.test(section.slice(openEnd + 1)),
    });
  }
  for (const id of [w7Id, p2bId]) {
    const caseName = id.split(' > ').pop() ?? id;
    const found = collected.filter((entry) => entry.classname === declaredFile && entry.name.endsWith(caseName));
    if (found.length !== 1) {
      // Zero matches means the case never ran; two means the declaration does not identify one case.
      // Neither is a pass, and neither is allowed to look like one.
      outcomes.set(id, 'missing');
      continue;
    }
    outcomes.set(id, found[0]?.failed === true ? 'failed' : 'passed');
  }
  return outcomes;
};

interface Iteration {
  iteration: number;
  suiteExit: number;
  suiteCommand: string;
  seconds: number;
  w7: string;
  p2b: string;
  /**
   * The probe's own verdict and the impairment-layer controls that flipped. Not part of the declared
   * scoring (the rule scores W-7 and P-2b by case id) — it is retained because it is what defect WA-3
   * looks like: a suite where the two named cases pass while the layer's environment controls do not.
   */
  probeVerdict: string;
  probeControlsFailing: string[];
  auditChecks: number;
  auditFailing: { id: string; defect: string; expectation: string; actual: unknown }[];
}

const results: Iteration[] = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const directory = join(outDir, `iter-${String(iteration).padStart(2, '0')}`);
  mkdirSync(directory, { recursive: true });
  const began = Date.now();
  const suite = spawnSync('pnpm', ['test'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1_800_000,
    env: { ...process.env, UDG_EVIDENCE_JUNIT: join(directory, 'junit.xml') },
  });
  const outcomes = casesFromJunit(join(directory, 'junit.xml'));
  spawnSync(
    process.execPath,
    [
      'tests/system/udg-003-phase-3/wa-assertion-audit.ts',
      '--dir',
      join('artifacts', 'udg-003-phase-2'),
      '--out',
      join(directory, 'wa-assertion-audit.json'),
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
  );
  const audit = JSON.parse(readFileSync(join(directory, 'wa-assertion-audit.json'), 'utf8')) as {
    checked: number;
    failing: Iteration['auditFailing'];
  };
  let probeVerdict = 'unavailable';
  let probeControlsFailing: string[] = [];
  try {
    const artefact = JSON.parse(
      readFileSync(join('artifacts', 'udg-003-phase-2', 'transport-impairment.json'), 'utf8'),
    ) as { verdict?: string; controls?: Record<string, boolean> };
    probeVerdict = artefact.verdict ?? 'unavailable';
    probeControlsFailing = Object.entries(artefact.controls ?? {})
      .filter(([, value]) => value !== true)
      .map(([name]) => name);
  } catch {
    // the artefact is asserted by the accepted suite; here its absence is only reported
  }
  const row: Iteration = {
    iteration,
    suiteExit: suite.status ?? -1,
    suiteCommand: declaration.testOrder.command,
    seconds: Number(((Date.now() - began) / 1000).toFixed(1)),
    w7: outcomes.get(w7Id) ?? 'missing',
    p2b: outcomes.get(p2bId) ?? 'missing',
    probeVerdict,
    probeControlsFailing,
    auditChecks: audit.checked,
    auditFailing: audit.failing,
  };
  results.push(row);
  appendFileSync(join(outDir, 'iterations.jsonl'), `${JSON.stringify({ ...row, spinners: declaration.load.spinners })}\n`);
  process.stdout.write(
    `[wa-streak] iter ${String(iteration)}/${String(iterations)} suite ${String(row.suiteExit)} in ${String(row.seconds)}s ` +
      `W-7 ${row.w7} P-2b ${row.p2b} probe ${row.probeVerdict}` +
      `${row.probeControlsFailing.length === 0 ? '' : `(${row.probeControlsFailing.join(',')})`} ` +
      `audit ${String(audit.checked - audit.failing.length)}/${String(audit.checked)}` +
      `${audit.failing.length === 0 ? '' : ` failing ${audit.failing.map((entry) => entry.id).join(',')}`}\n`,
  );
}

for (const pid of spinnerPids) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

const streakOf = (key: 'w7' | 'p2b'): { reached: number; firstRedIteration: number | null } => {
  let reached = 0;
  let firstRedIteration: number | null = null;
  for (const row of results) {
    if (row[key] === 'passed') reached += 1;
    else {
      firstRedIteration = row.iteration;
      break;
    }
  }
  return { reached, firstRedIteration };
};

const summary = {
  schemaVersion: 1,
  task: 'UDG-003',
  phase: 'phase-3',
  purpose: 'W-A repeatability streak under the declared load and test order',
  started,
  finished: new Date().toISOString(),
  machineClass: { cpus: cpus().length, nodeVersion: process.version },
  implementationSha,
  workingTreeDirty,
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  declaredLoad: declaration.load,
  declaredOrder: declaration.testOrder,
  iterations,
  w7: streakOf('w7'),
  p2b: streakOf('p2b'),
  auditFailures: results.filter((row) => row.auditFailing.length > 0).map((row) => ({ iteration: row.iteration, failing: row.auditFailing })),
  results,
};
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `[wa-streak] W-7 ${String(summary.w7.reached)}/${String(iterations)} consecutive` +
    `${summary.w7.firstRedIteration === null ? '' : ` (first red iter ${String(summary.w7.firstRedIteration)})`}; ` +
    `P-2b ${String(summary.p2b.reached)}/${String(iterations)} consecutive` +
    `${summary.p2b.firstRedIteration === null ? '' : ` (first red iter ${String(summary.p2b.firstRedIteration)})`}\n`,
);
process.exit(0);
