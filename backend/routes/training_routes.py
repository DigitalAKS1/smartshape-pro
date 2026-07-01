from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from datetime import datetime, timezone
import uuid, logging

from database import db
from auth_utils import get_current_user

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


# ── Training Sessions ─────────────────────────────────────────────────────────

@router.get("/training/sessions")
async def list_sessions(request: Request):
    sessions = await db.training_sessions.find({}, {"_id": 0}).sort("date", 1).to_list(200)
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
        "created_at": _now(),
        "created_by": user["email"],
    }
    await db.training_sessions.insert_one(doc)
    return {**doc, "registrations": 0}


@router.put("/training/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = ["title", "description", "date", "time", "platform",
               "meeting_link", "location", "max_participants", "status", "is_published"]
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
