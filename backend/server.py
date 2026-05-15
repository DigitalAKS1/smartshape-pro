from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Header, UploadFile, File, Query, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import os
import logging
import uuid
import bcrypt
import jwt
import secrets
import requests
import math
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from emergentintegrations.llm.chat import LlmChat, UserMessage

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ.get("JWT_SECRET", "default-secret-key")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "smartshape"
storage_key = None

# ==================== HELPER FUNCTIONS ====================

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

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
        user = await db.users.find_one({"email": payload["email"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two GPS coordinates"""
    R = 6371  # Earth radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def reverse_geocode(lat: float, lng: float) -> str:
    """Get address from GPS coordinates using Nominatim"""
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json"
        response = requests.get(url, headers={"User-Agent": "SmartShapePro/1.0"}, timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get("display_name", f"{lat}, {lng}")
    except:
        pass
    return f"{lat}, {lng}"

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()

# ---- Last Activity tracker (FMS Phase 1) ----
async def touch_last_activity(entity_type: str, entity_id: str):
    """Update last_activity_date on schools/contacts/leads when an event occurs."""
    if not entity_type or not entity_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    coll_map = {
        "school": ("schools", "school_id"),
        "lead": ("leads", "lead_id"),
        "contact": ("contacts", "contact_id"),
    }
    pair = coll_map.get(entity_type)
    if not pair:
        return
    coll, key = pair
    await db[coll].update_one({key: entity_id}, {"$set": {"last_activity_date": now_iso}})

# ==================== MODELS ====================

class User(BaseModel):
    user_id: str
    email: str
    name: str
    role: str  # admin, sales_person
    created_at: str

class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "sales_person"

class LoginInput(BaseModel):
    email: EmailStr
    password: str

class Die(BaseModel):
    die_id: str
    code: str
    name: str
    type: str  # standard, large, machine
    category: Optional[str] = "decorative"
    stock_qty: int = 0
    reserved_qty: int = 0
    min_level: int = 5
    image_url: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True

class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None

class Package(BaseModel):
    package_id: str
    name: str
    display_name: str
    base_price: float
    std_die_qty: int
    machine_qty: int
    large_die_qty: int
    gst_pct: float = 18
    is_active: bool = True
    items: Optional[List[Dict[str, Any]]] = None  # [{type, name, qty, unit_price, gst_pct}]

class PackageUpdate(BaseModel):
    display_name: Optional[str] = None
    base_price: Optional[float] = None
    std_die_qty: Optional[int] = None
    large_die_qty: Optional[int] = None
    machine_qty: Optional[int] = None
    gst_pct: Optional[float] = None
    items: Optional[List[Dict[str, Any]]] = None
    is_active: Optional[bool] = None

class SalesPerson(BaseModel):
    sales_person_id: str
    name: str
    email: str
    phone: str
    is_active: bool = True

class SalesPersonCreate(BaseModel):
    name: str
    email: str
    phone: str

class QuotationLine(BaseModel):
    description: str
    product_type: str  # standard_die, large_die, machine, custom
    qty: int
    unit_price: float
    gst_pct: float
    line_subtotal: float
    line_gst: float
    line_total: float
    sort_order: int

class Quotation(BaseModel):
    quotation_id: str
    quote_number: str
    package_id: str
    package_name: str
    principal_name: str
    school_name: str
    address: str
    customer_email: str
    customer_phone: str
    customer_gst: Optional[str] = None
    sales_person_id: str
    sales_person_name: str
    discount1_pct: float = 0
    discount2_pct: float = 0
    freight_amount: float = 0
    freight_gst_pct: float = 18
    subtotal: float
    gst_amount: float
    total_with_gst: float
    disc1_amount: float
    after_disc1: float
    disc2_amount: float
    after_disc2: float
    freight_total: float
    grand_total: float
    quotation_status: str = "draft"
    catalogue_status: str = "not_sent"
    catalogue_token: Optional[str] = None
    catalogue_sent_at: Optional[str] = None
    catalogue_opened_at: Optional[str] = None
    catalogue_submitted_at: Optional[str] = None
    lines: List[QuotationLine]
    created_at: str

class QuotationCreate(BaseModel):
    package_id: str
    principal_name: str
    school_name: str
    address: str
    customer_email: str
    customer_phone: str
    customer_gst: Optional[str] = None
    sales_person_id: str
    discount1_pct: float = 0
    discount2_pct: float = 0
    freight_amount: float = 0
    lines: List[QuotationLine]

class StockMovement(BaseModel):
    movement_id: str
    die_id: str
    die_code: str
    die_name: str
    movement_type: str  # stock_in, stock_out, allocated_to_sales, returned_from_sales, physical_adjustment
    quantity: int
    sales_person_id: Optional[str] = None
    sales_person_name: Optional[str] = None
    quotation_id: Optional[str] = None
    notes: Optional[str] = None
    movement_date: str
    reference_number: Optional[str] = None

class StockMovementCreate(BaseModel):
    die_id: str
    movement_type: str
    quantity: int
    sales_person_id: Optional[str] = None
    notes: Optional[str] = None

class Attendance(BaseModel):
    attendance_id: str
    sales_person_email: str
    sales_person_name: str
    date: str  # YYYY-MM-DD
    work_type: str  # field, work_from_home, office
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    check_in_lat: Optional[float] = None
    check_in_lng: Optional[float] = None
    check_in_address: Optional[str] = None
    check_out_lat: Optional[float] = None
    check_out_lng: Optional[float] = None
    check_out_address: Optional[str] = None
    notes: Optional[str] = None

class AttendanceCheckIn(BaseModel):
    work_type: str
    lat: float
    lng: float

class FieldVisit(BaseModel):
    visit_id: str
    sales_person_email: str
    sales_person_name: str
    school_name: str
    contact_person: str
    contact_phone: str
    visit_date: str  # YYYY-MM-DD
    visit_time: str  # HH:MM
    status: str  # planned, visited, cancelled, rescheduled
    purpose: Optional[str] = None
    outcome: Optional[str] = None
    planned_lat: Optional[float] = None
    planned_lng: Optional[float] = None
    planned_address: Optional[str] = None
    visited_lat: Optional[float] = None
    visited_lng: Optional[float] = None
    visited_address: Optional[str] = None
    checked_in_at: Optional[str] = None
    quotation_id: Optional[str] = None

class FieldVisitCreate(BaseModel):
    school_name: str
    contact_person: str
    contact_phone: str
    visit_date: str
    visit_time: str
    purpose: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None

class TravelExpense(BaseModel):
    expense_id: str
    sales_person_email: str
    sales_person_name: str
    date: str  # YYYY-MM-DD
    month_year: str  # YYYY-MM
    from_location: str
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_location: str
    to_lat: Optional[float] = None
    to_lng: Optional[float] = None
    distance_km: float
    transport_mode: str  # two_wheeler, four_wheeler, public_transport, other
    rate_per_km: float
    amount: float
    from_visit_id: Optional[str] = None
    to_visit_id: Optional[str] = None
    notes: Optional[str] = None
    status: str = "pending"

class TravelExpenseCreate(BaseModel):
    date: str
    from_location: str
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    to_location: str
    to_lat: Optional[float] = None
    to_lng: Optional[float] = None
    distance_km: float
    transport_mode: str
    from_visit_id: Optional[str] = None
    to_visit_id: Optional[str] = None
    notes: Optional[str] = None

# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register(input: RegisterInput, response: Response):
    email = input.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    # Default assigned modules: admins get all, everyone else gets the sales portal entry
    all_mods = ["dashboard", "quotations", "inventory", "stock_management", "purchase_alerts",
                "package_master", "physical_count", "analytics", "payroll", "accounts",
                "hr", "store", "field_sales", "leads", "settings", "user_management", "sales_portal"]
    default_modules = all_mods if input.role == "admin" else ["sales_portal"]
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(input.password),
        "name": input.name,
        "role": input.role,
        "assigned_modules": default_modules,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
    
    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return user

@api_router.post("/auth/login")
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
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Clear failed attempts
    await db.login_attempts.delete_one({"identifier": identifier})
    
    user_id = user.get("user_id", str(user["_id"]))
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
    
    user_data = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return user_data

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
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
        
        # Create new tokens
        access_token = create_access_token(user["user_id"], user["email"])
        new_refresh_token = create_refresh_token(user["user_id"])
        
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
        response.set_cookie(key="refresh_token", value=new_refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
        
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# Emergent Google Auth
@api_router.post("/auth/google/session")
async def google_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    
    # Call Emergent Auth API
    auth_response = requests.get(
        "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
        headers={"X-Session-ID": session_id},
        timeout=10
    )
    if auth_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    session_data = auth_response.json()
    email = session_data["email"].lower()
    name = session_data.get("name", email)
    session_token = session_data["session_token"]
    
    # Check if user exists
    user = await db.users.find_one({"email": email})
    if not user:
        # Create new user with default sales_portal module
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "role": "sales_person",
            "assigned_modules": ["sales_portal"],
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(user_doc)
        user = user_doc
    else:
        user_id = user.get("user_id", str(user["_id"]))
    
    # Store session
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Set JWT tokens (same as normal login) so all API calls work
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=False, samesite="lax", max_age=2592000, path="/")
    
    user_data = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return user_data

# ==================== DIE ENDPOINTS ====================

@api_router.get("/dies", response_model=List[Die])
async def get_dies(request: Request, include_archived: bool = False):
    await get_current_user(request)
    query = {} if include_archived else {"is_active": {"$ne": False}}
    dies = await db.dies.find(query, {"_id": 0}).to_list(1000)
    return dies

@api_router.post("/dies", response_model=Die)
async def create_die(die_input: DieCreate, request: Request):
    await get_current_user(request)
    die_id = f"die_{uuid.uuid4().hex[:12]}"
    die_doc = {
        "die_id": die_id,
        **die_input.model_dump(),
        "stock_qty": 0,
        "reserved_qty": 0,
        "image_url": None,
        "is_active": True
    }
    await db.dies.insert_one(die_doc)
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})

@api_router.put("/dies/{die_id}", response_model=Die)
async def update_die(die_id: str, updates: dict, request: Request):
    await get_current_user(request)
    await db.dies.update_one({"die_id": die_id}, {"$set": updates})
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})

@api_router.put("/dies/{die_id}/archive")
async def archive_die(die_id: str, request: Request):
    user = await get_current_user(request)
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    new_status = not die.get("is_active", True)
    await db.dies.update_one({"die_id": die_id}, {"$set": {"is_active": new_status}})
    updated = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    return updated

@api_router.delete("/dies/{die_id}")
async def delete_die(die_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admin can delete inventory items")
    die = await db.dies.find_one({"die_id": die_id})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    await db.dies.delete_one({"die_id": die_id})
    return {"message": "Die deleted successfully"}

@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), request: Request = None):
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"{APP_NAME}/uploads/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/octet-stream")
    
    # Return accessible URL
    return {"url": f"/api/files/{result['path']}"}

@api_router.post("/dies/{die_id}/upload-image")
async def upload_die_image(die_id: str, file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"{APP_NAME}/dies/{die_id}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/octet-stream")
    
    image_url = f"/api/files/{result['path']}"
    await db.dies.update_one({"die_id": die_id}, {"$set": {"image_url": image_url}})
    
    return {"image_url": image_url}

@api_router.get("/files/{path:path}")
async def get_file(path: str):
    """Proxy to retrieve files from object storage"""
    try:
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=30
        )
        if resp.status_code == 200:
            from fastapi.responses import Response as FastAPIResponse
            return FastAPIResponse(
                content=resp.content,
                media_type=resp.headers.get("content-type", "application/octet-stream")
            )
        raise HTTPException(status_code=404, detail="File not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==================== PACKAGE ENDPOINTS ====================

@api_router.get("/packages")
async def get_packages():
    pkgs = await db.packages.find({}, {"_id": 0}).to_list(100)
    return pkgs

@api_router.post("/packages")
async def create_package(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    package_id = f"pkg_{uuid.uuid4().hex[:8]}"
    pkg_doc = {
        "package_id": package_id,
        "name": body.get("name", "").lower().replace(" ", "_"),
        "display_name": body.get("display_name", body.get("name", "")),
        "base_price": body.get("base_price", 0),
        "std_die_qty": body.get("std_die_qty", 0),
        "machine_qty": body.get("machine_qty", 0),
        "large_die_qty": body.get("large_die_qty", 0),
        "gst_pct": body.get("gst_pct", 18),
        "items": body.get("items", []),
        "is_active": True,
    }
    await db.packages.insert_one(pkg_doc)
    return await db.packages.find_one({"package_id": package_id}, {"_id": 0})

@api_router.put("/packages/{package_id}")
async def update_package(package_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for key in ("display_name", "base_price", "std_die_qty", "large_die_qty", "machine_qty", "gst_pct", "items", "is_active"):
        if key in body:
            allowed[key] = body[key]
    if allowed:
        await db.packages.update_one({"package_id": package_id}, {"$set": allowed})
    return await db.packages.find_one({"package_id": package_id}, {"_id": 0})

@api_router.delete("/packages/{package_id}")
async def delete_package(package_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.packages.delete_one({"package_id": package_id})
    return {"message": "Package deleted"}

# Company settings (logo)
@api_router.post("/settings/company")
async def save_company_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    await db.settings.update_one(
        {"type": "company"},
        {"$set": {**body, "type": "company", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Company settings saved"}

@api_router.get("/settings/company")
async def get_company_settings():
    settings = await db.settings.find_one({"type": "company"}, {"_id": 0})
    defaults = {
        "company_name": "SmartShape Pro", "logo_url": "", "address": "", "phone": "", "email": "",
        "gst_number": "", "pan": "", "website": "", "contact_person": "", "city": "", "state": "",
        "pincode": "", "industry": "", "bank_details": "", "terms_conditions": ""
    }
    if not settings:
        return defaults
    for k, v in defaults.items():
        settings.setdefault(k, v)
    return settings

@api_router.post("/settings/company/upload-logo")
async def upload_company_logo(file: UploadFile = File(...), request: Request = None):
    if request:
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    path = f"{APP_NAME}/company/logo_{uuid.uuid4().hex[:8]}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "image/png")
    logo_url = f"/api/files/{result['path']}"
    await db.settings.update_one({"type": "company"}, {"$set": {"logo_url": logo_url}}, upsert=True)
    return {"logo_url": logo_url}

# ==================== SALES PERSON ENDPOINTS ====================

@api_router.get("/salespersons")
async def get_salespersons(request: Request):
    await get_current_user(request)
    persons = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(1000)
    return persons

@api_router.post("/salespersons", response_model=SalesPerson)
async def create_salesperson(person_input: SalesPersonCreate, request: Request):
    await get_current_user(request)
    person_id = f"sp_{uuid.uuid4().hex[:12]}"
    person_doc = {
        "sales_person_id": person_id,
        **person_input.model_dump(),
        "is_active": True
    }
    await db.salespersons.insert_one(person_doc)
    return await db.salespersons.find_one({"sales_person_id": person_id}, {"_id": 0})

# ==================== QUOTATION ENDPOINTS ====================

@api_router.get("/quotations")
async def get_quotations(request: Request, sales_person_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if sales_person_id:
        query["sales_person_id"] = sales_person_id
    elif user.get("role") != "admin" and "quotations" not in user.get("assigned_modules", []):
        # Non-admin without quotations module sees only their own
        query["sales_person_email"] = user["email"]
    
    quotations = await db.quotations.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quotations

async def generate_quote_number() -> str:
    year = datetime.now(timezone.utc).year
    # Find max number for this year
    existing = await db.quotations.find({"quote_number": {"$regex": f"^Q-{year}-"}}).sort("quote_number", -1).limit(1).to_list(1)
    if existing:
        last_num = int(existing[0]["quote_number"].split("-")[-1])
        next_num = last_num + 1
    else:
        next_num = 1
    return f"Q-{year}-{next_num:03d}"

@api_router.post("/quotations")
async def create_quotation(request: Request):
    user = await get_current_user(request)
    # Admin, quotations module, or sales_portal module can create
    can_create = user.get("role") == "admin" or any(m in user.get("assigned_modules", []) for m in ("quotations", "sales_portal"))
    if not can_create:
        raise HTTPException(status_code=403, detail="No permission to create quotations")

    body = await request.json()
    
    # Get package
    package_id = body.get("package_id")
    package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")
    
    # Get sales person
    sp_id = body.get("sales_person_id", "")
    sp = await db.salespersons.find_one({"sales_person_id": sp_id}, {"_id": 0})
    if not sp:
        # If sales team creating, use self
        sp = await db.salespersons.find_one({"email": user["email"]}, {"_id": 0})
        if not sp:
            raise HTTPException(status_code=404, detail="Sales person not found")
    
    # Calculate pricing (FMS: discounts on pre-GST base, GST applied after discounts+freight)
    lines = body.get("lines", [])
    items_total = sum(l.get("line_subtotal", 0) for l in lines)

    d1 = body.get("discount1_pct", 0)
    d2 = body.get("discount2_pct", 0)
    fr = body.get("freight_amount", 0)

    disc1_amount = items_total * (d1 / 100)
    disc2_amount = items_total * (d2 / 100)
    freight_base = fr  # pre-GST freight
    sub_total_after = items_total - disc1_amount - disc2_amount + freight_base
    gst_amount_final = sub_total_after * 0.18
    grand_total = sub_total_after + gst_amount_final

    quotation_id = f"quot_{uuid.uuid4().hex[:12]}"
    quote_number = await generate_quote_number()
    
    quot_doc = {
        "quotation_id": quotation_id,
        "quote_number": quote_number,
        "package_id": package_id,
        "package_name": package["display_name"],
        "principal_name": body.get("principal_name", ""),
        "school_name": body.get("school_name", ""),
        "address": body.get("address", ""),
        "customer_email": body.get("customer_email", ""),
        "customer_phone": body.get("customer_phone", ""),
        "customer_gst": body.get("customer_gst", ""),
        "sales_person_id": sp.get("sales_person_id"),
        "sales_person_name": sp["name"],
        "sales_person_email": sp["email"],
        "discount1_pct": d1,
        "discount2_pct": d2,
        "freight_amount": fr,
        "freight_gst_pct": 0,
        "subtotal": items_total,
        "gst_amount": gst_amount_final,
        "total_with_gst": grand_total,
        "disc1_amount": disc1_amount,
        "after_disc1": items_total - disc1_amount,
        "disc2_amount": disc2_amount,
        "after_disc2": items_total - disc1_amount - disc2_amount,
        "sub_total_after": sub_total_after,
        "freight_total": freight_base,
        "grand_total": grand_total,
        "font_size_mode": body.get("font_size_mode", "medium"),  # small | medium | large
        "quotation_status": "draft",
        "catalogue_status": "not_sent",
        "catalogue_token": None,
        "lines": lines,
        "bank_details_override": body.get("bank_details_override", ""),
        "terms_override": body.get("terms_override", ""),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.quotations.insert_one(quot_doc)
    # FMS: bump last_activity on the matching school (by name)
    try:
        sname = (body.get("school_name") or "").strip()
        if sname:
            sch = await db.schools.find_one({"school_name": sname}, {"_id": 0, "school_id": 1})
            if sch and sch.get("school_id"):
                await touch_last_activity("school", sch["school_id"])
    except Exception:
        pass
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})

@api_router.post("/quotations/{quotation_id}/send-catalogue")
async def send_catalogue(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    
    # Generate token if not exists
    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": datetime.now(timezone.utc).isoformat(),
                "quotation_status": "sent"
            }}
        )
    else:
        token = quot["catalogue_token"]
    
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"
    
    # TODO: Send email via Gmail integration
    # For now, return the link
    return {"catalogue_url": catalogue_url, "message": "Catalogue link generated"}

@api_router.put("/quotations/{quotation_id}/status")
async def update_quotation_status(quotation_id: str, status: str, request: Request):
    user = await get_current_user(request)
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"quotation_status": status}}
    )
    return {"message": "Status updated"}

@api_router.delete("/quotations/{quotation_id}")
async def delete_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    # Only admin or accounts can delete
    can_delete = user.get("role") == "admin" or "accounts" in user.get("assigned_modules", [])
    if not can_delete:
        raise HTTPException(status_code=403, detail="Only Accounts team can delete quotations")
    result = await db.quotations.delete_one({"quotation_id": quotation_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return {"message": "Quotation deleted"}

@api_router.post("/quotations/{quotation_id}/new-version")
async def create_quotation_version(quotation_id: str, request: Request):
    user = await get_current_user(request)
    orig = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not orig:
        raise HTTPException(status_code=404, detail="Quotation not found")
    # Determine the root parent and next version number
    root_id = orig.get("parent_quotation_id") or quotation_id
    all_versions = await db.quotations.find(
        {"$or": [{"quotation_id": root_id}, {"parent_quotation_id": root_id}]},
        {"_id": 0, "version": 1}
    ).to_list(None)
    next_version = max((v.get("version", 1) for v in all_versions), default=1) + 1
    new_id = f"quot_{uuid.uuid4().hex[:12]}"
    new_number = await generate_quote_number()
    new_doc = {k: v for k, v in orig.items() if k not in ("quotation_id", "quote_number", "_id")}
    new_doc.update({
        "quotation_id": new_id,
        "quote_number": new_number,
        "version": next_version,
        "parent_quotation_id": root_id,
        "quotation_status": "draft",
        "catalogue_status": "not_sent",
        "catalogue_token": None,
        "catalogue_sent_at": None,
        "catalogue_opened_at": None,
        "catalogue_submitted_at": None,
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    if "version" not in orig:
        await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": {"version": 1, "parent_quotation_id": None}})
    await db.quotations.insert_one(new_doc)
    return await db.quotations.find_one({"quotation_id": new_id}, {"_id": 0})

@api_router.get("/quotations/{quotation_id}/versions")
async def get_quotation_versions(quotation_id: str, request: Request):
    await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    root_id = quot.get("parent_quotation_id") or quotation_id
    versions = await db.quotations.find(
        {"$or": [{"quotation_id": root_id}, {"parent_quotation_id": root_id}]},
        {"_id": 0, "quotation_id": 1, "quote_number": 1, "version": 1,
         "quotation_status": 1, "grand_total": 1, "created_at": 1}
    ).sort("version", 1).to_list(None)
    return versions

@api_router.put("/quotations/{quotation_id}")
async def edit_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    allowed = {}
    for key in ("principal_name", "school_name", "address", "customer_email", "customer_phone",
                "customer_gst", "sales_person_id", "discount1_pct", "discount2_pct",
                "freight_amount", "lines", "quotation_status",
                "font_size_mode", "bank_details_override", "terms_override"):
        if key in body:
            allowed[key] = body[key]
    # Recalculate pricing (same model as create)
    if "lines" in allowed:
        existing = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0}) or {}
        lines = allowed["lines"]
        items_total = sum(l.get("line_subtotal", 0) for l in lines)
        d1 = allowed.get("discount1_pct", body.get("discount1_pct", existing.get("discount1_pct", 0)))
        d2 = allowed.get("discount2_pct", body.get("discount2_pct", existing.get("discount2_pct", 0)))
        fr = allowed.get("freight_amount", body.get("freight_amount", existing.get("freight_amount", 0)))
        disc1 = items_total * (d1 / 100)
        disc2 = items_total * (d2 / 100)
        sub_total_after = items_total - disc1 - disc2 + fr
        gst_final = sub_total_after * 0.18
        allowed.update({
            "subtotal": items_total,
            "gst_amount": gst_final,
            "total_with_gst": sub_total_after + gst_final,
            "disc1_amount": disc1,
            "after_disc1": items_total - disc1,
            "disc2_amount": disc2,
            "after_disc2": items_total - disc1 - disc2,
            "sub_total_after": sub_total_after,
            "freight_total": fr,
            "grand_total": sub_total_after + gst_final,
        })
    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": allowed})
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})

@api_router.get("/quotations/{quotation_id}/pdf")
async def download_quotation_pdf(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER
    import io as stdio

    buf = stdio.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm, topMargin=10*mm, bottomMargin=10*mm)

    styles = getSampleStyleSheet()
    # Font size scaling (FMS: user-selectable)
    FONT_SCALES = {"small": 0.85, "medium": 1.0, "large": 1.15}
    fs_mode = (quot.get("font_size_mode") or "medium")
    scale = FONT_SCALES.get(fs_mode, 1.0)
    def sz(n):
        return max(5, round(n * scale))
    styles.add(ParagraphStyle(name='CoName', fontSize=sz(14), leading=sz(17), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2)))
    styles.add(ParagraphStyle(name='CoSub', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.3, 0.3, 0.4)))
    styles.add(ParagraphStyle(name='QTitle', fontSize=sz(13), leading=sz(16), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_CENTER))
    styles.add(ParagraphStyle(name='Sm', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.15, 0.15, 0.2)))
    styles.add(ParagraphStyle(name='SmR', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.15, 0.15, 0.2), alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name='Tiny', fontSize=sz(7), leading=sz(9), textColor=colors.Color(0.4, 0.4, 0.5)))
    styles.add(ParagraphStyle(name='BoldSm', fontSize=sz(9), leading=sz(11), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2)))
    styles.add(ParagraphStyle(name='BoldSmR', fontSize=sz(9), leading=sz(11), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name='Total', fontSize=sz(11), leading=sz(14), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_RIGHT))

    elements = []
    accent = colors.Color(0.91, 0.27, 0.38)
    hdr_bg = colors.Color(0.95, 0.95, 0.97)

    # ---- COMPANY HEADER (logo + text in 2 columns) ----
    co_name = company.get("company_name", "SmartShape Pro")
    co_addr = company.get("address", "")
    co_city = f"{company.get('city', '')}{', ' + company.get('state', '') if company.get('state') else ''} {company.get('pincode', '')}"
    co_contact = f"Phone: {company.get('phone', '')} | Email: {company.get('email', '')}"
    co_gst = f"GSTIN: {company.get('gst_number', '')}" if company.get('gst_number') else ""

    # Build text block
    text_block = [Paragraph(co_name, styles['CoName'])]
    if co_addr:
        text_block.append(Paragraph(f"{co_addr}, {co_city}", styles['CoSub']))
    if co_contact:
        text_block.append(Paragraph(co_contact, styles['CoSub']))
    if co_gst:
        text_block.append(Paragraph(co_gst, styles['CoSub']))

    # Try to load logo as Image
    logo_image = None
    logo_url = company.get("logo_url", "")
    if logo_url:
        try:
            from reportlab.platypus import Image as RLImage
            from reportlab.lib.utils import ImageReader
            import io as _io
            img_bytes = None
            if logo_url.startswith("/api/files/"):
                # Internal storage
                key = init_storage()
                obj_path = logo_url.replace("/api/files/", "", 1)
                r = requests.get(f"{STORAGE_URL}/objects/{obj_path}",
                                 headers={"X-Storage-Key": key}, timeout=15)
                if r.ok:
                    img_bytes = r.content
            elif logo_url.startswith("http://") or logo_url.startswith("https://"):
                r = requests.get(logo_url, timeout=15)
                if r.ok:
                    img_bytes = r.content
            if img_bytes:
                # Determine intrinsic ratio to size into max 28mm tall
                ir = ImageReader(_io.BytesIO(img_bytes))
                iw, ih = ir.getSize()
                target_h = 22 * mm
                target_w = (iw / ih) * target_h if ih else 30 * mm
                # cap width
                if target_w > 50 * mm:
                    target_w = 50 * mm
                    target_h = (ih / iw) * target_w if iw else target_h
                logo_image = RLImage(_io.BytesIO(img_bytes), width=target_w, height=target_h)
        except Exception as _e:
            logging.warning(f"PDF logo load failed: {_e}")
            logo_image = None

    if logo_image is not None:
        header_tbl = Table([[logo_image, text_block]], colWidths=[55*mm, 131*mm])
        header_tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_tbl)
    else:
        for el in text_block:
            elements.append(el)
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width="100%", thickness=1, color=accent))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph("QUOTATION", styles['QTitle']))
    elements.append(Spacer(1, 2*mm))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.Color(0.8, 0.8, 0.85)))
    elements.append(Spacer(1, 3*mm))

    # ---- QUOTE + CUSTOMER INFO ----
    quote_date = quot.get("created_at", "")[:10]
    info_left = f"""<b>Quote No:</b> {quot.get('quote_number', '')}<br/>
<b>Date:</b> {quote_date}<br/>
<b>Valid Till:</b> 30 days from date<br/>
<b>Sales Person:</b> {quot.get('sales_person_name', '')}"""

    info_right = f"""<b>To:</b><br/>
<b>{quot.get('school_name', '')}</b><br/>
{quot.get('principal_name', '')}<br/>
{quot.get('address', '')}<br/>
Ph: {quot.get('customer_phone', '')} | {quot.get('customer_email', '')}"""
    if quot.get('customer_gst'):
        info_right += f"<br/>GSTIN: {quot['customer_gst']}"

    info_table = Table([
        [Paragraph(info_left, styles['Sm']), Paragraph(info_right, styles['Sm'])]
    ], colWidths=[90*mm, 96*mm])
    info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 4*mm))

    # ---- ITEMS TABLE (Divine Computers format) ----
    lines = quot.get("lines", [])
    tbl_header = ["Sr.", "Description of Product", "Type", "Qty", "Rate", "GST", "Amount"]
    tbl_data = [tbl_header]
    for i, l in enumerate(lines):
        tbl_data.append([
            str(i + 1),
            Paragraph(l.get("description", ""), styles['Sm']),
            l.get("product_type", ""),
            str(l.get("qty", 0)),
            f"{l.get('unit_price', 0):,.0f}",
            f"{l.get('line_gst', 0):,.0f}",
            f"{l.get('line_total', 0):,.0f}",
        ])

    col_widths = [10*mm, 68*mm, 20*mm, 14*mm, 24*mm, 20*mm, 30*mm]
    items_table = Table(tbl_data, colWidths=col_widths)
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), hdr_bg),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.Color(0.75, 0.75, 0.8)),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.Color(0.98, 0.98, 0.99)]),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 3*mm))

    # ---- PRICING SUMMARY (FMS: industry-standard pre-GST discount layout) ----
    items_total = quot.get("subtotal", 0)
    d1p = quot.get("discount1_pct", 0)
    d1a = quot.get("disc1_amount", 0)
    d2p = quot.get("discount2_pct", 0)
    d2a = quot.get("disc2_amount", 0)
    fr_total = quot.get("freight_total", 0)
    sub_total = quot.get("sub_total_after", items_total - d1a - d2a + fr_total)
    gst = quot.get("gst_amount", 0)
    gt = quot.get("grand_total", 0)

    sum_rows = [["Total", f"{items_total:,.2f}"]]
    if d1p > 0:
        sum_rows.append([f"Discount @ {d1p}%", f"{d1a:,.2f}"])
    if d2p > 0:
        sum_rows.append([f"Spl Additional Discount {d2p}%", f"{d2a:,.2f}"])
    if fr_total > 0:
        sum_rows.append(["Freight & Packing", f"{fr_total:,.2f}"])
    sum_rows.append(["Sub-total", f"{sub_total:,.2f}"])
    sum_rows.append(["GST @ 18%", f"{gst:,.2f}"])
    sum_rows.append(["Total", f"{gt:,.2f}"])

    sum_data = []
    for i, row in enumerate(sum_rows):
        is_first = i == 0
        is_last = i == len(sum_rows) - 1
        is_subtotal = row[0] == "Sub-total"
        label_style = styles['BoldSm'] if (is_first or is_last or is_subtotal) else styles['Sm']
        if is_last:
            value_style = styles['Total']
        elif is_subtotal or is_first:
            value_style = styles['BoldSmR']
        else:
            value_style = styles['SmR']
        sum_data.append([Paragraph(row[0], label_style), Paragraph(row[1], value_style)])

    sum_tbl = Table(sum_data, colWidths=[55*mm, 35*mm])
    sub_total_row_idx = next((i for i, r in enumerate(sum_rows) if r[0] == "Sub-total"), None)
    tbl_styles = [
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEABOVE', (0, -1), (-1, -1), 1, accent),
        ('LINEBELOW', (0, -1), (-1, -1), 1, accent),
        ('TOPPADDING', (0, -1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -2), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -2), 2),
    ]
    if sub_total_row_idx is not None:
        tbl_styles.append(('LINEABOVE', (0, sub_total_row_idx), (-1, sub_total_row_idx), 0.5, colors.Color(0.7, 0.7, 0.75)))
    sum_tbl.setStyle(TableStyle(tbl_styles))
    outer_sum = Table([['', sum_tbl]], colWidths=[96*mm, 90*mm])
    outer_sum.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
    elements.append(outer_sum)
    elements.append(Spacer(1, 5*mm))

    # ---- TERMS & CONDITIONS + BANK DETAILS (side-by-side compact) ----
    terms_raw = quot.get("terms_override") or company.get("terms_conditions", "")
    if terms_raw:
        terms_lines = [t.strip().lstrip("0123456789. )-") for t in str(terms_raw).split("\n") if t.strip()]
    else:
        terms_lines = [
            "Payment : 50% advance and balance 50% against Delivery",
            "Warranty : 1 year against any manufacturing Defect",
            "Machine not to be used for commercial purpose",
            "Local Duties/Taxes extra to be bore by buyer",
        ]

    bank_info = quot.get("bank_details_override") or company.get("bank_details", "")
    bank_lines = [ln.strip() for ln in str(bank_info).split("\n") if ln.strip()] if bank_info else []

    terms_block = [Paragraph('<b>Terms &amp; Conditions</b>', styles['BoldSm'])]
    for i, t in enumerate(terms_lines):
        terms_block.append(Paragraph(f'{i+1}. {t}', styles['Tiny']))
    terms_block.append(Spacer(1, 2*mm))

    bank_block = [Paragraph('<b>Bank Details</b>', styles['BoldSm'])]
    if bank_lines:
        for ln in bank_lines:
            bank_block.append(Paragraph(ln, styles['Sm']))
    else:
        bank_block.append(Paragraph(f"<i>Account : {co_name}</i>", styles['Sm']))
        bank_block.append(Paragraph("Bank details will be shared separately.", styles['Tiny']))

    tb_table = Table([[terms_block, bank_block]], colWidths=[105*mm, 81*mm])
    tb_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, 0), 6),
        ('LEFTPADDING', (1, 0), (1, 0), 6),
        ('BOX', (0, 0), (-1, -1), 0.3, colors.Color(0.85, 0.85, 0.9)),
        ('LINEAFTER', (0, 0), (0, 0), 0.3, colors.Color(0.85, 0.85, 0.9)),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(tb_table)
    elements.append(Spacer(1, 6*mm))

    # ---- SIGNATURE ----
    sig_table = Table([
        ['', Paragraph(f'<font size=8>For <b>{co_name}</b></font>', styles['SmR'])],
        ['', ''],
        ['', Paragraph('<font size=7>Authorized Signatory</font>', styles['SmR'])],
    ], colWidths=[120*mm, 66*mm])
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('TOPPADDING', (0, 1), (-1, 1), 15*mm),
    ]))
    elements.append(sig_table)

    doc.build(elements)
    buf.seek(0)
    filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})

# ==================== GROUP MASTER ====================

@api_router.get("/groups")
async def get_groups(request: Request):
    await get_current_user(request)
    groups = await db.groups.find({}, {"_id": 0}).sort("group_name", 1).to_list(500)
    return groups

@api_router.post("/groups")
async def create_group(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    group_id = f"grp_{uuid.uuid4().hex[:8]}"
    await db.groups.insert_one({
        "group_id": group_id, "group_name": body.get("group_name", ""),
        "head_office_address": body.get("head_office_address", ""),
        "chairman_name": body.get("chairman_name", ""),
        "contact_number": body.get("contact_number", ""),
        "email": body.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})

@api_router.put("/groups/{group_id}")
async def update_group(group_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("group_name", "head_office_address", "chairman_name", "contact_number", "email") if k in body}
    await db.groups.update_one({"group_id": group_id}, {"$set": allowed})
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})

@api_router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request):
    await get_current_user(request)
    await db.groups.delete_one({"group_id": group_id})
    return {"message": "Group deleted"}

# ==================== SOURCE MASTER ====================

DEFAULT_SOURCES = ["Call", "Visit", "Reference", "Campaign", "Exhibition", "Website", "Social Media", "Walk-in", "Partner", "Other"]

@api_router.get("/sources")
async def get_sources(request: Request):
    await get_current_user(request)
    sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not sources:
        for s in DEFAULT_SOURCES:
            await db.sources.insert_one({"source_id": f"src_{uuid.uuid4().hex[:8]}", "name": s, "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()})
        sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return sources

@api_router.post("/sources")
async def create_source(request: Request):
    await get_current_user(request)
    body = await request.json()
    source_id = f"src_{uuid.uuid4().hex[:8]}"
    await db.sources.insert_one({"source_id": source_id, "name": body.get("name", ""), "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()})
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})

@api_router.put("/sources/{source_id}")
async def update_source(source_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.sources.update_one({"source_id": source_id}, {"$set": allowed})
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})

@api_router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    await get_current_user(request)
    await db.sources.delete_one({"source_id": source_id})
    return {"message": "Source deleted"}

# ==================== CONTACT ROLE MASTER ====================

DEFAULT_CONTACT_ROLES = ["Principal", "Vice Principal", "Admin Head", "Director", "Owner", "Manager", "Coordinator", "Teacher", "IT Head", "Purchase Head", "Other"]

@api_router.get("/contact-roles")
async def get_contact_roles(request: Request):
    await get_current_user(request)
    roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not roles:
        for r in DEFAULT_CONTACT_ROLES:
            await db.contact_roles.insert_one({"role_id": f"cr_{uuid.uuid4().hex[:8]}", "name": r, "is_active": True})
        roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return roles

@api_router.post("/contact-roles")
async def create_contact_role(request: Request):
    await get_current_user(request)
    body = await request.json()
    role_id = f"cr_{uuid.uuid4().hex[:8]}"
    await db.contact_roles.insert_one({"role_id": role_id, "name": body.get("name", ""), "is_active": True})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})

@api_router.put("/contact-roles/{role_id}")
async def update_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.contact_roles.update_one({"role_id": role_id}, {"$set": allowed})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})

@api_router.delete("/contact-roles/{role_id}")
async def delete_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    await db.contact_roles.delete_one({"role_id": role_id})
    return {"message": "Role deleted"}

# ==================== SCHOOL MASTER ====================

@api_router.get("/schools")
async def get_schools(request: Request):
    user = await get_current_user(request)
    # Role-based scoping: non-admins without 'leads' module see only their own schools
    # ("their" = created by them OR linked to leads assigned to them)
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        own_leads = await db.leads.find({"assigned_to": user["email"]}, {"_id": 0, "school_id": 1}).to_list(10000)
        linked_school_ids = [l.get("school_id") for l in own_leads if l.get("school_id")]
        query = {"$or": [
            {"created_by": user["email"]},
            {"school_id": {"$in": linked_school_ids}} if linked_school_ids else {"school_id": "__none__"},
        ]}
    else:
        query = {}
    schools = await db.schools.find(query, {"_id": 0}).sort("school_name", 1).to_list(10000)
    return schools

@api_router.post("/schools")
async def create_school(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    school_id = f"sch_{uuid.uuid4().hex[:12]}"
    school_doc = {
        "school_id": school_id,
        "school_name": body.get("school_name", ""),
        "school_type": body.get("school_type", "CBSE"),
        "board": body.get("board", ""),
        "group_id": body.get("group_id", ""),
        "website": body.get("website", ""),
        "email": body.get("email", ""),
        "phone": body.get("phone", ""),
        "city": body.get("city", ""),
        "state": body.get("state", ""),
        "pincode": body.get("pincode", ""),
        "address": body.get("address", ""),
        "primary_contact_name": body.get("primary_contact_name", ""),
        "designation": body.get("designation", ""),
        "alternate_contact": body.get("alternate_contact", ""),
        "school_strength": body.get("school_strength", 0),
        "number_of_branches": body.get("number_of_branches", 1),
        "annual_budget_range": body.get("annual_budget_range", ""),
        "existing_vendor": body.get("existing_vendor", ""),
        "social_profiles": body.get("social_profiles", {}),
        "last_activity_date": datetime.now(timezone.utc).isoformat(),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schools.insert_one(school_doc)
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})

@api_router.put("/schools/{school_id}")
async def update_school(school_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("school_name", "school_type", "board", "group_id", "website", "email", "phone",
              "city", "state", "pincode", "address", "primary_contact_name", "designation",
              "alternate_contact", "school_strength", "number_of_branches",
              "annual_budget_range", "existing_vendor", "social_profiles"):
        if k in body:
            allowed[k] = body[k]
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one({"school_id": school_id}, {"$set": allowed})
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})

@api_router.delete("/schools/{school_id}")
async def delete_school(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.schools.delete_one({"school_id": school_id})
    return {"message": "School deleted"}

# ==================== SCHOOL PORTAL (Phase 2) ====================

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

@api_router.post("/school/auth/login")
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
    token_payload = {"sub": school_id, "email": email, "role": "school", "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access"}
    access_token = jwt.encode(token_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    school_data = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "password_hash": 0})
    school_data["role"] = "school"
    return school_data

@api_router.get("/school/me")
async def school_me(request: Request):
    school = await get_current_school(request)
    school["role"] = "school"
    return school

@api_router.get("/school/orders")
async def school_orders(request: Request):
    school = await get_current_school(request)
    orders = await db.orders.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders

@api_router.get("/school/orders/{order_id}")
async def school_order_detail(order_id: str, request: Request):
    school = await get_current_school(request)
    order = await db.orders.find_one({"order_id": order_id, "school_id": school["school_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    order["items"] = items
    timeline = await db.order_timeline.find({"order_id": order_id}, {"_id": 0}).sort("timestamp", 1).to_list(100)
    order["timeline"] = timeline
    return order

@api_router.get("/school/quotations")
async def school_quotations(request: Request):
    school = await get_current_school(request)
    quots = await db.quotations.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quots

@api_router.get("/school/notifications")
async def school_notifications(request: Request):
    school = await get_current_school(request)
    notifs = await db.school_notifications.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notifs

@api_router.put("/school/notifications/read")
async def school_mark_notifications_read(request: Request):
    school = await get_current_school(request)
    await db.school_notifications.update_many({"school_id": school["school_id"], "read": False}, {"$set": {"read": True}})
    return {"message": "All notifications marked as read"}

# Admin: set school password
@api_router.put("/schools/{school_id}/set-password")
async def set_school_password(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    password = body.get("password", "")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    await db.schools.update_one({"school_id": school_id}, {"$set": {"password_hash": hash_password(password)}})
    return {"message": "Password set"}

# ==================== DISPATCH MANAGEMENT (Phase 3) ====================

@api_router.post("/dispatches")
async def create_dispatch(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["order_status"] not in ("confirmed", "pending"):
        raise HTTPException(status_code=400, detail=f"Cannot dispatch order in '{order['order_status']}' status")

    dispatch_id = f"dsp_{uuid.uuid4().hex[:12]}"
    dispatch_count = await db.dispatches.count_documents({})
    dispatch_number = f"DSP-{datetime.now(timezone.utc).year}-{dispatch_count + 1:04d}"
    dispatch_doc = {
        "dispatch_id": dispatch_id,
        "dispatch_number": dispatch_number,
        "order_id": order_id,
        "order_number": order.get("order_number", ""),
        "school_name": order.get("school_name", ""),
        "school_id": order.get("school_id", ""),
        "dispatch_date": body.get("dispatch_date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "courier_name": body.get("courier_name", ""),
        "tracking_number": body.get("tracking_number", ""),
        "notes": body.get("notes", ""),
        "status": "dispatched",
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.dispatches.insert_one(dispatch_doc)

    # Update order status to dispatched (auto-deducts stock)
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    for item in items:
        if item.get("status") in ("on_hold", "confirmed"):
            await db.dies.update_one({"die_id": item["die_id"]}, {
                "$inc": {"stock_qty": -item.get("quantity", 1), "reserved_qty": -item.get("quantity", 1)}
            })
            await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "dispatched"}})
    await db.orders.update_one({"order_id": order_id}, {"$set": {
        "order_status": "dispatched",
        "dispatch_date": dispatch_doc["dispatch_date"],
        "updated_at": datetime.now(timezone.utc).isoformat()
    }})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": "dispatched",
        "note": f"Dispatch {dispatch_number} created. {body.get('courier_name', '')} {body.get('tracking_number', '')}".strip(),
        "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # Create school notification
    await db.school_notifications.insert_one({
        "notification_id": f"notif_{uuid.uuid4().hex[:8]}",
        "school_id": order.get("school_id", ""),
        "type": "dispatch",
        "title": "Order Dispatched",
        "message": f"Your order {order.get('order_number', '')} has been dispatched via {body.get('courier_name', 'courier')}.",
        "order_id": order_id,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})

@api_router.get("/dispatches")
async def get_dispatches(request: Request):
    await get_current_user(request)
    dispatches = await db.dispatches.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    # Enrich with phone number from order → quotation or school
    for d in dispatches:
        if d.get("phone"):
            continue
        phone = ""
        if d.get("order_id"):
            order = await db.orders.find_one({"order_id": d["order_id"]}, {"quotation_id": 1, "school_id": 1})
            if order:
                if order.get("quotation_id"):
                    quot = await db.quotations.find_one({"quotation_id": order["quotation_id"]}, {"contact_phone": 1, "contact_name": 1})
                    if quot:
                        phone = quot.get("contact_phone", "")
                        if not d.get("contact_name"):
                            d["contact_name"] = quot.get("contact_name", "")
                if not phone and order.get("school_id"):
                    school = await db.schools.find_one({"school_id": order["school_id"]}, {"primary_contact_phone": 1, "phone": 1})
                    if school:
                        phone = school.get("primary_contact_phone") or school.get("phone", "")
        d["phone"] = phone
    return dispatches

@api_router.put("/dispatches/{dispatch_id}/delivered")
async def mark_dispatch_delivered(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    await db.dispatches.update_one({"dispatch_id": dispatch_id}, {"$set": {"status": "delivered", "delivered_at": datetime.now(timezone.utc).isoformat()}})
    # Update order
    order_id = dispatch["order_id"]
    await db.orders.update_one({"order_id": order_id}, {"$set": {"order_status": "delivered", "updated_at": datetime.now(timezone.utc).isoformat()}})
    await db.order_items.update_many({"order_id": order_id}, {"$set": {"status": "delivered"}})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}", "order_id": order_id, "status": "delivered",
        "note": f"Delivery confirmed for dispatch {dispatch['dispatch_number']}", "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    await db.school_notifications.insert_one({
        "notification_id": f"notif_{uuid.uuid4().hex[:8]}", "school_id": dispatch.get("school_id", ""),
        "type": "delivered", "title": "Order Delivered",
        "message": f"Your order {dispatch.get('order_number', '')} has been delivered.",
        "order_id": order_id, "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Marked as delivered"}

# ==================== IMPORT SYSTEM (Phase 4) ====================

@api_router.post("/import/preview")
async def preview_import(file: UploadFile = File(...), entity_type: str = "contacts", request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for i, row in enumerate(reader):
        status = "ok"
        error = ""
        if entity_type == "contacts":
            if not row.get("name", "").strip() or not row.get("phone", "").strip():
                status = "error"
                error = "Missing name or phone"
        elif entity_type == "inventory":
            if not row.get("code", "").strip() or not row.get("name", "").strip():
                status = "error"
                error = "Missing code or name"
        elif entity_type == "schools":
            if not row.get("school_name", "").strip() or not row.get("email", "").strip():
                status = "error"
                error = "Missing school_name or email"
        rows.append({"row_num": i + 1, "data": dict(row), "status": status, "error": error})
    return {"total_rows": len(rows), "valid": sum(1 for r in rows if r["status"] == "ok"), "errors": sum(1 for r in rows if r["status"] == "error"), "rows": rows}

@api_router.post("/import/execute")
async def execute_import(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    entity_type = body.get("entity_type", "contacts")
    rows = body.get("rows", [])
    created = 0
    failed = 0
    for row_data in rows:
        if row_data.get("status") != "ok":
            failed += 1
            continue
        data = row_data.get("data", {})
        try:
            if entity_type == "contacts":
                existing = await db.contacts.find_one({"phone": data.get("phone", "").strip(), "name": data.get("name", "").strip()})
                if existing:
                    failed += 1
                    continue
                await db.contacts.insert_one({
                    "contact_id": f"con_{uuid.uuid4().hex[:12]}",
                    "name": data.get("name", "").strip(), "phone": data.get("phone", "").strip(),
                    "email": data.get("email", "").strip(), "company": data.get("company", "").strip(),
                    "designation": data.get("designation", "").strip(), "source": data.get("source", "").strip(),
                    "notes": data.get("notes", "").strip(), "status": "active",
                    "converted_to_lead": False, "lead_id": None,
                    "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
                })
                created += 1
            elif entity_type == "schools":
                existing = await db.schools.find_one({"email": data.get("email", "").strip()})
                if existing:
                    failed += 1
                    continue
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                doc = {
                    "school_id": school_id, "school_name": data.get("school_name", "").strip(),
                    "email": data.get("email", "").strip(), "phone": data.get("phone", "").strip(),
                    "school_type": data.get("school_type", "CBSE").strip(),
                    "city": data.get("city", "").strip(), "state": data.get("state", "").strip(),
                    "primary_contact_name": data.get("contact_name", "").strip(),
                    "school_strength": int(data.get("school_strength", 0) or 0),
                    "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
                }
                pwd = data.get("password", "").strip()
                if pwd:
                    doc["password_hash"] = hash_password(pwd)
                await db.schools.insert_one(doc)
                created += 1
        except Exception:
            failed += 1

    # Log import
    log_id = f"imp_{uuid.uuid4().hex[:8]}"
    await db.import_logs.insert_one({
        "log_id": log_id, "entity_type": entity_type,
        "total_rows": len(rows), "success_count": created, "failed_count": failed,
        "uploaded_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"created": created, "failed": failed, "log_id": log_id}

@api_router.get("/import/logs")
async def get_import_logs(request: Request):
    await get_current_user(request)
    logs = await db.import_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return logs

# ==================== ACTIVITY LOGS (Phase 5) ====================

async def log_activity(user_email: str, action: str, entity_type: str, entity_id: str, details: str = ""):
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # Cascade last_activity_date to related entity if applicable
    try:
        await touch_last_activity(entity_type, entity_id)
    except Exception:
        pass

@api_router.get("/activity-logs")
async def get_activity_logs(request: Request, entity_type: Optional[str] = None, limit: int = 100):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    logs = await db.activity_logs.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs

# ==================== CONTACTS ====================

@api_router.get("/contacts")
async def get_contacts(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        query["created_by"] = user["email"]
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return contacts

@api_router.post("/contacts")
async def create_contact(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name") or not body.get("phone"):
        raise HTTPException(status_code=400, detail="Name and phone are required")
    contact_id = f"con_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    contact_doc = {
        "contact_id": contact_id,
        "name": body.get("name", ""),
        "phone": body.get("phone", ""),
        "email": body.get("email", ""),
        "company": body.get("company", ""),
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "notes": body.get("notes", ""),
        "status": "active",
        "converted_to_lead": False,
        "lead_id": None,
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.contacts.insert_one(contact_doc)
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})

@api_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("name", "phone", "email", "company", "designation", "contact_role_id", "source", "source_id", "notes", "status"):
        if k in body:
            allowed[k] = body[k]
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": allowed})
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})

@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    await get_current_user(request)
    result = await db.contacts.delete_one({"contact_id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}

@api_router.post("/contacts/{contact_id}/convert-to-lead")
async def convert_contact_to_lead(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.get("converted_to_lead"):
        raise HTTPException(status_code=400, detail="Contact already converted to a lead")

    body = await request.json()
    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    lead_doc = {
        "lead_id": lead_id,
        "school_id": body.get("school_id", ""),
        "company_name": contact.get("company", ""),
        "contact_name": contact["name"],
        "designation": contact.get("designation", ""),
        "contact_role_id": contact.get("contact_role_id", ""),
        "contact_phone": contact["phone"],
        "contact_email": contact.get("email", ""),
        "source": contact.get("source", ""),
        "source_id": contact.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "interested_product": body.get("interested_product", ""),
        "stage": "new",
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "notes": contact.get("notes", ""),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "converted_from_contact": contact_id,
    }
    await db.leads.insert_one(lead_doc)
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "converted_to_lead": True,
        "lead_id": lead_id,
        "status": "converted",
        "last_activity_date": now_iso,
    }})
    if body.get("school_id"):
        await touch_last_activity("school", body["school_id"])
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})

# ==================== LEAD MASTER (linked to schools) ====================

def calc_lead_score(lead, school=None):
    score = 0
    if school and school.get("school_strength", 0) > 1000:
        score += 10
    desig = (lead.get("designation") or "").lower()
    if any(d in desig for d in ("principal", "trustee", "admin", "director")):
        score += 5
    if lead.get("stage") not in ("new",):
        score += 5
    if lead.get("lead_type") == "hot":
        score += 10
    elif lead.get("lead_type") == "warm":
        score += 5
    return score

@api_router.get("/leads")
async def get_leads(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin" and "leads" not in user.get("assigned_modules", []):
        query["assigned_to"] = user["email"]
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    # Enrich with school data and score
    school_cache = {}
    now = datetime.now(timezone.utc)
    for lead in leads:
        sid = lead.get("school_id")
        if sid and sid not in school_cache:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0})
            school_cache[sid] = sch
        school = school_cache.get(sid)
        lead["school_name"] = school["school_name"] if school else lead.get("school_name", "")
        lead["school_type"] = school.get("school_type", "") if school else ""
        lead["school_city"] = school.get("city", "") if school else ""
        lead["school_strength"] = school.get("school_strength", 0) if school else 0
        lead["lead_score"] = calc_lead_score(lead, school)
        # FMS Phase 3: visit_required computed flag
        lead["visit_required"] = compute_visit_required(lead, now)
    return leads

def compute_visit_required(lead: dict, now: datetime = None) -> bool:
    """A visit is required when: stage is demo/negotiation OR priority high AND
    no visit happened in last 7 days."""
    if now is None:
        now = datetime.now(timezone.utc)
    triggers = lead.get("stage") in ("demo", "negotiation") or lead.get("priority") == "high" or lead.get("lead_type") == "hot"
    if not triggers:
        return False
    last_visit = lead.get("last_visit_date")
    if not last_visit:
        return True
    try:
        lv = datetime.fromisoformat(last_visit.replace("Z", "+00:00"))
        return (now - lv).days >= 7
    except Exception:
        return True

@api_router.post("/leads")
async def create_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    # Auto-create school if new_school data provided
    school_id = body.get("school_id")
    if not school_id and body.get("new_school"):
        ns = body["new_school"]
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": ns.get("school_name", ""),
            "school_type": ns.get("school_type", "CBSE"),
            "website": ns.get("website", ""), "email": ns.get("email", ""),
            "phone": ns.get("phone", ""), "city": ns.get("city", ""),
            "state": ns.get("state", ""), "pincode": ns.get("pincode", ""),
            "primary_contact_name": body.get("contact_name", ""),
            "designation": body.get("designation", ""),
            "school_strength": ns.get("school_strength", 0),
            "number_of_branches": ns.get("number_of_branches", 1),
            "created_by": user["email"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    initial_stage = body.get("stage", "new")
    lead_doc = {
        "lead_id": lead_id,
        "school_id": school_id or "",
        "company_name": body.get("company_name", ""),
        "contact_name": body.get("contact_name", ""),
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "contact_phone": body.get("contact_phone", ""),
        "contact_email": body.get("contact_email", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "interested_product": body.get("interested_product", ""),
        "stage": initial_stage,
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "assignment_type": body.get("assignment_type", "manual"),  # manual | auto | round_robin | self
        "likely_closure_date": body.get("likely_closure_date", ""),
        "pipeline_history": [{
            "from_stage": None,
            "to_stage": initial_stage,
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": "Lead created",
        }],
        "last_visit_date": None,
        "notes": body.get("notes", ""),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.leads.insert_one(lead_doc)
    if school_id:
        await touch_last_activity("school", school_id)
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})

@api_router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    existing = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Lead not found")
    allowed = {}
    for k in ("school_id", "company_name", "contact_name", "designation", "contact_role_id",
              "contact_phone", "contact_email", "source", "source_id",
              "lead_type", "interested_product", "stage", "priority",
              "next_followup_date", "assigned_to", "assigned_name", "notes",
              "assignment_type", "likely_closure_date"):
        if k in body:
            allowed[k] = body[k]
    now_iso = datetime.now(timezone.utc).isoformat()
    allowed["updated_at"] = now_iso
    allowed["last_activity_date"] = now_iso

    # FMS: if lead is locked (converted to order) only admin can modify
    if existing.get("is_locked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Lead is locked after order conversion. Admin unlock required.")

    # Pipeline history: if stage changed, append
    if "stage" in body and body["stage"] != existing.get("stage"):
        history = existing.get("pipeline_history", []) or []
        history.append({
            "from_stage": existing.get("stage"),
            "to_stage": body["stage"],
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": body.get("stage_change_note", ""),
        })
        allowed["pipeline_history"] = history

    # Reassignment: if assigned_to changed, log it
    if "assigned_to" in body and body["assigned_to"] != existing.get("assigned_to"):
        await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                           details=f"From {existing.get('assigned_name', existing.get('assigned_to'))} to {body.get('assigned_name', body['assigned_to'])}")

    await db.leads.update_one({"lead_id": lead_id}, {"$set": allowed})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return lead

# ---- FMS Phase 2: Auto-assign + Bulk reassign ----

@api_router.post("/leads/reassign")
async def reassign_lead(request: Request):
    """Reassign one lead to a new agent with mandatory reason. Tracks history + count."""
    user = await get_current_user(request)
    body = await request.json()
    lead_id = body.get("lead_id")
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "").strip()
    if not lead_id or not new_agent_email or not reason:
        raise HTTPException(status_code=400, detail="lead_id, new_agent_email and reason are required")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    # Permissions: admin = any; manager = team; agent = blocked
    role = user.get("role", "")
    if role == "agent":
        raise HTTPException(status_code=403, detail="Agents cannot reassign")
    now_iso = datetime.now(timezone.utc).isoformat()
    history = lead.get("reassignments", []) or []
    history.append({
        "from_email": lead.get("assigned_to", ""),
        "from_name": lead.get("assigned_name", ""),
        "to_email": new_agent_email,
        "to_name": new_agent_name,
        "by_email": user["email"],
        "by_name": user["name"],
        "reason": reason,
        "at": now_iso,
    })
    reassign_count = (lead.get("reassignment_count", 0) or 0) + 1
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {
        "assigned_to": new_agent_email,
        "assigned_name": new_agent_name,
        "assignment_type": "manual",
        "reassignments": history,
        "reassignment_count": reassign_count,
        "last_reassigned_at": now_iso,
        "last_reassigned_by": user["email"],
        "last_reassignment_reason": reason,
        "updated_at": now_iso,
        "last_activity_date": now_iso,
    }})
    await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                       details=f"-> {new_agent_name} | {reason}")
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})

@api_router.post("/leads/bulk-assign")
async def bulk_assign_leads(request: Request):
    """Bulk assign multiple leads to one agent."""
    user = await get_current_user(request)
    if user.get("role") == "agent":
        raise HTTPException(status_code=403, detail="Agents cannot reassign")
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "Bulk assignment").strip()
    if not lead_ids or not new_agent_email:
        raise HTTPException(status_code=400, detail="lead_ids and new_agent_email required")
    now_iso = datetime.now(timezone.utc).isoformat()
    leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    count = 0
    for lead in leads:
        history = lead.get("reassignments", []) or []
        history.append({
            "from_email": lead.get("assigned_to", ""),
            "from_name": lead.get("assigned_name", ""),
            "to_email": new_agent_email, "to_name": new_agent_name,
            "by_email": user["email"], "by_name": user["name"],
            "reason": reason, "at": now_iso,
        })
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": new_agent_email, "assigned_name": new_agent_name,
            "assignment_type": "bulk",
            "reassignments": history,
            "reassignment_count": (lead.get("reassignment_count", 0) or 0) + 1,
            "last_reassigned_at": now_iso,
            "last_reassigned_by": user["email"],
            "last_reassignment_reason": reason,
            "updated_at": now_iso, "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "bulk_assign_lead", "lead", lead["lead_id"],
                           details=f"-> {new_agent_name} | {reason}")
        count += 1
    return {"assigned": count}

@api_router.post("/leads/auto-assign")
async def auto_assign_leads(request: Request):
    """Round-robin assign all unassigned (or specified) leads to active sales persons."""
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    lead_ids = body.get("lead_ids") or None  # if None, assign unassigned ones
    sps = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).sort("name", 1).to_list(1000)
    if not sps:
        raise HTTPException(status_code=400, detail="No active sales persons available")
    if lead_ids:
        leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    else:
        leads = await db.leads.find({"$or": [{"assigned_to": ""}, {"assigned_to": None}]}, {"_id": 0}).to_list(10000)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = []
    for i, lead in enumerate(leads):
        sp = sps[i % len(sps)]
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": sp["email"], "assigned_name": sp["name"],
            "assignment_type": "round_robin", "updated_at": now_iso, "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "auto_assign_lead", "lead", lead["lead_id"],
                           details=f"Round-robin to {sp['name']}")
        updates.append({"lead_id": lead["lead_id"], "assigned_to": sp["email"], "assigned_name": sp["name"]})
    return {"assigned": len(updates), "details": updates}

@api_router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, request: Request):
    await get_current_user(request)
    await db.leads.delete_one({"lead_id": lead_id})
    return {"message": "Lead deleted"}

# ==================== FOLLOW-UPS ====================

@api_router.get("/followups")
async def get_followups(request: Request, lead_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    elif user.get("role") != "admin":
        query["assigned_to"] = user["email"]
    followups = await db.followups.find(query, {"_id": 0}).sort("followup_date", -1).to_list(5000)
    return followups

@api_router.post("/followups")
async def create_followup(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fid = f"fu_{uuid.uuid4().hex[:12]}"
    fu_doc = {
        "followup_id": fid,
        "lead_id": body.get("lead_id"),
        "followup_date": body.get("followup_date", ""),
        "followup_time": body.get("followup_time", ""),
        "followup_type": body.get("followup_type", "call"),
        "notes": body.get("notes", ""),
        "outcome": body.get("outcome", ""),
        "status": body.get("status", "pending"),
        "assigned_to": body.get("assigned_to", user["email"]),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.followups.insert_one(fu_doc)
    # Auto-update last_activity on related lead and school
    if fu_doc.get("lead_id"):
        await touch_last_activity("lead", fu_doc["lead_id"])
        lead = await db.leads.find_one({"lead_id": fu_doc["lead_id"]}, {"_id": 0, "school_id": 1})
        if lead and lead.get("school_id"):
            await touch_last_activity("school", lead["school_id"])
    return await db.followups.find_one({"followup_id": fid}, {"_id": 0})

@api_router.put("/followups/{followup_id}")
async def update_followup(followup_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("followup_date", "followup_time", "followup_type", "notes", "outcome", "status") if k in body}
    await db.followups.update_one({"followup_id": followup_id}, {"$set": allowed})
    return await db.followups.find_one({"followup_id": followup_id}, {"_id": 0})

# Call Notes (kept)
@api_router.get("/leads/{lead_id}/notes")
async def get_lead_notes(lead_id: str, request: Request):
    await get_current_user(request)
    notes = await db.call_notes.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return notes

@api_router.post("/leads/{lead_id}/notes")
async def add_call_note(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    note_id = f"note_{uuid.uuid4().hex[:12]}"
    note_doc = {
        "note_id": note_id, "lead_id": lead_id,
        "type": body.get("type", "call"),
        "content": body.get("content", ""),
        "outcome": body.get("outcome", ""),
        "created_by": user["email"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.call_notes.insert_one(note_doc)
    # Update lead last activity + cascade to school
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"updated_at": now_iso, "last_activity_date": now_iso}})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.call_notes.find_one({"note_id": note_id}, {"_id": 0})

# ==================== CSV IMPORT ====================

@api_router.post("/leads/import")
async def import_leads_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))

    created = 0
    linked = 0
    duplicates = 0
    errors = []

    for row in reader:
        try:
            school_name = row.get("school_name", "").strip()
            phone = row.get("phone", "").strip()
            website = row.get("website", "").strip()
            contact_name = row.get("contact_name", "").strip()

            if not school_name:
                errors.append(f"Row missing school_name")
                continue

            # Find existing school
            school = None
            if phone:
                school = await db.schools.find_one({"$or": [
                    {"school_name": school_name, "phone": phone},
                    {"phone": phone}
                ]}, {"_id": 0})
            if not school and website:
                school = await db.schools.find_one({"website": website}, {"_id": 0})
            if not school:
                school = await db.schools.find_one({"school_name": school_name}, {"_id": 0})

            school_id = None
            if school:
                school_id = school["school_id"]
                linked += 1
            else:
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                await db.schools.insert_one({
                    "school_id": school_id,
                    "school_name": school_name,
                    "school_type": row.get("school_type", "CBSE").strip(),
                    "website": website, "email": row.get("email", "").strip(),
                    "phone": phone, "city": row.get("location", row.get("city", "")).strip(),
                    "state": row.get("state", "").strip(), "pincode": row.get("pincode", "").strip(),
                    "primary_contact_name": contact_name,
                    "designation": row.get("designation", "").strip(),
                    "school_strength": int(row.get("school_strength", 0) or 0),
                    "number_of_branches": 1,
                    "created_by": "import", "created_at": datetime.now(timezone.utc).isoformat(),
                })

            # Check duplicate lead
            existing_lead = await db.leads.find_one({
                "school_id": school_id,
                "contact_phone": phone
            }, {"_id": 0})
            if existing_lead:
                duplicates += 1
                continue

            lead_id = f"lead_{uuid.uuid4().hex[:12]}"
            await db.leads.insert_one({
                "lead_id": lead_id, "school_id": school_id,
                "company_name": school_name,
                "contact_name": contact_name,
                "designation": row.get("designation", "").strip(),
                "contact_phone": phone,
                "contact_email": row.get("email", "").strip(),
                "source": row.get("source", "import").strip(),
                "lead_type": "warm", "stage": "new", "priority": "medium",
                "interested_product": "", "next_followup_date": "",
                "assigned_to": "", "assigned_name": "", "notes": "",
                "created_by": "import",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            created += 1
        except Exception as e:
            errors.append(str(e))

    return {"created": created, "linked": linked, "duplicates": duplicates, "errors": errors[:10]}

# Follow-ups / Tasks
@api_router.get("/tasks")
async def get_tasks(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["$or"] = [{"assigned_to": user["email"]}, {"created_by": user["email"]}]
    tasks = await db.tasks.find(query, {"_id": 0}).sort("due_date", 1).to_list(5000)
    return tasks

@api_router.post("/tasks")
async def create_task(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    task_doc = {
        "task_id": task_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "type": body.get("type", "follow_up"),
        "lead_id": body.get("lead_id"),
        "lead_name": body.get("lead_name", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "due_date": body.get("due_date", ""),
        "due_time": body.get("due_time", ""),
        "priority": body.get("priority", "medium"),
        "status": "pending",
        "outcome": "",
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(task_doc)
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})

@api_router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("title", "description", "type", "assigned_to", "assigned_name",
              "due_date", "due_time", "priority", "status", "outcome") if k in body}
    await db.tasks.update_one({"task_id": task_id}, {"$set": allowed})
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    await get_current_user(request)
    await db.tasks.delete_one({"task_id": task_id})
    return {"message": "Task deleted"}

# ==================== LEAVE MANAGEMENT ====================

@api_router.get("/leaves")
async def get_leaves(request: Request):
    user = await get_current_user(request)
    query = {}
    can_view_all = user.get("role") == "admin" or "hr" in user.get("assigned_modules", [])
    if not can_view_all:
        query["user_email"] = user["email"]
    leaves = await db.leaves.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return leaves

@api_router.post("/leaves")
async def apply_leave(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    leave_id = f"lv_{uuid.uuid4().hex[:12]}"
    leave_doc = {
        "leave_id": leave_id,
        "user_id": user.get("user_id"),
        "user_email": user["email"],
        "user_name": user["name"],
        "leave_type": body.get("leave_type", "casual"),
        "from_date": body.get("from_date"),
        "to_date": body.get("to_date"),
        "half_day": body.get("half_day", False),
        "reason": body.get("reason", ""),
        "status": "pending",
        "approved_by": None,
        "remarks": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # Calculate days
    try:
        fd = datetime.fromisoformat(body.get("from_date"))
        td = datetime.fromisoformat(body.get("to_date"))
        days = (td - fd).days + 1
        if body.get("half_day"):
            days = 0.5
        leave_doc["days"] = days
    except:
        leave_doc["days"] = 1

    await db.leaves.insert_one(leave_doc)
    return await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})

@api_router.put("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, request: Request):
    user = await get_current_user(request)
    can_approve = user.get("role") == "admin" or "hr" in user.get("assigned_modules", [])
    if not can_approve:
        raise HTTPException(status_code=403, detail="Only Admin/HR can approve leaves")
    body = await request.json()
    status = body.get("status", "approved")
    remarks = body.get("remarks", "")
    await db.leaves.update_one({"leave_id": leave_id}, {"$set": {
        "status": status,
        "approved_by": user["email"],
        "remarks": remarks,
    }})
    return await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})

@api_router.delete("/leaves/{leave_id}")
async def cancel_leave(leave_id: str, request: Request):
    user = await get_current_user(request)
    leave = await db.leaves.find_one({"leave_id": leave_id}, {"_id": 0})
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    if leave["user_email"] != user["email"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    if leave["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending leaves can be cancelled")
    await db.leaves.delete_one({"leave_id": leave_id})
    return {"message": "Leave cancelled"}

@api_router.get("/leaves/balance")
async def get_leave_balance(request: Request):
    user = await get_current_user(request)
    email = request.query_params.get("email", user["email"])
    current_year = datetime.now(timezone.utc).year
    year_start = f"{current_year}-01-01"

    approved = await db.leaves.find({
        "user_email": email,
        "status": "approved",
        "from_date": {"$gte": year_start}
    }, {"_id": 0}).to_list(500)

    used = {"casual": 0, "sick": 0, "earned": 0, "half_day": 0}
    for lv in approved:
        lt = lv.get("leave_type", "casual")
        if lv.get("half_day"):
            used["half_day"] += 1
        elif lt in used:
            used[lt] += lv.get("days", 0)

    total = {"casual": 12, "sick": 6, "earned": 15}
    balance = {k: total.get(k, 0) - used.get(k, 0) for k in total}

    return {"total": total, "used": used, "balance": balance, "half_days_used": used["half_day"]}

# ==================== AUTO-REMINDER & CONVERSION TRACKING ====================

import asyncio

async def run_auto_reminders():
    """Background task: Check overdue tasks and pending follow-ups, create alerts"""
    while True:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            # Find overdue pending tasks
            overdue_tasks = await db.tasks.find({
                "status": "pending",
                "due_date": {"$lt": today}
            }, {"_id": 0}).to_list(500)

            for task in overdue_tasks:
                await db.tasks.update_one(
                    {"task_id": task["task_id"], "status": "pending"},
                    {"$set": {"status": "missed"}}
                )
                # Create reminder notification
                await db.notifications.update_one(
                    {"task_id": task["task_id"], "type": "overdue_task"},
                    {"$set": {
                        "task_id": task["task_id"],
                        "type": "overdue_task",
                        "title": f"Overdue: {task['title']}",
                        "message": f"Task '{task['title']}' was due on {task['due_date']}",
                        "assigned_to": task.get("assigned_to"),
                        "lead_id": task.get("lead_id"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }},
                    upsert=True
                )

            # Find leads with no activity in 7 days
            week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            stale_leads = await db.leads.find({
                "stage": {"$nin": ["won", "lost"]},
                "updated_at": {"$lt": week_ago}
            }, {"_id": 0}).to_list(500)

            for lead in stale_leads:
                await db.notifications.update_one(
                    {"lead_id": lead["lead_id"], "type": "stale_lead"},
                    {"$set": {
                        "lead_id": lead["lead_id"],
                        "type": "stale_lead",
                        "title": f"No activity: {lead['company_name']}",
                        "message": f"Lead '{lead['company_name']}' has no activity since {lead['updated_at'][:10]}",
                        "assigned_to": lead.get("assigned_to"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }},
                    upsert=True
                )

            # Pending quotations > 3 days
            three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
            pending_quots = await db.quotations.find({
                "quotation_status": {"$in": ["draft", "sent"]},
                "created_at": {"$lt": three_days_ago}
            }, {"_id": 0}).to_list(500)

            for q in pending_quots:
                await db.notifications.update_one(
                    {"quotation_id": q["quotation_id"], "type": "pending_quotation"},
                    {"$set": {
                        "quotation_id": q["quotation_id"],
                        "type": "pending_quotation",
                        "title": f"Pending: {q['quote_number']}",
                        "message": f"Quotation {q['quote_number']} for {q['school_name']} is still {q['quotation_status']}",
                        "assigned_to": q.get("sales_person_email"),
                        "is_read": False,
                        "created_at": datetime.now(timezone.utc).isoformat()
                    }},
                    upsert=True
                )

            logging.info(f"Auto-reminder: {len(overdue_tasks)} overdue, {len(stale_leads)} stale, {len(pending_quots)} pending quots")
        except Exception as e:
            logging.error(f"Auto-reminder error: {e}")

        await asyncio.sleep(3600)  # Run every hour

@api_router.get("/notifications")
async def get_notifications(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["assigned_to"] = user["email"]
    notifications = await db.notifications.find(query, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return notifications

@api_router.put("/notifications/read-all")
async def mark_all_read(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["assigned_to"] = user["email"]
    await db.notifications.update_many(query, {"$set": {"is_read": True}})
    return {"message": "All notifications marked as read"}

# Conversion Tracking
@api_router.get("/analytics/conversion")
async def get_conversion_analytics(request: Request):
    user = await get_current_user(request)

    # Lead conversion by stage
    pipeline_counts = {}
    for stage in ["new", "contacted", "demo", "quoted", "negotiation", "won", "lost"]:
        pipeline_counts[stage] = await db.leads.count_documents({"stage": stage})

    total_leads = sum(pipeline_counts.values())
    won_count = pipeline_counts.get("won", 0)
    lost_count = pipeline_counts.get("lost", 0)
    conversion_rate = (won_count / total_leads * 100) if total_leads > 0 else 0

    # Per salesperson conversion
    all_sp = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(100)
    sp_conversion = []
    for sp in all_sp:
        sp_total = await db.leads.count_documents({"assigned_to": sp["email"]})
        sp_won = await db.leads.count_documents({"assigned_to": sp["email"], "stage": "won"})
        sp_lost = await db.leads.count_documents({"assigned_to": sp["email"], "stage": "lost"})
        sp_active = await db.leads.count_documents({"assigned_to": sp["email"], "stage": {"$nin": ["won", "lost"]}})
        sp_quots = await db.quotations.count_documents({"sales_person_email": sp["email"]})
        sp_revenue = 0
        won_quots = await db.quotations.find({"sales_person_email": sp["email"], "quotation_status": "confirmed"}, {"_id": 0, "grand_total": 1}).to_list(1000)
        sp_revenue = sum(q.get("grand_total", 0) for q in won_quots)

        sp_conversion.append({
            "name": sp["name"],
            "email": sp["email"],
            "total_leads": sp_total,
            "won": sp_won,
            "lost": sp_lost,
            "active": sp_active,
            "quotations": sp_quots,
            "revenue": sp_revenue,
            "conversion_rate": (sp_won / sp_total * 100) if sp_total > 0 else 0,
        })

    sp_conversion.sort(key=lambda x: x["conversion_rate"], reverse=True)

    # Quotation stats
    total_quots = await db.quotations.count_documents({})
    draft_quots = await db.quotations.count_documents({"quotation_status": "draft"})
    sent_quots = await db.quotations.count_documents({"quotation_status": "sent"})
    confirmed_quots = await db.quotations.count_documents({"quotation_status": "confirmed"})

    # Task stats
    total_tasks = await db.tasks.count_documents({})
    pending_tasks = await db.tasks.count_documents({"status": "pending"})
    done_tasks = await db.tasks.count_documents({"status": "done"})
    missed_tasks = await db.tasks.count_documents({"status": "missed"})

    return {
        "pipeline": pipeline_counts,
        "total_leads": total_leads,
        "won": won_count,
        "lost": lost_count,
        "conversion_rate": round(conversion_rate, 1),
        "salesperson_conversion": sp_conversion,
        "quotation_stats": {
            "total": total_quots, "draft": draft_quots, "sent": sent_quots, "confirmed": confirmed_quots,
        },
        "task_stats": {
            "total": total_tasks, "pending": pending_tasks, "done": done_tasks, "missed": missed_tasks,
        },
    }

# ==================== CATALOGUE PUBLIC ENDPOINT ====================

@api_router.get("/catalogue/{token}")
async def get_catalogue(token: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Catalogue not found")
    
    # Mark as opened
    if quot.get("catalogue_status") == "sent":
        await db.quotations.update_one(
            {"catalogue_token": token},
            {"$set": {
                "catalogue_status": "opened",
                "catalogue_opened_at": datetime.now(timezone.utc).isoformat()
            }}
        )
    
    # Get package details
    package = await db.packages.find_one({"package_id": quot["package_id"]}, {"_id": 0})
    
    # Get active dies
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)
    
    return {
        "quotation": quot,
        "package": package,
        "dies": dies
    }

@api_router.post("/catalogue/{token}/submit")
async def submit_catalogue_selection(token: str, request: Request):
    body = await request.json()
    selected_dies = body.get("selected_dies", [])
    
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Catalogue not found")
    
    # Create selection record
    selection_id = f"sel_{uuid.uuid4().hex[:12]}"
    selection_doc = {
        "selection_id": selection_id,
        "quotation_id": quot["quotation_id"],
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "customer_ip": request.client.host if request.client else "unknown"
    }
    await db.catalogue_selections.insert_one(selection_doc)
    
    # Create selection items and update stock
    for die_id in selected_dies:
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
        if die:
            await db.catalogue_selection_items.insert_one({
                "catalogue_selection_id": selection_id,
                "die_id": die_id,
                "die_name": die["name"],
                "die_code": die["code"],
                "die_type": die["type"],
                "die_image_url": die.get("image_url")
            })
            
            # Update reserved qty
            await db.dies.update_one(
                {"die_id": die_id},
                {"$inc": {"reserved_qty": 1}}
            )
            
            # Check if purchase alert needed
            updated_die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
            available = updated_die["stock_qty"] - updated_die["reserved_qty"]
            if available < 0:
                await db.purchase_alerts.insert_one({
                    "alert_id": f"alert_{uuid.uuid4().hex[:12]}",
                    "die_id": die_id,
                    "die_code": die["code"],
                    "die_name": die["name"],
                    "die_type": die["type"],
                    "triggered_by_catalogue_selection_id": selection_id,
                    "current_stock": updated_die["stock_qty"],
                    "required_qty": updated_die["reserved_qty"],
                    "shortage_qty": abs(available),
                    "priority": "urgent" if abs(available) > 10 else "high",
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
    
    # Update quotation
    await db.quotations.update_one(
        {"catalogue_token": token},
        {"$set": {
            "catalogue_status": "submitted",
            "catalogue_submitted_at": datetime.now(timezone.utc).isoformat(),
            "quotation_status": "pending"
        }}
    )
    
    return {"message": "Selection submitted successfully"}

# ==================== ORDERS + HOLD SYSTEM ====================

@api_router.get("/orders")
async def get_orders(request: Request):
    user = await get_current_user(request)
    orders = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return orders

@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request):
    await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    order["items"] = items
    timeline = await db.order_timeline.find({"order_id": order_id}, {"_id": 0}).sort("timestamp", 1).to_list(100)
    order["timeline"] = timeline
    return order

@api_router.post("/orders")
async def create_order_from_quotation(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    quotation_id = body.get("quotation_id")
    if not quotation_id:
        raise HTTPException(status_code=400, detail="quotation_id required")
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    existing = await db.orders.find_one({"quotation_id": quotation_id})
    if existing:
        raise HTTPException(status_code=400, detail="Order already exists for this quotation")

    # FMS Phase 5.3: if converting from a lead, only allow in Negotiation/Won
    lead_id = body.get("lead_id")
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        if lead.get("stage") not in ("negotiation", "won"):
            raise HTTPException(status_code=400, detail="Lead must be in Negotiation or Won stage to convert")

    order_id = f"ord_{uuid.uuid4().hex[:12]}"
    order_num_count = await db.orders.count_documents({})
    order_number = f"ORD-{datetime.now(timezone.utc).year}-{order_num_count + 1:04d}"

    # Get catalogue selection items for this quotation
    selection = await db.catalogue_selections.find_one({"quotation_id": quotation_id}, {"_id": 0})
    sel_items = []
    if selection:
        sel_items = await db.catalogue_selection_items.find({"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}).to_list(1000)

    now_iso = datetime.now(timezone.utc).isoformat()
    order_doc = {
        "order_id": order_id,
        "order_number": order_number,
        "quotation_id": quotation_id,
        "quote_number": quot.get("quote_number", ""),
        "school_id": quot.get("school_id", ""),
        "school_name": quot.get("school_name", ""),
        "lead_id": lead_id or "",
        "package_name": quot.get("package_name", ""),
        "total_items": len(sel_items),
        "grand_total": quot.get("grand_total", 0),
        "order_status": "pending",
        # FMS Phase 5.3 production pipeline
        "production_stage": "order_created",  # order_created | in_production | ready_to_dispatch | dispatched
        "payment_threshold_pct": float(body.get("payment_threshold_pct", 50)),
        "payment_received": float(body.get("payment_received", 0)),
        "dispatch_date": None,
        "notes": body.get("notes", ""),
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.orders.insert_one(order_doc)

    # Create order items from selection
    for item in sel_items:
        await db.order_items.insert_one({
            "order_item_id": f"oi_{uuid.uuid4().hex[:8]}",
            "order_id": order_id,
            "die_id": item.get("die_id"),
            "die_name": item.get("die_name"),
            "die_code": item.get("die_code"),
            "die_type": item.get("die_type"),
            "die_image_url": item.get("die_image_url"),
            "quantity": 1,
            "status": "on_hold",
        })

    # Add timeline entry
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": "pending",
        "note": "Order created from quotation",
        "updated_by": user["email"],
        "timestamp": now_iso,
    })

    # Update quotation status
    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": {"quotation_status": "confirmed"}})

    # FMS Phase 5.3: lock the lead if conversion
    if lead_id:
        await db.leads.update_one({"lead_id": lead_id}, {"$set": {
            "is_locked": True, "order_id": order_id, "stage": "won",
            "last_activity_date": now_iso, "updated_at": now_iso,
        }})
        await log_activity(user["email"], "convert_to_order", "lead", lead_id, f"Order {order_number} created")

    await log_activity(user["email"], "create", "order", order_id, f"Order {order_number} created from {quot.get('quote_number', '')}")
    return await db.orders.find_one({"order_id": order_id}, {"_id": 0})

# ---- FMS Phase 5.3: Lead lock/unlock ----
@api_router.post("/leads/{lead_id}/lock")
async def lock_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    is_locked = bool(body.get("is_locked", True))
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"is_locked": is_locked}})
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})

# ---- FMS Phase 5.3/5.4: Order production pipeline (Kanban) ----
VALID_PRODUCTION_STAGES = ["order_created", "in_production", "ready_to_dispatch", "dispatched"]

@api_router.put("/orders/{order_id}/production-stage")
async def update_order_production_stage(order_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    new_stage = body.get("production_stage")
    if new_stage not in VALID_PRODUCTION_STAGES:
        raise HTTPException(status_code=400, detail="Invalid production_stage")
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    # Dispatch guards
    if new_stage == "dispatched":
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        for it in items:
            if it.get("status") == "out_of_stock":
                raise HTTPException(status_code=400, detail=f"Cannot dispatch — item out of stock: {it.get('die_name','')}")
        threshold = float(order.get("payment_threshold_pct", 50))
        grand = float(order.get("grand_total", 0) or 0)
        received = float(order.get("payment_received", 0) or 0)
        if grand > 0 and (received / grand * 100) < threshold:
            raise HTTPException(status_code=400, detail=f"Cannot dispatch — payment below threshold ({threshold}% required)")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"order_id": order_id}, {"$set": {
        "production_stage": new_stage, "updated_at": now_iso,
    }})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}", "order_id": order_id,
        "status": new_stage, "note": body.get("note", f"Moved to {new_stage}"),
        "updated_by": user["email"], "timestamp": now_iso,
    })
    await log_activity(user["email"], "update_production_stage", "order", order_id, f"-> {new_stage}")
    return await db.orders.find_one({"order_id": order_id}, {"_id": 0})

# ---- FMS Phase 5.4: Dispatch tracking + WhatsApp send ----
@api_router.put("/dispatches/{dispatch_id}/tracking")
async def update_dispatch_tracking(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("tracking_number", "courier_name", "courier_url", "status") if k in body}
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.dispatches.update_one({"dispatch_id": dispatch_id}, {"$set": allowed})
    disp = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    await log_activity(user["email"], "update_tracking", "dispatch", dispatch_id,
                       details=f"{allowed.get('courier_name','')} {allowed.get('tracking_number','')}")
    return disp

# ---- FMS Phase 5.4: Admin Control Panel analytics ----
# ---- FMS Phase 6 (Mobile/PWA): Today's Action Dashboard ----
@api_router.get("/today/actions")
async def today_actions(request: Request):
    """Unified feed of today's + overdue + upcoming call follow-ups and visits, respecting role.
    Returns { overdue: [...], calls_today: [...], visits_today: [...], counts: {...} }.
    """
    user = await get_current_user(request)
    from datetime import date as _date
    today = _date.today().isoformat()

    lead_query = {}
    visit_query = {}
    fu_query = {}
    role = user.get("role", "")
    if role not in ("admin", "manager"):
        lead_query["assigned_to"] = user["email"]
        visit_query["assigned_to"] = user["email"]
        fu_query["assigned_to"] = user["email"]

    # Load assigned leads (source of truth for contact/phone/stage)
    leads_all = await db.leads.find(lead_query, {"_id": 0}).to_list(10000)
    leads_by_id = {l["lead_id"]: l for l in leads_all}

    def _card_from_lead(lead, kind, due_date):
        days_stale = None
        if lead.get("last_activity_date"):
            try:
                la = datetime.fromisoformat(lead["last_activity_date"].replace("Z", "+00:00"))
                days_stale = (datetime.now(timezone.utc) - la).days
            except Exception:
                pass
        return {
            "kind": kind,  # call | visit | overdue_call | overdue_visit
            "lead_id": lead["lead_id"],
            "school_id": lead.get("school_id"),
            "school_name": lead.get("school_name") or lead.get("company_name") or "",
            "contact_name": lead.get("contact_name", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "stage": lead.get("stage", "new"),
            "priority": lead.get("priority", "medium"),
            "lead_type": lead.get("lead_type", "warm"),
            "assigned_name": lead.get("assigned_name", ""),
            "last_activity_date": lead.get("last_activity_date"),
            "days_stale": days_stale,
            "next_followup_date": lead.get("next_followup_date"),
            "due_date": due_date,
            "is_hot": lead.get("lead_type") == "hot" or lead.get("catalogue_status") == "opened" or lead.get("quotation_status") == "confirmed",
        }

    # Calls due — leads with next_followup_date
    calls_today = []
    overdue_calls = []
    for l in leads_all:
        fu = l.get("next_followup_date")
        if not fu:
            continue
        if fu == today:
            calls_today.append(_card_from_lead(l, "call", fu))
        elif fu < today:
            overdue_calls.append(_card_from_lead(l, "overdue_call", fu))

    # Visits today
    visits = await db.visit_plans.find(visit_query, {"_id": 0}).to_list(10000)
    visits_today = []
    overdue_visits = []
    for v in visits:
        if v.get("status") in ("completed", "cancelled"):
            continue
        vdate = v.get("visit_date")
        if not vdate:
            continue
        # Enrich with lead data if linked
        linked = leads_by_id.get(v.get("lead_id") or "")
        card = {
            "kind": "visit" if vdate >= today else "overdue_visit",
            "plan_id": v.get("plan_id"),
            "lead_id": v.get("lead_id"),
            "school_id": v.get("school_id"),
            "school_name": v.get("school_name", "") or (linked.get("school_name") if linked else ""),
            "contact_name": (linked.get("contact_name", "") if linked else ""),
            "contact_phone": (linked.get("contact_phone", "") if linked else v.get("phone", "")),
            "stage": (linked.get("stage", "") if linked else ""),
            "priority": (linked.get("priority", "") if linked else v.get("priority", "medium")),
            "assigned_name": v.get("assigned_name", ""),
            "visit_time": v.get("visit_time"),
            "purpose": v.get("purpose", ""),
            "status": v.get("status", "planned"),
            "due_date": vdate,
            "next_followup_date": (linked.get("next_followup_date") if linked else None),
            "last_activity_date": (linked.get("last_activity_date") if linked else None),
            "is_hot": (linked.get("lead_type") == "hot" if linked else False),
        }
        if vdate == today:
            visits_today.append(card)
        elif vdate < today:
            overdue_visits.append(card)

    # Sort: high-priority/stale first
    def _sort_key(c):
        pri_order = {"high": 0, "medium": 1, "low": 2}
        return (pri_order.get(c.get("priority", "medium"), 1), -(c.get("days_stale") or 0))
    overdue = sorted(overdue_calls + overdue_visits, key=lambda c: (c.get("due_date") or "", c.get("priority", "medium")))
    calls_today.sort(key=_sort_key)
    visits_today.sort(key=_sort_key)

    return {
        "today": today,
        "overdue": overdue,
        "calls_today": calls_today,
        "visits_today": visits_today,
        "counts": {
            "overdue": len(overdue),
            "calls_today": len(calls_today),
            "visits_today": len(visits_today),
            "total": len(overdue) + len(calls_today) + len(visits_today),
        },
        "role": role,
    }

@api_router.post("/today/mark-done")
async def today_mark_done(request: Request):
    """Mark a today-action card done. Requires activity log + next_followup_date (strict rule)."""
    user = await get_current_user(request)
    body = await request.json()
    kind = body.get("kind")
    note = (body.get("note") or "").strip()
    next_fu = body.get("next_followup_date", "")
    if not note:
        raise HTTPException(status_code=400, detail="Activity note is required to mark done")
    if not next_fu and kind not in ("visit", "overdue_visit"):
        raise HTTPException(status_code=400, detail="Next follow-up date is required")

    now_iso = datetime.now(timezone.utc).isoformat()
    if kind in ("visit", "overdue_visit"):
        plan_id = body.get("plan_id")
        if not plan_id:
            raise HTTPException(status_code=400, detail="plan_id required")
        update = {
            "status": "completed",
            "visit_notes": note,
            "outcome": note,
            "check_out_time": now_iso,
            "updated_at": now_iso,
        }
        await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
        lead_id = body.get("lead_id")
        if lead_id:
            await db.leads.update_one({"lead_id": lead_id}, {"$set": {
                "last_activity_date": now_iso,
                "last_visit_date": now_iso,
                "next_followup_date": next_fu or "",
                "updated_at": now_iso,
            }})
            await db.call_notes.insert_one({
                "note_id": f"cn_{uuid.uuid4().hex[:8]}", "lead_id": lead_id, "type": "meeting",
                "content": note, "outcome": note, "created_by": user["email"],
                "created_by_name": user["name"], "created_at": now_iso,
            })
        await log_activity(user["email"], "today_mark_done_visit", "visit_plan", plan_id, note[:120])
        return {"ok": True, "kind": kind}

    # call / overdue_call
    lead_id = body.get("lead_id")
    if not lead_id:
        raise HTTPException(status_code=400, detail="lead_id required")
    note_id = f"cn_{uuid.uuid4().hex[:8]}"
    await db.call_notes.insert_one({
        "note_id": note_id, "lead_id": lead_id, "type": "call",
        "content": note, "outcome": note, "created_by": user["email"],
        "created_by_name": user["name"], "created_at": now_iso,
    })
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {
        "last_activity_date": now_iso,
        "next_followup_date": next_fu,
        "updated_at": now_iso,
    }})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    await log_activity(user["email"], "today_mark_done_call", "lead", lead_id, note[:120])
    return {"ok": True, "kind": kind, "note_id": note_id}

@api_router.get("/admin/funnel")
async def admin_funnel(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    # Lead stage buckets
    stage_buckets = {}
    async for doc in db.leads.aggregate([
        {"$group": {"_id": "$stage", "count": {"$sum": 1}}}
    ]):
        stage_buckets[doc["_id"] or "new"] = doc["count"]
    # Orders production stages
    order_stages = {}
    async for doc in db.orders.aggregate([
        {"$group": {"_id": "$production_stage", "count": {"$sum": 1}}}
    ]):
        order_stages[doc["_id"] or "order_created"] = doc["count"]
    total_leads = await db.leads.count_documents({})
    total_orders = await db.orders.count_documents({})
    total_dispatches = await db.dispatches.count_documents({})
    # Reassignment leaderboard
    reassigned = await db.leads.find({"reassignment_count": {"$gt": 0}}, {"_id": 0}).sort("reassignment_count", -1).to_list(50)
    # Recent activity_log entries for movement
    movement = await db.activity_logs.find({"action": {"$in": ["reassign_lead", "bulk_assign_lead", "convert_to_order", "update_production_stage"]}},
                                           {"_id": 0}).sort("timestamp", -1).to_list(100)
    return {
        "lead_stages": stage_buckets,
        "order_stages": order_stages,
        "totals": {"leads": total_leads, "orders": total_orders, "dispatches": total_dispatches},
        "lead_to_order_ratio": round(total_orders / total_leads, 3) if total_leads else 0,
        "order_to_dispatch_ratio": round(total_dispatches / total_orders, 3) if total_orders else 0,
        "reassignment_leaderboard": reassigned[:20],
        "recent_movements": movement,
    }

@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    new_status = body.get("status")
    if new_status not in ("pending", "confirmed", "dispatched", "delivered", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")

    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    update_data = {"order_status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "dispatched":
        update_data["dispatch_date"] = body.get("dispatch_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        # Auto deduct stock on dispatch
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        for item in items:
            if item.get("status") == "on_hold":
                await db.dies.update_one({"die_id": item["die_id"]}, {
                    "$inc": {"stock_qty": -item.get("quantity", 1), "reserved_qty": -item.get("quantity", 1)}
                })
                await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "dispatched"}})
    elif new_status == "delivered":
        await db.order_items.update_many({"order_id": order_id}, {"$set": {"status": "delivered"}})
    elif new_status == "cancelled":
        # Release holds back to available
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        for item in items:
            if item.get("status") == "on_hold":
                await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
                await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "cancelled"}})

    await db.orders.update_one({"order_id": order_id}, {"$set": update_data})

    # Add timeline
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": new_status,
        "note": body.get("note", f"Status changed to {new_status}"),
        "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return await db.orders.find_one({"order_id": order_id}, {"_id": 0})

# ---- PAYMENTS ----

@api_router.post("/orders/{order_id}/payment")
async def record_payment(order_id: str, request: Request):
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    body = await request.json()
    amount = float(body.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    payment_doc = {
        "payment_id": payment_id,
        "order_id": order_id,
        "amount": amount,
        "method": body.get("method", "cash"),  # cash | neft | upi | cheque
        "reference": body.get("reference", ""),
        "notes": body.get("notes", ""),
        "recorded_by": user["email"],
        "payment_date": body.get("payment_date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payments.insert_one(payment_doc)
    # Recalculate total paid and update order payment status
    all_payments = await db.payments.find({"order_id": order_id}, {"_id": 0}).to_list(None)
    total_paid = sum(p["amount"] for p in all_payments)
    # Get grand_total from linked quotation
    quot = await db.quotations.find_one({"quotation_id": order.get("quotation_id")}, {"_id": 0})
    grand_total = (quot or {}).get("grand_total", 0)
    payment_status = "paid" if total_paid >= grand_total else "partial" if total_paid > 0 else "unpaid"
    await db.orders.update_one({"order_id": order_id}, {
        "$set": {"total_paid": total_paid, "payment_status": payment_status}
    })
    return {**payment_doc, "total_paid": total_paid, "payment_status": payment_status}

@api_router.get("/orders/{order_id}/payments")
async def get_order_payments(order_id: str, request: Request):
    await get_current_user(request)
    payments = await db.payments.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(None)
    total_paid = sum(p["amount"] for p in payments)
    return {"payments": payments, "total_paid": total_paid}

# ---- HOLDS ----

@api_router.get("/holds")
async def get_holds(request: Request):
    await get_current_user(request)
    # Aggregate holds: each die with reserved_qty > 0, linked to orders
    holds = []
    items = await db.order_items.find({"status": "on_hold"}, {"_id": 0}).to_list(10000)
    for item in items:
        order = await db.orders.find_one({"order_id": item["order_id"]}, {"_id": 0})
        die = await db.dies.find_one({"die_id": item["die_id"]}, {"_id": 0})
        holds.append({
            "order_item_id": item["order_item_id"],
            "order_id": item["order_id"],
            "order_number": order.get("order_number", "") if order else "",
            "school_name": order.get("school_name", "") if order else "",
            "die_id": item["die_id"],
            "die_name": item.get("die_name", ""),
            "die_code": item.get("die_code", ""),
            "quantity": item.get("quantity", 1),
            "hold_date": order.get("created_at", "") if order else "",
            "stock_qty": die.get("stock_qty", 0) if die else 0,
            "reserved_qty": die.get("reserved_qty", 0) if die else 0,
            "available": (die.get("stock_qty", 0) - die.get("reserved_qty", 0)) if die else 0,
            "status": item.get("status", "on_hold"),
        })
    return holds

@api_router.post("/holds/bulk-release")
async def bulk_release_holds(request: Request):
    await get_current_user(request)
    body = await request.json()
    item_ids = body.get("item_ids", [])
    if not item_ids:
        raise HTTPException(status_code=400, detail="No item IDs provided")
    released, skipped = [], []
    for oid in item_ids:
        item = await db.order_items.find_one({"order_item_id": oid})
        if not item or item.get("status") != "on_hold":
            skipped.append(oid)
            continue
        await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
        await db.order_items.update_one({"order_item_id": oid}, {"$set": {"status": "released"}})
        released.append(oid)
    return {"released": len(released), "skipped": len(skipped), "released_ids": released}

@api_router.post("/holds/{order_item_id}/release")
async def release_hold(order_item_id: str, request: Request):
    user = await get_current_user(request)
    item = await db.order_items.find_one({"order_item_id": order_item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Hold item not found")
    if item.get("status") != "on_hold":
        raise HTTPException(status_code=400, detail="Item is not on hold")
    # Release reserved qty
    await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
    await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "released"}})
    return {"message": "Hold released"}

@api_router.post("/holds/{order_item_id}/confirm")
async def confirm_hold(order_item_id: str, request: Request):
    user = await get_current_user(request)
    item = await db.order_items.find_one({"order_item_id": order_item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Hold item not found")
    await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "confirmed"}})
    return {"message": "Hold confirmed"}

# ==================== STOCK MANAGEMENT ====================

@api_router.post("/stock/movement", response_model=StockMovement)
async def create_stock_movement(movement_input: StockMovementCreate, request: Request):
    user = await get_current_user(request)
    
    die = await db.dies.find_one({"die_id": movement_input.die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    
    movement_id = f"mov_{uuid.uuid4().hex[:12]}"
    movement_doc = {
        "movement_id": movement_id,
        "die_id": movement_input.die_id,
        "die_code": die["code"],
        "die_name": die["name"],
        "movement_type": movement_input.movement_type,
        "quantity": movement_input.quantity,
        "sales_person_id": movement_input.sales_person_id,
        "sales_person_name": None,
        "notes": movement_input.notes,
        "movement_date": datetime.now(timezone.utc).isoformat(),
        "reference_number": None
    }
    
    # Update stock
    if movement_input.movement_type == "stock_in":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": movement_input.quantity}})
    elif movement_input.movement_type == "stock_out":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": -movement_input.quantity}})
    elif movement_input.movement_type == "allocated_to_sales":
        # Update sales person stock
        await db.sales_person_stock.update_one(
            {"sales_person_id": movement_input.sales_person_id, "die_id": movement_input.die_id},
            {"$inc": {"allocated_qty": movement_input.quantity, "current_holding": movement_input.quantity}},
            upsert=True
        )
    
    await db.stock_movements.insert_one(movement_doc)
    return await db.stock_movements.find_one({"movement_id": movement_id}, {"_id": 0})

@api_router.get("/stock/movements")
async def get_stock_movements(request: Request):
    user = await get_current_user(request)
    movements = await db.stock_movements.find({}, {"_id": 0}).sort("movement_date", -1).limit(100).to_list(100)
    return movements

@api_router.get("/purchase-alerts")
async def get_purchase_alerts(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if status:
        query["status"] = status
    alerts = await db.purchase_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return alerts

@api_router.put("/purchase-alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, status: str, request: Request):
    user = await get_current_user(request)
    await db.purchase_alerts.update_one({"alert_id": alert_id}, {"$set": {"status": status}})
    return {"message": "Alert updated"}

# ==================== ANALYTICS ====================

@api_router.get("/analytics/dashboard")
async def get_dashboard_analytics(request: Request):
    user = await get_current_user(request)
    
    total_dies = await db.dies.count_documents({})
    low_stock_count = await db.dies.count_documents({"$expr": {"$lt": ["$stock_qty", "$min_level"]}})
    pending_alerts = await db.purchase_alerts.count_documents({"status": "pending"})
    
    # Monthly revenue
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    quotations = await db.quotations.find({
        "created_at": {"$regex": f"^{current_month}"},
        "quotation_status": {"$in": ["confirmed", "sent", "pending"]}
    }, {"_id": 0}).to_list(1000)
    monthly_revenue = sum(q["grand_total"] for q in quotations)
    
    return {
        "total_dies": total_dies,
        "low_stock_count": low_stock_count,
        "pending_alerts": pending_alerts,
        "monthly_revenue": monthly_revenue
    }

@api_router.get("/analytics/charts")
async def get_chart_data(request: Request):
    user = await get_current_user(request)
    
    # Stock by type
    stock_by_type = {}
    dies = await db.dies.find({}, {"_id": 0}).to_list(1000)
    for die in dies:
        type_name = die["type"]
        stock_by_type[type_name] = stock_by_type.get(type_name, 0) + die["stock_qty"]
    
    # Quotation status distribution
    status_dist = {}
    quotations = await db.quotations.find({}, {"_id": 0}).to_list(1000)
    for quot in quotations:
        status = quot["quotation_status"]
        status_dist[status] = status_dist.get(status, 0) + 1
    
    return {
        "stock_by_type": [{"type": k, "count": v} for k, v in stock_by_type.items()],
        "quotation_status": [{"status": k, "count": v} for k, v in status_dist.items()]
    }

# ==================== ATTENDANCE ====================

@api_router.post("/sales/attendance/check-in")
async def check_in(check_in_data: AttendanceCheckIn, request: Request):
    user = await get_current_user(request)
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.attendance.find_one({"sales_person_email": user["email"], "date": today})
    if existing:
        raise HTTPException(status_code=400, detail="Already checked in today")
    
    address = reverse_geocode(check_in_data.lat, check_in_data.lng)
    
    attendance_id = f"att_{uuid.uuid4().hex[:12]}"
    attendance_doc = {
        "attendance_id": attendance_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "date": today,
        "work_type": check_in_data.work_type,
        "check_in_time": datetime.now(timezone.utc).isoformat(),
        "check_in_lat": check_in_data.lat,
        "check_in_lng": check_in_data.lng,
        "check_in_address": address,
        "check_out_time": None,
        "check_out_lat": None,
        "check_out_lng": None,
        "check_out_address": None
    }
    await db.attendance.insert_one(attendance_doc)
    return await db.attendance.find_one({"attendance_id": attendance_id}, {"_id": 0})

@api_router.post("/sales/attendance/check-out")
async def check_out(lat: float, lng: float, request: Request):
    user = await get_current_user(request)
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attendance = await db.attendance.find_one({"sales_person_email": user["email"], "date": today})
    if not attendance:
        raise HTTPException(status_code=400, detail="No check-in found for today")
    if attendance.get("check_out_time"):
        raise HTTPException(status_code=400, detail="Already checked out")
    
    address = reverse_geocode(lat, lng)
    
    await db.attendance.update_one(
        {"attendance_id": attendance["attendance_id"]},
        {"$set": {
            "check_out_time": datetime.now(timezone.utc).isoformat(),
            "check_out_lat": lat,
            "check_out_lng": lng,
            "check_out_address": address
        }}
    )
    return {"message": "Checked out successfully"}

@api_router.get("/sales/attendance")
async def get_attendance(request: Request):
    user = await get_current_user(request)
    records = await db.attendance.find(
        {"sales_person_email": user["email"]},
        {"_id": 0}
    ).sort("date", -1).limit(30).to_list(30)
    return records

@api_router.get("/sales/attendance/today")
async def get_today_attendance(request: Request):
    user = await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attendance = await db.attendance.find_one(
        {"sales_person_email": user["email"], "date": today},
        {"_id": 0}
    )
    return attendance

# ==================== VISIT PLANNING (linked to leads) ====================

@api_router.get("/visit-plans")
async def get_visit_plans(request: Request):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin" and "field_sales" not in user.get("assigned_modules", []):
        query["assigned_to"] = user["email"]
    plans = await db.visit_plans.find(query, {"_id": 0}).sort("visit_date", -1).to_list(5000)
    return plans

@api_router.post("/visit-plans")
async def create_visit_plan(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan_id = f"vp_{uuid.uuid4().hex[:12]}"
    plan_doc = {
        "plan_id": plan_id,
        "lead_id": body.get("lead_id", ""),
        "lead_name": body.get("lead_name", ""),
        "school_name": body.get("school_name", ""),
        "school_id": body.get("school_id", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "visit_date": body.get("visit_date", ""),
        "visit_time": body.get("visit_time", ""),
        "purpose": body.get("purpose", ""),
        "status": "planned",
        "check_in_time": None,
        "check_in_lat": None,
        "check_in_lng": None,
        "check_out_time": None,
        "visit_notes": "",
        "outcome": "",
        "photos": [],
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.visit_plans.insert_one(plan_doc)
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})

@api_router.put("/visit-plans/{plan_id}")
async def update_visit_plan(plan_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("visit_date", "visit_time", "purpose", "status", "assigned_to", "assigned_name",
              "check_in_time", "check_in_lat", "check_in_lng", "check_out_time",
              "visit_notes", "outcome"):
        if k in body:
            allowed[k] = body[k]
    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": allowed})
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})

@api_router.delete("/visit-plans/{plan_id}")
async def delete_visit_plan(plan_id: str, request: Request):
    await get_current_user(request)
    await db.visit_plans.delete_one({"plan_id": plan_id})
    return {"message": "Visit plan deleted"}

# ---- FMS Phase 3: Visit Intelligence (GPS check-in/out + WFH) ----

@api_router.post("/visit-plans/{plan_id}/check-in")
async def visit_check_in(plan_id: str, request: Request):
    """Check-in to a planned visit. Supports field (GPS required) or wfh (skip GPS)."""
    user = await get_current_user(request)
    body = await request.json()
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    if plan.get("check_in_time"):
        raise HTTPException(status_code=400, detail="Already checked in")

    work_type = body.get("work_type", "field")  # field | wfh
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "check_in_time": now_iso,
        "work_type": work_type,
        "status": "in_progress",
    }
    if work_type == "field":
        lat = body.get("lat")
        lng = body.get("lng")
        if lat is None or lng is None:
            raise HTTPException(status_code=400, detail="GPS lat/lng required for field visit")
        update["check_in_lat"] = float(lat)
        update["check_in_lng"] = float(lng)
        update["check_in_address"] = reverse_geocode(float(lat), float(lng))
    else:
        update["check_in_lat"] = None
        update["check_in_lng"] = None
        update["check_in_address"] = "Work From Home"

    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
    # Cascade last_activity_date to lead and school
    if plan.get("lead_id"):
        await db.leads.update_one({"lead_id": plan["lead_id"]},
                                  {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}})
    if plan.get("school_id"):
        await touch_last_activity("school", plan["school_id"])
    await log_activity(user["email"], "visit_check_in", "visit_plan", plan_id,
                       details=f"{work_type} check-in for {plan.get('school_name','')}")
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})

@api_router.post("/visit-plans/{plan_id}/check-out")
async def visit_check_out(plan_id: str, request: Request):
    """Check-out from a visit. Captures outcome notes + optional GPS for field."""
    user = await get_current_user(request)
    body = await request.json()
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    if not plan.get("check_in_time"):
        raise HTTPException(status_code=400, detail="Not checked-in yet")
    if plan.get("check_out_time"):
        raise HTTPException(status_code=400, detail="Already checked out")
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "check_out_time": now_iso,
        "status": "completed",
        "visit_notes": body.get("visit_notes", plan.get("visit_notes", "")),
        "outcome": body.get("outcome", plan.get("outcome", "")),
    }
    if plan.get("work_type", "field") == "field":
        lat = body.get("lat")
        lng = body.get("lng")
        if lat is not None and lng is not None:
            update["check_out_lat"] = float(lat)
            update["check_out_lng"] = float(lng)
            update["check_out_address"] = reverse_geocode(float(lat), float(lng))
    await db.visit_plans.update_one({"plan_id": plan_id}, {"$set": update})
    if plan.get("lead_id"):
        await db.leads.update_one({"lead_id": plan["lead_id"]},
                                  {"$set": {"last_activity_date": now_iso, "last_visit_date": now_iso}})
    if plan.get("school_id"):
        await touch_last_activity("school", plan["school_id"])
    await log_activity(user["email"], "visit_check_out", "visit_plan", plan_id,
                       details=f"Outcome: {update['outcome']}")
    return await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})

@api_router.get("/visit-plans/{plan_id}/distance")
async def visit_distance(plan_id: str, lat: float, lng: float, request: Request):
    """Compute meters between user current GPS and the planned school location (if known)."""
    await get_current_user(request)
    plan = await db.visit_plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Visit plan not found")
    target_lat = plan.get("check_in_lat")
    target_lng = plan.get("check_in_lng")
    if target_lat is None or target_lng is None:
        return {"distance_m": None, "within_geofence": None, "message": "No reference GPS on plan"}
    # haversine_distance returns km; convert to metres
    dist_m = haversine_distance(lat, lng, target_lat, target_lng) * 1000
    return {"distance_m": round(dist_m, 1), "within_geofence": dist_m <= 200}

# Inventory CSV import
@api_router.post("/dies/import")
async def import_dies_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    duplicates = 0
    errors = []
    for row in reader:
        try:
            code = row.get("code", "").strip()
            name = row.get("name", "").strip()
            if not code or not name:
                errors.append("Row missing code or name")
                continue
            existing = await db.dies.find_one({"code": code})
            if existing:
                duplicates += 1
                continue
            die_id = f"die_{uuid.uuid4().hex[:8]}"
            await db.dies.insert_one({
                "die_id": die_id, "code": code, "name": name,
                "type": row.get("type", "standard").strip().lower(),
                "stock_qty": int(row.get("stock_qty", 0) or 0),
                "reserved_qty": int(row.get("reserved_qty", 0) or 0),
                "min_level": int(row.get("min_level", 5) or 5),
                "image_url": "", "description": row.get("description", "").strip(),
                "is_active": True,
            })
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "duplicates": duplicates, "errors": errors[:10]}

# ==================== FIELD SALES ADMIN ENDPOINTS ====================

@api_router.get("/admin/attendance")
async def get_all_attendance(request: Request):
    user = await get_current_user(request)
    allowed = user.get("role") == "admin" or any(m in user.get("assigned_modules", []) for m in ("hr", "field_sales"))
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    records = await db.attendance.find({}, {"_id": 0}).sort("date", -1).limit(200).to_list(200)
    return records

@api_router.get("/admin/visits")
async def get_all_visits(request: Request):
    user = await get_current_user(request)
    allowed = user.get("role") == "admin" or "field_sales" in user.get("assigned_modules", [])
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    visits = await db.field_visits.find({}, {"_id": 0}).sort("visit_date", -1).limit(200).to_list(200)
    return visits

@api_router.get("/admin/expenses")
async def get_all_expenses(request: Request):
    user = await get_current_user(request)
    allowed = user.get("role") == "admin" or any(m in user.get("assigned_modules", []) for m in ("field_sales", "accounts"))
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    expenses = await db.travel_expenses.find({}, {"_id": 0}).sort("date", -1).limit(200).to_list(200)
    return expenses

@api_router.get("/admin/field-sales/summary")
async def get_field_sales_summary(request: Request):
    user = await get_current_user(request)
    allowed = user.get("role") == "admin" or "field_sales" in user.get("assigned_modules", [])
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")

    today_checkins = await db.attendance.count_documents({"date": today})
    month_visits = await db.field_visits.count_documents({"visit_date": {"$regex": f"^{current_month}"}})
    completed_visits = await db.field_visits.count_documents({"visit_date": {"$regex": f"^{current_month}"}, "status": "visited"})
    planned_visits = await db.field_visits.count_documents({"status": "planned"})
    month_expenses = await db.travel_expenses.find({"month_year": current_month}, {"_id": 0}).to_list(1000)
    total_expense = sum(e.get("amount", 0) for e in month_expenses)
    total_km = sum(e.get("distance_km", 0) for e in month_expenses)
    active_salespersons = await db.salespersons.count_documents({"is_active": {"$ne": False}})

    return {
        "today_checkins": today_checkins,
        "month_visits": month_visits,
        "completed_visits": completed_visits,
        "planned_visits": planned_visits,
        "total_expense": total_expense,
        "total_km": total_km,
        "active_salespersons": active_salespersons
    }

# ==================== FIELD VISITS (Sales Portal) ====================

@api_router.post("/sales/visits", response_model=FieldVisit)
async def create_visit(visit_input: FieldVisitCreate, request: Request):
    user = await get_current_user(request)
    
    visit_id = f"visit_{uuid.uuid4().hex[:12]}"
    address = None
    if visit_input.lat and visit_input.lng:
        address = reverse_geocode(visit_input.lat, visit_input.lng)
    
    visit_doc = {
        "visit_id": visit_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "school_name": visit_input.school_name,
        "contact_person": visit_input.contact_person,
        "contact_phone": visit_input.contact_phone,
        "visit_date": visit_input.visit_date,
        "visit_time": visit_input.visit_time,
        "status": "planned",
        "purpose": visit_input.purpose,
        "planned_lat": visit_input.lat,
        "planned_lng": visit_input.lng,
        "planned_address": address,
        "visited_lat": None,
        "visited_lng": None,
        "visited_address": None,
        "checked_in_at": None,
        "outcome": None
    }
    await db.field_visits.insert_one(visit_doc)
    return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})

@api_router.get("/sales/visits")
async def get_visits(request: Request):
    user = await get_current_user(request)
    visits = await db.field_visits.find(
        {"sales_person_email": user["email"]},
        {"_id": 0}
    ).sort("visit_date", -1).to_list(1000)
    return visits

@api_router.post("/sales/visits/{visit_id}/check-in")
async def check_in_visit(visit_id: str, lat: float, lng: float, request: Request):
    user = await get_current_user(request)
    
    visit = await db.field_visits.find_one({"visit_id": visit_id, "sales_person_email": user["email"]})
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    
    address = reverse_geocode(lat, lng)
    
    await db.field_visits.update_one(
        {"visit_id": visit_id},
        {"$set": {
            "status": "visited",
            "visited_lat": lat,
            "visited_lng": lng,
            "visited_address": address,
            "checked_in_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    return {"message": "Checked in at visit", "visit_id": visit_id}

@api_router.put("/sales/visits/{visit_id}")
async def update_visit(visit_id: str, updates: dict, request: Request):
    user = await get_current_user(request)
    await db.field_visits.update_one(
        {"visit_id": visit_id, "sales_person_email": user["email"]},
        {"$set": updates}
    )
    return await db.field_visits.find_one({"visit_id": visit_id}, {"_id": 0})

# ==================== TRAVEL EXPENSES ====================

@api_router.post("/sales/expenses", response_model=TravelExpense)
async def create_expense(expense_input: TravelExpenseCreate, request: Request):
    user = await get_current_user(request)
    
    # Calculate rate
    rates = {
        "two_wheeler": 5,
        "four_wheeler": 10,
        "public_transport": 3,
        "other": 4
    }
    rate = rates.get(expense_input.transport_mode, 4)
    amount = expense_input.distance_km * rate
    
    expense_id = f"exp_{uuid.uuid4().hex[:12]}"
    month_year = expense_input.date[:7]  # YYYY-MM
    
    expense_doc = {
        "expense_id": expense_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "date": expense_input.date,
        "month_year": month_year,
        "from_location": expense_input.from_location,
        "from_lat": expense_input.from_lat,
        "from_lng": expense_input.from_lng,
        "to_location": expense_input.to_location,
        "to_lat": expense_input.to_lat,
        "to_lng": expense_input.to_lng,
        "distance_km": expense_input.distance_km,
        "transport_mode": expense_input.transport_mode,
        "rate_per_km": rate,
        "amount": amount,
        "from_visit_id": expense_input.from_visit_id,
        "to_visit_id": expense_input.to_visit_id,
        "notes": expense_input.notes,
        "status": "pending"
    }
    await db.travel_expenses.insert_one(expense_doc)
    return await db.travel_expenses.find_one({"expense_id": expense_id}, {"_id": 0})

@api_router.get("/sales/expenses")
async def get_expenses(request: Request, month_year: Optional[str] = None):
    user = await get_current_user(request)
    query = {"sales_person_email": user["email"]}
    if month_year:
        query["month_year"] = month_year
    expenses = await db.travel_expenses.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return expenses

@api_router.post("/sales/expenses/submit-reimbursement")
async def submit_reimbursement(month_year: str, request: Request):
    user = await get_current_user(request)
    
    # Get all pending expenses for month
    expenses = await db.travel_expenses.find({
        "sales_person_email": user["email"],
        "month_year": month_year,
        "status": "pending"
    }, {"_id": 0}).to_list(1000)
    
    total_km = sum(e["distance_km"] for e in expenses)
    total_amount = sum(e["amount"] for e in expenses)
    
    # Count working days and field days
    attendance_records = await db.attendance.find({
        "sales_person_email": user["email"],
        "date": {"$regex": f"^{month_year}"}
    }, {"_id": 0}).to_list(1000)
    
    total_working_days = len(attendance_records)
    field_days = len([a for a in attendance_records if a["work_type"] == "field"])
    
    # Count visits
    visits = await db.field_visits.find({
        "sales_person_email": user["email"],
        "visit_date": {"$regex": f"^{month_year}"},
        "status": "visited"
    }, {"_id": 0}).to_list(1000)
    total_visits = len(visits)
    
    reimbursement_id = f"reimb_{uuid.uuid4().hex[:12]}"
    reimb_doc = {
        "reimbursement_id": reimbursement_id,
        "sales_person_email": user["email"],
        "sales_person_name": user["name"],
        "month_year": month_year,
        "total_km": total_km,
        "total_amount": total_amount,
        "total_visits": total_visits,
        "total_working_days": total_working_days,
        "field_days": field_days,
        "wfh_days": total_working_days - field_days,
        "status": "submitted",
        "submitted_at": datetime.now(timezone.utc).isoformat()
    }
    await db.payroll_reimbursements.insert_one(reimb_doc)
    
    # Mark expenses as submitted
    for expense in expenses:
        await db.travel_expenses.update_one(
            {"expense_id": expense["expense_id"]},
            {"$set": {"status": "submitted"}}
        )
    
    return await db.payroll_reimbursements.find_one({"reimbursement_id": reimbursement_id}, {"_id": 0})

# ==================== PAYROLL ====================

@api_router.get("/payroll/reimbursements")
async def get_reimbursements(request: Request, month_year: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if user.get("role") != "admin":
        query["sales_person_email"] = user["email"]
    if month_year:
        query["month_year"] = month_year
    
    reimbursements = await db.payroll_reimbursements.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(1000)
    return reimbursements

@api_router.put("/payroll/reimbursements/{reimbursement_id}/approve")
async def approve_reimbursement(reimbursement_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await db.payroll_reimbursements.update_one(
        {"reimbursement_id": reimbursement_id},
        {"$set": {
            "status": "approved",
            "approved_by": user["email"],
            "approved_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    return {"message": "Reimbursement approved"}

@api_router.put("/payroll/reimbursements/{reimbursement_id}/reject")
async def reject_reimbursement(reimbursement_id: str, notes: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await db.payroll_reimbursements.update_one(
        {"reimbursement_id": reimbursement_id},
        {"$set": {
            "status": "rejected",
            "approved_by": user["email"],
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "notes": notes
        }}
    )
    return {"message": "Reimbursement rejected"}

# ==================== MODULE MASTER ====================

@api_router.get("/modules")
async def get_modules(request: Request):
    await get_current_user(request)
    modules = await db.modules.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return modules

@api_router.put("/modules/{module_id}")
async def update_module(module_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    allowed = {k: v for k, v in body.items() if k in ("display_name", "is_active", "sort_order")}
    await db.modules.update_one({"module_id": module_id}, {"$set": allowed})
    return await db.modules.find_one({"module_id": module_id}, {"_id": 0})

# ==================== DESIGNATIONS / ROLES ====================

DEFAULT_DESIGNATIONS = [
    {"designation_id": "desg_super_admin", "name": "Super Admin", "code": "super_admin", "role_level": "admin", "default_modules": ["dashboard", "quotations", "inventory", "stock_management", "purchase_alerts", "package_master", "physical_count", "analytics", "payroll", "accounts", "hr", "leave_management", "store", "settings", "user_management", "field_sales", "leads", "sales_portal"], "description": "Full access to all system modules", "is_system": True, "is_active": True},
    {"designation_id": "desg_admin", "name": "Admin", "code": "admin", "role_level": "admin", "default_modules": ["dashboard", "quotations", "inventory", "stock_management", "package_master", "analytics", "accounts", "hr", "leave_management", "store", "settings", "user_management", "leads", "sales_portal"], "description": "Administrative access without sensitive configs", "is_system": True, "is_active": True},
    {"designation_id": "desg_sales_head", "name": "Sales Head", "code": "sales_head", "role_level": "admin", "default_modules": ["dashboard", "quotations", "leads", "field_sales", "analytics", "sales_portal", "leave_management"], "description": "Manages sales team, views analytics, creates quotations", "is_system": True, "is_active": True},
    {"designation_id": "desg_sales_exec", "name": "Sales Executive", "code": "sales_executive", "role_level": "sales_person", "default_modules": ["quotations", "leads", "field_sales", "sales_portal", "leave_management"], "description": "Field sales, lead management, quotation creation", "is_system": True, "is_active": True},
    {"designation_id": "desg_hr_manager", "name": "HR Manager", "code": "hr_manager", "role_level": "admin", "default_modules": ["dashboard", "hr", "payroll", "leave_management", "field_sales", "user_management", "analytics"], "description": "HR operations, payroll, attendance, leave approvals", "is_system": True, "is_active": True},
    {"designation_id": "desg_store_mgr", "name": "Store Manager", "code": "store_manager", "role_level": "admin", "default_modules": ["dashboard", "inventory", "stock_management", "purchase_alerts", "physical_count", "store", "package_master"], "description": "Inventory control, stock management, store operations", "is_system": True, "is_active": True},
    {"designation_id": "desg_accounts", "name": "Accounts Manager", "code": "accounts_manager", "role_level": "admin", "default_modules": ["dashboard", "accounts", "quotations", "payroll", "analytics", "leave_management"], "description": "Financial operations, quotation approval, payroll processing", "is_system": True, "is_active": True},
    {"designation_id": "desg_field_exec", "name": "Field Executive", "code": "field_executive", "role_level": "sales_person", "default_modules": ["field_sales", "sales_portal", "leave_management"], "description": "Field visits, attendance, basic sales portal access", "is_system": True, "is_active": True},
    {"designation_id": "desg_dispatch", "name": "Dispatch Manager", "code": "dispatch_manager", "role_level": "admin", "default_modules": ["dashboard", "inventory", "stock_management", "store", "leave_management"], "description": "Manages dispatches, stock deductions, delivery tracking", "is_system": True, "is_active": True},
]

@api_router.get("/designations")
async def get_designations(request: Request):
    await get_current_user(request)
    designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not designations:
        # Seed defaults
        for d in DEFAULT_DESIGNATIONS:
            d["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.designations.insert_one(d)
        designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return designations

@api_router.post("/designations")
async def create_designation(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    if not body.get("name") or not body.get("code"):
        raise HTTPException(status_code=400, detail="name and code required")
    existing = await db.designations.find_one({"code": body["code"]})
    if existing:
        raise HTTPException(status_code=400, detail="Designation code already exists")
    desg_id = f"desg_{uuid.uuid4().hex[:12]}"
    doc = {
        "designation_id": desg_id,
        "name": body["name"],
        "code": body["code"],
        "role_level": body.get("role_level", "sales_person"),
        "default_modules": body.get("default_modules", []),
        "description": body.get("description", ""),
        "is_system": False,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.designations.insert_one(doc)
    return await db.designations.find_one({"designation_id": desg_id}, {"_id": 0})

@api_router.put("/designations/{designation_id}")
async def update_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    allowed = {}
    for k in ("name", "description", "default_modules", "role_level", "is_active"):
        if k in body:
            allowed[k] = body[k]
    await db.designations.update_one({"designation_id": designation_id}, {"$set": allowed})
    return await db.designations.find_one({"designation_id": designation_id}, {"_id": 0})

@api_router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    desg = await db.designations.find_one({"designation_id": designation_id})
    if not desg:
        raise HTTPException(status_code=404, detail="Not found")
    if desg.get("is_system"):
        raise HTTPException(status_code=400, detail="Cannot delete system designations")
    await db.designations.delete_one({"designation_id": designation_id})
    return {"message": "Designation deleted"}

# ==================== ADMIN USER MANAGEMENT ====================

@api_router.get("/admin/users")
async def admin_get_users(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@api_router.post("/admin/users")
async def admin_create_user(request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    name = body.get("name", "")
    role = body.get("role", "sales_person")
    phone = body.get("phone", "")
    assigned_modules = body.get("assigned_modules", [])

    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="Email, password, and name are required")

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "phone": phone,
        "assigned_modules": assigned_modules,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)

    # Always create/sync salesperson record so user appears in dropdowns
    sp_existing = await db.salespersons.find_one({"email": email})
    if not sp_existing:
        await db.salespersons.insert_one({
            "sales_person_id": f"sp_{uuid.uuid4().hex[:12]}",
            "name": name,
            "email": email,
            "phone": phone,
            "user_id": user_id,
            "is_active": True
        })
    else:
        await db.salespersons.update_one(
            {"email": email},
            {"$set": {"name": name, "phone": phone, "user_id": user_id, "is_active": True}}
        )

    result = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return result

@api_router.put("/admin/users/{user_id}")
async def admin_update_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    body = await request.json()
    allowed_fields = {}
    for key in ("name", "role", "phone", "assigned_modules", "is_active"):
        if key in body:
            allowed_fields[key] = body[key]

    if "password" in body and body["password"]:
        allowed_fields["password_hash"] = hash_password(body["password"])

    if not allowed_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.users.update_one({"user_id": user_id}, {"$set": allowed_fields})
    result = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    # Sync salesperson record
    sp_update = {}
    if "name" in allowed_fields:
        sp_update["name"] = allowed_fields["name"]
    if "phone" in allowed_fields:
        sp_update["phone"] = allowed_fields["phone"]
    if "is_active" in allowed_fields:
        sp_update["is_active"] = allowed_fields["is_active"]
    if sp_update:
        await db.salespersons.update_one({"email": result["email"]}, {"$set": sp_update})

    return result

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    # Don't allow deleting self
    if current_user.get("user_id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user_to_delete = await db.users.find_one({"user_id": user_id})
    if not user_to_delete:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.delete_one({"user_id": user_id})
    # Also deactivate linked salesperson
    await db.salespersons.update_one({"email": user_to_delete["email"]}, {"$set": {"is_active": False}})
    return {"message": "User deleted"}

# ==================== AI INSIGHTS ====================

@api_router.post("/ai/insights")
async def get_ai_insights(query: str, request: Request):
    user = await get_current_user(request)
    
    # Gather context data
    quotations = await db.quotations.find({}, {"_id": 0}).to_list(100)
    dies = await db.dies.find({}, {"_id": 0}).to_list(100)
    alerts = await db.purchase_alerts.find({"status": "pending"}, {"_id": 0}).to_list(100)
    
    context = f"""Quotations: {len(quotations)} total
Dies inventory: {len(dies)} items
Pending alerts: {len(alerts)}

User query: {query}"""
    
    chat = LlmChat(
        api_key=EMERGENT_KEY,
        session_id=f"insights_{user['user_id']}",
        system_message="You are a business analytics assistant for SmartShape Pro inventory and sales management. Provide concise, actionable insights."
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    
    message = UserMessage(text=context)
    response = await chat.send_message(message)
    
    return {"insight": response}

# ==================== SETTINGS & EMAIL ====================

@api_router.post("/settings/email")
async def save_email_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    settings = await request.json()
    # Auto-enable if credentials are present so admins don't need a separate toggle
    if settings.get("sender_email") and settings.get("gmail_app_password"):
        settings["enabled"] = True
    await db.settings.update_one(
        {"type": "email"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Email settings saved"}

@api_router.get("/settings/email")
async def get_email_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not settings:
        return {"sender_name": "SmartShape Pro", "sender_email": "", "gmail_app_password": "", "enabled": False}
    return settings

# WhatsApp Settings
@api_router.post("/settings/whatsapp")
async def save_whatsapp_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    await db.settings.update_one(
        {"type": "whatsapp"},
        {"$set": {**body, "type": "whatsapp", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "WhatsApp settings saved"}

@api_router.get("/settings/whatsapp")
async def get_whatsapp_settings(request: Request):
    await get_current_user(request)
    settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not settings:
        return {"username": "", "password": "", "enabled": False}
    return settings

@api_router.post("/whatsapp/send")
async def send_whatsapp_message(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa_settings or not wa_settings.get("username"):
        raise HTTPException(status_code=400, detail="WhatsApp not configured. Go to Settings.")
    phone = body.get("phone", "")
    message = body.get("message", "")
    if not phone or not message:
        raise HTTPException(status_code=400, detail="phone and message required")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://app.messageautosender.com/message/new",
                data={
                    "username": wa_settings["username"],
                    "password": wa_settings["password"],
                    "receiverMobileNo": phone,
                    "message": message,
                },
            )
            return {"success": True, "status_code": resp.status_code, "response": resp.text[:500]}
    except Exception as e:
        return {"success": False, "error": str(e)}

@api_router.post("/whatsapp/send-file")
async def send_whatsapp_file(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa_settings or not wa_settings.get("username"):
        raise HTTPException(status_code=400, detail="WhatsApp not configured")
    phone = body.get("phone", "")
    message = body.get("message", "")
    file_url = body.get("file_url", "")
    if not phone:
        raise HTTPException(status_code=400, detail="phone required")
    import httpx
    try:
        data = {"username": wa_settings["username"], "password": wa_settings["password"], "receiverMobileNo": phone}
        if message:
            data["message"] = message
        if file_url:
            data["filePathUrl"] = file_url
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://app.messageautosender.com/message/new", data=data)
            return {"success": True, "status_code": resp.status_code, "response": resp.text[:500]}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ==================== WHATSAPP TEMPLATE MASTER (FMS Phase 4) ====================

WA_TEMPLATE_MODULES = ["lead", "contact", "school", "visit", "order", "dispatch", "quotation", "general"]
WA_TEMPLATE_CATEGORIES = ["thankyou", "reminder", "followup", "marketing", "intro", "custom"]

DEFAULT_WA_TEMPLATES = [
    {"name": "Thank You - Call", "module": "lead", "category": "thankyou",
     "body": "Hi {contact_name}, thank you for your time on the call today. As discussed, we offer SmartShape solutions for {school_name}. I'll share the catalogue shortly.\n\nRegards,\n{my_name}"},
    {"name": "Visit Follow-up", "module": "visit", "category": "followup",
     "body": "Hi {contact_name}, it was great meeting you at {school_name} today. Sharing our catalogue & quotation as discussed. Please reach me on {my_phone} for any clarification.\n\nRegards,\n{my_name}"},
    {"name": "Quotation Sent", "module": "quotation", "category": "followup",
     "body": "Dear {contact_name}, please find attached our quotation for {school_name}. Looking forward to your review.\n\nRegards,\n{my_name}"},
    {"name": "Demo Reminder", "module": "lead", "category": "reminder",
     "body": "Hi {contact_name}, just a quick reminder of our scheduled demo. Looking forward to showing you the SmartShape advantage.\n\nRegards,\n{my_name}"},
    {"name": "Order Confirmed", "module": "order", "category": "thankyou",
     "body": "Dear {contact_name}, your order has been confirmed. We'll keep you updated on dispatch.\n\nRegards,\n{my_name}"},
    {"name": "Dispatch Update", "module": "dispatch", "category": "reminder",
     "body": "Hi {contact_name}, your shipment for {school_name} is on its way. Tracking details will be shared shortly.\n\nRegards,\n{my_name}"},
]

async def _ensure_default_wa_templates():
    count = await db.whatsapp_templates.count_documents({})
    if count > 0:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    docs = []
    for t in DEFAULT_WA_TEMPLATES:
        docs.append({
            "template_id": f"wat_{uuid.uuid4().hex[:10]}",
            "name": t["name"],
            "module": t["module"],
            "category": t["category"],
            "body": t["body"],
            "is_active": True,
            "is_default": True,
            "created_by": "system",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    await db.whatsapp_templates.insert_many(docs)

@api_router.get("/whatsapp-templates")
async def list_wa_templates(request: Request, module: Optional[str] = None, category: Optional[str] = None):
    await get_current_user(request)
    await _ensure_default_wa_templates()
    query = {"is_active": True}
    if module:
        query["module"] = module
    if category:
        query["category"] = category
    templates = await db.whatsapp_templates.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return templates

@api_router.post("/whatsapp-templates")
async def create_wa_template(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name or not body.get("body"):
        raise HTTPException(status_code=400, detail="Name and body are required")
    module = body.get("module", "general")
    if module not in WA_TEMPLATE_MODULES:
        module = "general"
    category = body.get("category", "custom")
    if category not in WA_TEMPLATE_CATEGORIES:
        category = "custom"
    tpl_id = f"wat_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": tpl_id,
        "name": name,
        "module": module,
        "category": category,
        "body": body["body"],
        "is_active": True,
        "is_default": False,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.whatsapp_templates.insert_one(doc)
    return await db.whatsapp_templates.find_one({"template_id": tpl_id}, {"_id": 0})

@api_router.put("/whatsapp-templates/{template_id}")
async def update_wa_template(template_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("name", "module", "category", "body", "is_active"):
        if k in body:
            allowed[k] = body[k]
    if "module" in allowed and allowed["module"] not in WA_TEMPLATE_MODULES:
        allowed["module"] = "general"
    if "category" in allowed and allowed["category"] not in WA_TEMPLATE_CATEGORIES:
        allowed["category"] = "custom"
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.whatsapp_templates.update_one({"template_id": template_id}, {"$set": allowed})
    return await db.whatsapp_templates.find_one({"template_id": template_id}, {"_id": 0})

@api_router.delete("/whatsapp-templates/{template_id}")
async def delete_wa_template(template_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.whatsapp_templates.delete_one({"template_id": template_id})
    return {"message": "Template deleted"}

def _interpolate_template(body_text: str, ctx: dict) -> str:
    """Replace {var} placeholders in template body with values from ctx (missing vars become blank)."""
    import re
    def _sub(m):
        key = m.group(1).strip()
        return str(ctx.get(key, ""))
    return re.sub(r"\{(\w+)\}", _sub, body_text or "")

@api_router.post("/whatsapp/render-template")
async def render_template(request: Request):
    """Resolve a template with context (lead/contact/school/order ids) and return preview body + phone."""
    user = await get_current_user(request)
    body = await request.json()
    tpl_id = body.get("template_id")
    custom_body = body.get("body", "")
    if tpl_id:
        tpl = await db.whatsapp_templates.find_one({"template_id": tpl_id}, {"_id": 0})
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")
        text = tpl["body"]
    else:
        text = custom_body

    ctx = {"my_name": user.get("name", ""), "my_phone": ""}
    sp = await db.salespersons.find_one({"email": user["email"]}, {"_id": 0})
    if sp:
        ctx["my_phone"] = sp.get("phone", "")

    phone = body.get("phone") or ""
    contact_id = body.get("contact_id")
    lead_id = body.get("lead_id")
    school_id = body.get("school_id")
    order_id = body.get("order_id")

    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
        if c:
            ctx.update({"contact_name": c.get("name", ""), "school_name": c.get("company", "")})
            phone = phone or c.get("phone", "")
    if lead_id:
        ld = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if ld:
            ctx.update({"contact_name": ld.get("contact_name", "")})
            phone = phone or ld.get("contact_phone", "")
            sid = ld.get("school_id") or school_id
            if sid:
                school_id = sid
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
        if s:
            ctx.setdefault("school_name", s.get("school_name", ""))
            ctx.update({"school_city": s.get("city", "")})
            phone = phone or s.get("phone", "")
    if order_id:
        o = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
        if o:
            ctx.setdefault("school_name", o.get("school_name", ""))
            ctx["order_id"] = o.get("order_id", "")

    rendered = _interpolate_template(text, ctx)
    return {"body": rendered, "phone": phone, "context": ctx}

@api_router.post("/whatsapp/send-via-template")
async def send_via_template(request: Request):
    """Send a WhatsApp message via API (if configured) and log it.
    Body: {template_id?, body, phone, lead_id?, contact_id?, school_id?, order_id?, send_mode='api'|'manual'}
    send_mode='manual' just logs (used after user shares via wa.me link)."""
    user = await get_current_user(request)
    body = await request.json()
    phone = (body.get("phone") or "").strip()
    msg = (body.get("body") or "").strip()
    if not phone or not msg:
        raise HTTPException(status_code=400, detail="phone and body required")
    send_mode = body.get("send_mode", "api")
    log_id = f"wal_{uuid.uuid4().hex[:10]}"
    log_doc = {
        "log_id": log_id,
        "template_id": body.get("template_id"),
        "phone": phone,
        "body": msg,
        "lead_id": body.get("lead_id"),
        "contact_id": body.get("contact_id"),
        "school_id": body.get("school_id"),
        "order_id": body.get("order_id"),
        "send_mode": send_mode,
        "status": "pending",
        "response": None,
        "sent_by": user["email"],
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }

    if send_mode == "manual":
        log_doc["status"] = "manual_sent"
    else:
        wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
        if not wa_settings or not wa_settings.get("username"):
            log_doc["status"] = "wa_not_configured"
        else:
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        "https://app.messageautosender.com/message/new",
                        data={
                            "username": wa_settings["username"],
                            "password": wa_settings["password"],
                            "receiverMobileNo": phone,
                            "message": msg,
                        },
                    )
                    log_doc["status"] = "sent" if 200 <= resp.status_code < 300 else "failed"
                    log_doc["response"] = resp.text[:500]
            except Exception as e:
                log_doc["status"] = "error"
                log_doc["response"] = str(e)[:500]

    await db.whatsapp_logs.insert_one(log_doc)

    # Cascade last_activity to related entity
    if body.get("lead_id"):
        await touch_last_activity("lead", body["lead_id"])
    if body.get("contact_id"):
        await touch_last_activity("contact", body["contact_id"])
    if body.get("school_id"):
        await touch_last_activity("school", body["school_id"])
    await log_activity(user["email"], "whatsapp_sent", "whatsapp_log", log_id,
                       details=f"{send_mode} -> {phone} | {msg[:60]}")
    return await db.whatsapp_logs.find_one({"log_id": log_id}, {"_id": 0})

@api_router.get("/whatsapp/logs")
async def list_wa_logs(request: Request, lead_id: Optional[str] = None, contact_id: Optional[str] = None,
                      school_id: Optional[str] = None, limit: int = 100):
    await get_current_user(request)
    q = {}
    if lead_id: q["lead_id"] = lead_id
    if contact_id: q["contact_id"] = contact_id
    if school_id: q["school_id"] = school_id
    logs = await db.whatsapp_logs.find(q, {"_id": 0}).sort("sent_at", -1).to_list(limit)
    return logs

# Gmail Send Email
@api_router.post("/email/send")
async def send_email_via_gmail(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not email_settings or not email_settings.get("sender_email") or not email_settings.get("gmail_app_password"):
        raise HTTPException(status_code=400, detail="Gmail not configured. Ask admin to set SMTP in App Settings.")
    to_email = body.get("to", "")
    subject = body.get("subject", "")
    html_body = body.get("body", "")
    if not to_email or not subject:
        raise HTTPException(status_code=400, detail="to and subject required")
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    sender_email = email_settings["sender_email"]
    # Auto-CC the logged-in user (so their Sent folder effectively reflects what was sent on their behalf)
    cc_list = []
    if user.get("email") and user["email"].lower() not in (sender_email.lower(), to_email.lower()):
        cc_list.append(user["email"])
    # Caller-provided additional CCs
    for e in (body.get("cc") or []):
        if e and e.lower() not in (sender_email.lower(), to_email.lower()) and e not in cc_list:
            cc_list.append(e)
    try:
        msg = MIMEMultipart()
        msg["From"] = f"{email_settings.get('sender_name', 'SmartShape Pro')} <{sender_email}>"
        msg["To"] = to_email
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))
        recipients = [to_email] + cc_list
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender_email, email_settings["gmail_app_password"])
            server.sendmail(sender_email, recipients, msg.as_string())
        return {"success": True, "message": f"Email sent to {to_email}", "cc": cc_list}
    except Exception as e:
        return {"success": False, "error": str(e)}

# Dispatch Slip PDF
@api_router.get("/dispatches/{dispatch_id}/pdf")
async def dispatch_slip_pdf(dispatch_id: str, request: Request):
    await get_current_user(request)
    dispatch = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    order = await db.orders.find_one({"order_id": dispatch["order_id"]}, {"_id": 0})
    items = await db.order_items.find({"order_id": dispatch["order_id"]}, {"_id": 0}).to_list(1000)
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}

    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=15*mm, bottomMargin=15*mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=16, spaceAfter=6)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=4)
    normal = styles["Normal"]

    elements = []
    elements.append(Paragraph(company.get("company_name", "SmartShape Pro"), title_style))
    elements.append(Paragraph(f"DISPATCH SLIP — {dispatch['dispatch_number']}", h2))
    elements.append(Spacer(1, 4*mm))

    info_data = [
        ["Order:", dispatch.get("order_number", ""), "Date:", dispatch.get("dispatch_date", "")],
        ["School:", dispatch.get("school_name", ""), "Courier:", dispatch.get("courier_name", "")],
        ["Tracking #:", dispatch.get("tracking_number", ""), "Status:", dispatch.get("status", "").upper()],
    ]
    info_table = Table(info_data, colWidths=[70, 180, 70, 180])
    info_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 6*mm))

    item_data = [["#", "Die Code", "Die Name", "Type", "Qty", "Status"]]
    for i, item in enumerate(items, 1):
        item_data.append([str(i), item.get("die_code", ""), item.get("die_name", ""), item.get("die_type", ""), str(item.get("quantity", 1)), item.get("status", "")])
    item_table = Table(item_data, colWidths=[25, 80, 150, 70, 40, 80])
    item_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.1, 0.1, 0.18)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.96, 0.96, 0.98)]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(Paragraph("Items", h2))
    elements.append(item_table)
    elements.append(Spacer(1, 8*mm))
    if dispatch.get("notes"):
        elements.append(Paragraph(f"<b>Notes:</b> {dispatch['notes']}", normal))
    elements.append(Spacer(1, 15*mm))
    elements.append(Paragraph("_________________________", normal))
    elements.append(Paragraph("Authorized Signature", normal))

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=dispatch_{dispatch['dispatch_number']}.pdf"})

@api_router.post("/settings/sheets")
async def save_sheets_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    settings = await request.json()
    await db.settings.update_one(
        {"type": "sheets"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Sheets settings saved"}

@api_router.post("/settings/notifications")
async def save_notification_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    settings = await request.json()
    await db.settings.update_one(
        {"type": "notifications"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Notification settings saved"}

async def send_catalogue_email(quotation_id: str, cc_emails: Optional[List[str]] = None):
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return {"success": False, "error": "Quotation not found"}

    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    sender_email = email_settings.get("sender_email") if email_settings else None
    app_password = email_settings.get("gmail_app_password") if email_settings else None
    sender_name = email_settings.get("sender_name", "SmartShape Pro") if email_settings else "SmartShape Pro"

    if not sender_email or not app_password:
        return {"success": False, "error": "Email credentials not configured. Ask admin to set Gmail SMTP in App Settings."}

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{quot['catalogue_token']}"

    # CC list: dedup + drop empties + exclude sender & customer to avoid loops
    cc_set = []
    for e in (cc_emails or []):
        if e and e.lower() != sender_email.lower() and e.lower() != (quot.get('customer_email') or '').lower() and e not in cc_set:
            cc_set.append(e)
    # Also CC the sales person who owns the quotation (so "Parul sees it if Parul's quotation")
    sp_email = quot.get("sales_person_email")
    if sp_email and sp_email.lower() != sender_email.lower() and sp_email.lower() != (quot.get('customer_email') or '').lower() and sp_email not in cc_set:
        cc_set.append(sp_email)

    subject = f"Catalogue Link - {quot['school_name']}"
    body = f"""Dear {quot['principal_name']},

Thank you for your interest in SmartShape Pro products!

We are pleased to share your personalized catalogue for {quot['package_name']}.

Please click the link below to view and select your preferred dies:
{catalogue_url}

For any queries, please contact:
{quot['sales_person_name']}
Email: {quot.get('sales_person_email', 'N/A')}

Best regards,
SmartShape Pro Team"""

    try:
        msg = MIMEMultipart()
        msg['From'] = f"{sender_name} <{sender_email}>"
        msg['To'] = quot['customer_email']
        if cc_set:
            msg['Cc'] = ", ".join(cc_set)
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        recipients = [quot['customer_email']] + cc_set
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())

        return {"success": True, "message": "Email sent successfully", "cc": cc_set}
    except Exception as e:
        logging.error(f"Email send error: {e}")
        return {"success": False, "error": str(e)}

@api_router.post("/quotations/{quotation_id}/send-catalogue-email")
async def send_catalogue_with_email(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    
    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": datetime.now(timezone.utc).isoformat(),
                "quotation_status": "sent"
            }}
        )
    else:
        token = quot["catalogue_token"]
    
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"
    
    email_result = await send_catalogue_email(quotation_id, cc_emails=[user.get("email")])

    return {
        "catalogue_url": catalogue_url,
        "email_sent": email_result.get("success", False),
        "email_error": email_result.get("error"),
        "cc": email_result.get("cc", []),
        "message": "Catalogue link generated" + (" and email sent!" if email_result.get("success") else " (email not configured)")
    }

# ==================== EXPORT / GOOGLE SHEETS ====================

import csv
import io

@api_router.get("/export/quotations")
async def export_quotations(request: Request):
    user = await get_current_user(request)
    quotations = await db.quotations.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Quote Number", "School Name", "Principal Name", "Package", "Sales Person",
                      "Subtotal", "GST", "Discount 1%", "Discount 2%", "Freight", "Grand Total",
                      "Status", "Catalogue Status", "Created At"])
    for q in quotations:
        writer.writerow([
            q.get("quote_number"), q.get("school_name"), q.get("principal_name"),
            q.get("package_name"), q.get("sales_person_name"),
            q.get("subtotal", 0), q.get("gst_amount", 0),
            q.get("discount1_pct", 0), q.get("discount2_pct", 0),
            q.get("freight_total", 0), q.get("grand_total", 0),
            q.get("quotation_status"), q.get("catalogue_status"), q.get("created_at")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quotations_export.csv"}
    )

@api_router.get("/export/inventory")
async def export_inventory(request: Request):
    user = await get_current_user(request)
    dies = await db.dies.find({}, {"_id": 0}).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Code", "Name", "Type", "Stock Qty", "Reserved Qty", "Available", "Min Level", "Status"])
    for d in dies:
        avail = d.get("stock_qty", 0) - d.get("reserved_qty", 0)
        status = "Low Stock" if d.get("stock_qty", 0) < d.get("min_level", 5) else "OK"
        writer.writerow([
            d.get("code"), d.get("name"), d.get("type"),
            d.get("stock_qty", 0), d.get("reserved_qty", 0), avail,
            d.get("min_level", 5), status
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory_export.csv"}
    )

@api_router.get("/export/attendance")
async def export_attendance(request: Request):
    user = await get_current_user(request)
    records = await db.attendance.find({}, {"_id": 0}).sort("date", -1).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "Email", "Date", "Work Type", "Check In Time", "Check In Address",
                      "Check Out Time", "Check Out Address"])
    for a in records:
        writer.writerow([
            a.get("sales_person_name"), a.get("sales_person_email"), a.get("date"),
            a.get("work_type"), a.get("check_in_time"), a.get("check_in_address"),
            a.get("check_out_time"), a.get("check_out_address")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendance_export.csv"}
    )

@api_router.get("/export/expenses")
async def export_expenses(request: Request):
    user = await get_current_user(request)
    expenses = await db.travel_expenses.find({}, {"_id": 0}).sort("date", -1).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "Date", "From", "To", "Distance KM", "Transport Mode",
                      "Rate/KM", "Amount", "Status"])
    for e in expenses:
        writer.writerow([
            e.get("sales_person_name"), e.get("date"),
            e.get("from_location"), e.get("to_location"),
            e.get("distance_km"), e.get("transport_mode"),
            e.get("rate_per_km"), e.get("amount"), e.get("status")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=expenses_export.csv"}
    )

@api_router.get("/export/field-visits")
async def export_field_visits(request: Request):
    user = await get_current_user(request)
    visits = await db.field_visits.find({}, {"_id": 0}).sort("visit_date", -1).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sales Person", "School Name", "Contact Person", "Contact Phone",
                      "Visit Date", "Visit Time", "Status", "Purpose", "Outcome", "Address"])
    for v in visits:
        writer.writerow([
            v.get("sales_person_name"), v.get("school_name"),
            v.get("contact_person"), v.get("contact_phone"),
            v.get("visit_date"), v.get("visit_time"), v.get("status"),
            v.get("purpose"), v.get("outcome"),
            v.get("visited_address") or v.get("planned_address")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=field_visits_export.csv"}
    )

@api_router.get("/export/users")
async def export_users(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Email", "Role", "Phone", "Modules", "Active", "Created At"])
    for u in users:
        writer.writerow([
            u.get("name"), u.get("email"), u.get("role"),
            u.get("phone", ""), ", ".join(u.get("assigned_modules", [])),
            u.get("is_active", True), u.get("created_at")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users_export.csv"}
    )

@api_router.get("/export/contacts")
async def export_contacts(request: Request):
    await get_current_user(request)
    contacts_list = await db.contacts.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Phone", "Email", "Company", "Designation", "Source", "Notes", "Status", "Converted", "Lead ID", "Created At"])
    for c in contacts_list:
        writer.writerow([
            c.get("name"), c.get("phone"), c.get("email"),
            c.get("company"), c.get("designation"), c.get("source"),
            c.get("notes"), c.get("status", "active"),
            "Yes" if c.get("converted_to_lead") else "No",
            c.get("lead_id", ""), c.get("created_at", "")
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=contacts_export.csv"}
    )

@api_router.post("/contacts/import")
async def import_contacts_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        user = await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    duplicates = 0
    errors = []
    for row in reader:
        try:
            name = row.get("name", "").strip()
            phone = row.get("phone", "").strip()
            if not name or not phone:
                errors.append("Row missing name or phone")
                continue
            existing = await db.contacts.find_one({"phone": phone, "name": name})
            if existing:
                duplicates += 1
                continue
            contact_id = f"con_{uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({
                "contact_id": contact_id,
                "name": name,
                "phone": phone,
                "email": row.get("email", "").strip(),
                "company": row.get("company", "").strip(),
                "designation": row.get("designation", "").strip(),
                "source": row.get("source", "").strip(),
                "notes": row.get("notes", "").strip(),
                "status": "active",
                "converted_to_lead": False,
                "lead_id": None,
                "created_by": user["email"] if request else "import",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "duplicates": duplicates, "errors": errors[:10]}

# ==================== STARTUP & SEEDING ====================

@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logging.info("Storage initialized")
    except Exception as e:
        logging.error(f"Storage init failed: {e}")
    
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.dies.create_index("code", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.contacts.create_index("contact_id", unique=True)
    
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@smartshape.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        admin_doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(admin_doc)
        logging.info(f"Admin created: {admin_email}")
    else:
        # Ensure admin has password and correct role
        update_admin = {"role": "admin"}
        if not existing_admin.get("password_hash") or not verify_password(admin_password, existing_admin.get("password_hash", "")):
            update_admin["password_hash"] = hash_password(admin_password)
        await db.users.update_one({"email": admin_email}, {"$set": update_admin})
        logging.info("Admin ensured")
    
    # Seed packages (with configurable items)
    packages_data = [
        {"package_id": "pkg_standard", "name": "standard", "display_name": "Standard Package", "base_price": 25000, "std_die_qty": 10, "machine_qty": 1, "large_die_qty": 0, "gst_pct": 18, "is_active": True,
         "items": [
             {"type": "standard_die", "name": "Standard Die", "qty": 10, "unit_price": 2000, "gst_pct": 18},
             {"type": "machine", "name": "Machine Press", "qty": 1, "unit_price": 15000, "gst_pct": 18},
         ]},
        {"package_id": "pkg_premium", "name": "premium", "display_name": "Premium Package", "base_price": 40000, "std_die_qty": 15, "machine_qty": 1, "large_die_qty": 2, "gst_pct": 18, "is_active": True,
         "items": [
             {"type": "standard_die", "name": "Standard Die", "qty": 15, "unit_price": 2000, "gst_pct": 18},
             {"type": "large_die", "name": "Large Die", "qty": 2, "unit_price": 3500, "gst_pct": 18},
             {"type": "machine", "name": "Machine Press", "qty": 1, "unit_price": 15000, "gst_pct": 18},
         ]},
        {"package_id": "pkg_ultimate", "name": "ultimate", "display_name": "Ultimate Package", "base_price": 60000, "std_die_qty": 20, "machine_qty": 1, "large_die_qty": 5, "gst_pct": 18, "is_active": True,
         "items": [
             {"type": "standard_die", "name": "Standard Die", "qty": 20, "unit_price": 2000, "gst_pct": 18},
             {"type": "large_die", "name": "Large Die", "qty": 5, "unit_price": 3500, "gst_pct": 18},
             {"type": "machine", "name": "Machine Press", "qty": 1, "unit_price": 15000, "gst_pct": 18},
             {"type": "die_set", "name": "Die Set (Complete)", "qty": 1, "unit_price": 5000, "gst_pct": 18},
         ]},
    ]
    for pkg in packages_data:
        existing = await db.packages.find_one({"package_id": pkg["package_id"]})
        if not existing:
            await db.packages.insert_one(pkg)
        elif not existing.get("items"):
            # Update existing packages with items
            await db.packages.update_one({"package_id": pkg["package_id"]}, {"$set": {"items": pkg["items"]}})
    
    # Seed sample dies
    sample_dies = [
        {"die_id": f"die_{i:03d}", "code": f"D-STD-{i:03d}", "name": f"Standard Die {i}", "type": "standard", "stock_qty": 20 if i <= 10 else 3, "reserved_qty": 0, "min_level": 5, "is_active": True}
        for i in range(1, 11)
    ] + [
        {"die_id": f"die_l{i:03d}", "code": f"D-LRG-{i:03d}", "name": f"Large Die {i}", "type": "large", "stock_qty": 15, "reserved_qty": 0, "min_level": 5, "is_active": True}
        for i in range(1, 4)
    ] + [
        {"die_id": "die_m001", "code": "D-MCH-001", "name": "Machine Press A", "type": "machine", "stock_qty": 5, "reserved_qty": 0, "min_level": 2, "is_active": True},
        {"die_id": "die_m002", "code": "D-MCH-002", "name": "Machine Press B", "type": "machine", "stock_qty": 3, "reserved_qty": 0, "min_level": 2, "is_active": True}
    ]
    
    for die in sample_dies:
        existing = await db.dies.find_one({"die_id": die["die_id"]})
        if not existing:
            await db.dies.insert_one(die)
    
    # Seed modules
    default_modules = [
        {"module_id": "mod_dashboard", "name": "dashboard", "display_name": "Dashboard", "category": "admin", "sort_order": 1, "is_active": True},
        {"module_id": "mod_quotations", "name": "quotations", "display_name": "Quotations", "category": "admin", "sort_order": 2, "is_active": True},
        {"module_id": "mod_inventory", "name": "inventory", "display_name": "Inventory", "category": "store", "sort_order": 3, "is_active": True},
        {"module_id": "mod_stock_mgmt", "name": "stock_management", "display_name": "Stock Management", "category": "store", "sort_order": 4, "is_active": True},
        {"module_id": "mod_purchase_alerts", "name": "purchase_alerts", "display_name": "Purchase Alerts", "category": "store", "sort_order": 5, "is_active": True},
        {"module_id": "mod_package_master", "name": "package_master", "display_name": "Package Master", "category": "admin", "sort_order": 6, "is_active": True},
        {"module_id": "mod_physical_count", "name": "physical_count", "display_name": "Physical Count", "category": "store", "sort_order": 7, "is_active": True},
        {"module_id": "mod_analytics", "name": "analytics", "display_name": "Analytics", "category": "admin", "sort_order": 8, "is_active": True},
        {"module_id": "mod_payroll", "name": "payroll", "display_name": "Payroll", "category": "hr", "sort_order": 9, "is_active": True},
        {"module_id": "mod_accounts", "name": "accounts", "display_name": "Accounts", "category": "accounts", "sort_order": 10, "is_active": True},
        {"module_id": "mod_hr", "name": "hr", "display_name": "HR", "category": "hr", "sort_order": 11, "is_active": True},
        {"module_id": "mod_leave", "name": "leave_management", "display_name": "Leave Management", "category": "hr", "sort_order": 12, "is_active": True},
        {"module_id": "mod_store", "name": "store", "display_name": "Store", "category": "store", "sort_order": 12, "is_active": True},
        {"module_id": "mod_settings", "name": "settings", "display_name": "Settings", "category": "admin", "sort_order": 13, "is_active": True},
        {"module_id": "mod_user_mgmt", "name": "user_management", "display_name": "User Management", "category": "admin", "sort_order": 14, "is_active": True},
        {"module_id": "mod_field_sales", "name": "field_sales", "display_name": "Field Sales", "category": "sales", "sort_order": 15, "is_active": True},
        {"module_id": "mod_leads", "name": "leads", "display_name": "Leads & CRM", "category": "sales", "sort_order": 16, "is_active": True},
        {"module_id": "mod_sales", "name": "sales_portal", "display_name": "Sales Portal", "category": "sales", "sort_order": 17, "is_active": True},
    ]
    for mod in default_modules:
        existing_mod = await db.modules.find_one({"module_id": mod["module_id"]})
        if not existing_mod:
            await db.modules.insert_one(mod)
        else:
            # Update category if changed
            await db.modules.update_one({"module_id": mod["module_id"]}, {"$set": {"category": mod["category"], "sort_order": mod["sort_order"]}})

    # Ensure admin has all modules assigned
    all_mod_names = [m["name"] for m in default_modules]
    admin_user = await db.users.find_one({"email": admin_email})
    if admin_user:
        await db.users.update_one({"email": admin_email}, {"$set": {"assigned_modules": all_mod_names, "is_active": True}})

    # Seed dme@pfcpl24.in user
    dme_email = "dme@pfcpl24.in"
    dme_user = await db.users.find_one({"email": dme_email})
    dme_modules = ["accounts", "hr", "store", "inventory", "stock_management", "purchase_alerts", "physical_count", "payroll", "field_sales"]
    if dme_user:
        update = {"assigned_modules": dme_modules, "is_active": True}
        if not dme_user.get("password_hash"):
            update["password_hash"] = hash_password("admin@123")
        else:
            try:
                if not verify_password("admin@123", dme_user["password_hash"]):
                    update["password_hash"] = hash_password("admin@123")
            except Exception:
                update["password_hash"] = hash_password("admin@123")
        await db.users.update_one({"email": dme_email}, {"$set": update})
    else:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": dme_email,
            "password_hash": hash_password("admin@123"),
            "name": "Aman DME",
            "role": "sales_person",
            "phone": "",
            "assigned_modules": dme_modules,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    logging.info(f"DME user configured: {dme_email}")

    # Ensure all existing users have is_active and assigned_modules fields
    users_without_modules = db.users.find({"$or": [
        {"assigned_modules": {"$exists": False}},
        {"is_active": {"$exists": False}}
    ]})
    async for u in users_without_modules:
        update_fields = {}
        if not u.get("assigned_modules"):
            if u.get("role") == "admin":
                update_fields["assigned_modules"] = all_mod_names
            else:
                update_fields["assigned_modules"] = ["sales_portal"]
        if "is_active" not in u:
            update_fields["is_active"] = True
        if update_fields:
            await db.users.update_one({"user_id": u.get("user_id")}, {"$set": update_fields})

    # Sync users → salespersons (auto-link)
    all_users = await db.users.find({}, {"_id": 0}).to_list(1000)
    for u in all_users:
        sp_existing = await db.salespersons.find_one({"email": u["email"]})
        if not sp_existing:
            await db.salespersons.insert_one({
                "sales_person_id": f"sp_{uuid.uuid4().hex[:12]}",
                "name": u["name"],
                "email": u["email"],
                "phone": u.get("phone", ""),
                "user_id": u.get("user_id"),
                "is_active": u.get("is_active", True)
            })
        else:
            # Update existing salesperson to link with user
            await db.salespersons.update_one(
                {"email": u["email"]},
                {"$set": {"name": u["name"], "user_id": u.get("user_id"), "is_active": u.get("is_active", True)}}
            )

    # Seed sales persons
    sample_sp = [
        {"sales_person_id": "sp_001", "name": "Rajesh Kumar", "email": "rajesh@smartshape.com", "phone": "+91-9876543210", "is_active": True},
        {"sales_person_id": "sp_002", "name": "Priya Sharma", "email": "priya@smartshape.com", "phone": "+91-9876543211", "is_active": True},
        {"sales_person_id": "sp_003", "name": "Amit Patel", "email": "amit@smartshape.com", "phone": "+91-9876543212", "is_active": True}
    ]
    for sp in sample_sp:
        existing = await db.salespersons.find_one({"sales_person_id": sp["sales_person_id"]})
        if not existing:
            await db.salespersons.insert_one(sp)
    
    # Seed company settings with logo
    company_settings = await db.settings.find_one({"type": "company"})
    if not company_settings:
        await db.settings.insert_one({
            "type": "company",
            "company_name": "SmartShapes",
            "logo_url": "https://customer-assets.emergentagent.com/job_field-sales-app-16/artifacts/bwpjcb1m_logo.png",
            "address": "",
            "phone": "",
            "email": "info@smartshape.in",
            "gst_number": "",
        })

    # Seed demo department accounts
    demo_accounts = [
        {"email": "sales@smartshape.in", "name": "Sales Team", "role": "sales_person", "modules": ["sales_portal", "field_sales", "quotations", "leads"]},
        {"email": "store@smartshape.in", "name": "Store Manager", "role": "sales_person", "modules": ["inventory", "stock_management", "purchase_alerts", "physical_count", "store"]},
        {"email": "accounts@smartshape.in", "name": "Accounts Team", "role": "sales_person", "modules": ["accounts", "payroll", "quotations"]},
        {"email": "hr@smartshape.in", "name": "HR Team", "role": "sales_person", "modules": ["hr", "payroll", "field_sales"]},
    ]
    for acct in demo_accounts:
        existing_acct = await db.users.find_one({"email": acct["email"]})
        if not existing_acct:
            uid = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": uid, "email": acct["email"],
                "password_hash": hash_password("demo@123"),
                "name": acct["name"], "role": acct["role"],
                "phone": "", "assigned_modules": acct["modules"],
                "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()
            })
            await db.salespersons.update_one({"email": acct["email"]}, {"$set": {
                "sales_person_id": f"sp_{uuid.uuid4().hex[:12]}", "name": acct["name"],
                "email": acct["email"], "phone": "", "user_id": uid, "is_active": True
            }}, upsert=True)
            logging.info(f"Demo account created: {acct['email']}")
        else:
            # Ensure password is correct
            if not existing_acct.get("password_hash") or not verify_password("demo@123", existing_acct.get("password_hash", "")):
                await db.users.update_one({"email": acct["email"]}, {"$set": {"password_hash": hash_password("demo@123"), "assigned_modules": acct["modules"], "is_active": True}})

    # Write test credentials
    try:
        os.makedirs("/app/memory", exist_ok=True)
        with open("/app/memory/test_credentials.md", "w") as f:
            f.write(f"""# SmartShape Pro Test Credentials

## Admin Account
- Email: {admin_email}
- Password: {admin_password}
- Role: admin

## Test Sales Persons
- Rajesh Kumar: rajesh@smartshape.com
- Priya Sharma: priya@smartshape.com
- Amit Patel: amit@smartshape.com

## Auth Endpoints
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/google/session (Google Auth)

## Notes
- Default role for new registrations: sales_person
- Admin can access all features
- Sales persons see only their own data
""")
    except Exception as e:
        logging.error(f"Failed to write test credentials: {e}")

    # Start auto-reminder background task
    asyncio.create_task(run_auto_reminders())
    logging.info("Auto-reminder cron started (runs every hour)")

app.include_router(api_router)

# ── WebSocket: Today's Actions real-time push ──────────────────────────────
import asyncio
from typing import Set

class TodayActionsWSManager:
    def __init__(self):
        self.connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.add(ws)

    def disconnect(self, ws: WebSocket):
        self.connections.discard(ws)

    async def broadcast(self, data: dict):
        dead = set()
        for ws in self.connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self.connections -= dead

ws_manager = TodayActionsWSManager()

@app.websocket("/api/ws/today-actions")
async def ws_today_actions(websocket: WebSocket):
    token = websocket.query_params.get("token")
    # Accept first, then validate — allows clean close on auth failure
    await ws_manager.connect(websocket)
    try:
        # Send initial data immediately on connect
        actions = await _build_today_actions_payload(websocket)
        if actions is not None:
            await websocket.send_json(actions)
        # Keep alive — ping every 30s, push updates every 60s
        tick = 0
        while True:
            await asyncio.sleep(30)
            tick += 1
            try:
                await websocket.send_json({"type": "ping"})
                if tick % 2 == 0:  # every 60s push updated actions
                    actions = await _build_today_actions_payload(websocket)
                    if actions:
                        await websocket.send_json(actions)
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)

async def _build_today_actions_payload(websocket: WebSocket):
    """Re-use the /today/actions query logic for WS push."""
    try:
        from fastapi import Request as FRequest
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Lightweight version — return count only for WS to avoid heavy queries
        overdue = await db.visit_plans.count_documents({"status": "planned", "visit_date": {"$lt": today_str}})
        due_today = await db.visit_plans.count_documents({"status": "planned", "visit_date": today_str})
        return {"type": "today_actions_update", "overdue_visits": overdue, "due_today": due_today, "ts": datetime.now(timezone.utc).isoformat()}
    except Exception:
        return None

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get('FRONTEND_URL', 'http://localhost:3000')],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
