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

/** Re-queue a single stylized tile so a worker stylizes it again. */
export async function restylizeTile(input: {
  projectId: string;
  x: number;
  y: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const n = await repos.requeueStylize(input.projectId, input.x, input.y);
    if (n === 0) return { ok: false, error: 'tile is not in the stylize phase' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-queue a tile that errored out so its worker (render or stylize) retries it. */
export async function retryTile(input: {
  projectId: string;
  x: number;
  y: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const n = await repos.requeueErrored(input.projectId, input.x, input.y);
    if (n === 0) return { ok: false, error: 'tile is not in an error state' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Bulk re-queue a project's errored tiles — all of them, or just one phase. */
export async function retryProjectErrors(input: {
  projectId: string;
  phase: 'all' | 'render' | 'stylize';
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const phase = input.phase === 'all' ? undefined : input.phase;
    const count = await repos.requeueErroredByProject(input.projectId, phase);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-queue every stylize-phase tile in a project for a fresh stylize pass. */
export async function restyleAll(input: {
  projectId: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const count = await repos.requeueAllStylize(input.projectId);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Cancel queued stylize work: stop the workers from claiming pending tiles. */
export async function cancelAll(input: {
  projectId: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const count = await repos.cancelAllStylize(input.projectId);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
