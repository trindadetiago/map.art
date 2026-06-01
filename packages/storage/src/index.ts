import { env, requireEnv } from '@mapart/env';
import { S3Storage } from './s3';
import type { Storage } from './types';

let singleton: Storage | null = null;

/** Returns the process-wide Storage instance, backed by S3/MinIO. */
export function getStorage(): Storage {
  if (singleton) return singleton;

  // Path-style addressing is required by MinIO and most other custom S3
  // backends; AWS S3 uses virtual-hosted style. A custom S3_ENDPOINT
  // reliably signals one of the former, so derive the toggle from it.
  singleton = new S3Storage({
    ...(env.s3Endpoint ? { endpoint: env.s3Endpoint } : {}),
    region: env.s3Region,
    accessKeyId: requireEnv('s3AccessKeyId'),
    secretAccessKey: requireEnv('s3SecretAccessKey'),
    bucket: requireEnv('s3Bucket'),
    forcePathStyle: !!env.s3Endpoint,
  });

  return singleton;
}

/** Test-only: swap in a different impl. Never call from product code. */
export function __setStorageForTests(storage: Storage): void {
  singleton = storage;
}

export { S3Storage } from './s3';
export type { Storage, StorageEntry } from './types';
