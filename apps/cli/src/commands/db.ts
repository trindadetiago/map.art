import { closeDb, getSql, repos, resetSchema, runMigrations } from '@mapart/db';
import type { Command } from 'commander';

export function registerDbCommands(parent: Command): void {
  parent
    .command('status')
    .description('Connection check + PostGIS version + table counts')
    .action(async () => {
      try {
        const info = await repos.getPostgresInfo();
        console.log(`postgres: ${info.version.split(' ').slice(0, 2).join(' ')}`);
        console.log(`postgis:  ${info.postgisVersion ?? '(not installed)'}`);
        try {
          const counts = await repos.getTableCounts();
          console.log('tables:');
          for (const [k, v] of Object.entries(counts)) {
            console.log(`  ${k.padEnd(15)} ${v}`);
          }
        } catch (e) {
          console.log('tables:  (schema not migrated yet)');
          console.log(`  reason: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
        }
      } finally {
        await closeDb();
      }
    });

  parent
    .command('migrate')
    .description('Apply pending Drizzle migrations')
    .action(async () => {
      try {
        await runMigrations();
        console.log('migrations applied');
      } finally {
        await closeDb();
      }
    });

  parent
    .command('reset')
    .description('DROP everything in the public schema. Dev-only, requires --yes.')
    .requiredOption('--yes', 'confirm destructive action')
    .action(async () => {
      try {
        await resetSchema();
        console.log('schema reset');
      } finally {
        await closeDb();
      }
    });

  const projectsCmd = parent.command('projects').description('Project CRUD');

  projectsCmd
    .command('list')
    .description('List projects')
    .action(async () => {
      try {
        const rows = await repos.listProjects();
        if (rows.length === 0) {
          console.log('(no projects)');
          return;
        }
        for (const p of rows) {
          console.log(
            `${p.id}  ${p.slug.padEnd(24)}  ${p.status.padEnd(10)}  pitch=${p.cameraPitch}° yaw=${p.cameraYaw}°  tile=${p.tileWorldMeters}m/${p.tilePixelSize}px  center=${p.centerLat.toFixed(4)},${p.centerLng.toFixed(4)}  ${p.name}`,
          );
        }
      } finally {
        await closeDb();
      }
    });

  projectsCmd
    .command('create-rect')
    .description('Create a project + seed a cols × rows tile grid centered on lat/lng')
    .requiredOption('--name <name>')
    .requiredOption('--slug <slug>')
    .requiredOption('--lat <n>', 'center latitude', Number.parseFloat)
    .requiredOption('--lng <n>', 'center longitude', Number.parseFloat)
    .option('--cols <n>', 'number of columns (width)', (v) => Number.parseInt(v, 10), 10)
    .option('--rows <n>', 'number of rows (height)', (v) => Number.parseInt(v, 10), 10)
    .option('--tile-meters <n>', 'ground width per tile (m)', Number.parseFloat, 150)
    .option('--tile-pixels <n>', 'PNG size per tile', (v) => Number.parseInt(v, 10), 512)
    .option('--pitch <n>', 'camera pitch (°)', Number.parseFloat, 30)
    .option('--yaw <n>', 'camera yaw (°)', Number.parseFloat, 45)
    .action(async (opts) => {
      try {
        const { project, tileCount } = await repos.createRectProject({
          name: opts.name,
          slug: opts.slug,
          centerLat: opts.lat,
          centerLng: opts.lng,
          cols: opts.cols,
          rows: opts.rows,
          tileWorldMeters: opts.tileMeters,
          tilePixelSize: opts.tilePixels,
          cameraPitch: opts.pitch,
          cameraYaw: opts.yaw,
        });
        console.log(`created ${project.id} (${project.slug})  seeded ${tileCount} tiles`);
      } finally {
        await closeDb();
      }
    });

  projectsCmd
    .command('tile-count')
    .description('How many tile rows a project has')
    .requiredOption('--id <uuid>')
    .action(async (opts) => {
      try {
        const n = await repos.countTilesForProject(opts.id);
        console.log(n);
      } finally {
        await closeDb();
      }
    });

  projectsCmd
    .command('delete')
    .description('Delete a project by id')
    .requiredOption('--id <uuid>', 'project id')
    .action(async (opts) => {
      try {
        await repos.deleteProject(opts.id);
        console.log(`deleted ${opts.id}`);
      } finally {
        await closeDb();
      }
    });

  const modelsCmd = parent.command('models').description('Model registry');

  modelsCmd
    .command('list')
    .description('List registered models')
    .action(async () => {
      try {
        const rows = await repos.listModels();
        if (rows.length === 0) {
          console.log('(no models)');
          return;
        }
        for (const m of rows) {
          const active = m.active ? '*' : ' ';
          console.log(`${active} ${m.id.padEnd(26)} ${m.kind.padEnd(9)} ${m.endpoint}`);
        }
      } finally {
        await closeDb();
      }
    });

  modelsCmd
    .command('upsert')
    .description('Insert or update a model row')
    .requiredOption('--id <id>')
    .requiredOption('--kind <kind>', 'generate | edit')
    .requiredOption('--endpoint <endpoint>')
    .option('--notes <text>')
    .option('--active', 'mark as default/active', false)
    .action(async (opts) => {
      try {
        const row = await repos.upsertModel({
          id: opts.id,
          kind: opts.kind,
          endpoint: opts.endpoint,
          notes: opts.notes,
          active: !!opts.active,
        });
        console.log(`upserted ${row.id}`);
      } finally {
        await closeDb();
      }
    });

  parent
    .command('seed')
    .description('Seed default model rows (stub + gemini variants)')
    .action(async () => {
      try {
        const n = await repos.seedDefaultModels();
        console.log(`seeded ${n} models`);
      } finally {
        await closeDb();
      }
    });

  parent
    .command('sql')
    .description('Run a raw SQL statement (read-only if you behave)')
    .requiredOption('--q <statement>', 'SQL to execute')
    .action(async (opts) => {
      try {
        const result = await getSql().unsafe(opts.q);
        console.log(JSON.stringify(result, null, 2));
      } finally {
        await closeDb();
      }
    });
}
