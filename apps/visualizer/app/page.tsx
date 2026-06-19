import { Frame } from '@/components/frame';
import { HomeLanding } from '@/components/home_landing';
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
    return <HomeLanding projects={projects} />;
  }

  const project = await repos.getProjectById(projectId);
  if (!project) {
    return (
      <Notice title="Project not found">
        No project with id <code className={CODE}>{projectId}</code>.{' '}
        <a href="/" className="text-[#6ea8fe] hover:underline">
          Pick another &rarr;
        </a>
      </Notice>
    );
  }

  const storage = getStorage();
  const metaKey = vizMetadataKey(projectId);
  if (!(await storage.has(metaKey))) {
    return (
      <Notice title={`No pyramid for "${project.name}" yet`}>
        This project hasn&apos;t been exported to a deep-zoom pyramid. Build one with:
        <pre className="mt-3 mb-3 overflow-x-auto rounded-lg border border-[rgba(234,230,220,0.1)] bg-[#221f17] p-3">
          <code className="font-mono text-[12.5px]">
            pnpm mapart export dzi --project {projectId}
          </code>
        </pre>
        Then reload this page.
      </Notice>
    );
  }

  const meta = JSON.parse((await storage.get(metaKey)).toString('utf8')) as VizMetadata;
  const pins = await getProjectPins(projectId);

  return (
    <Frame projectId={projectId} meta={meta} pins={pins} name={project.name} year={project.year} />
  );
}

const CODE =
  'rounded-md border border-[rgba(234,230,220,0.1)] bg-[#221f17] px-1.5 py-0.5 font-mono text-[12.5px]';

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-8">
      <div className="w-full max-w-[520px] rounded-[14px] border border-[rgba(234,230,220,0.12)] bg-[#16140f] px-6 py-[22px]">
        <h1 className="mt-0 mb-2.5 text-[18px] font-semibold">{title}</h1>
        <div className="text-[14px] leading-[1.6] text-[#9a9385]">{children}</div>
      </div>
    </div>
  );
}
