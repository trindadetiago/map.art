import '@mapart/env';

const TICK_MS = 5000;

let ticks = 0;
let running = true;

function log(msg: string): void {
  console.log(`[worker] ${new Date().toISOString()} ${msg}`);
}

async function tick(): Promise<void> {
  ticks += 1;
  // Placeholder. When this worker actually does work, replace with:
  //   1. claimNextJob() against the Postgres jobs table (SELECT FOR UPDATE SKIP LOCKED)
  //   2. dispatch by job.type (render / stylize / …)
  //   3. write outputs to @mapart/storage, mark job done/failed
  log(`tick #${ticks} — would claim next job here`);
}

async function main(): Promise<void> {
  log('starting');
  process.on('SIGTERM', () => {
    log('SIGTERM — shutting down');
    running = false;
  });
  process.on('SIGINT', () => {
    log('SIGINT — shutting down');
    running = false;
  });

  while (running) {
    try {
      await tick();
    } catch (e) {
      log(`tick error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  log('stopped');
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
