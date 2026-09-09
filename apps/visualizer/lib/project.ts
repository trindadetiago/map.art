import { env } from '@mapart/env';
import { readVizCatalog } from '@mapart/export/catalog';
import { vizThumbKey } from '@mapart/export/keys';
import type { VizCatalogEntry } from '@mapart/export/types';

/** A project the landing can point at: located, exported, and thumbnailable. */
export interface VizProject {
  id: string;
  slug: string;
  name: string;
  year: number | null;
  lat: number;
  lng: number;
  /** The whole map as one pyramid tile. */
  thumbUrl: string;
  /** Stitched width/height, so a thumbnail box can reserve its shape up front. */
  aspect: number;
}

/**
 * Public URL for a pyramid object, given its storage key.
 *
 * With a bucket origin configured the object is fetched straight from there —
 * a CDN answers and no app process touches the bytes. Without one it routes
 * through this app's own proxy, which serves key `viz/<path>` at
 * `/api/viz/<path>`.
 */
export function vizObjectUrl(key: string): string {
  const path = key.replace(/^viz\//, '');
  return env.vizPublicBaseUrl ? `${env.vizPublicBaseUrl}/viz/${path}` : `/api/viz/${path}`;
}

/** Shape a catalogue entry into what the landing renders. */
export function toVizProject(e: VizCatalogEntry): VizProject {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    year: e.year,
    lat: e.lat,
    lng: e.lng,
    thumbUrl: vizObjectUrl(vizThumbKey(e.id, e)),
    aspect: e.width / e.height,
  };
}

/**
 * Every published map, newest first.
 *
 * One object out of storage, and no database: everything the landing needs is
 * in the catalogue the export writes. That is what lets this site serve while
 * the pipeline behind it is down.
 */
export async function listExportedProjects(): Promise<VizProject[]> {
  const catalog = await readVizCatalog();
  return catalog.projects.map(toVizProject);
}

/** Resolve a URL segment to a published map, by slug or by project id. */
export async function findProject(segment: string): Promise<VizCatalogEntry | undefined> {
  const { projects } = await readVizCatalog();
  return projects.find((p) => p.slug === segment) ?? projects.find((p) => p.id === segment);
}
