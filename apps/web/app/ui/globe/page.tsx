'use client';

import { GLOBE_VARIANTS, type GlobeVariant } from '@mapart/globe';
import dynamic from 'next/dynamic';
import { type ReactNode, useEffect, useState } from 'react';
import { PageHeader } from '../_components/spec';

const Globe = dynamic(() => import('@mapart/globe/react').then((m) => m.Globe), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-full bg-stone-200/60" />,
});

const VARIANTS = Object.keys(GLOBE_VARIANTS) as GlobeVariant[];

export default function GlobePage() {
  const [variant, setVariant] = useState<GlobeVariant>('realistic');
  const [pixelSize, setPixelSize] = useState(6);
  const [oceanColor, setOceanColor] = useState(GLOBE_VARIANTS.realistic.palette.ocean);
  const [landColor, setLandColor] = useState(GLOBE_VARIANTS.realistic.palette.land);
  const [borderColor, setBorderColor] = useState(GLOBE_VARIANTS.realistic.palette.border);
  const [showBorders, setShowBorders] = useState(true);
  const [showAtmosphere, setShowAtmosphere] = useState(true);
  const [lit, setLit] = useState(true);
  const [ambient, setAmbient] = useState(GLOBE_VARIANTS.realistic.light.ambient);
  const [keyLight, setKeyLight] = useState(GLOBE_VARIANTS.realistic.light.key);
  const [interactive, setInteractive] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotateSpeed, setRotateSpeed] = useState(0.6);
  const [tilt, setTilt] = useState(23.5);

  // Switching variant resets the look controls to that variant's defaults.
  useEffect(() => {
    const v = GLOBE_VARIANTS[variant];
    setOceanColor(v.palette.ocean);
    setLandColor(v.palette.land);
    setBorderColor(v.palette.border);
    setShowBorders(v.texture.borderWidth > 0);
    setShowAtmosphere(v.atmosphere);
    setLit(v.lit);
    setAmbient(v.light.ambient);
    setKeyLight(v.light.key);
  }, [variant]);

  return (
    <div>
      <PageHeader
        title="Globe"
        description="A 3D globe built from real country geometry (world-atlas + d3-geo on a three.js sphere). Every control below is a prop on <Globe>."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
        <div className="rounded-2xl border border-stone-200/70 bg-white p-4">
          <div className="h-[440px] w-full">
            <Globe
              variant={variant}
              oceanColor={oceanColor}
              landColor={landColor}
              borderColor={borderColor}
              showBorders={showBorders}
              showAtmosphere={showAtmosphere}
              lit={lit}
              ambientIntensity={ambient}
              lightIntensity={keyLight}
              interactive={interactive}
              autoRotate={autoRotate}
              rotateSpeed={rotateSpeed}
              tilt={tilt}
              {...(variant === 'pixelated' ? { pixelSize } : {})}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="flex flex-col gap-5 rounded-2xl border border-stone-200/70 bg-white p-5">
          <Field label="Variant">
            <Segmented
              value={variant}
              onChange={setVariant}
              options={VARIANTS.map((v) => ({ value: v, label: GLOBE_VARIANTS[v].label }))}
            />
          </Field>

          {variant === 'pixelated' && (
            <Field label={`Pixel size · ${pixelSize}`}>
              <Range min={2} max={16} step={1} value={pixelSize} onChange={setPixelSize} />
            </Field>
          )}

          <Field label="Water">
            <ColorInput value={oceanColor} onChange={setOceanColor} />
          </Field>
          <Field label="Land">
            <ColorInput value={landColor} onChange={setLandColor} />
          </Field>

          <Field label="Contours">
            <Toggle checked={showBorders} onChange={setShowBorders} text="outline countries" />
            {showBorders && (
              <div className="mt-2">
                <ColorInput value={borderColor} onChange={setBorderColor} />
              </div>
            )}
          </Field>

          {variant !== 'pixelated' && (
            <Field label="Lighting">
              <Segmented
                value={lit ? 'directional' : 'even'}
                onChange={(v) => setLit(v === 'directional')}
                options={[
                  { value: 'even', label: 'Even' },
                  { value: 'directional', label: 'Directional' },
                ]}
              />
              {lit && (
                <div className="mt-2 flex flex-col gap-2">
                  <Range
                    label={`ambient · ${ambient.toFixed(2)}`}
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={ambient}
                    onChange={setAmbient}
                  />
                  <Range
                    label={`key light · ${keyLight.toFixed(2)}`}
                    min={0}
                    max={2.5}
                    step={0.05}
                    value={keyLight}
                    onChange={setKeyLight}
                  />
                </div>
              )}
            </Field>
          )}

          <Field label="Atmosphere">
            <Toggle checked={showAtmosphere} onChange={setShowAtmosphere} text="glow halo" />
          </Field>

          <Field label="Rotation">
            <Range
              label={`speed · ${rotateSpeed.toFixed(1)}`}
              min={0}
              max={3}
              step={0.1}
              value={rotateSpeed}
              onChange={setRotateSpeed}
            />
            <div className="mt-2">
              <Range
                label={`tilt · ${tilt.toFixed(0)}°`}
                min={-90}
                max={90}
                step={1}
                value={tilt}
                onChange={setTilt}
              />
            </div>
          </Field>

          <Field label="Interaction">
            <Toggle checked={interactive} onChange={setInteractive} text="drag to rotate" />
            <div className="mt-2">
              <Toggle checked={autoRotate} onChange={setAutoRotate} text="auto-spin" />
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-full border border-stone-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full px-3 py-1 text-[12px] transition ${
            value === o.value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 cursor-pointer rounded border border-stone-200 bg-white p-0.5"
      />
      <span className="font-mono text-[11px] text-stone-500">{value}</span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-stone-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-stone-900"
      />
      {text}
    </label>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="font-mono text-[10px] text-stone-400">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-stone-900"
      />
    </label>
  );
}
