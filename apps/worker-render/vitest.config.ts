import { defineConfig } from 'vitest/config';

// End-to-end test of the render-queue consumer. Hits the local dev Postgres
// (real claim/complete/fail SQL) with an in-memory storage backend and a stub
// renderer — no Chromium, no network. The suite owns the queue, so it wipes
// tiles + projects between tests behind a localhost-only guard.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
