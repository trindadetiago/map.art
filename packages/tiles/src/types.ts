import type { LatLng } from '@mapart/shared';

export interface TileCoord {
  x: number;
  y: number;
}

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Closed polygon in WGS84. First and last vertex should be equal (per GeoJSON convention); we normalize if not. */
export type Polygon = LatLng[];

export type { LatLng } from '@mapart/shared';
