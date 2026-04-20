import { requireEnv } from '@mapart/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbClient: ReturnType<typeof drizzle<typeof schema>> | null = null;

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Returns the process-wide Drizzle instance. Lazily constructs on first call. */
export function getDb(): Db {
  if (!dbClient) {
    const url = requireEnv('databaseUrl');
    sqlClient = postgres(url, { prepare: false });
    dbClient = drizzle(sqlClient, { schema });
  }
  return dbClient;
}

/** Closes the underlying postgres connection. Call on process shutdown for long-lived tools. */
export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
    dbClient = null;
  }
}

/** Raw postgres client (for migrations + ad-hoc SQL). Constructs lazily alongside the Drizzle instance. */
export function getSql(): ReturnType<typeof postgres> {
  if (!sqlClient) getDb();
  if (!sqlClient) throw new Error('postgres client not initialized');
  return sqlClient;
}
