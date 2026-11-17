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

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'declaration.json'), `${JSON.stringify(declaration, null, 2)}\n`);

const spinnerPath = join(outDir, 'spinner.mjs');
writeFileSync(spinnerPath, "const stopAt = Date.now() + 90 * 60 * 1000;\nwhile (Date.now() < stopAt) { Math.sqrt(Math.random()); }\n");

const started = new Date().toISOString();
const loads: ReturnType<typeof spawnSync>[] = [];
for (let index = 0; index < declaration.load.spinners; index += 1) {
  // Detached background load: spawnSync with `detached` + unref, so the spinner outlives this call and is
  // killed by pid at the end.
  const child = spawnSync('sh', ['-c', `node ${spinnerPath} & echo $!`], { encoding: 'utf8' });
  loads.push({ pid: Number((child.stdout ?? '0').trim()) } as never);
}
const spinnerPids = loads.map((entry) => (entry as unknown as { pid: number }).pid);

/** The case outcomes of one iteration, read from that iteration's junit. */
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
  for (const id of [w7Id, p2bId]) {
    const name = id.split('> ').pop() ?? id;
    const escaped = name.replace(/[&<>"']/g, (character) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' }[character] ?? character}`);
    const caseStart = raw.indexOf(`name="${escaped}"`);
    if (caseStart === -1) {
      outcomes.set(id, 'missing');
      continue;
    }
    const block = raw.slice(caseStart, raw.indexOf('</testcase>', caseStart) === -1 ? caseStart + 4000 : raw.indexOf('</testcase>', caseStart));
    outcomes.set(id, /<failure/.test(block) ? 'failed' : 'passed');
  }
  return outcomes;
};

interface Iteration {
  iteration: number;
  suiteExit: number;
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
