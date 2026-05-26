import { OPENAI_IMAGE_MODELS, OpenAIImageModel, type OpenAIName } from './openai';
import type { ModelClient, ModelName } from './types';

export interface GetModelOptions {
  apiKey?: string;
}

export function getModel(name: ModelName, opts: GetModelOptions = {}): ModelClient {
  if (!(name in OPENAI_IMAGE_MODELS)) {
    throw new Error(`unknown model: ${name}`);
  }
  if (!opts.apiKey) {
    throw new Error(`${name} requires an apiKey. Pass it via opts.apiKey (e.g. from @mapart/env).`);
  }
  return new OpenAIImageModel({
    name,
    modelId: OPENAI_IMAGE_MODELS[name as OpenAIName],
    apiKey: opts.apiKey,
  });
}

export const MODEL_NAMES: readonly ModelName[] = ['gpt-image-1.5', 'gpt-image-2'];
