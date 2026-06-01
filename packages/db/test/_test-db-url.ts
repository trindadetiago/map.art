import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test-DB plumbing, kept free of any `@mapart/env` import — importing that
 * builds (and caches) `env` from the current process.env, which would lock in
 * the dev DATABASE_URL before the setup file can override it. We read `.env`
 * directly instead.
 */

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root not found');
}

/** The dev DATABASE_URL straight from the root .env (the source of truth). */
function devDatabaseUrl(): string {
  const envPath = resolve(repoRoot(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq !== -1 && t.slice(0, eq).trim() === 'DATABASE_URL') {
        return t
          .slice(eq + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');
      }
    }
  }
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  throw new Error('DATABASE_URL not found in .env or process.env');
}

export interface TestDbTarget {
  /** Connection URL for the isolated test database (`<devdb>_test`). */
  url: string;
  /** The test database name. */
  dbName: string;
  /** URL pointed at the dev database — used to issue CREATE DATABASE. */
  adminUrl: string;
}

/** Derive an isolated `<devdb>_test` database on the same (local) server. */
export function testDbTarget(): TestDbTarget {
  const dev = devDatabaseUrl();
  const u = new URL(dev);
  if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) {
    throw new Error(`refusing to derive a test DB from non-local host: ${u.hostname}`);
  }
  const devDb = u.pathname.replace(/^\//, '') || 'postgres';
  const dbName = `${devDb}_test`;

  const testUrl = new URL(dev);
  testUrl.pathname = `/${dbName}`;
  const adminUrl = new URL(dev);
  adminUrl.pathname = `/${devDb}`;

  return { url: testUrl.toString(), dbName, adminUrl: adminUrl.toString() };
}
