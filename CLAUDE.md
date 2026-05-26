# map.art — agent orientation

Pixel-art map tool. Turns aerial map tiles into isometric SimCity-style pixel-art. Currently early R&D — collecting `(rendered, stylized)` pairs to fine-tune Qwen Image-Edit. The end goal is a SaaS where users pick an area on a map, get back a stylized pixel-art version they can buy.

For the planned production architecture (workers, queue, model service, SaaS bits), see [`docs/architecture.html`](docs/architecture.html).

---

## Repo layout

Monorepo. pnpm workspaces. Two top-level boundaries:

- **`apps/*`** — things that *run* (services, daemons, CLIs, UIs). May import from `packages/*`.
- **`packages/*`** — pure server-side TypeScript libraries. **No React, no UI code, no HTTP servers.** Shared across `apps/*`.

That boundary is load-bearing. Don't add React or Next-isms inside `packages/*`. Don't write business logic that belongs in a package inside an app.

### `apps/`

| Path | What | Runtime shape |
|---|---|---|
| `apps/web` | Next.js 15 (App Router). Main UI on `:3210`. Admin pages at `/admin/*` (projects, storage, env, models, renderer, tiles, pipeline). Database has no panel — its card on the dashboard links to Drizzle Studio at https://local.drizzle.studio. | long-running service |
| `apps/worker` | Background job process. **Placeholder today** — ticks every 5s, logs heartbeat. Eventually consumes from the Postgres `jobs` table (render/stylize). | long-running service |
| `apps/cli` | `mapart` binary. Single entry, subcommands per domain. Imports from `packages/*`. | short-lived tool |

`apps/cli` is a *tool*, not a service — runs ad-hoc, exits. Not in `mprocs`. Future workers (`apps/worker-render`, `apps/worker-stylize`, `apps/model`) will be services.

### `packages/`

All pure Node libraries. No React. Tree-shake-friendly imports.

| Package | What |
|---|---|
| `@mapart/db` | Drizzle ORM schema + repos + migrations. Postgres + PostGIS. Sub-paths: `./schema`, `./repos`. |
| `@mapart/env` | Typed env loader. Reads `.env`, validates per-key, exposes `env` + `requireEnv()`. Schema in `src/schema.ts`. |
| `@mapart/models` | OpenAI image-edit clients (`gpt-image-1.5`, `gpt-image-2`) behind a common `ModelClient` interface. Factory: `getModel(name, opts)`. Requires `OPENAI_API_KEY`. |
| `@mapart/pipeline` | Generation-strategy harness — turns N rendered tiles into N stylized tiles. Strategy modules under `src/strategies/`. |
| `@mapart/renderer` | Shared Three.js + Google 3D Tiles helpers. Exports `createTilesRenderer(apiKey, center)` (configured TilesRenderer with auth + reorientation + compression + update-on-change plugins) plus camera-math helpers (`positionCamera`, `applyFrustum`). Consumed by `apps/web/components/scene.tsx` today; designed to be the shared core for a future `apps/worker-render`. |
| `@mapart/shared` | Shared types + small pure utilities used across packages. |
| `@mapart/storage` | Blob storage. Two backends: `local` (`<repo>/data/`) or `s3` (MinIO/AWS). Selected by `STORAGE_BACKEND`. Singleton via `getStorage()`. |
| `@mapart/tiles` | Web-mercator tile math (point/bbox/circle/polygon → tiles, tile → bounds/center/WKT). |

### `infra/`

Local services for dev. Root `docker-compose.yml` uses `include:` to pull both in.

- `infra/db/` — Postgres + PostGIS on `localhost:5433`, user/pass/db all `jp`.
- `infra/storage/` — MinIO (S3-compatible) on `localhost:9000`, console `:9001`, root creds `mapart` / `mapartstorage`, bucket `mapart` auto-created.

### Other

- `python/` — exploration scripts, data prep, training pipeline (separate Python venv at `.venv/`).
- `data/` — local-mode storage backend root (gitignored; created on demand by `@mapart/storage` when `STORAGE_BACKEND=local`). When `STORAGE_BACKEND=s3`, this is unused.
- `scripts/setup.sh` — full bootstrap. Docker check, services up, .env sync, deps install, db migrate. Idempotent.
- `scripts/run.mjs` — dev-runner log-tee wrapper (used by mprocs).
- `mprocs.yaml` — dev process layout (one tab per long-running service).
- `.logs/` — per-process stdout/stderr from `pnpm dev`. **Gitignored. Truncated on each `pnpm dev` start.** `grep`-friendly.
- `docs/` — standalone HTML docs (architecture sketch, model research).

---

## How to run the dev environment

```bash
pnpm install
pnpm run-setup    # one-time: Docker, services, .env, migrations
pnpm dev          # mprocs TUI: apps/web (:3210) + apps/worker + drizzle studio (:4983)
```

Inside the TUI: `j`/`k` switch procs, `r` restart, `x` stop, `q` quit. Each proc also streams to `.logs/<name>.log` for searching from another terminal (`grep ERROR .logs/web.log`, `tail -f .logs/worker.log`).

Escape hatches (no TUI): `pnpm dev:web`, `pnpm dev:worker`, or `pnpm dev:studio` standalone. Drizzle Studio prints a URL (usually https://local.drizzle.studio) that proxies to the local server — open it in a browser to browse rows.

---

## CLI

Single binary: `pnpm mapart <subcommand>`. Discover with `--help` at any level.

```bash
pnpm mapart --help
pnpm mapart db status                  # connection + table counts
pnpm mapart db migrate                 # apply pending migrations (alias: pnpm db:migrate)
pnpm mapart db projects list
pnpm mapart storage list
pnpm mapart tiles for-point --lat 40.7 --lng -74 --zoom 18
pnpm mapart models generate --input … --prompt … --out …
```

If you need a *new* command, add it under `apps/cli/src/commands/<domain>.ts` and register it in `apps/cli/bin/mapart.ts`. Don't add new `bin/` folders inside packages — packages stay library-only.

---

## Conventions / important rules

- **Packages are server-only.** No React, no Next imports, no UI. If a thing is UI, it lives in `apps/web` (or another app that hosts UI). The admin Panel pattern: each `apps/web/app/admin/<pkg>/panel.tsx` is the host for that package's inspector.
- **`apps/web` files are snake_case.** All `.ts`/`.tsx` files under `apps/web/` (components, panels, helpers) use `snake_case.tsx` — exported React components themselves stay PascalCase. Exempt: Next.js routing conventions (`page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx`, `default.tsx`, `global-error.tsx`) and Next auto-generated files (`next.config.ts`, `next-env.d.ts`). Enforced by `scripts/check-naming.sh` in the pre-commit hook.
- **`@mapart/env` is the only place reading `process.env`.** Add new env vars to `packages/env/src/schema.ts`, then to `.env.example`. The setup script will sync existing dev `.env`s on next run.
- **Storage call-sites are async and backend-agnostic.** Never reach into `LocalFs` or `S3Storage` directly; always go through `getStorage()`.
- **Workers will be the only writers to blob storage** (per architecture doc) — once we get to production. For now `apps/web` server actions still write directly; that's a known transitional state.
- **Type-checking is the canonical correctness signal.** No tests yet. `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` etc. Run after non-trivial changes.
- **Lint runs on staged files via `lint-staged` + `biome`.** Pre-commit hook auto-fixes safe issues and blocks on real errors.
- **Use `git mv`** to move files so history is preserved.

## Tools used

- pnpm workspaces (Node 22+)
- TypeScript strict mode, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- Next.js 15 (App Router, Server Actions, Server Components)
- Drizzle ORM + `postgres` driver
- AWS SDK v3 (`@aws-sdk/client-s3`) for S3/MinIO
- Three.js + `3d-tiles-renderer` for tile rendering
- `commander` for CLI
- `tsx` for running TS without compile step
- `mprocs` for the dev TUI runner
- `biome` for lint + format
- `husky` + `lint-staged` for pre-commit hook

---

## Common pitfalls

- After moving or renaming Next route folders, **stale `.next/types/*.ts`** can produce phantom tsc errors referencing the old paths. Fix: `rm -rf apps/web/.next` then re-type-check.
- `pnpm install` after package.json changes is required — workspace links update lazily.
- The pre-commit hook uses biome auto-fix on staged files. If it surfaces lint errors in *untouched* code that you happened to stage, fix them — they were dormant only because nothing triggered a lint pass.
- Don't put long-running services (workers, dev servers) into `apps/cli`. CLIs exit; services loop. Different shapes.
