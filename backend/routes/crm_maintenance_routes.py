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
