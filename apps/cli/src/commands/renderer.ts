import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderTile } from '@mapart/renderer';
import type { Command } from 'commander';

export function registerRendererCommands(parent: Command): void {
  parent
    .command('render')
    .description('Render a single tile PNG from camera params')
    .requiredOption('--lat <number>', 'center latitude', Number.parseFloat)
    .requiredOption('--lng <number>', 'center longitude', Number.parseFloat)
    .option('--pitch <number>', 'camera pitch in degrees', Number.parseFloat, 30)
    .option('--yaw <number>', 'camera yaw in degrees (0=N)', Number.parseFloat, 0)
    .option('--size <number>', 'output PNG size in px', Number.parseInt, 512)
    .option('--zoom <number>', 'web-mercator zoom level (fractional ok)', Number.parseFloat, 18)
    .requiredOption('--out <path>', 'output PNG path')
    .action(async (opts) => {
      const buf = await renderTile({
        center: { lat: opts.lat, lng: opts.lng },
        pitch: opts.pitch,
        yaw: opts.yaw,
        size: opts.size,
        zoom: opts.zoom,
      });
      const outPath = resolve(process.cwd(), opts.out);
      await writeFile(outPath, buf);
      console.log(`wrote ${outPath} (${buf.byteLength} bytes)`);
    });
}
