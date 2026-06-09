# CI/CD for map.art on Railway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Actions CI (typecheck + lint + DB-backed tests) on every PR/push, and CD that deploys only the changed Railway services on merge to `main` once CI is green, plus branch protection on `main`.

**Architecture:** A single workflow `.github/workflows/ci.yml` with three jobs — `check` (the test gate, with a Postgres service container), `changes` (path-filter computing which services changed), and `deploy` (`needs: [check, changes]`, runs `railway up --ci --service <name>` only for changed services, only on push to `main`). A repo-wide `typecheck` script is added so CI has one command.

**Tech Stack:** GitHub Actions, pnpm 9.12.0, Node 22, Postgres 16 service container, `dorny/paths-filter`, Railway CLI, Biome, Vitest, TypeScript.

---

## Spec reference

Design doc: `docs/superpowers/specs/2026-06-09-ci-cd-railway-design.md`. Read it first.

## File structure

- **`package.json` (root)** — add `typecheck` script that fans out to workspaces.
- **`apps/web/package.json`, `apps/worker-render/package.json`, `apps/worker-stylize/package.json`, `apps/cli/package.json`** — add `typecheck` script.
- **`packages/db/package.json`, `packages/env/package.json`, `packages/geo/package.json`, `packages/models/package.json`, `packages/renderer/package.json`, `packages/storage/package.json`, `packages/stylize/package.json`** — add `typecheck` script.
- **`.github/workflows/ci.yml`** — new workflow (built incrementally across Tasks 2–4).

## Notes on verification in this repo

- `act` and `gh` are **not installed**. So: GitHub Actions YAML can't be executed locally. Verify each job's *commands* locally (run exactly what the job runs), validate YAML syntax, then push the branch and observe the run on GitHub's Actions tab / the PR checks.
- The `deploy` job only fires on push to `main`; it's verified at the end by merging and watching the Actions run, not locally.
- Confirmed locally during planning: `pnpm --filter @mapart/geo exec tsc --noEmit` and `pnpm --filter @mapart/web exec tsc --noEmit` both exit 0, so `tsc --noEmit` per workspace is the right command.

---

## Task 1: Add a repo-wide `typecheck` script

**Files:**
- Modify: `package.json` (root, scripts block)
- Modify: `apps/web/package.json`, `apps/worker-render/package.json`, `apps/worker-stylize/package.json`, `apps/cli/package.json`
- Modify: `packages/db/package.json`, `packages/env/package.json`, `packages/geo/package.json`, `packages/models/package.json`, `packages/renderer/package.json`, `packages/storage/package.json`, `packages/stylize/package.json`

- [ ] **Step 1: Add `typecheck` to each workspace package.json**

In each of the 11 workspace files listed above, add this entry to the `"scripts"` object (for the ones with no `scripts` block — `packages/env`, `packages/geo`, `packages/storage` — create the block):

```json
"typecheck": "tsc --noEmit"
```

Example for `packages/geo/package.json` (no prior scripts):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Example for `apps/worker-render/package.json` (has scripts — add the key, keep the rest):

```json
"scripts": {
  "dev": "...",
  "build:page": "...",
  "test": "vitest run",
  "test:watch": "...",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Add the root `typecheck` script**

In root `package.json` `"scripts"`, add (next to `"test"`):

```json
"typecheck": "pnpm -r --if-present typecheck"
```

- [ ] **Step 3: Run the repo-wide typecheck**

Run: `pnpm typecheck`
Expected: every workspace runs `tsc --noEmit`; exit 0. If any workspace surfaces latent type errors, fix them now (this is expected per the spec's risk note). For `apps/web`, if you hit phantom errors referencing old paths, run `rm -rf apps/web/.next` and re-run.

- [ ] **Step 4: Confirm lint and tests still pass locally**

Run: `pnpm lint`
Expected: exit 0 (Biome reports no errors).

Run: `pnpm test`
Expected: all suites pass. Requires the local Postgres container up (`docker compose up -d` if not running) — these are the same DB suites CI will run.

- [ ] **Step 5: Commit**

```bash
git add package.json apps/*/package.json packages/*/package.json
git commit -m "build: add typecheck script across workspaces"
```

---

## Task 2: CI workflow — `check` job (typecheck + lint + test with Postgres)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow with the `check` job**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
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
    env:
      DATABASE_URL: postgres://jp:jp@localhost:5432/jp
      S3_ENDPOINT: http://localhost:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY_ID: ci
      S3_SECRET_ACCESS_KEY: ci-secret
      S3_BUCKET: ci-bucket
      S3_FORCE_PATH_STYLE: "true"
      GOOGLE_MAPS_API_KEY: ci-dummy-key
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

- [ ] **Step 2: Validate the YAML syntax locally**

Run: `node -e "const yaml=require('yaml'); yaml.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('ok')"`
Expected: `ok`. If `yaml` isn't resolvable, instead run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`.

- [ ] **Step 3: Mirror the job's commands locally to confirm they pass**

Run (the exact sequence the `check` job runs):

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test
```

Expected: all four succeed, exit 0. (Local Postgres must be up; CI uses its own container.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add check job (typecheck, lint, test with postgres)"
```

- [ ] **Step 5: Push and observe the real run**

```bash
git push -u origin feat/ci-cd-railway
```

Open the branch's PR (or the Actions tab) on GitHub. Expected: the `check` job runs and goes green. If the DB suites fail on Postgres readiness, confirm the `health-cmd` and that `DATABASE_URL` host is `localhost`. Fix and push until green.

---

## Task 3: CI workflow — `changes` job (path filter)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the `changes` job**

Add this job to `.github/workflows/ci.yml` under `jobs:` (a sibling of `check`):

```yaml
  changes:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    outputs:
      web: ${{ steps.filter.outputs.web }}
      worker_render: ${{ steps.filter.outputs.worker_render }}
      worker_stylize: ${{ steps.filter.outputs.worker_stylize }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            shared: &shared
              - 'packages/**'
              - 'package.json'
              - 'pnpm-lock.yaml'
              - 'pnpm-workspace.yaml'
            web:
              - *shared
              - 'apps/web/**'
            worker_render:
              - *shared
              - 'apps/worker-render/**'
            worker_stylize:
              - *shared
              - 'apps/worker-stylize/**'
```

Note: output keys use underscores (`worker_render`) because `dorny/paths-filter` outputs must be valid identifiers; the deploy job maps them to the hyphenated Railway service names.

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add path-filter job to detect changed services"
git push
```

- [ ] **Step 4: Verify filter outputs on the real run**

On the PR's Actions run, open the `changes` job logs. Expected: it lists the filters and reports `true`/`false` per service. Since this branch touches only `.github/` and `docs/`, expect all three to be `false` (proving the filter discriminates). To sanity-check a positive, you can temporarily touch a file under `apps/web/` in a scratch commit and confirm `web=true`, then drop it — optional.

---

## Task 4: CI workflow — `deploy` job (changed services only, gated on CI)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the `deploy` job**

Add this job to `.github/workflows/ci.yml` under `jobs:`:

```yaml
  deploy:
    needs: [check, changes]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    env:
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Install Railway CLI
        run: npm i -g @railway/cli
      - name: Deploy web
        if: needs.changes.outputs.web == 'true'
        run: railway up --ci --service web
      - name: Deploy worker-render
        if: needs.changes.outputs.worker_render == 'true'
        run: railway up --ci --service worker-render
      - name: Deploy worker-stylize
        if: needs.changes.outputs.worker_stylize == 'true'
        run: railway up --ci --service worker-stylize
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add deploy job for changed Railway services"
git push
```

- [ ] **Step 4: Confirm deploy does NOT run on the PR**

On the PR's Actions run, expected: the `deploy` job is skipped (the `if` condition is false on `pull_request`). Verify it shows as skipped, not run. Full deploy verification happens in Task 6 after the secret + merge.

---

## Task 5: Railway token + GitHub secret (manual, guided)

**Files:** none (Railway dashboard + GitHub settings)

- [ ] **Step 1: Generate a Railway project token**

In the Railway dashboard → project "azimute art project" → **Settings → Tokens** (Project Tokens), create a token scoped to the **production** environment. Copy it.

- [ ] **Step 2: Store it as a GitHub Actions secret**

GitHub repo `trindadetiago/map.art` → **Settings → Secrets and variables → Actions → New repository secret**. Name: `RAILWAY_TOKEN`. Value: the token. Save.

- [ ] **Step 3: Confirm**

The secret `RAILWAY_TOKEN` appears in the Actions secrets list (value hidden). No code change; nothing to commit.

---

## Task 6: Branch protection on `main` (manual, guided)

**Files:** none (GitHub settings)

- [ ] **Step 1: Add a branch protection rule / ruleset**

GitHub repo → **Settings → Branches → Add branch ruleset** (or classic "Add rule") targeting `main`:
- Require a pull request before merging.
- Require status checks to pass before merging → add the **`check`** check (it appears in the search after the workflow has run at least once — that's why Task 2 pushed first).
- Block direct pushes (do not allow bypass for the default path).

- [ ] **Step 2: Verify the gate**

Confirm: on the open PR, the merge button is blocked until `check` is green. Direct `git push origin main` is rejected.

- [ ] **Step 3: Merge and watch CD**

Merge the PR into `main`. On the resulting `push` Actions run, expected: `check` runs green, `changes` reports `false` for all services (this PR only touched `.github/` + `docs/`), so all three `deploy` steps are skipped and the `deploy` job succeeds with nothing deployed. This proves the wiring without spending build credit. The first *real* deploy will happen on the next PR that touches `apps/**` or `packages/**`.

---

## Self-review notes

- **Spec coverage:** CI typecheck+lint+test with Postgres → Tasks 1–2. Path-filtered CD → Tasks 3–4. Branch protection → Task 6. Railway token/secret → Task 5. `typecheck` script addition → Task 1. All spec sections mapped.
- **Type/name consistency:** filter outputs `web` / `worker_render` / `worker_stylize` are defined in Task 3 and consumed verbatim in Task 4 (`needs.changes.outputs.*`); Railway `--service` names are the hyphenated `web` / `worker-render` / `worker-stylize` matching the deployed services.
- **No placeholders:** every step has the literal YAML/JSON/commands to run.
