from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL') or os.environ.get('MONGODB_URL')
if not mongo_url:
    raise RuntimeError("MONGO_URL environment variable is not set")
db_name = os.environ.get('DB_NAME', 'smartshape_prod')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]


async def connect_db():
    """Called on startup — creates indexes and verifies connection."""
    await db.users.create_index("email", unique=True)
    await db.dies.create_index("code", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.contacts.create_index("contact_id", unique=True)
    # Performance indexes
    for col, field, direction in [
        ("leads", "stage", 1), ("leads", "assigned_to", 1), ("leads", "created_at", -1),
        ("quotations", "status", 1), ("quotations", "created_at", -1),
        ("orders", "order_status", 1), ("followups", "lead_id", 1),
        ("call_notes", "lead_id", 1), ("support_tickets", "created_at", -1),
        ("activity_logs", "created_at", -1),
    ]:
        try:
            await db[col].create_index([(field, direction)], background=True)
        except Exception:
            pass
    logging.info("Database indexes created")


async def close_db():
    """Called on shutdown — closes the Motor client."""
    client.close()
    logging.info("Database connection closed")
