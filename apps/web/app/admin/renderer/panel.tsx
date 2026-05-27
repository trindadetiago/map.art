'use client';

import { Scene, type SceneHandle } from '@mapart/scene';
import { type RenderParams, renderParamsForTile } from '@mapart/shared';
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
  const [sampleTileWorldMeters, setSampleTileWorldMeters] = useState(150);
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
          const p = renderParamsForTile(
            {
              centerLat: cLat,
              centerLng: cLng,
              cameraPitch: pitch,
              cameraYaw: yaw,
              tileWorldMeters: sampleTileWorldMeters,
              tilePixelSize: size,
            },
            off.col,
            off.row,
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
      <div className="text-red-700">
        <code>GOOGLE_MAPS_API_KEY</code> is not set. Add it to the root <code>.env</code> and
        restart the dev server.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-[320px_1fr_1fr] gap-6">
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-2">
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
            className="mt-2 cursor-pointer rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            capture
          </button>
        </form>
        <div>
          <div className="mb-1 text-xs opacity-60">live scene</div>
          <Scene ref={sceneRef} apiKey={apiKey} params={activeParams} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs opacity-60">captured PNG</span>
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
                    className="cursor-pointer rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? 'saving…' : 'save'}
                  </button>
                )}
                <a
                  href={capturedUrl}
                  download={downloadFilename(liveParams)}
                  className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-900 no-underline"
                >
                  download
                </a>
              </div>
            )}
          </div>
          {capturedUrl ? (
            // biome-ignore lint/a11y/useAltText: debug surface
            <img
              src={capturedUrl}
              width={size}
              height={size}
              className="max-w-full border border-neutral-300 [image-rendering:pixelated]"
            />
          ) : (
            <div className="opacity-50">press "capture" once tiles have loaded</div>
          )}
          {saveInfo && <div className="mt-1.5 font-mono text-xs opacity-75">{saveInfo}</div>}
          {saveError && (
            <pre className="mt-1.5 whitespace-pre-wrap text-xs text-red-700">{saveError}</pre>
          )}
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <h3 className="m-0 mb-2 text-[13px]">random samples (João Pessoa)</h3>
        <p className="m-0 mb-3 text-xs opacity-70">
          Picks N random points in the JP bounding box and captures each + its 8 neighbours. Files
          land at{' '}
          <code>
            renderer/samples/&lt;run&gt;/sampleN/c{'{'}col{'}'}_r{'{'}row{'}'}.png
          </code>
          . Tile framing uses the current pitch/yaw/size plus the tileWorldMeters field below.
        </p>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-end gap-3">
          <Field
            label="N samples"
            value={sampleN}
            onChange={(n) => setSampleN(Math.max(1, Math.round(n)))}
            step={1}
          />
          <Field
            label="seed"
            value={sampleSeed}
            onChange={(n) => setSampleSeed(Math.round(n))}
            step={1}
          />
          <Field
            label="tileWorldMeters"
            value={sampleTileWorldMeters}
            onChange={(n) => setSampleTileWorldMeters(Math.max(10, n))}
            step={5}
          />
          <button
            type="button"
            onClick={runRandomSamples}
            disabled={sampleRunning || !saveToKeyAction}
            className="cursor-pointer rounded border px-3.5 py-2 text-xs enabled:border-neutral-900 enabled:bg-neutral-900 enabled:text-white disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400"
          >
            {sampleRunning ? 'rendering…' : 'render random samples'}
          </button>
        </div>
        {sampleProgress && <div className="mt-2 font-mono text-xs">{sampleProgress}</div>}
        {sampleError && (
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-700">{sampleError}</pre>
        )}
        {sampleSummary && (
          <div className="mt-2 font-mono text-xs text-green-700">{sampleSummary}</div>
        )}
      </section>

      {sampleResults.length > 0 && (
        <section className="mt-4">
          <h3 className="m-0 mb-3 text-[13px]">rendered samples</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {sampleResults.map((s) => (
              <div key={s.sampleIdx} className="rounded-lg border border-neutral-200 p-3">
                <div className="mb-2 font-mono text-xs opacity-70">
                  sample {s.sampleIdx} · ({s.centerLat.toFixed(4)}, {s.centerLng.toFixed(4)})
                </div>
                <TileGrid3x3 tiles={s.tiles} />
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
