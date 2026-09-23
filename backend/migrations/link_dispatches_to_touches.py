"""Backfill the touch <-> dispatch link, and give every historical drip mailer a
row somebody can see.

Two production facts this repairs (both measured on 2026-09-22):
  - 40 `physical_dispatches` rows carry `needs_dispatch: True`, a flag written
    once by `create_physical_from_drip` and read nowhere.
  - 39 of them are school-less drip sends that produced NO `mail_touches` row at
    all, because the whole Offline Mail leg was gated on `lead.school_id`. They
    are invisible in Offline Mail, the today queue and verification.

The governing rule: NOTHING IS LEFT UN-LINKED. A dispatch that ends this
migration with neither a `touch_id` nor a stored `needs_dispatch` flag is a
posting that no screen can ever show again, so every dispatch either gets a
touch, or keeps its flag and is reported as an orphan.

What it does, per `auto_from_drip` dispatch with no `touch_id` yet:
  1. LINK when a matching touch exists. The exact join key the spec names,
     (enrollment_id, step_number), only exists on dispatches written AFTER
     task B1 - historical dispatch rows never carried it. So the match is tried
     in order: (a) enrollment_id + step_number when the dispatch has them,
     (b) same lead_id/contact (pre-B1 touches store a SCALAR `contact_id`, B1+
     touches an array `contact_ids` - both are matched) + same piece + same
     `created_at` calendar day.
  2. CREATE the missing touch when nothing matched, for EVERY dispatch whose
     recipient still exists - school-less or not. With a live school that has an
     address the touch is `pending` (it is postable); without one it is
     `needs_address` (D2). Either way the dispatch is linked to it.
  3. MARK an already-delivered dispatch's touch as `sent`. A dispatch with
     `received_confirmed: True` or a non-empty `sent_date` went out months ago;
     it must never resurface in the To-post queue as work owed.
  4. FLAG a pre-existing school-less touch as `needs_address` (only while it is
     `pending` - a posted piece is never re-opened).
  5. UNSET the stored `needs_dispatch` (D4: derived on read now) - but ONLY on
     the dispatches this run linked or created a touch for. A dispatch whose
     lead AND contact are both gone keeps its flag and is counted in
     `skipped_orphan`, because a flag is the only handle left on it.

Soft-deleted contacts, leads and schools are treated as gone throughout.

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

# A run in one of these states is finished. Appending a backfilled envelope to it
# would silently re-open somebody's completed paperwork, so the migration makes a
# fresh backfill run instead.
_CLOSED_RUN_STATES = ("posted", "completed", "closed")


def _delivered(d):
    """(already_went_out, posted_at_iso). `sent_date` or an explicit delivery
    confirmation both mean the envelope is long gone."""
    sent = str(d.get("sent_date") or "").strip()
    if not (sent or d.get("received_confirmed") is True):
        return False, None
    at = sent or str(d.get("created_at") or "").strip()
    if len(at) == 10:                       # a bare YYYY-MM-DD
        at = f"{at}T00:00:00+00:00"
    return True, (at or None)


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
        # Pre-B1 touches store a SCALAR `contact_id`; B1+ touches an array
        # `contact_ids`. Matching only the array misses every historical row -
        # which is exactly the population this migration exists for.
        who = {"$or": [{"contact_ids": d["contact_id"]},
                       {"contact_id": d["contact_id"]}]}
    else:
        return None
    async for t in db.mail_touches.find({**who, "piece_type": piece}, {"_id": 0}):
        if str(t.get("created_at") or "")[:10] == day:
            return t
    return None


async def _recipient(db, d):
    """(recipient_still_exists, school_id). False means the lead AND the contact
    are both gone - there is nobody left to address, so the row is an orphan."""
    exists, sid = False, ""
    cid = d.get("contact_id")
    if cid:
        c = await db.contacts.find_one(
            {"contact_id": cid, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1})
        if c:
            exists = True
            sid = c.get("school_id") or ""
    lid = d.get("lead_id")
    if lid and not sid:
        l = await db.leads.find_one(
            {"lead_id": lid, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1})
        if l:
            exists = True
            sid = l.get("school_id") or ""
    return exists, sid


async def _postable_school(db, sid):
    """The school id IF it is live and has a street address - else "". A school
    row with no address is no more postable than no school at all, so the piece
    is parked `needs_address` either way."""
    if not sid:
        return ""
    s = await db.schools.find_one(
        {"school_id": sid, "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "address": 1, "pincode": 1, "city": 1})
    # Same rule the sticker printer uses (_addr_missing): street AND pincode
    # AND city — a piece we could not print a label for is not postable.
    if not s or not (str(s.get("address") or "").strip()
                     and str(s.get("pincode") or "").strip()
                     and str(s.get("city") or "").strip()):
        return ""
    return sid


async def _ensure_drip_run(db, d, day, piece, apply, cache):
    key = (day, piece)
    if key in cache:
        return cache[key]
    run = await db.mail_runs.find_one(
        {"is_drip_run": True, "send_date": day, "piece_type": piece,
         "status": {"$nin": list(_CLOSED_RUN_STATES)}},
        {"_id": 0, "run_id": 1})
    if run:
        cache[key] = run["run_id"]
        return run["run_id"]
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    if apply:
        await db.mail_runs.insert_one({
            "run_id": run_id, "name": f"Drip Mailers — backfill {day}", "area_id": "",
            "piece_type": piece, "deal_type_target": "", "school_ids": [],
            "send_date": day, "courier": "", "tracking_no": "", "courier_cost": 0,
            "status": "planned", "is_drip_run": True,
            "sequence_id": d.get("sequence_id", ""), "sequence_name": "",
            "created_by": "migration", "created_at": datetime.now(timezone.utc).isoformat(),
            "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
    cache[key] = run_id
    return run_id


async def link_dispatches_to_touches(db, apply: bool = False) -> dict:
    linked = touches_created = marked_needs_address = 0
    skipped_no_match = skipped_orphan = marked_sent = created_pending = 0
    handled = []          # dispatch ids that now have a touch -> safe to unset
    run_cache = {}

    dispatches = await db.physical_dispatches.find(
        {"auto_from_drip": True,
         "$or": [{"touch_id": {"$exists": False}}, {"touch_id": ""}]},
        {"_id": 0}).to_list(None)

    tag = "APPLY " if apply else "DRY   "
    for d in dispatches:
        did = d["dispatch_id"]
        gone, posted_at = _delivered(d)
        touch = await _find_matching_touch(db, d)

        if touch:
            print(f"{tag} link dispatch={did} -> touch={touch['touch_id']}")
            if apply:
                await db.physical_dispatches.update_one(
                    {"dispatch_id": did}, {"$set": {"touch_id": touch["touch_id"]}})
                await db.mail_touches.update_one(
                    {"touch_id": touch["touch_id"]}, {"$addToSet": {"dispatch_ids": did}})
            linked += 1
            handled.append(did)
            # Already in the post: close the touch too, or the To-post queue
            # hands somebody an envelope that was mailed in July.
            if gone and touch.get("verify_status") != "sent":
                print(f"{tag} mark touch={touch['touch_id']} sent (dispatch already delivered)")
                if apply:
                    await db.mail_touches.update_one(
                        {"touch_id": touch["touch_id"]},
                        {"$set": {"verify_status": "sent", "posted_at": posted_at,
                                  "verified_by": "migration",
                                  "verified_at": datetime.now(timezone.utc).isoformat()}})
                    if touch.get("run_id"):
                        await db.mail_runs.update_one(
                            {"run_id": touch["run_id"]},
                            {"$inc": {"counts.verified_sent": 1}})
                marked_sent += 1
            continue

        # Nothing matched. Every recipient that still exists gets a touch - a
        # posting with no record of it is the whole defect being fixed here.
        exists, sid = await _recipient(db, d)
        if not exists:
            print(f"SKIP   dispatch={did} orphan - lead and contact are both gone; "
                  f"needs_dispatch KEPT so the row stays findable")
            skipped_no_match += 1
            skipped_orphan += 1
            continue

        school_id = await _postable_school(db, sid)
        status = "sent" if gone else ("pending" if school_id else "needs_address")
        day = str(d.get("created_at") or "")[:10] or \
            datetime.now(timezone.utc).strftime("%Y-%m-%d")
        piece = d.get("material_type") or "brochure"
        run_id = await _ensure_drip_run(db, d, day, piece, apply, run_cache)
        touch_id = f"mt_{uuid.uuid4().hex[:10]}"
        name = (d.get("lead_name") or "").strip()
        print(f"{tag} create {status} touch={touch_id} for dispatch={did} run={run_id}")
        if apply:
            await db.mail_touches.insert_one({
                "touch_id": touch_id, "run_id": run_id, "school_id": school_id,
                "lead_id": d.get("lead_id", ""),
                **({"contact_id": d["contact_id"]} if d.get("contact_id") else {}),
                "piece_type": piece,
                "item_name": (d.get("material_name") or piece),
                "posted_at": posted_at if status == "sent" else None,
                "qr_token": uuid.uuid4().hex[:16],
                "delivery_status": "pending", "responded": False, "responded_at": None,
                "response_channel": "", "appointment": False, "next_action_date": "",
                "outcome_note": "", "owner": d.get("created_by", "") or "system",
                "created_at": d.get("created_at") or day,
                "planned_date": day, "verify_status": status,
                **({"verified_by": "migration",
                    "verified_at": datetime.now(timezone.utc).isoformat()}
                   if status == "sent" else {}),
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
            # It is a real envelope either way, so it counts on the run.
            inc = {"counts.sent": 1}
            if status == "sent":
                inc["counts.verified_sent"] = 1
            upd = {"$inc": inc}
            if school_id:
                upd["$addToSet"] = {"school_ids": school_id}
            await db.mail_runs.update_one({"run_id": run_id}, upd)
        touches_created += 1
        handled.append(did)
        if status == "sent":
            marked_sent += 1
        elif status == "pending":
            created_pending += 1

    # Any pre-existing touch with no school is parked, not pending. Scoped to
    # `pending` on purpose: a piece already ticked posted is never re-opened.
    blanks = await db.mail_touches.find(
        {"verify_status": "pending",
         "$or": [{"school_id": ""}, {"school_id": None}, {"school_id": {"$exists": False}}]},
        {"_id": 0, "touch_id": 1}).to_list(None)
    for t in blanks:
        print(f"{tag} flag touch={t['touch_id']} -> needs_address")
        if apply:
            await db.mail_touches.update_one(
                {"touch_id": t["touch_id"]}, {"$set": {"verify_status": "needs_address"}})
        marked_needs_address += 1

    # D4: the stored flag goes ONLY where a touch now carries the truth. An
    # orphan keeps its flag - stripping it would erase the last trace of it.
    stored = 0
    if handled:
        q = {"needs_dispatch": {"$exists": True}, "dispatch_id": {"$in": handled}}
        stored = await db.physical_dispatches.count_documents(q)
        print(f"{tag} unset stored needs_dispatch on {stored} linked dispatches "
              f"({skipped_orphan} orphan(s) keep theirs)")
        if apply and stored:
            await db.physical_dispatches.update_many(q, {"$unset": {"needs_dispatch": ""}})
    else:
        print(f"{tag} unset stored needs_dispatch on 0 linked dispatches "
              f"({skipped_orphan} orphan(s) keep theirs)")

    return {
        "linked": linked,
        "touches_created": touches_created,
        "created_pending": created_pending,
        "marked_sent": marked_sent,
        "marked_needs_address": marked_needs_address,
        "unset_needs_dispatch": stored,
        "skipped_no_match": skipped_no_match,
        "skipped_orphan": skipped_orphan,
        "total_dispatches_seen": len(dispatches),
    }


if __name__ == "__main__":
    import asyncio
    import sys
    from database import db

    result = asyncio.run(link_dispatches_to_touches(db, apply="--apply" in sys.argv))
    print(f"\n{result}")
