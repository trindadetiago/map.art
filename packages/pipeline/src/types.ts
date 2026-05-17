import type { ModelClient } from '@mapart/models';

export interface PipelineTileInput {
  col: number;
  row: number;
  /** PNG buffer of the rendered source image for this tile. */
  renderedPng: Buffer;
}

export interface PipelineTileOutput {
  col: number;
  row: number;
  /** PNG buffer of the generated image for this tile. */
  generatedPng: Buffer;
  /** Freeform metadata — timing, model params, whatever the strategy wants to record. */
  metadata: Record<string, unknown>;
}

export interface StrategyInput {
  project: {
    pitch: number;
    yaw: number;
    tileWorldMeters: number;
    tilePixelSize: number;
  };
  tiles: PipelineTileInput[];
  prompt: string;
  /** Optional callback fired after each tile finishes. */
  onProgress?: (doneTiles: PipelineTileOutput[], total: number) => void;
}

export interface GenerationStrategy {
  /** Stable identifier, used in storage paths and UI. */
  name: string;
  description: string;
  run(input: StrategyInput, model: ModelClient): Promise<PipelineTileOutput[]>;
}
