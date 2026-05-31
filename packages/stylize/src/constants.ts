/** Canonical tile edge length the algorithm works in (px). */
export const TILE_SIZE = 1024;

/** Default neighbour-strip width as a % of TILE_SIZE (10% → 102px). */
export const DEFAULT_CONTEXT_PCT = 10;

/** The prompt the LoRA was trained with; the stub ignores it, the real model needs it verbatim. */
export const STYLIZE_PROMPT =
  'Fill in the outlined section with the missing pixels corresponding to the ' +
  '<mapart isometric pixel art> style, removing the border and exactly ' +
  'following the shape/style/structure of the surrounding image.';
