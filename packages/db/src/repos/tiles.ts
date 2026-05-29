import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { type NewTile, type Tile, tiles } from '../schema/tiles';

export async function countTilesForProject(projectId: string): Promise<number> {
  const rows = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(tiles)
    .where(eq(tiles.projectId, projectId));
  return rows[0]?.c ?? 0;
}

export async function listTilesForProject(projectId: string, limit = 5000): Promise<Tile[]> {
  return getDb()
    .select()
    .from(tiles)
    .where(eq(tiles.projectId, projectId))
    .orderBy(asc(tiles.createdAt))
    .limit(limit);
}

export async function getTileById(id: string): Promise<Tile | undefined> {
  const rows = await getDb().select().from(tiles).where(eq(tiles.id, id)).limit(1);
  return rows[0];
}

/** Append a tile row. Render jobs set renderedImgPath; stylize jobs carry the
 * source render inline and set stylizedImgPath. */
export async function createTile(input: NewTile): Promise<Tile> {
  const [row] = await getDb().insert(tiles).values(input).returning();
  if (!row) throw new Error('createTile: insert returned no row');
  return row;
}
