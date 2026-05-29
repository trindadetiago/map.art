import { desc, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { type NewProject, type Project, projects } from '../schema/projects';

export async function listProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt));
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

export type ProjectPatch = Partial<Pick<Project, 'name' | 'description'>>;

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
