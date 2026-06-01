# map.art

Pixel-art map tool. Turns aerial map tiles into isometric SimCity-style pixel-art. Early R&D — building toward fine-tuning Qwen Image-Edit on rendered/stylized pairs.

See [`CLAUDE.md`](CLAUDE.md) for an agent-friendly orientation; [`docs/architecture.html`](docs/architecture.html) for the planned SaaS shape.

## Apps

- `apps/web` — Next.js UI + thin API + `/admin` inspector pages
- `apps/worker-render` — server-side render service. Single process on `:9999`: hosts the render-page (Vite middleware), drives Puppeteer/Chromium, exposes `POST /render` returning a PNG
- `apps/cli` — `mapart` binary (one entry, subcommands per domain)

## Packages

- `db` — Drizzle schema + repos + migrations (Postgres)
- `env` — typed env loader
- `geo` — foundational geo primitives (`LatLng`, `Bbox`, `Polygon`, `TileCoord`) + web-mercator tile math + coverage (`bboxToTiles`, `polygonToTiles`, `circleToPolygon`)
- `models` — OpenAI image-edit clients (gpt-image-1.5, gpt-image-2)
- `renderer` — Three.js + Google 3D Tiles. Ships the React `<Scene>` component plus pure render-side helpers + types
- `storage` — blob storage (LocalFs + S3/MinIO backends)

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
pnpm dev          # mprocs TUI — runs apps/web (Next), Drizzle Studio, and apps/worker-render side-by-side
```

In mprocs: `j`/`k` switch between procs, `r` restart, `x` stop, `q` quit. Each proc's live output is also streamed to `.logs/<name>.log` (gitignored, truncated on each run) — `grep`-able from any other terminal.

Escape hatches if you don't want the TUI: `pnpm dev:web`, `pnpm dev:studio`, or `pnpm dev:worker-render` alone.

### Tests

Type-checking (`pnpm exec tsc --noEmit -p <tsconfig>`) is the primary correctness signal; some packages also have `vitest` tests (`pnpm --filter <pkg> test`).

The `@mapart/db` tests are integration tests that wipe `tiles` + `projects` between runs — so they run against an **isolated `<devdb>_test` database** (e.g. `jp_test`), never the dev DB. It's created and migrated automatically on first run (only needs the Postgres container up); there's nothing to set up. Don't repoint the suite at the dev database.

`.env` keys to fill in:

- `GOOGLE_MAPS_API_KEY` — Map Tiles API key, used by the renderer
- `OPENAI_API_KEY` — required by `@mapart/models` (gpt-image-1.5 / gpt-image-2)
- `OXEN_API_KEY` — for the planned oxen.ai LoRA training/hosting workflow
- `DATABASE_URL` — preset to local docker Postgres
- `STORAGE_BACKEND=s3` + `S3_*` — preset to local MinIO

## CLI

One entry point for everything ad-hoc:

```bash
pnpm mapart --help                 # discover
pnpm mapart db status              # connection + table counts
pnpm mapart db migrate             # apply pending migrations
pnpm mapart storage list           # list keys in current backend
pnpm mapart tiles for-point --lat 40.7 --lng -74 --zoom 18
pnpm mapart models generate --input … --prompt …  --out …
```

### Render service (`apps/worker-render`)

Single Node process on `:9999`. Embeds Vite as middleware to serve the
render-page (mounts `<Scene>` from `@mapart/scene`), launches a persistent
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
