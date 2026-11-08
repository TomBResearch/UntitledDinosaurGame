import { defineConfig, devices } from '@playwright/test';

/**
 * Browser test configuration authored by UDG-001.
 *
 * The suites themselves belong to later tasks: tests/e2e/camera.spec.ts (UDG-004), netcode
 * (UDG-SPIKE-001), physics (UDG-006), input (UDG-008) and hybrid (UDG-SPIKE-003). Until then
 * `pnpm test:e2e` is answered by the dispatcher with an attributed refusal, and no browser suite
 * here can report a vacuous pass.
 *
 * Browser binaries are not installed by UDG-001. UDG-004 installs the pinned browser with
 * `pnpm exec playwright install chromium` and records it in its own evidence.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'artifacts/.local/playwright-junit.xml' }],
    ['json', { outputFile: 'artifacts/.local/playwright-results.json' }],
  ],
  use: {
    baseURL: process.env['UDG_CLIENT_URL'] ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
