import { desc, eq } from 'drizzle-orm';
import { getDb, getSql } from '../client';
import { type NewProject, type Project, projects } from '../schema/projects';

export async function listProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(desc(projects.createdAt));
}

export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  const rows = await getDb().select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return rows[0];
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

export async function deleteProject(id: string): Promise<void> {
  await getDb().delete(projects).where(eq(projects.id, id));
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | 'name'
    | 'cameraPitch'
    | 'cameraYaw'
    | 'status'
    | 'defaultModelId'
    | 'centerLat'
    | 'centerLng'
    | 'tileWorldMeters'
    | 'tilePixelSize'
  >
>;

export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const [row] = await getDb()
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  if (!row) throw new Error(`updateProject: no project with id ${id}`);
  return row;
}

export interface CreateRectProjectInput {
  name: string;
  slug: string;
  centerLat: number;
  centerLng: number;
  cols: number;
  rows: number;
  cameraPitch?: number;
  cameraYaw?: number;
  tileWorldMeters?: number;
  tilePixelSize?: number;
}

/**
 * Create a project + seed a rectangular grid of tiles around (col=0, row=0).
 * cols/rows are signed extents: cols=10 means col ∈ [-5, 4]; rows similarly.
 * Everything in one transaction.
 */
export async function createRectProject(
  input: CreateRectProjectInput,
): Promise<{ project: Project; tileCount: number }> {
  const sql = getSql();
  const pitch = input.cameraPitch ?? 30;
  const yaw = input.cameraYaw ?? 45;
  const tileWorldMeters = input.tileWorldMeters ?? 150;
  const tilePixelSize = input.tilePixelSize ?? 512;

  const halfCols = Math.floor(input.cols / 2);
  const halfRows = Math.floor(input.rows / 2);
  const minCol = -halfCols;
  const maxCol = minCol + input.cols - 1;
  const minRow = -halfRows;
  const maxRow = minRow + input.rows - 1;

  const coords: { col: number; row: number }[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      coords.push({ col: c, row: r });
    }
  }

  const projectId = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO projects (
        name, slug, center_lat, center_lng,
        camera_pitch, camera_yaw, tile_world_meters, tile_pixel_size, status
      )
      VALUES (
        ${input.name}, ${input.slug}, ${input.centerLat}, ${input.centerLng},
        ${pitch}, ${yaw}, ${tileWorldMeters}, ${tilePixelSize}, 'setup'
      )
      RETURNING id
    `;
    const row = rows[0];
    if (!row) throw new Error('createRectProject: project insert returned no row');

    if (coords.length > 0) {
      const chunkSize = 2000;
      for (let i = 0; i < coords.length; i += chunkSize) {
        const chunk = coords.slice(i, i + chunkSize);
        const cs = chunk.map((t) => t.col);
        const rs = chunk.map((t) => t.row);
        await tx`
          INSERT INTO tiles (project_id, col, row)
          SELECT ${row.id}::uuid, c, r
          FROM UNNEST(${cs}::int[], ${rs}::int[]) AS t(c, r)
        `;
      }
    }
    return row.id;
  });

  const project = await getProjectById(projectId);
  if (!project) throw new Error('createRectProject: project vanished after insert');
  return { project, tileCount: coords.length };
}

export interface ReseedInput {
  projectId: string;
  newTiles: { col: number; row: number }[];
  centerLat?: number;
  centerLng?: number;
  cameraPitch?: number;
  cameraYaw?: number;
  tileWorldMeters?: number;
}

/**
 * Update project settings + replace tile grid in one transaction. Destructive:
 * any tile_versions attached to old tiles cascade-delete.
 */
export async function reseedProjectTiles(input: ReseedInput): Promise<void> {
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx`
      UPDATE projects
      SET
        center_lat = COALESCE(${input.centerLat ?? null}::real, center_lat),
        center_lng = COALESCE(${input.centerLng ?? null}::real, center_lng),
        camera_pitch = COALESCE(${input.cameraPitch ?? null}::real, camera_pitch),
        camera_yaw = COALESCE(${input.cameraYaw ?? null}::real, camera_yaw),
        tile_world_meters = COALESCE(${input.tileWorldMeters ?? null}::real, tile_world_meters),
        updated_at = now()
      WHERE id = ${input.projectId}
    `;
    await tx`DELETE FROM tiles WHERE project_id = ${input.projectId}`;
    if (input.newTiles.length > 0) {
      const chunkSize = 2000;
      for (let i = 0; i < input.newTiles.length; i += chunkSize) {
        const chunk = input.newTiles.slice(i, i + chunkSize);
        const cs = chunk.map((t) => t.col);
        const rs = chunk.map((t) => t.row);
        await tx`
          INSERT INTO tiles (project_id, col, row)
          SELECT ${input.projectId}::uuid, c, r
          FROM UNNEST(${cs}::int[], ${rs}::int[]) AS t(c, r)
        `;
      }
    }
  });
}
