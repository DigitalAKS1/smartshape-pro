"""
Delegation Management System — SmartShape Pro module
Roles: boss (all rights) | delegator (assigns tasks) | delegatee (executes tasks)
"""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta, date
import uuid, os, mimetypes

from database import db
from auth_utils import get_current_user

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")
os.makedirs(os.path.join(UPLOADS_DIR, "delegation"), exist_ok=True)

router = APIRouter(prefix="/delegation", tags=["delegation"])

# ── helpers ──────────────────────────────────────────────────────────────────

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def today_str():
    return date.today().isoformat()

def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# ══════════════════════════════════════════════════════════════════════════════
# DEPARTMENTS
# ══════════════════════════════════════════════════════════════════════════════

class DeptIn(BaseModel):
    name: str
    description: Optional[str] = ""

@router.get("/departments")
async def list_departments(request: Request):
    await get_current_user(request)
    return await db.del_departments.find({}, {"_id": 0}).sort("name", 1).to_list(200)

@router.post("/departments")
async def create_department(body: DeptIn, request: Request):
    await get_current_user(request)
    doc = {
        "dept_id": gen_id("dept"), "name": body.name,
        "description": body.description, "is_active": True, "created_at": now_iso()
    }
    await db.del_departments.insert_one(doc)
    return await db.del_departments.find_one({"dept_id": doc["dept_id"]}, {"_id": 0})

@router.put("/departments/{dept_id}")
async def update_department(dept_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    safe = {k: v for k, v in body.items() if k in ("name", "description", "is_active")}
    if safe:
        await db.del_departments.update_one({"dept_id": dept_id}, {"$set": safe})
    return await db.del_departments.find_one({"dept_id": dept_id}, {"_id": 0})

@router.delete("/departments/{dept_id}")
async def delete_department(dept_id: str, request: Request):
    await get_current_user(request)
    await db.del_departments.delete_one({"dept_id": dept_id})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# EMPLOYEES
# ══════════════════════════════════════════════════════════════════════════════

class EmpIn(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    department_id: Optional[str] = ""
    department_name: Optional[str] = ""
    roles: List[str] = []          # boss | delegator | delegatee
    buddy_emp_id: Optional[str] = ""
    delegation_targets: List[str] = []   # emp_ids this person is allowed to assign tasks to

_ROLE_MAP = {
    "admin":        ["boss", "delegator"],
    "sales_person": ["delegatee"],
    "store":        ["delegatee"],
    "accounts":     ["delegatee"],
}

async def _sync_users_to_employees():
    """Auto-seed delegation employees from SmartShape users (upsert by email)."""
    app_users = await db.users.find(
        {}, {"_id": 0, "name": 1, "email": 1, "role": 1}
    ).to_list(200)
    existing_emails = {
        e["email"] for e in
        await db.del_employees.find({}, {"_id": 0, "email": 1}).to_list(500)
        if e.get("email")
    }
    inserted = 0
    for u in app_users:
        if not u.get("email") or u["email"] in existing_emails:
            continue
        await db.del_employees.insert_one({
            "emp_id": gen_id("emp"),
            "name": u.get("name") or u["email"].split("@")[0],
            "email": u["email"],
            "phone": "", "department_id": "", "department_name": "",
            "roles": _ROLE_MAP.get(u.get("role", ""), ["delegatee"]),
            "buddy_emp_id": "", "is_active": True,
            "created_at": now_iso(), "created_by": "system",
            "synced_from_users": True,
        })
        inserted += 1
    return inserted

@router.get("/employees")
async def list_employees(request: Request):
    await get_current_user(request)
    await _sync_users_to_employees()   # auto-seed on every load (idempotent)
    return await db.del_employees.find({}, {"_id": 0}).sort("name", 1).to_list(500)

@router.post("/sync-users")
async def sync_users(request: Request):
    """Force-sync all SmartShape users into delegation employees."""
    await get_current_user(request)
    inserted = await _sync_users_to_employees()
    total = await db.del_employees.count_documents({})
    return {"synced": inserted, "total": total}


@router.get("/my-context")
async def get_my_context(request: Request):
    """
    Returns the delegation context for the currently logged-in user:
    - which roles they hold (boss / delegator / delegatee)
    - which employees they are allowed to delegate to (delegation_targets)
    Used by the frontend to show/hide role cards and filter assignee lists.
    """
    user = await get_current_user(request)
    emp = await db.del_employees.find_one({"email": user.get("email")}, {"_id": 0})
    if not emp:
        # Not yet linked — show all roles (admin/boss fallback)
        return {"linked": False, "emp_id": None, "name": None, "roles": [], "delegation_targets": [], "target_employees": []}

    roles = emp.get("roles", [])
    target_ids = emp.get("delegation_targets", [])

    target_employees = []
    if target_ids:
        target_employees = await db.del_employees.find(
            {"emp_id": {"$in": target_ids}, "is_active": True}, {"_id": 0}
        ).to_list(100)

    return {
        "linked": True,
        "emp_id": emp["emp_id"],
        "name": emp.get("name"),
        "roles": roles,
        "delegation_targets": target_ids,
        "target_employees": target_employees,
    }

@router.post("/employees")
async def create_employee(body: EmpIn, request: Request):
    user = await get_current_user(request)
    emp_id = gen_id("emp")
    doc = {
        "emp_id": emp_id, "name": body.name, "email": body.email,
        "phone": body.phone, "department_id": body.department_id,
        "department_name": body.department_name, "roles": body.roles,
        "buddy_emp_id": body.buddy_emp_id, "delegation_targets": body.delegation_targets,
        "is_active": True, "created_at": now_iso(), "created_by": user.get("email"),
    }
    await db.del_employees.insert_one(doc)
    return await db.del_employees.find_one({"emp_id": emp_id}, {"_id": 0})

@router.put("/employees/{emp_id}")
async def update_employee(emp_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    safe = {k: v for k, v in body.items() if k in (
        "name", "email", "phone", "department_id", "department_name",
        "roles", "buddy_emp_id", "is_active", "delegation_targets"
    )}
    if safe:
        await db.del_employees.update_one({"emp_id": emp_id}, {"$set": safe})
    return await db.del_employees.find_one({"emp_id": emp_id}, {"_id": 0})

@router.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str, request: Request):
    await get_current_user(request)
    await db.del_employees.delete_one({"emp_id": emp_id})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# TASKS
# ══════════════════════════════════════════════════════════════════════════════

class TaskIn(BaseModel):
    title: str
    description: Optional[str] = ""
    task_type: str = "onetime"
    frequency: Optional[str] = "custom"
    target_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    priority: str = "medium"
    assignee_ids: List[str] = []
    delegator_id: Optional[str] = None
    department_ids: Optional[List[str]] = []
    score: int = 0
    require_verification: bool = False
    requires_image: bool = False
    # for system-linked tasks (visit plans, etc.)
    linked_entity_id: Optional[str] = None
    linked_entity_type: Optional[str] = None   # visit_plan | order | etc.

def _make_instance(task_id, task_number, title, priority, score,
                   require_verification, emp, delegator_id, delegator_name, due, freq):
    return {
        "instance_id": gen_id("inst"),
        "task_id": task_id, "task_title": title, "task_number": task_number,
        "emp_id": emp["emp_id"], "emp_name": emp["name"],
        "department_id": emp.get("department_id", ""),
        "department_name": emp.get("department_name", ""),
        "delegator_id": delegator_id, "delegator_name": delegator_name,
        "due_date": due, "frequency": freq,
        "priority": priority, "score": score,
        "require_verification": require_verification,
        "requires_image": False,
        "linked_entity_id": None,
        "linked_entity_type": None,
        "status": "pending",
        "completed_at": None, "verified_at": None, "verified_by": None,
        "completion_note": "", "completion_image_url": None, "created_at": now_iso(),
    }

def _make_instance_v2(task_id, task_number, title, priority, score,
                      require_verification, requires_image, emp,
                      delegator_id, delegator_name, due, freq,
                      linked_entity_id=None, linked_entity_type=None):
    return {
        "instance_id": gen_id("inst"),
        "task_id": task_id, "task_title": title, "task_number": task_number,
        "emp_id": emp["emp_id"], "emp_name": emp["name"],
        "department_id": emp.get("department_id", ""),
        "department_name": emp.get("department_name", ""),
        "delegator_id": delegator_id, "delegator_name": delegator_name,
        "due_date": due, "frequency": freq,
        "priority": priority, "score": score,
        "require_verification": require_verification,
        "requires_image": requires_image,
        "linked_entity_id": linked_entity_id,
        "linked_entity_type": linked_entity_type,
        "status": "pending",
        "completed_at": None, "verified_at": None, "verified_by": None,
        "completion_note": "", "completion_image_url": None,
        "created_at": now_iso(),
    }

def _recurring_dates(frequency: str, start: str, end: str) -> List[str]:
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except Exception:
        return []
    dates, cur = [], s
    while cur <= e:
        dates.append(cur.isoformat())
        if frequency == "daily":
            cur += timedelta(days=1)
        elif frequency == "weekly":
            cur += timedelta(weeks=1)
        elif frequency == "monthly":
            m = cur.month + 1
            y = cur.year + (1 if m > 12 else 0)
            m = m if m <= 12 else 1
            try:
                cur = cur.replace(year=y, month=m)
            except ValueError:
                break
        else:
            break
    return dates

@router.get("/tasks")
async def list_tasks(
    request: Request,
    delegator_id: Optional[str] = None,
    status: Optional[str] = None,
):
    await get_current_user(request)
    q = {"is_active": True}
    if delegator_id:
        q["delegator_id"] = delegator_id
    if status:
        q["status"] = status
    return await db.del_tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

@router.post("/tasks")
async def create_task(body: TaskIn, request: Request):
    user = await get_current_user(request)
    today = today_str()

    # Fetch assignees
    assignees = []
    for aid in body.assignee_ids:
        emp = await db.del_employees.find_one(
            {"emp_id": aid}, {"_id": 0, "emp_id": 1, "name": 1, "department_id": 1, "department_name": 1}
        )
        if emp:
            assignees.append(emp)

    # Delegator info
    delegator_name = ""
    if body.delegator_id:
        d = await db.del_employees.find_one({"emp_id": body.delegator_id}, {"_id": 0, "name": 1})
        if d:
            delegator_name = d["name"]

    task_id = gen_id("task")
    task_number = f"TASK-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "task_id": task_id, "task_number": task_number,
        "title": body.title, "description": body.description,
        "task_type": body.task_type, "frequency": body.frequency,
        "target_date": body.target_date, "start_date": body.start_date,
        "end_date": body.end_date, "priority": body.priority,
        "assignee_ids": body.assignee_ids, "assignees": assignees,
        "delegator_id": body.delegator_id, "delegator_name": delegator_name,
        "department_ids": body.department_ids,
        "score": body.score, "require_verification": body.require_verification,
        "status": "active", "is_active": True,
        "created_at": now_iso(), "created_by": user.get("email"),
    }
    await db.del_tasks.insert_one(doc)

    # Generate instances
    instances = []
    kw = dict(task_id=task_id, task_number=task_number, title=body.title,
              priority=body.priority, score=body.score,
              require_verification=body.require_verification,
              requires_image=body.requires_image,
              delegator_id=body.delegator_id, delegator_name=delegator_name,
              linked_entity_id=body.linked_entity_id,
              linked_entity_type=body.linked_entity_type)

    if body.task_type == "onetime":
        due = body.target_date or today
        for emp in assignees:
            instances.append(_make_instance_v2(**kw, emp=emp, due=due, freq="onetime"))
    else:
        dates = _recurring_dates(body.frequency, body.start_date or today, body.end_date or today)
        for due in dates:
            for emp in assignees:
                instances.append(_make_instance_v2(**kw, emp=emp, due=due, freq=body.frequency))

    if instances:
        await db.del_task_instances.insert_many([{**i} for i in instances])

    await db.del_tasks.update_one({"task_id": task_id}, {"$set": {"instance_count": len(instances)}})
    return await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})


@router.post("/tasks/bulk")
async def bulk_create_tasks(request: Request):
    """Create multiple tasks at once from the bulk assignment table."""
    user = await get_current_user(request)
    body = await request.json()
    task_defs = body if isinstance(body, list) else body.get("tasks", [])
    created = 0
    for td in task_defs:
        tin = TaskIn(**{k: v for k, v in td.items() if k in TaskIn.__fields__})
        # reuse the single-task creation logic inline
        today = today_str()
        assignees = []
        for aid in tin.assignee_ids:
            emp = await db.del_employees.find_one(
                {"emp_id": aid}, {"_id": 0, "emp_id": 1, "name": 1, "department_id": 1, "department_name": 1}
            )
            if emp:
                assignees.append(emp)
        if not assignees:
            continue
        delegator_name = ""
        if tin.delegator_id:
            d = await db.del_employees.find_one({"emp_id": tin.delegator_id}, {"_id": 0, "name": 1})
            if d:
                delegator_name = d["name"]
        task_id = gen_id("task")
        task_number = f"TASK-{uuid.uuid4().hex[:6].upper()}"
        doc = {
            "task_id": task_id, "task_number": task_number,
            "title": tin.title, "description": tin.description,
            "task_type": tin.task_type, "frequency": tin.frequency,
            "target_date": tin.target_date, "start_date": tin.start_date,
            "end_date": tin.end_date, "priority": tin.priority,
            "assignee_ids": tin.assignee_ids, "assignees": assignees,
            "delegator_id": tin.delegator_id, "delegator_name": delegator_name,
            "score": tin.score, "require_verification": tin.require_verification,
            "requires_image": tin.requires_image,
            "linked_entity_id": tin.linked_entity_id,
            "linked_entity_type": tin.linked_entity_type,
            "status": "active", "is_active": True,
            "created_at": now_iso(), "created_by": user.get("email"),
        }
        await db.del_tasks.insert_one(doc)
        kw = dict(task_id=task_id, task_number=task_number, title=tin.title,
                  priority=tin.priority, score=tin.score,
                  require_verification=tin.require_verification,
                  requires_image=tin.requires_image,
                  delegator_id=tin.delegator_id, delegator_name=delegator_name,
                  linked_entity_id=tin.linked_entity_id,
                  linked_entity_type=tin.linked_entity_type)
        instances = []
        if tin.task_type == "onetime":
            due = tin.target_date or today
            for emp in assignees:
                instances.append(_make_instance_v2(**kw, emp=emp, due=due, freq="onetime"))
        else:
            dates = _recurring_dates(tin.frequency, tin.start_date or today, tin.end_date or today)
            for due in dates:
                for emp in assignees:
                    instances.append(_make_instance_v2(**kw, emp=emp, due=due, freq=tin.frequency))
        if instances:
            await db.del_task_instances.insert_many(instances)
        created += 1
    return {"created": created}

@router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    safe = {k: v for k, v in body.items() if k in (
        "title", "description", "priority", "score", "require_verification", "is_active"
    )}
    if safe:
        await db.del_tasks.update_one({"task_id": task_id}, {"$set": safe})
    return await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})

@router.delete("/tasks/{task_id}")
async def archive_task(task_id: str, request: Request):
    await get_current_user(request)
    await db.del_tasks.update_one({"task_id": task_id}, {"$set": {"is_active": False}})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# TASK INSTANCES
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/instances")
async def list_instances(
    request: Request,
    emp_id: Optional[str] = None,
    delegator_id: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    priority: Optional[str] = None,
    task_id: Optional[str] = None,
    linked_entity_type: Optional[str] = None,
):
    await get_current_user(request)
    q = {}
    if emp_id:        q["emp_id"] = emp_id
    if delegator_id:  q["delegator_id"] = delegator_id
    if status:        q["status"] = status
    if task_id:       q["task_id"] = task_id
    if priority:      q["priority"] = priority
    if linked_entity_type:
        q["linked_entity_type"] = linked_entity_type
    if date_from or date_to:
        q["due_date"] = {}
        if date_from: q["due_date"]["$gte"] = date_from
        if date_to:   q["due_date"]["$lte"] = date_to
    return await db.del_task_instances.find(q, {"_id": 0}).sort("due_date", -1).to_list(2000)


@router.get("/calendar")
async def get_calendar(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
    emp_id: Optional[str] = None,
):
    """Return instances grouped by date for calendar view."""
    await get_current_user(request)
    today = date.today()
    y = year or today.year
    m = month or today.month
    import calendar as cal
    _, last_day = cal.monthrange(y, m)
    start = f"{y:04d}-{m:02d}-01"
    end   = f"{y:04d}-{m:02d}-{last_day:02d}"
    q = {"due_date": {"$gte": start, "$lte": end}}
    if emp_id:
        q["emp_id"] = emp_id
    items = await db.del_task_instances.find(q, {"_id": 0}).sort("due_date", 1).to_list(5000)
    grouped: dict = {}
    for i in items:
        d = i["due_date"]
        grouped.setdefault(d, []).append(i)
    return {"year": y, "month": m, "days": grouped}


@router.get("/instances/{instance_id}/team")
async def get_instance_team(instance_id: str, request: Request):
    """Return all team members assigned to the same task on the same date."""
    await get_current_user(request)
    inst = await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "Instance not found")
    siblings = await db.del_task_instances.find(
        {"task_id": inst["task_id"], "due_date": inst["due_date"]},
        {"_id": 0}
    ).to_list(100)
    return siblings

@router.post("/instances/{instance_id}/complete")
async def complete_instance(instance_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    inst = await db.del_task_instances.find_one({"instance_id": instance_id})
    if not inst:
        raise HTTPException(404, "Instance not found")
    new_status = "completed"
    if inst.get("require_verification") is False:
        new_status = "verified"  # auto-verify if not required
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": {
            "status": new_status,
            "completed_at": now_iso(),
            "completion_note": body.get("note", ""),
        }}
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})

@router.post("/instances/bulk-complete")
async def bulk_complete(request: Request):
    await get_current_user(request)
    body = await request.json()
    ids = body.get("instance_ids", [])
    note = body.get("note", "Bulk closed")
    if ids:
        await db.del_task_instances.update_many(
            {"instance_id": {"$in": ids}, "status": "pending"},
            {"$set": {"status": "completed", "completed_at": now_iso(), "completion_note": note}}
        )
    return {"closed": len(ids)}

@router.post("/instances/{instance_id}/verify")
async def verify_instance(instance_id: str, request: Request):
    user = await get_current_user(request)
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": {"status": "verified", "verified_at": now_iso(), "verified_by": user.get("name", user.get("email"))}}
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})

@router.post("/instances/{instance_id}/complete-with-image")
async def complete_with_image(instance_id: str, request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    inst = await db.del_task_instances.find_one({"instance_id": instance_id})
    if not inst:
        raise HTTPException(404, "Instance not found")
    ext = os.path.splitext(file.filename)[1].lower() or ".jpg"
    fname = f"{instance_id}{ext}"
    path = os.path.join(UPLOADS_DIR, "delegation", fname)
    with open(path, "wb") as f:
        f.write(await file.read())
    image_url = f"/api/files/delegation/{fname}"
    new_status = "verified" if not inst.get("require_verification") else "completed"
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": {"status": new_status, "completed_at": now_iso(),
                  "completion_image_url": image_url, "completion_note": "Completed with photo"}}
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})


@router.post("/instances/{instance_id}/reopen")
async def reopen_instance(instance_id: str, request: Request):
    await get_current_user(request)
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": {"status": "pending", "completed_at": None, "verified_at": None}}
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/team-summary")
async def get_team_summary(request: Request):
    """Per-employee aggregate stats for role-based overview views."""
    await get_current_user(request)
    today = today_str()

    stats_list = await db.del_task_instances.aggregate([
        {"$group": {
            "_id": "$emp_id",
            "pending":   {"$sum": {"$cond": [{"$eq": ["$status", "pending"]},   1, 0]}},
            "completed": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
            "verified":  {"$sum": {"$cond": [{"$eq": ["$status", "verified"]},  1, 0]}},
            "overdue":   {"$sum": {"$cond": [{"$and": [
                {"$eq": ["$status", "pending"]}, {"$lt": ["$due_date", today]}
            ]}, 1, 0]}},
            "assigners": {"$addToSet": "$delegator_name"},
        }}
    ]).to_list(1000)
    stats = {s["_id"]: s for s in stats_list}

    assignee_list = await db.del_task_instances.aggregate([
        {"$group": {"_id": "$delegator_id", "assignees": {"$addToSet": "$emp_id"}}}
    ]).to_list(500)
    assignees_by = {s["_id"]: s["assignees"] for s in assignee_list}

    employees = await db.del_employees.find({"is_active": True}, {"_id": 0}).to_list(200)
    result = []
    for emp in employees:
        eid = emp["emp_id"]
        s = stats.get(eid, {})
        result.append({
            **emp,
            "pending":     s.get("pending",   0),
            "completed":   s.get("completed", 0),
            "verified":    s.get("verified",  0),
            "overdue":     s.get("overdue",   0),
            "assigners":   [a for a in (s.get("assigners") or []) if a],
            "assignee_ids": assignees_by.get(eid, []),
        })
    return result


@router.get("/dashboard")
async def get_dashboard(
    request: Request,
    emp_id: Optional[str] = None,
    role: Optional[str] = None,
):
    await get_current_user(request)
    today = today_str()
    q: dict = {}
    if emp_id and role == "delegatee":
        q["emp_id"] = emp_id
    elif emp_id and role == "delegator":
        q["delegator_id"] = emp_id
    # boss: no filter

    pending   = await db.del_task_instances.count_documents({**q, "status": "pending"})
    completed = await db.del_task_instances.count_documents({**q, "status": "completed"})
    verified  = await db.del_task_instances.count_documents({**q, "status": "verified"})
    overdue   = await db.del_task_instances.count_documents({**q, "status": "pending", "due_date": {"$lt": today}})
    today_ct  = await db.del_task_instances.count_documents({**q, "due_date": today})
    high_p    = await db.del_task_instances.count_documents({**q, "status": "pending", "priority": "high"})

    total_emp  = await db.del_employees.count_documents({"is_active": True})
    total_dept = await db.del_departments.count_documents({"is_active": True})
    total_tasks = await db.del_tasks.count_documents({"is_active": True})

    # Recent completions
    recent = await db.del_task_instances.find(
        {**q, "status": {"$in": ["completed", "verified"]}},
        {"_id": 0}
    ).sort("completed_at", -1).to_list(5)

    return {
        "pending": pending, "completed": completed, "verified": verified,
        "overdue": overdue, "today": today_ct, "high_priority": high_p,
        "total_employees": total_emp, "total_departments": total_dept,
        "total_tasks": total_tasks, "recent_completions": recent,
    }


# ══════════════════════════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/reports")
async def get_report(
    request: Request,
    period: str = "weekly",
    emp_id: Optional[str] = None,
    role: Optional[str] = None,
):
    await get_current_user(request)
    today = date.today()
    if period == "daily":
        start, end = today.isoformat(), today.isoformat()
    elif period == "weekly":
        start = (today - timedelta(days=today.weekday())).isoformat()
        end = today.isoformat()
    else:
        start = today.replace(day=1).isoformat()
        end = today.isoformat()

    q: dict = {"due_date": {"$gte": start, "$lte": end}}
    if emp_id and role == "delegatee":
        q["emp_id"] = emp_id
    elif emp_id and role == "delegator":
        q["delegator_id"] = emp_id

    items = await db.del_task_instances.find(q, {"_id": 0}).sort("due_date", -1).to_list(2000)
    total     = len(items)
    completed = len([i for i in items if i["status"] in ("completed", "verified")])
    verified  = len([i for i in items if i["status"] == "verified"])
    pending   = len([i for i in items if i["status"] == "pending"])
    overdue   = len([i for i in items if i["status"] == "pending" and i["due_date"] < today.isoformat()])

    # Per-employee breakdown
    from collections import defaultdict
    by_emp: dict = defaultdict(lambda: {"pending": 0, "completed": 0, "verified": 0})
    for i in items:
        by_emp[i["emp_name"]][i["status"]] = by_emp[i["emp_name"]].get(i["status"], 0) + 1

    return {
        "period": period, "start": start, "end": end,
        "total": total, "completed": completed, "verified": verified,
        "pending": pending, "overdue": overdue,
        "completion_rate": round((completed / total * 100) if total else 0, 1),
        "by_employee": [{"name": k, **v} for k, v in by_emp.items()],
        "instances": items,
    }
