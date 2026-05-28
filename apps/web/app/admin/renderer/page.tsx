import { env } from '@mapart/env';
import type { RenderParams } from '@mapart/renderer';
import { getStorage } from '@mapart/storage';
import { RendererPanel, type SaveError, type SaveResult } from './panel';

async function saveAction(dataUrl: string, params: RenderParams): Promise<SaveResult | SaveError> {
  'use server';
  try {
    if (!dataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'Invalid image data.' };
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    const key = renderCaptureKey(params);
    await getStorage().put(key, buf);
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Save with a caller-supplied key (no auto-naming). Accepts FormData with
// `key` + `png` (Blob) fields to dodge Next.js Server Actions' string-arg
// size cap — base64 dataURLs of 1024² PNGs trip "Maximum array nesting
// exceeded" on serialization. Restricted to the `renderer/samples/` prefix.
async function saveToKeyAction(fd: FormData): Promise<SaveResult | SaveError> {
  'use server';
  try {
    const key = String(fd.get('key') ?? '');
    const png = fd.get('png');
    if (!key.startsWith('renderer/samples/')) {
      return { ok: false, error: `key must start with 'renderer/samples/', got ${key}` };
    }
    if (key.includes('..')) {
      return { ok: false, error: 'key contains illegal path traversal' };
    }
    if (!(png instanceof Blob)) {
      return { ok: false, error: 'png blob missing from FormData' };
    }
    const buf = Buffer.from(await png.arrayBuffer());
    await getStorage().put(key, buf);
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function renderCaptureKey(p: RenderParams): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const round = (n: number, d = 4) => n.toFixed(d).replace(/\.?0+$/, '');
  return `renderer/${iso}_${round(p.center.lat)}_${round(p.center.lng)}_p${Math.round(p.pitch)}_y${Math.round(p.yaw)}_z${round(p.zoom, 2)}_${p.size}.png`;
}

export default function RendererDebugPage() {
  const apiKey = env.googleMapsApiKey ?? '';
  return (
    <div>
      <div className="mb-8 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Renderer</h1>
        <span className="text-sm text-stone-500">
          {apiKey ? 'Google Photorealistic 3D Tiles' : 'GOOGLE_MAPS_API_KEY not set'}
        </span>
        {!apiKey && (
          <span className="ml-auto rounded-full border border-red-200 bg-red-50 px-3 py-1 text-[11px] text-red-700">
            scene will not load
          </span>
        )}
      </div>
      <p className="mb-8 max-w-[640px] text-[13px] leading-relaxed text-stone-500">
        Live Three.js scene streaming Google Photorealistic 3D Tiles. Adjust params, wait for tiles
        to stream in, then <strong className="font-medium text-stone-700">capture</strong> to grab
        the canvas as a PNG. Use <strong className="font-medium text-stone-700">save</strong> to
        persist into <code className="font-mono">/admin/storage</code>.
      </p>
      <RendererPanel apiKey={apiKey} saveAction={saveAction} saveToKeyAction={saveToKeyAction} />
    </div>
  );
}
