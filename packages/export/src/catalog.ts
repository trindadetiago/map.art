import { getVizStorage } from '@mapart/storage';
import { vizCatalogKey } from './keys';
import type { VizCatalog } from './types';

/**
 * Read the list of published maps.
 *
 * Deliberately imports no database: this is the module the visualizer uses, and
 * keeping it storage-only is what lets the public site run without reaching the
 * pipeline. The write side lives in the package entry, which does have db.
 */
export async function readVizCatalog(): Promise<VizCatalog> {
  const storage = getVizStorage();
  const key = vizCatalogKey();
  // An empty catalogue is a legitimate state — nothing published yet — so it
  // renders an empty globe rather than failing the page.
  if (!(await storage.has(key))) return { projects: [], generatedAt: new Date(0).toISOString() };
  try {
    return JSON.parse((await storage.get(key)).toString('utf8')) as VizCatalog;
  } catch {
    return { projects: [], generatedAt: new Date(0).toISOString() };
  }
}
