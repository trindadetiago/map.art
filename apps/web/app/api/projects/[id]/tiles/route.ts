import { repos } from '@mapart/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Polling endpoint for the live project grid (step 3). Returns the minimal tile
 * state the client paints from, plus the phase/status counts for the progress
 * summary. No caching — the worker pool mutates these rows continuously.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const [tiles, counts] = await Promise.all([
      repos.tilesByProject(id),
      repos.tileStatusCounts(id),
    ]);
    return NextResponse.json(
      {
        tiles: tiles.map((t) => ({
          x: t.x,
          y: t.y,
          currentStatusType: t.currentStatusType,
          status: t.status,
          renderedImgPath: t.renderedImgPath,
          stylizedImgPath: t.stylizedImgPath,
          v: t.updatedAt.getTime(),
        })),
        counts,
      },
      { headers: { 'cache-control': 'no-cache' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
