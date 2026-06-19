import { repos } from '@mapart/db';
import { getStorage } from '@mapart/storage';
import { OUTPUT_FORMAT, TILE_SIZE, stylizeKey } from '@mapart/stylize';
import { type NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { log } from '../../../../../lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Persist one post-process imported tile. The request body is the raw edited
 * image (PNG) for the tile at `?x=&y=`: it's re-encoded into the stylize output
 * format, written to that tile's stylize key (overwriting any worker output in
 * place), and the tile is pointed at it. Bumping `updatedAt` cache-busts the
 * served image so the edit shows everywhere it's displayed.
 *
 * One tile per request (raw body, not multipart) keeps each upload small and
 * bounded — a whole-region import would otherwise blow past the request body
 * cap and arrive truncated.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  const x = Number(req.nextUrl.searchParams.get('x'));
  const y = Number(req.nextUrl.searchParams.get('y'));
  try {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return NextResponse.json({ ok: false, error: 'x and y must be integers' }, { status: 400 });
    }
    const png = Buffer.from(await req.arrayBuffer());
    if (png.length === 0) {
      return NextResponse.json({ ok: false, error: 'empty image body' }, { status: 400 });
    }
    const out = await OUTPUT_FORMAT.encode(
      sharp(png).resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' }),
    ).toBuffer();
    const key = stylizeKey(projectId, x, y);
    await getStorage().put(key, out);
    const n = await repos.setStylizedImage(projectId, x, y, key);
    if (n === 0) {
      return NextResponse.json(
        { ok: false, error: `tile ${x},${y} not found in project` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    log.error('saveImportedTile failed', { projectId, x, y, err: e });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
