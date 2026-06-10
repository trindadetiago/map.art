import { getStorage } from '@mapart/storage';
import { type NextRequest, NextResponse } from 'next/server';

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
    if (req.nextUrl.searchParams.has('v')) {
      const url = await getStorage().presignGet(key, 7 * 24 * 3600, {
        contentType: contentTypeFor(key),
        cacheControl: 'public, max-age=31536000, immutable',
      });
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
    return NextResponse.json({ error: err.message ?? 'unknown' }, { status: 500 });
  }
}
