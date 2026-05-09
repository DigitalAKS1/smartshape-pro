from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

from database import db, connect_db, close_db
from auth_utils import hash_password, verify_password

# ── Route modules ──────────────────────────────────────────────────────────────
from routes.auth_routes import router as auth_router
from routes.crm_routes import router as crm_router
from routes.quotation_routes import router as quotation_router
from routes.inventory_routes import router as inventory_router
from routes.order_routes import router as order_router
from routes.field_routes import router as field_router
from routes.hr_routes import router as hr_router
from routes.admin_routes import router as admin_router, run_auto_reminders
from routes.settings_routes import router as settings_router
from routes.school_routes import router as school_router

# ── App instance ───────────────────────────────────────────────────────────────
app = FastAPI(title="SmartShape Pro API", version="1.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://smartshaperpro.netlify.app",
]
extra = os.environ.get("FRONTEND_URL", "")
if extra and extra not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(extra)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers (all under /api) ──────────────────────────────────────────
app.include_router(auth_router, prefix="/api")
app.include_router(crm_router, prefix="/api")
app.include_router(quotation_router, prefix="/api")
app.include_router(inventory_router, prefix="/api")
app.include_router(order_router, prefix="/api")
app.include_router(field_router, prefix="/api")
app.include_router(hr_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(school_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ── WebSocket: Today's Actions real-time push ──────────────────────────────────
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


async def _build_today_actions_payload(websocket: WebSocket):
    """Re-use the /today/actions query logic for WS push."""
    try:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Lightweight version — return count only for WS to avoid heavy queries
        overdue = await db.visit_plans.count_documents({"status": "planned", "visit_date": {"$lt": today_str}})
        due_today = await db.visit_plans.count_documents({"status": "planned", "visit_date": today_str})
        return {"type": "today_actions_update", "overdue_visits": overdue, "due_today": due_today, "ts": datetime.now(timezone.utc).isoformat()}
    except Exception:
        return None


@app.websocket("/api/ws/today-actions")
async def ws_today_actions(websocket: WebSocket):
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


# ==================== STARTUP & SEEDING ====================

@app.on_event("startup")
async def startup():
    try:
        from routes.inventory_routes import init_storage
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

    # Sync users -> salespersons (auto-link)
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
            "logo_url": "",
            "address": "",
            "phone": "",
            "email": "info@smartshape.in",
            "gst_number": "",
        })


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


@app.on_event("shutdown")
async def shutdown():
    await close_db()
