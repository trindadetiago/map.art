import { desc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { type ProjectExport, projectExports } from '../schema/exports';

/** Queue an export. The runner picks it up and moves it through the states. */
export async function createExport(projectId: string, source: string): Promise<ProjectExport> {
  const [row] = await getDb().insert(projectExports).values({ projectId, source }).returning();
  if (!row) throw new Error('createExport: insert returned no row');
  return row;
}

export async function getExportById(id: string): Promise<ProjectExport | undefined> {
  const rows = await getDb()
    .select()
    .from(projectExports)
    .where(eq(projectExports.id, id))
    .limit(1);
  return rows[0];
}

/** The most recent run for a project, whatever its state. */
export async function latestExport(projectId: string): Promise<ProjectExport | undefined> {
  const rows = await getDb()
    .select()
    .from(projectExports)
    .where(eq(projectExports.projectId, projectId))
    .orderBy(desc(projectExports.createdAt))
    .limit(1);
  return rows[0];
}

export async function listExports(projectId: string, limit = 10): Promise<ProjectExport[]> {
  return getDb()
    .select()
    .from(projectExports)
    .where(eq(projectExports.projectId, projectId))
    .orderBy(desc(projectExports.createdAt))
    .limit(limit);
}

export async function markExportRunning(id: string): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(projectExports.id, id));
}

export interface ExportOutcome {
  placed: number;
  skipped: number;
  uploaded: number;
  width: number;
  height: number;
}

export async function markExportDone(id: string, outcome: ExportOutcome): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ status: 'done', finishedAt: new Date(), ...outcome })
    .where(eq(projectExports.id, id));
}

export async function markExportError(id: string, error: string): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ status: 'error', finishedAt: new Date(), error: error.slice(0, 500) })
    .where(eq(projectExports.id, id));
}
