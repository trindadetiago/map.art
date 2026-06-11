'use client';

import type { LatLng } from '@mapart/geo';
import { tileCenterLatLng } from '@mapart/renderer/params';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createProjectWithGrid, expandProject } from './actions';
import { AreaScene, type OverlayTile } from './area_scene';
import { centerFromOrigin, originForCenter } from './grid_geometry';

type Margins = { top: number; right: number; bottom: number; left: number };
const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

export function StepArea({
  apiKey,
  center,
  cols,
  rows,
  readOnly,
  projectId,
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
  /** view mode only — enables expanding the existing grid from this step. */
  projectId?: string;
  cityLabel: string;
  onCenterChange: (c: LatLng) => void;
  onCols: (n: number) => void;
  onRows: (n: number) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [margins, setMargins] = useState<Margins>(NO_MARGINS);

  const expanding =
    readOnly && (margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0);
  const previewCols = cols + margins.left + margins.right;
  const previewRows = rows + margins.top + margins.bottom;
  const addedTiles = previewCols * previewRows - cols * rows;

  // Keep the existing grid fixed on the map while the preview frame grows
  // around it: shift the scene center by the (asymmetric) margins.
  const previewCenter = useMemo<LatLng>(() => {
    if (!expanding) return center;
    const origin = originForCenter(center, cols, rows);
    const previewOrigin = tileCenterLatLng(origin, -margins.left, -margins.top);
    return centerFromOrigin(previewOrigin, previewCols, previewRows);
  }, [expanding, center, cols, rows, margins, previewCols, previewRows]);

  // Grey-fill the cells the expansion would add, so new coverage is visible
  // against the live map before committing anything.
  const previewOverlay = useMemo<OverlayTile[] | undefined>(() => {
    if (!expanding) return undefined;
    const list: OverlayTile[] = [];
    for (let y = 0; y < previewRows; y++) {
      for (let x = 0; x < previewCols; x++) {
        const isExisting =
          x >= margins.left &&
          x < margins.left + cols &&
          y >= margins.top &&
          y < margins.top + rows;
        if (!isExisting) list.push({ x, y, state: 'pending', imageUrl: null });
      }
    }
    return list;
  }, [expanding, previewCols, previewRows, margins, cols, rows]);

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

  async function applyExpansion() {
    if (!projectId || !expanding) return;
    setPending(true);
    setError(null);
    const res = await expandProject({ projectId, ...margins });
    if (res.ok) {
      // Full reload: the page re-derives grid bounds + center from the new
      // tile extent, and reopens on the Build step where the new tiles queue.
      window.location.reload();
    } else {
      setPending(false);
      setError(res.error);
    }
  }

  return (
    <div className="relative h-full w-full bg-stone-900">
      <AreaScene
        apiKey={apiKey}
        center={previewCenter}
        cols={previewCols}
        rows={previewRows}
        interactive={!readOnly}
        onCenterChange={onCenterChange}
        dimOutside
        {...(previewOverlay ? { overlay: previewOverlay } : {})}
      />

      {/* fixed crosshair marking the grid center */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-3 w-3 rounded-full border-2 border-white/90 shadow" />
      </div>

      <div className="absolute bottom-4 left-4 w-80 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        {readOnly ? (
          <>
            <div className="text-[13px] text-stone-600">
              <div className="font-medium text-stone-800">{cityLabel || 'area'}</div>
              <div className="mt-1 text-[12px] text-stone-500">
                {cols}×{rows} = <strong className="text-stone-700">{cols * rows}</strong> tiles
              </div>
            </div>

            {projectId && (
              <div className="mt-3 border-stone-200 border-t pt-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
                  expand grid
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['top', 'left', 'right', 'bottom'] as const).map((side) => (
                    <Stepper
                      key={side}
                      label={side}
                      value={margins[side]}
                      min={0}
                      max={100}
                      onChange={(n) => setMargins((m) => ({ ...m, [side]: n }))}
                    />
                  ))}
                </div>
                <div className="mt-2 text-[12px] text-stone-500">
                  {expanding ? (
                    <>
                      → {previewCols}×{previewRows} ·{' '}
                      <strong className="text-stone-800">+{addedTiles}</strong> new tiles (each one
                      renders + runs the model)
                    </>
                  ) : (
                    'grey preview shows the tiles an expansion would add'
                  )}
                </div>
                <button
                  type="button"
                  onClick={applyExpansion}
                  disabled={!expanding || pending}
                  className="mt-2 h-9 w-full rounded-full bg-stone-900 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-40"
                >
                  {pending ? 'expanding…' : `expand by ${addedTiles} tiles`}
                </button>
                {error && <p className="mt-2 mb-0 text-xs text-red-600">{error}</p>}
              </div>
            )}
          </>
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
  min = 1,
  max = 200,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
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
          onChange={(e) => onChange(clamp(Number.parseInt(e.target.value, 10) || min))}
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
