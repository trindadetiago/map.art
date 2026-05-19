import { and, eq, sql } from 'drizzle-orm';
import { getDb, getSql } from '../client';
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
