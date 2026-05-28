'use client';

export function TileGrid3x3({
  tiles,
}: {
  tiles: ReadonlyArray<{ col: number; row: number; url: string }>;
}) {
  // Place each tile in its 3×3 slot via (col, row). row=+1 is top.
  const byKey = new Map<string, string>();
  for (const t of tiles) byKey.set(`${t.col},${t.row}`, t.url);
  const slots: Array<{ col: number; row: number; url: string | null }> = [];
  for (let r = 1; r >= -1; r--) {
    for (let c = -1; c <= 1; c++) {
      slots.push({ col: c, row: r, url: byKey.get(`${c},${r}`) ?? null });
    }
  }
  return (
    <div className="grid grid-cols-3 gap-px bg-stone-200">
      {slots.map((s) =>
        s.url ? (
          // biome-ignore lint/a11y/useAltText: sample thumb
          <img
            key={`${s.col},${s.row}`}
            src={s.url}
            className="block h-auto w-full bg-stone-900 [image-rendering:pixelated]"
          />
        ) : (
          <div key={`${s.col},${s.row}`} className="aspect-square bg-stone-800" />
        ),
      )}
    </div>
  );
}
