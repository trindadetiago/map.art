import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { MODEL_NAMES, type ModelName, getModel } from '@mapart/models';
import {
  type PipelineTileInput,
  type PipelineTileOutput,
  getStrategy,
  overlaySeams,
  stitchTiles,
  strategies,
} from '@mapart/pipeline';
import { getStorage } from '@mapart/storage';
import {
  PipelinePanel,
  type PipelineProject,
  type RenderedTileInfo,
  type StrategyRunError,
  type StrategyRunResult,
} from './Panel';

export const dynamic = 'force-dynamic';

const DEFAULT_PROMPT = [
  'Redraw this aerial photo as a SimCity 2000 / RollerCoaster Tycoon style isometric pixel-art sprite.',
  '- Chunky 2-4 pixel blocks, hard pixel edges.',
  '- Limited palette of 16-24 colors, warm and muted.',
  '- Bold black outlines around buildings, roads, and structures.',
  '- Flat shading with simple highlights and cast shadows.',
  '- Simplify silhouettes aggressively — do NOT preserve photorealistic textures.',
  '- Keep the isometric perspective and overall layout of buildings and streets.',
  '- Final output must be crisp pixel-art, not a photorealistic render.',
].join('\n');

function renderedKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/rendered/${col}_${row}.png`;
}
function generatedKey(projectId: string, strategyName: string, col: number, row: number): string {
  return `pipeline/${projectId}/generated/${strategyName}/${col}_${row}.png`;
}
function stitchedKey(projectId: string, strategyName: string, kind: 'plain' | 'seams'): string {
  return `pipeline/${projectId}/generated/${strategyName}/_stitched_${kind}.png`;
}
function storageUrl(key: string): string {
  return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function saveRenderedAction(
  fd: FormData,
): Promise<{ ok: true; url: string; storageKey: string } | { ok: false; error: string }> {
  'use server';
  try {
    const projectId = String(fd.get('projectId') ?? '');
    const colRaw = fd.get('col');
    const rowRaw = fd.get('row');
    const pngBlob = fd.get('png');
    if (!projectId) return { ok: false, error: 'missing projectId' };
    if (typeof colRaw !== 'string' || typeof rowRaw !== 'string') {
      return { ok: false, error: 'missing col/row' };
    }
    const col = Number.parseInt(colRaw, 10);
    const row = Number.parseInt(rowRaw, 10);
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      return { ok: false, error: 'invalid col/row' };
    }
    if (!(pngBlob instanceof Blob)) {
      return { ok: false, error: 'missing png blob' };
    }
    const buf = Buffer.from(await pngBlob.arrayBuffer());
    const key = renderedKey(projectId, col, row);
    await getStorage().put(key, buf);
    return { ok: true, url: storageUrl(key), storageKey: key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function listRenderedAction(projectId: string): Promise<RenderedTileInfo[]> {
  'use server';
  const entries = await getStorage().list(`pipeline/${projectId}/rendered`);
  const out: RenderedTileInfo[] = [];
  for (const e of entries) {
    // Keys look like `pipeline/{id}/rendered/{col}_{row}.png`
    const m = e.key.match(/\/rendered\/(-?\d+)_(-?\d+)\.png$/);
    if (!m || !m[1] || !m[2]) continue;
    out.push({
      col: Number.parseInt(m[1], 10),
      row: Number.parseInt(m[2], 10),
      storageKey: e.key,
      url: storageUrl(e.key),
    });
  }
  return out;
}

async function stitchRenderedAction(
  projectId: string,
): Promise<{ ok: true; stitchedUrl: string } | { ok: false; error: string }> {
  'use server';
  try {
    const project = await repos.getProjectById(projectId);
    if (!project) return { ok: false, error: 'project not found' };
    const storage = getStorage();
    const listed = await storage.list(`pipeline/${projectId}/rendered`);
    const tiles: Array<{ col: number; row: number; png: Buffer }> = [];
    for (const entry of listed) {
      const m = entry.key.match(/\/rendered\/(-?\d+)_(-?\d+)\.png$/);
      if (!m || !m[1] || !m[2]) continue;
      const col = Number.parseInt(m[1], 10);
      const row = Number.parseInt(m[2], 10);
      const png = await storage.get(entry.key);
      tiles.push({ col, row, png });
    }
    if (tiles.length === 0) return { ok: false, error: 'no rendered tiles yet' };
    const stitch = await stitchTiles(tiles, project.tilePixelSize);
    const key = `pipeline/${projectId}/rendered/_stitched.png`;
    await storage.put(key, stitch.image);
    return { ok: true, stitchedUrl: `${storageUrl(key)}?t=${Date.now()}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runStrategyAction(
  projectId: string,
  strategyName: string,
  modelName: string,
  prompt: string,
): Promise<StrategyRunResult | StrategyRunError> {
  'use server';
  try {
    const project = await repos.getProjectById(projectId);
    if (!project) return { ok: false, error: 'project not found' };
    const strategy = getStrategy(strategyName);
    if (!strategy) return { ok: false, error: `unknown strategy: ${strategyName}` };

    // Load rendered PNGs from storage.
    const storage = getStorage();
    const listed = await storage.list(`pipeline/${projectId}/rendered`);
    const inputs: PipelineTileInput[] = [];
    for (const entry of listed) {
      const m = entry.key.match(/\/rendered\/(-?\d+)_(-?\d+)\.png$/);
      if (!m || !m[1] || !m[2]) continue;
      const col = Number.parseInt(m[1], 10);
      const row = Number.parseInt(m[2], 10);
      const png = await storage.get(entry.key);
      inputs.push({ col, row, renderedPng: png });
    }
    if (inputs.length === 0) {
      return { ok: false, error: 'no rendered tiles — run Phase 1 first' };
    }

    // Model client
    const apiKey = env.geminiApiKey;
    if (modelName !== 'stub' && !apiKey) {
      return { ok: false, error: 'GEMINI_API_KEY missing; only stub works without it' };
    }
    const model = getModel(modelName as ModelName, apiKey ? { apiKey } : {});

    console.log(
      `[pipeline] phase 2 — strategy=${strategyName} model=${modelName} tiles=${inputs.length}`,
    );
    const phaseStarted = Date.now();

    const outputs = await strategy.run(
      {
        project: {
          pitch: project.cameraPitch,
          yaw: project.cameraYaw,
          tileWorldMeters: project.tileWorldMeters,
          tilePixelSize: project.tilePixelSize,
        },
        tiles: inputs,
        prompt,
      },
      model,
    );

    console.log(
      `[pipeline] phase 2 done — ${outputs.length} tile(s) in ${Date.now() - phaseStarted}ms — stitching`,
    );

    // Persist outputs + stitch + seam overlay.
    for (const o of outputs) {
      await storage.put(generatedKey(projectId, strategyName, o.col, o.row), o.generatedPng);
    }
    const stitch = await stitchTiles(
      outputs.map((o) => ({ col: o.col, row: o.row, png: o.generatedPng })),
      project.tilePixelSize,
    );
    const seams = await overlaySeams(stitch);
    const plainKey = stitchedKey(projectId, strategyName, 'plain');
    const seamsKey = stitchedKey(projectId, strategyName, 'seams');
    await storage.put(plainKey, stitch.image);
    await storage.put(seamsKey, seams);

    return {
      ok: true,
      tiles: outputs.map((o: PipelineTileOutput) => ({
        col: o.col,
        row: o.row,
        url: storageUrl(generatedKey(projectId, strategyName, o.col, o.row)),
        metadata: o.metadata,
      })),
      stitchedUrl: `${storageUrl(plainKey)}?t=${Date.now()}`,
      seamOverlayUrl: `${storageUrl(seamsKey)}?t=${Date.now()}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function PipelineDebugPage() {
  const dbProjects = await repos.listProjects();
  const projects: PipelineProject[] = dbProjects.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    centerLat: p.centerLat,
    centerLng: p.centerLng,
    cameraPitch: p.cameraPitch,
    cameraYaw: p.cameraYaw,
    tileWorldMeters: p.tileWorldMeters,
    tilePixelSize: p.tilePixelSize,
  }));

  // Models — include stub always; include Gemini variants only if we have a key.
  const availableModels = env.geminiApiKey
    ? [...MODEL_NAMES]
    : MODEL_NAMES.filter((m) => m === 'stub');

  const strategyDescriptors = strategies.map((s) => ({
    name: s.name,
    description: s.description,
  }));

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>pipeline</h1>
      <p style={{ opacity: 0.7, maxWidth: 720 }}>
        Research harness for generation strategies. Phase 1 renders N tiles of a project to disk.
        Phase 2 runs a <code>GenerationStrategy</code> against those rendered tiles and shows the
        stitched result with an optional seam overlay.
      </p>
      {projects.length === 0 ? (
        <div style={{ opacity: 0.6 }}>
          No projects yet. Create one via <code>pnpm -w run db projects create-rect ...</code>{' '}
          first.
        </div>
      ) : (
        <PipelinePanel
          apiKey={env.googleMapsApiKey ?? ''}
          projects={projects}
          strategies={strategyDescriptors}
          availableModels={availableModels}
          defaultPrompt={DEFAULT_PROMPT}
          saveRenderedAction={saveRenderedAction}
          listRenderedAction={listRenderedAction}
          stitchRenderedAction={stitchRenderedAction}
          runStrategyAction={runStrategyAction}
        />
      )}
    </div>
  );
}
