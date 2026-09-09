"""Canonicalise the tag array field to `tag_ids` on schools and leads.

Schools accumulated two fields: `tag_ids` written by the CSV importer and
`tags` written by the CRM UI. Neither could see the other's tags. Leads use
`tags` only. Contacts already use `tag_ids` and are left untouched.

Non-destructive: schools union the two arrays rather than picking a winner.
Idempotent: after the first pass no document matches the filter.
"""


async def canonicalise_tag_fields(db) -> dict:
    schools_merged = await _merge_schools(db)
    leads_renamed = await _rename_leads(db)
    return {
        "leads_renamed": leads_renamed,
        "schools_merged": schools_merged,
        "already_clean": (schools_merged == 0 and leads_renamed == 0),
    }


async def _merge_schools(db) -> int:
    q = {"tags": {"$exists": True}}
    n = await db.schools.count_documents(q)
    if not n:
        return 0
    async for doc in db.schools.find(q, {"_id": 1, "tags": 1, "tag_ids": 1}):
        merged = list(dict.fromkeys(
            list(doc.get("tag_ids") or []) + list(doc.get("tags") or [])
        ))
        await db.schools.update_one(
            {"_id": doc["_id"]},
            {"$set": {"tag_ids": merged}, "$unset": {"tags": ""}},
        )
    return n


async def _rename_leads(db) -> int:
    q = {"tags": {"$exists": True}}
    n = await db.leads.count_documents(q)
    if not n:
        return 0
    async for doc in db.leads.find(q, {"_id": 1, "tags": 1, "tag_ids": 1}):
        merged = list(dict.fromkeys(
            list(doc.get("tag_ids") or []) + list(doc.get("tags") or [])
        ))
        await db.leads.update_one(
            {"_id": doc["_id"]},
            {"$set": {"tag_ids": merged}, "$unset": {"tags": ""}},
        )
    return n
