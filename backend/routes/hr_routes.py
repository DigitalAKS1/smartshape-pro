from fastapi import APIRouter, HTTPException, Request
from typing import Optional
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ==================== LEAVE MANAGEMENT ====================

DEFAULT_DESIGNATIONS = [
    {"designation_id": "desg_super_admin", "name": "Super Admin", "code": "super_admin", "role_level": "admin", "default_modules": ["dashboard", "quotations", "inventory", "stock_management", "purchase_alerts", "package_master", "physical_count", "analytics", "payroll", "accounts", "hr", "leave_management", "store", "settings", "user_management", "field_sales", "leads", "sales_portal"], "description": "Full access to all system modules", "is_system": True, "is_active": True},
    {"designation_id": "desg_admin", "name": "Admin", "code": "admin", "role_level": "admin", "default_modules": ["dashboard", "quotations", "inventory", "stock_management", "package_master", "analytics", "accounts", "hr", "leave_management", "store", "settings", "user_management", "leads", "sales_portal"], "description": "Administrative access without sensitive configs", "is_system": True, "is_active": True},
    {"designation_id": "desg_sales_head", "name": "Sales Head", "code": "sales_head", "role_level": "admin", "default_modules": ["dashboard", "quotations", "leads", "field_sales", "analytics", "sales_portal", "leave_management"], "description": "Manages sales team, views analytics, creates quotations", "is_system": True, "is_active": True},
    {"designation_id": "desg_sales_exec", "name": "Sales Executive", "code": "sales_executive", "role_level": "sales_person", "default_modules": ["quotations", "leads", "field_sales", "sales_portal", "leave_management"], "description": "Field sales, lead management, quotation creation", "is_system": True, "is_active": True},
    {"designation_id": "desg_hr_manager", "name": "HR Manager", "code": "hr_manager", "role_level": "admin", "default_modules": ["dashboard", "hr", "payroll", "leave_management", "field_sales", "user_management", "analytics"], "description": "HR operations, payroll, attendance, leave approvals", "is_system": True, "is_active": True},
    {"designation_id": "desg_store_mgr", "name": "Store Manager", "code": "store_manager", "role_level": "admin", "default_modules": ["dashboard", "inventory", "stock_management", "purchase_alerts", "physical_count", "store", "package_master"], "description": "Inventory control, stock management, store operations", "is_system": True, "is_active": True},
    {"designation_id": "desg_accounts", "name": "Accounts Manager", "code": "accounts_manager", "role_level": "admin", "default_modules": ["dashboard", "accounts", "quotations", "payroll", "analytics", "leave_management"], "description": "Financial operations, quotation approval, payroll processing", "is_system": True, "is_active": True},
    {"designation_id": "desg_field_exec", "name": "Field Executive", "code": "field_executive", "role_level": "sales_person", "default_modules": ["field_sales", "sales_portal", "leave_management"], "description": "Field visits, attendance, basic sales portal access", "is_system": True, "is_active": True},
    {"designation_id": "desg_dispatch", "name": "Dispatch Manager", "code": "dispatch_manager", "role_level": "admin", "default_modules": ["dashboard", "inventory", "stock_management", "store", "leave_management"], "description": "Manages dispatches, stock deductions, delivery tracking", "is_system": True, "is_active": True},
]


@router.get("/leaves")
async def get_leaves(request: Request):
    user = await get_current_user(request)
    query = {}
    can_view_all = user.get("role") == "admin" or "hr" in user.get("assigned_modules", [])
    if not can_view_all:
        query["user_email"] = user["email"]
    leaves = await db.leaves.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return leaves


@router.post("/leaves")
async def apply_leave(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    leave_id = f"lv_{uuid.uuid4().hex[:12]}"
    leave_doc = {
        "leave_id": leave_id,
        "user_id": user.get("user_id"),
        "user_email": user["email"],
        "user_name": user["name"],
        "leave_type": body.get("leave_type", "casual"),
        "from_date": body.get("from_date"),
        "to_date": body.get("to_date"),
        "half_day": body.get("half_day", False),
        "reason": body.get("reason", ""),
        "status": "pending",
        "approved_by": None,
        "remarks": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        fd = datetime.fromisoformat(body.get("from_date"))
        td = datetime.fromisoformat(body.get("to_date"))
        days = (td - fd).days + 1
        if body.get("half_day"):
            days = 0.5
        leave_doc["days"] = days
    except Exception:
        leave_doc["days"] = 1

    await db.leaves.insert_one(leave_doc)
    return await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})


@router.put("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, request: Request):
    user = await get_current_user(request)
    can_approve = user.get("role") == "admin" or "hr" in user.get("assigned_modules", [])
    if not can_approve:
        raise HTTPException(status_code=403, detail="Only Admin/HR can approve leaves")
    body = await request.json()
    status = body.get("status", "approved")
    remarks = body.get("remarks", "")
    await db.leaves.update_one({"leave_id": leave_id}, {"$set": {
        "status": status,
        "approved_by": user["email"],
        "remarks": remarks,
    }})
    return await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})


@router.delete("/leaves/{leave_id}")
async def cancel_leave(leave_id: str, request: Request):
    user = await get_current_user(request)
    leave = await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    if leave["user_email"] != user["email"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if leave["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending leaves can be cancelled")
    await db.leaves.delete_one({"leave_id": leave_id})
    return {"message": "Leave cancelled"}


@router.get("/leaves/balance")
async def get_leave_balance(request: Request):
    user = await get_current_user(request)
    email = request.query_params.get("email", user["email"])
    current_year = datetime.now(timezone.utc).year
    year_start = f"{current_year}-01-01"

    approved = await db.leaves.find({
        "user_email": email,
        "status": "approved",
        "from_date": {"$gte": year_start},
    }, {"_id": 0}).to_list(500)

    used = {"casual": 0, "sick": 0, "earned": 0, "half_day": 0}
    for lv in approved:
        lt = lv.get("leave_type", "casual")
        if lv.get("half_day"):
            used["half_day"] += 1
        elif lt in used:
            used[lt] += lv.get("days", 0)

    total = {"casual": 12, "sick": 6, "earned": 15}
    balance = {k: total.get(k, 0) - used.get(k, 0) for k in total}

    return {"total": total, "used": used, "balance": balance, "half_days_used": used["half_day"]}


# ==================== PAYROLL ====================

@router.get("/payroll/reimbursements")
async def get_reimbursements(request: Request, month_year: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["sales_person_email"] = user["email"]
    if month_year:
        query["month_year"] = month_year

    reimbursements = await db.payroll_reimbursements.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(1000)
    return reimbursements


@router.put("/payroll/reimbursements/{reimbursement_id}/approve")
async def approve_reimbursement(reimbursement_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    await db.payroll_reimbursements.update_one(
        {"reimbursement_id": reimbursement_id},
        {"$set": {
            "status": "approved",
            "approved_by": user["email"],
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"message": "Reimbursement approved"}


@router.put("/payroll/reimbursements/{reimbursement_id}/reject")
async def reject_reimbursement(reimbursement_id: str, notes: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    await db.payroll_reimbursements.update_one(
        {"reimbursement_id": reimbursement_id},
        {"$set": {
            "status": "rejected",
            "approved_by": user["email"],
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "notes": notes,
        }},
    )
    return {"message": "Reimbursement rejected"}


# ==================== DESIGNATIONS ====================

@router.get("/designations")
async def get_designations(request: Request):
    await get_current_user(request)
    designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not designations:
        for d in DEFAULT_DESIGNATIONS:
            d["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.designations.insert_one(d)
        designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return designations


@router.post("/designations")
async def create_designation(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    if not body.get("name") or not body.get("code"):
        raise HTTPException(status_code=400, detail="name and code required")
    existing = await db.designations.find_one({"code": body["code"]})
    if existing:
        raise HTTPException(status_code=400, detail="Designation code already exists")
    desg_id = f"desg_{uuid.uuid4().hex[:12]}"
    doc = {
        "designation_id": desg_id,
        "name": body["name"],
        "code": body["code"],
        "role_level": body.get("role_level", "sales_person"),
        "default_modules": body.get("default_modules", []),
        "description": body.get("description", ""),
        "is_system": False,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.designations.insert_one(doc)
    return await db.designations.find_one({"designation_id": desg_id}, {"_id": 0})


@router.put("/designations/{designation_id}")
async def update_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    allowed = {}
    for k in ("name", "description", "default_modules", "role_level", "is_active"):
        if k in body:
            allowed[k] = body[k]
    await db.designations.update_one({"designation_id": designation_id}, {"$set": allowed})
    return await db.designations.find_one({"designation_id": designation_id}, {"_id": 0})


@router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    desg = await db.designations.find_one({"designation_id": designation_id})
    if not desg:
        raise HTTPException(status_code=404, detail="Not found")
    if desg.get("is_system"):
        raise HTTPException(status_code=400, detail="Cannot delete system designations")
    await db.designations.delete_one({"designation_id": designation_id})
    return {"message": "Designation deleted"}
