import sharp from 'sharp';
import type { GenerateParams, GenerateResult, ModelClient } from './types';

const EDITS_URL = 'https://api.openai.com/v1/images/edits';

export const OPENAI_IMAGE_MODELS = {
  'gpt-image-1.5': 'gpt-image-1.5',
  'gpt-image-2': 'gpt-image-2',
} as const;
export type OpenAIName = keyof typeof OPENAI_IMAGE_MODELS;

interface OpenAIImagesResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; type?: string };
}

export interface OpenAIImageModelOptions {
  name: string;
  apiKey: string;
  /** API model id (e.g. 'gpt-image-1', 'gpt-image-1.5'). Defaults to the value of `name`. */
  modelId?: string;
  /** Output size accepted by gpt-image-1. Defaults to '1024x1024'. */
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
}

/**
 * gpt-image-1 via OpenAI's /v1/images/edits endpoint. Image-to-image with an
 * optional mask. The model only accepts a fixed set of sizes; we resize the
 * output back down to the caller's input size so downstream code can stay
 * size-agnostic.
 */
export class OpenAIImageModel implements ModelClient {
  readonly name: string;
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly size: NonNullable<OpenAIImageModelOptions['size']>;

  constructor(opts: OpenAIImageModelOptions) {
    if (!opts.apiKey) throw new Error('OpenAIImageModel requires an apiKey');
    this.name = opts.name;
    this.modelId = opts.modelId ?? opts.name;
    this.apiKey = opts.apiKey;
    this.size = opts.size ?? '1024x1024';
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const start = Date.now();

    // gpt-image-1 expects square PNG ≤25MB, multiples of 256 in width. Pad/resize
    // is the caller's job — we just check it's PNG-ish and forward.
    const form = new FormData();
    form.append('model', this.modelId);
    form.append('prompt', params.prompt);
    form.append('n', '1');
    form.append('size', this.size);
    form.append(
      'image',
      new Blob([new Uint8Array(params.input)], { type: 'image/png' }),
      'input.png',
    );
    if (params.mask) {
      form.append(
        'mask',
        new Blob([new Uint8Array(params.mask)], { type: 'image/png' }),
        'mask.png',
      );
    }

    const res = await fetch(EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as OpenAIImagesResponse;
    if (json.error) {
      throw new Error(`OpenAI error: ${json.error.message ?? JSON.stringify(json.error)}`);
    }
    const b64 = json.data?.[0]?.b64_json;
    const url = json.data?.[0]?.url;
    let raw: Buffer;
    if (b64) {
      raw = Buffer.from(b64, 'base64');
    } else if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`OpenAI image fetch ${r.status}`);
      raw = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error(`OpenAI returned no image: ${JSON.stringify(json).slice(0, 500)}`);
    }

    // Resize back to the caller's input dimensions so the pipeline's tile size
    // is preserved regardless of which 'size' the model produced.
    const inputMeta = await sharp(params.input).metadata();
    const outW = inputMeta.width ?? 1024;
    const outH = inputMeta.height ?? 1024;
    const image = await sharp(raw).resize(outW, outH, { fit: 'fill' }).png().toBuffer();

    return {
      image,
      rawImage: raw,
      metadata: {
        model: this.name,
        prompt: params.prompt,
        seed: params.seed,
        durationMs: Date.now() - start,
      },
    };
  }
}
