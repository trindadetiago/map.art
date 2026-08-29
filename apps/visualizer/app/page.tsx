import { HomeLanding } from '@/components/home_landing';
import { CODE, Notice } from '@/components/notice';
import { repos } from '@mapart/db';
import { vizMetadataKey } from '@mapart/export/keys';
import { getStorage } from '@mapart/storage';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.project;
  const projectId = Array.isArray(raw) ? raw[0] : raw;

  // Links written before projects had slugs point here with an id.
  if (projectId) {
    const project = await repos.getProjectById(projectId);
    if (project) redirect(`/${project.slug}`);
    return (
      <Notice title="Project not found">
        No project with id <code className={CODE}>{projectId}</code>.{' '}
        <a href="/" className="text-[#6ea8fe] hover:underline">
          Pick another &rarr;
        </a>
      </Notice>
    );
  }

  // Only pin projects that actually have an exported pyramid — a project can
  // have tiles (so a location) without ever being exported, and clicking such
  // a pin would only land on the "no pyramid yet" notice.
  const located = await repos.listProjectsWithLocation();
  const storage = getStorage();
  const exported = await Promise.all(located.map((p) => storage.has(vizMetadataKey(p.id))));
  const projects = located.filter((_, i) => exported[i]);
  return <HomeLanding projects={projects} />;
}
