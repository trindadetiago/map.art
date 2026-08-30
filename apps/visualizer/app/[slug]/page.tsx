import { Frame } from '@/components/frame';
import { CODE, Notice } from '@/components/notice';
import { listExportedProjects, vizObjectUrl } from '@/lib/project';
import { repos } from '@mapart/db';
import { vizMetadataKey, vizTilesPrefix } from '@mapart/export/keys';
import { getProjectPins } from '@mapart/export/pins';
import type { VizMetadata } from '@mapart/export/types';
import { getVizStorage } from '@mapart/storage';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A URL segment resolves by slug. Ids still resolve too, so links written
 * against a project's uuid keep working; the page then redirects to the slug so
 * one project has one canonical address.
 */
async function resolveProject(segment: string) {
  const bySlug = await repos.getProjectBySlug(segment);
  if (bySlug) return bySlug;
  return UUID.test(segment) ? repos.getProjectById(segment) : undefined;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const project = await resolveProject(slug);
  if (!project) return { title: 'Not found — map.art' };
  const title = project.year !== null ? `${project.name} (${project.year})` : project.name;
  return {
    title: `${title} — map.art`,
    ...(project.description ? { description: project.description } : {}),
  };
}

export default async function ProjectPage({ params }: { params: Params }) {
  const { slug } = await params;
  const project = await resolveProject(slug);

  if (!project) {
    return (
      <Notice title="Project not found">
        Nothing lives at <code className={CODE}>/{slug}</code>.{' '}
        <a href="/" className="text-[#6ea8fe] hover:underline">
          Pick another &rarr;
        </a>
      </Notice>
    );
  }

  if (project.slug !== slug) redirect(`/${project.slug}`);

  const storage = getVizStorage();
  const metaKey = vizMetadataKey(project.id);
  if (!(await storage.has(metaKey))) {
    return (
      <Notice title={`No pyramid for "${project.name}" yet`}>
        This project hasn&apos;t been exported to a deep-zoom pyramid. Build one with:
        <pre className="mt-3 mb-3 overflow-x-auto rounded-lg border border-[rgba(234,230,220,0.1)] bg-[#221f17] p-3">
          <code className="font-mono text-[12.5px]">
            pnpm mapart export dzi --project {project.id}
          </code>
        </pre>
        Then reload this page.
      </Notice>
    );
  }

  const meta = JSON.parse((await storage.get(metaKey)).toString('utf8')) as VizMetadata;
  const pins = await getProjectPins(project.id);
  // The Info drawer hangs a map under the blurb — one you aren't already
  // looking at, so it's somewhere to go rather than a link back to here.
  const featured = (await listExportedProjects()).find((p) => p.id !== project.id);

  return (
    <Frame
      tileBaseUrl={vizObjectUrl(vizTilesPrefix(project.id))}
      meta={meta}
      pins={pins}
      name={project.name}
      year={project.year}
      {...(featured ? { featured } : {})}
    />
  );
}
