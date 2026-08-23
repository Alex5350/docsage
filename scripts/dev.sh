#!/usr/bin/env bash
# Boot the full local stack: pgvector db, FastAPI, Next.js dev server.
# Usage: scripts/dev.sh   (Ctrl-C stops everything)
set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  trap - EXIT
  kill $(jobs -p) 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! docker ps --format '{{.Names}}' | grep -q '^docsage-db$'; then
  echo ">> starting docsage-db"
  docker compose up -d db
fi

echo ">> backend on :8000"
(cd backend && uv run uvicorn docsage_api.main:app --port 8000 --reload) &
BACKEND=$!

echo ">> frontend on :3000"
(cd frontend && npm run dev -- --port 3000) &
FRONTEND=$!

wait
