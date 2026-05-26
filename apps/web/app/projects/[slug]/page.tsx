import { ProjectWorkspace } from '@/components/projects/project_workspace';
import type { SavedTile } from '@/components/projects/tile_renderer';
import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { type ModelName, getModel } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

function renderedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/rendered/${col}_${row}.png`;
}
function storageUrl(key: string): string {
  return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function saveTileAction(
  fd: FormData,
): Promise<
  | { ok: true; col: number; row: number; url: string; filename: string }
  | { ok: false; error: string }
> {
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
    const key = renderedTileKey(projectId, col, row);
    await getStorage().put(key, buf);
    await repos.createTileVersionAndSetCurrent({
      projectId,
      col,
      row,
      source: 'rendered',
      storageKey: key,
    });
    return {
      ok: true,
      col,
      row,
      url: storageUrl(key),
      filename: `${col}_${row}.png`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function generatedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/generated/manual/${col}_${row}.png`;
}

async function generateTileAction(
  projectId: string,
  col: number,
  row: number,
  prompt: string,
  modelName: ModelName,
): Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }> {
  'use server';
  try {
    if (!prompt.trim()) return { ok: false, error: 'prompt is empty' };
    const storage = getStorage();
    const renderedKey = renderedTileKey(projectId, col, row);
    if (!(await storage.has(renderedKey))) {
      return { ok: false, error: `rendered tile missing: ${renderedKey}` };
    }
    const input = await storage.get(renderedKey);
    const apiKey = modelName.startsWith('gpt-image') ? env.openaiApiKey : env.geminiApiKey;
    const model = getModel(modelName, apiKey ? { apiKey } : {});
    const result = await model.generate({ input, prompt });
    const key = generatedTileKey(projectId, col, row);
    await storage.put(key, result.image);
    await repos.createTileVersionAndSetCurrent({
      projectId,
      col,
      row,
      source: 'generated',
      storageKey: key,
      modelId: modelName,
      prompt,
      referenceStorageKey: renderedKey,
    });
    return { ok: true, url: storageUrl(key), filename: `${col}_${row}.png` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Smart infill: client built a 3×3 hybrid (centre = current render, surrounding
 * slots = generated neighbours or transparent) and a mask that's transparent
 * only over the centre tile. Model fills only the centre while seeing the
 * neighbourhood as context. We crop the centre back out and save.
 */
async function generateTileInfillAction(
  fd: FormData,
): Promise<{ ok: true; url: string; filename: string } | { ok: false; error: string }> {
  'use server';
  try {
    const projectId = String(fd.get('projectId') ?? '');
    const colRaw = fd.get('col');
    const rowRaw = fd.get('row');
    const prompt = String(fd.get('prompt') ?? '');
    const modelName = String(fd.get('modelName') ?? '') as ModelName;
    const slotSize = Number.parseInt(String(fd.get('slotSize') ?? ''), 10);
    const finalTileSize = Number.parseInt(String(fd.get('finalTileSize') ?? ''), 10);
    const hybrid = fd.get('hybrid');
    const mask = fd.get('mask');

    if (!projectId) return { ok: false, error: 'missing projectId' };
    if (!prompt.trim()) return { ok: false, error: 'empty prompt' };
    if (!Number.isFinite(slotSize) || slotSize <= 0) {
      return { ok: false, error: 'invalid slotSize' };
    }
    if (!Number.isFinite(finalTileSize) || finalTileSize <= 0) {
      return { ok: false, error: 'invalid finalTileSize' };
    }
    if (typeof colRaw !== 'string' || typeof rowRaw !== 'string') {
      return { ok: false, error: 'missing col/row' };
    }
    const col = Number.parseInt(colRaw, 10);
    const row = Number.parseInt(rowRaw, 10);
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      return { ok: false, error: 'invalid col/row' };
    }
    if (!(hybrid instanceof Blob) || !(mask instanceof Blob)) {
      return { ok: false, error: 'missing hybrid or mask blob' };
    }
    if (!modelName.startsWith('gpt-image')) {
      return {
        ok: false,
        error: `infill only supported for gpt-image-* (got ${modelName})`,
      };
    }

    const hybridBuf = Buffer.from(await hybrid.arrayBuffer());
    const maskBuf = Buffer.from(await mask.arrayBuffer());
    const storage = getStorage();

    // Diagnostic dump: persist exactly what we sent and exactly what the model
    // returned, so we can see whether the "zoom" comes from the model or from
    // the crop/resize math. Files land next to the saved tile.
    const debugBase = `pipeline/${projectId}/generated/manual/_debug/${col}_${row}`;
    await storage.put(`${debugBase}_hybrid.png`, hybridBuf);
    await storage.put(`${debugBase}_mask.png`, maskBuf);

    // Persist each of the 9 input slots as its own PNG (top-left → bottom-right,
    // so the centre tile is index 4). Lets the operator drop these into a manual
    // test rig outside this codebase. Lives at `<debugBase>_tiles/<idx>.png`.
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c;
        const slot = await sharp(hybridBuf)
          .extract({ left: c * slotSize, top: r * slotSize, width: slotSize, height: slotSize })
          .png()
          .toBuffer();
        await storage.put(`${debugBase}_tiles/${idx}.png`, slot);
      }
    }

    const apiKey = env.openaiApiKey;
    const model = getModel(modelName, apiKey ? { apiKey } : {});
    const result = await model.generate({ input: hybridBuf, mask: maskBuf, prompt });

    const hybridMeta = await sharp(hybridBuf).metadata();
    const hybridW = hybridMeta.width ?? 1024;
    const hybridH = hybridMeta.height ?? 1024;
    // _raw.png = post-resize (matches hybrid dims, used by the crop math).
    // _raw_native.png = exactly what OpenAI returned, before our adapter touches it.
    await storage.put(`${debugBase}_raw.png`, result.image);
    if (result.rawImage) {
      await storage.put(`${debugBase}_raw_native.png`, result.rawImage);
      const nativeMeta = await sharp(result.rawImage).metadata();
      console.log(
        `[infill] tile (${col},${row}) — sent ${hybridW}×${hybridH} (slot=${slotSize}), model native ${nativeMeta.width}×${nativeMeta.height}, post-resize ${hybridW}×${hybridH}`,
      );
    } else {
      const rawMeta = await sharp(result.image).metadata();
      console.log(
        `[infill] tile (${col},${row}) — sent ${hybridW}×${hybridH} (slot=${slotSize}), model returned ${rawMeta.width}×${rawMeta.height}`,
      );
    }

    // Crop at the SAME coords we used to draw the rendered tile into the
    // hybrid canvas. If the model output isn't already at hybrid dims, scale
    // it to hybrid dims first so the slot coords line up — but normally the
    // adapter has already resized to input dims, so this is a no-op.
    const resultMeta = await sharp(result.image).metadata();
    const normalized =
      resultMeta.width === hybridW && resultMeta.height === hybridH
        ? result.image
        : await sharp(result.image).resize(hybridW, hybridH, { fit: 'fill' }).png().toBuffer();

    // Native crop at the exact slot coords — no resize. This is the model's
    // pixel output for the slot at its source resolution. Useful for sanity:
    // it should look like the centre of `_raw.png` at the same scale.
    const croppedNative = await sharp(normalized)
      .extract({ left: slotSize, top: slotSize, width: slotSize, height: slotSize })
      .png()
      .toBuffer();
    await storage.put(`${debugBase}_cropped_native.png`, croppedNative);

    const cropped = await sharp(croppedNative)
      .resize(finalTileSize, finalTileSize, { fit: 'fill' })
      .png()
      .toBuffer();
    await storage.put(`${debugBase}_cropped.png`, cropped);

    const key = generatedTileKey(projectId, col, row);
    await storage.put(key, cropped);
    await repos.createTileVersionAndSetCurrent({
      projectId,
      col,
      row,
      source: 'generated',
      storageKey: key,
      modelId: modelName,
      prompt,
      referenceStorageKey: renderedTileKey(projectId, col, row),
    });
    return { ok: true, url: storageUrl(key), filename: `${col}_${row}.png` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function listGeneratedTilesAction(projectId: string): Promise<SavedTile[]> {
  'use server';
  const entries = await getStorage().list(`pipeline/${projectId}/generated/manual`);
  const out: SavedTile[] = [];
  for (const e of entries) {
    const m = e.key.match(/\/manual\/(-?\d+)_(-?\d+)\.png$/);
    if (!m || !m[1] || !m[2]) continue;
    const col = Number.parseInt(m[1], 10);
    const row = Number.parseInt(m[2], 10);
    out.push({ col, row, url: storageUrl(e.key), filename: `${col}_${row}.png` });
  }
  return out;
}

async function listTilesAction(projectId: string): Promise<SavedTile[]> {
  'use server';
  const entries = await getStorage().list(`pipeline/${projectId}/rendered`);
  const out: SavedTile[] = [];
  for (const e of entries) {
    const m = e.key.match(/\/rendered\/(-?\d+)_(-?\d+)\.png$/);
    if (!m || !m[1] || !m[2]) continue;
    const col = Number.parseInt(m[1], 10);
    const row = Number.parseInt(m[2], 10);
    out.push({
      col,
      row,
      url: storageUrl(e.key),
      filename: `${col}_${row}.png`,
    });
  }
  return out;
}

async function saveAction(
  id: string,
  patch: {
    centerLat: number;
    centerLng: number;
    cameraPitch: number;
    cameraYaw: number;
    tileWorldMeters: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server';
  try {
    await repos.updateProject(id, patch);
    const project = await repos.getProjectById(id);
    revalidatePath('/projects');
    if (project) revalidatePath(`/projects/${project.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function reseedTilesAction(
  id: string,
  side: number,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  'use server';
  try {
    if (!Number.isInteger(side) || side < 1 || side > 201) {
      return { ok: false, error: 'side must be an integer between 1 and 201' };
    }
    const half = Math.floor(side / 2);
    const min = -half;
    const max = min + side - 1;
    const newTiles: { col: number; row: number }[] = [];
    for (let r = min; r <= max; r++) {
      for (let c = min; c <= max; c++) {
        newTiles.push({ col: c, row: r });
      }
    }
    await repos.reseedProjectTiles({ projectId: id, newTiles });
    const project = await repos.getProjectById(id);
    revalidatePath('/projects');
    if (project) revalidatePath(`/projects/${project.slug}`);
    return { ok: true, count: newTiles.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await repos.getProjectBySlug(slug);
  if (!project) notFound();

  const [tileCount, tiles] = await Promise.all([
    repos.countTilesForProject(project.id),
    repos.listTilesForProject(project.id, 10000),
  ]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{project.name}</h1>
        <code style={{ opacity: 0.5, fontSize: 14 }}>{project.slug}</code>
        <span style={{ flex: 1 }} />
        <Link href="/projects" style={{ fontSize: 13, color: '#6b7280' }}>
          ← all projects
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px minmax(0, 1fr)',
          gap: 24,
          marginTop: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={cardStyle}>
            <h3 style={h3}>project</h3>
            <KV label="status" value={project.status} />
            <KV label="default model" value={project.defaultModelId ?? '(none)'} />
          </section>
          <section style={cardStyle}>
            <h3 style={h3}>tile grid</h3>
            <KV label="count" value={String(tileCount)} />
            <KV
              label="tile size"
              value={`${project.tileWorldMeters}m / ${project.tilePixelSize}px`}
            />
            <KV
              label="center"
              value={`${project.centerLat.toFixed(4)}, ${project.centerLng.toFixed(4)}`}
            />
            <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8, marginBottom: 0 }}>
              Drag the minimap to re-center. Adjust pitch/yaw with sliders. Save persists to the
              project; tiles keep their <code>(col, row)</code> — they're camera-frame-aligned.
            </p>
          </section>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <ProjectWorkspace
            projectId={project.id}
            apiKey={env.googleMapsApiKey ?? ''}
            tiles={tiles}
            initialCenterLat={project.centerLat}
            initialCenterLng={project.centerLng}
            initialPitch={project.cameraPitch}
            initialYaw={project.cameraYaw}
            initialTileWorldMeters={project.tileWorldMeters}
            initialTilePixelSize={project.tilePixelSize}
            initialGridSide={currentGridSide(tiles)}
            saveAction={saveAction}
            reseedTilesAction={reseedTilesAction}
            saveTileAction={saveTileAction}
            listTilesAction={listTilesAction}
            generateTileAction={generateTileAction}
            generateTileInfillAction={generateTileInfillAction}
            listGeneratedTilesAction={listGeneratedTilesAction}
          />
        </div>
      </div>
    </div>
  );
}

function currentGridSide(tiles: ReadonlyArray<{ col: number; row: number }>): number {
  if (tiles.length === 0) return 1;
  let minC = Number.POSITIVE_INFINITY;
  let maxC = Number.NEGATIVE_INFINITY;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;
  for (const t of tiles) {
    if (t.col < minC) minC = t.col;
    if (t.col > maxC) maxC = t.col;
    if (t.row < minR) minR = t.row;
    if (t.row > maxR) maxR = t.row;
  }
  return Math.max(maxC - minC + 1, maxR - minR + 1);
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '110px 1fr', fontSize: 13, padding: '3px 0' }}
    >
      <span style={{ fontFamily: 'monospace', opacity: 0.6 }}>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

const cardStyle = { padding: 16, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8 };
const h3 = {
  margin: 0,
  marginBottom: 8,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.5,
};
