import { sql } from 'drizzle-orm';
import { getDb } from '../client';
import { projects, tiles } from '../schema/index';

export interface TableCounts {
  projects: number;
  tiles: number;
}

export async function getTableCounts(): Promise<TableCounts> {
  const db = getDb();
  const count = sql<number>`count(*)::int`;
  const [p] = await db.select({ c: count }).from(projects);
  const [t] = await db.select({ c: count }).from(tiles);
  return { projects: p?.c ?? 0, tiles: t?.c ?? 0 };
}

export interface PostgresInfo {
  version: string;
}

export async function getPostgresInfo(): Promise<PostgresInfo> {
  const db = getDb();
  const versionRow = await db.execute<{ version: string }>(sql`SELECT version() as version`);
  return { version: versionRow[0]?.version ?? 'unknown' };
}
