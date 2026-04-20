import { GEMINI_IMAGE_MODELS, GeminiImageModel, type NanoBananaName } from './nano-banana';
import { StubModel } from './stub';
import type { ModelClient, ModelName } from './types';

export interface GetModelOptions {
  apiKey?: string;
}

export function getModel(name: ModelName, opts: GetModelOptions = {}): ModelClient {
  if (name === 'stub') return new StubModel();

  if (name in GEMINI_IMAGE_MODELS) {
    if (!opts.apiKey) {
      throw new Error(
        `${name} requires an apiKey. Pass it via opts.apiKey (e.g. from @mapart/env).`,
      );
    }
    return new GeminiImageModel({
      name,
      modelId: GEMINI_IMAGE_MODELS[name as NanoBananaName],
      apiKey: opts.apiKey,
    });
  }

  throw new Error(`unknown model: ${name}`);
}

export const MODEL_NAMES: readonly ModelName[] = [
  'stub',
  'nano-banana',
  'nano-banana-pro',
  'gemini-3.1-flash-image',
];
