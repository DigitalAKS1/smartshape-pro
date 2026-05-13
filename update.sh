#!/bin/bash
# SmartShape Pro — Update Script
# Run this on the VPS whenever you want to deploy new code.
#
# USAGE (SSH into VPS, then):
#   cd /var/www/smartshape && bash update.sh

set -e

DEPLOY_DIR="/var/www/smartshape"
VPS_IP=$(curl -s ifconfig.me)

echo ""
echo "=================================================="
echo "   SmartShape Pro — Deploying Update"
echo "=================================================="
echo ""

cd $DEPLOY_DIR

echo "[1/4] Pulling latest code from GitHub..."
git pull origin main
echo "      Done."

echo "[2/4] Stopping running containers..."
docker compose -f docker-compose.prod.yml down --remove-orphans
echo "      Done."

echo "[3/4] Building new images..."
REACT_APP_BACKEND_URL="http://${VPS_IP}" \
  docker compose -f docker-compose.prod.yml build --no-cache
echo "      Done."

echo "[4/4] Starting updated containers..."
REACT_APP_BACKEND_URL="http://${VPS_IP}" \
  docker compose -f docker-compose.prod.yml up -d
echo "      Done."

echo ""
echo "  Waiting 15 seconds for startup..."
sleep 15

echo ""
echo "  Health check:"
curl -s http://localhost:8000/api/health && echo " ← Backend OK" || echo " ← Still starting..."

echo ""
echo "=================================================="
echo "   UPDATE DEPLOYED!"
echo "=================================================="
echo ""
echo "   Live at: http://${VPS_IP}"
echo ""
docker compose -f docker-compose.prod.yml ps
