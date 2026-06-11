'use server';

import { repos } from '@mapart/db';
import { gridCells, tileCenterLatLng } from '@mapart/renderer/params';
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

/**
 * Expand a project's grid by N tiles per side. New cells are placed on the
 * same pose-aligned lattice as the existing tiles (anchored to a current tile,
 * so seams stay exact) and enter the queue as render/pending — the workers
 * render them, then stylize them with the existing stylized edge as context.
 * Expanding north/west produces negative grid coordinates; existing tiles and
 * their storage keys are never touched.
 */
export async function expandProject(input: {
  projectId: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const sides = [input.top, input.right, input.bottom, input.left];
    if (sides.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) {
      return { ok: false, error: 'each side must be an integer between 0 and 100' };
    }
    if (sides.every((n) => n === 0)) return { ok: true, count: 0 };

    const existing = await repos.tilesByProject(input.projectId);
    const anchor = existing[0];
    if (!anchor) return { ok: false, error: 'project has no tiles to expand from' };

    const xs = existing.map((t) => t.x);
    const ys = existing.map((t) => t.y);
    const minX = Math.min(...xs) - input.left;
    const maxX = Math.max(...xs) + input.right;
    const minY = Math.min(...ys) - input.top;
    const maxY = Math.max(...ys) + input.bottom;

    const occupied = new Set(existing.map((t) => `${t.x}:${t.y}`));
    const cells: { x: number; y: number; lat: number; lng: number }[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (occupied.has(`${x}:${y}`)) continue;
        const c = tileCenterLatLng(
          { lat: anchor.lat, lng: anchor.lng },
          x - anchor.x,
          y - anchor.y,
        );
        cells.push({ x, y, lat: c.lat, lng: c.lng });
      }
    }

    const inserted = await repos.addProjectTiles(input.projectId, cells);
    revalidatePath(`/projects/${input.projectId}`);
    return { ok: true, count: inserted.length };
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

/** Resume every cancelled tile: re-queue the stylize work that Cancel all stopped. */
export async function resumeAll(input: {
  projectId: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const count = await repos.resumeAllStylize(input.projectId);
    return { ok: true, count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-queue a tile stuck in progress (worker died mid-job) so it gets re-claimed. */
export async function requeueStuckTile(input: {
  projectId: string;
  x: number;
  y: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const n = await repos.requeueStuck(input.projectId, input.x, input.y);
    if (n === 0) return { ok: false, error: 'tile is not in progress' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Resume one cancelled tile so a stylize worker picks it up again. */
export async function resumeTile(input: {
  projectId: string;
  x: number;
  y: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const n = await repos.resumeStylize(input.projectId, input.x, input.y);
    if (n === 0) return { ok: false, error: 'tile is not cancelled' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
