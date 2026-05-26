import { requireEnv } from '@mapart/env';
import { PgBoss } from 'pg-boss';
import type { RenderTilePayload, StylizeTilePayload } from './types';
import { QUEUE_NAMES } from './types';

const globalKey = Symbol.for('@mapart/queue:pg-boss');

function getBoss(): PgBoss {
  const existing = (globalThis as Record<symbol, PgBoss | undefined>)[globalKey];
  if (existing) return existing;

  const url = requireEnv('databaseUrl');
  const boss = new PgBoss({
    connectionString: url,
    monitorStateIntervalSeconds: 5,
    retryLimit: 2,
    retryDelay: 30,
  });
  (globalThis as Record<symbol, PgBoss>)[globalKey] = boss;
  return boss;
}

export async function startQueue(): Promise<PgBoss> {
  const b = getBoss();
  if (b.started) return b;
  await b.start();
  return b;
}

export async function stopQueue(): Promise<void> {
  const b = (globalThis as Record<symbol, PgBoss | undefined>)[globalKey];
  if (b) {
    await b.stop();
    delete (globalThis as Record<symbol, PgBoss | undefined>)[globalKey];
  }
}

function validateIdempotencyKey(key: string | undefined): string {
  if (!key) throw new Error('idempotencyKey is required');
  return key;
}

export async function enqueueRender(payload: RenderTilePayload): Promise<string | null> {
  const b = getBoss();
  return b.send(QUEUE_NAMES.RENDER, payload, {
    singletonKey: validateIdempotencyKey(payload.idempotencyKey),
  });
}

export async function enqueueStylize(payload: StylizeTilePayload): Promise<string | null> {
  const b = getBoss();
  return b.send(QUEUE_NAMES.STYLIZE, payload, {
    singletonKey: validateIdempotencyKey(payload.idempotencyKey),
  });
}

export { QUEUE_NAMES, type RenderTilePayload, type StylizeTilePayload };
