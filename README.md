# map.art

Pixel-art map tool. Turns aerial map tiles into isometric SimCity-style pixel-art. Early R&D — building toward fine-tuning Qwen Image-Edit on rendered/stylized pairs.

See [`CLAUDE.md`](CLAUDE.md) for an agent-friendly orientation; [`docs/architecture.html`](docs/architecture.html) for the planned SaaS shape.

## Apps

- `apps/web` — Next.js UI + thin API + `/admin` inspector pages
- `apps/worker` — background-job process (placeholder; ticks every 5s, will consume from the Postgres jobs table)
- `apps/cli` — `mapart` binary (one entry, subcommands per domain)

## Packages

Pure server-side libraries. No React, no UI code.

- `db` — Drizzle schema + repos + migrations (Postgres + PostGIS)
- `env` — typed env loader
- `models` — image-edit model clients (stub, Gemini, OpenAI)
- `pipeline` — generation-strategy harness (independent / infill / big-render / …)
- `renderer` — Three.js + Google 3D Tiles tile renderer
- `shared` — shared types
- `storage` — blob storage (LocalFs + S3/MinIO backends)
- `tiles` — web-mercator tile math

## Infra

Local services run via `docker compose` (root `docker-compose.yml` uses `include:`):

- `infra/db/` — Postgres + PostGIS on `localhost:5433`
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
pnpm dev          # mprocs TUI — runs apps/web (Next) + apps/worker side-by-side
```

In mprocs: `j`/`k` switch between procs, `r` restart, `x` stop, `q` quit. Each proc's live output is also streamed to `.logs/<name>.log` (gitignored, truncated on each run) — `grep`-able from any other terminal.

Escape hatches if you don't want the TUI: `pnpm dev:web` or `pnpm dev:worker` alone.

`.env` keys to fill in:

- `GOOGLE_MAPS_API_KEY` — Map Tiles API key, used by the renderer
- `GEMINI_API_KEY` — Gemini 2.5 Flash Image
- `OPENAI_API_KEY` — gpt-image-1
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
pnpm mapart generate --input … --prompt …  --out …
```
