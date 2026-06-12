import { type ModelName, getModel } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import sharp from 'sharp';

const INFILL_SIZE = 1024;
const SLOT_SIZE = Math.floor(INFILL_SIZE / 3); // 341

const NEIGHBOR_OFFSETS = [
  { dc: -1, dr: 1 },
  { dc: 0, dr: 1 },
  { dc: 1, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: -1, dr: -1 },
  { dc: 0, dr: -1 },
  { dc: 1, dr: -1 },
];

function renderedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/rendered/${col}_${row}.png`;
}

function generatedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/generated/manual/${col}_${row}.png`;
}

export interface GenerateJobPayload {
  prompt: string;
  apiKey: string;
  slotSize?: number;
  finalTileSize?: number;
}

export async function generateTile(
  projectId: string,
  col: number,
  row: number,
  modelId: string,
  payload: GenerateJobPayload,
): Promise<Buffer> {
  const storage = getStorage();
  const slotSize = payload.slotSize ?? SLOT_SIZE;
  const finalTileSize = payload.finalTileSize ?? INFILL_SIZE;

  const renderedKey = renderedTileKey(projectId, col, row);
  const renderedBuffer = await storage.get(renderedKey);
  if (!renderedBuffer) throw new Error(`rendered tile not found: ${renderedKey}`);

  const neighborBuffers: Array<{ dc: number; dr: number; buffer: Buffer }> = [];
  for (const n of NEIGHBOR_OFFSETS) {
    try {
      const nKey = generatedTileKey(projectId, col + n.dc, row + n.dr);
      if (await storage.has(nKey)) {
        const nBuf = await storage.get(nKey);
        neighborBuffers.push({ ...n, buffer: nBuf });
      }
    } catch {
      // neighbor doesn't exist yet — skip
    }
  }

  const { hybrid, mask } = await buildInfillComposite(renderedBuffer, neighborBuffers, slotSize);

  const model = getModel(modelId as ModelName, { apiKey: payload.apiKey });
  const result = await model.generate({
    input: hybrid,
    mask,
    prompt: payload.prompt,
  });

  const cropped = await sharp(result.image)
    .extract({ left: slotSize, top: slotSize, width: slotSize, height: slotSize })
    .png()
    .toBuffer();

  if (finalTileSize !== slotSize) {
    return sharp(cropped).resize(finalTileSize, finalTileSize, { fit: 'fill' }).png().toBuffer();
  }

  return cropped;
}

async function buildInfillComposite(
  renderedTile: Buffer,
  neighbors: Array<{ dc: number; dr: number; buffer: Buffer }>,
  slotSize: number,
): Promise<{ hybrid: Buffer; mask: Buffer }> {
  const H = INFILL_SIZE;
  const S = slotSize;

  const base = sharp({
    create: { width: H, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  });

  const composites: sharp.OverlayOptions[] = [
    { input: await resizeToSlot(renderedTile, S), top: S, left: S },
  ];

  for (const n of neighbors) {
    const slotX = (1 + n.dc) * S;
    const slotY = (1 - n.dr) * S;
    composites.push({
      input: await resizeToSlot(n.buffer, S),
      top: slotY,
      left: slotX,
    });
  }

  const hybrid = await base.composite(composites).png().toBuffer();

  // Mask: white everywhere except the center slot which is transparent.
  // OpenAI's edit API uses the alpha channel to determine the editable area.
  const maskPixels = Buffer.alloc(H * H * 4, 255);
  for (let y = S; y < S * 2; y++) {
    const rowStart = y * H * 4;
    for (let x = S; x < S * 2; x++) {
      maskPixels[rowStart + x * 4 + 3] = 0;
    }
  }
  const mask = await sharp(maskPixels, {
    raw: { width: H, height: H, channels: 4 },
  })
    .png()
    .toBuffer();

  return { hybrid, mask };
}

async function resizeToSlot(buf: Buffer, targetSize: number): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  if (meta.width === targetSize && meta.height === targetSize) return buf;
  return sharp(buf).resize(targetSize, targetSize, { fit: 'fill' }).png().toBuffer();
}
