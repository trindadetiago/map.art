/**
 * apps/worker-stylize — server-side stylize service.
 *
 * Runs the stylize-queue consumer (./consumer.ts): claims stylize-ready tiles,
 * builds the Algorithm-A composite, runs the model, crops the result, writes the
 * PNG to storage, marks the tile done. No HTTP surface.
 *
 * Model selection: when OXEN_API_KEY is set, runs the deployed oxen.ai
 * image-edit model (OXEN_MODEL_ID); otherwise falls back to StubImageModel,
 * which echoes the composite back unchanged so the pipeline runs with no GPU,
 * key, or cost.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeDb } from '@mapart/db';
import { env, findRepoRoot, requireEnv } from '@mapart/env';
import { type ModelClient, OxenImageModel, StubImageModel } from '@mapart/models';
import { getStorage } from '@mapart/storage';
import { IDLE_POLL_MS, type StylizeConsumer, startStylizeConsumer } from './consumer';

/** Deployed oxen.ai image-edit model that backs the stylize phase. */
const OXEN_MODEL_ID = 'trindadetiago-linguistic-amaranth-clam';

const WORKER_NAME = `stylize-worker-${process.pid}`;

/**
 * Public base URL for MinIO objects, written by the `ngrok` process to
 * <repo>/.ngrok-url. Read fresh per upload so a tunnel that comes up (or
 * rotates) after the worker starts is picked up without a restart.
 */
function ngrokBase(): string {
  const url = readFileSync(resolve(findRepoRoot(), '.ngrok-url'), 'utf8').trim();
  if (!url) throw new Error('.ngrok-url is empty — is the ngrok process running?');
  return url.replace(/\/$/, '');
}

let consumer: StylizeConsumer | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${WORKER_NAME}] shutting down (${signal})`);
  if (consumer) {
    consumer.stop();
    await consumer.done.catch(() => {});
  }
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

function buildModel(): ModelClient {
  // oxen needs a publicly-fetchable input URL; that path is wired for the s3
  // (MinIO) backend + ngrok tunnel only. Anything else stays on the stub.
  if (env.oxenApiKey && env.storageBackend === 's3') {
    const storage = getStorage();
    const bucket = requireEnv('s3Bucket');
    return new OxenImageModel({
      model: OXEN_MODEL_ID,
      apiKey: env.oxenApiKey,
      uploadImage: async (image) => {
        const key = `oxen-input/${randomUUID()}.png`;
        await storage.put(key, image);
        const url = `${ngrokBase()}/${bucket}/${key}`;
        console.log(`[${WORKER_NAME}] composite uploaded → ${url}`);
        return url;
      },
    });
  }
  return new StubImageModel();
}

function main(): void {
  const model = buildModel();
  consumer = startStylizeConsumer(model, (m) => console.log(`[${WORKER_NAME}] ${m}`));
  console.log(
    `[${WORKER_NAME}] queue consumer started (idle poll ${IDLE_POLL_MS / 1000}s, model=${model.name})`,
  );
}

main();
