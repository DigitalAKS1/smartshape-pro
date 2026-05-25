#!/bin/bash
# SmartShape — Transparent SOCKS5 Proxy for Evolution API
# ─────────────────────────────────────────────────────────
# Routes all Evolution container TCP through a SOCKS5 proxy at the OS
# level (redsocks + iptables REDIRECT).  Works with both free Tor and
# paid residential proxies (SmartProxy, BrightData, ProxyScrape, etc.)
#
# USAGE
# ─────
# Tor (free, already installed):
#   sudo bash setup_tor_proxy.sh
#
# Residential SOCKS5 (recommended for WhatsApp):
#   sudo PROXY_HOST=gate.smartproxy.com \
#        PROXY_PORT=7000 \
#        PROXY_USER=spuser12345 \
#        PROXY_PASS=hunter2 \
#        bash setup_tor_proxy.sh
#
# Or pass args directly:
#   sudo bash setup_tor_proxy.sh <host> <port> [user] [pass]
#
# Re-run any time to change proxy config.
# ─────────────────────────────────────────────────────────

set -e
[ "$(id -u)" -ne 0 ] && { echo "ERROR: run as root"; exit 1; }

# ── Resolve proxy config (args > env vars > Tor default) ─────────────────────
PROXY_HOST="${1:-${PROXY_HOST:-}}"
PROXY_PORT="${2:-${PROXY_PORT:-}}"
PROXY_USER="${3:-${PROXY_USER:-}}"
PROXY_PASS="${4:-${PROXY_PASS:-}}"

if [ -z "$PROXY_HOST" ]; then
    # Default: Tor
    USE_TOR=1
    PROXY_HOST="127.0.0.1"
    PROXY_PORT="9050"
    PROXY_USER=""
    PROXY_PASS=""
    PROXY_LABEL="Tor (127.0.0.1:9050)"
else
    USE_TOR=0
    : "${PROXY_PORT:=1080}"
    PROXY_LABEL="$PROXY_HOST:$PROXY_PORT"
    [ -n "$PROXY_USER" ] && PROXY_LABEL="$PROXY_USER@$PROXY_LABEL"
fi

echo "==> Proxy backend: $PROXY_LABEL"

# ── 1. Tor (only if using Tor mode) ──────────────────────────────────────────
if [ "$USE_TOR" = "1" ]; then
    if ! command -v tor &>/dev/null; then
        echo "==> Installing Tor..."
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tor
    fi

    # Ensure SocksPort and SocksPolicy are correct
    sed -i '/^SocksPort 0\.0\.0\.0/d' /etc/tor/torrc
    sed -i '/^SocksPolicy/d'           /etc/tor/torrc
    cat >> /etc/tor/torrc << 'TORRC'
SocksPort 0.0.0.0:9050
SocksPolicy accept 172.16.0.0/12
SocksPolicy accept 127.0.0.1
SocksPolicy reject *
TORRC

    systemctl enable tor &>/dev/null
    systemctl restart tor
    sleep 4

    systemctl is-active --quiet tor || {
        echo "ERROR: Tor failed to start"
        journalctl -u tor --no-pager -n 20
        exit 1
    }
    echo "✓ Tor running"
fi

# ── 2. Install redsocks ───────────────────────────────────────────────────────
if ! command -v redsocks &>/dev/null; then
    echo "==> Installing redsocks..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends redsocks
fi
echo "✓ redsocks installed"

# ── 3. Write redsocks config ──────────────────────────────────────────────────
# Build optional auth lines
AUTH_LINES=""
if [ -n "$PROXY_USER" ]; then
    AUTH_LINES="    login    = \"$PROXY_USER\";
    password = \"$PROXY_PASS\";"
fi

cat > /etc/redsocks.conf << REDSOCKS_CONF
base {
    log_debug  = off;
    log_info   = on;
    log        = "syslog:daemon";
    daemon     = on;
    user       = nobody;
    group      = nogroup;
    redirector = iptables;
}

redsocks {
    local_ip   = 127.0.0.1;
    local_port = 12345;
    ip         = $PROXY_HOST;
    port       = $PROXY_PORT;
    type       = socks5;
$AUTH_LINES
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
echo "✓ redsocks → $PROXY_LABEL on 127.0.0.1:12345"

# ── 4. Detect Docker network subnet ──────────────────────────────────────────
DOCKER_SUBNET=$(docker network inspect smartshape_net \
    --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo "")
if [ -z "$DOCKER_SUBNET" ]; then
    echo "WARNING: smartshape_net not found — using fallback 172.0.0.0/8"
    DOCKER_SUBNET="172.0.0.0/8"
fi
EVO_IP=$(docker inspect smartshape_evolution \
    --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "unknown")
echo "==> Docker subnet : $DOCKER_SUBNET"
echo "==> Evolution IP  : $EVO_IP"

# ── 5. iptables rules ────────────────────────────────────────────────────────
echo "==> Configuring iptables..."

iptables -t nat -D PREROUTING -s "$DOCKER_SUBNET" -j SMARTSHAPE_PROXY 2>/dev/null || true
iptables -t nat -F SMARTSHAPE_PROXY 2>/dev/null || true
iptables -t nat -X SMARTSHAPE_PROXY 2>/dev/null || true

iptables -t nat -N SMARTSHAPE_PROXY

# Private ranges → bypass (postgres, redis, internal Docker traffic)
iptables -t nat -A SMARTSHAPE_PROXY -d 127.0.0.0/8    -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 10.0.0.0/8     -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 172.16.0.0/12  -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 192.168.0.0/16 -j RETURN

# All other TCP → redsocks → proxy
iptables -t nat -A SMARTSHAPE_PROXY -p tcp -j REDIRECT --to-port 12345

# Apply to everything in the Evolution Docker network
iptables -t nat -A PREROUTING -s "$DOCKER_SUBNET" -j SMARTSHAPE_PROXY

echo "✓ iptables active"

# ── 6. Persist across reboots ────────────────────────────────────────────────
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save 2>/dev/null && echo "✓ Rules persisted"
elif command -v iptables-save &>/dev/null; then
    mkdir -p /etc/iptables
    iptables-save > /etc/iptables/rules.v4 && echo "✓ Saved to /etc/iptables/rules.v4"
fi

# ── 7. Verify ────────────────────────────────────────────────────────────────
echo ""
echo "==> Testing exit IP from Evolution container (15s timeout)..."
EVO_EXIT=$(docker exec smartshape_evolution \
    wget -qO- --timeout=15 https://ifconfig.io 2>/dev/null || \
    docker exec smartshape_evolution \
    curl -s --max-time 15 https://ifconfig.io 2>/dev/null || echo "FAILED")
HOST_EXIT=$(curl -s --max-time 10 https://ifconfig.io 2>/dev/null || echo "unknown")

echo "   VPS host IP      : $HOST_EXIT"
echo "   Evolution exit IP: $EVO_EXIT"

if [ "$EVO_EXIT" = "FAILED" ]; then
    echo ""
    echo "⚠  Could not reach ifconfig.io from Evolution container."
    echo "   Possible causes:"
    echo "     1. Proxy credentials wrong / proxy not accepting connections"
    echo "     2. redsocks config issue — check: journalctl -u redsocks -n 30"
    if [ "$USE_TOR" = "1" ]; then
    echo "     3. Tor circuit not ready — wait 10s and re-test:"
    echo "        docker exec smartshape_evolution curl -s https://ifconfig.io"
    fi
elif [ "$EVO_EXIT" = "$HOST_EXIT" ]; then
    echo ""
    echo "⚠  Exit IPs are the same — proxy may not be routing correctly."
    echo "   Check redsocks: journalctl -u redsocks -n 30"
else
    echo ""
    echo "✅  Proxy active — Evolution API exits via $EVO_EXIT"
    echo ""
    echo "Next steps:"
    echo "  1. Restart Evolution API:"
    echo "     docker compose -f docker-compose.evolution.yml restart evolution-api"
    echo "  2. Open SmartShape → Marketing → WhatsApp Setup → Connect"
    echo "  3. Scan the QR code"
fi
