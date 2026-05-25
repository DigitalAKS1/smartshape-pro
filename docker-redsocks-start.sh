#!/bin/bash
# Transparent Tor proxy sidecar for Evolution API
# Shares Evolution API's network namespace — iptables OUTPUT rules here
# affect all TCP leaving the Evolution container.

set -e

TOR_HOST="${TOR_HOST:-tor}"
TOR_PORT="${TOR_PORT:-9050}"

# ── 1. Resolve Tor container hostname → IP ───────────────────────────────────
echo "==> Waiting for Tor container ($TOR_HOST)..."
for i in $(seq 1 60); do
    TOR_IP=$(getent hosts "$TOR_HOST" 2>/dev/null | awk '{print $1}' | head -1)
    [ -n "$TOR_IP" ] && break
    sleep 2
done

if [ -z "$TOR_IP" ]; then
    echo "ERROR: Could not resolve '$TOR_HOST' — is the tor service running?"
    exit 1
fi
echo "    Tor IP: $TOR_IP"

# ── 2. Write redsocks config ──────────────────────────────────────────────────
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
    ip         = $TOR_IP;
    port       = $TOR_PORT;
    type       = socks5;
}
EOF

# ── 3. Clear any stale iptables rules from a previous run ────────────────────
iptables -t nat -D OUTPUT -p tcp -j SMARTSHAPE_TOR 2>/dev/null || true
iptables -t nat -F SMARTSHAPE_TOR 2>/dev/null || true
iptables -t nat -X SMARTSHAPE_TOR 2>/dev/null || true

# ── 4. Start redsocks in the background ──────────────────────────────────────
redsocks -c /tmp/redsocks.conf &
REDSOCKS_PID=$!
sleep 1   # Give redsocks time to bind :12345

# ── 5. iptables OUTPUT rules (affect entire shared network namespace) ─────────
iptables -t nat -N SMARTSHAPE_TOR

# Private ranges → bypass (postgres, redis, other Docker services)
iptables -t nat -A SMARTSHAPE_TOR -d 127.0.0.0/8    -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 10.0.0.0/8     -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 172.16.0.0/12  -j RETURN
iptables -t nat -A SMARTSHAPE_TOR -d 192.168.0.0/16 -j RETURN

# Everything else → redsocks → Tor
iptables -t nat -A SMARTSHAPE_TOR -p tcp -j REDIRECT --to-port 12345
iptables -t nat -A OUTPUT -p tcp -j SMARTSHAPE_TOR

echo "✅ Transparent Tor proxy active — all Evolution API TCP exits via Tor"

# ── 6. Keep container alive (exit when redsocks exits) ───────────────────────
wait $REDSOCKS_PID
