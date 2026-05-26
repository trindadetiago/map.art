import { env } from '@mapart/env';
import { MODEL_NAMES, type ModelName, getModel } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import {
  type ActionError,
  type ActionResult,
  ModelsPanel,
  type SaveError,
  type SaveResult,
} from './Panel';

async function runAction(formData: FormData): Promise<ActionResult | ActionError> {
  'use server';
  try {
    const modelName = String(formData.get('model') ?? 'stub') as ModelName;
    const prompt = String(formData.get('prompt') ?? '');
    const inputDataUrl = String(formData.get('inputDataUrl') ?? '');
    const seedRaw = formData.get('seed');
    const seed =
      seedRaw === null || seedRaw === '' ? undefined : Number.parseInt(String(seedRaw), 10);

    if (!inputDataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'Missing or invalid input image.' };
    }
    const base64 = inputDataUrl.slice(inputDataUrl.indexOf(',') + 1);
    const input = Buffer.from(base64, 'base64');

    const needsGemini = modelName !== 'stub';
    if (needsGemini && !env.geminiApiKey) {
      return {
        ok: false,
        error: 'GEMINI_API_KEY is not set. Add it to the root .env and restart the dev server.',
      };
    }

    const model = getModel(modelName, env.geminiApiKey ? { apiKey: env.geminiApiKey } : {});
    const result = await model.generate({
      input,
      prompt,
      ...(seed === undefined ? {} : { seed }),
    });

    return {
      ok: true,
      outputDataUrl: `data:image/png;base64,${result.image.toString('base64')}`,
      durationMs: result.metadata.durationMs,
      model: result.metadata.model,
      ...(result.metadata.textResponse === undefined
        ? {}
        : { textResponse: result.metadata.textResponse }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function saveAction(
  dataUrl: string,
  meta: { model: string; prompt: string },
): Promise<SaveResult | SaveError> {
  'use server';
  try {
    if (!dataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'Invalid image data.' };
    }
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(base64, 'base64');
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `models/${meta.model}/${iso}.png`;
    await getStorage().put(key, buf);
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default function ModelsDebugPage() {
  const geminiAvailable = !!env.geminiApiKey;
  const availableModels = geminiAvailable ? MODEL_NAMES : MODEL_NAMES.filter((m) => m === 'stub');

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>models</h1>
      <p style={{ opacity: 0.7, maxWidth: 720 }}>
        Run an input PNG through a model. <strong>stub</strong> = pixelate + hue shift (no API
        call). <strong>nano-banana</strong> = Gemini 2.5 Flash Image (fast, cheap).{' '}
        <strong>nano-banana-pro</strong> = Gemini 3 Pro Image Preview (higher quality, slower,
        pricier — what Cannon Eyed used). <strong>gemini-3.1-flash-image</strong> = newer Flash
        variant.{' '}
        {geminiAvailable ? null : (
          <span style={{ color: 'crimson' }}>
            (GEMINI_API_KEY not set — only stub is available.)
          </span>
        )}
      </p>
      <ModelsPanel
        availableModels={availableModels}
        runAction={runAction}
        saveAction={saveAction}
      />
    </div>
  );
}
