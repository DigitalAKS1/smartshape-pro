#!/bin/bash
# SmartShape Pro — MongoDB Backup Script
# Run on VPS to backup database to a .gz file
#
# USAGE:
#   bash backup.sh
#
# Saves backup to: /var/backups/smartshape/smartshape_YYYY-MM-DD.gz
# Keep these files — copy to your PC occasionally for safety.

BACKUP_DIR="/var/backups/smartshape"
DATE=$(date +%Y-%m-%d_%H%M)
FILENAME="smartshape_${DATE}.gz"

mkdir -p $BACKUP_DIR

echo "Backing up MongoDB..."
docker exec smartshape-mongo mongodump \
  --username smartshape \
  --password SmartShape2024 \
  --authenticationDatabase admin \
  --db smartshape_prod \
  --archive \
  --gzip > $BACKUP_DIR/$FILENAME

SIZE=$(du -sh $BACKUP_DIR/$FILENAME | cut -f1)
echo "Backup saved: $BACKUP_DIR/$FILENAME ($SIZE)"

# Keep only last 7 backups
ls -t $BACKUP_DIR/smartshape_*.gz | tail -n +8 | xargs -r rm
echo "Old backups cleaned (keeping last 7)."
echo ""
echo "To download this backup to your PC, run from your PC:"
echo "  scp root@$(curl -s ifconfig.me):$BACKUP_DIR/$FILENAME ."
