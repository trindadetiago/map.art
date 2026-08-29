import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { createProject } from '../src/repos/projects';
import { type TileCell, createProjectTiles, tilesByIds } from '../src/repos/tiles';
import { projects } from '../src/schema/projects';
import { tiles } from '../src/schema/tiles';

beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`refusing to run integration tests against non-local DB: ${url || '(unset)'}`);
  }
});

beforeEach(async () => {
  await getDb().delete(tiles);
  await getDb().delete(projects);
});

afterAll(async () => {
  await getDb().delete(tiles);
  await getDb().delete(projects);
  await closeDb();
});

describe('tilesByIds', () => {
  it('returns rows for given ids, ignores unknown ids, and [] for empty input', async () => {
    const name = `vitest-${crypto.randomUUID()}`;
    const p = await createProject({ name, slug: name });
    const cells: TileCell[] = [
      { x: 0, y: 0, lat: 40, lng: -74 },
      { x: 1, y: 0, lat: 40, lng: -73.999 },
    ];
    const inserted = await createProjectTiles(p.id, cells);
    const ids = inserted.map((t) => t.id);

    const rows = await tilesByIds(ids);
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());

    expect(await tilesByIds([])).toEqual([]);
    expect(await tilesByIds([crypto.randomUUID()])).toEqual([]);
  });
});
