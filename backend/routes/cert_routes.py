"""Certificate pipeline — generate personalized cert PDFs and deliver via WhatsApp/email."""
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid, os

from database import db
from auth_utils import get_current_user
from rbac import require_admin

router = APIRouter(prefix="/certs", tags=["certs"])

CERT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "certificates")
os.makedirs(CERT_DIR, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@router.get("/templates")
async def list_templates(request: Request):
    await get_current_user(request)
    return await db.cert_templates.find({"is_active": {"$ne": False}}, {"_id": 0}).sort("created_at", -1).to_list(100)
