'use client';

import { tileWidthMeters } from '@mapart/geo';
import {
  type TileCoord,
  bboxToTiles,
  circleToPolygon,
  polygonToTiles,
  tileToBounds,
} from '@mapart/geo';
import { useMemo, useState } from 'react';

type Mode = 'bbox' | 'circle';

export function TilesPanel() {
  const [mode, setMode] = useState<Mode>('bbox');
  const [zoom, setZoom] = useState(18);

  // bbox mode (default: central João Pessoa)
  const [west, setWest] = useState(-34.88);
  const [south, setSouth] = useState(-7.13);
  const [east, setEast] = useState(-34.84);
  const [north, setNorth] = useState(-7.1);

  // circle mode
  const [centerLat, setCenterLat] = useState(-7.115);
  const [centerLng, setCenterLng] = useState(-34.861);
  const [radiusMeters, setRadiusMeters] = useState(1500);

  const result = useMemo(() => {
    if (mode === 'bbox') {
      const tiles = bboxToTiles({ west, south, east, north }, zoom);
      const lat = (south + north) / 2;
      return { tiles, width: tileWidthMeters(zoom, lat), lat };
    }
    const poly = circleToPolygon({ lat: centerLat, lng: centerLng }, radiusMeters);
    const tiles = polygonToTiles(poly, zoom);
    return { tiles, width: tileWidthMeters(zoom, centerLat), lat: centerLat };
  }, [mode, zoom, west, south, east, north, centerLat, centerLng, radiusMeters]);

  return (
    <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-4">
      <section className={CARD}>
        <div className={`${SECTION_LABEL} mb-4`}>Area</div>
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <div className="inline-flex w-full rounded-lg border border-stone-200 bg-stone-50 p-0.5">
            {(['bbox', 'circle'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition ${
                  mode === m
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <Field
            label="zoom"
            value={zoom}
            onChange={(n) => setZoom(Math.max(1, Math.min(22, Math.round(n))))}
            step={1}
          />

          {mode === 'bbox' ? (
            <>
              <Field label="west (lng)" value={west} onChange={setWest} step={0.0001} />
              <Field label="south (lat)" value={south} onChange={setSouth} step={0.0001} />
              <Field label="east (lng)" value={east} onChange={setEast} step={0.0001} />
              <Field label="north (lat)" value={north} onChange={setNorth} step={0.0001} />
            </>
          ) : (
            <>
              <Field label="center lat" value={centerLat} onChange={setCenterLat} step={0.0001} />
              <Field label="center lng" value={centerLng} onChange={setCenterLng} step={0.0001} />
              <Field label="radius (m)" value={radiusMeters} onChange={setRadiusMeters} step={50} />
            </>
          )}

          <div className="mt-1 rounded-xl border border-stone-200 bg-stone-50 p-4">
            <div className="text-[28px] font-light leading-none tracking-tight text-stone-900">
              {result.tiles.length.toLocaleString()}
            </div>
            <div className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
              tiles at z={zoom}
            </div>
            <div className="mt-2 font-mono text-[11px] text-stone-500">
              ~{result.width.toFixed(1)} m / tile · lat {result.lat.toFixed(3)}
            </div>
          </div>
        </form>
      </section>

      <TileOverlay
        tiles={result.tiles}
        zoom={zoom}
        highlight={
          mode === 'bbox'
            ? { type: 'bbox', west, south, east, north }
            : {
                type: 'circle',
                center: { lat: centerLat, lng: centerLng },
                radiusMeters,
              }
        }
      />
    </div>
  );
}

const CARD = 'rounded-2xl border border-stone-200/70 bg-white p-6';
const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500';

type Highlight =
  | { type: 'bbox'; west: number; south: number; east: number; north: number }
  | { type: 'circle'; center: { lat: number; lng: number }; radiusMeters: number };

const MAX_PREVIEW_TILES = 5000;

function TileOverlay({
  tiles,
  zoom,
  highlight,
}: {
  tiles: TileCoord[];
  zoom: number;
  highlight: Highlight;
}) {
  if (tiles.length === 0) {
    return (
      <section className={`${CARD} flex min-h-[400px] items-center justify-center`}>
        <div className="text-[13px] text-stone-400">No tiles — adjust the params.</div>
      </section>
    );
  }

  if (tiles.length > MAX_PREVIEW_TILES) {
    return (
      <section className={`${CARD} flex min-h-[400px] items-center justify-center`}>
        <div className="max-w-[420px] rounded-xl border border-amber-200 bg-amber-50 p-5 text-[13px] leading-relaxed text-amber-800">
          <strong>{tiles.length.toLocaleString()}</strong> tiles — too many to preview (cap{' '}
          {MAX_PREVIEW_TILES.toLocaleString()}). The math is fine; it's just the SVG renderer that
          would freeze. Reduce zoom or shrink the area.
        </div>
      </section>
    );
  }

  // Compute a viewBox in lat/lng covering the tile bbox with small padding.
  const allBounds = tiles.map((t) => tileToBounds(t.x, t.y, zoom));
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const b of allBounds) {
    if (b.west < minLng) minLng = b.west;
    if (b.east > maxLng) maxLng = b.east;
    if (b.south < minLat) minLat = b.south;
    if (b.north > maxLat) maxLat = b.north;
  }

  const svgW = 600;
  const svgH = 500;
  const padLng = (maxLng - minLng) * 0.05;
  const padLat = (maxLat - minLat) * 0.05;
  const vbMinLng = minLng - padLng;
  const vbMaxLng = maxLng + padLng;
  const vbMinLat = minLat - padLat;
  const vbMaxLat = maxLat + padLat;

  const toSvg = (lng: number, lat: number): [number, number] => {
    const x = ((lng - vbMinLng) / (vbMaxLng - vbMinLng)) * svgW;
    const y = ((vbMaxLat - lat) / (vbMaxLat - vbMinLat)) * svgH;
    return [fx(x), fx(y)];
  };

  return (
    <section className={CARD}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className={SECTION_LABEL}>Tile coverage</div>
        <div className="flex items-center gap-4 text-[12px] text-stone-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-blue-500/30 ring-1 ring-blue-500" />
            tiles
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] ring-2 ring-red-500" />
            selection
          </span>
        </div>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="rounded-xl border border-stone-200 bg-stone-50"
      >
        <title>Tile coverage preview</title>
        {tiles.map((t) => {
          const b = tileToBounds(t.x, t.y, zoom);
          const [x, y] = toSvg(b.west, b.north);
          const [x2, y2] = toSvg(b.east, b.south);
          const w = fx(x2 - x);
          const h = fx(y2 - y);
          return (
            <g key={`${t.x},${t.y}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="#3b82f6"
                fillOpacity={0.12}
                stroke="#3b82f6"
                strokeWidth={0.5}
              />
              {w > 30 && tiles.length < 400 && (
                <text
                  x={fx(x + w / 2)}
                  y={fx(y + h / 2)}
                  fontSize={Math.min(10, w / 8)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#1e3a8a"
                  opacity={0.8}
                >
                  {t.x},{t.y}
                </text>
              )}
            </g>
          );
        })}
        {renderHighlight(highlight, toSvg)}
      </svg>
    </section>
  );
}

function renderHighlight(
  highlight: Highlight,
  toSvg: (lng: number, lat: number) => [number, number],
): React.ReactNode {
  if (highlight.type === 'bbox') {
    const [x1, y1] = toSvg(highlight.west, highlight.north);
    const [x2, y2] = toSvg(highlight.east, highlight.south);
    return (
      <rect
        x={fx(Math.min(x1, x2))}
        y={fx(Math.min(y1, y2))}
        width={fx(Math.abs(x2 - x1))}
        height={fx(Math.abs(y2 - y1))}
        fill="none"
        stroke="#dc2626"
        strokeWidth={2}
      />
    );
  }
  const poly = circleToPolygon(highlight.center, highlight.radiusMeters, 64);
  const pts = poly.map((p) => toSvg(p.lng, p.lat).join(',')).join(' ');
  return <polygon points={pts} fill="none" stroke="#dc2626" strokeWidth={2} />;
}

/** Round SVG coords to 3 decimals so SSR and client hydration agree on attribute stringification. */
function fx(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] text-stone-900 outline-none transition focus:border-stone-400"
      />
    </label>
  );
}
