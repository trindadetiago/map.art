import type { LatLng } from '@mapart/geo';

/** Global render pose + output config. Applied to every tile capture. */
export const RENDER_DEFAULTS = {
  /** Camera pitch in degrees. 90 = straight down. */
  cameraPitch: 30,
  /** Camera yaw in degrees. 0 = camera looks north; increases counter-clockwise
   * viewed from above (yaw=90 looks west, 180 south, 270 east). */
  cameraYaw: 45,
  /** Width of one tile on the image plane, in ground meters. */
  tileWorldMeters: 150,
  /** Output PNG dimensions per tile (pixels, square). */
  tilePixelSize: 512,
} as const;

export interface RenderParams {
  center: LatLng;
  pitch: number;
  yaw: number;
  size: number;
  /** Web-mercator zoom level. Fractional values are allowed for fine-tuning the framing. */
  zoom: number;
}

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/**
 * Geographic offset (in meters) of grid tile (x, y)'s CENTER relative to the
 * project origin, using the global camera pose.
 *
 *   - `east` = meters east (+) / west (-) of origin.
 *   - `north` = meters north (+) / south (-) of origin.
 *
 * Stepping:
 *   - x+ moves the tile along image-right on the ground (one tile per x).
 *   - y+ moves the tile along image-up on the ground, elongated by
 *     `1/sin(pitch)` so adjacent rows abut exactly in image space.
 *
 * At yaw=0 the camera looks north, so x+ = east and y+ = north. At other yaws
 * both axes rotate together — this is what makes per-tile captures tile
 * seamlessly in the stitched output at any yaw.
 *
 * Note: scene convention (set by the 3d-tiles-renderer ReorientationPlugin with
 * OBJECT_FRAME) is +X = west, +Z = north. Callers drawing in scene coords must
 * negate `east` before using it as scene-x.
 */
function tileGroundOffset(x: number, y: number): { east: number; north: number } {
  const yawRad = (RENDER_DEFAULTS.cameraYaw * Math.PI) / 180;
  const pitchRad = (RENDER_DEFAULTS.cameraPitch * Math.PI) / 180;
  const sinPitch = Math.max(Math.sin(pitchRad), 0.01);
  const rightStep = RENDER_DEFAULTS.tileWorldMeters;
  const forwardStep = RENDER_DEFAULTS.tileWorldMeters / sinPitch;
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return {
    east: x * rightStep * cos + y * forwardStep * -sin,
    north: x * rightStep * sin + y * forwardStep * cos,
  };
}

/**
 * Geographic corners of grid tile (x, y) as east/north meter offsets from the
 * project origin. Compass names reflect the corner's actual direction at yaw=0
 * (rotate with yaw like `tileGroundOffset`).
 */
export function tileGroundCorners(
  x: number,
  y: number,
): {
  nw: { east: number; north: number };
  ne: { east: number; north: number };
  se: { east: number; north: number };
  sw: { east: number; north: number };
} {
  return {
    nw: tileGroundOffset(x - 0.5, y + 0.5),
    ne: tileGroundOffset(x + 0.5, y + 0.5),
    se: tileGroundOffset(x + 0.5, y - 0.5),
    sw: tileGroundOffset(x - 0.5, y - 0.5),
  };
}

function offsetToLatLng(center: LatLng, east: number, north: number): LatLng {
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLat = EARTH_CIRCUMFERENCE_M / 360;
  const metersPerDegLng = (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / 360;
  return {
    lat: center.lat + north / metersPerDegLat,
    lng: center.lng + east / metersPerDegLng,
  };
}

/** Geographic center of grid tile (x, y) given the project's origin tile (0,0). */
export function tileCenterLatLng(center: LatLng, x: number, y: number): LatLng {
  const o = tileGroundOffset(x, y);
  return offsetToLatLng(center, o.east, o.north);
}

/**
 * Build the `RenderParams` the Scene needs to capture a tile centered at the
 * given lat/lng, using the global camera pose. Picks the web-mercator zoom such
 * that the orthographic frustum width equals `tileWorldMeters` at that latitude.
 */
export function renderParamsForLatLng(center: LatLng): RenderParams {
  const latRad = (center.lat * Math.PI) / 180;
  const zoom = Math.log2(
    (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / RENDER_DEFAULTS.tileWorldMeters,
  );
  return {
    center,
    pitch: RENDER_DEFAULTS.cameraPitch,
    yaw: RENDER_DEFAULTS.cameraYaw,
    size: RENDER_DEFAULTS.tilePixelSize,
    zoom,
  };
}
