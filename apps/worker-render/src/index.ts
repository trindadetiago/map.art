#!/usr/bin/env node
import '@mapart/env';
import { type Job, claimNextJob, completeJob, failJob } from '@mapart/db/repos';
import { getStorage } from '@mapart/storage';
import { type RenderPayload, renderTile } from './renderer.js';

const WORKER_ID = `render-${process.pid}-${Date.now()}`;
const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT = 2;

let running = 0;

async function processJob(job: Job) {
  try {
    console.log(
      `[${WORKER_ID}] Rendering tile (${job.col}, ${job.row}) for project ${job.projectId}`,
    );
    const pngBuffer = await renderTile(job.payload as RenderPayload);

    const key = `projects/${job.projectId}/render/${job.col}_${job.row}.png`;
    const storage = await getStorage();
    await storage.put(key, pngBuffer);

    await completeJob(job.id, null, { storageKey: key });
    console.log(`[${WORKER_ID}] Done: ${key} (${pngBuffer.length} bytes)`);
  } catch (err) {
    console.error(`[${WORKER_ID}] Failed:`, err);
    await failJob(job.id, String(err));
  } finally {
    running--;
  }
}

async function tick() {
  while (running < MAX_CONCURRENT) {
    const job = await claimNextJob('render', WORKER_ID);
    if (!job) break;
    running++;
    processJob(job);
  }
}

let alive = true;
process.on('SIGTERM', () => {
  alive = false;
});
process.on('SIGINT', () => {
  alive = false;
});

console.log(`[${WORKER_ID}] Worker started`);

async function loop() {
  while (alive) {
    try {
      await tick();
    } catch (err) {
      console.error(`[${WORKER_ID}] Tick error:`, err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`[${WORKER_ID}] Shutting down`);
}

loop().catch((e) => {
  console.error(`[${WORKER_ID}] Fatal:`, e);
  process.exit(1);
});
