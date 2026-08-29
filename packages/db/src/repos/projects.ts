import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { type NewProject, type Project, projects } from '../schema/projects';
import { tiles } from '../schema/tiles';

/** Taken by the visualizer's own routes, so no project may claim them. */
const RESERVED_SLUGS = new Set(['api', 'admin', 'static', 'public', '_next']);

/** Fold accents, lowercase, collapse every non-alphanumeric run to one dash. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug for a project: `raw` when given, else derived from `name`. Throws when
 * nothing usable survives slugification or the result is reserved.
 */
export function toSlug(raw: string, name: string): string {
  const slug = slugify(raw.trim() || name);
  if (!slug) throw new Error('slug must contain at least one letter or number');
  if (RESERVED_SLUGS.has(slug)) throw new Error(`slug "${slug}" is reserved`);
  return slug;
}

function rethrowSlugConflict(e: unknown): never {
  if ((e as { code?: string })?.code === '23505') {
    throw new Error('that slug is already taken by another project');
  }
  throw e;
}

export async function listProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt));
}

export interface ProjectLocation {
  id: string;
  slug: string;
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
      slug: projects.slug,
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

export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  const rows = await getDb().select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0];
}

export async function createProject(input: NewProject): Promise<Project> {
  const [row] = await getDb().insert(projects).values(input).returning().catch(rethrowSlugConflict);
  if (!row) throw new Error('createProject: insert returned no row');
  return row;
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'slug' | 'description' | 'year'>>;

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const [row] = await getDb()
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()
    .catch(rethrowSlugConflict);
  if (!row) throw new Error(`updateProject: no project with id ${id}`);
  return row;
}

export async function deleteProject(id: string): Promise<void> {
  await getDb().delete(projects).where(eq(projects.id, id));
}
