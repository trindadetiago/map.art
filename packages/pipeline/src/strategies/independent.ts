import type { GenerationStrategy, PipelineTileOutput } from '../types';

/**
 * Baseline strategy: each tile is generated independently with no neighbor
 * context or masking. Seams will almost certainly be visible between adjacent
 * outputs. Kept around as the reference point all other strategies are compared
 * against.
 */
export const independentStrategy: GenerationStrategy = {
  name: 'independent',
  description:
    'Each tile generated as a standalone model call. No neighbor context, no masking. Baseline.',
  async run(input, model) {
    const total = input.tiles.length;
    console.log(`[pipeline:independent] starting — ${total} tile(s)`);
    const outputs: PipelineTileOutput[] = [];
    for (const [i, tile] of input.tiles.entries()) {
      const started = Date.now();
      console.log(`[pipeline:independent] tile ${i + 1}/${total} (col=${tile.col} row=${tile.row}) — generating`);
      const result = await model.generate({
        input: tile.renderedPng,
        prompt: input.prompt,
      });
      const wallClockMs = Date.now() - started;
      console.log(`[pipeline:independent] tile ${i + 1}/${total} (col=${tile.col} row=${tile.row}) — done in ${wallClockMs}ms (model ${result.metadata.durationMs}ms)`);
      outputs.push({
        col: tile.col,
        row: tile.row,
        generatedPng: result.image,
        metadata: {
          strategy: 'independent',
          model: result.metadata.model,
          durationMs: result.metadata.durationMs,
          textResponse: result.metadata.textResponse,
          wallClockMs,
        },
      });
      input.onProgress?.(outputs, total);
    }
    console.log(`[pipeline:independent] all ${total} tile(s) done`);
    return outputs;
  },
};
