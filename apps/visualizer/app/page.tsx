import { HomeLanding } from '@/components/home_landing';
import { CODE, Notice } from '@/components/notice';
import { findProject, listExportedProjects } from '@/lib/project';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.project;
  const projectId = Array.isArray(raw) ? raw[0] : raw;

  // Links written before projects had slugs point here with an id.
  if (projectId) {
    const project = await findProject(projectId);
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

  return <HomeLanding projects={await listExportedProjects()} />;
}
