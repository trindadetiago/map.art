'use client';

import type { LatLng } from '@mapart/geo';
import { useEffect, useMemo, useState } from 'react';
import { AreaScene, type OverlayTile } from './area_scene';

export interface TileLite {
  x: number;
  y: number;
  currentStatusType: 'render' | 'stylize';
  status: 'pending' | 'progress' | 'done' | 'error';
  renderedImgPath: string | null;
  stylizedImgPath: string | null;
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
  }, [projectId]);

  // Every tile painted onto its footprint over the live city, by status:
  // error → red, stylized → image, rendered → dimmed image, render-in-progress
  // → pulsing amber, otherwise pending → faint grey.
  const overlay = useMemo<OverlayTile[]>(
    () =>
      tiles.map((t) => {
        if (t.status === 'error') return { x: t.x, y: t.y, state: 'error', imageUrl: null };
        if (t.stylizedImgPath)
          return {
            x: t.x,
            y: t.y,
            state: 'stylized',
            imageUrl: `/api/storage/${t.stylizedImgPath}`,
          };
        if (t.renderedImgPath)
          return {
            x: t.x,
            y: t.y,
            state: 'rendered',
            imageUrl: `/api/storage/${t.renderedImgPath}`,
          };
        if (t.status === 'progress') return { x: t.x, y: t.y, state: 'progress', imageUrl: null };
        return { x: t.x, y: t.y, state: 'pending', imageUrl: null };
      }),
    [tiles],
  );

  const stylized = tiles.filter((t) => t.stylizedImgPath).length;
  const rendered = tiles.filter((t) => t.renderedImgPath).length;
  const errors = tiles.filter((t) => t.status === 'error').length;
  const total = cols * rows;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-stone-200 border-b px-5 py-4">
        <div>
          <div className="text-[15px] font-semibold text-stone-900">{projectName}</div>
          <div className="text-[12px] text-stone-500">
            {stylized}/{total} stylized · {rendered}/{total} rendered
            {errors > 0 && <span className="text-red-600"> · {errors} error</span>}
          </div>
        </div>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-stone-900 transition-all"
            style={{ width: `${total ? (stylized / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-stone-900">
        <AreaScene
          apiKey={apiKey}
          center={center}
          cols={cols}
          rows={rows}
          interactive={false}
          overlay={overlay}
        />
      </div>
    </div>
  );
}
