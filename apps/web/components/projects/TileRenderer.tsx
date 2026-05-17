'use client';

import { Scene, type SceneHandle } from '@mapart/renderer/debug/Scene';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const project = {
    centerLat,
    centerLng,
    cameraPitch,
    cameraYaw,
    tileWorldMeters,
    tilePixelSize,
  };

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
    // project params are read fresh inside renderOne; depending on the primitives is enough.
    [
      projectId,
      saveTileAction,
      centerLat,
      centerLng,
      cameraPitch,
      cameraYaw,
      tileWorldMeters,
      tilePixelSize,
    ],
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
        const t = tiles[i]!;
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
        const t = missing[i]!;
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
    minCol = Infinity;
    maxCol = -Infinity;
    minRow = Infinity;
    maxRow = -Infinity;
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

  const missingCount = tiles.reduce(
    (n, t) => (savedMap.has(keyOf(t.col, t.row)) ? n : n + 1),
    0,
  );

  return (
    <section style={cardStyle}>
      <h3 style={h3}>tile export</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Click any tile in the grid to render & save it. Files are saved as{' '}
            <code>{'{col}_{row}.png'}</code> under{' '}
            <code>pipeline/{projectId}/rendered/</code>. Uses the <b>saved</b> project params; if
            you changed sliders above, save first.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={runMissing}
              disabled={busy || missingCount === 0}
              style={primaryBtn}
            >
              {bulkRunning
                ? `rendering ${bulkProgress.done}/${bulkProgress.total}`
                : `render missing (${missingCount})`}
            </button>
            <button type="button" onClick={runAll} disabled={busy} style={secondaryBtn}>
              re-render all
            </button>
            <button type="button" onClick={refresh} disabled={busy} style={secondaryBtn}>
              reload
            </button>
          </div>
          {error && (
            <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 4 }}>
              {error}
            </pre>
          )}
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
            capture scene (full-res {tilePixelSize}×{tilePixelSize} off-screen, shown scaled):
          </div>
          <div
            style={{
              width: 180,
              height: 180,
              overflow: 'hidden',
              border: '1px solid #ccc',
              borderRadius: 4,
              position: 'relative',
            }}
          >
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
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
            grid · {tiles.length} tiles · {savedMap.size} saved · click a cell to render
          </div>
          {tiles.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.6 }}>no tiles seeded yet</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
                gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
                gap: 2,
                background: '#e5e7eb',
                padding: 2,
                borderRadius: 4,
                width: 'fit-content',
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
                const thumbSrc = saved ? `${saved.url}${saved.url.includes('?') ? '&' : '?'}v=${v}` : null;
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
                    style={{
                      gridColumn,
                      gridRow,
                      width: cellPx,
                      height: cellPx,
                      padding: 0,
                      border: 'none',
                      background: saved ? '#fff' : '#f3f4f6',
                      cursor: busy || isPending ? 'wait' : 'pointer',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {thumbSrc && (
                      // biome-ignore lint/a11y/useAltText: thumbnail in a clickable grid
                      <img
                        src={thumbSrc}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                          opacity: isPending ? 0.4 : 1,
                        }}
                      />
                    )}
                    {!saved && (
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: Math.max(8, Math.floor(cellPx / 8)),
                          fontFamily: 'monospace',
                          color: '#9ca3af',
                          pointerEvents: 'none',
                        }}
                      >
                        {t.col},{t.row}
                      </span>
                    )}
                    {isPending && (
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: Math.max(8, Math.floor(cellPx / 6)),
                          fontFamily: 'monospace',
                          color: '#111',
                          background: 'rgba(255,255,255,0.6)',
                          pointerEvents: 'none',
                        }}
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

const cardStyle = {
  padding: 16,
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  marginTop: 16,
};
const h3 = {
  margin: 0,
  marginBottom: 12,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.55,
};
const primaryBtn = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #111',
  background: '#111',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #ccc',
  background: '#fff',
  color: '#111',
  borderRadius: 6,
  cursor: 'pointer',
};
