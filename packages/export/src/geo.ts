import type { VizGeoAnchor } from './types';

/**
 * Fit a linear map from grid coordinates to WGS84 by least squares over the
 * tile centres. Longitude regresses on grid X and latitude on grid Y (the grid
 * is mercator-aligned, so the cross terms are negligible). The anchor is the
 * fit evaluated at `(minX, minY)` — the grid cell the stitch is anchored on.
 *
 * A project one tile wide or tall has no spread on that axis to fit, so the
 * step is recovered from the other axis: tiles are square on the ground, and at
 * latitude φ a degree of longitude spans `cos(φ)` of a degree of latitude.
 */
export function computeGeoAnchor(
  tiles: { x: number; y: number; lat: number; lng: number }[],
  minX: number,
  minY: number,
): VizGeoAnchor {
  const n = tiles.length;
  const meanX = tiles.reduce((s, t) => s + t.x, 0) / n;
  const meanY = tiles.reduce((s, t) => s + t.y, 0) / n;
  const meanLat = tiles.reduce((s, t) => s + t.lat, 0) / n;
  const meanLng = tiles.reduce((s, t) => s + t.lng, 0) / n;

  let varX = 0;
  let varY = 0;
  let covXLng = 0;
  let covYLat = 0;
  for (const t of tiles) {
    const dx = t.x - meanX;
    const dy = t.y - meanY;
    varX += dx * dx;
    varY += dy * dy;
    covXLng += dx * (t.lng - meanLng);
    covYLat += dy * (t.lat - meanLat);
  }

  let lngPerTileX = varX > 0 ? covXLng / varX : 0;
  let latPerTileY = varY > 0 ? covYLat / varY : 0;

  const cosLat = Math.cos((meanLat * Math.PI) / 180) || 1;
  if (lngPerTileX === 0 && latPerTileY !== 0) {
    lngPerTileX = Math.abs(latPerTileY) / cosLat;
  } else if (latPerTileY === 0 && lngPerTileX !== 0) {
    latPerTileY = Math.abs(lngPerTileX) * cosLat;
  }

  return {
    anchorLat: meanLat + latPerTileY * (minY - meanY),
    anchorLng: meanLng + lngPerTileX * (minX - meanX),
    latPerTileY,
    lngPerTileX,
  };
}

/**
 * Grid offset from the `(minX, minY)` anchor tile → WGS84. `dx`/`dy` are in tile
 * units (grid X east, grid Y north) and may be fractional.
 */
export function gridOffsetToLatLng(
  geo: VizGeoAnchor,
  dx: number,
  dy: number,
): { lat: number; lng: number } {
  return {
    lat: geo.anchorLat + dy * geo.latPerTileY,
    lng: geo.anchorLng + dx * geo.lngPerTileX,
  };
}

/**
 * WGS84 → grid offset (in tile units) from the `(minX, minY)` anchor tile.
 * Inverse of {@link gridOffsetToLatLng}; returns `null` for a degenerate anchor.
 */
export function latLngToGridOffset(
  geo: VizGeoAnchor,
  lat: number,
  lng: number,
): { dx: number; dy: number } | null {
  if (geo.lngPerTileX === 0 || geo.latPerTileY === 0) return null;
  return {
    dx: (lng - geo.anchorLng) / geo.lngPerTileX,
    dy: (lat - geo.anchorLat) / geo.latPerTileY,
  };
}
