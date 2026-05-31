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
    expect(await pixel(out, 512, 512)).toEqual([10, 20, 30]);
  });
});
