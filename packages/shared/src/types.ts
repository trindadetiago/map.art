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
  /** Camera yaw in degrees. 0 = looking along +Z (south in our scene convention). */
  yaw: number;
  /** Width of one tile on the image plane, in ground meters. Camera-right step. */
  tileWorldMeters: number;
}

/**
 * World-frame offset (scene meters, +X east, +Z south) of the tile at (col, row)'s
 * CENTER relative to the project origin. Step along camera-right = tileWorldMeters;
 * step along camera-forward = tileWorldMeters / sin(pitch) (pitch foreshortening).
 * This is what makes per-tile captures tile seamlessly in image space.
 */
export function tileGroundOffset(
  col: number,
  row: number,
  p: CameraGridParams,
): { x: number; z: number } {
  const yawRad = (p.yaw * Math.PI) / 180;
  const pitchRad = (p.pitch * Math.PI) / 180;
  const sinPitch = Math.max(Math.sin(pitchRad), 0.01);
  // Ground horizontal frame derived from yaw.
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  const forwardX = Math.sin(yawRad);
  const forwardZ = Math.cos(yawRad);
  const rightStep = p.tileWorldMeters;
  const forwardStep = p.tileWorldMeters / sinPitch;
  return {
    x: col * rightStep * rightX + row * forwardStep * forwardX,
    z: col * rightStep * rightZ + row * forwardStep * forwardZ,
  };
}

/** Ground-frame corners of the tile at (col, row). Used by scene overlays. */
export function tileGroundCorners(
  col: number,
  row: number,
  p: CameraGridParams,
): {
  nw: { x: number; z: number };
  ne: { x: number; z: number };
  se: { x: number; z: number };
  sw: { x: number; z: number };
} {
  const c00 = tileGroundOffset(col - 0.5, row - 0.5, p);
  const c10 = tileGroundOffset(col + 0.5, row - 0.5, p);
  const c11 = tileGroundOffset(col + 0.5, row + 0.5, p);
  const c01 = tileGroundOffset(col - 0.5, row + 0.5, p);
  return { nw: c00, ne: c10, se: c11, sw: c01 };
}

const EARTH_R = 6378137;
/** Convert a small ground-meters offset into a lat/lng delta. Good enough for city-scale. */
export function metersToLatLng(
  origin: LatLng,
  offsetMetersX: number,
  offsetMetersZ: number,
): LatLng {
  const dLat = -(offsetMetersZ / EARTH_R) * (180 / Math.PI); // -Z = north so positive Z subtracts lat
  const dLng =
    (offsetMetersX / (EARTH_R * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}
