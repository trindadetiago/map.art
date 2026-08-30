import { env, requireEnv } from '@mapart/env';
import { S3Storage } from './s3';
import type { Storage } from './types';

let singleton: Storage | null = null;
let vizSingleton: Storage | null = null;

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

/**
 * Storage for published pyramids — everything under `viz/`.
 *
 * These are the only objects served to the public, so they can live in their own
 * bucket: one that is world-readable behind a CDN, reachable by credentials that
 * cannot touch the pipeline's renders and stylized output. With `VIZ_S3_BUCKET`
 * unset there is no split and this is the main storage, which is what local dev
 * and single-bucket deployments want.
 */
export function getVizStorage(): Storage {
  if (vizSingleton) return vizSingleton;
  if (!env.vizS3Bucket) return getStorage();

  vizSingleton = new S3Storage({
    ...(env.vizS3Endpoint ? { endpoint: env.vizS3Endpoint } : {}),
    region: env.vizS3Region,
    accessKeyId: requireEnv('vizS3AccessKeyId'),
    secretAccessKey: requireEnv('vizS3SecretAccessKey'),
    bucket: env.vizS3Bucket,
    forcePathStyle: !!env.vizS3Endpoint,
  });

  return vizSingleton;
}

/** Test-only: swap in a different impl. Never call from product code. */
export function __setStorageForTests(storage: Storage): void {
  singleton = storage;
  vizSingleton = null;
}

export { S3Storage } from './s3';
export type { PutOptions, Storage, StorageEntry } from './types';
