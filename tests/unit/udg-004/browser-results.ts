/**
 * The camera suite's evidence contract, shared by the three suites that read or write it.
 *
 * ## Why a shared module instead of a file each
 *
 * `tests/e2e/camera.spec.ts` writes `camera-browser-results.json`; `tests/contracts/UDG-004.test.ts` refuses a
 * bundle whose copy of that file is missing, failed, stale or short a case; `tests/unit/udg-004/evidence-gates.test.ts`
 * proves those refusals fire by building a valid artefact and then breaking it in each of the ways a real run
 * could go wrong. Three readers, one schema — because the failure mode this task must not repeat is a writer and
 * a gate that quietly agree on different files, which is what a "the suite passed and proved nothing" bundle
 * looks like from the outside.
 *
 * ## What the artefact has to make impossible
 *
 * - a browser run that never happened (missing file, wrong task, wrong commit, wrong run, too old);
 * - a run that produced no cases (`suites.expected === 0` is a failure, not a vacuous pass);
 * - a case that disappeared (every name in `CAMERA_CASE_NAMES` must be present and passed);
 * - a screenshot that is a placeholder, a stale copy, or a different picture than the one that was measured
 *   (`browser/screenshots.json` names each file, its byte count and its digest, and the gate re-reads the bytes).
 *
 * Per owner instruction, screenshot freshness and integrity are checked **here**, by this task's own suites, and
 * the shared vector-manifest schema in `tools/checks/src/evidence.ts` is left untouched: PNGs are not vectors,
 * and inventing a manifest field to describe them would change an accepted artefact format for a reason the
 * accepted format does not have (open decision D-004-15).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Task that owns this artefact. A file that names another task is not this suite's evidence. */
export const CAMERA_RESULTS_TASK = 'UDG-004';

/** Bump when the shape below changes, so an old artefact cannot be read as a new one. */
export const CAMERA_RESULTS_SCHEMA_VERSION = 1;

/** Bundle-relative names of the three camera artefacts. */
export const CAMERA_RESULTS_FILE = 'camera-browser-results.json';
export const CAMERA_LIFECYCLE_FILE = 'lifecycle-counts.json';
export const CAMERA_CONSOLE_FILE = 'console-errors.json';
export const CAMERA_SCREENSHOT_DIRECTORY = 'browser';
export const CAMERA_SCREENSHOT_INDEX_FILE = 'browser/screenshots.json';

/**
 * The seven cases the camera suite must report, in the order it runs them.
 *
 * The names are load-bearing: `gateBrowserResults` fails on a missing case, so deleting or renaming a test is a
 * gate failure rather than a smaller suite. Each maps to one of UDG-004's ten acceptance checks.
 */
export const CAMERA_CASE_NAMES = [
  'renders the greybox with two independent presented entities',
  'scene is right-handed, Y-up and in metres, and the marker says so',
  'orbit by mouse drag and by touch drag stays inside its bounds, and a cancelled gesture survives',
  'zoom by wheel and by pinch clamps to 2 m and 20 m',
  'gestures that start on UI do not move the camera',
  'presented poses move the view, and camera operations never mutate either pose',
  'ten mount/unmount cycles leave no loop, listener, mesh or WebGL resource',
] as const;

export type CameraCaseName = (typeof CAMERA_CASE_NAMES)[number];

/**
 * The screenshots the bundle must contain. Six, named for the state each one shows, because "screenshots at
 * orbit/zoom bounds" (UDG-004 §7) is a requirement about states, not about how many PNG files exist.
 */
export const CAMERA_SCREENSHOT_NAMES = [
  'orbit-default.png',
  'orbit-azimuth-min.png',
  'orbit-elevation-min.png',
  'orbit-elevation-max.png',
  'zoom-min-2m.png',
  'zoom-max-20m.png',
] as const;

export type CameraScreenshotName = (typeof CAMERA_SCREENSHOT_NAMES)[number];

/** How old a camera artefact may be and still count as this run's. */
export const CAMERA_RESULTS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface CameraCaseResult {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly durationMs: number;
}

/** A measured number or flag the thresholds in the capture plan are written against. */
export type CameraMeasurement = number | string | boolean;

export interface CameraBrowserResults {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly runId: string;
  readonly implementationSha: string;
  readonly workingTreeDirty: boolean;
  readonly capturedAt: string;
  readonly browser: {
    readonly name: string;
    readonly version: string;
    readonly chromiumBuild: string;
    readonly headed: false;
    readonly viewport: { readonly width: number; readonly height: number };
  };
  readonly suites: {
    readonly expected: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly cases: readonly CameraCaseResult[];
  readonly measurements: Readonly<Record<string, CameraMeasurement>>;
  readonly screenshots: readonly ScreenshotRecord[];
  readonly consoleErrors: {
    readonly pageErrors: number;
    readonly uncaughtConsoleErrors: number;
    readonly expected: readonly string[];
  };
}

/** One PNG in the bundle, identified by its bytes rather than by its filename. */
export interface ScreenshotRecord {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CameraLifecycleCounts {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly runId: string;
  readonly implementationSha: string;
  readonly workingTreeDirty: boolean;
  readonly capturedAt: string;
  readonly cycles: number;
  readonly after: {
    readonly mounted: boolean;
    readonly engines: number;
    readonly scenes: number;
    readonly meshes: number;
    readonly materials: number;
    readonly observers: number;
    readonly listeners: number;
    readonly renderTicksAdvanced: number;
    readonly frameRequestsAdvanced: number;
    readonly engineDisposed: boolean;
    readonly sceneDisposed: boolean;
  };
}

export interface CameraConsoleErrors {
  readonly schemaVersion: number;
  readonly taskId: string;
  readonly runId: string;
  readonly implementationSha: string;
  readonly workingTreeDirty: boolean;
  readonly capturedAt: string;
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  /** Errors the client is expected to produce in a development run, each with the reason it is expected. */
  readonly expected: readonly { readonly pattern: string; readonly reason: string }[];
  readonly unexpectedPageErrors: number;
  readonly unexpectedConsoleErrors: number;
}

/** Everything a gate can be wrong about, named. */
export type BrowserResultsFailureCode =
  | 'MISSING'
  | 'UNPARSEABLE'
  | 'IDENTITY'
  | 'ZERO_CASES'
  | 'CASE_MISSING'
  | 'CASE_NOT_PASSED'
  | 'FAILED'
  | 'STALE'
  | 'RUN_MISMATCH'
  | 'TREE_DIRTY'
  | 'SCREENSHOTS_MISSING'
  | 'SCREENSHOT_MISSING'
  | 'SCREENSHOT_BYTES'
  | 'SCREENSHOT_HASH'
  | 'SCREENSHOT_UNLISTED'
  | 'SCREENSHOT_STALE'
  | 'CONSOLE_PAGE_ERRORS'
  | 'MEASUREMENT';

export interface BrowserResultsIssue {
  readonly code: BrowserResultsFailureCode;
  readonly detail: string;
}

export interface BrowserResultsGateInput {
  /** The bundle (or scratch) directory holding `camera-browser-results.json`. */
  readonly directory: string;
  /** The run this gate belongs to, when the caller knows it. A mismatch is staleness. */
  readonly expectedRunId?: string;
  /** The commit this run executed. Anything else is an artefact from a different tree. */
  readonly expectedImplementationSha?: string;
  readonly maxAgeMs?: number;
  readonly now?: Date;
  /** Measurements the caller requires to be exactly true/number, e.g. the portability proofs. */
  readonly requiredMeasurements?: Readonly<Record<string, CameraMeasurement>>;
  /** Fail on any unexplained page error, which is the acceptance rule, not a preference. */
  readonly requireCleanConsole?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

export const sha256File = (absolutePath: string): string =>
  createHash('sha256').update(readFileSync(absolutePath)).digest('hex');

/** Parse the artefact. `undefined` means "there is nothing here to gate", which the caller reports. */
export const readCameraResults = (directory: string): CameraBrowserResults | undefined => {
  const path = join(directory, CAMERA_RESULTS_FILE);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? (parsed as unknown as CameraBrowserResults) : undefined;
};

const identityOf = (results: CameraBrowserResults): string =>
  `taskId=${String(results.taskId)} schemaVersion=${String(results.schemaVersion)} runId=${String(results.runId)} sha=${String(results.implementationSha)}`;

/**
 * Gate the camera artefacts. Returns every problem it can find, so one run tells a reviewer all twelve things
 * that are wrong instead of the first one.
 *
 * The gate takes a directory, not a parsed object, on purpose: the byte-level checks (re-hash, re-stat) are half
 * of what makes an artefact trustworthy, and a gate handed a pre-parsed object could not perform them.
 */
export const gateBrowserResults = (input: BrowserResultsGateInput): readonly BrowserResultsIssue[] => {
  const issues: BrowserResultsIssue[] = [];
  const path = join(input.directory, CAMERA_RESULTS_FILE);
  if (!existsSync(path)) {
    return [{ code: 'MISSING', detail: `${CAMERA_RESULTS_FILE} does not exist in ${input.directory}` }];
  }
  const results = readCameraResults(input.directory);
  if (results === undefined) {
    return [{ code: 'UNPARSEABLE', detail: `${CAMERA_RESULTS_FILE} is not parseable JSON` }];
  }

  if (results.taskId !== CAMERA_RESULTS_TASK || results.schemaVersion !== CAMERA_RESULTS_SCHEMA_VERSION) {
    issues.push({
      code: 'IDENTITY',
      detail: `the camera artefact does not declare ${CAMERA_RESULTS_TASK} at schema v${String(CAMERA_RESULTS_SCHEMA_VERSION)} — ${identityOf(results)}`,
    });
  }
  if (typeof results.implementationSha !== 'string' || !/^[0-9a-f]{40}$/.test(results.implementationSha)) {
    issues.push({ code: 'IDENTITY', detail: `implementationSha is not a 40-character commit: ${String(results.implementationSha)}` });
  }
  if (
    input.expectedImplementationSha !== undefined
    && results.implementationSha !== input.expectedImplementationSha
  ) {
    issues.push({
      code: 'IDENTITY',
      detail: `the camera artefact was produced from ${String(results.implementationSha)} but this run executed ${input.expectedImplementationSha}`,
    });
  }
  if (input.expectedRunId !== undefined && results.runId !== input.expectedRunId) {
    issues.push({
      code: 'RUN_MISMATCH',
      detail: `the camera artefact belongs to run ${String(results.runId)} but this is run ${input.expectedRunId}`,
    });
  }
  if (results.workingTreeDirty !== false) {
    issues.push({
      code: 'TREE_DIRTY',
      detail: 'the camera artefact was produced from a dirty tree, so its bytes are not attributable to a commit',
    });
  }

  const capturedAt = Date.parse(String(results.capturedAt));
  const maxAge = input.maxAgeMs ?? CAMERA_RESULTS_MAX_AGE_MS;
  if (!Number.isFinite(capturedAt)) {
    issues.push({ code: 'STALE', detail: `capturedAt is not a timestamp: ${String(results.capturedAt)}` });
  } else if ((input.now ?? new Date()).getTime() - capturedAt > maxAge) {
    issues.push({
      code: 'STALE',
      detail: `the camera artefact was captured ${String(results.capturedAt)}, older than ${String(maxAge)} ms, so it is not this run's result`,
    });
  }

  const suites = isRecord(results.suites as unknown) ? results.suites : undefined;
  const expected = suites === undefined ? undefined : asNumber(suites['expected']);
  const failed = suites === undefined ? undefined : asNumber(suites['failed']);
  const skipped = suites === undefined ? undefined : asNumber(suites['skipped']);
  if (expected === undefined || failed === undefined || skipped === undefined) {
    issues.push({ code: 'UNPARSEABLE', detail: 'suites.expected/failed/skipped are missing or not numbers' });
  } else {
    if (expected === 0) {
      issues.push({ code: 'ZERO_CASES', detail: 'the camera suite reported zero expected cases: a run that proves nothing cannot be accepted' });
    }
    if (failed > 0) issues.push({ code: 'FAILED', detail: `${String(failed)} camera case(s) failed` });
    if (skipped > 0) issues.push({ code: 'CASE_NOT_PASSED', detail: `${String(skipped)} camera case(s) were skipped; a skipped case is not a pass` });
  }

  const cases = Array.isArray(results.cases) ? results.cases : [];
  if (cases.length === 0) {
    issues.push({ code: 'ZERO_CASES', detail: 'cases[] is empty' });
  }
  for (const required of CAMERA_CASE_NAMES) {
    const found = cases.find((entry) => isRecord(entry as unknown) && entry.name === required);
    if (found === undefined) {
      issues.push({ code: 'CASE_MISSING', detail: `case "${required}" is absent from the camera artefact` });
      continue;
    }
    if (found.status !== 'passed') {
      issues.push({ code: 'CASE_NOT_PASSED', detail: `case "${required}" reported status ${String(found.status)}` });
    }
  }
  for (const entry of cases) {
    if (!isRecord(entry as unknown)) {
      issues.push({ code: 'UNPARSEABLE', detail: 'a case entry is not an object' });
    }
  }

  issues.push(
    ...gateScreenshots(input.directory, results, {
      // Spread rather than a plain `now: input.now`: `exactOptionalPropertyTypes` is on repository-wide, so an
      // absent clock must be *absent* from the options object, not present-and-undefined.
      ...(input.now === undefined ? {} : { now: input.now }),
      maxAgeMs: maxAge,
    }),
  );

  const consoleErrors = isRecord(results.consoleErrors as unknown) ? results.consoleErrors : undefined;
  const pageErrors = consoleErrors === undefined ? undefined : asNumber(consoleErrors['pageErrors']);
  if (pageErrors === undefined) {
    issues.push({ code: 'UNPARSEABLE', detail: 'consoleErrors.pageErrors is missing or not a number' });
  } else if (pageErrors > 0 && input.requireCleanConsole === true) {
    issues.push({ code: 'CONSOLE_PAGE_ERRORS', detail: `${String(pageErrors)} unexplained page error(s) during the camera run` });
  }

  for (const [key, want] of Object.entries(input.requiredMeasurements ?? {})) {
    const have = (results.measurements as Record<string, unknown> | undefined)?.[key];
    if (have !== want) {
      issues.push({ code: 'MEASUREMENT', detail: `measurement "${key}" is ${String(have)}, required ${String(want)}` });
    }
  }

  return issues;
};

/**
 * Re-hash and re-stat every screenshot the artefact names, and name every PNG that appeared without being
 * declared.
 *
 * This is the whole of D-004-15 as implemented: freshness and integrity for screenshots, checked by this task's
 * suites against the index the suite wrote, with the shared manifest schema left exactly as it was accepted.
 * A placeholder PNG, a PNG from an earlier run, and a PNG whose bytes were rewritten by a text sanitiser all
 * fail here — the last one because a digest that moved is precisely how a "survived capture" claim dies.
 */
export const gateScreenshots = (
  directory: string,
  results: CameraBrowserResults,
  options?: { readonly now?: Date; readonly maxAgeMs?: number },
): readonly BrowserResultsIssue[] => {
  const issues: BrowserResultsIssue[] = [];
  const screenshotDirectory = join(directory, CAMERA_SCREENSHOT_DIRECTORY);
  const declared = Array.isArray(results.screenshots) ? results.screenshots : [];
  if (declared.length === 0) {
    issues.push({ code: 'SCREENSHOTS_MISSING', detail: 'screenshots[] names no file; the contract asks for screenshots at the orbit and zoom bounds' });
  }
  for (const required of CAMERA_SCREENSHOT_NAMES) {
    if (!declared.some((entry) => isRecord(entry as unknown) && entry.name === required)) {
      issues.push({ code: 'SCREENSHOT_MISSING', detail: `no screenshot record for ${required}` });
    }
  }
  if (!existsSync(screenshotDirectory)) {
    issues.push({ code: 'SCREENSHOTS_MISSING', detail: `${CAMERA_SCREENSHOT_DIRECTORY}/ does not exist beside the camera artefact` });
    return issues;
  }
  const onDisk = new Set(readdirSync(screenshotDirectory).filter((name) => name.endsWith('.png')));
  for (const record of declared) {
    if (!isRecord(record as unknown)) continue;
    const name = asString(record['name']);
    if (name === undefined) continue;
    const absolute = join(screenshotDirectory, name);
    if (!existsSync(absolute)) {
      issues.push({ code: 'SCREENSHOT_MISSING', detail: `${CAMERA_SCREENSHOT_DIRECTORY}/${name} is declared but absent` });
      continue;
    }
    const bytes = asNumber(record['bytes']);
    const actualBytes = statSync(absolute).size;
    if (bytes !== actualBytes) {
      issues.push({ code: 'SCREENSHOT_BYTES', detail: `${name} is ${String(actualBytes)} bytes but the record declares ${String(bytes)}` });
    }
    const digest = sha256File(absolute);
    if (asString(record['sha256']) !== digest) {
      issues.push({ code: 'SCREENSHOT_HASH', detail: `${name} hashes to ${digest}, not the digest the record declares` });
    }
    // A PNG that decodes as nothing is a 0-byte success: the byte count above would pass, so the signature is
    // checked too. This is the failure G-9(b) was about, caught at the gate rather than in a reviewer's image
    // viewer.
    const head = readFileSync(absolute).subarray(0, 8).toString('hex');
    if (head !== '89504e470d0a1a0a') {
      issues.push({ code: 'SCREENSHOT_HASH', detail: `${name} does not start with a PNG signature, so it is not a picture` });
    }
    onDisk.delete(name);
  }
  for (const extra of [...onDisk].sort()) {
    issues.push({ code: 'SCREENSHOT_UNLISTED', detail: `${CAMERA_SCREENSHOT_DIRECTORY}/${extra} exists but no screenshot record names it` });
  }
  const index = join(directory, CAMERA_SCREENSHOT_INDEX_FILE);
  if (!existsSync(index)) {
    issues.push({ code: 'SCREENSHOTS_MISSING', detail: `${CAMERA_SCREENSHOT_INDEX_FILE} is absent, so the screenshots have no index to verify against` });
  } else {
    const indexRecord = safeJsonRead(index);
    const capturedAt = isRecord(indexRecord) ? Date.parse(String(indexRecord['capturedAt'])) : Number.NaN;
    if (!Number.isFinite(capturedAt)) {
      issues.push({ code: 'SCREENSHOT_STALE', detail: `${CAMERA_SCREENSHOT_INDEX_FILE} carries no readable capturedAt` });
    } else if ((options?.now ?? new Date()).getTime() - capturedAt > (options?.maxAgeMs ?? CAMERA_RESULTS_MAX_AGE_MS)) {
      issues.push({ code: 'SCREENSHOT_STALE', detail: `${CAMERA_SCREENSHOT_INDEX_FILE} was captured at ${String(indexRecord === undefined ? '' : (indexRecord as { capturedAt?: unknown }).capturedAt)}, older than this run's window` });
    }
  }
  return issues;
};

const safeJsonRead = (absolutePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return undefined;
  }
};

/** The gate for the two companion artefacts: identity, and the specific numbers the acceptance list names. */
export const gateCompanionArtefacts = (
  directory: string,
  expected: { readonly runId: string; readonly implementationSha: string; readonly minCycles: number },
): readonly BrowserResultsIssue[] => {
  const issues: BrowserResultsIssue[] = [];
  for (const [file, check] of [
    [CAMERA_LIFECYCLE_FILE, (record: Record<string, unknown>): BrowserResultsIssue[] => {
      const after = isRecord(record['after']) ? record['after'] : undefined;
      const found: BrowserResultsIssue[] = [];
      const cycles = asNumber(record['cycles']);
      if (cycles === undefined || cycles < expected.minCycles) {
        found.push({ code: 'MEASUREMENT', detail: `${CAMERA_LIFECYCLE_FILE}: cycles is ${String(cycles)}, required >= ${String(expected.minCycles)}` });
      }
      if (after === undefined) {
        found.push({ code: 'UNPARSEABLE', detail: `${CAMERA_LIFECYCLE_FILE}: no "after" block` });
        return found;
      }
      const zeroFields = ['engines', 'scenes', 'meshes', 'materials', 'observers', 'listeners', 'frameRequestsAdvanced', 'renderTicksAdvanced'] as const;
      for (const field of zeroFields) {
        const value = asNumber(after[field]);
        if (value !== 0) {
          found.push({ code: 'MEASUREMENT', detail: `${CAMERA_LIFECYCLE_FILE}: after.${field} is ${String(value)} after ${String(cycles)} cycles, required 0` });
        }
      }
      if (asBoolean(after['mounted']) !== false) {
        found.push({ code: 'MEASUREMENT', detail: `${CAMERA_LIFECYCLE_FILE}: after.mounted is not false after the cycles finished` });
      }
      if (asBoolean(after['engineDisposed']) !== true || asBoolean(after['sceneDisposed']) !== true) {
        found.push({ code: 'MEASUREMENT', detail: `${CAMERA_LIFECYCLE_FILE}: engineDisposed/sceneDisposed are not both true` });
      }
      return found;
    }],
    [CAMERA_CONSOLE_FILE, (record: Record<string, unknown>): BrowserResultsIssue[] => {
      const found: BrowserResultsIssue[] = [];
      for (const field of ['pageErrors', 'consoleErrors'] as const) {
        const list = record[field];
        if (!Array.isArray(list)) {
          found.push({ code: 'UNPARSEABLE', detail: `${CAMERA_CONSOLE_FILE}: ${field} is not a list` });
        }
      }
      if (asNumber(record['unexpectedPageErrors']) !== 0) {
        found.push({ code: 'CONSOLE_PAGE_ERRORS', detail: `${CAMERA_CONSOLE_FILE}: ${String(record['unexpectedPageErrors'])} unexplained page error(s)` });
      }
      if (asNumber(record['unexpectedConsoleErrors']) !== 0) {
        found.push({ code: 'CONSOLE_PAGE_ERRORS', detail: `${CAMERA_CONSOLE_FILE}: ${String(record['unexpectedConsoleErrors'])} unexplained console error(s)` });
      }
      return found;
    }],
  ] as const) {
    const path = join(directory, file);
    if (!existsSync(path)) {
      issues.push({ code: 'MISSING', detail: `${file} does not exist in the bundle directory` });
      continue;
    }
    const parsed = safeJsonRead(path);
    if (!isRecord(parsed)) {
      issues.push({ code: 'UNPARSEABLE', detail: `${file} is not a JSON object` });
      continue;
    }
    if (parsed['taskId'] !== CAMERA_RESULTS_TASK) {
      issues.push({ code: 'IDENTITY', detail: `${file} declares taskId ${String(parsed['taskId'])}, expected ${CAMERA_RESULTS_TASK}` });
    }
    if (parsed['runId'] !== expected.runId) {
      issues.push({ code: 'RUN_MISMATCH', detail: `${file} belongs to run ${String(parsed['runId'])}, expected ${expected.runId}` });
    }
    if (parsed['implementationSha'] !== expected.implementationSha) {
      issues.push({ code: 'IDENTITY', detail: `${file} was produced from ${String(parsed['implementationSha'])}, expected ${expected.implementationSha}` });
    }
    if (parsed['workingTreeDirty'] !== false) {
      issues.push({ code: 'TREE_DIRTY', detail: `${file} was produced from a dirty tree` });
    }
    issues.push(...check(parsed));
  }
  return issues;
};

/** A compact one-line-per-problem rendering, for a CI log a reviewer can read. */
export const formatIssues = (issues: readonly BrowserResultsIssue[]): string =>
  issues.map((issue) => `  ${issue.code}: ${issue.detail}`).join('\n');
