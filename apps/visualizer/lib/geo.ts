import type { VizMetadata } from '@mapart/export/types';

/**
 * Convert a WGS84 coordinate to a point in the stitched raster's image space
 * (pixels, origin top-left), using the project's geo anchor. Returns `null` for
 * pyramids exported without geo anchoring.
 *
 * The anchor gives the grid offset from the `(minX, minY)` tile centre; the
 * pixel mapping mirrors the export stitch, where tile centres sit half a tile
 * in from the grid origin and the row axis is flipped (grid Y runs north, image
 * rows run top→down).
 */
export function latLngToImagePoint(
  meta: VizMetadata,
  lat: number,
  lng: number,
): { x: number; y: number } | null {
  const geo = meta.geo;
  if (!geo || geo.lngPerTileX === 0 || geo.latPerTileY === 0) return null;

  const dx = (lng - geo.anchorLng) / geo.lngPerTileX; // grid X offset from minX
  const dy = (lat - geo.anchorLat) / geo.latPerTileY; // grid Y offset from minY

  return {
    x: (dx + 0.5) * meta.sourceTileSize,
    y: (meta.gridHeight - 1 - dy + 0.5) * meta.sourceTileSize,
  };
}
