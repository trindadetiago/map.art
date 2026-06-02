# map.art — agent orientation

Pixel-art map tool. Turns aerial map tiles into isometric SimCity-style pixel-art. Currently early R&D — collecting `(rendered, stylized)` pairs to fine-tune Qwen Image-Edit. The end goal is a SaaS where users pick an area on a map, get back a stylized pixel-art version they can buy.

For the planned production architecture (workers, queue, model service, SaaS bits), see [`docs/architecture.html`](docs/architecture.html).

---

## Repo layout

Monorepo. pnpm workspaces. Two top-level boundaries:

- **`apps/*`** — things that *run* (services, daemons, CLIs, UIs). May import from `packages/*`.
- **`packages/*`** — pure server-side TypeScript libraries. **No React, no UI code, no HTTP servers.** Shared across `apps/*`.

That boundary is load-bearing. Don't add Next-isms inside `packages/*`. Don't write business logic that belongs in a package inside an app.

`@mapart/renderer` is the only package that ships a React component (`<Scene>`) alongside pure helpers — Scene is shared by `apps/web` and `apps/worker-render/render-page` (the page headless Chrome navigates to). React is a peer dep there. Tree-shaking keeps non-React consumers from pulling Scene at runtime. New packages should follow the "no React" default unless there's a similar two-or-more-consumer justification.

### `apps/`

| Path | What | Runtime shape |
|---|---|---|
| `apps/web` | Next.js 15 (App Router). Main UI on `:3210`. Admin pages at `/admin/*` (projects, storage, env, models, renderer, tiles). Database has no panel — its card on the dashboard links to Drizzle Studio at https://local.drizzle.studio. | long-running service |
| `apps/worker-render` | Server-side render service. Single Node process on `:9999`. Embeds Vite as middleware to serve `render-page/` (the page that mounts `<Scene>`), drives a persistent Puppeteer/Chromium that navigates to its own port, exposes `POST /render` to render one tile and return its PNG. Queue consumer can be layered on top later (call `renderTile()` from a pg-boss handler). | long-running service |
| `apps/cli` | `mapart` binary. Single entry, subcommands per domain. Imports from `packages/*`. | short-lived tool |

`apps/cli` is a *tool*, not a service — runs ad-hoc, exits. Not in `mprocs`. Future workers (`apps/worker-stylize`, `apps/model`) will also be services.

### `packages/`

Mostly pure Node libraries. Tree-shake-friendly imports.

| Package | What |
|---|---|
| `@mapart/db` | Drizzle ORM schema + repos + migrations. Postgres. Sub-paths: `./schema`, `./repos`. |
| `@mapart/env` | Typed env loader. Reads `.env`, validates per-key, exposes `env` + `requireEnv()`. Schema in `src/schema.ts`. |
| `@mapart/models` | OpenAI image-edit clients (`gpt-image-1.5`, `gpt-image-2`) behind a common `ModelClient` interface. Factory: `getModel(name, opts)`. Requires `OPENAI_API_KEY`. |
| `@mapart/geo` | Foundational geo primitives + web-mercator tile math. Types (`LatLng`, `Bbox`, `Polygon`, `TileCoord`). Tile math (`latLngToTile`, `tileToBounds`, `tileToCenter`, `tileToBoundsWkt`, `tileWidthMeters`). Coverage (`bboxToTiles`, `polygonToTiles`, `circleToPolygon`). No deps. |
| `@mapart/renderer` | Three.js + Google 3D Tiles. Exports the React `<Scene>` component (for `apps/web` + `apps/worker-render/render-page`), the render-side type `RenderParams`, the global render pose/output config `RENDER_DEFAULTS` (pitch 30, yaw 45, 150 m/tile, 512 px), and the pure helpers (`createTilesRenderer`, `positionCamera`, `applyFrustum`, `reorientTo`, `tileGroundCorners`, `tileCenterLatLng`, `renderParamsForLatLng`). Depends on `@mapart/geo` for `LatLng` + `tileWidthMeters`. React is a peer dep; pure helpers are usable without it (tree-shaken). |
| `@mapart/storage` | Blob storage on S3 (MinIO locally, AWS in prod), configured by the `S3_*` env vars. Singleton via `getStorage()`. |

### `infra/`

Local services for dev. Root `docker-compose.yml` uses `include:` to pull both in.

- `infra/db/` — Postgres on `localhost:5433`, user/pass/db all `jp`.
- `infra/storage/` — MinIO (S3-compatible) on `localhost:9000`, console `:9001`, root creds `mapart` / `mapartstorage`, bucket `mapart` auto-created.

### Other

- `python/` — exploration scripts, data prep, training pipeline (separate Python venv at `.venv/`).
- `scripts/setup.sh` — full bootstrap. Docker check, services up, .env sync, deps install, db migrate. Idempotent.
- `scripts/run.mjs` — dev-runner log-tee wrapper (used by mprocs).
- `scripts/dev.mjs` — `pnpm dev` entrypoint. Parses the optional `s<N>` stylize-worker count and generates the mprocs proc layout (one pane per long-running service).
- `.logs/` — per-process stdout/stderr from `pnpm dev`. **Gitignored. Truncated on each `pnpm dev` start.** `grep`-friendly.
- `docs/` — standalone HTML docs (architecture sketch, model research).

---

## How to run the dev environment

```bash
pnpm install
pnpm run-setup    # one-time: Docker, services, .env, migrations
pnpm dev          # mprocs TUI: apps/web (:3210) + drizzle studio (:4983) + worker-render (:9999) + worker-stylize
pnpm dev s5       # same, but 5 stylize workers (1–10), each its own pane
```

`pnpm dev` takes an optional `s<N>` argument (1–10, default 1) for the number of stylize workers, each launched as its own mprocs pane (named `worker-stylize-1…N`; a single worker keeps the plain `worker-stylize` name). They run safely in parallel — `claimNextStylize` claims with `FOR UPDATE SKIP LOCKED`. The TUI layout is generated by `scripts/dev.mjs` (no static `mprocs.yaml`). `s=5` and `s 5` are also accepted.

Inside the TUI: `j`/`k` switch procs, `r` restart, `x` stop, `q` quit. Each proc also streams to `.logs/<name>.log` for searching from another terminal (`grep ERROR .logs/web.log`, `tail -f .logs/worker-stylize-1.log`).

Escape hatches (no TUI): `pnpm dev:web`, `pnpm dev:studio`, `pnpm dev:worker-render`, or `pnpm dev:worker-stylize` standalone. Drizzle Studio prints a URL (usually https://local.drizzle.studio) that proxies to the local server — open it in a browser to browse rows. The worker-render serves the render-page on `http://localhost:9999/` (so you can open it manually in a browser to debug) and exposes `POST /render` for headless renders.

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
- **Storage call-sites are async.** Never construct `S3Storage` directly; always go through `getStorage()`.
- **Workers will be the only writers to blob storage** (per architecture doc) — once we get to production. For now `apps/web` server actions still write directly; that's a known transitional state.
- **Type-checking is the primary correctness signal.** `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` etc. Run after non-trivial changes. Some packages also have `vitest` tests (`pnpm --filter <pkg> test`).
- **DB tests run against an isolated `jp_test` database, never the dev DB.** Any suite that wipes `tiles`/`projects` between runs — `@mapart/db`, `apps/worker-render`, `apps/worker-stylize` — must point at the throwaway DB. They share `packages/db/test/_global-setup.ts` + `_setup.ts`: `globalSetup` creates `<devdb>_test` (e.g. `jp_test`) and migrates it; `setupFiles` repoints `DATABASE_URL` per worker *before* `@mapart/env` loads. So each suite's vitest config references those two files (the worker configs via `../../packages/db/test/...`), and each `beforeAll` guard asserts the DB name ends in `_test` — fail loudly rather than wipe dev. It self-provisions on first run (only needs the Postgres container up); nothing to add to the setup script. Because all these suites share the one `jp_test` DB, the root `pnpm test` runs `--workspace-concurrency=1` so they don't wipe each other mid-run. Never point a wiping suite at the dev DB.
- **Lint runs on staged files via `lint-staged` + `biome`.** Pre-commit hook auto-fixes safe issues and blocks on real errors.
- **Use `git mv`** to move files so history is preserved.
- **No history-leaking comments.** A comment that only makes sense if you remember what was there before is rot. Examples to avoid: "no longer needed", "replaces the previous X", "was inlined before", "first/new package of its kind", "now uses Y instead". The code describes what it is now; the *why* (if non-obvious) is what comments are for, and that *why* must stand on its own without referring to a removed past. Same applies to docs/README files — describe current state, not the journey to it. Git log is the place for change history.

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
