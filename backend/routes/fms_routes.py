"""
Flow Management System (FMS) — SmartShape Pro
What → Who → How → When (Planned) vs When (Actual)

Every order, purchase, dispatch, payment is a tracked FLOW with:
- Office-hour-aware TAT (10am–6pm, skip Sunday + holidays)
- Green/Red accountability scoring
- QC eye-button inspection
- Pre-dispatch checklist
- Payment milestone tracking
- Sequential stage dependencies
- Approval gates for critical actions
- Auto WhatsApp/email notifications at 50%, 80%, 100% TAT
"""
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta, date, time as dtime
import uuid, math

IST = timezone(timedelta(hours=5, minutes=30))

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_admin

router = APIRouter(prefix="/fms", tags=["fms"])

# ── helpers ──────────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def now_iso() -> str:
    return now_utc().isoformat()

def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

def today_str() -> str:
    return date.today().isoformat()

async def _log_stage(flow_id: str, stage: dict, action: str,
                     user: Optional[dict] = None, note: str = "",
                     from_status: str = "", to_status: str = ""):
    await db.fms_stage_logs.insert_one({
        "log_id": gen_id("flog"),
        "flow_id": flow_id,
        "stage_id": stage.get("stage_id") if stage else None,
        "stage_label": stage.get("label") if stage else None,
        "action": action,
        "from_status": from_status,
        "to_status": to_status,
        "by": (user or {}).get("email", "system"),
        "note": note,
        "at": now_iso(),
    })

# ── RBAC field masking ────────────────────────────────────────────────────────

# Fields hidden from each team on flow read responses
_MASK_BY_TEAM = {
    "sales": ["amount", "customer_phone"],
    "store": ["amount"],
}

def _mask_flow(flow: dict, team: str) -> dict:
    """Strip sensitive fields from a flow dict for non-privileged teams."""
    hidden = _MASK_BY_TEAM.get(team, [])
    if not hidden:
        return flow
    return {k: ("" if k in hidden else v) for k, v in flow.items()}

# ── Stage edit-lock (write gating) ───────────────────────────────────────────

# Map a stage's logical team to the user teams allowed to act on it.
# (dispatch/purchase/management/field consolidate under store/admin in this ERP.)
_STAGE_TEAM_ALLOWED = {
    "sales":      {"sales", "admin"},
    "store":      {"store", "admin"},
    "dispatch":   {"store", "admin"},
    "purchase":   {"store", "admin"},
    "accounts":   {"accounts", "admin"},
    "management": {"admin"},
    "field":      {"sales", "admin"},
}

def _require_stage_team(user: dict, stage: dict):
    team = get_team(user)
    allowed = _STAGE_TEAM_ALLOWED.get(stage.get("team", ""), {"admin"})
    if team not in allowed:
        raise HTTPException(403, f"Your role ({team}) cannot act on a {stage.get('team')} stage")

# ── TAT Engine: office-hour-aware next plan time ──────────────────────────────

DEFAULT_OFFICE_START = 10   # 10 AM
DEFAULT_OFFICE_END   = 18   # 6 PM
DEFAULT_WEEKLY_OFF   = [6]  # Sunday = 6

_DEFAULT_TEMPLATES = {
    "staff_warning":  "Reminder: {stage} for {title} ({ref}) is due by {due}.",
    "staff_escalate": "URGENT: {stage} for {title} ({ref}) is nearly overdue (due {due}).",
    "staff_breach":   "OVERDUE: {stage} for {title} ({ref}) missed its deadline ({due}).",
    "manager_breach": "{assignee} missed {stage} for {title} ({ref}), due {due}.",
    "customer_stage": "Hi {customer_name}, update on your order {ref}: {stage} is complete.",
}

async def get_fms_settings() -> dict:
    s = await db.fms_settings.find_one({"type": "fms"}, {"_id": 0}) or {}
    return {
        "office_start":        s.get("office_start",        DEFAULT_OFFICE_START),
        "office_end":          s.get("office_end",          DEFAULT_OFFICE_END),
        "weekly_off":          s.get("weekly_off",          DEFAULT_WEEKLY_OFF),
        "holidays":            s.get("holidays",            []),
        "status_warning_pct":  s.get("status_warning_pct",  0.5),
        "status_red_pct":      s.get("status_red_pct",      0.8),
        "notify_warning_pct":  s.get("notify_warning_pct",  0.5),
        "notify_escalate_pct": s.get("notify_escalate_pct", 0.2),
        "notify_on_breach":    s.get("notify_on_breach",    True),
        "notify_channels":     s.get("notify_channels",     ["whatsapp", "email"]),
        "templates":           {**_DEFAULT_TEMPLATES, **(s.get("templates") or {})},
    }

def _is_working_day(d: date, weekly_off: List[int], holidays: List[str]) -> bool:
    return d.weekday() not in weekly_off and d.isoformat() not in holidays

def calculate_plan_time(
    from_dt: datetime,
    tat_hours: float,
    office_start: int,
    office_end: int,
    weekly_off: List[int],
    holidays: List[str],
) -> datetime:
    """Add tat_hours of working time to from_dt, respecting IST office hours,
    weekly-off days and holidays. Input may be any tz; result is returned in UTC."""
    if from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=timezone.utc)
    current = from_dt.astimezone(IST)
    remaining = tat_hours * 60  # minutes
    max_iter, iterations = 5000, 0
    while remaining > 0 and iterations < max_iter:
        iterations += 1
        d = current.date()
        if not _is_working_day(d, weekly_off, holidays):
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
            continue
        if current.hour < office_start:
            current = current.replace(hour=office_start, minute=0, second=0, microsecond=0)
        if current.hour >= office_end:
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
            continue
        end_today = current.replace(hour=office_end, minute=0, second=0, microsecond=0)
        slot_mins = (end_today - current).total_seconds() / 60
        if remaining <= slot_mins:
            current += timedelta(minutes=remaining)
            remaining = 0
        else:
            remaining -= slot_mins
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
    return current.astimezone(timezone.utc)

def working_minutes_elapsed(start: datetime, end: datetime,
                             office_start: int, office_end: int,
                             weekly_off: List[int], holidays: List[str]) -> float:
    """Count working minutes (IST office hours, skipping off-days/holidays) between two instants."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    start, end = start.astimezone(IST), end.astimezone(IST)
    if start >= end:
        return 0.0
    total = 0.0
    cur = start
    while cur < end:
        d = cur.date()
        if _is_working_day(d, weekly_off, holidays):
            day_start = max(cur, datetime.combine(d, dtime(office_start, 0), tzinfo=IST))
            day_end = min(end, datetime.combine(d, dtime(office_end, 0), tzinfo=IST))
            if day_end > day_start:
                total += (day_end - day_start).total_seconds() / 60
        cur = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
    return total

def tat_status(plan_start: Optional[datetime], plan_done: Optional[datetime],
               actual_done: Optional[datetime] = None,
               warn_pct: float = 0.5, red_pct: float = 0.8) -> str:
    """green / orange / red / overdue / pending based on elapsed fraction of the TAT window."""
    if not plan_done or not plan_start:
        return "pending"
    if actual_done:
        return "green" if actual_done <= plan_done else "red"
    now = now_utc()
    total = (plan_done - plan_start).total_seconds()
    if total <= 0:
        return "overdue" if now >= plan_done else "green"
    pct = max(0.0, (now - plan_start).total_seconds() / total)
    if pct >= 1.0:
        return "overdue"
    if pct >= red_pct:
        return "red"
    if pct >= warn_pct:
        return "orange"
    return "green"


def score_stage(plan_start: Optional[datetime], plan_done: Optional[datetime],
                actual_done: Optional[datetime]) -> int:
    """100 = on time or early. Linear down to 0 at 2x-budget late. Missing data = 0."""
    if not plan_start or not plan_done or not actual_done:
        return 0
    planned_mins = max(1.0, (plan_done - plan_start).total_seconds() / 60)
    if actual_done <= plan_done:
        return 100
    late = (actual_done - plan_done).total_seconds() / 60
    return max(0, round(100 - (late / planned_mins) * 50))


def render_template(tpl: str, **kw) -> str:
    """Safe template fill: unknown placeholders render blank, never raise."""
    class _Blank(dict):
        def __missing__(self, k): return ""
    try:
        return tpl.format_map(_Blank(kw))
    except Exception:
        return tpl


def pct_remaining(plan_start: datetime, plan_done: datetime,
                  paused_intervals: Optional[list] = None) -> float:
    """Fraction of the TAT window still remaining (0..1). Subtracts paused time."""
    now = now_utc()
    total = (plan_done - plan_start).total_seconds()
    if total <= 0:
        return 0.0 if now >= plan_done else 1.0
    paused = _paused_seconds(paused_intervals or [], plan_start, now)
    elapsed = max(0.0, (now - plan_start).total_seconds() - paused)
    rem = 1.0 - (elapsed / total)
    return max(0.0, min(1.0, rem))


def _paused_seconds(intervals: list, lo: datetime, hi: datetime) -> float:
    """Total seconds of paused intervals that fall within [lo, hi]."""
    total = 0.0
    for iv in intervals:
        try:
            a = datetime.fromisoformat(iv["from"])
            b = datetime.fromisoformat(iv["to"]) if iv.get("to") else hi
        except Exception:
            continue
        a = max(a, lo); b = min(b, hi)
        if b > a:
            total += (b - a).total_seconds()
    return total


# ── Stage definitions (configurable per flow type) ────────────────────────────

ORDER_STAGES = [
    {"key": "crm_confirm",       "label": "CRM Confirmation",      "team": "sales",      "tat_hours": 2,   "needs_approval": False},
    {"key": "inventory_check",   "label": "Inventory Check",       "team": "store",      "tat_hours": 4,   "needs_approval": False},
    {"key": "qc_check",          "label": "QC Inspection",         "team": "store",      "tat_hours": 4,   "needs_approval": True},
    {"key": "predispatch",       "label": "Pre-Dispatch Checklist","team": "store",      "tat_hours": 2,   "needs_approval": False},
    {"key": "dispatch",          "label": "Dispatch",              "team": "dispatch",   "tat_hours": 4,   "needs_approval": False, "customer_notify": True},
    {"key": "payment_advance",   "label": "Advance Payment",       "team": "accounts",   "tat_hours": 24,  "needs_approval": False},
    {"key": "delivery_confirm",  "label": "Delivery Confirmation", "team": "sales",      "tat_hours": 48,  "needs_approval": False, "customer_notify": True},
    {"key": "payment_final",     "label": "Final Payment",         "team": "accounts",   "tat_hours": 72,  "needs_approval": False},
]

PURCHASE_STAGES = [
    {"key": "pr_raised",         "label": "PR Raised",             "team": "purchase",   "tat_hours": 4,   "needs_approval": True},
    {"key": "po_approved",       "label": "PO Approved",           "team": "management", "tat_hours": 8,   "needs_approval": True},
    {"key": "vendor_ordered",    "label": "Vendor Ordered",        "team": "purchase",   "tat_hours": 4,   "needs_approval": False},
    {"key": "material_received", "label": "Material Received",     "team": "store",      "tat_hours": 48,  "needs_approval": False},
    {"key": "qc_material",       "label": "Material QC",           "team": "store",      "tat_hours": 8,   "needs_approval": True},
    {"key": "purchase_payment",  "label": "Purchase Payment",      "team": "accounts",   "tat_hours": 24,  "needs_approval": True},
]

STAGE_MAP = {"order": ORDER_STAGES, "purchase": PURCHASE_STAGES}

# ═══════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/settings")
async def get_settings(request: Request):
    await get_current_user(request)
    return await get_fms_settings()

@router.put("/settings")
async def update_settings(request: Request):
    await get_current_user(request)
    body = await request.json()
    safe = {k: v for k, v in body.items() if k in (
        "office_start", "office_end", "weekly_off", "holidays",
        "status_warning_pct", "status_red_pct",
        "notify_warning_pct", "notify_escalate_pct", "notify_on_breach",
        "notify_channels", "templates",
    )}
    await db.fms_settings.update_one(
        {"type": "fms"}, {"$set": {"type": "fms", **safe}}, upsert=True
    )
    return await get_fms_settings()

# ═══════════════════════════════════════════════════════════════════════════════
# FLOW INSTANCES  (one per order / purchase / production job)
# ═══════════════════════════════════════════════════════════════════════════════

class FlowCreate(BaseModel):
    flow_type: str = "order"
    template_id: Optional[str] = None    # use custom template instead of flow_type
    title: str
    reference_id: Optional[str] = None
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_email: Optional[str] = ""
    amount: Optional[float] = 0
    notes: Optional[str] = ""
    lead_id: Optional[str] = None         # CRM lead link
    school_id: Optional[str] = None
    assigned_teams: Optional[Dict[str, str]] = {}

@router.get("/flows")
async def list_flows(request: Request, flow_type: Optional[str] = None,
                     status: Optional[str] = None, limit: int = 100):
    user = await get_current_user(request)
    q = {}
    if flow_type: q["flow_type"] = flow_type
    if status:    q["status"]    = status
    flows = await db.fms_flows.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    team = get_team(user)
    return [_mask_flow(f, team) for f in flows]

@router.get("/flows/{flow_id}")
async def get_flow(flow_id: str, request: Request):
    user = await get_current_user(request)
    flow = await db.fms_flows.find_one({"flow_id": flow_id}, {"_id": 0})
    if not flow: raise HTTPException(404, "Flow not found")
    stages = await db.fms_stages.find({"flow_id": flow_id}, {"_id": 0}).sort("order", 1).to_list(50)
    return {**_mask_flow(flow, get_team(user)), "stages": stages}

@router.get("/flows/{flow_id}/logs")
async def get_flow_logs(flow_id: str, request: Request):
    await get_current_user(request)
    return await db.fms_stage_logs.find(
        {"flow_id": flow_id}, {"_id": 0}
    ).sort("at", 1).to_list(500)

@router.post("/flows")
async def create_flow(body: FlowCreate, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()

    # Resolve stage definitions: custom template → flow_type → default
    if body.template_id:
        tmpl = await db.fms_templates.find_one({"template_id": body.template_id}, {"_id": 0})
        stage_defs = tmpl.get("stages", ORDER_STAGES) if tmpl else ORDER_STAGES
    else:
        stage_defs = STAGE_MAP.get(body.flow_type, ORDER_STAGES)

    flow_id = gen_id("flow")
    now = now_utc()
    flow_doc = {
        "flow_id": flow_id, "flow_type": body.flow_type,
        "template_id": body.template_id,
        "title": body.title, "reference_id": body.reference_id,
        "customer_name": body.customer_name, "customer_phone": body.customer_phone,
        "customer_email": body.customer_email,
        "amount": body.amount, "notes": body.notes,
        "lead_id": body.lead_id, "school_id": body.school_id,
        "assigned_teams": body.assigned_teams,
        "current_stage_key": stage_defs[0]["key"] if stage_defs else "",
        "status": "active",
        "created_by": user.get("email"), "created_at": now.isoformat(),
        "completed_at": None, "overall_score": None,
    }
    await db.fms_flows.insert_one(flow_doc)

    # Build stage documents with calculated plan times
    stage_docs = []
    plan_from = now
    for i, sd in enumerate(stage_defs):
        plan_dt = calculate_plan_time(
            plan_from, sd["tat_hours"],
            cfg["office_start"], cfg["office_end"],
            cfg["weekly_off"], cfg["holidays"]
        )
        stage_doc = {
            "stage_id": gen_id("stg"), "flow_id": flow_id,
            "order": i, "key": sd["key"], "label": sd["label"],
            "team": sd["team"], "tat_hours": sd["tat_hours"],
            "needs_approval": sd["needs_approval"],
            "customer_notify": sd.get("customer_notify", False),
            "status": "waiting" if i > 0 else "active",
            # waiting → active → done / rejected
            "plan_start": plan_from.isoformat(),
            "plan_done":  plan_dt.isoformat(),
            "actual_start": now.isoformat() if i == 0 else None,
            "actual_done": None,
            "assigned_to": body.assigned_teams.get(sd["team"], ""),
            "done_by": None, "done_note": "",
            "approval_status": None,   # pending | approved | rejected
            "approval_by": None,
            "tat_status": "pending",   # pending | green | orange | red | overdue
            "score": None,
        }
        stage_docs.append(stage_doc)
        plan_from = plan_dt   # next stage starts where this one is planned to end

    if stage_docs:
        await db.fms_stages.insert_many(stage_docs)

    for sd in stage_docs:
        await _log_stage(flow_id, sd, "created", user, to_status=sd["status"])

    # Create delegation task for first stage
    await _create_delegation_task_for_stage(stage_docs[0], body.title, flow_id)

    return await get_flow(flow_id, request)

async def _create_delegation_task_for_stage(stage: dict, flow_title: str, flow_id: str):
    """Auto-create a delegation task when a stage becomes active."""
    try:
        emp = None
        if stage.get("assigned_to"):
            emp = await db.del_employees.find_one(
                {"email": stage["assigned_to"], "is_active": True}, {"_id": 0}
            )
        if emp:
            tid = gen_id("task"); iid = gen_id("inst")
            num = f"FMS-{flow_id[-6:].upper()}-{stage['key'][:4].upper()}"
            due = stage["plan_done"][:10] if stage.get("plan_done") else today_str()
            task = {
                "task_id": tid, "task_number": num,
                "title": f"{stage['label']}: {flow_title}",
                "description": f"Stage: {stage['label']} · TAT: {stage['tat_hours']}h",
                "task_type": "onetime", "frequency": "onetime", "target_date": due,
                "priority": "high", "assignee_ids": [emp["emp_id"]], "assignees": [emp],
                "delegator_id": None, "delegator_name": "FMS Auto",
                "score": 0, "require_verification": stage.get("needs_approval", False),
                "requires_image": False,
                "linked_entity_id": stage["stage_id"],
                "linked_entity_type": "fms_stage",
                "status": "active", "is_active": True, "created_at": now_iso(),
            }
            await db.del_tasks.insert_one(task)
            await db.del_task_instances.insert_one({
                "instance_id": iid, "task_id": tid,
                "task_title": task["title"], "task_number": num,
                "emp_id": emp["emp_id"], "emp_name": emp["name"],
                "department_id": emp.get("department_id",""), "department_name": emp.get("department_name",""),
                "delegator_id": None, "delegator_name": "FMS",
                "due_date": due, "frequency": "onetime",
                "priority": "high", "score": 0,
                "require_verification": stage.get("needs_approval", False),
                "requires_image": False,
                "linked_entity_id": stage["stage_id"], "linked_entity_type": "fms_stage",
                "status": "pending", "completed_at": None, "verified_at": None,
                "verified_by": None, "completion_note": "", "completion_image_url": None,
                "created_at": now_iso(),
            })
    except Exception:
        pass

# ═══════════════════════════════════════════════════════════════════════════════
# STAGE ACTIONS: complete, approve, reject
# ═══════════════════════════════════════════════════════════════════════════════

async def _maybe_notify_customer(flow: dict, stage: dict):
    if not stage.get("customer_notify"):
        return
    cfg = await get_fms_settings()
    tpl = cfg["templates"].get("customer_stage", "")
    text = render_template(
        tpl, stage=stage.get("label", ""),
        ref=flow.get("reference_id") or flow.get("flow_id", ""),
        customer_name=flow.get("customer_name", ""),
        title=flow.get("title", ""),
    )
    from scheduler import _fms_send_wa, _fms_send_email   # local import avoids cycle
    if "whatsapp" in cfg["notify_channels"] and flow.get("customer_phone"):
        ok, err = await _fms_send_wa(flow["customer_phone"], text)
        await db.fms_notifications.insert_one({
            "notif_id": gen_id("fnotif"), "flow_id": flow["flow_id"], "stage_id": stage["stage_id"],
            "kind": "customer_stage", "channel": "whatsapp", "recipient": flow["customer_phone"],
            "status": "sent" if ok else "failed", "error": err, "sent_at": now_iso(),
        })
    if "email" in cfg["notify_channels"] and flow.get("customer_email"):
        ok, err = await _fms_send_email(flow["customer_email"], "Order update", text)
        await db.fms_notifications.insert_one({
            "notif_id": gen_id("fnotif"), "flow_id": flow["flow_id"], "stage_id": stage["stage_id"],
            "kind": "customer_stage", "channel": "email", "recipient": flow["customer_email"],
            "status": "sent" if ok else "failed", "error": err, "sent_at": now_iso(),
        })


@router.post("/stages/{stage_id}/complete")
async def complete_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()
    body = await request.json()

    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage: raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)
    if stage["status"] not in ("active", "waiting"):
        raise HTTPException(400, "Stage already completed")

    now = now_utc()
    plan_start = datetime.fromisoformat(stage["plan_start"]) if stage.get("plan_start") else now
    plan_done = datetime.fromisoformat(stage["plan_done"]) if stage.get("plan_done") else now

    # Calculate tat status and score
    t_status = "green" if now <= plan_done else "red"
    score = score_stage(plan_start, plan_done, now)

    update = {
        "status": "pending_approval" if stage.get("needs_approval") else "done",
        "actual_done": now.isoformat(),
        "done_by": user.get("email"), "done_note": body.get("note", ""),
        "tat_status": t_status, "score": score,
    }
    await db.fms_stages.update_one({"stage_id": stage_id}, {"$set": update})
    await _log_stage(stage["flow_id"], {**stage, **update}, "completed", user,
                     note=body.get("note", ""), from_status=stage["status"],
                     to_status=update["status"])

    # If needs approval → stop here, notify approver
    if stage.get("needs_approval"):
        return {"message": "Submitted for approval", "tat_status": t_status}

    # Notify customer if this stage is flagged
    flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
    if flow:
        await _maybe_notify_customer(flow, {**stage, **update})

    # Otherwise advance to next stage
    await _advance_flow(stage["flow_id"], stage["order"], now, cfg)
    return {"message": "Stage completed", "tat_status": t_status, "score": score}

@router.post("/stages/{stage_id}/approve")
async def approve_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()
    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage: raise HTTPException(404)
    _require_stage_team(user, stage)
    await db.fms_stages.update_one({"stage_id": stage_id}, {"$set": {
        "status": "done", "approval_status": "approved",
        "approval_by": user.get("email"), "approval_at": now_iso(),
    }})
    await _log_stage(stage["flow_id"], stage, "approved", user, to_status="done")
    flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
    if flow:
        await _maybe_notify_customer(flow, stage)
    await _advance_flow(stage["flow_id"], stage["order"], now_utc(), cfg)
    return {"message": "Approved and flow advanced"}

@router.post("/stages/{stage_id}/reject")
async def reject_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()
    body = await request.json()
    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage:
        raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)

    # Keep the original stage in 'rejected' state with the reason preserved.
    await db.fms_stages.update_one({"stage_id": stage_id}, {"$set": {
        "status": "rejected",
        "approval_status": "rejected",
        "approval_by": user.get("email"),
        "reject_reason": body.get("reason", ""),
        "rejected_at": now_iso(),
    }})
    await _log_stage(stage["flow_id"], stage, "rejected", user,
                     note=body.get("reason", ""), from_status=stage["status"],
                     to_status="rejected")

    # Create a fresh redo stage at the same order so the flow can proceed.
    now = now_utc()
    plan_done = calculate_plan_time(
        now, stage.get("tat_hours", 4),
        cfg["office_start"], cfg["office_end"], cfg["weekly_off"], cfg["holidays"],
    )
    redo = {
        "stage_id": gen_id("stg"), "flow_id": stage["flow_id"],
        "order": stage["order"], "key": f"{stage['key']}_redo",
        "label": f"{stage['label']} (Redo)", "team": stage["team"],
        "tat_hours": stage.get("tat_hours", 4), "needs_approval": stage.get("needs_approval", False),
        "status": "active",
        "plan_start": now.isoformat(), "plan_done": plan_done.isoformat(),
        "actual_start": now.isoformat(), "actual_done": None,
        "assigned_to": stage.get("assigned_to", ""),
        "customer_notify": stage.get("customer_notify", False),
        "done_by": None, "done_note": "", "approval_status": None, "approval_by": None,
        "tat_status": "pending", "score": None,
    }
    await db.fms_stages.insert_one(redo)
    await _log_stage(stage["flow_id"], redo, "reworked", user, to_status="active")
    return {"message": "Rejected — redo stage created"}

async def _advance_flow(flow_id: str, completed_order: int, now: datetime, cfg: dict):
    """Find next stage, activate it, recalculate plan times from now."""
    next_stage = await db.fms_stages.find_one(
        {"flow_id": flow_id, "order": completed_order + 1}
    )
    if not next_stage:
        # All stages done — complete the flow
        stages = await db.fms_stages.find({"flow_id": flow_id}, {"_id": 0}).to_list(50)
        scores = [s["score"] for s in stages if s.get("score") is not None]
        overall = round(sum(scores) / len(scores)) if scores else None
        await db.fms_flows.update_one({"flow_id": flow_id}, {"$set": {
            "status": "completed", "completed_at": now.isoformat(),
            "overall_score": overall,
        }})
        return

    plan_done = calculate_plan_time(
        now, next_stage["tat_hours"],
        cfg["office_start"], cfg["office_end"],
        cfg["weekly_off"], cfg["holidays"],
    )
    await db.fms_stages.update_one(
        {"stage_id": next_stage["stage_id"]},
        {"$set": {
            "status": "active",
            "actual_start": now.isoformat(),
            "plan_start": now.isoformat(),
            "plan_done": plan_done.isoformat(),
        }}
    )
    await _log_stage(flow_id, {**next_stage, "stage_id": next_stage["stage_id"]},
                     "activated", None, to_status="active")
    # Update flow's current stage
    await db.fms_flows.update_one(
        {"flow_id": flow_id},
        {"$set": {"current_stage_key": next_stage["key"]}}
    )
    # Create delegation task for new active stage
    flow = await db.fms_flows.find_one({"flow_id": flow_id}, {"_id": 0})
    next_s = await db.fms_stages.find_one({"stage_id": next_stage["stage_id"]}, {"_id": 0})
    if next_s and flow:
        await _create_delegation_task_for_stage(next_s, flow.get("title", ""), flow_id)

# ═══════════════════════════════════════════════════════════════════════════════
# QC CHECK — eye-button inspection per item
# ═══════════════════════════════════════════════════════════════════════════════

class QCItemResult(BaseModel):
    item_name: str
    result: str   # pass | fail | na
    note: Optional[str] = ""
    image_url: Optional[str] = None

class QCSubmit(BaseModel):
    flow_id: str
    stage_id: str
    inspector: Optional[str] = ""
    items: List[QCItemResult]
    overall: str = "pass"   # pass | fail
    rework_note: Optional[str] = ""

@router.get("/qc/{flow_id}")
async def get_qc(flow_id: str, request: Request):
    await get_current_user(request)
    return await db.fms_qc.find({"flow_id": flow_id}, {"_id": 0}).sort("created_at", -1).to_list(10)

@router.post("/qc")
async def submit_qc(body: QCSubmit, request: Request):
    user = await get_current_user(request)
    stage = await db.fms_stages.find_one({"stage_id": body.stage_id}, {"_id": 0})
    if not stage: raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)
    qc_id = gen_id("qc")
    doc = {
        "qc_id": qc_id, "flow_id": body.flow_id, "stage_id": body.stage_id,
        "inspector": body.inspector or user.get("name", user.get("email")),
        "items": [i.dict() for i in body.items],
        "overall": body.overall,
        "rework_note": body.rework_note,
        "created_at": now_iso(), "created_by": user.get("email"),
    }
    await db.fms_qc.insert_one(doc)

    if body.overall == "fail":
        # Create rework task linked to this flow
        await db.fms_stages.update_one(
            {"stage_id": body.stage_id},
            {"$set": {"status": "rework", "qc_id": qc_id}}
        )
        # Insert a rework stage (temporary)
        cfg = await get_fms_settings()
        rw_plan = calculate_plan_time(
            now_utc(), 8,  # 8 hours rework TAT
            cfg["office_start"], cfg["office_end"],
            cfg["weekly_off"], cfg["holidays"],
        )
        await db.fms_stages.insert_one({
            "stage_id": gen_id("stg"), "flow_id": body.flow_id,
            "order": stage["order"],   # same order, re-run
            "key": "rework", "label": "Rework (QC Failed)",
            "team": "store", "tat_hours": 8, "needs_approval": False,
            "status": "active",
            "plan_start": now_iso(), "plan_done": rw_plan.isoformat(),
            "actual_start": now_iso(), "actual_done": None,
            "assigned_to": stage.get("assigned_to", ""),
            "done_by": None, "done_note": "",
            "tat_status": "pending", "score": None,
        })
    else:
        # QC passed — mark stage done and advance
        cfg = await get_fms_settings()
        await db.fms_stages.update_one(
            {"stage_id": body.stage_id},
            {"$set": {"status": "done", "actual_done": now_iso(),
                      "tat_status": "green", "qc_id": qc_id}}
        )
        await _advance_flow(body.flow_id, stage["order"], now_utc(), cfg)

    return await db.fms_qc.find_one({"qc_id": qc_id}, {"_id": 0})

# ═══════════════════════════════════════════════════════════════════════════════
# PRE-DISPATCH CHECKLIST — auto-generated, all must be checked before dispatch
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_CHECKLIST = [
    {"key": "invoice",       "label": "Invoice generated & attached"},
    {"key": "payment_adv",   "label": "Advance payment confirmed"},
    {"key": "items_packed",  "label": "All items packed & counted"},
    {"key": "weight",        "label": "Weight & dimensions recorded"},
    {"key": "courier_booked","label": "Courier booked"},
    {"key": "lr_number",     "label": "LR / tracking number entered"},
    {"key": "label_printed", "label": "Shipping label printed & affixed"},
    {"key": "qc_clearance",  "label": "QC clearance received"},
    {"key": "customer_notified","label": "Customer notified (WhatsApp/Email)"},
]

@router.get("/checklist/{flow_id}")
async def get_checklist(flow_id: str, request: Request):
    await get_current_user(request)
    existing = await db.fms_checklists.find_one({"flow_id": flow_id}, {"_id": 0})
    if existing:
        return existing
    # Auto-generate default
    return {
        "flow_id": flow_id, "checklist_id": None,
        "items": DEFAULT_CHECKLIST,
        "all_checked": False, "submitted": False,
    }

@router.post("/checklist")
async def submit_checklist(request: Request):
    user = await get_current_user(request)
    if get_team(user) not in ("store", "admin"):
        raise HTTPException(403, "Only store/admin can submit the pre-dispatch checklist")
    body = await request.json()
    flow_id = body["flow_id"]
    items = body["items"]  # list of {key, label, checked, checked_by, checked_at, note}
    all_checked = all(i.get("checked") for i in items)

    cl_id = gen_id("cl")
    doc = {
        "checklist_id": cl_id, "flow_id": flow_id,
        "items": items, "all_checked": all_checked,
        "submitted": True, "submitted_by": user.get("email"),
        "submitted_at": now_iso(),
    }
    await db.fms_checklists.update_one(
        {"flow_id": flow_id}, {"$set": doc}, upsert=True
    )
    return doc

# ═══════════════════════════════════════════════════════════════════════════════
# PAYMENT MILESTONES
# ═══════════════════════════════════════════════════════════════════════════════

class PaymentMilestone(BaseModel):
    flow_id: str
    milestone_type: str   # advance | partial | final | refund
    amount: float
    pct_of_total: Optional[float] = None
    received_date: Optional[str] = None
    reference: Optional[str] = ""
    mode: Optional[str] = "upi"   # upi | neft | cash | cheque
    note: Optional[str] = ""

@router.get("/payments/{flow_id}")
async def get_payments(flow_id: str, request: Request):
    user = await get_current_user(request)
    payments = await db.fms_payments.find({"flow_id": flow_id}, {"_id": 0}).sort("created_at", 1).to_list(20)
    flow = await db.fms_flows.find_one({"flow_id": flow_id}, {"_id": 0}) or {}
    if get_team(user) in ("sales", "store"):
        raise HTTPException(403, "Payment data not visible for your role")
    total = flow.get("amount", 0)
    collected = sum(p["amount"] for p in payments)
    balance = total - collected
    return {"payments": payments, "total": total, "collected": collected, "balance": balance,
            "pct_collected": round(collected / total * 100, 1) if total else 0}

@router.post("/payments")
async def add_payment(body: PaymentMilestone, request: Request):
    user = await get_current_user(request)
    pm_id = gen_id("pay")
    doc = {
        "payment_id": pm_id, **body.dict(),
        "recorded_by": user.get("email"), "created_at": now_iso(),
    }
    await db.fms_payments.insert_one(doc)

    # Check if fully paid → auto-archive
    payments = await db.fms_payments.find({"flow_id": body.flow_id}, {"_id": 0}).to_list(20)
    flow = await db.fms_flows.find_one({"flow_id": body.flow_id}, {"_id": 0}) or {}
    collected = sum(p["amount"] for p in payments)
    if flow.get("amount") and collected >= flow["amount"]:
        await db.fms_flows.update_one(
            {"flow_id": body.flow_id},
            {"$set": {"status": "archived", "archived_at": now_iso()}}
        )

    return await db.fms_payments.find_one({"payment_id": pm_id}, {"_id": 0})

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD — real-time color-coded flow board
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/dashboard")
async def fms_dashboard(request: Request, flow_type: Optional[str] = None):
    user = await get_current_user(request)
    team = get_team(user)
    now = now_utc()
    q = {"status": {"$in": ["active", "blocked"]}}
    if flow_type: q["flow_type"] = flow_type
    flows = await db.fms_flows.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)

    result = []
    for flow in flows:
        stages = await db.fms_stages.find(
            {"flow_id": flow["flow_id"]}, {"_id": 0}
        ).sort("order", 1).to_list(20)

        # Enrich each stage with live TAT status
        for s in stages:
            if s["status"] == "active" and s.get("plan_done"):
                plan_dt = datetime.fromisoformat(s["plan_done"])
                if now > plan_dt:
                    s["tat_status"] = "overdue"
                else:
                    pct = (now - datetime.fromisoformat(s["plan_start"])).total_seconds() / \
                          max(1, (plan_dt - datetime.fromisoformat(s["plan_start"])).total_seconds())
                    s["tat_status"] = "orange" if pct > 0.8 else "pending"

        result.append({**_mask_flow(flow, team), "stages": stages})

    # Summary counts
    total  = await db.fms_flows.count_documents({"status": {"$in": ["active","blocked"]}})
    done   = await db.fms_flows.count_documents({"status": "completed"})
    arched = await db.fms_flows.count_documents({"status": "archived"})
    overdue_stages = await db.fms_stages.count_documents({"status": "active", "plan_done": {"$lt": now.isoformat()}})

    return {
        "flows": result,
        "summary": {"active": total, "completed": done, "archived": arched, "overdue_stages": overdue_stages},
    }

# ═══════════════════════════════════════════════════════════════════════════════
# REPORTS — employee scoring, TAT analytics
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/reports/scores")
async def score_report(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
    await get_current_user(request)
    q = {"actual_done": {"$ne": None}}
    if date_from: q.setdefault("actual_done", {})["$gte"] = date_from
    if date_to:   q.setdefault("actual_done", {})["$lte"] = date_to
    stages = await db.fms_stages.find(q, {"_id": 0}).to_list(5000)

    by_person: dict = {}
    for s in stages:
        who = s.get("done_by") or s.get("assigned_to") or "Unknown"
        if who not in by_person:
            by_person[who] = {"email": who, "total": 0, "green": 0, "red": 0, "scores": []}
        by_person[who]["total"] += 1
        if s.get("tat_status") == "green": by_person[who]["green"] += 1
        if s.get("tat_status") == "red":   by_person[who]["red"]   += 1
        if s.get("score") is not None:     by_person[who]["scores"].append(s["score"])

    result = []
    for email, d in by_person.items():
        avg_score = round(sum(d["scores"]) / len(d["scores"])) if d["scores"] else 0
        result.append({
            "email": email,
            "total_stages": d["total"],
            "green": d["green"],
            "red": d["red"],
            "on_time_pct": round(d["green"] / d["total"] * 100, 1) if d["total"] else 0,
            "avg_score": avg_score,
        })
    result.sort(key=lambda x: -x["avg_score"])
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW TEMPLATES — user-defined dynamic flow types
# ═══════════════════════════════════════════════════════════════════════════════

_SYSTEM_TEMPLATES = [
    {"key": "order",    "name": "Sales Order Flow",   "color": "#e94560", "stages": ORDER_STAGES},
    {"key": "purchase", "name": "Purchase Flow",      "color": "#8b5cf6", "stages": PURCHASE_STAGES},
]

FOLLOWUP_STAGES = [
    {"key": "initial_contact",  "label": "Initial Contact",   "team": "sales",    "tat_hours": 2,  "needs_approval": False},
    {"key": "demo_schedule",    "label": "Demo Scheduled",    "team": "sales",    "tat_hours": 24, "needs_approval": False},
    {"key": "demo_done",        "label": "Demo Done",         "team": "sales",    "tat_hours": 4,  "needs_approval": False},
    {"key": "proposal_sent",    "label": "Proposal Sent",     "team": "sales",    "tat_hours": 8,  "needs_approval": False},
    {"key": "negotiation",      "label": "Negotiation",       "team": "sales",    "tat_hours": 48, "needs_approval": True},
    {"key": "order_confirmed",  "label": "Order Confirmed",   "team": "sales",    "tat_hours": 4,  "needs_approval": True},
]

ONBOARDING_STAGES = [
    {"key": "welcome_call",     "label": "Welcome Call",      "team": "sales",    "tat_hours": 4,  "needs_approval": False},
    {"key": "setup_visit",      "label": "Setup Visit",       "team": "field",    "tat_hours": 24, "needs_approval": False},
    {"key": "training",         "label": "Training Session",  "team": "field",    "tat_hours": 8,  "needs_approval": False},
    {"key": "feedback",         "label": "Feedback Collected","team": "sales",    "tat_hours": 48, "needs_approval": False},
    {"key": "handover",         "label": "Account Handover",  "team": "sales",    "tat_hours": 4,  "needs_approval": True},
]

_ALL_SYSTEM = [
    *_SYSTEM_TEMPLATES,
    {"key": "followup",     "name": "Sales Follow-up Flow",  "color": "#10b981", "stages": FOLLOWUP_STAGES},
    {"key": "onboarding",   "name": "Customer Onboarding",   "color": "#f59e0b", "stages": ONBOARDING_STAGES},
]

async def _ensure_system_templates():
    for t in _ALL_SYSTEM:
        exists = await db.fms_templates.find_one({"key": t["key"]})
        if not exists:
            await db.fms_templates.insert_one({
                "template_id": gen_id("tmpl"), "key": t["key"],
                "name": t["name"], "color": t["color"],
                "description": "", "is_system": True, "is_active": True,
                "stages": t["stages"], "created_at": now_iso(), "created_by": "system",
            })

@router.get("/templates")
async def list_templates(request: Request):
    await get_current_user(request)
    await _ensure_system_templates()
    return await db.fms_templates.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)

@router.post("/templates")
async def create_template(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name") or not body.get("stages"):
        raise HTTPException(400, "Name and at least one stage required")
    tid = gen_id("tmpl")
    doc = {
        "template_id": tid,
        "key": body.get("key") or body["name"].lower().replace(" ", "_"),
        "name": body["name"],
        "description": body.get("description", ""),
        "color": body.get("color", "#6366f1"),
        "is_system": False, "is_active": True,
        "stages": body["stages"],
        "created_at": now_iso(), "created_by": user.get("email"),
    }
    await db.fms_templates.insert_one(doc)
    return await db.fms_templates.find_one({"template_id": tid}, {"_id": 0})

@router.put("/templates/{template_id}")
async def update_template(template_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    safe = {k: v for k, v in body.items() if k in ("name", "description", "color", "is_active", "stages")}
    if safe:
        await db.fms_templates.update_one({"template_id": template_id}, {"$set": safe})
    return await db.fms_templates.find_one({"template_id": template_id}, {"_id": 0})

@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    await get_current_user(request)
    tmpl = await db.fms_templates.find_one({"template_id": template_id})
    if not tmpl: raise HTTPException(404, "Template not found")
    if tmpl.get("is_system"): raise HTTPException(400, "System templates cannot be deleted")
    await db.fms_templates.delete_one({"template_id": template_id})
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
# CALENDAR — stage plan_done dates grouped by day for monthly view
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/calendar")
async def fms_calendar(
    request: Request,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    await get_current_user(request)
    import calendar as cal_mod
    today = date.today()
    y = year or today.year
    m = month or today.month
    _, last_day = cal_mod.monthrange(y, m)
    start = f"{y:04d}-{m:02d}-01"
    end   = f"{y:04d}-{m:02d}-{last_day:02d}T23:59:59"

    stages = await db.fms_stages.find(
        {"plan_done": {"$gte": start, "$lte": end}},
        {"_id": 0}
    ).to_list(2000)

    flow_ids = list({s["flow_id"] for s in stages})
    flows_list = await db.fms_flows.find(
        {"flow_id": {"$in": flow_ids}},
        {"_id": 0, "flow_id": 1, "title": 1, "customer_name": 1}
    ).to_list(500)
    flows_map = {f["flow_id"]: f for f in flows_list}

    now = now_utc()
    grouped: dict = {}
    for s in stages:
        day = s["plan_done"][:10]
        flow = flows_map.get(s["flow_id"], {})
        # Live TAT status
        tat = s.get("tat_status", "pending")
        if s["status"] == "active" and s.get("plan_done"):
            plan_dt = datetime.fromisoformat(s["plan_done"])
            if now > plan_dt: tat = "overdue"
        grouped.setdefault(day, []).append({
            "stage_id": s["stage_id"],
            "stage_label": s["label"],
            "flow_id": s["flow_id"],
            "flow_title": flow.get("title", ""),
            "customer_name": flow.get("customer_name", ""),
            "status": s["status"],
            "tat_status": tat,
            "plan_done": s["plan_done"],
        })

    return {"year": y, "month": m, "days": grouped}


# ═══════════════════════════════════════════════════════════════════════════════
# DEBUG / ADMIN ENDPOINTS (Task 9b)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/_run-sla")
async def debug_run_sla(request: Request, dry: int = 0):
    user = await get_current_user(request)
    require_admin(user)
    import os as _os
    if dry:
        _os.environ["FMS_NOTIFY_DRY_RUN"] = "1"
    from scheduler import run_fms_sla_check   # local import avoids cycle at module load
    await run_fms_sla_check()
    return {"ok": True}


@router.get("/_notifications/{flow_id}")
async def debug_notifications(flow_id: str, request: Request):
    user = await get_current_user(request)
    require_admin(user)
    return await db.fms_notifications.find({"flow_id": flow_id}, {"_id": 0}).to_list(200)
