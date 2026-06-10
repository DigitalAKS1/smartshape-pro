"""Zoom Server-to-Server OAuth client — fetch past-meeting participants.

Credentials are stored in db.settings ({type:"zoom"}) so a non-technical admin can
enter them in the app (no server/env access needed). Mirrors the db.settings pattern
used for email/whatsapp config.
"""
import base64
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
