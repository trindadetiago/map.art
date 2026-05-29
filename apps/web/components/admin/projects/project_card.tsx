import { IconLayers } from '../icons';
import { DeleteProjectButton } from './delete_project_button';

export interface ProjectCardData {
  id: string;
  name: string;
  description: string | null;
  tileCount: number;
  createdAt: Date;
}

export function ProjectCard({
  project,
  deleteAction,
}: {
  project: ProjectCardData;
  deleteAction: (id: string) => Promise<void>;
}) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-stone-200/70 bg-white p-6 transition hover:border-stone-300">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-white">
          <IconLayers className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[17px] font-medium leading-tight tracking-tight text-stone-900">
          {project.name}
        </div>
        {project.description && (
          <p className="mt-1 mb-0 line-clamp-2 text-[13px] text-stone-500">{project.description}</p>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-2 text-[12px]">
        <dt className="text-stone-400">tiles</dt>
        <dd className="m-0 text-right font-mono tabular-nums text-stone-700">
          {project.tileCount.toLocaleString()}
        </dd>
      </dl>

      <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-4 text-[11px] text-stone-400">
        <span>created {formatDate(project.createdAt)}</span>
        <DeleteProjectButton id={project.id} label={project.name} action={deleteAction} />
      </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
