import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, getSql } from '../client';
import { tileVersions } from '../schema/tile-versions';
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

export type TileVersionSource = 'rendered' | 'generated' | 'manual';

export interface CreateTileVersionInput {
  projectId: string;
  col: number;
  row: number;
  source: TileVersionSource;
  storageKey: string;
  modelId?: string | null;
  prompt?: string | null;
  referenceStorageKey?: string | null;
}

export interface TileStatusSummary {
  total: number;
  rendered: number;
  generated: number;
  pending: number;
}

export async function getTileStatusSummary(projectId: string): Promise<TileStatusSummary> {
  const result = await getDb()
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      rendered:
        sql<number>`count(case when ${tileVersions.source} = 'rendered' then 1 end)`.mapWith(
          Number,
        ),
      generated:
        sql<number>`count(case when ${tileVersions.source} = 'generated' then 1 end)`.mapWith(
          Number,
        ),
    })
    .from(tiles)
    .leftJoin(tileVersions, eq(tiles.currentVersionId, tileVersions.id))
    .where(eq(tiles.projectId, projectId));

  const r = result[0];
  const total = r?.total ?? 0;
  const generated = r?.generated ?? 0;
  return {
    total,
    rendered: r?.rendered ?? 0,
    generated,
    pending: total - generated,
  };
}

export async function listTileVersionByProjectAndCoords(
  projectId: string,
  col: number,
  row: number,
  source: TileVersionSource,
) {
  const result = await getDb().query.tileVersions.findFirst({
    where: and(
      eq(tileVersions.projectId, projectId),
      eq(tileVersions.col, col),
      eq(tileVersions.row, row),
      eq(tileVersions.source, source),
    ),
    orderBy: desc(tileVersions.createdAt),
  });
  return result ?? null;
}

/**
 * Insert a tile_versions row and point tiles.current_version_id at it. If
 * modelId is provided we upsert a minimal models row first so the FK doesn't
 * break for users who skipped `seedDefaultModels`. Single transaction.
 */
export async function createTileVersionAndSetCurrent(
  input: CreateTileVersionInput,
): Promise<string> {
  const sqlTx = getSql();
  return sqlTx.begin(async (tx) => {
    if (input.modelId) {
      await tx`
        INSERT INTO models (id, kind, endpoint)
        VALUES (${input.modelId}, 'edit', ${`auto:${input.modelId}`})
        ON CONFLICT (id) DO NOTHING
      `;
    }
    const rows = await tx<{ id: string }[]>`
      INSERT INTO tile_versions (
        project_id, col, row, source, storage_key, model_id, prompt, reference_storage_key
      )
      VALUES (
        ${input.projectId}::uuid, ${input.col}, ${input.row},
        ${input.source}, ${input.storageKey},
        ${input.modelId ?? null}, ${input.prompt ?? null}, ${input.referenceStorageKey ?? null}
      )
      RETURNING id
    `;
    const row = rows[0];
    if (!row) throw new Error('createTileVersion: insert returned no row');
    await tx`
      UPDATE tiles
      SET current_version_id = ${row.id}::uuid, updated_at = now()
      WHERE project_id = ${input.projectId}::uuid
        AND col = ${input.col}
        AND row = ${input.row}
    `;
    return row.id;
  });
}
