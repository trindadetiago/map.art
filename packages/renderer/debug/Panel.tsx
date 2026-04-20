'use client';

import type { RenderParams } from '@mapart/shared';
import { useRef, useState } from 'react';
import { Scene, type SceneHandle } from './Scene';

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
}

export function RendererPanel({ apiKey, saveAction }: RendererPanelProps) {
  const sceneRef = useRef<SceneHandle>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [lat, setLat] = useState(-7.115);
  const [lng, setLng] = useState(-34.861);
  const [pitch, setPitch] = useState(30);
  const [yaw, setYaw] = useState(45);
  const [size, setSize] = useState(512);
  const [zoom, setZoom] = useState(18);

  const params: RenderParams = {
    center: { lat, lng },
    pitch,
    yaw,
    size,
    zoom,
  };

  if (!apiKey) {
    return (
      <div style={{ color: 'crimson' }}>
        <code>GOOGLE_MAPS_API_KEY</code> is not set. Add it to the root <code>.env</code> and
        restart the dev server.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 1fr', gap: 24 }}>
      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <Field label="lat" value={lat} onChange={setLat} step={0.0001} />
        <Field label="lng" value={lng} onChange={setLng} step={0.0001} />
        <Field label="pitch" value={pitch} onChange={setPitch} />
        <Field label="yaw" value={yaw} onChange={setYaw} />
        <Field label="size" value={size} onChange={setSize} step={1} />
        <Field label="zoom" value={zoom} onChange={setZoom} step={0.5} />
        <button
          type="button"
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
          style={{ marginTop: 8 }}
        >
          capture
        </button>
      </form>
      <div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>live scene</div>
        <Scene ref={sceneRef} apiKey={apiKey} params={params} />
      </div>
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.6 }}>captured PNG</span>
          {capturedUrl && (
            <div style={{ display: 'flex', gap: 6 }}>
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
                      const result = await saveAction(capturedUrl, params);
                      if (result.ok) setSaveInfo(`saved → ${result.key}`);
                      else setSaveError(result.error);
                    } catch (e) {
                      setSaveError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  style={buttonStyle}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
              )}
              <a
                href={capturedUrl}
                download={downloadFilename(params)}
                style={{ ...buttonStyle, textDecoration: 'none', color: '#111' }}
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
            style={{
              border: '1px solid #ccc',
              imageRendering: 'pixelated',
              maxWidth: '100%',
            }}
          />
        ) : (
          <div style={{ opacity: 0.5 }}>press "capture" once tiles have loaded</div>
        )}
        {saveInfo && (
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, fontFamily: 'monospace' }}>
            {saveInfo}
          </div>
        )}
        {saveError && (
          <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }}>
            {saveError}
          </pre>
        )}
      </div>
    </div>
  );
}

const buttonStyle = {
  fontSize: 12,
  padding: '4px 10px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
} as const;

function downloadFilename(p: RenderParams): string {
  const round = (n: number, d = 4) => n.toFixed(d).replace(/\.?0+$/, '');
  return `mapart_${round(p.center.lat)}_${round(p.center.lng)}_p${Math.round(p.pitch)}_y${Math.round(p.yaw)}_z${round(p.zoom, 2)}_${p.size}.png`;
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
    </label>
  );
}
