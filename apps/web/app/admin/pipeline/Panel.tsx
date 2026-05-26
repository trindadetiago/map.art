'use client';

import { Scene, type SceneHandle } from '@/components/Scene';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
import { useMemo, useRef, useState } from 'react';

export interface PipelineProject {
  id: string;
  slug: string;
  name: string;
  centerLat: number;
  centerLng: number;
  cameraPitch: number;
  cameraYaw: number;
  tileWorldMeters: number;
  tilePixelSize: number;
}

export interface RenderedTileInfo {
  col: number;
  row: number;
  storageKey: string;
  url: string; // /api/storage/<key> served image URL
}

export interface StrategyDescriptor {
  name: string;
  description: string;
}

export interface StrategyRunResult {
  ok: true;
  tiles: Array<{ col: number; row: number; url: string; metadata: Record<string, unknown> }>;
  stitchedUrl: string;
  seamOverlayUrl: string;
}

export interface StrategyRunError {
  ok: false;
  error: string;
}

export interface PipelinePanelProps {
  apiKey: string;
  projects: PipelineProject[];
  strategies: StrategyDescriptor[];
  availableModels: string[];
  defaultPrompt: string;
  /**
   * Accepts a FormData with `projectId`, `col`, `row`, and `png` (Blob) fields.
   * Using FormData avoids the React Flight "maximum array nesting" limit that
   * fires when you pass megabyte-sized base64 data-URLs as plain-string args.
   */
  saveRenderedAction: (
    fd: FormData,
  ) => Promise<{ ok: true; url: string; storageKey: string } | { ok: false; error: string }>;
  listRenderedAction: (projectId: string) => Promise<RenderedTileInfo[]>;
  /** Stitches the currently-saved rendered tiles (no model). Used to verify that rendered geometry lines up without blaming the generator. */
  stitchRenderedAction: (
    projectId: string,
  ) => Promise<{ ok: true; stitchedUrl: string } | { ok: false; error: string }>;
  runStrategyAction: (
    projectId: string,
    strategyName: string,
    modelName: string,
    prompt: string,
  ) => Promise<StrategyRunResult | StrategyRunError>;
}

export function PipelinePanel({
  apiKey,
  projects,
  strategies,
  availableModels,
  defaultPrompt,
  saveRenderedAction,
  listRenderedAction,
  runStrategyAction,
  stitchRenderedAction,
}: PipelinePanelProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projectId, projects]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section style={cardStyle}>
        <h2 style={h2}>project</h2>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inputStyle}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.slug}
            </option>
          ))}
        </select>
        {project && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8, fontFamily: 'monospace' }}>
            center {project.centerLat.toFixed(4)}, {project.centerLng.toFixed(4)} · pitch{' '}
            {project.cameraPitch}° · yaw {project.cameraYaw}° · tile {project.tileWorldMeters}m /{' '}
            {project.tilePixelSize}px
          </div>
        )}
      </section>

      {project && (
        <>
          <Phase1
            apiKey={apiKey}
            project={project}
            saveRenderedAction={saveRenderedAction}
            listRenderedAction={listRenderedAction}
            stitchRenderedAction={stitchRenderedAction}
          />
          <Phase2
            project={project}
            strategies={strategies}
            availableModels={availableModels}
            defaultPrompt={defaultPrompt}
            listRenderedAction={listRenderedAction}
            runStrategyAction={runStrategyAction}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — render N tiles via the Scene component, save each to storage.
// ─────────────────────────────────────────────────────────────────────────────

function Phase1({
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
    <section style={cardStyle}>
      <h2 style={h2}>phase 1 · render source tiles</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            <span>cols</span>
            <input
              type="number"
              min={1}
              max={9}
              value={cols}
              onChange={(e) => setCols(clampInt(e.target.value, 1, 9))}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>rows</span>
            <input
              type="number"
              min={1}
              max={9}
              value={rows}
              onChange={(e) => setRows(clampInt(e.target.value, 1, 9))}
              style={inputStyle}
            />
          </label>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            will render {targets.length} tiles centered on (col 0, row 0)
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={running} onClick={run} style={primaryBtn}>
              {running ? `rendering ${progress.done}/${progress.total}` : 'render all'}
            </button>
            <button type="button" onClick={refresh} style={secondaryBtn}>
              reload list
            </button>
            <button
              type="button"
              onClick={onStitch}
              disabled={stitching || rendered.length === 0}
              style={secondaryBtn}
            >
              {stitching ? 'stitching…' : 'stitch rendered'}
            </button>
          </div>
          {error && (
            <pre
              style={{
                color: 'crimson',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                marginTop: 4,
              }}
            >
              {error}
            </pre>
          )}
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
            live scene (hidden off-screen during runs, shown below in dev for debugging):
          </div>
          <div
            style={{
              width: 180,
              height: 180,
              overflow: 'hidden',
              border: '1px solid #ccc',
              borderRadius: 4,
              position: 'relative',
            }}
          >
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
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
            rendered tiles for this project ({rendered.length})
          </div>
          <TileGridPreview tiles={rendered} pixelSize={project.tilePixelSize} />
          {stitchUrl && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
                stitched rendered composite (no model) — use this to check whether tiles abut
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="stitched rendered composite"
                src={stitchUrl}
                style={{
                  maxWidth: '100%',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  imageRendering: 'pixelated',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — pick strategy, run against the saved rendered tiles, show output.
// ─────────────────────────────────────────────────────────────────────────────

function Phase2({
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
  const [modelName, setModelName] = useState(availableModels[0] ?? 'stub');
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
    <section style={cardStyle}>
      <h2 style={h2}>phase 2 · experiment with strategies</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            <span>strategy</span>
            <select
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              style={inputStyle}
            >
              {strategies.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {selectedStrategy && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>{selectedStrategy.description}</div>
          )}
          <label style={labelStyle}>
            <span>model</span>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              style={inputStyle}
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, opacity: 0.55, textTransform: 'uppercase' }}>prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              style={{ ...inputStyle, fontFamily: 'inherit', fontSize: 13 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={loadRendered} style={secondaryBtn}>
              load rendered ({rendered.length})
            </button>
            <button
              type="button"
              onClick={run}
              disabled={running || rendered.length === 0}
              style={primaryBtn}
            >
              {running ? 'running…' : 'run strategy'}
            </button>
          </div>
          {error && (
            <pre
              style={{
                color: 'crimson',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                marginTop: 4,
              }}
            >
              {error}
            </pre>
          )}
        </div>
        <div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showSeams}
                onChange={(e) => setShowSeams(e.target.checked)}
              />
              show seam overlay
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>rendered (input)</div>
              <TileGridPreview tiles={rendered} pixelSize={project.tilePixelSize} />
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
                generated (output · {strategyName})
              </div>
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
                <div style={{ opacity: 0.5, fontSize: 12 }}>(run strategy to see output)</div>
              )}
            </div>
          </div>
          {result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>stitched composite</div>
              <img
                alt="stitched composite"
                src={showSeams ? result.seamOverlayUrl : result.stitchedUrl}
                style={{
                  maxWidth: '100%',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  imageRendering: 'pixelated',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function TileGridPreview({
  tiles,
  pixelSize,
}: {
  tiles: RenderedTileInfo[];
  pixelSize: number;
}) {
  if (tiles.length === 0) {
    return (
      <div
        style={{
          opacity: 0.5,
          fontSize: 12,
          padding: 24,
          border: '1px dashed #ccc',
          borderRadius: 4,
        }}
      >
        no tiles yet
      </div>
    );
  }
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  for (const t of tiles) {
    if (t.col < minCol) minCol = t.col;
    if (t.col > maxCol) maxCol = t.col;
    if (t.row < minRow) minRow = t.row;
    if (t.row > maxRow) maxRow = t.row;
  }
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const byKey = new Map<string, RenderedTileInfo>();
  for (const t of tiles) byKey.set(`${t.col},${t.row}`, t);
  const thumbSize = Math.min(96, Math.floor(480 / Math.max(cols, rows)));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${thumbSize}px)`,
        gap: 2,
        background: '#0a0a0a',
        padding: 2,
        borderRadius: 4,
      }}
    >
      {Array.from({ length: rows }, (_, rIdx) =>
        Array.from({ length: cols }, (_, cIdx) => {
          const col = minCol + cIdx;
          const row = maxRow - rIdx; // invert: row+ grows upward on screen
          const t = byKey.get(`${col},${row}`);
          return (
            <div
              key={`${col},${row}`}
              style={{
                width: thumbSize,
                height: thumbSize,
                background: t ? '#000' : '#222',
                overflow: 'hidden',
              }}
              title={`col=${col} row=${row}`}
            >
              {t && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.url}
                  alt={`tile ${col},${row}`}
                  style={{
                    width: thumbSize,
                    height: thumbSize,
                    objectFit: 'cover',
                    imageRendering: 'pixelated',
                  }}
                />
              )}
            </div>
          );
        }),
      ).flat()}
    </div>
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

const cardStyle = {
  padding: 16,
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
};
const h2 = {
  margin: 0,
  marginBottom: 12,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.55,
};
const labelStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 13,
};
const inputStyle = { padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 };
const primaryBtn = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #111',
  background: '#111',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #ccc',
  background: '#fff',
  color: '#111',
  borderRadius: 6,
  cursor: 'pointer',
};
