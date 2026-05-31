import sharp from 'sharp';
import { DEFAULT_CONTEXT_PCT, TILE_SIZE } from './constants';
import type { Bbox, CompositeResult, StylizedNeighbors } from './types';

/**
 * Pixel widths of each context band, ported from the Python `context_widths`.
 * A missing side contributes 0 there but doubles the present opposite side, so
 * the composite stays square without padding.
 */
export function contextWidths(
  hasN: boolean,
  hasS: boolean,
  hasW: boolean,
  hasE: boolean,
  base: number,
): { topH: number; botH: number; leftW: number; rightW: number } {
  let topH = hasN ? base : 0;
  let botH = hasS ? base : 0;
  let leftW = hasW ? base : 0;
  let rightW = hasE ? base : 0;
  if (!hasN && hasS) botH = 2 * base;
  if (!hasS && hasN) topH = 2 * base;
  if (!hasW && hasE) rightW = 2 * base;
  if (!hasE && hasW) leftW = 2 * base;
  return { topH, botH, leftW, rightW };
}

/** Normalise a neighbour to the canonical 1024² so edge crops use absolute coords. */
function norm(buf: Buffer): Promise<Buffer> {
  return sharp(buf).resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' }).toBuffer();
}

/** Crop a [left,top,width,height] region from a 1024² buffer and resize it. */
function crop(
  buf: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  toW: number,
  toH: number,
): Promise<Buffer> {
  return sharp(buf)
    .extract({ left, top, width, height })
    .resize(toW, toH, { fit: 'fill' })
    .toBuffer();
}

/**
 * Port of Algorithm A's `build_composite`. Returns a 1024² composite — center
 * render + thin strips cropped from each present stylized neighbour edge +
 * diagonal corner fills + a 1px red box around the central region — plus the
 * bbox of that central region for `extractStylized` to crop back out.
 */
export async function buildComposite(
  render: Buffer,
  neighbors: StylizedNeighbors,
  opts: { contextPct?: number } = {},
): Promise<CompositeResult> {
  const base = Math.round((TILE_SIZE * (opts.contextPct ?? DEFAULT_CONTEXT_PCT)) / 100);

  const hasN = neighbors.north !== undefined;
  const hasS = neighbors.south !== undefined;
  const hasW = neighbors.west !== undefined;
  const hasE = neighbors.east !== undefined;
  const { topH, botH, leftW, rightW } = contextWidths(hasN, hasS, hasW, hasE, base);
  const centerW = TILE_SIZE - leftW - rightW;
  const centerH = TILE_SIZE - topH - botH;

  const N = neighbors.north ? await norm(neighbors.north) : null;
  const S = neighbors.south ? await norm(neighbors.south) : null;
  const W = neighbors.west ? await norm(neighbors.west) : null;
  const E = neighbors.east ? await norm(neighbors.east) : null;
  const NW = neighbors.northwest ? await norm(neighbors.northwest) : null;
  const NE = neighbors.northeast ? await norm(neighbors.northeast) : null;
  const SW = neighbors.southwest ? await norm(neighbors.southwest) : null;
  const SE = neighbors.southeast ? await norm(neighbors.southeast) : null;

  const overlays: sharp.OverlayOptions[] = [];

  // Center = the raw render, resized into the central region.
  overlays.push({
    input: await sharp(render).resize(centerW, centerH, { fit: 'fill' }).toBuffer(),
    left: leftW,
    top: topH,
  });

  // Edge strips — the neighbour edge adjacent to this tile.
  if (N)
    overlays.push({
      input: await crop(N, 0, TILE_SIZE - topH, TILE_SIZE, topH, centerW, topH),
      left: leftW,
      top: 0,
    });
  if (S)
    overlays.push({
      input: await crop(S, 0, 0, TILE_SIZE, botH, centerW, botH),
      left: leftW,
      top: topH + centerH,
    });
  if (W)
    overlays.push({
      input: await crop(W, TILE_SIZE - leftW, 0, leftW, TILE_SIZE, leftW, centerH),
      left: 0,
      top: topH,
    });
  if (E)
    overlays.push({
      input: await crop(E, 0, 0, rightW, TILE_SIZE, rightW, centerH),
      left: leftW + centerW,
      top: topH,
    });

  // Corner fills — diagonal neighbour's matching corner if stylized, else
  // extend the adjacent edge neighbour. Only runs when both strips exist (>0).
  const corner = async (
    cw: number,
    ch: number,
    dstLeft: number,
    dstTop: number,
    diag: Buffer | null,
    diagBox: [number, number, number, number],
    edge: Buffer | null,
    edgeBox: [number, number, number, number],
  ): Promise<void> => {
    if (cw <= 0 || ch <= 0) return;
    let src: Buffer | null = null;
    if (diag) src = await crop(diag, diagBox[0], diagBox[1], diagBox[2], diagBox[3], cw, ch);
    else if (edge) src = await crop(edge, edgeBox[0], edgeBox[1], edgeBox[2], edgeBox[3], cw, ch);
    if (src) overlays.push({ input: src, left: dstLeft, top: dstTop });
  };
  await corner(leftW, topH, 0, 0, NW, [TILE_SIZE - leftW, TILE_SIZE - topH, leftW, topH], N, [
    0,
    TILE_SIZE - topH,
    leftW,
    topH,
  ]);
  await corner(rightW, topH, leftW + centerW, 0, NE, [0, TILE_SIZE - topH, rightW, topH], N, [
    TILE_SIZE - rightW,
    TILE_SIZE - topH,
    rightW,
    topH,
  ]);
  await corner(leftW, botH, 0, topH + centerH, SW, [TILE_SIZE - leftW, 0, leftW, botH], S, [
    0,
    0,
    leftW,
    botH,
  ]);
  await corner(rightW, botH, leftW + centerW, topH + centerH, SE, [0, 0, rightW, botH], S, [
    TILE_SIZE - rightW,
    0,
    rightW,
    botH,
  ]);

  // 1px red box around the central region — four crisp filled lines (PIL parity).
  const bbox: Bbox = [leftW, topH, leftW + centerW, topH + centerH];
  const [bl, bt, br, bb] = bbox;
  const svg = Buffer.from(
    `<svg width="${TILE_SIZE}" height="${TILE_SIZE}"><rect x="${bl}" y="${bt}" width="${br - bl}" height="1" fill="rgb(255,0,0)"/><rect x="${bl}" y="${bb - 1}" width="${br - bl}" height="1" fill="rgb(255,0,0)"/><rect x="${bl}" y="${bt}" width="1" height="${bb - bt}" fill="rgb(255,0,0)"/><rect x="${br - 1}" y="${bt}" width="1" height="${bb - bt}" fill="rgb(255,0,0)"/></svg>`,
  );
  overlays.push({ input: svg, left: 0, top: 0 });

  const composite = await sharp({
    create: { width: TILE_SIZE, height: TILE_SIZE, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite(overlays)
    .png()
    .toBuffer();

  return { composite, bbox };
}
