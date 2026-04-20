import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { tiles } from '../schema/tiles';

export async function countTilesForProject(projectId: string): Promise<number> {
  const rows = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(tiles)
    .where(eq(tiles.projectId, projectId));
  return rows[0]?.c ?? 0;
}

export async function listTilesForProject(
  projectId: string,
  limit = 5000,
): Promise<{ col: number; row: number }[]> {
  return getDb()
    .select({ col: tiles.col, row: tiles.row })
    .from(tiles)
    .where(eq(tiles.projectId, projectId))
    .limit(limit);
}

export async function getTile(
  projectId: string,
  col: number,
  row: number,
): Promise<{ col: number; row: number } | undefined> {
  const rows = await getDb()
    .select({ col: tiles.col, row: tiles.row })
    .from(tiles)
    .where(and(eq(tiles.projectId, projectId), eq(tiles.col, col), eq(tiles.row, row)))
    .limit(1);
  return rows[0];
}
