import { repos } from '@mapart/db';
import { env } from '@mapart/env';
import { vizMetadataKey, vizThumbKey } from '@mapart/export/keys';
import type { VizMetadata } from '@mapart/export/types';
import { getVizStorage } from '@mapart/storage';

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

/**
 * Every project with a location *and* an exported pyramid, newest first. A
 * project can have tiles (so a location) without ever being exported, and a pin
 * for one of those would only ever land on the "no pyramid yet" notice.
 */
export async function listExportedProjects(): Promise<VizProject[]> {
  const located = await repos.listProjectsWithLocation();
  const storage = getVizStorage();
  const metas = await Promise.all(
    located.map(async (p): Promise<VizMetadata | undefined> => {
      const key = vizMetadataKey(p.id);
      if (!(await storage.has(key))) return undefined;
      try {
        return JSON.parse((await storage.get(key)).toString('utf8')) as VizMetadata;
      } catch {
        return undefined;
      }
    }),
  );

  const out: VizProject[] = [];
  located.forEach((p, i) => {
    const meta = metas[i];
    if (!meta) return;
    out.push({
      id: p.id,
      slug: p.slug,
      name: p.name,
      year: p.year,
      lat: p.lat,
      lng: p.lng,
      thumbUrl: vizObjectUrl(vizThumbKey(p.id, meta)),
      aspect: meta.width / meta.height,
    });
  });
  return out;
}
