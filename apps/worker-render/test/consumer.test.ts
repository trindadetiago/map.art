import { closeDb, getDb } from '@mapart/db';
import {
  MAX_RETRIES,
  type TileCell,
  createProject,
  createProjectTiles,
  tilesByProject,
} from '@mapart/db/repos';
import { projects, tiles } from '@mapart/db/schema';
import { RENDER_DEFAULTS } from '@mapart/renderer';
import { type Storage, type StorageEntry, __setStorageForTests } from '@mapart/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type RenderRequest, renderKey, startRenderConsumer } from '../consumer';

// ---- in-memory storage backend (no filesystem, no MinIO) -----------------

class MemStorage implements Storage {
  readonly files = new Map<string, Buffer>();
  put(key: string, data: Buffer): Promise<void> {
    this.files.set(key, Buffer.from(data));
    return Promise.resolve();
  }
  get(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    return b ? Promise.resolve(b) : Promise.reject(new Error(`missing ${key}`));
  }
  has(key: string): Promise<boolean> {
    return Promise.resolve(this.files.has(key));
  }
  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }
  list(prefix = ''): Promise<StorageEntry[]> {
    const out = [...this.files.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, data]) => ({ key, size: data.length, modifiedAt: new Date(0) }));
    return Promise.resolve(out);
  }
}

// ---- helpers -------------------------------------------------------------

function grid(w: number, h: number): TileCell[] {
  const cells: TileCell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells.push({ x, y, lat: 40 + y * 0.001, lng: -74 + x * 0.001 });
    }
  }
  return cells;
}

async function project(cells: TileCell[]): Promise<string> {
  const p = await createProject({ name: `vitest-worker-${crypto.randomUUID()}` });
  await createProjectTiles(p.id, cells);
  return p.id;
}

/** Poll until `cond` holds — the consumer works the queue on its own loop. */
async function waitFor(cond: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: condition not met within timeout');
}

async function wipe(): Promise<void> {
  await getDb().delete(tiles);
  await getDb().delete(projects);
}

// ---- setup ---------------------------------------------------------------

beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`refusing to run integration tests against non-local DB: ${url || '(unset)'}`);
  }
  // The vitest setup repoints DATABASE_URL at the isolated `<devdb>_test` DB.
  // If that didn't happen, the wipes would hit the dev DB — fail loudly instead.
  if (!/_test(\b|$)/.test(new URL(url).pathname)) {
    throw new Error(`refusing to wipe a non-test DB (expected name ending in _test): ${url}`);
  }
});

beforeEach(async () => {
  await wipe();
  __setStorageForTests(new MemStorage()); // fresh blob store per test
});

afterAll(async () => {
  await wipe();
  await closeDb();
});

// ---- tests ---------------------------------------------------------------

describe('render-queue consumer (end-to-end)', () => {
  it('drains pending tiles: render → storage → done, with fixed pose + correct keys', async () => {
    const mem = new MemStorage();
    __setStorageForTests(mem);

    const projectId = await project(grid(2, 2)); // 4 tiles, all render/pending

    const seen: RenderRequest[] = [];
    const png = Buffer.from('\x89PNG\r\n fake render bytes');
    const consumer = startRenderConsumer(
      async (req) => {
        seen.push(req);
        return png;
      },
      () => {},
    );

    // the loop claims + renders on its own — wait for the queue to drain
    await waitFor(async () => (await tilesByProject(projectId)).every((t) => t.status === 'done'));
    consumer.stop();
    await consumer.done;

    const rows = await tilesByProject(projectId);
    expect(rows).toHaveLength(4);
    for (const tile of rows) {
      expect(tile.currentStatusType).toBe('render');
      expect(tile.status).toBe('done');
      const key = renderKey(projectId, tile.x, tile.y);
      expect(tile.renderedImgPath).toBe(key); // db points at the blob
      expect(await mem.has(key)).toBe(true); // and the blob was actually written
      expect((await mem.get(key)).equals(png)).toBe(true);
    }

    // every render call got the hardcoded pose + this tile's real-world center
    expect(seen).toHaveLength(4);
    for (const req of seen) {
      expect(req.size).toBe(RENDER_DEFAULTS.tilePixelSize);
      expect(req.pitch).toBe(RENDER_DEFAULTS.cameraPitch);
      expect(req.yaw).toBe(RENDER_DEFAULTS.cameraYaw);
    }
    const centersSent = new Set(seen.map((r) => `${r.lat},${r.lng}`));
    for (const tile of rows) expect(centersSent.has(`${tile.lat},${tile.lng}`)).toBe(true);
  });

  it('a render that always fails ends at error after the retry budget — nothing stored', async () => {
    const mem = new MemStorage();
    __setStorageForTests(mem);

    const projectId = await project(grid(1, 1));

    const consumer = startRenderConsumer(
      async () => {
        throw new Error('boom');
      },
      () => {},
    );

    await waitFor(async () => {
      const [tile] = await tilesByProject(projectId);
      return tile?.status === 'error';
    });
    consumer.stop();
    await consumer.done;

    const [tile] = await tilesByProject(projectId);
    expect(tile?.status).toBe('error');
    expect(tile?.retryAttempt).toBe(MAX_RETRIES + 1); // 4th failure is terminal
    expect(tile?.renderedImgPath).toBeNull();
    expect(await mem.list()).toHaveLength(0); // never wrote a blob
  });
});
