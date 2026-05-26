#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

# 1. Docker
bold "[1/4] Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and re-run."
  exit 1
fi
dim "  docker ok"

# 2. Services via docker compose (non-fatal — still write .env on failure)
bold "[2/4] Starting services (docker compose up -d)"
postgres_ok=0
minio_ok=0
if docker compose up -d; then
  dim "  waiting for postgres..."
  for i in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U jp -d jp >/dev/null 2>&1; then
      dim "  postgres ready"
      postgres_ok=1
      break
    fi
    sleep 1
  done
  if [ "$postgres_ok" = 0 ]; then
    warn "  postgres did not become ready in 30s — continuing"
  fi

  dim "  waiting for minio..."
  for i in $(seq 1 30); do
    if curl -fsS http://localhost:9000/minio/health/live >/dev/null 2>&1; then
      dim "  minio ready (api :9000, console :9001)"
      minio_ok=1
      break
    fi
    sleep 1
  done
  if [ "$minio_ok" = 0 ]; then
    warn "  minio did not become ready in 30s — continuing"
  fi
else
  warn "  docker compose up failed (port conflict? existing container?) — continuing"
  warn "  fix it manually, then ensure DATABASE_URL / S3_* in .env match your services"
fi

# 3. .env (create if missing, otherwise append only the keys it doesn't already have)
bold "[3/4] Syncing .env with .env.example"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  created .env from .env.example"
  echo "  edit .env to fill in GOOGLE_MAPS_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY"
else
  added=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    if ! grep -qE "^${key}=" .env; then
      if [ "$added" = 0 ]; then
        printf '\n# Added by setup.sh on %s\n' "$(date +%Y-%m-%d)" >> .env
        added=1
      fi
      printf '%s\n' "$line" >> .env
      dim "  + $key"
    fi
  done < .env.example
  if [ "$added" = 0 ]; then
    dim "  .env already has every key from .env.example"
  fi
fi

# 4. Install + migrate (non-fatal — surface errors but don't abort the script)
bold "[4/4] Installing deps & running migrations"
if pnpm install >/dev/null 2>&1; then
  dim "  pnpm install ok"
else
  warn "  pnpm install failed — run 'pnpm install' manually to see the error"
fi

if [ "$postgres_ok" = 1 ]; then
  if pnpm db:migrate >/dev/null 2>&1; then
    dim "  migrations applied"
  else
    warn "  pnpm db:migrate failed — check DATABASE_URL in .env, then run 'pnpm db:migrate'"
  fi
else
  warn "  skipping migrations — postgres was not ready"
fi

bold "Done."
echo "Next:"
echo "  pnpm dev"
