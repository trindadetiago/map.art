#!/usr/bin/env tsx
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '@mapart/env';
import { Command } from 'commander';
import { getModel } from '../src/factory';
import type { ModelName } from '../src/types';

const program = new Command();

program
  .name('mapart-generate')
  .description('Run an input PNG through a model and write the output PNG')
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

await program.parseAsync();
