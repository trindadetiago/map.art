import { sql } from 'drizzle-orm';
import { getDb } from '../client';
import { projects } from '../schema/index';

export interface TableCounts {
  projects: number;
}

export async function getTableCounts(): Promise<TableCounts> {
  const db = getDb();
  const rows = await db.select({ c: sql<number>`count(*)::int` }).from(projects);
  return { projects: rows[0]?.c ?? 0 };
}

export interface PostgresInfo {
  version: string;
}

export async function getPostgresInfo(): Promise<PostgresInfo> {
  const db = getDb();
  const versionRow = await db.execute<{ version: string }>(sql`SELECT version() as version`);
  return { version: versionRow[0]?.version ?? 'unknown' };
}
