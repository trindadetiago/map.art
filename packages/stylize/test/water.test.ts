import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectWaterMask } from '../src/water';

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
