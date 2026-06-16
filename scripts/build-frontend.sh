#!/usr/bin/env bash
# Build the production frontend bundle OFF the VPS, then commit it.
#
# Why: the production VPS is RAM-constrained and OOM-thrashes if it runs webpack/craco
# (this stalled a deploy and tripped the host's resource monitor). So we build the
# bundle on a machine with RAM and ship the committed artifact; the VPS only serves it.
#
# Usage:
#   bash scripts/build-frontend.sh
#   git add frontend/build && git commit -m "chore(frontend): rebuild bundle" && git push origin main
#   # then on the VPS:  cd /var/www/smartshape && bash deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

export REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://app.smartshape.in}"
export DISABLE_ESLINT_PLUGIN=true
export CI=false
export NODE_OPTIONS="--max_old_space_size=4096"

echo "==> Clean previous build"
rm -rf build

echo "==> Building frontend (REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL)"
npm run build

echo "==> Done. Bundle:"
grep -oE 'static/js/main\.[a-z0-9]+\.js' build/index.html | head -1
echo "Next: git add frontend/build && git commit -m 'chore(frontend): rebuild bundle' && git push origin main"
