"""Move `schools.owner` (written by the CSV importer) to `assigned_to`.

The CRM scopes and displays school ownership from `assigned_to`, so imported
schools looked unowned. An existing non-empty `assigned_to` always wins — the
importer's value is only used to fill a gap.
"""


async def canonicalise_school_owner(db) -> dict:
    q = {"owner": {"$exists": True}}
    n = await db.schools.count_documents(q)
    if not n:
        return {"schools_migrated": 0}
    async for doc in db.schools.find(q, {"_id": 1, "owner": 1, "assigned_to": 1}):
        current = (doc.get("assigned_to") or "").strip()
        upd = {"$unset": {"owner": ""}}
        legacy = (doc.get("owner") or "").strip()
        if not current and legacy:
            upd["$set"] = {"assigned_to": legacy}
        await db.schools.update_one({"_id": doc["_id"]}, upd)
    return {"schools_migrated": n}


if __name__ == "__main__":
    import asyncio

    from database import db

    print(asyncio.run(canonicalise_school_owner(db)))
