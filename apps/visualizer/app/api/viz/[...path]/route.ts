import { getStorage } from '@mapart/storage';

/**
 * Tile proxy: streams a project's pyramid objects out of blob storage.
 *
 * This is the analog of isometric.nyc's ~60-line Cloudflare Worker — it does two
 * things and no tile logic: serve `viz/<path>` from storage, and stamp immutable
 * cache + CORS headers. The pyramid is content-addressed by (project, level,
 * col, row), so every object is safe to cache forever.
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

/** A storage error that means the object genuinely doesn't exist (vs. a
 * transient throttle/timeout, which is retryable). */
function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p === '.' || p.includes('/'))) {
    return new Response('Bad request', { status: 400 });
  }
  const key = `viz/${path.join('/')}`;
  const storage = getStorage();

  // A viewer load fires dozens of tile requests at once; under that burst remote
  // storage occasionally throttles/cancels a request. Retry transient failures
  // with backoff, and — critically — return 503 (not 404) when retries are
  // exhausted so OpenSeadragon re-requests the tile instead of treating it as a
  // permanent gap and leaving a black hole.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const buf = await storage.get(key);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': contentType(key),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      if (isMissing(err)) return new Response('Not found', { status: 404 });
      if (attempt < 3) await sleep(80 * 2 ** attempt);
    }
  }
  return new Response('Upstream error', {
    status: 503,
    headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '1' },
  });
}
