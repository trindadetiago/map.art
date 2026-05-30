import { defineConfig } from 'vitest/config';

// Integration tests that hit the local dev Postgres. The claim repos are
// global (not project-scoped), so the suite owns the queue: it wipes tiles +
// projects between tests behind a localhost-only guard. Run with `pnpm dev`
// (or at least the db container) up, and migrations applied.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One DB, shared state — never run test files in parallel against it.
    fileParallelism: false,
  },
});
