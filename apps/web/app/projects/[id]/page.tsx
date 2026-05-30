import { repos } from '@mapart/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const PHASE_ORDER = ['render', 'stylize'] as const;
const STATUS_ORDER = ['pending', 'progress', 'done', 'error'] as const;

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await repos.getProjectById(id);
  if (!project) notFound();

  const counts = await repos.tileStatusCounts(id);
  const total = counts.reduce((n, c) => n + c.count, 0);
  const at = (phase: string, status: string) =>
    counts.find((c) => c.currentStatusType === phase && c.status === status)?.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/projects" className="text-[13px] text-stone-500 hover:text-stone-800">
        ← projects
      </Link>

      <div className="mt-3 mb-8">
        <h1 className="m-0 text-2xl font-light tracking-tight text-stone-900">{project.name}</h1>
        {project.description && (
          <p className="mt-1 mb-0 text-[14px] text-stone-500">{project.description}</p>
        )}
        <p className="mt-1 mb-0 text-[12px] text-stone-400">{total} tiles</p>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/40 p-12 text-center text-sm text-stone-500">
          No tiles for this project.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-stone-50 text-left text-[11px] uppercase tracking-[0.1em] text-stone-400">
                <th className="px-4 py-2 font-medium">phase</th>
                {STATUS_ORDER.map((s) => (
                  <th key={s} className="px-4 py-2 text-right font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PHASE_ORDER.map((phase) => (
                <tr key={phase} className="border-t border-stone-100">
                  <td className="px-4 py-2 font-medium text-stone-700">{phase}</td>
                  {STATUS_ORDER.map((status) => {
                    const n = at(phase, status);
                    return (
                      <td
                        key={status}
                        className={`px-4 py-2 text-right tabular-nums ${
                          n === 0 ? 'text-stone-300' : 'text-stone-800'
                        }`}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[12px] text-stone-400">
        Reload to refresh — the render worker claims tiles as it runs.
      </p>
    </div>
  );
}
