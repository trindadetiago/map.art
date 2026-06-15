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

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p === '.' || p.includes('/'))) {
    return new Response('Bad request', { status: 400 });
  }
  const key = `viz/${path.join('/')}`;

  try {
    const buf = await getStorage().get(key);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType(key),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
