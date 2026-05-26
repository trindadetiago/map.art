import { repos } from '@mapart/db';
import type { Browser } from 'puppeteer';
import '@mapart/env';
import { env } from '@mapart/env';
import { type RenderTilePayload, startQueue, stopQueue } from '@mapart/queue';
import { renderParamsForTile } from '@mapart/shared';
import { getStorage } from '@mapart/storage';
import { VIEWPORT_PAD, launchBrowser } from './chrome';

const WORKER_NAME = `render-worker-${process.pid}`;
const BASE_URL = env.renderWorkerUrl;
const RENDER_DEADLINE_MS = 120_000;

let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;

  if (browserPromise) return browserPromise;

  browserPromise = launchBrowser()
    .then((b) => {
      browser = b;
      browserPromise = null;
      b.on('disconnected', () => {
        console.warn(
          `[${WORKER_NAME}] browser disconnected unexpectedly — will relaunch on next job`,
        );
        browser = null;
        browserPromise = null;
      });
      return b;
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });

  return browserPromise;
}

async function renderAndCapture(job: RenderTilePayload, signal?: AbortSignal): Promise<Buffer> {
  const params = renderParamsForTile(
    {
      centerLat: job.centerLat,
      centerLng: job.centerLng,
      cameraPitch: job.cameraPitch,
      cameraYaw: job.cameraYaw,
      tileWorldMeters: job.tileWorldMeters,
      tilePixelSize: job.tilePixelSize,
    },
    job.col,
    job.row,
  );

  const url =
    `${BASE_URL}?lat=${params.center.lat}&lng=${params.center.lng}` +
    `&pitch=${params.pitch}&yaw=${params.yaw}&zoom=${params.zoom}&size=${params.size}` +
    `&token=${process.env.RENDER_WORKER_TOKEN ?? 'dev-token-placeholder'}`;

  const b = await getBrowser();
  const page = await b.newPage();

  page.on('pageerror', (err) => console.error(`[${WORKER_NAME}] page error:`, String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${WORKER_NAME}] console:`, msg.text());
  });

  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        page.close().catch(() => {});
      },
      { once: true },
    );
  }

  try {
    await page.setViewport({
      width: params.size + VIEWPORT_PAD,
      height: params.size + VIEWPORT_PAD,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForFunction(() => window.__sceneReady === true, { timeout: 10000 });

    await page.waitForFunction(() => window.__scene?.isReady?.() === true, { timeout: 30000 });

    await page.evaluate(
      (settleOpts) => {
        return window.__scene?.waitForSettled?.(settleOpts);
      },
      { settleMs: 1000, timeoutMs: 30000 },
    );

    const dataUrl = await page.evaluate(() => {
      return window.__scene?.capture?.() ?? null;
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('capture() returned invalid data');
    }

    const comma = dataUrl.indexOf(',');
    if (comma === -1) {
      throw new Error('capture() returned malformed data URL — missing comma');
    }

    const base64 = dataUrl.slice(comma + 1);
    return Buffer.from(base64, 'base64');
  } finally {
    await page.close();
  }
}

async function processRenderJob(job: RenderTilePayload): Promise<void> {
  let dbJob: Awaited<ReturnType<typeof repos.createJob>> | null = null;

  try {
    dbJob = await repos.createJob({
      projectId: job.projectId,
      kind: 'render',
      col: job.col,
      row: job.row,
      payload: {},
      status: 'pending',
      idempotencyKey: job.idempotencyKey,
    });
  } catch (err) {
    console.error(`[${WORKER_NAME}] createJob failed (${job.col},${job.row}):`, err);
    throw err;
  }

  try {
    const claimed = await repos.claimJob(dbJob.id, WORKER_NAME);
    if (!claimed) {
      console.log(`[${WORKER_NAME}] duplicate job skipped: ${job.idempotencyKey}`);
      await repos.failJob(dbJob.id, 'Job already claimed by another worker');
      return;
    }
  } catch (err) {
    console.error(`[${WORKER_NAME}] claimJob failed (${job.col},${job.row}):`, err);
    await repos.failJob(dbJob.id, err instanceof Error ? err.message : String(err));
    return;
  }

  console.log(`[${WORKER_NAME}] rendering tile (${job.col},${job.row}) project=${job.projectId}`);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  try {
    abortController = new AbortController();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        abortController?.abort();
        reject(new Error(`render deadline exceeded (${RENDER_DEADLINE_MS}ms)`));
      }, RENDER_DEADLINE_MS);
    });

    const pngBuffer = await Promise.race([
      renderAndCapture(job, abortController.signal).finally(() => clearTimeout(timeout)),
      timeoutPromise,
    ]).catch((err) => {
      throw err;
    });

    const storageKey = `pipeline/${job.projectId}/rendered/${job.col}_${job.row}.png`;
    await getStorage().put(storageKey, pngBuffer);

    const versionId = await repos.createTileVersionAndSetCurrent({
      projectId: job.projectId,
      col: job.col,
      row: job.row,
      source: 'rendered',
      storageKey,
    });

    await repos.completeJob(dbJob.id, versionId, {
      rendered: true,
      storageKey,
      pngSize: pngBuffer.length,
    });

    console.log(`[${WORKER_NAME}] render done: ${storageKey} (${pngBuffer.length} bytes)`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] render failed (${job.col},${job.row}): ${errorMsg}`);
    if (!abortController?.signal.aborted) {
      await repos.failJob(dbJob.id, errorMsg);
    }
  } finally {
    clearTimeout(timeout);
  }
}

let shuttingDown = false;

async function shutdown(signal?: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${WORKER_NAME}] shutting down...`);
  try {
    await stopQueue();
  } catch (err) {
    console.error(`[${WORKER_NAME}] stopQueue error:`, err);
  }
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
  const exitCode = signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : 0;
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  console.log(`[${WORKER_NAME}] starting...`);
  console.log(`[${WORKER_NAME}] render-worker URL: ${BASE_URL}`);

  const boss = await startQueue();
  console.log(`[${WORKER_NAME}] queue connected, listening on 'render-tile'`);

  await boss.work<RenderTilePayload>(
    'render-tile',
    async (pgBossJob: { data: RenderTilePayload }) => {
      if (shuttingDown) return;
      await processRenderJob(pgBossJob.data);
    },
  );

  console.log(`[${WORKER_NAME}] ready`);
}

main().catch((err) => {
  console.error(`[${WORKER_NAME}] FATAL:`, err);
  process.exit(1);
});
