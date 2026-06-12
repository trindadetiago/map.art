import type { Sharp } from 'sharp';

/**
 * Single source of truth for the stylize pipeline's final output format.
 *
 * The encoder (how the bytes are produced) and the key extension (how the object
 * is named, and therefore which content type the storage-serving route hands
 * back) both derive from one descriptor, so the two can never drift apart and
 * switching formats is a one-line change to OUTPUT_FORMAT.
 *
 * Reading stays format-agnostic regardless of this choice: sharp detects the
 * format from the bytes when loading neighbours, and the serving route maps any
 * extension to its content type — so objects written in an earlier format keep
 * serving correctly alongside newer ones.
 */
export interface OutputFormat {
  /** File extension (no leading dot) used in the storage key. */
  readonly ext: string;
  /** Apply this format's encoder settings to a sharp pipeline. */
  encode(pipeline: Sharp): Sharp;
}

/** Lossy WebP — ~93% smaller than truecolour PNG at visually-identical quality. */
export const WEBP_OUTPUT: OutputFormat = {
  ext: 'webp',
  encode: (p) => p.webp({ quality: 90, effort: 6 }),
};

/** Indexed-colour PNG — lossless for a limited palette, ~80% smaller otherwise. */
export const PNG_OUTPUT: OutputFormat = {
  ext: 'png',
  encode: (p) => p.png({ palette: true, dither: 0, compressionLevel: 9, effort: 10 }),
};

/** The format new stylized outputs are written and keyed in. */
export const OUTPUT_FORMAT: OutputFormat = WEBP_OUTPUT;
