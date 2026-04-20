import sharp from 'sharp';
import type { GenerateParams, GenerateResult, ModelClient } from './types';

export class StubModel implements ModelClient {
  readonly name = 'stub';

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const start = Date.now();
    const meta = await sharp(params.input).metadata();
    const width = meta.width ?? 512;
    const height = meta.height ?? 512;

    const pixelSize = 8;
    const hueShift = ((params.seed ?? 0) * 37) % 360;

    const image = await sharp(params.input)
      .resize(
        Math.max(1, Math.floor(width / pixelSize)),
        Math.max(1, Math.floor(height / pixelSize)),
        {
          kernel: 'nearest',
        },
      )
      .resize(width, height, { kernel: 'nearest' })
      .modulate({ hue: hueShift, saturation: 1.3 })
      .png()
      .toBuffer();

    return {
      image,
      metadata: {
        model: this.name,
        prompt: params.prompt,
        seed: params.seed,
        durationMs: Date.now() - start,
      },
    };
  }
}
