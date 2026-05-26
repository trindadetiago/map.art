'use client';

import { Scene, type SceneHandle } from '@/components/scene';
import type { ModelName } from '@mapart/models';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ProjectMap, type TileCoord, type TileVisualState } from './project_map';
import type { SavedTile } from './tile_renderer';

const Minimap = dynamic(() => import('./minimap').then((m) => m.Minimap), {
  ssr: false,
  loading: () => (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex h-[200px] w-[260px] items-center justify-center rounded-md bg-black/40 font-mono text-xs text-white">
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

const PRIMARY_BTN =
  'cursor-pointer rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BTN =
  'cursor-pointer rounded-md border border-neutral-300 bg-white px-4 py-2 text-[13px] text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50';
const MINI_LABEL = 'text-[11px] uppercase tracking-wider opacity-50';
const STUDIO_CARD = 'relative mt-4 rounded-lg border border-neutral-200 bg-white p-4';
const H3 = 'm-0 text-[11px] uppercase tracking-wider opacity-[0.55]';
const THUMB = 'h-8 w-8 rounded-sm border border-neutral-200 object-cover';

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
  const [hovered, setHovered] = useState<{
    col: number;
    row: number;
    x: number;
    y: number;
    screenSize: number;
  } | null>(null);
  const [showOriginal, setShowOriginal] = useState<Set<string>>(() => new Set());

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

        const localRendered = new Map(savedRendered);
        const captureAndSave = async (
          c: number,
          r: number,
        ): Promise<{ url: string; dataUrl: string }> => {
          const params = renderParamsForTile(project, c, r);
          setActiveParams(params);
          await new Promise<void>((res) => requestAnimationFrame(() => res()));
          await scene.waitForSettled({ settleMs: 600, timeoutMs: 20000 }).catch((e) => {
            console.warn(`[studio] settle warning at (${c},${r})`, e);
          });
          const dataUrl = scene.capture();
          if (!dataUrl) throw new Error(`capture returned null at (${c},${r})`);
          const blob = await (await fetch(dataUrl)).blob();
          const fd = new FormData();
          fd.append('projectId', projectId);
          fd.append('col', String(c));
          fd.append('row', String(r));
          fd.append('png', blob, `${c}_${r}.png`);
          const rr = await saveTileAction(fd);
          if (!rr.ok) throw new Error(`render save failed at (${c},${r}): ${rr.error}`);
          const tile = { col: rr.col, row: rr.row, url: rr.url, filename: rr.filename };
          localRendered.set(keyOf(c, r), tile);
          setSavedRendered((m) => {
            const next = new Map(m);
            next.set(keyOf(c, r), tile);
            return next;
          });
          return { url: rr.url, dataUrl };
        };

        const targetCap = await captureAndSave(col, row);
        const renderedUrl = `${targetCap.url}${targetCap.url.includes('?') ? '&' : '?'}v=${Date.now()}`;

        if (opts?.skipGenerate) {
          setStatus(k, { phase: 'done', renderedUrl, ts: Date.now() });
          return;
        }

        setStatus(k, { phase: 'generating', renderedUrl, ts: Date.now() });

        const canInfill = modelName.startsWith('gpt-image');
        const neighbors: Array<{ dc: number; dr: number; url: string }> = [];
        if (canInfill) {
          const inGrid = new Set(tiles.map((t) => keyOf(t.col, t.row)));
          for (const { dc, dr } of NEIGHBOR_OFFSETS) {
            const nc = col + dc;
            const nr = row + dr;
            const nk = keyOf(nc, nr);
            const gen = savedGenerated.get(nk);
            if (gen) {
              neighbors.push({ dc, dr, url: gen.url });
              continue;
            }
            const ren = localRendered.get(nk);
            if (ren) {
              neighbors.push({ dc, dr, url: ren.url });
              continue;
            }
            if (!inGrid.has(nk)) continue;
            setStatus(nk, { phase: 'rendering', ts: Date.now() });
            try {
              const neighCap = await captureAndSave(nc, nr);
              setStatus(nk, {
                phase: 'done',
                renderedUrl: `${neighCap.url}?v=${Date.now()}`,
                ts: Date.now(),
              });
              neighbors.push({ dc, dr, url: neighCap.url });
            } catch (e) {
              console.warn('[studio] neighbor capture failed', { nc, nr, e });
              setStatus(nk, {
                phase: 'error',
                error: e instanceof Error ? e.message : String(e),
                ts: Date.now(),
              });
            }
          }
        }

        let genRes: { ok: true; url: string; filename: string } | { ok: false; error: string };
        if (canInfill) {
          const { hybrid, mask, slotSize } = await buildInfillInputs(targetCap.dataUrl, neighbors);
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
      tiles,
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
    for (const [k, t] of savedGenerated) {
      const overrideKey = showOriginal.has(k) ? savedRendered.get(k)?.url : undefined;
      m.set(k, overrideKey ?? t.url);
    }
    return m;
  }, [savedGenerated, savedRendered, showOriginal]);

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
      <div className="mb-2 flex items-center gap-4 text-[13px] opacity-80">
        <span>
          drag the minimap to re-center · click any cell to render & generate · {renderedCount}/
          {tiles.length} rendered · {generatedCount}/{tiles.length} generated
        </span>
        <span className="flex-1" />
        {dirty && (
          <span className="rounded-sm border border-amber-200 bg-amber-100/20 px-2 py-0.5 font-mono text-[11px] text-amber-600">
            unsaved
          </span>
        )}
        {!dirty && justSaved && (
          <span className="rounded-sm border border-green-200 bg-green-100/20 px-2 py-0.5 font-mono text-[11px] text-green-600">
            saved
          </span>
        )}
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
        onTileHover={(col, row, x, y, screenSize) => {
          if (col == null || row == null) setHovered(null);
          else setHovered({ col, row, x, y, screenSize });
        }}
        tileStates={tileStates}
        tileImages={tileImages}
        height={640}
        overlay={
          <>
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
            {hovered &&
              hovered.screenSize >= 90 &&
              (() => {
                const k = keyOf(hovered.col, hovered.row);
                const hasGenerated = savedGenerated.has(k);
                const hasRendered = savedRendered.has(k);
                if (!hasGenerated && !hasRendered) return null;
                const isShowingOriginal = showOriginal.has(k);
                const fontSize = Math.max(9, Math.min(14, hovered.screenSize * 0.07));
                const padY = Math.max(2, Math.min(6, hovered.screenSize * 0.025));
                const padX = padY * 2;
                const gap = Math.max(2, Math.min(6, hovered.screenSize * 0.02));
                const inset = Math.max(3, Math.min(8, hovered.screenSize * 0.03));
                return (
                  <div
                    className="pointer-events-none absolute z-20 flex"
                    style={{
                      left: hovered.x,
                      top: hovered.y,
                      transform: `translate(calc(-100% - ${inset}px), ${inset}px)`,
                      gap,
                    }}
                  >
                    {hasGenerated && hasRendered && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowOriginal((s) => {
                            const next = new Set(s);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          });
                        }}
                        className="pointer-events-auto cursor-pointer whitespace-nowrap rounded-sm border border-white/30 bg-black/75 font-mono text-white"
                        style={{ fontSize, padding: `${padY}px ${padX}px` }}
                      >
                        {isShowingOriginal ? 'see generated' : 'see original'}
                      </button>
                    )}
                    {hasRendered && (
                      <button
                        type="button"
                        onClick={() => {
                          void renderAndGenerate(hovered.col, hovered.row);
                        }}
                        className="pointer-events-auto cursor-pointer whitespace-nowrap rounded-sm border border-white/30 bg-black/75 font-mono text-white"
                        style={{ fontSize, padding: `${padY}px ${padX}px` }}
                      >
                        regenerate
                      </button>
                    )}
                  </div>
                );
              })()}
          </>
        }
      />

      {/* Hidden capture scene — full-res off-screen render used per-tile. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: -99999,
          top: -99999,
          width: initialTilePixelSize,
          height: initialTilePixelSize,
        }}
        aria-hidden
      >
        <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-4 rounded-lg border border-neutral-200 bg-white p-4">
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
          className={SECONDARY_BTN}
        >
          reset
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || savePending}
          className={PRIMARY_BTN}
        >
          {savePending ? 'saving…' : 'save'}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <Slider
          label="grid side"
          min={1}
          max={201}
          step={1}
          value={gridSide}
          onChange={(v) => setGridSide(Math.round(v))}
        />
        <span className="max-w-[240px] self-center font-mono text-[11px] opacity-60">
          {gridSide}×{gridSide} = {gridSide * gridSide} tiles
          {gridDirty && (
            <span className="block opacity-70">
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
          className={PRIMARY_BTN}
        >
          {reseedPending ? 'applying…' : 'apply grid'}
        </button>
      </div>

      {editorError && (
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-700">{editorError}</pre>
      )}

      <section className={STUDIO_CARD}>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className={H3}>tile studio</h3>
          <div className="font-mono text-xs opacity-60">
            <LegendDot state="idle" /> idle <LegendDot state="pending" /> pending{' '}
            <LegendDot state="done" /> done <LegendDot state="error" /> error
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={MINI_LABEL}>prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                className="resize-y rounded border border-neutral-300 p-2 font-sans text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={MINI_LABEL}>model</span>
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value as ModelName)}
                className="rounded border border-neutral-300 px-1.5 py-1 text-[13px]"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={bulkRunning || missingGenerated === 0}
                onClick={() => runBulk('missing-generated')}
                className={PRIMARY_BTN}
              >
                {bulkRunning
                  ? `${bulkProgress.done}/${bulkProgress.total}`
                  : `generate missing (${missingGenerated})`}
              </button>
              <button
                type="button"
                disabled={bulkRunning || missingRendered === 0}
                onClick={() => runBulk('missing-rendered')}
                className={SECONDARY_BTN}
              >
                render only ({missingRendered})
              </button>
              <button
                type="button"
                onClick={refresh}
                disabled={bulkRunning}
                className={SECONDARY_BTN}
              >
                reload
              </button>
            </div>
            {studioError && (
              <pre className="m-0 whitespace-pre-wrap text-[11px] text-red-700">{studioError}</pre>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] opacity-[0.55]">recent activity</div>
            <div className="flex max-h-[360px] flex-col gap-1.5 overflow-auto">
              {recent.length === 0 && (
                <div className="text-[11px] opacity-50">click a tile to start</div>
              )}
              {recent.map(([k, s]) => (
                <div
                  key={k}
                  className="flex items-center gap-1.5 rounded border border-neutral-200 bg-neutral-50 p-1 font-mono text-[11px]"
                >
                  <span className="w-[50px]">{k}</span>
                  {s.renderedUrl && (
                    // biome-ignore lint/a11y/useAltText: thumbnail
                    <img src={s.renderedUrl} className={THUMB} />
                  )}
                  {s.generatedUrl && (
                    // biome-ignore lint/a11y/useAltText: thumbnail
                    <img src={s.generatedUrl} className={THUMB} />
                  )}
                  <span className="flex-1" style={{ color: phaseColor(s.phase) }}>
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
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex justify-between text-[11px] uppercase tracking-wider opacity-50">
        <span>{label}</span>
        <span className="w-12 text-right font-mono tabular-nums opacity-80">
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
        className="w-full min-w-0"
      />
    </label>
  );
}

function LegendDot({ state }: { state: TileVisualState }) {
  const colors: Record<TileVisualState, string> = {
    idle: '#3b82f6',
    pending: '#eab308',
    done: '#22c55e',
    error: '#ef4444',
  };
  return (
    <span
      className="ml-1 mr-0.5 inline-block h-2 w-2 rounded-sm"
      style={{ background: colors[state] }}
    />
  );
}

function phaseColor(p: TileStatus['phase']): string {
  if (p === 'error') return '#ef4444';
  if (p === 'done') return '#16a34a';
  return '#a16207';
}
