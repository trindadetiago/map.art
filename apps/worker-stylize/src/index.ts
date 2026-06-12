import '@mapart/env';
import {
  type Job,
  claimNextJob,
  completeJob,
  createTileVersionAndSetCurrent,
  failJob,
} from '@mapart/db/repos';
import { getStorage } from '@mapart/storage';
import { type GenerateJobPayload, generateTile } from './generate.js';

const WORKER_ID = `stylize-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT = 3;

let running = 0;
let shuttingDown = false;

function log(msg: string): void {
  console.log(`[${WORKER_ID}] ${new Date().toISOString()} ${msg}`);
}

function generatedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/generated/manual/${col}_${row}.png`;
}

function renderedTileKey(projectId: string, col: number, row: number): string {
  return `pipeline/${projectId}/rendered/${col}_${row}.png`;
}

async function processNext(): Promise<void> {
  if (running >= MAX_CONCURRENT) return;

  const job = await claimNextJob('generate', WORKER_ID);
  if (!job) return;

  running++;
  log(`claimed job ${job.id} — tile (${job.col}, ${job.row}) for project ${job.projectId}`);

  processJob(job).finally(() => {
    running--;
  });
}

async function processJob(job: Job): Promise<void> {
  try {
    const payload = job.payload as GenerateJobPayload;
    if (!payload.prompt) throw new Error('job payload missing prompt');
    if (!payload.apiKey) throw new Error('job payload missing apiKey');

    const pngBuffer = await generateTile(
      job.projectId,
      job.col,
      job.row,
      job.modelId ?? 'gpt-image-1.5',
      payload,
    );

    const storageKey = generatedTileKey(job.projectId, job.col, job.row);
    const storage = getStorage();
    await storage.put(storageKey, pngBuffer);

    const versionId = await createTileVersionAndSetCurrent({
      projectId: job.projectId,
      col: job.col,
      row: job.row,
      source: 'generated',
      storageKey,
      modelId: job.modelId,
      prompt: payload.prompt,
      referenceStorageKey: renderedTileKey(job.projectId, job.col, job.row),
    });

    await completeJob(job.id, versionId, { storageKey });
    log(`done job ${job.id} — ${storageKey} (${pngBuffer.length} bytes)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`failed job ${job.id}: ${msg}`);
    await failJob(job.id, msg);
  }
}

async function main(): Promise<void> {
  log('starting');

  process.on('SIGTERM', () => {
    log('SIGTERM — shutting down');
    shuttingDown = true;
  });
  process.on('SIGINT', () => {
    log('SIGINT — shutting down');
    shuttingDown = true;
  });

  while (!shuttingDown) {
    try {
      await processNext();
    } catch (e) {
      log(`tick error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  log('waiting for in-flight jobs to finish...');
  while (running > 0) {
    await new Promise((r) => setTimeout(r, 500));
  }
  log('stopped');
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
