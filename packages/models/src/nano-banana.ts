import type { GenerateParams, GenerateResult, ModelClient } from './types';

function endpointFor(modelId: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

interface GeminiInlinePart {
  inlineData: { mimeType: string; data: string };
}
interface GeminiTextPart {
  text: string;
}
type GeminiPart = GeminiInlinePart | GeminiTextPart;

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

export interface GeminiImageModelOptions {
  name: string;
  modelId: string;
  apiKey: string;
}

export class GeminiImageModel implements ModelClient {
  readonly name: string;
  readonly modelId: string;
  private readonly apiKey: string;

  constructor(opts: GeminiImageModelOptions) {
    if (!opts.apiKey) throw new Error('GeminiImageModel requires an apiKey');
    this.name = opts.name;
    this.modelId = opts.modelId;
    this.apiKey = opts.apiKey;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const start = Date.now();

    const parts: GeminiPart[] = [
      { text: params.prompt },
      { inlineData: { mimeType: 'image/png', data: params.input.toString('base64') } },
    ];
    if (params.reference) {
      parts.push({
        inlineData: { mimeType: 'image/png', data: params.reference.toString('base64') },
      });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    };

    const res = await fetch(`${endpointFor(this.modelId)}?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as GeminiResponse;

    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked prompt: ${json.promptFeedback.blockReason}`);
    }

    const candidate = json.candidates?.[0];
    const allParts = candidate?.content?.parts ?? [];
    const imagePart = allParts.find((p): p is GeminiInlinePart => 'inlineData' in p);
    const textResponse = allParts
      .filter((p): p is GeminiTextPart => 'text' in p)
      .map((p) => p.text)
      .join('\n')
      .trim();

    if (!imagePart) {
      const finishReason = candidate?.finishReason ?? 'unknown';
      const detail = textResponse || JSON.stringify(json).slice(0, 500);
      throw new Error(`Gemini returned no image (finishReason=${finishReason}): ${detail}`);
    }

    const image = Buffer.from(imagePart.inlineData.data, 'base64');

    return {
      image,
      metadata: {
        model: this.name,
        prompt: params.prompt,
        seed: params.seed,
        durationMs: Date.now() - start,
        ...(textResponse ? { textResponse } : {}),
      },
    };
  }
}

export const GEMINI_IMAGE_MODELS = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image': 'gemini-3.1-flash-image-preview',
} as const;

export type NanoBananaName = keyof typeof GEMINI_IMAGE_MODELS;
