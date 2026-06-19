'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TileLite } from './step_build';

/** Stylized tiles are the canonical 1024² edge; renders are 512². */
const STYLIZED_PX = 1024;
const RENDERED_PX = 512;

/** A locally-imported, not-yet-saved stylized tile (one grid cell). */
interface Override {
  /** Object URL of the sliced PNG, for on-grid preview. */
  url: string;
  /** The sliced PNG bytes, sent to the server on save and drawn on export. */
  blob: Blob;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const cellKey = (x: number, y: number): string => `${x}:${y}`;

function norm(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Trigger a browser download of a blob under `name`. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Step 4 — Review / post-process. Lays the project's tiles out flat (top-down)
 * so a contiguous rectangle can be drag-selected, then:
 *  - exported as one stitched image (stylized or the raw render), to edit
 *    externally, and
 *  - re-imported: a same-size image is sliced back onto the selected tiles,
 *    previewed in place, and persisted on Save.
 *
 * Imported-but-unsaved tiles stay in memory as overrides — they preview on the
 * grid and feed back into a stylized export, so a region can be exported again
 * (carrying the edit) before it's ever saved.
 */
export function StepReview({
  projectId,
  projectName,
  cols,
  rows,
  initialTiles,
}: {
  projectId: string;
  projectName: string;
  cols: number;
  rows: number;
  initialTiles: TileLite[];
}) {
  const [tiles, setTiles] = useState<TileLite[]>(initialTiles);
  const [blend, setBlend] = useState(1); // 0 = render, 1 = stylized
  const [showLines, setShowLines] = useState(true);
  const [sel, setSel] = useState<Rect | null>(null);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);

  const dragAnchor = useRef<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Cell size = the viewport-fit base × a user zoom factor (1 = fit-to-view).
  const [fitPx, setFitPx] = useState(48);
  const [zoom, setZoom] = useState(1);
  const cellPx = Math.max(4, Math.round(fitPx * zoom));

  const byCoord = useMemo(() => {
    const m = new Map<string, TileLite>();
    for (const t of tiles) m.set(cellKey(t.x, t.y), t);
    return m;
  }, [tiles]);

  const extent = useMemo(() => {
    if (tiles.length === 0) return { minX: 0, minY: 0, cols, rows };
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const t of tiles) {
      if (t.x < minX) minX = t.x;
      if (t.x > maxX) maxX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.y > maxY) maxY = t.y;
    }
    return { minX, minY, cols: maxX - minX + 1, rows: maxY - minY + 1 };
  }, [tiles, cols, rows]);

  // Fit the grid to the viewport (square cells), leaving room for the gridlines.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const fit = (): void => {
      const pad = 24;
      const w = el.clientWidth - pad;
      const h = el.clientHeight - pad;
      const px = Math.floor(Math.min(w / extent.cols, h / extent.rows));
      setFitPx(Math.max(6, Math.min(160, px)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [extent.cols, extent.rows]);

  // Wheel over the grid zooms (non-passive so we can stop the page from scrolling).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom((z) => Math.max(0.2, Math.min(16, z * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Object URLs are leaked unless revoked; drop the latest set on unmount.
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  useEffect(() => {
    return () => {
      for (const ov of overridesRef.current.values()) URL.revokeObjectURL(ov.url);
    };
  }, []);

  // Shift-drag pans the scroll viewport instead of selecting. The pan origin
  // (cursor + scroll offset at mousedown) lives in a ref; the move handler
  // tracks it so a drag never gets swallowed by a re-render.
  const panRef = useRef<{ cx: number; cy: number; left: number; top: number } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const p = panRef.current;
      const el = viewportRef.current;
      if (!p || !el) return;
      el.scrollLeft = p.left - (e.clientX - p.cx);
      el.scrollTop = p.top - (e.clientY - p.cy);
    };
    const onUp = (): void => {
      dragAnchor.current = null;
      panRef.current = null;
      setPanning(false);
    };
    const onKey = (e: KeyboardEvent): void => setShiftHeld(e.shiftKey);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  function startPan(e: React.MouseEvent): void {
    const el = viewportRef.current;
    if (!el) return;
    e.preventDefault();
    panRef.current = { cx: e.clientX, cy: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
  }

  // Is every cell in the selection an actual tile, and is anything selected?
  const selStats = useMemo(() => {
    if (!sel) return null;
    const w = sel.x1 - sel.x0 + 1;
    const h = sel.y1 - sel.y0 + 1;
    let complete = true;
    for (let y = sel.y0; y <= sel.y1; y++)
      for (let x = sel.x0; x <= sel.x1; x++) if (!byCoord.has(cellKey(x, y))) complete = false;
    return { w, h, complete };
  }, [sel, byCoord]);

  const canAct = !!sel && !!selStats?.complete && !busy;

  function startDrag(x: number, y: number): void {
    if (!byCoord.has(cellKey(x, y))) return;
    dragAnchor.current = { x, y };
    setSel({ x0: x, y0: y, x1: x, y1: y });
    setError(null);
  }
  function extendDrag(x: number, y: number): void {
    if (!dragAnchor.current) return;
    setSel(norm(dragAnchor.current, { x, y }));
  }

  /**
   * Iterate selected cells with their 0-based offset within the stitched image.
   * The grid's +y points north (up on screen, like step 3), so the top image row
   * is the max-y tile — `row` counts down from `y1` to keep export/import upright.
   */
  function* selectedCells(r: Rect): Generator<{ x: number; y: number; col: number; row: number }> {
    for (let y = r.y1; y >= r.y0; y--)
      for (let x = r.x0; x <= r.x1; x++) yield { x, y, col: x - r.x0, row: r.y1 - y };
  }

  // Same-origin (unversioned) fetch keeps the canvas untainted, so toBlob works.
  async function loadTileImage(path: string): Promise<ImageBitmap> {
    const res = await fetch(`/api/storage/${path}`, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`fetch ${path} → ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  async function doExport(source: 'stylized' | 'rendered'): Promise<void> {
    if (!sel || !selStats) return;
    setBusy(source === 'stylized' ? 'Exporting stylized…' : 'Exporting render…');
    setError(null);
    try {
      const px = source === 'stylized' ? STYLIZED_PX : RENDERED_PX;
      const canvas = document.createElement('canvas');
      canvas.width = selStats.w * px;
      canvas.height = selStats.h * px;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingEnabled = false;

      for (const { x, y, col, row } of selectedCells(sel)) {
        const ov = source === 'stylized' ? overrides.get(cellKey(x, y)) : undefined;
        let img: ImageBitmap | null = null;
        if (ov) {
          img = await createImageBitmap(ov.blob);
        } else {
          const t = byCoord.get(cellKey(x, y));
          const path = source === 'stylized' ? t?.stylizedImgPath : t?.renderedImgPath;
          if (path) img = await loadTileImage(path);
        }
        if (img) ctx.drawImage(img, col * px, row * px, px, px);
      }

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('failed to encode image');
      const tag = `${sel.x0}_${sel.y0}__${sel.x1}_${sel.y1}`;
      download(blob, `${projectName || 'project'}_${source}_${tag}.png`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onImportFile(file: File): Promise<void> {
    if (!sel || !selStats) return;
    setBusy('Slicing import…');
    setError(null);
    try {
      const expW = selStats.w * STYLIZED_PX;
      const expH = selStats.h * STYLIZED_PX;
      const whole = await createImageBitmap(file);
      if (whole.width !== expW || whole.height !== expH) {
        setError(
          `Image must be ${expW}×${expH}px for this ${selStats.w}×${selStats.h} selection — got ${whole.width}×${whole.height}px.`,
        );
        return;
      }

      const next = new Map(overrides);
      for (const { x, y, col, row } of selectedCells(sel)) {
        const sub = await createImageBitmap(
          whole,
          col * STYLIZED_PX,
          row * STYLIZED_PX,
          STYLIZED_PX,
          STYLIZED_PX,
        );
        const c = document.createElement('canvas');
        c.width = STYLIZED_PX;
        c.height = STYLIZED_PX;
        const cx = c.getContext('2d');
        if (!cx) throw new Error('no 2d context');
        cx.drawImage(sub, 0, 0);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        if (!blob) throw new Error('failed to slice tile');
        const k = cellKey(x, y);
        const prev = next.get(k);
        if (prev) URL.revokeObjectURL(prev.url);
        next.set(k, { url: URL.createObjectURL(blob), blob });
      }
      setOverrides(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function refetchTiles(): Promise<void> {
    const res = await fetch(`/api/projects/${projectId}/tiles`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { tiles: TileLite[] };
      setTiles(data.tiles);
    }
  }

  async function save(): Promise<void> {
    if (overrides.size === 0) return;
    setError(null);
    const entries = [...overrides];
    const saved: string[] = [];
    try {
      for (const [k, ov] of entries) {
        setBusy(`Saving ${saved.length + 1}/${entries.length} tiles…`);
        const [x, y] = k.split(':');
        const res = await fetch(`/api/projects/${projectId}/postprocess?x=${x}&y=${y}`, {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: ov.blob,
        });
        const r = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !r.ok) throw new Error(r.error ?? `save failed (${res.status})`);
        URL.revokeObjectURL(ov.url);
        saved.push(k);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Drop the tiles that persisted; any that failed stay for a retry.
      if (saved.length > 0) {
        setOverrides((prev) => {
          const next = new Map(prev);
          for (const k of saved) next.delete(k);
          return next;
        });
        await refetchTiles();
      }
      setBusy(null);
    }
  }

  function discard(): void {
    for (const ov of overrides.values()) URL.revokeObjectURL(ov.url);
    setOverrides(new Map());
    setError(null);
  }

  const stylizedCount = tiles.filter((t) => t.stylizedImgPath).length;
  const gap = showLines ? 1 : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-stone-200 border-b px-5 py-4">
        <div>
          <div className="font-semibold text-[15px] text-stone-900">{projectName}</div>
          <div className="text-[12px] text-stone-500">
            {sel && selStats ? (
              selStats.complete ? (
                <span>
                  {selStats.w}×{selStats.h} selected · stylized {selStats.w * STYLIZED_PX}×
                  {selStats.h * STYLIZED_PX}px
                </span>
              ) : (
                <span className="text-amber-600">
                  Selection must be a full rectangle of tiles — it has gaps.
                </span>
              )
            ) : (
              <span>
                {stylizedCount} stylized tiles · drag to select · shift-drag to pan · scroll to zoom
              </span>
            )}
            {overrides.size > 0 && (
              <span className="ml-1.5 text-emerald-600">· {overrides.size} imported (unsaved)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white px-3"
            title={`Stylized ${Math.round(blend * 100)}%`}
          >
            <span className="text-[11px] text-stone-500">Render</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(blend * 100)}
              onChange={(e) => setBlend(Number(e.target.value) / 100)}
              className="w-20 accent-stone-900"
            />
            <span className="text-[11px] text-stone-500">Stylized</span>
          </div>
          <Toggle on={showLines} onClick={() => setShowLines((v) => !v)}>
            Grid
          </Toggle>
          <div className="flex h-8 items-center rounded-full border border-stone-200 bg-white">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
              className="px-2.5 text-[14px] text-stone-600 hover:text-stone-900"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="w-12 text-[11px] text-stone-500 tabular-nums hover:text-stone-900"
              title="Reset to fit"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(16, z * 1.2))}
              className="px-2.5 text-[14px] text-stone-600 hover:text-stone-900"
              title="Zoom in"
            >
              +
            </button>
          </div>

          <span className="mx-1 h-5 w-px bg-stone-200" />

          {overrides.size > 0 ? (
            <>
              <button
                type="button"
                onClick={discard}
                disabled={!!busy}
                className="h-8 rounded-full border border-stone-200 bg-white px-3 text-[12px] text-stone-700 transition hover:border-stone-400 disabled:opacity-40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!!busy}
                className="h-8 rounded-full bg-emerald-600 px-3 text-[12px] text-white transition hover:bg-emerald-500 disabled:opacity-40"
              >
                Save {overrides.size}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => doExport('rendered')}
                disabled={!canAct}
                className="h-8 rounded-full border border-stone-200 bg-white px-3 text-[12px] text-stone-700 transition hover:border-stone-400 disabled:opacity-40"
              >
                Export original
              </button>
              <button
                type="button"
                onClick={() => doExport('stylized')}
                disabled={!canAct}
                className="h-8 rounded-full border border-stone-200 bg-white px-3 text-[12px] text-stone-700 transition hover:border-stone-400 disabled:opacity-40"
              >
                Export stylized
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={!canAct}
                className="h-8 rounded-full bg-stone-900 px-3 text-[12px] text-white transition hover:bg-stone-700 disabled:opacity-40"
              >
                Import stylized
              </button>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </div>

      {(busy || error) && (
        <div
          className={`px-5 py-2 text-[12px] ${error ? 'bg-red-50 text-red-700' : 'bg-stone-50 text-stone-500'}`}
        >
          {error ?? busy}
        </div>
      )}

      <div
        ref={viewportRef}
        className={`relative flex min-h-0 flex-1 overflow-auto bg-stone-900 p-3 ${
          panning ? 'cursor-grabbing' : shiftHeld ? 'cursor-grab' : ''
        }`}
        onMouseDown={(e) => {
          if (e.shiftKey) startPan(e);
        }}
      >
        <div
          className="m-auto grid select-none bg-stone-700"
          style={{
            gridTemplateColumns: `repeat(${extent.cols}, ${cellPx}px)`,
            gridTemplateRows: `repeat(${extent.rows}, ${cellPx}px)`,
            gap: `${gap}px`,
          }}
        >
          {Array.from({ length: extent.rows * extent.cols }, (_, i) => {
            const col = i % extent.cols;
            const row = Math.floor(i / extent.cols);
            const x = col + extent.minX;
            // +y points north (up), so the top grid row is the max-y tile.
            const y = extent.minY + extent.rows - 1 - row;
            const t = byCoord.get(cellKey(x, y));
            const ov = overrides.get(cellKey(x, y));
            const selected = sel ? inRect(sel, x, y) : false;
            const rendered = t?.renderedImgPath
              ? `/api/storage/${t.renderedImgPath}?v=${t.v}`
              : null;
            const stylized = ov
              ? ov.url
              : t?.stylizedImgPath
                ? `/api/storage/${t.stylizedImgPath}?v=${t.v}`
                : null;
            return (
              <div
                key={`${x}:${y}`}
                className={`relative bg-stone-800 ${shiftHeld ? '' : t ? 'cursor-crosshair' : ''}`}
                style={{ width: cellPx, height: cellPx }}
                onMouseDown={(e) => {
                  if (!e.shiftKey) startDrag(x, y);
                }}
                onMouseEnter={() => extendDrag(x, y)}
              >
                {rendered && (
                  <img
                    src={rendered}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
                  />
                )}
                {stylized && (
                  <img
                    src={stylized}
                    alt=""
                    draggable={false}
                    style={{ opacity: blend }}
                    className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
                  />
                )}
                {ov && (
                  <span className="absolute top-0.5 right-0.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-emerald-900/40" />
                )}
                {selected && (
                  <span className="pointer-events-none absolute inset-0 z-10 bg-sky-400/25 ring-1 ring-sky-300 ring-inset" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[12px] transition ${
        on
          ? 'border-stone-900 bg-stone-900 text-white'
          : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
      }`}
    >
      {children}
    </button>
  );
}
