#!/bin/bash
# SmartShape Pro — First-time Hostinger VPS Setup
# Run this ONCE after getting VPS access.
# Usage: bash setup-vps.sh yourdomain.com

set -e
DOMAIN=${1:-yourdomain.com}
DEPLOY_DIR="/var/www/smartshape"

echo "=== 1. System update ==="
apt-get update && apt-get upgrade -y

echo "=== 2. Install Docker ==="
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "=== 3. Install Docker Compose plugin ==="
apt-get install -y docker-compose-plugin

echo "=== 4. Install Nginx + Certbot ==="
apt-get install -y nginx certbot python3-certbot-nginx

echo "=== 5. Install Git ==="
apt-get install -y git

echo "=== 6. Clone the repo ==="
mkdir -p $DEPLOY_DIR
git clone https://github.com/DigitalAKS1/smartshape-pro.git $DEPLOY_DIR
cd $DEPLOY_DIR

echo ""
echo "=== 7. Create backend .env ==="
echo "Creating $DEPLOY_DIR/backend/.env with production values..."
cat > $DEPLOY_DIR/backend/.env <<ENV
MONGO_URL=mongodb+srv://smartshape:Aman%401996%24@cluster0.xixalur.mongodb.net/?retryWrites=true&w=majority
DB_NAME=smartshape_prod
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
ENVIRONMENT=production
FRONTEND_URL=https://${DOMAIN}
CORS_ORIGINS=https://${DOMAIN}
ADMIN_EMAIL=info@smartshape.in
ADMIN_PASSWORD=admin123
ENV

echo "=== 8. Setup Nginx config ==="
sed "s/yourdomain.com/${DOMAIN}/g" $DEPLOY_DIR/nginx-vps.conf > /etc/nginx/sites-available/smartshape

# Temporarily serve HTTP only so certbot can verify
cat > /etc/nginx/sites-available/smartshape-temp <<NGINX
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    location / { return 200 'OK'; }
}
NGINX

ln -sf /etc/nginx/sites-available/smartshape-temp /etc/nginx/sites-enabled/smartshape
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "=== 9. Get SSL certificate ==="
certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --non-interactive --agree-tos -m info@smartshape.in

echo "=== 10. Switch to full Nginx config ==="
ln -sf /etc/nginx/sites-available/smartshape /etc/nginx/sites-enabled/smartshape
nginx -t && systemctl reload nginx

echo "=== 11. Build and start Docker containers ==="
cd $DEPLOY_DIR
REACT_APP_BACKEND_URL=https://${DOMAIN} docker compose -f docker-compose.prod.yml up -d --build

echo "=== 12. Setup GitHub Actions SSH deploy key ==="
echo ""
echo "Generate a deploy key (run this, then add pubkey to GitHub Deploy Keys):"
echo "  ssh-keygen -t ed25519 -f ~/.ssh/smartshape_deploy -N ''"
echo "  cat ~/.ssh/smartshape_deploy.pub   # Add to GitHub repo → Settings → Deploy keys"
echo "  cat ~/.ssh/smartshape_deploy       # Add as VPS_SSH_KEY in GitHub Secrets"
echo ""
echo "Required GitHub Secrets:"
echo "  VPS_HOST      = $(curl -s ifconfig.me)"
echo "  VPS_USER      = root"
echo "  VPS_SSH_KEY   = (contents of ~/.ssh/smartshape_deploy)"
echo "  DEPLOY_PATH   = ${DEPLOY_DIR}"
echo "  DOMAIN        = ${DOMAIN}"
echo ""
echo "===  VPS setup complete! ==="
echo "    App URL: https://${DOMAIN}"
echo "    Backend: http://localhost:8000/api/health"
