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
