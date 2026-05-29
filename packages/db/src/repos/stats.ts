import { sql } from 'drizzle-orm';
import { getDb } from '../client';
import { jobs, projects, tiles } from '../schema/index';

export interface TableCounts {
  projects: number;
  tiles: number;
  jobs: number;
}

export async function getTableCounts(): Promise<TableCounts> {
  const db = getDb();
  const countOf = async (tbl: typeof projects | typeof tiles | typeof jobs) => {
    const rows = await db.select({ c: sql<number>`count(*)::int` }).from(tbl);
    return rows[0]?.c ?? 0;
  };
  const [p, t, j] = await Promise.all([countOf(projects), countOf(tiles), countOf(jobs)]);
  return { projects: p, tiles: t, jobs: j };
}

export interface PostgresInfo {
  version: string;
  postgisVersion: string | null;
}

export async function getPostgresInfo(): Promise<PostgresInfo> {
  const db = getDb();
  const versionRow = await db.execute<{ version: string }>(sql`SELECT version() as version`);
  const version = versionRow[0]?.version ?? 'unknown';

  let postgisVersion: string | null = null;
  try {
    const pgRow = await db.execute<{ v: string }>(sql`SELECT postgis_version() as v`);
    postgisVersion = pgRow[0]?.v ?? null;
  } catch {
    postgisVersion = null;
  }

  return { version, postgisVersion };
}
