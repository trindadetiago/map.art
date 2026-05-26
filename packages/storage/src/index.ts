import { resolve } from 'node:path';
import { env, findRepoRoot, requireEnv } from '@mapart/env';
import { LocalFs } from './local-fs';
import { S3Storage } from './s3';
import type { Storage } from './types';

/** Hardcoded location for the dev LocalFs backend when STORAGE_BACKEND=local. */
const LOCAL_STORAGE_ROOT = 'data';

let singleton: Storage | null = null;

/** Returns the process-wide Storage instance. Picks S3 or LocalFs based on STORAGE_BACKEND. */
export function getStorage(): Storage {
  if (singleton) return singleton;

  if (env.storageBackend === 's3') {
    singleton = new S3Storage({
      ...(env.s3Endpoint ? { endpoint: env.s3Endpoint } : {}),
      region: env.s3Region,
      accessKeyId: requireEnv('s3AccessKeyId'),
      secretAccessKey: requireEnv('s3SecretAccessKey'),
      bucket: requireEnv('s3Bucket'),
      forcePathStyle: env.s3ForcePathStyle === 'true',
    });
  } else {
    singleton = new LocalFs(resolve(findRepoRoot(), LOCAL_STORAGE_ROOT));
  }

  return singleton;
}

/** Test-only: swap in a different impl. Never call from product code. */
export function __setStorageForTests(storage: Storage): void {
  singleton = storage;
}

export { LocalFs } from './local-fs';
export { S3Storage } from './s3';
export type { Storage, StorageEntry } from './types';
