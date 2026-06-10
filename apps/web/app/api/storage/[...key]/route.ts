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
  // the content does, making the response safe to cache forever.
  const immutable = req.nextUrl.searchParams.has('v');
  try {
    const buf = await getStorage().get(key);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': contentTypeFor(key),
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
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
