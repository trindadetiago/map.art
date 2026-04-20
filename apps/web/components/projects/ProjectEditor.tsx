'use client';

import dynamic from 'next/dynamic';
import { useState, useTransition } from 'react';
import { ProjectMap, type TileCoord } from './ProjectMap';

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

export interface ProjectEditorProps {
  projectId: string;
  apiKey: string;
  tiles: TileCoord[];
  initialCenterLat: number;
  initialCenterLng: number;
  initialPitch: number;
  initialYaw: number;
  initialTileWorldMeters: number;
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
}

export function ProjectEditor({
  projectId,
  apiKey,
  tiles,
  initialCenterLat,
  initialCenterLng,
  initialPitch,
  initialYaw,
  initialTileWorldMeters,
  saveAction,
}: ProjectEditorProps) {
  const [centerLat, setCenterLat] = useState(initialCenterLat);
  const [centerLng, setCenterLng] = useState(initialCenterLng);
  const [pitch, setPitch] = useState(initialPitch);
  const [yaw, setYaw] = useState(initialYaw);
  const [tileWorldMeters, setTileWorldMeters] = useState(initialTileWorldMeters);
  const [viewZoom, setViewZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panZ, setPanZ] = useState(0);
  const clampZoom = (v: number) => Math.max(0.25, Math.min(8, v));

  const [saved, setSaved] = useState({
    centerLat: initialCenterLat,
    centerLng: initialCenterLng,
    pitch: initialPitch,
    yaw: initialYaw,
    tileWorldMeters: initialTileWorldMeters,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    Math.abs(centerLat - saved.centerLat) > 1e-7 ||
    Math.abs(centerLng - saved.centerLng) > 1e-7 ||
    pitch !== saved.pitch ||
    yaw !== saved.yaw ||
    Math.abs(tileWorldMeters - saved.tileWorldMeters) > 0.01;

  const onSave = () => {
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      const result = await saveAction(projectId, {
        centerLat,
        centerLng,
        cameraPitch: pitch,
        cameraYaw: yaw,
        tileWorldMeters,
      });
      if (result.ok) {
        setSaved({ centerLat, centerLng, pitch, yaw, tileWorldMeters });
        setJustSaved(true);
      } else {
        setError(result.error);
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
    setError(null);
    setJustSaved(false);
  };

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
          drag the minimap to re-center · blue = {tiles.length} tiles in camera-frame grid
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
        <button type="button" onClick={onReset} disabled={!dirty || pending} style={secondaryBtn}>
          reset
        </button>
        <button type="button" onClick={onSave} disabled={!dirty || pending} style={primaryBtn}>
          {pending ? 'saving…' : 'save'}
        </button>
      </div>

      {error && (
        <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>
          {error}
        </pre>
      )}
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
