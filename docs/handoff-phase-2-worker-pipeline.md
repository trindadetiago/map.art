# Phase 2 Handoff: Worker Pipeline

**Date:** 2026-06-11
**Status:** Core workers built, jobs table extended, tile serving API in place. Not yet wired to the browser UI.

---

## 1. Architecture Overview

```
                    ┌──────────────────────┐
                    │     apps/web          │
                    │  POST /api/v1/...     │  creates jobs
                    │  GET  /api/v1/tiles/  │  serves results
                    │  GET  .../status      │  progress polling
                    └────────┬─────────────┘
                             │
                    ┌────────▼─────────────┐
                    │    Postgres (jobs)     │
                    │  status=pending        │
                    │  kind=render | generate│
                    └──┬──────────────┬─────┘
                       │              │
              ┌────────▼─────┐  ┌─────▼──────────┐
              │ worker-render │  │ worker-stylize │
              │ (Puppeteer)   │  │ (OpenAI models)│
              │               │  │                 │
              │ Render 3D tile│  │ Build infill    │
              │ via headless  │  │ composite, call │
              │ Chrome +      │  │ model edit API, │
              │ Three.js      │  │ crop, save      │
              └──────┬────────┘  └─────┬──────────┘
                     │                 │
                     ▼                 ▼
              ┌──────────────────────────────┐
              │   S3 / MinIO / local FS      │
              │   projects/{id}/render/*.png  │
              │   pipeline/{id}/rendered/*.png│
              │   pipeline/{id}/generated/... │
              └──────────────────────────────┘
```

**Key principle:** Workers are the only writers to blob storage. Browser only reads via the tile API.

---

## 2. What Was Built

### 2.1 Jobs table extension (`packages/db/drizzle/0001_loose_sir_ram.sql`)

Added columns: `priority`, `depends_on`, `scheduled_at`, `started_at`, `finished_at`, `cost_cents`, `duration_ms`, `worker_version`.

Added 3 indexes:
- `jobs_poll_idx` — covers the hot-path `claimNextJob` query (`priority ASC, created_at ASC` WHERE `status='pending'`)
- `jobs_project_status_idx` — project-scoped status lookups
- `jobs_stuck_idx` — detects jobs stuck in `claimed` for >5 min (for future stale-job reaper)

**Job kinds** (enum `job_kind`): `render`, `generate`, `regenerate`
**Job statuses** (enum `job_status`): `pending`, `claimed`, `done`, `failed`, `cancelled`

### 2.2 Job repository (`packages/db/src/repos/jobs.ts`)

All operations use raw SQL for database-level concurrency control.

| Function | What it does |
|---|---|
| `createJob(input)` | INSERT a new job row. Returns the full Job. |
| `getJob(id)` | SELECT by id. |
| `claimJob(id, workerId)` | UPDATE status→claimed for a specific job (only if pending + under maxAttempts). Returns the job or undefined. |
| `claimNextJob(kind, workerId)` | Atomic claim using `FOR UPDATE SKIP LOCKED`. Picks the highest-priority pending job, marks it claimed, sets `started_at`. Returns the job or null. |
| `completeJob(id, versionId, progress)` | UPDATE status→done, set `result_version_id`, merge progress into payload. |
| `failJob(id, error)` | UPDATE status→failed, store error message. |
| `listJobsForProject(projectId, opts)` | List jobs for a project, optionally filtered by status. |

### 2.3 Tile version repository (`packages/db/src/repos/tiles.ts`)

| Function | What it does |
|---|---|
| `createTileVersionAndSetCurrent(input)` | Transaction: upserts a `models` row (if modelId given), inserts a `tile_versions` row, updates `tiles.current_version_id`. Returns the new version UUID. |
| `getTileStatusSummary(projectId)` | Returns `{ total, rendered, generated, pending }` — used by the status API. |
| `listTileVersionByProjectAndCoords(projectId, col, row, source)` | Finds the latest version for a given tile+source. Used by the tile serving API. |

### 2.4 worker-render (`apps/worker-render/`)

**Package:** `@mapart/worker-render` — depends on `puppeteer`, `@mapart/db`, `@mapart/env`, `@mapart/storage`.

**Entry:** `src/index.ts`
- Polls every 2s for `render` jobs via `claimNextJob('render', WORKER_ID)`
- Max 2 concurrent jobs
- For each job: calls `renderTile(payload)` → saves PNG to storage → `completeJob`
- On SIGTERM/SIGINT: stops polling, exits

**Renderer:** `src/renderer.ts`
- Manages a singleton Puppeteer browser instance (reused across jobs)
- Chrome flags: `--use-gl=swiftshader`, `--no-sandbox`, `--disable-gpu`
- `renderTile(payload)`:
  1. Opens a new page, sets viewport to `payload.size × payload.size`
  2. Loads `render-page.html` content via `page.setContent()`
  3. Injects `window.__RENDER_PARAMS__` with camera params
  4. Waits for `window.__TILES_READY__ === true` (120s timeout)
  5. Captures the canvas as PNG via base64 data URL
  6. Returns `Buffer`

**Render payload shape** (`RenderPayload`):
```ts
{ apiKey: string; center: { lat: number; lng: number }; pitch: number; yaw: number; size: number; zoom: number }
```

**render-page.html** (`src/render-page.html`)
- Self-contained HTML that loads `three@0.169.0` and `3d-tiles-renderer@0.4.8` from `esm.sh` via importmap
- Creates OrthographicCamera, WebGLRenderer, TilesRenderer with GoogleCloudAuthPlugin
- Uses same camera math (`applyFrustum`, `positionCamera`) as `@mapart/renderer`
- Polls for tile-set load + queue idle → sets `window.__TILES_READY__`

### 2.5 worker-stylize (`apps/worker-stylize/`)

**Package:** `@mapart/worker-stylize` — depends on `sharp`, `@mapart/db`, `@mapart/env`, `@mapart/models`, `@mapart/storage`.

**Entry:** `src/index.ts`
- Polls every 2s for `generate` jobs via `claimNextJob('generate', WORKER_ID)`
- Max 3 concurrent jobs
- For each job: loads rendered tile + neighbors from storage → calls `generateTile()` → saves result → `createTileVersionAndSetCurrent()` → `completeJob`
- On SIGTERM/SIGINT: waits for in-flight jobs to finish before exiting

**Generator:** `src/generate.ts`
- `generateTile(projectId, col, row, modelId, payload)`:
  1. Fetches the rendered tile from storage (`pipeline/{projectId}/rendered/{col}_{row}.png`)
  2. Loads up to 8 neighboring *generated* tiles (existing ones only, silently skips missing)
  3. Builds a 3×3 infill composite (1024px canvas, center slot = rendered tile, 8 neighbors around it)
  4. Creates a mask (white everywhere except the center slot is transparent)
  5. Calls `model.generate({ input: hybrid, mask, prompt })` via `@mapart/models`
  6. Crops the center 341px slot from the 1024px result
  7. Resizes if `finalTileSize` differs from `slotSize`

- **Infill strategy:** Center tile is rendered (photorealistic). Surrounding 8 slots are filled with previously generated (stylized) tiles. This ensures seamless borders between completed tiles when new tiles are generated.

### 2.6 Storage changes (`packages/storage/`)

- **New method** `presignReadUrl(key, ttlSeconds): Promise<string>` added to the `Storage` interface.
- **S3Storage** implements it via `@aws-sdk/s3-request-presigner` (`getSignedUrl`).
- **LocalFs** returns `/api/storage/{key}` (for local dev, the web app proxies storage reads).

### 2.7 API endpoints (`apps/web/`)

**`GET /api/v1/tiles/[...path]`** (`apps/web/app/api/v1/tiles/[...path]/route.ts`)
- Path format: `/[projectId]/[representation]/[col]_[row].png`
  Example: `/v1/tiles/abc-123/generated/5_3.png`
- Looks up `tile_versions` by project+col+row+source
- If the presigned URL starts with `http`: 302 redirect (S3/MinIO)
- If local path: serves the buffer directly with `Content-Type: image/png`
- Cache headers: `Cache-Control: public, max-age=31536000, immutable`, `ETag`
- 404 if tile version not found

**`GET /api/v1/projects/[projectId]/tiles/status`** (`apps/web/app/api/v1/projects/[projectId]/tiles/status/route.ts`)
- Returns `{ total: number, rendered: number, generated: number, pending: number }`
- Used by the frontend to show progress bars

### 2.8 Dev runner (`mprocs.yaml`)

Added two new processes:
```
worker-render:   "node scripts/run.mjs worker-render -- pnpm --filter @mapart/worker-render dev"
worker-stylize:  "node scripts/run.mjs worker-stylize -- pnpm --filter @mapart/worker-stylize dev"
```

Logs output to `.logs/worker-render.log` and `.logs/worker-stylize.log`.

---

## 3. How to Run

### 3.1 Install dependencies

```bash
pnpm install
```

New dependencies brought in by Phase 2:
- `puppeteer` (^24) — headless Chrome for worker-render
- `sharp` (^0.33) — image manipulation for worker-stylize
- `@aws-sdk/s3-request-presigner` — presigned URLs for S3 storage backend

Puppeteer downloads Chromium automatically on install (~300MB).

### 3.2 Apply database migration

```bash
pnpm db:migrate
```

This runs migration `0001_loose_sir_ram.sql` which adds the new columns and indexes to the `jobs` table.

### 3.3 Start workers

**Via mprocs (all services):**
```bash
pnpm dev
```
Then in the TUI: `j`/`k` to switch between web/worker/studio/worker-render/worker-stylize.

**Standalone:**
```bash
# Worker-render only
pnpm dev:worker-render

# Worker-stylize only (note: must use pnpm filter directly)
pnpm --filter @mapart/worker-stylize dev
```

**Note:** `dev:worker-stylize` is in `mprocs.yaml` but currently missing from root `package.json` scripts. Add it manually:
```bash
pnpm dev:worker-stylize   # won't work yet; use the filter command above
```

### 3.4 Start the web app (if not using mprocs)

```bash
pnpm dev:web
```

---

## 4. Job Flow

### Render job lifecycle

```
1. API call creates job (status=pending, kind=render)
2. worker-render calls claimNextJob('render', ...)
   → FOR UPDATE SKIP LOCKED picks the job, marks claimed
3. renderTile(payload):
   a. Puppeteer opens page, loads render-page.html
   b. Three.js + 3d-tiles-renderer load Google 3D Tiles
   c. Camera positioned, frustum applied
   d. Wait for __TILES_READY__ signal
   e. Capture canvas → PNG Buffer
4. storage.put('projects/{projectId}/render/{col}_{row}.png', pngBuffer)
5. completeJob(job.id, null, { storageKey })
   → status becomes 'done'
6. (Separate flow) A 'generate' job is created for this tile
```

### Generate job lifecycle

```
1. API call creates job (status=pending, kind=generate)
2. worker-stylize calls claimNextJob('generate', ...)
3. generateTile():
   a. Load rendered tile from storage: pipeline/{projectId}/rendered/{col}_{row}.png
   b. Load up to 8 neighboring generated tiles (if they exist)
   c. Build 1024×1024 infill composite:
      ┌─────────┬─────────┬─────────┐
      │ gen(-1,1)│ gen(0,1) │ gen(1,1) │
      ├─────────┼─────────┼─────────┤
      │ gen(-1,0)│ render  │ gen(1,0) │  ← mask transparent on center
      ├─────────┼─────────┼─────────┤
      │ gen(-1,-1)│gen(0,-1)│gen(1,-1)│
      └─────────┴─────────┴─────────┘
   d. Call model.generate({ input: hybrid, mask, prompt })
   e. Crop center 341×341 slot from 1024×1024 result
   f. Resize if needed
4. storage.put('pipeline/{projectId}/generated/manual/{col}_{row}.png', pngBuffer)
5. createTileVersionAndSetCurrent({ source: 'generated', storageKey, ... })
   → updates tiles.current_version_id
6. completeJob(job.id, versionId, { storageKey })
```

---

## 5. Configuration

### Environment variables

All existing env vars (`packages/env/src/schema.ts`) apply. Phase 2 uses these existing keys — no new ones were added:

| Variable | Used by | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | worker-render | Passed as `apiKey` in RenderPayload. Must have Map Tiles API enabled. |
| `OPENAI_API_KEY` | worker-stylize | Passed as `apiKey` in GenerateJobPayload. Used for image editing. |
| `STORAGE_BACKEND` | both workers | `s3` or `local`. Controls where tiles are stored. |
| `S3_*` vars | both workers | Required when `STORAGE_BACKEND=s3`. |
| `DATABASE_URL` | both workers | Postgres connection. |

### Puppeteer dependencies

Puppeteer auto-downloads Chromium. On Linux servers, you may need system libs:
```bash
# Debian/Ubuntu
apt-get install ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
  libcups2 libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 \
  libxfixes3 libxkbcommon0 libxrandr2 xdg-utils
```

The render page loads Three.js from `esm.sh` CDN at runtime — workers need internet access.

---

## 6. Known Issues & Limitations

### Bug: Storage key format mismatch

The render worker saves tiles to:
```
projects/{projectId}/render/{col}_{row}.png
```

But the stylize worker reads rendered tiles from:
```
pipeline/{projectId}/rendered/{col}_{row}.png
```

**These don't match.** The stylize worker will fail with "rendered tile not found" for any tile rendered by the render worker. Fix: align the key format in both workers (pick one convention — `pipeline/...` is the "modern" one from the stylize worker).

### Missing root package.json script

`dev:worker-stylize` exists in `mprocs.yaml` but is missing from root `package.json`. Add:
```json
"dev:worker-stylize": "pnpm --filter @mapart/worker-stylize dev"
```

### No job creation plumbing

The workers poll for jobs, but nothing in `apps/web` currently creates `render` or `generate` jobs. The old flow in `project_workspace.tsx` captures tiles in-browser and calls the model directly. These flows need to be replumbed to create jobs instead.

### No retry/recovery for stuck jobs

The `jobs_stuck_idx` index exists but no process runs `UPDATE jobs SET status='pending' WHERE ...` for jobs stuck in `claimed` for >5min. The worker loop has no retry logic for failed jobs either — once `failJob` is called, the job stays failed forever.

### No job dependency enforcement

The `depends_on` column and `scheduled_at` exist in the schema, but `claimNextJob` doesn't check them. A generate job can be claimed before its render predecessor finishes. The application layer must only create generate jobs after render completes.

### Network dependency for rendering

`render-page.html` loads Three.js from `esm.sh` CDN. Offline/dev-air-gapped environments won't work. Consider bundling the render page or pinning to a local copy.

### No SSE/progress endpoint

There's no way for the frontend to watch individual job progress in real time. The `GET .../tiles/status` endpoint gives aggregate counts, but no per-tile streaming updates.

### MAX_CONCURRENT is hardcoded

Render worker allows 2 concurrent, stylize allows 3. These should be env-configurable for different machine sizes.

### No WebP conversion

All tiles are stored as PNG. The RFC calls for WebP (lossless) for 50-70% smaller files. `sharp` is already a dependency — the conversion step just hasn't been added.

---

## 7. Next Steps (Phase 3)

### Immediate (fixes)
1. **Fix storage key mismatch** — unify on `pipeline/{projectId}/rendered/{col}_{row}.png` everywhere
2. **Add `dev:worker-stylize` to root package.json**
3. **Wire job creation** — replace browser-side capture in `project_workspace.tsx` with job creation API calls

### Short-term (Phase 2 completion)
4. **Stuck-job reaper** — a periodic query that resets `claimed→pending` for jobs stuck >5min
5. **Retry logic** — `failJob` should check `attempts < maxAttempts` and reset to `pending` with `scheduled_at` delay
6. **SSE progress endpoint** — `GET /api/v1/jobs/[id]/progress` for real-time per-tile updates
7. **Env-configurable concurrency** — `RENDER_CONCURRENCY`, `STYLIZE_CONCURRENCY` env vars

### Medium-term (Phase 3 proper)
8. **DZI export pipeline** — stitch generated tiles into a composite, export DZI pyramid with nearest-neighbor downscaling
9. **OpenSeadragon viewer** — replace the browser's 3D map with a 2D DZI viewer (no Three.js, no WebGL)
10. **WebP migration** — convert PNG→WebP lossless at save time
11. **CDN setup** — Cloudflare R2 (S3-compatible, zero egress)

### Key files to touch next

| File | What to do |
|---|---|
| `apps/worker-render/src/index.ts:20` | Change storage key to `pipeline/...` format |
| `apps/web/.../project_workspace.tsx` | Replace capture with job creation |
| `apps/web/.../route.ts` (new) | `POST /api/v1/jobs` to create jobs |
| `root package.json` | Add `dev:worker-stylize` script |
| `packages/db/src/repos/jobs.ts` | Add `resetStuckJobs()`, retry-on-fail logic |
