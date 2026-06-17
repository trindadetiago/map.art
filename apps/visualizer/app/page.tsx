import { Frame } from '@/components/frame';
import { WorldMapHome } from '@/components/worldmap_home';
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

  if (!projectId) {
    // Only pin projects that actually have an exported pyramid — a project can
    // have tiles (so a location) without ever being exported, and clicking such
    // a pin would only land on the "no pyramid yet" notice.
    const located = await repos.listProjectsWithLocation();
    const storage = getStorage();
    const exported = await Promise.all(located.map((p) => storage.has(vizMetadataKey(p.id))));
    const projects = located.filter((_, i) => exported[i]);
    return <WorldMapHome projects={projects} />;
  }

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
    <Frame
      projectId={projectId}
      meta={meta}
      pins={pins}
      name={project.name}
      year={project.year}
      description={project.description}
    />
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
