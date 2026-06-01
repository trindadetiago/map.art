import type { LatLng } from '@mapart/geo';
import { tileCenterLatLng } from '@mapart/renderer/params';

/**
 * Origin (tile 0,0) that places a `cols`×`rows` grid centered on `center`.
 * `createProjectWithGrid` / `gridCells` are anchored at the origin, but the
 * picker works in terms of the grid's center — this converts between them.
 *
 * `tileCenterLatLng` is origin + a linear offset, so for the grid center cell
 * (cx, cy): probe = origin + offset(cx, cy)  ⇒  origin = 2·center − probe.
 */
export function originForCenter(center: LatLng, cols: number, rows: number): LatLng {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const probe = tileCenterLatLng(center, cx, cy);
  return { lat: 2 * center.lat - probe.lat, lng: 2 * center.lng - probe.lng };
}

/** Grid center given the project's origin tile (0,0) + size. Inverse of `originForCenter`. */
export function centerFromOrigin(origin: LatLng, cols: number, rows: number): LatLng {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  return tileCenterLatLng(origin, cx, cy);
}
