"""FMS stage action-nodes: dispatcher + executors. Reuses the cert pipeline and
notification senders. Idempotent + audited via fms_action_logs."""
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import uuid

from database import db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


_OPS = {
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}

def eval_condition(cond: Optional[Dict[str, Any]], flow: Dict[str, Any]) -> bool:
    """Null condition => True. Otherwise compare flow[field] op value. Unknown op /
    missing field => False. Numeric compares coerce both sides to float when possible."""
    if not cond:
        return True
    field = cond.get("field")
    op = cond.get("op")
    if field not in flow or op not in _OPS:
        return False
    left, right = flow.get(field), cond.get("value")
    try:
        lf, rf = float(left), float(right)
        return _OPS[op](lf, rf)
    except (TypeError, ValueError):
        return _OPS[op](left, right)


async def _claim_action(flow_id, stage_id, action_index, event, atype):
    """Atomically claim an action via the UNIQUE (stage_id, action_index, event) index.
    Returns a log_id if this caller won the claim, else None (already attempted).
    Claiming BEFORE executing makes each action fire at most once even if execution
    later fails (the SLA loop repeats on_overdue every 5 min — a failed costly action
    like start_flow must not re-spawn)."""
    log_id = _gen_id("falog")
    try:
        await db.fms_action_logs.insert_one({
            "log_id": log_id, "flow_id": flow_id, "stage_id": stage_id,
            "action_index": action_index, "event": event, "type": atype,
            "status": "firing", "result_ref": None, "error": None, "at": _now_iso(),
        })
        return log_id
    except Exception:
        return None  # duplicate key → already claimed/done by an earlier pass

async def _finish_action(log_id, status, result_ref=None, error=None):
    await db.fms_action_logs.update_one(
        {"log_id": log_id},
        {"$set": {"status": status, "result_ref": result_ref, "error": error, "at": _now_iso()}})


def _render(tpl: str, flow: dict, stage: dict) -> str:
    from routes.fms_routes import render_template
    return render_template(tpl, customer_name=flow.get("customer_name", ""),
                           title=flow.get("title", ""), ref=flow.get("reference_id") or flow.get("flow_id", ""),
                           stage=stage.get("label", ""))


async def _exec_send_message(action, flow, stage):
    params = action.get("params", {})
    text = _render(params.get("template", ""), flow, stage)
    channels = params.get("channels", ["whatsapp", "email"])
    from scheduler import _fms_send_wa, _fms_send_email   # local import avoids cycle
    to = params.get("to", "customer")
    phone = flow.get("customer_phone", "") if to == "customer" else ""
    email = flow.get("customer_email", "") if to == "customer" else ""
    if to == "staff":
        emp = await db.del_employees.find_one({"email": stage.get("assigned_to", "")}, {"_id": 0}) or {}
        u = await db.users.find_one({"email": stage.get("assigned_to", "")}, {"_id": 0}) or {}
        phone = u.get("phone") or emp.get("phone") or ""
        email = stage.get("assigned_to", "")
    notif_id = _gen_id("fanotif")
    results = []
    if "whatsapp" in channels and phone:
        ok, _ = await _fms_send_wa(phone, text); results.append(ok)
    if "email" in channels and email and "@" in email:
        ok, _ = await _fms_send_email(email, "Update", text); results.append(ok)
    if results and not any(results):
        raise ValueError("all message channels failed")
    return notif_id


async def _execute_action(action, flow, stage):
    atype = action.get("type")
    if atype == "send_message":
        return await _exec_send_message(action, flow, stage)
    if atype == "start_flow":
        return await _exec_start_flow(action, flow, stage)       # Task 3
    if atype == "generate_certificate":
        return await _exec_generate_certificate(action, flow, stage)  # Task 4
    raise ValueError(f"unknown action type: {atype}")


async def run_stage_actions(flow: dict, stage: dict, event: str):
    for idx, action in enumerate(stage.get("actions", []) or []):
        if action.get("event") != event:
            continue
        log_id = await _claim_action(flow["flow_id"], stage["stage_id"], idx, event, action.get("type"))
        if not log_id:
            continue  # already attempted on an earlier pass — never re-run
        if not eval_condition(action.get("condition"), flow):
            await _finish_action(log_id, "skipped_condition")
            continue
        try:
            ref = await _execute_action(action, flow, stage)
            await _finish_action(log_id, "fired", result_ref=ref)
        except Exception as e:
            await _finish_action(log_id, "failed", error=str(e)[:200])


MAX_SPAWN_DEPTH = 5

async def _exec_start_flow(action, flow, stage):
    if (flow.get("spawn_depth", 0) or 0) >= MAX_SPAWN_DEPTH:
        raise ValueError("max spawn depth reached")
    params = action.get("params", {})
    carry_fields = params.get("carry", ["customer_name", "customer_phone", "customer_email", "reference_id", "amount"])
    carry = {f: flow.get(f) for f in carry_fields}
    title = f"{flow.get('title', '')}{params.get('title_suffix', '')}"
    from routes.fms_routes import create_child_flow
    child = await create_child_flow(
        params["template_id"], title, carry,
        flow["flow_id"], (flow.get("spawn_depth", 0) or 0) + 1,
        flow.get("created_by", "fms-action"),
    )
    await db.fms_flows.update_one(
        {"flow_id": flow["flow_id"]},
        {"$push": {"spawned_flow_ids": child["flow_id"]}},
    )
    return child["flow_id"]

async def _exec_generate_certificate(action, flow, stage):
    params = action.get("params", {})
    cert_template_id = params.get("cert_template_id")
    tpl = await db.cert_templates.find_one({"template_id": cert_template_id}, {"_id": 0})
    if not tpl:
        raise ValueError(f"cert template not found: {cert_template_id!r}")
    bid = _gen_id("cbatch")
    item = {
        "item_id": _gen_id("citem"), "batch_id": bid,
        "name": flow.get("customer_name", ""),
        "phone": flow.get("customer_phone", "") or "",
        "email": flow.get("customer_email", "") or "",
        "pdf_url": None, "gen_status": "pending", "gen_error": None,
        "delivery": {
            "whatsapp": {"status": "pending", "at": None, "error": None},
            "email":    {"status": "pending", "at": None, "error": None},
        },
        "created_at": _now_iso(),
    }
    batch = {
        "batch_id": bid,
        "title": f"Cert: {flow.get('title', '')}",
        "template_id": cert_template_id,
        "source": "manual", "session_id": None,
        "shared_values": params.get("shared_values", {}),
        "channels": params.get("channels", ["whatsapp", "email"]),
        "status": "generating",
        "counts": {"total": 1, "generated": 0, "sent_whatsapp": 0, "sent_email": 0, "failed": 0},
        "created_by": flow.get("created_by", "fms-action"),
        "created_at": _now_iso(),
        "origin_flow_id": flow["flow_id"],
    }
    await db.cert_batches.insert_one(batch)
    await db.cert_items.insert_one(item)
    return bid
