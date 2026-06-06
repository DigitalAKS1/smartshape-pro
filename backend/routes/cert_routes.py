"""Certificate pipeline — generate personalized cert PDFs and deliver via WhatsApp/email."""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
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


@router.post("/templates/background")
async def upload_background(request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "png").lower()
    if ext not in ("png", "jpg", "jpeg"):
        raise HTTPException(400, "Background must be PNG or JPG")
    fname = f"tpl_{uuid.uuid4().hex[:12]}.{ext}"
    path = os.path.join(CERT_DIR, fname)
    with open(path, "wb") as fh:
        fh.write(await file.read())
    return {"url": f"/uploads/certificates/{fname}", "filename": fname}


class TemplateField(BaseModel):
    key: str            # name | date | theme | expert
    x: int
    y: int
    size: int = 24
    color: str = "#000000"
    align: str = "center"   # left | center | right

class TemplateCreate(BaseModel):
    name: str
    background_url: str
    orientation: str = "landscape"
    width_px: int
    height_px: int
    fields: List[TemplateField]

@router.post("/templates")
async def create_template(body: TemplateCreate, request: Request):
    user = await get_current_user(request)
    require_admin(user)
    tid = gen_id("ctpl")
    doc = {"template_id": tid, **body.dict(), "is_active": True,
           "created_by": user.get("email"), "created_at": now_iso()}
    await db.cert_templates.insert_one(doc)
    return await db.cert_templates.find_one({"template_id": tid}, {"_id": 0})

@router.put("/templates/{template_id}")
async def update_template(template_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    body = await request.json()
    safe = {k: v for k, v in body.items()
            if k in ("name", "background_url", "orientation", "width_px", "height_px", "fields", "is_active")}
    if safe:
        await db.cert_templates.update_one({"template_id": template_id}, {"$set": safe})
    return await db.cert_templates.find_one({"template_id": template_id}, {"_id": 0})

@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_templates.update_one({"template_id": template_id}, {"$set": {"is_active": False}})
    return {"ok": True}
