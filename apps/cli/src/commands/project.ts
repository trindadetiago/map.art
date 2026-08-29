import { closeDb, repos } from '@mapart/db';
import { gridCells } from '@mapart/renderer/params';
import type { Command } from 'commander';

export function registerProjectCommands(parent: Command): void {
  parent
    .command('create')
    .description('Create a project and a cols×rows grid of render tiles')
    .requiredOption('--name <s>', 'project name')
    .requiredOption('--lat <n>', 'origin (tile 0,0) latitude', Number.parseFloat)
    .requiredOption('--lng <n>', 'origin (tile 0,0) longitude', Number.parseFloat)
    .requiredOption('--cols <n>', 'grid width in tiles', (v) => Number.parseInt(v, 10))
    .requiredOption('--rows <n>', 'grid height in tiles', (v) => Number.parseInt(v, 10))
    .option('--slug <s>', 'url key (default: derived from name)')
    .option('--desc <s>', 'project description')
    .action(async (opts) => {
      try {
        if (
          !Number.isInteger(opts.cols) ||
          !Number.isInteger(opts.rows) ||
          opts.cols < 1 ||
          opts.rows < 1
        ) {
          console.error('--cols and --rows must be positive integers');
          process.exit(1);
          return;
        }
        const cells = gridCells({ lat: opts.lat, lng: opts.lng }, opts.cols, opts.rows);
        const project = await repos.createProject({
          name: opts.name,
          slug: repos.toSlug(opts.slug ?? '', opts.name),
          ...(opts.desc ? { description: opts.desc } : {}),
        });
        const tiles = await repos.createProjectTiles(project.id, cells);
        console.log(`project ${project.id}`);
        console.log(`  name   ${project.name}`);
        console.log(`  slug   /${project.slug}`);
        console.log(`  grid   ${opts.cols}×${opts.rows} = ${tiles.length} tiles (render/pending)`);
      } finally {
        await closeDb();
      }
    });

  parent
    .command('status')
    .description('Tile status breakdown for a project')
    .argument('<id>', 'project id')
    .action(async (id: string) => {
      try {
        const counts = await repos.tileStatusCounts(id);
        if (counts.length === 0) {
          console.log('(no tiles for this project)');
          return;
        }
        let total = 0;
        for (const c of counts) {
          console.log(`  ${c.currentStatusType}/${c.status}\t${c.count}`);
          total += c.count;
        }
        console.log(`  total\t\t${total}`);
      } finally {
        await closeDb();
      }
    });
}
