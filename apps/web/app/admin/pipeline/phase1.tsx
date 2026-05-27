'use client';

import { Scene, type SceneHandle } from '@mapart/scene';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
import { useMemo, useRef, useState } from 'react';
import type { PipelinePanelProps, PipelineProject, RenderedTileInfo } from './panel';
import { TileGridPreview } from './tile_grid_preview';

export function Phase1({
  apiKey,
  project,
  saveRenderedAction,
  listRenderedAction,
  stitchRenderedAction,
}: {
  apiKey: string;
  project: PipelineProject;
  saveRenderedAction: PipelinePanelProps['saveRenderedAction'];
  listRenderedAction: PipelinePanelProps['listRenderedAction'];
  stitchRenderedAction: PipelinePanelProps['stitchRenderedAction'];
}) {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedTileInfo[]>([]);
  const sceneRef = useRef<SceneHandle>(null);

  const targets = useMemo(() => buildGrid(cols, rows), [cols, rows]);
  const [activeParams, setActiveParams] = useState<RenderParams>(() =>
    renderParamsForTile(project, 0, 0),
  );

  const run = async () => {
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: targets.length });

    const scene = sceneRef.current;
    if (!scene) {
      setError('Scene not ready');
      setRunning(false);
      return;
    }

    const outputs: RenderedTileInfo[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t) continue;
        const params = renderParamsForTile(project, t.col, t.row);
        setActiveParams(params);
        // Give React one frame to propagate params into Scene, then wait for the
        // TilesRenderer to actually finish streaming the new region.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await scene.waitForSettled({ settleMs: 600, timeoutMs: 20000 }).catch((e) => {
          console.warn(`[pipeline] settle warning at (${t.col},${t.row})`, e);
        });
        const dataUrl = scene.capture();
        if (!dataUrl) throw new Error('capture returned null');
        const blob = await dataUrlToBlob(dataUrl);
        const fd = new FormData();
        fd.append('projectId', project.id);
        fd.append('col', String(t.col));
        fd.append('row', String(t.row));
        fd.append('png', blob, `${t.col}_${t.row}.png`);
        const saved = await saveRenderedAction(fd);
        if (!saved.ok) throw new Error(saved.error);
        outputs.push({ col: t.col, row: t.row, storageKey: saved.storageKey, url: saved.url });
        setProgress({ done: i + 1, total: targets.length });
      }
      setRendered(outputs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const refresh = async () => {
    const list = await listRenderedAction(project.id);
    setRendered(list);
  };

  const [stitchUrl, setStitchUrl] = useState<string | null>(null);
  const [stitching, setStitching] = useState(false);
  const onStitch = async () => {
    setStitching(true);
    try {
      const res = await stitchRenderedAction(project.id);
      if (res.ok) setStitchUrl(res.stitchedUrl);
      else setError(res.error);
    } finally {
      setStitching(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="m-0 mb-3 text-[11px] uppercase tracking-wider opacity-[0.55]">
        phase 1 · render source tiles
      </h2>
      <div className="grid grid-cols-[360px_1fr] gap-6">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px]">
            <span>cols</span>
            <input
              type="number"
              min={1}
              max={9}
              value={cols}
              onChange={(e) => setCols(clampInt(e.target.value, 1, 9))}
              className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span>rows</span>
            <input
              type="number"
              min={1}
              max={9}
              value={rows}
              onChange={(e) => setRows(clampInt(e.target.value, 1, 9))}
              className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
            />
          </label>
          <div className="text-xs opacity-70">
            will render {targets.length} tiles centered on (col 0, row 0)
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={running}
              onClick={run}
              className="cursor-pointer rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? `rendering ${progress.done}/${progress.total}` : 'render all'}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900"
            >
              reload list
            </button>
            <button
              type="button"
              onClick={onStitch}
              disabled={stitching || rendered.length === 0}
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stitching ? 'stitching…' : 'stitch rendered'}
            </button>
          </div>
          {error && <pre className="mt-1 whitespace-pre-wrap text-xs text-red-700">{error}</pre>}
          <div className="mt-2 text-[11px] opacity-[0.55]">
            live scene (hidden off-screen during runs, shown below in dev for debugging):
          </div>
          <div className="relative h-[180px] w-[180px] overflow-hidden rounded border border-neutral-300">
            <div
              style={{
                transform: `scale(${180 / project.tilePixelSize})`,
                transformOrigin: 'top left',
              }}
            >
              <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs opacity-60">
            rendered tiles for this project ({rendered.length})
          </div>
          <TileGridPreview tiles={rendered} pixelSize={project.tilePixelSize} />
          {stitchUrl && (
            <div className="mt-4">
              <div className="mb-1 text-xs opacity-60">
                stitched rendered composite (no model) — use this to check whether tiles abut
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="stitched rendered composite"
                src={stitchUrl}
                className="max-w-full rounded border border-neutral-300 [image-rendering:pixelated]"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function buildGrid(cols: number, rows: number): Array<{ col: number; row: number }> {
  const halfC = Math.floor(cols / 2);
  const halfR = Math.floor(rows / 2);
  const minC = -halfC;
  const maxC = minC + cols - 1;
  const minR = -halfR;
  const maxR = minR + rows - 1;
  const out: Array<{ col: number; row: number }> = [];
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      out.push({ col: c, row: r });
    }
  }
  return out;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // `fetch(dataUrl)` is the standard way to parse a data URL into a Blob
  // without involving atob/Buffer and without inflating memory with string work.
  const res = await fetch(dataUrl);
  return res.blob();
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
