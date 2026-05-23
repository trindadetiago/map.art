# map.art

Pixel-art map tool.

## Apps

- `apps/web` - UI, API, debug pages

## Packages

- `db` - projects, tiles, models
- `env` - typed env
- `models` - image models
- `pipeline` - orchestrates models, renderer, storage
- `renderer` - tile render
- `shared` - shared types
- `storage` - file storage
- `tiles` - tile math

## Docs

Standalone HTML in `docs/`, viewable straight from GitHub or by opening locally:

- [`docs/architecture.html`](docs/architecture.html) — SaaS architecture sketch (workers, model service, queue, blob)
- [`docs/models-research.html`](docs/models-research.html) — image-model landscape, LoRA plan, hosting comparison

Also: `python/data_overview.html` documents the v01 training dataset pipeline.

## Dev

```bash
pnpm install
pnpm run-setup   # starts Postgres via docker, writes .env from .env.example
pnpm dev
```

Then edit `.env` to fill in real values:

- `GOOGLE_MAPS_API_KEY` — Map Tiles API key, used by the renderer
- `GEMINI_API_KEY` — Gemini 2.5 Flash Image
- `OPENAI_API_KEY` — gpt-image-1 (TileStudio smart-infill)
- `DATABASE_URL` — preset to the local docker Postgres
