/**
 * UDG-SPIKE-001 slice 30r7 — GA-11 MEASUREMENT-GRADE CLI (test-only, stateless, offline).
 *
 * Reads a finished bundle directory and computes the MEASUREMENT GRADE from the record alone
 * (or from the atomic PARTIAL-labelled progress trail when the record is absent — a dead worker
 * then still yields an honest INCOMPLETE/NOT-RUN grade instead of silence). It exists because
 * the EE capture proved the two questions can DISAGREE: 16/16 diagnostic checks GREEN and exit
 * 0 while only 2 of 3 promised sessions were eligible. The grade never re-scores eligibility,
 * never relabels history, and prints digests only — no endpoint value, no credential, no raw
 * room/session ids. Exit codes are for the wrapper's LOGGING of the grade only; the wrapper's
 * own exit stays the measurement's (the grade is reported separately, not conflated with it):
 *   0 COMPLETE · 1 PARTIAL · 2 INCOMPLETE · 3 NOT-RUN · 4 the grade could not be computed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ga11MeasurementGrade, type Ga11GradeSessionInput, type Ga11MeasurementGrade } from './ga11-session.js';

interface SessionLike {
  session?: number;
  navigation?: { moverHttpStatus?: number; observerHttpStatus?: number };
  joinMover?: { ok?: boolean };
  joinObserver?: { ok?: boolean };
  rtt?: { eligible?: boolean; collectionComplete?: boolean };
  patchIntervalsMs?: { ledgerTruncated?: boolean };
  windowInterruption?: unknown;
  failure?: string;
  timelineFailure?: string;
}

const is2xx = (status: number | undefined): boolean => status !== undefined && status >= 200 && status < 300;

const toGradeInput = (row: SessionLike, index: number): Ga11GradeSessionInput => ({
  session: typeof row.session === 'number' ? row.session : index + 1,
  joined: is2xx(row.navigation?.moverHttpStatus) && is2xx(row.navigation?.observerHttpStatus)
    && row.joinMover?.ok === true && row.joinObserver?.ok === true,
  promisedSamplesPresent: row.rtt !== undefined,
  rttEligible: row.rtt?.eligible === true,
  namedFailure: row.failure !== undefined || row.timelineFailure !== undefined,
  populationComplete: (row.rtt?.collectionComplete !== false) // ABSENCE of the slice-30r6 label (older records) is NOT a partial label — old records are read as recorded, never reshaped
    && (row.patchIntervalsMs !== undefined ? row.patchIntervalsMs.ledgerTruncated === false : false)
    && row.windowInterruption === undefined,
});

const readJson = (path: string): Record<string, unknown> | null => {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; }
  catch { return null; }
};

const main = (): number => {
  const bundleDir = process.argv[2];
  if (bundleDir === undefined || bundleDir === '') {
    process.stderr.write('ga11-grade: usage: node ga11-grade.js <bundle-dir>\n');
    return 4;
  }
  const record = readJson(join(bundleDir, 'spike-cell-ga11-session.json'));
  const progress = readJson(join(bundleDir, 'spike-cell-ga11-session.progress.json'));
  const declared = (record?.['population'] as { sessions?: number } | undefined)?.sessions
    ?? (progress?.['population'] as { sessions?: number } | undefined)?.sessions
    ?? 3; // the pre-registered fixed N; the record's own population block wins when present
  const recordSessions = Array.isArray(record?.['sessions']) ? (record!['sessions'] as SessionLike[]) : null;
  const progressSessions = Array.isArray(progress?.['sessionsCompleted']) ? (progress!['sessionsCompleted'] as SessionLike[]) : null;
  const gradedFrom = recordSessions !== null ? 'record' : progressSessions !== null ? 'progress (record absent — the atomic PARTIAL-labelled trail; a dead worker still yields an honest grade)' : 'nothing (no record, no progress)';
  const sessions = recordSessions ?? progressSessions ?? [];
  const checks = Array.isArray(record?.['checks']) ? (record!['checks'] as { ok?: boolean }[]) : null;
  const grade: Ga11MeasurementGrade = ga11MeasurementGrade(Number(declared), sessions.map(toGradeInput));
  const identity = (record?.['identity'] ?? {}) as { runId?: string; sha?: string };
  const admission = (record?.['admission'] ?? {}) as { endpointDigest?: string };
  const out = {
    kind: 'GA11-MEASUREMENT-GRADE',
    schemaVersion: 1,
    note: 'computed from the bundle AT REST by a reader that runs no browser and dials nothing; separate from the diagnostic checks by construction — the wrapper preserves the measurement exit code and reports this grade beside it',
    runId: identity.runId ?? progress?.['runId'] ?? null,
    headSha: identity.sha ?? progress?.['sha'] ?? null,
    endpointDigest: admission.endpointDigest ?? progress?.['endpointDigest'] ?? null,
    gradedFrom,
    diagnosticChecks: checks === null
      ? { recorded: 0, red: null, allGreen: null, note: 'no check list in the bundle (record absent or pre-check death) — absence is NOT a pass' }
      : { recorded: checks.length, red: checks.filter((c) => c.ok !== true).length, allGreen: checks.every((c) => c.ok === true) },
    measurementGrade: grade,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return grade.grade === 'COMPLETE' ? 0 : grade.grade === 'PARTIAL' ? 1 : grade.grade === 'INCOMPLETE' ? 2 : 3;
};

process.exit(main());
