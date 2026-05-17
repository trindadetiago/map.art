import sharp from 'sharp';

export interface StitchTile {
  col: number;
  row: number;
  png: Buffer;
}

export interface StitchResult {
  image: Buffer;
  minCol: number;
  minRow: number;
  cols: number;
  rows: number;
  pixelSize: number;
}

/**
 * Stitch a set of (col, row) PNGs into one composite image.
 *
 * Layout convention:
 *   - +col (camera-right) → grows rightward on screen.
 *   - +row (camera-forward, away into the distance) → grows UPWARD on screen,
 *     so further-from-camera tiles sit at the top of the stitched image.
 */
export async function stitchTiles(
  tiles: readonly StitchTile[],
  pixelSize: number,
): Promise<StitchResult> {
  if (tiles.length === 0) throw new Error('stitchTiles: empty tile list');

  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  for (const t of tiles) {
    if (t.col < minCol) minCol = t.col;
    if (t.col > maxCol) maxCol = t.col;
    if (t.row < minRow) minRow = t.row;
    if (t.row > maxRow) maxRow = t.row;
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const width = cols * pixelSize;
  const height = rows * pixelSize;

  // Model outputs (e.g. Gemini) can arrive at arbitrary resolutions, so
  // normalize each tile to pixelSize before compositing — otherwise an
  // oversized tile spills into its neighbor's slot.
  const composite = await Promise.all(
    tiles.map(async (t) => ({
      input: await sharp(t.png).resize(pixelSize, pixelSize, { fit: 'fill' }).png().toBuffer(),
      left: (t.col - minCol) * pixelSize,
      // row+ grows upward, so invert for image-space top coordinate.
      top: (maxRow - t.row) * pixelSize,
    })),
  );

  const image = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png()
    .toBuffer();

  return { image, minCol, minRow, cols, rows, pixelSize };
}

/**
 * Overlay vertical and horizontal seam lines at tile boundaries on top of a
 * stitched image. Useful for eyeballing seam quality across a composite.
 */
export async function overlaySeams(
  stitched: StitchResult,
  opts: { color?: string; thickness?: number } = {},
): Promise<Buffer> {
  const color = opts.color ?? '#dc2626';
  const thickness = opts.thickness ?? 2;
  const { cols, rows, pixelSize } = stitched;
  const width = cols * pixelSize;
  const height = rows * pixelSize;

  const svgLines: string[] = [];
  for (let c = 1; c < cols; c++) {
    const x = c * pixelSize;
    svgLines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${color}" stroke-width="${thickness}" />`,
    );
  }
  for (let r = 1; r < rows; r++) {
    const y = r * pixelSize;
    svgLines.push(
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" stroke-width="${thickness}" />`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgLines.join('')}</svg>`;

  return sharp(stitched.image)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
