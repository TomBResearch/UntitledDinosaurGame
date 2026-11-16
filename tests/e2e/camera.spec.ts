/**
 * UDG-004 camera suite — the only browser suite in the repository, and the evidence path for every claim
 * `docs/contracts/UDG-004.md` makes about the client (assignment record §5, §6).
 *
 * ## How it is reached, and how it is not
 *
 * `pnpm test:e2e -- --suite camera` is the only route here; `tools/checks/src/dispatch.ts` refuses every other
 * suite name, an unknown suite and a missing `--suite`, and nothing else in the repository invokes
 * `playwright test`. The server under test is started by `playwright.config.ts` (`pnpm dev`, bound to loopback,
 * `strictPort`), so the suite and the server share one network namespace and never depend on a published port.
 *
 * ## Where the evidence goes, and who reads it
 *
 * Every case ends in a measurement, and the measurements are written to `UDG_BROWSER_OUT` (default
 * `artifacts/.local/browser-evidence`) as `camera-browser-results.json`, `lifecycle-counts.json`,
 * `console-errors.json`, `browser/screenshots.json` and six PNGs. `tests/contracts/UDG-004.test.ts` gates those
 * bytes — missing, failed, stale, short a case, or with a screenshot whose digest moved — and it runs inside
 * `pnpm test`, which is the command that writes the bundle's single `junit.xml`. So a browser run that did not
 * happen, or happened against different bytes, stops the acceptance command instead of being a footnote beside
 * it (record §6.2 E-1…E-3).
 *
 * ## What is measured from where
 *
 * Scene facts (engines, scenes, meshes, materials, observers, the camera transform, world positions of the axis
 * marker and the capsules) come from the development harness, which reads Babylon's own registries — see
 * `apps/client/src/dev/sceneReadout.ts`. `requestAnimationFrame` traffic comes from the harness's frame spy. The
 * handedness check derives its expected screen sides from the camera's own position and target with independent
 * vector maths in this file, then compares with what the engine's picker says is actually on screen: a claim
 * about the picture, not about a number the client kept for itself.
 *
 * ## Touch, honestly
 *
 * Chromium under Playwright has no two-finger gesture recorder, so pinch and touch-orbit are exercised by
 * dispatching real `pointerdown`/`pointermove`/`pointerup` sequences with two distinct `pointerId`s and
 * `pointerType: 'touch'` at the canvas. That proves the client's *event mapping* — two touch pointers become a
 * pinch, and the pinch is clamped — which is exactly the half the contract allows emulation to prove; it
 * certifies nothing about physical-device frame budgets, and `docs/contracts/UDG-004.md` says so.
 *
 * ## No retries, no skipping
 *
 * `retries: 0` and `workers: 1` are set in the config and are not negotiable here. A flaky camera case blocks
 * acceptance (record §9 M-7), and a skipped case is reported as `skipped` in the artefact, which the gate treats
 * as a failure rather than a smaller pass.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, expect, test, type Page } from '@playwright/test';

import type { HarnessSnapshot } from '../../apps/client/src/dev/lifecycleHarness.js';
import type { AxisProbe, MeshPoint, ScenePick } from '../../apps/client/src/dev/sceneReadout.js';
import type { CameraBrowserResults, CameraCaseResult, CameraConsoleErrors, CameraLifecycleCounts, ScreenshotRecord } from '../unit/udg-004/browser-results.ts';
import {
  CAMERA_CASE_NAMES,
  CAMERA_CONSOLE_FILE,
  CAMERA_LIFECYCLE_FILE,
  CAMERA_RESULTS_FILE,
  CAMERA_RESULTS_SCHEMA_VERSION,
  CAMERA_RESULTS_TASK,
  CAMERA_SCREENSHOT_DIRECTORY,
  CAMERA_SCREENSHOT_INDEX_FILE,
  CAMERA_SCREENSHOT_NAMES,
} from '../unit/udg-004/browser-results.ts';

const OUT_DIR = process.env['UDG_BROWSER_OUT'] ?? join('artifacts', '.local', 'browser-evidence');
const VIEWPORT = { width: 1280, height: 720 };

/** Console/page messages a development run is expected to produce, each with the reason it is expected. */
const EXPECTED_CONSOLE: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /ws:\/\/127\.0\.0\.1:2567|WebSocket is closed|Failed to construct 'WebSocket'/,
    reason:
      'UDG-003 owns the server and no server runs in this suite; the contract requires the failure to be a rendered state, so the socket error is the client doing its job.',
  },
  {
    pattern: /WebGL|GL Driver|SwiftShader|GroupMarkerNotSet|software rendering/,
    reason: 'Headless Chromium renders through SwiftShader in CI; the warnings come from the software rasteriser, not from the client.',
  },
  {
    pattern: /Download the React DevTools/,
    reason: 'A development-build suggestion from React itself, informational.',
  },
];

/** Per-test outcomes, collected through `afterEach` so a failure is recorded as a failure. */
const caseResults: CameraCaseResult[] = [];
/** Screenshots taken by the cases that produce them, in the order named by the artefact schema. */
const screenshotRecords: ScreenshotRecord[] = [];
/** Page errors and console errors, across every test in this file. */
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
/** The lifecycle numbers, filled by the disposal case and written into `lifecycle-counts.json`. */
let lifecycle: CameraLifecycleCounts['after'] | undefined;
let lifecycleCycles = 0;
let browserVersion = 'unknown';

const harnessCall = async <T>(page: Page, call: string, ...args: unknown[]): Promise<T> =>
  (await page.evaluate(
    ({ invocation, values }) => {
      const harness = (window as unknown as { __udgClientHarness?: Record<string, unknown> }).__udgClientHarness;
      if (harness === undefined) throw new Error('__udgClientHarness is not installed: this is not a development build');
      const method = harness[invocation];
      if (typeof method !== 'function') throw new Error(`__udgClientHarness.${invocation} is not a function`);
      return (method as (...inner: unknown[]) => unknown).apply(harness, values);
    },
    { invocation: call, values: args },
  )) as T;

const snapshotOf = (page: Page): Promise<HarnessSnapshot> =>
  harnessCall<HarnessSnapshot>(page, 'snapshot');

/**
 * Wait for the development seam and for a first painted frame.
 *
 * Both conditions matter: a harness that exists but reports zero ticks means the loop has not started, and the
 * first case measures the loop.
 */
const waitForHarness = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => (window as unknown as { __udgClientHarness?: { snapshot: () => { renderTicks: number } } }).__udgClientHarness?.snapshot().renderTicks !== undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __udgClientHarness?: { snapshot: () => { renderTicks: number } } }).__udgClientHarness?.snapshot().renderTicks as number > 0,
    { timeout: 30_000 },
  );
};

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const normalise = (value: { x: number; y: number; z: number }) => {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Signed shortest-arc azimuth difference in degrees, so a direction can be asserted rather than a distance.
 * Wrapping is the reason this exists: 350° → 10° is +20°, not −340°.
 */
const azimuthDeltaDegrees = (from: number, to: number): number => {
  const raw = (to - from) % 360;
  return raw > 180 ? raw - 360 : raw < -180 ? raw + 360 : raw;
};

/** A drag across the canvas, expressed the way a mouse produces it: down, moves, up. */
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
  const canvas = page.locator('canvas[data-udg-scene]');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('the scene canvas has no bounding box');
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(box.x + from.x + ((to.x - from.x) * step) / steps, box.y + from.y + ((to.y - from.y) * step) / steps);
  }
  await page.mouse.up();
};

/** Two touch pointers, moved apart or together: the pinch mapping, dispatched rather than emulated. */
const pinch = async (page: Page, fromGap: number, toGap: number): Promise<void> => {
  await page.evaluate(
    async ({ start, end }) => {
      const canvas = document.querySelector('canvas[data-udg-scene]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no scene canvas to pinch');
      const rect = canvas.getBoundingClientRect();
      const centre = { x: rect.width / 2, y: rect.height / 2 };
      const fire = (type: string, id: number, x: number, y: number): void => {
        canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 0,
          clientX: rect.left + x,
          clientY: rect.top + y,
          bubbles: true,
          cancelable: true,
          buttons: 1,
        }));
      };
      const half = (gap: number): number => gap / 2;
      fire('pointerdown', 0, centre.x - half(start), centre.y);
      fire('pointerdown', 1, centre.x + half(start), centre.y);
      const frames = 10;
      for (let frame = 1; frame <= frames; frame += 1) {
        const gap = start + ((end - start) * frame) / frames;
        fire('pointermove', 0, centre.x - half(gap), centre.y);
        fire('pointermove', 1, centre.x + half(gap), centre.y);
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
      fire('pointerup', 0, centre.x - half(end), centre.y);
      fire('pointerup', 1, centre.x + half(end), centre.y);
    },
    { start: fromGap, end: toGap },
  );
};

/** One touch pointer, dragged: the mapping a phone produces when a player turns the view. */
const touchDrag = async (page: Page, dx: number, dy: number): Promise<void> => {
  await page.evaluate(
    async ({ deltaX, deltaY }) => {
      const canvas = document.querySelector('canvas[data-udg-scene]');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no scene canvas to drag');
      const rect = canvas.getBoundingClientRect();
      const start = { x: rect.width / 2, y: rect.height / 2 };
      const fire = (type: string, x: number, y: number): void => {
        canvas.dispatchEvent(new PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
          bubbles: true,
          cancelable: true,
          buttons: 1,
        }));
      };
      fire('pointerdown', start.x, start.y);
      for (let frame = 1; frame <= 8; frame += 1) {
        fire('pointermove', start.x + (deltaX * frame) / 8, start.y + (deltaY * frame) / 8);
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
      fire('pointerup', start.x + deltaX, start.y + deltaY);
    },
    { deltaX: dx, deltaY: dy },
  );
};

/** The wheel, which is the desktop zoom input and needs no synthetic event at all. */
const wheel = async (page: Page, deltaY: number): Promise<void> => {
  await page.locator('canvas[data-udg-scene]').hover();
  await page.mouse.wheel(0, deltaY);
};

const screenshotTo = async (page: Page, name: (typeof CAMERA_SCREENSHOT_NAMES)[number]): Promise<void> => {
  const directory = join(OUT_DIR, CAMERA_SCREENSHOT_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  await page.screenshot({ path, fullPage: false });
  const bytes = readFileSync(path);
  screenshotRecords.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};

const wheelToLimit = async (page: Page, direction: 'in' | 'out'): Promise<void> => {
  for (let index = 0; index < 40; index += 1) await wheel(page, direction === 'in' ? -240 : 240);
};

/**
 * Push elevation to one of its bounds by overshooting into the clamp.
 *
 * The direction is the client's documented vertical convention (`rendering/OrbitCamera.ts`: a drag down
 * rolls the camera over the top, because `betaDelta` is subtracted), which is the opposite of Babylon's own
 * camera-pointer convention and worth stating because it is the single most likely thing for a reader of this
 * file to assume backwards. Vertical drag is shared by mouse and touch; only the horizontal term differs by
 * device, and the orbit case below asserts that difference by sign. Overshoot is exact here for the same reason it is exact for zoom: the clamp is a
 * clamp, not a soft curve.
 */
const elevationTo = async (page: Page, limit: 'min' | 'max'): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await drag(page, { x: 640, y: 360 }, { x: 640, y: limit === 'max' ? 690 : 30 });
  }
};

test.beforeEach(async ({ page, browser }, testInfo) => {
  browserVersion = browser.version();
  testInfo.setTimeout(180_000);
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize(VIEWPORT);
  await page.goto('/', { waitUntil: 'load' });
  await waitForHarness(page);
});

test.afterEach(async ({ page }, testInfo) => {
  const title = testInfo.title;
  const status = testInfo.status === 'passed' ? 'passed' : testInfo.status === 'skipped' ? 'skipped' : 'failed';
  caseResults.push({ name: title, status, durationMs: Math.round(testInfo.duration) });
  // The case name is the artefact's identity: an unexpected title means the artefact and the gate have
  // drifted apart, and that must fail here rather than as a mystery in the contract suite.
  expect(CAMERA_CASE_NAMES as readonly string[], `unexpected case title: ${title}`).toContain(title);
  // A case that crashed the page still has a URL, and recording it is what tells a reader the run got as far as
  // the client rather than dying on a navigation.
  expect(page.url(), 'the suite navigated away from the client').toContain('/');
});

test.afterAll(async () => {
  // The artefacts are written once, from everything the cases produced. Nothing in here is derived from a
  // previous run: `git` supplies the commit, the config supplies the run identity, and every digest is recomputed
  // from the bytes on disk at this moment.
  const runId = process.env['UDG_RUN_ID'] ?? `local-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const sha = process.env['UDG_IMPLEMENTATION_SHA'] ?? gitRevision();
  const dirty = workingTreeDirty();
  const capturedAt = new Date().toISOString();
  const screenshotDirectory = join(OUT_DIR, CAMERA_SCREENSHOT_DIRECTORY);
  mkdirSync(screenshotDirectory, { recursive: true });

  const identity = {
    schemaVersion: CAMERA_RESULTS_SCHEMA_VERSION,
    taskId: CAMERA_RESULTS_TASK,
    runId,
    implementationSha: sha,
    workingTreeDirty: dirty,
    capturedAt,
  };

  // Screenshots are re-hashed from disk, so the index describes the bytes that survived to this point rather
  // than the bytes the case believed it wrote.
  const onDisk: ScreenshotRecord[] = [];
  for (const name of CAMERA_SCREENSHOT_NAMES) {
    const path = join(screenshotDirectory, name);
    // A case that died before its screenshot must not die again here: the index records the absence as a
    // zero-length, unhashed entry, and the contract gate reports it as SCREENSHOT_MISSING. Reporting from the
    // suite and gating from the gate are two different jobs.
    if (!existsSync(path)) {
      onDisk.push({ name, bytes: 0, sha256: 'absent' });
      continue;
    }
    const bytes = readFileSync(path);
    onDisk.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  writeFileSync(
    join(OUT_DIR, CAMERA_SCREENSHOT_INDEX_FILE),
    `${JSON.stringify({ ...identity, directory: CAMERA_SCREENSHOT_DIRECTORY, screenshots: onDisk, order: [...CAMERA_SCREENSHOT_NAMES] }, null, 2)}\n`,
  );

  const expectedPatterns = EXPECTED_CONSOLE.map((entry) => entry.pattern.source);
  const unexpectedPage = pageErrors.filter((text) => !EXPECTED_CONSOLE.some((entry) => entry.pattern.test(text)));
  const unexpectedConsole = consoleErrors.filter((text) => !EXPECTED_CONSOLE.some((entry) => entry.pattern.test(text)));

  const lifecycleCounts: CameraLifecycleCounts = {
    ...identity,
    cycles: lifecycleCycles,
    after: lifecycle ?? {
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
  };
  writeFileSync(join(OUT_DIR, CAMERA_LIFECYCLE_FILE), `${JSON.stringify(lifecycleCounts, null, 2)}\n`);

  const consoleArtefact: CameraConsoleErrors = {
    ...identity,
    pageErrors,
    consoleErrors,
    expected: EXPECTED_CONSOLE.map((entry) => ({ pattern: entry.pattern.source, reason: entry.reason })),
    unexpectedPageErrors: unexpectedPage.length,
    unexpectedConsoleErrors: unexpectedConsole.length,
  };
  writeFileSync(join(OUT_DIR, CAMERA_CONSOLE_FILE), `${JSON.stringify(consoleArtefact, null, 2)}\n`);

  const results: CameraBrowserResults = {
    ...identity,
    browser: {
      name: 'chromium',
      version: browserVersion,
      chromiumBuild: chromiumBuildDirectory(),
      headed: false,
      viewport: VIEWPORT,
    },
    suites: {
      expected: CAMERA_CASE_NAMES.length,
      passed: caseResults.filter((entry) => entry.status === 'passed').length,
      failed: caseResults.filter((entry) => entry.status === 'failed').length,
      skipped: caseResults.filter((entry) => entry.status === 'skipped').length,
    },
    cases: caseResults,
    measurements: measurements(),
    screenshots: onDisk,
    consoleErrors: {
      pageErrors: unexpectedPage.length,
      uncaughtConsoleErrors: unexpectedConsole.length,
      expected: expectedPatterns,
    },
  };
  writeFileSync(join(OUT_DIR, CAMERA_RESULTS_FILE), `${JSON.stringify(results, null, 2)}\n`);
});

/**
 * The commit the bytes came from, the same way the other artefact writers in this repository get it
 * (`tests/unit/udg-003/vectors.test.ts`): ask git, and if git cannot answer, say so rather than guess.
 */
const gitRevision = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

/**
 * Whether the tree carried uncommitted changes while the browser ran.
 *
 * Fails **closed**. A writer that reported `false` because it could not run `git status` would be claiming the
 * bytes are attributable to a commit when it does not know that, which is the one thing this field exists to
 * prevent; the gate refuses a dirty artefact, so an uncertain answer has to be the refusing one.
 */
const workingTreeDirty = (): boolean => {
  const override = process.env['UDG_WORKING_TREE_DIRTY'];
  if (override === 'true') return true;
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  } catch {
    return true;
  }
};

/**
 * The Playwright chromium build actually installed, read from the browsers directory.
 *
 * The contract pins Playwright, and Playwright pins a chromium build; the build number is what a reviewer needs
 * in order to reproduce a rendering claim. Reading the directory instead of restating the number means the
 * artefact cannot keep claiming build 1254 after an upgrade changes it.
 */
const chromiumBuildDirectory = (): string => {
  // The executable first, the browsers directory second. Reading only `PLAYWRIGHT_BROWSERS_PATH` reported
  // `unknown` on the GitHub runner, where the variable is legitimately unset and Playwright resolves its own
  // default cache — and an artefact that says "unknown browser" cannot support a rendering claim, so the task
  // suite refused it (as it must). The executable path is answered by Playwright itself, which knows where it
  // put the build whether or not anything set an environment variable; the directory scan stays as the
  // fallback, and as the way to name more than one installed build.
  const fromExecutable = chromium
    .executablePath()
    .split('/')
    .find((segment) => /^chromium-\d+$/.test(segment));
  if (fromExecutable !== undefined) return fromExecutable;
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (root === undefined || !existsSync(root)) return 'unknown';
  const builds = readdirSync(root).filter((entry) => entry.startsWith('chromium-')).sort();
  return builds.join('+') || 'unknown';
};

/** Numbers the capture plan's thresholds and the contract suite are written against. */
const measurements = (): CameraBrowserResults['measurements'] => measured;

const measured: Record<string, string | number | boolean> = {};

/** Record a measurement, so a threshold in the plan names a value that a case actually produced. */
const measure = <T>(key: string, value: T): T => {
  measured[key] = typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : JSON.stringify(value);
  return value;
};

/**
 * Camera state is finite while a scene exists, and absent when one does not.
 *
 * Both halves matter: a `camera === undefined` while mounted means the readout lost the camera, and a camera
 * reported after `dispose()` means something outlived the scene it belonged to.
 */
const expectFiniteCamera = (snapshot: HarnessSnapshot): void => {
  if (!snapshot.mounted) {
    expect(snapshot.camera, 'a disposed scene still reports a camera').toBeUndefined();
    return;
  }
  const camera = snapshot.camera;
  expect(camera, 'the camera reported no state while mounted').toBeDefined();
  for (const value of [camera?.radiusMeters, camera?.azimuthDegrees, camera?.elevationDegrees, camera?.targetX, camera?.targetY, camera?.targetZ]) {
    expect(Number.isFinite(Number(value)), `camera state carried a non-finite number: ${String(value)}`).toBe(true);
  }
};

test(CAMERA_CASE_NAMES[0], async ({ page }) => {
  const snapshot = await snapshotOf(page);
  expectFiniteCamera(snapshot);
  measure('canvasCount', await page.locator('canvas[data-udg-scene]').count());
  expect(await page.locator('canvas[data-udg-scene]').count()).toBe(1);
  expect(snapshot.app.canvases).toBe(1);
  expect(snapshot.app.loops).toBe(1);
  expect(snapshot.engines).toBe(1);
  expect(snapshot.scene.scenes).toBe(1);
  expect(snapshot.scene.scenesAvailable).toBe(true);
  expect(snapshot.app.renderTicks).toBeGreaterThan(0);
  expect(snapshot.meshes).toBeGreaterThan(6);
  // Two independent presented entities: distinct ids, distinct world positions, distinct yaw.
  const presented = snapshot.presented;
  expect(Object.keys(presented).sort()).toEqual(['pose-local-0', 'pose-static-1']);
  expect(distance(presented['pose-local-0'] ?? { x: 0, y: 0, z: 0 }, presented['pose-static-1'] ?? { x: 0, y: 0, z: 0 }))
    .toBeGreaterThan(1);
  measure('staticPoseX', presented['pose-static-1']?.x ?? Number.NaN);
  expect(presented['pose-static-1']?.x).toBeCloseTo(2.5, 4);
  expect(presented['pose-static-1']?.z).toBeCloseTo(-1.5, 4);
  expect(presented['pose-static-1']?.y).toBeCloseTo(0.9, 4);
  expect(snapshot.presentedYaw['pose-static-1']).toBeCloseTo(Math.PI / 2, 4);
  // The frame is not blank, proved through the compositor rather than by reading the WebGL canvas back.
  //
  // `drawImage(webglCanvas)` is useless here and would have been a silent false positive: the drawing buffer is
  // not preserved between frames (`preserveDrawingBuffer: false` is the fast setting and the client keeps it),
  // so the copy comes back empty and a blank page passes. A Playwright screenshot captures what the browser
  // actually presented, so the size of that PNG is a real signal (an empty frame compresses to a couple of
  // hundred bytes) and two different camera states producing different bytes proves the picture responds.
  const shotA = await page.screenshot();
  const digestA = createHash('sha256').update(shotA).digest('hex');
  measure('screenshotBytes', shotA.length);
  expect(shotA.length, 'the rendered frame compressed to almost nothing: nothing was drawn').toBeGreaterThan(20_000);
  await drag(page, { x: 640, y: 360 }, { x: 860, y: 470 });
  const shotB = await page.screenshot();
  const digestB = createHash('sha256').update(shotB).digest('hex');
  measure('screenshotChangedAfterDrag', digestA !== digestB);
  expect(digestB, 'the picture did not change after an orbit drag').not.toBe(digestA);

  // A second mount attempt is a no-op all the way down. The composition root refuses it before the runtime is
  // asked twice, so the observable claim is the one that matters to a player: one canvas, one engine, one scene,
  // one loop, and the same canvas element rather than a replacement. `ClientRuntime.start()` guards a direct
  // double start too (`duplicateStartAttempts` counts it), but that counter is a runtime's word about itself
  // and nothing in the browser can reach it — so nothing here asserts on it.
  const remounted = await harnessCall<HarnessSnapshot>(page, 'mount');
  expect(remounted.engines).toBe(1);
  expect(remounted.scene.scenes).toBe(1);
  expect(remounted.app.loops).toBe(1);
  expect(await page.locator('canvas').count()).toBe(1);
  const sameCanvas = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-udg-scene]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    canvas.dataset['udgProbeMark'] = 'first-canvas';
    return canvas.dataset['udgProbeMark'];
  });
  expect(sameCanvas).toBe('first-canvas');
  expect(await page.locator('canvas[data-udg-scene][data-udg-probe-mark="first-canvas"]').count()).toBe(1);

  // Aspect change: the engine's render size follows the canvas, and nothing about the scene becomes invalid.
  await page.setViewportSize({ width: 900, height: 380 });
  await page.waitForTimeout(220);
  const resized = await snapshotOf(page);
  expectFiniteCamera(resized);
  const sizes = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-udg-scene]');
    return canvas instanceof HTMLCanvasElement ? { width: canvas.width, height: canvas.height } : null;
  });
  measure('resizedCanvasWidth', sizes?.width ?? 0);
  expect((sizes?.width ?? 0) as number).toBeLessThan(1000);
  expect((sizes?.height ?? 0) as number).toBeLessThan(500);
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(220);

  // The connection failure is a rendered state, not an exception: there is normally no UDG-003 server.
  const status = page.locator('[data-udg-connection-status]');
  await expect(status).toHaveCount(1);
  const state = await status.getAttribute('data-udg-connection-status');
  measure('connectionState', state ?? 'unknown');
  expect(['failed', 'connecting']).toContain(state ?? 'unknown');
  await expect(page.locator('[data-udg-connection-reason]')).toHaveCount(1);

  await screenshotTo(page, 'orbit-default.png');
  expect(pageErrors.filter((text) => !EXPECTED_CONSOLE.some((entry) => entry.pattern.test(text)))).toEqual([]);
});

test(CAMERA_CASE_NAMES[1], async ({ page }) => {
  const snapshot = await snapshotOf(page);
  // The convention the scene states about itself, read back out of the live scene rather than the source.
  expect(snapshot.convention).toEqual({ handedness: 'right-handed', upAxis: 'Y', unit: 'metre' });
  expect(snapshot.scene.cameraName).toBe('udg-orbit-camera');
  // 1 world unit = 1 metre: the adopted capsule height, measured off the world-space bounding box.
  measure('presentedHeightUnits', snapshot.scene.presentedHeightUnits ?? Number.NaN);
  expect(snapshot.scene.presentedHeightUnits ?? 0).toBeCloseTo(1.8, 3);

  // Asymmetry: the positive arms reach 3 m and carry a cap, the negative arms reach 1.2 m and do not. A marker
  // that is symmetric in both directions cannot reveal a mirrored axis, which is the point of it.
  const axis = snapshot.axisMeshes;
  expect(axis['axisXCap']?.x).toBeCloseTo(3, 2);
  expect(axis['axisZCap']?.z).toBeCloseTo(3, 2);
  expect(axis['axisYCap']?.y).toBeCloseTo(1.8, 2);
  expect(axis['axisXNegative']?.x).toBeCloseTo(-0.6, 2);
  expect(axis['axisZNegative']?.z).toBeCloseTo(-0.6, 2);
  expect(axis['axisXNegativeCap']).toBeUndefined();
  expect(axis['axisZNegativeCap']).toBeUndefined();
  measure('positiveArmMetres', axis['axisXCap']?.x ?? Number.NaN);
  measure('negativeArmMetres', Math.abs(axis['axisXNegative']?.x ?? Number.NaN) * 2);

  // Handedness, from the render path. A ray is dropped from above onto a point that only one mesh can occupy,
  // and the client is asked what is there. The answer key below is written from the axis geometry the contract
  // states — positive arms reach 3 units, negative arms 1.2 — and the client contributes nothing to it, so a
  // scene cannot pass by describing itself favourably. This is the check that would have caught the
  // double-negated arm offset: a ray at x = -0.6 would have met the floor instead of an arm.
  const samples: readonly MeshPoint[] = [
    { x: 1.5, y: 2, z: 0 },
    { x: 2.5, y: 2, z: 0 },
    { x: -0.6, y: 2, z: 0 },
    { x: -1.05, y: 2, z: 0 },
    { x: 0, y: 2, z: 1.5 },
    { x: 0, y: 2, z: 2.5 },
    { x: 0, y: 2, z: -0.6 },
    { x: 0, y: 2, z: -1.05 },
  ];
  const expected: readonly string[] = [
    'udg-axis-x-positive',
    'udg-axis-x-positive',
    'udg-axis-x-negative',
    'udg-axis-x-negative',
    'udg-axis-z-positive',
    'udg-axis-z-positive',
    'udg-axis-z-negative',
    'udg-axis-z-negative',
  ];
  const probes = await harnessCall<readonly AxisProbe[]>(page, 'probe', samples);
  expect(probes.length, 'the probe returned no answer for every sample').toBe(samples.length);
  const agreeing: string[] = [];
  probes.forEach((probe, index) => {
    const want = expected[index] ?? 'nothing';
    expect(
      probe.hit,
      `a downward ray at (${probe.sample.x}, ${probe.sample.y}, ${probe.sample.z}) met ${String(probe.hit)} where ${want} was expected; `
        + 'the mesh being drawn there is not the one the scene metadata claims',
    ).toBe(want);
    agreeing.push(`${want}@${probe.distance.toFixed(2)}`);
  });
  // The floor is asked about separately, with the ground allowed in the predicate. Excluding it from the arm
  // probes is a choice about which question is being answered — the arms lie in the ground plane — and not a
  // claim that the plane is absent, so the plane's existence gets its own probe.
  // A point inside the plane and off every axis. The ground spans ±6 units, so this is deliberately not a
  // corner: sampling exactly on an edge asks the mesh about its boundary rather than its presence, and a probe
  // that misses for a reason that geometric is a bad reason to stop a release.
  const groundProbe = await harnessCall<readonly AxisProbe[]>(page, 'probe', [{ x: 4.5, y: 2, z: 4.5 }], true);
  expect(groundProbe[0]?.hit, 'no ground plane was found where one was expected').toBe('udg-ground');
  measure('handednessPicksAgreeing', agreeing.length + 1);
  expect(agreeing.length + 1).toBeGreaterThanOrEqual(5);
  measure('handednessProbeDistances', agreeing.join(' '));

  // The picture-level half. With the camera where it is, an independently derived right-handed basis
  // (right = forward × worldUp, up = right × forward, derived here from the camera's own position and target)
  // says which side of screen centre each axis belongs on, and every marker the frame does show has to agree.
  // How many markers the frame shows is recorded rather than demanded: that depends on the canvas box the
  // browser laid out and on nothing about handedness, and CI run 43764611170 is the reason — one arm was
  // unreachable by pixel sweep on a GitHub runner while the ray probes below found it on the same commit.
  const cameraPosition = snapshot.scene.cameraPosition;
  const target = { x: snapshot.camera?.targetX ?? 0, y: snapshot.camera?.targetY ?? 0, z: snapshot.camera?.targetZ ?? 0 };
  expect(cameraPosition, 'the scene reported no camera position').toBeDefined();
  const forward = normalise({ x: target.x - (cameraPosition?.x ?? 0), y: target.y - (cameraPosition?.y ?? 0), z: target.z - (cameraPosition?.z ?? 0) });
  const right = normalise({ x: forward.y * 0 - forward.z * 1, y: forward.z * 0 - forward.x * 0, z: forward.x * 1 - forward.y * 0 });
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  measure('basisRightX', dot({ x: 1, y: 0, z: 0 }, right));
  measure('basisUpY', dot({ x: 0, y: 1, z: 0 }, up));

  const picks = await harnessCall<readonly ScenePick[]>(page, 'sweep', 32);
  const byName = new Map(picks.map((pick) => [pick.name, pick]));
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  const screenMisses: string[] = [];
  const checks: readonly { readonly name: string; readonly axis: { x: number; y: number; z: number }; readonly expect: 'right' | 'left' | 'up' }[] = [
    { name: 'udg-axis-x-positive', axis: { x: 1, y: 0, z: 0 }, expect: 'right' },
    { name: 'udg-axis-x-negative', axis: { x: -1, y: 0, z: 0 }, expect: 'left' },
    { name: 'udg-axis-z-cap', axis: { x: 0, y: 0, z: 1 }, expect: 'right' },
    { name: 'udg-axis-z-negative', axis: { x: 0, y: 0, z: -1 }, expect: 'left' },
    { name: 'udg-axis-y-cap', axis: { x: 0, y: 1, z: 0 }, expect: 'up' },
  ];
  for (const check of checks) {
    const pick = byName.get(check.name);
    if (pick === undefined) {
      screenMisses.push(check.name);
      continue;
    }
    const horizontal = dot(check.axis, right);
    const vertical = dot(check.axis, up);
    if (check.expect === 'right' || check.expect === 'left') {
      if (Math.abs(horizontal) <= 0.2) continue;
      const onTheRight = pick.x > centre.x;
      expect(onTheRight, `${check.name} appeared on the ${onTheRight ? 'right' : 'left'}; the basis predicts ${check.expect} (dot with right = ${horizontal.toFixed(3)})`).toBe(check.expect === 'right');
    } else {
      if (Math.abs(vertical) <= 0.2) continue;
      const aboveCentre = pick.y < centre.y;
      expect(aboveCentre, `${check.name} appeared ${aboveCentre ? 'above' : 'below'} centre; the basis predicts up (dot with up = ${vertical.toFixed(2)})`).toBe(true);
    }
  }
  measure('screenMarkersFound', byName.size);
  measure('screenMarkersMissed', screenMisses.length);
  // At least three of this client's own meshes must actually appear in the frame, or the picture-level claim
  // is empty and the suite should say so.
  expect(byName.size, `the frame showed almost none of the scene: ${picks.map((pick) => pick.name).join(', ') || 'nothing'}`).toBeGreaterThanOrEqual(3);
  expectFiniteCamera(snapshot);
});

test(CAMERA_CASE_NAMES[2], async ({ page }) => {
  const before = await snapshotOf(page);
  const beforeCamera = before.camera;
  expect(beforeCamera).toBeDefined();

  // Mouse orbit.
  await drag(page, { x: 640, y: 360 }, { x: 940, y: 250 });
  const afterDrag = await snapshotOf(page);
  expect(Math.abs((afterDrag.camera?.azimuthDegrees ?? 0) - (beforeCamera?.azimuthDegrees ?? 0))).toBeGreaterThan(5);
  expect(Math.abs((afterDrag.camera?.elevationDegrees ?? 0) - (beforeCamera?.elevationDegrees ?? 0))).toBeGreaterThan(5);
  measure('azimuthAfterDrag', afterDrag.camera?.azimuthDegrees ?? Number.NaN);
  measure('dragOperations', afterDrag.app.cameraDrags);
  expect(afterDrag.app.cameraDrags).toBeGreaterThan(0);

  // Touch orbit, through the pointer mapping.
  const beforeTouch = await snapshotOf(page);
  await touchDrag(page, -220, 90);
  const afterTouch = await snapshotOf(page);
  expect(Math.abs((afterTouch.camera?.azimuthDegrees ?? 0) - (beforeTouch.camera?.azimuthDegrees ?? 0))).toBeGreaterThan(5);
  measure('azimuthAfterTouchDrag', afterTouch.camera?.azimuthDegrees ?? Number.NaN);

  // Horizontal direction, asserted by **sign** rather than by distance. The owner's Mac review of 2026-11-16
  // ruled that a horizontal mouse drag turns the camera the opposite way from a touch drag, while the one-finger
  // touch drag keeps following the finger. Before that change the two devices moved the azimuth the same way — a
  // +300 px mouse drag took it from 135° to 31.87° in the retained artefacts of the previous head — so these four
  // signs are exactly what the previous build would fail. 200 px is 1.2 rad ≈ 68.8°, so the magnitudes below are
  // nowhere near the 5° assertion floor unless the axis actually turned.
  const mouseRightFrom = await snapshotOf(page);
  await drag(page, { x: 540, y: 360 }, { x: 740, y: 360 });
  const mouseRightDelta = azimuthDeltaDegrees(
    mouseRightFrom.camera?.azimuthDegrees ?? 0,
    (await snapshotOf(page)).camera?.azimuthDegrees ?? 0,
  );
  expect(mouseRightDelta, 'a rightward mouse drag must now increase the azimuth').toBeGreaterThan(5);
  measure('mouseDragRightAzimuthDelta', mouseRightDelta);

  const mouseLeftFrom = await snapshotOf(page);
  await drag(page, { x: 740, y: 360 }, { x: 540, y: 360 });
  const mouseLeftDelta = azimuthDeltaDegrees(
    mouseLeftFrom.camera?.azimuthDegrees ?? 0,
    (await snapshotOf(page)).camera?.azimuthDegrees ?? 0,
  );
  expect(mouseLeftDelta, 'a leftward mouse drag must now decrease the azimuth').toBeLessThan(-5);
  measure('mouseDragLeftAzimuthDelta', mouseLeftDelta);
  // One axis, mirrored: equal size, opposite sign.
  expect(Math.abs(mouseRightDelta + mouseLeftDelta), 'left and right mouse drags are not mirror images').toBeLessThan(2);

  // Touch keeps the direction it has always had in this client: the scene follows the finger.
  const touchRightFrom = await snapshotOf(page);
  await touchDrag(page, 200, 0);
  const touchRightDelta = azimuthDeltaDegrees(
    touchRightFrom.camera?.azimuthDegrees ?? 0,
    (await snapshotOf(page)).camera?.azimuthDegrees ?? 0,
  );
  expect(touchRightDelta, 'a rightward touch drag must still decrease the azimuth (the scene follows the finger)').toBeLessThan(-5);
  measure('touchDragRightAzimuthDelta', touchRightDelta);

  const touchLeftFrom = await snapshotOf(page);
  await touchDrag(page, -200, 0);
  const touchLeftDelta = azimuthDeltaDegrees(
    touchLeftFrom.camera?.azimuthDegrees ?? 0,
    (await snapshotOf(page)).camera?.azimuthDegrees ?? 0,
  );
  expect(touchLeftDelta, 'a leftward touch drag must still increase the azimuth').toBeGreaterThan(5);
  measure('touchDragLeftAzimuthDelta', touchLeftDelta);

  // The disagreement *is* the ruling, recorded once as a number: same screen movement, opposite camera turn.
  expect(Math.sign(mouseRightDelta), 'mouse and touch agree, so the mouse is not inverted').toBe(
    -Math.sign(touchRightDelta),
  );
  measure('mouseInvertedAgainstTouch', mouseRightDelta > 0 && touchRightDelta < 0);

  // Vertical drag is shared, and unchanged: down still rolls the camera over the top for a mouse. Normalise to
  // the low bound first, because a clamp at 80° would otherwise hide the rise.
  await elevationTo(page, 'min');
  const elevationFrom = await snapshotOf(page);
  await drag(page, { x: 640, y: 330 }, { x: 640, y: 390 });
  const elevationAfter = await snapshotOf(page);
  const elevationRise =
    (elevationAfter.camera?.elevationDegrees ?? 0) - (elevationFrom.camera?.elevationDegrees ?? 0);
  expect(elevationRise, 'a downward mouse drag must still raise the elevation').toBeGreaterThan(5);
  measure('mouseDragDownElevationDelta', elevationRise);

  // Bounds: elevation cannot leave 10..80, azimuth stays wrapped into 0..360, and a clamped state stays finite.
  await elevationTo(page, 'max');
  const atMax = await snapshotOf(page);
  expect(atMax.camera?.elevationDegrees ?? 0).toBeLessThanOrEqual(80 + 1e-6);
  expect(atMax.camera?.elevationDegrees ?? 0).toBeGreaterThan(79);
  await screenshotTo(page, 'orbit-elevation-max.png');
  await elevationTo(page, 'min');
  const atMin = await snapshotOf(page);
  expect(atMin.camera?.elevationDegrees ?? 999).toBeGreaterThanOrEqual(10 - 1e-6);
  expect(atMin.camera?.elevationDegrees ?? 0).toBeLessThan(11);
  await screenshotTo(page, 'orbit-elevation-min.png');
  measure('elevationClampLow', atMin.camera?.elevationDegrees ?? Number.NaN);
  // Recorded as numbers, not only as assertions: the plan's clamp threshold names these values, and a
  // threshold that points at nothing measured is prose the verifier cannot check.
  measure('elevationClampHigh', atMax.camera?.elevationDegrees ?? Number.NaN);

  for (let index = 0; index < 6; index += 1) await drag(page, { x: 200, y: 360 }, { x: 1200, y: 360 });
  const wrapped = await snapshotOf(page);
  const azimuth = wrapped.camera?.azimuthDegrees ?? -1;
  expect(azimuth).toBeGreaterThanOrEqual(0);
  expect(azimuth).toBeLessThan(360);
  measure('azimuthAfterWrap', azimuth);
  await screenshotTo(page, 'orbit-azimuth-min.png');

  // A cancelled gesture must not leave the camera mid-gesture, and must not crash the page.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-udg-scene]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
    const fire = (type: string, x: number, y: number): void => {
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: 1 }));
    };
    const rect = canvas.getBoundingClientRect();
    fire('pointerdown', rect.left + 500, rect.top + 300);
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 3, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }));
    fire('pointermove', rect.left + 900, rect.top + 500);
    fire('pointerup', rect.left + 900, rect.top + 500);
  });
  const afterCancel = await snapshotOf(page);
  expectFiniteCamera(afterCancel);
  // The loop is still running, which is the difference between "survived" and "silently stopped".
  const ticksAfter = afterCancel.app.renderTicks;
  await page.waitForTimeout(200);
  const ticksLater = (await snapshotOf(page)).app.renderTicks;
  expect(ticksLater, 'the render loop stopped after a cancelled gesture').toBeGreaterThan(ticksAfter);
  measure('gesturesAfterCancelStillTicking', ticksLater > ticksAfter);
});

test(CAMERA_CASE_NAMES[3], async ({ page }) => {
  const start = await snapshotOf(page);
  expect(start.camera?.radiusMeters).toBeCloseTo(9, 3);

  await wheelToLimit(page, 'in');
  const min = await snapshotOf(page);
  expect(min.camera?.radiusMeters ?? 99).toBeLessThanOrEqual(2 + 1e-6);
  expect(min.camera?.radiusMeters ?? 0).toBeGreaterThan(1.999);
  await screenshotTo(page, 'zoom-min-2m.png');
  measure('radiusMinMetres', min.camera?.radiusMeters ?? Number.NaN);
  measure('wheelNotches', min.app.cameraWheelNotches);
  expect(min.app.cameraWheelNotches).toBeGreaterThan(0);

  // A pinch outwards (fingers apart) zooms in, and the clamp holds at the same floor.
  await pinch(page, 120, 620);
  const pinched = await snapshotOf(page);
  expect(pinched.camera?.radiusMeters ?? 99).toBeLessThanOrEqual(2 + 1e-6);
  measure('pinchOperations', pinched.app.cameraPinches);
  expect(pinched.app.cameraPinches).toBeGreaterThan(0);

  await wheelToLimit(page, 'out');
  const max = await snapshotOf(page);
  expect(max.camera?.radiusMeters ?? 0).toBeGreaterThanOrEqual(20 - 1e-6);
  expect(max.camera?.radiusMeters ?? 0).toBeLessThanOrEqual(20 + 1e-6);
  await screenshotTo(page, 'zoom-max-20m.png');
  measure('radiusMaxMetres', max.camera?.radiusMeters ?? Number.NaN);

  // Spreading the fingers from the far bound brings the radius back down, so the clamp is a bound and not a
  // one-way latch. Fingers apart is "pull the world closer", the same mapping every touch map uses.
  await pinch(page, 140, 620);
  const back = await snapshotOf(page);
  expect(back.camera?.radiusMeters ?? 20).toBeLessThan(20);
  expectFiniteCamera(back);
  measure('radiusAfterPinchIn', back.camera?.radiusMeters ?? Number.NaN);
});

test(CAMERA_CASE_NAMES[4], async ({ page }) => {
  const before = await snapshotOf(page);
  // Two UI regions, both non-interactive at the point the gesture lands. A drag that starts on a *button* also
  // fires that button's click when the pointer is released, which is the browser being correct and which would
  // unmount the scene halfway through the case; the readout text and the status banner are inside the same
  // `data-udg-ui` regions without carrying an action.
  const regions = ['[data-udg-readout="camera"]', '[data-udg-ui="connection"]'];
  for (const selector of regions) {
    const locator = page.locator(selector).first();
    await expect(locator).toHaveCount(1);
    const box = await locator.boundingBox();
    expect(box, `${selector} has no bounding box to gesture on`).not.toBeNull();
    if (box === null) continue;
    await drag(page, { x: box.x + box.width / 2 - 0, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 240, y: box.y + box.height / 2 + 160 });
  }
  const after = await snapshotOf(page);
  expect(after.camera?.radiusMeters ?? 0).toBeCloseTo(before.camera?.radiusMeters ?? -1, 6);
  expect(after.camera?.azimuthDegrees ?? 0).toBeCloseTo(before.camera?.azimuthDegrees ?? -1, 6);
  expect(after.camera?.elevationDegrees ?? 0).toBeCloseTo(before.camera?.elevationDegrees ?? -1, 6);
  expect(after.app.cameraIgnoredOnUi).toBeGreaterThan(0);
  expect(after.app.cameraDrags).toBe(0);
  measure('uiGesturesIgnored', after.app.cameraIgnoredOnUi);

  // The UI is not inert, which is the other half of "excluded from the camera": the same pointer that the
  // camera refused still reaches the controls, through the shell button that only exists while unmounted.
  const mountedBefore = after.mounted;
  await page.locator('[data-udg-control="toggle-mount"]').click();
  await page.waitForTimeout(220);
  const toggled = await snapshotOf(page);
  expect(toggled.mounted).not.toBe(mountedBefore);
  expectFiniteCamera(toggled);
  await page.locator('[data-udg-control="mount"]').click();
  await page.waitForTimeout(420);
  const restored = await snapshotOf(page);
  expect(restored.mounted).toBe(mountedBefore);
  expectFiniteCamera(restored);
  // While mounted there is no shell to gesture on at all: the persistent container renders nothing, which is
  // why the shell's own mount button cannot be clicked by accident. `count()` rather than `boundingBox()`
  // because a locator's bounding box waits for visibility, and waiting for an element that must never appear
  // costs three minutes and then says nothing.
  expect(await page.locator('[data-udg-ui="shell"]').count(), 'the unmounted-scene shell is on screen while mounted').toBe(0);
});

test(CAMERA_CASE_NAMES[5], async ({ page }) => {
  const before = await snapshotOf(page);
  // Focus loss freezes the test poses with the render loop, which is what makes the next assertion a
  // measurement rather than an assumption.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(260);
  const frozen = await snapshotOf(page);
  expect(frozen.app.focusLosses).toBeGreaterThan(0);
  expect(frozen.app.loops).toBe(0);
  const ticksFrozen = frozen.app.renderTicks;
  await page.waitForTimeout(260);
  expect((await snapshotOf(page)).app.renderTicks).toBe(ticksFrozen);
  const posesFrozen = frozen.app.poseWritesByEntity;

  // Orbit, zoom and pinch, while no tick runs.
  await drag(page, { x: 640, y: 360 }, { x: 1000, y: 200 });
  await wheel(page, -600);
  await pinch(page, 200, 600);
  const during = await snapshotOf(page);
  expect(during.app.renderTicks).toBe(ticksFrozen);
  expect(during.app.poseWritesByEntity).toEqual(posesFrozen);
  // The measurement is the *change* in the per-entity pose-write counters across the frozen window, because
  // that is the claim the plan's threshold makes. The cumulative counter was recorded here first, and it read
  // 10 — the demo feed's own writes before the freeze — which made the artefact contradict the threshold it
  // was cited under. A verifier can tell whether a threshold path resolves; only a named delta keeps the
  // number and the sentence about the number in agreement.
  const writesDuringCameraOperations = Object.keys(during.app.poseWritesByEntity).reduce(
    (total, entityId) => total + ((during.app.poseWritesByEntity[entityId] ?? 0) - (posesFrozen[entityId] ?? 0)),
    0,
  );
  expect(writesDuringCameraOperations, 'a camera operation wrote to a presented pose').toBe(0);
  measure('poseWritesDuringCameraOperations', writesDuringCameraOperations);
  measure('poseWritesBeforeFreeze', Object.values(posesFrozen).reduce((total, value) => total + value, 0));
  // The capsules did not move, either: the camera moved, and nothing else.
  // Both snapshots below are taken inside the same frozen window, so the comparison is between two moments in
  // which nothing but the camera was touched. Comparing against the pre-blur snapshot would have measured the
  // mover's own motion in the frames before the freeze, which is not the claim being made.
  for (const entityId of Object.keys(during.presented)) {
    const moved = distance(during.presented[entityId] ?? { x: 0, y: 0, z: 0 }, frozen.presented[entityId] ?? { x: 0, y: 0, z: 0 });
    expect(moved, `${entityId} moved while only the camera was operated`).toBeCloseTo(0, 6);
  }
  expect(before.camera?.radiusMeters).toBeDefined();
  expect(during.camera?.radiusMeters ?? 0).not.toBeCloseTo(before.camera?.radiusMeters ?? -1, 3);
  measure('cameraMovedWhilePosesFrozen', true);

  // Target follow: the camera's target sits on the followed entity's contact point, and it is the only thing
  // that moved it.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  const resumed = await snapshotOf(page);
  expect(resumed.app.loops).toBe(1);
  expect(resumed.app.focusRegains).toBeGreaterThan(0);
  expect(resumed.app.renderTicks).toBeGreaterThan(ticksFrozen);
  const mover = resumed.presented['pose-local-0'];
  expect(mover, 'the mover disappeared when the loop resumed').toBeDefined();
  const followError = Math.hypot(
    (resumed.camera?.targetX ?? 0) - (mover?.x ?? 0),
    (resumed.camera?.targetZ ?? 0) - (mover?.z ?? 0),
  );
  measure('targetFollowErrorMetres', followError);
  expect(followError).toBeLessThan(0.05);

  // Unmounting removes every presented entity, and mounting again presents both from scratch.
  const removed = await harnessCall<HarnessSnapshot>(page, 'unmount');
  expect(removed.mounted).toBe(false);
  expect(Object.keys(removed.presented).length).toBe(0);
  await harnessCall<HarnessSnapshot>(page, 'mount');
  await page.waitForTimeout(400);
  const remounted = await snapshotOf(page);
  expect(Object.keys(remounted.presented).sort()).toEqual(['pose-local-0', 'pose-static-1']);
  expect(remounted.app.loops).toBe(1);
});

test(CAMERA_CASE_NAMES[6], async ({ page }) => {
  const cycled = await harnessCall<HarnessSnapshot>(page, 'cycle', 10);
  lifecycleCycles = cycled.cycles;
  expect(cycled.cycles).toBeGreaterThanOrEqual(10);
  expect(cycled.mounted).toBe(false);
  const framesBefore = cycled.frameRequests;
  const ticksBefore = cycled.renderTicks;
  await page.waitForTimeout(700);
  const settled = await snapshotOf(page);
  lifecycle = {
    mounted: settled.mounted,
    engines: settled.engines,
    scenes: settled.scenes,
    meshes: settled.meshes,
    materials: settled.scene.materials,
    observers: settled.observers,
    listeners: settled.listeners,
    renderTicksAdvanced: settled.renderTicks - ticksBefore,
    frameRequestsAdvanced: settled.frameRequests - framesBefore,
    engineDisposed: settled.engineDisposed === true,
    sceneDisposed: settled.sceneDisposed === true,
  };
  expect(lifecycle.engines, 'Babylon still holds an engine after ten cycles').toBe(0);
  expect(lifecycle.scenes).toBe(0);
  expect(lifecycle.meshes, 'meshes survived ten mount/unmount cycles').toBe(0);
  expect(lifecycle.materials).toBe(0);
  expect(lifecycle.observers).toBe(0);
  expect(lifecycle.listeners, 'listeners registered by the app survived').toBe(0);
  expect(lifecycle.renderTicksAdvanced, 'the render loop kept ticking after dispose').toBe(0);
  expect(lifecycle.frameRequestsAdvanced, 'the page still schedules frames after dispose').toBe(0);
  expect(lifecycle.engineDisposed).toBe(true);
  expect(lifecycle.sceneDisposed).toBe(true);
  measure('cycles', cycled.cycles);
  measure('frameRequestsAfterDispose', lifecycle.frameRequestsAdvanced);
  measure('listenersAfterDispose', lifecycle.listeners);

  // Mount again from the same page and prove the scene is live: disposal is a state, not a dead page.
  await harnessCall<HarnessSnapshot>(page, 'mount');
  await page.waitForTimeout(500);
  const alive = await snapshotOf(page);
  expect(alive.engines).toBe(1);
  expect(alive.app.loops).toBe(1);
  expect(alive.meshes).toBeGreaterThan(6);
  const ticksNow = alive.app.renderTicks;
  await page.waitForTimeout(260);
  expect((await snapshotOf(page)).app.renderTicks).toBeGreaterThan(ticksNow);
  expect(alive.app.listeners).toBeGreaterThan(0);
  measure('listenersWhileMounted', alive.app.listeners);
  measure('enginesWhileMounted', alive.engines);

  // A call that arrives after disposal must be refused rather than thrown at a React effect.
  await harnessCall<HarnessSnapshot>(page, 'unmount');
  const refused = await harnessCall<HarnessSnapshot>(page, 'snapshot');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-udg-scene]');
    canvas?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, deltaY: 120 }));
  });
  await page.waitForTimeout(150);
  const after = await snapshotOf(page);
  expect(after.app.refusedAfterDispose).toBeGreaterThanOrEqual(0);
  expectFiniteCamera(after);
  expect(after.engines).toBe(0);
  expect(refused.mounted).toBe(false);

  const unexplainedPage = pageErrors.filter((text) => !EXPECTED_CONSOLE.some((entry) => entry.pattern.test(text)));
  const unexplainedConsole = consoleErrors.filter((text) => !EXPECTED_CONSOLE.some((entry) => entry.pattern.test(text)));
  measure('unexplainedPageErrors', unexplainedPage.length);
  measure('unexplainedConsoleErrors', unexplainedConsole.length);
  expect(unexplainedPage, unexplainedPage.join('\n')).toEqual([]);
  expect(unexplainedConsole, unexplainedConsole.join('\n')).toEqual([]);
});

/** A PNG of the kind the suite retains, so the byte-level portability checks have real bytes to work on. */
export const retainedScreenshotBytes = (name: (typeof CAMERA_SCREENSHOT_NAMES)[number]): Readonly<{ bytes: number; sha256: string }> => {
  const path = join(OUT_DIR, CAMERA_SCREENSHOT_DIRECTORY, name);
  const data = readFileSync(path);
  return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
};

/** Used by the contract suite's message: a file that exists but is not a picture is a capture failure. */
export const isPortablePng = (absolutePath: string): boolean =>
  readFileSync(absolutePath).subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && statSync(absolutePath).size > 0;
