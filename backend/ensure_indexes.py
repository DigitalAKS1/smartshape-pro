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
    "schools":           [("school_name", 1), ("city", 1)],
    "quotations":        [("status", 1), ("created_at", -1), ("sales_person_id", 1), ("school_name", 1)],
    "orders":            [("order_status", 1), ("created_at", -1)],
    "inventory":         [("category", 1), ("name", 1)],
    "followups":         [("lead_id", 1), ("followup_date", -1)],
    "call_notes":        [("lead_id", 1), ("call_date", -1)],
    "visit_plans":       [("assigned_to", 1), ("visit_date", -1), ("school_id", 1)],
    "physical_dispatches": [("lead_id", 1), ("dispatch_date", -1)],
    "activity_logs":     [("user_email", 1), ("created_at", -1)],
    "contacts":          [("company", 1), ("converted_to_lead", 1)],
    "support_tickets":   [("status", 1), ("created_at", -1)],
    "users":             [("email", 1), ("role", 1)],
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
