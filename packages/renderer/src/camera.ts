import { tileWidthMeters } from '@mapart/geo';
import type { OrthographicCamera } from 'three';
import type { RenderParams } from './params';

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
