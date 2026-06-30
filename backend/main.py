from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import asyncio
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s: %(message)s")

# Optional error tracking: set SENTRY_DSN on the server to capture backend errors.
# No-op if the package isn't installed or the DSN isn't set, so it never blocks boot.
if os.environ.get("SENTRY_DSN"):
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=os.environ["SENTRY_DSN"],
            traces_sample_rate=0.1,
            environment=os.environ.get("ENVIRONMENT", "production"),
        )
        logging.info("Sentry error tracking enabled")
    except Exception as _e:
        logging.warning(f"Sentry not initialised: {_e}")

import uuid
from datetime import datetime, timezone
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from database import db, connect_db, close_db
from auth_utils import hash_password, verify_password

# ── Route modules ──────────────────────────────────────────────────────────────
from routes.auth_routes import router as auth_router
from routes.crm_routes import router as crm_router
from routes.quotation_routes import router as quotation_router
from routes.inventory_routes import router as inventory_router
from routes.product_type_routes import router as product_type_router
from routes.order_routes import router as order_router
from routes.invoice_routes import router as invoice_router
from routes.field_routes import router as field_router
from routes.hr_routes import router as hr_router
from routes.admin_routes import router as admin_router, run_auto_reminders
from routes.settings_routes import router as settings_router
from routes.school_routes import router as school_router
from routes.customer_routes import router as customer_router
from routes.training_routes import router as training_router
from routes.promotions_routes import router as promotions_router
from routes.support_routes import router as support_router
from routes.device_routes import router as device_router
from routes.drip_routes import router as drip_router
from routes.greeting_routes import router as greeting_router
from routes.whatsapp_routes import router as whatsapp_router
from routes.email_routes import router as email_router
from routes.demo_routes import router as demo_router
from routes.push_routes import router as push_router
from routes.delegation_routes import router as delegation_router
from routes.fms_routes import router as fms_router
from routes.procurement_routes import router as procurement_router
from routes.cert_routes import router as cert_router
from routes.dynamic_import_routes import router as dynamic_import_router
from scheduler import start_scheduler

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
app.include_router(product_type_router, prefix="/api")
app.include_router(order_router, prefix="/api")
app.include_router(invoice_router, prefix="/api")
app.include_router(field_router, prefix="/api")
app.include_router(hr_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(school_router, prefix="/api")
app.include_router(customer_router, prefix="/api")
app.include_router(training_router, prefix="/api")
app.include_router(promotions_router, prefix="/api")
app.include_router(support_router, prefix="/api")
app.include_router(device_router, prefix="/api")
app.include_router(drip_router, prefix="/api")
app.include_router(greeting_router, prefix="/api")
app.include_router(whatsapp_router, prefix="/api")
app.include_router(email_router, prefix="/api")
app.include_router(demo_router, prefix="/api")
app.include_router(push_router, prefix="/api")
app.include_router(delegation_router, prefix="/api")
app.include_router(fms_router, prefix="/api")
app.include_router(procurement_router, prefix="/api")
app.include_router(cert_router, prefix="/api")
app.include_router(dynamic_import_router, prefix="/api")

# ── Static files — uploaded WhatsApp attachments served publicly ───────────────
_WA_UPLOADS = os.path.join(os.path.dirname(__file__), "uploads", "whatsapp")
os.makedirs(_WA_UPLOADS, exist_ok=True)
app.mount("/uploads/whatsapp", StaticFiles(directory=_WA_UPLOADS), name="wa_uploads")

_CERT_UPLOADS = os.path.join(os.path.dirname(__file__), "uploads", "certificates")
os.makedirs(_CERT_UPLOADS, exist_ok=True)
app.mount("/uploads/certificates", StaticFiles(directory=_CERT_UPLOADS), name="cert_uploads")


@app.get("/api/health")
async def health():
    # Report DB reachability so a misconfigured/unreachable database surfaces as a
    # clear "degraded" signal instead of a silent crash-loop.
    from database import db, db_init_error
    if db is None:
        return {"status": "degraded", "database": "not_initialised", "detail": db_init_error}
    try:
        await db.command("ping")
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": "unreachable", "detail": str(e)[:200]}


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
    # Unique indexes — wrapped so pre-existing duplicate data can't crash startup
    # (a failure is logged and the app still boots; clean the dupes, then it takes).
    _unique = [(db.users, "email"), (db.dies, "code"), (db.contacts, "contact_id")]
    for coll, field in _unique:
        try:
            await coll.create_index(field, unique=True)
        except Exception as e:
            logging.warning(f"unique index on {field} not created (likely existing duplicates): {e}")
    await db.login_attempts.create_index("identifier")

    # Performance + lookup indexes (non-blocking background build). Business numbers
    # (order/quote/invoice) are NON-unique for now — existing data may contain duplicates
    # and generation is single-worker; a true unique constraint needs a dedup pass first.
    _idx = [
        (db.schools,            [("school_name", 1), ("is_deleted", 1), ("assigned_to", 1)]),
        (db.contacts,           [("school_id", 1), ("phone", 1), ("email", 1), ("is_deleted", 1)]),
        (db.quotations,         [("school_name", 1), ("customer_phone", 1), ("customer_email", 1), ("created_at", -1), ("quote_number", 1), ("sales_person_email", 1)]),
        (db.leads,              [("school_id", 1), ("assigned_to", 1), ("stage", 1), ("company_name", 1)]),
        (db.orders,             [("order_number", 1), ("quotation_id", 1), ("school_id", 1), ("order_status", 1), ("created_at", -1)]),
        (db.invoices,           [("invoice_number", 1), ("gstin", 1), ("school_id", 1), ("order_id", 1), ("match_status", 1)]),
        (db.payments,           [("order_id", 1)]),
        (db.dispatches,         [("order_id", 1), ("dispatch_number", 1)]),
        (db.order_items,        [("order_id", 1)]),
        (db.sales_person_stock, [("sales_person_id", 1), ("die_id", 1)]),
        (db.visit_plans,        [("school_id", 1), ("visit_date", -1), ("status", 1), ("assigned_to", 1)]),
        (db.field_visits,       [("sales_person_email", 1), ("visit_date", 1), ("status", 1)]),
        (db.trusted_devices,    [("user_email", 1), ("device_token", 1), ("status", 1)]),
        (db.salespersons,       [("email", 1), ("user_id", 1)]),
        (db.stock_movements,    [("die_id", 1), ("movement_date", -1)]),
        (db.activity_logs,      [("entity_id", 1), ("timestamp", -1), ("user_email", 1)]),
        (db.cal_events,         [("date", 1), ("created_by_emp_id", 1), ("status", 1)]),
        (db.whatsapp_scheduled, [("status", 1)]),
        (db.greeting_logs,      [("rule_id", 1), ("contact_id", 1), ("year", 1)]),
    ]
    for coll, fields in _idx:
        for field in fields:
            try:
                await coll.create_index([field], background=True)
            except Exception:
                pass

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@smartshape.com").lower()
    # No weak default. The admin password comes from the ADMIN_PASSWORD env var: if set, it
    # is applied (declarative). If NOT set, we never reset an existing admin's password and we
    # seed a brand-new admin with a strong RANDOM password (logged once) — so the master
    # login is never the guessable 'admin123'.
    env_admin_password = os.environ.get("ADMIN_PASSWORD")

    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        import secrets
        seed_pw = env_admin_password or secrets.token_urlsafe(16)
        admin_doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "password_hash": hash_password(seed_pw),
            "name": "Admin",
            "role": "admin",
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(admin_doc)
        if env_admin_password:
            logging.info(f"Admin created: {admin_email}")
        else:
            logging.warning(
                f"Admin {admin_email} seeded with a GENERATED password (ADMIN_PASSWORD not set). "
                f"One-time password: {seed_pw} — log in and change it immediately, or set ADMIN_PASSWORD."
            )
    else:
        update_admin = {"role": "admin"}
        if not existing_admin.get("password_hash"):
            import secrets
            update_admin["password_hash"] = hash_password(env_admin_password or secrets.token_urlsafe(16))
        elif env_admin_password and not verify_password(env_admin_password, existing_admin.get("password_hash", "")):
            # ADMIN_PASSWORD explicitly provided → apply it so the owner can set a strong one.
            update_admin["password_hash"] = hash_password(env_admin_password)
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

    # Only seed demo dies on a brand-new (empty) database. Once real inventory
    # exists we must NOT re-insert these, or a deliberately deleted demo die
    # (D-STD-/D-LRG-/D-MCH-) would resurrect itself on every backend restart.
    if await db.dies.count_documents({}) == 0:
        for die in sample_dies:
            await db.dies.insert_one(die)

    # Seed the built-in "Dies" product type and backfill existing products onto it.
    # Idempotent: the upsert + the {$exists: false} filter make this a no-op once applied.
    await db.product_types.update_one(
        {"product_type_id": "ptype_dies"},
        {"$setOnInsert": {
            "product_type_id": "ptype_dies",
            "name": "Dies",
            "code_prefix": "SSSD",
            "visible_to_schools": True,
            "uses_quota": True,
            "sort_order": 0,
            "is_active": True,
        }},
        upsert=True,
    )
    await db.dies.update_many(
        {"product_type_id": {"$exists": False}},
        {"$set": {"product_type_id": "ptype_dies", "product_type": "Dies"}},
    )

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
        {"module_id": "mod_store", "name": "store", "display_name": "Store", "category": "store", "sort_order": 12, "is_active": True},
        {"module_id": "mod_leave", "name": "leave_management", "display_name": "Leave Management", "category": "hr", "sort_order": 13, "is_active": True},
        {"module_id": "mod_settings", "name": "settings", "display_name": "Settings", "category": "admin", "sort_order": 14, "is_active": True},
        {"module_id": "mod_user_mgmt", "name": "user_management", "display_name": "User Management", "category": "admin", "sort_order": 15, "is_active": True},
        {"module_id": "mod_field_sales", "name": "field_sales", "display_name": "Field Sales", "category": "sales", "sort_order": 16, "is_active": True},
        {"module_id": "mod_leads", "name": "leads", "display_name": "Leads & CRM", "category": "sales", "sort_order": 17, "is_active": True},
        {"module_id": "mod_sales", "name": "sales_portal", "display_name": "Sales Portal", "category": "sales", "sort_order": 18, "is_active": True},
        {"module_id": "mod_delegation", "name": "delegation", "display_name": "Delegation System", "category": "admin", "sort_order": 19, "is_active": True},
        {"module_id": "mod_orders", "name": "orders", "display_name": "Orders", "category": "store", "sort_order": 20, "is_active": True},
        {"module_id": "mod_procurement", "name": "procurement", "display_name": "Procurement", "category": "store", "sort_order": 21, "is_active": True},
        {"module_id": "mod_invoices", "name": "invoices", "display_name": "Invoices", "category": "accounts", "sort_order": 22, "is_active": True},
    ]
    for mod in default_modules:
        existing_mod = await db.modules.find_one({"module_id": mod["module_id"]})
        if not existing_mod:
            await db.modules.insert_one(mod)
        else:
            # Update category if changed
            await db.modules.update_one({"module_id": mod["module_id"]}, {"$set": {"category": mod["category"], "sort_order": mod["sort_order"]}})

    # Backfill module permissions so module-based capability gates match prior
    # role-based access (idempotent; never lowers an existing grant).
    try:
        from migrations.backfill_module_permissions import backfill_module_permissions
        _bf = await backfill_module_permissions(db)
        print(f"[startup] module-permission backfill: {_bf}")
    except Exception as _e:
        print(f"[startup] module-permission backfill skipped: {_e}")

    # Ensure admin has all modules assigned
    all_mod_names = [m["name"] for m in default_modules]
    admin_user = await db.users.find_one({"email": admin_email})
    if admin_user:
        await db.users.update_one({"email": admin_email}, {"$set": {"assigned_modules": all_mod_names, "is_active": True}})

    # Seed secondary user from env (no hardcoded credentials in source)
    dme_email    = os.environ.get("SEED_USER_EMAIL", "")
    dme_password = os.environ.get("SEED_USER_PASSWORD", "")
    dme_name     = os.environ.get("SEED_USER_NAME", "Ops User")
    dme_role     = os.environ.get("SEED_USER_ROLE", "sales_person")
    dme_modules  = [m.strip() for m in os.environ.get(
        "SEED_USER_MODULES",
        "accounts,hr,store,inventory,stock_management,purchase_alerts,physical_count,payroll,field_sales"
    ).split(",") if m.strip()]

    if dme_email and dme_password:
        dme_user = await db.users.find_one({"email": dme_email})
        if dme_user:
            update = {"assigned_modules": dme_modules, "is_active": True}
            if not dme_user.get("password_hash") or not verify_password(dme_password, dme_user["password_hash"]):
                update["password_hash"] = hash_password(dme_password)
            await db.users.update_one({"email": dme_email}, {"$set": update})
        else:
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}",
                "email": dme_email,
                "password_hash": hash_password(dme_password),
                "name": dme_name,
                "role": dme_role,
                "phone": "",
                "assigned_modules": dme_modules,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        logging.info(f"Seed user configured: {dme_email}")

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

    # Sync users -> salespersons (users is authoritative; salespersons is kept for FK lookups on quotations)
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
                "is_active": u.get("is_active", True),
            })
        else:
            # Keep salespersons in sync with users — name/phone/active come from users
            await db.salespersons.update_one(
                {"email": u["email"]},
                {"$set": {
                    "name": u["name"],
                    "phone": u.get("phone", sp_existing.get("phone", "")),
                    "user_id": u.get("user_id"),
                    "is_active": u.get("is_active", True),
                }}
            )

    # (Removed) demo sales persons (Rajesh/Priya/Amit @smartshape.com) were re-seeded on
    # every startup; dropped for the commercial launch. Real salespersons are synced from
    # the users collection above.

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


    # (Removed) Previously wrote the live admin password to /app/memory/test_credentials.md,
    # leaking the master credential into a file inside the container. The credential is no
    # longer persisted to disk.

    # Start auto-reminder background task
    asyncio.create_task(run_auto_reminders())
    logging.info("Auto-reminder cron started (runs every hour)")

    # Start marketing automation scheduler
    await start_scheduler()
    logging.info("Marketing automation scheduler started (email + WA + drip + greetings)")

    # SP5 — calendar reminders dispatcher (enqueues into the email/WA queues above)
    if os.environ.get("REMINDERS_DISABLE_LOOP", "").strip() not in ("1", "true", "True"):
        async def _reminders_loop():
            from routes.delegation_routes import dispatch_due_reminders
            while True:
                try:
                    await dispatch_due_reminders()
                except Exception as e:
                    logging.warning(f"[reminders] dispatch error: {e}")
                await asyncio.sleep(180)
        asyncio.create_task(_reminders_loop())
        logging.info("Calendar reminders dispatcher started (every 3 min)")
    else:
        logging.info("Calendar reminders dispatcher DISABLED (REMINDERS_DISABLE_LOOP)")


@app.on_event("shutdown")
async def shutdown():
    await close_db()
