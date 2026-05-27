'use client';

import { Scene, type SceneHandle } from '@mapart/renderer';
import { type RenderParams, renderParamsForTile } from '@mapart/renderer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface SavedTile {
  col: number;
  row: number;
  url: string;
  filename: string;
}

export interface TileRendererProps {
  apiKey: string;
  projectId: string;
  tiles: ReadonlyArray<{ col: number; row: number }>;
  centerLat: number;
  centerLng: number;
  cameraPitch: number;
  cameraYaw: number;
  tileWorldMeters: number;
  tilePixelSize: number;
  saveTileAction: (
    fd: FormData,
  ) => Promise<
    | { ok: true; col: number; row: number; url: string; filename: string }
    | { ok: false; error: string }
  >;
  listTilesAction: (projectId: string) => Promise<SavedTile[]>;
}

const keyOf = (col: number, row: number) => `${col},${row}`;

export function TileRenderer({
  apiKey,
  projectId,
  tiles,
  centerLat,
  centerLng,
  cameraPitch,
  cameraYaw,
  tileWorldMeters,
  tilePixelSize,
  saveTileAction,
  listTilesAction,
}: TileRendererProps) {
  const project = useMemo(
    () => ({
      centerLat,
      centerLng,
      cameraPitch,
      cameraYaw,
      tileWorldMeters,
      tilePixelSize,
    }),
    [centerLat, centerLng, cameraPitch, cameraYaw, tileWorldMeters, tilePixelSize],
  );

  const firstTile = tiles[0] ?? { col: 0, row: 0 };
  const [activeParams, setActiveParams] = useState<RenderParams>(() =>
    renderParamsForTile(project, firstTile.col, firstTile.row),
  );
  const sceneRef = useRef<SceneHandle>(null);

  const [savedMap, setSavedMap] = useState<Map<string, SavedTile>>(() => new Map());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  // Refresh-bust thumbnails when a tile is re-rendered (same storage URL).
  const [thumbVersion, setThumbVersion] = useState<Map<string, number>>(() => new Map());

  const renderOne = useCallback(
    async (col: number, row: number): Promise<void> => {
      const k = keyOf(col, row);
      setError(null);
      setPending((s) => new Set(s).add(k));
      try {
        const scene = sceneRef.current;
        if (!scene) throw new Error('Scene not ready');
        const params = renderParamsForTile(project, col, row);
        setActiveParams(params);
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await scene.waitForSettled({ settleMs: 600, timeoutMs: 20000 }).catch((e) => {
          console.warn(`[tiles] settle warning at (${col},${row})`, e);
        });
        const dataUrl = scene.capture();
        if (!dataUrl) throw new Error(`capture returned null at (${col},${row})`);
        const blob = await (await fetch(dataUrl)).blob();
        const fd = new FormData();
        fd.append('projectId', projectId);
        fd.append('col', String(col));
        fd.append('row', String(row));
        fd.append('png', blob, `${col}_${row}.png`);
        const res = await saveTileAction(fd);
        if (!res.ok) throw new Error(res.error);
        setSavedMap((m) => {
          const next = new Map(m);
          next.set(k, { col: res.col, row: res.row, url: res.url, filename: res.filename });
          return next;
        });
        setThumbVersion((m) => {
          const next = new Map(m);
          next.set(k, (m.get(k) ?? 0) + 1);
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(k);
          return next;
        });
      }
    },
    [projectId, saveTileAction, project],
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listTilesAction(projectId);
      const m = new Map<string, SavedTile>();
      for (const t of list) m.set(keyOf(t.col, t.row), t);
      setSavedMap(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [listTilesAction, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAll = useCallback(async () => {
    setError(null);
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: tiles.length });
    try {
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (!t) continue;
        await renderOne(t.col, t.row);
        setBulkProgress({ done: i + 1, total: tiles.length });
      }
    } finally {
      setBulkRunning(false);
    }
  }, [tiles, renderOne]);

  const runMissing = useCallback(async () => {
    setError(null);
    const missing = tiles.filter((t) => !savedMap.has(keyOf(t.col, t.row)));
    setBulkRunning(true);
    setBulkProgress({ done: 0, total: missing.length });
    try {
      for (let i = 0; i < missing.length; i++) {
        const t = missing[i];
        if (!t) continue;
        await renderOne(t.col, t.row);
        setBulkProgress({ done: i + 1, total: missing.length });
      }
    } finally {
      setBulkRunning(false);
    }
  }, [tiles, savedMap, renderOne]);

  // Grid extents — used to lay out the clickable grid below.
  let minCol = 0;
  let maxCol = 0;
  let minRow = 0;
  let maxRow = 0;
  if (tiles.length > 0) {
    minCol = Number.POSITIVE_INFINITY;
    maxCol = Number.NEGATIVE_INFINITY;
    minRow = Number.POSITIVE_INFINITY;
    maxRow = Number.NEGATIVE_INFINITY;
    for (const t of tiles) {
      if (t.col < minCol) minCol = t.col;
      if (t.col > maxCol) maxCol = t.col;
      if (t.row < minRow) minRow = t.row;
      if (t.row > maxRow) maxRow = t.row;
    }
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  // Aim for tiles ~80px each, but shrink if grid is huge.
  const cellPx = Math.max(28, Math.min(96, Math.floor(640 / Math.max(cols, rows))));
  const busy = bulkRunning;

  const missingCount = tiles.reduce((n, t) => (savedMap.has(keyOf(t.col, t.row)) ? n : n + 1), 0);

  return (
    <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="m-0 mb-3 text-[11px] uppercase tracking-wider opacity-[0.55]">tile export</h3>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex w-[320px] flex-col gap-3">
          <div className="text-xs opacity-75">
            Click any tile in the grid to render & save it. Files are saved as{' '}
            <code>{'{col}_{row}.png'}</code> under <code>pipeline/{projectId}/rendered/</code>. Uses
            the <b>saved</b> project params; if you changed sliders above, save first.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runMissing}
              disabled={busy || missingCount === 0}
              className="cursor-pointer rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkRunning
                ? `rendering ${bulkProgress.done}/${bulkProgress.total}`
                : `render missing (${missingCount})`}
            </button>
            <button
              type="button"
              onClick={runAll}
              disabled={busy}
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              re-render all
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              reload
            </button>
          </div>
          {error && <pre className="mt-1 whitespace-pre-wrap text-xs text-red-700">{error}</pre>}
          <div className="mt-1 text-[11px] opacity-50">
            capture scene (full-res {tilePixelSize}×{tilePixelSize} off-screen, shown scaled):
          </div>
          <div className="relative h-[180px] w-[180px] overflow-hidden rounded border border-neutral-300">
            <div
              style={{
                transform: `scale(${180 / tilePixelSize})`,
                transformOrigin: 'top left',
              }}
            >
              <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
            </div>
          </div>
        </div>
        <div className="min-w-[240px] flex-1">
          <div className="mb-2 text-xs opacity-60">
            grid · {tiles.length} tiles · {savedMap.size} saved · click a cell to render
          </div>
          {tiles.length === 0 ? (
            <div className="text-xs opacity-60">no tiles seeded yet</div>
          ) : (
            <div
              className="grid w-fit gap-px rounded bg-neutral-200 p-px"
              style={{
                gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
                gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
              }}
            >
              {tiles.map((t) => {
                const k = keyOf(t.col, t.row);
                const saved = savedMap.get(k);
                const isPending = pending.has(k);
                const gridColumn = t.col - minCol + 1;
                // Flip row so highest row (north) sits at top.
                const gridRow = maxRow - t.row + 1;
                const v = thumbVersion.get(k) ?? 0;
                const thumbSrc = saved
                  ? `${saved.url}${saved.url.includes('?') ? '&' : '?'}v=${v}`
                  : null;
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => {
                      if (busy || isPending) return;
                      void renderOne(t.col, t.row);
                    }}
                    disabled={busy || isPending}
                    title={`(${t.col}, ${t.row})${saved ? ' — saved' : ''}`}
                    className={`relative overflow-hidden border-none p-0 ${saved ? 'bg-white' : 'bg-neutral-100'} ${busy || isPending ? 'cursor-wait' : 'cursor-pointer'}`}
                    style={{
                      gridColumn,
                      gridRow,
                      width: cellPx,
                      height: cellPx,
                    }}
                  >
                    {thumbSrc && (
                      // biome-ignore lint/a11y/useAltText: thumbnail in a clickable grid
                      <img
                        src={thumbSrc}
                        className={`block h-full w-full object-cover ${isPending ? 'opacity-40' : ''}`}
                      />
                    )}
                    {!saved && (
                      <span
                        className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-neutral-400"
                        style={{ fontSize: Math.max(8, Math.floor(cellPx / 8)) }}
                      >
                        {t.col},{t.row}
                      </span>
                    )}
                    {isPending && (
                      <span
                        className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 font-mono text-neutral-900"
                        style={{ fontSize: Math.max(8, Math.floor(cellPx / 6)) }}
                      >
                        …
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
