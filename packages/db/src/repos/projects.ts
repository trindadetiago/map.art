import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { type NewProject, type Project, projects } from '../schema/projects';
import { tiles } from '../schema/tiles';

export async function listProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt));
}

export interface ProjectLocation {
  id: string;
  name: string;
  description: string | null;
  year: number | null;
  lat: number;
  lng: number;
}

/**
 * Every project that has tiles, with a representative location (the mean of its
 * tile centres). Projects without tiles have no location and are omitted — the
 * visualizer globe needs a point to place each one on.
 */
export async function listProjectsWithLocation(): Promise<ProjectLocation[]> {
  const rows = await getDb()
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      year: projects.year,
      lat: sql<number>`avg(${tiles.lat})`,
      lng: sql<number>`avg(${tiles.lng})`,
    })
    .from(projects)
    .innerJoin(tiles, eq(tiles.projectId, projects.id))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
  return rows.map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }));
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const rows = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0];
}

export async function createProject(input: NewProject): Promise<Project> {
  const [row] = await getDb().insert(projects).values(input).returning();
  if (!row) throw new Error('createProject: insert returned no row');
  return row;
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'description' | 'year'>>;

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const [row] = await getDb()
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  if (!row) throw new Error(`updateProject: no project with id ${id}`);
  return row;
}

export async function deleteProject(id: string): Promise<void> {
  await getDb().delete(projects).where(eq(projects.id, id));
}
