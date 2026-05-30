import { and, asc, eq, or, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { type Tile, type TilePhase, type TileStatus, tiles } from '../schema/tiles';

/** Retry budget per phase. The 4th failure (attempt already at MAX_RETRIES) is terminal. */
export const MAX_RETRIES = 3;

// ---- reads (web) ---------------------------------------------------------

export async function tilesByProject(projectId: string): Promise<Tile[]> {
  return getDb()
    .select()
    .from(tiles)
    .where(eq(tiles.projectId, projectId))
    .orderBy(asc(tiles.y), asc(tiles.x));
}

export interface TileStatusCount {
  currentStatusType: TilePhase;
  status: TileStatus;
  count: number;
}

/** Progress ("42 of 900 done") is a `group by` over tiles — never stored, never stale. */
export async function tileStatusCounts(projectId: string): Promise<TileStatusCount[]> {
  return getDb()
    .select({
      currentStatusType: tiles.currentStatusType,
      status: tiles.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tiles)
    .where(eq(tiles.projectId, projectId))
    .groupBy(tiles.currentStatusType, tiles.status);
}

// ---- grid creation (web) -------------------------------------------------

export interface TileCell {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

/**
 * Insert one tiles row per grid cell, then back-fill each tile's `neighbors`
 * with the ids of its (≤8) present grid-adjacent cells. Two passes in one
 * transaction — ids don't exist until the rows are inserted.
 *
 * Cells come from @mapart/geo (area → grid). Adjacency here is plain ±1 grid
 * stepping; no geometry lives in this package.
 */
export async function createProjectTiles(
  projectId: string,
  cells: readonly TileCell[],
): Promise<Tile[]> {
  if (cells.length === 0) return [];
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(tiles)
      .values(cells.map((c) => ({ projectId, x: c.x, y: c.y, lat: c.lat, lng: c.lng })))
      .returning();

    const idByCell = new Map(inserted.map((t) => [`${t.x}:${t.y}`, t.id]));
    for (const t of inserted) {
      const neighbors: string[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const id = idByCell.get(`${t.x + dx}:${t.y + dy}`);
          if (id) neighbors.push(id);
        }
      }
      if (neighbors.length > 0) {
        await tx.update(tiles).set({ neighbors }).where(eq(tiles.id, t.id));
        t.neighbors = neighbors; // keep the returned row in sync with the back-fill
      }
    }
    return inserted;
  });
}

// ---- queue: render phase (worker-render) ---------------------------------

/**
 * Atomically claim the next pending render tile: SELECT … FOR UPDATE SKIP
 * LOCKED, flip to `progress`, commit. The lock is held only for this tiny
 * transaction — the render itself happens after, outside any txn.
 */
export async function claimNextRender(): Promise<Tile | null> {
  return getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .select({ id: tiles.id })
      .from(tiles)
      .where(and(eq(tiles.currentStatusType, 'render'), eq(tiles.status, 'pending')))
      .orderBy(asc(tiles.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!claimed) return null;
    const [row] = await tx
      .update(tiles)
      .set({ status: 'progress', updatedAt: new Date() })
      .where(eq(tiles.id, claimed.id))
      .returning();
    return row ?? null;
  });
}

export async function completeRender(id: string, renderedImgPath: string): Promise<void> {
  await getDb()
    .update(tiles)
    .set({ renderedImgPath, status: 'done', updatedAt: new Date() })
    .where(eq(tiles.id, id));
}

// ---- queue: stylize phase (worker-stylize) -------------------------------

/**
 * Claim the next tile to stylize, lowest id first. Two entry paths:
 *   1. a render-done tile whose neighbors have ALL rendered → promote it into
 *      the stylize phase (resets retry_attempt; retries are per phase).
 *   2. a stylize tile that failed back to pending → re-claim it, keeping its
 *      retry_attempt so the budget still counts down.
 *
 * Neighbor readiness keys on `rendered_img_path IS NOT NULL`, never on the
 * phase column — a stylized neighbor still has its rendered path, so the check
 * stays true and tiles never starve.
 */
export async function claimNextStylize(): Promise<Tile | null> {
  return getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .select({ id: tiles.id, currentStatusType: tiles.currentStatusType })
      .from(tiles)
      .where(
        or(
          and(
            eq(tiles.currentStatusType, 'render'),
            eq(tiles.status, 'done'),
            sql`not exists (
              select 1 from ${tiles} n
              where n.id = any(${tiles.neighbors}) and n.rendered_img_path is null
            )`,
          ),
          and(eq(tiles.currentStatusType, 'stylize'), eq(tiles.status, 'pending')),
        ),
      )
      .orderBy(asc(tiles.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!claimed) return null;

    const promoting = claimed.currentStatusType === 'render';
    const [row] = await tx
      .update(tiles)
      .set({
        currentStatusType: 'stylize',
        status: 'progress',
        updatedAt: new Date(),
        ...(promoting ? { retryAttempt: 0 } : {}),
      })
      .where(eq(tiles.id, claimed.id))
      .returning();
    return row ?? null;
  });
}

export async function completeStylize(id: string, stylizedImgPath: string): Promise<void> {
  await getDb()
    .update(tiles)
    .set({ stylizedImgPath, status: 'done', updatedAt: new Date() })
    .where(eq(tiles.id, id));
}

// ---- queue: failure handling (both workers) ------------------------------

/**
 * Record a failed attempt in the tile's current phase: bump retry_attempt and
 * drop back to `pending` for re-claim — unless the budget is spent (attempt
 * already at MAX_RETRIES), in which case the tile goes to `error`. Returns the
 * resulting status. The CASE reads the pre-update retry_attempt.
 */
export async function failOrRetry(id: string): Promise<TileStatus> {
  const [row] = await getDb()
    .update(tiles)
    .set({
      retryAttempt: sql`${tiles.retryAttempt} + 1`,
      status: sql`case when ${tiles.retryAttempt} >= ${MAX_RETRIES} then 'error' else 'pending' end`,
      updatedAt: new Date(),
    })
    .where(eq(tiles.id, id))
    .returning({ status: tiles.status });
  if (!row) throw new Error(`failOrRetry: no tile with id ${id}`);
  return row.status;
}
