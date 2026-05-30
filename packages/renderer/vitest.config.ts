import { defineConfig } from 'vitest/config';

// Pure unit tests for the renderer's grid/pose math. No DB, no browser — the
// test imports only ./src/params (which depends on @mapart/geo, not Scene).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
