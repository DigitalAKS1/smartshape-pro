from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging

# MongoDB connection.
# IMPORTANT: never let a bad/unreachable DB URL crash the whole app on *import* —
# that turns into an endless restart/crash-loop on container hosts (e.g. Railway).
# If the client can't be created (missing env var, or a placeholder/invalid SRV host
# like "cluster.mongodb.net" that fails DNS), we log loudly and leave db = None. The
# app still boots, /api/health reports the problem, and DB-backed requests fail with a
# clear error instead of the process dying over and over.
mongo_url = os.environ.get('MONGO_URL') or os.environ.get('MONGODB_URL')
db_name = os.environ.get('DB_NAME', 'smartshape_prod')
client = None
db = None
db_init_error = None
try:
    if not mongo_url:
        raise RuntimeError("MONGO_URL (or MONGODB_URL) environment variable is not set")
    # serverSelectionTimeoutMS keeps real outages from hanging requests for ~30s.
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    db = client[db_name]
except Exception as e:
    db_init_error = str(e)
    logging.error(
        "DATABASE NOT INITIALISED — backend started but cannot use MongoDB. "
        "Check the MONGO_URL/DB_NAME environment variables on this host "
        "(a placeholder host such as 'cluster.mongodb.net' will fail DNS). Error: %s",
        str(e)[:300])


async def _i(coro):
    """Create one index, but never let a failure (e.g. a unique index over
    pre-existing duplicate data) crash app startup. Logs and continues."""
    try:
        await coro
    except Exception as e:  # DuplicateKeyError, IndexOptionsConflict, etc.
        logging.warning("index skipped: %s", str(e)[:180])


async def connect_db():
    """Called on startup — creates indexes (best-effort) and verifies connection.

    Every index is created independently and non-fatally: a single bad index
    (such as a unique constraint over existing duplicate values) must NEVER abort
    startup, or the container fails its health check and the deploy is rejected.
    """
    if db is None:
        logging.error("connect_db skipped — database not initialised (%s)", db_init_error)
        return

    # ── Unique constraints ──────────────────────────────────────────────────
    await _i(db.users.create_index("email", unique=True))
    await _i(db.dies.create_index("code", unique=True))
    await _i(db.contacts.create_index("contact_id", unique=True))
    await _i(db.contacts.create_index("phone", background=True))   # dedup checks
    await _i(db.contacts.create_index("phone_norm", background=True))  # normalized dedup (P2.2)

    # ── Forms builder ────────────────────────────────────────────────────────
    await _i(db.forms.create_index("form_id", unique=True))
    await _i(db.forms.create_index("public_token", unique=True))
    await _i(db.form_responses.create_index("response_id", unique=True))
    await _i(db.form_responses.create_index(
        [("form_id", 1), ("submitted_at", -1)], background=True))

    # ── Auth / session ──────────────────────────────────────────────────────
    await db.login_attempts.create_index("identifier")
    await db.user_sessions.create_index([("user_id", 1), ("expires_at", 1)], background=True)
    await db.login_logs.create_index([("user_email", 1), ("login_time", -1)], background=True)
    await db.trusted_devices.create_index("user_email", background=True)
    await db.push_subscriptions.create_index("email", background=True)

    # ── Schools ─────────────────────────────────────────────────────────────
    # UNIQUE on school_id (D3). Non-fatal via _i(): on a DB that still has
    # DUPLICATE school_id values (or an older NON-unique school_id index), this
    # raises DuplicateKeyError / IndexOptionsConflict, which _i swallows so
    # startup never crashes — the unique index simply isn't created yet.
    # To land it cleanly: run /crm/maintenance/integrity-detect, dedup the
    # reported duplicate school_id values, drop any old non-unique school_id
    # index, then restart. NO auto-dedup here (never delete rows on startup).
    await _i(db.schools.create_index("school_id", unique=True, background=True))
    await db.schools.create_index([("school_name", 1), ("is_deleted", 1)], background=True)
    await db.schools.create_index("is_deleted", background=True)
    await _i(db.schools.create_index("phone_norm", background=True))  # normalized dedup (P2.2)

    # ── Contacts ────────────────────────────────────────────────────────────
    await db.contacts.create_index([("school_id", 1), ("is_deleted", 1)], background=True)
    await db.contacts.create_index([("assigned_to", 1), ("is_deleted", 1)], background=True)
    await db.contacts.create_index("is_deleted", background=True)
    await db.contacts.create_index("lead_id", background=True)

    # ── Leads ───────────────────────────────────────────────────────────────
    # UNIQUE on lead_id (D3). Non-fatal via _i(): pre-existing duplicate lead_id
    # values make this a no-op (DuplicateKeyError swallowed) rather than crashing
    # startup. Dedup via integrity-detect BEFORE relying on the constraint.
    await _i(db.leads.create_index("lead_id", unique=True, background=True))
    await db.leads.create_index([("school_id", 1), ("is_deleted", 1)], background=True)
    await db.leads.create_index([("assigned_to", 1), ("is_deleted", 1)], background=True)
    await db.leads.create_index([("stage", 1), ("is_deleted", 1)], background=True)
    await db.leads.create_index("is_deleted", background=True)
    await db.leads.create_index("created_at", background=True)
    await db.leads.create_index("converted_from_contact", background=True)
    await db.leads.create_index("referred_by_contact_id", background=True)
    await _i(db.leads.create_index("phone_norm", background=True))  # normalized dedup (P2.2)

    # ── CRM child collections ───────────────────────────────────────────────
    await db.followups.create_index([("lead_id", 1), ("status", 1)], background=True)
    await db.followups.create_index([("assigned_to", 1), ("followup_date", 1)], background=True)
    await db.call_notes.create_index([("lead_id", 1), ("created_at", -1)], background=True)
    await db.tasks.create_index([("lead_id", 1), ("status", 1)], background=True)
    await db.tasks.create_index([("assigned_to", 1), ("due_date", 1)], background=True)
    await db.physical_dispatches.create_index("lead_id", background=True)

    # ── Quotations ──────────────────────────────────────────────────────────
    await db.quotations.create_index([("school_id", 1), ("created_at", -1)], background=True)
    await db.quotations.create_index([("lead_id", 1), ("created_at", -1)], background=True)
    await db.quotations.create_index([("quotation_status", 1), ("created_at", -1)], background=True)
    await db.quotations.create_index("quote_number", background=True)
    await db.catalogue_selections.create_index("quotation_id", background=True)
    await db.catalogue_selection_items.create_index("catalogue_selection_id", background=True)
    await db.quotation_edit_history.create_index([("quotation_id", 1), ("edited_at", -1)], background=True)

    # ── Orders ──────────────────────────────────────────────────────────────
    await _i(db.orders.create_index([("quotation_id", 1)], unique=True, background=True))
    await db.orders.create_index([("school_id", 1), ("order_status", 1)], background=True)
    await db.orders.create_index([("lead_id", 1)], background=True)
    await db.orders.create_index("order_number", background=True)
    await db.order_items.create_index([("order_id", 1)], background=True)
    await db.order_timeline.create_index([("order_id", 1), ("timestamp", -1)], background=True)
    await db.payments.create_index([("order_id", 1), ("payment_date", -1)], background=True)
    await db.dispatches.create_index([("order_id", 1)], background=True)
    await db.dispatches.create_index([("school_id", 1), ("dispatch_date", -1)], background=True)

    # ── Inventory ───────────────────────────────────────────────────────────
    await db.stock_movements.create_index([("die_id", 1), ("movement_date", -1)], background=True)
    await _i(db.sales_person_stock.create_index(
        [("sales_person_id", 1), ("die_id", 1)], unique=True, background=True
    ))

    # ── Marketing ───────────────────────────────────────────────────────────
    await db.whatsapp_campaigns.create_index([("status", 1), ("created_at", -1)], background=True)
    await db.whatsapp_scheduled.create_index([("campaign_id", 1), ("status", 1)], background=True)
    await db.whatsapp_scheduled.create_index([("phone", 1), ("status", 1)], background=True)
    await db.email_campaigns.create_index([("status", 1), ("created_at", -1)], background=True)
    await db.email_scheduled.create_index([("campaign_id", 1), ("status", 1)], background=True)
    await db.drip_enrollments.create_index([("lead_id", 1), ("status", 1)], background=True)
    await db.drip_enrollments.create_index([("sequence_id", 1), ("status", 1)], background=True)
    await db.drip_enrollments.create_index("next_step_at", background=True)
    await db.greeting_logs.create_index([("contact_id", 1), ("sent_at", -1)], background=True)
    await db.greeting_logs.create_index([("phone", 1), ("year", 1)], background=True)
    await db.whatsapp_logs.create_index([("lead_id", 1), ("sent_at", -1)], background=True)

    # ── Field sales ─────────────────────────────────────────────────────────
    await db.visit_plans.create_index([("school_id", 1), ("visit_date", 1)], background=True)
    await db.visit_plans.create_index([("assigned_to", 1), ("visit_date", 1)], background=True)

    # ── HR / Payroll ────────────────────────────────────────────────────────
    await db.leaves.create_index([("user_email", 1), ("from_date", -1)], background=True)
    await db.leaves.create_index([("status", 1), ("from_date", 1)], background=True)

    # ── Training & Support ──────────────────────────────────────────────────
    await db.training_sessions.create_index("date", background=True)
    await db.session_registrations.create_index("session_id", background=True)
    await db.support_tickets.create_index([("status", 1), ("created_at", -1)], background=True)

    # ── Activity / Audit ────────────────────────────────────────────────────
    await db.activity_logs.create_index([("entity_type", 1), ("entity_id", 1), ("created_at", -1)], background=True)
    await db.activity_logs.create_index("created_at", background=True)

    # ── FMS ─────────────────────────────────────────────────────────────────
    await db.fms_stage_logs.create_index([("flow_id", 1), ("at", 1)], background=True)
    await db.fms_stages.create_index([("status", 1), ("plan_done", 1)], background=True)
    await db.fms_notifications.create_index([("stage_id", 1), ("kind", 1), ("channel", 1)], background=True)

    # ── Customer portal ─────────────────────────────────────────────────────
    await db.school_notifications.create_index([("school_id", 1), ("read", 1)], background=True)
    await db.customer_accounts.create_index("catalogue_token", background=True)

    # ── Procurement ─────────────────────────────────────────────────────────
    await db.vendors.create_index("name", background=True)
    await db.vendors.create_index("is_active", background=True)
    await db.vendor_items.create_index([("vendor_id", 1)], background=True)
    await db.vendor_items.create_index([("item_ref.id", 1)], background=True)
    await _i(db.vendor_items.create_index(
        [("vendor_id", 1), ("item_ref.source", 1), ("item_ref.id", 1)],
        unique=True, background=True))
    await db.purchase_items.create_index("name", background=True)
    await db.requisitions.create_index([("status", 1), ("created_at", -1)], background=True)
    await db.purchase_orders.create_index([("status", 1), ("created_at", -1)], background=True)
    await db.purchase_orders.create_index("vendor_id", background=True)
    await db.purchase_orders.create_index("requisition_id", background=True)
    await db.goods_receipts.create_index("po_id", background=True)
    await db.goods_receipts.create_index([("status", 1), ("created_at", -1)], background=True)
    await db.procurement_stage_logs.create_index([("doc_type", 1), ("doc_id", 1), ("at", 1)], background=True)
    await db.challans.create_index([("type", 1), ("status", 1), ("created_at", -1)], background=True)

    # ── Certificates ─────────────────────────────────────────────────────────
    await db.cert_templates.create_index("is_active", background=True)
    await db.cert_batches.create_index([("created_at", -1)], background=True)
    await db.cert_items.create_index([("batch_id", 1), ("gen_status", 1)], background=True)

    # ── FMS action logs ───────────────────────────────────────────────────────
    # Idempotency is enforced by a deterministic _id (stage:action:event) in the
    # dispatcher, not this index; this index just serves the per-flow audit query.
    await db.fms_action_logs.create_index([("flow_id", 1), ("at", 1)], background=True)

    # ── Field-definition registry indexes (Import Center) ────────────────────
    await _i(db.field_definitions.create_index([("entity", 1), ("is_active", 1)], background=True))
    await _i(db.field_definitions.create_index([("key", 1)], unique=True, background=True))

    logging.info("Database indexes created/verified (%d collections indexed)", 31)

    # ── Field-definition master seed (28 importable fields) ──────────────────
    from field_registry import seed_field_definitions as _seed_fields
    await _seed_fields(db)

async def close_db():
    """Called on shutdown — closes the Motor client."""
    if client is not None:
        client.close()
        logging.info("Database connection closed")
