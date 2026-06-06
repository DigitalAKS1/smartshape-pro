#!/bin/bash
# SmartShape — Production Deploy Script
# Run ON the Hostinger VPS:  bash deploy.sh
#
# Rebuilds ONLY backend + frontend via docker-compose.prod.yml.
# Never runs `down` / `--remove-orphans` — the Mongo / WhatsApp / Tor containers
# share this compose project and would otherwise be destroyed.

set -e

cd /var/www/smartshape

echo "==> Syncing code to origin/main..."
git fetch origin main
git reset --hard origin/main

echo "==> Building backend + frontend (no-cache)..."
REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://app.smartshape.in}" \
  docker compose -f docker-compose.prod.yml build --no-cache backend frontend

echo "==> Recreating containers..."
REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://app.smartshape.in}" \
  docker compose -f docker-compose.prod.yml up -d backend frontend

echo "==> Waiting for startup..."
sleep 12

echo "==> Health check:"
curl -sf http://localhost:8000/api/health && echo " Backend OK" || echo " Backend starting / check logs"

echo "==> Container status:"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "Deployed. Live at https://app.smartshape.in"
