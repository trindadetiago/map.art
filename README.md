# earthToPixels

<img width="1600" height="1348" alt="image" src="https://github.com/user-attachments/assets/0e1fad64-bdbd-42f4-9975-c0ca799656f5" />


Pixel-art map tool. Turns aerial map tiles into isometric SimCity-style pixel-art. Early R&D — building toward fine-tuning Qwen Image-Edit on rendered/stylized pairs.

Live at **[earthtopixels.com](https://earthtopixels.com)** — each map is a deep-zoom pyramid served from object storage behind a CDN, at `/<project-slug>`.

See [`CLAUDE.md`](CLAUDE.md) for an agent-friendly orientation; [`docs/architecture.html`](docs/architecture.html) for the planned SaaS shape.

## Apps

- `apps/web` — Next.js UI on `:3210`. Project workspace (city → area → build → review → pins → publish) plus `/admin` inspector pages
- `apps/visualizer` — Next.js deep-zoom viewer on `:3220`. OpenSeadragon over a project's pre-built pyramid, reached at `/<slug>`; lat/lng pins are placed as overlays through the pyramid's geo anchor
- `apps/worker-render` — server-side render service. Single process on `:9999`: hosts the render-page (Vite middleware), drives Puppeteer/Chromium, exposes `POST /render` returning a PNG
- `apps/worker-stylize` — claims rendered tiles and runs them through the image-edit model
- `apps/cli` — `mapart` binary (one entry, subcommands per domain)

## Packages

- `db` — Drizzle schema + repos + migrations (Postgres)
- `env` — typed env loader
- `geo` — foundational geo primitives (`LatLng`, `Bbox`, `Polygon`, `TileCoord`) + web-mercator tile math + coverage (`bboxToTiles`, `polygonToTiles`, `circleToPolygon`)
- `models` — OpenAI image-edit clients (gpt-image-1.5, gpt-image-2)
- `renderer` — Three.js + Google 3D Tiles. Ships the React `<Scene>` component plus pure render-side helpers + types
- `stylize` — the per-tile stylize pipeline: composite, model call, crop, output format
- `export` — stitches a project's tiles into one raster and slices the deep-zoom pyramid the visualizer serves
- `ui` — shared React components (globe, world map, analytics provider), one subpath each
- `logger` — structured logging shared by the services
- `storage` — blob storage (S3-compatible). Two targets: the pipeline's bucket, and a public one holding everything under `viz/`

## Infra

Local services run via `docker compose` (root `docker-compose.yml` uses `include:`):

- `infra/db/` — Postgres on `localhost:5433`
- `infra/storage/` — MinIO (S3-compatible) on `localhost:9000`, console `:9001`, bucket `mapart`

## Docs

Standalone HTML in `docs/`, viewable from GitHub or locally:

- [`docs/architecture.html`](docs/architecture.html) — SaaS architecture sketch (workers, model service, queue, blob)
- [`docs/models-research.html`](docs/models-research.html) — image-model landscape, LoRA plan, hosting comparison

Also: `python/data_overview.html` documents the v01 training dataset pipeline.

## Dev

```bash
pnpm install
pnpm run-setup    # Docker check, boots Postgres + MinIO, writes .env, installs deps, runs migrations
pnpm dev          # mprocs TUI — runs apps/web (Next), Drizzle Studio, worker-render, worker-stylize side-by-side
pnpm dev s5       # same, but 5 stylize workers (1–10) as their own panes
```

`pnpm dev` takes an optional `s<N>` argument (1–10) for the number of stylize workers, each shown as its own mprocs pane. They parallelise safely — every worker claims tiles with `FOR UPDATE SKIP LOCKED`, so they never grab the same one. (`s=5` and `s 5` work too.)

In mprocs: `j`/`k` switch between procs, `r` restart, `x` stop, `q` quit. Each proc's live output is also streamed to `.logs/<name>.log` (gitignored, truncated on each run) — `grep`-able from any other terminal.

Escape hatches if you don't want the TUI: `pnpm dev:web`, `pnpm dev:studio`, `pnpm dev:worker-render`, or `pnpm dev:worker-stylize` alone.

### Tests

Type-checking (`pnpm exec tsc --noEmit -p <tsconfig>`) is the primary correctness signal; some packages also have `vitest` tests (`pnpm --filter <pkg> test`).

The `@mapart/db` tests are integration tests that wipe `tiles` + `projects` between runs — so they run against an **isolated `<devdb>_test` database** (e.g. `jp_test`), never the dev DB. It's created and migrated automatically on first run (only needs the Postgres container up); there's nothing to set up. Don't repoint the suite at the dev database.

`.env` keys to fill in:

- `GOOGLE_MAPS_API_KEY` — Map Tiles API key, used by the renderer
- `OPENAI_API_KEY` — required by `@mapart/models` (gpt-image-1.5 / gpt-image-2)
- `OXEN_API_KEY` — for the planned oxen.ai LoRA training/hosting workflow
- `DATABASE_URL` — preset to local docker Postgres
- `S3_*` — the pipeline's blob storage, preset to local MinIO
- `VIZ_S3_*` — the bucket holding published pyramids (`viz/`), the only objects served publicly. Leave empty locally and everything shares one bucket
- `VIZ_PUBLIC_BASE_URL` — origin serving those pyramids directly, CDN in front. Empty falls back to the visualizer's own proxy route
- `RAILWAY_API_TOKEN` — lets the admin's Publish step start an export. Empty and the button points at the CLI instead

## CLI

One entry point for everything ad-hoc:

```bash
pnpm mapart --help                 # discover
pnpm mapart db status              # connection + table counts
pnpm mapart db migrate             # apply pending migrations
pnpm mapart storage list           # list keys in current backend
pnpm mapart tiles for-point --lat 40.7 --lng -74 --zoom 18
pnpm mapart models generate --input … --prompt …  --out …
pnpm mapart export dzi --project <id>   # build a project's deep-zoom pyramid
pnpm mapart export run-queued           # claim the oldest queued export and run it
pnpm mapart export pins --project <id> --file pins.json
```

### Publishing a map

Editing tiles changes a project's *source* images; the public map is a pyramid
stitched from them, so it only changes when that pyramid is rebuilt. Do it from
the admin's **Publish** step, which queues an export and shows how it went, or
from a terminal with `mapart export dzi`.

Each export publishes under its own version (`viz/{project}/v/{version}/`) and
the descriptor at `viz/{project}/metadata.json` names the current one. That is
what lets tiles be cached forever: a rebuild writes URLs nobody holds, rather
than new bytes at addresses browsers and CDNs were told never to revalidate.

### Render service (`apps/worker-render`)

Single Node process on `:9999`. Embeds Vite as middleware to serve the
render-page (mounts `<Scene>` from `@mapart/renderer`), launches a persistent
Puppeteer/Chromium, and exposes `POST /render` returning PNG bytes.

The same internal `renderTile()` is what the eventual pg-boss queue consumer
will call. **`POST /render` is for dev / testing only** — in production,
renders come from the queue, not over HTTP.

Requires `VITE_GOOGLE_MAPS_API_KEY` in `.env` (Vite only exposes vars
prefixed `VITE_` to the page bundle).

```bash
# Start it (also a pane in `pnpm dev`)
pnpm dev:worker-render

# Open the page in your own browser to debug
open "http://localhost:9999/?lat=-7.115&lng=-34.861&pitch=60&yaw=0&zoom=18&size=1024"

# End-to-end test via the CLI (drives Puppeteer → Chromium → Scene → tiles → PNG)
pnpm mapart render --lat -7.115 --lng -34.861 --zoom 18 --size 1024 --out tile.png && open tile.png

# Or hit the endpoint with curl
curl -X POST http://localhost:9999/render \
  -H 'content-type: application/json' \
  -d '{"lat":-7.115,"lng":-34.861,"pitch":60,"yaw":0,"zoom":18,"size":1024}' \
  --output tile.png

# GPU mode (Metal on macOS)
RENDER_GPU_ENABLED=true pnpm dev:worker-render
```
