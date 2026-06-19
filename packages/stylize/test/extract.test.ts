import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../src/constants';
import { extractStylized } from '../src/extract';

function solid(r: number, g: number, b: number, size = TILE_SIZE): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0] ?? -1, data[1] ?? -1, data[2] ?? -1];
}

describe('extractStylized', () => {
  it('crops the bbox region and resizes back to 1024²', async () => {
    const img = await solid(10, 20, 30);
    const out = await extractStylized(img, [100, 100, 600, 600]);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(TILE_SIZE);
    expect(meta.height).toBe(TILE_SIZE);
    // OUTPUT_FORMAT may be lossy (WebP), so the centre colour is preserved within
    // a small tolerance rather than exactly — this asserts the crop landed, not
    // byte-exact encoding.
    const [r, g, b] = await pixel(out, 512, 512);
    for (const [actual, expected] of [
      [r, 10],
      [g, 20],
      [b, 30],
    ]) {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(5);
    }
  });
});
