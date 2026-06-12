from fastapi import HTTPException, Request
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import os

from database import db

# ==================== CONSTANTS ====================

JWT_ALGORITHM = "HS256"
# JWT_SECRET signs every login token. A weak/known value lets anyone forge a login for
# any user, so in production we REFUSE to start without a strong, explicitly-set secret
# instead of silently falling back to a guessable default.
JWT_SECRET = os.environ.get("JWT_SECRET")
_IS_PROD = os.environ.get("ENVIRONMENT", "").lower() == "production" or os.environ.get("FRONTEND_URL", "").startswith("https")
if not JWT_SECRET or JWT_SECRET == "default-secret-key":
    if _IS_PROD:
        raise RuntimeError(
            "JWT_SECRET must be set to a strong random value in production. "
            "Set it as an environment variable on the server before starting."
        )
    JWT_SECRET = JWT_SECRET or "dev-only-insecure-secret-change-me"

# ==================== PASSWORD UTILITIES ====================

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


# ==================== TOKEN UTILITIES ====================

def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "type": "refresh",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ==================== AUTH DEPENDENCIES ====================

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        # A school-portal token must never authenticate as a staff user, even though both
        # portals share the 'access_token' cookie name. Without this a school login whose
        # email collides with a staff account would grant staff access.
        if payload.get("role") == "school":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"email": payload["email"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Deactivated accounts (is_active explicitly False) lose access immediately.
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Account disabled")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_school_user(request: Request) -> dict:
    return await get_current_school(request)


async def get_current_school(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "school":
            raise HTTPException(status_code=403, detail="School access required")
        school = await db.schools.find_one({"school_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not school:
            raise HTTPException(status_code=401, detail="School not found")
        return school
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
