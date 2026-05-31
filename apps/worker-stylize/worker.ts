/**
 * apps/worker-stylize — server-side stylize service.
 *
 * Runs the stylize-queue consumer (./consumer.ts): claims stylize-ready tiles,
 * builds the Algorithm-A composite, runs the model, crops the result, writes the
 * PNG to storage, marks the tile done. No HTTP surface.
 *
 * Uses StubImageModel, which echoes the composite back unchanged so the pipeline
 * runs with no GPU, key, or cost. Swap in a different ModelClient implementation
 * to drive a real inference backend.
 */
import '@mapart/env';
import { closeDb } from '@mapart/db';
import { StubImageModel } from '@mapart/models';
import { IDLE_POLL_MS, type StylizeConsumer, startStylizeConsumer } from './consumer';

const WORKER_NAME = `stylize-worker-${process.pid}`;

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

function main(): void {
  const model = new StubImageModel();
  consumer = startStylizeConsumer(model, (m) => console.log(`[${WORKER_NAME}] ${m}`));
  console.log(
    `[${WORKER_NAME}] queue consumer started (idle poll ${IDLE_POLL_MS / 1000}s, model=${model.name})`,
  );
}

main();
