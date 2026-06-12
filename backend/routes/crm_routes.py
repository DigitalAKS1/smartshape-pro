from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
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


async def create_physical_from_drip(lead: dict, material_type: str, seq_name: str) -> str:
    """Queue a physical dispatch + a rep task from a drip step. Returns dispatch_id."""
    now_iso = datetime.now(timezone.utc).isoformat()
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    await db.physical_dispatches.insert_one({
        "dispatch_id": dispatch_id,
        "lead_id": lead.get("lead_id", ""),
        "lead_name": lead.get("contact_name", ""),
        "material_type": material_type or "brochure",
        "description": f"Auto-queued by drip: {seq_name}",
        "courier_name": "", "tracking_number": "", "sent_date": "",
        "received_confirmed": False,
        "auto_from_drip": True, "needs_dispatch": True,
        "created_by": "system", "created_at": now_iso,
    })
    await db.tasks.insert_one({
        "task_id": f"task_{uuid.uuid4().hex[:10]}",
        "title": f"Ship {material_type or 'material'} → {lead.get('company_name', '')}",
        "description": f"Auto-created by drip sequence '{seq_name}'. Add courier + tracking after shipping.",
        "type": "other", "lead_id": lead.get("lead_id", ""),
        "assigned_to": lead.get("assigned_to", ""),
        "due_date": "", "due_time": "", "priority": "medium",
        "status": "pending", "created_by": "system", "created_at": now_iso,
    })
    return dispatch_id


import os as _os
DEMO_WA_DRY_RUN = _os.getenv("DEMO_WA_DRY_RUN", "0") == "1"

async def _send_demo_wa(phone: str, message: str) -> bool:
    """Direct WhatsApp send via the configured provider (mirrors dispatch auto-WA)."""
    if not phone:
        return False
    if DEMO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[demo][dry] WA -> {phone}: {message[:60]}")
        return True
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa or not wa.get("username"):
        return False
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            await client.post("https://app.messageautosender.com/message/new", data={
                "username": wa["username"], "password": wa["password"],
                "receiverMobileNo": phone, "message": message})
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message,
            "send_mode": "demo_link", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False


INTRO_WA_DRY_RUN = _os.getenv("INTRO_WA_DRY_RUN", "0") == "1"

async def _send_intro_wa(phone: str, message: str) -> bool:
    if not phone or not message:
        return False
    if INTRO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[intro][dry] WA -> {phone}: {message[:60]}")
        return True
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa or not wa.get("username"):
        return False
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            await client.post("https://app.messageautosender.com/message/new", data={
                "username": wa["username"], "password": wa["password"],
                "receiverMobileNo": phone, "message": message})
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message,
            "send_mode": "lead_intro", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False


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


# ==================== PHASE 1: PIPELINE SETTINGS + COMPUTE ====================

OPEN_STAGES = ["new", "contacted", "demo", "quoted", "negotiation"]

DEFAULT_PIPELINE_SETTINGS = {
    "type": "crm_pipeline",
    "stage_probabilities": {
        "new": 10, "contacted": 20, "demo": 30, "quoted": 50,
        "negotiation": 70, "won": 100, "lost": 0, "retention": 0, "resell": 0,
    },
    "stage_idle_limits": {
        "new": 7, "contacted": 5, "demo": 4, "quoted": 4,
        "negotiation": 3, "retention": 30, "resell": 14,
    },
    "lost_reasons": ["Price", "Competitor", "No budget", "No response", "Timing", "Other"],
    "digest_time": "08:00",
    "digest_enabled": False,
}


async def get_crm_settings() -> dict:
    doc = await db.settings.find_one({"type": "crm_pipeline"}, {"_id": 0})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_PIPELINE_SETTINGS))
        doc = {}
    merged = {**DEFAULT_PIPELINE_SETTINGS, **doc}
    for mk in ("stage_probabilities", "stage_idle_limits"):
        merged[mk] = {**DEFAULT_PIPELINE_SETTINGS[mk], **(doc.get(mk) or {})}
    merged.pop("_id", None)
    return merged


def resolve_lead_value(lead: dict, quote_map: dict) -> float:
    """Linked quotation grand_total (latest) wins; else manual expected_value."""
    qids = lead.get("quotation_ids") or []
    linked = [quote_map[q] for q in qids if q in quote_map]
    if linked:
        latest = max(linked, key=lambda q: q.get("created_at", "") or "")
        return float(latest.get("grand_total", 0) or 0)
    return float(lead.get("expected_value", 0) or 0)


def stage_probability(stage: str, settings: dict) -> int:
    return int((settings.get("stage_probabilities") or {}).get(stage, 0) or 0)


async def _build_quote_map(leads: list) -> dict:
    ids = [q for l in leads for q in (l.get("quotation_ids") or [])]
    qmap = {}
    if ids:
        async for q in db.quotations.find(
            {"quotation_id": {"$in": ids}},
            {"_id": 0, "quotation_id": 1, "grand_total": 1, "created_at": 1},
        ):
            qmap[q["quotation_id"]] = q
    return qmap


def _parse_dt(val):
    if not val:
        return None
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        try:
            dt = datetime.fromisoformat(str(val)[:10])
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compute_attention(lead: dict, now: datetime, settings: dict,
                      has_upcoming: bool, has_open_task: bool) -> list:
    """Return list of reason codes; empty if the lead is fine. Open stages only."""
    if lead.get("stage") not in OPEN_STAGES:
        return []
    reasons = []
    nfd = _parse_dt(lead.get("next_followup_date"))
    if nfd and nfd < now:
        reasons.append("overdue")
    last = _parse_dt(lead.get("last_activity_date"))
    limit = (settings.get("stage_idle_limits") or {}).get(lead.get("stage"), 7)
    if last and (now - last).days >= int(limit or 7):
        reasons.append("stuck")
    if not has_upcoming and not has_open_task:
        reasons.append("no_next_action")
    return reasons


FUNNEL_ORDER = ["new", "contacted", "demo", "quoted", "negotiation", "won"]
FUNNEL_RANK = {s: i for i, s in enumerate(FUNNEL_ORDER)}


def _max_stage_reached(lead: dict) -> int:
    """Highest funnel rank this lead has touched, from pipeline_history + current stage."""
    best = FUNNEL_RANK.get(lead.get("stage", ""), -1)
    for h in lead.get("pipeline_history", []) or []:
        best = max(best, FUNNEL_RANK.get(h.get("to_stage", ""), -1))
    return best


def _avg_days_in_stage(leads: list, stage: str) -> float:
    """Average days a lead spent in `stage`, from consecutive pipeline_history timestamps."""
    spans = []
    for lead in leads:
        hist = sorted((lead.get("pipeline_history") or []), key=lambda h: h.get("at", "") or "")
        for i, h in enumerate(hist):
            if h.get("to_stage") != stage:
                continue
            start = h.get("at")
            end = hist[i + 1].get("at") if i + 1 < len(hist) else None
            if not start or not end:
                continue
            d0 = _parse_dt(start)
            d1 = _parse_dt(end)
            if d0 and d1:
                spans.append((d1 - d0).total_seconds() / 86400)
    return round(sum(spans) / len(spans), 1) if spans else 0.0


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


# ==================== PIPELINE SETTINGS ====================

@router.get("/pipeline-settings")
async def get_pipeline_settings(request: Request):
    await get_current_user(request)
    return await get_crm_settings()


@router.put("/pipeline-settings")
async def update_pipeline_settings(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    allowed = {}
    for k in ("stage_probabilities", "stage_idle_limits", "lost_reasons",
              "digest_time", "digest_enabled"):
        if k in body:
            allowed[k] = body[k]
    if allowed:
        await db.settings.update_one(
            {"type": "crm_pipeline"}, {"$set": allowed}, upsert=True
        )
    return await get_crm_settings()


# ==================== SCHOOL TYPE MASTER ====================

DEFAULT_SCHOOL_TYPES = ["CBSE", "ICSE", "IB", "Cambridge", "State Board", "Coaching", "College"]


@router.get("/school-types")
async def get_school_types(request: Request):
    await get_current_user(request)
    items = await db.school_types.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    if not items:
        for s in DEFAULT_SCHOOL_TYPES:
            await db.school_types.insert_one({
                "type_id": f"st_{uuid.uuid4().hex[:8]}",
                "name": s, "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        items = await db.school_types.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return items


@router.post("/school-types")
async def create_school_type(request: Request):
    await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    existing = await db.school_types.find_one({"name": name}, {"_id": 0})
    if existing:
        return existing
    type_id = f"st_{uuid.uuid4().hex[:8]}"
    await db.school_types.insert_one({
        "type_id": type_id, "name": name, "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.school_types.find_one({"type_id": type_id}, {"_id": 0})


@router.put("/school-types/{type_id}")
async def update_school_type(type_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.school_types.update_one({"type_id": type_id}, {"$set": allowed})
    return await db.school_types.find_one({"type_id": type_id}, {"_id": 0})


@router.delete("/school-types/{type_id}")
async def delete_school_type(type_id: str, request: Request):
    await get_current_user(request)
    await db.school_types.delete_one({"type_id": type_id})
    return {"message": "School type deleted"}


# ==================== INTERESTED PRODUCT MASTER ====================
# Custom/individual "interested product" entries that aren't formal packages.
# Packages remain the primary UI options; these accumulate from rep input.

@router.get("/interested-products")
async def get_interested_products(request: Request):
    await get_current_user(request)
    return await db.interested_products.find({}, {"_id": 0}).sort("name", 1).to_list(300)


@router.post("/interested-products")
async def create_interested_product(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    existing = await db.interested_products.find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0})
    if existing:
        return existing
    product_id = f"ip_{uuid.uuid4().hex[:8]}"
    await db.interested_products.insert_one({
        "product_id": product_id, "name": name, "is_active": True,
        "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.interested_products.find_one({"product_id": product_id}, {"_id": 0})


@router.delete("/interested-products/{product_id}")
async def delete_interested_product(product_id: str, request: Request):
    await get_current_user(request)
    await db.interested_products.delete_one({"product_id": product_id})
    return {"message": "Interested product deleted"}


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


# ==================== DESIGNATION MASTER ====================

_DEFAULT_DESIGNATIONS = [
    "CEO", "MD", "Director", "Trustee", "Chairman",
    "Principal", "Vice Principal", "Head of Department",
    "Coordinator", "Administrator", "Accountant",
    "Teacher", "Librarian", "Counselor",
]

@router.get("/designations")
async def get_designations(request: Request):
    await get_current_user(request)
    designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    if not designations:
        for d in _DEFAULT_DESIGNATIONS:
            await db.designations.insert_one({"designation_id": f"des_{uuid.uuid4().hex[:8]}", "name": d, "is_active": True})
        designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return designations

@router.post("/designations")
async def create_designation(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    existing = await db.designations.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if existing:
        raise HTTPException(status_code=409, detail="Designation already exists")
    did = f"des_{uuid.uuid4().hex[:8]}"
    doc = {"designation_id": did, "name": name, "department": body.get("department", ""), "is_active": True, "created_by": user["email"]}
    await db.designations.insert_one(doc)
    return await db.designations.find_one({"designation_id": did}, {"_id": 0})

@router.put("/designations/{designation_id}")
async def update_designation(designation_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: v for k, v in body.items() if k in ("name", "department", "is_active")}
    if allowed:
        await db.designations.update_one({"designation_id": designation_id}, {"$set": allowed})
    return await db.designations.find_one({"designation_id": designation_id}, {"_id": 0})

@router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: str, request: Request):
    await get_current_user(request)
    await db.designations.delete_one({"designation_id": designation_id})
    return {"message": "Designation deleted"}


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

async def _owned_school_ids(email: str) -> list:
    """School ids a sales user owns (assigned to them) or created — excludes deleted."""
    cur = db.schools.find(
        {"$or": [{"assigned_to": email}, {"created_by": email}], "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1},
    )
    return [s["school_id"] async for s in cur]


async def _sales_lead_scope(email: str) -> list:
    """$or clauses making a sales user's lead view = assigned + under owned schools.
    Mirrors GET /leads so deal analytics agree with the pipeline a rep can see."""
    owned = await _owned_school_ids(email)
    return [{"assigned_to": email}, {"school_id": {"$in": owned}}]


async def _user_can_access_school(user: dict, school: dict) -> bool:
    """Mirror GET /schools sales scope: admin sees all; accounts/store none;
    sales sees owned/created schools + schools holding their leads."""
    if not school:
        return False
    team = get_team(user)
    if team == "admin":
        return True
    if team in ("accounts", "store"):
        return False
    email = user["email"]
    if school.get("assigned_to") == email or school.get("created_by") == email:
        return True
    sid = school.get("school_id")
    if sid:
        lead = await db.leads.find_one(
            {"school_id": sid, "assigned_to": email}, {"_id": 0, "lead_id": 1}
        )
        if lead:
            return True
    return False


async def _user_can_mutate_lead(user: dict, lead: dict) -> bool:
    """admin all; accounts/store none; sales if assigned or under an owned school."""
    if not lead:
        return False
    team = get_team(user)
    if team == "admin":
        return True
    if team in ("accounts", "store"):
        return False
    email = user["email"]
    if lead.get("assigned_to") == email:
        return True
    sid = lead.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
    return False


async def _user_can_mutate_contact(user: dict, contact: dict) -> bool:
    """admin all; accounts/store none; sales if creator/assignee or under an owned school."""
    if not contact:
        return False
    team = get_team(user)
    if team == "admin":
        return True
    if team in ("accounts", "store"):
        return False
    email = user["email"]
    if contact.get("created_by") == email or contact.get("assigned_to") == email:
        return True
    sid = contact.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
    return False


async def _assign_school_cascade(school_id: str, assigned_to: str, assigned_name: str, actor: dict) -> dict:
    """Set a school's owner and cascade that owner onto ALL its contacts and leads."""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one(
        {"school_id": school_id},
        {"$set": {"assigned_to": assigned_to, "assigned_name": assigned_name, "last_activity_date": now_iso}},
    )
    cres = await db.contacts.update_many(
        {"school_id": school_id, "is_deleted": {"$ne": True}},
        {"$set": {"assigned_to": assigned_to, "assigned_name": assigned_name}},
    )
    leads = await db.leads.find(
        {"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(10000)
    moved = 0
    for lead in leads:
        if lead.get("assigned_to") == assigned_to:
            continue
        history = lead.get("reassignments", []) or []
        history.append({
            "from_email": lead.get("assigned_to", ""), "from_name": lead.get("assigned_name", ""),
            "to_email": assigned_to, "to_name": assigned_name,
            "by_email": actor.get("email", ""), "by_name": actor.get("name", ""),
            "reason": "School reassigned", "at": now_iso,
        })
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": assigned_to, "assigned_name": assigned_name,
            "reassignments": history, "reassignment_count": (lead.get("reassignment_count", 0) or 0) + 1,
            "last_reassigned_at": now_iso, "last_reassigned_by": actor.get("email", ""),
            "last_reassignment_reason": "School reassigned",
            "updated_at": now_iso, "last_activity_date": now_iso,
        }})
        moved += 1
    return {"contacts": cres.modified_count, "leads": moved}


@router.get("/schools")
async def get_schools(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    elif team in ("accounts", "store"):
        # These teams don't work with the CRM; return empty
        return []
    else:  # sales — owned schools + created + schools holding their leads
        own_leads = await db.leads.find({"assigned_to": user["email"]}, {"_id": 0, "school_id": 1}).to_list(10000)
        linked_school_ids = [l.get("school_id") for l in own_leads if l.get("school_id")]
        query = {"$or": [
            {"assigned_to": user["email"]},
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
    # Owner: explicit, else the creating sales rep owns what they add.
    owner = body.get("assigned_to") or (user["email"] if get_team(user) == "sales" else "")
    owner_name = body.get("assigned_name") or (user["name"] if owner == user["email"] else "")
    school_doc = {
        "school_id": school_id,
        "school_name": body.get("school_name", ""),
        "assigned_to": owner,
        "assigned_name": owner_name,
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
        "gstin": body.get("gstin", ""),
        "social_profiles": body.get("social_profiles", {}),
        "linkedin_url": body.get("linkedin_url", ""),
        "instagram_url": body.get("instagram_url", ""),
        "anniversary": body.get("anniversary", ""),
        "last_activity_date": datetime.now(timezone.utc).isoformat(),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _pm = body.get("portal_login_methods")
    if isinstance(_pm, dict):
        school_doc["portal_login_methods"] = {k: bool(_pm.get(k, False)) for k in ("email_link", "magic_link", "google")}
    await db.schools.insert_one(school_doc)
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.put("/schools/{school_id}")
async def update_school(school_id: str, request: Request):
    user = await get_current_user(request)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    if not await _user_can_access_school(user, school):
        raise HTTPException(status_code=403, detail="Not authorized to edit this school")
    body = await request.json()
    allowed = {}
    for k in ("school_name", "school_type", "board", "group_id", "website", "email", "phone",
              "city", "state", "pincode", "address", "primary_contact_name", "designation",
              "alternate_contact", "school_strength", "number_of_branches",
              "annual_budget_range", "existing_vendor", "gstin", "social_profiles",
              "linkedin_url", "instagram_url", "anniversary"):
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


@router.post("/schools/{school_id}/assign")
async def assign_school(school_id: str, request: Request):
    """Assign a school to a Sales Executive and cascade ownership to its
    contacts + leads. Admin only."""
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    assigned_to = (body.get("assigned_to") or "").strip()
    assigned_name = (body.get("assigned_name") or "").strip()
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    counts = await _assign_school_cascade(school_id, assigned_to, assigned_name, user)
    await log_activity(user["email"], "assign_school", "school", school_id,
                       details=f"-> {assigned_name or 'Unassigned'} ({counts['leads']} leads, {counts['contacts']} contacts)")
    updated = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    return {"school": updated, "cascaded": counts}


@router.post("/schools/backfill-owners")
async def backfill_school_owners(request: Request):
    """One-time, idempotent: give each unowned school the Sales Exec who holds the
    most of its leads. Does not cascade (those leads are already assigned). Admin only."""
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}, "$or": [{"assigned_to": {"$exists": False}}, {"assigned_to": ""}, {"assigned_to": None}]},
        {"_id": 0, "school_id": 1},
    ).to_list(20000)
    assigned, skipped = 0, 0
    for sch in schools:
        sid = sch["school_id"]
        leads = await db.leads.find(
            {"school_id": sid, "is_deleted": {"$ne": True}}, {"_id": 0, "assigned_to": 1, "assigned_name": 1}
        ).to_list(10000)
        tally = {}
        for l in leads:
            a = (l.get("assigned_to") or "").strip()
            if a:
                tally.setdefault(a, {"n": 0, "name": l.get("assigned_name", "")})
                tally[a]["n"] += 1
        if not tally:
            skipped += 1
            continue
        best = max(tally.items(), key=lambda kv: kv[1]["n"])
        await db.schools.update_one(
            {"school_id": sid},
            {"$set": {"assigned_to": best[0], "assigned_name": best[1]["name"]}},
        )
        assigned += 1
    return {"assigned": assigned, "skipped": skipped, "scanned": len(schools)}


@router.post("/schools/bulk-assign")
async def bulk_assign_schools(request: Request):
    """Assign many schools to one Sales Executive at once, cascading each. Admin only."""
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    school_ids = body.get("school_ids") or []
    assigned_to = (body.get("assigned_to") or "").strip()
    assigned_name = (body.get("assigned_name") or "").strip()
    if not school_ids:
        raise HTTPException(status_code=400, detail="school_ids required")
    total = {"schools": 0, "contacts": 0, "leads": 0}
    for sid in school_ids:
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_id": 1})
        if not sch:
            continue
        c = await _assign_school_cascade(sid, assigned_to, assigned_name, user)
        total["schools"] += 1
        total["contacts"] += c["contacts"]
        total["leads"] += c["leads"]
    await log_activity(user["email"], "bulk_assign_schools", "school", ",".join(school_ids[:20]),
                       details=f"-> {assigned_name or 'Unassigned'} ({total['schools']} schools, {total['leads']} leads, {total['contacts']} contacts)")
    return {"cascaded": total}


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
    user = await get_current_user(request)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    if not await _user_can_access_school(user, school):
        raise HTTPException(status_code=403, detail="Not authorized to view this school")
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
        {"$or": [{"school_id": school_id}, {"school_name": school_name}]},
        {"_id": 0, "quotation_id": 1, "quotation_number": 1, "status": 1, "quotation_status": 1,
         "grand_total": 1, "currency_symbol": 1, "created_at": 1, "created_by_name": 1, "items": 1}
    ).sort("created_at", -1).to_list(None)

    # Fetch from visit_plans (admin-scheduled, have school_id)
    vp_list = await db.visit_plans.find({"school_id": school_id}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    # Also fetch self-created field_visits by school_name match (reps who didn't have a plan)
    fv_list = await db.field_visits.find({"$or": [{"school_id": school_id}, {"school_name": school_name}]}, {"_id": 0}).sort("visit_date", -1).to_list(None)
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

    # Sales Orders (SO) for this school — by FK, its leads, or its quotations
    quote_ids = [q.get("quotation_id") for q in quotations if q.get("quotation_id")]
    order_or = [{"school_id": school_id}]
    if lead_ids:
        order_or.append({"lead_id": {"$in": lead_ids}})
    if quote_ids:
        order_or.append({"quotation_id": {"$in": quote_ids}})
    orders = await db.orders.find({"$or": order_or}, {"_id": 0}).sort("created_at", -1).to_list(None)

    # Communications timeline — WhatsApp / Email / Drip / Greetings reaching this
    # school's contacts + leads (aggregated via existing contact_id / lead_id / phone links).
    contact_ids = [c.get("contact_id") for c in contacts_list if c.get("contact_id")]
    phones = [c.get("phone") for c in contacts_list if c.get("phone")]
    communications = []
    if contact_ids:
        async for m in db.whatsapp_scheduled.find(
            {"contact_id": {"$in": contact_ids}},
            {"_id": 0, "campaign_name": 1, "status": 1, "sent_at": 1, "scheduled_at": 1}
        ).sort("scheduled_at", -1).limit(200):
            communications.append({"channel": "whatsapp", "label": m.get("campaign_name") or "WhatsApp message",
                                   "status": m.get("status", ""), "at": m.get("sent_at") or m.get("scheduled_at")})
        async for m in db.email_scheduled.find(
            {"contact_id": {"$in": contact_ids}},
            {"_id": 0, "subject": 1, "status": 1, "sent_at": 1, "queued_at": 1}
        ).sort("queued_at", -1).limit(200):
            communications.append({"channel": "email", "label": m.get("subject") or "Email",
                                   "status": m.get("status", ""), "at": m.get("sent_at") or m.get("queued_at")})
    if lead_ids:
        enrolls = await db.drip_enrollments.find(
            {"lead_id": {"$in": lead_ids}},
            {"_id": 0, "sequence_id": 1, "status": 1, "enrolled_at": 1, "current_step": 1}
        ).sort("enrolled_at", -1).limit(100).to_list(100)
        seq_names = {}
        seq_ids = list({e.get("sequence_id") for e in enrolls if e.get("sequence_id")})
        if seq_ids:
            async for sq in db.drip_sequences.find({"sequence_id": {"$in": seq_ids}}, {"_id": 0, "sequence_id": 1, "name": 1}):
                seq_names[sq["sequence_id"]] = sq.get("name")
        for e in enrolls:
            communications.append({"channel": "drip", "label": seq_names.get(e.get("sequence_id")) or "Drip sequence",
                                   "status": e.get("status", ""), "at": e.get("enrolled_at"),
                                   "detail": f"Step {(e.get('current_step', 0) or 0) + 1}"})
    g_or = []
    if contact_ids:
        g_or.append({"contact_id": {"$in": contact_ids}})
    if phones:
        g_or.append({"phone": {"$in": phones}})
    if g_or:
        async for g in db.greeting_logs.find(
            {"$or": g_or}, {"_id": 0, "greeting_type": 1, "status": 1, "sent_at": 1}
        ).sort("sent_at", -1).limit(100):
            communications.append({"channel": "greeting", "label": g.get("greeting_type") or "Greeting",
                                   "status": g.get("status", ""), "at": g.get("sent_at")})
    communications.sort(key=lambda x: x.get("at") or "", reverse=True)
    communications = communications[:200]

    # Invoices — by school_id (primary) or by this school's orders/quotations
    inv_or = [{"school_id": school_id}]
    order_ids = [o.get("order_id") for o in orders if o.get("order_id")]
    if order_ids:
        inv_or.append({"order_id": {"$in": order_ids}})
    if quote_ids:
        inv_or.append({"quotation_id": {"$in": quote_ids}})
    invoices = await db.invoices.find({"$or": inv_or}, {"_id": 0, "raw": 0}).sort("invoice_date", -1).to_list(None)

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
    total_revenue_ordered = sum(o.get("grand_total", 0) or 0 for o in orders)
    total_paid = sum(o.get("payment_received", 0) or 0 for o in orders)
    total_invoiced = sum(i.get("total_amount", 0) or 0 for i in invoices)
    total_outstanding = max(0, round(total_invoiced - total_paid, 2))

    return {
        "school": school,
        "leads": leads,
        "contacts": contacts_list,
        "quotations": quotations,
        "orders": orders,
        "visits": visits,
        "call_notes": call_notes,
        "meetings": meetings,
        "dispatches": dispatches,
        "communications": communications,
        "invoices": invoices,
        "metrics": {
            "total_leads": len(leads),
            "active_leads": active_leads_count,
            "total_contacts": len(contacts_list),
            "total_visits": len(visits),
            "total_calls": len(call_notes),
            "total_quotations": len(quotations),
            "total_revenue_quoted": total_revenue_quoted,
            "total_orders": len(orders),
            "total_revenue_ordered": total_revenue_ordered,
            "total_paid": total_paid,
            "total_invoices": len(invoices),
            "total_invoiced": total_invoiced,
            "total_outstanding": total_outstanding,
            "total_communications": len(communications),
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
    else:  # sales — own + assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        query = {"$or": [
            {"created_by": user["email"]},
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"contact_id": "__none__"},
        ]}
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
    # Owner default: explicit, else the creating sales rep.
    _default_owner = (body.get("assigned_to") or "").strip() or (user["email"] if get_team(user) == "sales" else "")
    _default_owner_name = (body.get("assigned_name") or "").strip() or (user["name"] if _default_owner == user["email"] else "")

    # Resolve school_id → company (FK wins over string if both supplied)
    school_id = body.get("school_id") or None
    company = body.get("company", "")
    if school_id:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
        if sch:
            company = sch["school_name"]
        else:
            school_id = None  # invalid FK — ignore it

    # Auto-link: if company name matches a school, resolve school_id
    if not school_id and company:
        found_sch = await db.schools.find_one(
            {"school_name": {"$regex": f"^{re.escape(company)}$", "$options": "i"}},
            {"_id": 0, "school_id": 1}
        )
        if found_sch:
            school_id = found_sch["school_id"]
        elif body.get("create_school_if_missing"):
            # Auto-create a minimal school record so the contact is properly linked
            new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
            await db.schools.insert_one({
                "school_id": new_sch_id,
                "school_name": company,
                "school_type": "CBSE",
                "assigned_to": _default_owner,
                "assigned_name": _default_owner_name,
                "phone": body.get("phone", ""),
                "email": body.get("email", ""),
                "city": "", "state": "", "pincode": "", "address": "",
                "primary_contact_name": body.get("name", ""),
                "designation": body.get("designation", ""),
                "school_strength": 0, "number_of_branches": 1,
                "annual_budget_range": "", "existing_vendor": "",
                "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                "last_activity_date": now_iso,
                "created_by": user["email"],
                "created_at": now_iso,
            })
            school_id = new_sch_id

    # Owner: explicit > the linked school's owner > creating-rep default.
    c_assigned_to = (body.get("assigned_to") or "").strip()
    c_assigned_name = (body.get("assigned_name") or "").strip()
    if not c_assigned_to and school_id:
        _s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _s and _s.get("assigned_to"):
            c_assigned_to, c_assigned_name = _s["assigned_to"], _s.get("assigned_name", "")
    if not c_assigned_to:
        c_assigned_to, c_assigned_name = _default_owner, _default_owner_name

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
        "assigned_to": c_assigned_to,
        "assigned_name": c_assigned_name,
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
    user = await get_current_user(request)
    existing_contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not existing_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not await _user_can_mutate_contact(user, existing_contact):
        raise HTTPException(status_code=403, detail="Not authorized to edit this contact")
    body = await request.json()
    allowed = {}
    for k in ("name", "phone", "email", "designation", "contact_role_id", "source", "source_id", "notes", "status", "birthday", "assigned_to"):
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
        new_company = body["company"]
        allowed["company"] = new_company
        # Auto-link: if the new company name matches a school, set school_id
        if new_company:
            found_sch = await db.schools.find_one(
                {"school_name": {"$regex": f"^{re.escape(new_company)}$", "$options": "i"}},
                {"_id": 0, "school_id": 1}
            )
            if found_sch:
                allowed["school_id"] = found_sch["school_id"]
            elif body.get("create_school_if_missing") and new_company:
                now_iso = datetime.now(timezone.utc).isoformat()
                existing_con = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "name": 1, "phone": 1, "designation": 1})
                new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
                await db.schools.insert_one({
                    "school_id": new_sch_id,
                    "school_name": new_company,
                    "school_type": "CBSE",
                    "phone": existing_con.get("phone", "") if existing_con else "",
                    "email": body.get("email", ""),
                    "city": "", "state": "", "pincode": "", "address": "",
                    "primary_contact_name": existing_con.get("name", "") if existing_con else "",
                    "designation": existing_con.get("designation", "") if existing_con else "",
                    "school_strength": 0, "number_of_branches": 1,
                    "annual_budget_range": "", "existing_vendor": "",
                    "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                    "last_activity_date": now_iso, "created_by": "auto", "created_at": now_iso,
                })
                allowed["school_id"] = new_sch_id

    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": allowed})
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized to delete this contact")
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
    # Null out the back-reference on any lead that referenced this contact
    await db.leads.update_many(
        {"converted_from_contact": contact_id},
        {"$unset": {"converted_from_contact": ""}}
    )
    # Null out referral references
    await db.leads.update_many(
        {"referred_by_contact_id": contact_id},
        {"$unset": {"referred_by_contact_id": ""}}
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

    # Owner default for the convert flow: explicit > contact owner > creating sales rep.
    _cv_owner = (body.get("assigned_to") or "").strip() or (contact.get("assigned_to") or "").strip() or (user["email"] if get_team(user) == "sales" else "")
    _cv_owner_name = (body.get("assigned_name") or "").strip() or (contact.get("assigned_name") or "").strip() or (user["name"] if _cv_owner == user["email"] else "")

    # Inline school creation
    school_id = body.get("school_id", "")
    company_name = contact.get("company", "")
    new_school_data = body.get("new_school")
    if new_school_data and new_school_data.get("school_name"):
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        company_name = new_school_data.get("school_name", "")
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": company_name,
            "assigned_to": _cv_owner,
            "assigned_name": _cv_owner_name,
            "school_type": new_school_data.get("school_type", "CBSE"),
            "phone": new_school_data.get("phone", ""),
            "email": new_school_data.get("email", ""),
            "city": new_school_data.get("city", ""),
            "state": new_school_data.get("state", ""),
            "pincode": new_school_data.get("pincode", ""),
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
    # Assignee: explicit > the linked school's owner > convert-flow default.
    _school_owner, _school_owner_name = "", ""
    if school_id:
        _ls = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _ls and _ls.get("assigned_to"):
            _school_owner, _school_owner_name = _ls["assigned_to"], _ls.get("assigned_name", "")
    _eff_assigned_to = (body.get("assigned_to") or "").strip() or _school_owner or _cv_owner
    _eff_assigned_name = (body.get("assigned_name") or "").strip() or _school_owner_name or _cv_owner_name
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
        "assigned_to": _eff_assigned_to,
        "assigned_name": _eff_assigned_name,
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
    intro = (body.get("intro_message") or "").strip()
    if intro:
        await _send_intro_wa(lead_doc.get("contact_phone", ""), intro)
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/contacts/import")
async def import_contacts_csv(
    file: UploadFile = File(...),
    tag_ids: Optional[str] = Form(None),
    global_notes: Optional[str] = Form(None),
    request: Request = None,
):
    if request:
        user = await get_current_user(request)
    tag_id_list = [t.strip() for t in (tag_ids or "").split(",") if t.strip()]
    extra_note = (global_notes or "").strip()
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
            csv_notes = row.get("notes", "").strip()
            notes_combined = f"{csv_notes}\n{extra_note}".strip() if csv_notes and extra_note else (extra_note or csv_notes)
            csv_company = (row.get("school", "") or row.get("company", "")).strip()
            csv_now = datetime.now(timezone.utc).isoformat()
            # Auto-link company name → school_id; auto-create school if missing
            csv_school_id = None
            if csv_company:
                found_sch = await db.schools.find_one(
                    {"school_name": {"$regex": f"^{re.escape(csv_company)}$", "$options": "i"}},
                    {"_id": 0, "school_id": 1}
                )
                if found_sch:
                    csv_school_id = found_sch["school_id"]
                else:
                    new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
                    await db.schools.insert_one({
                        "school_id": new_sch_id, "school_name": csv_company,
                        "school_type": "CBSE",
                        "phone": phone, "email": row.get("email", "").strip(),
                        "city": "", "state": "", "pincode": "", "address": "",
                        "primary_contact_name": name,
                        "designation": row.get("designation", "").strip(),
                        "school_strength": 0, "number_of_branches": 1,
                        "annual_budget_range": "", "existing_vendor": "",
                        "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                        "last_activity_date": csv_now, "created_by": "import", "created_at": csv_now,
                    })
                    csv_school_id = new_sch_id
            csv_assigned = row.get("assigned_to", "").strip()
            await db.contacts.insert_one({
                "contact_id": contact_id,
                "name": name,
                "phone": phone,
                "email": row.get("email", "").strip(),
                "company": csv_company,
                "school_id": csv_school_id,
                "designation": row.get("designation", "").strip(),
                "source": row.get("source", "").strip(),
                "notes": notes_combined,
                "birthday": row.get("birthday", "").strip(),
                "assigned_to": csv_assigned,
                "tag_ids": tag_id_list,
                "status": "active",
                "converted_to_lead": False,
                "lead_id": None,
                "created_by": user["email"] if request else "import",
                "created_at": csv_now,
                "last_activity_date": csv_now,
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
    else:  # sales — assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        query = {"$or": [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"},
        ]}
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    school_cache = {}
    now = datetime.now(timezone.utc)
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)

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
        lead["deal_value"] = resolve_lead_value(lead, quote_map)
        lead["probability"] = stage_probability(lead.get("stage", ""), settings)
        lead["weighted_value"] = round(lead["deal_value"] * lead["probability"] / 100, 2)
        lead["linked_contact_name"] = linked_map.get(lead.get("converted_from_contact"))
    return leads


@router.get("/leads/search")
async def search_leads(request: Request, q: str = "", limit: int = 8):
    """Typeahead lead search, scoped like GET /leads. Placed before /leads/{lead_id}
    routes so it isn't shadowed."""
    user = await get_current_user(request)
    team = get_team(user)
    q = (q or "").strip()
    if len(q) < 2:
        return {"leads": []}

    if team == "admin":
        scope = {}
    elif team in ("accounts", "store"):
        return {"leads": []}
    else:  # sales — assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        scope = {"$or": [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"},
        ]}

    rx = {"$regex": re.escape(q), "$options": "i"}
    text = {"$or": [
        {"company_name": rx},
        {"contact_name": rx},
        {"contact_phone": rx},
        {"school_name": rx},
    ]}
    query = {"$and": [scope, text]} if scope else text

    try:
        lim = max(1, min(25, int(limit)))
    except (TypeError, ValueError):
        lim = 8

    rows = await db.leads.find(
        query,
        {"_id": 0, "lead_id": 1, "company_name": 1, "contact_name": 1, "contact_phone": 1,
         "contact_email": 1, "school_id": 1, "school_name": 1, "stage": 1},
    ).sort("created_at", -1).limit(lim).to_list(lim)

    for r in rows:
        if not r.get("company_name"):
            r["company_name"] = r.get("school_name", "")
    return {"leads": rows}


@router.post("/leads")
async def create_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    # Owner for an inline new school: explicit, else the creating sales rep.
    _ns_owner = (body.get("assigned_to") or "").strip() or (user["email"] if get_team(user) == "sales" else "")
    _ns_owner_name = (body.get("assigned_name") or "").strip() or (user["name"] if _ns_owner == user["email"] else "")

    school_id = body.get("school_id")
    # Validate existing school_id refers to a real, non-deleted school
    if school_id and not body.get("new_school"):
        sch_exists = await db.schools.find_one(
            {"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1}
        )
        if not sch_exists:
            raise HTTPException(status_code=404, detail="School not found or has been deleted")
    if not school_id and body.get("new_school"):
        ns = body["new_school"]
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": ns.get("school_name", ""),
            "school_type": ns.get("school_type", "CBSE"),
            "assigned_to": _ns_owner,
            "assigned_name": _ns_owner_name,
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
    # Assignee: explicit > the linked school's owner > creator.
    _school_owner, _school_owner_name = "", ""
    if school_id:
        _ls = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _ls and _ls.get("assigned_to"):
            _school_owner, _school_owner_name = _ls["assigned_to"], _ls.get("assigned_name", "")
    _body_assigned = (body.get("assigned_to") or "").strip()
    _eff_assigned_to = _body_assigned or _school_owner or user["email"]
    _eff_assigned_name = body.get("assigned_name", "") if _body_assigned else (_school_owner_name if _school_owner else user["name"])
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
        "assigned_to": _eff_assigned_to,
        "assigned_name": _eff_assigned_name,
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
        "expected_value": float(body.get("expected_value", 0) or 0),
        "lost_reason": body.get("lost_reason", ""),
        "lost_reason_note": body.get("lost_reason_note", ""),
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
    if not await _user_can_mutate_lead(user, existing):
        raise HTTPException(status_code=403, detail="Not authorized to edit this lead")
    allowed = {}
    for k in ("school_id", "company_name", "contact_name", "designation", "contact_role_id",
              "contact_phone", "contact_email", "source", "source_id",
              "lead_type", "interested_product", "stage", "priority",
              "next_followup_date", "assigned_to", "assigned_name", "notes",
              "assignment_type", "likely_closure_date",
              "expected_value", "lost_reason", "lost_reason_note",
              "demo_format", "demo_date", "demo_time", "demo_link", "demo_visit_plan_id",
              "referred_by_contact_id", "referral_reward_status"):
        if k in body:
            allowed[k] = body[k]
    if "expected_value" in allowed:
        allowed["expected_value"] = float(allowed["expected_value"] or 0)
    if "tags" in body:
        allowed["tags"] = await _resolve_tags(body["tags"], user["email"])
    now_iso = datetime.now(timezone.utc).isoformat()
    allowed["updated_at"] = now_iso
    allowed["last_activity_date"] = now_iso

    if existing.get("is_locked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Lead is locked after order conversion. Admin unlock required.")

    if body.get("stage") == "lost" and existing.get("stage") != "lost":
        reason = (body.get("lost_reason") or existing.get("lost_reason") or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="lost_reason is required when marking a lead Lost")

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


@router.get("/leads/forecast")
async def leads_forecast(request: Request):
    """Weighted pipeline forecast over OPEN stages, RBAC-scoped, per-stage + per-rep."""
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return {"total_value": 0, "total_weighted": 0, "by_stage": {}, "by_rep": {}}
    query = {} if team == "admin" else {"$or": await _sales_lead_scope(user["email"])}
    query["stage"] = {"$in": OPEN_STAGES}
    leads = await db.leads.find(query, {"_id": 0}).to_list(10000)
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)

    by_stage = {s: {"count": 0, "value": 0.0, "weighted": 0.0} for s in OPEN_STAGES}
    by_rep = {}
    total_value = total_weighted = 0.0
    for lead in leads:
        stage = lead.get("stage", "")
        if stage not in by_stage:
            continue
        value = resolve_lead_value(lead, quote_map)
        weighted = round(value * stage_probability(stage, settings) / 100, 2)
        by_stage[stage]["count"] += 1
        by_stage[stage]["value"] = round(by_stage[stage]["value"] + value, 2)
        by_stage[stage]["weighted"] = round(by_stage[stage]["weighted"] + weighted, 2)
        rep = lead.get("assigned_name") or lead.get("assigned_to") or "Unassigned"
        rr = by_rep.setdefault(rep, {"count": 0, "value": 0.0, "weighted": 0.0})
        rr["count"] += 1
        rr["value"] = round(rr["value"] + value, 2)
        rr["weighted"] = round(rr["weighted"] + weighted, 2)
        total_value += value
        total_weighted += weighted
    return {
        "total_value": round(total_value, 2),
        "total_weighted": round(total_weighted, 2),
        "by_stage": by_stage,
        "by_rep": by_rep,
    }


@router.get("/leads/funnel")
async def leads_funnel(request: Request,
                       start: Optional[str] = None, end: Optional[str] = None,
                       rep: Optional[str] = None, source: Optional[str] = None):
    """Stage-to-stage conversion %, avg days/stage, win/loss + lost-reason breakdown."""
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return {"stages": [], "won": {"count": 0, "value": 0}, "lost": {"count": 0}, "lost_reasons": {}}
    query = {} if team == "admin" else {"$or": await _sales_lead_scope(user["email"])}
    if rep and team == "admin":
        query["assigned_to"] = rep
    if source:
        query["source"] = source
    if start or end:
        cq = {}
        if start:
            cq["$gte"] = start
        if end:
            cq["$lte"] = end + "T23:59:59"
        query["created_at"] = cq
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)

    reached = {s: 0 for s in FUNNEL_ORDER}
    for lead in leads:
        top = _max_stage_reached(lead)
        for s in FUNNEL_ORDER:
            if top >= FUNNEL_RANK[s]:
                reached[s] += 1

    stages = []
    prev = None
    for s in FUNNEL_ORDER:
        cnt = reached[s]
        adv = round(cnt / prev * 100, 1) if prev else 100.0
        stages.append({"stage": s, "count": cnt, "advanced_pct": adv,
                       "avg_days": _avg_days_in_stage(leads, s)})
        prev = cnt if cnt else prev

    quote_map = await _build_quote_map(leads)
    won = [l for l in leads if l.get("stage") == "won"]
    won_value = round(sum(resolve_lead_value(l, quote_map) for l in won), 2)
    lost = [l for l in leads if l.get("stage") == "lost"]
    lost_reasons = {}
    for l in lost:
        key = l.get("lost_reason") or "Unspecified"
        lost_reasons[key] = lost_reasons.get(key, 0) + 1

    return {
        "stages": stages,
        "won": {"count": len(won), "value": won_value},
        "lost": {"count": len(lost)},
        "lost_reasons": lost_reasons,
    }


@router.get("/leads/needs-attention")
async def leads_needs_attention(request: Request):
    """Open leads flagged overdue / stuck / no-next-action, RBAC-scoped, sorted by value."""
    user = await get_current_user(request)
    team = get_team(user)
    if team in ("accounts", "store"):
        return []
    query = {"stage": {"$in": OPEN_STAGES}}
    if team != "admin":
        query["$or"] = await _sales_lead_scope(user["email"])
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)
    lead_ids = [l["lead_id"] for l in leads]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    settings = await get_crm_settings()

    upcoming = set()
    async for fu in db.followups.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending",
         "followup_date": {"$gte": today}}, {"_id": 0, "lead_id": 1}):
        upcoming.add(fu["lead_id"])
    open_tasks = set()
    async for t in db.tasks.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending"}, {"_id": 0, "lead_id": 1}):
        open_tasks.add(t["lead_id"])

    quote_map = await _build_quote_map(leads)
    out = []
    for lead in leads:
        reasons = compute_attention(
            lead, now, settings,
            lead["lead_id"] in upcoming, lead["lead_id"] in open_tasks)
        if reasons:
            out.append({
                "lead_id": lead["lead_id"],
                "company_name": lead.get("company_name", ""),
                "contact_name": lead.get("contact_name", ""),
                "stage": lead.get("stage", ""),
                "assigned_to": lead.get("assigned_to", ""),
                "assigned_name": lead.get("assigned_name", ""),
                "deal_value": resolve_lead_value(lead, quote_map),
                "reasons": reasons,
            })
    out.sort(key=lambda x: x["deal_value"], reverse=True)
    return out


@router.post("/leads/{lead_id}/schedule-demo")
async def schedule_demo(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fmt = body.get("format")
    if fmt not in ("physical", "online"):
        raise HTTPException(status_code=400, detail="format must be 'physical' or 'online'")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    demo_date = body.get("demo_date", "")
    demo_time = body.get("demo_time", "")
    update = {
        "stage": "demo", "demo_format": fmt,
        "demo_date": demo_date, "demo_time": demo_time,
        "updated_at": now_iso, "last_activity_date": now_iso,
    }

    if fmt == "physical":
        plan_id = f"vp_{uuid.uuid4().hex[:12]}"
        await db.visit_plans.insert_one({
            "plan_id": plan_id, "lead_id": lead_id,
            "lead_name": lead.get("contact_name", ""),
            "school_name": lead.get("company_name", ""),
            "school_id": lead.get("school_id", ""),
            "contact_person": lead.get("contact_name", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "assigned_to": body.get("assigned_to") or lead.get("assigned_to", ""),
            "assigned_name": lead.get("assigned_name", ""),
            "visit_date": demo_date, "visit_time": demo_time,
            "purpose": body.get("purpose") or "Demo / Workshop",
            "planned_address": body.get("address", ""),
            "status": "planned",
            "created_by": user["email"], "created_at": now_iso,
        })
        update["demo_visit_plan_id"] = plan_id
        await log_activity(user["email"], "schedule_demo_physical", "lead", lead_id,
                           details=f"Physical workshop {demo_date} {demo_time}")
    else:  # online
        link = body.get("demo_link", "")
        update["demo_link"] = link
        contact_name = lead.get("contact_name", "Sir/Madam")
        msg = (f"Dear {contact_name}, your SmartShape online workshop is scheduled for "
               f"{demo_date} {demo_time}.\nJoin here: {link}")
        sent = await _send_demo_wa(lead.get("contact_phone", ""), msg)
        await log_activity(user["email"], "schedule_demo_online", "lead", lead_id,
                           details=f"Online workshop {demo_date} {demo_time} | WA sent={sent}")

    if lead.get("stage") != "demo":
        hist = lead.get("pipeline_history", []) or []
        hist.append({"from_stage": lead.get("stage"), "to_stage": "demo",
                     "by_email": user["email"], "by_name": user["name"],
                     "at": now_iso, "note": f"Demo scheduled ({fmt})"})
        update["pipeline_history"] = hist

    await db.leads.update_one({"lead_id": lead_id}, {"$set": update})
    if lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


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
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reassign leads")
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
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reassign leads")
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
    user = await get_current_user(request)
    lead = await db.leads.find_one(
        {"lead_id": lead_id},
        {"_id": 0, "converted_from_contact": 1, "order_id": 1, "assigned_to": 1, "school_id": 1},
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await _user_can_mutate_lead(user, lead):
        raise HTTPException(status_code=403, detail="Not authorized to delete this lead")

    # Block deletion if a live order exists for this lead
    if lead.get("order_id"):
        order = await db.orders.find_one({"order_id": lead["order_id"]}, {"_id": 0, "order_id": 1})
        if order:
            raise HTTPException(status_code=409, detail="Cannot delete lead: an order exists. Cancel or delete the order first.")

    # Cascade: hard-delete all child CRM records
    await asyncio.gather(
        db.followups.delete_many({"lead_id": lead_id}),
        db.call_notes.delete_many({"lead_id": lead_id}),
        db.tasks.delete_many({"lead_id": lead_id}),
        db.physical_dispatches.delete_many({"lead_id": lead_id}),
        db.drip_enrollments.delete_many({"lead_id": lead_id}),
        db.whatsapp_logs.update_many({"lead_id": lead_id}, {"$unset": {"lead_id": ""}}),
    )

    # Restore converted contact back to active if this lead was the conversion target
    if lead.get("converted_from_contact"):
        await db.contacts.update_one(
            {"contact_id": lead["converted_from_contact"]},
            {"$set": {"converted_to_lead": False, "lead_id": None,
                      "last_activity_date": datetime.now(timezone.utc).isoformat()}}
        )

    await db.leads.delete_one({"lead_id": lead_id})
    return {"message": "Lead and all related records deleted"}


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

    # Auto-link to delegation: create a dispatch-follow-up task for the assigned rep
    try:
        lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})
        if lead_doc and lead_doc.get("assigned_to"):
            del_emp = await db.del_employees.find_one(
                {"email": lead_doc["assigned_to"], "is_active": True}, {"_id": 0}
            )
            if del_emp:
                _tid = f"task_{uuid.uuid4().hex[:10]}"
                _num = f"DISP-{dispatch_id[-6:].upper()}"
                _iid = f"inst_{uuid.uuid4().hex[:10]}"
                _now = datetime.now(timezone.utc).isoformat()
                _due = doc.get("sent_date", _now[:10])
                await db.del_tasks.insert_one({
                    "task_id": _tid, "task_number": _num,
                    "title": f"Dispatch: {doc['material_type'].title()} → {lead_doc.get('company_name', lead_doc.get('contact_name',''))}",
                    "description": f"Courier: {doc.get('courier_name','')} · {doc.get('tracking_number','')}",
                    "task_type": "onetime", "frequency": "onetime", "target_date": _due,
                    "priority": "medium", "assignee_ids": [del_emp["emp_id"]],
                    "assignees": [del_emp], "delegator_id": None, "delegator_name": "",
                    "score": 0, "require_verification": False, "requires_image": False,
                    "linked_entity_id": dispatch_id, "linked_entity_type": "dispatch",
                    "status": "active", "is_active": True, "created_at": _now,
                })
                await db.del_task_instances.insert_one({
                    "instance_id": _iid, "task_id": _tid, "task_title": f"Dispatch: {doc['material_type'].title()}",
                    "task_number": _num, "emp_id": del_emp["emp_id"], "emp_name": del_emp["name"],
                    "department_id": del_emp.get("department_id",""), "department_name": del_emp.get("department_name",""),
                    "delegator_id": None, "delegator_name": "", "due_date": _due, "frequency": "onetime",
                    "priority": "medium", "score": 0, "require_verification": False, "requires_image": False,
                    "linked_entity_id": dispatch_id, "linked_entity_type": "dispatch",
                    "status": "pending", "completed_at": None, "verified_at": None, "verified_by": None,
                    "completion_note": "", "completion_image_url": None, "created_at": _now,
                })
    except Exception:
        pass  # never block dispatch creation

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
