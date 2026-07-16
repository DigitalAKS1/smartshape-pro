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


# ── Public endpoints (NO auth — the token is the secret, catalogue pattern) ───

RATE_LIMIT, RATE_WINDOW, MAX_RESPONSES = 5, 600, 5000
_RATE = {}   # {(ip, form_id): [epoch_seconds, ...]} — in-memory, single process


def _client_ip(request: Request) -> str:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "?")


def _rate_ok(ip: str, form_id: str) -> bool:
    import time as _t
    now_s = _t.time()
    key = (ip, form_id)
    hits = [t for t in _RATE.get(key, []) if now_s - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        _RATE[key] = hits
        return False
    hits.append(now_s)
    _RATE[key] = hits
    if len(_RATE) > 10000:          # bot-flood memory backstop
        _RATE.clear()
    return True


def validate_answers(fields: list, answers: dict):
    """Returns (clean, errors). clean maps field_id -> str|list[str]."""
    clean, errors = {}, {}
    answers = answers if isinstance(answers, dict) else {}
    for f in fields:
        fid = f["field_id"]
        val = answers.get(fid)
        if isinstance(val, list):
            val = [str(v)[:200] for v in val][:30]
            empty = not val
        else:
            val = ("" if val is None else str(val)).strip()
            empty = not val
        if f.get("required") and empty:
            errors[fid] = "This field is required"
            continue
        if empty:
            clean[fid] = [] if f["type"] == "checkbox" else ""
            continue
        t = f["type"]
        if t in ("dropdown", "multiple_choice"):
            if val not in f.get("choices", []):
                errors[fid] = "Invalid choice"
                continue
        elif t == "checkbox":
            if not isinstance(val, list) or any(v not in f.get("choices", []) for v in val):
                errors[fid] = "Invalid choice"
                continue
        elif t == "number":
            try:
                float(str(val).replace(",", ""))
            except ValueError:
                errors[fid] = "Must be a number"
                continue
            val = str(val)[:40]
        elif t == "textarea":
            val = str(val)[:2000]
        elif t == "date":
            val = str(val)[:40]
        else:
            val = str(val)[:200]
        clean[fid] = val
    return clean, errors


def _mapped(form: dict, clean: dict) -> dict:
    """{map_to: answer} for CRM + registration use."""
    out = {}
    for f in form.get("fields", []):
        if f.get("map_to") and clean.get(f["field_id"]):
            out[f["map_to"]] = clean[f["field_id"]]
    return out


def gcal_url(form: dict) -> str:
    """Prefilled Google-Calendar 'add event' URL (works in WhatsApp texts)."""
    from urllib.parse import urlencode
    from datetime import timedelta
    from webinar_lifecycle import session_start_ist
    ev = form.get("event") or {}
    start = session_start_ist({"date": ev.get("date"), "time": ev.get("time")})
    if not start:
        return ""
    end = start + timedelta(minutes=int(ev.get("duration_min") or 60))
    fmt = "%Y%m%dT%H%M%SZ"
    details = f"Join: {ev.get('meeting_link', '')}" if ev.get("meeting_link") else ""
    return "https://calendar.google.com/calendar/render?" + urlencode({
        "action": "TEMPLATE", "text": form.get("title", ""),
        "dates": f"{start.strftime(fmt)}/{end.strftime(fmt)}",
        "details": details})


def _thank_you(form: dict) -> dict:
    ev = form.get("event") or {}
    if form.get("type") != "event":
        return {"message": "Thank you! Your response has been recorded."}
    return {"message": "Registration confirmed! Check your email & WhatsApp for the joining details.",
            "title": form.get("title", ""), "theme": ev.get("theme", ""),
            "date": ev.get("date", ""), "time": ev.get("time", ""),
            "zoom_link": ev.get("meeting_link", ""), "calendar_link": gcal_url(form)}


@router.get("/forms/public/{token}")
async def public_form(token: str):
    form = await db.forms.find_one(
        {"public_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    if form.get("status") != "open":
        return {"status": "closed", "title": form.get("title", "")}
    ev = form.get("event") or {}
    return {
        "status": "open",
        "title": form.get("title", ""),
        "description": form.get("description", ""),
        "type": form.get("type", "general"),
        "banner_url": form.get("banner_url", ""),
        "fields": form.get("fields", []),
        # meeting_link deliberately withheld — revealed only after registering
        "event": {k: ev.get(k, "") for k in ("theme", "date", "time", "platform", "duration_min")},
    }


@router.post("/forms/public/{token}/submit")
async def public_submit(token: str, request: Request):
    import hashlib
    form = await db.forms.find_one(
        {"public_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    if form.get("status") != "open":
        raise HTTPException(410, "Registrations are closed")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(422, "Invalid request body")
    ip = _client_ip(request)
    if not _rate_ok(ip, form["form_id"]):
        raise HTTPException(429, "Too many attempts — please try again in a few minutes")
    if (body.get("website") or "").strip():     # honeypot: silent no-op success, no details
        return {"ok": True,
                "thank_you": {"message": "Thank you! Your response has been recorded."}}
    if await db.form_responses.count_documents({"form_id": form["form_id"]}) >= MAX_RESPONSES:
        raise HTTPException(410, "Registrations are closed")
    clean, errors = validate_answers(form.get("fields", []), body.get("answers"))
    if errors:
        raise HTTPException(422, detail={"field_errors": errors})

    response = {
        "response_id": f"fresp_{uuid.uuid4().hex[:12]}",
        "form_id": form["form_id"],
        "answers": clean,
        "submitted_at": _now(),
        "ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:16],
        "contact_id": None, "school_id": None, "registration_id": None,
        "delivery": {"email": "skipped", "whatsapp": "skipped"},
    }
    await db.form_responses.insert_one(response)
    response.pop("_id", None)

    mapped = _mapped(form, clean)
    updates = {}
    from services.form_crm import upsert_contact
    contact_id, school_id = await upsert_contact(db, mapped, form["form_id"])
    updates["contact_id"], updates["school_id"] = contact_id, school_id
    if form.get("type") == "event" and (form.get("event") or {}).get("session_id"):
        session = await db.training_sessions.find_one(
            {"session_id": form["event"]["session_id"]}, {"_id": 0})
        if session:
            email_l = (mapped.get("email") or "").strip().lower()
            reg = None
            if "@" in email_l:
                reg = await db.session_registrations.find_one(
                    {"session_id": session["session_id"], "email": email_l})
            if not reg:
                reg = {"reg_id": f"reg_{uuid.uuid4().hex[:12]}",
                       "session_id": session["session_id"],
                       "name": mapped.get("name") or "",
                       "email": email_l if "@" in email_l else "",
                       "school_name": mapped.get("school") or "",
                       "phone": mapped.get("phone") or "",
                       "contact_id": updates.get("contact_id"),
                       "status": "registered", "sent_stages": [],
                       "wa_sent_stages": [], "registered_at": _now(),
                       "source_form_id": form["form_id"]}
                await db.session_registrations.insert_one(reg)
                reg.pop("_id", None)
            updates["registration_id"] = reg["reg_id"]
            # Confirmation email: custom template if set, else engine stage
            from routes.training_routes import _enqueue_webinar_stage
            custom = await _enqueue_custom_confirm_email(form, session, reg)
            if custom is None:
                sent = await _enqueue_webinar_stage(session, reg, "confirm")
                updates["delivery.email"] = "queued" if sent else "skipped"
            else:
                updates["delivery.email"] = custom
            # WhatsApp confirmation (instant; idempotent per registration)
            wa_ok = False
            if "confirm" not in (reg.get("wa_sent_stages") or []):
                wa_msg = render_msg(
                    (form.get("messages") or {}).get("wa_confirm") or DEFAULT_WA_CONFIRM,
                    _msg_ctx(form, reg))
                wa_ok = await _enqueue_wa(reg.get("phone"), wa_msg, f"form_{form['form_id']}")
                if wa_ok:
                    await db.session_registrations.update_one(
                        {"reg_id": reg["reg_id"]},
                        {"$addToSet": {"wa_sent_stages": "confirm"}})
            updates["delivery.whatsapp"] = "queued" if wa_ok else "skipped"
    if updates:
        await db.form_responses.update_one(
            {"response_id": response["response_id"]}, {"$set": updates})
    return {"ok": True, "thank_you": _thank_you(form)}


# ── Confirmation / reminder messaging ─────────────────────────────────────────

def render_msg(tmpl: str, ctx: dict) -> str:
    out = tmpl or ""
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", str(v or ""))
    return out


def _msg_ctx(form: dict, reg: dict) -> dict:
    ev = form.get("event") or {}
    first = (reg.get("name") or "").split(" ")[0]
    return {"name": first or "there",
            "school_name": reg.get("school_name") or "your school",
            "title": form.get("title", ""), "theme": ev.get("theme", ""),
            "date": ev.get("date", ""), "time": ev.get("time", ""),
            "zoom_link": ev.get("meeting_link", ""),
            "calendar_link": gcal_url(form)}


async def _enqueue_wa(phone: str, message: str, campaign_id: str) -> bool:
    """Queue one WhatsApp text via the existing wa_sender_loop queue."""
    phone = (phone or "").strip()
    if len(re.sub(r"\D", "", phone)) < 10:
        return False
    await db.whatsapp_scheduled.insert_one({
        "scheduled_id": f"wsch_{uuid.uuid4().hex[:12]}", "campaign_id": campaign_id,
        "status": "pending", "phone": phone, "message": message,
        "created_at": _now()})
    return True


async def _enqueue_custom_confirm_email(form: dict, session: dict, reg: dict):
    """If the form owner customised the confirmation email, queue THAT instead
    of the engine's stage template. Returns None (no custom template — caller
    uses engine stage) | "queued" | "skipped"."""
    msgs = form.get("messages") or {}
    subject_t = (msgs.get("email_subject") or "").strip()
    html_t = (msgs.get("email_html") or "").strip()
    if not (subject_t and html_t):
        return None
    if "confirm" in (reg.get("sent_stages") or []):
        return "skipped"
    email = (reg.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return "skipped"
    if await db.email_suppressions.find_one({"email": email}):
        return "skipped"
    from email_utils import (sanitize_html, personalize, personalize_html,
                             plain_from_html, wrap_email_shell)
    ctx = _msg_ctx(form, reg)
    html = wrap_email_shell(sanitize_html(render_msg(html_t, ctx)))
    subject = render_msg(subject_t, ctx)
    first, school = ctx["name"], ctx["school_name"]
    await db.email_scheduled.insert_one({
        "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
        "campaign_id": f"form_{form['form_id']}",
        "email": email, "contact_name": reg.get("name", ""),
        "subject": personalize(subject, first, school),
        "message": personalize(plain_from_html(html), first, school),
        "body_html": personalize_html(html, first, school),
        "status": "pending", "type": "webinar", "queued_at": _now(), "sent_at": None})
    await db.session_registrations.update_one(
        {"reg_id": reg["reg_id"]}, {"$addToSet": {"sent_stages": "confirm"}})
    return "queued"


# ── Reminders ─────────────────────────────────────────────────────────────────

async def enqueue_form_wa_stage(session: dict, reg: dict, stage: str) -> bool:
    """WhatsApp companion to the email reminder stages (remind_24h/remind_1h).
    Called by scheduler.process_webinar_lifecycle for form-linked sessions.
    Idempotent per registration+stage via wa_sent_stages."""
    form = await db.forms.find_one(
        {"event.session_id": session.get("session_id"), "is_deleted": {"$ne": True}},
        {"_id": 0})
    if not form:
        return False
    if stage in (reg.get("wa_sent_stages") or []):
        return False
    msg = render_msg(
        (form.get("messages") or {}).get("wa_reminder") or DEFAULT_WA_REMINDER,
        _msg_ctx(form, reg))
    if not await _enqueue_wa(reg.get("phone"), msg, f"form_{form['form_id']}"):
        return False
    await db.session_registrations.update_one(
        {"reg_id": reg["reg_id"]}, {"$addToSet": {"wa_sent_stages": stage}})
    return True


@router.post("/forms/{form_id}/remind")
async def send_reminder_now(form_id: str, request: Request):
    """Manual blast: reminder email + WhatsApp to every registered attendee, now."""
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    if form.get("type") != "event" or not (form.get("event") or {}).get("session_id"):
        raise HTTPException(422, "Only event forms have reminders")
    session = await db.training_sessions.find_one(
        {"session_id": form["event"]["session_id"]}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Linked session not found")

    from routes.training_routes import _session_tokens
    from webinar_templates_html import render_stage
    from email_utils import (sanitize_html, personalize, personalize_html,
                             plain_from_html, wrap_email_shell)
    subject_t, inner = render_stage("remind_1h", _session_tokens(session))
    html_t = wrap_email_shell(sanitize_html(inner))

    regs = await db.session_registrations.find(
        {"session_id": session["session_id"], "status": "registered"},
        {"_id": 0}).to_list(5000)
    emails = wa = 0
    for reg in regs:
        email = (reg.get("email") or "").strip().lower()
        if email and "@" in email and \
                not await db.email_suppressions.find_one({"email": email}):
            first = (reg.get("name") or "").split(" ")[0]
            school = reg.get("school_name") or "your school"
            await db.email_scheduled.insert_one({
                "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
                "campaign_id": f"form_{form_id}", "email": email,
                "contact_name": reg.get("name", ""),
                "subject": personalize(subject_t, first, school),
                "message": personalize(plain_from_html(html_t), first, school),
                "body_html": personalize_html(html_t, first, school),
                "status": "pending", "type": "webinar",
                "queued_at": _now(), "sent_at": None})
            emails += 1
        msg = render_msg(
            (form.get("messages") or {}).get("wa_reminder") or DEFAULT_WA_REMINDER,
            _msg_ctx(form, reg))
        if await _enqueue_wa(reg.get("phone"), msg, f"form_{form_id}"):
            wa += 1
    await db.forms.update_one({"form_id": form_id}, {"$push": {"manual_reminders": {
        "at": _now(), "by": user["email"], "emails": emails, "whatsapp": wa}}})
    return {"emails": emails, "whatsapp": wa, "registrants": len(regs)}
