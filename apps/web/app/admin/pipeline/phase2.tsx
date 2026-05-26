'use client';

import { useState } from 'react';
import type {
  PipelinePanelProps,
  PipelineProject,
  RenderedTileInfo,
  StrategyDescriptor,
  StrategyRunResult,
} from './panel';
import { TileGridPreview } from './tile_grid_preview';

export function Phase2({
  project,
  strategies,
  availableModels,
  defaultPrompt,
  listRenderedAction,
  runStrategyAction,
}: {
  project: PipelineProject;
  strategies: StrategyDescriptor[];
  availableModels: string[];
  defaultPrompt: string;
  listRenderedAction: PipelinePanelProps['listRenderedAction'];
  runStrategyAction: PipelinePanelProps['runStrategyAction'];
}) {
  const [strategyName, setStrategyName] = useState(strategies[0]?.name ?? 'independent');
  const [modelName, setModelName] = useState(availableModels[0] ?? 'gpt-image-1.5');
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StrategyRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedTileInfo[]>([]);
  const [showSeams, setShowSeams] = useState(true);

  const loadRendered = async () => {
    setRendered(await listRenderedAction(project.id));
  };

  const run = async () => {
    setError(null);
    setRunning(true);
    setResult(null);
    try {
      const res = await runStrategyAction(project.id, strategyName, modelName, prompt);
      if (res.ok) setResult(res);
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const selectedStrategy = strategies.find((s) => s.name === strategyName);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="m-0 mb-3 text-[11px] uppercase tracking-wider opacity-[0.55]">
        phase 2 · experiment with strategies
      </h2>
      <div className="grid grid-cols-[360px_1fr] gap-6">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px]">
            <span>strategy</span>
            <select
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
            >
              {strategies.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {selectedStrategy && (
            <div className="text-xs opacity-70">{selectedStrategy.description}</div>
          )}
          <label className="flex flex-col gap-1 text-[13px]">
            <span>model</span>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-[13px]"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase opacity-[0.55]">prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              className="rounded border border-neutral-300 px-2 py-1.5 font-sans text-[13px]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadRendered}
              className="cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900"
            >
              load rendered ({rendered.length})
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running || rendered.length === 0}
              className="cursor-pointer rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'running…' : 'run strategy'}
            </button>
          </div>
          {error && <pre className="mt-1 whitespace-pre-wrap text-xs text-red-700">{error}</pre>}
        </div>
        <div>
          <div className="mb-3 flex gap-6">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={showSeams}
                onChange={(e) => setShowSeams(e.target.checked)}
              />
              show seam overlay
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 text-xs opacity-60">rendered (input)</div>
              <TileGridPreview tiles={rendered} pixelSize={project.tilePixelSize} />
            </div>
            <div>
              <div className="mb-1 text-xs opacity-60">generated (output · {strategyName})</div>
              {result ? (
                <TileGridPreview
                  tiles={result.tiles.map((t) => ({
                    col: t.col,
                    row: t.row,
                    storageKey: t.url,
                    url: t.url,
                  }))}
                  pixelSize={project.tilePixelSize}
                />
              ) : (
                <div className="text-xs opacity-50">(run strategy to see output)</div>
              )}
            </div>
          </div>
          {result && (
            <div className="mt-4">
              <div className="mb-1 text-xs opacity-60">stitched composite</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="stitched composite"
                src={showSeams ? result.seamOverlayUrl : result.stitchedUrl}
                className="max-w-full rounded border border-neutral-300 [image-rendering:pixelated]"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
