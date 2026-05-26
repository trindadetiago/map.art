# @mapart/worker

Background-job process. **Placeholder.** Anchors the worker pattern so future render / stylize workers have a clear shape to copy.

## What it does today

Heartbeat loop. Every 5s, logs `tick #N — would claim next job here` and goes back to sleep. Handles `SIGTERM` / `SIGINT` cleanly. That's it.

## What it will eventually do

Per [`docs/architecture.html`](../../docs/architecture.html):

```
loop:
  job = SELECT … FOR UPDATE SKIP LOCKED FROM jobs WHERE deps_done LIMIT 1
  if !job: sleep, continue
  execute job (render tile / call model / …)
  write outputs to @mapart/storage
  mark job done or failed
```

When it does, it'll probably split into `apps/worker-render` (Three.js + Chromium, RAM-heavy) and `apps/worker-stylize` (model HTTP client, lightweight). See the architecture doc for the reasoning.

## Run

Part of `pnpm dev` (mprocs proc named `worker`).

Standalone:

```bash
pnpm dev:worker        # via root script
pnpm --filter @mapart/worker dev
```
