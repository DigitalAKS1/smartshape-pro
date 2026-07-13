"""CRM maintenance / data-hygiene endpoints.

Kept in its own module (not crm_routes.py) so data-cleanup tooling can evolve
without touching the hot CRM router. Read-only audit here is safe for anyone
admin; destructive cleanup (added later) is owner-only + snapshotted.

The immediate driver: a bad import created ~500 blank school rows (empty
school_name/city/contact). Before deleting anything we must SEE what's there —
especially how many blank schools still carry leads/contacts/quotes/orders,
because those must NOT be blindly removed.
"""
from fastapi import APIRouter, Request

from database import db
from auth_utils import get_current_user
from rbac import require_admin

router = APIRouter(prefix="/crm/maintenance", tags=["crm-maintenance"])


def _is_blank(school: dict) -> bool:
    """A school is 'blank' when it has no usable name — the junk-import signature."""
    return not (school.get("school_name") or "").strip()


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
