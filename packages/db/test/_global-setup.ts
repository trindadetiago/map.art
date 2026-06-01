import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { testDbTarget } from './_test-db-url';

/**
 * Runs once before the suite: create the isolated `<devdb>_test` database (if
 * missing) and apply migrations to it. Tests then wipe/insert freely there,
 * never touching the dev database.
 */
export default async function setup(): Promise<void> {
  const { url, dbName, adminUrl } = testDbTarget();

  const admin = postgres(adminUrl, { prepare: false, max: 1 });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (existing.length === 0) {
      await admin.unsafe(`create database "${dbName}"`); // not allowed inside a txn
    }
  } finally {
    await admin.end();
  }

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
