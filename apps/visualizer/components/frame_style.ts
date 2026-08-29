import type { CSSProperties } from 'react';

// Pixel-art gallery chrome: flat fills with hard (0-blur) stepped bevels and
// crisp dark outlines, sharp corners — like an 8-bit game window. No smooth
// gradients. `bevel` is the width of the highlight/shadow bands, so the same
// look scales from the wall-sized frame down to a thumbnail.
export const OUTLINE = '#241a09';

/** Gold moulding — the outermost piece of frame. */
export const goldFrame = (bevel: number, float: string): CSSProperties => ({
  background: '#c19a3a',
  boxShadow: [
    `0 0 0 3px ${OUTLINE}`, // outer pixel outline
    `inset ${bevel}px ${bevel}px 0 0 #ecd283`, // top-left highlight band
    `inset -${bevel}px -${bevel}px 0 0 #6f5018`, // bottom-right shadow band
    float,
  ].join(', '),
});

/** Cream mat, sitting inside the moulding. */
export const creamMat = (bevel: number): CSSProperties => ({
  background: '#f3ecd9',
  boxShadow: [
    `0 0 0 3px ${OUTLINE}`, // dark channel between gold and mat
    `inset ${bevel}px ${bevel}px 0 0 #fffaf0`,
    `inset -${bevel}px -${bevel}px 0 0 #d8cdaa`,
  ].join(', '),
});

/** Engraved brass nameplate. */
export const brassPlate: CSSProperties = {
  background: '#caa24e',
  boxShadow: [
    `0 0 0 2px ${OUTLINE}`,
    'inset 3px 3px 0 0 #e9cd7e',
    'inset -3px -3px 0 0 #7a5a22',
  ].join(', '),
};
