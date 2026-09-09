/**
 * Storage-key layout for a project's deep-zoom pyramid.
 *
 * Everything for one project lives under `viz/{projectId}/`:
 *   - `metadata.json`  — the {@link import('./types').VizMetadata} descriptor
 *   - `pins.json`      — the map's lat/lng pins
 *   - `v/{version}/tiles.dzi` — the DZI XML descriptor sharp emits
 *   - `v/{version}/tiles_files/{level}/{col}_{row}.webp` — the pyramid itself
 *
 * The pyramid is written under a per-export `version`, and the descriptor names
 * the current one. That is what makes a tile genuinely immutable: re-exporting
 * writes new URLs rather than new bytes at old ones, so nothing a browser or CDN
 * already holds can go stale. The two mutable objects — the descriptor and the
 * pins — stay at fixed keys and are read through the S3 API, never cached.
 *
 * `version` is optional throughout: pyramids exported before this existed are
 * still addressed at the old flat `tiles_files/` path.
 */

import type { VizMetadata } from './types';

export function vizPrefix(projectId: string): string {
  return `viz/${projectId}`;
}

/** The list of published maps. One object for the whole visualizer. */
export function vizCatalogKey(): string {
  return 'viz/index.json';
}

export function vizMetadataKey(projectId: string): string {
  return `${vizPrefix(projectId)}/metadata.json`;
}

export function vizDziKey(projectId: string, version?: string): string {
  return `${vizVersionPrefix(projectId, version)}/tiles.dzi`;
}

/** Everything belonging to one export of a project. */
export function vizVersionPrefix(projectId: string, version?: string): string {
  return version ? `${vizPrefix(projectId)}/v/${version}` : vizPrefix(projectId);
}

/** Prefix the pyramid tile folders live under (OpenSeadragon's `Url`). */
export function vizTilesPrefix(projectId: string, version?: string): string {
  return `${vizVersionPrefix(projectId, version)}/tiles_files`;
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
  meta: Pick<VizMetadata, 'width' | 'height' | 'tileSize' | 'format' | 'version'>,
): string {
  return `${vizTilesPrefix(projectId, meta.version)}/${vizThumbLevel(meta)}/0_0.${meta.format}`;
}
