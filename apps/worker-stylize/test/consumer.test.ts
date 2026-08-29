import { closeDb, getDb } from '@mapart/db';
import { type TileCell, createProject, createProjectTiles, tilesByProject } from '@mapart/db/repos';
import { projects, tiles } from '@mapart/db/schema';
import { silentLogger } from '@mapart/logger';
import { type ModelClient, StubImageModel } from '@mapart/models';
import { type Storage, type StorageEntry, __setStorageForTests } from '@mapart/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startStylizeConsumer, stylizeKey } from '../consumer';

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
  presignGet(key: string): Promise<string> {
    return Promise.resolve(`mem://${key}`);
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

/** Project whose tiles are all render/done with a real PNG render in storage. */
async function seedRenderedProject(mem: MemStorage, w: number, h: number): Promise<string> {
  const name = `vitest-stylize-${crypto.randomUUID()}`;
  const p = await createProject({ name, slug: name });
  const rows = await createProjectTiles(p.id, grid(w, h));
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .png()
    .toBuffer();
  for (const t of rows) {
    const key = `render/${p.id}/${t.x}_${t.y}.png`;
    await mem.put(key, png);
    await getDb()
      .update(tiles)
      .set({ status: 'done', renderedImgPath: key })
      .where(eq(tiles.id, t.id));
  }
  return p.id;
}

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
  __setStorageForTests(new MemStorage());
});

afterAll(async () => {
  await wipe();
  await closeDb();
});

// ---- tests ---------------------------------------------------------------

describe('stylize-queue consumer (end-to-end)', () => {
  it('drains rendered tiles: render/done → stylized blob + completeStylize', async () => {
    const mem = new MemStorage();
    __setStorageForTests(mem);
    const projectId = await seedRenderedProject(mem, 2, 2);

    const consumer = startStylizeConsumer(new StubImageModel(), silentLogger);
    await waitFor(async () =>
      (await tilesByProject(projectId)).every(
        (t) => t.currentStatusType === 'stylize' && t.status === 'done',
      ),
    );
    consumer.stop();
    await consumer.done;

    const rows = await tilesByProject(projectId);
    expect(rows).toHaveLength(4);
    for (const t of rows) {
      const key = stylizeKey(projectId, t.x, t.y);
      expect(t.stylizedImgPath).toBe(key);
      expect(await mem.has(key)).toBe(true);
      const meta = await sharp(await mem.get(key)).metadata();
      expect(meta.width).toBe(1024);
      expect(meta.height).toBe(1024);
    }
  });

  it('a stylize that always fails ends at error after the retry budget', async () => {
    const mem = new MemStorage();
    __setStorageForTests(mem);
    const projectId = await seedRenderedProject(mem, 1, 1);

    const boom: ModelClient = { name: 'boom', generate: () => Promise.reject(new Error('boom')) };
    const consumer = startStylizeConsumer(boom, silentLogger);
    await waitFor(async () => {
      const [t] = await tilesByProject(projectId);
      return t?.status === 'error';
    });
    consumer.stop();
    await consumer.done;

    const [t] = await tilesByProject(projectId);
    expect(t?.currentStatusType).toBe('stylize');
    expect(t?.status).toBe('error');
    expect(t?.stylizedImgPath).toBeNull();
  });
});
