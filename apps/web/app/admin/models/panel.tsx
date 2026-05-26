'use client';

import { Select, type SelectOption } from '@/components/admin/select';
import type { ModelName } from '@mapart/models';
import { useEffect, useRef, useState, useTransition } from 'react';

const LATEST_CAPTURE_KEY = 'mapart:latest-capture';

const DEFAULT_PROMPT = `Redraw this aerial photo as a SimCity 2000 / RollerCoaster Tycoon style isometric pixel-art sprite.
- Chunky 2-4 pixel blocks, hard pixel edges.
- Limited palette of 16-24 colors, warm and muted.
- Bold black outlines around buildings, roads, and structures.
- Flat shading with simple highlights and cast shadows.
- Simplify silhouettes aggressively — do NOT preserve photorealistic textures.
- Keep the isometric perspective and overall layout of buildings and streets.
- Final output must be crisp pixel-art, not a photorealistic render.`;

const MODEL_DESCRIPTIONS: Record<ModelName, string> = {
  'gpt-image-1.5': 'OpenAI · current default',
  'gpt-image-2': 'OpenAI · newer, may not be GA yet',
};

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

const CARD = 'rounded-2xl border border-stone-200/70 bg-white p-6';
const SECTION_LABEL = 'text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500 mb-4';

export function ModelsPanel({ availableModels, runAction, saveAction }: ModelsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [model, setModel] = useState<ModelName>(availableModels[0] ?? 'gpt-image-1.5');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [seed, setSeed] = useState<number | ''>('');
  const [inputDataUrl, setInputDataUrl] = useState<string | null>(null);
  const [inputName, setInputName] = useState<string | null>(null);
  const [outputDataUrl, setOutputDataUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [textResponse, setTextResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LATEST_CAPTURE_KEY);
    if (stored && !inputDataUrl) {
      setInputDataUrl(stored);
      setInputName('latest renderer capture');
    }
  }, [inputDataUrl]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setInputDataUrl(reader.result);
        setInputName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleFile(file);
  };

  const run = () => {
    if (!inputDataUrl) {
      setError('Pick an input image first.');
      return;
    }
    setError(null);
    setInfo(null);
    setTextResponse(null);
    setSaveInfo(null);
    setSaveError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('model', model);
        fd.set('prompt', prompt);
        fd.set('inputDataUrl', inputDataUrl);
        if (seed !== '') fd.set('seed', String(seed));
        const result = await runAction(fd);
        if (result.ok) {
          setOutputDataUrl(result.outputDataUrl);
          setInfo(`${result.model} · ${(result.durationMs / 1000).toFixed(1)}s`);
          setTextResponse(result.textResponse ?? null);
        } else {
          setError(result.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const onSave = async () => {
    if (!outputDataUrl || !saveAction) return;
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
  };

  const modelOptions: SelectOption<ModelName>[] = availableModels.map((m) => ({
    value: m,
    label: m,
    description: MODEL_DESCRIPTIONS[m] ?? 'OpenAI image-edit',
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Settings */}
        <section className={CARD}>
          <div className={SECTION_LABEL}>Settings</div>
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Select
              label="Model"
              value={model}
              onValueChange={(v) => setModel(v)}
              options={modelOptions}
            />
            <FieldWrapper label="Seed">
              <input
                type="number"
                value={seed}
                onChange={(e) =>
                  setSeed(e.target.value === '' ? '' : Number.parseInt(e.target.value, 10))
                }
                placeholder="optional"
                className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-[13px] outline-none transition focus:border-stone-400"
              />
            </FieldWrapper>
          </div>
          <div className="mt-4">
            <FieldWrapper label="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={10}
                className="w-full resize-y rounded-lg border border-stone-200 bg-white p-3 font-mono text-[12px] leading-relaxed text-stone-800 outline-none transition focus:border-stone-400"
              />
            </FieldWrapper>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={pending || !inputDataUrl}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-stone-900 px-5 text-[13px] font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'generating…' : 'Generate'}
            {!pending && <span className="text-white/60">→</span>}
          </button>
          {error && (
            <pre className="m-0 mt-3 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-[12px] text-red-700">
              {error}
            </pre>
          )}
        </section>

        {/* Input */}
        <section className={CARD}>
          <div className="mb-4 flex items-baseline justify-between">
            <div className={`${SECTION_LABEL} m-0`}>Input</div>
            <button
              type="button"
              onClick={() => {
                const stored = localStorage.getItem(LATEST_CAPTURE_KEY);
                if (stored) {
                  setInputDataUrl(stored);
                  setInputName('latest renderer capture');
                } else {
                  setError('No capture in localStorage yet.');
                }
              }}
              className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] text-stone-700 transition hover:border-stone-400"
            >
              use latest capture
            </button>
          </div>

          {inputDataUrl ? (
            <div className="flex flex-col gap-3">
              {/* biome-ignore lint/a11y/useAltText: debug surface */}
              <img
                src={inputDataUrl}
                className="max-h-[360px] w-full rounded-lg border border-stone-200 bg-stone-50 object-contain [image-rendering:pixelated]"
              />
              <div className="flex items-center justify-between text-[12px]">
                <span className="truncate font-mono text-stone-500">{inputName ?? 'input'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setInputDataUrl(null);
                    setInputName(null);
                  }}
                  className="text-stone-400 underline-offset-2 transition hover:text-red-600 hover:underline"
                >
                  remove
                </button>
              </div>
            </div>
          ) : (
            <DropZone
              dragging={dragging}
              setDragging={setDragging}
              onDrop={onDrop}
              onPick={handleFile}
            />
          )}
        </section>
      </div>

      {/* Result */}
      {outputDataUrl && (
        <section className={CARD}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`${SECTION_LABEL} m-0`}>Result</div>
              {info && (
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 font-mono text-[11px] text-stone-600">
                  {info}
                </span>
              )}
            </div>
            {saveAction && (
              <button
                type="button"
                disabled={saving}
                onClick={onSave}
                className="rounded-full border border-stone-200 bg-white px-4 py-1.5 text-[12px] text-stone-700 transition hover:border-stone-400 disabled:opacity-50"
              >
                {saving ? 'saving…' : 'save to storage'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            {inputDataUrl && (
              // biome-ignore lint/a11y/useAltText: debug surface
              <img
                src={inputDataUrl}
                className="w-full rounded-lg border border-stone-200 bg-stone-50 [image-rendering:pixelated]"
              />
            )}
            <div className="text-stone-300">→</div>
            {/* biome-ignore lint/a11y/useAltText: debug surface */}
            <img
              src={outputDataUrl}
              className="w-full rounded-lg border border-stone-200 bg-stone-50 [image-rendering:pixelated]"
            />
          </div>

          {textResponse && (
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-stone-500">
                Text response
              </div>
              <pre className="m-0 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-[12px] leading-relaxed text-stone-700">
                {textResponse}
              </pre>
            </div>
          )}

          {saveInfo && (
            <div className="mt-3 font-mono text-[12px] text-emerald-700">{saveInfo}</div>
          )}
          {saveError && (
            <pre className="m-0 mt-3 whitespace-pre-wrap text-[12px] text-red-700">{saveError}</pre>
          )}
        </section>
      )}
    </div>
  );
}

function FieldWrapper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is passed in as children
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function DropZone({
  dragging,
  setDragging,
  onDrop,
  onPick,
}: {
  dragging: boolean;
  setDragging: (b: boolean) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${
        dragging ? 'border-stone-500 bg-stone-50' : 'border-stone-200 bg-stone-50/40'
      }`}
    >
      <div className="text-[13px] text-stone-600">Drop a PNG here</div>
      <div className="text-[11px] text-stone-400">or</div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-[12px] text-stone-700 transition hover:border-stone-500"
      >
        Choose file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
        }}
      />
    </div>
  );
}
