'use client';

import { Scene, type SceneHandle } from '@mapart/renderer';
import { type RenderParams, renderParamsForLatLng, tileCenterLatLng } from '@mapart/renderer';
import { useRef, useState } from 'react';
import { Field } from './field';
import { TileGrid3x3 } from './tile_grid_3x3';

export interface SaveResult {
  ok: true;
  key: string;
}
export interface SaveError {
  ok: false;
  error: string;
}

export interface RendererPanelProps {
  apiKey: string;
  saveAction?: (dataUrl: string, params: RenderParams) => Promise<SaveResult | SaveError>;
  /** Save a PNG to a caller-supplied exact key. Accepts FormData with `key`
   *  (string) and `png` (Blob) fields. We send a Blob (not a base64 string)
   *  to avoid Next.js Server Actions' arg-size cap. Required for the
   *  random-sample batch run. */
  saveToKeyAction?: (fd: FormData) => Promise<SaveResult | SaveError>;
}

interface SampleTile {
  col: number;
  row: number;
  url: string; // object URL for in-page preview (revoked when next batch runs)
  key: string;
}
interface SampleResult {
  sampleIdx: number;
  centerLat: number;
  centerLng: number;
  tiles: SampleTile[];
}

// João Pessoa bounding box (lat / lng) — loose enough to land anywhere from
// the beachfront to the inland neighbourhoods.
const JP_BBOX = { latMin: -7.18, latMax: -7.05, lngMin: -34.91, lngMax: -34.8 };

// 9-tile target + neighbour layout in reading order (top→bottom, left→right).
const TILE_OFFSETS: ReadonlyArray<{ col: number; row: number }> = [
  { col: -1, row: 1 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
  { col: -1, row: 0 },
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: -1, row: -1 },
  { col: 0, row: -1 },
  { col: 1, row: -1 },
];

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextFrame(): Promise<void> {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

const CARD = 'rounded-2xl border border-stone-200/70 bg-white p-6';
const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500';
const PILL =
  'rounded-full border border-stone-200 bg-stone-50 px-3 py-1 font-mono text-[11px] text-stone-600';
const BTN_PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full bg-stone-900 px-5 text-[13px] font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY =
  'rounded-full border border-stone-200 bg-white px-4 py-1.5 text-[12px] text-stone-700 no-underline transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50';

// Live scene + captured PNG render at a fixed display size; the scene canvas is
// scaled to fit so full-res capture is unaffected.
const SCENE_DISPLAY = 380;

export function RendererPanel({ apiKey, saveAction, saveToKeyAction }: RendererPanelProps) {
  const sceneRef = useRef<SceneHandle>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [lat, setLat] = useState(-7.115);
  const [lng, setLng] = useState(-34.861);
  const [pitch, setPitch] = useState(30);
  const [yaw, setYaw] = useState(45);
  const [size, setSize] = useState(1024);
  const [zoom, setZoom] = useState(18);

  const liveParams: RenderParams = { center: { lat, lng }, pitch, yaw, size, zoom };

  // When non-null, drives both scenes during a batch run; live form values are
  // ignored until the run finishes.
  const [batchParams, setBatchParams] = useState<RenderParams | null>(null);
  const activeParams = batchParams ?? liveParams;

  const [sampleN, setSampleN] = useState(50);
  const [sampleSeed, setSampleSeed] = useState(42);
  const [sampleRunning, setSampleRunning] = useState(false);
  const [sampleProgress, setSampleProgress] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleSummary, setSampleSummary] = useState<string | null>(null);
  const [sampleResults, setSampleResults] = useState<SampleResult[]>([]);
  const objectUrlsRef = useRef<string[]>([]);

  // Convert a data URL to a Blob — much smaller wire payload than the
  // base64-encoded string when round-tripped through FormData/multipart.
  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob();

  const runRandomSamples = async () => {
    if (sampleRunning) return;
    if (!saveToKeyAction) {
      setSampleError('saveToKeyAction prop is not wired — cannot save samples to disk');
      return;
    }
    if (!sceneRef.current) {
      setSampleError('scene not mounted yet — wait a moment and retry');
      return;
    }
    setSampleError(null);
    setSampleSummary(null);
    setSampleRunning(true);
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    objectUrlsRef.current = [];
    setSampleResults([]);
    const scn = sceneRef.current;
    try {
      const rng = mulberry32(sampleSeed);
      const totalFiles = sampleN * 9;
      let doneFiles = 0;
      const folderRoot = `renderer/samples/seed${sampleSeed}_n${sampleN}_${Date.now()}`;
      const results: SampleResult[] = [];

      for (let i = 0; i < sampleN; i++) {
        const cLat = JP_BBOX.latMin + rng() * (JP_BBOX.latMax - JP_BBOX.latMin);
        const cLng = JP_BBOX.lngMin + rng() * (JP_BBOX.lngMax - JP_BBOX.lngMin);
        const sampleTiles: SampleTile[] = [];

        for (const [t, off] of TILE_OFFSETS.entries()) {
          const p = renderParamsForLatLng(
            tileCenterLatLng({ lat: cLat, lng: cLng }, off.col, off.row),
          );

          setSampleProgress(
            `sample ${i + 1}/${sampleN} · tile ${t + 1}/9 (col=${off.col}, row=${off.row}) · ${cLat.toFixed(4)}, ${cLng.toFixed(4)}`,
          );

          setBatchParams(p);
          await nextFrame();
          await scn.waitForSettled({ settleMs: 600, timeoutMs: 20000 }).catch((e) => {
            console.warn('[samples] settle warn', e);
          });

          const dataUrl = scn.capture();
          if (!dataUrl)
            throw new Error(`capture returned null at sample ${i} tile (${off.col},${off.row})`);
          const blob = await dataUrlToBlob(dataUrl);

          const tileName = `c${off.col}_r${off.row}.png`;
          const key = `${folderRoot}/sample${i}/${tileName}`;
          const fd = new FormData();
          fd.append('key', key);
          fd.append('png', blob, tileName);
          const res = await saveToKeyAction(fd);
          if (!res.ok) throw new Error(`save failed: ${res.error}`);
          doneFiles++;

          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          sampleTiles.push({ col: off.col, row: off.row, url, key });
        }

        results.push({ sampleIdx: i, centerLat: cLat, centerLng: cLng, tiles: sampleTiles });
        setSampleResults([...results]);
      }

      setSampleSummary(`done — ${doneFiles}/${totalFiles} files saved under ${folderRoot}`);
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : String(e));
    } finally {
      setSampleProgress(null);
      setBatchParams(null);
      setSampleRunning(false);
    }
  };

  if (!apiKey) {
    return (
      <div className="max-w-[520px] rounded-2xl border border-red-200 bg-red-50 p-6 text-[13px] leading-relaxed text-red-700">
        <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[12px]">
          GOOGLE_MAPS_API_KEY
        </code>{' '}
        is not set. Add it to the root <code className="font-mono">.env</code> and restart the dev
        server.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-4">
        <section className={`${CARD} w-[260px] shrink-0`}>
          <div className={`${SECTION_LABEL} mb-4`}>Camera</div>
          <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
            <Field label="lat" value={lat} onChange={setLat} step={0.0001} />
            <Field label="lng" value={lng} onChange={setLng} step={0.0001} />
            <Field label="pitch" value={pitch} onChange={setPitch} />
            <Field label="yaw" value={yaw} onChange={setYaw} />
            <Field label="size" value={size} onChange={setSize} step={1} />
            <Field label="zoom" value={zoom} onChange={setZoom} step={0.5} />
            <button
              type="button"
              disabled={sampleRunning}
              onClick={() => {
                const url = sceneRef.current?.capture();
                if (url) {
                  setCapturedUrl(url);
                  try {
                    localStorage.setItem('mapart:latest-capture', url);
                  } catch {
                    // quota exceeded or storage unavailable — ignore, capture still works in-memory
                  }
                }
              }}
              className={`${BTN_PRIMARY} mt-1 w-full`}
            >
              Capture
            </button>
          </form>
        </section>

        <section className={CARD}>
          <div className={`${SECTION_LABEL} mb-3`}>Live scene</div>
          <div
            className="overflow-hidden rounded-xl border border-stone-200 bg-stone-900"
            style={{ width: SCENE_DISPLAY, height: SCENE_DISPLAY }}
          >
            <div
              style={{
                transform: `scale(${SCENE_DISPLAY / activeParams.size})`,
                transformOrigin: 'top left',
              }}
            >
              <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
            </div>
          </div>
        </section>

        <section className={CARD}>
          <div className="mb-3 flex h-6 items-center justify-between gap-3">
            <span className={SECTION_LABEL}>Captured PNG</span>
            {capturedUrl && (
              <div className="flex gap-1.5">
                {saveAction && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (!capturedUrl) return;
                      setSaveError(null);
                      setSaveInfo(null);
                      setSaving(true);
                      try {
                        const result = await saveAction(capturedUrl, liveParams);
                        if (result.ok) setSaveInfo(`saved → ${result.key}`);
                        else setSaveError(result.error);
                      } catch (e) {
                        setSaveError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className={BTN_SECONDARY}
                  >
                    {saving ? 'saving…' : 'save'}
                  </button>
                )}
                <a
                  href={capturedUrl}
                  download={downloadFilename(liveParams)}
                  className={BTN_SECONDARY}
                >
                  download
                </a>
              </div>
            )}
          </div>
          <div
            className="flex items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-900"
            style={{ width: SCENE_DISPLAY, height: SCENE_DISPLAY }}
          >
            {capturedUrl ? (
              // biome-ignore lint/a11y/useAltText: debug surface
              <img
                src={capturedUrl}
                className="h-full w-full object-contain [image-rendering:pixelated]"
              />
            ) : (
              <div className="px-6 text-center text-[12px] text-stone-400">
                Press <span className="text-stone-300">Capture</span> once tiles have loaded
              </div>
            )}
          </div>
          {saveInfo && (
            <div className="mt-3 font-mono text-[12px] text-emerald-700">{saveInfo}</div>
          )}
          {saveError && (
            <pre className="m-0 mt-3 whitespace-pre-wrap text-[12px] text-red-700">{saveError}</pre>
          )}
        </section>
      </div>

      <section className={`${CARD} mt-4`}>
        <div className="mb-2 flex items-baseline gap-3">
          <div className={SECTION_LABEL}>Random samples</div>
          <span className="text-xs text-stone-400">João Pessoa</span>
        </div>
        <p className="m-0 mb-4 max-w-[68ch] text-[13px] leading-relaxed text-stone-500">
          Picks N random points in the JP bounding box and captures each + its 8 neighbours. Files
          land at{' '}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[12px] text-stone-700">
            renderer/samples/&lt;run&gt;/sampleN/c{'{'}col{'}'}_r{'{'}row{'}'}.png
          </code>
          . Tile framing uses the global render defaults.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[140px]">
            <Field
              label="N samples"
              value={sampleN}
              onChange={(n) => setSampleN(Math.max(1, Math.round(n)))}
              step={1}
            />
          </div>
          <div className="w-[140px]">
            <Field
              label="seed"
              value={sampleSeed}
              onChange={(n) => setSampleSeed(Math.round(n))}
              step={1}
            />
          </div>
          <button
            type="button"
            onClick={runRandomSamples}
            disabled={sampleRunning || !saveToKeyAction}
            className={`${BTN_PRIMARY} px-6`}
          >
            {sampleRunning ? 'rendering…' : 'Render random samples'}
          </button>
        </div>
        {sampleProgress && (
          <div className="mt-3 inline-block rounded-lg bg-stone-50 px-3 py-1.5 font-mono text-[12px] text-stone-600">
            {sampleProgress}
          </div>
        )}
        {sampleError && (
          <pre className="m-0 mt-3 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-[12px] text-red-700">
            {sampleError}
          </pre>
        )}
        {sampleSummary && (
          <div className="mt-3 font-mono text-[12px] text-emerald-700">{sampleSummary}</div>
        )}
      </section>

      {sampleResults.length > 0 && (
        <section className="mt-8">
          <div className={`${SECTION_LABEL} mb-4`}>Rendered samples</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {sampleResults.map((s) => (
              <div key={s.sampleIdx} className={`${CARD} p-3`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-stone-700">
                    sample {s.sampleIdx}
                  </span>
                  <span className={PILL}>
                    {s.centerLat.toFixed(4)}, {s.centerLng.toFixed(4)}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-stone-200">
                  <TileGrid3x3 tiles={s.tiles} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function downloadFilename(p: RenderParams): string {
  const round = (n: number, d = 4) => n.toFixed(d).replace(/\.?0+$/, '');
  return `mapart_${round(p.center.lat)}_${round(p.center.lng)}_p${Math.round(p.pitch)}_y${Math.round(p.yaw)}_z${round(p.zoom, 2)}_${p.size}.png`;
}
