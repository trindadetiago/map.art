'use client';

import type { ModelName } from '@mapart/models';
import { Scene, type SceneHandle } from '@mapart/renderer/debug/Scene';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ProjectMap, type TileCoord, type TileVisualState } from './ProjectMap';
import type { SavedTile } from './TileRenderer';

const Minimap = dynamic(() => import('./Minimap').then((m) => m.Minimap), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        width: 260,
        height: 200,
        borderRadius: 6,
        background: 'rgba(0,0,0,0.4)',
        color: '#fff',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'monospace',
        zIndex: 10,
      }}
    >
      loading minimap…
    </div>
  ),
});

const DEFAULT_PROMPT =
  'Convert this aerial isometric city render into a 16-bit isometric pixel-art tile in the visual style of SimCity 2000, RollerCoaster Tycoon 2, and Theme Hospital. Late-1990s simulation game aesthetic: limited saturated palette, crisp aliased pixel edges, simple flat shading with a single top-left light direction. While keeping the exact building footprints, road grid, and layout identical to the input, re-render every surface as pixel art. Treat low-poly artifacts in the input as cues about real-world content, not features to copy: blocky tree shapes are trees (round pixel-art crowns), shimmering surfaces are water (flat color + 2-pixel checkerboard), stretched facades are buildings (clean rectangular pixel-art walls). Do not invent, move, or remove buildings.';

const MODEL_OPTIONS: { value: ModelName; label: string }[] = [
  { value: 'stub', label: 'stub (fast, no API)' },
  { value: 'nano-banana', label: 'nano-banana (Gemini 2.5)' },
  { value: 'nano-banana-pro', label: 'nano-banana-pro (Gemini 3 pro)' },
  { value: 'gemini-3.1-flash-image', label: 'gemini-3.1-flash-image' },
  { value: 'gpt-image-1', label: 'gpt-image-1 (OpenAI)' },
  { value: 'gpt-image-1.5', label: 'gpt-image-1.5 (OpenAI)' },
];

const NEIGHBOR_OFFSETS: ReadonlyArray<{ dc: number; dr: number }> = [
  { dc: -1, dr: 1 },
  { dc: 0, dr: 1 },
  { dc: 1, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: -1, dr: -1 },
  { dc: 0, dr: -1 },
  { dc: 1, dr: -1 },
];

const INFILL_HYBRID_SIZE = 1024;
const INFILL_SLOT_SIZE = Math.floor(INFILL_HYBRID_SIZE / 3);

const keyOf = (col: number, row: number) => `${col},${row}`;

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e instanceof Event ? new Error('image load failed') : e);
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob null'))), 'image/png');
  });
}

/** Built at OpenAI's native 1024×1024 so the API doesn't downsample-then-upsample
 *  the inpainted region (avoids the lossy round-trip the adapter would otherwise do).
 *  Slot size = floor(1024/3) = 341. Empty neighbour slots are filled with opaque
 *  black, NOT transparent — alpha-0 areas in the input image can be re-interpreted
 *  as "editable" even when a separate mask is provided, which scrambles the model's
 *  read of the scene. */
async function buildInfillInputs(
  renderedDataUrl: string,
  neighbors: Array<{ dc: number; dr: number; url: string }>,
): Promise<{
  hybrid: Blob;
  mask: Blob;
  neighborCount: number;
  slotSize: number;
  hybridSize: number;
}> {
  const H = INFILL_HYBRID_SIZE;
  const S = INFILL_SLOT_SIZE;

  const hybridCanvas = document.createElement('canvas');
  hybridCanvas.width = H;
  hybridCanvas.height = H;
  const hctx = hybridCanvas.getContext('2d');
  if (!hctx) throw new Error('2d context unavailable');
  hctx.fillStyle = '#000000';
  hctx.fillRect(0, 0, H, H);

  const renderedImg = await loadImageEl(renderedDataUrl);
  hctx.drawImage(renderedImg, S, S, S, S);

  let drawn = 0;
  await Promise.all(
    neighbors.map(async (n) => {
      try {
        const img = await loadImageEl(n.url);
        const slotX = (1 + n.dc) * S;
        const slotY = (1 - n.dr) * S;
        hctx.drawImage(img, slotX, slotY, S, S);
        drawn++;
      } catch (e) {
        console.warn('[studio] neighbour image failed to load', n, e);
      }
    }),
  );

  const hybrid = await canvasToBlob(hybridCanvas);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = H;
  maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  if (!mctx) throw new Error('2d context unavailable');
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(0, 0, H, H);
  mctx.clearRect(S, S, S, S);
  const mask = await canvasToBlob(maskCanvas);

  return { hybrid, mask, neighborCount: drawn, slotSize: S, hybridSize: H };
}

interface TileStatus {
  phase: 'rendering' | 'generating' | 'done' | 'error';
  error?: string;
  renderedUrl?: string;
  generatedUrl?: string;
  ts: number;
}

export interface ProjectWorkspaceProps {
  projectId: string;
  apiKey: string;
  tiles: TileCoord[];
  initialCenterLat: number;
  initialCenterLng: number;
  initialPitch: number;
  initialYaw: number;
  initialTileWorldMeters: number;
  initialTilePixelSize: number;
  initialGridSide: number;
  saveAction: (
    id: string,
    patch: {
      centerLat: number;
      centerLng: number;
      cameraPitch: number;
      cameraYaw: number;
      tileWorldMeters: number;
    },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  reseedTilesAction: (
    id: string,
    side: number,
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  saveTileAction: (
    fd: FormData,
  ) => Promise<
    | { ok: true; col: number; row: number; url: string; filename: string }
    | { ok: false; error: string }
  >;
  listTilesAction: (projectId: string) => Promise<SavedTile[]>;
  generateTileAction: (
    projectId: string,
    col: number,
    row: number,
    prompt: string,
    modelName: ModelName,
  ) => Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }>;
  listGeneratedTilesAction: (projectId: string) => Promise<SavedTile[]>;
  generateTileInfillAction: (
    fd: FormData,
  ) => Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }>;
}

export function ProjectWorkspace({
  projectId,
  apiKey,
  tiles,
  initialCenterLat,
  initialCenterLng,
  initialPitch,
  initialYaw,
  initialTileWorldMeters,
  initialTilePixelSize,
  initialGridSide,
  saveAction,
  reseedTilesAction,
  saveTileAction,
  listTilesAction,
  generateTileAction,
  generateTileInfillAction,
  listGeneratedTilesAction,
}: ProjectWorkspaceProps) {
  // ----- Camera / grid state (was ProjectEditor) -----
  const [centerLat, setCenterLat] = useState(initialCenterLat);
  const [centerLng, setCenterLng] = useState(initialCenterLng);
  const [pitch, setPitch] = useState(initialPitch);
  const [yaw, setYaw] = useState(initialYaw);
  const [tileWorldMeters, setTileWorldMeters] = useState(initialTileWorldMeters);
  const [gridSide, setGridSide] = useState(initialGridSide);
  const [viewZoom, setViewZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panZ, setPanZ] = useState(0);
  const clampZoom = (v: number) => Math.max(0.005, Math.min(256, v));

  const [saved, setSaved] = useState({
    centerLat: initialCenterLat,
    centerLng: initialCenterLng,
    pitch: initialPitch,
    yaw: initialYaw,
    tileWorldMeters: initialTileWorldMeters,
    gridSide: initialGridSide,
  });
  const [savePending, startSaveTransition] = useTransition();
  const [reseedPending, startReseedTransition] = useTransition();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    Math.abs(centerLat - saved.centerLat) > 1e-7 ||
    Math.abs(centerLng - saved.centerLng) > 1e-7 ||
    pitch !== saved.pitch ||
    yaw !== saved.yaw ||
    Math.abs(tileWorldMeters - saved.tileWorldMeters) > 0.01;

  const onSave = () => {
    setEditorError(null);
    setJustSaved(false);
    startSaveTransition(async () => {
      const result = await saveAction(projectId, {
        centerLat,
        centerLng,
        cameraPitch: pitch,
        cameraYaw: yaw,
        tileWorldMeters,
      });
      if (result.ok) {
        setSaved((s) => ({ ...s, centerLat, centerLng, pitch, yaw, tileWorldMeters }));
        setJustSaved(true);
      } else {
        setEditorError(result.error);
      }
    });
  };

  const onReset = () => {
    setCenterLat(saved.centerLat);
    setCenterLng(saved.centerLng);
    setPitch(saved.pitch);
    setYaw(saved.yaw);
    setTileWorldMeters(saved.tileWorldMeters);
    setPanX(0);
    setPanZ(0);
    setViewZoom(1);
    setEditorError(null);
    setJustSaved(false);
  };

  const gridDirty = gridSide !== saved.gridSide;
  const onApplyGrid = () => {
    if (!gridDirty) return;
    if (gridSide < saved.gridSide) {
      const lost = saved.gridSide * saved.gridSide - gridSide * gridSide;
      const ok = window.confirm(
        `Shrinking from ${saved.gridSide}×${saved.gridSide} to ${gridSide}×${gridSide} will delete ${lost} tile(s) and any generated versions on them. Continue?`,
      );
      if (!ok) return;
    }
    setEditorError(null);
    setJustSaved(false);
    startReseedTransition(async () => {
      const result = await reseedTilesAction(projectId, gridSide);
      if (result.ok) {
        setSaved((s) => ({ ...s, gridSide }));
      } else {
        setEditorError(result.error);
      }
    });
  };

  // ----- Tile studio state (was TileStudio) -----
  const project = useMemo(
    () => ({
      centerLat,
      centerLng,
      cameraPitch: pitch,
      cameraYaw: yaw,
      tileWorldMeters,
      tilePixelSize: initialTilePixelSize,
    }),
    [centerLat, centerLng, pitch, yaw, tileWorldMeters, initialTilePixelSize],
  );

  const firstTile = tiles[0] ?? { col: 0, row: 0 };
  const [activeParams, setActiveParams] = useState<RenderParams>(() =>
    renderParamsForTile(project, firstTile.col, firstTile.row),
  );
  const sceneRef = useRef<SceneHandle>(null);
  const inFlightRef = useRef<boolean>(false);

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [modelName, setModelName] = useState<ModelName>('gpt-image-1.5');
  const [savedRendered, setSavedRendered] = useState<Map<string, SavedTile>>(() => new Map());
  const [savedGenerated, setSavedGenerated] = useState<Map<string, SavedTile>>(() => new Map());
  const [statuses, setStatuses] = useState<Map<string, TileStatus>>(() => new Map());
  const [studioError, setStudioError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const refresh = useCallback(async () => {
    try {
      const [rendered, generated] = await Promise.all([
        listTilesAction(projectId),
        listGeneratedTilesAction(projectId),
      ]);
      const r = new Map<string, SavedTile>();
      for (const t of rendered) r.set(keyOf(t.col, t.row), t);
      const g = new Map<string, SavedTile>();
      for (const t of generated) g.set(keyOf(t.col, t.row), t);
      setSavedRendered(r);
      setSavedGenerated(g);
    } catch (e) {
      setStudioError(e instanceof Error ? e.message : String(e));
    }
  }, [listTilesAction, listGeneratedTilesAction, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = useCallback((k: string, s: TileStatus | null) => {
    setStatuses((m) => {
      const next = new Map(m);
      if (s === null) next.delete(k);
      else next.set(k, s);
      return next;
    });
  }, []);

  const renderAndGenerate = useCallback(
    async (col: number, row: number, opts?: { skipGenerate?: boolean }): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const k = keyOf(col, row);
      setStudioError(null);
      setStatus(k, { phase: 'rendering', ts: Date.now() });
      try {
        const scene = sceneRef.current;
        if (!scene) throw new Error('capture scene not ready');
        const params = renderParamsForTile(project, col, row);
        setActiveParams(params);
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await scene.waitForSettled({ settleMs: 600, timeoutMs: 20000 }).catch((e) => {
          console.warn(`[studio] settle warning at (${col},${row})`, e);
        });
        const dataUrl = scene.capture();
        if (!dataUrl) throw new Error(`capture returned null at (${col},${row})`);
        const blob = await (await fetch(dataUrl)).blob();
        const fd = new FormData();
        fd.append('projectId', projectId);
        fd.append('col', String(col));
        fd.append('row', String(row));
        fd.append('png', blob, `${col}_${row}.png`);
        const renderRes = await saveTileAction(fd);
        if (!renderRes.ok) throw new Error(`render save failed: ${renderRes.error}`);
        const renderedUrl = `${renderRes.url}${renderRes.url.includes('?') ? '&' : '?'}v=${Date.now()}`;
        setSavedRendered((m) => {
          const next = new Map(m);
          next.set(k, {
            col: renderRes.col,
            row: renderRes.row,
            url: renderRes.url,
            filename: renderRes.filename,
          });
          return next;
        });

        if (opts?.skipGenerate) {
          setStatus(k, { phase: 'done', renderedUrl, ts: Date.now() });
          return;
        }

        setStatus(k, { phase: 'generating', renderedUrl, ts: Date.now() });
        type NeighborEntry = {
          dc: number;
          dr: number;
          url: string;
          kind: 'generated' | 'rendered';
        };
        const neighbors: NeighborEntry[] = NEIGHBOR_OFFSETS.flatMap(({ dc, dr }) => {
          const nk = keyOf(col + dc, row + dr);
          const gen = savedGenerated.get(nk);
          if (gen) return [{ dc, dr, url: gen.url, kind: 'generated' }] as NeighborEntry[];
          const ren = savedRendered.get(nk);
          if (ren) return [{ dc, dr, url: ren.url, kind: 'rendered' }] as NeighborEntry[];
          return [] as NeighborEntry[];
        });
        const hasGenerated = neighbors.some((n) => n.kind === 'generated');
        const canInfill =
          modelName.startsWith('gpt-image') && (hasGenerated || neighbors.length >= 4);
        let genRes: { ok: true; url: string; filename: string } | { ok: false; error: string };
        if (canInfill) {
          const { hybrid, mask, slotSize } = await buildInfillInputs(dataUrl, neighbors);
          const ifd = new FormData();
          ifd.append('projectId', projectId);
          ifd.append('col', String(col));
          ifd.append('row', String(row));
          ifd.append('prompt', prompt);
          ifd.append('modelName', modelName);
          ifd.append('slotSize', String(slotSize));
          ifd.append('finalTileSize', String(initialTilePixelSize));
          ifd.append('hybrid', hybrid, 'hybrid.png');
          ifd.append('mask', mask, 'mask.png');
          genRes = await generateTileInfillAction(ifd);
        } else {
          genRes = await generateTileAction(projectId, col, row, prompt, modelName);
        }
        if (!genRes.ok) throw new Error(`generate failed: ${genRes.error}`);
        const generatedUrl = `${genRes.url}${genRes.url.includes('?') ? '&' : '?'}v=${Date.now()}`;
        setSavedGenerated((m) => {
          const next = new Map(m);
          next.set(k, { col, row, url: genRes.url, filename: genRes.filename });
          return next;
        });
        setStatus(k, { phase: 'done', renderedUrl, generatedUrl, ts: Date.now() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStudioError(msg);
        setStatus(k, { phase: 'error', error: msg, ts: Date.now() });
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      project,
      projectId,
      saveTileAction,
      generateTileAction,
      generateTileInfillAction,
      savedGenerated,
      savedRendered,
      initialTilePixelSize,
      prompt,
      modelName,
      setStatus,
    ],
  );

  const onTileClick = useCallback(
    (col: number, row: number) => {
      void renderAndGenerate(col, row);
    },
    [renderAndGenerate],
  );

  const tileStates = useMemo<Map<string, TileVisualState>>(() => {
    const m = new Map<string, TileVisualState>();
    for (const k of savedGenerated.keys()) m.set(k, 'done');
    for (const k of savedRendered.keys()) if (!m.has(k)) m.set(k, 'pending');
    for (const [k, status] of statuses) {
      if (status.phase === 'rendering' || status.phase === 'generating') m.set(k, 'pending');
      else if (status.phase === 'error') m.set(k, 'error');
      else if (status.phase === 'done') m.set(k, 'done');
    }
    return m;
  }, [statuses, savedGenerated, savedRendered]);

  const tileImages = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const [k, t] of savedGenerated) m.set(k, t.url);
    return m;
  }, [savedGenerated]);

  const runBulk = useCallback(
    async (mode: 'missing-generated' | 'missing-rendered' | 'all') => {
      setStudioError(null);
      const targets = tiles.filter((t) => {
        const k = keyOf(t.col, t.row);
        if (mode === 'all') return true;
        if (mode === 'missing-rendered') return !savedRendered.has(k);
        return !savedGenerated.has(k);
      });
      setBulkRunning(true);
      setBulkProgress({ done: 0, total: targets.length });
      try {
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (!t) continue;
          await renderAndGenerate(t.col, t.row, { skipGenerate: mode === 'missing-rendered' });
          setBulkProgress({ done: i + 1, total: targets.length });
        }
      } finally {
        setBulkRunning(false);
      }
    },
    [tiles, savedRendered, savedGenerated, renderAndGenerate],
  );

  const recent = useMemo(
    () =>
      Array.from(statuses.entries())
        .sort((a, b) => b[1].ts - a[1].ts)
        .slice(0, 12),
    [statuses],
  );

  const renderedCount = savedRendered.size;
  const generatedCount = savedGenerated.size;
  const { missingGenerated, missingRendered } = useMemo(() => {
    let mr = 0;
    let mg = 0;
    for (const t of tiles) {
      const k = keyOf(t.col, t.row);
      if (!savedRendered.has(k)) mr++;
      if (!savedGenerated.has(k)) mg++;
    }
    return { missingRendered: mr, missingGenerated: mg };
  }, [tiles, savedRendered, savedGenerated]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          marginBottom: 8,
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        <span>
          drag the minimap to re-center · click any cell to render & generate · {renderedCount}/
          {tiles.length} rendered · {generatedCount}/{tiles.length} generated
        </span>
        <span style={{ flex: 1 }} />
        {dirty && <span style={dirtyChip}>unsaved</span>}
        {!dirty && justSaved && <span style={savedChip}>saved</span>}
      </div>

      <ProjectMap
        apiKey={apiKey}
        tiles={tiles}
        centerLat={centerLat}
        centerLng={centerLng}
        pitch={pitch}
        yaw={yaw}
        tileWorldMeters={tileWorldMeters}
        panX={panX}
        panZ={panZ}
        viewZoom={viewZoom}
        onPanDelta={(dx, dz) => {
          setPanX((p) => p + dx);
          setPanZ((p) => p + dz);
        }}
        onZoomFactor={(factor) => setViewZoom((v) => clampZoom(v * factor))}
        onTileClick={onTileClick}
        tileStates={tileStates}
        tileImages={tileImages}
        height={640}
        overlay={
          <Minimap
            centerLat={centerLat}
            centerLng={centerLng}
            initialZoom={15}
            minZoom={10}
            maxZoom={19}
            onCenterChange={(lat, lng) => {
              setCenterLat(lat);
              setCenterLng(lng);
            }}
          />
        }
      />

      {/* Hidden capture scene — full-res off-screen render used per-tile. */}
      <div
        style={{
          position: 'absolute',
          left: -99999,
          top: -99999,
          width: initialTilePixelSize,
          height: initialTilePixelSize,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto auto',
          gap: 16,
          alignItems: 'end',
          marginTop: 16,
          padding: 16,
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
        }}
      >
        <Slider
          label="pitch"
          min={5}
          max={90}
          step={1}
          value={pitch}
          onChange={setPitch}
          suffix="°"
        />
        <Slider label="yaw" min={0} max={360} step={1} value={yaw} onChange={setYaw} suffix="°" />
        <Slider
          label="tile size"
          min={30}
          max={500}
          step={5}
          value={tileWorldMeters}
          onChange={setTileWorldMeters}
          suffix="m"
        />
        <button
          type="button"
          onClick={onReset}
          disabled={!dirty || savePending}
          style={secondaryBtn}
        >
          reset
        </button>
        <button type="button" onClick={onSave} disabled={!dirty || savePending} style={primaryBtn}>
          {savePending ? 'saving…' : 'save'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto auto',
          gap: 16,
          alignItems: 'end',
          marginTop: 8,
          padding: 16,
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 8,
        }}
      >
        <Slider
          label="grid side"
          min={1}
          max={201}
          step={1}
          value={gridSide}
          onChange={(v) => setGridSide(Math.round(v))}
        />
        <span
          style={{
            fontSize: 11,
            opacity: 0.6,
            alignSelf: 'center',
            maxWidth: 240,
            fontFamily: 'monospace',
          }}
        >
          {gridSide}×{gridSide} = {gridSide * gridSide} tiles
          {gridDirty && (
            <span style={{ display: 'block', opacity: 0.7 }}>
              {gridSide < saved.gridSide
                ? `shrinking from ${saved.gridSide}×${saved.gridSide} — destructive`
                : `growing from ${saved.gridSide}×${saved.gridSide}`}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onApplyGrid}
          disabled={!gridDirty || reseedPending}
          style={primaryBtn}
        >
          {reseedPending ? 'applying…' : 'apply grid'}
        </button>
      </div>

      {editorError && (
        <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>
          {editorError}
        </pre>
      )}

      <section style={studioCard}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 12,
          }}
        >
          <h3 style={h3}>tile studio</h3>
          <div style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>
            <span style={legendChip('idle')} /> idle <span style={legendChip('pending')} /> pending{' '}
            <span style={legendChip('done')} /> done <span style={legendChip('error')} /> error
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={miniLabel}>prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 12,
                  padding: 8,
                  border: '1px solid #d4d4d8',
                  borderRadius: 4,
                  resize: 'vertical',
                }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={miniLabel}>model</span>
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value as ModelName)}
                style={{ padding: 6, fontSize: 13 }}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={bulkRunning || missingGenerated === 0}
                onClick={() => runBulk('missing-generated')}
                style={primaryBtn}
              >
                {bulkRunning
                  ? `${bulkProgress.done}/${bulkProgress.total}`
                  : `generate missing (${missingGenerated})`}
              </button>
              <button
                type="button"
                disabled={bulkRunning || missingRendered === 0}
                onClick={() => runBulk('missing-rendered')}
                style={secondaryBtn}
              >
                render only ({missingRendered})
              </button>
              <button type="button" onClick={refresh} disabled={bulkRunning} style={secondaryBtn}>
                reload
              </button>
            </div>
            {studioError && (
              <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 11, margin: 0 }}>
                {studioError}
              </pre>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, opacity: 0.55 }}>recent activity</div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 360,
                overflow: 'auto',
              }}
            >
              {recent.length === 0 && (
                <div style={{ fontSize: 11, opacity: 0.5 }}>click a tile to start</div>
              )}
              {recent.map(([k, s]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    gap: 6,
                    fontSize: 11,
                    fontFamily: 'monospace',
                    alignItems: 'center',
                    background: '#fafafa',
                    border: '1px solid #eee',
                    borderRadius: 4,
                    padding: 4,
                  }}
                >
                  <span style={{ width: 50 }}>{k}</span>
                  {s.renderedUrl && (
                    // biome-ignore lint/a11y/useAltText: thumbnail
                    <img src={s.renderedUrl} style={thumb} />
                  )}
                  {s.generatedUrl && (
                    // biome-ignore lint/a11y/useAltText: thumbnail
                    <img src={s.generatedUrl} style={thumb} />
                  )}
                  <span style={{ flex: 1, color: phaseColor(s.phase) }}>
                    {s.phase}
                    {s.error ? ` — ${s.error.slice(0, 40)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1,
          opacity: 0.5,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontFamily: 'monospace',
            opacity: 0.8,
            fontVariantNumeric: 'tabular-nums',
            width: 48,
            textAlign: 'right',
          }}
        >
          {value.toFixed(0)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        style={{ width: '100%', minWidth: 0 }}
      />
    </label>
  );
}

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
const dirtyChip = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 3,
  background: '#fef3c722',
  color: '#ca8a04',
  border: '1px solid #fde68a',
  fontFamily: 'monospace' as const,
};
const savedChip = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 3,
  background: '#d1fae522',
  color: '#16a34a',
  border: '1px solid #bbf7d0',
  fontFamily: 'monospace' as const,
};
const studioCard = {
  padding: 16,
  background: '#fff',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  marginTop: 16,
  position: 'relative' as const,
};
const h3 = {
  margin: 0,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.55,
};
const miniLabel = {
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.5,
};
const thumb = {
  width: 32,
  height: 32,
  objectFit: 'cover' as const,
  border: '1px solid #eee',
  borderRadius: 2,
};

function legendChip(state: TileVisualState): React.CSSProperties {
  const colors: Record<TileVisualState, string> = {
    idle: '#3b82f6',
    pending: '#eab308',
    done: '#22c55e',
    error: '#ef4444',
  };
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    background: colors[state],
    borderRadius: 2,
    marginRight: 2,
    marginLeft: 4,
  };
}

function phaseColor(p: TileStatus['phase']): string {
  if (p === 'error') return '#ef4444';
  if (p === 'done') return '#16a34a';
  return '#a16207';
}
