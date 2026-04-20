import { resolve } from 'node:path';
import { findRepoRoot } from '@mapart/env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb, getSql } from './client';

/** Applies all pending migrations from packages/db/drizzle. Ensures PostGIS is enabled first. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(findRepoRoot(), 'packages/db/drizzle');
  const sql = getSql();
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS postgis');
  await migrate(getDb(), { migrationsFolder });
}

/** Drops all tables, enums, and extensions created by our schema. Dev-only nuke button. */
export async function resetSchema(): Promise<void> {
  const sql = getSql();
  await sql.unsafe(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO jp;
    GRANT ALL ON SCHEMA public TO public;
  `);
}
