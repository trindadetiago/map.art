import { latLngToTile, tileToBounds, tileToCenter } from './coords';
import type { Bbox, Polygon, TileCoord } from './types';

/** Integer tile coords covered by a bbox at the given zoom. Inclusive of edges. */
export function bboxToTiles(bbox: Bbox, zoom: number): TileCoord[] {
  const nw = latLngToTile(bbox.north, bbox.west, zoom);
  const se = latLngToTile(bbox.south, bbox.east, zoom);
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  const out: TileCoord[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      out.push({ x, y });
    }
  }
  return out;
}

/** Tiles whose area overlaps the polygon at the given zoom. Uses ray-casting point-in-polygon with 5 test points per tile (4 corners + center), so it slightly over-covers edges — correct for seeding but not for exact-geometry queries. */
export function polygonToTiles(polygon: Polygon, zoom: number): TileCoord[] {
  if (polygon.length < 3) return [];
  const bbox = polygonBbox(polygon);
  const candidates = bboxToTiles(bbox, zoom);
  const out: TileCoord[] = [];
  for (const c of candidates) {
    const tileBbox = tileToBounds(c.x, c.y, zoom);
    const center = tileToCenter(c.x, c.y, zoom);
    const testPoints: [number, number][] = [
      [center.lng, center.lat],
      [tileBbox.west, tileBbox.north],
      [tileBbox.east, tileBbox.north],
      [tileBbox.east, tileBbox.south],
      [tileBbox.west, tileBbox.south],
    ];
    const hit = testPoints.some((p) => pointInPolygon(p[0], p[1], polygon));
    if (hit) {
      out.push(c);
      continue;
    }
    // Additional check: any polygon vertex inside the tile bbox.
    const anyVertexInside = polygon.some(
      (v) =>
        v.lng >= tileBbox.west &&
        v.lng <= tileBbox.east &&
        v.lat >= tileBbox.south &&
        v.lat <= tileBbox.north,
    );
    if (anyVertexInside) out.push(c);
  }
  return out;
}

/** Tightly fit a bbox around a polygon. */
export function polygonBbox(polygon: Polygon): Bbox {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const { lat, lng } of polygon) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/** Serialize a polygon to PostGIS WKT. Closes the ring if not already closed. */
export function polygonToWkt(polygon: Polygon): string {
  if (polygon.length < 3) throw new Error('polygonToWkt: need at least 3 vertices');
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (!first || !last) throw new Error('polygonToWkt: unexpected empty slot');
  const closed = first.lat === last.lat && first.lng === last.lng ? polygon : [...polygon, first];
  const coords = closed.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `POLYGON((${coords}))`;
}

/** Convert a bbox into a closed 5-vertex polygon (NW, NE, SE, SW, NW). */
export function bboxToPolygon(bbox: Bbox): Polygon {
  return [
    { lng: bbox.west, lat: bbox.north },
    { lng: bbox.east, lat: bbox.north },
    { lng: bbox.east, lat: bbox.south },
    { lng: bbox.west, lat: bbox.south },
    { lng: bbox.west, lat: bbox.north },
  ];
}

/** Tessellate a circle (center + radius meters) into a polygon. */
export function circleToPolygon(
  center: { lat: number; lng: number },
  radiusMeters: number,
  steps = 64,
): Polygon {
  const earthRadius = 6378137;
  const out: Polygon = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const d = radiusMeters / earthRadius;
    const lat1 = (center.lat * Math.PI) / 180;
    const lng1 = (center.lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    out.push({ lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI });
  }
  return out;
}

/** Ray-casting point-in-polygon. Polygon is [{ lat, lng }]; treated as [lng, lat] (x, y) coords. */
function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const xi = pi.lng;
    const yi = pi.lat;
    const xj = pj.lng;
    const yj = pj.lat;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-16) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
