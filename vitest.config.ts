import { defineConfig } from 'vitest/config';

/**
 * Root test configuration (UDG-001).
 *
 * `pnpm test` must never pass on zero discovered tests, so passWithNoTests stays false and the
 * include list only matches real suites. Browser and spike suites are excluded here; they are
 * dispatched by their own commands and must fail clearly until their owning task creates them.
 *
 * Evidence capture sets UDG_EVIDENCE_JUNIT to collect junit.xml without changing what a normal
 * local `pnpm test` writes to disk.
 */
const junitOutput = process.env['UDG_EVIDENCE_JUNIT'];

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/fixtures/**',
      'tests/e2e/**',
      'tests/spikes/**',
      'artifacts/**',
    ],
    globals: false,
    passWithNoTests: false,
    // Suites spawn installs, compilers and checkers; serial execution keeps store access and
    // evidence ordering deterministic.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    ...(junitOutput === undefined
      ? { reporters: ['default'] }
      : { reporters: ['default', 'junit'], outputFile: { junit: junitOutput } }),
  },
});
