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


# ==================== MODELS ====================

class AttendanceCheckIn(BaseModel):
    work_type: str
    lat: float
    lng: float


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

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"sales_person_email": user["email"], "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Already checked in today")

    address = reverse_geocode(check_in_data.lat, check_in_data.lng)

    # ── Geofence check ───────────────────────────────────────────────────────
    geofence_breach = False
    distance_from_office_m = None
    office_settings = await db.settings.find_one({"type": "field_settings"}, {"_id": 0})
    if (office_settings and office_settings.get("office_lat") and office_settings.get("office_lng")
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
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "visit_date": body.get("visit_date", ""),
        "visit_time": body.get("visit_time", ""),
        "purpose": body.get("purpose", ""),
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
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})


@router.put("/visit-plans/{plan_id}")
async def update_visit_plan(plan_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("visit_date", "visit_time", "purpose", "status", "assigned_to", "assigned_name",
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

@router.post("/sales/visits")
async def create_visit(visit_input: FieldVisitCreate, request: Request):
    user = await get_current_user(request)

    visit_id = f"visit_{uuid.uuid4().hex[:12]}"
    address = None
    if visit_input.lat and visit_input.lng:
        address = reverse_geocode(visit_input.lat, visit_input.lng)

    visit_doc = {
        "visit_id": visit_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "school_name": visit_input.school_name,
        "contact_person": visit_input.contact_person,
        "contact_phone": visit_input.contact_phone,
        "visit_date": visit_input.visit_date,
        "visit_time": visit_input.visit_time,
        "status": "planned",
        "purpose": visit_input.purpose,
        "planned_lat": visit_input.lat,
        "planned_lng": visit_input.lng,
        "planned_address": address,
        "visited_lat": None,
        "visited_lng": None,
        "visited_address": None,
        "checked_in_at": None,
        "outcome": None,
    }
    await db.field_visits.insert_one(visit_doc)
    return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})


@router.get("/sales/visits")
async def get_visits(request: Request):
    user = await get_current_user(request)
    visits = await db.field_visits.find(
        {"sales_person_email": user["email"]}, {"_id": 0}
    ).sort("visit_date", -1).to_list(1000)
    return visits


@router.post("/sales/visits/{visit_id}/check-in")
async def check_in_visit(visit_id: str, lat: float, lng: float, request: Request):
    user = await get_current_user(request)

    visit = await db.field_visits.find_one({"visit_id": visit_id, "sales_person_email": user["email"]})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    address = reverse_geocode(lat, lng)

    await db.field_visits.update_one(
        {"visit_id": visit_id},
        {"$set": {
            "status": "visited",
            "visited_lat": lat,
            "visited_lng": lng,
            "visited_address": address,
            "checked_in_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"message": "Checked in at visit", "visit_id": visit_id}


@router.put("/sales/visits/{visit_id}")
async def update_visit(visit_id: str, updates: dict, request: Request):
    user = await get_current_user(request)
    await db.field_visits.update_one(
        {"visit_id": visit_id, "sales_person_email": user["email"]},
        {"$set": updates},
    )
    return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})


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
