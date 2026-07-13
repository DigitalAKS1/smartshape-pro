"""CRM maintenance / data-hygiene endpoints.

Kept in its own module (not crm_routes.py) so data-cleanup tooling can evolve
without touching the hot CRM router. Read-only audit here is safe for anyone
admin; destructive cleanup (added later) is owner-only + snapshotted.

The immediate driver: a bad import created ~500 blank school rows (empty
school_name/city/contact). Before deleting anything we must SEE what's there —
especially how many blank schools still carry leads/contacts/quotes/orders,
because those must NOT be blindly removed.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from database import db
from auth_utils import get_current_user
from rbac import require_admin, require_superadmin

router = APIRouter(prefix="/crm/maintenance", tags=["crm-maintenance"])

# Collections whose presence makes a blank school "referenced" (unsafe to blind-delete).
_CHILD_COLLECTIONS = ("leads", "contacts", "quotations", "orders")


def _is_blank(school: dict) -> bool:
    """A school is 'blank' when it has no usable name — the junk-import signature."""
    return not (school.get("school_name") or "").strip()


async def _log_activity(user_email: str, action: str, entity_id: str, details: str = ""):
    """Local activity log (self-contained — no crm_routes import cycle)."""
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": "school",
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/blank-schools-audit")
async def blank_schools_audit(request: Request):
    """READ-ONLY. Report how many schools are blank (no name), how many of those
    are childless (safe to delete) vs still referenced, and where they came from.
    No writes. Admin only."""
    user = await get_current_user(request)
    require_admin(user)

    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1, "city": 1,
         "created_by": 1, "created_at": 1, "assigned_name": 1, "assigned_to": 1},
    ).to_list(100000)

    blanks = [s for s in schools if _is_blank(s)]
    blank_ids = [s["school_id"] for s in blanks]

    # Count children per blank school across every collection that references it.
    async def _ref_counts(coll: str) -> dict:
        if not blank_ids:
            return {}
        rows = await db[coll].find(
            {"school_id": {"$in": blank_ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1},
        ).to_list(1000000)
        out = {}
        for r in rows:
            sid = r.get("school_id")
            out[sid] = out.get(sid, 0) + 1
        return out

    leads_by = await _ref_counts("leads")
    contacts_by = await _ref_counts("contacts")
    quotes_by = await _ref_counts("quotations")
    orders_by = await _ref_counts("orders")

    def _has_children(sid: str) -> bool:
        return bool(leads_by.get(sid) or contacts_by.get(sid)
                    or quotes_by.get(sid) or orders_by.get(sid))

    childless = [s for s in blanks if not _has_children(s["school_id"])]
    with_children = [s for s in blanks if _has_children(s["school_id"])]

    # Provenance: who created the blanks, and the created_at span.
    by_creator = {}
    created_ats = []
    for s in blanks:
        who = (s.get("created_by") or "unknown").strip() or "unknown"
        by_creator[who] = by_creator.get(who, 0) + 1
        if s.get("created_at"):
            created_ats.append(s["created_at"])

    return {
        "total_schools": len(schools),
        "blank_schools": len(blanks),
        "blank_childless": len(childless),          # safe to delete
        "blank_with_children": len(with_children),   # must NOT blind-delete
        "children_breakdown": {
            "leads": sum(leads_by.values()),
            "contacts": sum(contacts_by.values()),
            "quotations": sum(quotes_by.values()),
            "orders": sum(orders_by.values()),
        },
        "by_creator": by_creator,
        "created_at_earliest": min(created_ats) if created_ats else None,
        "created_at_latest": max(created_ats) if created_ats else None,
        # A small sample so the owner can eyeball what "blank" means here.
        "sample_childless_ids": [s["school_id"] for s in childless[:20]],
        "sample_with_children_ids": [s["school_id"] for s in with_children[:20]],
    }


# ---------------------------------------------------------------------------
# GUARDED bulk delete (O20 + O19 execute step) — SUPERADMIN ONLY, reversible.
# ---------------------------------------------------------------------------

async def _blank_childless_ids() -> list:
    """School ids for blank (empty-name) schools that carry ZERO leads/contacts/
    quotations/orders — the safe cleanup set for the ~516 junk-import rows."""
    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1},
    ).to_list(100000)
    blank_ids = [s["school_id"] for s in schools if _is_blank(s)]
    if not blank_ids:
        return []
    referenced: set = set()
    for coll in _CHILD_COLLECTIONS:
        rows = await db[coll].find(
            {"school_id": {"$in": blank_ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1},
        ).to_list(1000000)
        referenced |= {r["school_id"] for r in rows if r.get("school_id")}
    return [sid for sid in blank_ids if sid not in referenced]


async def _bulk_delete_schools(ids: list, *, dry_run: bool, reason: str, actor: dict) -> dict:
    """Shared engine for both bulk-delete endpoints.

    dry_run=True  → per-school blast radius + grand totals, writes NOTHING.
    dry_run=False → snapshot_and_delete each school's full cascade (restorable),
                    recompute stock reservations once if any orders were touched.

    Imports the cascade/backup helpers lazily so this module never forms an
    import cycle with crm_routes / order_routes.
    """
    from cascade_delete import build_school_plan          # lazy — avoid cycle
    from audit_backup import snapshot_and_delete, preview_counts

    ids = [i for i in (ids or []) if i]

    per_school: list = []
    totals = {"schools": 0, "leads": 0, "contacts": 0, "quotations": 0, "orders": 0, "docs": 0}
    planned: list = []  # (school, plan, label, touches_orders)

    for sid in ids:
        school = await db.schools.find_one({"school_id": sid}, {"_id": 0})
        if not school:
            continue
        plan, label, touches_orders = await build_school_plan(school)
        counts = await preview_counts(plan)
        plan_total = sum(counts.values())
        children = {
            "leads": counts.get("leads", 0),
            "contacts": counts.get("contacts", 0),
            "quotations": counts.get("quotations", 0),
            "orders": counts.get("orders", 0),
        }
        per_school.append({
            "school_id": sid,
            "label": label,
            "blank": _is_blank(school),
            "children": children,
            "plan_total": plan_total,
        })
        totals["schools"] += 1
        for k in ("leads", "contacts", "quotations", "orders"):
            totals[k] += children[k]
        totals["docs"] += plan_total
        planned.append((school, plan, label, touches_orders))

    if dry_run:
        return {"dry_run": True, "schools": per_school, "totals": totals}

    backups: list = []
    total_docs = 0
    any_orders = False
    for school, plan, label, touches_orders in planned:
        result = await snapshot_and_delete(
            plan, root_type="school", root_id=school["school_id"], root_label=label,
            deleted_by=actor.get("email", ""), reason=reason)
        backups.append(result["backup_id"])
        total_docs += result["total"]
        any_orders = any_orders or touches_orders
        await _log_activity(
            actor.get("email", ""), "bulk_cascade_delete", school["school_id"],
            f"Deleted school '{label}' + {result['total']} related docs "
            f"(backup {result['backup_id']}; reason: {reason or 'n/a'})")

    recomputed = False
    if any_orders:
        from routes.order_routes import recompute_reservations   # lazy — avoid cycle
        await recompute_reservations()
        recomputed = True

    return {"dry_run": False, "deleted": len(planned), "backups": backups,
            "total_docs": total_docs, "recomputed": recomputed}


@router.post("/schools/bulk-delete")
async def bulk_delete_schools(request: Request):
    """SUPERADMIN ONLY. Guarded, reversible bulk cascade-delete of schools.

    Body: {school_ids:[..], dry_run:true, confirm_count:<int>, reason:""}
    - dry_run defaults TRUE — a preview that writes nothing.
    - to actually delete: dry_run=false AND confirm_count == len(school_ids),
      else 400 (a stale UI can never over-delete).
    Every delete is snapshotted into audit_backups first, so it is restorable."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    school_ids = body.get("school_ids") or []
    if not isinstance(school_ids, list):
        raise HTTPException(status_code=400, detail="school_ids must be a list")
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    if not dry_run:
        if body.get("confirm_count") != len(school_ids):
            raise HTTPException(status_code=400, detail="confirm_count mismatch")

    return await _bulk_delete_schools(
        school_ids, dry_run=bool(dry_run), reason=reason, actor=user)


@router.post("/schools/delete-blank-childless")
async def delete_blank_childless_schools(request: Request):
    """SUPERADMIN ONLY. Convenience cleanup for the junk-import blanks: the server
    selects blank (empty-name) schools with ZERO children and routes them through
    the same guarded bulk-delete engine.

    Body: {dry_run:true, confirm_count:<int>, reason:""}
    - dry_run defaults TRUE.
    - to delete: dry_run=false AND confirm_count == the current childless count,
      else 400 (guards against the set having changed since the caller looked)."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    ids = await _blank_childless_ids()
    if not dry_run:
        if body.get("confirm_count") != len(ids):
            raise HTTPException(status_code=400, detail="confirm_count mismatch")

    return await _bulk_delete_schools(
        ids, dry_run=bool(dry_run), reason=reason, actor=user)


# ===========================================================================
# PHASE 4 — CRM LINK / PHONE INTEGRITY (detect + guarded, dry-run migrations)
# ---------------------------------------------------------------------------
# Fixes for the defects surfaced in the earlier CRM integrity audit:
#   D1  lead<->contact link split across lead.contact_id (create/import) vs
#       lead.converted_from_contact (convert flow) — canonicalise to
#       lead.contact_id <-> contact.lead_id.
#   D2  delete_contact left leads dangling (contact_id -> missing/soft-deleted).
#   D6  phones normalized in only one path (some raw / float / sci-notation).
# Every write endpoint is SUPERADMIN-gated, defaults dry_run=True, and snapshots
# every affected doc to audit_backups (pre-image) BEFORE mutating. All are
# idempotent / re-runnable.
# ===========================================================================

from import_engine import normalize_phone, phone_is_lossy, clean_text  # reuse the one true helpers

_CAP = 1000000

# Collections that carry a school_id FIELD on their documents (so a merge must
# reassign that field survivor<-duplicate). Derived from cascade_delete.build_school_plan
# — every entry there filtered by a bare {"school_id": sid}. Children linked only via
# lead_id/quotation_id/order_id (tasks, followups, call_notes, catalogue_selections,
# order_items, payments, ...) follow their parent automatically and need no rewrite.
_SCHOOL_ID_COLLECTIONS = (
    "leads", "contacts", "quotations", "orders", "dispatches", "invoices",
    "visit_plans", "school_notifications", "school_requests", "teachers",
    "fms_flows",
)


def _blankish(v) -> bool:
    """True when a link field is absent/None/empty-string."""
    return not (v or "").strip() if isinstance(v, str) else v is None


def _phone_category(raw) -> str:
    """Classify a raw phone value for the repair pass.

    - 'empty'       : no usable phone.
    - 'lossy'       : scientific-notation (e.g. "9.17709E+11") — digits already
                      gone, UNRECOVERABLE; must be flagged, never normalized.
    - 'clean'       : already equals its normalized form.
    - 'recoverable' : normalizing changes it (trailing '.0', spaces, +, -, or a
                      numeric/float value) and yields a non-empty number.
    """
    if raw is None:
        return "empty"
    if isinstance(raw, str) and not raw.strip():
        return "empty"
    if phone_is_lossy(raw):
        return "lossy"
    norm = normalize_phone(raw)
    if not norm:
        return "empty"
    if isinstance(raw, str) and raw.strip() == norm:
        return "clean"
    return "recoverable"


def _dup_values(rows: list, key: str) -> list:
    """Return [{value, count}] for id values that appear more than once."""
    counts = {}
    for r in rows:
        v = r.get(key)
        if v is None:
            continue
        counts[v] = counts.get(v, 0) + 1
    return sorted(
        ({"value": v, "count": n} for v, n in counts.items() if n > 1),
        key=lambda d: (-d["count"], str(d["value"])),
    )


async def _integrity_report() -> dict:
    """Pure read-only integrity scan (no writes). Factored out so tests can call
    it directly and the endpoint stays a thin auth wrapper."""
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(_CAP)
    schools = await db.schools.find({}, {"_id": 0}).to_list(_CAP)

    # Contact lookup incl. soft-delete state (dangling detection needs deleted rows).
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}

    # --- D1: link-model split & bidirectional gaps -------------------------
    cfc_no_contact_id = 0        # converted_from_contact set but contact_id blank
    dangling_contact_id = 0      # contact_id -> missing OR soft-deleted contact (D2)
    lead_contact_id_no_backref = 0   # valid contact_id but contact.lead_id != this lead
    for l in leads:
        cid = l.get("contact_id")
        cfc = l.get("converted_from_contact")
        if not _blankish(cfc) and _blankish(cid):
            cfc_no_contact_id += 1
        if not _blankish(cid):
            c = contact_by_id.get(cid)
            if c is None or c.get("is_deleted"):
                dangling_contact_id += 1
            elif c.get("lead_id") != l.get("lead_id"):
                lead_contact_id_no_backref += 1

    # contacts converted-to-lead but no live lead points back
    lead_ptr = set()   # contact_ids that a live lead points at (either link style)
    for l in leads:
        if l.get("is_deleted"):
            continue
        for k in ("contact_id", "converted_from_contact"):
            v = l.get(k)
            if not _blankish(v):
                lead_ptr.add(v)
    contacts_converted_no_lead = sum(
        1 for c in contacts
        if c.get("converted_to_lead") and not c.get("is_deleted")
        and c.get("contact_id") not in lead_ptr
    )

    # --- D3: duplicate ids -------------------------------------------------
    dup_school_id = _dup_values(schools, "school_id")
    dup_lead_id = _dup_values(leads, "lead_id")

    # --- D5: soft-deleted schools that still have non-deleted children -----
    deleted_school_ids = [s.get("school_id") for s in schools
                          if s.get("is_deleted") and s.get("school_id")]
    schools_deleted_with_children = 0
    if deleted_school_ids:
        dset = set(deleted_school_ids)
        with_kids = set()
        for coll in _CHILD_COLLECTIONS:
            rows = await db[coll].find(
                {"school_id": {"$in": deleted_school_ids}, "is_deleted": {"$ne": True}},
                {"_id": 0, "school_id": 1},
            ).to_list(_CAP)
            with_kids |= {r["school_id"] for r in rows if r.get("school_id") in dset}
        schools_deleted_with_children = len(with_kids)

    # --- D6: phone hygiene, per collection ---------------------------------
    def _phone_stats(rows: list) -> dict:
        stat = {"total": 0, "lossy": 0, "recoverable": 0, "clean": 0, "empty": 0}
        for r in rows:
            stat["total"] += 1
            stat[_phone_category(r.get("phone"))] += 1
        return stat

    phones = {
        "schools": _phone_stats(schools),
        "contacts": _phone_stats(contacts),
        "leads": _phone_stats(leads),
    }

    return {
        "links": {
            "converted_from_no_contact_id": cfc_no_contact_id,
            "dangling_contact_id": dangling_contact_id,
            "lead_contact_id_no_backref": lead_contact_id_no_backref,
            "contacts_converted_no_lead": contacts_converted_no_lead,
        },
        "duplicates": {
            "school_id": dup_school_id,
            "lead_id": dup_lead_id,
        },
        "schools_soft_deleted_with_children": schools_deleted_with_children,
        "phones": phones,
        "counts": {"leads": len(leads), "contacts": len(contacts),
                   "schools": len(schools)},
    }


@router.get("/integrity-detect")
async def integrity_detect(request: Request):
    """SUPERADMIN, READ-ONLY. Full CRM link/id/phone integrity report. No writes."""
    user = await get_current_user(request)
    require_superadmin(user)
    return await _integrity_report()


# ---------------------------------------------------------------------------
# 2. unify-links — canonical lead.contact_id <-> contact.lead_id
# ---------------------------------------------------------------------------

async def _plan_unify_links():
    """Return (leads_to_set_contact_id, contacts_to_backref) as lists of tuples.

    leads_to_set_contact_id : [(lead_id, contact_id)]  — copy converted_from_contact
                              into a blank contact_id.
    contacts_to_backref     : [(contact_id, lead_id)]  — set contact.lead_id +
                              converted_to_lead=True for every live, existing contact
                              a lead validly points at but which lacks the back-pointer.
    """
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(_CAP)
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}

    leads_to_set = []
    for l in leads:
        cid, cfc = l.get("contact_id"), l.get("converted_from_contact")
        if not _blankish(cfc) and _blankish(cid):
            leads_to_set.append((l.get("lead_id"), cfc))

    # Effective contact_id after phase A (so phase B sees the unified link).
    contacts_to_backref = []
    seen_pairs = set()
    for l in leads:
        eff_cid = l.get("contact_id")
        if _blankish(eff_cid):
            eff_cid = l.get("converted_from_contact")
        if _blankish(eff_cid):
            continue
        c = contact_by_id.get(eff_cid)
        if c is None or c.get("is_deleted"):
            continue   # dangling — handled by the dangling repair, not here
        lid = l.get("lead_id")
        if c.get("lead_id") != lid or not c.get("converted_to_lead"):
            pair = (eff_cid, lid)
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                contacts_to_backref.append(pair)
    return leads_to_set, contacts_to_backref


@router.post("/migrate/unify-links")
async def migrate_unify_links(request: Request):
    """SUPERADMIN. Canonicalise the lead<->contact link. dry_run defaults TRUE.

    Body: {dry_run:true, reason:""}. Idempotent. On a real run, snapshots every
    affected lead+contact (pre-image) to audit_backups BEFORE writing."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    leads_to_set, contacts_to_backref = await _plan_unify_links()

    result = {
        "dry_run": bool(dry_run),
        "leads_would_set_contact_id": len(leads_to_set),
        "contacts_would_backref": len(contacts_to_backref),
        "sample_leads": [{"lead_id": lid, "contact_id": cid}
                         for lid, cid in leads_to_set[:20]],
        "sample_contacts": [{"contact_id": cid, "lead_id": lid}
                            for cid, lid in contacts_to_backref[:20]],
    }
    if dry_run:
        return result

    lead_ids = {lid for lid, _ in leads_to_set}
    contact_ids = {cid for cid, _ in contacts_to_backref}
    if lead_ids or contact_ids:
        from audit_backup import snapshot_only
        plan = []
        if lead_ids:
            plan.append(("leads", {"lead_id": {"$in": list(lead_ids)}}))
        if contact_ids:
            plan.append(("contacts", {"contact_id": {"$in": list(contact_ids)}}))
        backup = await snapshot_only(
            plan, root_type="migration", root_id="unify-links",
            root_label="unify lead<->contact links",
            backed_up_by=user.get("email", ""), reason=reason)
        result["backup_id"] = backup["backup_id"]

    now_iso = datetime.now(timezone.utc).isoformat()
    for lid, cid in leads_to_set:
        await db.leads.update_one({"lead_id": lid}, {"$set": {"contact_id": cid}})
    for cid, lid in contacts_to_backref:
        await db.contacts.update_one(
            {"contact_id": cid},
            {"$set": {"lead_id": lid, "converted_to_lead": True,
                      "last_activity_date": now_iso}})

    result["leads_updated"] = len(leads_to_set)
    result["contacts_updated"] = len(contacts_to_backref)
    await _log_activity(user.get("email", ""), "migrate_unify_links", "unify-links",
                        f"set {len(leads_to_set)} lead.contact_id, "
                        f"{len(contacts_to_backref)} contact back-refs "
                        f"(reason: {reason or 'n/a'})")
    return result


# ---------------------------------------------------------------------------
# 3. dangling-contact-links — unset contact_id -> missing/deleted contact (D2)
# ---------------------------------------------------------------------------

async def _plan_dangling():
    """Return [lead, ...] for leads whose contact_id points at a missing or
    soft-deleted contact."""
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0, "contact_id": 1, "is_deleted": 1}).to_list(_CAP)
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}
    out = []
    for l in leads:
        cid = l.get("contact_id")
        if _blankish(cid):
            continue
        c = contact_by_id.get(cid)
        if c is None or c.get("is_deleted"):
            out.append(l)
    return out


@router.post("/repair/dangling-contact-links")
async def repair_dangling_contact_links(request: Request):
    """SUPERADMIN. Unset contact_id (and converted_from_contact when it matches)
    on leads pointing at a missing/soft-deleted contact. dry_run defaults TRUE;
    a real run snapshots the affected leads first. Idempotent."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    dangling = await _plan_dangling()
    result = {
        "dry_run": bool(dry_run),
        "leads_would_unset": len(dangling),
        "sample": [{"lead_id": l.get("lead_id"), "contact_id": l.get("contact_id")}
                   for l in dangling[:20]],
    }
    if dry_run or not dangling:
        return result

    from audit_backup import snapshot_only
    lead_ids = [l.get("lead_id") for l in dangling]
    backup = await snapshot_only(
        [("leads", {"lead_id": {"$in": lead_ids}})],
        root_type="migration", root_id="dangling-contact-links",
        root_label="unset dangling lead.contact_id",
        backed_up_by=user.get("email", ""), reason=reason)
    result["backup_id"] = backup["backup_id"]

    for l in dangling:
        cid = l.get("contact_id")
        unset = {"contact_id": ""}
        if l.get("converted_from_contact") == cid:
            unset["converted_from_contact"] = ""
        await db.leads.update_one({"lead_id": l.get("lead_id")}, {"$unset": unset})

    result["leads_unset"] = len(dangling)
    await _log_activity(user.get("email", ""), "repair_dangling_links",
                        "dangling-contact-links",
                        f"unset {len(dangling)} dangling lead.contact_id "
                        f"(reason: {reason or 'n/a'})")
    return result


# ---------------------------------------------------------------------------
# 4. phones — normalize recoverable, flag lossy (D6)
# ---------------------------------------------------------------------------

_PHONE_COLLECTIONS = ("schools", "contacts", "leads")


async def _plan_phones():
    """Return {coll: {"recoverable": [(id_field, id_val, norm)],
                      "lossy": [(id_field, id_val)]}} for the phone repair."""
    id_field = {"schools": "school_id", "contacts": "contact_id", "leads": "lead_id"}
    plan = {}
    for coll in _PHONE_COLLECTIONS:
        idf = id_field[coll]
        rows = await db[coll].find({}, {"_id": 0, idf: 1, "phone": 1}).to_list(_CAP)
        rec, lossy = [], []
        for r in rows:
            cat = _phone_category(r.get("phone"))
            if cat == "recoverable":
                rec.append((idf, r.get(idf), normalize_phone(r.get("phone"))))
            elif cat == "lossy":
                lossy.append((idf, r.get(idf)))
        plan[coll] = {"recoverable": rec, "lossy": lossy}
    return plan


@router.post("/repair/phones")
async def repair_phones(request: Request):
    """SUPERADMIN. For schools/contacts/leads: normalize recoverable phones
    (phone + phone_norm), and flag lossy sci-notation with phone_needs_reimport
    (phone untouched, phone_norm left blank). dry_run defaults TRUE; a real run
    snapshots affected docs first. Idempotent."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    plan = await _plan_phones()
    per_coll = {c: {"recoverable": len(v["recoverable"]), "lossy": len(v["lossy"])}
                for c, v in plan.items()}
    result = {
        "dry_run": bool(dry_run),
        "per_collection": per_coll,
        "totals": {
            "recoverable": sum(v["recoverable"] for v in per_coll.values()),
            "lossy": sum(v["lossy"] for v in per_coll.values()),
        },
    }
    if dry_run:
        return result

    # Snapshot every doc we'll touch (pre-image), per collection.
    from audit_backup import snapshot_only
    snap_plan = []
    for coll, v in plan.items():
        idf = {"schools": "school_id", "contacts": "contact_id", "leads": "lead_id"}[coll]
        touched_ids = [t[1] for t in v["recoverable"]] + [t[1] for t in v["lossy"]]
        if touched_ids:
            snap_plan.append((coll, {idf: {"$in": touched_ids}}))
    if snap_plan:
        backup = await snapshot_only(
            snap_plan, root_type="migration", root_id="repair-phones",
            root_label="normalize/flag phones",
            backed_up_by=user.get("email", ""), reason=reason)
        result["backup_id"] = backup["backup_id"]

    for coll, v in plan.items():
        for idf, idv, norm in v["recoverable"]:
            await db[coll].update_one(
                {idf: idv}, {"$set": {"phone": norm, "phone_norm": norm}})
        for idf, idv in v["lossy"]:
            await db[coll].update_one(
                {idf: idv},
                {"$set": {"phone_needs_reimport": True, "phone_norm": ""}})

    result["applied"] = per_coll
    await _log_activity(user.get("email", ""), "repair_phones", "repair-phones",
                        f"normalized {result['totals']['recoverable']}, "
                        f"flagged {result['totals']['lossy']} lossy "
                        f"(reason: {reason or 'n/a'})")
    return result


# ===========================================================================
# PHASE 4b — SCHOOL DEDUP / MERGE (name-collision merge the ID-upsert can't do)
# ---------------------------------------------------------------------------
# Two schools with the SAME (normalized) name but DIFFERENT school_ids can't be
# merged by the ID-based import upsert. Merge = FK-reassign every child from the
# duplicate(s) onto a survivor school_id, then snapshot-and-delete the emptied
# duplicate school doc (restorable). Superadmin-gated, dry_run defaults TRUE,
# every write snapshotted first.
# ===========================================================================


def _norm_school_name(name) -> str:
    """Canonical key for name-collision grouping: mojibake-repaired, lowercased,
    trimmed, internal whitespace collapsed. 'ST. XAVIERâ€™S  High School ' and
    'St. Xavier's High School' collapse to the same key."""
    cleaned = clean_text(name) if isinstance(name, str) else ""
    cleaned = (cleaned or "").strip().lower()
    return " ".join(cleaned.split())


async def _school_child_counts(sid: str) -> dict:
    """Non-deleted child counts for one school across the headline collections."""
    out = {}
    for coll in _CHILD_COLLECTIONS:
        out[coll] = await db[coll].count_documents(
            {"school_id": sid, "is_deleted": {"$ne": True}})
    return out


@router.get("/duplicate-schools")
async def duplicate_schools(request: Request):
    """SUPERADMIN, READ-ONLY. Group non-deleted schools by NORMALIZED name and
    return every group with >1 distinct school_id — the merge-candidate report.
    Groups sorted by total children desc. No writes."""
    user = await get_current_user(request)
    require_superadmin(user)

    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "created_at": 1},
    ).to_list(_CAP)

    groups = {}
    for s in schools:
        key = _norm_school_name(s.get("school_name"))
        if not key:
            continue   # blank-name rows are the delete-blank-childless job, not merge
        groups.setdefault(key, []).append(s)

    out = []
    for key, members in groups.items():
        distinct_ids = {m["school_id"] for m in members}
        if len(distinct_ids) < 2:
            continue
        detailed = []
        group_total = 0
        for m in members:
            children = await _school_child_counts(m["school_id"])
            group_total += sum(children.values())
            detailed.append({
                "school_id": m["school_id"],
                "school_name": m.get("school_name", ""),
                "city": m.get("city", ""),
                "created_at": m.get("created_at", ""),
                "children": children,
            })
        detailed.sort(key=lambda d: sum(d["children"].values()), reverse=True)
        out.append({
            "normalized_name": key,
            "total_children": group_total,
            "schools": detailed,
        })

    out.sort(key=lambda g: g["total_children"], reverse=True)
    return {"groups": out, "group_count": len(out)}


async def _move_children_counts(merge_id: str) -> dict:
    """Per-collection count of docs whose school_id == merge_id (what a merge moves)."""
    counts = {}
    for coll in _SCHOOL_ID_COLLECTIONS:
        n = await db[coll].count_documents({"school_id": merge_id})
        if n:
            counts[coll] = n
    return counts


@router.post("/schools/merge")
async def merge_schools(request: Request):
    """SUPERADMIN. Merge duplicate schools into one survivor.

    Body: {survivor_id, merge_ids:[...], dry_run:true, confirm:false, reason}
      - dry_run defaults TRUE → per-merge child move counts + survivor totals; no writes.
      - real run needs dry_run=false AND confirm==true.
    Reassigns every child (school_id: merge_id -> survivor_id) across all
    school_id-bearing collections, fills only-blank survivor fields from a merge
    doc, then snapshot_and_delete's the emptied duplicate school rows (restorable).
    Idempotent-ish: re-running with already-merged ids moves 0 children."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()

    survivor_id = (body.get("survivor_id") or "").strip()
    merge_ids = body.get("merge_ids") or []
    dry_run = body.get("dry_run", True)
    confirm = bool(body.get("confirm", False))
    reason = body.get("reason", "") or ""

    if not survivor_id:
        raise HTTPException(status_code=400, detail="survivor_id is required")
    if not isinstance(merge_ids, list) or not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids must be a non-empty list")
    _seen = set()   # order-preserving dedup + drop blanks (fill is "first wins")
    merge_ids = [x for x in merge_ids if x and not (x in _seen or _seen.add(x))]
    if not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids must be a non-empty list")
    if survivor_id in merge_ids:
        raise HTTPException(status_code=400, detail="survivor_id cannot be in merge_ids")

    survivor = await db.schools.find_one({"school_id": survivor_id}, {"_id": 0})
    if not survivor:
        raise HTTPException(status_code=400, detail=f"survivor school {survivor_id} not found")
    merge_docs = []
    for mid in merge_ids:
        doc = await db.schools.find_one({"school_id": mid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=400, detail=f"merge school {mid} not found")
        merge_docs.append(doc)

    # Per-merge move counts + aggregate.
    per_merge = {}
    moved_total = {}
    for mid in merge_ids:
        counts = await _move_children_counts(mid)
        per_merge[mid] = counts
        for coll, n in counts.items():
            moved_total[coll] = moved_total.get(coll, 0) + n

    # Survivor's resulting headline totals (current + everything moving in).
    survivor_now = await _school_child_counts(survivor_id)
    survivor_after = dict(survivor_now)
    for mid in merge_ids:
        for coll in _CHILD_COLLECTIONS:
            survivor_after[coll] = survivor_after.get(coll, 0) + per_merge[mid].get(coll, 0)

    result = {
        "dry_run": bool(dry_run),
        "survivor_id": survivor_id,
        "merge_ids": merge_ids,
        "per_merge_moves": per_merge,
        "moved": moved_total,
        "survivor_children_before": survivor_now,
        "survivor_children_after": survivor_after,
    }
    if dry_run:
        return result
    if not confirm:
        raise HTTPException(status_code=400, detail="confirm must be true for a real merge")

    from audit_backup import snapshot_only, snapshot_and_delete

    # 1. Pre-image snapshot of the duplicate school docs BEFORE any change.
    pre = await snapshot_only(
        [("schools", {"school_id": {"$in": merge_ids}})],
        root_type="school_merge", root_id=survivor_id,
        root_label=f"merge {len(merge_ids)} dup schools into {survivor_id}",
        backed_up_by=user.get("email", ""), reason=reason)
    result["preimage_backup_id"] = pre["backup_id"]

    # 2. Reassign every child FK survivor<-merge across school_id-bearing collections.
    applied_moves = {}
    for coll in _SCHOOL_ID_COLLECTIONS:
        r = await db[coll].update_many(
            {"school_id": {"$in": merge_ids}}, {"$set": {"school_id": survivor_id}})
        n = getattr(r, "modified_count", 0) or 0
        if n:
            applied_moves[coll] = n
    result["moved"] = applied_moves

    # 3. Fill ONLY-blank survivor fields from the first merge doc that has a value.
    fillable = ("school_name", "city", "state", "pincode", "phone", "email",
                "school_type", "school_strength", "assigned_to", "assigned_name")
    fill = {}
    for f in fillable:
        cur = survivor.get(f)
        if cur in (None, "", 0):
            for doc in merge_docs:
                v = doc.get(f)
                if v not in (None, "", 0):
                    fill[f] = v
                    break
    if fill:
        await db.schools.update_one({"school_id": survivor_id}, {"$set": fill})
        result["survivor_filled"] = fill

    # 4. Snapshot-and-delete the now-empty duplicate school docs (restorable).
    del_res = await snapshot_and_delete(
        [("schools", {"school_id": {"$in": merge_ids}})],
        root_type="school_merge_removed", root_id=survivor_id,
        root_label=f"removed {len(merge_ids)} merged dup schools",
        deleted_by=user.get("email", ""), reason=reason)
    result["removed_backup_id"] = del_res["backup_id"]
    result["backups"] = [pre["backup_id"], del_res["backup_id"]]
    result["merged"] = merge_ids

    for mid in merge_ids:
        await _log_activity(
            user.get("email", ""), "school_merge", mid,
            f"merged school {mid} into {survivor_id} "
            f"(backups {pre['backup_id']}/{del_res['backup_id']}; "
            f"reason: {reason or 'n/a'})")
    return result
