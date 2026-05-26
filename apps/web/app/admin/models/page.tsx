import { env } from '@mapart/env';
import { MODEL_NAMES, type ModelName, getModel } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import {
  type ActionError,
  type ActionResult,
  ModelsPanel,
  type SaveError,
  type SaveResult,
} from './panel';

async function runAction(formData: FormData): Promise<ActionResult | ActionError> {
  'use server';
  try {
    const modelName = String(formData.get('model') ?? 'gpt-image-1.5') as ModelName;
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

    if (!env.openaiApiKey) {
      return {
        ok: false,
        error: 'OPENAI_API_KEY is not set. Add it to the root .env and restart the dev server.',
      };
    }

    const model = getModel(modelName, { apiKey: env.openaiApiKey });
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
  const openaiAvailable = !!env.openaiApiKey;

  return (
    <div>
      <h1 className="mt-0">models</h1>
      <p className="max-w-[720px] opacity-70">
        Run an input PNG through an OpenAI image-edit model. Pick a model, supply a prompt, and the
        output PNG is resized back to the input dimensions so downstream code stays size-agnostic.{' '}
        {openaiAvailable ? null : (
          <span className="text-red-600">(OPENAI_API_KEY not set — calls will fail.)</span>
        )}
      </p>
      <ModelsPanel availableModels={MODEL_NAMES} runAction={runAction} saveAction={saveAction} />
    </div>
  );
}
