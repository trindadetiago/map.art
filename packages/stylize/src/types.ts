/**
 * Already-stylized neighbour images keyed by direction. Any subset may be
 * present; a missing key means "no stylized neighbour on that side" — whether
 * that is a grid edge OR a neighbour not yet stylized (the worker collapses
 * both to absence). Buffers are PNG bytes, normalised to TILE_SIZE internally.
 */
export interface StylizedNeighbors {
  north?: Buffer;
  south?: Buffer;
  east?: Buffer;
  west?: Buffer;
  northeast?: Buffer;
  northwest?: Buffer;
  southeast?: Buffer;
  southwest?: Buffer;
}

/** Red-outlined central region: [left, top, right, bottom] in TILE_SIZE space. */
export type Bbox = [left: number, top: number, right: number, bottom: number];

export interface CompositeResult {
  /** 1024×1024 PNG: center render + edge strips + corner fills + 1px red box. */
  composite: Buffer;
  /** The region to crop back out of the model's output. */
  bbox: Bbox;
}
