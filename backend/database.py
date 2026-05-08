from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging

# MongoDB connection
mongo_url = os.getenv("MONGO_URL") or os.getenv("MONGODB_URL")
if not mongo_url:
    raise RuntimeError("Neither MONGO_URL nor MONGODB_URL environment variable is set")
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


async def connect_db():
    """Called on startup — creates indexes and verifies connection."""
    await db.users.create_index("email", unique=True)
    await db.dies.create_index("code", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.contacts.create_index("contact_id", unique=True)
    logging.info("Database indexes created")


async def close_db():
    """Called on shutdown — closes the Motor client."""
    client.close()
    logging.info("Database connection closed")
