import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'puppeteer';
import { launchBrowser, type RenderGpuMode } from './chrome';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadEnv(): Promise<string> {
  const envPath = resolve(__dirname, '../../.env');
  try {
    const contents = readFileSync(envPath, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const raw = trimmed.slice(eq + 1).trim();
      const value = raw.replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found, using process.env directly
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY not set in .env or environment');
  return key;
}

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
  const url = `${baseUrl}?lat=${lat}&lng=${lng}&pitch=${pitch}&yaw=${yaw}&zoom=${zoom}&size=${size}`;
  const page = await browser.newPage();

  try {
    const t0 = Date.now();

    await page.setViewport({ width: size + 100, height: size + 100 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const t1 = Date.now();

    await page.waitForFunction(
      () => window.__sceneReady === true,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => window.__scene?.isReady?.() === true,
      { timeout: 30000 },
    );
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
    const pngPath = resolve(outputDir, `tile_${lat.toFixed(4)}_${lng.toFixed(4)}_p${pitch}_y${yaw}${suffix}.png`);
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
    return { mode, phases: { navigationMs: 0, sceneReadyMs: 0, tilesSettledMs: 0, captureMs: 0, totalMs: 0 }, pngPath: '', pngBytes: 0, error };
  } finally {
    await page.close();
  }
}

function formatPhase(label: string, ms: number): string {
  return `${label}: ${ms}ms`.padEnd(30);
}

async function main() {
  await loadEnv();

  const baseUrl = process.env.RENDER_WORKER_URL ?? 'http://localhost:3210/render-worker';
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
  const cpuResult = await renderTile(cpuBrowser, baseUrl, LAT, LNG, PITCH, YAW, ZOOM, SIZE, 'cpu', outputDir);
  await cpuBrowser.close();

  const gpuBrowser = await launchBrowser('gpu');
  const gpuResult = await renderTile(gpuBrowser, baseUrl, LAT, LNG, PITCH, YAW, ZOOM, SIZE, 'gpu', outputDir);
  await gpuBrowser.close();

  const results = [cpuResult, gpuResult];

  console.log('\n=== Comparison ===\n');
  console.log('Phase'.padEnd(30), 'CPU (SwiftShader)'.padEnd(22), 'GPU (Metal)'.padEnd(22));
  console.log('-'.repeat(74));

  const phases: (keyof PhaseTiming)[] = ['navigationMs', 'sceneReadyMs', 'tilesSettledMs', 'captureMs', 'totalMs'];
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
