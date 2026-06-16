#!/bin/bash
# SmartShape — Production Deploy Script
# Run ON the Hostinger VPS:  bash deploy.sh
#
# Rebuilds ONLY backend + frontend via docker-compose.prod.yml.
# Never runs `down` / `--remove-orphans` — the Mongo / WhatsApp / Tor containers
# share this compose project and would otherwise be destroyed.
#
# Safety net: records the current commit BEFORE deploying and, if the new build
# fails its health check, AUTOMATICALLY rolls back to the previous version so a
# bad push cannot leave the live business offline.

set -e

cd /var/www/smartshape

PREV_COMMIT="$(git rev-parse HEAD)"
echo "==> Rollback point (current commit): $PREV_COMMIT"

echo "==> Syncing code to origin/main..."
git fetch origin main
git reset --hard origin/main
NEW_COMMIT="$(git rev-parse HEAD)"
echo "==> Deploying commit: $NEW_COMMIT"

# The frontend is prebuilt OFF the VPS and committed under frontend/build (this box
# OOM-thrashes if it runs webpack). Fail fast if the bundle is missing so we never
# ship an empty frontend.
if [ ! -f frontend/build/index.html ]; then
  echo "!! frontend/build/index.html is missing on $NEW_COMMIT."
  echo "   Build it off-box first:  bash scripts/build-frontend.sh  (then commit frontend/build & push)."
  exit 1
fi

# Layer-cached build: backend reuses its pip layer (only changed code re-copies),
# frontend is a static-file copy into nginx. No --no-cache -> light + fast, so the
# host's resource monitor is never tripped.
build_and_up() {
  REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://app.smartshape.in}" \
    docker compose -f docker-compose.prod.yml build backend frontend
  REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://app.smartshape.in}" \
    docker compose -f docker-compose.prod.yml up -d backend frontend
}

healthy() {
  curl -sf http://localhost:8000/api/health > /dev/null 2>&1
}

echo "==> Building + recreating containers..."
build_and_up

echo "==> Waiting for startup..."
sleep 15

if healthy; then
  echo "==> Health check: Backend OK"
  echo "==> Container status:"
  docker compose -f docker-compose.prod.yml ps
  echo ""
  echo "Deployed $NEW_COMMIT. Live at https://app.smartshape.in"
else
  echo "!! Health check FAILED for $NEW_COMMIT — rolling back to $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT"
  build_and_up
  sleep 15
  if healthy; then
    echo "==> Rolled back successfully to $PREV_COMMIT. Investigate the bad commit before re-deploying."
  else
    echo "!! Rollback ALSO failed health check — manual help needed."
    echo "   Check logs: docker compose -f docker-compose.prod.yml logs --tail=100 backend"
  fi
  exit 1
fi
