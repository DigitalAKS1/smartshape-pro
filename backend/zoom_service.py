"""Zoom Server-to-Server OAuth client — fetch past-meeting participants.

Credentials are stored in db.settings ({type:"zoom"}) so a non-technical admin can
enter them in the app (no server/env access needed). Mirrors the db.settings pattern
used for email/whatsapp config.
"""
import base64
import re
import time
from typing import List, Dict, Any, Optional, Tuple

import httpx

from database import db

_OAUTH_URL = "https://zoom.us/oauth/token"
_API_BASE = "https://api.zoom.us/v2"
_TIMEOUT = httpx.Timeout(20.0)

# cached access token: (token, expires_at_epoch)
_token_cache: Dict[str, Any] = {"token": None, "exp": 0.0}


async def get_zoom_config() -> Optional[Dict[str, str]]:
    cfg = await db.settings.find_one({"type": "zoom"}, {"_id": 0})
    if not cfg:
        return None
    aid = (cfg.get("account_id") or "").strip()
    cid = (cfg.get("client_id") or "").strip()
    sec = (cfg.get("client_secret") or "").strip()
    if not (aid and cid and sec):
        return None
    return {"account_id": aid, "client_id": cid, "client_secret": sec}


async def is_configured() -> bool:
    return await get_zoom_config() is not None


async def _get_access_token(force: bool = False) -> str:
    now = time.time()
    if not force and _token_cache["token"] and _token_cache["exp"] - 60 > now:
        return _token_cache["token"]
    cfg = await get_zoom_config()
    if not cfg:
        raise RuntimeError("Zoom is not configured")
    basic = base64.b64encode(f"{cfg['client_id']}:{cfg['client_secret']}".encode()).decode()
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(
            _OAUTH_URL,
            params={"grant_type": "account_credentials", "account_id": cfg["account_id"]},
            headers={"Authorization": f"Basic {basic}"},
        )
        if r.status_code != 200:
            raise RuntimeError(f"Zoom auth failed ({r.status_code}): {r.text[:200]}")
        data = r.json()
    _token_cache["token"] = data.get("access_token")
    _token_cache["exp"] = now + float(data.get("expires_in", 3600))
    return _token_cache["token"]


async def create_meeting(topic: str, start_time: str, duration: int = 60,
                         timezone_str: str = "Asia/Kolkata",
                         agenda: str = "") -> Dict[str, Any]:
    """Create a scheduled Zoom meeting on the account's default user (me).
    Requires the S2S app to have the `meeting:write:admin` scope.
    Returns {meeting_id, join_url, start_url, password, start_time, topic}.
    """
    if not (topic or "").strip():
        raise ValueError("Meeting topic is required")
    token = await _get_access_token()
    payload = {
        "topic": topic.strip(),
        "type": 2,  # scheduled
        "start_time": start_time,
        "duration": int(duration or 60),
        "timezone": timezone_str,
        "agenda": agenda or "",
        "settings": {"join_before_host": True, "waiting_room": False, "approval_type": 2},
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(f"{_API_BASE}/users/me/meetings",
                         headers={"Authorization": f"Bearer {token}"}, json=payload)
        if r.status_code == 401:
            token = await _get_access_token(force=True)
            r = await c.post(f"{_API_BASE}/users/me/meetings",
                             headers={"Authorization": f"Bearer {token}"}, json=payload)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Zoom create-meeting failed ({r.status_code}): {r.text[:200]}")
        m = r.json()
    return {
        "meeting_id": str(m.get("id", "")),
        "join_url": m.get("join_url", ""),
        "start_url": m.get("start_url", ""),
        "password": m.get("password", ""),
        "start_time": m.get("start_time", start_time),
        "topic": m.get("topic", topic),
    }


def _norm_meeting_id(meeting_id: str) -> str:
    """Accept a raw numeric id, or a pasted join URL / spaced id."""
    s = (meeting_id or "").strip()
    if "zoom.us" in s and "/j/" in s:
        s = s.split("/j/", 1)[1].split("?", 1)[0]
    return s.replace(" ", "")


async def _fetch_participants(path: str, token: str) -> Tuple[int, List[Dict[str, Any]]]:
    """Return (status_code, rows). Follows next_page_token pagination."""
    rows: List[Dict[str, Any]] = []
    next_token = ""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        while True:
            params = {"page_size": 300}
            if next_token:
                params["next_page_token"] = next_token
            r = await c.get(f"{_API_BASE}{path}", headers={"Authorization": f"Bearer {token}"}, params=params)
            if r.status_code != 200:
                return r.status_code, rows
            data = r.json()
            rows.extend(data.get("participants", []) or [])
            next_token = data.get("next_page_token") or ""
            if not next_token:
                break
    return 200, rows


async def get_meeting_participants(meeting_id: str) -> List[Dict[str, str]]:
    """Fetch unique participants for a past meeting. Tries the admin Report API first
    (richer, needs report scope), then falls back to the past_meetings endpoint.
    Returns [{name, email, phone}] (phone usually empty from Zoom)."""
    mid = _norm_meeting_id(meeting_id)
    if not mid:
        raise ValueError("Meeting ID is required")
    token = await _get_access_token()

    status, raw = await _fetch_participants(f"/report/meetings/{mid}/participants", token)
    if status == 401:                       # token expired between calls — retry once
        token = await _get_access_token(force=True)
        status, raw = await _fetch_participants(f"/report/meetings/{mid}/participants", token)
    if status != 200:
        status2, raw2 = await _fetch_participants(f"/past_meetings/{mid}/participants", token)
        if status2 == 200:
            raw = raw2
        else:
            raise RuntimeError(
                f"Zoom could not return participants (report={status}, past={status2}). "
                "Check the meeting ID, that the meeting has ended, and the app's report/meeting scopes."
            )

    seen = set()
    out: List[Dict[str, str]] = []
    for p in raw:
        name = (p.get("name") or p.get("user_name") or "").strip()
        email = (p.get("user_email") or p.get("email") or "").strip()
        key = (email.lower() or name.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        if name:
            out.append({"name": name, "email": email, "phone": ""})
    return out


# ── CRM extraction: topic + registrants (school/designation) + display-name parse ──

_DESIG_HINTS = (
    "principal", "vice principal", "director", "head", "coordinator", "teacher",
    "manager", "owner", "admin", "hod", "dean", "professor", "prof", "founder",
    "chairman", "president", "incharge", "in-charge", "counsellor", "counselor",
    "trustee", "registrar",
)
_SCHOOL_HINTS = ("school", "academy", "vidyalaya", "college", "institute", "convent",
                 "public school", "international", "university", "gurukul")


def _looks_like_designation(s: str) -> bool:
    t = (s or "").lower()
    return any(h in t for h in _DESIG_HINTS)


def _looks_like_school(s: str) -> bool:
    t = (s or "").lower()
    return any(h in t for h in _SCHOOL_HINTS)


def parse_display_name(display: str):
    """Split a Zoom display name like 'Aman Kumar | DPS Delhi | Principal' into
    (name, school, designation). Best-effort: first chunk is the person; remaining
    chunks are classified by keyword. Returns ('', '', '') gracefully."""
    raw = (display or "").strip()
    if not raw:
        return "", "", ""
    parts = [p.strip() for p in re.split(r"\s*[|/\-–—,]\s*", raw) if p.strip()]
    if len(parts) <= 1:
        return raw, "", ""
    name = parts[0]
    school, desig = "", ""
    for chunk in parts[1:]:
        if not desig and _looks_like_designation(chunk):
            desig = chunk
        elif not school and _looks_like_school(chunk):
            school = chunk
        elif not school:
            school = chunk
        elif not desig:
            desig = chunk
    return name, school, desig


async def get_meeting_topic(meeting_id: str) -> str:
    mid = _norm_meeting_id(meeting_id)
    token = await _get_access_token()
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        for path in (f"/meetings/{mid}", f"/past_meetings/{mid}"):
            try:
                r = await c.get(f"{_API_BASE}{path}", headers={"Authorization": f"Bearer {token}"})
                if r.status_code == 200:
                    topic = (r.json().get("topic") or "").strip()
                    if topic:
                        return topic
            except Exception:
                continue
    return ""


async def get_meeting_registrants(meeting_id: str) -> List[Dict[str, str]]:
    """Registrants with structured school/designation from built-in + custom fields.
    Returns [] if the meeting had no registration (or scope missing)."""
    mid = _norm_meeting_id(meeting_id)
    token = await _get_access_token()
    rows: List[Dict[str, str]] = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        for status in ("approved", "pending"):
            next_token = ""
            while True:
                params = {"status": status, "page_size": 300}
                if next_token:
                    params["next_page_token"] = next_token
                try:
                    r = await c.get(f"{_API_BASE}/meetings/{mid}/registrants",
                                    headers={"Authorization": f"Bearer {token}"}, params=params)
                except Exception:
                    break
                if r.status_code != 200:
                    break
                data = r.json()
                for reg in data.get("registrants", []) or []:
                    name = f"{reg.get('first_name','')} {reg.get('last_name','')}".strip()
                    school = (reg.get("org") or "").strip()
                    desig = (reg.get("job_title") or "").strip()
                    for q in reg.get("custom_questions", []) or []:
                        title = (q.get("title") or "").lower()
                        val = (q.get("value") or "").strip()
                        if not val:
                            continue
                        if not school and ("school" in title or "institut" in title or "organi" in title or "college" in title):
                            school = val
                        elif not desig and ("design" in title or "title" in title or "role" in title or "job" in title or "position" in title):
                            desig = val
                    if name:
                        rows.append({"name": name, "email": (reg.get("email") or "").strip(),
                                     "school": school, "designation": desig})
                next_token = data.get("next_page_token") or ""
                if not next_token:
                    break
    return rows


async def get_meeting_crm_data(meeting_id: str) -> Dict[str, Any]:
    """Combine topic (theme) + registrants (structured school/designation) + attendees,
    falling back to display-name parsing. Returns {theme, rows:[{name,email,phone,school,designation,source}]}."""
    topic = await get_meeting_topic(meeting_id)
    registrants = await get_meeting_registrants(meeting_id)
    participants = await get_meeting_participants(meeting_id)

    reg_by_email = {r["email"].lower(): r for r in registrants if r.get("email")}
    rows: List[Dict[str, str]] = []
    seen = set()

    def add(name, email, school, desig, source):
        key = (email or "").lower() or (name or "").lower()
        if not key or key in seen or not name:
            return
        seen.add(key)
        rows.append({"name": name, "email": email or "", "phone": "",
                     "school": school or "", "designation": desig or "", "source": source})

    # Prefer attendees (who actually joined); enrich from registration or display name.
    for p in participants:
        email = (p.get("email") or "").strip()
        reg = reg_by_email.get(email.lower()) if email else None
        if reg:
            add(reg["name"], email or reg.get("email", ""), reg.get("school", ""), reg.get("designation", ""), "registration")
        else:
            nm, sch, des = parse_display_name(p.get("name", ""))
            add(nm or p.get("name", ""), email, sch, des, "display_name")

    # Registrants who didn't appear in the participant list (e.g. no-shows / upcoming).
    for r in registrants:
        add(r["name"], r.get("email", ""), r.get("school", ""), r.get("designation", ""), "registration")

    return {"theme": topic, "rows": rows}
