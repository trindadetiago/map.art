#!/usr/bin/env tsx
import '@mapart/env';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { getStorage } from '../src/index';

const program = new Command();

program.name('mapart-storage').description('Browse and manipulate the storage layer');

program
  .command('list')
  .description('List keys under a prefix')
  .argument('[prefix]', 'prefix to list under', '')
  .action(async (prefix: string) => {
    const entries = await getStorage().list(prefix);
    if (entries.length === 0) {
      console.log('(empty)');
      return;
    }
    for (const e of entries) {
      const sizeKb = (e.size / 1024).toFixed(1);
      console.log(`${e.modifiedAt.toISOString()}  ${sizeKb.padStart(8)} KB  ${e.key}`);
    }
  });

program
  .command('put')
  .description('Upload a local file to a storage key')
  .requiredOption('--file <path>', 'local file to upload')
  .requiredOption('--key <key>', 'storage key (path under the storage root)')
  .action(async (opts) => {
    const buf = await readFile(resolve(process.cwd(), opts.file));
    await getStorage().put(opts.key, buf);
    console.log(`wrote ${opts.key} (${buf.byteLength} bytes)`);
  });

program
  .command('get')
  .description('Download a storage key to a local file')
  .requiredOption('--key <key>', 'storage key')
  .requiredOption('--out <path>', 'local output path')
  .action(async (opts) => {
    const buf = await getStorage().get(opts.key);
    await writeFile(resolve(process.cwd(), opts.out), buf);
    console.log(`wrote ${opts.out} (${buf.byteLength} bytes)`);
  });

program
  .command('delete')
  .description('Delete a storage key')
  .requiredOption('--key <key>', 'storage key')
  .action(async (opts) => {
    await getStorage().delete(opts.key);
    console.log(`deleted ${opts.key}`);
  });

await program.parseAsync();
