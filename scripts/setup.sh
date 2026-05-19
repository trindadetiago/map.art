#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

# 1. Docker
bold "[1/3] Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop and re-run."
  exit 1
fi
dim "  docker ok"

# 2. Postgres via docker compose (non-fatal — still write .env on failure)
bold "[2/3] Starting Postgres (docker compose up -d)"
postgres_ok=0
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
else
  warn "  docker compose up failed (port conflict? existing container?) — continuing"
  warn "  fix it manually, then ensure DATABASE_URL in .env points at your Postgres"
fi

# 3. .env
bold "[3/3] Writing .env"
if [ -f .env ]; then
  warn "  .env already exists — leaving it alone"
else
  cp .env.example .env
  echo "  created .env from .env.example"
  echo "  edit .env to fill in GOOGLE_MAPS_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY"
fi

bold "Done."
echo "Next:"
echo "  pnpm install"
echo "  pnpm db:migrate"
echo "  pnpm dev"
