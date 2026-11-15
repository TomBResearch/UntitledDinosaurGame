/**
 * UDG-004 evidence-gate suite — the six demonstrations the assignment record §6.2 demands.
 *
 * ## Why this file exists at all
 *
 * A gate nobody has watched fail is a rumour. `tests/contracts/UDG-004.test.ts` refuses a bundle whose browser
 * evidence is missing, failed, stale or short a case, and `tests/e2e/camera.spec.ts` produces that evidence on
 * a good run — but "on a good run" is precisely the sentence a reviewer cannot audit. So this file builds a
 * valid artefact set in a scratch directory and then breaks it in each of the ways a real run goes wrong, and
 * asserts the gate refuses, with the reason named. Six demonstrations, all in Node, none needing a browser
 * except the two that are about pixels:
 *
 * - **E-1** a missing browser result blocks acceptance;
 * - **E-2** a failed, skipped, removed or never-run case blocks acceptance;
 * - **E-3** a stale, foreign, wrong-commit or dirty-tree result blocks acceptance;
 * - **E-4** a real PNG survives capture byte-for-byte **and still decodes** in the pinned chromium;
 * - **E-5** a PNG carrying a machine path is **refused**, with its bytes left alone;
 * - **E-6** what UDG-004 did not own still works: text artefacts are still sanitised, the accepted capture
 *   plans are unchanged, and any retained bundle this machine can see still verifies.
 *
 * ## E-4 and E-5 are the same defect seen from two sides
 *
 * Owner ruling G-9(b) settled a bug found while measuring: a PNG read as UTF-8 and written back is **not** the
 * same bytes. Measured on a real Playwright screenshot — 4254 bytes and a valid signature before, 5437 bytes,
 * no signature and `naturalWidth` 0 after — the lossy round trip was silent, and the sanitiser even reported
 * zero failures because nothing matched its patterns. So a binary is now either portable or a failure, never
 * "rewritten". E-4 proves the first half, E-5 the second, and both assert the bytes afterwards, because a
 * demonstration that only checks the report is how the original defect kept passing.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';

import {
  CAPTURE_PLANS,
  binaryMachinePathRefusals,
  isBinaryArtefact,
  machineRoots,
  sanitiseBundleDirectory,
} from '@udg/checks';

import {
  CAMERA_CASE_NAMES,
  CAMERA_CONSOLE_FILE,
  CAMERA_LIFECYCLE_FILE,
  CAMERA_RESULTS_FILE,
  CAMERA_SCREENSHOT_DIRECTORY,
  CAMERA_SCREENSHOT_INDEX_FILE,
  CAMERA_SCREENSHOT_NAMES,
  gateBrowserResults,
  gateCompanionArtefacts,
} from './browser-results.js';

// Three levels up from tests/unit/udg-004/, which is the repository root. Two levels is `tests/`, and a root
// that points at tests/ quietly turns every "the other tasks' records still work" check below into a
// check of nothing at all — the first version of this file measured zero retained bundles for exactly
// that reason, while still going green. A demonstration that can see no evidence must fail, not shrug.
const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const RUN_ID = 'UDG-004-unit-gatedemo-aaaaaaa1';
const SHA = '0'.repeat(39) + '1';
const CAPTURED_AT = new Date(Date.UTC(2026, 10, 15, 12, 0, 0)).toISOString();
/** "Now" for the gate, pinned, so freshness is tested against a fixed clock instead of a moving one. */
const NOW = new Date(Date.UTC(2026, 10, 15, 13, 0, 0));
const MAX_AGE_MS = 60 * 60 * 1000;

/** A 1×1 PNG, used where the gate's *rules* are under test rather than the picture. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let scratch = '';
let browser: Browser | undefined;
/** A real 1280×720 chromium screenshot, captured once for E-4 and E-5. */
let realPng: Buffer<ArrayBufferLike> = Buffer.alloc(0);
const measured: Record<string, number | string | boolean> = {};

const pngOf = async (): Promise<Buffer> => {
  const context = await (browser ?? (await chromium.launch())).newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.setContent(
    '<body style="margin:0;background:linear-gradient(120deg,#123,#c60 40%,#0a7)"><h1 style="color:#fff;font:600 90px system-ui">UDG-004</h1></body>',
  );
  const shot = await page.screenshot();
  await context.close();
  return Buffer.from(shot);
};

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const writeScreenshotDirectory = (directory: string, bytes: Buffer): void => {
  const shots = join(directory, CAMERA_SCREENSHOT_DIRECTORY);
  mkdirSync(shots, { recursive: true });
  for (const name of CAMERA_SCREENSHOT_NAMES) writeFileSync(join(shots, name), bytes);
  writeFileSync(
    join(directory, CAMERA_SCREENSHOT_INDEX_FILE),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        taskId: 'UDG-004',
        runId: RUN_ID,
        implementationSha: SHA,
        workingTreeDirty: false,
        capturedAt: CAPTURED_AT,
        screenshots: CAMERA_SCREENSHOT_NAMES.map((name) => ({ name, bytes: bytes.length, sha256: digest(bytes) })),
      },
      null,
      2,
    )}\n`,
  );
};

/**
 * A complete, valid artefact set, optionally mutated.
 *
 * Validity is the baseline every demonstration departs from, so the fixture is written here once and each test
 * changes exactly one thing. A fixture that was already broken would prove nothing about the gate.
 */
const writeFixture = (
  directory: string,
  mutate?: (results: Record<string, unknown>) => void,
  screenshotBytes: Buffer = TINY_PNG,
): Record<string, unknown> => {
  mkdirSync(directory, { recursive: true });
  const results: Record<string, unknown> = {
    schemaVersion: 1,
    taskId: 'UDG-004',
    runId: RUN_ID,
    implementationSha: SHA,
    workingTreeDirty: false,
    capturedAt: CAPTURED_AT,
    browser: { name: 'chromium', version: '158.0.8127.18', chromiumBuild: 'chromium-1254', headed: false, viewport: { width: 1280, height: 720 } },
    suites: { expected: CAMERA_CASE_NAMES.length, passed: CAMERA_CASE_NAMES.length, failed: 0, skipped: 0 },
    cases: CAMERA_CASE_NAMES.map((name) => ({ name, status: 'passed', durationMs: 100 })),
    measurements: {
      unexplainedPageErrors: 0,
      unexplainedConsoleErrors: 0,
      frameRequestsAfterDispose: 0,
      listenersAfterDispose: 0,
    },
    screenshots: CAMERA_SCREENSHOT_NAMES.map((name) => ({ name, bytes: screenshotBytes.length, sha256: digest(screenshotBytes) })),
    consoleErrors: { pageErrors: 0, uncaughtConsoleErrors: 0, expected: [] },
  };
  mutate?.(results);
  writeFileSync(join(directory, CAMERA_RESULTS_FILE), `${JSON.stringify(results, null, 2)}\n`);
  writeScreenshotDirectory(directory, screenshotBytes);
  const identity = {
    schemaVersion: 1,
    taskId: 'UDG-004',
    runId: RUN_ID,
    implementationSha: SHA,
    workingTreeDirty: false,
    capturedAt: CAPTURED_AT,
  };
  writeFileSync(
    join(directory, CAMERA_LIFECYCLE_FILE),
    `${JSON.stringify(
      {
        ...identity,
        cycles: 10,
        after: {
          mounted: false,
          engines: 0,
          scenes: 0,
          meshes: 0,
          materials: 0,
          observers: 0,
          listeners: 0,
          renderTicksAdvanced: 0,
          frameRequestsAdvanced: 0,
          engineDisposed: true,
          sceneDisposed: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(directory, CAMERA_CONSOLE_FILE),
    `${JSON.stringify({ ...identity, pageErrors: [], consoleErrors: [], expected: [], unexpectedPageErrors: 0, unexpectedConsoleErrors: 0 }, null, 2)}\n`,
  );
  return results;
};

/** A scratch directory per demonstration, so one test's breakage cannot leak into the next. */
const fresh = (label: string): string => {
  const directory = join(scratch, label);
  mkdirSync(directory, { recursive: true });
  return directory;
};

/** Parse-or-undefined, for a file this suite must not crash on. */
const safeJson = (text: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const codes = (directory: string, overrides?: Parameters<typeof gateBrowserResults>[0]): string[] =>
  gateBrowserResults({ directory, expectedRunId: RUN_ID, expectedImplementationSha: SHA, maxAgeMs: MAX_AGE_MS, now: NOW, requireCleanConsole: true, ...overrides }).map((issue) => issue.code);

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'udg004-gates-'));
  browser = await chromium.launch();
  realPng = await pngOf();
  measured['realScreenshotBytes'] = realPng.length;
  measured['realScreenshotIsPng'] = isBinaryArtefact(new Uint8Array(realPng));
});

afterAll(() => {
  void browser?.close();
  if (scratch.length > 0) rmSync(scratch, { recursive: true, force: true });
  const target = process.env['UDG_EVIDENCE_MEASUREMENTS'];
  if (target === undefined || process.env['UDG_EVIDENCE_TASK'] !== 'UDG-004') return;
  const absolute = resolve(target);
  mkdirSync(join(absolute, '..'), { recursive: true });
  // Appended to the file the contract suite owns, under a distinct key, so the gate demonstrations are part of
  // the measured record rather than a side note beside it.
  // The plan's `binary.portability` threshold is answered by this one flag, and it is deliberately a
  // conjunction rather than a hope: E-4 (a clean PNG survives byte-for-byte and still decodes) and E-5 (a
  // path-carrying PNG is refused with its bytes unchanged) are different code paths in the sanitiser, and the
  // claim "binaries are portable" is only true when both hold.
  const portability =
    measured['E4.pngBytesIdentical'] === true
    && measured['E4.pngDecodesInPinnedChromium'] === true
    && measured['E5.pathCarryingPngRefused'] === true
    && measured['E5.bytesUnchanged'] === true;
  measured['binaryPortabilityProven'] = portability;
  const existing = existsSync(absolute) ? (JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>) : { taskId: 'UDG-004', schemaVersion: 1 };
  writeFileSync(absolute, `${JSON.stringify({ ...existing, evidenceGates: measured }, null, 2)}\n`);
});

describe('E-1: a browser run that did not happen cannot be accepted', () => {
  it('refuses a bundle with no camera results at all', () => {
    const directory = fresh('e1-empty');
    const issues = gateBrowserResults({ directory, expectedRunId: RUN_ID, expectedImplementationSha: SHA, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe('MISSING');
    expect(issues[0]?.detail).toContain(CAMERA_RESULTS_FILE);
    measured['E1.missingRefused'] = true;
  });

  it('refuses a results file that is not JSON, and one that is an empty object', () => {
    const unparseable = fresh('e1-unparseable');
    mkdirSync(join(unparseable, CAMERA_SCREENSHOT_DIRECTORY), { recursive: true });
    writeFileSync(join(unparseable, CAMERA_RESULTS_FILE), '{} this is not json');
    expect(codes(unparseable)).toContain('UNPARSEABLE');

    const placeholder = fresh('e1-placeholder');
    writeFixture(placeholder, () => undefined);
    writeFileSync(join(placeholder, CAMERA_RESULTS_FILE), '{}\n');
    const issues = gateBrowserResults({ directory: placeholder, expectedRunId: RUN_ID, expectedImplementationSha: SHA, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(issues.map((issue) => issue.code)).toContain('IDENTITY');
    expect(issues.map((issue) => issue.code)).toContain('ZERO_CASES');
    expect(issues.map((issue) => issue.code)).toContain('SCREENSHOTS_MISSING');
    measured['E1.placeholderRefused'] = true;
  });

  it('refuses a run that produced no cases, which is a pass that proved nothing', () => {
    const directory = fresh('e1-zerocases');
    writeFixture(directory, (results) => {
      results['cases'] = [];
      results['suites'] = { expected: 0, passed: 0, failed: 0, skipped: 0 };
    });
    const found = codes(directory);
    expect(found).toContain('ZERO_CASES');
    expect(found).toContain('CASE_MISSING');
    measured['E1.zeroCasesRefused'] = true;
  });
});

describe('E-2: a failed or vanished browser case cannot be accepted', () => {
  it('refuses a case that failed, and a case that was skipped', () => {
    const failed = fresh('e2-failed');
    writeFixture(failed, (results) => {
      results['cases'] = (results['cases'] as Record<string, unknown>[]).map((entry, index) =>
        index === 3 ? { ...entry, status: 'failed' } : entry,
      );
      results['suites'] = { expected: CAMERA_CASE_NAMES.length, passed: CAMERA_CASE_NAMES.length - 1, failed: 1, skipped: 0 };
    });
    const found = codes(failed);
    expect(found).toContain('FAILED');
    expect(found).toContain('CASE_NOT_PASSED');

    const skipped = fresh('e2-skipped');
    writeFixture(skipped, (results) => {
      results['cases'] = (results['cases'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0 ? { ...entry, status: 'skipped' } : entry,
      );
      results['suites'] = { expected: CAMERA_CASE_NAMES.length, passed: CAMERA_CASE_NAMES.length - 1, failed: 0, skipped: 1 };
    });
    expect(codes(skipped)).toContain('CASE_NOT_PASSED');
    measured['E2.failedAndSkippedRefused'] = true;
  });

  it('refuses a deleted case, even with the totals rewritten to match', () => {
    const directory = fresh('e2-deleted');
    writeFixture(directory, (results) => {
      const cases = (results['cases'] as Record<string, unknown>[]).slice(1);
      results['cases'] = cases;
      // The counters are self-consistent: only the missing name gives it away, which is why the required case
      // list lives in the gate and not in the artefact.
      results['suites'] = { expected: cases.length, passed: cases.length, failed: 0, skipped: 0 };
    });
    const found = codes(directory);
    expect(found).toContain('CASE_MISSING');
    measured['E2.deletedCaseRefused'] = true;
  });

  it('refuses a page that logged an unexplained error, and a lifecycle count that survived disposal', () => {
    const directory = fresh('e2-console');
    writeFixture(directory, (results) => {
      results['consoleErrors'] = { pageErrors: 2, uncaughtConsoleErrors: 1, expected: [] };
    });
    expect(codes(directory)).toContain('CONSOLE_PAGE_ERRORS');

    writeFixture(directory);
    writeFileSync(
      join(directory, CAMERA_LIFECYCLE_FILE),
      readFileSync(join(directory, CAMERA_LIFECYCLE_FILE), 'utf8').replace('"meshes": 0', '"meshes": 13'),
    );
    const issues = gateCompanionArtefacts(directory, { runId: RUN_ID, implementationSha: SHA, minCycles: 10 });
    expect(issues.map((issue) => issue.code)).toContain('MEASUREMENT');
    expect(issues[0]?.detail).toContain('after.meshes');
    measured['E2.leakAndConsoleRefused'] = true;
  });

  it('refuses a screenshot whose bytes moved, was deleted, or was never declared', () => {
    const directory = fresh('e2-screenshots');
    writeFixture(directory);
    const shot = join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'zoom-min-2m.png');
    writeFileSync(shot, Buffer.concat([readFileSync(shot), Buffer.from('trailing bytes')]));
    let found = codes(directory);
    expect(found).toContain('SCREENSHOT_BYTES');
    expect(found).toContain('SCREENSHOT_HASH');

    rmSync(shot);
    found = codes(directory);
    expect(found).toContain('SCREENSHOT_MISSING');

    writeFixture(directory);
    writeFileSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'surprise.png'), TINY_PNG);
    expect(codes(directory)).toContain('SCREENSHOT_UNLISTED');

    // A PNG whose signature is gone is not a smaller picture; it is the E-4 defect arriving as an artefact.
    writeFixture(directory);
    writeFileSync(shot, Buffer.from('not a png at all, but the right length xxxxxxxxxxxxxxxxxxxxxxxxxx'));
    found = codes(directory);
    expect(found).toContain('SCREENSHOT_HASH');
    expect(found).toContain('SCREENSHOT_BYTES');
    measured['E2.screenshotTamperingRefused'] = true;
  });
});

describe('E-3: yesterday\'s green run cannot stand in for today\'s', () => {
  it('refuses an old capture, a foreign run, a different commit and a dirty tree', () => {
    const stale = fresh('e3-stale');
    writeFixture(stale, (results) => {
      results['capturedAt'] = new Date(NOW.getTime() - 10 * 60 * 60 * 1000).toISOString();
    });
    expect(codes(stale)).toContain('STALE');

    const foreignRun = fresh('e3-run');
    writeFixture(foreignRun, (results) => {
      results['runId'] = 'UDG-004-someone-elses-run-bbbbbbb2';
    });
    expect(codes(foreignRun)).toContain('RUN_MISMATCH');

    const otherCommit = fresh('e3-sha');
    writeFixture(otherCommit, (results) => {
      results['implementationSha'] = 'f'.repeat(40);
    });
    expect(codes(otherCommit)).toContain('IDENTITY');

    const dirty = fresh('e3-dirty');
    writeFixture(dirty, (results) => {
      results['workingTreeDirty'] = true;
    });
    expect(codes(dirty)).toContain('TREE_DIRTY');

    const wrongTask = fresh('e3-task');
    writeFixture(wrongTask, (results) => {
      results['taskId'] = 'UDG-003';
    });
    const issues = codes(wrongTask);
    expect(issues).toContain('IDENTITY');
    measured['E3.staleForeignDirtyRefused'] = true;
  });

  it('refuses a companion artefact copied out of another run while the main one is current', () => {
    const directory = fresh('e3-companion');
    writeFixture(directory);
    writeFileSync(
      join(directory, CAMERA_CONSOLE_FILE),
      readFileSync(join(directory, CAMERA_CONSOLE_FILE), 'utf8').replace(RUN_ID, 'UDG-004-older-run-ccccccc3'),
    );
    const issues = gateCompanionArtefacts(directory, { runId: RUN_ID, implementationSha: SHA, minCycles: 10 });
    expect(issues.map((issue) => issue.code)).toContain('RUN_MISMATCH');
    // Nine cycles is not ten; the contract says ten mount/unmount cycles, and the artefact has to show ten.
    writeFixture(directory);
    writeFileSync(
      join(directory, CAMERA_LIFECYCLE_FILE),
      readFileSync(join(directory, CAMERA_LIFECYCLE_FILE), 'utf8').replace('"cycles": 10', '"cycles": 9'),
    );
    const short = gateCompanionArtefacts(directory, { runId: RUN_ID, implementationSha: SHA, minCycles: 10 });
    expect(short.map((issue) => issue.code)).toContain('MEASUREMENT');
    measured['E3.companionCopyRefused'] = true;
  });

  it('accepts the unbroken artefact set, so the refusals above are about the break and not about the gate', () => {
    const directory = fresh('control');
    writeFixture(directory);
    const issues = gateBrowserResults({
      directory,
      expectedRunId: RUN_ID,
      expectedImplementationSha: SHA,
      maxAgeMs: MAX_AGE_MS,
      now: NOW,
      requireCleanConsole: true,
      requiredMeasurements: { unexplainedPageErrors: 0, frameRequestsAfterDispose: 0, listenersAfterDispose: 0 },
    });
    expect(issues).toEqual([]);
    expect(gateCompanionArtefacts(directory, { runId: RUN_ID, implementationSha: SHA, minCycles: 10 })).toEqual([]);
    measured['control.cleanArtefactAccepted'] = true;
  });
});

describe('E-4: a real screenshot survives capture byte-for-byte and still opens', () => {
  it('leaves a PNG untouched while rewriting the text beside it', () => {
    const directory = join(scratch, 'e4-survives');
    mkdirSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY), { recursive: true });
    const pngPath = join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png');
    writeFileSync(pngPath, realPng);
    // Text that genuinely needs sanitising, in the same directory, so "the binary was skipped" cannot be
    // confused with "nothing was rewritten at all".
    writeFileSync(join(directory, 'notes.json'), `${JSON.stringify({ repo: ROOT, run: directory })}\n`);
    const before = readFileSync(pngPath);
    const roots = machineRoots(ROOT, directory, undefined);

    const rewritten = sanitiseBundleDirectory(directory, (_label, text) => {
      let out = text;
      for (const [path, token] of roots) out = out.split(path).join(token);
      return out;
    });

    const after = readFileSync(pngPath);
    expect(after.equals(before), 'a PNG was rewritten by sanitisation').toBe(true);
    expect(digest(after)).toBe(digest(before));
    expect(rewritten).toContain('notes.json');
    expect(rewritten).not.toContain(join(CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png'));
    expect(readFileSync(join(directory, 'notes.json'), 'utf8')).toContain('REPO_ROOT');
    expect(readFileSync(join(directory, 'notes.json'), 'utf8')).not.toContain(ROOT);
    measured['E4.pngBytesIdentical'] = true;
    measured['E4.textStillSanitised'] = rewritten.includes('notes.json');
  });

  it('still decodes in the same chromium build that captured it', async () => {
    expect(realPng.length).toBeGreaterThan(2000);
    const context = await (browser ?? await chromium.launch()).newContext();
    const page = await context.newPage();
    const dataUrl = `data:image/png;base64,${realPng.toString('base64')}`;
    await page.setContent(`<img id="shot" alt="" src="${dataUrl}" />`);
    // The page functions below are strings rather than closures. This suite is typechecked by the root project,
    // which has no DOM library — the same reason `apps/client` is the only workspace allowed one — and a
    // `document.getElementById` closure here would either fail to compile or tempt someone into widening the
    // root project's library to make it compile.
    await page.waitForFunction('document.getElementById("shot")?.complete === true');
    const decoded = (await page.evaluate(
      '({ w: document.getElementById("shot")?.naturalWidth ?? 0, h: document.getElementById("shot")?.naturalHeight ?? 0 })',
    )) as { w: number; h: number };
    await context.close();
    const opened = decoded.w === 1280 && decoded.h === 720;
    expect(opened, `the retained PNG did not decode as 1280x720: ${JSON.stringify(decoded)}`).toBe(true);
    measured['E4.pngDecodesInPinnedChromium'] = true;
  });

  it('would have failed before the fix, and says so in numbers a reviewer can check', () => {
    // The measured defect, restated as an assertion: decoding a PNG as UTF-8 and re-encoding it is not identity.
    // If a future refactor reintroduces the text round trip for binaries, this stops it on the spot — with the
    // byte counts, because "it looked fine in the viewer" is what let it through the first time.
    const lossy = Buffer.from(realPng.toString('utf8'), 'utf8');
    expect(lossy.equals(realPng), 'this chromium/Node pair no longer mangles PNG bytes; re-check the G-9(b) ruling').toBe(false);
    expect(lossy.length).not.toBe(realPng.length);
    expect(isBinaryArtefact(new Uint8Array(realPng))).toBe(true);
    expect(isBinaryArtefact(new Uint8Array(Buffer.from('{"a":1}')))).toBe(false);
    expect(isBinaryArtefact(new Uint8Array(Buffer.from('<testsuites><testcase name="x"/></testsuites>')))).toBe(false);
    measured['E4.lossyRoundTripStillLossy'] = true;
  });
});

describe('E-5: a PNG carrying a machine path is refused, not repaired', () => {
  it('reports the file, and leaves the offending bytes exactly as they were', () => {
    const directory = join(scratch, 'e5-refused');
    mkdirSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY), { recursive: true });
    const path = join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png');
    // A tEXt chunk carrying the checkout path, appended the way a naive screenshot writer would: this is the
    // case the contract's "no machine path in a published artefact" rule is about, in a file that cannot be
    // edited without breaking it.
    const leaked = Buffer.concat([realPng, textChunk('Comment', `captured in ${ROOT}`)]);
    writeFileSync(path, leaked);
    const before = readFileSync(path);
    expect(isBinaryArtefact(new Uint8Array(before))).toBe(true);
    expect(before.toString('latin1')).toContain(ROOT);

    const roots = machineRoots(ROOT, directory, undefined);
    const refusals = binaryMachinePathRefusals(directory, roots);
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain(join(CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png'));
    expect(refusals[0]).toContain('refusing instead of rewriting');

    // The bytes are the demonstration. A refusal that also "fixed" the file would destroy the evidence that
    // something produced it, and would be the same silent rewrite in a different clothes.
    const after = readFileSync(path);
    expect(after.equals(before)).toBe(true);
    expect(after.toString('latin1')).toContain(ROOT);

    // And sanitisation itself still refuses to touch it, so there is no second path to the same rewrite.
    const rewritten = sanitiseBundleDirectory(directory, (_label, text) => text.split(ROOT).join('REPO_ROOT'));
    expect(rewritten).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
    measured['E5.pathCarryingPngRefused'] = true;
    measured['E5.bytesUnchanged'] = true;
  });

  it('still decodes, which is the point of refusing rather than rewriting', async () => {
    const directory = join(scratch, 'e5-refused');
    const bytes = readFileSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png'));
    const context = await (browser ?? await chromium.launch()).newContext();
    const page = await context.newPage();
    await page.setContent(`<img id="shot" alt="" src="data:image/png;base64,${bytes.toString('base64')}" />`);
    await page.waitForFunction('document.getElementById("shot")?.complete === true');
    const width = (await page.evaluate('document.getElementById("shot")?.naturalWidth ?? 0')) as number;
    await context.close();
    expect(width).toBe(1280);
    measured['E5.refusedPngStillOpens'] = true;
  });

  it('says nothing about a PNG that carries no path, so the refusal stays a signal', () => {
    const directory = join(scratch, 'e5-clean');
    mkdirSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY), { recursive: true });
    writeFileSync(join(directory, CAMERA_SCREENSHOT_DIRECTORY, 'orbit-default.png'), realPng);
    writeFileSync(join(directory, 'plain.json'), `${JSON.stringify({ note: 'no paths here' })}\n`);
    expect(binaryMachinePathRefusals(directory, machineRoots(ROOT, directory, undefined))).toEqual([]);
    measured['E5.cleanPngNotRefused'] = true;
  });
});

describe('E-6: what this task did not own still works', () => {
  it('is reading the repository it thinks it is reading', () => {
    // E-6 is a claim about *this* checkout's records. If the root above is wrong, every count below is zero
    // and every assertion still passes, which is the worst kind of green.
    expect(existsSync(join(ROOT, 'pnpm-lock.yaml')), `${ROOT} is not the repository root`).toBe(true);
    expect(existsSync(join(ROOT, 'docs', 'contracts', 'UDG-004.md'))).toBe(true);
    measured['rootIsRepository'] = true;
  });

  it('keeps the accepted capture plans byte-identical', () => {
    const accepted: Readonly<Record<string, string>> = {
      'UDG-001': '3b450c283d165361',
      'UDG-002': '754df194a28d1e0a',
      'UDG-003': '3b93cfbbd9ca818e',
    };
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
          : value;
    for (const [taskId, want] of Object.entries(accepted)) {
      const plan = CAPTURE_PLANS[taskId];
      expect(plan, `${taskId} lost its capture plan`).toBeDefined();
      const have = createHash('sha256').update(JSON.stringify(canonical(plan ?? {}))).digest('hex').slice(0, 16);
      expect(have, `${taskId}'s capture plan changed`).toBe(want);
    }
    measured['E6.acceptedPlansUnchanged'] = Object.keys(accepted).length;
  });

  it('does not break the integrity checks over the bundles already in the store', () => {
    // E-6 as it can honestly be tested. The claim UDG-004 owes is narrow: the shared evidence tool it edited
    // still checks retained bundles correctly. So every sibling bundle this machine can see is verified, and
    // the *integrity* codes — the ones a sanitisation or artefact-copying change could plausibly cause — are
    // asserted absent. Other codes are recorded rather than failed, because a bundle captured last week
    // against a plan that has since grown legitimately reports EVIDENCE-COMMAND-MISSING: measured on this
    // machine, all four retained UDG-003 bundles report exactly that, for the Phase 2 runtime commands added
    // after they were written, and none of them reports a hash, size or secret problem.
    //
    // CI is where this demonstration actually lands: the job captures UDG-001, UDG-002 and UDG-003 bundles
    // before UDG-004's, verifies each one in its own step, and this test then re-verifies them inside
    // UDG-004's own capture. The current run's own bundle is deliberately excluded, because a bundle being
    // written is not a record yet.
    // The codes that mean "these bytes are wrong, empty, or leaking", as opposed to "this bundle predates the
    // current plan": `EVIDENCE-FILE-MISSING` and `EVIDENCE-COMMAND-MISSING` say a plan declares more than the
    // bundle was captured with, which is true of every stale bundle and says nothing about this task's edit.
    const integrityCodes = new Set([
      'EVIDENCE-FILE-EMPTY',
      'EVIDENCE-FILE-HASH',
      'EVIDENCE-CHECKSUM-MISMATCH',
      'EVIDENCE-CHECKSUM-INCOMPLETE',
      'EVIDENCE-SECRET',
      'EVIDENCE-REPORT-MISSING',
      'EVIDENCE-REPORT-UNPARSEABLE',
    ]);
    const store = resolve(ROOT, process.env['UDG_RETAINED_BUNDLES'] ?? 'artifacts');
    const bundles = existsSync(store)
      ? readdirSync(store, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^UDG-00[123]-\d{4}/.test(entry.name))
        .map((entry) => join(store, entry.name))
        .filter((directory) => existsSync(join(directory, 'report.json')))
        .sort()
      : [];
    const outcomes: Record<string, string> = {};
    const integrityFailures: string[] = [];
    for (const bundle of bundles) {
      // A bundle whose own report says FAIL is retained *because* it is red — UDG-003 keeps one from a run it
      // had to reproduce — and asking it to verify clean would be asking it to deny what it recorded. Measured
      // here: the red one reports an empty stdout log for a step that failed before printing, which is exactly
      // what EVIDENCE-FILE-EMPTY means and nothing to do with this task. Red bundles are counted, not gated.
      const declared = safeJson(readFileSync(join(bundle, 'report.json'), 'utf8'))?.['status'];
      if (declared !== 'PASS') {
        outcomes[bundle.replace(`${store}/`, '')] = `retained red run (report status ${String(declared)}), not required to verify clean`;
        continue;
      }
      const result = spawnSync('pnpm', ['evidence:verify', '--', '--run', bundle], { cwd: ROOT, encoding: 'utf8', timeout: 900_000 });
      const codes = [...`${result.stdout ?? ''}${result.stderr ?? ''}`.matchAll(/^EVIDENCE-[A-Z-]+/gm)].map((match) => match[0]);
      outcomes[bundle.replace(`${store}/`, '')] = result.status === 0 ? 'verified' : [...new Set(codes)].sort().join(',') || `exit ${String(result.status)}`;
      for (const code of codes) {
        if (integrityCodes.has(code)) integrityFailures.push(`${bundle}: ${code}`);
      }
    }
    measured['E6.bundlesVisible'] = bundles.length;
    // One compact string per bundle in the measurements file, so a reader of the bundle can see what the
    // older records actually reported instead of taking "0 failures" to mean "nothing to check".
    measured['E6.bundleOutcomes'] = JSON.stringify(outcomes);
    expect(integrityFailures, 'retained bundles failed an integrity check this task could have caused').toEqual([]);
  });

  it('still rewrites text artefacts it has always rewritten, including the JUnit report', () => {
    const directory = join(scratch, 'e6-text');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'junit.xml'), `<testsuites><testcase name="x" classname="${ROOT}/tests"/><system-out>cwd ${directory}</system-out></testsuites>`);
    writeFileSync(join(directory, 'notes.csv'), `path,value\n${ROOT},1\n`);
    const rewritten = sanitiseBundleDirectory(directory, (_label, text) => {
      let out = text;
      for (const [path, token] of machineRoots(ROOT, directory, undefined)) out = out.split(path).join(token);
      return out;
    });
    expect(rewritten.sort()).toEqual(['junit.xml', 'notes.csv']);
    expect(readFileSync(join(directory, 'junit.xml'), 'utf8')).not.toContain(ROOT);
    expect(readFileSync(join(directory, 'notes.csv'), 'utf8')).not.toContain(directory);
    measured['E6.textRewritePreserved'] = true;
  });
});

/**
 * A PNG `tEXt` chunk, built by hand: type, length, payload and the CRC the format demands.
 *
 * Hand-built because the point of the fixture is a *real* PNG that carries a private path, and the only way to
 * make one is to write the chunk the way a writer would. A truncated or CRC-less chunk would test the refusal
 * against a file no producer would ever emit.
 */
const textChunk = (keyword: string, value: string): Buffer => {
  const payload = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0x00]), Buffer.from(value, 'latin1')]);
  const type = Buffer.from('tEXt', 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, payload])), 0);
  return Buffer.concat([length, type, payload, crc]);
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >> 1) : value >> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Buffer): number => {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) crc = (CRC_TABLE[byte & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};
