export interface LatLng {
  lat: number;
  lng: number;
}

export interface RenderParams {
  center: LatLng;
  pitch: number;
  yaw: number;
  size: number;
  /** Web-mercator zoom level. Fractional values are allowed for fine-tuning the framing. */
  zoom: number;
}

const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Width in meters of a web-mercator tile at a given zoom + latitude. Kept for the renderer CLI and minimap utilities. */
export function tileWidthMeters(zoom: number, latDeg: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / 2 ** zoom;
}

export interface CameraGridParams {
  /** Project center (tile col=0, row=0 sits here). */
  centerLat: number;
  centerLng: number;
  /** Camera pitch in degrees. 90 = straight down. */
  pitch: number;
  /** Camera yaw in degrees. 0 = camera looks north. Increases counter-clockwise
   * when viewed from above (yaw=90 looks west, yaw=180 south, yaw=270 east). */
  yaw: number;
  /** Width of one tile on the image plane, in ground meters. */
  tileWorldMeters: number;
}

/**
 * Geographic offset (in meters) of tile (col, row)'s CENTER relative to the
 * project origin.
 *
 * Convention — these are GEO meters, not scene coords:
 *   - `east` = meters east (+) / west (-) of origin.
 *   - `north` = meters north (+) / south (-) of origin.
 *
 * Stepping:
 *   - col+ moves the tile along image-right on the ground (one tile per col).
 *   - row+ moves the tile along image-up on the ground, elongated by
 *     `1/sin(pitch)` so adjacent rows abut exactly in image space.
 *
 * At yaw=0 the camera looks north, so col+ = east and row+ = north. At other
 * yaws both axes rotate together. This is what makes per-tile captures tile
 * seamlessly in the stitched output at any yaw.
 *
 * Note: scene convention (set by the 3d-tiles-renderer ReorientationPlugin
 * with OBJECT_FRAME) is +X = west, +Z = north. Callers that draw in scene
 * coords must negate `east` before using it as scene-x.
 */
export function tileGroundOffset(
  col: number,
  row: number,
  p: CameraGridParams,
): { east: number; north: number } {
  const yawRad = (p.yaw * Math.PI) / 180;
  const pitchRad = (p.pitch * Math.PI) / 180;
  const sinPitch = Math.max(Math.sin(pitchRad), 0.01);
  const rightStep = p.tileWorldMeters;
  const forwardStep = p.tileWorldMeters / sinPitch;
  // image-right direction on the ground in (east, north): (cos yaw, sin yaw).
  // image-up direction on the ground in (east, north): (-sin yaw, cos yaw).
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return {
    east: col * rightStep * cos + row * forwardStep * -sin,
    north: col * rightStep * sin + row * forwardStep * cos,
  };
}

/**
 * Geographic corners of tile (col, row) as east/north meter offsets from the
 * project origin. Compass names reflect the corner's actual direction at
 * yaw=0 (rotate with yaw like `tileGroundOffset`).
 */
export function tileGroundCorners(
  col: number,
  row: number,
  p: CameraGridParams,
): {
  nw: { east: number; north: number };
  ne: { east: number; north: number };
  se: { east: number; north: number };
  sw: { east: number; north: number };
} {
  return {
    nw: tileGroundOffset(col - 0.5, row + 0.5, p),
    ne: tileGroundOffset(col + 0.5, row + 0.5, p),
    se: tileGroundOffset(col + 0.5, row - 0.5, p),
    sw: tileGroundOffset(col - 0.5, row - 0.5, p),
  };
}

/**
 * Build the `RenderParams` the Scene needs to capture tile (col, row) of the
 * given project. Converts the per-tile ground offset to an absolute lat/lng,
 * and picks the web-mercator zoom such that the orthographic frustum width
 * equals the project's `tileWorldMeters` at the tile's latitude.
 */
export function renderParamsForTile(
  project: {
    centerLat: number;
    centerLng: number;
    cameraPitch: number;
    cameraYaw: number;
    tileWorldMeters: number;
    tilePixelSize: number;
  },
  col: number,
  row: number,
): RenderParams {
  const offset = tileGroundOffset(col, row, {
    centerLat: project.centerLat,
    centerLng: project.centerLng,
    pitch: project.cameraPitch,
    yaw: project.cameraYaw,
    tileWorldMeters: project.tileWorldMeters,
  });
  const latRad = (project.centerLat * Math.PI) / 180;
  const metersPerDegLat = EARTH_CIRCUMFERENCE_M / 360;
  const metersPerDegLng = (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / 360;
  const tileLat = project.centerLat + offset.north / metersPerDegLat;
  const tileLng = project.centerLng + offset.east / metersPerDegLng;
  const tileLatRad = (tileLat * Math.PI) / 180;
  const zoom = Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(tileLatRad)) / project.tileWorldMeters);
  return {
    center: { lat: tileLat, lng: tileLng },
    pitch: project.cameraPitch,
    yaw: project.cameraYaw,
    size: project.tilePixelSize,
    zoom,
  };
}
