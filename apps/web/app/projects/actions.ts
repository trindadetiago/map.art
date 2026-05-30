'use server';

import { repos } from '@mapart/db';
import { gridCells } from '@mapart/renderer/params';
import { revalidatePath } from 'next/cache';

/**
 * Create a project and its render-tile grid from a chosen origin + size.
 * Same producer path as `mapart project create`: gridCells → createProject →
 * createProjectTiles. The render worker picks the tiles up from there.
 */
export async function createProjectWithGrid(input: {
  name: string;
  description?: string;
  lat: number;
  lng: number;
  cols: number;
  rows: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const name = input.name.trim();
    if (!name) return { ok: false, error: 'name is required' };
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      return { ok: false, error: 'invalid origin coordinates' };
    }
    if (
      !Number.isInteger(input.cols) ||
      !Number.isInteger(input.rows) ||
      input.cols < 1 ||
      input.rows < 1
    ) {
      return { ok: false, error: 'cols and rows must be positive integers' };
    }

    const cells = gridCells({ lat: input.lat, lng: input.lng }, input.cols, input.rows);
    const project = await repos.createProject({
      name,
      description: input.description?.trim() || null,
    });
    await repos.createProjectTiles(project.id, cells);
    revalidatePath('/projects');
    return { ok: true, id: project.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
