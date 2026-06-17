'use client';

import { gridOffsetToLatLng, latLngToGridOffset } from '@mapart/export/geo';
import type { VizGeoAnchor, VizPin } from '@mapart/export/types';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { savePins } from './actions';
import type { TileLite } from './step_build';

const cellKey = (x: number, y: number): string => `${x}:${y}`;
const formatCoord = (n: number): string => String(Number(n.toFixed(6)));

interface DraftPin {
  uid: string;
  lat: number;
  lng: number;
  label: string;
  kind: string;
}

let uidCounter = 0;
const newUid = (): string => `p${uidCounter++}`;

const toDraft = (pin: VizPin): DraftPin => ({
  uid: newUid(),
  lat: pin.lat,
  lng: pin.lng,
  label: pin.label,
  kind: pin.kind ?? '',
});

/** Below this pointer travel a press counts as a click (drop a pin), not a pan. */
const CLICK_SLOP_PX = 4;

/**
 * Step 5 — Pins. Lays the project's stylized tiles out flat (same as Review) and
 * overlays draggable lat/lng markers placed directly on the art: click the map
 * to drop a pin, drag a marker to move it, drag empty space to pan. Positions
 * map through the grid↔WGS84 fit, so what you see is what the visualizer renders.
 */
export function StepPins({
  projectId,
  projectName,
  cols,
  rows,
  geo,
  initialTiles,
  initialPins,
}: {
  projectId: string;
  projectName: string;
  cols: number;
  rows: number;
  geo: VizGeoAnchor;
  initialTiles: TileLite[];
  initialPins: VizPin[];
}) {
  const [tiles] = useState<TileLite[]>(initialTiles);
  const [pins, setPins] = useState<DraftPin[]>(() => initialPins.map(toDraft));
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [blend, setBlend] = useState(1); // 0 = render, 1 = stylized
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const viewportRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
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

  // Fit the grid to the viewport (square cells).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const fit = (): void => {
      const pad = 24;
      const px = Math.floor(
        Math.min((el.clientWidth - pad) / extent.cols, (el.clientHeight - pad) / extent.rows),
      );
      setFitPx(Math.max(6, Math.min(160, px)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [extent.cols, extent.rows]);

  // Wheel zoom (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(16, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pixel position of a grid offset within the rendered grid (cell units → px).
  // Grid Y runs north, image rows run top→down, so the row axis is flipped.
  const offsetToPx = (dx: number, dy: number): { px: number; py: number } => ({
    px: (dx + 0.5) * cellPx,
    py: (extent.rows - 1 - dy + 0.5) * cellPx,
  });

  // A pin's pixel position, or null if it falls outside a degenerate anchor.
  const pinToPx = (pin: { lat: number; lng: number }): { px: number; py: number } | null => {
    const off = latLngToGridOffset(geo, pin.lat, pin.lng);
    if (!off) return null;
    return offsetToPx(off.dx, off.dy);
  };

  // A pointer position (client coords) → lat/lng, inverting offsetToPx.
  function clientToLatLng(clientX: number, clientY: number): { lat: number; lng: number } | null {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const dx = (clientX - rect.left) / cellPx - 0.5;
    const dy = extent.rows - 1 - ((clientY - rect.top) / cellPx - 0.5);
    return gridOffsetToLatLng(geo, dx, dy);
  }

  function mutate(next: DraftPin[]): void {
    setPins(next);
    setDirty(true);
    setStatus(null);
  }
  const updatePin = (uid: string, patch: Partial<DraftPin>): void =>
    mutate(pins.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  function addPin(lat: number, lng: number): void {
    const uid = newUid();
    mutate([...pins, { uid, lat, lng, label: `Pin ${pins.length + 1}`, kind: '' }]);
    setSelected(uid);
  }
  function removePin(uid: string): void {
    mutate(pins.filter((p) => p.uid !== uid));
    if (selected === uid) setSelected(null);
  }

  // Pointer interaction. A press on a marker drags it; a press on empty art
  // either pans (if dragged past the slop) or drops a pin (if it stays put).
  const drag = useRef<
    | { mode: 'pin'; uid: string }
    | { mode: 'bg'; cx: number; cy: number; left: number; top: number; moved: boolean }
    | null
  >(null);

  // Window-level pointer handling reads the freshest closures via a ref, so the
  // listeners bind once yet always see current pins / cell size / extent.
  const live = useRef({ clientToLatLng, addPin, updatePin });
  live.current = { clientToLatLng, addPin, updatePin };

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = drag.current;
      const vp = viewportRef.current;
      if (!d) return;
      if (d.mode === 'pin') {
        const ll = live.current.clientToLatLng(e.clientX, e.clientY);
        if (ll) live.current.updatePin(d.uid, ll);
      } else if (vp) {
        const dxMoved = e.clientX - d.cx;
        const dyMoved = e.clientY - d.cy;
        if (Math.abs(dxMoved) > CLICK_SLOP_PX || Math.abs(dyMoved) > CLICK_SLOP_PX) d.moved = true;
        vp.scrollLeft = d.left - dxMoved;
        vp.scrollTop = d.top - dyMoved;
      }
    };
    const onUp = (e: PointerEvent): void => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode === 'bg' && !d.moved) {
        const ll = live.current.clientToLatLng(e.clientX, e.clientY);
        if (ll) live.current.addPin(ll.lat, ll.lng);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  function onBackgroundPointerDown(e: React.PointerEvent): void {
    const vp = viewportRef.current;
    if (!vp) return;
    drag.current = {
      mode: 'bg',
      cx: e.clientX,
      cy: e.clientY,
      left: vp.scrollLeft,
      top: vp.scrollTop,
      moved: false,
    };
  }

  function save(): void {
    const payload: VizPin[] = pins.map((p) => {
      const label = p.label.trim();
      const kind = p.kind.trim();
      return kind ? { lat: p.lat, lng: p.lng, label, kind } : { lat: p.lat, lng: p.lng, label };
    });
    startTransition(async () => {
      const res = await savePins(projectId, payload);
      if (res.ok) {
        setDirty(false);
        setStatus({ kind: 'ok', msg: `Saved ${res.count} pin${res.count === 1 ? '' : 's'}.` });
      } else {
        setStatus({ kind: 'error', msg: res.error });
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-stone-200 border-b px-5 py-4">
        <div>
          <div className="font-semibold text-[15px] text-stone-900">{projectName}</div>
          <div className="text-[12px] text-stone-500">
            {pins.length} pin{pins.length === 1 ? '' : 's'} · click the map to add · drag a pin to
            move · drag empty space to pan
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white px-3">
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
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="relative flex min-h-0 flex-1 overflow-auto bg-stone-900 p-3"
        >
          <div
            ref={gridRef}
            className="relative m-auto grid cursor-crosshair select-none bg-stone-700"
            style={{
              gridTemplateColumns: `repeat(${extent.cols}, ${cellPx}px)`,
              gridTemplateRows: `repeat(${extent.rows}, ${cellPx}px)`,
            }}
            onPointerDown={onBackgroundPointerDown}
          >
            {Array.from({ length: extent.rows * extent.cols }, (_, i) => {
              const col = i % extent.cols;
              const row = Math.floor(i / extent.cols);
              const x = col + extent.minX;
              // +y points north (up), so the top grid row is the max-y tile.
              const y = extent.minY + extent.rows - 1 - row;
              const t = byCoord.get(cellKey(x, y));
              const rendered = t?.renderedImgPath
                ? `/api/storage/${t.renderedImgPath}?v=${t.v}`
                : null;
              const stylized = t?.stylizedImgPath
                ? `/api/storage/${t.stylizedImgPath}?v=${t.v}`
                : null;
              return (
                <div key={`${x}:${y}`} className="relative bg-stone-800">
                  {rendered && (
                    <img
                      src={rendered}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
                    />
                  )}
                  {stylized && (
                    <img
                      src={stylized}
                      alt=""
                      draggable={false}
                      style={{ opacity: blend }}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
                    />
                  )}
                </div>
              );
            })}

            {pins.map((pin) => {
              const at = pinToPx(pin);
              if (!at) return null;
              const isSel = selected === pin.uid;
              return (
                <button
                  type="button"
                  key={pin.uid}
                  className="group absolute flex -translate-x-1/2 -translate-y-full cursor-grab flex-col items-center active:cursor-grabbing"
                  style={{ left: at.px, top: at.py }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected(pin.uid);
                    drag.current = { mode: 'pin', uid: pin.uid };
                  }}
                >
                  <span
                    className={`mb-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] shadow-sm transition ${
                      isSel
                        ? 'border-stone-700 bg-stone-900 text-white'
                        : 'border-stone-300 bg-white/90 text-stone-700 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {pin.label || 'untitled'}
                  </span>
                  <span
                    className={`h-3 w-3 rounded-full border-2 shadow ${
                      isSel ? 'border-white bg-amber-400' : 'border-stone-900 bg-amber-300'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-[320px] shrink-0 flex-col border-stone-200 border-l">
          <div className="flex items-center justify-between border-stone-100 border-b px-4 py-3">
            <span className="text-[13px] text-stone-700">
              {pins.length} pin{pins.length === 1 ? '' : 's'}
            </span>
            <span className="text-[12px] text-stone-400">
              {dirty ? 'unsaved changes' : 'all saved'}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col divide-y divide-stone-100 overflow-y-auto">
            {pins.length === 0 ? (
              <p className="m-0 px-4 py-10 text-center text-[13px] text-stone-400">
                No pins yet. Click the map to drop one.
              </p>
            ) : (
              pins.map((p, i) => (
                <PinRow
                  key={p.uid}
                  index={i}
                  pin={p}
                  selected={selected === p.uid}
                  onSelect={() => setSelected(p.uid)}
                  onChange={(patch) => updatePin(p.uid, patch)}
                  onRemove={() => removePin(p.uid)}
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-stone-100 border-t px-4 py-3">
            {status ? (
              <span
                className={`text-[12px] ${status.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {status.msg}
              </span>
            ) : (
              <span className="text-[12px] text-stone-400">pins overlay the visualizer map</span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="h-9 rounded-full bg-stone-900 px-5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              {pending ? 'saving…' : 'save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PinRow({
  index,
  pin,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  index: number;
  pin: DraftPin;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DraftPin>) => void;
  onRemove: () => void;
}) {
  const input =
    'h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[12px] text-stone-900 outline-none transition focus:border-stone-400';
  return (
    // Selection follows focus (bubbles from the inputs) — keyboard- and
    // pointer-driven without the row itself being a tab stop.
    <div
      onFocus={onSelect}
      className={`flex flex-col gap-2 px-4 py-3 transition ${selected ? 'bg-stone-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white">
          {index + 1}
        </span>
        <input
          value={pin.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="label"
          className={input}
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-[11px] text-stone-400 underline-offset-4 transition hover:text-red-600 hover:underline"
        >
          remove
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <CoordField label="lat" value={pin.lat} onChange={(v) => onChange({ lat: v })} />
        <CoordField label="lng" value={pin.lng} onChange={(v) => onChange({ lng: v })} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-stone-400">kind</span>
          <input
            value={pin.kind}
            onChange={(e) => onChange({ kind: e.target.value })}
            placeholder="optional"
            className={input}
          />
        </label>
      </div>
    </div>
  );
}

/** Coordinate input that holds its own text while focused so decimals aren't
 * clobbered, and re-syncs from the prop (e.g. after a marker drag) on blur. */
function CoordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(() => formatCoord(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatCoord(value));
  }, [value, focused]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-stone-400">{label}</span>
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
        }}
        className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[12px] text-stone-900 tabular-nums outline-none transition focus:border-stone-400"
      />
    </label>
  );
}
