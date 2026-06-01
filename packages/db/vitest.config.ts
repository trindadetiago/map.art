import { defineConfig } from 'vitest/config';

// Integration tests that hit an ISOLATED `<devdb>_test` database on the local
// Postgres — never the dev database. `_global-setup` creates + migrates it
// once; `_setup` repoints DATABASE_URL per worker before @mapart/env loads. The
// suite then wipes tiles + projects between tests against that throwaway DB.
// Run with the db container up.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/_global-setup.ts'],
    setupFiles: ['./test/_setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One DB, shared state — never run test files in parallel against it.
    fileParallelism: false,
  },
});
