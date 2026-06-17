import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
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

/** Fetch tiles by id — resolves a tile's `neighbors` (uuid[]) into rows. Read-only. */
export async function tilesByIds(ids: readonly string[]): Promise<Tile[]> {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(tiles)
    .where(inArray(tiles.id, ids as string[]));
}

/**
 * Storage key of an existing render for this exact lat/lng, if any tile already
 * has one. A render is a pure function of (lat, lng) + the fixed pose, so the
 * same geographic point produces an identical PNG — the render worker reuses it
 * instead of re-rendering. Returns null when no rendered tile shares the point.
 */
export async function findRenderedAt(lat: number, lng: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ renderedImgPath: tiles.renderedImgPath })
    .from(tiles)
    .where(and(eq(tiles.lat, lat), eq(tiles.lng, lng), isNotNull(tiles.renderedImgPath)))
    .limit(1);
  return row?.renderedImgPath ?? null;
}

/** Mean of a project's tile centres — a cheap centroid to open a map on. Null
 * when the project has no tiles. */
export async function projectCenter(
  projectId: string,
): Promise<{ lat: number; lng: number } | null> {
  const [row] = await getDb()
    .select({
      lat: sql<number | null>`avg(${tiles.lat})`,
      lng: sql<number | null>`avg(${tiles.lng})`,
    })
    .from(tiles)
    .where(eq(tiles.projectId, projectId));
  if (!row || row.lat === null || row.lng === null) return null;
  return { lat: Number(row.lat), lng: Number(row.lng) };
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

/**
 * Insert additional cells into an existing project's grid (grid expansion) and
 * rewire `neighbors` across the old/new boundary: new tiles get their full
 * adjacency, and existing tiles that gained a new neighbor are updated. New
 * tiles enter the queue as render/pending, so the workers pick them up and
 * stylize them with the existing stylized edge as context. Cells may carry
 * negative coordinates (expansion north/west of the original origin).
 */
export async function addProjectTiles(
  projectId: string,
  cells: readonly TileCell[],
): Promise<Tile[]> {
  if (cells.length === 0) return [];
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select({ id: tiles.id, x: tiles.x, y: tiles.y, neighbors: tiles.neighbors })
      .from(tiles)
      .where(eq(tiles.projectId, projectId));

    const inserted = await tx
      .insert(tiles)
      .values(cells.map((c) => ({ projectId, x: c.x, y: c.y, lat: c.lat, lng: c.lng })))
      .returning();

    const idByCell = new Map(
      [...existing, ...inserted].map((t) => [`${t.x}:${t.y}`, t.id] as const),
    );
    const adjacentIds = (x: number, y: number): string[] => {
      const ids: string[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const id = idByCell.get(`${x + dx}:${y + dy}`);
          if (id) ids.push(id);
        }
      }
      return ids;
    };

    for (const t of inserted) {
      const neighbors = adjacentIds(t.x, t.y);
      if (neighbors.length > 0) {
        await tx.update(tiles).set({ neighbors }).where(eq(tiles.id, t.id));
        t.neighbors = neighbors;
      }
    }
    for (const t of existing) {
      const neighbors = adjacentIds(t.x, t.y);
      if (neighbors.length !== t.neighbors.length) {
        await tx.update(tiles).set({ neighbors }).where(eq(tiles.id, t.id));
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
      // Same anti-diagonal sweep as stylize, so both phases march in lockstep.
      .orderBy(asc(sql`${tiles.x} + ${tiles.y}`), asc(tiles.y), asc(tiles.x))
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
export async function claimNextStylize(): Promise<(Tile & { promoted: boolean }) | null> {
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
      // Deterministic anti-diagonal sweep from the (0,0) corner — generalises
      // the reference algorithm's order so a tile is reached after its up/left
      // neighbours and stylized context grows outward (not random by uuid).
      .orderBy(asc(sql`${tiles.x} + ${tiles.y}`), asc(tiles.y), asc(tiles.x))
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
    return row ? { ...row, promoted: promoting } : null;
  });
}

export async function completeStylize(id: string, stylizedImgPath: string): Promise<void> {
  await getDb()
    .update(tiles)
    .set({ stylizedImgPath, status: 'done', updatedAt: new Date() })
    .where(eq(tiles.id, id));
}

/**
 * Point a tile at a stylized image written out-of-band (e.g. a post-process
 * import), addressed by grid coordinate rather than id. Marks the tile done in
 * the stylize phase and bumps `updatedAt` so the served image cache-busts.
 * Returns how many rows changed (0 = no such tile).
 */
export async function setStylizedImage(
  projectId: string,
  x: number,
  y: number,
  stylizedImgPath: string,
): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({
      stylizedImgPath,
      currentStatusType: 'stylize',
      status: 'done',
      updatedAt: new Date(),
    })
    .where(and(eq(tiles.projectId, projectId), eq(tiles.x, x), eq(tiles.y, y)))
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Re-queue a stylize-phase tile: drop it back to `pending`, clear its stylized
 * output + retry budget so a worker stylizes it again. No-op on render-phase
 * tiles. Returns how many rows changed (0 = no matching stylize tile).
 */
export async function requeueStylize(projectId: string, x: number, y: number): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', stylizedImgPath: null, retryAttempt: 0, updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.x, x),
        eq(tiles.y, y),
        eq(tiles.currentStatusType, 'stylize'),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Re-queue a tile that landed in `error`: drop it back to `pending` and reset
 * its retry budget so the worker for its current phase re-claims it. Works in
 * either phase — it matches only tiles whose status is `error`, leaving the
 * phase and any rendered input intact. Returns how many rows changed (0 = no
 * matching error tile).
 */
/**
 * Re-queue a tile stuck in `progress` (its worker died mid-job, e.g. during a
 * deploy — nothing reclaims `progress` rows on its own): drop it back to
 * `pending` in its current phase so a live worker re-claims it. Keeps the
 * retry budget — stuckness is not a model failure. Returns how many rows
 * changed (0 = the tile at x,y isn't in progress).
 */
export async function requeueStuck(projectId: string, x: number, y: number): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.x, x),
        eq(tiles.y, y),
        eq(tiles.status, 'progress'),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
}

export async function requeueErrored(projectId: string, x: number, y: number): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', retryAttempt: 0, updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.x, x),
        eq(tiles.y, y),
        eq(tiles.status, 'error'),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Bulk re-queue every errored tile in a project, optionally restricted to one
 * phase (`render` or `stylize`). Same reset as `requeueErrored` — back to
 * `pending` with a fresh retry budget. Returns how many tiles were requeued.
 */
export async function requeueErroredByProject(
  projectId: string,
  phase?: TilePhase,
): Promise<number> {
  const conds = [eq(tiles.projectId, projectId), eq(tiles.status, 'error')];
  if (phase) conds.push(eq(tiles.currentStatusType, phase));
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', retryAttempt: 0, updatedAt: new Date() })
    .where(and(...conds))
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Re-queue every stylize-phase tile in a project for a fresh stylize pass: back
 * to `pending` with a reset retry budget. The existing stylized output is kept
 * (not nulled), so the view stays populated and neighbours still contribute
 * context until each tile is overwritten. Returns how many were re-queued.
 */
export async function requeueAllStylize(projectId: string): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', retryAttempt: 0, updatedAt: new Date() })
    .where(and(eq(tiles.projectId, projectId), eq(tiles.currentStatusType, 'stylize')))
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Cancel queued stylize work: flip every `stylize/pending` tile to `done` so the
 * workers stop claiming them (each keeps whatever stylized output it has). A tile
 * already in `progress` finishes on its own. Returns how many were cancelled.
 */
export async function cancelAllStylize(projectId: string): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'done', updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.currentStatusType, 'stylize'),
        eq(tiles.status, 'pending'),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Resume cancelled stylize work: a cancelled tile is `stylize/done` with no
 * stylized output (the signature `cancelAllStylize` leaves behind). Drops every
 * such tile back to `pending` with a fresh retry budget so the workers claim
 * them again. Returns how many were resumed.
 */
export async function resumeAllStylize(projectId: string): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', retryAttempt: 0, updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.currentStatusType, 'stylize'),
        eq(tiles.status, 'done'),
        isNull(tiles.stylizedImgPath),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
}

/**
 * Resume one cancelled tile (same signature match as `resumeAllStylize`):
 * back to `pending` with a fresh retry budget. Returns how many rows changed
 * (0 = the tile at x,y isn't cancelled).
 */
export async function resumeStylize(projectId: string, x: number, y: number): Promise<number> {
  const rows = await getDb()
    .update(tiles)
    .set({ status: 'pending', retryAttempt: 0, updatedAt: new Date() })
    .where(
      and(
        eq(tiles.projectId, projectId),
        eq(tiles.x, x),
        eq(tiles.y, y),
        eq(tiles.currentStatusType, 'stylize'),
        eq(tiles.status, 'done'),
        isNull(tiles.stylizedImgPath),
      ),
    )
    .returning({ id: tiles.id });
  return rows.length;
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
