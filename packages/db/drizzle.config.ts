import '@mapart/env';
import { requireEnv } from '@mapart/env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: requireEnv('databaseUrl'),
  },
  strict: true,
  verbose: true,
});
