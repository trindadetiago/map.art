import { getStorage } from '@mapart/storage';

/**
 * Tile proxy: streams a project's pyramid objects out of blob storage.
 *
 * The analog of isometric.nyc's ~60-line Cloudflare Worker — serve `viz/<path>`
 * from storage with immutable cache + CORS, no tile logic. The pyramid is
 * content-addressed by (project, level, col, row), so every object is safe to
 * cache forever.
 */
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  dzi: 'application/xml',
  xml: 'application/xml',
  json: 'application/json',
};

function contentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Opening a deep-zoom view fires ~20 tile requests at once over a single HTTP/2
// connection, so they hit this process near-simultaneously. Letting them all
// stampede storage at once makes the backend deny/cancel some (surfacing as a
// spurious NoSuchKey). A small process-wide semaphore smooths the burst; spread
// over a few ticks the same requests all succeed.
const MAX_INFLIGHT = 8;
let inflight = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inflight++;
}
function release(): void {
  inflight--;
  waiters.shift()?.();
}

// A complete dzsave pyramid has a tile for every (level, col, row) in range, so
// a 404 under load is spurious — retry it like any other transient failure.
async function getWithRetry(key: string): Promise<Buffer> {
  const storage = getStorage();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await storage.get(key);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(60 * 2 ** attempt);
    }
  }
  throw lastErr;
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p === '.' || p.includes('/'))) {
    return new Response('Bad request', { status: 400 });
  }
  const key = `viz/${path.join('/')}`;

  await acquire();
  try {
    const buf = await getWithRetry(key);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType(key),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.error('[viz] tile fetch failed', {
      key,
      name: e?.name,
      status: e?.$metadata?.httpStatusCode,
      message: e?.message?.slice(0, 160),
    });
    // 404 only when the object is genuinely absent; otherwise 503 so the viewer retries.
    return new Response(isMissing(err) ? 'Not found' : 'Upstream error', {
      status: isMissing(err) ? 404 : 503,
      headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '1' },
    });
  } finally {
    release();
  }
}
