import { closeDb, getSql, repos, resetSchema, runMigrations } from '@mapart/db';
import type { Command } from 'commander';

export function registerDbCommands(parent: Command): void {
  parent
    .command('status')
    .description('Connection check + table counts')
    .action(async () => {
      try {
        const info = await repos.getPostgresInfo();
        console.log(`postgres: ${info.version.split(' ').slice(0, 2).join(' ')}`);
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
          console.log(`${p.id}  ${p.name.padEnd(24)}  ${p.description ?? ''}`);
        }
      } finally {
        await closeDb();
      }
    });

  projectsCmd
    .command('create')
    .description('Create a project')
    .requiredOption('--name <name>')
    .option('--description <text>')
    .action(async (opts) => {
      try {
        const project = await repos.createProject({
          name: opts.name,
          description: opts.description ?? null,
        });
        console.log(`created ${project.id} (${project.name})`);
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
