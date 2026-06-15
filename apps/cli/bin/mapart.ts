#!/usr/bin/env tsx
import '@mapart/env';
import { Command } from 'commander';
import { registerDbCommands } from '../src/commands/db';
import { registerExportCommands } from '../src/commands/export';
import { registerModelsCommands } from '../src/commands/models';
import { registerProjectCommands } from '../src/commands/project';
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
registerProjectCommands(
  program.command('project').description('projects + tile grids (create, status)'),
);
registerExportCommands(
  program.command('export').description('export projects to deep-zoom pyramids (dzi)'),
);
registerRenderCommands(program);

await program.parseAsync();

// Every subcommand is a one-shot tool. Force exit so lingering handles — DB
// pools, keep-alive S3 sockets after a bulk upload — can't hold the process
// open. A thrown command rejects the await above and exits non-zero before
// reaching here, so this only runs on success.
process.exit(0);
