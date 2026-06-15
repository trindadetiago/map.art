import sharp from 'sharp';

/**
 * Minimum amount the blue channel must exceed the red channel for a pixel to
 * read as water. Keeps near-gray roofs/shadows (b ≈ r) out of the mask.
 */
export const MIN_BLUE_DOMINANCE = 15;

/**
 * Blue must be at least this fraction of green. Catches teal water (green high
 * too) while rejecting vegetation, where blue sits far below green.
 */
export const MIN_BLUE_GREEN_RATIO = 0.7;

export interface WaterMask {
  /** Single-channel (0 or 255) buffer, row-major, length width*height. */
  mask: Buffer;
  width: number;
  height: number;
  /** Fraction of pixels classified as water, 0..1. */
  coverage: number;
}

/**
 * Classify each pixel of an aerial render as water (255) or not (0) using a
 * simple color rule: blue clearly dominant over red AND not far below green.
 * Tuned to split blue/teal water from green vegetation, sand, gray roofs and
 * shadows.
 */
export async function detectWaterMask(image: Buffer): Promise<WaterMask> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const mask = Buffer.alloc(width * height);
  let waterPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * channels] ?? 0;
    const g = data[i * channels + 1] ?? 0;
    const b = data[i * channels + 2] ?? 0;
    const isWater = b - r >= MIN_BLUE_DOMINANCE && b >= g * MIN_BLUE_GREEN_RATIO;
    if (isWater) {
      mask[i] = 255;
      waterPixels++;
    }
  }
  return { mask, width, height, coverage: waterPixels / (width * height) };
}

/** Gaussian sigma applied to the water region to kill island-triggering texture. */
export const WATER_BLUR_SIGMA = 8;

/** Sigma the mask is softened by, so the water/coast boundary blends smoothly. */
export const MASK_FEATHER_SIGMA = 6;

/**
 * Return a copy of the render with its water region blurred (texture removed) and
 * the rest untouched. The water mask is feathered so the coastline blends instead
 * of hard-cutting. Pass a precomputed mask to avoid re-detecting.
 */
export async function neutralizeWater(
  image: Buffer,
  water?: WaterMask,
  opts: { blurSigma?: number } = {},
): Promise<Buffer> {
  const { mask, width, height } = water ?? (await detectWaterMask(image));
  const raw = { width, height, channels: 1 as const };

  // Soften the mask edges → used as the alpha of the blurred layer.
  const feathered = await sharp(mask, { raw }).blur(MASK_FEATHER_SIGMA).raw().toBuffer();

  // A fully-blurred copy of the render, masked to water-only via the feathered alpha.
  const blurredWater = await sharp(image)
    .removeAlpha()
    .blur(opts.blurSigma ?? WATER_BLUR_SIGMA)
    .joinChannel(feathered, { raw })
    .png()
    .toBuffer();

  // Lay the masked blur over the original: water gets blurred, land shows through.
  return sharp(image)
    .removeAlpha()
    .composite([{ input: blurredWater }])
    .png()
    .toBuffer();
}

/** Render a water mask as an inspectable single-channel PNG. */
export function waterMaskToPng(water: WaterMask): Promise<Buffer> {
  return sharp(water.mask, { raw: { width: water.width, height: water.height, channels: 1 } })
    .png()
    .toBuffer();
}
