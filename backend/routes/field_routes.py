from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import math
import uuid
import requests

from database import db
from auth_utils import get_current_user

router = APIRouter()


# ==================== HELPER FUNCTIONS ====================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def reverse_geocode(lat: float, lng: float) -> str:
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json"
        response = requests.get(url, headers={"User-Agent": "SmartShapePro/1.0"}, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get("display_name", f"{lat}, {lng}")
    except Exception:
        pass
    return f"{lat}, {lng}"


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


async def _visit_completion_hooks(lead_id: str | None, school_name: str, outcome: str, assigned_to: str, now_iso: str):
    """Advance lead stage and auto-create follow-up task after visit completion."""
    from datetime import timedelta as _td

    lead = None
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    elif school_name:
        lead = await db.leads.find_one(
            {"company_name": school_name, "stage": {"$nin": ["won", "lost"]}},
            {"_id": 0},
        )
    if not lead:
        return

    lead_id = lead["lead_id"]
    current_stage = lead.get("stage", "new")

    STAGE_ADVANCE = {"demo_booked": "demo", "already_purchased": "won"}
    FOLLOWUP_DAYS = {
        "interested": 3,
        "follow_up": 3,
        "callback_requested": 1,
        "demo_booked": 1,
        "not_interested": 7,
    }
    FOLLOWUP_NOTES = {
        "interested": "Prospect expressed interest during visit. Schedule a demo.",
        "follow_up": "Follow up as requested during school visit.",
        "callback_requested": "Callback requested during school visit.",
        "demo_booked": "Confirm demo details and prepare materials.",
        "not_interested": "Not interested now. Re-engage after a week.",
    }

    new_stage = STAGE_ADVANCE.get(outcome)
    if new_stage and new_stage != current_stage:
        history_entry = {
            "from_stage": current_stage,
            "to_stage": new_stage,
            "changed_at": now_iso,
            "changed_by": assigned_to,
            "changed_by_name": "Auto (Visit)",
        }
        await db.leads.update_one(
            {"lead_id": lead_id},
            {"$set": {"stage": new_stage, "last_activity_date": now_iso},
             "$push": {"pipeline_history": history_entry}},
        )

    days = FOLLOWUP_DAYS.get(outcome)
    if days:
        fu_date = (datetime.fromisoformat(now_iso[:10]) + _td(days=days)).strftime("%Y-%m-%d")
        fu_type = "demo" if outcome == "demo_booked" else "call"
        fid = f"fu_{uuid.uuid4().hex[:12]}"
        await db.followups.insert_one({
            "followup_id": fid,
            "lead_id": lead_id,
            "followup_date": fu_date,
            "followup_time": "10:00",
            "followup_type": fu_type,
            "notes": FOLLOWUP_NOTES.get(outcome, "Post-visit follow up."),
            "outcome": "",
            "status": "pending",
            "assigned_to": assigned_to,
            "created_by": assigned_to,
            "source": "visit_auto",
            "created_at": now_iso,
        })


# ==================== MODELS ====================

class AttendanceCheckIn(BaseModel):
    work_type: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class FieldVisitCreate(BaseModel):
    school_name: str
    contact_person: str
    contact_phone: str
    visit_date: str
    visit_time: str
    purpose: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class TravelExpenseCreate(BaseModel):
    expense_type: str = "travel"          # travel | food | other
    date: str
    category: Optional[str] = None        # cab/auto/bus/train/two_wheeler/four_wheeler | breakfast/lunch/dinner/tea_snacks
    # Travel fields
    from_location: Optional[str] = None
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_location: Optional[str] = None
    to_lat: Optional[float] = None
    to_lng: Optional[float] = None
    distance_km: Optional[float] = None
    transport_mode: Optional[str] = None
    from_visit_id: Optional[str] = None
    to_visit_id: Optional[str] = None
    # Common
    amount: Optional[float] = None        # manual amount for non-km-based
    description: Optional[str] = None     # for "other" type
    notes: Optional[str] = None
    receipt_base64: Optional[str] = None
    receipt_filename: Optional[str] = None


# ==================== ATTENDANCE ====================

@router.post("/sales/attendance/check-in")
async def check_in(check_in_data: AttendanceCheckIn, request: Request):
    user = await get_current_user(request)

    if check_in_data.work_type == "field" and (check_in_data.lat is None or check_in_data.lng is None):
        raise HTTPException(status_code=400, detail="GPS location required for field check-in. Please enable location access or choose WFH.")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"sales_person_email": user["email"], "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Already checked in today")

    address = reverse_geocode(check_in_data.lat, check_in_data.lng) if check_in_data.lat is not None and check_in_data.lng is not None else "Work From Home"

    # ── Geofence check ───────────────────────────────────────────────────────
    geofence_breach = False
    distance_from_office_m = None
    office_settings = await db.settings.find_one({"type": "field_settings"}, {"_id": 0})
    if (check_in_data.lat is not None and check_in_data.lng is not None
            and office_settings and office_settings.get("office_lat") and office_settings.get("office_lng")
            and check_in_data.work_type in ("office", "field")):
        off_lat = float(office_settings["office_lat"])
        off_lng = float(office_settings["office_lng"])
        radius_m = float(office_settings.get("office_radius_m", 300))
        dist_m = haversine_distance(check_in_data.lat, check_in_data.lng, off_lat, off_lng) * 1000
        distance_from_office_m = round(dist_m, 1)
        if dist_m > radius_m and check_in_data.work_type == "office":
            geofence_breach = True
            # Store alert in geofence_alerts collection
            await db.geofence_alerts.insert_one({
                "alert_id":          f"ga_{uuid.uuid4().hex[:12]}",
                "user_email":        user["email"],
                "user_name":         user["name"],
                "alert_type":        "office_checkin_outside_geofence",
                "claimed_work_type": check_in_data.work_type,
                "lat":               check_in_data.lat,
                "lng":               check_in_data.lng,
                "address":           address,
                "distance_from_office_m": distance_from_office_m,
                "office_radius_m":   radius_m,
                "triggered_at":      datetime.now(timezone.utc).isoformat(),
                "is_read":           False,
            })

    attendance_id = f"att_{uuid.uuid4().hex[:12]}"
    attendance_doc = {
        "attendance_id":          attendance_id,
        "sales_person_email":     user["email"],
        "sales_person_name":      user["name"],
        "date":                   today,
        "work_type":              check_in_data.work_type,
        "check_in_time":          datetime.now(timezone.utc).isoformat(),
        "check_in_lat":           check_in_data.lat,
        "check_in_lng":           check_in_data.lng,
        "check_in_address":       address,
        "check_out_time":         None,
        "check_out_lat":          None,
        "check_out_lng":          None,
        "check_out_address":      None,
        "geofence_breach":        geofence_breach,
        "distance_from_office_m": distance_from_office_m,
    }
    await db.attendance.insert_one(attendance_doc)
    result = await db.attendance.find_one({"attendance_id": attendance_id}, {"_id": 0})
    if geofence_breach:
        result["geofence_warning"] = f"You checked in as 'office' but are {distance_from_office_m}m from the office. This has been flagged."
    return result


@router.post("/sales/attendance/check-out")
async def check_out(lat: float, lng: float, request: Request):
    user = await get_current_user(request)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attendance = await db.attendance.find_one({"sales_person_email": user["email"], "date": today})
    if not attendance:
        raise HTTPException(status_code=400, detail="No check-in found for today")
    if attendance.get("check_out_time"):
        raise HTTPException(status_code=400, detail="Already checked out")

    address = reverse_geocode(lat, lng)

    await db.attendance.update_one(
        {"attendance_id": attendance["attendance_id"]},
        {"$set": {
            "check_out_time": datetime.now(timezone.utc).isoformat(),
            "check_out_lat": lat,
            "check_out_lng": lng,
            "check_out_address": address,
        }},
    )
    return {"message": "Checked out successfully"}


@router.get("/sales/attendance")
async def get_attendance(request: Request):
    user = await get_current_user(request)
    records = await db.attendance.find(
        {"sales_person_email": user["email"]}, {"_id": 0}
    ).sort("date", -1).limit(30).to_list(30)
    return records


@router.get("/sales/attendance/today")
async def get_today_attendance(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attendance = await db.attendance.find_one(
        {"sales_person_email": user["email"], "date": today}, {"_id": 0}
    )
    return attendance


# ==================== VISIT PLANS ====================

@router.get("/visit-plans")
async def get_visit_plans(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin" and "field_sales" not in user.get("assigned_modules", []):
        query["assigned_to"] = user["email"]
    plans = await db.visit_plans.find(query, {"_id": 0}).sort("visit_date", -1).to_list(5000)
    return plans


@router.post("/visit-plans")
async def create_visit_plan(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan_id = f"vp_{uuid.uuid4().hex[:12]}"
    plan_doc = {
        "plan_id": plan_id,
        "lead_id": body.get("lead_id", ""),
        "lead_name": body.get("lead_name", ""),
        "school_name": body.get("school_name", ""),
        "school_id": body.get("school_id", ""),
        "contact_person": body.get("contact_person", ""),
        "contact_phone": body.get("contact_phone", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "visit_date": body.get("visit_date", ""),
        "visit_time": body.get("visit_time", ""),
        "purpose": body.get("purpose", ""),
        "planned_address": body.get("planned_address", ""),
        "planned_lat": body.get("planned_lat"),
        "planned_lng": body.get("planned_lng"),
        "status": "planned",
        "check_in_time": None,
        "check_in_lat": None,
        "check_in_lng": None,
        "check_out_time": None,
        "visit_notes": "",
        "outcome": "",
        "photos": [],
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.visit_plans.insert_one(plan_doc)

    # Auto-create a delegation task for the assigned sales rep
    try:
        assigned_email = plan_doc.get("assigned_to", "")
        if assigned_email and plan_doc.get("visit_date"):
            del_emp = await db.del_employees.find_one(
                {"email": assigned_email, "is_active": True}, {"_id": 0}
            )
            if del_emp:
                from datetime import timezone as _tz
                task_id = f"task_{__import__('uuid').uuid4().hex[:10]}"
                task_number = f"VISIT-{plan_id[-6:].upper()}"
                inst_id = f"inst_{__import__('uuid').uuid4().hex[:10]}"
                _now = datetime.now(_tz.utc).isoformat()
                task_doc = {
                    "task_id": task_id, "task_number": task_number,
                    "title": f"Visit: {plan_doc.get('school_name', 'School')}",
                    "description": plan_doc.get("purpose", ""),
                    "task_type": "onetime", "frequency": "onetime",
                    "target_date": plan_doc["visit_date"],
                    "priority": "high", "assignee_ids": [del_emp["emp_id"]],
                    "assignees": [del_emp], "delegator_id": None,
                    "delegator_name": plan_doc.get("assigned_name", ""),
                    "score": 0, "require_verification": False,
                    "requires_image": False,
                    "linked_entity_id": plan_id,
                    "linked_entity_type": "visit_plan",
                    "status": "active", "is_active": True, "created_at": _now,
                }
                await db.del_tasks.insert_one(task_doc)
                await db.del_task_instances.insert_one({
                    "instance_id": inst_id, "task_id": task_id,
                    "task_title": task_doc["title"], "task_number": task_number,
                    "emp_id": del_emp["emp_id"], "emp_name": del_emp["name"],
                    "department_id": del_emp.get("department_id", ""),
                    "department_name": del_emp.get("department_name", ""),
                    "delegator_id": None, "delegator_name": "",
                    "due_date": plan_doc["visit_date"], "frequency": "onetime",
                    "priority": "high", "score": 0,
                    "require_verification": False, "requires_image": False,
                    "linked_entity_id": plan_id, "linked_entity_type": "visit_plan",
                    "status": "pending", "completed_at": None, "verified_at": None,
                    "verified_by": None, "completion_note": "", "completion_image_url": None,
                    "created_at": _now,
                })
    except Exception:
        pass  # never block visit plan creation if delegation fails

    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


@router.put("/visit-plans/{plan_id}")
async def update_visit_plan(plan_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("visit_date", "visit_time", "purpose", "status", "assigned_to", "assigned_name",
              "planned_address", "planned_lat", "planned_lng",
              "check_in_time", "check_in_lat", "check_in_lng", "check_out_time",
              "visit_notes", "outcome"):
        if k in body:
            allowed[k] = body[k]
    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": allowed})
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


@router.delete("/visit-plans/{plan_id}")
async def delete_visit_plan(plan_id: str, request: Request):
    await get_current_user(request)
    await db.visit_plans.delete_one({"plan_id": plan_id})
    return {"message": "Visit plan deleted"}


@router.post("/visit-plans/{plan_id}/check-in")
async def visit_check_in(plan_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    if plan.get("check_in_time"):
        raise HTTPException(status_code=400, detail="Already checked in")

    work_type = body.get("work_type", "field")
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "check_in_time": now_iso,
        "work_type": work_type,
        "status": "in_progress",
    }
    if work_type == "field":
        lat = body.get("lat")
        lng = body.get("lng")
        if lat is None or lng is None:
            raise HTTPException(status_code=400, detail="GPS lat/lng required for field visit")
        update["check_in_lat"] = float(lat)
        update["check_in_lng"] = float(lng)
        update["check_in_address"] = reverse_geocode(float(lat), float(lng))
    else:
        update["check_in_lat"] = None
        update["check_in_lng"] = None
        update["check_in_address"] = "Work From Home"

    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
    if plan.get("lead_id"):
        await db.leads.update_one({"lead_id": plan["lead_id"]},
                                  {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}})
    if plan.get("school_id"):
        await touch_last_activity("school", plan["school_id"])
    await log_activity(user["email"], "visit_check_in", "visit_plan", plan_id,
                       details=f"{work_type} check-in for {plan.get('school_name','')}")
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


@router.post("/visit-plans/{plan_id}/check-out")
async def visit_check_out(plan_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    if not plan.get("check_in_time"):
        raise HTTPException(status_code=400, detail="Not checked-in yet")
    if plan.get("check_out_time"):
        raise HTTPException(status_code=400, detail="Already checked out")
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "check_out_time": now_iso,
        "status": "completed",
        "visit_notes": body.get("visit_notes", plan.get("visit_notes", "")),
        "outcome": body.get("outcome", plan.get("outcome", "")),
    }
    if plan.get("work_type", "field") == "field":
        lat = body.get("lat")
        lng = body.get("lng")
        if lat is not None and lng is not None:
            update["check_out_lat"] = float(lat)
            update["check_out_lng"] = float(lng)
            update["check_out_address"] = reverse_geocode(float(lat), float(lng))
    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
    if plan.get("lead_id"):
        await db.leads.update_one({"lead_id": plan["lead_id"]},
                                  {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}})
    if plan.get("school_id"):
        await touch_last_activity("school", plan["school_id"])
    await log_activity(user["email"], "visit_check_out", "visit_plan", plan_id,
                       details=f"Outcome: {update['outcome']}")
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


@router.get("/visit-plans/{plan_id}/distance")
async def visit_distance(plan_id: str, lat: float, lng: float, request: Request):
    await get_current_user(request)
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    target_lat = plan.get("check_in_lat")
    target_lng = plan.get("check_in_lng")
    if target_lat is None or target_lng is None:
        return {"distance_m": None, "within_geofence": None, "message": "No reference GPS on plan"}
    dist_m = haversine_distance(lat, lng, target_lat, target_lng) * 1000
    return {"distance_m": round(dist_m, 1), "within_geofence": dist_m <= 200}


# ==================== FIELD VISITS (Sales Portal) ====================

def _normalize_plan(plan: dict) -> dict:
    """Map visit_plans document to the same shape as field_visits for the sales portal."""
    status = plan.get("status", "planned")
    if status == "in_progress":
        status = "checked_in"
    return {
        "visit_id":           plan["plan_id"],
        "plan_id":            plan["plan_id"],
        "sales_person_email": plan.get("assigned_to", ""),
        "sales_person_name":  plan.get("assigned_name", ""),
        "school_name":        plan.get("school_name", ""),
        "school_id":          plan.get("school_id", ""),
        "lead_id":            plan.get("lead_id", ""),
        "contact_person":     plan.get("contact_person") or plan.get("lead_name", ""),
        "contact_phone":      plan.get("contact_phone", ""),
        "visit_date":         plan.get("visit_date", ""),
        "visit_time":         plan.get("visit_time", ""),
        "status":             status,
        "purpose":            plan.get("purpose", ""),
        "planned_address":    plan.get("planned_address", ""),
        "lat":                plan.get("planned_lat"),
        "lng":                plan.get("planned_lng"),
        "check_in_time":      plan.get("check_in_time"),
        "check_out_time":     plan.get("check_out_time"),
        "notes":              plan.get("visit_notes", ""),
        "outcome":            plan.get("outcome", ""),
        "is_admin_assigned":  True,
        "assigned_by":        plan.get("created_by", ""),
    }


@router.post("/sales/visits")
async def create_visit(visit_input: FieldVisitCreate, request: Request):
    user = await get_current_user(request)
    visit_id = f"visit_{uuid.uuid4().hex[:12]}"
    address = None
    if visit_input.lat is not None and visit_input.lng is not None:
        address = reverse_geocode(visit_input.lat, visit_input.lng)
    visit_doc = {
        "visit_id":           visit_id,
        "sales_person_email": user["email"],
        "sales_person_name":  user["name"],
        "school_name":        visit_input.school_name,
        "contact_person":     visit_input.contact_person,
        "contact_phone":      visit_input.contact_phone,
        "visit_date":         visit_input.visit_date,
        "visit_time":         visit_input.visit_time,
        "status":             "planned",
        "purpose":            visit_input.purpose,
        "planned_lat":        visit_input.lat,
        "planned_lng":        visit_input.lng,
        "planned_address":    address,
        "lat":                visit_input.lat,
        "lng":                visit_input.lng,
        "check_in_time":      None,
        "check_out_time":     None,
        "notes":              None,
        "outcome":            None,
        "is_admin_assigned":  False,
    }
    await db.field_visits.insert_one(visit_doc)
    return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})


@router.get("/sales/visits")
async def get_visits(request: Request):
    user = await get_current_user(request)
    # Own self-created field visits
    own = await db.field_visits.find(
        {"sales_person_email": user["email"]}, {"_id": 0}
    ).sort("visit_date", -1).to_list(1000)
    # Ensure lat/lng populated from planned_lat/lng for legacy records
    for v in own:
        if v.get("lat") is None:
            v["lat"] = v.get("planned_lat")
        if v.get("lng") is None:
            v["lng"] = v.get("planned_lng")
        if v.get("check_in_time") is None:
            v["check_in_time"] = v.get("checked_in_at")
        if v.get("status") == "visited":
            v["status"] = "checked_in"
    # Admin-assigned visit plans
    plans = await db.visit_plans.find(
        {"assigned_to": user["email"]}, {"_id": 0}
    ).sort("visit_date", -1).to_list(1000)
    normalized = [_normalize_plan(p) for p in plans]
    # Merge — sort by visit_date desc, put today's first
    all_visits = own + normalized
    all_visits.sort(key=lambda v: (v.get("visit_date") or ""), reverse=True)
    return all_visits


@router.post("/sales/visits/{visit_id}/check-in")
async def check_in_visit(visit_id: str, lat: float, lng: float, request: Request):
    user = await get_current_user(request)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Try own field_visits first
    visit = await db.field_visits.find_one(
        {"visit_id": visit_id, "sales_person_email": user["email"]}
    )
    if visit:
        address = reverse_geocode(lat, lng) if lat is not None and lng is not None else None
        await db.field_visits.update_one(
            {"visit_id": visit_id},
            {"$set": {
                "status":        "checked_in",
                "lat":           lat,
                "lng":           lng,
                "check_in_time": now_iso,
                "planned_address": address or visit.get("planned_address"),
            }},
        )
        return {"message": "Checked in", "visit_id": visit_id}

    # Try admin-assigned visit plan
    plan = await db.visit_plans.find_one({"plan_id": visit_id, "assigned_to": user["email"]})
    if plan:
        if plan.get("check_in_time"):
            raise HTTPException(status_code=400, detail="Already checked in")
        update = {"check_in_time": now_iso, "status": "in_progress", "work_type": "field"}
        if lat is not None and lng is not None:
            update["check_in_lat"]     = float(lat)
            update["check_in_lng"]     = float(lng)
            update["check_in_address"] = reverse_geocode(float(lat), float(lng))
        await db.visit_plans.update_one({"plan_id": visit_id}, {"$set": update})
        if plan.get("lead_id"):
            await db.leads.update_one(
                {"lead_id": plan["lead_id"]},
                {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}},
            )
        if plan.get("school_id"):
            await touch_last_activity("school", plan["school_id"])
        await log_activity(user["email"], "visit_check_in", "visit_plan", visit_id,
                           details=f"Field check-in for {plan.get('school_name','')}")
        return {"message": "Checked in", "visit_id": visit_id}

    raise HTTPException(status_code=404, detail="Visit not found")


@router.put("/sales/visits/{visit_id}")
async def update_visit(visit_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Try own field_visits first
    visit = await db.field_visits.find_one(
        {"visit_id": visit_id, "sales_person_email": user["email"]}
    )
    if visit:
        allowed = ("status", "notes", "outcome", "check_out_time", "check_in_time",
                   "check_out_lat", "check_out_lng", "check_out_address")
        safe = {k: v for k, v in body.items() if k in allowed}
        if safe.get("status") == "completed" and not safe.get("check_out_time"):
            safe["check_out_time"] = now_iso
        # Reverse-geocode check-out coords if address not provided
        if safe.get("check_out_lat") and safe.get("check_out_lng") and not safe.get("check_out_address"):
            safe["check_out_address"] = reverse_geocode(safe["check_out_lat"], safe["check_out_lng"])
        await db.field_visits.update_one(
            {"visit_id": visit_id, "sales_person_email": user["email"]},
            {"$set": safe},
        )
        if safe.get("status") == "completed":
            outcome = safe.get("outcome", "")
            await _visit_completion_hooks(
                lead_id=None,
                school_name=visit.get("school_name", ""),
                outcome=outcome,
                assigned_to=user["email"],
                now_iso=now_iso,
            )
        return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})

    # Try admin-assigned visit plan
    plan = await db.visit_plans.find_one({"plan_id": visit_id, "assigned_to": user["email"]})
    if plan:
        safe = {}
        status = body.get("status")
        if status == "completed":
            safe["status"]         = "completed"
            safe["check_out_time"] = now_iso
            # Capture check-out GPS for visit_plans too
            if body.get("check_out_lat") and body.get("check_out_lng"):
                safe["check_out_lat"] = float(body["check_out_lat"])
                safe["check_out_lng"] = float(body["check_out_lng"])
                safe["check_out_address"] = body.get("check_out_address") or reverse_geocode(
                    safe["check_out_lat"], safe["check_out_lng"]
                )
        elif status == "checked_in":
            safe["status"] = "in_progress"
        if "notes" in body:
            safe["visit_notes"] = body["notes"]
        if "outcome" in body:
            safe["outcome"] = body["outcome"]
        if safe:
            await db.visit_plans.update_one({"plan_id": visit_id}, {"$set": safe})
        if status == "completed":
            if plan.get("lead_id"):
                await db.leads.update_one(
                    {"lead_id": plan["lead_id"]},
                    {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}},
                )
            if plan.get("school_id"):
                await touch_last_activity("school", plan["school_id"])
            await log_activity(user["email"], "visit_complete", "visit_plan", visit_id,
                               details=f"Completed visit at {plan.get('school_name','')}")
            outcome = body.get("outcome", "")
            await _visit_completion_hooks(
                lead_id=plan.get("lead_id"),
                school_name=plan.get("school_name", ""),
                outcome=outcome,
                assigned_to=user["email"],
                now_iso=now_iso,
            )
        return await db.visit_plans.find_one({"plan_id": visit_id}, {"_id": 0})

    raise HTTPException(status_code=404, detail="Visit not found")


@router.get("/leads/{lead_id}/visit-history")
async def lead_visit_history(lead_id: str, request: Request):
    """Return all visits for a lead from both visit_plans and field_visits."""
    await get_current_user(request)
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "company_name": 1, "school_name": 1})
    school_name = (lead or {}).get("company_name") or (lead or {}).get("school_name") or ""

    vp_list = await db.visit_plans.find({"lead_id": lead_id}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    fv_list = await db.field_visits.find({"school_name": school_name}, {"_id": 0}).sort("visit_date", -1).to_list(None) if school_name else []

    def _norm_vp(v):
        status = v.get("status", "planned")
        if status == "in_progress": status = "checked_in"
        return {
            "visit_id": v.get("plan_id"), "source": "visit_plan",
            "visit_date": v.get("visit_date"), "visit_time": v.get("visit_time"),
            "status": status, "purpose": v.get("purpose"), "outcome": v.get("outcome"),
            "notes": v.get("visit_notes"), "rep_name": v.get("assigned_name"),
            "check_in_time": v.get("check_in_time"), "check_out_time": v.get("check_out_time"),
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
            "check_out_time": v.get("check_out_time"),
        }

    all_visits = sorted(
        [_norm_vp(v) for v in vp_list] + [_norm_fv(v) for v in fv_list],
        key=lambda v: (v.get("visit_date") or ""), reverse=True
    )
    return all_visits


# ==================== TRAVEL EXPENSES ====================

@router.post("/sales/expenses")
async def create_expense(expense_input: TravelExpenseCreate, request: Request):
    user = await get_current_user(request)

    km_rates = {"two_wheeler": 5, "four_wheeler": 10}
    category = expense_input.category or expense_input.transport_mode or ""

    if expense_input.expense_type == "travel" and category in km_rates and expense_input.distance_km:
        rate_per_km = km_rates[category]
        amount = expense_input.distance_km * rate_per_km
    else:
        rate_per_km = None
        amount = expense_input.amount or 0

    expense_id = f"exp_{uuid.uuid4().hex[:12]}"
    month_year = expense_input.date[:7]

    expense_doc = {
        "expense_id": expense_id,
        "expense_type": expense_input.expense_type,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "date": expense_input.date,
        "month_year": month_year,
        "category": category,
        "from_location": expense_input.from_location,
        "from_lat": expense_input.from_lat,
        "from_lng": expense_input.from_lng,
        "to_location": expense_input.to_location,
        "to_lat": expense_input.to_lat,
        "to_lng": expense_input.to_lng,
        "distance_km": expense_input.distance_km or 0,
        "transport_mode": expense_input.transport_mode or category,
        "rate_per_km": rate_per_km,
        "amount": amount,
        "description": expense_input.description,
        "from_visit_id": expense_input.from_visit_id,
        "to_visit_id": expense_input.to_visit_id,
        "notes": expense_input.notes,
        "receipt_base64": expense_input.receipt_base64,
        "receipt_filename": expense_input.receipt_filename,
        "status": "pending",
    }
    await db.travel_expenses.insert_one(expense_doc)
    return await db.travel_expenses.find_one({"expense_id": expense_id}, {"_id": 0})


@router.get("/sales/expenses")
async def get_expenses(request: Request, month_year: Optional[str] = None):
    user = await get_current_user(request)
    query = {"sales_person_email": user["email"]}
    if month_year:
        query["month_year"] = month_year
    expenses = await db.travel_expenses.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return expenses


@router.post("/sales/expenses/submit-reimbursement")
async def submit_reimbursement(month_year: str, request: Request):
    user = await get_current_user(request)

    expenses = await db.travel_expenses.find({
        "sales_person_email": user["email"],
        "month_year": month_year,
        "status": "pending",
    }, {"_id": 0}).to_list(1000)

    total_km = sum(e["distance_km"] for e in expenses)
    total_amount = sum(e["amount"] for e in expenses)

    attendance_records = await db.attendance.find({
        "sales_person_email": user["email"],
        "date": {"$regex": f"^{month_year}"},
    }, {"_id": 0}).to_list(1000)

    total_working_days = len(attendance_records)
    field_days = len([a for a in attendance_records if a["work_type"] == "field"])

    visits = await db.field_visits.find({
        "sales_person_email": user["email"],
        "visit_date": {"$regex": f"^{month_year}"},
        "status": "visited",
    }, {"_id": 0}).to_list(1000)
    total_visits = len(visits)

    reimbursement_id = f"reimb_{uuid.uuid4().hex[:12]}"
    reimb_doc = {
        "reimbursement_id": reimbursement_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "month_year": month_year,
        "total_km": total_km,
        "total_amount": total_amount,
        "total_visits": total_visits,
        "total_working_days": total_working_days,
        "field_days": field_days,
        "wfh_days": total_working_days - field_days,
        "status": "submitted",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payroll_reimbursements.insert_one(reimb_doc)

    for expense in expenses:
        await db.travel_expenses.update_one(
            {"expense_id": expense["expense_id"]},
            {"$set": {"status": "submitted"}},
        )

    return await db.payroll_reimbursements.find_one({"reimbursement_id": reimbursement_id}, {"_id": 0})


# ==================== VISIT RESCHEDULE ====================

@router.post("/visit-plans/{plan_id}/reschedule")
async def reschedule_visit(plan_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    if plan.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Cannot reschedule a completed visit")

    new_date = body.get("new_date", "").strip()
    new_time = body.get("new_time", plan.get("visit_time", "")).strip()
    reason   = body.get("reason", "").strip()
    if not new_date:
        raise HTTPException(status_code=400, detail="new_date is required")

    history_entry = {
        "old_date":        plan.get("visit_date"),
        "old_time":        plan.get("visit_time"),
        "new_date":        new_date,
        "new_time":        new_time,
        "reason":          reason,
        "rescheduled_by":  user["email"],
        "rescheduled_at":  datetime.now(timezone.utc).isoformat(),
    }

    await db.visit_plans.update_one(
        {"plan_id": plan_id},
        {
            "$set": {
                "visit_date":       new_date,
                "visit_time":       new_time,
                "status":           "planned",
                "reschedule_reason": reason,
                "reschedule_count": (plan.get("reschedule_count") or 0) + 1,
            },
            "$push": {"reschedule_history": history_entry},
        },
    )
    await log_activity(user["email"], "visit_rescheduled", "visit_plan", plan_id,
                       details=f"Rescheduled from {plan.get('visit_date')} to {new_date}. Reason: {reason}")
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


# ==================== OFFICE LOCATION SETTINGS ====================

@router.get("/settings/office-location")
async def get_office_location(request: Request):
    await get_current_user(request)
    settings = await db.settings.find_one({"type": "field_settings"}, {"_id": 0})
    if not settings:
        return {"office_lat": None, "office_lng": None, "office_address": "", "office_radius_m": 300}
    return settings


@router.post("/settings/office-location")
async def save_office_location(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    await db.settings.update_one(
        {"type": "field_settings"},
        {"$set": {**body, "type": "field_settings", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Office location saved"}


# ==================== GEOFENCE ALERTS ====================

@router.get("/admin/geofence-alerts")
async def get_geofence_alerts(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin" and "field_sales" not in user.get("assigned_modules", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    alerts = await db.attendance.find(
        {"geofence_breach": True}, {"_id": 0}
    ).sort("check_in_time", -1).to_list(500)
    return alerts


@router.get("/admin/login-logs")
async def get_login_logs(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin" and "field_sales" not in user.get("assigned_modules", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.login_logs.find({}, {"_id": 0}).sort("login_time", -1).to_list(1000)
    return logs


# ==================== PUNCH CLOCK ====================

@router.post("/attendance/punch")
async def record_punch(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    punch_type = body.get("type")
    lat = body.get("lat")
    lng = body.get("lng")
    source = body.get("source", "manual")

    if punch_type not in ("in", "out"):
        raise HTTPException(400, "type must be 'in' or 'out'")

    now   = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    address = None
    if lat is not None and lng is not None:
        address = reverse_geocode(float(lat), float(lng))

    distance_m = None
    office = await db.settings.find_one({"type": "field_settings"}, {"_id": 0})
    if office and office.get("office_lat") and lat is not None:
        d_km = haversine_distance(float(lat), float(lng), float(office["office_lat"]), float(office["office_lng"]))
        distance_m = round(d_km * 1000, 1)

    doc = {
        "punch_id":               f"pch_{uuid.uuid4().hex[:12]}",
        "user_email":             user["email"],
        "user_name":              user["name"],
        "date":                   today,
        "type":                   punch_type,
        "timestamp":              now.isoformat(),
        "lat":                    lat,
        "lng":                    lng,
        "address":                address,
        "distance_from_office_m": distance_m,
        "source":                 source,
    }
    await db.punch_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/attendance/today-punches")
async def get_today_punches(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    punches = await db.punch_logs.find(
        {"user_email": user["email"], "date": today}, {"_id": 0}
    ).sort("timestamp", 1).to_list(100)
    return punches


@router.post("/attendance/geofence-exit")
async def geofence_exit(request: Request):
    """Called by the frontend when auto-logout due to leaving the geofence."""
    user = await get_current_user(request)
    body = await request.json()
    lat        = body.get("lat")
    lng        = body.get("lng")
    distance_m = body.get("distance_m")

    now   = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    address = None
    if lat is not None and lng is not None:
        address = reverse_geocode(float(lat), float(lng))

    office     = await db.settings.find_one({"type": "field_settings"}, {"_id": 0}) or {}
    radius_m   = float(office.get("office_radius_m", 300))

    # Auto punch-out
    punch_doc = {
        "punch_id":               f"pch_{uuid.uuid4().hex[:12]}",
        "user_email":             user["email"],
        "user_name":              user["name"],
        "date":                   today,
        "type":                   "out",
        "timestamp":              now.isoformat(),
        "lat":                    lat,
        "lng":                    lng,
        "address":                address,
        "distance_from_office_m": distance_m,
        "source":                 "geofence_auto_logout",
    }
    await db.punch_logs.insert_one(punch_doc)

    # Create geofence alert
    await db.geofence_alerts.insert_one({
        "alert_id":               f"ga_{uuid.uuid4().hex[:12]}",
        "user_email":             user["email"],
        "user_name":              user["name"],
        "alert_type":             "geofence_exit_auto_logout",
        "lat":                    lat,
        "lng":                    lng,
        "address":                address,
        "distance_from_office_m": distance_m,
        "office_radius_m":        radius_m,
        "triggered_at":           now.isoformat(),
        "is_read":                False,
    })

    # Notify admin + HR (best-effort email)
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        email_cfg = await db.settings.find_one({"type": "email"}, {"_id": 0})
        admins    = await db.users.find(
            {"role": {"$in": ["admin", "hr"]}, "is_active": True}, {"email": 1, "_id": 0}
        ).to_list(20)
        to_list = [a["email"] for a in admins if a.get("email")]

        if email_cfg and email_cfg.get("enabled") and email_cfg.get("sender_email") and to_list:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"⚠️ Geofence Exit Auto-Logout: {user['name']}"
            msg["From"]    = email_cfg["sender_email"]
            msg["To"]      = ", ".join(to_list)
            html = f"""
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
              <h2 style="color:#e94560;margin-top:0;">⚠️ Geofence Exit Alert</h2>
              <p><strong>{user['name']}</strong> ({user['email']}) left the office zone and was automatically logged out.</p>
              <table style="width:100%;border-collapse:collapse;margin-top:12px;">
                <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;border:1px solid #eee;">Time</td>
                    <td style="padding:8px;font-weight:bold;border:1px solid #eee;">{now.strftime('%d %b %Y %H:%M:%S UTC')}</td></tr>
                <tr><td style="padding:8px;color:#555;border:1px solid #eee;">Distance from Office</td>
                    <td style="padding:8px;font-weight:bold;color:#e94560;border:1px solid #eee;">{distance_m}m away (allowed radius: {radius_m}m)</td></tr>
                <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;border:1px solid #eee;">Location</td>
                    <td style="padding:8px;border:1px solid #eee;">{address or 'Unknown'}</td></tr>
              </table>
              <p style="color:#888;font-size:12px;margin-top:16px;">View full details → SmartShape Pro → Field Sales → Geo Alerts</p>
            </div>"""
            msg.attach(MIMEText(html, "html"))
            with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
                smtp.ehlo(); smtp.starttls()
                smtp.login(email_cfg["sender_email"], email_cfg.get("gmail_app_password", ""))
                smtp.sendmail(email_cfg["sender_email"], to_list, msg.as_string())
    except Exception:
        pass

    punch_doc.pop("_id", None)
    return {"message": "Geofence exit logged and notifications sent", "punch": punch_doc}


@router.post("/attendance/geofence-field-alert")
async def geofence_field_alert(request: Request):
    """
    Silent geofence alert for field sales reps — no punch-out, no logout.
    If they have a visit plan or active self-visit today, skip entirely.
    Otherwise log alert and email admin/HR that rep is outside without a visit plan.
    """
    user = await get_current_user(request)
    body       = await request.json()
    lat        = body.get("lat")
    lng        = body.get("lng")
    distance_m = body.get("distance_m")

    now   = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    # Skip if rep has a planned or in-progress visit today
    has_plan = await db.visit_plans.find_one({
        "assigned_to": user["email"],
        "visit_date":  today,
        "status":      {"$in": ["planned", "in_progress"]},
    })
    if not has_plan:
        has_plan = await db.field_visits.find_one({
            "created_by": user["email"],
            "visit_date": today,
            "status":     {"$in": ["planned", "in_progress"]},
        })
    if has_plan:
        return {"action": "skip", "reason": "has_visit_plan"}

    address  = None
    if lat is not None and lng is not None:
        address = reverse_geocode(float(lat), float(lng))

    office   = await db.settings.find_one({"type": "field_settings"}, {"_id": 0}) or {}
    radius_m = float(office.get("office_radius_m", 300))

    await db.geofence_alerts.insert_one({
        "alert_id":               f"ga_{uuid.uuid4().hex[:12]}",
        "user_email":             user["email"],
        "user_name":              user["name"],
        "alert_type":             "sales_outside_without_visit_plan",
        "lat":                    lat,
        "lng":                    lng,
        "address":                address,
        "distance_from_office_m": distance_m,
        "office_radius_m":        radius_m,
        "triggered_at":           now.isoformat(),
        "is_read":                False,
    })

    # Notify admin + HR silently
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        email_cfg = await db.settings.find_one({"type": "email"}, {"_id": 0})
        admins    = await db.users.find(
            {"role": {"$in": ["admin", "hr"]}, "is_active": True}, {"email": 1, "_id": 0}
        ).to_list(20)
        to_list = [a["email"] for a in admins if a.get("email")]

        if email_cfg and email_cfg.get("enabled") and email_cfg.get("sender_email") and to_list:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"📍 Field Alert: {user['name']} is outside office (no visit plan today)"
            msg["From"]    = email_cfg["sender_email"]
            msg["To"]      = ", ".join(to_list)
            html = f"""
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
              <h2 style="color:#f59e0b;margin-top:0;">📍 Sales Rep Outside Office — No Visit Plan</h2>
              <p><strong>{user['name']}</strong> ({user['email']}) is outside the office zone with no visit scheduled today.</p>
              <p style="color:#888;font-size:13px;">The rep was <strong>not logged out</strong>. This is an informational alert only.</p>
              <table style="width:100%;border-collapse:collapse;margin-top:12px;">
                <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;border:1px solid #eee;">Time</td>
                    <td style="padding:8px;font-weight:bold;border:1px solid #eee;">{now.strftime('%d %b %Y %H:%M:%S UTC')}</td></tr>
                <tr><td style="padding:8px;color:#555;border:1px solid #eee;">Distance from Office</td>
                    <td style="padding:8px;font-weight:bold;color:#f59e0b;border:1px solid #eee;">{distance_m}m away (radius: {radius_m}m)</td></tr>
                <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;border:1px solid #eee;">Location</td>
                    <td style="padding:8px;border:1px solid #eee;">{address or 'Unknown'}</td></tr>
              </table>
              <p style="color:#888;font-size:12px;margin-top:16px;">View alerts → SmartShape Pro → Field Sales → Geo Alerts</p>
            </div>"""
            msg.attach(MIMEText(html, "html"))
            with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
                smtp.ehlo(); smtp.starttls()
                smtp.login(email_cfg["sender_email"], email_cfg.get("gmail_app_password", ""))
                smtp.sendmail(email_cfg["sender_email"], to_list, msg.as_string())
    except Exception:
        pass

    return {"action": "alert_sent"}


@router.get("/profile/wfh-location")
async def get_wfh_location(request: Request):
    """Return the current user's saved WFH (home) GPS location."""
    user = await get_current_user(request)
    doc  = await db.users.find_one({"email": user["email"]}, {"_id": 0, "wfh_lat": 1, "wfh_lng": 1})
    return {
        "wfh_lat": doc.get("wfh_lat") if doc else None,
        "wfh_lng": doc.get("wfh_lng") if doc else None,
    }


@router.put("/profile/wfh-location")
async def set_wfh_location(request: Request):
    """Save or update the current user's WFH home GPS location."""
    user = await get_current_user(request)
    body = await request.json()
    lat  = body.get("lat")
    lng  = body.get("lng")
    if lat is None or lng is None:
        raise HTTPException(400, "lat and lng are required")
    await db.users.update_one(
        {"email": user["email"]},
        {"$set": {"wfh_lat": float(lat), "wfh_lng": float(lng)}},
    )
    return {"message": "WFH location saved", "wfh_lat": float(lat), "wfh_lng": float(lng)}


@router.get("/admin/punch-report")
async def get_punch_report(
    request: Request,
    date_from: str = "",
    date_to:   str = "",
    user_email: str = "",
):
    user = await get_current_user(request)
    if user.get("role") != "admin" and "field_sales" not in user.get("assigned_modules", []):
        raise HTTPException(403, "Insufficient permissions")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filt: dict = {}
    if date_from and date_to:
        filt["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        filt["date"] = {"$gte": date_from}
    elif date_to:
        filt["date"] = {"$lte": date_to}
    else:
        filt["date"] = today
    if user_email:
        filt["user_email"] = user_email

    all_punches = await db.punch_logs.find(filt, {"_id": 0}).sort(
        [("date", 1), ("timestamp", 1)]
    ).to_list(10000)

    from collections import defaultdict
    grouped: dict = defaultdict(list)
    for p in all_punches:
        grouped[(p["date"], p["user_email"])].append(p)

    report = []
    for (date, email), punches in sorted(grouped.items(), key=lambda x: x[0][0], reverse=True):
        ins  = [p for p in punches if p["type"] == "in"]
        outs = [p for p in punches if p["type"] == "out"]

        first_in  = min((p["timestamp"] for p in ins),  default=None)
        last_out  = max((p["timestamp"] for p in outs), default=None)

        total_hours = None
        if first_in and last_out:
            try:
                from datetime import datetime as _dt
                fi = _dt.fromisoformat(first_in.replace("Z", "+00:00"))
                lo = _dt.fromisoformat(last_out.replace("Z", "+00:00"))
                total_hours = round((lo - fi).total_seconds() / 3600, 2)
            except Exception:
                pass

        cycles       = min(len(ins), len(outs))
        auto_logouts = sum(1 for p in punches if p.get("source") == "geofence_auto_logout")

        if cycles <= 1:   efficiency = "optimal"
        elif cycles == 2: efficiency = "good"
        elif cycles == 3: efficiency = "moderate"
        else:             efficiency = "frequent_exits"

        report.append({
            "user_email":       email,
            "user_name":        punches[0]["user_name"] if punches else email,
            "date":             date,
            "first_in":         first_in,
            "last_out":         last_out,
            "total_hours":      total_hours,
            "punch_count":      len(punches),
            "in_count":         len(ins),
            "out_count":        len(outs),
            "auto_logout_count": auto_logouts,
            "efficiency":       efficiency,
            "punches":          punches,
        })

    return report


# ==================== SALES TARGETS ====================

@router.get("/sales/targets/progress")
async def get_target_progress(request: Request, month_year: Optional[str] = None):
    """Return current user's visits/leads progress vs their monthly target."""
    user = await get_current_user(request)
    my = month_year or datetime.now(timezone.utc).strftime("%Y-%m")

    target = await db.sales_targets.find_one(
        {"email": user["email"], "month_year": my}, {"_id": 0}
    ) or {}

    visits_done = await db.field_visits.count_documents({
        "sales_person_email": user["email"],
        "status": "visited",
        "visit_date": {"$regex": f"^{my}"},
    })
    plans_done = await db.visit_plans.count_documents({
        "assigned_to": user["email"],
        "status": "completed",
        "visit_date": {"$regex": f"^{my}"},
    })

    leads_converted = await db.leads.count_documents({
        "assigned_to": user["email"],
        "stage": {"$in": ["demo", "negotiation", "won"]},
        "created_at": {"$regex": f"^{my}"},
    })

    return {
        "month_year": my,
        "visits_done": visits_done + plans_done,
        "visits_target": target.get("visits_target", 0),
        "leads_converted": leads_converted,
        "leads_target": target.get("leads_target", 0),
        "demos_done": await db.visit_plans.count_documents({
            "assigned_to": user["email"],
            "purpose": {"$regex": "demo", "$options": "i"},
            "status": "completed",
            "visit_date": {"$regex": f"^{my}"},
        }),
        "demos_target": target.get("demos_target", 0),
    }


@router.get("/admin/sales-targets")
async def get_all_sales_targets(request: Request, month_year: Optional[str] = None):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    my = month_year or datetime.now(timezone.utc).strftime("%Y-%m")
    targets = await db.sales_targets.find({"month_year": my}, {"_id": 0}).to_list(200)
    return targets


@router.post("/admin/sales-targets")
async def set_sales_target(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    required = ("email", "month_year")
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"{f} is required")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "email": body["email"],
        "name": body.get("name", ""),
        "month_year": body["month_year"],
        "visits_target": int(body.get("visits_target", 0)),
        "leads_target": int(body.get("leads_target", 0)),
        "demos_target": int(body.get("demos_target", 0)),
        "set_by": user["email"],
        "updated_at": now_iso,
    }
    await db.sales_targets.update_one(
        {"email": body["email"], "month_year": body["month_year"]},
        {"$set": doc},
        upsert=True,
    )
    return doc


# ==================== BUSINESS CARD SCANNER ====================

_CARD_SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

_CARD_PROMPT = (
    "Extract contact information from this business card image. "
    "Return ONLY a JSON object with these exact keys "
    "(use empty string if a field is not found on the card): "
    "{\"name\": \"\", \"phone\": \"\", \"email\": \"\", "
    "\"school_name\": \"\", \"role\": \"\", \"website\": \"\", \"address\": \"\"}. "
    "For 'role' pick the closest from: principal, vice_principal, director, "
    "coordinator, admin, teacher, purchase — or leave empty if unclear. "
    "For 'phone' include country code if visible. "
    "Return ONLY the JSON object, no markdown fences, no explanation."
)


def _gemini_scan_sync(api_key: str, image_b64: str):
    """Synchronous Gemini call — runs in a thread pool via asyncio.to_thread."""
    import base64 as _b64
    import io as _io
    import google.generativeai as genai
    import PIL.Image as PILImage

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    img_bytes = _b64.b64decode(image_b64)
    img = PILImage.open(_io.BytesIO(img_bytes))

    response = model.generate_content([img, _CARD_PROMPT])
    return response.text


@router.post("/sales/scan-card")
async def scan_business_card(request: Request):
    """
    Accept a base64 image of a business card and return extracted contact fields
    using Gemini 1.5 Flash vision.
    """
    import asyncio as _asyncio
    import os as _os
    import json as _json
    import re as _re

    await get_current_user(request)
    body = await request.json()
    image_b64 = body.get("image_base64", "")
    media_type = (body.get("media_type") or "image/jpeg").lower().strip()

    if not image_b64:
        raise HTTPException(status_code=400, detail="image_base64 is required")

    if media_type == "image/jpg":
        media_type = "image/jpeg"

    if media_type not in _CARD_SUPPORTED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Image format '{media_type}' is not supported. "
                "Use JPEG, PNG, or WebP. On iPhone go to Settings → Camera → Formats → Most Compatible."
            ),
        )

    # Read key from DB settings first; fall back to environment variable
    ai_doc = await db.settings.find_one({"type": "ai"}, {"_id": 0}) or {}
    api_key = ai_doc.get("gemini_api_key", "").strip() or _os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI scanning not configured. Add your Gemini API key in App Settings → AI.",
        )

    try:
        raw = await _asyncio.to_thread(_gemini_scan_sync, api_key, image_b64)
    except Exception as e:
        err = str(e)
        if "API_KEY_INVALID" in err or "invalid" in err.lower() and "key" in err.lower():
            raise HTTPException(status_code=503, detail="Gemini API key is invalid. Check GEMINI_API_KEY in backend/.env")
        raise HTTPException(status_code=502, detail=f"AI service error: {err[:200]}")

    # Strip markdown fences if model adds them
    raw = raw.strip()
    raw = _re.sub(r"^```(?:json)?\s*", "", raw, flags=_re.MULTILINE)
    raw = _re.sub(r"\s*```\s*$", "", raw, flags=_re.MULTILINE)
    raw = raw.strip()

    try:
        data = _json.loads(raw)
        defaults = {"name": "", "phone": "", "email": "", "school_name": "", "role": "", "website": "", "address": ""}
        data = {**defaults, **{k: (v or "") for k, v in data.items()}}
    except Exception:
        data = {"name": "", "phone": "", "email": "", "school_name": "", "role": "", "website": "", "address": ""}

    return data


# ==================== FIELD JOURNEY TRACKER ====================

@router.post("/sales/journey/start")
async def start_journey(request: Request):
    """Start a new field journey for today. Only one active journey allowed per user per day."""
    user = await get_current_user(request)
    body       = await request.json()
    start_type = body.get("start_type", "office")   # "office" or "home"
    lat        = body.get("lat")
    lng        = body.get("lng")

    now   = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    existing = await db.field_journeys.find_one(
        {"user_email": user["email"], "date": today, "status": "active"}, {"_id": 0}
    )
    if existing:
        return existing

    address = None
    if lat is not None and lng is not None:
        address = reverse_geocode(float(lat), float(lng))

    journey = {
        "journey_id":    f"jrn_{uuid.uuid4().hex[:12]}",
        "user_email":    user["email"],
        "user_name":     user["name"],
        "date":          today,
        "status":        "active",
        "start_type":    start_type,
        "start_lat":     lat,
        "start_lng":     lng,
        "start_address": address,
        "start_time":    now.isoformat(),
        "end_lat":       None,
        "end_lng":       None,
        "end_time":      None,
        "total_km":      0.0,
        "stops":         [],
    }
    await db.field_journeys.insert_one(journey)
    journey.pop("_id", None)
    return journey


@router.get("/sales/journey/active")
async def get_active_journey(request: Request):
    """Return today's active journey for the current user, or empty dict if none."""
    user  = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc   = await db.field_journeys.find_one(
        {"user_email": user["email"], "date": today, "status": "active"}, {"_id": 0}
    )
    return doc or {}


@router.post("/sales/journey/{journey_id}/arrive")
async def arrive_at_stop(journey_id: str, request: Request):
    """
    Mark arrival at next stop. Auto-calculates km from previous stop or journey start.
    Optionally links to an existing visit by visit_id — auto-triggers check-in.
    """
    user = await get_current_user(request)
    body                 = await request.json()
    lat                  = float(body.get("lat"))
    lng                  = float(body.get("lng"))
    school_name          = body.get("school_name", "")
    school_id            = body.get("school_id", "")
    visit_id             = body.get("visit_id")
    contact_name         = body.get("contact_name", "")
    contact_designation  = body.get("contact_designation", "")
    contact_phone        = body.get("contact_phone", "")
    contact_id           = body.get("contact_id", "")

    journey = await db.field_journeys.find_one(
        {"journey_id": journey_id, "user_email": user["email"]}, {"_id": 0}
    )
    if not journey:
        raise HTTPException(404, "Journey not found")
    if journey["status"] != "active":
        raise HTTPException(400, "Journey is not active")

    stops = journey.get("stops", [])
    if stops:
        prev_lat, prev_lng = float(stops[-1]["lat"]), float(stops[-1]["lng"])
    else:
        prev_lat = float(journey["start_lat"])
        prev_lng = float(journey["start_lng"])

    km_from_prev = round(haversine_distance(prev_lat, prev_lng, lat, lng), 2)
    now          = datetime.now(timezone.utc)
    address      = reverse_geocode(lat, lng)

    stop = {
        "stop_num":            len(stops) + 1,
        "school_name":         school_name,
        "school_id":           school_id,
        "visit_id":            visit_id,
        "contact_name":        contact_name,
        "contact_designation": contact_designation,
        "contact_phone":       contact_phone,
        "contact_id":          contact_id,
        "arrived_at":          now.isoformat(),
        "departed_at":         None,
        "lat":                 lat,
        "lng":                 lng,
        "address":             address,
        "km_from_prev":        km_from_prev,
        "status":              "arrived",
    }

    # Touch school + contact last_activity in background
    if school_id:
        try:
            await touch_last_activity("school", school_id)
        except Exception:
            pass
    new_total = round(journey.get("total_km", 0) + km_from_prev, 2)

    await db.field_journeys.update_one(
        {"journey_id": journey_id},
        {"$push": {"stops": stop}, "$set": {"total_km": new_total}}
    )

    # Auto check-in the linked visit
    if visit_id:
        try:
            check_in_data = {"status": "in_progress", "check_in_time": now.isoformat(),
                             "check_in_lat": lat, "check_in_lng": lng}
            r = await db.visit_plans.update_one({"plan_id": visit_id}, {"$set": check_in_data})
            if r.matched_count == 0:
                await db.field_visits.update_one({"visit_id": visit_id}, {"$set": check_in_data})
        except Exception:
            pass

    return {"stop": stop, "total_km": new_total}


@router.post("/sales/journey/{journey_id}/depart")
async def depart_stop(journey_id: str, request: Request):
    """Mark departure from the current (latest) stop. Optionally records visit outcome."""
    user = await get_current_user(request)
    body    = await request.json()
    outcome = body.get("outcome")

    journey = await db.field_journeys.find_one(
        {"journey_id": journey_id, "user_email": user["email"]}, {"_id": 0}
    )
    if not journey:
        raise HTTPException(404, "Journey not found")

    stops = journey.get("stops", [])
    if not stops:
        raise HTTPException(400, "No stops to depart from")

    now       = datetime.now(timezone.utc)
    last_stop = stops[-1]
    idx       = len(stops) - 1

    await db.field_journeys.update_one(
        {"journey_id": journey_id},
        {"$set": {
            f"stops.{idx}.departed_at": now.isoformat(),
            f"stops.{idx}.status":      "completed",
            **({"stops." + str(idx) + ".outcome": outcome} if outcome else {}),
        }}
    )

    # Auto check-out the linked visit
    if last_stop.get("visit_id"):
        try:
            checkout = {"status": "completed", "check_out_time": now.isoformat(),
                        **({"outcome": outcome} if outcome else {})}
            r = await db.visit_plans.update_one({"plan_id": last_stop["visit_id"]}, {"$set": checkout})
            if r.matched_count == 0:
                await db.field_visits.update_one({"visit_id": last_stop["visit_id"]}, {"$set": checkout})
        except Exception:
            pass

    return {"departed_at": now.isoformat()}


@router.post("/sales/journey/{journey_id}/end")
async def end_journey(journey_id: str, request: Request):
    """
    End the journey. Calculates return km from last stop back to base.
    Returns full journey summary.
    """
    user = await get_current_user(request)
    body = await request.json()
    lat  = body.get("lat")
    lng  = body.get("lng")

    journey = await db.field_journeys.find_one(
        {"journey_id": journey_id, "user_email": user["email"]}, {"_id": 0}
    )
    if not journey:
        raise HTTPException(404, "Journey not found")

    now       = datetime.now(timezone.utc)
    stops     = journey.get("stops", [])
    return_km = 0.0

    if lat is not None and lng is not None:
        if stops:
            return_km = round(haversine_distance(
                float(stops[-1]["lat"]), float(stops[-1]["lng"]), float(lat), float(lng)
            ), 2)
        elif journey.get("start_lat"):
            return_km = round(haversine_distance(
                float(journey["start_lat"]), float(journey["start_lng"]), float(lat), float(lng)
            ), 2)

    total_km = round(journey.get("total_km", 0) + return_km, 2)
    address  = reverse_geocode(float(lat), float(lng)) if lat and lng else None

    await db.field_journeys.update_one(
        {"journey_id": journey_id},
        {"$set": {
            "status":      "completed",
            "end_lat":     lat,
            "end_lng":     lng,
            "end_address": address,
            "end_time":    now.isoformat(),
            "return_km":   return_km,
            "total_km":    total_km,
        }}
    )

    journey.update({"status": "completed", "total_km": total_km,
                    "return_km": return_km, "end_time": now.isoformat()})
    journey.pop("_id", None)
    return journey


@router.get("/sales/journeys")
async def list_journeys(request: Request, date: str = ""):
    """Return the current user's journey history (most recent 30)."""
    user  = await get_current_user(request)
    query: dict = {"user_email": user["email"]}
    if date:
        query["date"] = date
    docs = await db.field_journeys.find(query, {"_id": 0}).sort("date", -1).to_list(30)
    return docs
