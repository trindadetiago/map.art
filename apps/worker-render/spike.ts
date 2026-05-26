import '@mapart/env';
import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@mapart/env';
import type { Page } from 'puppeteer';
import { VIEWPORT_PAD, launchBrowser } from './chrome';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCATIONS = [
  { name: 'João Pessoa — Ponta do Seixas', lat: -7.1195, lng: -34.8286 },
  { name: 'João Pessoa — Centro', lat: -7.115, lng: -34.88 },
  { name: 'João Pessoa — Cabo Branco', lat: -7.14, lng: -34.82 },
  { name: 'Recife — Boa Viagem', lat: -8.12, lng: -34.9 },
  { name: 'São Paulo — Av Paulista', lat: -23.5615, lng: -46.656 },
  { name: 'Rio de Janeiro — Copacabana', lat: -22.971, lng: -43.1823 },
  { name: 'Nova York — Manhattan', lat: 40.758, lng: -73.9855 },
  { name: 'Paris — Torre Eiffel', lat: 48.8584, lng: 2.2945 },
];

interface TileRender {
  name: string;
  lat: number;
  lng: number;
  durationMs: number;
  pngPath: string;
  error?: string;
}

const SPIKE_SIZE = 1024;

async function renderOne(
  page: Page,
  baseUrl: string,
  loc: { name: string; lat: number; lng: number },
  outputDir: string,
): Promise<TileRender> {
  const started = Date.now();
  const url = `${baseUrl}?lat=${loc.lat}&lng=${loc.lng}&pitch=60&yaw=0&zoom=18&size=${SPIKE_SIZE}&token=${process.env.RENDER_WORKER_TOKEN ?? 'dev-token-placeholder'}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForFunction(() => window.__sceneReady === true, { timeout: 10000 });

    await page.waitForFunction(() => window.__scene?.isReady?.() === true, { timeout: 45000 });

    await page.evaluate(() => {
      return window.__scene?.waitForSettled?.({ settleMs: 1000, timeoutMs: 90000 });
    });

    const dataUrl = await page.evaluate(() => {
      return window.__scene?.capture?.() ?? null;
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('capture() returned invalid data');
    }

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    const safeName = loc.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    const pngPath = resolve(outputDir, `${safeName}.png`);
    await writeFile(pngPath, buf);

    const durationMs = Date.now() - started;
    console.log(`  ${loc.name}: done in ${durationMs}ms (${(buf.length / 1024).toFixed(1)} KB)`);
    return { name: loc.name, lat: loc.lat, lng: loc.lng, durationMs, pngPath };
  } catch (err) {
    const durationMs = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  ${loc.name}: FAILED (${durationMs}ms): ${error}`);
    return { name: loc.name, lat: loc.lat, lng: loc.lng, durationMs, pngPath: '', error };
  }
}

async function main() {
  const baseUrl = env.renderWorkerUrl ?? 'http://localhost:3210/render-worker';
  const outputDir = resolve(__dirname, '../../data/spike-renders');

  await mkdir(outputDir, { recursive: true });

  console.log('=== Worker Render Spike — Batch Test ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Locations: ${LOCATIONS.length}\n`);

  const browser = await launchBrowser();

  const page = await browser.newPage();
  await page.setViewport({ width: SPIKE_SIZE + VIEWPORT_PAD, height: SPIKE_SIZE + VIEWPORT_PAD });

  const results: TileRender[] = [];
  const overallStart = Date.now();

  try {
    for (const loc of LOCATIONS) {
      const result = await renderOne(page, baseUrl, loc, outputDir);
      results.push(result);
    }
  } finally {
    await page.close();
    await browser.close();
  }

  const overallMs = Date.now() - overallStart;
  const succeeded = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  console.log('\n=== Summary ===');
  console.log(`Total: ${results.length} | OK: ${succeeded.length} | Failed: ${failed.length}`);
  console.log(`Overall time: ${(overallMs / 1000).toFixed(1)}s`);

  if (succeeded.length > 0) {
    const avg = succeeded.reduce((s, r) => s + r.durationMs, 0) / succeeded.length;
    const min = Math.min(...succeeded.map((r) => r.durationMs));
    const max = Math.max(...succeeded.map((r) => r.durationMs));
    console.log(
      `Per-tile: avg ${(avg / 1000).toFixed(1)}s | min ${(min / 1000).toFixed(1)}s | max ${(max / 1000).toFixed(1)}s`,
    );
  }

  const reportPath = resolve(outputDir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`Report: ${reportPath}`);

  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
