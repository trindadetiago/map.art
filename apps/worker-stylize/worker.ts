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
  // oxen needs a publicly-fetchable input URL for the composite in the S3
  // bucket. On Railway the bucket endpoint is internet-reachable, so a
  // presigned GET URL works directly; locally MinIO is not, so the URL goes
  // through the ngrok tunnel. Without an oxen key we stay on the
  // pass-through stub.
  if (env.oxenApiKey) {
    const storage = getStorage();
    const bucket = requireEnv('s3Bucket');
    // Inputs uploaded during a generate call, deleted once it returns — oxen
    // fetches the composite during the call, so afterwards the object is dead
    // weight in the bucket.
    const pendingInputs = new Set<string>();
    const oxen = new OxenImageModel({
      model: OXEN_MODEL_ID,
      apiKey: env.oxenApiKey,
      uploadImage: async (image) => {
        const key = `oxen-input/${randomUUID()}.png`;
        await storage.put(key, image);
        pendingInputs.add(key);
        const url = env.railwayEnvironmentName
          ? await storage.presignGet(key)
          : `${ngrokBase()}/${bucket}/${key}`;
        console.log(`[${WORKER_NAME}] composite uploaded → ${url}`);
        return url;
      },
    });
    return {
      name: oxen.name,
      async generate(params) {
        try {
          return await oxen.generate(params);
        } finally {
          const keys = [...pendingInputs];
          pendingInputs.clear();
          void Promise.all(keys.map((k) => storage.delete(k).catch(() => {})));
        }
      },
    };
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
