import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '@mapart/env';
import type { Command } from 'commander';

interface RenderTileRequest {
  lat: number;
  lng: number;
  pitch: number;
  yaw: number;
  zoom: number;
  size: number;
}

/**
 * `mapart render` — POSTs to apps/worker-render's dev HTTP endpoint and writes
 * the resulting PNG to disk. End-to-end smoke test: Puppeteer → Chromium →
 * render-page → Scene → Three.js → Google 3D Tiles → canvas → bytes.
 *
 * The endpoint this hits (`POST /render`) is dev-only — production renders go
 * through the queue (no HTTP exposure). See apps/worker-render/worker.ts.
 */
export function registerRenderCommands(parent: Command): void {
  parent
    .command('render')
    .description('Render a tile via apps/worker-render (dev/testing only)')
    .requiredOption('--lat <number>', 'center latitude', Number.parseFloat)
    .requiredOption('--lng <number>', 'center longitude', Number.parseFloat)
    .option('--pitch <number>', 'camera pitch degrees', Number.parseFloat, 60)
    .option('--yaw <number>', 'camera yaw degrees (0 = north)', Number.parseFloat, 0)
    .option('--zoom <number>', 'web-mercator zoom (fractional ok)', Number.parseFloat, 18)
    .option('--size <number>', 'output PNG side in px', (v) => Number.parseInt(v, 10), 1024)
    .requiredOption('--out <path>', 'output PNG path')
    .option('--worker <url>', 'worker base URL', `http://localhost:${env.renderWorkerPort}`)
    .action(async (opts) => {
      const body: RenderTileRequest = {
        lat: opts.lat,
        lng: opts.lng,
        pitch: opts.pitch,
        yaw: opts.yaw,
        zoom: opts.zoom,
        size: opts.size,
      };
      const url = `${String(opts.worker).replace(/\/$/, '')}/render`;
      const startedAt = Date.now();

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(
          `worker unreachable at ${url} (is apps/worker-render running? \`pnpm dev:worker-render\`): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`worker ${res.status}: ${text.slice(0, 500)}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const outPath = resolve(process.cwd(), opts.out);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buf);
      const dur = Date.now() - startedAt;
      console.log(
        `wrote ${outPath} (${buf.byteLength} bytes) in ${dur}ms (worker reported ${
          res.headers.get('x-render-duration-ms') ?? '?'
        }ms)`,
      );
    });
}
