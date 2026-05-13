#!/bin/bash
# SmartShape Pro — Migrate data FROM Atlas TO VPS MongoDB
# Run this ONCE on the VPS if you want to move existing Atlas data to local.
#
# USAGE (SSH into VPS, then):
#   bash /var/www/smartshape/migrate-atlas-to-vps.sh

ATLAS_URL="mongodb+srv://smartshape:Aman%401996%24@cluster0.xixalur.mongodb.net/smartshape_prod?retryWrites=true&w=majority"

echo "=================================================="
echo "  Migrating data from MongoDB Atlas → VPS MongoDB"
echo "=================================================="
echo ""
echo "Step 1: Dumping data from Atlas..."

# Dump from Atlas into a temp archive
docker run --rm \
  --network smartshape_default \
  -v /tmp/atlas-dump:/dump \
  mongo:7.0 \
  mongodump \
  --uri "$ATLAS_URL" \
  --out /dump \
  --quiet

echo "       Atlas dump complete."
echo ""
echo "Step 2: Restoring into VPS MongoDB..."

docker run --rm \
  --network smartshape_default \
  -v /tmp/atlas-dump:/dump \
  mongo:7.0 \
  mongorestore \
  --host mongo:27017 \
  --username smartshape \
  --password SmartShape2024 \
  --authenticationDatabase admin \
  --db smartshape_prod \
  /dump/smartshape_prod \
  --drop \
  --quiet

echo "       Restore complete."
echo ""
echo "=================================================="
echo "  Migration done! All Atlas data is now on VPS."
echo "  Test the app, then you can cancel Atlas if desired."
echo "=================================================="

# Cleanup
rm -rf /tmp/atlas-dump
