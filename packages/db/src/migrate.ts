import { resolve } from 'node:path';
import { findRepoRoot } from '@mapart/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb, getSql } from './client';

/** Applies all pending migrations from packages/db/drizzle. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(findRepoRoot(), 'packages/db/drizzle');
  await migrate(getDb(), { migrationsFolder });
}

/** Drops all tables/enums in `public` plus Drizzle's migration journal. Dev-only
 * nuke button. The journal lives in a separate `drizzle` schema, so it must be
 * dropped too — otherwise a subsequent migrate sees the journal, thinks every
 * migration is already applied, and skips recreating the tables. */
export async function resetSchema(): Promise<void> {
  const sql = getSql();
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO jp;
    GRANT ALL ON SCHEMA public TO public;
  `);
}
