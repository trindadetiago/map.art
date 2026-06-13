/**
 * apps/worker-render — server-side render service.
 *
 * Three roles, one process:
 *   1. Hosts the render-page (Vite middleware in dev; serves built static
 *      files in prod) on GET /. Puppeteer navigates here to execute Scene.
 *   2. Runs the render-queue consumer (./consumer.ts): claims render/pending
 *      tiles from the database, renders them, writes PNGs to storage, marks
 *      them done. This is the worker's real job.
 *   3. Exposes POST /render — DEV / TESTING ONLY. Same render path driven by an
 *      HTTP request returning PNG bytes, for smoke tests like
 *      `pnpm mapart render --lat … --out …`.
 */
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@mapart/env';
import { closeDb } from '@mapart/db';
import { env } from '@mapart/env';
import { createLogger } from '@mapart/logger';
import type { Browser } from 'pptr';
import { type ViteDevServer, createServer as createViteServer } from 'vite';
import { VIEWPORT_PAD, launchBrowser } from './chrome';
import { IDLE_POLL_MS, type RenderConsumer, startRenderConsumer } from './consumer';

interface RenderTileRequest {
  lat: number;
  lng: number;
  pitch: number;
  yaw: number;
  zoom: number;
  size: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDER_PAGE_ROOT = resolve(__dirname, 'render-page');
const WORKER_NAME = `render-worker-${process.pid}`;
const PORT = Number.parseInt(env.renderWorkerPort, 10);
const log = createLogger('worker-render', { pid: process.pid });

// Browser is launched lazily on the first render and reused. The disconnect
// handler nulls it out so the next request relaunches.
let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (browserPromise) return browserPromise;
  browserPromise = launchBrowser(log.child({ component: 'chrome' })).then((b) => {
    browser = b;
    browserPromise = null;
    b.on('disconnected', () => {
      log.warn('browser disconnected — will relaunch on next render');
      browser = null;
      browserPromise = null;
    });
    return b;
  });
  return browserPromise;
}

async function renderTile(req: RenderTileRequest): Promise<Buffer> {
  const url = new URL(`http://localhost:${PORT}/`);
  url.searchParams.set('lat', String(req.lat));
  url.searchParams.set('lng', String(req.lng));
  url.searchParams.set('pitch', String(req.pitch));
  url.searchParams.set('yaw', String(req.yaw));
  url.searchParams.set('zoom', String(req.zoom));
  url.searchParams.set('size', String(req.size));
  if (env.googleMapsApiKey) url.searchParams.set('apiKey', env.googleMapsApiKey);

  const b = await getBrowser();
  const page = await b.newPage();
  page.on('pageerror', (err) => log.error('render-page error', { error: String(err) }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.warn('render-page console error', { text: msg.text() });
  });

  try {
    await page.setViewport({ width: req.size + VIEWPORT_PAD, height: req.size + VIEWPORT_PAD });
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction('window.__sceneReady === true', { timeout: 10_000 });
    await page.waitForFunction('window.__scene?.isReady?.() === true', { timeout: 30_000 });
    await page.evaluate(
      (opts) =>
        (
          window as unknown as { __scene: { waitForSettled: (o: typeof opts) => Promise<void> } }
        ).__scene.waitForSettled(opts),
      { settleMs: 1000, timeoutMs: 30_000 },
    );
    const dataUrl = await page.evaluate(
      () =>
        (window as unknown as { __scene: { capture: () => string | null } }).__scene.capture() ??
        null,
    );
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('capture() returned invalid data');
    }
    const comma = dataUrl.indexOf(',');
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } finally {
    await page.close().catch(() => {});
  }
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseRequest(body: unknown): RenderTileRequest {
  if (typeof body !== 'object' || body === null) throw new Error('body must be a JSON object');
  const obj = body as Record<string, unknown>;
  const num = (k: string): number => {
    const v = obj[k];
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`field "${k}" must be a finite number`);
    return v;
  };
  return {
    lat: num('lat'),
    lng: num('lng'),
    pitch: num('pitch'),
    yaw: num('yaw'),
    zoom: num('zoom'),
    size: num('size'),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  try {
    const body = await parseBody(req);
    const tileReq = parseRequest(body);
    const png = await renderTile(tileReq);
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(png.length),
      'x-render-duration-ms': String(Date.now() - startedAt),
    });
    res.end(png);
    log.info('render request served', {
      lat: Number(tileReq.lat.toFixed(4)),
      lng: Number(tileReq.lng.toFixed(4)),
      zoom: tileReq.zoom,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('render request failed', { err: e });
    sendJson(res, 400, { ok: false, error: msg });
  }
}

let vite: ViteDevServer | null = null;
let consumer: RenderConsumer | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutting down', { signal });
  if (consumer) {
    consumer.stop();
    await consumer.done.catch(() => {});
  }
  if (vite) await vite.close().catch(() => {});
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function main(): Promise<void> {
  vite = await createViteServer({
    root: RENDER_PAGE_ROOT,
    server: { middlewareMode: true },
    appType: 'spa', // Vite includes an HTML middleware that serves index.html on GET /
  });

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/render') {
      void handleRender(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, name: WORKER_NAME, browser: browser?.connected ?? false });
      return;
    }
    // Everything else (GET /, GET /main.tsx, GET /@vite/client, …) goes to Vite.
    vite?.middlewares(req, res, () => {
      sendJson(res, 404, { ok: false, error: 'not found' });
    });
  });

  server.listen(PORT, () => {
    log.info('listening', {
      url: `http://localhost:${PORT}`,
      renderPage: 'GET /',
      health: 'GET /health',
    });
    log.info('POST /render is dev only — prod renders come from the queue');
    // Start consuming the render queue. Needs the server up first — renderTile
    // navigates Puppeteer to this same port to execute Scene.
    consumer = startRenderConsumer(renderTile, log.child({ component: 'consumer' }));
    log.info('queue consumer started', { idlePollMs: IDLE_POLL_MS });
  });
}

main().catch((err) => {
  log.error('fatal — exiting', { err });
  process.exit(1);
});
