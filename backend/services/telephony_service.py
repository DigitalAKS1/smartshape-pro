"""Provider-agnostic telephony seam.

Owns the telephony_calls lifecycle and the config accessors. `place_call`
dials via the configured provider (Bonvoice); `handle_webhook` finalizes the
row and creates a call_note idempotently. Pure payload/parse logic lives in
services.providers.bonvoice; pure mapping in telephony_mapping.
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from database import db
from services.providers import bonvoice
import telephony_mapping as tm

_log = logging.getLogger("telephony")
_TYPE = "telephony"

_DEFAULT_CFG = {
    "provider": "bonvoice", "enabled": False,
    "username": "", "password": "", "caller_id_did": "",
    "token": "", "webhook_secret": "",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_config() -> Dict[str, Any]:
    doc = await db.settings.find_one({"type": _TYPE}, {"_id": 0}) or {}
    return {**_DEFAULT_CFG, **{k: v for k, v in doc.items() if k != "type"}}


async def is_enabled() -> bool:
    cfg = await get_config()
    return bool(cfg.get("enabled") and cfg.get("username") and cfg.get("password"))


async def _ensure_token(cfg: Dict[str, Any], http) -> str:
    if cfg.get("token"):
        return cfg["token"]
    token = await bonvoice.get_token(cfg, http)
    await db.settings.update_one({"type": _TYPE},
        {"$set": {"token": token, "token_fetched_at": _now()}}, upsert=True)
    return token


async def place_call(rep_email: str, rep_name: str, rep_number: str,
                     target_phone: str, corr: Dict[str, Any]) -> Dict[str, Any]:
    """Write a pending telephony_calls row, dial via Bonvoice, update status."""
    cfg = await get_config()
    event_id = uuid.uuid4().hex[:16]
    row = {
        "tcall_id": f"tcall_{uuid.uuid4().hex[:12]}",
        "event_id": event_id, "provider": "bonvoice", "status": "pending",
        "rep_email": rep_email, "rep_name": rep_name, "rep_number": rep_number,
        "target_phone": target_phone,
        "kind": corr.get("kind"), "ref_id": corr.get("ref_id"),
        "school_id": corr.get("school_id"), "contact_id": corr.get("contact_id"),
        "lead_id": corr.get("lead_id"),
        "call_id": "", "start_time": "", "end_time": "", "duration_sec": 0,
        "recording_url": "", "dtmf": "", "raw_events": [],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.telephony_calls.insert_one(dict(row))
    payload = bonvoice.build_click2call_payload(cfg, rep_number, target_phone, event_id)
    async with httpx.AsyncClient(timeout=30) as http:
        try:
            token = await _ensure_token(cfg, http)
            resp = await http.post(bonvoice.CLICK2CALL_URL, json=payload,
                                   headers={"Authorization": f"Token {token}"})
            if resp.status_code == 401:  # stale token -> re-auth once and retry
                await db.settings.update_one({"type": _TYPE}, {"$set": {"token": ""}})
                token = await _ensure_token({**cfg, "token": ""}, http)
                resp = await http.post(bonvoice.CLICK2CALL_URL, json=payload,
                                       headers={"Authorization": f"Token {token}"})
            ok = 200 <= resp.status_code < 300
            new_status = "dialing" if ok else "failed"
            await db.telephony_calls.update_one({"event_id": event_id},
                {"$set": {"status": new_status,
                          "provider_response": resp.text[:500], "updated_at": _now()}})
            row["status"] = new_status
        except Exception as e:  # noqa: BLE001
            _log.warning("place_call failed: %s", e)
            await db.telephony_calls.update_one({"event_id": event_id},
                {"$set": {"status": "failed", "provider_response": str(e)[:500],
                          "updated_at": _now()}})
            row["status"] = "failed"
    row.pop("_id", None)
    return row


async def _touch_last_activity(row: Dict[str, Any], now_iso: str) -> None:
    if row.get("contact_id"):
        await db.contacts.update_one({"contact_id": row["contact_id"]},
            {"$set": {"last_call_at": now_iso, "last_activity_date": now_iso}})
    if row.get("lead_id"):
        await db.leads.update_one({"lead_id": row["lead_id"]},
            {"$set": {"last_activity_date": now_iso}})
    if row.get("school_id"):
        await db.schools.update_one({"school_id": row["school_id"]},
            {"$set": {"last_activity_date": now_iso}})


async def handle_webhook(content_type: str, raw_body: bytes,
                         form: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Update the telephony_calls row from a webhook; on hangup create the
    call_note exactly once (idempotent on event_id)."""
    evt = bonvoice.parse_webhook(content_type, raw_body, form)
    event_id = evt.get("event_id")
    if not event_id:
        _log.warning("telephony webhook with no event_id")
        return {"ok": False, "reason": "no_event_id"}
    now_iso = _now()
    set_fields = {"status": evt["status"] or "unknown", "updated_at": now_iso}
    if evt.get("call_id"):
        set_fields["call_id"] = evt["call_id"]
    if evt.get("start_time"):
        set_fields["start_time"] = evt["start_time"]
    if evt.get("is_hangup"):
        set_fields.update({"end_time": evt["end_time"], "duration_sec": evt["duration_sec"],
                           "recording_url": evt["recording_url"], "dtmf": evt["dtmf"]})
    await db.telephony_calls.update_one({"event_id": event_id},
        {"$set": set_fields, "$push": {"raw_events": evt.get("raw", {})}}, upsert=True)

    if not evt.get("is_hangup"):
        return {"ok": True, "event": "notification"}

    # Hangup: create the call_note ONCE.
    existing = await db.call_notes.find_one({"event_id": event_id}, {"_id": 0, "note_id": 1})
    if existing:
        return {"ok": True, "event": "hangup", "note": "already_logged"}
    row = await db.telephony_calls.find_one({"event_id": event_id}, {"_id": 0}) or {}
    note = tm.build_webhook_call_note(row, now_iso)
    await db.call_notes.insert_one(dict(note))
    await _touch_last_activity(row, now_iso)
    return {"ok": True, "event": "hangup", "note": note["note_id"]}
