from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import csv
import io
import re
import asyncio
import requests as http_requests

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter()

# ==================== HELPER ====================

async def touch_last_activity(entity_type: str, entity_id: str):
    if not entity_type or not entity_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    coll_map = {
        "school": ("schools", "school_id"),
        "lead": ("leads", "lead_id"),
        "contact": ("contacts", "contact_id"),
    }
    pair = coll_map.get(entity_type)
    if not pair:
        return
    coll, key = pair
    await db[coll].update_one({key: entity_id}, {"$set": {"last_activity_date": now_iso}})


async def _auto_enroll_lead(lead_doc: dict):
    """Background task: auto-enroll a new lead into matching drip sequences."""
    try:
        lead_des = (lead_doc.get("designation") or "").strip().lower()
        role_name = ""
        if lead_doc.get("contact_role_id"):
            role = await db.contact_roles.find_one(
                {"role_id": lead_doc["contact_role_id"]}, {"_id": 0, "name": 1}
            )
            if role:
                role_name = role.get("name", "").lower()

        seqs = await db.drip_sequences.find(
            {"trigger": "lead_created", "is_active": True}, {"_id": 0}
        ).to_list(50)

        now = datetime.now(timezone.utc)
        for seq in seqs:
            filt = (seq.get("filter_designation") or "").strip().lower()
            if filt and lead_des != filt and role_name != filt:
                continue
            if not seq.get("steps"):
                continue
            existing = await db.drip_enrollments.find_one(
                {"sequence_id": seq["sequence_id"], "lead_id": lead_doc["lead_id"], "status": "active"}
            )
            if existing:
                continue
            first_delay = seq["steps"][0].get("delay_days", 0)
            await db.drip_enrollments.insert_one({
                "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
                "sequence_id": seq["sequence_id"],
                "lead_id": lead_doc["lead_id"],
                "current_step": 0,
                "status": "active",
                "enrolled_at": now.isoformat(),
                "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
                "last_step_at": None,
                "completed_at": None,
                "enrolled_by": "system",
            })
    except Exception as exc:
        import logging as _log
        _log.error(f"_auto_enroll_lead error: {exc}")


async def log_activity(user_email: str, action: str, entity_type: str, entity_id: str, details: str = ""):
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    try:
        await touch_last_activity(entity_type, entity_id)
    except Exception:
        pass


def calc_lead_score(lead, school=None):
    score = 0
    if school and school.get("school_strength", 0) > 1000:
        score += 10
    desig = (lead.get("designation") or "").lower()
    if any(d in desig for d in ("principal", "trustee", "admin", "director")):
        score += 5
    if lead.get("stage") not in ("new",):
        score += 5
    if lead.get("lead_type") == "hot":
        score += 10
    elif lead.get("lead_type") == "warm":
        score += 5
    return score


def compute_visit_required(lead: dict, now: datetime = None) -> bool:
    if now is None:
        now = datetime.now(timezone.utc)
    triggers = (
        lead.get("stage") in ("demo", "negotiation")
        or lead.get("priority") == "high"
        or lead.get("lead_type") == "hot"
    )
    if not triggers:
        return False
    last_visit = lead.get("last_visit_date")
    if not last_visit:
        return True
    try:
        lv = datetime.fromisoformat(last_visit.replace("Z", "+00:00"))
        return (now - lv).days >= 7
    except Exception:
        return True


# ==================== GROUP MASTER ====================

@router.get("/groups")
async def get_groups(request: Request):
    await get_current_user(request)
    groups = await db.groups.find({}, {"_id": 0}).sort("group_name", 1).to_list(500)
    return groups


@router.post("/groups")
async def create_group(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    group_id = f"grp_{uuid.uuid4().hex[:8]}"
    await db.groups.insert_one({
        "group_id": group_id,
        "group_name": body.get("group_name", ""),
        "head_office_address": body.get("head_office_address", ""),
        "chairman_name": body.get("chairman_name", ""),
        "contact_number": body.get("contact_number", ""),
        "email": body.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})


@router.put("/groups/{group_id}")
async def update_group(group_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("group_name", "head_office_address", "chairman_name", "contact_number", "email") if k in body}
    await db.groups.update_one({"group_id": group_id}, {"$set": allowed})
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request):
    await get_current_user(request)
    await db.groups.delete_one({"group_id": group_id})
    return {"message": "Group deleted"}


# ==================== SOURCE MASTER ====================

DEFAULT_SOURCES = ["Call", "Visit", "Reference", "Campaign", "Exhibition", "Website", "Social Media", "Walk-in", "Partner", "Other"]


@router.get("/sources")
async def get_sources(request: Request):
    await get_current_user(request)
    sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not sources:
        for s in DEFAULT_SOURCES:
            await db.sources.insert_one({
                "source_id": f"src_{uuid.uuid4().hex[:8]}",
                "name": s,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return sources


@router.post("/sources")
async def create_source(request: Request):
    await get_current_user(request)
    body = await request.json()
    source_id = f"src_{uuid.uuid4().hex[:8]}"
    await db.sources.insert_one({
        "source_id": source_id,
        "name": body.get("name", ""),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})


@router.put("/sources/{source_id}")
async def update_source(source_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.sources.update_one({"source_id": source_id}, {"$set": allowed})
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    await get_current_user(request)
    await db.sources.delete_one({"source_id": source_id})
    return {"message": "Source deleted"}


# ==================== CONTACT ROLE MASTER ====================

DEFAULT_CONTACT_ROLES = [
    "Principal", "Vice Principal", "Admin Head", "Director", "Owner",
    "Manager", "Coordinator", "Teacher", "IT Head", "Purchase Head", "Other",
]


@router.get("/contact-roles")
async def get_contact_roles(request: Request):
    await get_current_user(request)
    roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not roles:
        for r in DEFAULT_CONTACT_ROLES:
            await db.contact_roles.insert_one({"role_id": f"cr_{uuid.uuid4().hex[:8]}", "name": r, "is_active": True})
        roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return roles


@router.post("/contact-roles")
async def create_contact_role(request: Request):
    await get_current_user(request)
    body = await request.json()
    role_id = f"cr_{uuid.uuid4().hex[:8]}"
    await db.contact_roles.insert_one({"role_id": role_id, "name": body.get("name", ""), "is_active": True})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})


@router.put("/contact-roles/{role_id}")
async def update_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.contact_roles.update_one({"role_id": role_id}, {"$set": allowed})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})


@router.delete("/contact-roles/{role_id}")
async def delete_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    await db.contact_roles.delete_one({"role_id": role_id})
    return {"message": "Role deleted"}


# ==================== TAG MASTER ====================

# 12 expert marketing tags pre-seeded for SmartShape B2B school sales cycle
_DEFAULT_MARKETING_TAGS = [
    # Lead temperature
    {"name": "Hot Lead",           "color": "#ef4444", "group": "temperature"},
    {"name": "Warm Lead",          "color": "#f97316", "group": "temperature"},
    {"name": "Cold Lead",          "color": "#6b7280", "group": "temperature"},
    # Demo status
    {"name": "Demo Done",          "color": "#22c55e", "group": "demo"},
    {"name": "Demo Scheduled",     "color": "#3b82f6", "group": "demo"},
    {"name": "Demo Interested",    "color": "#a855f7", "group": "demo"},
    # Decision status
    {"name": "Budget Approved",    "color": "#10b981", "group": "decision"},
    {"name": "Decision Pending",   "color": "#eab308", "group": "decision"},
    {"name": "Price Sensitive",    "color": "#f59e0b", "group": "decision"},
    # Relationship
    {"name": "Key Decision Maker", "color": "#06b6d4", "group": "relationship"},
    {"name": "Referral",           "color": "#8b5cf6", "group": "relationship"},
    {"name": "Existing Customer",  "color": "#059669", "group": "relationship"},
]


async def _seed_marketing_tags():
    existing_names = {
        t["name"] async for t in db.tags.find({}, {"name": 1, "_id": 0})
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    for tag in _DEFAULT_MARKETING_TAGS:
        if tag["name"] not in existing_names:
            await db.tags.insert_one({
                "tag_id": f"tag_{uuid.uuid4().hex[:8]}",
                "name": tag["name"],
                "color": tag["color"],
                "group": tag["group"],
                "created_by": "system",
                "created_at": now_iso,
            })


@router.get("/tags")
async def get_tags(request: Request):
    await get_current_user(request)
    await _seed_marketing_tags()
    return await db.tags.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/tags")
async def create_tag(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(status_code=400, detail="Tag name is required")
    tag_id = f"tag_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "tag_id": tag_id,
        "name": body["name"].strip(),
        "color": body.get("color", "#6366f1"),
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.tags.insert_one(doc)
    return await db.tags.find_one({"tag_id": tag_id}, {"_id": 0})


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "color") if k in body}
    await db.tags.update_one({"tag_id": tag_id}, {"$set": allowed})
    return await db.tags.find_one({"tag_id": tag_id}, {"_id": 0})


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, request: Request):
    await get_current_user(request)
    await db.tags.delete_one({"tag_id": tag_id})
    return {"message": "Tag deleted"}


async def _resolve_tags(tag_names_or_ids: list, creator_email: str) -> list:
    """Resolve a list of tag_ids or tag name strings → list of tag_ids. Creates tags inline if name not found."""
    resolved = []
    for item in (tag_names_or_ids or []):
        if not item:
            continue
        if str(item).startswith("tag_"):
            existing = await db.tags.find_one({"tag_id": item}, {"_id": 0})
            if existing:
                resolved.append(item)
                continue
        # Treat as name string — find or create
        existing = await db.tags.find_one({"name": str(item).strip()}, {"_id": 0})
        if existing:
            resolved.append(existing["tag_id"])
        else:
            new_id = f"tag_{uuid.uuid4().hex[:8]}"
            await db.tags.insert_one({
                "tag_id": new_id,
                "name": str(item).strip(),
                "color": "#6366f1",
                "created_by": creator_email,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            resolved.append(new_id)
    return resolved


# ==================== SCHOOL MASTER ====================

@router.get("/schools")
async def get_schools(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    elif team in ("accounts", "store"):
        # These teams don't work with the CRM; return empty
        return []
    else:  # sales
        own_leads = await db.leads.find({"assigned_to": user["email"]}, {"_id": 0, "school_id": 1}).to_list(10000)
        linked_school_ids = [l.get("school_id") for l in own_leads if l.get("school_id")]
        query = {"$or": [
            {"created_by": user["email"]},
            {"school_id": {"$in": linked_school_ids}} if linked_school_ids else {"school_id": "__none__"},
        ]}
    query["is_deleted"] = {"$ne": True}
    schools = await db.schools.find(query, {"_id": 0}).sort("school_name", 1).to_list(10000)
    return schools


@router.post("/schools")
async def create_school(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    school_id = f"sch_{uuid.uuid4().hex[:12]}"
    school_doc = {
        "school_id": school_id,
        "school_name": body.get("school_name", ""),
        "school_type": body.get("school_type", "CBSE"),
        "board": body.get("board", ""),
        "group_id": body.get("group_id", ""),
        "website": body.get("website", ""),
        "email": body.get("email", ""),
        "phone": body.get("phone", ""),
        "city": body.get("city", ""),
        "state": body.get("state", ""),
        "pincode": body.get("pincode", ""),
        "address": body.get("address", ""),
        "primary_contact_name": body.get("primary_contact_name", ""),
        "designation": body.get("designation", ""),
        "alternate_contact": body.get("alternate_contact", ""),
        "school_strength": body.get("school_strength", 0),
        "number_of_branches": body.get("number_of_branches", 1),
        "annual_budget_range": body.get("annual_budget_range", ""),
        "existing_vendor": body.get("existing_vendor", ""),
        "social_profiles": body.get("social_profiles", {}),
        "anniversary": body.get("anniversary", ""),
        "last_activity_date": datetime.now(timezone.utc).isoformat(),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schools.insert_one(school_doc)
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.put("/schools/{school_id}")
async def update_school(school_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("school_name", "school_type", "board", "group_id", "website", "email", "phone",
              "city", "state", "pincode", "address", "primary_contact_name", "designation",
              "alternate_contact", "school_strength", "number_of_branches",
              "annual_budget_range", "existing_vendor", "social_profiles", "anniversary"):
        if k in body:
            allowed[k] = body[k]
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one({"school_id": school_id}, {"$set": allowed})
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.delete("/schools/{school_id}")
async def delete_school(school_id: str, request: Request, force: bool = False):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    # Cascade check — block hard delete if live data references this school
    if not force:
        linked_leads = await db.leads.count_documents({"school_id": school_id, "is_deleted": {"$ne": True}})
        linked_contacts = await db.contacts.count_documents({"school_id": school_id, "is_deleted": {"$ne": True}})
        linked_quotations = await db.quotations.count_documents({"school_id": school_id})
        linked_visits = await db.visit_plans.count_documents({"school_id": school_id})
        if linked_leads or linked_contacts or linked_quotations or linked_visits:
            return {
                "blocked": True,
                "reason": "School has linked data. Soft-deleted instead.",
                "links": {"leads": linked_leads, "contacts": linked_contacts,
                          "quotations": linked_quotations, "visits": linked_visits},
            }

    # Soft delete — keeps the record but marks it invisible to normal queries
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one(
        {"school_id": school_id},
        {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user["email"]}}
    )
    return {"message": "School archived (soft-deleted)"}


@router.put("/schools/{school_id}/restore")
async def restore_school(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.schools.update_one(
        {"school_id": school_id},
        {"$unset": {"is_deleted": "", "deleted_at": "", "deleted_by": ""}}
    )
    return {"message": "School restored"}


@router.get("/schools/{school_id}/profile")
async def get_school_profile(school_id: str, request: Request):
    await get_current_user(request)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    school_name = school.get("school_name", "")

    leads = await db.leads.find({"school_id": school_id}, {"_id": 0}).to_list(None)
    lead_ids = [l["lead_id"] for l in leads]

    # Query by FK first, fall back to string match for legacy records; deduplicate
    contacts_by_fk = await db.contacts.find({"school_id": school_id}, {"_id": 0}).to_list(None)
    fk_ids = {c["contact_id"] for c in contacts_by_fk}
    contacts_by_name = await db.contacts.find(
        {"company": school_name, "contact_id": {"$nin": list(fk_ids)}}, {"_id": 0}
    ).to_list(None)
    contacts_list = contacts_by_fk + contacts_by_name

    quotations = await db.quotations.find(
        {"school_name": school_name},
        {"_id": 0, "quotation_id": 1, "quotation_number": 1, "status": 1,
         "grand_total": 1, "currency_symbol": 1, "created_at": 1, "created_by_name": 1, "items": 1}
    ).sort("created_at", -1).to_list(None)

    # Fetch from visit_plans (admin-scheduled, have school_id)
    vp_list = await db.visit_plans.find({"school_id": school_id}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    # Also fetch self-created field_visits by school_name match (reps who didn't have a plan)
    fv_list = await db.field_visits.find({"school_name": school_name}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    # Normalize both to a unified schema for the frontend
    def _norm_vp(v):
        status = v.get("status", "planned")
        if status == "in_progress": status = "checked_in"
        return {
            "visit_id": v.get("plan_id"), "source": "visit_plan",
            "visit_date": v.get("visit_date"), "visit_time": v.get("visit_time"),
            "status": status, "purpose": v.get("purpose"), "outcome": v.get("outcome"),
            "notes": v.get("visit_notes"), "rep_name": v.get("assigned_name"),
            "check_in_time": v.get("check_in_time"), "check_out_time": v.get("check_out_time"),
            "check_in_address": v.get("check_in_address"), "school_name": v.get("school_name"),
        }
    def _norm_fv(v):
        status = v.get("status", "planned")
        if status == "visited": status = "checked_in"
        return {
            "visit_id": v.get("visit_id"), "source": "field_visit",
            "visit_date": v.get("visit_date"), "visit_time": v.get("visit_time"),
            "status": status, "purpose": v.get("purpose"), "outcome": v.get("outcome"),
            "notes": v.get("notes"), "rep_name": v.get("sales_person_name"),
            "check_in_time": v.get("check_in_time") or v.get("checked_in_at"),
            "check_out_time": v.get("check_out_time"), "check_in_address": None,
            "school_name": v.get("school_name"),
        }
    visits = sorted(
        [_norm_vp(v) for v in vp_list] + [_norm_fv(v) for v in fv_list],
        key=lambda v: (v.get("visit_date") or ""), reverse=True
    )

    call_notes = []
    meetings = []
    dispatches = []
    if lead_ids:
        call_notes = await db.call_notes.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).sort("created_at", -1).to_list(None)
        meetings = await db.followups.find(
            {"lead_id": {"$in": lead_ids}, "followup_type": "meeting"}, {"_id": 0}
        ).sort("followup_date", -1).to_list(None)
        dispatches = await db.physical_dispatches.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).sort("sent_date", -1).to_list(None)

    active_stages = {"new", "contacted", "demo", "quoted", "negotiation"}
    active_leads_count = sum(1 for l in leads if l.get("stage") in active_stages)

    all_dates = [cn["created_at"] for cn in call_notes if cn.get("created_at")]
    all_dates += [v["visit_date"] for v in visits if v.get("visit_date")]
    last_contacted = max(all_dates) if all_dates else None

    days_since = None
    if last_contacted:
        from datetime import date as _date
        try:
            lc_str = last_contacted[:10]
            lc = _date.fromisoformat(lc_str)
            days_since = (_date.today() - lc).days
        except Exception:
            pass

    total_revenue_quoted = sum(q.get("grand_total", 0) or 0 for q in quotations)

    return {
        "school": school,
        "leads": leads,
        "contacts": contacts_list,
        "quotations": quotations,
        "visits": visits,
        "call_notes": call_notes,
        "meetings": meetings,
        "dispatches": dispatches,
        "metrics": {
            "total_leads": len(leads),
            "active_leads": active_leads_count,
            "total_contacts": len(contacts_list),
            "total_visits": len(visits),
            "total_calls": len(call_notes),
            "total_quotations": len(quotations),
            "total_revenue_quoted": total_revenue_quoted,
            "last_contacted": last_contacted,
            "days_since_last_contact": days_since,
        },
    }


@router.put("/schools/{school_id}/set-password")
async def set_school_password(school_id: str, request: Request):
    from auth_utils import hash_password as _hash_password
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    password = body.get("password", "")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    await db.schools.update_one({"school_id": school_id}, {"$set": {"password_hash": _hash_password(password)}})
    return {"message": "Password set"}


# ==================== CONTACTS ====================

@router.get("/contacts")
async def get_contacts(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    elif team in ("accounts", "store"):
        return []
    else:  # sales
        query = {"created_by": user["email"]}
    query["is_deleted"] = {"$ne": True}
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return contacts


@router.post("/contacts")
async def create_contact(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name") or not body.get("phone"):
        raise HTTPException(status_code=400, detail="Name and phone are required")
    contact_id = f"con_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    # Resolve school_id → company (FK wins over string if both supplied)
    school_id = body.get("school_id") or None
    company = body.get("company", "")
    if school_id:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
        if sch:
            company = sch["school_name"]
        else:
            school_id = None  # invalid FK — ignore it

    contact_doc = {
        "contact_id": contact_id,
        "name": body.get("name", ""),
        "phone": body.get("phone", ""),
        "email": body.get("email", ""),
        "company": company,
        "school_id": school_id,
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "notes": body.get("notes", ""),
        "birthday": body.get("birthday", ""),
        "status": "active",
        "converted_to_lead": False,
        "lead_id": None,
        "previous_schools": [],
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.contacts.insert_one(contact_doc)
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("name", "phone", "email", "designation", "contact_role_id", "source", "source_id", "notes", "status", "birthday"):
        if k in body:
            allowed[k] = body[k]

    # school_id change: update FK, sync company, log previous school
    new_school_id = body.get("school_id")
    if "school_id" in body:
        if new_school_id:
            sch = await db.schools.find_one({"school_id": new_school_id}, {"_id": 0, "school_name": 1})
            if not sch:
                raise HTTPException(status_code=404, detail="School not found")
            existing = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "school_id": 1, "company": 1})
            old_school_id = existing.get("school_id") if existing else None
            if old_school_id and old_school_id != new_school_id:
                # Log the school change in history
                await db.contacts.update_one(
                    {"contact_id": contact_id},
                    {"$push": {"previous_schools": {
                        "school_id": old_school_id,
                        "company": existing.get("company", ""),
                        "until": datetime.now(timezone.utc).isoformat(),
                    }}}
                )
            allowed["school_id"] = new_school_id
            allowed["company"] = sch["school_name"]
        else:
            allowed["school_id"] = None

    # Allow direct company edit only when no school_id is being set
    elif "company" in body:
        allowed["company"] = body["company"]

    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": allowed})
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "contact_id": 1, "converted_to_lead": 1})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    # Block deletion if contact has been converted to an active lead
    if contact.get("converted_to_lead") and contact.get("lead_id"):
        lead = await db.leads.find_one({"lead_id": contact["lead_id"], "is_deleted": {"$ne": True}}, {"_id": 0, "lead_id": 1})
        if lead:
            raise HTTPException(status_code=409, detail="Contact is linked to an active lead. Delete the lead first or unlink it.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user["email"]}}
    )
    return {"message": "Contact archived (soft-deleted)"}


@router.post("/contacts/{contact_id}/tags")
async def add_contact_tag(contact_id: str, request: Request):
    """Add a tag to a contact. Body: {tag_id: str}"""
    await get_current_user(request)
    body = await request.json()
    tag_id = body.get("tag_id", "").strip()
    if not tag_id:
        raise HTTPException(400, "tag_id is required")
    if not await db.tags.find_one({"tag_id": tag_id}):
        raise HTTPException(404, "Tag not found")
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$addToSet": {"tag_ids": tag_id}}
    )
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}/tags/{tag_id}")
async def remove_contact_tag(contact_id: str, tag_id: str, request: Request):
    """Remove a tag from a contact."""
    await get_current_user(request)
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$pull": {"tag_ids": tag_id}}
    )
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.get("/contacts/{contact_id}/activity")
async def get_contact_activity(contact_id: str, request: Request):
    """Unified activity timeline: WhatsApp campaigns, drip enrollments, greeting logs."""
    await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(404, "Contact not found")

    items = []

    # WhatsApp campaign messages sent to this contact
    async for msg in db.whatsapp_scheduled.find(
        {"contact_id": contact_id}, {"_id": 0, "campaign_name": 1, "status": 1, "scheduled_at": 1, "sent_at": 1}
    ).sort("scheduled_at", -1).limit(50):
        items.append({
            "type": "whatsapp",
            "label": msg.get("campaign_name", "WhatsApp Campaign"),
            "summary": f"Status: {msg.get('status', 'unknown')}",
            "status": msg.get("status", ""),
            "at": msg.get("sent_at") or msg.get("scheduled_at", ""),
        })

    # Drip enrollments via linked lead
    lead_id = contact.get("lead_id")
    if lead_id:
        async for enr in db.drip_enrollments.find(
            {"lead_id": lead_id}, {"_id": 0, "sequence_id": 1, "status": 1, "enrolled_at": 1, "current_step": 1}
        ).sort("enrolled_at", -1).limit(20):
            seq = await db.drip_sequences.find_one({"sequence_id": enr["sequence_id"]}, {"_id": 0, "name": 1})
            seq_name = seq["name"] if seq else enr["sequence_id"]
            items.append({
                "type": "drip",
                "label": seq_name,
                "summary": f"Step {enr.get('current_step', 0) + 1} · {enr.get('status', '')}",
                "status": enr.get("status", ""),
                "at": enr.get("enrolled_at", ""),
            })

    # Greeting logs by phone
    phone = contact.get("phone", "")
    if phone:
        async for gl in db.greeting_logs.find(
            {"phone": phone}, {"_id": 0, "greeting_type": 1, "status": 1, "sent_at": 1}
        ).sort("sent_at", -1).limit(20):
            items.append({
                "type": "greeting",
                "label": gl.get("greeting_type", "Greeting"),
                "summary": f"Status: {gl.get('status', 'unknown')}",
                "status": gl.get("status", ""),
                "at": gl.get("sent_at", ""),
            })

    # Sort all by `at` descending, return max 100
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    return items[:100]


@router.put("/contacts/{contact_id}/restore")
async def restore_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$unset": {"is_deleted": "", "deleted_at": "", "deleted_by": ""}}
    )
    return {"message": "Contact restored"}


@router.post("/contacts/{contact_id}/convert-to-lead")
async def convert_contact_to_lead(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.get("converted_to_lead"):
        raise HTTPException(status_code=400, detail="Contact already converted to a lead")

    body = await request.json()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Inline school creation
    school_id = body.get("school_id", "")
    company_name = contact.get("company", "")
    new_school_data = body.get("new_school")
    if new_school_data and new_school_data.get("school_name"):
        school_id = f"sch_{uuid.uuid4().hex[:8]}"
        company_name = new_school_data.get("school_name", "")
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": company_name,
            "school_type": new_school_data.get("school_type", "CBSE"),
            "phone": new_school_data.get("phone", ""),
            "email": new_school_data.get("email", ""),
            "city": new_school_data.get("city", ""),
            "state": new_school_data.get("state", ""),
            "school_strength": new_school_data.get("school_strength", 0),
            "primary_contact_name": contact["name"],
            "designation": contact.get("designation", ""),
            "created_at": now_iso,
            "last_activity_date": now_iso,
        })
    elif school_id:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
        if sch:
            company_name = sch.get("school_name", company_name)

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    lead_doc = {
        "lead_id": lead_id,
        "school_id": school_id,
        "company_name": company_name,
        "contact_name": contact["name"],
        "designation": contact.get("designation", ""),
        "contact_role_id": contact.get("contact_role_id", ""),
        "contact_phone": contact["phone"],
        "contact_email": contact.get("email", ""),
        "source": contact.get("source", ""),
        "source_id": contact.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "interested_product": body.get("interested_product", ""),
        "stage": "new",
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "notes": contact.get("notes", ""),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "converted_from_contact": contact_id,
    }
    await db.leads.insert_one(lead_doc)
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "converted_to_lead": True,
        "lead_id": lead_id,
        "status": "converted",
        "last_activity_date": now_iso,
    }})
    if school_id:
        await touch_last_activity("school", school_id)
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/contacts/import")
async def import_contacts_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        user = await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    duplicates = 0
    errors = []
    for row in reader:
        try:
            name = row.get("name", "").strip()
            phone = row.get("phone", "").strip()
            if not name or not phone:
                errors.append("Row missing name or phone")
                continue
            existing = await db.contacts.find_one({"phone": phone, "name": name})
            if existing:
                duplicates += 1
                continue
            contact_id = f"con_{uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({
                "contact_id": contact_id,
                "name": name,
                "phone": phone,
                "email": row.get("email", "").strip(),
                "company": row.get("company", "").strip(),
                "designation": row.get("designation", "").strip(),
                "source": row.get("source", "").strip(),
                "notes": row.get("notes", "").strip(),
                "status": "active",
                "converted_to_lead": False,
                "lead_id": None,
                "created_by": user["email"] if request else "import",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "duplicates": duplicates, "errors": errors[:10]}


# ==================== LEADS ====================

@router.get("/leads")
async def get_leads(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    elif team in ("accounts", "store"):
        return []
    else:  # sales — only assigned leads
        query = {"assigned_to": user["email"]}
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    school_cache = {}
    now = datetime.now(timezone.utc)

    # Batch-fetch linked contact names (P1-B)
    cfc_ids = [l.get("converted_from_contact") for l in leads if l.get("converted_from_contact")]
    linked_map = {}
    if cfc_ids:
        async for c in db.contacts.find(
            {"contact_id": {"$in": cfc_ids}}, {"_id": 0, "contact_id": 1, "name": 1}
        ):
            linked_map[c["contact_id"]] = c["name"]

    for lead in leads:
        sid = lead.get("school_id")
        if sid and sid not in school_cache:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0})
            school_cache[sid] = sch
        school = school_cache.get(sid)
        lead["school_name"] = school["school_name"] if school else lead.get("school_name", "")
        lead["school_type"] = school.get("school_type", "") if school else ""
        lead["school_city"] = school.get("city", "") if school else ""
        lead["school_strength"] = school.get("school_strength", 0) if school else 0
        lead["lead_score"] = calc_lead_score(lead, school)
        lead["visit_required"] = compute_visit_required(lead, now)
        lead["linked_contact_name"] = linked_map.get(lead.get("converted_from_contact"))
    return leads


@router.post("/leads")
async def create_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    school_id = body.get("school_id")
    if not school_id and body.get("new_school"):
        ns = body["new_school"]
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": ns.get("school_name", ""),
            "school_type": ns.get("school_type", "CBSE"),
            "website": ns.get("website", ""),
            "email": ns.get("email", ""),
            "phone": ns.get("phone", ""),
            "city": ns.get("city", ""),
            "state": ns.get("state", ""),
            "pincode": ns.get("pincode", ""),
            "primary_contact_name": body.get("contact_name", ""),
            "designation": body.get("designation", ""),
            "school_strength": ns.get("school_strength", 0),
            "number_of_branches": ns.get("number_of_branches", 1),
            "created_by": user["email"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    initial_stage = body.get("stage", "new")
    lead_doc = {
        "lead_id": lead_id,
        "school_id": school_id or "",
        "company_name": body.get("company_name", ""),
        "contact_name": body.get("contact_name", ""),
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "contact_phone": body.get("contact_phone", ""),
        "contact_email": body.get("contact_email", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "interested_product": body.get("interested_product", ""),
        "stage": initial_stage,
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "assignment_type": body.get("assignment_type", "manual"),
        "likely_closure_date": body.get("likely_closure_date", ""),
        "pipeline_history": [{
            "from_stage": None,
            "to_stage": initial_stage,
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": "Lead created",
        }],
        "last_visit_date": None,
        "notes": body.get("notes", ""),
        "referred_by_contact_id": body.get("referred_by_contact_id", ""),
        "referral_reward_status": body.get("referral_reward_status", "none"),
        "tags": await _resolve_tags(body.get("tags", []), user["email"]),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.leads.insert_one(lead_doc)
    asyncio.create_task(_auto_enroll_lead(lead_doc))
    if school_id:
        await touch_last_activity("school", school_id)
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    existing = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Lead not found")
    allowed = {}
    for k in ("school_id", "company_name", "contact_name", "designation", "contact_role_id",
              "contact_phone", "contact_email", "source", "source_id",
              "lead_type", "interested_product", "stage", "priority",
              "next_followup_date", "assigned_to", "assigned_name", "notes",
              "assignment_type", "likely_closure_date",
              "referred_by_contact_id", "referral_reward_status"):
        if k in body:
            allowed[k] = body[k]
    if "tags" in body:
        allowed["tags"] = await _resolve_tags(body["tags"], user["email"])
    now_iso = datetime.now(timezone.utc).isoformat()
    allowed["updated_at"] = now_iso
    allowed["last_activity_date"] = now_iso

    if existing.get("is_locked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Lead is locked after order conversion. Admin unlock required.")

    if "stage" in body and body["stage"] != existing.get("stage"):
        history = existing.get("pipeline_history", []) or []
        history.append({
            "from_stage": existing.get("stage"),
            "to_stage": body["stage"],
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": body.get("stage_change_note", ""),
        })
        allowed["pipeline_history"] = history

    if "assigned_to" in body and body["assigned_to"] != existing.get("assigned_to"):
        await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                           details=f"From {existing.get('assigned_name', existing.get('assigned_to'))} to {body.get('assigned_name', body['assigned_to'])}")

    await db.leads.update_one({"lead_id": lead_id}, {"$set": allowed})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return lead


@router.get("/leads/referral-leaderboard")
async def referral_leaderboard(request: Request):
    """Returns top referrers: contacts who have referred the most leads."""
    await get_current_user(request)
    pipeline = [
        {"$match": {"referred_by_contact_id": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$referred_by_contact_id",
            "total_referred": {"$sum": 1},
            "won": {"$sum": {"$cond": [{"$eq": ["$stage", "won"]}, 1, 0]}},
            "pending": {"$sum": {"$cond": [{"$nin": ["$stage", ["won", "lost"]]}, 1, 0]}},
        }},
        {"$sort": {"total_referred": -1}},
        {"$limit": 20},
    ]
    rows = await db.leads.aggregate(pipeline).to_list(20)
    contact_ids = [r["_id"] for r in rows]
    contacts = await db.contacts.find({"contact_id": {"$in": contact_ids}}, {"_id": 0, "contact_id": 1, "name": 1, "company": 1, "phone": 1}).to_list(20)
    contact_map = {c["contact_id"]: c for c in contacts}
    result = []
    for r in rows:
        c = contact_map.get(r["_id"], {})
        result.append({
            "contact_id": r["_id"],
            "contact_name": c.get("name", "Unknown"),
            "company": c.get("company", ""),
            "phone": c.get("phone", ""),
            "total_referred": r["total_referred"],
            "won": r["won"],
            "pending": r["pending"],
        })
    return result


@router.post("/leads/reassign")
async def reassign_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    lead_id = body.get("lead_id")
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "").strip()
    if not lead_id or not new_agent_email or not reason:
        raise HTTPException(status_code=400, detail="lead_id, new_agent_email and reason are required")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    role = user.get("role", "")
    if role == "agent":
        raise HTTPException(status_code=403, detail="Agents cannot reassign")
    now_iso = datetime.now(timezone.utc).isoformat()
    history = lead.get("reassignments", []) or []
    history.append({
        "from_email": lead.get("assigned_to", ""),
        "from_name": lead.get("assigned_name", ""),
        "to_email": new_agent_email,
        "to_name": new_agent_name,
        "by_email": user["email"],
        "by_name": user["name"],
        "reason": reason,
        "at": now_iso,
    })
    reassign_count = (lead.get("reassignment_count", 0) or 0) + 1
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {
        "assigned_to": new_agent_email,
        "assigned_name": new_agent_name,
        "assignment_type": "manual",
        "reassignments": history,
        "reassignment_count": reassign_count,
        "last_reassigned_at": now_iso,
        "last_reassigned_by": user["email"],
        "last_reassignment_reason": reason,
        "updated_at": now_iso,
        "last_activity_date": now_iso,
    }})
    await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                       details=f"-> {new_agent_name} | {reason}")
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/leads/bulk-assign")
async def bulk_assign_leads(request: Request):
    user = await get_current_user(request)
    if user.get("role") == "agent":
        raise HTTPException(status_code=403, detail="Agents cannot reassign")
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "Bulk assignment").strip()
    if not lead_ids or not new_agent_email:
        raise HTTPException(status_code=400, detail="lead_ids and new_agent_email required")
    now_iso = datetime.now(timezone.utc).isoformat()
    leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    count = 0
    for lead in leads:
        history = lead.get("reassignments", []) or []
        history.append({
            "from_email": lead.get("assigned_to", ""),
            "from_name": lead.get("assigned_name", ""),
            "to_email": new_agent_email,
            "to_name": new_agent_name,
            "by_email": user["email"],
            "by_name": user["name"],
            "reason": reason,
            "at": now_iso,
        })
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": new_agent_email,
            "assigned_name": new_agent_name,
            "assignment_type": "bulk",
            "reassignments": history,
            "reassignment_count": (lead.get("reassignment_count", 0) or 0) + 1,
            "last_reassigned_at": now_iso,
            "last_reassigned_by": user["email"],
            "last_reassignment_reason": reason,
            "updated_at": now_iso,
            "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "bulk_assign_lead", "lead", lead["lead_id"],
                           details=f"-> {new_agent_name} | {reason}")
        count += 1
    return {"assigned": count}


@router.post("/leads/bulk-tag")
async def bulk_tag_leads(request: Request):
    """Add or remove a tag from multiple leads at once."""
    user = await get_current_user(request)
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    tag_id = body.get("tag_id", "").strip()
    action = body.get("action", "add")  # "add" or "remove"
    if not lead_ids or not tag_id:
        raise HTTPException(400, "lead_ids and tag_id are required")
    if not await db.tags.find_one({"tag_id": tag_id}):
        raise HTTPException(404, "Tag not found")
    op = {"$addToSet": {"tags": tag_id}} if action == "add" else {"$pull": {"tags": tag_id}}
    result = await db.leads.update_many({"lead_id": {"$in": lead_ids}}, op)
    await log_activity(user["email"], f"bulk_tag_{action}", "lead", ",".join(lead_ids[:5]),
                       details=f"tag_id={tag_id} action={action} count={result.modified_count}")
    return {"modified": result.modified_count}


@router.post("/leads/bulk-stage")
async def bulk_stage_leads(request: Request):
    """Move multiple leads to a new pipeline stage."""
    user = await get_current_user(request)
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    stage = body.get("stage", "").strip()
    if not lead_ids or not stage:
        raise HTTPException(400, "lead_ids and stage are required")
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    for lead_id in lead_ids:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "stage": 1})
        if not lead:
            continue
        history_entry = {
            "from_stage": lead.get("stage"),
            "to_stage": stage,
            "by_email": user["email"],
            "by_name": user.get("name", user["email"]),
            "at": now_iso,
        }
        await db.leads.update_one(
            {"lead_id": lead_id},
            {
                "$set": {"stage": stage, "updated_at": now_iso, "last_activity_date": now_iso},
                "$push": {"pipeline_history": history_entry},
            },
        )
        count += 1
    await log_activity(user["email"], "bulk_stage_change", "lead", ",".join(lead_ids[:5]),
                       details=f"-> {stage} | count={count}")
    return {"modified": count}


@router.post("/leads/auto-assign")
async def auto_assign_leads(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    lead_ids = body.get("lead_ids") or None
    sps = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).sort("name", 1).to_list(1000)
    if not sps:
        raise HTTPException(status_code=400, detail="No active sales persons available")
    if lead_ids:
        leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    else:
        leads = await db.leads.find({"$or": [{"assigned_to": ""}, {"assigned_to": None}]}, {"_id": 0}).to_list(10000)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = []
    for i, lead in enumerate(leads):
        sp = sps[i % len(sps)]
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": sp["email"],
            "assigned_name": sp["name"],
            "assignment_type": "round_robin",
            "updated_at": now_iso,
            "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "auto_assign_lead", "lead", lead["lead_id"],
                           details=f"Round-robin to {sp['name']}")
        updates.append({"lead_id": lead["lead_id"], "assigned_to": sp["email"], "assigned_name": sp["name"]})
    return {"assigned": len(updates), "details": updates}


@router.post("/leads/import")
async def import_leads_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))

    created = 0
    linked = 0
    duplicates = 0
    errors = []

    for row in reader:
        try:
            school_name = row.get("school_name", "").strip()
            phone = row.get("phone", "").strip()
            website = row.get("website", "").strip()
            contact_name = row.get("contact_name", "").strip()

            if not school_name:
                errors.append("Row missing school_name")
                continue

            school = None
            if phone:
                school = await db.schools.find_one({"$or": [
                    {"school_name": school_name, "phone": phone},
                    {"phone": phone},
                ]}, {"_id": 0})
            if not school and website:
                school = await db.schools.find_one({"website": website}, {"_id": 0})
            if not school:
                school = await db.schools.find_one({"school_name": school_name}, {"_id": 0})

            school_id = None
            if school:
                school_id = school["school_id"]
                linked += 1
            else:
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                await db.schools.insert_one({
                    "school_id": school_id,
                    "school_name": school_name,
                    "school_type": row.get("school_type", "CBSE").strip(),
                    "website": website,
                    "email": row.get("email", "").strip(),
                    "phone": phone,
                    "city": row.get("location", row.get("city", "")).strip(),
                    "state": row.get("state", "").strip(),
                    "pincode": row.get("pincode", "").strip(),
                    "primary_contact_name": contact_name,
                    "designation": row.get("designation", "").strip(),
                    "school_strength": int(row.get("school_strength", 0) or 0),
                    "number_of_branches": 1,
                    "created_by": "import",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

            existing_lead = await db.leads.find_one({
                "school_id": school_id,
                "contact_phone": phone,
            }, {"_id": 0})
            if existing_lead:
                duplicates += 1
                continue

            lead_id = f"lead_{uuid.uuid4().hex[:12]}"
            await db.leads.insert_one({
                "lead_id": lead_id,
                "school_id": school_id,
                "company_name": school_name,
                "contact_name": contact_name,
                "designation": row.get("designation", "").strip(),
                "contact_phone": phone,
                "contact_email": row.get("email", "").strip(),
                "source": row.get("source", "import").strip(),
                "lead_type": "warm",
                "stage": "new",
                "priority": "medium",
                "interested_product": "",
                "next_followup_date": "",
                "assigned_to": "",
                "assigned_name": "",
                "notes": "",
                "created_by": "import",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            created += 1
        except Exception as e:
            errors.append(str(e))

    return {"created": created, "linked": linked, "duplicates": duplicates, "errors": errors[:10]}


@router.post("/leads/{lead_id}/lock")
async def lock_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    is_locked = bool(body.get("is_locked", True))
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"is_locked": is_locked}})
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, request: Request):
    await get_current_user(request)
    await db.leads.delete_one({"lead_id": lead_id})
    return {"message": "Lead deleted"}


@router.get("/leads/{lead_id}/notes")
async def get_lead_notes(lead_id: str, request: Request):
    await get_current_user(request)
    notes = await db.call_notes.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return notes


@router.post("/leads/{lead_id}/notes")
async def add_call_note(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    note_id = f"note_{uuid.uuid4().hex[:12]}"
    note_doc = {
        "note_id": note_id,
        "lead_id": lead_id,
        "type": body.get("type", "call"),
        "content": body.get("content", ""),
        "outcome": body.get("outcome", ""),
        "created_by": user["email"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.call_notes.insert_one(note_doc)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"updated_at": now_iso, "last_activity_date": now_iso}})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.call_notes.find_one({"note_id": note_id}, {"_id": 0})


# ==================== FOLLOW-UPS ====================

@router.get("/followups")
async def get_followups(request: Request, lead_id: Optional[str] = None):
    user = await get_current_user(request)
    team = get_team(user)
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    elif team == "admin":
        pass  # no filter — see all
    else:
        query["assigned_to"] = user["email"]
    followups = await db.followups.find(query, {"_id": 0}).sort("followup_date", -1).to_list(5000)
    return followups


@router.post("/followups")
async def create_followup(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fid = f"fu_{uuid.uuid4().hex[:12]}"
    fu_doc = {
        "followup_id": fid,
        "lead_id": body.get("lead_id"),
        "followup_date": body.get("followup_date", ""),
        "followup_time": body.get("followup_time", ""),
        "followup_type": body.get("followup_type", "call"),
        "notes": body.get("notes", ""),
        "outcome": body.get("outcome", ""),
        "status": body.get("status", "pending"),
        "assigned_to": body.get("assigned_to", user["email"]),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.followups.insert_one(fu_doc)
    if fu_doc.get("lead_id"):
        await touch_last_activity("lead", fu_doc["lead_id"])
        lead = await db.leads.find_one({"lead_id": fu_doc["lead_id"]}, {"_id": 0, "school_id": 1})
        if lead and lead.get("school_id"):
            await touch_last_activity("school", lead["school_id"])
    return await db.followups.find_one({"followup_id": fid}, {"_id": 0})


@router.put("/followups/{followup_id}")
async def update_followup(followup_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("followup_date", "followup_time", "followup_type", "notes", "outcome", "status") if k in body}
    await db.followups.update_one({"followup_id": followup_id}, {"$set": allowed})
    return await db.followups.find_one({"followup_id": followup_id}, {"_id": 0})


# ==================== PHYSICAL DISPATCHES ====================

@router.get("/physical-dispatches")
async def get_physical_dispatches(request: Request, lead_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    elif get_team(user) != "admin":
        query["created_by"] = user["email"]
    dispatches = await db.physical_dispatches.find(query, {"_id": 0}).sort("sent_date", -1).to_list(2000)
    return dispatches


@router.post("/physical-dispatches")
async def create_physical_dispatch(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("lead_id"):
        raise HTTPException(status_code=400, detail="lead_id is required")
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "dispatch_id": dispatch_id,
        "lead_id": body.get("lead_id", ""),
        "lead_name": body.get("lead_name", ""),
        "material_type": body.get("material_type", "brochure"),
        "description": body.get("description", ""),
        "courier_name": body.get("courier_name", ""),
        "tracking_number": body.get("tracking_number", ""),
        "sent_date": body.get("sent_date", now_iso[:10]),
        "received_confirmed": False,
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.physical_dispatches.insert_one(doc)
    await touch_last_activity("lead", body["lead_id"])

    # Auto-WhatsApp: fire-and-forget tracking notification to the lead contact
    try:
        lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})
        if lead_doc and lead_doc.get("contact_phone"):
            courier_key = doc.get("courier_name", "").lower().strip()
            tn = doc.get("tracking_number", "")
            _COURIER_URLS = {
                "delhivery": f"https://www.delhivery.com/track/package/{tn}",
                "blue dart": f"https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
                "bluedart": f"https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
                "dtdc": f"https://tracking.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCustInter&cType=Consignment&cnNo={tn}",
            }
            tracking_url = _COURIER_URLS.get(courier_key, "")
            track_part = f"\nTrack here: {tracking_url}" if tracking_url else ""
            contact_name = lead_doc.get("contact_name", "Sir/Madam")
            courier_name = doc.get("courier_name", "courier")
            message = (
                f"Dear {contact_name}, your {doc.get('material_type', 'material')} from SmartShape "
                f"has been dispatched!\nCourier: {courier_name}"
                f"{(' | Tracking: ' + tn) if tn else ''}"
                f"{track_part}"
            )
            wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
            if wa_settings and wa_settings.get("username"):
                import httpx as _httpx
                async with _httpx.AsyncClient(timeout=15) as client:
                    await client.post(
                        "https://app.messageautosender.com/message/new",
                        data={
                            "username": wa_settings["username"],
                            "password": wa_settings["password"],
                            "receiverMobileNo": lead_doc["contact_phone"],
                            "message": message,
                        },
                    )
                await db.whatsapp_logs.insert_one({
                    "log_id": f"wal_{uuid.uuid4().hex[:10]}",
                    "template_id": None,
                    "phone": lead_doc["contact_phone"],
                    "body": message,
                    "lead_id": body["lead_id"],
                    "send_mode": "auto_dispatch",
                    "status": "sent",
                    "sent_by": "system",
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                })
    except Exception:
        pass  # Dispatch is already saved — WA failure is non-blocking

    return await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})


@router.put("/physical-dispatches/{dispatch_id}")
async def update_physical_dispatch(dispatch_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("courier_name", "tracking_number", "sent_date", "received_confirmed", "description", "material_type") if k in body}
    await db.physical_dispatches.update_one({"dispatch_id": dispatch_id}, {"$set": allowed})
    return await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})


@router.delete("/physical-dispatches/{dispatch_id}")
async def delete_physical_dispatch(dispatch_id: str, request: Request):
    await get_current_user(request)
    result = await db.physical_dispatches.delete_one({"dispatch_id": dispatch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return {"message": "Deleted"}


# ==================== TASKS ====================

@router.get("/tasks")
async def get_tasks(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    else:
        query = {"$or": [{"assigned_to": user["email"]}, {"created_by": user["email"]}]}
    tasks = await db.tasks.find(query, {"_id": 0}).sort("due_date", 1).to_list(5000)
    return tasks


@router.post("/tasks")
async def create_task(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    task_doc = {
        "task_id": task_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "type": body.get("type", "follow_up"),
        "lead_id": body.get("lead_id"),
        "lead_name": body.get("lead_name", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "due_date": body.get("due_date", ""),
        "due_time": body.get("due_time", ""),
        "priority": body.get("priority", "medium"),
        "status": "pending",
        "outcome": "",
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(task_doc)
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("title", "description", "type", "assigned_to", "assigned_name",
              "due_date", "due_time", "priority", "status", "outcome") if k in body}
    await db.tasks.update_one({"task_id": task_id}, {"$set": allowed})
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    await get_current_user(request)
    await db.tasks.delete_one({"task_id": task_id})
    return {"message": "Task deleted"}


# ── Google Maps URL resolver ──────────────────────────────────────────────────
@router.get("/resolve-maps-url")
async def resolve_maps_url(url: str, request: Request):
    """Follow redirects on Google Share / short URLs and extract coordinates."""
    await get_current_user(request)
    try:
        resp = http_requests.get(
            url,
            allow_redirects=True,
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SmartShapePro/1.0)"},
        )
        final_url = resp.url

        # Try all known coordinate patterns in the final URL
        patterns = [
            r'@(-?\d+\.\d+),(-?\d+\.\d+)',
            r'[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)',
            r'/place/[^/]+/@(-?\d+\.\d+),(-?\d+\.\d+)',
            r'[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)',
        ]
        for pat in patterns:
            m = re.search(pat, final_url)
            if m:
                return {"lat": float(m.group(1)), "lng": float(m.group(2)), "final_url": final_url}

        return {"lat": None, "lng": None, "final_url": final_url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve URL: {e}")
