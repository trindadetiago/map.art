import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/client';
import { claimNextExport, createExport, getExportById, markExportDone } from '../src/repos/exports';
import { createProject } from '../src/repos/projects';
import { projectExports } from '../src/schema/exports';

beforeAll(() => {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_test(\?|$)/.test(url.split('/').pop() ?? '')) {
    throw new Error(`refusing to run against ${url} — expected a *_test database`);
  }
});

async function freshProject() {
  const name = `vitest-export-${crypto.randomUUID()}`;
  return createProject({ name, slug: name });
}

describe('claimNextExport', () => {
  it('returns undefined when nothing is queued', async () => {
    await getDb().delete(projectExports);
    expect(await claimNextExport()).toBeUndefined();
  });

  it('hands back a fully mapped row, not raw snake_case columns', async () => {
    await getDb().delete(projectExports);
    const p = await freshProject();
    const queued = await createExport(p.id, 'stylized');

    const claimed = await claimNextExport();
    expect(claimed).toBeDefined();
    // The bug this guards: a raw `execute()` returns `project_id`, leaving
    // `projectId` undefined and the export running against nothing.
    expect(claimed?.projectId).toBe(p.id);
    expect(claimed?.source).toBe('stylized');
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.startedAt).toBeInstanceOf(Date);
  });

  it('gives two concurrent claimers different rows', async () => {
    await getDb().delete(projectExports);
    const p = await freshProject();
    await createExport(p.id, 'stylized');
    await createExport(p.id, 'stylized');

    const [a, b] = await Promise.all([claimNextExport(), claimNextExport()]);
    expect(a?.id).toBeDefined();
    expect(b?.id).toBeDefined();
    expect(a?.id).not.toBe(b?.id);
    expect(await claimNextExport()).toBeUndefined();
  });

  it('takes the oldest first', async () => {
    await getDb().delete(projectExports);
    const p = await freshProject();
    const first = await createExport(p.id, 'stylized');
    await new Promise((r) => setTimeout(r, 5));
    await createExport(p.id, 'rendered');
    expect((await claimNextExport())?.id).toBe(first.id);
  });

  it('records the outcome on success', async () => {
    await getDb().delete(projectExports);
    const p = await freshProject();
    const e = await createExport(p.id, 'stylized');
    await claimNextExport();
    await markExportDone(e.id, { placed: 5, skipped: 1, uploaded: 9, width: 10, height: 20 });
    const after = await getExportById(e.id);
    expect(after?.status).toBe('done');
    expect(after?.placed).toBe(5);
    expect(after?.finishedAt).toBeInstanceOf(Date);
  });
});
