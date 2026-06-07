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


async def _action_already_fired(stage_id: str, action_index: int, event: str) -> bool:
    return bool(await db.fms_action_logs.find_one(
        {"stage_id": stage_id, "action_index": action_index, "event": event,
         "status": {"$in": ["fired", "skipped_condition"]}}))

async def _log_action(flow_id, stage_id, action_index, event, atype, status, result_ref=None, error=None):
    await db.fms_action_logs.insert_one({
        "log_id": _gen_id("falog"), "flow_id": flow_id, "stage_id": stage_id,
        "action_index": action_index, "event": event, "type": atype,
        "status": status, "result_ref": result_ref, "error": error, "at": _now_iso(),
    })


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
    if "whatsapp" in channels and phone:
        await _fms_send_wa(phone, text)
    if "email" in channels and email and "@" in email:
        await _fms_send_email(email, "Update", text)
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
        if await _action_already_fired(stage["stage_id"], idx, event):
            continue
        if not eval_condition(action.get("condition"), flow):
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "skipped_condition")
            continue
        try:
            ref = await _execute_action(action, flow, stage)
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "fired", result_ref=ref)
        except Exception as e:
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "failed", error=str(e)[:200])


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
    raise NotImplementedError("generate_certificate")  # implemented in Task 4
