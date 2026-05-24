#!/bin/bash
# SmartShape — Transparent Tor Proxy for Evolution API
# ─────────────────────────────────────────────────────
# Bypasses Evolution API's broken proxy validator by intercepting
# all TCP from the Evolution container at the OS level and routing
# it through Tor SOCKS5, transparently.
#
# Prerequisites (already done):
#   - Tor installed: apt-get install -y tor
#   - /etc/tor/torrc has: SocksPort 0.0.0.0:9050
#   - Tor is running: systemctl start tor
#   - Evolution stack running: docker compose -f docker-compose.evolution.yml up -d
#
# Run as root on your VPS: bash setup_tor_proxy.sh

set -e

[ "$(id -u)" -ne 0 ] && { echo "ERROR: run as root"; exit 1; }

# ── 1. Ensure Tor is running ────────────────────────────────────────────────
if ! systemctl is-active --quiet tor 2>/dev/null; then
    echo "==> Starting Tor..."
    systemctl start tor
    sleep 3
fi
echo "✓ Tor running"

# ── 2. Install redsocks ─────────────────────────────────────────────────────
if ! command -v redsocks &>/dev/null; then
    echo "==> Installing redsocks..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends redsocks
fi
echo "✓ redsocks installed"

# ── 3. Configure redsocks → Tor ─────────────────────────────────────────────
cat > /etc/redsocks.conf << 'REDSOCKS_CONF'
base {
    log_debug = off;
    log_info  = on;
    log       = "syslog:daemon";
    daemon    = on;
    user      = nobody;
    group     = nogroup;
    redirector = iptables;
}

redsocks {
    local_ip   = 127.0.0.1;
    local_port = 12345;
    ip         = 127.0.0.1;
    port       = 9050;
    type       = socks5;
}
REDSOCKS_CONF

systemctl enable redsocks &>/dev/null
systemctl restart redsocks
sleep 2

systemctl is-active --quiet redsocks || {
    echo "ERROR: redsocks failed to start"
    journalctl -u redsocks --no-pager -n 20
    exit 1
}
echo "✓ redsocks running on 127.0.0.1:12345 → Tor 127.0.0.1:9050"

# ── 4. Get Docker network subnet ─────────────────────────────────────────────
DOCKER_SUBNET=$(docker network inspect smartshape_net \
    --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null)

if [ -z "$DOCKER_SUBNET" ]; then
    echo "WARNING: Could not detect smartshape_net subnet. Using fallback 172.0.0.0/8"
    DOCKER_SUBNET="172.0.0.0/8"
fi
echo "==> Docker network: $DOCKER_SUBNET"

# Get Evolution container IP (for display only)
EVO_IP=$(docker inspect smartshape_evolution \
    --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "unknown")
echo "==> Evolution container IP: $EVO_IP"

# ── 5. iptables transparent proxy rules ─────────────────────────────────────
echo "==> Configuring iptables..."

# Clean up any previous run
iptables -t nat -D PREROUTING -s "$DOCKER_SUBNET" -j SMARTSHAPE_TOR 2>/dev/null || true
iptables -t nat -F SMARTSHAPE_TOR 2>/dev/null || true
iptables -t nat -X SMARTSHAPE_TOR 2>/dev/null || true

# Create dedicated chain
iptables -t nat -N SMARTSHAPE_TOR

# Private ranges → bypass proxy (allows postgres/redis/internal Docker comms)
iptables -t nat -A SMARTSHAPE_TOR -d 127.0.0.0/8     -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 10.0.0.0/8      -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 172.16.0.0/12   -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 192.168.0.0/16  -j RETURN

# Everything else → redsocks → Tor
iptables -t nat -A SMARTSHAPE_TOR -p tcp -j REDIRECT --to-port 12345

# Apply to all containers in the Docker network
iptables -t nat -A PREROUTING -s "$DOCKER_SUBNET" -j SMARTSHAPE_TOR

echo "✓ iptables rules active"

# ── 6. Persist rules across reboots ─────────────────────────────────────────
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save 2>/dev/null && echo "✓ Rules persisted (netfilter-persistent)"
elif command -v iptables-save &>/dev/null; then
    mkdir -p /etc/iptables
    iptables-save > /etc/iptables/rules.v4 && echo "✓ Rules saved to /etc/iptables/rules.v4"
fi

# ── 7. Quick verification ────────────────────────────────────────────────────
echo ""
echo "==> Current PREROUTING rules:"
iptables -t nat -L PREROUTING -n --line-numbers

echo ""
echo "==> Testing Tor exit IP from Evolution container..."
TOR_IP=$(docker exec smartshape_evolution wget -qO- --timeout=15 https://ifconfig.io 2>/dev/null || echo "FAILED")
HOST_IP=$(wget -qO- --timeout=10 https://ifconfig.io 2>/dev/null || echo "unknown")

echo "   Host IP:      $HOST_IP"
echo "   Evolution IP: $TOR_IP"

if [ "$TOR_IP" != "$HOST_IP" ] && [ "$TOR_IP" != "FAILED" ]; then
    echo ""
    echo "✅ SUCCESS — Evolution API is now routing through Tor!"
    echo "   Tor exit IP: $TOR_IP (different from host $HOST_IP)"
    echo ""
    echo "Next: Restart Evolution API and try scanning the QR code"
    echo "  docker compose -f docker-compose.evolution.yml restart evolution-api"
else
    echo ""
    echo "⚠  WARNING — Proxy may not be working correctly"
    echo "   Expected different IPs but got: $TOR_IP"
    echo "   Check: journalctl -u redsocks -n 30"
    echo "   Check: journalctl -u tor -n 30"
fi
