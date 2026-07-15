"""Pure helpers for contact-level call logging and follow-ups.

No DB/server imports, so this is unit-testable in isolation (same pattern as
cert_engine.py). The route layer supplies `now_iso` and persists the returned
documents.
"""
import uuid
from typing import Any, Dict, Optional, Tuple

# The only outcomes a logged call may carry. Order is the UI dropdown order.
# "failed" is used by auto-logged provider (Bonvoice) calls that never connected.
CALL_OUTCOMES: Tuple[str, ...] = (
    "connected", "no_answer", "busy", "wrong_number", "callback", "failed",
)


def is_valid_outcome(outcome: str) -> bool:
    return outcome in CALL_OUTCOMES


def timeline_query(contact_id: str, lead_id: Optional[str]) -> Dict[str, Any]:
    """Rows belonging to this contact OR to the lead it was converted into.
    An unconverted contact (no lead) matches on contact_id alone."""
    if lead_id:
        return {"$or": [{"contact_id": contact_id}, {"lead_id": lead_id}]}
    return {"contact_id": contact_id}


def resolve_task_owner(contact: Dict[str, Any], user: Dict[str, Any]) -> Tuple[str, str]:
    """A follow-up task belongs to whoever owns the contact; if nobody owns it,
    it falls to the person who logged the call."""
    email = (contact.get("assigned_to") or "").strip() or user.get("email", "")
    name = (contact.get("assigned_name") or "").strip() or user.get("name", "")
    return email, name


def _lead_id(contact: Dict[str, Any]) -> Optional[str]:
    return contact.get("lead_id") or None


def build_call_note(contact: Dict[str, Any], user: Dict[str, Any],
                    outcome: str, content: str, now_iso: str) -> Dict[str, Any]:
    return {
        "note_id": f"note_{uuid.uuid4().hex[:12]}",
        "contact_id": contact["contact_id"],
        "lead_id": _lead_id(contact),
        "type": "call",
        "content": content or "",
        "outcome": outcome,
        "created_by": user.get("email", ""),
        "created_by_name": user.get("name", ""),
        "created_at": now_iso,
    }


def build_followup(contact: Dict[str, Any], user: Dict[str, Any], date: str, time: str,
                   ftype: str, notes: str, now_iso: str) -> Dict[str, Any]:
    owner_email, _ = resolve_task_owner(contact, user)
    return {
        "followup_id": f"fu_{uuid.uuid4().hex[:12]}",
        "contact_id": contact["contact_id"],
        "contact_name": contact.get("name", ""),
        "lead_id": _lead_id(contact),
        "followup_date": date,
        "followup_time": time or "",
        "followup_type": ftype or "call",
        "notes": notes or "",
        "outcome": "",
        "status": "pending",
        "assigned_to": owner_email,
        "created_by": user.get("email", ""),
        "created_at": now_iso,
    }


def build_task_for_followup(contact: Dict[str, Any], user: Dict[str, Any],
                            followup: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
    owner_email, owner_name = resolve_task_owner(contact, user)
    ftype = followup.get("followup_type", "call")
    who = contact.get("name", "contact")
    return {
        "task_id": f"task_{uuid.uuid4().hex[:12]}",
        "title": f"{ftype.title()} {who}",
        "description": followup.get("notes", ""),
        "type": "follow_up",
        "contact_id": contact["contact_id"],
        "contact_name": who,
        "lead_id": _lead_id(contact),
        "lead_name": "",
        "followup_id": followup["followup_id"],
        "assigned_to": owner_email,
        "assigned_name": owner_name,
        "due_date": followup.get("followup_date", ""),
        "due_time": followup.get("followup_time", ""),
        "priority": "medium",
        "status": "pending",
        "outcome": "",
        "created_by": user.get("email", ""),
        "created_at": now_iso,
    }
