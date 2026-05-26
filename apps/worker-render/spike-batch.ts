import '@mapart/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@mapart/env';
import type { Browser } from 'puppeteer';
import { type RenderGpuMode, VIEWPORT_PAD, launchBrowser } from './chrome';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TileTiming {
  index: number;
  settleMs: number;
  captureMs: number;
  totalMs: number;
}

interface RunResult {
  mode: RenderGpuMode;
  timings: TileTiming[];
  firstMs: number;
  restAvgMs: number;
  totalMs: number;
}

const GRID = 10;
const TILES = GRID * GRID;
const STEP_DEG = 0.002;
const CENTER_LAT = -7.12;
const CENTER_LNG = -34.86;
const HALF = GRID / 2;

const LOCATIONS = Array.from({ length: TILES }, (_, i) => {
  const col = i % GRID;
  const row = Math.floor(i / GRID);
  return {
    name: `(${col - Math.floor(HALF) + 1},${row - Math.floor(HALF) + 1})`,
    lat: CENTER_LAT + (row - Math.floor(HALF)) * STEP_DEG,
    lng: CENTER_LNG + (col - Math.floor(HALF)) * STEP_DEG,
  };
});

async function renderBatch(
  browser: Browser,
  baseUrl: string,
  size: number,
  outputDir: string,
  mode: RenderGpuMode,
): Promise<RunResult> {
  const PITCH = 60;
  const YAW = 0;
  const ZOOM = 17.5;

  // biome-ignore lint/style/noNonNullAssertion: LOCATIONS is always length TILES
  const seed = LOCATIONS[0]!;
  const seedUrl = `${baseUrl}?lat=${seed.lat}&lng=${seed.lng}&pitch=${PITCH}&yaw=${YAW}&zoom=${ZOOM}&size=${size}&token=${process.env.RENDER_WORKER_TOKEN ?? 'dev-token-placeholder'}`;
  const page = await browser.newPage();
  const timings: TileTiming[] = [];

  try {
    await page.setViewport({ width: size + VIEWPORT_PAD, height: size + VIEWPORT_PAD });
    await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__sceneReady === true, { timeout: 10000 });
    await page.waitForFunction(() => window.__scene?.isReady?.() === true, { timeout: 30000 });

    const runStart = Date.now();
    for (let i = 0; i < TILES; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop bounds guarantee existence
      const loc = LOCATIONS[i]!;
      const t0 = Date.now();

      if (i === 0) {
        await page.evaluate(() => {
          return window.__scene?.waitForSettled?.({ settleMs: 1000, timeoutMs: 60000 });
        });
      } else {
        await page.evaluate(
          ({
            lat,
            lng,
            pitch,
            yaw,
            zoom,
            s,
          }: { lat: number; lng: number; pitch: number; yaw: number; zoom: number; s: number }) => {
            window.__scene?.updateParams?.({ center: { lat, lng }, pitch, yaw, zoom, size: s });
            return window.__scene?.waitForSettled?.({ settleMs: 1000, timeoutMs: 60000 });
          },
          { lat: loc.lat, lng: loc.lng, pitch: PITCH, yaw: YAW, zoom: ZOOM, s: size },
        );
      }
      const t1 = Date.now();

      const dataUrl = await page.evaluate(() => {
        return window.__scene?.capture?.() ?? null;
      });
      const t2 = Date.now();

      if (!dataUrl?.startsWith('data:image/png')) {
        throw new Error(`capture failed at tile ${i}`);
      }

      const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const pngPath = resolve(outputDir, `${mode}_${i.toString().padStart(3, '0')}.png`);
      if (i < 5 || i >= TILES - 5 || i % 10 === 0) {
        await writeFile(pngPath, buf);
      }

      timings.push({ index: i, settleMs: t1 - t0, captureMs: t2 - t1, totalMs: t2 - t0 });

      if ((i + 1) % 10 === 0 || i === TILES - 1) {
        const elapsed = Math.round((Date.now() - runStart) / 1000);
        const pct = (((i + 1) / TILES) * 100).toFixed(0);
        const min = Math.floor(elapsed / 60);
        const sec = elapsed % 60;
        const elapsedStr = min > 0 ? `${min}m${sec}s` : `${sec}s`;
        console.log(`  ${mode}: ${i + 1}/${TILES} (${pct}%) — ${elapsedStr}`);
      }
    }
  } finally {
    await page.close();
  }

  // biome-ignore lint/style/noNonNullAssertion: timings always has at least 1 entry
  const firstMs = timings[0]!.totalMs;
  const rest = timings.slice(1);
  const restAvgMs = rest.reduce((s, r) => s + r.totalMs, 0) / rest.length;
  const totalMs = timings.reduce((s, r) => s + r.totalMs, 0);

  return { mode, timings, firstMs, restAvgMs, totalMs };
}

function formatTime(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(0);
  return `${m}m${sec}s`;
}

function project(
  nTiles: number,
  firstMs: number,
  restAvgMs: number,
): { seconds: number; formatted: string } {
  const totalMs = firstMs + (nTiles - 1) * restAvgMs;
  return { seconds: totalMs / 1000, formatted: formatTime(totalMs) };
}

async function main() {
  const baseUrl = env.renderWorkerUrl ?? 'http://localhost:3210/render-worker';
  const outputDir = resolve(__dirname, '../../data/spike-renders');
  await mkdir(outputDir, { recursive: true });

  const SIZE = 1024;
  console.log(`=== Batch Test: ${TILES} tiles (${GRID}×${GRID} grid) ===\n`);

  console.log('Running CPU (SwiftShader)...');
  const cpuBrowser = await launchBrowser('cpu');
  const cpu = await renderBatch(cpuBrowser, baseUrl, SIZE, outputDir, 'cpu');
  await cpuBrowser.close();
  console.log('');

  console.log('Running GPU (Metal)...');
  const gpuBrowser = await launchBrowser('gpu');
  const gpu = await renderBatch(gpuBrowser, baseUrl, SIZE, outputDir, 'gpu');
  await gpuBrowser.close();

  console.log(`\n${'='.repeat(60)}`);
  console.log('               CPU vs GPU — 100 tiles em batch');
  console.log('='.repeat(60));
  console.log('');

  console.log(''.padEnd(30), 'CPU (SwiftShader)'.padEnd(22), 'GPU (Metal)');
  console.log('─'.repeat(74));
  console.log(
    'Primeiro tile (setup Three.js)'.padEnd(30),
    formatTime(cpu.firstMs).padEnd(22),
    formatTime(gpu.firstMs),
  );
  console.log(
    'Média tiles seguintes'.padEnd(30),
    formatTime(cpu.restAvgMs).padEnd(22),
    formatTime(gpu.restAvgMs),
  );
  console.log(
    'Total 100 tiles'.padEnd(30),
    formatTime(cpu.totalMs).padEnd(22),
    formatTime(gpu.totalMs),
  );
  console.log('');

  console.log('── Projeção pra 1.000, 5.000 e 9.000 tiles ──\n');

  const targets = [1000, 5000, 9000];

  console.log(
    'Tiles'.padEnd(12),
    'CPU (SwiftShader)'.padEnd(18),
    'GPU (Metal)'.padEnd(18),
    'Diferença',
  );
  console.log('─'.repeat(60));
  for (const n of targets) {
    const cpuP = project(n, cpu.firstMs, cpu.restAvgMs);
    const gpuP = project(n, gpu.firstMs, gpu.restAvgMs);
    const ratio = cpuP.seconds > 0 ? (cpuP.seconds / gpuP.seconds).toFixed(1) : '-';
    console.log(
      n.toString().padEnd(12),
      cpuP.formatted.padEnd(18),
      gpuP.formatted.padEnd(18),
      `${ratio}x`,
    );
  }

  console.log('\n── Com paralelismo (10 páginas Chrome simultâneas) ──\n');

  console.log('Tiles'.padEnd(12), 'CPU 10x paralelo'.padEnd(18), 'GPU 10x paralelo'.padEnd(18));
  console.log('─'.repeat(50));
  for (const n of targets) {
    const cpuP = project(Math.ceil(n / 10), cpu.firstMs, cpu.restAvgMs);
    const gpuP = project(Math.ceil(n / 10), gpu.firstMs, gpu.restAvgMs);
    console.log(n.toString().padEnd(12), cpuP.formatted.padEnd(18), gpuP.formatted.padEnd(18));
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
