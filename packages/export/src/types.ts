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
  generatedAt: string;
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
