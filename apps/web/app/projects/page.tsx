import { repos } from '@mapart/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ProjectsListPage() {
  let projects: Awaited<ReturnType<typeof repos.listProjects>> = [];
  let dbDown = false;
  try {
    projects = await repos.listProjects();
  } catch {
    dbDown = true;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="m-0 text-2xl font-light tracking-tight text-stone-900">projects</h1>
        <Link
          href="/projects/new"
          className="h-9 rounded-full bg-stone-900 px-5 text-[13px] leading-9 text-white transition hover:bg-stone-700"
        >
          + new project
        </Link>
      </div>

      {dbDown ? (
        <Empty
          title="Database is unreachable"
          body="Start the dev stack with `pnpm dev` and your projects will appear here."
        />
      ) : projects.length === 0 ? (
        <Empty
          title="No projects yet"
          body="Create one with “new project” — search a city, frame a grid over the area, confirm."
        />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-xl border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:shadow-sm"
              >
                <div className="text-[15px] font-semibold text-stone-900">{p.name}</div>
                {p.description && (
                  <div className="mt-1 text-[13px] text-stone-500">{p.description}</div>
                )}
                <div className="mt-2 text-[11px] uppercase tracking-[0.1em] text-stone-400">
                  {p.createdAt.toLocaleDateString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center">
      <div className="text-[15px] font-medium text-stone-700">{title}</div>
      <p className="mx-auto mt-2 mb-0 max-w-[44ch] text-sm text-stone-500">{body}</p>
    </div>
  );
}
