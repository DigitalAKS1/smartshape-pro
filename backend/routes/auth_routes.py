from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import jwt
import requests
import os
import logging
import smtplib
import urllib.parse
import httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# In production (HTTPS) use samesite=none + secure=True for cross-domain cookies
_PROD = os.environ.get("FRONTEND_URL", "").startswith("https")
_COOKIE_KWARGS = dict(httponly=True, secure=_PROD, samesite="none" if _PROD else "lax", path="/")

from database import db
from auth_utils import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    get_current_user, get_current_school,
    JWT_SECRET, JWT_ALGORITHM,
)
from services import school_auth

_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"

router = APIRouter()


async def _notify_admin_new_device(user_name: str, user_email: str, device_label: str, ip: str):
    """Send email to all admin users when a new device registers as pending."""
    try:
        email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0}) or {}
        sender_email = email_settings.get("smtp_user", "")
        app_password = email_settings.get("smtp_password", "")
        if not sender_email or not app_password:
            return

        admins = await db.users.find({"role": "admin", "is_active": {"$ne": False}}, {"_id": 0, "email": 1}).to_list(20)
        admin_emails = [a["email"] for a in admins if a.get("email")]
        if not admin_emails:
            return

        frontend_url = os.environ.get("FRONTEND_URL", "https://app.smartshape.in")
        subject = f"[SmartShape] New Device Pending Approval — {user_name}"
        html = f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
          <div style="background:#123c69;padding:20px 30px;">
            <h2 style="color:#fff;margin:0;font-size:18px;">New Device Approval Required</h2>
          </div>
          <div style="padding:24px 30px;background:#f8fafc;border:1px solid #e2e8f0;">
            <p style="color:#334155;font-size:14px;margin:0 0 16px;">
              A team member is trying to log in from an <strong>unrecognized device</strong>.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;color:#475569;">
              <tr><td style="padding:6px 0;font-weight:600;width:120px;">User</td><td>{user_name} ({user_email})</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Device</td><td>{device_label}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">IP Address</td><td>{ip}</td></tr>
              <tr><td style="padding:6px 0;font-weight:600;">Time</td><td>{datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')}</td></tr>
            </table>
            <div style="margin-top:20px;text-align:center;">
              <a href="{frontend_url}/admin-control"
                 style="display:inline-block;background:#123c69;color:#fff;text-decoration:none;
                        padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;">
                Review & Approve Device
              </a>
            </div>
          </div>
          <p style="font-size:11px;color:#94a3b8;text-align:center;margin:12px 0;">
            SmartShape Pro — Device Management
          </p>
        </div>"""

        msg = MIMEMultipart("alternative")
        msg["From"]    = sender_email
        msg["To"]      = ", ".join(admin_emails)
        msg["Subject"] = subject
        msg.attach(MIMEText(html, "html", "utf-8"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, admin_emails, msg.as_string())
        logging.info(f"Device approval alert sent to {admin_emails}")
    except Exception as e:
        logging.warning(f"Device approval alert failed: {e}")

# ==================== MODELS ====================

class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "sales_person"


class LoginInput(BaseModel):
    email: EmailStr
    password: str
    device_token: Optional[str] = None
    device_info: Optional[dict] = None


# ==================== AUTH ENDPOINTS ====================

@router.post("/auth/register")
async def register(input: RegisterInput, request: Request, response: Response):
    # Self-registration is disabled. Users are created by admin only.
    # This endpoint still works but requires the caller to be an authenticated admin.
    try:
        caller = await get_current_user(request)
        if caller.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only admins can create user accounts. Contact your administrator.")
    except HTTPException as e:
        if e.status_code in (401, 403):
            raise HTTPException(status_code=403, detail="User accounts can only be created by an administrator.")
        raise

    email = input.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    all_mods = [
        "dashboard", "quotations", "inventory", "stock_management", "purchase_alerts",
        "package_master", "physical_count", "analytics", "payroll", "accounts",
        "hr", "store", "field_sales", "leads", "settings", "user_management", "sales_portal",
    ]
    default_modules = all_mods if input.role == "admin" else ["sales_portal"]
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(input.password),
        "name": input.name,
        "role": input.role,
        "assigned_modules": default_modules,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return user


@router.post("/auth/login")
async def login(input: LoginInput, response: Response, request: Request):
    email = input.email.lower()

    # Check brute force
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout_until = attempt.get("lockout_until")
        if lockout_until:
            unlock_dt = datetime.fromisoformat(lockout_until)
            now_utc   = datetime.now(timezone.utc)
            if unlock_dt > now_utc:
                mins_left = max(1, int((unlock_dt - now_utc).total_seconds() / 60) + 1)
                raise HTTPException(
                    status_code=429,
                    detail=f"Account temporarily locked after too many failed attempts. "
                           f"Please wait {mins_left} minute{'s' if mins_left != 1 else ''} and try again, "
                           f"or contact your administrator."
                )
            else:
                # Lockout expired — auto-clear it
                await db.login_attempts.delete_one({"identifier": identifier})
                attempt = None

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(input.password, user["password_hash"]):
        # Increment failed attempts
        if attempt:
            new_count = attempt.get("count", 0) + 1
            update = {"$set": {"count": new_count}}
            if new_count >= 5:
                update["$set"]["lockout_until"] = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
            await db.login_attempts.update_one({"identifier": identifier}, update)
        else:
            await db.login_attempts.insert_one({
                "identifier": identifier,
                "count": 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Deactivated accounts cannot log in (admin set is_active:false in User Management).
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account disabled. Contact your administrator.")

    # Clear failed attempts
    await db.login_attempts.delete_one({"identifier": identifier})

    # ── Device Trust Check ──────────────────────────────────────────────────────
    device_token = input.device_token
    device_info  = input.device_info or {}
    if device_token:
        policy = await db.settings.find_one({"type": "device_policy"}, {"_id": 0}) or {}
        enforcement       = policy.get("enforcement_enabled", False)
        auto_approve_admin = policy.get("auto_approve_admin", True)
        role = user.get("role", "")
        skip_check = (not enforcement) or (role == "admin" and auto_approve_admin)
        if not skip_check:
            existing_dev = await db.trusted_devices.find_one(
                {"user_email": email, "device_token": device_token}, {"_id": 0}
            )
            if existing_dev:
                dev_status = existing_dev.get("status", "pending")
                if dev_status == "approved":
                    await db.trusted_devices.update_one(
                        {"device_id": existing_dev["device_id"]},
                        {"$set": {"last_used": datetime.now(timezone.utc).isoformat(), "last_ip": ip}},
                    )
                elif dev_status == "revoked":
                    raise HTTPException(
                        status_code=403,
                        detail={"code": "DEVICE_REVOKED",
                                "message": "This device has been revoked by your administrator. Contact admin to restore access."},
                    )
                else:
                    raise HTTPException(
                        status_code=403,
                        detail={"code": "DEVICE_PENDING",
                                "message": "This device is awaiting administrator approval. Try again after your admin approves it."},
                    )
            else:
                # New device — check if user is already at device limit
                max_devices = int(policy.get("max_devices_per_user", 3))
                approved_count = await db.trusted_devices.count_documents(
                    {"user_email": email, "status": "approved"}
                )
                if approved_count >= max_devices:
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "code": "DEVICE_LIMIT_REACHED",
                            "message": (
                                f"You have reached the maximum of {max_devices} approved device(s). "
                                "Ask your administrator to revoke an existing device before adding a new one."
                            ),
                        },
                    )
                # Register as pending and block login
                await db.trusted_devices.insert_one({
                    "device_id":    f"dev_{uuid.uuid4().hex[:12]}",
                    "device_token": device_token,
                    "user_email":   email,
                    "user_name":    user.get("name", ""),
                    "role":         user.get("role", ""),
                    "device_label": device_info.get("label", "Unknown Device"),
                    "platform":     device_info.get("platform", "web"),
                    "screen":       device_info.get("screen", ""),
                    "timezone":     device_info.get("timezone", ""),
                    "language":     device_info.get("language", ""),
                    "status":       "pending",
                    "requested_at": datetime.now(timezone.utc).isoformat(),
                    "approved_at":  None,
                    "approved_by":  None,
                    "revoked_at":   None,
                    "revoked_by":   None,
                    "last_used":    None,
                    "last_ip":      ip,
                })
                # Fire-and-forget email alert to admin(s)
                import asyncio as _aio
                _aio.create_task(_notify_admin_new_device(
                    user.get("name", ""), email,
                    device_info.get("label", "Unknown Device"), ip,
                ))
                raise HTTPException(
                    status_code=403,
                    detail={"code": "DEVICE_PENDING",
                            "message": "New device detected. Your administrator has been notified and will approve your access shortly."},
                )
    # ── End Device Trust Check ──────────────────────────────────────────────────

    user_id = user.get("user_id", str(user["_id"]))
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=access_token, max_age=86400, **_COOKIE_KWARGS)
    response.set_cookie(key="refresh_token", value=refresh_token, max_age=2592000, **_COOKIE_KWARGS)

    user_data = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})

    # Log login event
    await db.login_logs.insert_one({
        "log_id":     f"ll_{uuid.uuid4().hex[:12]}",
        "user_email": email,
        "user_name":  user_data.get("name", ""),
        "role":       user_data.get("role", ""),
        "login_time": datetime.now(timezone.utc).isoformat(),
        "logout_time": None,
        "ip_address": ip,
        "lat":        None,
        "lng":        None,
        "address":    None,
        "work_mode":  "unknown",
    })

    return user_data


@router.post("/auth/login-location")
async def update_login_location(request: Request):
    """Called by frontend after login to attach GPS coordinates to the login log."""
    from routes.field_routes import haversine_distance, reverse_geocode
    user = await get_current_user(request)
    body = await request.json()
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return {"message": "No coordinates provided"}

    address = reverse_geocode(float(lat), float(lng))
    office = await db.settings.find_one({"type": "field_settings"}, {"_id": 0})
    work_mode = "unknown"
    if office and office.get("office_lat") and office.get("office_lng"):
        dist_km = haversine_distance(float(lat), float(lng),
                                     float(office["office_lat"]), float(office["office_lng"]))
        radius_m = float(office.get("office_radius_m", 300))
        work_mode = "office" if dist_km * 1000 <= radius_m else "wfh"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.login_logs.update_one(
        {"user_email": user["email"], "login_time": {"$regex": f"^{today}"}, "logout_time": None},
        {"$set": {"lat": lat, "lng": lng, "address": address, "work_mode": work_mode}},
    )
    return {"message": "Location logged", "work_mode": work_mode}


@router.post("/auth/logout")
async def logout(response: Response, request: Request):
    # Mark logout time on latest login log
    try:
        user = await get_current_user(request)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.login_logs.update_one(
            {"user_email": user["email"], "login_time": {"$regex": f"^{today}"}, "logout_time": None},
            {"$set": {"logout_time": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception:
        pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user


@router.post("/auth/refresh")
async def refresh_tokens(request: Request, response: Response):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")

        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Stop a deactivated account from self-renewing its session for 30 days.
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Account disabled")

        access_token = create_access_token(user["user_id"], user["email"])
        new_refresh_token = create_refresh_token(user["user_id"])

        response.set_cookie(key="access_token", value=access_token, max_age=86400, **_COOKIE_KWARGS)
        response.set_cookie(key="refresh_token", value=new_refresh_token, max_age=2592000, **_COOKIE_KWARGS)

        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# Emergent Google Auth
@router.post("/auth/google/session")
async def google_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    auth_response = requests.get(
        "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
        headers={"X-Session-ID": session_id},
        timeout=10,
    )
    if auth_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")

    session_data = auth_response.json()
    email = session_data["email"].lower()
    name = session_data.get("name", email)
    session_token = session_data["session_token"]

    user = await db.users.find_one({"email": email})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "role": "sales_person",
            "assigned_modules": ["sales_portal"],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user_doc)
        user = user_doc
    else:
        user_id = user.get("user_id", str(user["_id"]))

    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, max_age=86400, **_COOKIE_KWARGS)
    response.set_cookie(key="refresh_token", value=refresh_token, max_age=2592000, **_COOKIE_KWARGS)

    user_data = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return user_data


# ==================== SCHOOL AUTH ENDPOINTS ====================

@router.post("/school/auth/login")
async def school_login(request: Request, response: Response):
    body = await request.json()
    email = body.get("email", "").lower().strip()
    password = body.get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    school = await db.schools.find_one({"email": email})
    if not school or not school.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(password, school["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    school_id = school["school_id"]
    token_payload = {
        "sub": school_id,
        "email": email,
        "role": "school",
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        "type": "access",
    }
    access_token = jwt.encode(token_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(key="access_token", value=access_token, max_age=86400, **_COOKIE_KWARGS)
    school_data = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "password_hash": 0})
    school_data["role"] = "school"
    return school_data


def _issue_school_cookie(response: Response, school: dict) -> dict:
    """Set the school access-token cookie on `response` and return a safe school dict."""
    payload = {
        "sub": school["school_id"], "email": school["email"], "role": "school",
        "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access",
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(key="access_token", value=token, max_age=86400, **_COOKIE_KWARGS)
    data = {k: v for k, v in school.items() if k not in ("_id", "password_hash")}
    data["role"] = "school"
    return data


@router.get("/school/auth/methods")
async def school_auth_methods(email: str = ""):
    """Public: which login methods are available for this email's school.
    Unknown emails fall back to the global defaults (no enumeration signal)."""
    email = (email or "").lower().strip()
    g = await school_auth.get_global_settings()
    fallback = {"email_link": g["email_link_enabled"], "magic_link": g["magic_link_enabled"], "google": g["google_enabled"]}
    if not email:
        return fallback
    school = await db.schools.find_one({"email": email})
    if not school:
        return fallback
    return await school_auth.effective_methods(school)


@router.post("/school/auth/activate/verify")
async def school_activate_verify(request: Request):
    body = await request.json()
    raw = (body.get("token") or "").strip()
    school = await school_auth.peek_token(raw, "activation")
    if not school:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    email = school.get("email", "")
    masked = (email[:2] + "***" + email[email.find("@"):]) if "@" in email else "***"
    return {"email_masked": masked}


@router.post("/school/auth/set-password")
async def school_set_password(request: Request, response: Response):
    body = await request.json()
    raw = (body.get("token") or "").strip()
    password = body.get("password") or ""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    school = await school_auth.consume_token(raw, "activation")
    if not school:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    await db.schools.update_one({"school_id": school["school_id"]},
                                {"$set": {"password_hash": hash_password(password)}})
    fresh = await db.schools.find_one({"school_id": school["school_id"]})
    return _issue_school_cookie(response, fresh)


@router.post("/school/auth/magic-link/request")
async def school_magic_request(request: Request):
    body = await request.json()
    email = (body.get("email") or "").lower().strip()
    generic = {"message": "If that email is registered, a login link has been sent."}
    if not email:
        return generic
    school = await db.schools.find_one({"email": email})
    if school:
        methods = await school_auth.effective_methods(school)
        if methods.get("magic_link"):
            raw = await school_auth.issue_token(school["school_id"], email, "magic")
            url = school_auth.magic_url(raw)
            html = f"""<div style="font-family:Arial,sans-serif">
              <p>Click to sign in to your SmartShape School Portal (valid 15 minutes):</p>
              <p><a href="{url}" style="background:#e94560;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p></div>"""
            await school_auth._send_email(email, "Your SmartShape sign-in link", html)
    return generic


@router.get("/school/auth/magic-link/verify")
async def school_magic_verify(token: str = ""):
    school = await school_auth.consume_token(token, "magic")
    if not school:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    redirect = RedirectResponse(url=f"{school_auth._frontend_base()}/school", status_code=303)
    _issue_school_cookie(redirect, school)
    return redirect


@router.post("/school/{school_id}/resend-invite")
async def school_resend_invite(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    school = await db.schools.find_one({"school_id": school_id})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    return await school_auth.send_portal_invite(school)


@router.get("/school/auth/google/start")
async def school_google_start():
    g = await school_auth.get_global_settings()
    if not (g["google_enabled"] and g["google_client_id"]):
        raise HTTPException(status_code=400, detail="Google sign-in is not enabled")
    params = {
        "client_id": g["google_client_id"],
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(url=f"{_GOOGLE_AUTH}?{urllib.parse.urlencode(params)}", status_code=303)


@router.get("/school/auth/google/callback")
async def school_google_callback(code: str = ""):
    g = await school_auth.get_global_settings()
    if not (g["google_enabled"] and g["google_client_id"] and g["google_client_secret"]):
        raise HTTPException(status_code=400, detail="Google sign-in is not enabled")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")
    async with httpx.AsyncClient(timeout=20) as client:
        tok = await client.post(_GOOGLE_TOKEN, data={
            "code": code, "client_id": g["google_client_id"], "client_secret": g["google_client_secret"],
            "redirect_uri": _google_redirect_uri(), "grant_type": "authorization_code",
        })
        if tok.status_code != 200:
            raise HTTPException(status_code=400, detail="Google auth failed")
        access = tok.json().get("access_token")
        ui = await client.get(_GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access}"})
        if ui.status_code != 200:
            raise HTTPException(status_code=400, detail="Could not read Google profile")
        info = ui.json()
    email = (info.get("email") or "").lower().strip()
    if not info.get("email_verified") or not email:
        raise HTTPException(status_code=400, detail="Google email not verified")
    school = await db.schools.find_one({"email": email})
    if not school:
        return RedirectResponse(url=f"{school_auth._frontend_base()}/school/login?err=not_registered", status_code=303)
    methods = await school_auth.effective_methods(school)
    if not methods.get("google"):
        return RedirectResponse(url=f"{school_auth._frontend_base()}/school/login?err=google_disabled", status_code=303)
    redirect = RedirectResponse(url=f"{school_auth._frontend_base()}/school", status_code=303)
    _issue_school_cookie(redirect, school)
    return redirect


def _google_redirect_uri() -> str:
    base = os.environ.get("BACKEND_PUBLIC_URL") or os.environ.get("FRONTEND_URL", "http://localhost:3000")
    return base.rstrip("/") + "/api/school/auth/google/callback"
