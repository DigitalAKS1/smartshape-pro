"""Repair leads orphaned from their school by the convert-to-lead bug.

POST /contacts/{id}/convert-to-lead used to read school_id ONLY from the
request body, never from the contact being converted. The School Profile's
Convert button sends no school_id at all, so a contact converted from its
own school's profile produced a lead with school_id='' — invisible on the
school's Leads tab and missing from its "Enroll Lead in Drip" dropdown.
(Fixed separately in routes/crm_routes.py.) This repairs the leads that bug
already produced.

Scope is deliberately narrow:
  - Only touches leads whose school_id is "" or None, and which are NOT
    themselves soft-deleted (is_deleted) — a deleted lead should stay
    invisible, not get "repaired" and count as a fix while remaining hidden.
  - Finds the contact that was converted into each such lead: either the
    contact's lead_id equals the lead's lead_id, or the lead's
    converted_from_contact equals a contact's contact_id.
  - Only sets school_id when that contact has a real (non-empty) school_id.
  - Only writes when the target school actually EXISTS and is not itself
    soft-deleted — copying a contact's school_id onto a lead blind, without
    checking the target is real, can point the lead at nothing or at a
    school nobody can see either. Those cases are skipped and counted
    separately (skipped_target_school_missing_or_deleted) rather than
    silently folded into "repaired".
  - Never touches a lead whose school_id already points at a DIFFERENT real
    school — that's the separate duplicate-schools problem, and guessing
    which duplicate is "right" would be wrong.

Dry-run by default (models backfill_user_roles_scope.py's --apply flag):
running the module prints what it WOULD do for every candidate lead — lead
id, target school id, whether that school exists, whether it is deleted —
and writes nothing unless invoked with --apply. The repair_orphaned_
converted_leads() function itself takes the same apply: bool switch so
callers (tests included) control it explicitly instead of relying on
module-level state.

Usage:  cd backend && python migrations/repair_orphaned_converted_leads.py [--apply]

Idempotent: a second run with --apply repairs zero (the leads it fixed no
longer match the school_id-blank filter).
"""


async def repair_orphaned_converted_leads(db, apply: bool = False) -> dict:
    q = {
        "$and": [
            {"$or": [{"school_id": ""}, {"school_id": None}, {"school_id": {"$exists": False}}]},
            {"is_deleted": {"$ne": True}},
        ]
    }
    orphans = await db.leads.find(
        q, {"_id": 1, "lead_id": 1, "converted_from_contact": 1}
    ).to_list(None)

    repaired = 0
    skipped_no_contact = 0
    skipped_contact_has_no_school = 0
    skipped_target_school_missing_or_deleted = 0

    for lead in orphans:
        lead_id = lead.get("lead_id")
        contact = None
        contact_id = lead.get("converted_from_contact")
        if contact_id:
            contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "school_id": 1})
        if not contact and lead_id:
            contact = await db.contacts.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})

        if not contact:
            skipped_no_contact += 1
            continue

        contact_school_id = (contact.get("school_id") or "").strip()
        if not contact_school_id:
            skipped_contact_has_no_school += 1
            continue

        school = await db.schools.find_one({"school_id": contact_school_id}, {"_id": 0, "is_deleted": 1})
        school_exists = school is not None
        school_deleted = bool(school.get("is_deleted")) if school else False

        if not school_exists or school_deleted:
            skipped_target_school_missing_or_deleted += 1
            print(
                f"SKIP   lead={lead_id} target_school={contact_school_id} "
                f"exists={school_exists} deleted={school_deleted}"
            )
            continue

        print(f"{'APPLY ' if apply else 'DRY   '} lead={lead_id} -> school_id={contact_school_id}")
        if apply:
            await db.leads.update_one({"_id": lead["_id"]}, {"$set": {"school_id": contact_school_id}})
            repaired += 1

    return {
        "repaired": repaired,
        "skipped_no_contact": skipped_no_contact,
        "skipped_contact_has_no_school": skipped_contact_has_no_school,
        "skipped_target_school_missing_or_deleted": skipped_target_school_missing_or_deleted,
        "total_orphans_seen": len(orphans),
    }


if __name__ == "__main__":
    import asyncio
    import sys
    from database import db

    result = asyncio.run(repair_orphaned_converted_leads(db, apply="--apply" in sys.argv))
    print(f"\n{result}")
