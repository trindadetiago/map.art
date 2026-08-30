import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { repos } from '@mapart/db';
import { createLogger } from '@mapart/logger';
import { getStorage, getVizStorage } from '@mapart/storage';
import sharp from 'sharp';
import { computeGeoAnchor } from './geo';
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
  // Source tiles come from the pipeline's bucket; the pyramid goes to the one
  // that is served publicly.
  const vizStorage = getVizStorage();

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

  // Download every tile to disk rather than holding it in memory: a large
  // project is thousands of tiles, and keeping every decoded buffer resident
  // would need gigabytes of RAM. Bounded concurrency caps the S3 connection
  // pool — firing every GET at once makes remote storage cancel requests (408).
  const srcDir = await mkdtemp(join(tmpdir(), `mapart-dzi-src-${projectId}-`));
  const stripsDir = await mkdtemp(join(tmpdir(), `mapart-dzi-strip-${projectId}-`));
  const outDir = await mkdtemp(join(tmpdir(), `mapart-dzi-out-${projectId}-`));
  let uploaded = 0;
  try {
    const placed = await mapLimit(present, STORAGE_CONCURRENCY, async (t) => {
      const key = tileImagePath(t, source);
      if (!key) throw new Error('unreachable: filtered for present image');
      const file = join(srcDir, `${t.x}_${t.y}${extname(key) || '.png'}`);
      await writeFile(file, await storage.get(key));
      return { x: t.x, y: t.y, file };
    });

    // All tiles share the fixed render/output size, so probing one fixes the
    // grid pitch for the whole project.
    const firstFile = placed[0];
    if (!firstFile) throw new Error('unreachable: present is non-empty');
    const probe = await sharp(firstFile.file).metadata();
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

    // Stitch in two passes to keep memory bounded. Compositing every tile in one
    // shot holds ~all inputs resident while dzsave renders a multi-gigapixel
    // canvas, which OOMs at a few thousand tiles. Instead build one full-width
    // strip per grid row (≤gridWidth inputs each) as a memory-mapped libvips
    // `.v`, then assemble the gridHeight strips into the pyramid — capping
    // concurrent inputs to dozens. Grid `y` increases northward but image rows
    // run top→down, so the row axis is inverted (highest `y` on top).
    const rowTiles = new Map<number, { left: number; file: string }[]>();
    for (const p of placed) {
      const imgRow = gridHeight - 1 - (p.y - minY);
      const list = rowTiles.get(imgRow) ?? [];
      list.push({ left: (p.x - minX) * sourceTileSize, file: p.file });
      rowTiles.set(imgRow, list);
    }

    const strips: { top: number; input: string }[] = [];
    for (const [imgRow, tilesInRow] of rowTiles) {
      const stripFile = join(stripsDir, `row_${imgRow}.v`);
      await sharp({
        create: {
          width,
          height: sourceTileSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
        limitInputPixels: false,
      })
        .composite(tilesInRow.map((t) => ({ input: t.file, left: t.left, top: 0 })))
        .toFile(stripFile);
      strips.push({ top: imgRow * sourceTileSize, input: stripFile });
    }

    // sharp appends `.dzi` + `_files` to this basename → `tiles.dzi` +
    // `tiles_files/`. The canvas far exceeds sharp's default megapixel guard.
    const dziBase = join(outDir, 'tiles');
    await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      limitInputPixels: false,
    })
      .composite(strips.map((s) => ({ input: s.input, left: 0, top: s.top })))
      .webp({ quality })
      .tile({ size: PYRAMID_TILE_SIZE, overlap: 0, layout: 'dz' })
      .toFile(dziBase);

    const prefix = vizPrefix(projectId);
    const files: string[] = [];
    for await (const filePath of walk(outDir)) files.push(filePath);
    // A pyramid is hundreds-to-thousands of small objects, so a sequential
    // upload to remote storage crawls — same bounded concurrency as the fetch.
    await mapLimit(files, STORAGE_CONCURRENCY, async (filePath) => {
      const rel = relative(outDir, filePath).split('\\').join('/');
      // tiles.dzi → viz/{pid}/tiles.dzi ; tiles_files/** → viz/{pid}/tiles_files/**
      await vizStorage.put(`${prefix}/${rel}`, await readFile(filePath));
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
      geo: computeGeoAnchor(tiles, minX, minY),
      generatedAt: new Date().toISOString(),
    };
    await vizStorage.put(vizMetadataKey(projectId), Buffer.from(JSON.stringify(metadata, null, 2)));
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
    await rm(srcDir, { recursive: true, force: true });
    await rm(stripsDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
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
