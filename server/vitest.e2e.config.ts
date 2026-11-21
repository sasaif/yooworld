// End-to-end: real `wrangler dev --local` (workerd + Durable Objects) against the private local Postgres.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    globalSetup: ['test/e2e/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/e2e-results.json' },
  },
});
