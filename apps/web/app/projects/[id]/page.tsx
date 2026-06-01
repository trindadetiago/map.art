import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { notFound } from 'next/navigation';
import { centerFromOrigin } from '../grid_geometry';
import { ProjectFlow } from '../project_flow';

export const dynamic = 'force-dynamic';

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await repos.getProjectById(id);
  if (!project) notFound();

  const tiles = await repos.tilesByProject(id);

  // Reconstruct the setup from the tile grid (nothing else is persisted).
  const cols = tiles.reduce((m, t) => Math.max(m, t.x + 1), 1);
  const rows = tiles.reduce((m, t) => Math.max(m, t.y + 1), 1);
  const origin = tiles.find((t) => t.x === 0 && t.y === 0) ?? tiles[0];
  const center = origin
    ? centerFromOrigin({ lat: origin.lat, lng: origin.lng }, cols, rows)
    : { lat: 0, lng: 0 };
  const cityLabel = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;

  return (
    <ProjectFlow
      mode="view"
      apiKey={env.googleMapsApiKey ?? ''}
      projectId={project.id}
      projectName={project.name}
      initial={{ center, cols, rows, cityLabel }}
      initialTiles={tiles.map((t) => ({
        x: t.x,
        y: t.y,
        currentStatusType: t.currentStatusType,
        status: t.status,
        renderedImgPath: t.renderedImgPath,
        stylizedImgPath: t.stylizedImgPath,
      }))}
    />
  );
}
