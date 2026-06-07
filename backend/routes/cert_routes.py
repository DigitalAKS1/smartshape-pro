"""Certificate pipeline — generate personalized cert PDFs and deliver via WhatsApp/email."""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid, os, tempfile

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


# ── Batches + Attendees ───────────────────────────────────────────────────────

class Attendee(BaseModel):
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""

class BatchCreate(BaseModel):
    title: str
    template_id: str
    source: str = "manual"            # manual | session
    session_id: Optional[str] = None
    shared_values: Dict[str, Any] = {}
    channels: List[str] = ["whatsapp", "email"]
    attendees: Optional[List[Attendee]] = None


def _new_item(batch_id: str, name: str, phone: str, email: str) -> dict:
    return {
        "item_id": gen_id("citem"), "batch_id": batch_id,
        "name": name, "phone": phone or "", "email": email or "",
        "pdf_url": None, "gen_status": "pending", "gen_error": None,
        "delivery": {
            "whatsapp": {"status": "pending", "at": None, "error": None},
            "email": {"status": "pending", "at": None, "error": None},
        },
        "created_at": now_iso(),
    }

@router.post("/batches")
async def create_batch(body: BatchCreate, request: Request):
    user = await get_current_user(request); require_admin(user)
    bid = gen_id("cbatch")
    # gather attendees
    rows: List[dict] = []
    if body.source == "session" and body.session_id:
        regs = await db.session_registrations.find({"session_id": body.session_id}, {"_id": 0}).to_list(1000)
        for r in regs:
            rows.append(_new_item(bid, r.get("name") or r.get("principal_name") or "",
                                  r.get("phone") or r.get("contact_phone") or "",
                                  r.get("email") or r.get("customer_email") or ""))
    else:
        for a in (body.attendees or []):
            rows.append(_new_item(bid, a.name, a.phone or "", a.email or ""))
    rows = [r for r in rows if r["name"].strip()]
    batch = {
        "batch_id": bid, "title": body.title, "template_id": body.template_id,
        "source": body.source, "session_id": body.session_id,
        "shared_values": body.shared_values, "channels": body.channels,
        "status": "draft",
        "counts": {"total": len(rows), "generated": 0, "sent_whatsapp": 0, "sent_email": 0, "failed": 0},
        "created_by": user.get("email"), "created_at": now_iso(),
    }
    await db.cert_batches.insert_one(batch)
    if rows:
        await db.cert_items.insert_many(rows)
    return await db.cert_batches.find_one({"batch_id": bid}, {"_id": 0})

@router.get("/batches")
async def list_batches(request: Request):
    await get_current_user(request)
    return await db.cert_batches.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, request: Request):
    await get_current_user(request)
    batch = await db.cert_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    items = await db.cert_items.find({"batch_id": batch_id}, {"_id": 0}).to_list(2000)
    return {**batch, "items": items}

@router.post("/batches/{batch_id}/attendees")
async def add_attendees(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    body = await request.json()
    rows = [_new_item(batch_id, a.get("name", ""), a.get("phone", ""), a.get("email", ""))
            for a in body.get("attendees", []) if a.get("name", "").strip()]
    if rows:
        await db.cert_items.insert_many(rows)
        await db.cert_batches.update_one({"batch_id": batch_id}, {"$inc": {"counts.total": len(rows)}})
    return {"added": len(rows)}


# ── Generation + debug runner ─────────────────────────────────────────────────

@router.post("/batches/{batch_id}/generate")
async def generate_batch(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_batches.update_one({"batch_id": batch_id}, {"$set": {"status": "generating"}})
    return {"ok": True, "message": "Generation queued"}

@router.post("/batches/{batch_id}/send")
async def send_batch(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_batches.update_one({"batch_id": batch_id}, {"$set": {"status": "sending"}})
    return {"ok": True, "message": "Delivery queued"}

@router.post("/_run-loop")
async def debug_run_loop(request: Request):
    """Admin-only: run one pass of the cert generation+delivery loop synchronously (tests/manual)."""
    user = await get_current_user(request); require_admin(user)
    from scheduler import run_cert_pass
    await run_cert_pass()
    return {"ok": True}


# ── Preview ───────────────────────────────────────────────────────────────────

@router.get("/items/{item_id}/preview")
async def preview_item(item_id: str, request: Request):
    await get_current_user(request)
    it = await db.cert_items.find_one({"item_id": item_id}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Item not found")
    batch = await db.cert_batches.find_one({"batch_id": it["batch_id"]}, {"_id": 0}) or {}
    tpl = await db.cert_templates.find_one({"template_id": batch.get("template_id")}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    from cert_engine import render_certificate_pdf, safe_bg_path
    try:
        bg_path = safe_bg_path(CERT_DIR, tpl.get("background_url", ""))
    except ValueError:
        raise HTTPException(400, "Invalid background path")
    out_path = os.path.join(tempfile.gettempdir(), f"preview_{item_id}.pdf")
    render_certificate_pdf(bg_path, out_path, tpl.get("fields", []),
                           {"name": it["name"]}, batch.get("shared_values", {}))
    return FileResponse(out_path, media_type="application/pdf", filename="preview.pdf")
