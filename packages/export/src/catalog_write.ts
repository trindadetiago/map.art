import { repos } from '@mapart/db';
import { createLogger } from '@mapart/logger';
import { getVizStorage } from '@mapart/storage';
import { vizCatalogKey, vizMetadataKey } from './keys';
import type { VizCatalog, VizCatalogEntry, VizMetadata } from './types';

const log = createLogger('export');

/**
 * Rebuild the list of published maps from the database.
 *
 * Called whenever what it describes could have changed — an export, a rename, a
 * deletion. Cheap enough to redo wholesale: it is a handful of rows and one
 * descriptor read per project, and being derived means a wrong one is always
 * fixed by running this again.
 *
 * Only projects that have both a location and a pyramid are listed. A project
 * can have tiles without ever being exported, and a pin for one of those leads
 * nowhere.
 */
export async function writeVizCatalog(): Promise<VizCatalog> {
  const storage = getVizStorage();
  const located = await repos.listProjectsWithLocation();

  const entries = await Promise.all(
    located.map(async (p): Promise<VizCatalogEntry | null> => {
      const key = vizMetadataKey(p.id);
      if (!(await storage.has(key))) return null;
      let meta: VizMetadata;
      try {
        meta = JSON.parse((await storage.get(key)).toString('utf8')) as VizMetadata;
      } catch {
        return null;
      }
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        year: p.year,
        lat: p.lat,
        lng: p.lng,
        width: meta.width,
        height: meta.height,
        tileSize: meta.tileSize,
        format: meta.format,
        ...(meta.version ? { version: meta.version } : {}),
      };
    }),
  );

  const catalog: VizCatalog = {
    projects: entries.filter((e): e is VizCatalogEntry => e !== null),
    generatedAt: new Date().toISOString(),
  };

  // Not cached: this is the pointer the visualizer resolves every slug against,
  // so a stale copy would hide a map that exists.
  await storage.put(vizCatalogKey(), Buffer.from(JSON.stringify(catalog, null, 2)), {
    contentType: 'application/json',
    cacheControl: 'no-cache',
  });
  log.info('published map catalogue', { projects: catalog.projects.length });
  return catalog;
}
