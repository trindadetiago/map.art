import { resolve } from 'node:path';
import { findRepoRoot } from '@mapart/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb, getSql } from './client';

/**
 * Arbitrary constant. Advisory locks share one namespace per database, so the
 * only requirement is that nothing else in the system picks the same number.
 */
const MIGRATION_LOCK = 8_170_423;

/**
 * Applies all pending migrations from packages/db/drizzle.
 *
 * Drizzle reads its journal *outside* the transaction it then applies in, so
 * two runs overlapping — a deploy landing while someone migrates by hand — both
 * see the same migration as pending, and the loser fails on already-applied
 * DDL. An advisory lock serializes them: the second waits, then finds nothing
 * left to apply. The lock is session-scoped, so it has to be taken and released
 * on one reserved connection rather than off the pool.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(findRepoRoot(), 'packages/db/drizzle');
  const lock = await getSql().reserve();
  try {
    await lock`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
    await migrate(getDb(), { migrationsFolder });
  } finally {
    await lock`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
    lock.release();
  }
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
