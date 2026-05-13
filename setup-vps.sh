#!/bin/bash
# SmartShape Pro — One-Time Hostinger VPS Setup
# Run this ONCE when you first get your VPS.
#
# USAGE (SSH into your VPS first, then):
#   bash setup-vps.sh
#
# What this does:
#   1. Updates the system
#   2. Installs Docker + Nginx
#   3. Clones your GitHub repo
#   4. Configures Nginx
#   5. Asks you to paste your .env secrets
#   6. Starts the app

set -e   # stop on any error

DEPLOY_DIR="/var/www/smartshape"
GITHUB_REPO="https://github.com/DigitalAKS1/smartshape-pro.git"

echo ""
echo "=================================================="
echo "   SmartShape Pro — VPS Setup"
echo "=================================================="
echo ""

# ── Step 1: Update system ──────────────────────────────
echo "[1/8] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
echo "      Done."

# ── Step 2: Install Docker ─────────────────────────────
echo "[2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi
docker --version
echo "      Done."

# ── Step 3: Install Docker Compose plugin ─────────────
echo "[3/8] Installing Docker Compose..."
apt-get install -y -qq docker-compose-plugin
docker compose version
echo "      Done."

# ── Step 4: Install Nginx ──────────────────────────────
echo "[4/8] Installing Nginx..."
apt-get install -y -qq nginx
systemctl enable nginx
systemctl start nginx
echo "      Done."

# ── Step 5: Clone repo ─────────────────────────────────
echo "[5/8] Cloning SmartShape Pro from GitHub..."
mkdir -p $DEPLOY_DIR
if [ -d "$DEPLOY_DIR/.git" ]; then
    echo "      Repo already exists — pulling latest..."
    git -C $DEPLOY_DIR pull origin main
else
    git clone $GITHUB_REPO $DEPLOY_DIR
fi
echo "      Done."

# ── Step 6: Create backend .env ────────────────────────
echo ""
echo "[6/8] Creating backend environment file..."
echo ""
echo "  You need to paste your backend .env contents."
echo "  (Copy from your F drive: SMARTSHAPE APP/backend/.env)"
echo "  Press ENTER after the last line, then Ctrl+D to finish."
echo ""
echo "---------- PASTE .env below, then Ctrl+D ----------"
mkdir -p $DEPLOY_DIR/backend
cat > $DEPLOY_DIR/backend/.env
echo ""

# Update .env for production (replace localhost with the VPS IP)
VPS_IP=$(curl -s ifconfig.me)
sed -i "s|http://localhost:3000|http://${VPS_IP}|g" $DEPLOY_DIR/backend/.env
sed -i 's|CORS_ORIGINS="*"|CORS_ORIGINS="*"|g' $DEPLOY_DIR/backend/.env
echo "      .env saved. VPS IP detected as: $VPS_IP"

# ── Step 7: Configure Nginx ────────────────────────────
echo "[7/8] Configuring Nginx..."
cp $DEPLOY_DIR/nginx-vps.conf /etc/nginx/sites-available/smartshape
ln -sf /etc/nginx/sites-available/smartshape /etc/nginx/sites-enabled/smartshape
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "      Done."

# ── Step 8: Build & start app ──────────────────────────
echo "[8/8] Building and starting SmartShape Pro..."
cd $DEPLOY_DIR
REACT_APP_BACKEND_URL="http://${VPS_IP}" \
  docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "  Waiting 20 seconds for containers to start..."
sleep 20

echo ""
echo "  Health check:"
curl -s http://localhost:8000/api/health && echo " ← Backend OK" || echo " ← Backend starting (may need 30s more)"

echo ""
echo "=================================================="
echo "   SETUP COMPLETE!"
echo "=================================================="
echo ""
echo "   App URL:     http://${VPS_IP}"
echo "   API health:  http://${VPS_IP}/api/health"
echo ""
echo "   To update the app in future, run:"
echo "   cd $DEPLOY_DIR && bash update.sh"
echo ""
echo "   Container status:"
docker compose -f docker-compose.prod.yml ps
