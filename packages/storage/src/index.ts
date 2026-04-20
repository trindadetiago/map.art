import { resolve } from 'node:path';
import { findRepoRoot } from '@mapart/env';
import { LocalFs } from './local-fs';
import type { Storage } from './types';

/** Hardcoded location for the dev LocalFs backend. When we add an S3 backend, this becomes the default fallback only. */
const LOCAL_STORAGE_ROOT = 'data';

let singleton: Storage | null = null;

/** Returns the process-wide Storage instance (currently always LocalFs rooted at <repo>/data). */
export function getStorage(): Storage {
  if (!singleton) {
    singleton = new LocalFs(resolve(findRepoRoot(), LOCAL_STORAGE_ROOT));
  }
  return singleton;
}

/** Test-only: swap in a different impl. Never call from product code. */
export function __setStorageForTests(storage: Storage): void {
  singleton = storage;
}

export { LocalFs } from './local-fs';
export type { Storage, StorageEntry } from './types';
