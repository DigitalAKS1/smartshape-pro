from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
import uuid
import csv
import io

from database import db
from auth_utils import get_current_user

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


# ==================== SCHOOL MASTER ====================

@router.get("/schools")
async def get_schools(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        own_leads = await db.leads.find({"assigned_to": user["email"]}, {"_id": 0, "school_id": 1}).to_list(10000)
        linked_school_ids = [l.get("school_id") for l in own_leads if l.get("school_id")]
        query = {"$or": [
            {"created_by": user["email"]},
            {"school_id": {"$in": linked_school_ids}} if linked_school_ids else {"school_id": "__none__"},
        ]}
    else:
        query = {}
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
              "annual_budget_range", "existing_vendor", "social_profiles"):
        if k in body:
            allowed[k] = body[k]
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one({"school_id": school_id}, {"$set": allowed})
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.delete("/schools/{school_id}")
async def delete_school(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.schools.delete_one({"school_id": school_id})
    return {"message": "School deleted"}


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
    query = {}
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        query["created_by"] = user["email"]
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
    contact_doc = {
        "contact_id": contact_id,
        "name": body.get("name", ""),
        "phone": body.get("phone", ""),
        "email": body.get("email", ""),
        "company": body.get("company", ""),
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "notes": body.get("notes", ""),
        "status": "active",
        "converted_to_lead": False,
        "lead_id": None,
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
    for k in ("name", "phone", "email", "company", "designation", "contact_role_id", "source", "source_id", "notes", "status"):
        if k in body:
            allowed[k] = body[k]
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": allowed})
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    await get_current_user(request)
    result = await db.contacts.delete_one({"contact_id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}


@router.post("/contacts/{contact_id}/convert-to-lead")
async def convert_contact_to_lead(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.get("converted_to_lead"):
        raise HTTPException(status_code=400, detail="Contact already converted to a lead")

    body = await request.json()
    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    lead_doc = {
        "lead_id": lead_id,
        "school_id": body.get("school_id", ""),
        "company_name": contact.get("company", ""),
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
    if body.get("school_id"):
        await touch_last_activity("school", body["school_id"])
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
    query = {}
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        query["assigned_to"] = user["email"]
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    school_cache = {}
    now = datetime.now(timezone.utc)
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
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.leads.insert_one(lead_doc)
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
              "assignment_type", "likely_closure_date"):
        if k in body:
            allowed[k] = body[k]
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
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    elif user.get("role") != "admin":
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


# ==================== TASKS ====================

@router.get("/tasks")
async def get_tasks(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["$or"] = [{"assigned_to": user["email"]}, {"created_by": user["email"]}]
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
