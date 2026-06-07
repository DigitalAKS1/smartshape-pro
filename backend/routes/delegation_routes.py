"""
Delegation Management System — SmartShape Pro module
Roles: boss (all rights) | delegator (assigns tasks) | delegatee (executes tasks)
"""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Response
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


def _make_change(by: str, field: str, frm, to, note: str = "") -> dict:
    """One append-only audit entry for an instance change_log."""
    return {"at": now_iso(), "by": by, "field": field, "from": frm, "to": to, "note": note}


# fields a delegator/boss may edit on a task definition
TASK_EDITABLE = (
    "title", "description", "priority", "score", "require_verification",
    "requires_image", "is_active", "task_type", "frequency",
    "target_date", "start_date", "end_date", "assignee_ids", "buddy_emp_id",
)

# fields a delegatee may soft-edit on their own instance
INSTANCE_SOFT_FIELDS = ("due_date", "priority", "completion_note")


async def _emp_name(emp_id) -> str:
    """Look up an employee's display name by id (empty string if missing)."""
    if not emp_id:
        return ""
    e = await db.del_employees.find_one({"emp_id": emp_id}, {"_id": 0, "name": 1})
    return e["name"] if e else ""


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
    buddy_emp_id: Optional[str] = ""        # backup owner (can complete if main owner is out)
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
                      linked_entity_id=None, linked_entity_type=None,
                      buddy_emp_id="", buddy_name=""):
    return {
        "instance_id": gen_id("inst"),
        "task_id": task_id, "task_title": title, "task_number": task_number,
        "emp_id": emp["emp_id"], "emp_name": emp["name"],
        "department_id": emp.get("department_id", ""),
        "department_name": emp.get("department_name", ""),
        "delegator_id": delegator_id, "delegator_name": delegator_name,
        "buddy_emp_id": buddy_emp_id or "", "buddy_name": buddy_name or "",
        "due_date": due, "frequency": freq,
        "priority": priority, "score": score,
        "require_verification": require_verification,
        "requires_image": requires_image,
        "linked_entity_id": linked_entity_id,
        "linked_entity_type": linked_entity_type,
        "status": "pending",
        "completed_at": None, "verified_at": None, "verified_by": None,
        "completed_by": "",
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

    buddy_name = await _emp_name(body.buddy_emp_id)

    task_id = gen_id("task")
    task_number = f"TASK-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "task_id": task_id, "task_number": task_number,
        "title": body.title, "description": body.description,
        "task_type": body.task_type, "frequency": body.frequency,
        "target_date": body.target_date, "start_date": body.start_date,
        "end_date": body.end_date, "priority": body.priority,
        "assignee_ids": body.assignee_ids, "assignees": assignees,
        "buddy_emp_id": body.buddy_emp_id or "", "buddy_name": buddy_name,
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
              buddy_emp_id=body.buddy_emp_id or "", buddy_name=buddy_name,
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
        buddy_name = await _emp_name(tin.buddy_emp_id)
        task_id = gen_id("task")
        task_number = f"TASK-{uuid.uuid4().hex[:6].upper()}"
        doc = {
            "task_id": task_id, "task_number": task_number,
            "title": tin.title, "description": tin.description,
            "task_type": tin.task_type, "frequency": tin.frequency,
            "target_date": tin.target_date, "start_date": tin.start_date,
            "end_date": tin.end_date, "priority": tin.priority,
            "assignee_ids": tin.assignee_ids, "assignees": assignees,
            "buddy_emp_id": tin.buddy_emp_id or "", "buddy_name": buddy_name,
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
                  buddy_emp_id=tin.buddy_emp_id or "", buddy_name=buddy_name,
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

async def _resync_pending_instances(task: dict):
    """Make PENDING instances match the task definition.
    Never touches completed/verified instances (history is preserved)."""
    task_id = task["task_id"]

    # desired (emp_id, due_date) pairs from the current definition
    if task.get("task_type") == "onetime":
        dates = [task.get("target_date") or today_str()]
    else:
        dates = _recurring_dates(
            task.get("frequency", "custom"),
            task.get("start_date") or today_str(),
            task.get("end_date") or today_str(),
        )
    assignees = task.get("assignees", [])
    emp_by_id = {a["emp_id"]: a for a in assignees}
    desired = {(a["emp_id"], d) for a in assignees for d in dates}

    existing = await db.del_task_instances.find({"task_id": task_id}).to_list(5000)

    # delete pending instances no longer wanted
    kept = []
    for inst in existing:
        key = (inst["emp_id"], inst["due_date"])
        if inst.get("status") == "pending" and key not in desired:
            await db.del_task_instances.delete_one({"instance_id": inst["instance_id"]})
        else:
            kept.append(inst)

    covered = {(i["emp_id"], i["due_date"]) for i in kept}

    # create instances for newly-desired (emp, date) pairs
    freq = "onetime" if task.get("task_type") == "onetime" else task.get("frequency", "custom")
    kw = dict(
        task_id=task_id, task_number=task["task_number"], title=task["title"],
        priority=task.get("priority", "medium"), score=task.get("score", 0),
        require_verification=task.get("require_verification", False),
        requires_image=task.get("requires_image", False),
        delegator_id=task.get("delegator_id"), delegator_name=task.get("delegator_name", ""),
        buddy_emp_id=task.get("buddy_emp_id", ""), buddy_name=task.get("buddy_name", ""),
        linked_entity_id=task.get("linked_entity_id"),
        linked_entity_type=task.get("linked_entity_type"),
    )
    new_insts = []
    for (emp_id, d) in desired:
        if (emp_id, d) in covered:
            continue
        emp = emp_by_id.get(emp_id)
        if not emp:
            continue
        new_insts.append(_make_instance_v2(**kw, emp=emp, due=d, freq=freq))
    if new_insts:
        await db.del_task_instances.insert_many(new_insts)

    # propagate field edits to all remaining pending instances
    await db.del_task_instances.update_many(
        {"task_id": task_id, "status": "pending"},
        {"$set": {
            "task_title": task["title"],
            "priority": task.get("priority", "medium"),
            "score": task.get("score", 0),
            "require_verification": task.get("require_verification", False),
            "requires_image": task.get("requires_image", False),
            "buddy_emp_id": task.get("buddy_emp_id", ""),
            "buddy_name": task.get("buddy_name", ""),
            "updated_at": now_iso(),
        }},
    )

    count = await db.del_task_instances.count_documents({"task_id": task_id})
    await db.del_tasks.update_one({"task_id": task_id}, {"$set": {"instance_count": count}})


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    task = await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(404, "Task not found")

    updates = {k: v for k, v in body.items() if k in TASK_EDITABLE}
    if not updates:
        return task
    updates["updated_at"] = now_iso()
    updates["updated_by"] = user.get("email")

    # if assignees change, refresh the cached assignee details
    if "assignee_ids" in updates:
        assignees = []
        for aid in updates["assignee_ids"]:
            emp = await db.del_employees.find_one(
                {"emp_id": aid},
                {"_id": 0, "emp_id": 1, "name": 1, "department_id": 1, "department_name": 1},
            )
            if emp:
                assignees.append(emp)
        updates["assignees"] = assignees

    # if buddy changes, refresh the cached buddy name
    if "buddy_emp_id" in updates:
        updates["buddy_name"] = await _emp_name(updates["buddy_emp_id"])

    await db.del_tasks.update_one({"task_id": task_id}, {"$set": updates})
    new_task = await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})
    await _resync_pending_instances(new_task)
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
    buddy_emp_id: Optional[str] = None,
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
    if buddy_emp_id:  q["buddy_emp_id"] = buddy_emp_id
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

def _completed_by(actor: dict, inst: dict) -> str:
    """'buddy' if the buddy (not the owner) closed it, else 'owner'."""
    aid = actor.get("emp_id")
    if aid and aid == inst.get("buddy_emp_id") and aid != inst.get("emp_id"):
        return "buddy"
    return "owner"


@router.post("/instances/{instance_id}/complete")
async def complete_instance(instance_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
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
            "completed_by": _completed_by(actor, inst),
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
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
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
                  "completed_by": _completed_by(actor, inst),
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


@router.patch("/instances/{instance_id}")
async def patch_instance(instance_id: str, request: Request):
    """Delegatee soft-edit: due_date / priority / completion_note, all change-logged."""
    user = await get_current_user(request)
    body = await request.json()
    inst = await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "Instance not found")

    updates, logs = {}, []
    for f in INSTANCE_SOFT_FIELDS:
        if f in body and body[f] != inst.get(f):
            updates[f] = body[f]
            logs.append(_make_change(user.get("email", ""), f, inst.get(f), body[f]))
    if not updates:
        return inst
    updates["updated_at"] = now_iso()
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": updates, "$push": {"change_log": {"$each": logs}}},
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})


# ══════════════════════════════════════════════════════════════════════════════
# REASSIGNMENT REQUESTS  +  NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def _resolve_actor(user: dict) -> dict:
    """Resolve the logged-in user to a delegation actor (roles + boss flag)."""
    emp = await db.del_employees.find_one({"email": user.get("email")}, {"_id": 0})
    if not emp:
        # unlinked → treat as boss (matches /my-context fallback)
        return {"emp_id": None, "name": user.get("name") or user.get("email"),
                "roles": ["boss"], "is_boss": True}
    roles = emp.get("roles", [])
    return {"emp_id": emp["emp_id"], "name": emp.get("name"),
            "roles": roles, "is_boss": "boss" in roles}


async def _notify(emp_id, ntype: str, title: str, body: str, link_instance_id=None):
    """Insert a polled in-app notification. No-op if emp_id is falsy."""
    if not emp_id:
        return
    await db.del_notifications.insert_one({
        "notif_id": gen_id("ntf"), "emp_id": emp_id, "type": ntype,
        "title": title, "body": body, "link_instance_id": link_instance_id,
        "is_read": False, "created_at": now_iso(),
    })


@router.post("/instances/{instance_id}/reassign-request")
async def create_reassign_request(instance_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    body = await request.json()
    to_emp_id = body.get("to_emp_id")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required")
    if not to_emp_id:
        raise HTTPException(400, "Target employee is required")

    inst = await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "Instance not found")
    if inst.get("status") in ("completed", "verified"):
        raise HTTPException(400, "Task is already done")
    if to_emp_id == inst.get("emp_id"):
        raise HTTPException(400, "Already assigned to that person")

    to_emp = await db.del_employees.find_one(
        {"emp_id": to_emp_id, "is_active": True}, {"_id": 0})
    if not to_emp:
        raise HTTPException(400, "Target employee not found")

    req = {
        "request_id": gen_id("rr"), "instance_id": instance_id,
        "task_id": inst.get("task_id"), "task_title": inst.get("task_title"),
        "delegator_id": inst.get("delegator_id"),
        "from_emp_id": inst.get("emp_id"), "from_emp_name": inst.get("emp_name"),
        "to_emp_id": to_emp_id, "to_emp_name": to_emp.get("name"),
        "requested_by": user.get("email"), "requested_by_name": actor["name"],
        "reason": reason, "status": "pending",
        "approver": None, "approver_name": None,
        "decided_at": None, "decision_note": None,
        "created_at": now_iso(),
    }
    await db.del_reassign_requests.insert_one(req)

    # notify the delegator + all bosses (they can approve)
    targets = set()
    if inst.get("delegator_id"):
        targets.add(inst["delegator_id"])
    bosses = await db.del_employees.find(
        {"roles": "boss", "is_active": True}, {"_id": 0, "emp_id": 1}).to_list(100)
    for b in bosses:
        targets.add(b["emp_id"])
    for tid in targets:
        await _notify(
            tid, "reassign_requested", "Reassignment requested",
            f"{actor['name']} asks to move \"{inst.get('task_title')}\" "
            f"from {inst.get('emp_name')} to {to_emp.get('name')}.",
            instance_id)
    return await db.del_reassign_requests.find_one(
        {"request_id": req["request_id"]}, {"_id": 0})


@router.get("/reassign-requests")
async def list_reassign_requests(request: Request, status: Optional[str] = None):
    """Approvals inbox. Boss sees all; a delegator sees requests for tasks they delegate."""
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    q = {}
    if status:
        q["status"] = status
    rows = await db.del_reassign_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    if actor["is_boss"]:
        return rows
    return [r for r in rows if r.get("delegator_id") == actor["emp_id"]]


@router.post("/reassign-requests/{request_id}/decide")
async def decide_reassign_request(request_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    body = await request.json()
    decision = body.get("decision")
    note = (body.get("note") or "").strip()
    if decision not in ("approved", "rejected"):
        raise HTTPException(400, "decision must be 'approved' or 'rejected'")

    req = await db.del_reassign_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Request already decided")

    # authorization: a boss OR the task's delegator may decide
    if not (actor["is_boss"] or (actor["emp_id"] and actor["emp_id"] == req.get("delegator_id"))):
        raise HTTPException(403, "Only the delegator or a manager can decide")

    decided = {"status": decision, "approver": user.get("email"),
               "approver_name": actor["name"], "decided_at": now_iso(),
               "decision_note": note}

    if decision == "rejected":
        await db.del_reassign_requests.update_one({"request_id": request_id}, {"$set": decided})
        requester = await db.del_employees.find_one(
            {"email": req["requested_by"]}, {"_id": 0, "emp_id": 1})
        if requester:
            await _notify(requester["emp_id"], "reassign_decided", "Reassignment rejected",
                          f"Request to move \"{req['task_title']}\" was rejected."
                          + (f" Note: {note}" if note else ""), req["instance_id"])
        return await db.del_reassign_requests.find_one({"request_id": request_id}, {"_id": 0})

    # approved → move the instance to the new owner
    inst = await db.del_task_instances.find_one({"instance_id": req["instance_id"]}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "Instance no longer exists")
    if inst.get("status") in ("completed", "verified"):
        await db.del_reassign_requests.update_one(
            {"request_id": request_id},
            {"$set": {**decided, "status": "rejected",
                      "decision_note": "Task was completed before approval"}})
        raise HTTPException(409, "Task was completed before approval")

    to_emp = await db.del_employees.find_one({"emp_id": req["to_emp_id"]}, {"_id": 0}) or {}
    await db.del_task_instances.update_one(
        {"instance_id": req["instance_id"]},
        {"$set": {
            "emp_id": req["to_emp_id"], "emp_name": req["to_emp_name"],
            "department_id": to_emp.get("department_id", inst.get("department_id", "")),
            "department_name": to_emp.get("department_name", inst.get("department_name", "")),
            "updated_at": now_iso(),
         },
         "$inc": {"reassignment_count": 1},
         "$push": {"change_log": _make_change(
             user.get("email", ""), "emp_id", req["from_emp_name"], req["to_emp_name"],
             f"Reassigned: {req['reason']}")}})
    await db.del_reassign_requests.update_one({"request_id": request_id}, {"$set": decided})
    await _notify(req["to_emp_id"], "assigned", "New task assigned to you",
                  f"\"{req['task_title']}\" was reassigned to you.", req["instance_id"])
    await _notify(req["from_emp_id"], "reassign_decided", "Reassignment approved",
                  f"\"{req['task_title']}\" moved to {req['to_emp_name']}.", req["instance_id"])
    return await db.del_reassign_requests.find_one({"request_id": request_id}, {"_id": 0})


@router.get("/notifications")
async def list_notifications(request: Request, unread_only: bool = False):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if not actor["emp_id"]:
        return []
    q = {"emp_id": actor["emp_id"]}
    if unread_only:
        q["is_read"] = False
    return await db.del_notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, request: Request):
    await get_current_user(request)
    await db.del_notifications.update_one({"notif_id": notif_id}, {"$set": {"is_read": True}})
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if actor["emp_id"]:
        await db.del_notifications.update_many(
            {"emp_id": actor["emp_id"], "is_read": False}, {"$set": {"is_read": True}})
    return {"ok": True}


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


# ══════════════════════════════════════════════════════════════════════════════
# PERSONAL DAY-PLAN BLOCKS  (private to each user)
# ══════════════════════════════════════════════════════════════════════════════

PLAN_BLOCK_FIELDS = ("date", "start_time", "end_time", "title", "note", "color", "linked_event_id")


@router.get("/plan-blocks")
async def list_plan_blocks(request: Request, date: Optional[str] = None,
                           date_from: Optional[str] = None, date_to: Optional[str] = None):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if not actor["emp_id"]:
        return []
    q = {"emp_id": actor["emp_id"]}
    if date:
        q["date"] = date
    elif date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    return await db.del_plan_blocks.find(q, {"_id": 0}).sort("start_time", 1).to_list(500)


@router.post("/plan-blocks")
async def create_plan_block(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if not actor["emp_id"]:
        raise HTTPException(400, "Your account is not linked to the team yet")
    body = await request.json()
    title = (body.get("title") or "").strip()
    st, et = body.get("start_time") or "", body.get("end_time") or ""
    if not title:
        raise HTTPException(400, "Title is required")
    if not body.get("date"):
        raise HTTPException(400, "Date is required")
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    doc = {
        "block_id": gen_id("blk"), "emp_id": actor["emp_id"],
        "date": body["date"], "start_time": st, "end_time": et,
        "title": title, "note": body.get("note", ""),
        "color": body.get("color", "#64748b"),
        "linked_event_id": body.get("linked_event_id", ""),
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.del_plan_blocks.insert_one(doc)
    return await db.del_plan_blocks.find_one({"block_id": doc["block_id"]}, {"_id": 0})


@router.patch("/plan-blocks/{block_id}")
async def update_plan_block(block_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    blk = await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})
    if not blk:
        raise HTTPException(404, "Block not found")
    if blk["emp_id"] != actor["emp_id"]:
        raise HTTPException(403, "Not your plan block")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in PLAN_BLOCK_FIELDS}
    st = updates.get("start_time", blk.get("start_time"))
    et = updates.get("end_time", blk.get("end_time"))
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(400, "Title is required")
    if updates:
        updates["updated_at"] = now_iso()
        await db.del_plan_blocks.update_one({"block_id": block_id}, {"$set": updates})
    return await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})


@router.delete("/plan-blocks/{block_id}")
async def delete_plan_block(block_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    blk = await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})
    if not blk:
        raise HTTPException(404, "Block not found")
    if blk["emp_id"] != actor["emp_id"]:
        raise HTTPException(403, "Not your plan block")
    await db.del_plan_blocks.delete_one({"block_id": block_id})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# UNIFIED AGENDA  (calendar aggregation across sources)
# ══════════════════════════════════════════════════════════════════════════════

AGENDA_COLORS = {
    "delegation": "#e94560", "fms": "#8b5cf6", "visit": "#06b6d4",
    "task": "#f59e0b", "followup": "#10b981", "workshop": "#6366f1", "plan": "#64748b",
    "event": "#0ea5e9",
}


def _ev(source, type_, title, date_, entity_id, link, *, start_time=None, end_time=None,
        status=None, priority=None, actions=None, meta=None):
    return {
        "event_id": f"{source}_{entity_id}", "source": source, "type": type_,
        "title": title or "(untitled)", "date": date_,
        "start_time": start_time, "end_time": end_time,
        "status": status, "priority": priority,
        "entity_id": entity_id, "link": link, "color": AGENDA_COLORS.get(source, "#64748b"),
        "actions": actions or [], "meta": meta or {},
    }


async def _resolve_subject(actor: dict, emp_id):
    """Whose calendar to show. Self by default; a team member if boss or a delegation target."""
    if not emp_id or emp_id == actor["emp_id"]:
        own = await db.del_employees.find_one({"emp_id": actor["emp_id"]}, {"_id": 0}) if actor["emp_id"] else None
        return own, True
    # viewing someone else's calendar requires a linked account
    if not actor["emp_id"]:
        raise HTTPException(403, "Your account is not linked to the team")
    target = await db.del_employees.find_one({"emp_id": emp_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Employee not found")
    if not actor["is_boss"]:
        me = await db.del_employees.find_one({"emp_id": actor["emp_id"]}, {"_id": 0}) or {}
        if emp_id not in (me.get("delegation_targets") or []):
            raise HTTPException(403, "You can only view your own team members' calendars")
    return target, False


async def _subject_team(email: str):
    if not email:
        return None
    u = await db.users.find_one({"email": email}, {"_id": 0, "role": 1})
    role = (u or {}).get("role", "")
    return {"admin": "admin", "accounts": "accounts", "store": "store"}.get(role, "sales" if role else None)


async def _agenda_delegation(emp_id, dfrom, dto):
    if not emp_id:
        return []
    rows = await db.del_task_instances.find(
        {"emp_id": emp_id, "due_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        acts = []
        if r.get("status") == "pending":
            acts = ["complete", "reschedule", "reassign"]
        elif r.get("status") == "completed":
            acts = ["verify", "reopen"]
        out.append(_ev(
            "delegation", "delegated" if r.get("delegator_id") else "my_task",
            r.get("task_title"), r["due_date"], r["instance_id"], "/delegation",
            status=r.get("status"), priority=r.get("priority"), actions=acts,
            meta={"delegator_name": r.get("delegator_name", ""), "emp_name": r.get("emp_name", ""),
                  "requires_image": r.get("requires_image", False)},
        ))
    return out


async def _agenda_fms(team, dfrom, dto):
    # FMS stages are team-scoped (no per-person owner). plan_done is an ISO datetime.
    q = {"plan_done": {"$gte": dfrom, "$lte": dto + "T23:59:59"}}
    stages = await db.fms_stages.find(q, {"_id": 0}).to_list(2000)
    if team and team != "admin":
        stages = [s for s in stages if s.get("team") in (team, None, "")]
    flow_ids = list({s["flow_id"] for s in stages if s.get("flow_id")})
    flows = await db.fms_flows.find(
        {"flow_id": {"$in": flow_ids}}, {"_id": 0, "flow_id": 1, "title": 1, "customer_name": 1}
    ).to_list(500)
    fmap = {f["flow_id"]: f for f in flows}
    out = []
    for s in stages:
        pd = s.get("plan_done") or ""
        d, t = (pd[:10], pd[11:16]) if len(pd) >= 16 else (pd[:10], None)
        flow = fmap.get(s.get("flow_id"), {})
        label = s.get("label") or s.get("stage_label") or "Stage"
        acts = ["complete_stage", "open"] if s.get("status") != "done" else ["open"]
        out.append(_ev(
            "fms", "fms_stage", f"{label} — {flow.get('title', '')}".strip(" —"),
            d, s.get("stage_id", ""), "/flow-management",
            start_time=t, status=s.get("status"), actions=acts,
            meta={"flow_id": s.get("flow_id"), "customer_name": flow.get("customer_name", ""),
                  "tat_status": s.get("tat_status", "")},
        ))
    return out


async def _agenda_visits(email, dfrom, dto):
    if not email:
        return []
    rows = await db.visit_plans.find(
        {"assigned_to": email, "visit_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        st = r.get("status")
        acts = ["open"]
        if st in (None, "", "planned"):
            acts = ["checkin", "reschedule", "open"]
        elif st == "checked_in":
            acts = ["checkout", "open"]
        out.append(_ev(
            "visit", "visit", r.get("school_name") or "Visit", r["visit_date"],
            r.get("plan_id", ""), "/visit-planning",
            start_time=(r.get("visit_time") or None), status=st, actions=acts,
            meta={"school_id": r.get("school_id", ""), "assigned_name": r.get("assigned_name", "")},
        ))
    return out


async def _agenda_crm_tasks(email, dfrom, dto):
    if not email:
        return []
    rows = await db.tasks.find(
        {"assigned_to": email, "due_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        done = r.get("status") in ("done", "completed")
        acts = ["open"] if done else ["complete", "reschedule", "open"]
        out.append(_ev(
            "task", "my_task", r.get("title") or "Task", r["due_date"],
            r.get("task_id", ""), "/leads",
            start_time=(r.get("due_time") or None), status=r.get("status"),
            priority=r.get("priority"), actions=acts,
            meta={"lead_id": r.get("lead_id", ""), "lead_name": r.get("lead_name", "")},
        ))
    return out


async def _agenda_followups(email, dfrom, dto):
    if not email:
        return []
    rows = await db.followups.find(
        {"assigned_to": email, "followup_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        ftype = r.get("followup_type") or "call"   # call|meeting|demo
        done = r.get("status") in ("done", "completed")
        acts = ["open"] if done else ["log_outcome", "reschedule", "open"]
        out.append(_ev(
            "followup", ftype, f"{ftype.title()} · {r.get('lead_name', '') or r.get('lead_id', '')}".strip(" ·"),
            r["followup_date"], r.get("followup_id", ""), "/leads",
            start_time=(r.get("followup_time") or None), status=r.get("status"), actions=acts,
            meta={"lead_id": r.get("lead_id", ""), "outcome": r.get("outcome", "")},
        ))
    return out


async def _agenda_workshops(dfrom, dto):
    # org-wide; platform zoom/meet/physical
    rows = await db.training_sessions.find(
        {"date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(1000)
    out = []
    for r in rows:
        platform = r.get("platform", "zoom")
        type_ = "physical_workshop" if platform == "physical" else "zoom_workshop"
        acts = ["open"]
        if r.get("meeting_link"):
            acts = ["join", "set_status", "open"]
        out.append(_ev(
            "workshop", type_, r.get("title") or "Workshop", r.get("date", ""),
            r.get("session_id", ""), "/leads",
            start_time=(r.get("time") or None), status=r.get("status"), actions=acts,
            meta={"platform": platform, "meeting_link": r.get("meeting_link", ""),
                  "location": r.get("location", ""), "org_wide": True},
        ))
    return out


@router.get("/agenda")
async def get_agenda(request: Request):
    from_ = request.query_params.get("from")
    to_ = request.query_params.get("to")
    emp_id = request.query_params.get("emp_id")
    if not from_ or not to_:
        raise HTTPException(400, "from and to (YYYY-MM-DD) are required")
    try:
        days = (date.fromisoformat(to_) - date.fromisoformat(from_)).days
    except Exception:
        raise HTTPException(400, "Invalid date format; use YYYY-MM-DD")
    if days < 0 or days > 62:
        raise HTTPException(400, "Range must be between 0 and 62 days")

    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    subject, is_self = await _resolve_subject(actor, emp_id)
    if not subject:
        return {"from": from_, "to": to_, "subject_emp_id": None, "events": []}

    s_emp = subject["emp_id"]
    s_email = subject.get("email", "")
    s_team = await _subject_team(s_email)

    events = []
    events += await _agenda_delegation(s_emp, from_, to_)
    events += await _agenda_fms(s_team, from_, to_)
    events += await _agenda_visits(s_email, from_, to_)
    events += await _agenda_crm_tasks(s_email, from_, to_)
    events += await _agenda_followups(s_email, from_, to_)
    events += await _agenda_workshops(from_, to_)
    events += await _agenda_events(s_emp, s_email, from_, to_)
    if is_self:
        blocks = await db.del_plan_blocks.find(
            {"emp_id": s_emp, "date": {"$gte": from_, "$lte": to_}}, {"_id": 0}
        ).to_list(500)
        for b in blocks:
            events.append(_ev(
                "plan", "plan_block", b.get("title"), b["date"], b["block_id"], "/delegation",
                start_time=b.get("start_time") or None, end_time=b.get("end_time") or None,
                actions=["edit", "delete"], meta={"note": b.get("note", ""),
                                                  "linked_event_id": b.get("linked_event_id", "")},
            ))

    return {"from": from_, "to": to_, "subject_emp_id": s_emp, "is_self": is_self,
            "subject_team": s_team, "events": events}


# ══════════════════════════════════════════════════════════════════════════════
# COLLABORATIVE CALENDAR EVENTS  (cal_events)
# ══════════════════════════════════════════════════════════════════════════════

EVENT_EDITABLE = ("title", "description", "location", "color", "date", "start_time", "end_time", "all_day")


async def _build_collaborators(creator_email, creator_emp_id, creator_name, emp_ids, emails):
    collab, seen = [], set()
    if creator_email:
        collab.append({"type": "user", "emp_id": creator_emp_id, "email": creator_email,
                       "name": creator_name or "", "response": "accepted"})
        seen.add(creator_email.lower())
    for eid in (emp_ids or []):
        e = await db.del_employees.find_one({"emp_id": eid}, {"_id": 0, "emp_id": 1, "name": 1, "email": 1})
        if e and (e.get("email", "").lower() not in seen):
            collab.append({"type": "user", "emp_id": e["emp_id"], "email": e.get("email", ""),
                           "name": e.get("name", ""), "response": "pending"})
            if e.get("email"):
                seen.add(e["email"].lower())
    for em in (emails or []):
        em = (em or "").strip()
        if em and em.lower() not in seen:
            collab.append({"type": "email", "emp_id": None, "email": em, "name": "", "response": "pending"})
            seen.add(em.lower())
    return collab


@router.post("/events")
async def create_event(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "Title is required")
    if not body.get("date"):
        raise HTTPException(400, "Date is required")
    st, et = body.get("start_time") or "", body.get("end_time") or ""
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    collab = await _build_collaborators(user.get("email"), actor["emp_id"], actor["name"],
                                        body.get("collaborator_emp_ids"), body.get("collaborator_emails"))
    doc = {
        "event_id": gen_id("evt"), "title": title, "description": body.get("description", ""),
        "location": body.get("location", ""), "color": body.get("color", "#0ea5e9"),
        "date": body["date"], "start_time": st, "end_time": et, "all_day": bool(body.get("all_day")),
        "created_by": user.get("email"), "created_by_emp_id": actor["emp_id"],
        "collaborators": collab, "linked_event_id": body.get("linked_event_id", ""),
        "status": "active", "ext_sync": {}, "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.cal_events.insert_one(doc)
    return await db.cal_events.find_one({"event_id": doc["event_id"]}, {"_id": 0})


@router.patch("/events/{event_id}")
async def update_event(event_id: str, request: Request):
    user = await get_current_user(request)
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev["created_by"] != user.get("email"):
        raise HTTPException(403, "Only the creator can edit this event")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in EVENT_EDITABLE}
    st = updates.get("start_time", ev.get("start_time"))
    et = updates.get("end_time", ev.get("end_time"))
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(400, "Title is required")
    if "collaborator_emp_ids" in body or "collaborator_emails" in body:
        updates["collaborators"] = await _build_collaborators(
            ev["created_by"], ev["created_by_emp_id"], "",
            body.get("collaborator_emp_ids"), body.get("collaborator_emails"))
    if updates:
        updates["updated_at"] = now_iso()
        await db.cal_events.update_one({"event_id": event_id}, {"$set": updates})
    return await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})


@router.delete("/events/{event_id}")
async def cancel_event(event_id: str, request: Request):
    user = await get_current_user(request)
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev["created_by"] != user.get("email"):
        raise HTTPException(403, "Only the creator can cancel this event")
    await db.cal_events.update_one({"event_id": event_id},
                                   {"$set": {"status": "cancelled", "updated_at": now_iso()}})
    return {"ok": True}


@router.post("/events/{event_id}/respond")
async def respond_event(event_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    body = await request.json()
    resp = body.get("response")
    if resp not in ("accepted", "declined"):
        raise HTTPException(400, "response must be 'accepted' or 'declined'")
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    email = (user.get("email") or "").lower()
    matched = any((c.get("emp_id") and c["emp_id"] == actor["emp_id"]) or
                  (c.get("email", "").lower() == email) for c in ev.get("collaborators", []))
    if not matched:
        raise HTTPException(403, "You are not a collaborator on this event")
    await db.cal_events.update_one(
        {"event_id": event_id, "collaborators.email": user.get("email")},
        {"$set": {"collaborators.$.response": resp, "updated_at": now_iso()}})
    return await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})


def _ics_escape(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_dt(date_str, time_str):
    """Return (ics_value, is_all_day_date)."""
    if not time_str:
        return date_str.replace("-", ""), True
    return f"{date_str.replace('-', '')}T{time_str.replace(':', '')}00", False


@router.get("/events/{event_id}.ics")
async def event_ics(event_id: str, request: Request):
    """Single-event iCalendar file — 'Add to calendar' for Google/Apple/Outlook."""
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    email = (user.get("email") or "").lower()
    allowed = ev.get("created_by") == user.get("email") or any(
        (c.get("emp_id") and c["emp_id"] == actor["emp_id"]) or c.get("email", "").lower() == email
        for c in ev.get("collaborators", []))
    if not allowed:
        raise HTTPException(403, "Not your event")

    dtstart, is_date = _ics_dt(ev["date"], ev.get("start_time"))
    dtend, _ = _ics_dt(ev["date"], ev.get("end_time") or ev.get("start_time"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SmartShape Pro//Calendar//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
             f"UID:{ev['event_id']}@smartshape.in", f"DTSTAMP:{stamp}"]
    if is_date:
        lines += [f"DTSTART;VALUE=DATE:{dtstart}", f"DTEND;VALUE=DATE:{dtstart}"]
    else:
        lines += [f"DTSTART;TZID=Asia/Kolkata:{dtstart}", f"DTEND;TZID=Asia/Kolkata:{dtend}"]
    lines.append(f"SUMMARY:{_ics_escape(ev.get('title'))}")
    if ev.get("description"):
        lines.append(f"DESCRIPTION:{_ics_escape(ev['description'])}")
    if ev.get("location"):
        lines.append(f"LOCATION:{_ics_escape(ev['location'])}")
    if ev.get("created_by"):
        lines.append(f"ORGANIZER;CN={_ics_escape(ev['created_by'])}:mailto:{ev['created_by']}")
    for c in ev.get("collaborators", []):
        if c.get("email"):
            lines.append(f"ATTENDEE;CN={_ics_escape(c.get('name') or c['email'])}:mailto:{c['email']}")
    lines += ["STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR"]
    body = "\r\n".join(lines) + "\r\n"
    return Response(content=body, media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="event-{ev["event_id"]}.ics"'})


async def _agenda_events(emp_id, email, dfrom, dto):
    q = {"status": "active", "date": {"$gte": dfrom, "$lte": dto},
         "$or": [{"created_by_emp_id": emp_id}, {"collaborators.emp_id": emp_id},
                 {"collaborators.email": email}]}
    rows = await db.cal_events.find(q, {"_id": 0}).to_list(2000)
    out = []
    for r in rows:
        is_creator = (r.get("created_by_emp_id") == emp_id) or (r.get("created_by") == email)
        my_resp = None
        for c in r.get("collaborators", []):
            if (c.get("emp_id") and c["emp_id"] == emp_id) or (c.get("email", "").lower() == (email or "").lower()):
                my_resp = c.get("response")
        acts = ["edit", "cancel"] if is_creator else ["respond", "open"]
        out.append(_ev(
            "event", "event", r.get("title"), r["date"], r["event_id"], "/delegation",
            start_time=(r.get("start_time") or None), end_time=(r.get("end_time") or None),
            status=r.get("status"), actions=acts,
            meta={"created_by_name": r.get("created_by", ""), "is_creator": is_creator,
                  "my_response": my_resp, "location": r.get("location", ""),
                  "description": r.get("description", ""),
                  "collaborators": [c.get("name") or c.get("email") for c in r.get("collaborators", [])]}))
    return out

