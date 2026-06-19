import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { computeGeoAnchor } from '@mapart/export/geo';
import { getProjectPins } from '@mapart/export/pins';
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
  // Expansion can grow the grid in any direction — north/west tiles carry
  // negative coords — so bounds come from the extent, and the framing origin
  // is whatever tile sits at the grid's top-left corner.
  const minX = tiles.reduce((m, t) => Math.min(m, t.x), 0);
  const minY = tiles.reduce((m, t) => Math.min(m, t.y), 0);
  const cols = tiles.reduce((m, t) => Math.max(m, t.x + 1), minX + 1) - minX;
  const rows = tiles.reduce((m, t) => Math.max(m, t.y + 1), minY + 1) - minY;
  const origin = tiles.find((t) => t.x === minX && t.y === minY) ?? tiles[0];
  const center = origin
    ? centerFromOrigin({ lat: origin.lat, lng: origin.lng }, cols, rows)
    : { lat: 0, lng: 0 };
  const cityLabel = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;

  // Grid↔WGS84 fit for placing/previewing pins on the stitched art. Anchored at
  // the grid's true (minX, minY) — the same extent the Pins step derives from its
  // tiles — so a pin's on-art position matches the render. Skipped with no tiles.
  const geo =
    tiles.length > 0
      ? computeGeoAnchor(
          tiles,
          tiles.reduce((m, t) => Math.min(m, t.x), Number.POSITIVE_INFINITY),
          tiles.reduce((m, t) => Math.min(m, t.y), Number.POSITIVE_INFINITY),
        )
      : undefined;
  const pins = await getProjectPins(project.id);

  return (
    <ProjectFlow
      mode="view"
      apiKey={env.googleMapsApiKey ?? ''}
      projectId={project.id}
      projectName={project.name}
      initial={{ center, cols, rows, cityLabel }}
      {...(geo ? { geo } : {})}
      initialPins={pins}
      initialTiles={tiles.map((t) => ({
        x: t.x,
        y: t.y,
        currentStatusType: t.currentStatusType,
        status: t.status,
        renderedImgPath: t.renderedImgPath,
        stylizedImgPath: t.stylizedImgPath,
        v: t.updatedAt.getTime(),
      }))}
    />
  );
}
