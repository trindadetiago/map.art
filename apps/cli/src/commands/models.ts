import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '@mapart/env';
import { type ModelName, getModel } from '@mapart/models';
import type { Command } from 'commander';

export function registerModelsCommands(parent: Command): void {
  parent
    .command('generate')
    .description('Run a PNG through a model and write the output PNG')
    .requiredOption('--input <path>', 'input PNG path')
    .requiredOption('--prompt <text>', 'text prompt')
    .option('--reference <path>', 'optional reference PNG path')
    .option('--model <name>', 'model name (gpt-image-1.5 | gpt-image-2)', 'gpt-image-1.5')
    .option('--seed <number>', 'optional seed', Number.parseInt)
    .requiredOption('--out <path>', 'output PNG path')
    .action(async (opts) => {
      const input = await readFile(resolve(process.cwd(), opts.input));
      const reference = opts.reference
        ? await readFile(resolve(process.cwd(), opts.reference))
        : undefined;
      if (!env.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not set. Add it to .env and retry.');
      }
      const model = getModel(opts.model as ModelName, { apiKey: env.openaiApiKey });
      const result = await model.generate({
        input,
        prompt: opts.prompt,
        ...(reference === undefined ? {} : { reference }),
        ...(opts.seed === undefined ? {} : { seed: opts.seed }),
      });
      const outPath = resolve(process.cwd(), opts.out);
      await writeFile(outPath, result.image);
      console.log(
        `wrote ${outPath} (${result.image.byteLength} bytes) via ${result.metadata.model} in ${result.metadata.durationMs}ms`,
      );
    });
}
