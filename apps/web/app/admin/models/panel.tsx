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
    <div className="grid grid-cols-[320px_1fr_1fr] gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-col gap-2.5"
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[13px]">model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ModelName)}
            className="p-1"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[13px]">prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="p-1.5 font-inherit text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[13px]">seed (optional)</span>
          <input
            type="number"
            value={seed}
            onChange={(e) =>
              setSeed(e.target.value === '' ? '' : Number.parseInt(e.target.value, 10))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[13px]">input PNG</span>
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
            className="mt-1"
          >
            use latest renderer capture
          </button>
        </label>

        <button type="submit" disabled={pending || !inputDataUrl} className="mt-2">
          {pending ? 'generating…' : 'generate'}
        </button>

        {info && <div className="text-xs opacity-70">{info}</div>}
        {error && <pre className="whitespace-pre-wrap text-xs text-red-600">{error}</pre>}
      </form>

      <div>
        <div className="mb-1 text-xs opacity-60">input</div>
        {inputDataUrl ? (
          // biome-ignore lint/a11y/useAltText: debug surface
          <img
            src={inputDataUrl}
            className="max-w-full border border-neutral-300 [image-rendering:pixelated]"
          />
        ) : (
          <div className="opacity-50">no input selected</div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs opacity-60">output</span>
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
              className="cursor-pointer rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50"
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
              className="max-w-full border border-neutral-300 [image-rendering:pixelated]"
            />
            {textResponse && (
              <pre className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-2 text-xs opacity-85">
                {textResponse}
              </pre>
            )}
            {saveInfo && <div className="mt-1.5 font-mono text-xs opacity-75">{saveInfo}</div>}
            {saveError && (
              <pre className="mt-1.5 whitespace-pre-wrap text-xs text-red-600">{saveError}</pre>
            )}
          </>
        ) : (
          <div className="opacity-50">press generate</div>
        )}
      </div>
    </div>
  );
}
