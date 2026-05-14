from fastapi import APIRouter, HTTPException, Request
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


@router.get("/training/sessions/{session_id}/registrations")
async def get_registrations(session_id: str, request: Request):
    await get_current_user(request)
    regs = await db.session_registrations.find({"session_id": session_id}, {"_id": 0}).to_list(500)
    return regs


@router.post("/training/sessions/{session_id}/notify")
async def notify_session(session_id: str, request: Request):
    """Email all active customers about this training session."""
    await get_current_user(request)
    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    s = await db.settings.find_one({"type": "email"}, {"_id": 0})
    se = s.get("sender_email") if s else None
    ap = s.get("gmail_app_password") if s else None
    sn = s.get("sender_name", "SmartShape Pro") if s else "SmartShape Pro"
    if not se or not ap:
        raise HTTPException(status_code=400, detail="Email not configured")

    import os
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")

    quotations = await db.quotations.find(
        {"customer_email": {"$exists": True, "$ne": ""},
         "catalogue_token": {"$exists": True, "$ne": ""}},
        {"_id": 0, "customer_email": 1, "principal_name": 1, "school_name": 1, "catalogue_token": 1}
    ).to_list(2000)

    sent = 0
    for q in quotations:
        email = q.get("customer_email", "").strip()
        if not email:
            continue
        portal_url = f"{frontend_url}/my-quote/{q['catalogue_token']}"
        salutation = q.get("principal_name") or "Sir/Ma'am"
        body = f"""Dear {salutation},

We are pleased to invite you to an upcoming SmartShape Pro training session:

{session['title']}
Date: {session['date']}  |  Time: {session['time']}
Platform: {session['platform'].upper()}
{f"Meeting Link: {session['meeting_link']}" if session.get('meeting_link') else f"Location: {session.get('location','')}" }

{session.get('description','')}

You can register and view session details in your personal portal:
{portal_url}

Best regards,
SmartShape Pro Team"""
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            msg = MIMEMultipart()
            msg["From"] = f"{sn} <{se}>"
            msg["To"] = email
            msg["Subject"] = f"Training Session: {session['title']}"
            msg.attach(MIMEText(body, "plain", "utf-8"))
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
                smtp.login(se, ap)
                smtp.sendmail(se, [email], msg.as_string())
            sent += 1
        except Exception as e:
            logging.error(f"Session notify failed for {email}: {e}")

    return {"sent": sent}


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
