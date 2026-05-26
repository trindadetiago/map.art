import type { TableCounts } from '@mapart/db/repos';
import type { Model, Project } from '@mapart/db/schema';
import { CreateProjectForm } from './create_project_form';
import { DeleteProjectButton } from './delete_project_button';

export interface DbPanelProps {
  postgresVersion: string;
  postgisVersion: string | null;
  counts: TableCounts;
  projects: Project[];
  models: Model[];
  createProjectAction: (
    fd: FormData,
  ) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  deleteProjectAction: (id: string) => Promise<void>;
  seedAction: () => Promise<void>;
}

const CARD = 'rounded-lg border border-neutral-200 bg-white p-5';
const H2 = 'm-0 mb-3 text-sm uppercase tracking-[1px] opacity-60';
const TABLE = 'w-full border-collapse text-[13px]';
const TH =
  'border-b border-neutral-200 px-2.5 py-1.5 text-left text-[11px] uppercase tracking-[1px] opacity-50';
const TD = 'border-b border-neutral-100 px-2.5 py-2';
const BTN =
  'cursor-pointer rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs hover:bg-neutral-50';

export function DbPanel({
  postgresVersion,
  postgisVersion,
  counts,
  projects,
  models,
  createProjectAction,
  deleteProjectAction,
  seedAction,
}: DbPanelProps) {
  return (
    <div className="grid gap-6">
      <section className={CARD}>
        <h2 className={H2}>connection</h2>
        <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="font-mono opacity-70">postgres</dt>
          <dd className="m-0 font-mono">{shortVersion(postgresVersion)}</dd>
          <dt className="font-mono opacity-70">postgis</dt>
          <dd className="m-0 font-mono">{postgisVersion ?? '(not installed)'}</dd>
        </dl>
      </section>

      <section className={CARD}>
        <h2 className={H2}>row counts</h2>
        <table className={TABLE}>
          <tbody>
            {Object.entries(counts).map(([k, v]) => (
              <tr key={k}>
                <td className={TD}>
                  <code>{k}</code>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h2 className={H2}>models</h2>
          <form action={seedAction}>
            <button type="submit" className={BTN}>
              seed defaults
            </button>
          </form>
        </div>
        {models.length === 0 ? (
          <div className="text-[13px] opacity-60">(none — press "seed defaults")</div>
        ) : (
          <table className={TABLE}>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td className={TD}>{m.active ? '★' : ''}</td>
                  <td className={TD}>
                    <code>{m.id}</code>
                  </td>
                  <td className={`${TD} opacity-70`}>{m.kind}</td>
                  <td className={`${TD} font-mono text-xs opacity-70`}>{m.endpoint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={CARD}>
        <h2 className={H2}>projects</h2>
        <CreateProjectForm action={createProjectAction} />
        <div className="h-4" />
        {projects.length === 0 ? (
          <div className="text-[13px] opacity-60">(no projects)</div>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>name</th>
                <th className={TH}>slug</th>
                <th className={TH}>status</th>
                <th className={TH}>camera</th>
                <th className={TH}>center</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className={TD}>{p.name}</td>
                  <td className={`${TD} font-mono text-xs`}>{p.slug}</td>
                  <td className={TD}>{p.status}</td>
                  <td className={`${TD} font-mono text-xs`}>
                    p={p.cameraPitch}° y={p.cameraYaw}°
                  </td>
                  <td className={`${TD} font-mono text-xs`}>
                    {p.centerLat.toFixed(4)}, {p.centerLng.toFixed(4)}
                  </td>
                  <td className={TD}>
                    <DeleteProjectButton id={p.id} slug={p.slug} action={deleteProjectAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function shortVersion(v: string): string {
  return v.split(' ').slice(0, 2).join(' ');
}
