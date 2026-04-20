import { repos } from '@mapart/db';
import { DbPanel } from '@mapart/db/debug';
import { revalidatePath } from 'next/cache';

async function createProjectAction(
  fd: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server';
  try {
    const name = String(fd.get('name') ?? '').trim();
    const slug = String(fd.get('slug') ?? '').trim();
    if (!name || !slug) return { ok: false, error: 'name and slug are required' };
    const pitch = numOrDefault(fd.get('pitch'), 30);
    const yaw = numOrDefault(fd.get('yaw'), 45);
    const centerLat = numOrDefault(fd.get('centerLat'), -7.115);
    const centerLng = numOrDefault(fd.get('centerLng'), -34.861);
    const row = await repos.createProject({
      name,
      slug,
      centerLat,
      centerLng,
      cameraPitch: pitch,
      cameraYaw: yaw,
    });
    revalidatePath('/debug/db');
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function deleteProjectAction(id: string): Promise<void> {
  'use server';
  await repos.deleteProject(id);
  revalidatePath('/debug/db');
}

async function seedAction(): Promise<void> {
  'use server';
  await repos.seedDefaultModels();
  revalidatePath('/debug/db');
}

function numOrDefault(v: FormDataEntryValue | null, fallback: number): number {
  if (v === null) return fallback;
  const parsed = Number.parseFloat(String(v));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function DbDebugPage() {
  const [info, counts, projects, models] = await Promise.all([
    repos.getPostgresInfo(),
    repos.getTableCounts(),
    repos.listProjects(),
    repos.listModels(),
  ]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>db</h1>
      <p style={{ opacity: 0.7, maxWidth: 720 }}>
        Connection status, row counts, and the projects + models tables. Create a project here; it
        will be the scope for rendered/generated tiles in the next step.
      </p>
      <DbPanel
        postgresVersion={info.version}
        postgisVersion={info.postgisVersion}
        counts={counts}
        projects={projects}
        models={models}
        createProjectAction={createProjectAction}
        deleteProjectAction={deleteProjectAction}
        seedAction={seedAction}
      />
    </div>
  );
}
