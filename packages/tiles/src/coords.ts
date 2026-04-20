import type { Bbox, LatLng, TileCoord } from './types';

/** Convert a WGS84 lat/lng to web-mercator tile coordinates at the given integer zoom. */
export function latLngToTile(lat: number, lng: number, zoom: number): TileCoord {
  const z = Math.floor(zoom);
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const yRaw = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const y = Math.floor(yRaw);
  return {
    x: clamp(x, 0, n - 1),
    y: clamp(y, 0, n - 1),
  };
}

/** North-west corner of a tile in WGS84. */
export function tileToNW(x: number, y: number, zoom: number): LatLng {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (latRad * 180) / Math.PI, lng };
}

/** WGS84 bounding box of a tile. */
export function tileToBounds(x: number, y: number, zoom: number): Bbox {
  const nw = tileToNW(x, y, zoom);
  const se = tileToNW(x + 1, y + 1, zoom);
  return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
}

/** Geographic center of a tile (lat/lng). */
export function tileToCenter(x: number, y: number, zoom: number): LatLng {
  const b = tileToBounds(x, y, zoom);
  return { lat: (b.north + b.south) / 2, lng: (b.west + b.east) / 2 };
}

/** PostGIS WKT for a tile's bounds polygon. Use with `ST_GeomFromText(wkt, 4326)`. */
export function tileToBoundsWkt(x: number, y: number, zoom: number): string {
  const b = tileToBounds(x, y, zoom);
  return `POLYGON((${b.west} ${b.south}, ${b.east} ${b.south}, ${b.east} ${b.north}, ${b.west} ${b.north}, ${b.west} ${b.south}))`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
