from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import csv
import io
import asyncio

from database import db
from auth_utils import get_current_user, hash_password
from rbac import get_team, require_admin, require_teams

router = APIRouter()


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


# ==================== MODULES ====================

@router.get("/modules")
async def get_modules(request: Request):
    await get_current_user(request)
    modules = await db.modules.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return modules


@router.put("/modules/{module_id}")
async def update_module(module_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    allowed = {k: v for k, v in body.items() if k in ("display_name", "is_active", "sort_order")}
    await db.modules.update_one({"module_id": module_id}, {"$set": allowed})
    return await db.modules.find_one({"module_id": module_id}, {"_id": 0})


# ==================== ADMIN USER MANAGEMENT ====================

@router.get("/admin/users")
async def admin_get_users(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users


@router.post("/admin/users")
async def admin_create_user(request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    name = body.get("name", "")
    role = body.get("role", "sales_person")
    if role not in ("admin", "accounts", "store", "sales_person"):
        role = "sales_person"
    phone = body.get("phone", "")
    designation = body.get("designation", "")
    sales_role = body.get("sales_role", "executive")
    if sales_role not in ("manager", "executive", "trainee"):
        sales_role = "executive"
    assigned_modules = body.get("assigned_modules", [])

    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="Email, password, and name are required")

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "phone": phone,
        "designation": designation,
        "sales_role": sales_role if role == "sales_person" else None,
        "assigned_modules": assigned_modules,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)

    sp_existing = await db.salespersons.find_one({"email": email})
    if not sp_existing:
        await db.salespersons.insert_one({
            "sales_person_id": f"sp_{uuid.uuid4().hex[:12]}",
            "name": name,
            "email": email,
            "phone": phone,
            "user_id": user_id,
            "is_active": True,
        })
    else:
        await db.salespersons.update_one(
            {"email": email},
            {"$set": {"name": name, "phone": phone, "user_id": user_id, "is_active": True}},
        )

    result = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return result


@router.put("/admin/users/{user_id}")
async def admin_update_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    body = await request.json()
    allowed_fields = {}
    for key in ("name", "role", "phone", "designation", "sales_role", "assigned_modules", "is_active", "module_permissions"):
        if key in body:
            allowed_fields[key] = body[key]

    # Sync assigned_modules from module_permissions if provided
    if "module_permissions" in allowed_fields and "assigned_modules" not in allowed_fields:
        perms = allowed_fields["module_permissions"]
        allowed_fields["assigned_modules"] = [m for m, p in perms.items() if p.get("level", "none") != "none"]

    if "password" in body and body["password"]:
        allowed_fields["password_hash"] = hash_password(body["password"])

    if not allowed_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.users.update_one({"user_id": user_id}, {"$set": allowed_fields})
    result = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    sp_update = {}
    if "name" in allowed_fields:
        sp_update["name"] = allowed_fields["name"]
    if "phone" in allowed_fields:
        sp_update["phone"] = allowed_fields["phone"]
    if "is_active" in allowed_fields:
        sp_update["is_active"] = allowed_fields["is_active"]
    if sp_update:
        await db.salespersons.update_one({"email": result["email"]}, {"$set": sp_update})

    return result


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if current_user.get("user_id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user_to_delete = await db.users.find_one({"user_id": user_id})
    if not user_to_delete:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.delete_one({"user_id": user_id})
    await db.salespersons.update_one({"email": user_to_delete["email"]}, {"$set": {"is_active": False}})
    return {"message": "User deleted"}


# ==================== ANALYTICS ====================

@router.get("/analytics/dashboard")
async def get_dashboard_analytics(request: Request):
    user = await get_current_user(request)

    total_dies = await db.dies.count_documents({})
    low_stock_count = await db.dies.count_documents({"$expr": {"$lt": ["$stock_qty", "$min_level"]}})
    pending_alerts = await db.purchase_alerts.count_documents({"status": "pending"})

    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    quotations = await db.quotations.find({
        "created_at": {"$regex": f"^{current_month}"},
        "quotation_status": {"$in": ["confirmed", "sent", "pending"]},
    }, {"_id": 0}).to_list(1000)
    monthly_revenue = sum(q["grand_total"] for q in quotations)

    return {
        "total_dies": total_dies,
        "low_stock_count": low_stock_count,
        "pending_alerts": pending_alerts,
        "monthly_revenue": monthly_revenue,
    }


@router.get("/analytics/charts")
async def get_chart_data(request: Request):
    user = await get_current_user(request)

    stock_by_type = {}
    dies = await db.dies.find({}, {"_id": 0}).to_list(1000)
    for die in dies:
        type_name = die["type"]
        stock_by_type[type_name] = stock_by_type.get(type_name, 0) + die["stock_qty"]

    status_dist = {}
    quotations = await db.quotations.find({}, {"_id": 0}).to_list(1000)
    for quot in quotations:
        status = quot["quotation_status"]
        status_dist[status] = status_dist.get(status, 0) + 1

    return {
        "stock_by_type": [{"type": k, "count": v} for k, v in stock_by_type.items()],
        "quotation_status": [{"status": k, "count": v} for k, v in status_dist.items()],
    }


@router.get("/analytics/conversion")
async def get_conversion_analytics(request: Request):
    user = await get_current_user(request)

    pipeline_counts = {}
    for stage in ["new", "contacted", "demo", "quoted", "negotiation", "won", "lost"]:
        pipeline_counts[stage] = await db.leads.count_documents({"stage": stage})

    total_leads = sum(pipeline_counts.values())
    won_count = pipeline_counts.get("won", 0)
    lost_count = pipeline_counts.get("lost", 0)
    conversion_rate = (won_count / total_leads * 100) if total_leads > 0 else 0

    all_sp = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(100)
    sp_conversion = []
    for sp in all_sp:
        sp_total = await db.leads.count_documents({"assigned_to": sp["email"]})
        sp_won = await db.leads.count_documents({"assigned_to": sp["email"], "stage": "won"})
        sp_lost = await db.leads.count_documents({"assigned_to": sp["email"], "stage": "lost"})
        sp_active = await db.leads.count_documents({"assigned_to": sp["email"], "stage": {"$nin": ["won", "lost"]}})
        sp_quots = await db.quotations.count_documents({"sales_person_email": sp["email"]})
        won_quots = await db.quotations.find(
            {"sales_person_email": sp["email"], "quotation_status": "confirmed"},
            {"_id": 0, "grand_total": 1},
        ).to_list(1000)
        sp_revenue = sum(q.get("grand_total", 0) for q in won_quots)

        sp_conversion.append({
            "name": sp["name"],
            "email": sp["email"],
            "total_leads": sp_total,
            "won": sp_won,
            "lost": sp_lost,
            "active": sp_active,
            "quotations": sp_quots,
            "revenue": sp_revenue,
            "conversion_rate": (sp_won / sp_total * 100) if sp_total > 0 else 0,
        })

    sp_conversion.sort(key=lambda x: x["conversion_rate"], reverse=True)

    total_quots = await db.quotations.count_documents({})
    draft_quots = await db.quotations.count_documents({"quotation_status": "draft"})
    sent_quots = await db.quotations.count_documents({"quotation_status": "sent"})
    confirmed_quots = await db.quotations.count_documents({"quotation_status": "confirmed"})

    total_tasks = await db.tasks.count_documents({})
    pending_tasks = await db.tasks.count_documents({"status": "pending"})
    done_tasks = await db.tasks.count_documents({"status": "done"})
    missed_tasks = await db.tasks.count_documents({"status": "missed"})

    return {
        "pipeline": pipeline_counts,
        "total_leads": total_leads,
        "won": won_count,
        "lost": lost_count,
        "conversion_rate": round(conversion_rate, 1),
        "salesperson_conversion": sp_conversion,
        "quotation_stats": {
            "total": total_quots, "draft": draft_quots, "sent": sent_quots, "confirmed": confirmed_quots,
        },
        "task_stats": {
            "total": total_tasks, "pending": pending_tasks, "done": done_tasks, "missed": missed_tasks,
        },
    }


# ==================== ADMIN FUNNEL ====================

@router.get("/admin/funnel")
async def admin_funnel(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    stage_buckets = {}
    async for doc in db.leads.aggregate([{"$group": {"_id": "$stage", "count": {"$sum": 1}}}]):
        stage_buckets[doc["_id"] or "new"] = doc["count"]
    order_stages = {}
    async for doc in db.orders.aggregate([{"$group": {"_id": "$production_stage", "count": {"$sum": 1}}}]):
        order_stages[doc["_id"] or "order_created"] = doc["count"]
    total_leads = await db.leads.count_documents({})
    total_orders = await db.orders.count_documents({})
    total_dispatches = await db.dispatches.count_documents({})
    reassigned = await db.leads.find({"reassignment_count": {"$gt": 0}}, {"_id": 0}).sort("reassignment_count", -1).to_list(50)
    movement = await db.activity_logs.find(
        {"action": {"$in": ["reassign_lead", "bulk_assign_lead", "convert_to_order", "update_production_stage"]}},
        {"_id": 0},
    ).sort("timestamp", -1).to_list(100)
    return {
        "lead_stages": stage_buckets,
        "order_stages": order_stages,
        "totals": {"leads": total_leads, "orders": total_orders, "dispatches": total_dispatches},
        "lead_to_order_ratio": round(total_orders / total_leads, 3) if total_leads else 0,
        "order_to_dispatch_ratio": round(total_dispatches / total_orders, 3) if total_orders else 0,
        "reassignment_leaderboard": reassigned[:20],
        "recent_movements": movement,
    }


# ==================== ADMIN FIELD SALES ====================

@router.get("/admin/attendance")
async def get_all_attendance(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin")
    records = await db.attendance.find({}, {"_id": 0}).sort("date", -1).limit(200).to_list(200)
    return records


@router.get("/admin/visits")
async def get_all_visits(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin")
    visits = await db.field_visits.find({}, {"_id": 0}).sort("visit_date", -1).limit(200).to_list(200)
    return visits


@router.get("/admin/expenses")
async def get_all_expenses(request: Request):
    user = await get_current_user(request)
    # Admin sees all; accounts team sees all for payroll; others see own only
    team = get_team(user)
    if team == "admin":
        query = {}
    elif team == "accounts":
        query = {}
    else:
        raise HTTPException(status_code=403, detail="Access denied")
    expenses = await db.travel_expenses.find(query, {"_id": 0}).sort("date", -1).limit(200).to_list(200)
    return expenses


@router.get("/admin/field-sales/summary")
async def get_field_sales_summary(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")

    today_checkins = await db.attendance.count_documents({"date": today})
    month_visits = await db.field_visits.count_documents({"visit_date": {"$regex": f"^{current_month}"}})
    completed_visits = await db.field_visits.count_documents({"visit_date": {"$regex": f"^{current_month}"}, "status": "visited"})
    planned_visits = await db.field_visits.count_documents({"status": "planned"})
    month_expenses = await db.travel_expenses.find({"month_year": current_month}, {"_id": 0}).to_list(1000)
    total_expense = sum(e.get("amount", 0) for e in month_expenses)
    total_km = sum(e.get("distance_km", 0) for e in month_expenses)
    active_salespersons = await db.salespersons.count_documents({"is_active": {"$ne": False}})

    return {
        "today_checkins": today_checkins,
        "month_visits": month_visits,
        "completed_visits": completed_visits,
        "planned_visits": planned_visits,
        "total_expense": total_expense,
        "total_km": total_km,
        "active_salespersons": active_salespersons,
    }


# ==================== TODAY ACTIONS ====================

@router.get("/today/actions")
async def today_actions(request: Request):
    user = await get_current_user(request)
    from datetime import date as _date
    today = _date.today().isoformat()

    lead_query = {}
    visit_query = {}
    team = get_team(user)
    role = user.get("role", "")
    if team != "admin":
        lead_query["assigned_to"] = user["email"]
        visit_query["assigned_to"] = user["email"]

    leads_all = await db.leads.find(lead_query, {"_id": 0}).to_list(10000)
    leads_by_id = {l["lead_id"]: l for l in leads_all}

    def _card_from_lead(lead, kind, due_date):
        days_stale = None
        if lead.get("last_activity_date"):
            try:
                la = datetime.fromisoformat(lead["last_activity_date"].replace("Z", "+00:00"))
                days_stale = (datetime.now(timezone.utc) - la).days
            except Exception:
                pass
        return {
            "kind": kind,
            "lead_id": lead["lead_id"],
            "school_id": lead.get("school_id"),
            "school_name": lead.get("school_name") or lead.get("company_name") or "",
            "contact_name": lead.get("contact_name", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "stage": lead.get("stage", "new"),
            "priority": lead.get("priority", "medium"),
            "lead_type": lead.get("lead_type", "warm"),
            "assigned_name": lead.get("assigned_name", ""),
            "last_activity_date": lead.get("last_activity_date"),
            "days_stale": days_stale,
            "next_followup_date": lead.get("next_followup_date"),
            "due_date": due_date,
            "is_hot": lead.get("lead_type") == "hot" or lead.get("catalogue_status") == "opened" or lead.get("quotation_status") == "confirmed",
        }

    calls_today = []
    overdue_calls = []
    for l in leads_all:
        fu = l.get("next_followup_date")
        if not fu:
            continue
        if fu == today:
            calls_today.append(_card_from_lead(l, "call", fu))
        elif fu < today:
            overdue_calls.append(_card_from_lead(l, "overdue_call", fu))

    visits = await db.visit_plans.find(visit_query, {"_id": 0}).to_list(10000)
    visits_today = []
    overdue_visits = []
    for v in visits:
        if v.get("status") in ("completed", "cancelled"):
            continue
        vdate = v.get("visit_date")
        if not vdate:
            continue
        linked = leads_by_id.get(v.get("lead_id") or "")
        card = {
            "kind": "visit" if vdate >= today else "overdue_visit",
            "plan_id": v.get("plan_id"),
            "lead_id": v.get("lead_id"),
            "school_id": v.get("school_id"),
            "school_name": v.get("school_name", "") or (linked.get("school_name") if linked else ""),
            "contact_name": (linked.get("contact_name", "") if linked else ""),
            "contact_phone": (linked.get("contact_phone", "") if linked else v.get("phone", "")),
            "stage": (linked.get("stage", "") if linked else ""),
            "priority": (linked.get("priority", "") if linked else v.get("priority", "medium")),
            "assigned_name": v.get("assigned_name", ""),
            "visit_time": v.get("visit_time"),
            "purpose": v.get("purpose", ""),
            "status": v.get("status", "planned"),
            "due_date": vdate,
            "next_followup_date": (linked.get("next_followup_date") if linked else None),
            "last_activity_date": (linked.get("last_activity_date") if linked else None),
            "is_hot": (linked.get("lead_type") == "hot" if linked else False),
        }
        if vdate == today:
            visits_today.append(card)
        elif vdate < today:
            overdue_visits.append(card)

    def _sort_key(c):
        pri_order = {"high": 0, "medium": 1, "low": 2}
        return (pri_order.get(c.get("priority", "medium"), 1), -(c.get("days_stale") or 0))

    overdue = sorted(overdue_calls + overdue_visits, key=lambda c: (c.get("due_date") or "", c.get("priority", "medium")))
    calls_today.sort(key=_sort_key)
    visits_today.sort(key=_sort_key)

    return {
        "today": today,
        "overdue": overdue,
        "calls_today": calls_today,
        "visits_today": visits_today,
        "counts": {
            "overdue": len(overdue),
            "calls_today": len(calls_today),
            "visits_today": len(visits_today),
            "total": len(overdue) + len(calls_today) + len(visits_today),
        },
        "role": role,
    }


@router.post("/today/mark-done")
async def today_mark_done(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    kind = body.get("kind")
    note = (body.get("note") or "").strip()
    next_fu = body.get("next_followup_date", "")
    if not note:
        raise HTTPException(status_code=400, detail="Activity note is required to mark done")
    if not next_fu and kind not in ("visit", "overdue_visit"):
        raise HTTPException(status_code=400, detail="Next follow-up date is required")

    now_iso = datetime.now(timezone.utc).isoformat()
    if kind in ("visit", "overdue_visit"):
        plan_id = body.get("plan_id")
        if not plan_id:
            raise HTTPException(status_code=400, detail="plan_id required")
        update = {
            "status": "completed",
            "visit_notes": note,
            "outcome": note,
            "check_out_time": now_iso,
            "updated_at": now_iso,
        }
        await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
        lead_id = body.get("lead_id")
        if lead_id:
            await db.leads.update_one({"lead_id": lead_id}, {"$set": {
                "last_activity_date": now_iso,
                "last_visit_date": now_iso,
                "next_followup_date": next_fu or "",
                "updated_at": now_iso,
            }})
            await db.call_notes.insert_one({
                "note_id": f"cn_{uuid.uuid4().hex[:8]}",
                "lead_id": lead_id,
                "type": "meeting",
                "content": note,
                "outcome": note,
                "created_by": user["email"],
                "created_by_name": user["name"],
                "created_at": now_iso,
            })
        await log_activity(user["email"], "today_mark_done_visit", "visit_plan", plan_id, note[:120])
        return {"ok": True, "kind": kind}

    lead_id = body.get("lead_id")
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id required")
    note_id = f"cn_{uuid.uuid4().hex[:8]}"
    await db.call_notes.insert_one({
        "note_id": note_id,
        "lead_id": lead_id,
        "type": "call",
        "content": note,
        "outcome": note,
        "created_by": user["email"],
        "created_by_name": user["name"],
        "created_at": now_iso,
    })
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {
        "last_activity_date": now_iso,
        "next_followup_date": next_fu,
        "updated_at": now_iso,
    }})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    await log_activity(user["email"], "today_mark_done_call", "lead", lead_id, note[:120])
    return {"ok": True, "kind": kind, "note_id": note_id}


# ==================== ACTIVITY LOGS ====================

@router.get("/activity-logs")
async def get_activity_logs(
    request: Request,
    entity_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    search: Optional[str] = None,
    user_email: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if user_email:
        query["user_email"] = {"$regex": user_email, "$options": "i"}
    if search:
        query["$or"] = [
            {"action": {"$regex": search, "$options": "i"}},
            {"user_email": {"$regex": search, "$options": "i"}},
            {"details": {"$regex": search, "$options": "i"}},
            {"entity_id": {"$regex": search, "$options": "i"}},
        ]
    if from_date or to_date:
        ts_filter = {}
        if from_date:
            ts_filter["$gte"] = from_date
        if to_date:
            ts_filter["$lte"] = to_date + "T23:59:59"
        query["timestamp"] = ts_filter
    total = await db.activity_logs.count_documents(query)
    logs = await db.activity_logs.find(query, {"_id": 0}).sort("timestamp", -1).skip(offset).to_list(limit)
    return {"logs": logs, "total": total, "offset": offset, "limit": limit}


# ==================== NOTIFICATIONS ====================

@router.get("/notifications")
async def get_notifications(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["assigned_to"] = user["email"]
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return notifications


@router.put("/notifications/read-all")
async def mark_all_read(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["assigned_to"] = user["email"]
    await db.notifications.update_many(query, {"$set": {"is_read": True}})
    return {"message": "All notifications marked as read"}


# ==================== IMPORT ====================

@router.post("/import/preview")
async def preview_import(file=None, entity_type: str = "contacts", request: Request = None):
    from fastapi import UploadFile, File
    if request:
        await get_current_user(request)
    if file is None:
        raise HTTPException(status_code=400, detail="file required")
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    import csv as _csv
    import io as _io
    reader = _csv.DictReader(_io.StringIO(text))
    rows = []
    for i, row in enumerate(reader):
        status = "ok"
        error = ""
        if entity_type == "contacts":
            if not row.get("name", "").strip() or not row.get("phone", "").strip():
                status = "error"
                error = "Missing name or phone"
        elif entity_type == "inventory":
            if not row.get("code", "").strip() or not row.get("name", "").strip():
                status = "error"
                error = "Missing code or name"
        elif entity_type == "schools":
            if not row.get("school_name", "").strip() or not row.get("email", "").strip():
                status = "error"
                error = "Missing school_name or email"
        rows.append({"row_num": i + 1, "data": dict(row), "status": status, "error": error})
    return {
        "total_rows": len(rows),
        "valid": sum(1 for r in rows if r["status"] == "ok"),
        "errors": sum(1 for r in rows if r["status"] == "error"),
        "rows": rows,
    }


@router.post("/import/execute")
async def execute_import(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    entity_type = body.get("entity_type", "contacts")
    rows = body.get("rows", [])
    created = 0
    failed = 0
    for row_data in rows:
        if row_data.get("status") != "ok":
            failed += 1
            continue
        data = row_data.get("data", {})
        try:
            if entity_type == "contacts":
                existing = await db.contacts.find_one({
                    "phone": data.get("phone", "").strip(),
                    "name": data.get("name", "").strip(),
                })
                if existing:
                    failed += 1
                    continue
                await db.contacts.insert_one({
                    "contact_id": f"con_{uuid.uuid4().hex[:12]}",
                    "name": data.get("name", "").strip(),
                    "phone": data.get("phone", "").strip(),
                    "email": data.get("email", "").strip(),
                    "company": data.get("company", "").strip(),
                    "designation": data.get("designation", "").strip(),
                    "source": data.get("source", "").strip(),
                    "notes": data.get("notes", "").strip(),
                    "status": "active",
                    "converted_to_lead": False,
                    "lead_id": None,
                    "created_by": user["email"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                created += 1
            elif entity_type == "schools":
                existing = await db.schools.find_one({"email": data.get("email", "").strip()})
                if existing:
                    failed += 1
                    continue
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                doc = {
                    "school_id": school_id,
                    "school_name": data.get("school_name", "").strip(),
                    "email": data.get("email", "").strip(),
                    "phone": data.get("phone", "").strip(),
                    "school_type": data.get("school_type", "CBSE").strip(),
                    "city": data.get("city", "").strip(),
                    "state": data.get("state", "").strip(),
                    "primary_contact_name": data.get("contact_name", "").strip(),
                    "school_strength": int(data.get("school_strength", 0) or 0),
                    "created_by": user["email"],
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                pwd = data.get("password", "").strip()
                if pwd:
                    doc["password_hash"] = hash_password(pwd)
                await db.schools.insert_one(doc)
                created += 1
        except Exception:
            failed += 1

    log_id = f"imp_{uuid.uuid4().hex[:8]}"
    await db.import_logs.insert_one({
        "log_id": log_id,
        "entity_type": entity_type,
        "total_rows": len(rows),
        "success_count": created,
        "failed_count": failed,
        "uploaded_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"created": created, "failed": failed, "log_id": log_id}


@router.get("/import/logs")
async def get_import_logs(request: Request):
    await get_current_user(request)
    logs = await db.import_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return logs


# ==================== EXPORT ====================

@router.get("/export/quotations")
async def export_quotations(request: Request):
    user = await get_current_user(request)
    quotations = await db.quotations.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Quote Number", "School Name", "Principal Name", "Package", "Sales Person",
                     "Subtotal", "GST", "Discount 1%", "Discount 2%", "Freight", "Grand Total",
                     "Status", "Catalogue Status", "Created At"])
    for q in quotations:
        writer.writerow([
            q.get("quote_number"), q.get("school_name"), q.get("principal_name"),
            q.get("package_name"), q.get("sales_person_name"),
            q.get("subtotal", 0), q.get("gst_amount", 0),
            q.get("discount1_pct", 0), q.get("discount2_pct", 0),
            q.get("freight_total", 0), q.get("grand_total", 0),
            q.get("quotation_status"), q.get("catalogue_status"), q.get("created_at"),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=quotations_export.csv"})


@router.get("/export/inventory")
async def export_inventory(request: Request):
    user = await get_current_user(request)
    dies = await db.dies.find({}, {"_id": 0}).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Code", "Name", "Type", "Stock Qty", "Reserved Qty", "Available", "Min Level", "Status"])
    for d in dies:
        avail = d.get("stock_qty", 0) - d.get("reserved_qty", 0)
        status = "Low Stock" if d.get("stock_qty", 0) < d.get("min_level", 5) else "OK"
        writer.writerow([
            d.get("code"), d.get("name"), d.get("type"),
            d.get("stock_qty", 0), d.get("reserved_qty", 0), avail,
            d.get("min_level", 5), status,
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=inventory_export.csv"})


@router.get("/export/attendance")
async def export_attendance(request: Request):
    user = await get_current_user(request)
    records = await db.attendance.find({}, {"_id": 0}).sort("date", -1).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "Email", "Date", "Work Type", "Check In Time", "Check In Address",
                     "Check Out Time", "Check Out Address"])
    for a in records:
        writer.writerow([
            a.get("sales_person_name"), a.get("sales_person_email"), a.get("date"),
            a.get("work_type"), a.get("check_in_time"), a.get("check_in_address"),
            a.get("check_out_time"), a.get("check_out_address"),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=attendance_export.csv"})


@router.get("/export/expenses")
async def export_expenses(request: Request):
    user = await get_current_user(request)
    expenses = await db.travel_expenses.find({}, {"_id": 0}).sort("date", -1).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "Date", "From", "To", "Distance KM", "Transport Mode", "Rate/KM", "Amount", "Status"])
    for e in expenses:
        writer.writerow([
            e.get("sales_person_name"), e.get("date"),
            e.get("from_location"), e.get("to_location"),
            e.get("distance_km"), e.get("transport_mode"),
            e.get("rate_per_km"), e.get("amount"), e.get("status"),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=expenses_export.csv"})


@router.get("/export/field-visits")
async def export_field_visits(request: Request):
    user = await get_current_user(request)
    visits = await db.field_visits.find({}, {"_id": 0}).sort("visit_date", -1).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "School Name", "Contact Person", "Contact Phone",
                     "Visit Date", "Visit Time", "Status", "Purpose", "Outcome", "Address"])
    for v in visits:
        writer.writerow([
            v.get("sales_person_name"), v.get("school_name"),
            v.get("contact_person"), v.get("contact_phone"),
            v.get("visit_date"), v.get("visit_time"), v.get("status"),
            v.get("purpose"), v.get("outcome"),
            v.get("visited_address") or v.get("planned_address"),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=field_visits_export.csv"})


@router.get("/export/users")
async def export_users(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Email", "Role", "Phone", "Modules", "Active", "Created At"])
    for u in users:
        writer.writerow([
            u.get("name"), u.get("email"), u.get("role"),
            u.get("phone", ""), ", ".join(u.get("assigned_modules", [])),
            u.get("is_active", True), u.get("created_at"),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=users_export.csv"})


@router.get("/export/contacts")
async def export_contacts(request: Request):
    await get_current_user(request)
    contacts_list = await db.contacts.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Phone", "Email", "Company", "Designation", "Source", "Notes", "Status", "Converted", "Lead ID", "Created At"])
    for c in contacts_list:
        writer.writerow([
            c.get("name"), c.get("phone"), c.get("email"),
            c.get("company"), c.get("designation"), c.get("source"),
            c.get("notes"), c.get("status", "active"),
            "Yes" if c.get("converted_to_lead") else "No",
            c.get("lead_id", ""), c.get("created_at", ""),
        ])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=contacts_export.csv"})


# ==================== AI INSIGHTS ====================

@router.post("/ai/insights")
async def get_ai_insights(query: str, request: Request):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    import os as _os
    user = await get_current_user(request)

    quotations = await db.quotations.find({}, {"_id": 0}).to_list(100)
    dies = await db.dies.find({}, {"_id": 0}).to_list(100)
    alerts = await db.purchase_alerts.find({"status": "pending"}, {"_id": 0}).to_list(100)

    context = f"""Quotations: {len(quotations)} total
Dies inventory: {len(dies)} items
Pending alerts: {len(alerts)}

User query: {query}"""

    chat = LlmChat(
        api_key=_os.environ.get("EMERGENT_LLM_KEY"),
        session_id=f"insights_{user['user_id']}",
        system_message="You are a business analytics assistant for SmartShape Pro inventory and sales management. Provide concise, actionable insights.",
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    message = UserMessage(text=context)
    response = await chat.send_message(message)

    return {"insight": response}


# ==================== AUTO-REMINDER BACKGROUND TASK ====================

async def run_auto_reminders():
    while True:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            overdue_tasks = await db.tasks.find({
                "status": "pending",
                "due_date": {"$lt": today},
            }, {"_id": 0}).to_list(500)

            for task in overdue_tasks:
                await db.tasks.update_one(
                    {"task_id": task["task_id"], "status": "pending"},
                    {"$set": {"status": "missed"}},
                )
                await db.notifications.update_one(
                    {"task_id": task["task_id"], "type": "overdue_task"},
                    {"$set": {
                        "task_id": task["task_id"],
                        "type": "overdue_task",
                        "title": f"Overdue: {task['title']}",
                        "message": f"Task '{task['title']}' was due on {task['due_date']}",
                        "assigned_to": task.get("assigned_to"),
                        "lead_id": task.get("lead_id"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

            week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            stale_leads = await db.leads.find({
                "stage": {"$nin": ["won", "lost"]},
                "updated_at": {"$lt": week_ago},
            }, {"_id": 0}).to_list(500)

            for lead in stale_leads:
                await db.notifications.update_one(
                    {"lead_id": lead["lead_id"], "type": "stale_lead"},
                    {"$set": {
                        "lead_id": lead["lead_id"],
                        "type": "stale_lead",
                        "title": f"No activity: {lead['company_name']}",
                        "message": f"Lead '{lead['company_name']}' has no activity since {lead['updated_at'][:10]}",
                        "assigned_to": lead.get("assigned_to"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

            three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
            pending_quots = await db.quotations.find({
                "quotation_status": {"$in": ["draft", "sent"]},
                "created_at": {"$lt": three_days_ago},
            }, {"_id": 0}).to_list(500)

            for q in pending_quots:
                await db.notifications.update_one(
                    {"quotation_id": q["quotation_id"], "type": "pending_quotation"},
                    {"$set": {
                        "quotation_id": q["quotation_id"],
                        "type": "pending_quotation",
                        "title": f"Pending: {q['quote_number']}",
                        "message": f"Quotation {q['quote_number']} for {q['school_name']} is still {q['quotation_status']}",
                        "assigned_to": q.get("sales_person_email"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

            # ── Birthday & Anniversary reminders ──────────────────────────────
            today_mmdd = datetime.now(timezone.utc).strftime("%m-%d")

            birthday_contacts = await db.contacts.find(
                {"birthday": {"$regex": f"-{today_mmdd}$"}},
                {"_id": 0, "contact_id": 1, "name": 1, "company": 1, "phone": 1, "birthday": 1},
            ).to_list(200)
            for c in birthday_contacts:
                await db.notifications.update_one(
                    {"contact_id": c["contact_id"], "type": "birthday_today", "date": today},
                    {"$set": {
                        "contact_id": c["contact_id"],
                        "type": "birthday_today",
                        "date": today,
                        "title": f"Birthday Today: {c['name']}",
                        "message": f"{c['name']} ({c.get('company', '')}) has a birthday today! Phone: {c.get('phone', 'N/A')}",
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

            anniversary_schools = await db.schools.find(
                {"anniversary": {"$regex": f"-{today_mmdd}$"}},
                {"_id": 0, "school_id": 1, "school_name": 1, "anniversary": 1, "primary_contact_name": 1, "phone": 1},
            ).to_list(200)
            for s in anniversary_schools:
                await db.notifications.update_one(
                    {"school_id": s["school_id"], "type": "anniversary_today", "date": today},
                    {"$set": {
                        "school_id": s["school_id"],
                        "type": "anniversary_today",
                        "date": today,
                        "title": f"Anniversary: {s['school_name']}",
                        "message": f"{s['school_name']} celebrates their anniversary today! Contact: {s.get('primary_contact_name', '')} {s.get('phone', '')}",
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                )

            # ── Scheduled WhatsApp messages ──────────────────────────────
            now_iso_full = datetime.now(timezone.utc).isoformat()
            due_scheduled = await db.whatsapp_scheduled.find(
                {"status": "pending", "scheduled_at": {"$lte": now_iso_full}},
                {"_id": 0}
            ).to_list(100)

            wa_cfg = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
            for sched in due_scheduled:
                phone = sched.get("phone", "")
                message = sched.get("message", "")
                new_status = "failed"
                if phone and message and wa_cfg and wa_cfg.get("username"):
                    try:
                        import httpx as _httpx
                        async with _httpx.AsyncClient(timeout=15) as client:
                            resp = await client.post(
                                "https://app.messageautosender.com/message/new",
                                data={"username": wa_cfg["username"], "password": wa_cfg["password"],
                                      "receiverMobileNo": phone, "message": message},
                            )
                        new_status = "sent" if 200 <= resp.status_code < 300 else "failed"
                    except Exception:
                        new_status = "failed"
                await db.whatsapp_scheduled.update_one(
                    {"schedule_id": sched["schedule_id"]},
                    {"$set": {"status": new_status, "sent_at": now_iso_full}}
                )
                await db.whatsapp_logs.insert_one({
                    "log_id": f"wal_{uuid.uuid4().hex[:10]}",
                    "template_id": sched.get("template_id"),
                    "phone": phone,
                    "body": message,
                    "lead_id": sched.get("lead_id"),
                    "send_mode": "scheduled",
                    "status": new_status,
                    "sent_by": sched.get("created_by", "system"),
                    "sent_at": now_iso_full,
                })

            import logging
            logging.info(
                f"Auto-reminder: {len(overdue_tasks)} overdue, {len(stale_leads)} stale, "
                f"{len(pending_quots)} pending quots, {len(birthday_contacts)} birthdays, "
                f"{len(anniversary_schools)} anniversaries, {len(due_scheduled)} scheduled WA fired"
            )
        except Exception as e:
            import logging
            logging.error(f"Auto-reminder error: {e}")

        await asyncio.sleep(60)
