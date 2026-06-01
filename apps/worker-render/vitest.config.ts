import { defineConfig } from 'vitest/config';

// End-to-end test of the render-queue consumer (real claim/complete/fail SQL)
// against an ISOLATED `<devdb>_test` database (never the dev DB), with an
// in-memory storage backend and a stub renderer — no Chromium, no network.
// Reuses @mapart/db's setup: `_global-setup` creates + migrates the test DB
// once; `_setup` repoints DATABASE_URL per worker before @mapart/env loads, so
// the suite's tiles/projects wipes never touch dev data.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['../../packages/db/test/_global-setup.ts'],
    setupFiles: ['../../packages/db/test/_setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
