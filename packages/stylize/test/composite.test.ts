import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildComposite, contextWidths } from '../src/composite';
import { TILE_SIZE } from '../src/constants';

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

describe('contextWidths', () => {
  it('all four neighbours present → base on each side', () => {
    expect(contextWidths(true, true, true, true, 102)).toEqual({
      topH: 102,
      botH: 102,
      leftW: 102,
      rightW: 102,
    });
  });

  it('N missing, S present → S doubles to stay square', () => {
    expect(contextWidths(false, true, false, false, 102)).toEqual({
      topH: 0,
      botH: 204,
      leftW: 0,
      rightW: 0,
    });
  });

  it('only N present → N doubles, no side context', () => {
    expect(contextWidths(true, false, false, false, 102)).toEqual({
      topH: 204,
      botH: 0,
      leftW: 0,
      rightW: 0,
    });
  });

  it('W missing, E present → E doubles', () => {
    expect(contextWidths(false, false, false, true, 102)).toEqual({
      topH: 0,
      botH: 0,
      leftW: 0,
      rightW: 204,
    });
  });
});

describe('buildComposite', () => {
  it('seed (no neighbours): bbox spans the full tile; centre is the render', async () => {
    const render = await solid(128, 128, 128);
    const { bbox, composite } = await buildComposite(render, {});
    expect(bbox).toEqual([0, 0, TILE_SIZE, TILE_SIZE]);
    expect(await pixel(composite, 512, 512)).toEqual([128, 128, 128]);
  });

  it('N + W present: bbox offsets by doubled context; strips + NW corner land correctly', async () => {
    const render = await solid(128, 128, 128);
    const north = await solid(0, 0, 255); // blue
    const west = await solid(0, 255, 0); // green
    const { bbox, composite } = await buildComposite(render, { north, west }); // base=102
    // leftW=204 (W doubled, no E), topH=204 (N doubled, no S), centre 820²
    expect(bbox).toEqual([204, 204, TILE_SIZE, TILE_SIZE]);
    expect(await pixel(composite, 600, 600)).toEqual([128, 128, 128]); // centre = render
    expect(await pixel(composite, 500, 50)).toEqual([0, 0, 255]); // north strip (top band)
    expect(await pixel(composite, 50, 600)).toEqual([0, 255, 0]); // west strip (left band)
    expect(await pixel(composite, 50, 50)).toEqual([0, 0, 255]); // NW corner → fallback to north
  });

  it('only S present: top has no context, S strip doubles to keep it square', async () => {
    const render = await solid(128, 128, 128);
    const south = await solid(255, 0, 255); // magenta
    const { bbox, composite } = await buildComposite(render, { south }); // base=102, botH=204
    expect(bbox).toEqual([0, 0, TILE_SIZE, TILE_SIZE - 204]); // [0,0,1024,820]
    expect(await pixel(composite, 512, 950)).toEqual([255, 0, 255]); // S strip at bottom
    expect(await pixel(composite, 512, 400)).toEqual([128, 128, 128]); // centre
  });
});
