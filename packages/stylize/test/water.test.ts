import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectWaterMask, neutralizeWater, waterMaskToPng } from '../src/water';

const WATER = { r: 20, g: 40, b: 120 }; // blue/teal water
const LAND = { r: 40, g: 120, b: 30 }; // green vegetation

/** A WxH image: left half water-blue, right half land-green. */
async function halfWaterLand(width = 64, height = 64): Promise<Buffer> {
  const half = await sharp({
    create: { width: width / 2, height, channels: 3, background: WATER },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: LAND } })
    .composite([{ input: half, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

describe('detectWaterMask', () => {
  it('flags the water half and clears the land half', async () => {
    const img = await halfWaterLand(64, 64);
    const { mask, width, height, coverage } = await detectWaterMask(img);
    expect(width).toBe(64);
    expect(height).toBe(64);
    expect(coverage).toBeCloseTo(0.5, 2);
    expect(mask[20 * width + 10]).toBe(255); // left → water
    expect(mask[20 * width + 54]).toBe(0); // right → land
  });

  it('does not flag gray roofs or shadows as water', async () => {
    const roof = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 130, g: 130, b: 135 } },
    })
      .png()
      .toBuffer();
    const { coverage } = await detectWaterMask(roof);
    expect(coverage).toBe(0);
  });
});

/** Read one pixel's [r,g,b] from a PNG buffer. */
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf)
    .removeAlpha()
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0] ?? -1, data[1] ?? -1, data[2] ?? -1];
}

describe('neutralizeWater', () => {
  it('blurs a bright speck in water but leaves the land half untouched', async () => {
    // Left half water, right half land, plus a bright-blue speck inside the water
    // half. The speck stays classified as water (blue-dominant) so it sits inside
    // the mask, and the blur should pull its value toward the surrounding water.
    const base = await halfWaterLand(64, 64);
    const speck = await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 60, g: 120, b: 220 } },
    })
      .png()
      .toBuffer();
    const img = await sharp(base)
      .composite([{ input: speck, left: 13, top: 29 }])
      .png()
      .toBuffer();

    const out = await neutralizeWater(img);

    // x=63 is well clear of the x=32 boundary's ~3*MASK_FEATHER_SIGMA feather spread
    // Land half, far from the boundary → identical to the original green.
    expect(await pixel(out, 63, 32)).toEqual([40, 120, 30]);
    // Speck centre in the water half → bright blue pulled down by the blur.
    const [, , b] = await pixel(out, 16, 32);
    expect(b).toBeLessThan(220);
  });
});

describe('waterMaskToPng', () => {
  it('renders the mask as a single-channel PNG of the same size', async () => {
    const img = await halfWaterLand(64, 64);
    const water = await detectWaterMask(img);
    const png = await waterMaskToPng(water);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expect(meta.channels).toBe(1);
  });
});
