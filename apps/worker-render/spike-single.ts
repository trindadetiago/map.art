import '@mapart/env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '@mapart/env';
import type { Browser } from 'puppeteer';
import { type RenderGpuMode, VIEWPORT_PAD, launchBrowser } from './chrome';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PhaseTiming {
  navigationMs: number;
  sceneReadyMs: number;
  tilesSettledMs: number;
  captureMs: number;
  totalMs: number;
}

interface TileResult {
  mode: RenderGpuMode;
  phases: PhaseTiming;
  pngPath: string;
  pngBytes: number;
  error?: string;
}

async function renderTile(
  browser: Browser,
  baseUrl: string,
  lat: number,
  lng: number,
  pitch: number,
  yaw: number,
  zoom: number,
  size: number,
  mode: RenderGpuMode,
  outputDir: string,
): Promise<TileResult> {
  const url = `${baseUrl}?lat=${lat}&lng=${lng}&pitch=${pitch}&yaw=${yaw}&zoom=${zoom}&size=${size}&token=${process.env.RENDER_WORKER_TOKEN ?? 'dev-token-placeholder'}`;
  const page = await browser.newPage();

  try {
    const t0 = Date.now();

    await page.setViewport({ width: size + VIEWPORT_PAD, height: size + VIEWPORT_PAD });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const t1 = Date.now();

    await page.waitForFunction(() => window.__sceneReady === true, { timeout: 10000 });
    await page.waitForFunction(() => window.__scene?.isReady?.() === true, { timeout: 30000 });
    const t2 = Date.now();

    await page.evaluate(() => {
      return window.__scene?.waitForSettled?.({ settleMs: 1000, timeoutMs: 60000 });
    });
    const t3 = Date.now();

    const dataUrl = await page.evaluate(() => {
      return window.__scene?.capture?.() ?? null;
    });
    const t4 = Date.now();

    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('capture() returned invalid data');
    }

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    const suffix = mode === 'gpu' ? '_gpu' : '_cpu';
    const pngPath = resolve(
      outputDir,
      `tile_${lat.toFixed(4)}_${lng.toFixed(4)}_p${pitch}_y${yaw}${suffix}.png`,
    );
    await writeFile(pngPath, buf);

    return {
      mode,
      phases: {
        navigationMs: t1 - t0,
        sceneReadyMs: t2 - t1,
        tilesSettledMs: t3 - t2,
        captureMs: t4 - t3,
        totalMs: t4 - t0,
      },
      pngPath,
      pngBytes: buf.length,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  [${mode}] FAILED: ${error}`);
    return {
      mode,
      phases: { navigationMs: 0, sceneReadyMs: 0, tilesSettledMs: 0, captureMs: 0, totalMs: 0 },
      pngPath: '',
      pngBytes: 0,
      error,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const baseUrl = env.renderWorkerUrl ?? 'http://localhost:3210/render-worker';
  const outputDir = resolve(__dirname, '../../data/spike-renders');
  await mkdir(outputDir, { recursive: true });

  const LAT = -7.1195;
  const LNG = -34.8286;
  const PITCH = 60;
  const YAW = 0;
  const ZOOM = 17.5;
  const SIZE = 1024;

  console.log('=== Render Worker — CPU vs GPU Comparison ===\n');

  const cpuBrowser = await launchBrowser('cpu');
  const cpuResult = await renderTile(
    cpuBrowser,
    baseUrl,
    LAT,
    LNG,
    PITCH,
    YAW,
    ZOOM,
    SIZE,
    'cpu',
    outputDir,
  );
  await cpuBrowser.close();

  const gpuBrowser = await launchBrowser('gpu');
  const gpuResult = await renderTile(
    gpuBrowser,
    baseUrl,
    LAT,
    LNG,
    PITCH,
    YAW,
    ZOOM,
    SIZE,
    'gpu',
    outputDir,
  );
  await gpuBrowser.close();

  const results = [cpuResult, gpuResult];

  console.log('\n=== Comparison ===\n');
  console.log('Phase'.padEnd(30), 'CPU (SwiftShader)'.padEnd(22), 'GPU (Metal)'.padEnd(22));
  console.log('-'.repeat(74));

  const phases: (keyof PhaseTiming)[] = [
    'navigationMs',
    'sceneReadyMs',
    'tilesSettledMs',
    'captureMs',
    'totalMs',
  ];
  const phaseLabels: Record<string, string> = {
    navigationMs: 'page load',
    sceneReadyMs: 'scene init',
    tilesSettledMs: 'tiles settle',
    captureMs: 'capture',
    totalMs: 'TOTAL',
  };

  for (const phase of phases) {
    const cpuMs = cpuResult.phases[phase];
    const gpuMs = gpuResult.phases[phase];
    const label = phaseLabels[phase] ?? phase;
    const speedup = gpuMs > 0 ? (cpuMs / gpuMs).toFixed(1) : '-';
    console.log(
      label.padEnd(30),
      `${cpuMs}ms`.padEnd(22),
      `${gpuMs}ms`.padEnd(22),
      gpuMs > 0 && cpuMs > gpuMs ? `(${speedup}x faster)` : '',
    );
  }

  console.log('\n---');
  for (const r of results) {
    const label = r.mode === 'gpu' ? 'GPU (Metal)' : 'CPU (SwiftShader)';
    const gpuMarker = r.mode === 'gpu' ? ' ✅' : '';
    console.log(`${label}: ${r.pngPath} (${(r.pngBytes / 1024).toFixed(0)} KB)${gpuMarker}`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
