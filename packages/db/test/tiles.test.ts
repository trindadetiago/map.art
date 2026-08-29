import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { createProject } from '../src/repos/projects';
import {
  MAX_RETRIES,
  type TileCell,
  addProjectTiles,
  claimNextRender,
  claimNextStylize,
  createProjectTiles,
  failOrRetry,
} from '../src/repos/tiles';
import { projects } from '../src/schema/projects';
import { type Tile, tiles } from '../src/schema/tiles';

// ---- helpers -------------------------------------------------------------

/** A w×h grid of cells with throwaway lat/lng. Inserted in row-major order. */
function grid(w: number, h: number): TileCell[] {
  const cells: TileCell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells.push({ x, y, lat: 40 + y * 0.001, lng: -74 + x * 0.001 });
    }
  }
  return cells;
}

/** Fresh project + its tiles. Names are prefixed so leftovers are easy to spot. */
async function project(cells: TileCell[]): Promise<Tile[]> {
  const name = `vitest-${crypto.randomUUID()}`;
  const p = await createProject({ name, slug: name });
  return createProjectTiles(p.id, cells);
}

/** Force a tile into an arbitrary state — test-arrangement only. */
async function setTile(id: string, patch: Partial<typeof tiles.$inferInsert>): Promise<void> {
  await getDb().update(tiles).set(patch).where(eq(tiles.id, id));
}

async function fetchTile(id: string): Promise<Tile> {
  const [row] = await getDb().select().from(tiles).where(eq(tiles.id, id)).limit(1);
  if (!row) throw new Error(`tile ${id} vanished`);
  return row;
}

/** The whole queue is shared, so reset it between tests. */
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
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await closeDb();
});

// ---- tests ---------------------------------------------------------------

describe('createProjectTiles', () => {
  it('back-fills Moore neighborhoods — 8 center, 5 edge, 3 corner', async () => {
    const created = await project(grid(3, 3));
    expect(created).toHaveLength(9);

    // assert the PERSISTED rows, not the return value — the back-fill is an UPDATE
    const projectId = created[0]?.projectId;
    if (!projectId) throw new Error('no project id');
    const t = await getDb().select().from(tiles).where(eq(tiles.projectId, projectId));
    const at = (x: number, y: number) => {
      const tile = t.find((r) => r.x === x && r.y === y);
      if (!tile) throw new Error(`no tile at ${x},${y}`);
      return tile;
    };

    expect(at(1, 1).neighbors).toHaveLength(8); // center
    expect(at(1, 0).neighbors).toHaveLength(5); // edge
    expect(at(0, 0).neighbors).toHaveLength(3); // corner

    // every neighbor id is a real tile in this project
    const ids = new Set(t.map((r) => r.id));
    for (const n of at(1, 1).neighbors) expect(ids.has(n)).toBe(true);
    // adjacency is symmetric
    expect(at(0, 0).neighbors).toContain(at(1, 1).id);
    expect(at(1, 1).neighbors).toContain(at(0, 0).id);
  });
});

describe('addProjectTiles', () => {
  it('rewires neighbors across the old/new boundary, negative coords included', async () => {
    const created = await project(grid(2, 2));
    const projectId = created[0]?.projectId;
    if (!projectId) throw new Error('no project id');

    // Expand one column west (negative x) — a 3×2 grid after the merge.
    const added = await addProjectTiles(projectId, [
      { x: -1, y: 0, lat: 40, lng: -74.001 },
      { x: -1, y: 1, lat: 40.001, lng: -74.001 },
    ]);
    expect(added).toHaveLength(2);

    const t = await getDb().select().from(tiles).where(eq(tiles.projectId, projectId));
    const at = (x: number, y: number) => {
      const tile = t.find((r) => r.x === x && r.y === y);
      if (!tile) throw new Error(`no tile at ${x},${y}`);
      return tile;
    };

    // new edge tiles see the old grid: (-1,0) touches (-1,1), (0,0), (0,1)
    expect(at(-1, 0).neighbors).toHaveLength(3);
    // old boundary tiles gained the new column: (0,0) had 3, now 5
    expect(at(0, 0).neighbors).toHaveLength(5);
    expect(at(0, 0).neighbors).toContain(at(-1, 0).id);
    expect(at(-1, 0).neighbors).toContain(at(0, 0).id);
    // the far column is untouched
    expect(at(1, 0).neighbors).toHaveLength(3);
    // new tiles enter the render queue
    expect(at(-1, 0).currentStatusType).toBe('render');
    expect(at(-1, 0).status).toBe('pending');
  });
});

describe('claimNextRender', () => {
  it('claims a pending render, flips it to progress, then drains to null', async () => {
    await project(grid(1, 1));

    const claimed = await claimNextRender();
    expect(claimed).not.toBeNull();
    expect(claimed?.currentStatusType).toBe('render');
    expect(claimed?.status).toBe('progress');

    // only one tile existed; a second claim finds nothing
    expect(await claimNextRender()).toBeNull();
  });

  it('hands every concurrent claimer a distinct tile (FOR UPDATE SKIP LOCKED)', async () => {
    const n = 6;
    await project(grid(n, 1));

    // fire more claimers than there are tiles, all at once
    const results = await Promise.all(Array.from({ length: n + 2 }, () => claimNextRender()));
    const claimed = results.filter((r): r is Tile => r !== null);
    const empty = results.filter((r) => r === null);

    expect(claimed).toHaveLength(n);
    expect(empty).toHaveLength(2);
    // no tile was handed out twice
    expect(new Set(claimed.map((c) => c.id)).size).toBe(n);
  });
});

describe('claimNextStylize', () => {
  it('will not claim until ALL neighbors have rendered', async () => {
    const t = await project(grid(3, 1)); // (0,0)-(1,0)-(2,0)
    const at = (x: number) => {
      const tile = t.find((r) => r.x === x);
      if (!tile) throw new Error(`no tile at ${x}`);
      return tile;
    };

    // middle is render-done, but its neighbors haven't rendered → blocked
    await setTile(at(1).id, { status: 'done', renderedImgPath: 'r/1.png' });
    expect(await claimNextStylize()).toBeNull();

    // render the neighbors too → now claimable
    await setTile(at(0).id, { status: 'done', renderedImgPath: 'r/0.png' });
    await setTile(at(2).id, { status: 'done', renderedImgPath: 'r/2.png' });

    const claimed = await claimNextStylize();
    expect(claimed?.currentStatusType).toBe('stylize');
    expect(claimed?.status).toBe('progress');
    expect(claimed?.retryAttempt).toBe(0); // reset on promotion
  });

  it('does not starve: a tile is claimable even when a neighbor is already stylized', async () => {
    const t = await project(grid(3, 1));
    const at = (x: number) => {
      const tile = t.find((r) => r.x === x);
      if (!tile) throw new Error(`no tile at ${x}`);
      return tile;
    };

    // (0,0) is fully past render — already stylized — but keeps its rendered path
    await setTile(at(0).id, {
      currentStatusType: 'stylize',
      status: 'done',
      renderedImgPath: 'r/0.png',
      stylizedImgPath: 's/0.png',
    });
    await setTile(at(1).id, { status: 'done', renderedImgPath: 'r/1.png' });
    await setTile(at(2).id, { status: 'done', renderedImgPath: 'r/2.png' });

    // readiness keys on rendered_img_path, not the phase column, so (1,0) claims
    const claimed = await claimNextStylize();
    expect(claimed).not.toBeNull();
    expect(claimed?.currentStatusType).toBe('stylize');
    expect(claimed?.status).toBe('progress');
    expect([at(1).id, at(2).id]).toContain(claimed?.id); // never the already-done (0,0)
  });
});

describe('failOrRetry', () => {
  it('retries up to the budget, then goes terminal at error', async () => {
    await project(grid(1, 1));
    const claimed = await claimNextRender();
    const id = claimed?.id;
    if (!id) throw new Error('expected a claimed tile');

    const seq: string[] = [];
    for (let i = 0; i < MAX_RETRIES + 1; i++) seq.push(await failOrRetry(id));
    expect(seq).toEqual(['pending', 'pending', 'pending', 'error']);

    const row = await fetchTile(id);
    expect(row.status).toBe('error');
    expect(row.retryAttempt).toBe(MAX_RETRIES + 1);

    // error is a dead end — workers only pick up pending
    expect(await claimNextRender()).toBeNull();
  });
});
