import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '@mapart/env';
import { type ModelName, getModel } from '@mapart/models';
import type { Command } from 'commander';

export function registerGenerateCommands(parent: Command): void {
  parent
    .requiredOption('--input <path>', 'input PNG path')
    .requiredOption('--prompt <text>', 'text prompt')
    .option('--reference <path>', 'optional reference PNG path')
    .option('--model <name>', 'model name (stub | nano-banana)', 'stub')
    .option('--seed <number>', 'optional seed', Number.parseInt)
    .requiredOption('--out <path>', 'output PNG path')
    .action(async (opts) => {
      const input = await readFile(resolve(process.cwd(), opts.input));
      const reference = opts.reference
        ? await readFile(resolve(process.cwd(), opts.reference))
        : undefined;
      const model = getModel(
        opts.model as ModelName,
        env.geminiApiKey ? { apiKey: env.geminiApiKey } : {},
      );
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
