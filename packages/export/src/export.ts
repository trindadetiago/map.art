import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { repos } from '@mapart/db';
import { createLogger } from '@mapart/logger';
import { getStorage } from '@mapart/storage';
import sharp from 'sharp';
import { vizDziKey, vizMetadataKey, vizPrefix } from './keys';
import type { ExportResult, VizMetadata, VizSource } from './types';

const log = createLogger('export');

/** Pyramid tile edge. 512px is the OpenSeadragon/DZI default. */
const PYRAMID_TILE_SIZE = 512;

/** Max inflight storage requests. Caps the S3 connection pool so remote storage
 * doesn't start cancelling requests under a thundering herd of GETs/PUTs. */
const STORAGE_CONCURRENCY = 16;

export interface ExportOptions {
  /** Which per-tile image to stitch. Defaults to the final stylized output. */
  source?: VizSource;
  /** Pyramid tile quality (WebP). Defaults to 90. */
  quality?: number;
}

function tileImagePath(
  tile: { stylizedImgPath: string | null; renderedImgPath: string | null },
  source: VizSource,
): string | null {
  return source === 'stylized' ? tile.stylizedImgPath : tile.renderedImgPath;
}

/**
 * Stitch a project's per-tile images into one raster, slice it into a DZI/WebP
 * pyramid, and upload the pyramid + descriptor + metadata to storage under
 * `viz/{projectId}/`. Returns once everything is uploaded.
 *
 * Tiles are placed on a plain grid at `(x - minX, y - minY) * sourceTileSize`.
 * A tile with no image for the chosen `source` is left as a transparent gap.
 */
export async function exportProjectDzi(
  projectId: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const source = opts.source ?? 'stylized';
  const quality = opts.quality ?? 90;
  const storage = getStorage();

  const tiles = await repos.tilesByProject(projectId);
  const present = tiles.filter((t) => tileImagePath(t, source) !== null);
  if (present.length === 0) {
    throw new Error(
      `No ${source} tiles for project ${projectId} — nothing to export. ` +
        `Run the ${source === 'stylized' ? 'stylize' : 'render'} pipeline first.`,
    );
  }
  const skipped = tiles.length - present.length;

  // Grid extent → canvas size. The grid is anchored at its own min, so a project
  // whose tiles don't start at (0,0) still produces a tight raster.
  const minX = Math.min(...present.map((t) => t.x));
  const minY = Math.min(...present.map((t) => t.y));
  const gridWidth = Math.max(...present.map((t) => t.x)) - minX + 1;
  const gridHeight = Math.max(...present.map((t) => t.y)) - minY + 1;

  // Fetch every tile image. All tiles share the fixed render/output size, so
  // probing the first one fixes the grid pitch for the whole project. Bounded
  // concurrency: firing every GET at once saturates the S3 connection pool and
  // remote storage starts cancelling requests (408), so cap inflight requests.
  const fetched = await mapLimit(present, STORAGE_CONCURRENCY, async (t) => {
    const key = tileImagePath(t, source);
    if (!key) throw new Error('unreachable: filtered for present image');
    return { x: t.x, y: t.y, buf: await storage.get(key) };
  });

  const first = fetched[0];
  if (!first) throw new Error('unreachable: present is non-empty');
  const probe = await sharp(first.buf).metadata();
  const sourceTileSize = probe.width ?? probe.height ?? 0;
  if (!sourceTileSize) throw new Error('Could not read source tile dimensions');

  const width = gridWidth * sourceTileSize;
  const height = gridHeight * sourceTileSize;
  log.info('stitching project pyramid', {
    projectId,
    source,
    placed: present.length,
    skipped,
    gridWidth,
    gridHeight,
    width,
    height,
  });

  // Every tile shares the fixed render/output size, so they slot onto the grid
  // verbatim — no per-tile resampling, which would only soften the pixel art.
  // Grid `y` increases northward, but image rows run top→down, so the row axis
  // is inverted (highest `y` at the top) to keep the map the right way up.
  const composites = fetched.map((f) => ({
    input: f.buf,
    left: (f.x - minX) * sourceTileSize,
    top: (gridHeight - 1 - (f.y - minY)) * sourceTileSize,
  }));

  // sharp/libvips writes the pyramid to disk only, so slice into a temp dir,
  // then upload every file and clean up. The stitched canvas easily exceeds
  // sharp's default megapixel guard, so lift it; composite straight into the
  // tiler to avoid materialising a full-size intermediate raster.
  const workDir = await mkdtemp(join(tmpdir(), `mapart-dzi-${projectId}-`));
  // sharp appends `.dzi` + `_files` to this basename → `tiles.dzi` + `tiles_files/`.
  const dziBase = join(workDir, 'tiles');
  let uploaded = 0;
  try {
    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      limitInputPixels: false,
    })
      .composite(composites)
      .webp({ quality })
      .tile({ size: PYRAMID_TILE_SIZE, overlap: 0, layout: 'dz' })
      .toFile(dziBase);

    const prefix = vizPrefix(projectId);
    const files: string[] = [];
    for await (const filePath of walk(workDir)) files.push(filePath);
    // Same bounded concurrency as the fetch — a pyramid is hundreds-to-thousands
    // of small objects, so a sequential upload to remote storage crawls.
    await mapLimit(files, STORAGE_CONCURRENCY, async (filePath) => {
      const rel = relative(workDir, filePath).split('\\').join('/');
      // tiles.dzi → viz/{pid}/tiles.dzi ; tiles_files/** → viz/{pid}/tiles_files/**
      await storage.put(`${prefix}/${rel}`, await readFile(filePath));
    });
    uploaded = files.length;

    const metadata: VizMetadata = {
      projectId,
      width,
      height,
      tileSize: PYRAMID_TILE_SIZE,
      overlap: 0,
      format: 'webp',
      gridWidth,
      gridHeight,
      sourceTileSize,
      source,
      generatedAt: new Date().toISOString(),
    };
    await storage.put(vizMetadataKey(projectId), Buffer.from(JSON.stringify(metadata, null, 2)));
    uploaded++;

    log.info('pyramid uploaded', { projectId, uploaded, dzi: vizDziKey(projectId) });
    return {
      projectId,
      source,
      placed: present.length,
      skipped,
      width,
      height,
      uploaded,
      prefix,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Map over `items` with at most `limit` calls inflight, preserving order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Yield every file path under `dir`, recursively. */
async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
