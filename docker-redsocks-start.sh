#!/bin/bash
# Transparent SOCKS5 proxy sidecar for Evolution API
# Shares Evolution API's network namespace — iptables OUTPUT rules here
# affect all TCP leaving the Evolution container.
#
# Set PROXY_HOST in .env.evolution to use a residential proxy instead of Tor:
#   PROXY_HOST=gate.smartproxy.com
#   PROXY_PORT=10001
#   PROXY_USER=spuser12345
#   PROXY_PASS=hunter2

set -e

PROXY_HOST="${PROXY_HOST:-}"
PROXY_PORT="${PROXY_PORT:-10001}"
PROXY_USER="${PROXY_USER:-}"
PROXY_PASS="${PROXY_PASS:-}"

# ── Decide: residential proxy or Tor fallback ─────────────────────────────────
if [ -n "$PROXY_HOST" ]; then
    SOCKS_HOST="$PROXY_HOST"
    SOCKS_PORT="$PROXY_PORT"
    echo "==> Using residential proxy: $PROXY_HOST:$PROXY_PORT"
    AUTH_CONF=""
    if [ -n "$PROXY_USER" ]; then
        AUTH_CONF="    login    = \"$PROXY_USER\";
    password = \"$PROXY_PASS\";"
        echo "    Auth: $PROXY_USER"
    fi
else
    echo "==> No PROXY_HOST set — falling back to Tor container"
    echo "==> Waiting for Tor container..."
    for i in $(seq 1 60); do
        SOCKS_HOST=$(getent hosts tor 2>/dev/null | awk '{print $1}' | head -1)
        [ -n "$SOCKS_HOST" ] && break
        sleep 2
    done
    if [ -z "$SOCKS_HOST" ]; then
        echo "ERROR: Could not resolve 'tor' — is the tor service running?"
        exit 1
    fi
    SOCKS_PORT="9050"
    AUTH_CONF=""
    echo "    Tor IP: $SOCKS_HOST"
fi

# ── Write redsocks config ─────────────────────────────────────────────────────
cat > /tmp/redsocks.conf << EOF
base {
    log_debug  = off;
    log_info   = on;
    log        = "stderr";
    daemon     = off;
    redirector = iptables;
}

redsocks {
    local_ip   = 127.0.0.1;
    local_port = 12345;
    ip         = $SOCKS_HOST;
    port       = $SOCKS_PORT;
    type       = socks5;
$AUTH_CONF
}
EOF

# ── Clear any stale iptables rules ───────────────────────────────────────────
iptables -t nat -D OUTPUT -p tcp -j SMARTSHAPE_PROXY 2>/dev/null || true
iptables -t nat -F SMARTSHAPE_PROXY 2>/dev/null || true
iptables -t nat -X SMARTSHAPE_PROXY 2>/dev/null || true

# ── Start redsocks ────────────────────────────────────────────────────────────
redsocks -c /tmp/redsocks.conf &
REDSOCKS_PID=$!
sleep 1

# ── iptables OUTPUT rules ─────────────────────────────────────────────────────
iptables -t nat -N SMARTSHAPE_PROXY

# Private ranges → bypass (postgres, redis, Docker internals, VPS loopback)
iptables -t nat -A SMARTSHAPE_PROXY -d 127.0.0.0/8    -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 10.0.0.0/8     -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 172.16.0.0/12  -j RETURN
iptables -t nat -A SMARTSHAPE_PROXY -d 192.168.0.0/16 -j RETURN

# All other TCP → redsocks → proxy
iptables -t nat -A SMARTSHAPE_PROXY -p tcp -j REDIRECT --to-port 12345
iptables -t nat -A OUTPUT -p tcp -j SMARTSHAPE_PROXY

echo "✅ Transparent proxy active → $SOCKS_HOST:$SOCKS_PORT"

wait $REDSOCKS_PID
