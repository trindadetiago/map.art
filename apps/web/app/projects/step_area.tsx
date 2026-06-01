'use client';

import type { LatLng } from '@mapart/geo';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createProjectWithGrid } from './actions';
import { AreaScene } from './area_scene';
import { originForCenter } from './grid_geometry';

export function StepArea({
  apiKey,
  center,
  cols,
  rows,
  readOnly,
  cityLabel,
  onCenterChange,
  onCols,
  onRows,
}: {
  apiKey: string;
  center: LatLng;
  cols: number;
  rows: number;
  readOnly: boolean;
  cityLabel: string;
  onCenterChange: (c: LatLng) => void;
  onCols: (n: number) => void;
  onRows: (n: number) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!name.trim()) {
      setError('name is required');
      return;
    }
    setPending(true);
    setError(null);
    const origin = originForCenter(center, cols, rows);
    const res = await createProjectWithGrid({
      name,
      lat: origin.lat,
      lng: origin.lng,
      cols,
      rows,
    });
    if (res.ok) {
      router.push(`/projects/${res.id}`);
    } else {
      setPending(false);
      setError(res.error);
    }
  }

  return (
    <div className="relative h-full w-full bg-stone-900">
      <AreaScene
        apiKey={apiKey}
        center={center}
        cols={cols}
        rows={rows}
        interactive={!readOnly}
        onCenterChange={onCenterChange}
      />

      {/* fixed crosshair marking the grid center */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-3 w-3 rounded-full border-2 border-white/90 shadow" />
      </div>

      <div className="absolute bottom-4 left-4 w-80 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        {readOnly ? (
          <div className="text-[13px] text-stone-600">
            <div className="font-medium text-stone-800">{cityLabel || 'area'}</div>
            <div className="mt-1 text-[12px] text-stone-500">
              {cols}×{rows} = <strong className="text-stone-700">{cols * rows}</strong> tiles
            </div>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
                name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my project"
                className="mt-1 h-9 w-full rounded-lg border border-stone-200 px-3 text-[13px] outline-none focus:border-stone-400"
              />
            </label>

            <div className="mt-3 flex gap-3">
              <Stepper label="cols" value={cols} onChange={onCols} />
              <Stepper label="rows" value={rows} onChange={onRows} />
            </div>

            <div className="mt-3 text-[12px] text-stone-500">
              {cols}×{rows} = <strong className="text-stone-800">{cols * rows}</strong> tiles · drag
              to reposition
            </div>

            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="mt-3 h-9 w-full rounded-full bg-stone-900 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              {pending ? 'creating…' : 'create project'}
            </button>
            {error && <p className="mt-2 mb-0 text-xs text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(200, n));
  return (
    <label className="block flex-1">
      <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      <div className="mt-1 flex h-9 items-center rounded-lg border border-stone-200">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          className="h-full w-8 text-stone-500 hover:text-stone-900"
        >
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(clamp(Number.parseInt(e.target.value, 10) || 1))}
          className="h-full w-full min-w-0 border-x border-stone-200 text-center text-[13px] outline-none tabular-nums"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          className="h-full w-8 text-stone-500 hover:text-stone-900"
        >
          +
        </button>
      </div>
    </label>
  );
}
