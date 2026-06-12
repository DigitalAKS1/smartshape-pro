"""Teacher (school sub-account) authentication helpers: one-time activation tokens + invite email.

Teachers are sub-accounts of a school. Reuses the hashing + email patterns from school_auth,
but keeps its own token collection (`teacher_auth_tokens`) so the live school flow is untouched.
"""
import os
import smtplib
import secrets
import logging
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db
from services.school_auth import _hash, _frontend_base, _send_email

ACTIVATION_TTL = timedelta(days=7)


def _now():
    return datetime.now(timezone.utc)


def activation_url(raw: str) -> str:
    return f"{_frontend_base()}/teacher/activate?token={raw}"


async def issue_token(teacher_id: str, email: str) -> str:
    """Single-use activation token for a teacher; invalidates prior unused ones. Returns RAW token."""
    await db.teacher_auth_tokens.update_many(
        {"teacher_id": teacher_id, "used": False}, {"$set": {"used": True}}
    )
    raw = secrets.token_urlsafe(32)
    await db.teacher_auth_tokens.insert_one({
        "token_hash": _hash(raw),
        "teacher_id": teacher_id,
        "email": email,
        "expires_at": (_now() + ACTIVATION_TTL).isoformat(),
        "used": False,
        "created_at": _now().isoformat(),
    })
    return raw


async def peek_token(raw: str) -> dict | None:
    """Validate without burning. Returns the teacher doc on success."""
    if not raw:
        return None
    doc = await db.teacher_auth_tokens.find_one({"token_hash": _hash(raw)})
    if not doc or doc.get("used"):
        return None
    try:
        if datetime.fromisoformat(doc["expires_at"]) < _now():
            return None
    except Exception:
        return None
    return await db.teachers.find_one({"teacher_id": doc["teacher_id"]})


async def consume_token(raw: str) -> dict | None:
    """Validate + burn. Returns the teacher doc on success."""
    if not raw:
        return None
    doc = await db.teacher_auth_tokens.find_one({"token_hash": _hash(raw)})
    if not doc or doc.get("used"):
        return None
    try:
        if datetime.fromisoformat(doc["expires_at"]) < _now():
            return None
    except Exception:
        return None
    await db.teacher_auth_tokens.update_one({"token_hash": doc["token_hash"]}, {"$set": {"used": True}})
    return await db.teachers.find_one({"teacher_id": doc["teacher_id"]})


async def send_teacher_invite(teacher: dict, school_name: str = "") -> dict:
    """Email the teacher an activation link to set their password. Returns {sent, activation_url}."""
    email = (teacher.get("email") or "").strip()
    if not email:
        return {"sent": False, "activation_url": None}
    raw = await issue_token(teacher["teacher_id"], email)
    url = activation_url(raw)
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#e94560">SmartShape Teacher Portal</h2>
      <p>Hello {teacher.get('name', 'Teacher')},</p>
      <p>{school_name or 'Your school'} has invited you to the SmartShape teacher portal —
         upload your workshop videos and take part in competitions.</p>
      <p style="margin:28px 0">
        <a href="{url}" style="background:#e94560;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Set your password</a>
      </p>
      <p style="color:#888;font-size:12px">If you didn't expect this, you can ignore this email.</p>
    </div>"""
    sent = await _send_email(email, "Activate your SmartShape Teacher Portal", html)
    return {"sent": sent, "activation_url": url}
