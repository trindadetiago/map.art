#!/usr/bin/env tsx
import '@mapart/env';
import { Command } from 'commander';
import { registerDbCommands } from '../src/commands/db';
import { registerModelsCommands } from '../src/commands/models';
import { registerRendererCommands } from '../src/commands/renderer';
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
registerModelsCommands(program.command('models').description('image-edit models (generate)'));
registerRendererCommands(program.command('renderer').description('tile renderer (render)'));
registerTilesCommands(program.command('tiles').description('tile coordinate math'));

await program.parseAsync();
