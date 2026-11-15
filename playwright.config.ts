import { join } from 'node:path';

import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * Browser test configuration authored by UDG-001 and populated for the camera suite by UDG-004.
 *
 * ## How a browser suite is reached at all
 *
 * `pnpm test:e2e -- --suite <name>` is dispatched by `tools/checks/src/dispatch.ts`, which is the only route to
 * Playwright: the guard refuses an unimplemented suite, an unknown suite and a missing `--suite`, and dispatches
 * the one suite that exists. Nothing in this repository invokes `playwright test` directly, so no caller can
 * reach a browser around that guard.
 *
 * ## Suites and their owners
 *
 * `tests/e2e/camera.spec.ts` is UDG-004's and is the only one that exists today. `netcode` (UDG-SPIKE-001),
 * `physics` (UDG-006), `input` (UDG-008) and `hybrid` (UDG-SPIKE-003) remain owed, and the dispatcher says so
 * with the owning task named — a missing suite is never reported as a pass. `tools/checks/src/support.ts`
 * `E2E_SUITES` is the single list of that ownership, and
 * `tests/contracts/UDG-004.test.ts` proves every case.
 *
 * ## Browsers
 *
 * The pinned browser is Playwright 1.65.0's chromium (build 1254), installed with
 * `pnpm exec playwright install chromium`; CI installs it in its own step and the UDG-004 camera step depends
 * on it. A container that ships the browsers read-only under `PLAYWRIGHT_BROWSERS_PATH` must not run the
 * install — it fails on a `mkdir` of the lock directory and the browsers are already there. The browser version
 * and build are recorded inside `camera-browser-results.json`, which is the artefact a reviewer reads to know
 * what actually ran.
 *
 * ## Serial, un-retried, one project
 *
 * `workers: 1`, `retries: 0`, `fullyParallel: false` and a single chromium project are UDG-001's decisions and
 * stay. A camera case that is flaky blocks acceptance instead of being re-run into greenness
 * (docs/contracts/assignments/UDG-004.md §9 M-7), and the evidence bundle has one JUnit report to carry, not
 * several to reconcile.
 */

/** Where this run writes its reports. Evidence capture points this at the bundle. */
const outputDirectory = process.env['UDG_E2E_OUT'] ?? 'artifacts/.local';

/** The client under test. Inside a container or a CI job this is loopback in that environment's namespace. */
const clientUrl = process.env['UDG_CLIENT_URL'] ?? 'http://127.0.0.1:5173';

const clientPort = process.env['UDG_CLIENT_PORT'] ?? '5173';

/**
 * Reporters for this run.
 *
 * `UDG_E2E_JUNIT=none` turns the JUnit reporter off, and evidence capture uses it: an acceptance bundle carries
 * **one** JUnit report — the one `pnpm test` writes — and the browser result gates that report transitively
 * through the UDG-004 contract suite instead of adding a second file a reader has to reconcile. A local run
 * keeps its own JUnit, because a developer wants the file.
 */
const reporters = (): ReporterDescription[] => {
  const junit = process.env['UDG_E2E_JUNIT'];
  const results = process.env['UDG_E2E_RESULTS'];
  const list: ReporterDescription[] = [['list']];
  if (junit !== 'none') list.push(['junit', { outputFile: junit ?? join(outputDirectory, 'playwright-junit.xml') }]);
  if (results !== 'none') list.push(['json', { outputFile: results ?? join(outputDirectory, 'playwright-results.json') }]);
  return list;
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Screenshots and traces from failures land under the same directory as the reports, so one `rm -rf` of the
  // scratch directory clears a local run and nothing from a captured bundle is ever reused as an output path.
  outputDir: join(outputDirectory, 'playwright-output'),
  reporter: reporters(),
  use: {
    baseURL: clientUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  /**
   * The development server, started and stopped by Playwright.
   *
   * It runs `pnpm dev`, which binds `127.0.0.1` by default: `UDG_DEV_HOST` is unset here on purpose, because
   * the runner and the server share one network namespace and the suite connects over loopback. The Mac preview
   * route in docs/contracts/assignments/UDG-004.md §7 is a human affordance and is never what this connects to
   * — pointing the runner at a published host port would test the port mapping instead of the client.
   *
   * `reuseExistingServer` is off on CI, where a leftover server would hide a startup failure, and on locally,
   * where a developer's own `pnpm dev` is exactly the server they want tested.
   */
  webServer: {
    command: 'pnpm dev',
    url: clientUrl,
    timeout: 120_000,
    reuseExistingServer: process.env['CI'] === undefined,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { UDG_CLIENT_PORT: clientPort },
  },
});
