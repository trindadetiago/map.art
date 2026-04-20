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
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: parts } = await params;
  const key = parts.map((p) => decodeURIComponent(p)).join('/');
  try {
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
