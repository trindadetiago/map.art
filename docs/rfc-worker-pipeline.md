## WORKER & DATA PIPELINE

### 1. Current State Analysis

#### 1.1 What happens today (all sync, all in browser)

The critical path for a single tile is entirely browser-driven and sequential:

1. **Camera setup + 3D streaming** — Google 3D Tiles stream into a hidden `<Scene>` (`Scene` component at `apps/web/components/scene.tsx`) rendered off-screen at `left: -99999; top: -99999`. This is a full Three.js renderer using `3d-tiles-renderer` with `GoogleCloudAuthPlugin`, `ReorientationPlugin`, `TileCompressionPlugin`, and `UpdateOnChangePlugin`.

2. **Tile capture** (`project_workspace.tsx:359-396`) — When a tile is clicked or the bulk runner iterates, the code:
   - Computes `RenderParams` via `renderParamsForTile()` (`@mapart/shared`)
   - Calls `scene.waitForSettled({ settleMs: 600, timeoutMs: 20000 })` — blocks until 3D tiles finish loading
   - Calls `scene.capture()` which does a `gl.readPixels` from the WebGL framebuffer
   - Extracts the `dataUrl`, converts to `Blob` via `fetch`, then sends to server via `FormData`

3. **Save to storage** (`page.tsx:21-65`) — The server action `saveTileAction`:
   - Receives the multipart form with `projectId`, `col`, `row`, `png` blob
   - Writes to storage at `pipeline/{projectId}/rendered/{col}_{row}.png`
   - Inserts a `tile_versions` row with `source = 'rendered'` and updates `tiles.current_version_id`

4. **AI stylization** (`page.tsx:71-106` or `page.tsx:114-243`) — A second server action (`generateTileAction` or `generateTileInfillAction`):
   - Reads the rendered PNG back from storage
   - Optionally assembles a 3×3 hybrid + mask for context-aware infill (uses Sharp for composition)
   - Calls OpenAI via `@mapart/models` (gpt-image-1.5 or gpt-image-2)
   - Writes output to `pipeline/{projectId}/generated/manual/{col}_{row}.png`
   - Inserts a `tile_versions` row with `source = 'generated'`

5. **Bulk generation** (`project_workspace.tsx:526-549`) — The "generate missing" button iterates tiles **one at a time, sequentially**, with no parallelism and no background processing. A 10×10 grid takes ~2 minutes of wall-clock time just for capture (20+ settle calls at ~600ms each), then another ~2-3 minutes for sequential model calls.

#### 1.2 What the worker does today

`apps/worker/src/index.ts` is a 46-line heartbeat loop:

```typescript
// Ticks every 5000ms, logs a placeholder line, does nothing else.
// Comment in the file explicitly states:
//   "When this worker actually does work, replace with:
//    1. claimNextJob() against the Postgres jobs table (SELECT FOR UPDATE SKIP LOCKED)
//    2. dispatch by job.type (render / stylize / …)
//    3. write outputs to @mapart/storage, mark job done/failed"
```

The worker has zero dependencies beyond `@mapart/env`. It does not import `@mapart/db`, `@mapart/storage`, or `@mapart/renderer`.

#### 1.3 What already exists that we can leverage

| Capability | Package/File | Maturity | Notes |
|---|---|---|---|
| Job table schema | `packages/db/src/schema/jobs.ts` | Ready | Has `kind (render/generate/regenerate)`, `status (pending/claimed/done/failed/cancelled)`, `attempts`, `claimed_by`, `idempotency_key`, `result_version_id` |
| Job CRUD ops | `packages/db/src/repos/jobs.ts` | Ready | `createJob`, `claimJob`, `completeJob`, `failJob`, `listJobsForProject` — but no `claimNextJob()` / `SELECT FOR UPDATE SKIP LOCKED` yet |
| Tile version tracking | `packages/db/src/schema/tile-versions.ts` | Ready | Links storage keys to tiles with source type, model, prompt, input hash |
| Blob storage | `packages/storage/src/` | Ready (prod) | S3/MinIO backend with `put/get/has/delete/list` |
| Headless rendering | `packages/renderer/src/` | **Browser-only** | Uses Three.js WebGL — cannot run in plain Node.js |
| AI model clients | `packages/models/src/` | Ready | OpenAI generate + edit clients with unified interface |
| Generation strategies | `packages/pipeline/src/` | Ready (research) | `independent` and `context-border` strategies run synchronously; no parallelism baked in |
| Tile math | `packages/tiles/` + `packages/shared/` | Ready | `renderParamsForTile`, `tileGroundOffset`, web-mercator tile math |
| Image processing | `packages/pipeline/src/stitch.ts` | Ready | Sharp-based tile stitching and seam overlay |

#### 1.4 Key pain points

- **Browser must stay open.** If the user closes the tab or navigates away, all in-progress captures and generations are lost. No persistence, no resumption.
- **No parallelism.** 100 tiles = 100 sequential Three.js settle(waitForSettled) calls + 100 sequential model API calls. This is 100× the latency instead of the throughput-limited optimum.
- **No retry surface.** If a model call fails or a 3D tile stream times out, the error is shown in ephemeral browser state. No automatic retry, no dead-letter queue.
- **WebGL context fragility.** The off-screen `<Scene>` relies on a browser WebGL context that can be lost, throttled by background tabs, or limited by GPU memory.
- **No partial progress persistence.** If the bulk runner fails at tile 47/100, the first 46 rendered tiles are saved to storage, but there's no record of which tiles still need styling, and the bulk runner starts from scratch next time.
- **Workers are not wired to anything.** The `apps/worker` process exists but is disconnected from the pipeline entirely.

---

### 2. Proposed Job Queue Architecture

#### 2.1 Job types

Extend the existing `job_kind` enum (currently `render`, `generate`, `regenerate`) to:

```sql
-- Migration: ALTER TYPE job_kind ADD VALUE 'generate' AFTER 'render';
-- Migration: ALTER TYPE job_kind ADD VALUE 'infill' AFTER 'generate';
-- Migration: ALTER TYPE job_kind ADD VALUE 'export' AFTER 'infill';

-- New enum values:
--   render       — capture a 3D tile to a rendered PNG in blob storage
--   generate     — stylize a rendered tile independently (no neighbor context)
--   infill       — stylize a rendered tile with neighbor context (GPT infill/editing)
--   export       — stitch all generated tiles into a final composite + DZI pyramid
--   (existing)   — regenerate (re-run a previously completed job)
```

Each job corresponds to exactly one tile (except `export` which is project-scoped). This makes retries, idempotency, and parallelism straightforward.

#### 2.2 Job schema (using the existing `jobs` table)

The `jobs` table at `packages/db/src/schema/jobs.ts` already has the right shape. We add two fields to the `payload` JSONB convention and one index:

```sql
-- Existing table (no structural changes needed):
-- jobs (
--   id UUID PK DEFAULT gen_random_uuid(),
--   project_id UUID NOT NULL REFERENCES projects ON DELETE CASCADE,
--   kind job_kind NOT NULL,
--   col INTEGER NOT NULL,
--   row INTEGER NOT NULL,
--   model_id TEXT REFERENCES models ON DELETE SET NULL,
--   payload JSONB NOT NULL DEFAULT '{}',
--   status job_status NOT NULL DEFAULT 'pending',
--   attempts INTEGER NOT NULL DEFAULT 0,
--   max_attempts INTEGER NOT NULL DEFAULT 3,
--   claimed_by TEXT,
--   claimed_at TIMESTAMPTZ,
--   idempotency_key TEXT UNIQUE,
--   result_version_id UUID REFERENCES tile_versions ON DELETE SET NULL,
--   error TEXT,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- );

-- New index for worker polling:
CREATE INDEX idx_jobs_poll
  ON jobs (status, kind, created_at)
  WHERE status = 'pending';

-- Payload convention per job kind:
-- render:   { "prompt": "…", "strategy": "context-border", "tilePixelSize": 512, "pitch": 30, "yaw": 45, "tileWorldMeters": 150, "zoom": 18.5 }
-- generate: { "prompt": "…", "modelName": "gpt-image-2", "renderedStorageKey": "pipeline/…/rendered/0_0.png" }
-- infill:   { "prompt": "…", "modelName": "gpt-image-2", "slotSize": 341, "finalTileSize": 512, "renderedStorageKey": "…", "neighborStorageKeys": ["…","…"], "strategy": "context-border" }
-- export:   { "strategy": "context-border", "format": "dzi" }
```

#### 2.3 Worker pool design

**Claiming pattern — `SELECT FOR UPDATE SKIP LOCKED`:**

```typescript
// New repo function: repos.claimNextJob(workerName, kinds?)
export async function claimNextJob(
  workerName: string,
  kinds?: JobKind[],
): Promise<Job | undefined> {
  const rows = await getSql()<Job[]>`
    WITH next_job AS (
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND attempts < max_attempts
        ${kinds ? sql`AND kind = ANY(${kinds}::job_kind[])` : sql``}
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE jobs
    SET status = 'claimed',
        claimed_by = ${workerName},
        claimed_at = now(),
        attempts = attempts + 1,
        updated_at = now()
    FROM next_job
    WHERE jobs.id = next_job.id
    RETURNING jobs.*
  `;
  return rows[0];
}
```

**Worker pool design:**

- **Single process, multi-worker (Phase 1).** The `apps/worker` process runs N concurrent "worker slots" in a single Node.js event loop. Each slot is a lightweight coroutine (async loop) that:
    1. Calls `claimNextJob()` with a short timeout
    2. Dispatches to the appropriate handler based on `job.kind`
    3. On success: calls `completeJob()` with `resultVersionId` and writes output to storage
    4. On failure: calls `failJob()` with error message; if `attempts < max_attempts`, resets status to `pending` for retry

- **Concurrency factor.** Start with `WORKER_CONCURRENCY=4`. Rationale:
  - RENDER jobs are I/O-bound (WebGL rendering + storage write), not CPU-bound
  - GENERATE/INFILL jobs are I/O-bound (OpenAI API calls)
  - More workers than CPU cores is fine because they spend most time waiting
  - Tune upward once we have production metrics

- **Multi-process (Phase 2).** For production, spawn N separate Node.js processes (via `cluster` or Docker replicas), each with its own concurrency. PostgreSQL's `SKIP LOCKED` ensures no two workers claim the same job.

#### 2.4 Retry logic and failure handling

```
                 ┌─────────┐
   createJob ──→ │ pending │
                 └────┬────┘
                      │ claimNextJob()
                 ┌────▼────┐
                 │ claimed │──→ timeout (5 min) ──→ reset to pending
                 └────┬────┘
                  ┌───┴───┐
                  │       │
              success   failure
                  │       │
            ┌─────▼──┐ ┌─▼──────┐
            │  done  │ │ failed │
            └────────┘ └───┬────┘
                           │ attempts < max_attempts?
                           │ YES: reset to pending (exponential backoff)
                           │ NO:  stay failed (dead letter)
                           │
                     ┌─────▼──────┐
                     │ cancelled  │  (user-requested)
                     └────────────┘
```

**Exponential backoff schedule:**

```typescript
function backoffDelay(attempt: number): number {
  // 0s, 15s, 60s, 4m, 15m, 30m (capped)
  const delays = [0, 15_000, 60_000, 240_000, 900_000, 1_800_000];
  return delays[Math.min(attempt, delays.length - 1)] ?? 1_800_000;
}
```

Workers implementing backoff: after failing a job, the worker sets `status = 'pending'` with `updated_at = now() + backoff * interval '1 millisecond'`. The `claimNextJob` query adds `AND now() >= updated_at` to respect the cooldown.

**Stale claim recovery:** A separate heartbeat goroutine runs every 30s and resets any `claimed` job where `claimed_at < now() - interval '5 minutes'` back to `pending`. This handles worker crashes.

**Max attempts:** Default `max_attempts = 3` (already in schema). Override per job kind via payload.

**Idempotency:** The `idempotency_key` column (unique) prevents duplicate job creation. Key format: `{projectId}:{kind}:{col}:{row}:{modelName}:{hash of prompt}`.

---

### 3. Headless Rendering Strategy

#### 3.1 Assessment of the `@mapart/renderer` situation

`packages/renderer/src/tiles.ts` exports `createTilesRenderer(apiKey, center)` which creates a `TilesRenderer` (Three.js WebGL renderer) with four plugins. This code assumes a browser runtime — it imports from `three` and `3d-tiles-renderer/three`, both of which depend on a WebGL context.

There is no `canvas` or `OffscreenCanvas` abstraction here. The renderer is configured per-call in the browser component `Scene` (`apps/web/components/scene.tsx`), which manages the WebGL context lifecycle and provides `capture()`, `waitForSettled()`, etc.

#### 3.2 Approach: Puppeteer-based headless Chrome

**Recommendation: Puppeteer with `--headless=new` (native headless mode).**

Rationale:
- **Node.js headless-gl (`gl`/`headless-gl`)** — requires native bindings (ANGLE/Mesa EGL), notoriously fragile on macOS ARM, doesn't support the full WebGL 2.0 feature set that `3d-tiles-renderer` uses (particularly OES_texture_float for Google's 3D tile textures). Not viable.
- **Puppeteer** — launches a real headless Chrome instance. It has a complete WebGL 2.0 implementation, supports `OffscreenCanvas`, and works identically on macOS, Linux, and in Docker. The `--headless=new` flag uses the new headless mode which renders identically to headed Chrome.
- **Playwright** — equivalent to Puppeteer; both are fine. We'll use Puppeteer since it's lighter-weight for our headless-only use case.

**Architecture:**

```
apps/worker/
├── src/
│   ├── index.ts           # main entry point, starts worker pool
│   ├── pool.ts            # worker pool (N concurrent slots)
│   ├── handlers/
│   │   ├── render.ts      # RENDER handler — Puppeteer + Three.js
│   │   ├── generate.ts    # GENERATE handler — calls OpenAI
│   │   ├── infill.ts      # INFILL handler — context-aware generation
│   │   └── export.ts      # EXPORT handler — stitch + DZI
│   └── browser/
│       ├── pool.ts         # headless Chrome instance pool
│       └── render_page.ts  # HTML page served to Puppeteer with Three.js
```

**Browser pool (reuse Chrome instances across renders):**

- Maintain a pool of N headless Chrome instances (1 per render concurrency slot).
- Each instance loads a single HTML page that imports `three`, `3d-tiles-renderer`, and exposes a JS API via `window.renderTile(params)`.
- After each render, the page is reset (dispose Three.js objects, reset camera) but Chrome stays alive.
- If a render fails or Chrome crashes, recycle the instance and spin up a fresh one.

**Per-tile render flow:**

```
Worker claims RENDER job
  → Acquires browser instance from pool
  → Calls page.evaluate(`window.renderTile(${JSON.stringify(params)})`)
     which inside the page:
       1. Creates TilesRenderer with auth plugins (already have code for this)
       2. Creates WebGLRenderer with off-screen canvas
       3. Sets camera position via positionCamera() from @mapart/renderer
       4. Renders frames in requestAnimationFrame loop
       5. Waits for TilesRenderer to settle (tiles loaded)
       6. Renders one final frame
       7. Calls canvas.toDataURL('image/png')
       8. Disposes renderer and tiles
       9. Returns data URL as string
  → Converts data URL to Buffer server-side
  → Puts to storage: pipeline/{projectId}/rendered/{col}_{row}.png
  → Creates tile_version row
  → Completes job
  → Releases browser instance back to pool
```

**Dependencies to add to `apps/worker/package.json`:**

```json
{
  "dependencies": {
    "@mapart/db": "workspace:*",
    "@mapart/env": "workspace:*",
    "@mapart/models": "workspace:*",
    "@mapart/pipeline": "workspace:*",
    "@mapart/renderer": "workspace:*",
    "@mapart/shared": "workspace:*",
    "@mapart/storage": "workspace:*",
    "puppeteer": "^24.0.0",
    "sharp": "^0.33.5",
    "three": "^0.169.0",
    "3d-tiles-renderer": "^0.4.8"
  }
}
```

**Puppeteer HTML page (`apps/worker/src/browser/render_page.ts` — compiled to a string or served from localhost):**

The page imports Three.js and 3d-tiles-renderer via ES modules (from a local `node_modules` path or CDN). It exposes:

```typescript
window.renderTile = async (apiKey: string, params: RenderParams) => {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  // ... setup from @mapart/renderer
  await waitForSettled(tilesRenderer, { settleMs: 600, timeoutMs: 20000 });
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};
```

The TypeScript from `packages/renderer` can be bundled into the page script via a simple esbuild step, or (simpler) the page can load `three` and `3d-tiles-renderer` from a CDN and inline the minimal render logic.

#### 3.3 Pre-rendering vs on-demand rendering

| Approach | Pros | Cons |
|---|---|---|
| **Pre-rendering** (render all tiles when project is created/updated) | No latency for user; batch-optimizable; can use cheaper spot instances | Storage cost for N tiles × project; renders tiles the user might never look at |
| **On-demand** (render only when user clicks a tile) | No waste; instant feedback for the first tile | Latency for first render (Chrome spin-up + tile settle); unpredictable load |
| **Hybrid (recommended)** | Best of both | Slightly more complex |

**Recommendation: Hybrid with eager front.**

1. **Frontier pre-render:** When a project is created or its grid is resized, enqueue RENDER jobs for the visible-center 3×3 to 5×5 tiles (the tiles most likely to be clicked first). This gives instant first-tile feedback.
2. **On-demand queue:** User clicks on any tile → enqueue RENDER + GENERATE jobs with priority. The UI polls job status via a lightweight endpoint.
3. **Background fill:** Idle workers pull the next unrendered tile from the queue (ordered by distance from center, nearest first). This gradually fills the grid without user action.

---

### 4. Tile Caching & Storage

#### 4.1 Cache hierarchy

```
┌─────────────────────────────────────────────────────┐
│ L1: Worker memory (Map<key, Buffer>)                 │
│     Lifetime: duration of job handler invocation     │
│     Size: ~50MB per worker slot (resizeable)         │
├─────────────────────────────────────────────────────┤
│ L2: Local disk (apps/worker/.cache/)                 │
│     Lifetime: until LRU eviction or manual clear     │
│     Size: configurable (default 2GB)                 │
│     Content: rendered PNGs, generated PNGs           │
├─────────────────────────────────────────────────────┤
│ L3: Object storage (S3 / MinIO / LocalFs)            │
│     Lifetime: permanent                              │
│     Content: all rendered + generated tiles          │
│     Served to browsers via /api/storage/… proxy      │
└─────────────────────────────────────────────────────┘
```

**L1 (memory):**
- When a worker processes a RENDER job, it keeps the rendered PNG in an in-memory LRU cache keyed by `{projectId}/{col}/{row}`.
- When a subsequent INFILL job needs neighbor tiles, it checks L1 first, avoiding a storage round-trip.
- Eviction: LRU, capped at ~50MB. For 512×512 PNGs (~200KB each), that's ~250 tiles.

**L2 (local disk):**
- `sharp` operations (resize, composite, extract) are fast on local disk but slow over S3 (network round-trip).
- Before a GENERATE/INFILL job, the handler downloads all needed rendered tiles to `.cache/{projectId}/rendered/` (if not already present).
- The `context-border` strategy reads neighbor tiles from disk, not S3.
- Eviction: LRU with configurable max size (`WORKER_CACHE_MAX_MB`, default 2048). Trim after each job batch.

**L3 (object storage):**
- Permanent. Never evicted (unless user deletes a project).
- All tiles have deterministic storage keys (see §4.2), making cache validation trivial.

#### 4.2 Storage key schema

```
pipeline/
  {projectId}/
    rendered/
      {col}_{row}.png                     # raw Three.js capture
    generated/
      {strategyName}/
        {col}_{row}.png                   # final stylized tile
      {strategyName}/
        _stitched_plain.png               # full-grid stitch
        _stitched_seams.png               # stitch with seam overlay
      {strategyName}/
        _dzi/
          {level}/
            {col}_{row}.png               # DZI tile pyramid (export)
    exports/
      {strategyName}/
        {timestamp}/
          map_stitched.png                # final export: full composite
          map.dzi                         # DZI descriptor XML for OpenSeadragon
          ...
```

#### 4.3 When to cache, when to invalidate

**Cache-on-write:** Every time a worker writes a rendered or generated tile to storage, it also writes to local disk cache (if enabled) and updates the in-memory cache.

**Invalidation triggers:**

| Event | Action |
|---|---|
| Project `cameraPitch`/`cameraYaw`/`tileWorldMeters` changed | Invalidate ALL rendered tiles for that project (stale captures). Enqueue re-render for all tiles. |
| Project `tilePixelSize` changed | Invalidate ALL rendered + generated tiles (resolution mismatch). Enqueue full repipeline. |
| Project grid resized (shrink) | Delete storage keys + DB rows for removed tiles. No cache invalidation needed for remaining tiles. |
| User changes prompt or model | Invalidate generated tiles only (rendered tiles are prompt-independent). Enqueue re-generation. |
| User deletes a tile | Delete from all 3 cache layers + storage. |
| New model version released | Optional: mark existing generated tiles as superseded, enqueue re-generation on demand. |

**Cache key includes all relevant parameters implicitly** through the storage path. A change in strategy name produces a different path prefix, so stale data is naturally shadowed rather than corrupted.

#### 4.4 Content-addressable cache (future optimization)

For rendered tiles, compute an `input_hash` (`sha256(col + row + cameraPitch + cameraYaw + tileWorldMeters + tilePixelSize + zoom)`). Store in `tile_versions.input_hash`. If a new RENDER job produces the same hash as an existing version, skip the write and reuse the existing `tile_version`. This avoids duplicating identical renders when camera parameters haven't changed.

---

### 5. Parallel Generation Pipeline

#### 5.1 Fan-out strategy

The pipeline breaks into three phases, each fanning out across worker slots:

```
Phase 1: RENDER
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Worker A │  │ Worker B │  │ Worker C │  │ Worker D │
  │ RENDER   │  │ RENDER   │  │ RENDER   │  │ RENDER   │
  │ (0,0)    │  │ (0,1)    │  │ (0,2)    │  │ (1,0)    │
  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │             │             │             │
       └─────────────┴──────┬──────┴─────────────┘
                            ▼
Phase 2: GENERATE (fully parallel — independent strategy)
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Worker A │  │ Worker B │  │ Worker C │  │ Worker D │
  │ GENERATE │  │ GENERATE │  │ GENERATE │  │ GENERATE │
  │ (0,0)    │  │ (0,1)    │  │ (0,2)    │  │ (1,0)    │
  └──────────┘  └──────────┘  └──────────┘  └──────────┘

Phase 2b: INFILL (partially parallel — context strategies)
  The greedy order from context-border strategy can be relaxed:
  - Round 1: all tiles with 0 generated neighbors → INFILL independently, parallel
  - Round 2: all tiles with 1+ generated neighbors → INFILL independently, parallel
  - Continue until all tiles done
  This is still parallel but respects the dependency: each round depends on the previous round's output.
```

#### 5.2 Dependency management for INFILL tiles

The `context-border` strategy requires each infill call to have up to 8 neighbor tiles available (rendered or generated). The existing browser implementation solves this by:
1. Rendering missing neighbors on-the-fly (blocking `captureAndSave()`)
2. Using the greedy "most-already-stylized-neighbors" ordering from `contextBorderStrategy`

For the worker pipeline, we need a **coordination mechanism** so workers don't starve waiting for neighbors:

**Approach: Staged wave-front scheduling.**

1. **Stage 0:** Enqueue RENDER jobs for all tiles in the grid. These have no dependencies — run fully parallel.
2. **Stage 1 (optional, for context strategies):** Instead of greedy ordering, use **layered parallelism:**
   - **Wave 1:** Generate tiles with 0 already-generated neighbors (start from center, spiral outward). These are "seed" tiles — they can run in parallel with no dependencies on generated neighbors.
   - **Wave 2+:** As each wave completes, the next wave's tiles gain more generated neighbors. Each wave can process all eligible tiles in parallel.
   - A **wave coordinator** (simple db query) determines which tiles are eligible:
     ```sql
     SELECT t.col, t.row FROM tiles t
     WHERE t.project_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.project_id = t.project_id
           AND j.col = t.col AND j.row = t.row
           AND j.kind = 'infill'
           AND j.status IN ('pending', 'claimed', 'done')
       )
       AND EXISTS (  -- has a rendered version
         SELECT 1 FROM tile_versions tv
         WHERE tv.project_id = t.project_id
           AND tv.col = t.col AND tv.row = t.row
           AND tv.source = 'rendered'
       )
     ORDER BY (ABS(t.col) + ABS(t.row)) ASC  -- spiral from center
     LIMIT $2;
     ```
   - A batch job creator (`createInfillBatch`) runs after each wave, enqueueing INFILL jobs for newly-eligible tiles.
   - No explicit dependency tracking needed — the DB is the source of truth.

3. **Stage 2 (independent strategy):** All GENERATE jobs for independent strategy have no dependencies — fully parallel from the start.

#### 5.3 Progress tracking

**Job-level tracking (already supported by schema):**

```
project:  "Times Square"
grid:     7×7 (49 tiles)
status:   rendering ████████░░ 42/49 | stylizing ██████░░░░ 35/49

Jobs:
  RENDER  (done: 42, pending: 7, failed: 0)
  INFILL  (done: 35, pending: 14, failed: 0)
```

**New `jobs` repo query for progress:**

```typescript
export async function getProjectPipelineProgress(projectId: string): Promise<{
  totalTiles: number;
  rendered: { done: number; pending: number; failed: number };
  generated: { done: number; pending: number; failed: number };
}> {
  // Group by kind and status, count
  const rows = await getSql()<Array<{ kind: string; status: string; count: number }>>`
    SELECT kind, status, count(*)::int
    FROM jobs
    WHERE project_id = ${projectId}::uuid
    GROUP BY kind, status
  `;
  // … aggregate
}
```

**Expose via lightweight polling endpoint:**

```
GET /api/projects/{id}/progress
→ { "totalTiles": 49, "rendered": {"done": 42, "pending": 7, "failed": 0}, "generated": … }
```

**UI integration:**
- Replace the sequential "generate missing" button in `project_workspace.tsx` with an "enqueue all" button that calls `createJob` for all tiles.
- Add a progress bar that polls `/api/projects/{id}/progress` every 2 seconds.
- Show per-tile status on the grid overlay (already have `TileVisualState`: idle/pending/done/error).
- Works even if the browser tab is closed and reopened — progress is persisted in the `jobs` table.

---

### 6. Production Deployment

#### 6.1 Process model

```
┌─────────────────────────────────────────────────────┐
│ Docker Compose (dev) / Kubernetes (prod)            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│  │ web      │  │ worker   │  │ worker (xN)  │      │
│  │ :3210    │  │ (1×)     │  │ replicas     │      │
│  │          │  │          │  │              │      │
│  │ Enqueues │  │ Claims   │  │ Claims       │      │
│  │ jobs via │  │ RENDER + │  │ GENERATE +   │      │
│  │ repos    │  │ GENERATE │  │ INFILL jobs  │      │
│  └──────────┘  └──────────┘  └──────────────┘      │
│       │              │               │              │
│       └──────────────┼───────────────┘              │
│                      │                              │
│              ┌───────▼────────┐                     │
│              │   PostgreSQL   │                     │
│              │   (jobs table) │                     │
│              └───────┬────────┘                     │
│                      │                              │
│              ┌───────▼────────┐                     │
│              │  S3 / MinIO    │                     │
│              │  (tile blobs)  │                     │
│              └────────────────┘                     │
└─────────────────────────────────────────────────────┘
```

#### 6.2 Worker configuration

```bash
# apps/worker/.env
DATABASE_URL=postgres://jp:jp@localhost:5433/jp
STORAGE_BACKEND=s3              # or 'local' for dev
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=mapart
S3_SECRET_ACCESS_KEY=mapartstorage
S3_BUCKET=mapart
S3_FORCE_PATH_STYLE=true

WORKER_NAME=worker-1            # unique per instance (hostname or random UUID)
WORKER_CONCURRENCY=4            # how many jobs to process in parallel
WORKER_POLL_INTERVAL_MS=2000    # poll interval when no jobs claimed
WORKER_STALE_CLAIM_MINUTES=5    # after this, a claimed job is considered abandoned
WORKER_BROWSER_POOL_SIZE=2      # headless Chrome instances (subset of concurrency)
WORKER_CACHE_MAX_MB=2048        # local disk cache
OPENAI_API_KEY=sk-…
```

#### 6.3 Scaling strategy

| Dimension | Mechanism |
|---|---|
| **Horizontal (more workers)** | Spin up more `apps/worker` replicas. Each claims jobs independently via `SKIP LOCKED`. PostgreSQL is the coordination point. |
| **Vertical (more concurrency per worker)** | Increase `WORKER_CONCURRENCY`. Limited by CPU/RAM per machine. |
| **Browser pool (render throughput)** | `WORKER_BROWSER_POOL_SIZE` controls how many headless Chromes run concurrently. This is the bottleneck for RENDER jobs. GPU-accelerated instances (e.g., AWS g4dn, GCP n1-standard with GPU) give 3-5× faster renders. |
| **Model API rate limits** | OpenAI rate limits (typically 100 RPM for gpt-image-2) become the bottleneck for GENERATE/INFILL jobs. Implement token-bucket rate limiting in the worker to stay under limits. |
| **Storage throughput** | S3/MinIO GET/PUT are rarely the bottleneck for tile-sized (~200KB) objects. If it becomes one, add aggressive local disk caching. |

#### 6.4 Docker setup

```dockerfile
# apps/worker/Dockerfile
FROM node:22-slim

# Puppeteer dependencies for headless Chrome
RUN apt-get update && apt-get install -y \
  chromium \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app
COPY --from=build /app ./
CMD ["tsx", "src/index.ts"]
```

For GPU-accelerated rendering in production, use GCP Cloud Run with GPU or AWS ECS with GPU-enabled AMIs, and pass `--use-gl=angle --use-angle=swiftshader` to Chromium (or `--use-gl=egl` on GPU instances).

#### 6.5 Observability

- **Structured logging:** Each job handler logs `{ jobId, kind, col, row, durationMs, outcome }` as JSON lines. Ship to your log aggregator.
- **Metrics (future):** Export job duration histograms, queue depth gauge, claim rate, failure rate to Prometheus.
- **Admin panel:** The existing `/admin/*` pages provide visibility. Add a jobs dashboard at `/admin/jobs` showing queue depth by kind, recent failures, worker health.

---

### 7. Quick Wins vs Full Architecture

#### 7.1 Week 1: Baseline background pipeline (MVP)

**Goal:** Users click "enqueue all" in the browser, close the tab, come back later and see all tiles rendered + generated.

**Deliverables:**

1. **Wire up `apps/worker` to Postgres** — add `@mapart/db` dependency, implement `claimNextJob()` with `SELECT FOR UPDATE SKIP LOCKED`.
2. **Implement GENERATE handler** — reads rendered tile from storage, calls OpenAI, writes output, marks job done. No browser/Puppeteer needed — this uses existing server-side code from `projects/[slug]/page.tsx` server actions, just run in the worker instead.
3. **Implement INFILL handler** — same as GENERATE but with hybrid/mask compositing using Sharp (already implemented in browser-side `buildInfillInputs`; port to server-side Sharp pipeline).
4. **Implement `POST /api/projects/{id}/jobs` endpoint** — web app enqueues jobs via a server action. The web app no longer does rendering or generation directly — it only enqueues.
5. **Implement `GET /api/projects/{id}/progress` endpoint** — returns job counts grouped by kind + status.
6. **Update `project_workspace.tsx`** — replace the sequential render+generate loop with "enqueue all" button + progress polling.

**What this enables:** Users can close the browser during generation. 100-tile projects become practical (hours instead of requiring an open browser tab). No headless rendering yet — rendered tiles must still come from the browser.

**Risk:** Zero. Uses existing server-side infrastructure. No new runtime dependencies. The worker just runs what the server actions already run, but in a background loop.

#### 7.2 Month 1: Headless rendering + full pipeline

**Goal:** Users don't need to render tiles in the browser at all. Creating a project auto-renders the first 3×3 tiles within 30 seconds.

**Deliverables:**

1. **Puppeteer integration** — add headless Chrome pool to `apps/worker`. Create the `browser/` module with the Three.js render page.
2. **Implement RENDER handler** — drives Puppeteer to capture tiles headlessly. Uses `packages/renderer` camera math directly (Two.js + renderer exported already — just need to bundle into the page script).
3. **Auto-enqueue on project create** — when a new project is created, automatically enqueue RENDER jobs for the center 3×3 tiles and GENERATE/INFILL jobs for those tiles.
4. **L2 disk cache** — implement LRU file cache in `apps/worker/src/cache.ts`.
5. **Stale claim recovery** — periodic worker health check, reset abandoned claimed jobs.
6. **IDEMPOTENCY** — use `idempotency_key` to prevent duplicate job creation on re-enqueue.
7. **Admin jobs dashboard** — `/admin/jobs` page showing queue stats, recent failures, worker count.

**What this enables:** The entire pipeline is hands-off. User sets a location and grid size, and tiles progressively appear over the next few minutes. No browser WebGL context needed. The browser is purely a viewer.

#### 7.3 Month 3: Production-grade pipeline

**Goal:** Scale to 50×50 grid projects. Exports as DZI tile pyramids for OpenSeadragon. Multi-worker, auto-scaling.

**Deliverables:**

1. **EXPORT handler** — `ExportHandler` stitches all generated tiles into a composite, then generates DZI tile pyramid at multiple zoom levels using Sharp. Outputs to `pipeline/{projectId}/exports/{strategy}/{timestamp}/`.
2. **DZI viewer page** — embed OpenSeadragon on the project page, loading the DZI from `/api/storage/…`.
3. **Horizontal scaling** — multiple `apps/worker` Docker replicas. Test with 4 workers on a 20×20 grid, measure throughput, identify bottlenecks (Chrome pool, OpenAI rate limits, S3 throughput, DB contention).
4. **Token-bucket rate limiter** — per-model API rate limiting (respect OpenAI's 100 RPM limit). Jobs block until a token is available.
5. **Priority queue** — user-clicked tiles get priority over background fill. Implement via a `priority` column on `jobs` (default 10, user-requested = 1, background = 10). `claimNextJob` orders by `priority ASC, created_at ASC`.
6. **Content-addressable caching** — skip re-renders when camera params haven't changed (input hash comparison).
7. **Failure notification** — webhook or email on batch completion/failure.
8. **Production Dockerfile + k8s manifests** — or fly.io / Railway configs.

---

### Appendix A: Decision Record — Why Puppeteer over headless-gl

| Criterion | headless-gl (`gl`) | Puppeteer |
|---|---|---|
| WebGL 2.0 support | Partial (depends on system OpenGL drivers) | Full (Chrome's ANGLE backend) |
| `OES_texture_float` | Unreliable on macOS | Yes (Chrome supports it) |
| Setup on macOS ARM | Fragile — requires manual `gl` native build with correct Xquartz/ANGLE flags | Just works (`npm install puppeteer`) |
| Docker compatibility | Requires Mesa/EGL in container | Works with `chromium` package |
| Render fidelity | May differ from browser (different GL backend) | Identical to browser (same renderer) |
| Memory per instance | ~50MB | ~200MB (Chrome process) |
| Startup latency | <100ms | ~2s (cold start), <100ms (warm pool) |
| Maintenance | Brittle — minor OS updates break native module | Chrome updates are handled by puppeteer |

Given that Google's 3D Tiles heavily use `OES_texture_float` (for the compressed textures in the photorealistic tiles), Puppeteer is the only reliable option. The memory overhead (~200MB per instance) is acceptable for a worker process that typically runs on a 2GB+ instance.

### Appendix B: Decision Record — Why not Python like isometric-nyc

The isometric-nyc project uses Python + `py3dtiles` + Modal.com for serverless GPU inference. While this is elegant for that project's specific pipeline (fixed viewport, no per-project customization), map.art has stronger reasons to stay in TypeScript:

- **Shared code between browser and worker:** `packages/renderer` camera math, `packages/shared` tile math, and `packages/pipeline` strategies are already TypeScript. Rewriting in Python would fork the codebase.
- **The worker already exists in TypeScript:** `apps/worker` is a Node.js process. Adding Python would introduce a second runtime to maintain, deploy, and monitor.
- **Modal.com adds operational complexity:** While serverless GPU is powerful, it introduces cold starts, a separate deployment pipeline, and Python dependency management. We can achieve 50+ parallel generations via horizontal Node.js worker scaling plus OpenAI's batch API (when available).
- **Revisit if OpenAI rate limits become the bottleneck:** If we need 500+ parallel generations and OpenAI's API can't keep up, then switching to self-hosted GPU inference (via Modal or similar) becomes compelling.
