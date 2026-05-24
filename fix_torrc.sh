#!/bin/bash
# Fix Tor config and restart — run on VPS before setup_tor_proxy.sh
# Ensures Tor accepts SOCKS5 connections from Docker containers

set -e
[ "$(id -u)" -ne 0 ] && { echo "ERROR: run as root"; exit 1; }

TORRC=/etc/tor/torrc

echo "==> Current Tor config (SocksPort / SocksPolicy lines):"
grep -E "^SocksPort|^SocksPolicy|^#SocksPort" "$TORRC" || echo "(none found)"

# Remove any existing SocksPort / SocksPolicy lines we might have added
sed -i '/^SocksPort 0\.0\.0\.0/d' "$TORRC"
sed -i '/^SocksPolicy accept/d' "$TORRC"

# Append our config block
cat >> "$TORRC" << 'TORRC_BLOCK'

# SmartShape — allow Docker containers to use Tor SOCKS5
SocksPort 0.0.0.0:9050
SocksPolicy accept 172.16.0.0/12
SocksPolicy accept 127.0.0.1
SocksPolicy reject *
TORRC_BLOCK

echo "==> Updated torrc:"
grep -E "^SocksPort|^SocksPolicy" "$TORRC"

echo "==> Restarting Tor..."
systemctl restart tor
sleep 3

systemctl is-active --quiet tor && echo "✓ Tor running" || {
    echo "ERROR: Tor failed to start"
    journalctl -u tor --no-pager -n 20
    exit 1
}

echo "==> Verifying Tor SOCKS5 works from localhost..."
TORIP=$(curl --silent --socks5 127.0.0.1:9050 --max-time 15 https://ifconfig.io 2>/dev/null || echo "FAILED")
echo "   Tor exit IP: $TORIP"

[ "$TORIP" = "FAILED" ] && echo "⚠  SOCKS5 test failed — check Tor logs: journalctl -u tor -n 30" \
                         || echo "✅ Tor SOCKS5 working!"
