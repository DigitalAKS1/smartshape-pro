"""Forms Builder — dynamic forms + public event registration.

Any authenticated user can create forms; per-form authorization is
owner OR collaborator OR admin. Event-type forms sync a linked
training_sessions doc so the existing webinar email lifecycle
(confirm / remind_24h / remind_1h) runs unchanged; WhatsApp stages
are added by this module (Tasks 4-5).
"""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import re, uuid, logging

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter()
log = logging.getLogger("forms")

FIELD_TYPES = {"text", "textarea", "dropdown", "multiple_choice", "checkbox", "number", "date"}
MAP_TO_KEYS = {"name", "email", "phone", "school", "designation", "city"}

# For form-linked sessions only 3 stages are wanted; live/noshow/attended stay off.
FORM_SESSION_EMAILS = {"confirm": True, "remind_24h": True, "remind_1h": True,
                       "live": False, "noshow": False, "attended": False}

DEFAULT_WA_CONFIRM = (
    "Dear {name}, your registration is confirmed! \U0001F389\n\n"
    "{title}\nTheme: {theme}\nDate: {date}\nTime: {time}\n\n"
    "Join on Zoom:\n{zoom_link}\n\n"
    "Add to calendar: {calendar_link}\n\n"
    "— SMARTS-SHAPES Team of Educators")

DEFAULT_WA_REMINDER = (
    "⏰ Reminder: {title} is coming up!\n\n"
    "Theme: {theme}\nDate: {date}\nTime: {time}\n\n"
    "Join on Zoom:\n{zoom_link}\n\n"
    "— SMARTS-SHAPES Team of Educators")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _fid():
    return f"ffld_{uuid.uuid4().hex[:8]}"


def default_event_fields():
    def mk(label, ftype, map_to, choices=None):
        return {"field_id": _fid(), "label": label, "type": ftype,
                "required": True, "choices": choices or [], "map_to": map_to}
    return [
        mk("Name", "text", "name"),
        mk("Email", "text", "email"),
        mk("School Name", "text", "school"),
        mk("Designation", "dropdown", "designation",
           ["Art Teacher", "Coordinator", "Pre Primary Teacher", "PRT", "TGT", "Other"]),
        mk("Contact Number", "text", "phone"),
        mk("City", "text", "city"),
    ]


def _default_messages():
    return {"email_subject": "", "email_html": "",
            "wa_confirm": DEFAULT_WA_CONFIRM, "wa_reminder": DEFAULT_WA_REMINDER}


def _can_manage(user, form) -> bool:
    if get_team(user) == "admin":
        return True
    email = (user.get("email") or "").lower()
    if email == (form.get("owner_email") or "").lower():
        return True
    return email in [(c or "").lower() for c in (form.get("collaborators") or [])]


async def _get_form_or_404(form_id: str) -> dict:
    form = await db.forms.find_one(
        {"form_id": form_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    return form


def _clean_fields(raw_fields) -> list:
    fields = []
    for f in (raw_fields or [])[:40]:
        ftype = f.get("type", "text")
        if ftype not in FIELD_TYPES:
            raise HTTPException(422, f"Unknown field type: {ftype}")
        map_to = f.get("map_to") or None
        if map_to is not None and map_to not in MAP_TO_KEYS:
            raise HTTPException(422, f"Unknown map_to: {map_to}")
        fields.append({
            "field_id": f.get("field_id") or _fid(),
            "label": str(f.get("label") or "")[:120],
            "type": ftype,
            "required": bool(f.get("required")),
            "choices": [str(c)[:80] for c in (f.get("choices") or [])][:30],
            "map_to": map_to,
        })
    return fields


def _clean_event(raw: dict) -> dict:
    ev = raw or {}
    out = {k: str(ev.get(k) or "")[:300] for k in
           ("theme", "date", "time", "platform", "meeting_link")}
    out["platform"] = out["platform"] or "zoom"
    try:
        out["duration_min"] = max(15, min(480, int(ev.get("duration_min") or 60)))
    except (TypeError, ValueError):
        out["duration_min"] = 60
    try:
        out["max_participants"] = max(0, int(ev.get("max_participants") or 0))
    except (TypeError, ValueError):
        out["max_participants"] = 0
    out["zoom_meeting_id"] = str(ev.get("zoom_meeting_id") or "")[:60]  # reserved for v2 auto-create
    return out


async def _sync_event_session(form: dict, user_email: str) -> str:
    """Create/update the training_sessions doc backing an event form so the
    existing webinar email lifecycle handles confirm/24h/1h stages."""
    ev = form.get("event") or {}
    sdoc = {
        "title": form.get("title", ""),
        "description": ev.get("theme", ""),
        "date": ev.get("date", ""),
        "time": ev.get("time", ""),
        "platform": ev.get("platform", "zoom"),
        "meeting_link": ev.get("meeting_link", ""),
        "location": "",
        "max_participants": ev.get("max_participants") or 0,
        "is_published": True,
        "zoom_meeting_id": ev.get("zoom_meeting_id") or "",
        "webinar_emails": dict(FORM_SESSION_EMAILS),
        "updated_at": _now(),
    }
    session_id = ev.get("session_id")
    if session_id and await db.training_sessions.find_one({"session_id": session_id}):
        await db.training_sessions.update_one({"session_id": session_id}, {"$set": sdoc})
        return session_id
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    await db.training_sessions.insert_one({
        **sdoc, "session_id": session_id, "status": "upcoming",
        "host_name": "", "host_email": "", "recording_url": "",
        "reminders_sent": {}, "source": "form",
        "created_at": _now(), "created_by": user_email,
    })
    return session_id


# ── Authenticated CRUD ────────────────────────────────────────────────────────

@router.get("/forms")
async def list_forms(request: Request):
    user = await get_current_user(request)
    q = {"is_deleted": {"$ne": True}}
    if get_team(user) != "admin":
        email = (user.get("email") or "").lower()
        q["$or"] = [{"owner_email": email}, {"collaborators": email}]
    forms = await db.forms.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for f in forms:
        f["response_count"] = await db.form_responses.count_documents({"form_id": f["form_id"]})
    return forms


@router.post("/forms")
async def create_form(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    ftype = body.get("type") if body.get("type") in ("event", "general") else "general"
    fields = _clean_fields(body.get("fields")) if body.get("fields") else (
        default_event_fields() if ftype == "event" else
        [{"field_id": _fid(), "label": "Name", "type": "text",
          "required": True, "choices": [], "map_to": "name"}])
    form = {
        "form_id": f"form_{uuid.uuid4().hex[:12]}",
        "title": str(body.get("title") or "Untitled form")[:200],
        "description": str(body.get("description") or "")[:2000],
        "type": ftype,
        "owner_email": (user.get("email") or "").lower(),
        "collaborators": [],
        "public_token": str(uuid.uuid4()),
        "status": "open",
        "banner_url": str(body.get("banner_url") or "")[:500],
        "fields": fields,
        "messages": _default_messages(),
        "manual_reminders": [],
        "is_deleted": False,
        "created_at": _now(),
        "updated_at": _now(),
    }
    if ftype == "event":
        form["event"] = _clean_event(body.get("event"))
        form["event"]["session_id"] = await _sync_event_session(form, form["owner_email"])
    await db.forms.insert_one(form)
    form.pop("_id", None)
    return form


@router.get("/forms/{form_id}")
async def get_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    return form


@router.put("/forms/{form_id}")
async def update_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    body = await request.json()
    updates = {}
    if "title" in body:
        updates["title"] = str(body.get("title") or "Untitled form")[:200]
    if "description" in body:
        updates["description"] = str(body.get("description") or "")[:2000]
    if "banner_url" in body:
        updates["banner_url"] = str(body.get("banner_url") or "")[:500]
    if "fields" in body:
        updates["fields"] = _clean_fields(body.get("fields"))
    if "collaborators" in body:
        updates["collaborators"] = [
            str(c).lower().strip() for c in (body.get("collaborators") or [])
            if "@" in str(c)][:20]
    if "messages" in body:
        msgs = {**(form.get("messages") or _default_messages())}
        for k in ("email_subject", "email_html", "wa_confirm", "wa_reminder"):
            if k in (body.get("messages") or {}):
                cap = 10000 if k == "email_html" else 2000
                msgs[k] = str(body["messages"].get(k) or "")[:cap]
        updates["messages"] = msgs
    if form.get("type") == "event" and "event" in body:
        ev = _clean_event(body.get("event"))
        ev["session_id"] = (form.get("event") or {}).get("session_id")
        merged = {**form, "event": ev,
                  "title": updates.get("title", form.get("title", ""))}
        ev["session_id"] = await _sync_event_session(merged, (user.get("email") or "").lower())
        updates["event"] = ev
    updates["updated_at"] = _now()
    await db.forms.update_one({"form_id": form_id}, {"$set": updates})
    return await _get_form_or_404(form_id)


@router.post("/forms/{form_id}/status")
async def set_form_status(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    body = await request.json()
    status = body.get("status")
    if status not in ("open", "closed"):
        raise HTTPException(422, "status must be open|closed")
    await db.forms.update_one({"form_id": form_id},
                              {"$set": {"status": status, "updated_at": _now()}})
    return {"ok": True, "status": status}


@router.delete("/forms/{form_id}")
async def delete_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    await db.forms.update_one({"form_id": form_id},
                              {"$set": {"is_deleted": True, "updated_at": _now()}})
    return {"ok": True}
