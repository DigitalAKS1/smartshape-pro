"""Bonvoice cloud-PBX provider adapter.

Pure functions for building the Click2Call payload and parsing webhooks;
`get_token` performs the single auth network call and returns a token string
(the caller persists it). Provider docs:
https://documenter.getpostman.com/view/21786347/2sAY52bJfR
"""
from typing import Any, Dict, Optional
import json

API_BASE = "https://backend.pbx.bonvoice.com"
AUTH_URL = f"{API_BASE}/usermanagement/external-auth/"
CLICK2CALL_URL = f"{API_BASE}/autoDialManagement/autoCallBridging/"

# Bonvoice "constant" fields. These match the Postman examples; override any of
# them per-account via the telephony config document (same snake_case keys).
_DEFAULTS = {
    "autocall_type": "click2call",
    "ring_strategy": "sequence",
    "leg_a_channel": "PJSIP",
    "leg_b_channel": "PJSIP",
    "leg_a_attempts": "1",
    "leg_b_attempts": "1",
}


def _c(cfg: Dict[str, Any], key: str) -> str:
    return str(cfg.get(key) or _DEFAULTS.get(key, ""))


def build_click2call_payload(cfg: Dict[str, Any], rep_number: str,
                             target_phone: str, event_id: str) -> Dict[str, Any]:
    """Leg A (destination) rings the rep first; Leg B is the customer."""
    did = str(cfg.get("caller_id_did") or "")
    return {
        "autocallType": _c(cfg, "autocall_type"),
        "destination": rep_number,                 # Leg A: ring the rep first
        "ringStrategy": _c(cfg, "ring_strategy"),
        "legACallerID": did,
        "legAChannelID": _c(cfg, "leg_a_channel"),
        "legADialAttempts": _c(cfg, "leg_a_attempts"),
        "legBDestination": target_phone,           # Leg B: the customer
        "legBCallerID": did,
        "legBChannelID": _c(cfg, "leg_b_channel"),
        "legBDialAttempts": _c(cfg, "leg_b_attempts"),
        "eventID": event_id,
    }


def _to_int(v: Any) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def parse_webhook(content_type: str, raw_body: bytes,
                  form: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalise both Bonvoice webhook formats (JSON + url-encoded) and both
    event types (notification vs hangup) into one flat dict."""
    ct = (content_type or "").lower()
    if "json" in ct:
        try:
            data = json.loads(raw_body or b"{}")
        except (ValueError, TypeError):
            data = {}
        if not isinstance(data, dict):
            data = {}
    else:
        data = dict(form or {})

    def g(*keys, default=""):
        for k in keys:
            if k in data and data[k] not in (None, ""):
                return data[k]
        return default

    end_time = g("EndTime", "endTime")
    duration = _to_int(g("callDuration", "Duration", "duration_sec", default=0))
    return {
        "event_id": g("eventID", "eventId", "event_id"),
        "call_id": g("callID", "callId", "call_id"),
        "status": g("Status", "status"),
        "direction": g("Direction", "direction"),
        "leg": g("Leg", "leg"),
        "start_time": g("StartTime", "startTime"),
        "end_time": end_time,
        "duration_sec": duration,
        "recording_url": g("ResourceURL", "resourceURL", "recording_url"),
        "dtmf": g("DTMF", "dtmf"),
        "is_hangup": bool(end_time),
        "raw": data,
    }


async def get_token(cfg: Dict[str, Any], http) -> str:
    """POST username/password, return the token string. `http` is an
    httpx.AsyncClient supplied by the caller."""
    resp = await http.post(AUTH_URL, json={
        "username": cfg.get("username", ""), "password": cfg.get("password", "")})
    resp.raise_for_status()
    data = resp.json()
    return data.get("token") or data.get("header_value") or ""
