import { ProjectEditor } from '@/components/projects/ProjectEditor';
import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function saveAction(
  id: string,
  patch: {
    centerLat: number;
    centerLng: number;
    cameraPitch: number;
    cameraYaw: number;
    tileWorldMeters: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server';
  try {
    await repos.updateProject(id, patch);
    const project = await repos.getProjectById(id);
    revalidatePath('/projects');
    if (project) revalidatePath(`/projects/${project.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await repos.getProjectBySlug(slug);
  if (!project) notFound();

  const [tileCount, tiles] = await Promise.all([
    repos.countTilesForProject(project.id),
    repos.listTilesForProject(project.id, 10000),
  ]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{project.name}</h1>
        <code style={{ opacity: 0.5, fontSize: 14 }}>{project.slug}</code>
        <span style={{ flex: 1 }} />
        <Link href="/projects" style={{ fontSize: 13, color: '#6b7280' }}>
          ← all projects
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px minmax(0, 1fr)',
          gap: 24,
          marginTop: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={cardStyle}>
            <h3 style={h3}>project</h3>
            <KV label="status" value={project.status} />
            <KV label="default model" value={project.defaultModelId ?? '(none)'} />
          </section>
          <section style={cardStyle}>
            <h3 style={h3}>tile grid</h3>
            <KV label="count" value={String(tileCount)} />
            <KV
              label="tile size"
              value={`${project.tileWorldMeters}m / ${project.tilePixelSize}px`}
            />
            <KV
              label="center"
              value={`${project.centerLat.toFixed(4)}, ${project.centerLng.toFixed(4)}`}
            />
            <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8, marginBottom: 0 }}>
              Drag the minimap to re-center. Adjust pitch/yaw with sliders. Save persists to the
              project; tiles keep their <code>(col, row)</code> — they're camera-frame-aligned.
            </p>
          </section>
        </div>
        <ProjectEditor
          projectId={project.id}
          apiKey={env.googleMapsApiKey ?? ''}
          tiles={tiles}
          initialCenterLat={project.centerLat}
          initialCenterLng={project.centerLng}
          initialPitch={project.cameraPitch}
          initialYaw={project.cameraYaw}
          initialTileWorldMeters={project.tileWorldMeters}
          saveAction={saveAction}
        />
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '110px 1fr', fontSize: 13, padding: '3px 0' }}
    >
      <span style={{ fontFamily: 'monospace', opacity: 0.6 }}>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

const cardStyle = { padding: 16, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8 };
const h3 = {
  margin: 0,
  marginBottom: 8,
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  opacity: 0.5,
};
