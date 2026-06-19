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
