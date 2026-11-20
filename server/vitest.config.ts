import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**'],
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false,          // suites share one local Postgres; attacks are parallel INSIDE a test
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/results.json' },
    coverage: { provider: 'v8', include: ['src/**', '../shared/**'], reporter: ['text-summary', 'json-summary'], reportsDirectory: 'test-results/coverage' },
  },
});
