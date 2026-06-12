import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { TilesRenderer } from '3d-tiles-renderer/three';
import {
  ReorientationPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/three/plugins';
import type { LatLng } from '@mapart/geo';

export interface CreateTilesRendererOptions {
  /** Google Maps Platform API key with Map Tiles API enabled. */
  apiKey: string;
  /** Geographic anchor — the lat/lng that ReorientationPlugin maps to (0, 0, 0). */
  center: LatLng;
}

export interface ConfiguredTilesRenderer {
  tiles: TilesRenderer;
  /** Exposed so callers can call `transformLatLonHeightToOrigin` on camera moves. */
  reorient: ReorientationPlugin;
}

/**
 * A `TilesRenderer` pre-wired with the four plugins we always want for
 * Google Photorealistic 3D Tiles: auth, reorientation, compression, and
 * update-on-change. The caller is responsible for `setCamera`,
 * `setResolutionFromRenderer`, the render loop, and disposal.
 */
export function createTilesRenderer(opts: CreateTilesRendererOptions): ConfiguredTilesRenderer {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new GoogleCloudAuthPlugin({ apiToken: opts.apiKey, autoRefreshToken: true }),
  );
  const reorient = new ReorientationPlugin({
    lat: opts.center.lat * (Math.PI / 180),
    lon: opts.center.lng * (Math.PI / 180),
    height: 0,
    recenter: true,
  });
  tiles.registerPlugin(reorient);
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UpdateOnChangePlugin());
  return { tiles, reorient };
}

/** Re-center an already-configured reorient plugin on a new lat/lng. */
export function reorientTo(reorient: ReorientationPlugin, center: LatLng): void {
  reorient.transformLatLonHeightToOrigin(
    center.lat * (Math.PI / 180),
    center.lng * (Math.PI / 180),
    0,
  );
}
