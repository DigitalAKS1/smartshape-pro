"""
Create performance indexes on frequently queried fields.

Usage
-----
    python ensure_indexes.py                     # all indexes below
    python ensure_indexes.py --compound          # only the multi-field ones
    python ensure_indexes.py --yes-production    # required when the target looks live

Safety
------
This script is purely ADDITIVE and idempotent: `create_index` on an index that
already exists is a no-op, and nothing here ever drops an index or writes a
document. It reads MONGO_URL / DB_NAME from backend/.env, which on a developer
box points at the LIVE Atlas cluster - so a production-looking target is refused
unless you pass --yes-production (or set ALLOW_PRODUCTION_INDEXES=1).
Real environment variables win over .env (load_dotenv does not override), so
    MONGO_URL=mongodb://localhost:27017 DB_NAME=smartshape_dev python ensure_indexes.py
is the safe way to target a local database.

Entry format: ("field", 1) for a single-field index, or
              (("f1", 1), ("f2", -1)) for a compound one - fields ordered by
              usage frequency (most selective / most-often-filtered first) so
              the index prefix is usable on its own.
"""
import asyncio, os, sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("DB_NAME", "smartshape")

INDEXES = {
    "leads": [
        # Single-field
        ("stage", 1), ("assigned_to", 1), ("lead_type", 1),
        ("created_at", -1), ("school_id", 1),

        # Compound - filter + sort in one index scan
        (("stage", 1), ("created_at", -1)),                    # stage filter, date sort
        (("assigned_to", 1), ("stage", 1)),                    # owner + stage
        (("tags", 1), ("stage", 1)),                           # tag + stage (multikey)
        (("school_id", 1), ("created_at", -1)),                # a school's leads, newest first
        (("converted_from_contact", 1), ("created_at", -1)),   # contact-linked leads
    ],

    "schools": [
        # Single-field
        ("school_name", 1), ("city", 1), ("is_deleted", 1),

        # Compound
        (("tags", 1), ("school_name", 1)),                     # schools by tag, name-sorted
        (("assigned_to", 1), ("created_at", -1)),              # a rep's schools, newest first
        (("city", 1), ("school_type", 1)),                     # city + type
    ],

    "contacts": [
        # Single-field
        ("school_id", 1), ("company", 1), ("phone", 1),
        ("email", 1), ("converted_to_lead", 1), ("is_deleted", 1),

        # Compound
        (("tag_ids", 1), ("created_at", -1)),
        (("school_id", 1), ("tag_ids", 1)),
    ],

    "tags": [
        ("name", 1),
        ("tag_id", 1),
    ],

    "quotations":        [("quotation_status", 1), ("created_at", -1), ("sales_person_id", 1),
                          ("school_name", 1), ("customer_phone", 1), ("customer_email", 1)],
    "orders":            [("order_status", 1), ("created_at", -1)],
    "followups":         [("lead_id", 1), ("followup_date", -1)],
    "call_notes":        [("lead_id", 1), ("call_date", -1), ("created_at", -1)],
    "visit_plans":       [("assigned_to", 1), ("visit_date", -1), ("school_id", 1), ("status", 1)],
    "physical_dispatches": [("lead_id", 1), ("dispatch_date", -1)],
    "activity_logs":     [("user_email", 1), ("timestamp", -1), ("entity_id", 1)],
    "support_tickets":   [("status", 1), ("created_at", -1)],
    "users":             [("email", 1), ("role", 1), ("is_active", 1)],
    "trusted_devices":   [("user_email", 1), ("device_token", 1), ("status", 1)],
    "login_attempts":    [("identifier", 1), ("created_at", -1)],
    "stock_movements":   [("die_id", 1), ("movement_date", -1)],
    "purchase_alerts":   [("status", 1), ("created_at", -1)],
    "salespersons":      [("email", 1), ("user_id", 1)],
}


def index_keys(entry):
    """Normalise an INDEXES entry into a pymongo key list.

    ("stage", 1)                      -> [("stage", 1)]
    (("stage", 1), ("created_at", -1))-> [("stage", 1), ("created_at", -1)]
    """
    if entry and isinstance(entry[0], (tuple, list)):
        return [(str(f), int(d)) for f, d in entry]
    field, direction = entry
    return [(str(field), int(direction))]


def _label(keys):
    return "+".join(f"{f}:{d}" for f, d in keys)


def _looks_like_production(url: str, db_name: str) -> bool:
    u, d = url.lower(), db_name.lower()
    return ("mongodb+srv://" in u or "mongodb.net" in u
            or d.endswith("_prod") or d.endswith("_production"))


async def ensure(compound_only: bool = False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    created = existing = errors = 0
    for collection, entries in INDEXES.items():
        col = db[collection]
        try:
            before = {tuple(idx["key"].items()) async for idx in col.list_indexes()}
        except Exception:
            before = set()
        for entry in entries:
            keys = index_keys(entry)
            if compound_only and len(keys) < 2:
                continue
            try:
                await col.create_index(keys, background=True)
                if tuple(keys) in before:
                    existing += 1
                    print(f"  --  {collection}.{_label(keys)} (already existed)")
                else:
                    created += 1
                    print(f"  OK  {collection}.{_label(keys)}")
            except Exception as e:
                errors += 1
                print(f"  ERR {collection}.{_label(keys)}: {e}")
    client.close()
    print(f"\nIndexes ensured on {DB_NAME}: {created} created, {existing} already present, {errors} errors.")
    return errors


if __name__ == "__main__":
    argv = sys.argv[1:]
    approved = "--yes-production" in argv or os.environ.get("ALLOW_PRODUCTION_INDEXES") == "1"
    safe_url = MONGO_URL.split("@")[-1]  # never echo credentials
    print(f"Target: {safe_url}  db={DB_NAME}")
    if _looks_like_production(MONGO_URL, DB_NAME) and not approved:
        print("REFUSED: that target looks like production.\n"
              "  Re-run with --yes-production (or ALLOW_PRODUCTION_INDEXES=1) if you mean it,\n"
              "  or point at a local database:\n"
              "    MONGO_URL=mongodb://localhost:27017 DB_NAME=smartshape_dev python ensure_indexes.py")
        sys.exit(2)
    sys.exit(1 if asyncio.run(ensure(compound_only="--compound" in argv)) else 0)
