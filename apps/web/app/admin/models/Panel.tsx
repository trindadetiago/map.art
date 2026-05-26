'use client';

import type { ModelName } from '@mapart/models';
import { useEffect, useState, useTransition } from 'react';

const LATEST_CAPTURE_KEY = 'mapart:latest-capture';

const DEFAULT_PROMPT = `Redraw this aerial photo as a SimCity 2000 / RollerCoaster Tycoon style isometric pixel-art sprite.
- Chunky 2-4 pixel blocks, hard pixel edges.
- Limited palette of 16-24 colors, warm and muted.
- Bold black outlines around buildings, roads, and structures.
- Flat shading with simple highlights and cast shadows.
- Simplify silhouettes aggressively — do NOT preserve photorealistic textures.
- Keep the isometric perspective and overall layout of buildings and streets.
- Final output must be crisp pixel-art, not a photorealistic render.`;

export interface ActionResult {
  ok: true;
  outputDataUrl: string;
  durationMs: number;
  model: string;
  textResponse?: string;
}

export interface ActionError {
  ok: false;
  error: string;
}

export interface SaveResult {
  ok: true;
  key: string;
}
export interface SaveError {
  ok: false;
  error: string;
}

export interface ModelsPanelProps {
  availableModels: readonly ModelName[];
  runAction: (formData: FormData) => Promise<ActionResult | ActionError>;
  saveAction?: (
    dataUrl: string,
    meta: { model: string; prompt: string },
  ) => Promise<SaveResult | SaveError>;
}

export function ModelsPanel({ availableModels, runAction, saveAction }: ModelsPanelProps) {
  const [pending, startTransition] = useTransition();

  const [model, setModel] = useState<ModelName>(availableModels[0] ?? 'stub');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [seed, setSeed] = useState<number | ''>('');
  const [inputDataUrl, setInputDataUrl] = useState<string | null>(null);
  const [outputDataUrl, setOutputDataUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [textResponse, setTextResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LATEST_CAPTURE_KEY);
    if (stored && !inputDataUrl) setInputDataUrl(stored);
  }, [inputDataUrl]);

  const onPickFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setInputDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const run = () => {
    if (!inputDataUrl) {
      setError('Pick an input image first.');
      return;
    }
    setError(null);
    setInfo(null);
    setTextResponse(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('model', model);
        fd.set('prompt', prompt);
        fd.set('inputDataUrl', inputDataUrl);
        if (seed !== '') fd.set('seed', String(seed));
        const result = await runAction(fd);
        if ('ok' in result && result.ok) {
          setOutputDataUrl(result.outputDataUrl);
          setInfo(`${result.model} · ${result.durationMs}ms`);
          setTextResponse(result.textResponse ?? null);
        } else {
          setError(result.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 1fr', gap: 24 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelName)}
            style={{ padding: 4 }}
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            style={{ fontFamily: 'inherit', fontSize: 13, padding: 6 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>seed (optional)</span>
          <input
            type="number"
            value={seed}
            onChange={(e) =>
              setSeed(e.target.value === '' ? '' : Number.parseInt(e.target.value, 10))
            }
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13 }}>input PNG</span>
          <input
            type="file"
            accept="image/png"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPickFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => {
              const stored = localStorage.getItem(LATEST_CAPTURE_KEY);
              if (stored) setInputDataUrl(stored);
              else setError('No capture in localStorage yet.');
            }}
            style={{ marginTop: 4 }}
          >
            use latest renderer capture
          </button>
        </label>

        <button type="submit" disabled={pending || !inputDataUrl} style={{ marginTop: 8 }}>
          {pending ? 'generating…' : 'generate'}
        </button>

        {info && <div style={{ fontSize: 12, opacity: 0.7 }}>{info}</div>}
        {error && (
          <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12 }}>{error}</pre>
        )}
      </form>

      <div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>input</div>
        {inputDataUrl ? (
          // biome-ignore lint/a11y/useAltText: debug surface
          <img
            src={inputDataUrl}
            style={{
              maxWidth: '100%',
              border: '1px solid #ccc',
              imageRendering: 'pixelated',
            }}
          />
        ) : (
          <div style={{ opacity: 0.5 }}>no input selected</div>
        )}
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
          <span style={{ fontSize: 12, opacity: 0.6 }}>output</span>
          {outputDataUrl && saveAction && (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaveInfo(null);
                setSaveError(null);
                setSaving(true);
                try {
                  const result = await saveAction(outputDataUrl, { model, prompt });
                  if (result.ok) setSaveInfo(`saved → ${result.key}`);
                  else setSaveError(result.error);
                } catch (e) {
                  setSaveError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSaving(false);
                }
              }}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {saving ? 'saving…' : 'save'}
            </button>
          )}
        </div>
        {outputDataUrl ? (
          <>
            {/* biome-ignore lint/a11y/useAltText: debug surface */}
            <img
              src={outputDataUrl}
              style={{
                maxWidth: '100%',
                border: '1px solid #ccc',
                imageRendering: 'pixelated',
              }}
            />
            {textResponse && (
              <pre
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 4,
                  padding: 8,
                  whiteSpace: 'pre-wrap',
                  opacity: 0.85,
                }}
              >
                {textResponse}
              </pre>
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
          </>
        ) : (
          <div style={{ opacity: 0.5 }}>press generate</div>
        )}
      </div>
    </div>
  );
}
