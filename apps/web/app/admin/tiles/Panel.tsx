'use client';

import { tileWidthMeters } from '@mapart/shared';
import {
  type TileCoord,
  bboxToTiles,
  circleToPolygon,
  polygonToTiles,
  tileToBounds,
} from '@mapart/tiles';
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
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" checked={mode === 'bbox'} onChange={() => setMode('bbox')} />
            bbox
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" checked={mode === 'circle'} onChange={() => setMode('circle')} />
            circle
          </label>
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

        <div
          style={{
            fontSize: 13,
            marginTop: 12,
            padding: 10,
            background: '#f9fafb',
            borderRadius: 4,
          }}
        >
          <div>
            <strong>{result.tiles.length}</strong> tiles at z={zoom}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.7 }}>
            ~{result.width.toFixed(1)}m / tile at lat {result.lat.toFixed(3)}
          </div>
        </div>
      </form>

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
    return <div style={{ opacity: 0.5 }}>no tiles — adjust params</div>;
  }

  if (tiles.length > MAX_PREVIEW_TILES) {
    return (
      <div
        style={{
          padding: 20,
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: 4,
          fontSize: 13,
          maxWidth: 480,
        }}
      >
        <strong>{tiles.length.toLocaleString()}</strong> tiles — too many to preview (cap{' '}
        {MAX_PREVIEW_TILES.toLocaleString()}). The math is fine; it's just the SVG renderer that
        would freeze. Reduce zoom or shrink the area.
      </div>
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
    <div>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
        tile coverage · blue = tiles, red = selection
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ border: '1px solid #ccc', background: '#fff', borderRadius: 4 }}
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
    </div>
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
    <label
      style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 8 }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
    </label>
  );
}
