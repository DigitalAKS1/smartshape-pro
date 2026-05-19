"""
Create performance indexes on frequently queried fields.
Run once: python ensure_indexes.py
"""
import asyncio, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("DB_NAME", "smartshape")

INDEXES = {
    "leads":             [("stage", 1), ("assigned_to", 1), ("lead_type", 1), ("created_at", -1), ("school_id", 1)],
    "schools":           [("school_name", 1), ("city", 1), ("is_deleted", 1)],
    "quotations":        [("quotation_status", 1), ("created_at", -1), ("sales_person_id", 1),
                          ("school_name", 1), ("customer_phone", 1), ("customer_email", 1)],
    "orders":            [("order_status", 1), ("created_at", -1)],
    "followups":         [("lead_id", 1), ("followup_date", -1)],
    "call_notes":        [("lead_id", 1), ("call_date", -1), ("created_at", -1)],
    "visit_plans":       [("assigned_to", 1), ("visit_date", -1), ("school_id", 1), ("status", 1)],
    "physical_dispatches": [("lead_id", 1), ("dispatch_date", -1)],
    "activity_logs":     [("user_email", 1), ("timestamp", -1), ("entity_id", 1)],
    "contacts":          [("school_id", 1), ("company", 1), ("phone", 1),
                          ("email", 1), ("converted_to_lead", 1), ("is_deleted", 1)],
    "support_tickets":   [("status", 1), ("created_at", -1)],
    "users":             [("email", 1), ("role", 1), ("is_active", 1)],
    "trusted_devices":   [("user_email", 1), ("device_token", 1), ("status", 1)],
    "login_attempts":    [("identifier", 1), ("created_at", -1)],
    "stock_movements":   [("die_id", 1), ("movement_date", -1)],
    "purchase_alerts":   [("status", 1), ("created_at", -1)],
    "salespersons":      [("email", 1), ("user_id", 1)],
}

async def ensure():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    for collection, fields in INDEXES.items():
        col = db[collection]
        for field, direction in fields:
            try:
                await col.create_index([(field, direction)], background=True)
                print(f"  OK  {collection}.{field}")
            except Exception as e:
                print(f"  ERR {collection}.{field}: {e}")
    client.close()
    print("Indexes ensured.")

if __name__ == "__main__":
    asyncio.run(ensure())
