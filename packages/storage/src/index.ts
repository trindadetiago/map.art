import { env, requireEnv } from '@mapart/env';
import { S3Storage } from './s3';
import type { Storage } from './types';

let singleton: Storage | null = null;

/** Returns the process-wide Storage instance, backed by S3/MinIO. */
export function getStorage(): Storage {
  if (singleton) return singleton;

  // Path-style addressing (bucket in the URL path) is required by MinIO;
  // AWS S3 and Railway buckets use virtual-hosted style. S3_FORCE_PATH_STYLE
  // sets it explicitly; when unset, default to path-style only when a custom
  // S3_ENDPOINT is configured (the MinIO case).
  const forcePathStyle =
    env.s3ForcePathStyle !== undefined ? env.s3ForcePathStyle === 'true' : !!env.s3Endpoint;

  singleton = new S3Storage({
    ...(env.s3Endpoint ? { endpoint: env.s3Endpoint } : {}),
    region: env.s3Region,
    accessKeyId: requireEnv('s3AccessKeyId'),
    secretAccessKey: requireEnv('s3SecretAccessKey'),
    bucket: requireEnv('s3Bucket'),
    forcePathStyle,
  });

  return singleton;
}

/** Test-only: swap in a different impl. Never call from product code. */
export function __setStorageForTests(storage: Storage): void {
  singleton = storage;
}

export { S3Storage } from './s3';
export type { Storage, StorageEntry } from './types';
