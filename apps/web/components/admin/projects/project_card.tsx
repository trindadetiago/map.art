import Link from 'next/link';
import { IconArrowUpRight, IconLayers } from '../icons';
import { DeleteProjectButton } from './delete_project_button';

export interface ProjectCardData {
  id: string;
  slug: string;
  name: string;
  status: string;
  centerLat: number;
  centerLng: number;
  cameraPitch: number;
  cameraYaw: number;
  tileCount: number;
  createdAt: Date;
}

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  setup: 'bg-amber-50 text-amber-700 border-amber-200',
  archived: 'bg-stone-100 text-stone-500 border-stone-200',
};

export function ProjectCard({
  project,
  deleteAction,
}: {
  project: ProjectCardData;
  deleteAction: (id: string) => Promise<void>;
}) {
  const statusClass = STATUS_CLASS[project.status] ?? STATUS_CLASS.setup;
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group relative flex flex-col rounded-2xl border border-stone-200/70 bg-white p-6 no-underline transition hover:border-stone-300"
    >
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white">
          <IconLayers className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-[11px] capitalize ${statusClass}`}>
            {project.status}
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 transition group-hover:border-stone-400 group-hover:text-stone-900">
            <IconArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[17px] font-medium leading-tight tracking-tight text-stone-900">
          {project.name}
        </div>
        <div className="mt-0.5 font-mono text-xs text-stone-500">{project.slug}</div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-2 text-[12px]">
        <dt className="text-stone-400">tiles</dt>
        <dd className="m-0 text-right font-mono tabular-nums text-stone-700">
          {project.tileCount.toLocaleString()}
        </dd>
        <dt className="text-stone-400">camera</dt>
        <dd className="m-0 text-right font-mono text-stone-700">
          p{project.cameraPitch}° y{project.cameraYaw}°
        </dd>
        <dt className="text-stone-400">center</dt>
        <dd className="m-0 text-right font-mono text-stone-700">
          {project.centerLat.toFixed(3)}, {project.centerLng.toFixed(3)}
        </dd>
      </dl>

      <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-4 text-[11px] text-stone-400">
        <span>created {formatDate(project.createdAt)}</span>
        <DeleteProjectButton id={project.id} slug={project.slug} action={deleteAction} />
      </div>
    </Link>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
