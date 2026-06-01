'use client';

import type { LatLng } from '@mapart/geo';
import { useEffect, useMemo, useState } from 'react';
import { restylizeTile } from './actions';
import { AreaScene, type OverlayTile } from './area_scene';

export interface TileLite {
  x: number;
  y: number;
  currentStatusType: 'render' | 'stylize';
  status: 'pending' | 'progress' | 'done' | 'error';
  renderedImgPath: string | null;
  stylizedImgPath: string | null;
}

type View = 'stylized' | 'render';
interface Menu {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

const isTerminal = (t: TileLite): boolean =>
  (t.currentStatusType === 'stylize' && t.status === 'done') || t.status === 'error';

export function StepBuild({
  apiKey,
  center,
  projectId,
  projectName,
  cols,
  rows,
  initialTiles,
}: {
  apiKey: string;
  center: LatLng;
  projectId: string;
  projectName: string;
  cols: number;
  rows: number;
  initialTiles: TileLite[];
}) {
  const [tiles, setTiles] = useState<TileLite[]>(initialTiles);
  const [view, setView] = useState<View>('stylized');
  const [dimOutside, setDimOutside] = useState(false);
  const [showLines, setShowLines] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  // Bumping this re-arms the poll loop after a manual re-stylize (which makes a
  // finished project active again).
  const [pollNonce, setPollNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollNonce re-arms the loop after a manual re-stylize
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finished = (ts: TileLite[]): boolean => ts.length > 0 && ts.every(isTerminal);

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tiles`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { tiles: TileLite[] };
          if (stopped) return;
          setTiles(data.tiles);
          if (finished(data.tiles)) return; // terminal — stop polling
        }
      } catch {
        // network blip — keep polling
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, pollNonce]);

  // Each tile painted onto its footprint over the live city. In stylized view,
  // status drives the look (stylized image / dimmed render / pulsing amber
  // in-progress / grey pending / red error). In render view, every rendered
  // tile shows its raw render at full opacity.
  const overlay = useMemo<OverlayTile[]>(
    () =>
      tiles.map((t) => {
        const rendered = t.renderedImgPath ? `/api/storage/${t.renderedImgPath}` : null;
        const stylized = t.stylizedImgPath ? `/api/storage/${t.stylizedImgPath}` : null;
        if (t.status === 'error') return { x: t.x, y: t.y, state: 'error', imageUrl: null };

        if (view === 'render') {
          if (rendered) return { x: t.x, y: t.y, state: 'stylized', imageUrl: rendered }; // full image
          if (t.status === 'progress') return { x: t.x, y: t.y, state: 'progress', imageUrl: null };
          return { x: t.x, y: t.y, state: 'pending', imageUrl: null };
        }

        if (stylized) return { x: t.x, y: t.y, state: 'stylized', imageUrl: stylized };
        if (t.currentStatusType === 'stylize' && t.status === 'progress')
          return { x: t.x, y: t.y, state: 'stylizing', imageUrl: rendered };
        if (rendered) return { x: t.x, y: t.y, state: 'rendered', imageUrl: rendered };
        if (t.status === 'progress') return { x: t.x, y: t.y, state: 'progress', imageUrl: null };
        return { x: t.x, y: t.y, state: 'pending', imageUrl: null };
      }),
    [tiles, view],
  );

  const stylizedCount = tiles.filter((t) => t.stylizedImgPath).length;
  const renderedCount = tiles.filter((t) => t.renderedImgPath).length;
  const errors = tiles.filter((t) => t.status === 'error').length;
  const total = cols * rows;

  async function doRestylize(x: number, y: number): Promise<void> {
    setMenu(null);
    // Optimistic: drop the tile back so it reads as re-queued immediately.
    setTiles((ts) =>
      ts.map((t) =>
        t.x === x && t.y === y ? { ...t, status: 'pending', stylizedImgPath: null } : t,
      ),
    );
    await restylizeTile({ projectId, x, y });
    setPollNonce((n) => n + 1); // re-arm polling to follow the re-stylize
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-stone-200 border-b px-5 py-4">
        <div>
          <div className="text-[15px] font-semibold text-stone-900">{projectName}</div>
          <div className="text-[12px] text-stone-500">
            {stylizedCount}/{total} stylized · {renderedCount}/{total} rendered
            {errors > 0 && <span className="text-red-600"> · {errors} error</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'stylized', label: 'Stylized' },
              { value: 'render', label: 'Render' },
            ]}
          />
          <Toggle on={dimOutside} onClick={() => setDimOutside((v) => !v)}>
            Focus area
          </Toggle>
          <Toggle on={showLines} onClick={() => setShowLines((v) => !v)}>
            Grid
          </Toggle>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-stone-900">
        <AreaScene
          apiKey={apiKey}
          center={center}
          cols={cols}
          rows={rows}
          interactive={false}
          overlay={overlay}
          dimOutside={dimOutside}
          showLines={showLines}
          onTileContext={(x, y, clientX, clientY) => {
            const t = tiles.find((tile) => tile.x === x && tile.y === y);
            if (t?.stylizedImgPath) setMenu({ x, y, clientX, clientY });
          }}
        />
      </div>

      {menu && (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
            style={{ left: menu.clientX, top: menu.clientY }}
          >
            <button
              type="button"
              onClick={() => doRestylize(menu.x, menu.y)}
              className="block w-full px-4 py-2 text-left text-[13px] text-stone-800 hover:bg-stone-100"
            >
              Re-stylize tile {menu.x},{menu.y}
            </button>
          </div>
        </>
      )}
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

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex h-8 items-center rounded-full border border-stone-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-full px-3 text-[12px] transition ${
            value === o.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
