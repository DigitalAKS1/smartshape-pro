#!/bin/bash
# SmartShape — Production Deploy Script
# Run on your Hostinger VPS after SSH login
# Usage: bash deploy.sh

set -e

echo "==> Pulling latest code..."
git pull origin main

echo "==> Stopping containers..."
docker-compose down

echo "==> Building fresh images..."
docker-compose build --no-cache \
  --build-arg REACT_APP_BACKEND_URL="${REACT_APP_BACKEND_URL:-https://yourdomain.com}"

echo "==> Starting containers..."
docker-compose up -d

echo "==> Waiting for services to be healthy..."
sleep 5

echo "==> Container status:"
docker-compose ps

echo "==> Recent backend logs:"
docker-compose logs --tail=20 backend

echo ""
echo "✅  SmartShape deployed successfully!"
echo "    Frontend: http://localhost:3000"
echo "    Backend:  http://localhost:8000/docs"
