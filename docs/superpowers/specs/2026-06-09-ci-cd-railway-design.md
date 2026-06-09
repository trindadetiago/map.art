# CI/CD for map.art on Railway — design

**Date:** 2026-06-09
**Status:** approved, ready for implementation plan

## Goal

Give the team control over PRs, commits, and changes by adding:

1. **CI** — every PR and every push runs typecheck + lint + the full test suite (including DB-backed tests against Postgres), surfacing a pass/fail status on the PR.
2. **CD** — merging to `main` deploys to Railway automatically, but **only the services whose code changed**, and **only if CI passed**.
3. **Branch protection** — `main` requires a PR and a green CI check before merge; no direct pushes.

Deploy mechanism: **GitHub Actions + Railway CLI** (`railway up` driven by a token). Railway stays disconnected from GitHub — GitHub Actions is the single brain deciding when to deploy. This preserves the existing manual-control model while automating it.

## Background / current state

- Repo: `trindadetiago/map.art` on GitHub. No `.github/` directory yet — zero CI today.
- Production runs on Railway (services: `web`, `worker-render`, `worker-stylize`, managed `Postgres`, a Storage Bucket). Deploys are manual `railway up` from the local repo. See the `railway-deployment` memory for service build/start commands and gotchas.
- Scripts available at the repo root: `lint` (`biome check .`), `test` (`pnpm -r --workspace-concurrency=1 --if-present test`). **There is no `typecheck` script** — typechecking is done ad-hoc with `tsc --noEmit -p <app>/tsconfig.json`.
- Test suites that need Postgres (`@mapart/db`, `apps/worker-render`, `apps/worker-stylize`) share `packages/db/test/_global-setup.ts` + `_setup.ts`. The helper `packages/db/test/_test-db-url.ts`:
  - Reads `DATABASE_URL` from the root `.env` first, then falls back to `process.env.DATABASE_URL`.
  - **Refuses any non-local host** (only `localhost`/`127.0.0.1` allowed) before deriving the test DB.
  - Derives `<devdb>_test` on the same server; `_global-setup.ts` creates and migrates it.
- `packageManager: pnpm@9.12.0`, `engines.node: >=22`.

## Architecture

A single workflow file, `.github/workflows/ci.yml`, triggered on:
- `pull_request` (any branch targeting the repo)
- `push` to `main`

### Job 1: `check` (runs on every trigger)

The safety net. Steps:

1. `actions/checkout`
2. Install pnpm (`pnpm/action-setup`, version 9.12.0) + Node 22 (`actions/setup-node` with `cache: pnpm`)
3. `pnpm install --frozen-lockfile`
4. `pnpm typecheck`
5. `pnpm lint`
6. `pnpm test`

**Postgres service container** attached to this job:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: jp
      POSTGRES_PASSWORD: jp
      POSTGRES_DB: jp
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U jp"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Job-level env (no `.env` file exists in CI, so these come from `process.env`):

- `DATABASE_URL: postgres://jp:jp@localhost:5432/jp` — host is `localhost`, so it passes the test helper's local-only guard. The DB suites create/migrate `jp_test` themselves.
- Placeholder values for the env keys `@mapart/env` may `requireEnv` during tests, so `env` construction never throws: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE=true`, `GOOGLE_MAPS_API_KEY`. (Dummy strings — nothing in CI talks to real S3 or Google.)

### Job 2: `changes` (runs on every trigger)

Uses `dorny/paths-filter` to compute which services are affected. Outputs three booleans:

- `web` ← `apps/web/**`, `packages/**`, root manifests (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`)
- `worker-render` ← `apps/worker-render/**`, `packages/**`, root manifests
- `worker-stylize` ← `apps/worker-stylize/**`, `packages/**`, root manifests

Rule of thumb encoded here: a change to any shared `packages/*` marks **all** services affected (they all depend on shared packages). Per-package dependency granularity is intentionally out of scope (YAGNI) — the cost of an occasional extra rebuild is lower than maintaining a precise dep graph.

### Job 3: `deploy` (`needs: [check, changes]`)

Guarded by `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. The `needs: check` dependency is what gates deploy on a green CI.

Steps:

1. `actions/checkout`
2. Install the Railway CLI (`bun`/`npm i -g @railway/cli`, or the official install script — implementation picks the most reliable).
3. Three conditional deploy steps, each gated on the matching `changes` output:
   - `if: needs.changes.outputs.web == 'true'` → `railway up --ci --service web`
   - `if: needs.changes.outputs.worker-render == 'true'` → `railway up --ci --service worker-render`
   - `if: needs.changes.outputs.worker-stylize == 'true'` → `railway up --ci --service worker-stylize`

Auth: `RAILWAY_TOKEN` from GitHub Actions secrets, exported as env for the deploy steps. A Railway **project token** scoped to the `production` environment lets `railway up --service <name>` run non-interactively without `railway link`.

`railway up --ci` uploads, streams the Railway-side build, and exits with the build's status — so a broken build turns the deploy job red. The build itself happens **on Railway**, not on the runner; the runner needs no production secrets beyond the token.

## Code changes in the repo

Scope is config-only — no app or package logic changes.

1. **`.github/workflows/ci.yml`** — new file (the workflow above).
2. **`package.json` (root)** — add `"typecheck": "pnpm -r --if-present typecheck"`, mirroring the existing `test` script pattern.
3. **Each workspace `package.json`** (`apps/*`, `packages/*`) — add `"typecheck": "tsc --noEmit"` (resolves against each project's own `tsconfig.json`). Skip workspaces where it doesn't apply.

## Manual setup (outside the repo — to be guided step by step)

1. **Railway token**: generate a Project Token for the `production` environment; store it in GitHub → Settings → Secrets and variables → Actions as `RAILWAY_TOKEN`.
2. **Branch protection on `main`**: require a PR before merging and require the `check` status check to pass; disallow direct pushes. Via GitHub UI or `gh api` (a ruleset). The status check name must match the `check` job.

## Risks / open points

- Adding a repo-wide `typecheck` may surface latent type errors in workspaces never typechecked in isolation. Implementation must run `pnpm typecheck` locally and fix whatever it surfaces before the workflow can go green.
- Standalone `tsc --noEmit` per workspace relies on pnpm workspace symlinks resolving `@mapart/*` types. If any package needs project references or a `tsconfig` tweak to typecheck in isolation, handle it during implementation.
- First CI run of the DB suites on the runner is the most likely spot for tuning (Postgres readiness timing, env placeholders). Build the workflow so a failure here is legible.
- Railway CLI install method and exact `railway up --ci` flag behavior should be verified against the current CLI version during implementation.

## Out of scope (YAGNI)

- Per-package dependency graph for finer-grained deploys.
- Building the apps in CI (the `railway up` build is the build gate; CI does typecheck/lint/test only).
- Preview/staging environments per PR.
- Caching the Next.js build or Docker layers beyond pnpm's store cache.
