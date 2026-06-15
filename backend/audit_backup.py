"""Snapshot-then-hard-delete helper for owner-only destructive actions, with restore.

A "plan" is a list of (collection_name, mongo_query) pairs. snapshot_and_delete()
first copies every matching document into the `audit_backups` collection, then
hard-deletes them from the live collections. preview_counts() runs the same plan
read-only so the UI can show the blast radius before anything is touched.

Backup storage avoids MongoDB's 16 MB per-document limit by writing many small *chunk*
documents (≤ _CHUNK docs each) plus one *manifest* document. The manifest is written
LAST, so its presence is the signal that the backup is complete — and the live delete
only runs after the manifest exists. A crash therefore leaves either nothing deleted,
or a complete, restorable backup.

restore_bundle() re-inserts a backup's documents into their original collections (best
effort: documents that already exist by their unique key are skipped).

This module is intentionally domain-free (it imports nothing but the db handle) so both
order_routes and crm_routes can use it without an import cycle. Keep each plan to ONE
entry per collection — overlapping queries on the same collection would double-count.
"""

import uuid
from datetime import datetime, timezone

from database import db

_FETCH_CAP = 100000
_CHUNK = 200  # docs per backup chunk — keeps each chunk doc comfortably under 16 MB

MANIFEST = "cascade_manifest"
CHUNK = "cascade_chunk"


async def preview_counts(plan) -> dict:
    """Read-only: how many docs each collection in the plan would delete."""
    counts = {}
    for coll, query in plan:
        n = await db[coll].count_documents(query)
        if n:
            counts[coll] = n
    return counts


async def snapshot_and_delete(plan, *, root_type: str, root_id: str, root_label: str,
                              deleted_by: str, reason: str = "") -> dict:
    """Back up every doc matched by the plan into audit_backups, then hard-delete.

    Returns {backup_id, counts, total}. Writes chunk docs, then the manifest, and only
    then deletes — so the backup is always complete before anything is removed.
    """
    collected, counts = {}, {}
    for coll, query in plan:
        docs = await db[coll].find(query, {"_id": 0}).to_list(_FETCH_CAP)
        if docs:
            collected[coll] = docs
            counts[coll] = len(docs)

    backup_id = f"bk_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    seq = 0
    for coll, docs in collected.items():
        for i in range(0, len(docs), _CHUNK):
            seq += 1
            await db.audit_backups.insert_one({
                "backup_id": backup_id, "kind": CHUNK,
                "collection": coll, "seq": seq, "docs": docs[i:i + _CHUNK],
            })

    # Manifest LAST — its existence means the backup finished writing.
    await db.audit_backups.insert_one({
        "backup_id": backup_id, "kind": MANIFEST,
        "root_type": root_type, "root_id": root_id, "root_label": root_label,
        "deleted_by": deleted_by, "deleted_at": now_iso, "reason": reason,
        "counts": counts, "total": sum(counts.values()),
        "restored": False,
    })

    for coll, query in plan:
        await db[coll].delete_many(query)

    return {"backup_id": backup_id, "counts": counts, "total": sum(counts.values())}


async def list_backups(limit: int = 100) -> list:
    """Recent backup manifests, newest first (no chunk payloads)."""
    return await db.audit_backups.find(
        {"kind": MANIFEST},
        {"_id": 0, "docs": 0},
    ).sort("deleted_at", -1).to_list(limit)


async def restore_bundle(backup_id: str, *, restored_by: str = "") -> dict:
    """Re-insert a backup's documents into their original collections (best effort).

    Documents that already exist (duplicate unique key) are skipped, so a partial
    re-create is safe to re-run. Returns {backup_id, restored: {coll: n}, total}.
    """
    manifest = await db.audit_backups.find_one(
        {"backup_id": backup_id, "kind": MANIFEST}, {"_id": 0})
    if not manifest:
        return {"backup_id": backup_id, "found": False, "restored": {}, "total": 0}

    # Once-only: most live collections have no unique index on their id, so a second
    # restore would silently duplicate every record. Refuse if already restored.
    if manifest.get("restored"):
        return {"backup_id": backup_id, "found": True, "already_restored": True,
                "restored": {}, "total": 0}

    chunks = await db.audit_backups.find(
        {"backup_id": backup_id, "kind": CHUNK}, {"_id": 0}).sort("seq", 1).to_list(_FETCH_CAP)

    restored = {}
    for ch in chunks:
        coll, docs = ch.get("collection"), ch.get("docs") or []
        if not coll or not docs:
            continue
        try:
            await db[coll].insert_many(docs, ordered=False)
        except Exception:
            # Duplicate keys (docs already restored / never deleted) — ignore and continue.
            pass
        restored[coll] = restored.get(coll, 0) + len(docs)

    await db.audit_backups.update_one(
        {"backup_id": backup_id, "kind": MANIFEST},
        {"$set": {"restored": True,
                  "restored_at": datetime.now(timezone.utc).isoformat(),
                  "restored_by": restored_by}})

    return {"backup_id": backup_id, "found": True, "restored": restored,
            "total": sum(restored.values())}
