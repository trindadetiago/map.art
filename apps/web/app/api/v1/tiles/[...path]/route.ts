import { repos } from '@mapart/db';
import { getStorage } from '@mapart/storage';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  const projectId = path[0];
  const representation = path[1];
  const filename = path[2];
  if (!projectId || !representation || !filename) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const [colStr = '0', rowStr = '0'] = filename.replace('.png', '').split('_');
  const col = Number.parseInt(colStr, 10);
  const row = Number.parseInt(rowStr, 10);

  const tileVersion = await repos.listTileVersionByProjectAndCoords(
    projectId,
    col,
    row,
    representation as 'rendered' | 'generated' | 'manual',
  );

  if (!tileVersion) {
    return NextResponse.json({ error: 'Tile not found' }, { status: 404 });
  }

  const storage = await getStorage();

  try {
    const presignedUrl = await storage.presignReadUrl(tileVersion.storageKey, 3600);

    if (presignedUrl.startsWith('http')) {
      return NextResponse.redirect(presignedUrl, {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: `"${tileVersion.id}"`,
        },
      });
    }

    const buffer = await storage.get(tileVersion.storageKey);
    if (!buffer) {
      return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${tileVersion.id}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[tiles] Failed to serve tile:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
