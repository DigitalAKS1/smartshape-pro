from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import jwt
import requests
import os

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

router = APIRouter()

# ==================== MODELS ====================

class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "sales_person"


class LoginInput(BaseModel):
    email: EmailStr
    password: str


# ==================== AUTH ENDPOINTS ====================

@router.post("/auth/register")
async def register(input: RegisterInput, response: Response):
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

    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=access_token, max_age=86400, **_COOKIE_KWARGS)
    response.set_cookie(key="refresh_token", value=refresh_token, max_age=2592000, **_COOKIE_KWARGS)

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
        if lockout_until and datetime.fromisoformat(lockout_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")

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

    # Clear failed attempts
    await db.login_attempts.delete_one({"identifier": identifier})

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
