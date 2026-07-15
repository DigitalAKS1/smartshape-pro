"""Pure, DB-free mapping helpers for provider call webhooks -> CRM call_notes.

Unit-testable in isolation (same pattern as crm_contact_calls.py). The route/
service layer supplies `now_iso` and persists the returned documents.
"""
import uuid
from typing import Any, Dict

_ANSWERED = {"answered", "bridged", "completed", "connected", "answer"}
_NO_ANSWER = {"no-answer", "noanswer", "no_answer", "missed", "ring", "ringing", "cancel-ring"}
_BUSY = {"busy"}


def status_to_outcome(status: str, duration_sec: int) -> str:
    """Map a provider hangup status to a crm_contact_calls.CALL_OUTCOMES member.

    An "answered" call with zero talk time never actually connected, so it maps
    to no_answer. Anything unrecognised is treated as a failed attempt.
    """
    s = (status or "").strip().lower()
    if s in _ANSWERED:
        return "connected" if (duration_sec or 0) > 0 else "no_answer"
    if s in _NO_ANSWER:
        return "no_answer"
    if s in _BUSY:
        return "busy"
    return "failed"


def build_webhook_call_note(call_row: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
    """Build a call_notes document from a finalized telephony_calls row."""
    duration = call_row.get("duration_sec") or 0
    outcome = status_to_outcome(call_row.get("status", ""), duration)
    return {
        "note_id": f"note_{uuid.uuid4().hex[:12]}",
        "type": "call",
        "source": "bonvoice",
        "event_id": call_row.get("event_id", ""),
        "contact_id": call_row.get("contact_id"),
        "lead_id": call_row.get("lead_id"),
        "school_id": call_row.get("school_id"),
        "outcome": outcome,
        "content": f"Auto-call to {call_row.get('target_phone', '')} — {outcome} ({duration}s)",
        "duration_sec": duration,
        "recording_url": call_row.get("recording_url") or "",
        "created_by": call_row.get("rep_email", ""),
        "created_by_name": call_row.get("rep_name", ""),
        "created_at": now_iso,
    }
