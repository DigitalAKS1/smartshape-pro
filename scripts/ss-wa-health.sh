#!/usr/bin/env bash
# Hourly host-side WhatsApp health probe (spec 2026-09-24, W1 Health).
#
# The backend container cannot see the VPS's real free memory, so the HOST reads it and hands
# it to the backend, which stores settings{type:"wa_health"} (read by Settings → WhatsApp and
# by the hourly alert in services/wa_health.py).
#
# Install (once, as root on the VPS):
#   chmod +x /var/www/smartshape/scripts/ss-wa-health.sh
#   echo '7 * * * * root /var/www/smartshape/scripts/ss-wa-health.sh >> /var/log/ss-wa-health.log 2>&1' \
#     > /etc/cron.d/ss-wa-health
set -uo pipefail

BACKEND="${BACKEND_CONTAINER:-smartshape-backend}"
EVOLUTION="${EVOLUTION_CONTAINER:-smartshape_evolution}"

if ! command -v docker >/dev/null 2>&1; then
  echo "$(date -Is) wa_health: docker not available on this host, nothing written"
  exit 0
fi

AVAIL_MB=$(awk '/^MemAvailable:/ {printf "%d", $2/1024}' /proc/meminfo)
TOTAL_MB=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)
AVAIL_MB="${AVAIL_MB:-0}"
TOTAL_MB="${TOTAL_MB:-0}"

# docker stats prints e.g. "412.3MiB / 3.84GiB"; take the first figure and convert to MB.
RAW=$(docker stats --no-stream --format '{{.MemUsage}}' "$EVOLUTION" 2>/dev/null | awk '{print $1}')
to_mb() {
  local v="$1"
  case "$v" in
    *GiB) awk -v x="${v%GiB}" 'BEGIN { printf "%d", x * 1024 }' ;;
    *MiB) awk -v x="${v%MiB}" 'BEGIN { printf "%d", x }' ;;
    *KiB) awk -v x="${v%KiB}" 'BEGIN { printf "%d", x / 1024 }' ;;
    *)    echo 0 ;;
  esac
}
# Evolution not running / docker unreachable for it: write 0 rather than fail the whole probe —
# the host's own free-memory reading is still worth recording.
EVO_MB=$(to_mb "${RAW:-}")

if ! docker exec "$BACKEND" python -c "
import asyncio, sys
import database
from services.wa_health import record_host_health
asyncio.run(record_host_health(database.db, int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])))
" "$AVAIL_MB" "$TOTAL_MB" "$EVO_MB"; then
  echo "$(date -Is) wa_health: could not write through $BACKEND"
  exit 0
fi

echo "$(date -Is) wa_health avail=${AVAIL_MB}MB total=${TOTAL_MB}MB evolution=${EVO_MB}MB"
exit 0
