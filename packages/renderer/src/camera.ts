import { tileWidthMeters } from '@mapart/geo';
import type { OrthographicCamera } from 'three';
import { RENDER_DEFAULTS, type RenderParams, tileGroundCorners } from './params';

/**
 * Orthographic frustum bounds for a given zoom + latitude. We size the frustum
 * so one tile (per `tileWidthMeters`) fits across the viewport, with near/far
 * set generously to avoid clipping at high pitch.
 */
export function cameraFrustumForZoom(
  zoom: number,
  lat: number,
): { half: number; near: number; far: number } {
  const width = tileWidthMeters(zoom, lat);
  return { half: width / 2, near: 1, far: width * 50 };
}

/** Apply zoom/lat-derived frustum to an existing ortho camera. */
export function applyFrustum(camera: OrthographicCamera, zoom: number, lat: number): void {
  const f = cameraFrustumForZoom(zoom, lat);
  camera.left = -f.half;
  camera.right = f.half;
  camera.top = f.half;
  camera.bottom = -f.half;
  camera.near = f.near;
  camera.far = f.far;
  camera.updateProjectionMatrix();
}

/**
 * Position an orthographic camera from yaw/pitch/zoom around a tile centered
 * at the origin. The TilesRenderer (with ReorientationPlugin) is responsible
 * for placing the geographic tile at (0, 0, 0); this camera math just orbits.
 */
export function positionCamera(camera: OrthographicCamera, p: RenderParams): void {
  const yawRad = (p.yaw * Math.PI) / 180;
  const pitchRad = (p.pitch * Math.PI) / 180;
  const distance = tileWidthMeters(p.zoom, p.center.lat) * 10;

  const dx = Math.sin(yawRad) * Math.cos(pitchRad);
  const dy = Math.sin(pitchRad);
  const dz = Math.cos(yawRad) * Math.cos(pitchRad);

  camera.position.set(-dx * distance, dy * distance, -dz * distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

type Vec3 = [number, number, number];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};

/** Camera basis (forward/right/up unit vectors) for the global iso pose. */
function isoBasis(yawDeg: number, pitchDeg: number): { f: Vec3; r: Vec3; u: Vec3 } {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const dx = Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * Math.cos(pitch);
  // positionCamera sits the camera at (-dx, dy, -dz)·D looking at the origin,
  // so the view-forward direction is (dx, -dy, dz).
  const f = norm([dx, -dy, dz]);
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f); // unit: r ⟂ f and both unit
  return { f, r, u };
}

/**
 * Orthographic framing for a whole `cols`×`rows` grid centered on the scene
 * origin, using the global iso pose. Generalizes the single-tile `positionCamera`
 * /`applyFrustum` so the area picker can frame the entire selection.
 *
 * Returns frustum half-extents along the camera's right/up axes (in world
 * meters, before any viewport-aspect fit), the unit direction to place the
 * camera along, and a safe orbit distance + near/far. The caller applies these
 * to a three `OrthographicCamera`, widening one half-extent to match the canvas
 * aspect ratio.
 */
export interface GridView {
  halfW: number;
  halfH: number;
  dir: Vec3;
  distance: number;
  near: number;
  far: number;
}

export function gridViewForSize(cols: number, rows: number, pad = 1.12): GridView {
  const { f, r, u } = isoBasis(RENDER_DEFAULTS.cameraYaw, RENDER_DEFAULTS.cameraPitch);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;

  // The grid footprint is affine in (x, y), so its extremes live on the four
  // corner tiles. Project their corners onto the camera right/up/forward axes.
  let maxU = 0;
  let maxV = 0;
  let maxDepth = 0;
  for (const [ix, iy] of [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1],
  ] as const) {
    const c = tileGroundCorners(ix - cx, iy - cy);
    for (const corner of [c.nw, c.ne, c.se, c.sw]) {
      const p: Vec3 = [-corner.east, 0, corner.north]; // scene: +X = west, +Z = north
      maxU = Math.max(maxU, Math.abs(dot(p, r)));
      maxV = Math.max(maxV, Math.abs(dot(p, u)));
      maxDepth = Math.max(maxDepth, Math.abs(dot(p, f)));
    }
  }

  const halfW = Math.max(maxU * pad, 1);
  const halfH = Math.max(maxV * pad, 1);
  const distance = (maxDepth + Math.max(halfW, halfH)) * 4 + 1000;
  return {
    halfW,
    halfH,
    dir: [-f[0], -f[1], -f[2]],
    distance,
    near: 1,
    far: distance * 4,
  };
}
