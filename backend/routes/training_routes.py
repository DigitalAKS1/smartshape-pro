from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from datetime import datetime, timezone
import os, uuid, logging

from database import db
from auth_utils import get_current_user

router = APIRouter()

WEBINAR_STAGES = ("confirm", "remind_24h", "remind_1h", "live", "noshow", "attended")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _default_webinar_emails():
    return {k: True for k in WEBINAR_STAGES}


def _session_tokens(session: dict) -> dict:
    """Merge tokens for a webinar-lifecycle email. `{name}`/`{school_name}` are
    left as-is here for later per-recipient personalize()/personalize_html()."""
    session_id = session.get("session_id", "")
    return {
        "{name}": "{name}",
        "{school_name}": "{school_name}",
        "{session_title}": session.get("title", ""),
        "{session_date}": session.get("date", ""),
        "{session_time}": session.get("time", ""),
        "{platform}": session.get("platform", ""),
        "{join_url}": session.get("meeting_link", ""),
        "{host_name}": session.get("host_name", ""),
        "{recording_url}": session.get("recording_url", ""),
        "{add_to_calendar_url}": f"{FRONTEND_URL}/api/training/sessions/{session_id}/ics",
    }


def _apply_tokens(text: str, tokens: dict) -> str:
    for k, v in tokens.items():
        text = text.replace(k, v or "")
    return text


def _stage_email_content(stage: str, tokens: dict) -> tuple[str, str]:
    """Returns (subject, html_inner) for a webinar-lifecycle stage, with session
    tokens already substituted (trusted app data). `{name}`/`{school_name}`
    remain for per-recipient personalize()/personalize_html() downstream.

    FOR NOW only "confirm" (Stage 2) is implemented; Task 4 replaces this with
    the full webinar_templates_html.STAGE_HTML set for all stages.
    """
    if stage == "confirm":
        subject = f"You're Registered: {tokens['{session_title}']}"
        html_inner = (
            f'<h2 style="color:#e94560;margin:0 0 8px;">You\'re registered!</h2>'
            f'<p>Dear {{name}}, you are confirmed for <strong>{tokens["{session_title}"]}</strong>.</p>'
            f'<p><strong>Date:</strong> {tokens["{session_date}"]} &nbsp; '
            f'<strong>Time:</strong> {tokens["{session_time}"]}</p>'
            f'<p><a href="{tokens["{join_url}"]}" style="background:#e94560;color:#fff;'
            f'padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">'
            f'Join the Session</a></p>'
            f'<p><a href="{tokens["{add_to_calendar_url}"]}">Add to Calendar</a></p>'
        )
        return subject, html_inner
    raise ValueError(f"Unknown webinar stage: {stage}")


async def _enqueue_webinar_stage(session: dict, reg: dict, stage: str) -> bool:
    """Shared enqueuer for webinar-lifecycle stage emails. Reused by the
    register endpoint (stage "confirm") and the scheduler (Task 6, later
    stages). Idempotent per registration+stage via `sent_stages`.
    """
    campaign_id = f"webinar_{session['session_id']}"
    await db.email_campaigns.update_one(
        {"campaign_id": campaign_id},
        {"$setOnInsert": {
            "campaign_id": campaign_id,
            "name": f"Webinar: {session.get('title','')}"[:60],
            "source": "webinar", "source_id": session["session_id"],
            "subject": f"Webinar: {session.get('title','')}",
            "audience_filter": {}, "audience_label": "Webinar registrants",
            "audience_count": 0, "status": "queued",
            "sent_count": 0, "delivered_count": 0, "failed_count": 0,
            "created_at": _now(), "updated_at": _now(), "sent_at": _now(),
        }},
        upsert=True,
    )

    if stage in (reg.get("sent_stages") or []):
        return False

    email = (reg.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return False
    if await db.email_suppressions.find_one({"email": email}):
        return False

    from email_utils import sanitize_html, personalize, personalize_html, plain_from_html, wrap_email_shell

    tokens = _session_tokens(session)
    subject_tmpl, html_inner_tmpl = _stage_email_content(stage, tokens)
    subject_final = _apply_tokens(subject_tmpl, tokens)
    html_with_session_tokens = _apply_tokens(html_inner_tmpl, tokens)
    html_tmpl = wrap_email_shell(sanitize_html(html_with_session_tokens))

    first = (reg.get("name") or "").split(" ")[0]
    school = reg.get("school_name") or "your school"

    now = _now()
    await db.email_scheduled.insert_one({
        "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
        "campaign_id": campaign_id,
        "email": email,
        "contact_name": reg.get("name", ""),
        "subject": personalize(subject_final, first, school),
        "message": personalize(plain_from_html(html_tmpl), first, school),
        "body_html": personalize_html(html_tmpl, first, school),
        "status": "pending",
        "type": "webinar",
        "queued_at": now,
        "sent_at": None,
    })

    await db.session_registrations.update_one(
        {"reg_id": reg["reg_id"]}, {"$addToSet": {"sent_stages": stage}}
    )
    return True


# ── Training Sessions ─────────────────────────────────────────────────────────

@router.get("/training/sessions")
async def list_sessions(request: Request):
    sessions = await db.training_sessions.find({}, {"_id": 0}).sort("date", 1).to_list(200)
    # Backfill webinar_emails defaults for legacy docs so reads are consistent.
    for s in sessions:
        s["webinar_emails"] = {**_default_webinar_emails(), **(s.get("webinar_emails") or {})}
        s.setdefault("reminders_sent", {})
        s.setdefault("host_name", "")
        s.setdefault("host_email", "")
        s.setdefault("recording_url", "")
        s.setdefault("zoom_meeting_id", "")
    return sessions


@router.post("/training/sessions")
async def create_session(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    doc = {
        "session_id": session_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "date": body.get("date", ""),
        "time": body.get("time", ""),
        "platform": body.get("platform", "zoom"),      # zoom / meet / physical
        "meeting_link": body.get("meeting_link", ""),
        "location": body.get("location", ""),
        "max_participants": body.get("max_participants", 0),
        "status": "upcoming",
        "is_published": body.get("is_published", True),
        "host_name": body.get("host_name", ""),
        "host_email": body.get("host_email", ""),
        "recording_url": body.get("recording_url", ""),
        "zoom_meeting_id": body.get("zoom_meeting_id", ""),
        "webinar_emails": {**_default_webinar_emails(), **(body.get("webinar_emails") or {})},
        "reminders_sent": {},
        "created_at": _now(),
        "created_by": user["email"],
    }
    await db.training_sessions.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "registrations": 0}


@router.put("/training/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = ["title", "description", "date", "time", "platform",
               "meeting_link", "location", "max_participants", "status", "is_published",
               "host_name", "host_email", "recording_url", "zoom_meeting_id", "webinar_emails"]
    updates = {k: body[k] for k in allowed if k in body}
    updates["updated_at"] = _now()
    await db.training_sessions.update_one({"session_id": session_id}, {"$set": updates})
    return {"ok": True}


@router.delete("/training/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    await get_current_user(request)
    await db.training_sessions.delete_one({"session_id": session_id})
    await db.session_registrations.delete_many({"session_id": session_id})
    return {"ok": True}


@router.get("/training/sessions/{session_id}/ics")
async def session_ics(session_id: str):
    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    from webinar_ics import build_session_ics
    ics = build_session_ics(session)
    return Response(content=ics, media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="{session_id}.ics"'})


@router.get("/training/sessions/{session_id}/registrations")
async def get_registrations(session_id: str, request: Request):
    await get_current_user(request)
    regs = await db.session_registrations.find({"session_id": session_id}, {"_id": 0}).to_list(500)
    return regs


@router.post("/training/sessions/{session_id}/register")
async def register_for_session(session_id: str, request: Request):
    """Staff-initiated registration for a training session/webinar. Dedups by
    (session_id, email); re-registering the same email reuses the existing
    row instead of creating a duplicate. Enqueues the Stage-2 confirmation
    email via the shared _enqueue_webinar_stage helper unless disabled.
    """
    user = await get_current_user(request)
    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    name = body.get("name", "")
    school_name = body.get("school_name", "")
    contact_id = body.get("contact_id")

    reg = await db.session_registrations.find_one({"session_id": session_id, "email": email})
    if not reg:
        reg = {
            "reg_id": f"reg_{uuid.uuid4().hex[:12]}",
            "session_id": session_id,
            "name": name,
            "email": email,
            "school_name": school_name,
            "contact_id": contact_id,
            "status": "registered",
            "sent_stages": [],
            "registered_at": _now(),
        }
        await db.session_registrations.insert_one(reg)

    webinar_emails = {**_default_webinar_emails(), **(session.get("webinar_emails") or {})}
    if webinar_emails.get("confirm", True):
        await _enqueue_webinar_stage(session, reg, "confirm")

    return {"registered": True, "reg_id": reg["reg_id"]}


@router.post("/training/sessions/{session_id}/notify")
async def notify_session(session_id: str, request: Request):
    """Queue an HTML training-session invite to every quotation-customer email.

    Builds one source-tagged email_campaigns doc and personalized email_scheduled
    rows (type "campaign"); the existing queue processor + scheduler deliver them.
    No inline/synchronous SMTP here.
    """
    user = await get_current_user(request)
    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    from email_utils import sanitize_html, personalize, personalize_html, plain_from_html, wrap_email_shell

    link_line = (f'<p><a href="{session.get("meeting_link","")}" style="background:#e94560;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Join the Session</a></p>'
                 if session.get("meeting_link") else f'<p>Location: {session.get("location","")}</p>')
    inner = (f'<h2 style="color:#e94560;margin:0 0 8px;">{session["title"]}</h2>'
             f'<p><strong>Date:</strong> {session.get("date","")} &nbsp; <strong>Time:</strong> {session.get("time","")}</p>'
             f'<p>{session.get("description","")}</p>{link_line}'
             f'<p style="color:#666;font-size:13px;">Dear {{name}}, you are invited to this SmartShape training session.</p>')
    html_tmpl = wrap_email_shell(sanitize_html(inner))
    text_tmpl = plain_from_html(inner)

    now = _now()
    campaign_id = f"ecamp_{uuid.uuid4().hex[:10]}"
    await db.email_campaigns.insert_one({
        "campaign_id": campaign_id, "name": f"Session: {session['title']}"[:60],
        "subject": f"Training Session: {session['title']}", "body_html": html_tmpl, "message": text_tmpl,
        "source": "training_session", "source_id": session_id, "audience_filter": {},
        "audience_label": "Quotation customers", "audience_count": 0, "status": "queued",
        "sent_count": 0, "delivered_count": 0, "failed_count": 0,
        "created_by": user["email"], "created_at": now, "updated_at": now, "sent_at": now,
    })
    quotations = await db.quotations.find(
        {"customer_email": {"$exists": True, "$ne": ""}},
        {"_id": 0, "customer_email": 1, "principal_name": 1, "school_name": 1}).to_list(2000)
    seen, queued = set(), 0
    for q in quotations:
        email_addr = (q.get("customer_email") or "").strip().lower()
        if not email_addr or "@" not in email_addr or email_addr in seen:
            continue
        seen.add(email_addr)
        if await db.email_suppressions.find_one({"email": email_addr}):
            continue
        first = q.get("principal_name") or "Sir/Ma'am"
        school = q.get("school_name") or "your school"
        await db.email_scheduled.insert_one({
            "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}", "campaign_id": campaign_id,
            "email": q["customer_email"].strip(), "contact_name": first,
            "subject": f"Training Session: {session['title']}",
            "message": personalize(text_tmpl, first, school),
            "body_html": personalize_html(html_tmpl, first, school),
            "status": "pending", "queued_at": now, "sent_at": None, "type": "campaign",
        })
        queued += 1
    await db.email_campaigns.update_one({"campaign_id": campaign_id}, {"$set": {"audience_count": queued}})
    return {"queued": queued}


# ── Training Videos ───────────────────────────────────────────────────────────

@router.get("/training/videos")
async def list_videos():
    videos = await db.training_videos.find({}, {"_id": 0}).sort("published_at", -1).to_list(500)
    return videos


@router.post("/training/videos")
async def create_video(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    video_id = f"vid_{uuid.uuid4().hex[:12]}"
    youtube_url = body.get("youtube_url", "")
    # Extract thumbnail from YouTube URL
    thumbnail = ""
    import re
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", youtube_url)
    if match:
        vid_code = match.group(1)
        thumbnail = f"https://img.youtube.com/vi/{vid_code}/hqdefault.jpg"
        # Build clean embed URL
        youtube_url = f"https://www.youtube.com/embed/{vid_code}"
    doc = {
        "video_id": video_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "youtube_url": youtube_url,
        "thumbnail_url": body.get("thumbnail_url") or thumbnail,
        "duration_mins": body.get("duration_mins", 0),
        "category": body.get("category", "product_training"),
        "tags": body.get("tags", []),
        "is_published": body.get("is_published", True),
        "view_count": 0,
        "published_at": _now(),
        "created_by": user["email"],
    }
    await db.training_videos.insert_one(doc)
    return doc


@router.put("/training/videos/{video_id}")
async def update_video(video_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = ["title", "description", "youtube_url", "thumbnail_url",
               "duration_mins", "category", "tags", "is_published"]
    updates = {k: body[k] for k in allowed if k in body}
    updates["updated_at"] = _now()
    await db.training_videos.update_one({"video_id": video_id}, {"$set": updates})
    return {"ok": True}


@router.delete("/training/videos/{video_id}")
async def delete_video(video_id: str, request: Request):
    await get_current_user(request)
    await db.training_videos.delete_one({"video_id": video_id})
    return {"ok": True}


@router.post("/training/videos/{video_id}/view")
async def increment_view(video_id: str):
    """Public — increment view count when customer plays a video."""
    await db.training_videos.update_one({"video_id": video_id}, {"$inc": {"view_count": 1}})
    return {"ok": True}
