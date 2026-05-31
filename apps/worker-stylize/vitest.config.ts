import { defineConfig } from 'vitest/config';

// End-to-end test of the stylize-queue consumer against the local dev Postgres
// with an in-memory storage backend and a stub model — no GPU, no network. The
// suite owns the queue, wiping tiles + projects between tests behind a
// localhost-only guard.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
