import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repos } from '@mapart/db';
import { exportProjectDzi } from '@mapart/export';
import { parsePins, setProjectPins } from '@mapart/export/pins';
import type { VizSource } from '@mapart/export/types';
import type { Command } from 'commander';

export function registerExportCommands(parent: Command): void {
  parent
    .command('dzi')
    .description("Stitch a project's tiles into a DZI/WebP deep-zoom pyramid for the visualizer")
    .requiredOption('--project <id>', 'project id to export')
    .option('--source <source>', 'which per-tile image to stitch: stylized | rendered', 'stylized')
    .option('--quality <n>', 'WebP tile quality (1-100)', '90')
    .option(
      '--export-id <id>',
      'exports row to report progress on, so a caller that cannot watch the logs still learns the outcome',
    )
    .action(
      async (opts: {
        project: string;
        source: string;
        quality: string;
        exportId?: string;
      }) => {
        const source = opts.source as VizSource;
        if (source !== 'stylized' && source !== 'rendered') {
          throw new Error(`--source must be "stylized" or "rendered" (got "${opts.source}")`);
        }
        const quality = Number(opts.quality);
        if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
          throw new Error(`--quality must be an integer 1-100 (got "${opts.quality}")`);
        }

        const exportId = opts.exportId;
        if (exportId) await repos.markExportRunning(exportId);

        let res: Awaited<ReturnType<typeof exportProjectDzi>>;
        try {
          res = await exportProjectDzi(opts.project, { source, quality });
        } catch (e) {
          // Record the failure before rethrowing, or a caller polling the row
          // waits forever on a run that already died.
          if (exportId) {
            await repos.markExportError(exportId, e instanceof Error ? e.message : String(e));
          }
          throw e;
        }
        if (exportId) {
          await repos.markExportDone(exportId, {
            placed: res.placed,
            skipped: res.skipped,
            uploaded: res.uploaded,
            width: res.width,
            height: res.height,
          });
        }
        console.log(`exported ${res.placed} ${res.source} tiles → ${res.prefix}`);
        console.log(`  image: ${res.width}×${res.height}px · ${res.uploaded} objects uploaded`);
        if (res.skipped) {
          console.log(`  ${res.skipped} tiles had no ${res.source} image (left as gaps)`);
        }
        console.log(`  view:  http://localhost:3220/?project=${res.projectId}`);
      },
    );

  parent
    .command('run-queued')
    .description('Claim the oldest queued export and run it. Exits 0 when the queue is empty.')
    .option('--quality <n>', 'WebP tile quality (1-100)', '90')
    .action(async (opts: { quality: string }) => {
      const claimed = await repos.claimNextExport();
      if (!claimed) {
        // Not an error: the runner restarts for reasons unrelated to exports,
        // and an idle start should cost nothing and report success.
        console.log('no queued export — nothing to do');
        return;
      }
      const source = claimed.source === 'rendered' ? 'rendered' : 'stylized';
      console.log(`claimed export ${claimed.id} — project ${claimed.projectId} (${source})`);
      try {
        const res = await exportProjectDzi(claimed.projectId, {
          source,
          quality: Number(opts.quality),
        });
        await repos.markExportDone(claimed.id, {
          placed: res.placed,
          skipped: res.skipped,
          uploaded: res.uploaded,
          width: res.width,
          height: res.height,
        });
        console.log(`exported ${res.placed} ${res.source} tiles → ${res.prefix}`);
        console.log(`  image: ${res.width}×${res.height}px · ${res.uploaded} objects uploaded`);
      } catch (e) {
        await repos.markExportError(claimed.id, e instanceof Error ? e.message : String(e));
        throw e;
      }
    });

  parent
    .command('pins')
    .description("Set a project's map pins from a local JSON file ([{ lat, lng, label, kind? }])")
    .requiredOption('--project <id>', 'project id to set pins for')
    .requiredOption('--file <path>', 'local JSON file with the pin array')
    .action(async (opts: { project: string; file: string }) => {
      const raw = await readFile(resolve(process.cwd(), opts.file), 'utf8');
      const pins = parsePins(raw);
      await setProjectPins(opts.project, pins);
      console.log(`set ${pins.length} pin(s) for project ${opts.project}`);
      console.log(`  view:  http://localhost:3220/?project=${opts.project}`);
    });
}
