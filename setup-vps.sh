#!/bin/bash
# SmartShape Pro — One-Time Hostinger VPS Setup
set -e

DEPLOY_DIR="/var/www/smartshape"
GITHUB_REPO="https://github.com/DigitalAKS1/smartshape-pro.git"

echo ""
echo "=================================================="
echo "   SmartShape Pro — VPS Setup"
echo "=================================================="
echo ""

echo "[1/8] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
echo "      Done."

echo "[2/8] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi
docker --version
echo "      Done."

echo "[3/8] Installing Docker Compose..."
apt-get install -y -qq docker-compose-plugin
docker compose version
echo "      Done."

echo "[4/8] Installing Nginx..."
apt-get install -y -qq nginx
systemctl enable nginx
systemctl start nginx
echo "      Done."

echo "[5/8] Cloning SmartShape Pro from GitHub..."
mkdir -p $DEPLOY_DIR
if [ -d "$DEPLOY_DIR/.git" ]; then
    echo "      Repo already exists — pulling latest..."
    git -C $DEPLOY_DIR pull origin main
else
    git clone $GITHUB_REPO $DEPLOY_DIR
fi
echo "      Done."

echo "[6/8] Creating backend environment file..."
VPS_IP=$(curl -s https://ipinfo.io/ip 2>/dev/null || curl -s https://api.ipify.org 2>/dev/null || echo "YOUR_VPS_IP")

cat > $DEPLOY_DIR/backend/.env << ENVEOF
MONGO_URL=mongodb+srv://smartshape:Aman%401996%24@cluster0.xixalur.mongodb.net/?retryWrites=true&w=majority
DB_NAME=smartshape_prod
CORS_ORIGINS=*
ENVIRONMENT=production
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
ADMIN_EMAIL=info@smartshape.in
ADMIN_PASSWORD=admin123
FRONTEND_URL=http://${VPS_IP}
ENVEOF

echo "      .env created. VPS IP: $VPS_IP"

echo "[7/8] Configuring Nginx..."
cp $DEPLOY_DIR/nginx-vps.conf /etc/nginx/sites-available/smartshape
ln -sf /etc/nginx/sites-available/smartshape /etc/nginx/sites-enabled/smartshape
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "      Done."

echo "[8/8] Building and starting SmartShape Pro..."
cd $DEPLOY_DIR
REACT_APP_BACKEND_URL=http://${VPS_IP} docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "  Waiting 20 seconds for startup..."
sleep 20

echo ""
echo "  Health check:"
curl -s http://localhost:8000/api/health && echo " — Backend OK" || echo " — Still starting, wait 30s more"

echo ""
echo "=================================================="
echo "   SETUP COMPLETE!"
echo "=================================================="
echo ""
echo "   App URL:  http://${VPS_IP}"
echo ""
docker compose -f docker-compose.prod.yml ps
