#!/usr/bin/env tsx
import '@mapart/env';
import { Command } from 'commander';
import { registerDbCommands } from '../src/commands/db';
import { registerGenerateCommands } from '../src/commands/generate';
import { registerRenderCommands } from '../src/commands/render';
import { registerStorageCommands } from '../src/commands/storage';
import { registerTilesCommands } from '../src/commands/tiles';

const program = new Command();
program.name('mapart').description('map.art monorepo CLI');

registerDbCommands(
  program.command('db').description('database ops (status, migrate, projects, models, sql)'),
);
registerStorageCommands(
  program.command('storage').description('blob storage (list, put, get, delete)'),
);
registerGenerateCommands(program.command('generate').description('run an image-edit model'));
registerRenderCommands(program.command('render').description('render a tile PNG'));
registerTilesCommands(program.command('tiles').description('tile coordinate math'));

await program.parseAsync();
