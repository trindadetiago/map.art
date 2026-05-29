import { CreateProjectForm } from '@/components/admin/projects/create_project_form';
import { ProjectCard, type ProjectCardData } from '@/components/admin/projects/project_card';
import { Section } from '@/components/admin/section';
import { repos } from '@mapart/db';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

async function createProjectAction(
  fd: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server';
  try {
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };
    const description = String(fd.get('description') ?? '').trim();
    const row = await repos.createProject({
      name,
      description: description || null,
    });
    revalidatePath('/admin/projects');
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function deleteProjectAction(id: string): Promise<void> {
  'use server';
  await repos.deleteProject(id);
  revalidatePath('/admin/projects');
}

export default async function ProjectsPage() {
  let projects: ProjectCardData[] = [];
  let dbDown = false;

  try {
    const rows = await repos.listProjects();
    projects = rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.createdAt,
    }));
  } catch {
    dbDown = true;
  }

  return (
    <div>
      <div className="mb-10 flex items-baseline gap-4">
        <h1 className="m-0 text-3xl font-light tracking-tight text-stone-900">Projects</h1>
        <span className="text-sm text-stone-500">
          {dbDown
            ? 'db unreachable'
            : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
        </span>
      </div>

      <Section label="Create" description="seed a new project">
        <div className="rounded-2xl border border-stone-200/70 bg-white p-6">
          <CreateProjectForm action={createProjectAction} />
        </div>
      </Section>

      <Section label="All projects" description="click a card to open the workspace">
        {dbDown ? (
          <EmptyState
            title="Database is unreachable"
            body="Start the dev stack with `pnpm dev` and the project list will appear here."
          />
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="Use the form above to create your first project. It will appear here, and you can click it to open the workspace."
          />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} deleteAction={deleteProjectAction} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center">
      <div className="text-[15px] font-medium text-stone-700">{title}</div>
      <p className="mx-auto mt-2 mb-0 max-w-[44ch] text-sm text-stone-500">{body}</p>
    </div>
  );
}
