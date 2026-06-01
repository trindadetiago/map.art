import sharp from 'sharp';
import type { GenerateParams, GenerateResult, ModelClient } from './types';

/** Deployed-model edit endpoint on hub.oxen.ai. */
const DEFAULT_ENDPOINT = 'https://hub.oxen.ai/api/images/edit';
const DEFAULT_STEPS = 28;

interface OxenEditResponse {
  images?: Array<{ url?: string; b64_json?: string }>;
  data?: Array<{ url?: string; b64_json?: string }>;
  url?: string;
  b64_json?: string;
  error?: string | { message?: string };
}

export interface OxenImageModelOptions {
  /** Display name surfaced in metadata/logs. */
  name?: string;
  /** Deployed model id, e.g. `trindadetiago-linguistic-amaranth-clam`. */
  model: string;
  /** oxen.ai API token (Bearer). */
  apiKey: string;
  /**
   * Publish the composite somewhere oxen's servers can fetch over HTTP and
   * return its URL. oxen rejects data URIs, so the caller must host the bytes
   * (e.g. write to S3/MinIO and return a public URL).
   */
  uploadImage: (image: Buffer) => Promise<string>;
  /** Override the edit endpoint. */
  endpoint?: string;
  /** Diffusion denoising steps. More = higher quality, slower. */
  numInferenceSteps?: number;
}

/**
 * oxen.ai deployed image-edit model via `POST /api/images/edit`.
 *
 * `input_image` must be a publicly-downloadable URL (data URIs are rejected by
 * the deploy), so the composite is published via `uploadImage` first. We ask
 * for `b64_json` so the result comes back as bytes in one round trip, then
 * resize to the caller's input dimensions so the pipeline stays size-agnostic
 * (mirrors `OpenAIImageModel`).
 */
export class OxenImageModel implements ModelClient {
  readonly name: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly numInferenceSteps: number;
  private readonly uploadImage: (image: Buffer) => Promise<string>;

  constructor(opts: OxenImageModelOptions) {
    if (!opts.apiKey) throw new Error('OxenImageModel requires an apiKey');
    if (!opts.model) throw new Error('OxenImageModel requires a model id');
    if (!opts.uploadImage) throw new Error('OxenImageModel requires an uploadImage function');
    this.name = opts.name ?? `oxen:${opts.model}`;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.uploadImage = opts.uploadImage;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.numInferenceSteps = opts.numInferenceSteps ?? DEFAULT_STEPS;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const start = Date.now();

    const inputUrl = await this.uploadImage(params.input);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: params.prompt,
        input_image: inputUrl,
        num_inference_steps: this.numInferenceSteps,
        response_format: 'b64_json',
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`oxen ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as OxenEditResponse;
    if (json.error) {
      const msg = typeof json.error === 'string' ? json.error : json.error.message;
      throw new Error(`oxen error: ${msg ?? JSON.stringify(json.error)}`);
    }

    const first = json.images?.[0] ?? json.data?.[0] ?? {};
    const b64 = first.b64_json ?? json.b64_json;
    const url = first.url ?? json.url;

    let raw: Buffer;
    if (b64) {
      raw = Buffer.from(b64, 'base64');
    } else if (url) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`oxen image fetch ${r.status}`);
      raw = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error(`oxen returned no image: ${JSON.stringify(json).slice(0, 500)}`);
    }

    // Normalise back to the caller's input dimensions.
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
