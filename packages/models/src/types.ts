export interface GenerateParams {
  input: Buffer;
  prompt: string;
  reference?: Buffer;
  mask?: Buffer;
  seed?: number;
}

export interface GenerateMetadata {
  model: string;
  prompt: string;
  seed: number | undefined;
  durationMs: number;
  /** Any text parts returned alongside the image. Useful for debugging — models sometimes narrate what they did or refuse. */
  textResponse?: string;
}

export interface GenerateResult {
  image: Buffer;
  /** The model's untouched response bytes, before any adapter-side normalisation
   *  (resize, format conversion). Useful for diagnosing scale/aspect issues. */
  rawImage?: Buffer;
  metadata: GenerateMetadata;
}

export interface ModelClient {
  readonly name: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

export type ModelName = 'gpt-image-1.5' | 'gpt-image-2';
