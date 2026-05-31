import type { GenerateParams, GenerateResult, ModelClient } from './types';

/**
 * No-op model: returns the input image unchanged. The stylize worker then crops
 * the red-boxed center back out, so the raw render passes through as the
 * "stylized" tile. Deterministic, no GPU / key / cost — proves the pipeline.
 */
export class StubImageModel implements ModelClient {
  readonly name = 'stub';

  generate(params: GenerateParams): Promise<GenerateResult> {
    return Promise.resolve({
      image: params.input,
      metadata: {
        model: this.name,
        prompt: params.prompt,
        seed: params.seed,
        durationMs: 0,
      },
    });
  }
}
