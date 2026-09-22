"""Backfill the touch <-> dispatch link, and give school-less sends a visible row.

Two production facts this repairs (both measured on 2026-09-22):
  - 40 `physical_dispatches` rows carry `needs_dispatch: True`, a flag written
    once by `create_physical_from_drip` and read nowhere.
  - 39 of them are school-less drip sends that produced NO `mail_touches` row at
    all, because the whole Offline Mail leg was gated on `lead.school_id`. They
    are invisible in Offline Mail, the today queue and verification.

What it does, per `auto_from_drip` dispatch with no `touch_id` yet:
  1. LINK when a matching touch exists. The exact join key the spec names,
     (enrollment_id, step_number), only exists on dispatches written AFTER
     task B1 - historical dispatch rows never carried it. So the match is tried
     in order: (a) enrollment_id + step_number when the dispatch has them,
     (b) same lead_id/contact_id + same piece_type/material_type + same
     created_at calendar day. Anything still unmatched is counted as
     `skipped_no_match` and left alone rather than guessed at.
  2. CREATE the missing touch when the recipient has no school. Without this the
     39 invisible sends stay invisible, which is the defect being fixed - so the
     row is created with verify_status "needs_address" (D2) under the drip run
     for that piece + day, creating that run only if it is absent.
  3. FLAG an existing touch whose school_id is blank as "needs_address"
     (only when it is currently pending - never re-open a sent piece).
  4. UNSET the stored `needs_dispatch` (D4: it is derived on read now).

Dry-run by default (models repair_orphaned_converted_leads.py's --apply flag):
prints what it WOULD do for every dispatch and writes nothing unless invoked
with --apply. The function takes the same `apply: bool` switch so tests control
it explicitly.

Usage:  cd backend && python -m migrations.link_dispatches_to_touches [--apply]

(The `-m` form is required: this module's `__main__` imports `database`, which
only resolves with `backend/` on `sys.path` as a package run provides. Running
it as a bare path - `python migrations/link_dispatches_to_touches.py` - fails
with ModuleNotFoundError: No module named 'database'.)

Idempotent: a second --apply run links 0 and creates 0 (every dispatch it
touched now has a touch_id, so it no longer matches the filter).
"""
import uuid
from datetime import datetime, timezone


async def _find_matching_touch(db, d):
    eid, sn = d.get("enrollment_id"), d.get("step_number")
    if eid:
        t = await db.mail_touches.find_one(
            {"enrollment_id": eid, "step_number": sn}, {"_id": 0})
        if t:
            return t
    piece = d.get("material_type") or "brochure"
    day = str(d.get("created_at") or "")[:10]
    if not day:
        return None
    if d.get("lead_id"):
        who = {"lead_id": d["lead_id"]}
    elif d.get("contact_id"):
        who = {"contact_ids": d["contact_id"]}
    else:
        return None
    async for t in db.mail_touches.find({**who, "piece_type": piece}, {"_id": 0}):
        if str(t.get("created_at") or "")[:10] == day:
            return t
    return None


async def _ensure_drip_run(db, d, day, piece, apply):
    run = await db.mail_runs.find_one(
        {"is_drip_run": True, "send_date": day, "piece_type": piece},
        {"_id": 0, "run_id": 1})
    if run:
        return run["run_id"]
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    if apply:
        await db.mail_runs.insert_one({
            "run_id": run_id, "name": f"Drip Mailers - {day}", "area_id": "",
            "piece_type": piece, "deal_type_target": "", "school_ids": [],
            "send_date": day, "courier": "", "tracking_no": "", "courier_cost": 0,
            "status": "planned", "is_drip_run": True,
            "sequence_id": d.get("sequence_id", ""), "sequence_name": "",
            "created_by": "migration", "created_at": datetime.now(timezone.utc).isoformat(),
            "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
    return run_id


async def link_dispatches_to_touches(db, apply: bool = False) -> dict:
    linked = touches_created = marked_needs_address = skipped_no_match = 0

    dispatches = await db.physical_dispatches.find(
        {"auto_from_drip": True,
         "$or": [{"touch_id": {"$exists": False}}, {"touch_id": ""}]},
        {"_id": 0}).to_list(None)

    for d in dispatches:
        did = d["dispatch_id"]
        touch = await _find_matching_touch(db, d)
        if touch:
            print(f"{'APPLY ' if apply else 'DRY   '} link dispatch={did} -> touch={touch['touch_id']}")
            if apply:
                await db.physical_dispatches.update_one(
                    {"dispatch_id": did}, {"$set": {"touch_id": touch["touch_id"]}})
                await db.mail_touches.update_one(
                    {"touch_id": touch["touch_id"]}, {"$addToSet": {"dispatch_ids": did}})
            linked += 1
            continue

        # No touch at all. Only a school-less send is legitimately missing one -
        # anything else is a data shape this migration will not guess at.
        sid = ""
        if d.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": d["contact_id"]},
                                           {"_id": 0, "school_id": 1})
            sid = (c or {}).get("school_id") or ""
        elif d.get("lead_id"):
            l = await db.leads.find_one({"lead_id": d["lead_id"]}, {"_id": 0, "school_id": 1})
            sid = (l or {}).get("school_id") or ""
        if sid:
            print(f"SKIP   dispatch={did} has a school ({sid}) but no touch - not guessed")
            skipped_no_match += 1
            continue

        day = str(d.get("created_at") or "")[:10] or \
            datetime.now(timezone.utc).strftime("%Y-%m-%d")
        piece = d.get("material_type") or "brochure"
        run_id = await _ensure_drip_run(db, d, day, piece, apply)
        touch_id = f"mt_{uuid.uuid4().hex[:10]}"
        name = (d.get("lead_name") or "").strip()
        print(f"{'APPLY ' if apply else 'DRY   '} create needs_address touch={touch_id} "
              f"for dispatch={did} run={run_id}")
        if apply:
            await db.mail_touches.insert_one({
                "touch_id": touch_id, "run_id": run_id, "school_id": "",
                "lead_id": d.get("lead_id", ""),
                **({"contact_id": d["contact_id"]} if d.get("contact_id") else {}),
                "piece_type": piece,
                "item_name": (d.get("material_name") or piece),
                "posted_at": None, "qr_token": uuid.uuid4().hex[:16],
                "delivery_status": "pending", "responded": False, "responded_at": None,
                "response_channel": "", "appointment": False, "next_action_date": "",
                "outcome_note": "", "owner": d.get("created_by", "") or "system",
                "created_at": d.get("created_at") or day,
                "planned_date": day, "verify_status": "needs_address",
                "printed_at": None, "print_batch_id": "", "replan_count": 0,
                "source": "drip", "sequence_id": d.get("sequence_id", ""),
                "enrollment_id": d.get("enrollment_id", ""),
                "step_number": d.get("step_number", 0),
                "contact_ids": [d["contact_id"]] if d.get("contact_id") else [],
                "recipient_names": [name] if name else [],
                "dispatch_ids": [did],
                "enrollment_ids": [d["enrollment_id"]] if d.get("enrollment_id") else []})
            await db.physical_dispatches.update_one(
                {"dispatch_id": did}, {"$set": {"touch_id": touch_id}})
        touches_created += 1

    # Any pre-existing touch with no school is parked, not pending. Scoped to
    # `pending` on purpose: a piece already ticked posted is never re-opened.
    blanks = await db.mail_touches.find(
        {"verify_status": "pending",
         "$or": [{"school_id": ""}, {"school_id": None}, {"school_id": {"$exists": False}}]},
        {"_id": 0, "touch_id": 1}).to_list(None)
    for t in blanks:
        print(f"{'APPLY ' if apply else 'DRY   '} flag touch={t['touch_id']} -> needs_address")
        if apply:
            await db.mail_touches.update_one(
                {"touch_id": t["touch_id"]}, {"$set": {"verify_status": "needs_address"}})
        marked_needs_address += 1

    stored = await db.physical_dispatches.count_documents({"needs_dispatch": {"$exists": True}})
    print(f"{'APPLY ' if apply else 'DRY   '} unset stored needs_dispatch on {stored} dispatches")
    if apply and stored:
        await db.physical_dispatches.update_many(
            {"needs_dispatch": {"$exists": True}}, {"$unset": {"needs_dispatch": ""}})

    return {
        "linked": linked,
        "touches_created": touches_created,
        "marked_needs_address": marked_needs_address,
        "unset_needs_dispatch": stored,
        "skipped_no_match": skipped_no_match,
        "total_dispatches_seen": len(dispatches),
    }


if __name__ == "__main__":
    import asyncio
    import sys
    from database import db

    result = asyncio.run(link_dispatches_to_touches(db, apply="--apply" in sys.argv))
    print(f"\n{result}")
