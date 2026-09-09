"""Move `schools.owner` (written by the CSV importer) to `assigned_to`.

The CRM scopes and displays school ownership from `assigned_to`, so imported
schools looked unowned. An existing non-empty `assigned_to` always wins — the
importer's value is only used to fill a gap. Also populates `assigned_name`
(the display name) by resolving the email/name against the users directory.
"""


async def canonicalise_school_owner(db) -> dict:
    from routes.crm_routes import resolve_owner

    q = {"owner": {"$exists": True}}
    n = await db.schools.count_documents(q)
    if not n:
        return {"schools_migrated": 0}
    async for doc in db.schools.find(q, {"_id": 1, "owner": 1, "assigned_to": 1, "assigned_name": 1}):
        current = (doc.get("assigned_to") or "").strip()
        upd = {"$unset": {"owner": ""}}
        legacy = (doc.get("owner") or "").strip()
        set_doc = {}

        if not current and legacy:
            # Case 1: fill assigned_to from legacy owner, and resolve the name
            owner_email, owner_name = await resolve_owner(db, legacy)
            set_doc["assigned_to"] = owner_email
            set_doc["assigned_name"] = owner_name
        elif current:
            # Case 2: assigned_to already correct, but fill a missing display name
            current_name = (doc.get("assigned_name") or "").strip()
            if not current_name:
                _, resolved_name = await resolve_owner(db, current)
                if resolved_name:
                    set_doc["assigned_name"] = resolved_name

        if set_doc:
            upd["$set"] = set_doc
        await db.schools.update_one({"_id": doc["_id"]}, upd)
    return {"schools_migrated": n}


if __name__ == "__main__":
    import asyncio

    from database import db

    print(asyncio.run(canonicalise_school_owner(db)))
