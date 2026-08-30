/**
 * The pyramid (DZI/WebP tiles + this descriptor) is the only thing the
 * visualizer reads. It's a flat raster: there is no scene, no camera at view
 * time — just a deep-zoom image. Everything here is what OpenSeadragon needs to
 * reconstruct the tile source plus a sensible opening view.
 */
export interface VizMetadata {
  projectId: string;
  /** Full stitched-image dimensions, in pixels. */
  width: number;
  height: number;
  /** Pyramid tile edge (what dzsave sliced into), in pixels. */
  tileSize: number;
  /** Pyramid tile overlap, in pixels (0 — pixel art must not bleed across seams). */
  overlap: number;
  /** Tile image format, e.g. "webp". */
  format: string;
  /** Source grid extent (number of project tiles placed on each axis). */
  gridWidth: number;
  gridHeight: number;
  /** Edge of a single source tile on the stitched canvas, in pixels. */
  sourceTileSize: number;
  /** Which tile image fed the stitch. */
  source: VizSource;
  /**
   * Which export produced the pyramid this descriptor points at. Tiles live
   * under it, so a rebuild publishes new URLs instead of overwriting cached
   * ones. Absent on pyramids exported before versioning.
   */
  version?: string;
  /**
   * Linear map from WGS84 to the grid, fitted over the project's tile centres.
   * Lets the visualizer place lat/lng pins in image space without DB access.
   * Absent on pyramids exported before geo anchoring existed.
   */
  geo?: VizGeoAnchor;
  generatedAt: string;
}

/**
 * Affine fit relating grid coordinates to WGS84. The grid is mercator-aligned
 * (no rotation), so longitude tracks grid X and latitude tracks grid Y, each
 * with a near-constant step over a single project's extent.
 */
export interface VizGeoAnchor {
  /** Center lat/lng of the grid's `(minX, minY)` tile (the stitch's anchor). */
  anchorLat: number;
  anchorLng: number;
  /** Degrees of latitude gained per +1 step in grid Y (grid Y runs north). */
  latPerTileY: number;
  /** Degrees of longitude gained per +1 step in grid X (grid X runs east). */
  lngPerTileX: number;
}

/**
 * A labelled real-world point a project pins onto its map, in WGS84. Stored as
 * a JSON array at `viz/{projectId}/pins.json`; the visualizer renders each as an
 * overlay marker.
 */
export interface VizPin {
  lat: number;
  lng: number;
  label: string;
  /** Optional free-form category, surfaced as a `data-kind` for styling. */
  kind?: string;
}

/** Which per-tile image the pyramid was built from. */
export type VizSource = 'stylized' | 'rendered';

export interface ExportResult {
  projectId: string;
  source: VizSource;
  /** Source tiles placed onto the canvas (tiles missing the chosen image are skipped). */
  placed: number;
  /** Source tiles that had no image for `source` and were left as gaps. */
  skipped: number;
  width: number;
  height: number;
  /** Objects written to storage (pyramid tiles + descriptor + metadata). */
  uploaded: number;
  /** Storage prefix the pyramid was written under. */
  prefix: string;
}
