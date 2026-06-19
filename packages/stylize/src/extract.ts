import sharp from 'sharp';
import { TILE_SIZE } from './constants';
import { OUTPUT_FORMAT } from './format';
import type { Bbox } from './types';

/** Crop the red-outlined region from a model output and resize to 1024². */
export async function extractStylized(modelOutput: Buffer, bbox: Bbox): Promise<Buffer> {
  const [left, top, right, bottom] = bbox;
  return OUTPUT_FORMAT.encode(
    sharp(modelOutput)
      .extract({ left, top, width: right - left, height: bottom - top })
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' }),
  ).toBuffer();
}
