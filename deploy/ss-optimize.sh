#!/usr/bin/env bash
# SmartShape Pro — daily auto-optimizer (safe housekeeping for the 1-core VPS).
# Installed at /usr/local/bin/ss-optimize.sh ; run by ss-optimize.timer once a day.
# Only performs reversible, data-safe operations. Never touches running app data,
# never restarts dockerd, never prunes attached volumes.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
LOG=/var/log/ss-optimize.log
LOCK=/run/ss-optimize.lock
ts(){ date '+%Y-%m-%d %H:%M:%S'; }

# single-instance guard
exec 9>"$LOCK" || exit 0
flock -n 9 || { echo "$(ts) another run in progress, skip" >>"$LOG"; exit 0; }

exec >>"$LOG" 2>&1
echo "==================== $(ts) ss-optimize START ===================="

BEFORE_DISK=$(df -h / | awk 'NR==2{print $3" used, "$4" free ("$5" used)"}')

# 1) Docker space reclaim — build cache (keep last 24h for fast rebuilds) + dangling images.
echo "-- pruning docker build cache (>24h) + dangling images --"
docker builder prune -af --filter 'until=24h' 2>&1 | tail -1
docker image prune -f 2>&1 | tail -1
docker container prune -f 2>&1 | tail -1   # stopped containers only (safe)

# 2) Truncate oversized container logs in place (>50MB) — prevents json-log bloat
#    without a daemon restart. Active containers keep logging into the truncated file.
echo "-- truncating container logs > 50MB --"
find /var/lib/docker/containers -name '*-json.log' -size +50M \
  -printf '   trimmed %p (%s bytes)\n' -exec truncate -s 0 {} \; 2>/dev/null || true

# 3) System log hygiene — keep 7 days of journal, drop apt cache.
echo "-- vacuuming journal to 7d + apt clean --"
journalctl --vacuum-time=7d 2>&1 | tail -1
apt-get clean 2>/dev/null || true

AFTER_DISK=$(df -h / | awk 'NR==2{print $3" used, "$4" free ("$5" used)"}')

# 4) Health snapshot / report.
echo "-- snapshot --"
echo "   Disk before: $BEFORE_DISK"
echo "   Disk after : $AFTER_DISK"
echo "  $(uptime | sed 's/^.*up/up/')"
echo "   Mem: $(free -h | awk 'NR==2{print $3" used / "$7" available"}')  Swap: $(free -h | awk 'NR==3{print $3" used"}')"
echo "   Containers:"
docker ps --format '     {{.Names}}: {{.Status}}'
UNHEALTHY=$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd, -)
[ -n "$UNHEALTHY" ] && echo "   !! UNHEALTHY: $UNHEALTHY (investigate manually — not auto-restarted)"
STEAL=$(top -bn1 | awk -F',' '/%Cpu/{for(i=1;i<=NF;i++) if($i ~ /st/){gsub(/[^0-9.]/,"",$i); print $i}}')
[ -n "${STEAL:-}" ] && echo "   CPU steal (host overcommit): ${STEAL}%"
echo "   Top CPU now:"
ps -eo pcpu,pmem,comm --sort=-pcpu --no-headers | head -3 | sed 's/^/     /'

echo "==================== $(ts) ss-optimize DONE ===================="
echo

# keep this log bounded to last ~1500 lines
tail -n 1500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" || true
