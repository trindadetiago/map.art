#!/usr/bin/env tsx
import '@mapart/env';
import { Command } from 'commander';
import { registerDbCommands } from '../src/commands/db';
import { registerModelsCommands } from '../src/commands/models';
import { registerRenderCommands } from '../src/commands/render';
import { registerStorageCommands } from '../src/commands/storage';
import { registerTilesCommands } from '../src/commands/tiles';

const program = new Command();
program.name('mapart').description('map.art monorepo CLI');

registerDbCommands(
  program.command('db').description('database ops (status, migrate, projects, sql)'),
);
registerStorageCommands(
  program.command('storage').description('blob storage (list, put, get, delete)'),
);
registerModelsCommands(program.command('models').description('image-edit models (generate)'));
registerTilesCommands(program.command('tiles').description('tile coordinate math'));
registerRenderCommands(program);

await program.parseAsync();
