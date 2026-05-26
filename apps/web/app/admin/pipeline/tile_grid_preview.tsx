'use client';

import type { RenderedTileInfo } from './panel';

export function TileGridPreview({
  tiles,
  pixelSize: _pixelSize,
}: {
  tiles: RenderedTileInfo[];
  pixelSize: number;
}) {
  if (tiles.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-300 p-6 text-xs opacity-50">
        no tiles yet
      </div>
    );
  }
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  for (const t of tiles) {
    if (t.col < minCol) minCol = t.col;
    if (t.col > maxCol) maxCol = t.col;
    if (t.row < minRow) minRow = t.row;
    if (t.row > maxRow) maxRow = t.row;
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const byKey = new Map<string, RenderedTileInfo>();
  for (const t of tiles) byKey.set(`${t.col},${t.row}`, t);
  const thumbSize = Math.min(96, Math.floor(480 / Math.max(cols, rows)));

  return (
    <div
      className="grid gap-px rounded bg-neutral-950 p-px"
      style={{ gridTemplateColumns: `repeat(${cols}, ${thumbSize}px)` }}
    >
      {Array.from({ length: rows }, (_, rIdx) =>
        Array.from({ length: cols }, (_, cIdx) => {
          const col = minCol + cIdx;
          const row = maxRow - rIdx; // invert: row+ grows upward on screen
          const t = byKey.get(`${col},${row}`);
          return (
            <div
              key={`${col},${row}`}
              className={`overflow-hidden ${t ? 'bg-black' : 'bg-neutral-800'}`}
              style={{ width: thumbSize, height: thumbSize }}
              title={`col=${col} row=${row}`}
            >
              {t && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.url}
                  alt={`tile ${col},${row}`}
                  className="object-cover [image-rendering:pixelated]"
                  style={{ width: thumbSize, height: thumbSize }}
                />
              )}
            </div>
          );
        }),
      ).flat()}
    </div>
  );
}
