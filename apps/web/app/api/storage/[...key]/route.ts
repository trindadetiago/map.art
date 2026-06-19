import { getStorage } from '@mapart/storage';
import { type NextRequest, NextResponse } from 'next/server';
import { log } from '../../../../lib/logger';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  json: 'application/json',
};

function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// A fresh presign mints a new signature each call, so the same image would get a
// different URL on every request and the browser's disk cache (keyed by URL)
// could never reuse it. Keying by `key` + `?v=` version, we hand back one stable
// URL per version: identical address every reload, so the cache actually holds.
// Entries refresh before the signature expires, keeping the served URL valid.
const PRESIGN_VALID_S = 7 * 24 * 3600;
const PRESIGN_TTL_MS = 6 * 24 * 3600 * 1000;
const PRESIGN_MAX_ENTRIES = 10_000;
const presignCache = new Map<string, { url: string; expiresAt: number }>();

async function stablePresign(key: string, version: string): Promise<string> {
  const cacheKey = `${key}?v=${version}`;
  const now = Date.now();
  const hit = presignCache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.url;

  const url = await getStorage().presignGet(key, PRESIGN_VALID_S, {
    contentType: contentTypeFor(key),
    cacheControl: 'public, max-age=31536000, immutable',
  });
  presignCache.set(cacheKey, { url, expiresAt: now + PRESIGN_TTL_MS });

  // Bound memory: Map iterates in insertion order, so the first key is the oldest.
  if (presignCache.size > PRESIGN_MAX_ENTRIES) {
    const oldest = presignCache.keys().next().value;
    if (oldest !== undefined) presignCache.delete(oldest);
  }
  return url;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: parts } = await params;
  const key = parts.map((p) => decodeURIComponent(p)).join('/');
  // Storage keys are stable and overwritten in place, so a bare URL must not be
  // cached. A `?v=` URL embeds the object's version: the URL changes whenever
  // the content does, making the response safe to cache.
  //
  // Versioned requests redirect to a presigned bucket URL instead of proxying
  // the bytes: downloads from the bucket are free, while bytes proxied through
  // this service are billed egress. The redirect's max-age stays safely below
  // the presigned URL's 7-day validity so a cached redirect can never point at
  // an expired signature; the bucket response itself is cached as immutable.
  try {
    const version = req.nextUrl.searchParams.get('v');
    if (version !== null) {
      const url = await stablePresign(key, version);
      return NextResponse.redirect(url, {
        status: 302,
        headers: { 'cache-control': 'public, max-age=518400' },
      });
    }
    const buf = await getStorage().get(key);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': contentTypeFor(key),
        'cache-control': 'no-cache',
      },
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'not found', key }, { status: 404 });
    }
    log.error('storage fetch failed', { key, err });
    return NextResponse.json({ error: err.message ?? 'unknown' }, { status: 500 });
  }
}
