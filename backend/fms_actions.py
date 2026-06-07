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
