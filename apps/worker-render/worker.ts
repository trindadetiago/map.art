/**
 * apps/worker-render — server-side render service.
 *
 * Two roles, one process:
 *   1. Hosts the render-page (Vite middleware in dev; serves built static
 *      files in prod) on GET /. Puppeteer navigates here to execute Scene.
 *   2. Exposes POST /render — DEV / TESTING ONLY. Accepts a tile request,
 *      drives Puppeteer, returns PNG bytes. In production, render jobs come
 *      from the pg-boss queue, not over HTTP; this endpoint would be removed
 *      (or gated behind RENDER_HTTP_ENABLED). It exists today so we can smoke
 *      the pipeline end-to-end with `pnpm mapart render --lat … --out …`.
 */
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@mapart/env';
import { env } from '@mapart/env';
import type { Browser } from 'puppeteer';
import { type ViteDevServer, createServer as createViteServer } from 'vite';
import { VIEWPORT_PAD, launchBrowser } from './chrome';

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

// Browser is launched lazily on the first render and reused. The disconnect
// handler nulls it out so the next request relaunches.
let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (browserPromise) return browserPromise;
  browserPromise = launchBrowser().then((b) => {
    browser = b;
    browserPromise = null;
    b.on('disconnected', () => {
      console.warn(`[${WORKER_NAME}] browser disconnected — will relaunch on next render`);
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
  page.on('pageerror', (err) => console.error(`[${WORKER_NAME}] page error:`, String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${WORKER_NAME}] console:`, msg.text());
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
    console.log(
      `[${WORKER_NAME}] rendered ${tileReq.lat.toFixed(4)},${tileReq.lng.toFixed(4)} z=${tileReq.zoom} in ${Date.now() - startedAt}ms`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${WORKER_NAME}] render failed:`, msg);
    sendJson(res, 400, { ok: false, error: msg });
  }
}

let vite: ViteDevServer | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${WORKER_NAME}] shutting down (${signal})`);
  if (vite) await vite.close().catch(() => {});
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
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
    console.log(`[${WORKER_NAME}] listening on http://localhost:${PORT}`);
    console.log(`[${WORKER_NAME}] render-page served at      GET  /`);
    console.log(`[${WORKER_NAME}] POST /render is DEV ONLY — prod renders come from the queue`);
    console.log(`[${WORKER_NAME}] health at                   GET  /health`);
  });
}

main().catch((err) => {
  console.error(`[${WORKER_NAME}] FATAL:`, err);
  process.exit(1);
});
