"""Zoom -> CRM import: fetch meeting attendees (with school/designation), suggest
fuzzy matches to existing schools + roles, then create Schools + Contacts + Leads.

Reuses the shared Zoom credentials in db.settings {type:"zoom"} (saved via the
certificate Zoom config UI). Find-or-create + dedupe mirrors crm_routes patterns.
"""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from typing import List, Dict, Any
import uuid, re

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_module

router = APIRouter(prefix="/crm-zoom")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _load_schools() -> List[Dict[str, Any]]:
    return await db.schools.find(
        {"is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1, "school_name": 1}).to_list(5000)


async def _load_roles() -> List[Dict[str, Any]]:
    return await db.contact_roles.find(
        {"is_active": {"$ne": False}}, {"_id": 0, "contact_role_id": 1, "name": 1}).to_list(200)


@router.get("/fetch")
async def zoom_crm_fetch(request: Request, meeting_id: str = ""):
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    import zoom_service
    if not await zoom_service.is_configured():
        raise HTTPException(400, "Zoom is not configured. Add your Zoom API credentials first.")
    if not meeting_id.strip():
        raise HTTPException(400, "Meeting ID is required")
    from cert_engine import clean_name
    from crm_zoom import suggest_rows
    try:
        data = await zoom_service.get_meeting_crm_data(meeting_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Zoom fetch failed: {str(e)[:300]}")
    rows = [{**r, "name": clean_name(r.get("name", ""))} for r in data.get("rows", [])]
    schools, roles = await _load_schools(), await _load_roles()
    return {"theme": data.get("theme", ""), "rows": suggest_rows(rows, schools, roles), "count": len(rows)}


@router.post("/suggest")
async def zoom_crm_suggest(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    from crm_zoom import suggest_rows
    body = await request.json()
    rows = body.get("rows", []) or []
    schools, roles = await _load_schools(), await _load_roles()
    return {"rows": suggest_rows(rows, schools, roles)}


async def _find_or_create_school(name: str, owner: str, owner_name: str, created_by: str) -> (str, bool):
    """Returns (school_id, created)."""
    name = (name or "").strip()
    if not name:
        return "", False
    found = await db.schools.find_one(
        {"school_name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1})
    if found:
        return found["school_id"], False
    sid = f"sch_{uuid.uuid4().hex[:12]}"
    await db.schools.insert_one({
        "school_id": sid, "school_name": name, "school_type": "CBSE",
        "assigned_to": owner, "assigned_name": owner_name,
        "phone": "", "email": "", "city": "", "state": "", "pincode": "", "address": "",
        "primary_contact_name": "", "designation": "",
        "school_strength": 0, "number_of_branches": 1,
        "annual_budget_range": "", "existing_vendor": "", "social_profiles": {},
        "linkedin_url": "", "instagram_url": "",
        "last_activity_date": _now(), "created_by": created_by, "created_at": _now(),
        "source": "Zoom",
    })
    return sid, True


@router.post("/import")
async def zoom_crm_import(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    theme = (body.get("theme") or "").strip()
    rows = body.get("rows", []) or []
    create_lead = body.get("create_lead", True)
    create_contact = body.get("create_contact", True)
    session_id = (body.get("session_id") or "").strip()
    if not rows:
        raise HTTPException(400, "No rows to import")

    is_sales = get_team(user) == "sales"
    default_owner = user["email"] if is_sales else ""
    default_owner_name = user["name"] if is_sales else ""

    res = {"schools_created": 0, "schools_linked": 0, "contacts_created": 0,
           "contacts_duplicate": 0, "leads_created": 0, "errors": []}

    for i, r in enumerate(rows):
        try:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            phone = (r.get("phone") or "").strip()
            email = (r.get("email") or "").strip()
            designation = (r.get("designation") or "").strip()
            role_id = (r.get("contact_role_id") or "").strip()
            # School: use an accepted suggestion/explicit id, else find-or-create by name
            school_id = (r.get("school_id") or "").strip()
            school_name = (r.get("school") or "").strip()
            if school_id:
                sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1, "assigned_to": 1, "assigned_name": 1})
                if sch:
                    school_name = sch.get("school_name", school_name)
                    res["schools_linked"] += 1
                else:
                    school_id = ""
            if not school_id and school_name:
                school_id, created = await _find_or_create_school(school_name, default_owner, default_owner_name, user["email"])
                res["schools_created" if created else "schools_linked"] += 1

            # owner inherits the school's owner when present
            owner, owner_name = default_owner, default_owner_name
            if school_id:
                s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
                if s and s.get("assigned_to"):
                    owner, owner_name = s["assigned_to"], s.get("assigned_name", "")

            contact_id = ""
            if create_contact:
                dup = None
                if phone:
                    dup = await db.contacts.find_one({"phone": phone, "name": name, "is_deleted": {"$ne": True}}, {"_id": 0, "contact_id": 1})
                if dup:
                    contact_id = dup["contact_id"]
                    res["contacts_duplicate"] += 1
                else:
                    contact_id = f"con_{uuid.uuid4().hex[:12]}"
                    await db.contacts.insert_one({
                        "contact_id": contact_id, "name": name, "phone": phone, "email": email,
                        "company": school_name, "school_id": school_id or None,
                        "designation": designation, "contact_role_id": role_id,
                        "source": "Zoom", "source_id": theme, "status": "active",
                        "assigned_to": owner, "assigned_name": owner_name,
                        "notes": f"Imported from Zoom meeting: {theme}" if theme else "Imported from Zoom",
                        "last_activity_date": _now(), "created_by": user["email"], "created_at": _now(),
                    })
                    res["contacts_created"] += 1

            if create_lead and school_id:
                lead_id = f"lead_{uuid.uuid4().hex[:12]}"
                await db.leads.insert_one({
                    "lead_id": lead_id, "school_id": school_id, "company_name": school_name,
                    "contact_name": name, "designation": designation, "contact_role_id": role_id,
                    "contact_phone": phone, "contact_email": email,
                    "source": "Zoom", "source_id": theme, "lead_type": "warm",
                    "interested_product": theme, "stage": "new", "priority": "medium",
                    "assigned_to": owner or user["email"], "assigned_name": owner_name or user["name"],
                    "assignment_type": "manual", "next_followup_date": "", "likely_closure_date": "",
                    "pipeline_history": [{"from_stage": None, "to_stage": "new", "by_email": user["email"],
                                          "by_name": user["name"], "at": _now(), "note": "Lead created (Zoom import)"}],
                    "last_visit_date": None, "notes": f"From Zoom meeting: {theme}" if theme else "",
                    "expected_value": 0.0, "converted_from_contact": contact_id or "",
                    "tags": [], "is_deleted": False,
                    "last_activity_date": _now(), "created_by": user["email"],
                    "created_at": _now(), "updated_at": _now(),
                })
                res["leads_created"] += 1
        except Exception as e:
            res["errors"].append({"row": i, "name": r.get("name", ""), "error": str(e)[:200]})

    if session_id:
        # Lazy import to avoid any circular-import risk with training_routes.
        from routes.training_routes import _reconcile_attendance
        emails = [r.get("email") for r in rows if r.get("email")]
        res["attendance"] = await _reconcile_attendance(session_id, emails)

    return res
