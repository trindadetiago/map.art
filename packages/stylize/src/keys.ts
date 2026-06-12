/**
 * Storage-key layout for the stylize pipeline.
 *
 * The final output lives at a flat `stylize/{pid}/{x}_{y}.{ext}` key — `ext` set
 * by OUTPUT_FORMAT — and is also recorded on the tile row as `stylizedImgPath`.
 * The intermediate steps — the composite
 * actually fed to the model and the model's raw output before cropping — live
 * under a per-tile `stylize-steps/{pid}/{x}_{y}/` prefix, so a single tile's whole
 * history is derivable from `(projectId, x, y)` without any DB columns to track them.
 */

import { OUTPUT_FORMAT } from './format';

/** Storage key for a tile's final (cropped) stylized output. */
export function stylizeKey(projectId: string, x: number, y: number): string {
  return `stylize/${projectId}/${x}_${y}.${OUTPUT_FORMAT.ext}`;
}

/** The intermediate pipeline artifacts saved per tile, in pipeline order. */
export const STYLIZE_STEPS = ['composite', 'raw-output'] as const;
export type StylizeStep = (typeof STYLIZE_STEPS)[number];

/** Storage key for one intermediate stylize artifact of a tile. */
export function stylizeStepKey(projectId: string, x: number, y: number, step: StylizeStep): string {
  return `stylize-steps/${projectId}/${x}_${y}/${step}.png`;
}
