/**
 * Storage-key layout for a project's deep-zoom pyramid.
 *
 * Everything for one project lives under `viz/{projectId}/`:
 *   - `metadata.json`  — the {@link import('./types').VizMetadata} descriptor
 *   - `tiles.dzi`      — the DZI XML descriptor sharp emits (kept for debugging)
 *   - `tiles_files/{level}/{col}_{row}.webp` — the pyramid itself
 *
 * The visualizer's tile-proxy serves `viz/{projectId}/<path>` verbatim, so
 * OpenSeadragon's `${Url}{level}/{col}_{row}.webp` requests map straight onto
 * these keys with no level remapping.
 */

import type { VizMetadata } from './types';

export function vizPrefix(projectId: string): string {
  return `viz/${projectId}`;
}

export function vizMetadataKey(projectId: string): string {
  return `${vizPrefix(projectId)}/metadata.json`;
}

export function vizDziKey(projectId: string): string {
  return `${vizPrefix(projectId)}/tiles.dzi`;
}

/** Prefix the pyramid tile folders live under (OpenSeadragon's `Url`). */
export function vizTilesPrefix(projectId: string): string {
  return `${vizPrefix(projectId)}/tiles_files`;
}

/** The project's pin overlay definitions (a JSON {@link import('./types').VizPin} array). */
export function vizPinsKey(projectId: string): string {
  return `${vizPrefix(projectId)}/pins.json`;
}

/**
 * Deep-zoom level at which the whole image first fits inside one tile. Levels
 * halve on the way down, so this walks up to the largest single-tile level —
 * the cheapest complete picture of a pyramid, and so its natural thumbnail.
 */
export function vizThumbLevel(meta: Pick<VizMetadata, 'width' | 'height' | 'tileSize'>): number {
  const maxLevel = Math.ceil(Math.log2(Math.max(meta.width, meta.height, 1)));
  let level = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const scale = 2 ** (maxLevel - l);
    if (Math.ceil(meta.width / scale) > meta.tileSize) break;
    if (Math.ceil(meta.height / scale) > meta.tileSize) break;
    level = l;
  }
  return level;
}

/** Key of the single tile holding the whole map at {@link vizThumbLevel}. */
export function vizThumbKey(
  projectId: string,
  meta: Pick<VizMetadata, 'width' | 'height' | 'tileSize' | 'format'>,
): string {
  return `${vizTilesPrefix(projectId)}/${vizThumbLevel(meta)}/0_0.${meta.format}`;
}
