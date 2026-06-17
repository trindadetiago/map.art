import { Viewer } from '@/components/viewer';
import { repos } from '@mapart/db';
import { vizMetadataKey } from '@mapart/export/keys';
import { getProjectPins } from '@mapart/export/pins';
import type { VizMetadata } from '@mapart/export/types';
import { getStorage } from '@mapart/storage';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.project;
  const projectId = Array.isArray(raw) ? raw[0] : raw;

  if (!projectId) return <Picker />;

  const project = await repos.getProjectById(projectId);
  if (!project) {
    return (
      <Notice title="Project not found">
        No project with id <code>{projectId}</code>. <a href="/">Pick another &rarr;</a>
      </Notice>
    );
  }

  const storage = getStorage();
  const metaKey = vizMetadataKey(projectId);
  if (!(await storage.has(metaKey))) {
    return (
      <Notice title={`No pyramid for "${project.name}" yet`}>
        This project hasn&apos;t been exported to a deep-zoom pyramid. Build one with:
        <pre>
          <code>pnpm mapart export dzi --project {projectId}</code>
        </pre>
        Then reload this page.
      </Notice>
    );
  }

  const meta = JSON.parse((await storage.get(metaKey)).toString('utf8')) as VizMetadata;
  const pins = await getProjectPins(projectId);

  return (
    <>
      <Viewer projectId={projectId} meta={meta} pins={pins} />
      <div className="overlay">
        <h1>{project.name}</h1>
        <div className="muted">
          {meta.gridWidth}&times;{meta.gridHeight} tiles &middot; {meta.width}&times;{meta.height}px
          &middot; {meta.source}
        </div>
      </div>
    </>
  );
}

async function Picker() {
  const projects = await repos.listProjects();
  return (
    <div className="center">
      <div className="panel">
        <h1>map.art visualizer</h1>
        {projects.length === 0 ? (
          <p className="muted">No projects yet. Create one in the admin app first.</p>
        ) : (
          <>
            <p className="muted">Pick a project to open its map:</p>
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <a href={`/?project=${p.id}`}>{p.name}</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="center">
      <div className="panel">
        <h1>{title}</h1>
        <div className="muted">{children}</div>
      </div>
    </div>
  );
}
