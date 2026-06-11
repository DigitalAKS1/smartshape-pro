"""School Portal authentication helpers: one-time tokens, method resolution, invite email."""
import os
import hashlib
import secrets
import smtplib
import logging
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db

# Token lifetimes
ACTIVATION_TTL = timedelta(days=7)
MAGIC_TTL = timedelta(minutes=15)

DEFAULT_METHODS = {"email_link": True, "magic_link": False, "google": False}


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now():
    return datetime.now(timezone.utc)


def _frontend_base() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _backend_base() -> str:
    return (os.environ.get("BACKEND_PUBLIC_URL") or _frontend_base()).rstrip("/")


async def get_global_settings() -> dict:
    doc = await db.settings.find_one({"type": "school_portal"}, {"_id": 0}) or {}
    return {
        # All methods default OFF — the portal stays dormant until an admin enables it in App Settings.
        "email_link_enabled": bool(doc.get("email_link_enabled", False)),
        "magic_link_enabled": bool(doc.get("magic_link_enabled", False)),
        "google_enabled": bool(doc.get("google_enabled", False)),
        "google_client_id": doc.get("google_client_id", ""),
        "google_client_secret": doc.get("google_client_secret", ""),
    }


async def effective_methods(school: dict) -> dict:
    """What this school may use = its per-quote override, else global defaults,
    intersected with global enablement (a method must be allowed by BOTH)."""
    g = await get_global_settings()
    glob = {"email_link": g["email_link_enabled"], "magic_link": g["magic_link_enabled"], "google": g["google_enabled"]}
    override = school.get("portal_login_methods")
    base = override if isinstance(override, dict) else glob
    return {k: bool(base.get(k, False)) and bool(glob.get(k, False)) for k in ("email_link", "magic_link", "google")}


async def issue_token(school_id: str, email: str, purpose: str) -> str:
    """Create a single-use token, invalidating prior unused tokens of the same purpose. Returns the RAW token."""
    await db.school_auth_tokens.update_many(
        {"school_id": school_id, "purpose": purpose, "used": False},
        {"$set": {"used": True}},
    )
    raw = secrets.token_urlsafe(32)
    ttl = ACTIVATION_TTL if purpose == "activation" else MAGIC_TTL
    await db.school_auth_tokens.insert_one({
        "token_hash": _hash(raw),
        "school_id": school_id,
        "email": email,
        "purpose": purpose,
        "expires_at": (_now() + ttl).isoformat(),
        "used": False,
        "created_at": _now().isoformat(),
    })
    return raw


async def peek_token(raw: str, purpose: str) -> dict | None:
    """Validate WITHOUT burning. Returns the school doc on success, else None."""
    if not raw:
        return None
    doc = await db.school_auth_tokens.find_one({"token_hash": _hash(raw), "purpose": purpose})
    if not doc or doc.get("used"):
        return None
    try:
        if datetime.fromisoformat(doc["expires_at"]) < _now():
            return None
    except Exception:
        return None
    return await db.schools.find_one({"school_id": doc["school_id"]})


async def consume_token(raw: str, purpose: str) -> dict | None:
    """Validate + burn a token. Returns the school doc on success, else None."""
    if not raw:
        return None
    doc = await db.school_auth_tokens.find_one({"token_hash": _hash(raw), "purpose": purpose})
    if not doc or doc.get("used"):
        return None
    try:
        if datetime.fromisoformat(doc["expires_at"]) < _now():
            return None
    except Exception:
        return None
    await db.school_auth_tokens.update_one({"token_hash": doc["token_hash"]}, {"$set": {"used": True}})
    return await db.schools.find_one({"school_id": doc["school_id"]})


def activation_url(raw: str) -> str:
    return f"{_frontend_base()}/school/activate?token={raw}"


def magic_url(raw: str) -> str:
    return f"{_backend_base()}/api/school/auth/magic-link/verify?token={raw}"


def login_url() -> str:
    return f"{_frontend_base()}/school/login"


async def _send_email(to_email: str, subject: str, html: str) -> bool:
    cfg = await db.settings.find_one({"type": "email"}, {"_id": 0}) or {}
    sender = (cfg.get("sender_email") or "").strip()
    pwd = (cfg.get("gmail_app_password") or "").strip()
    if not (sender and pwd):
        logging.warning("school_auth: email not configured; skipping send to %s", to_email)
        return False
    try:
        msg = MIMEMultipart()
        msg["From"] = f"{cfg.get('sender_name', 'SmartShape Pro')} <{sender}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender, pwd)
            server.sendmail(sender, [to_email], msg.as_string())
        return True
    except Exception as e:
        logging.error("school_auth: invite email failed: %s", str(e)[:200])
        return False


async def send_portal_invite(school: dict) -> dict:
    """Send the activation/welcome email per the school's effective methods.
    Returns {sent: bool, activation_url: str|None}."""
    email = (school.get("email") or "").strip()
    if not email:
        return {"sent": False, "activation_url": None}
    methods = await effective_methods(school)
    if not any(methods.values()):
        return {"sent": False, "activation_url": None}
    name = school.get("school_name", "your school")
    if methods["email_link"]:
        raw = await issue_token(school["school_id"], email, "activation")
        url = activation_url(raw)
        cta, link, result_url = "Set your password", url, url
    else:
        cta, link, result_url = "Open your portal", login_url(), None
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#e94560">SmartShape School Portal</h2>
      <p>Hello {name},</p>
      <p>Your school portal is ready. You can view your quotations, orders and more.</p>
      <p style="margin:28px 0">
        <a href="{link}" style="background:#e94560;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">{cta}</a>
      </p>
      <p style="color:#888;font-size:12px">If you didn't expect this, you can ignore this email.</p>
    </div>"""
    sent = await _send_email(email, "Your SmartShape School Portal is ready", html)
    return {"sent": sent, "activation_url": result_url}
