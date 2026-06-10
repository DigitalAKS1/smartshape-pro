"""Certificate pipeline — generate personalized cert PDFs and deliver via WhatsApp/email."""
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid, os, tempfile, io, zipfile

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
    if ext not in ("png", "jpg", "jpeg", "pdf"):
        raise HTTPException(400, "Template must be a PNG, JPG, or PDF")
    fname = f"tpl_{uuid.uuid4().hex[:12]}.{ext}"
    path = os.path.join(CERT_DIR, fname)
    with open(path, "wb") as fh:
        fh.write(await file.read())
    url = f"/uploads/certificates/{fname}"
    if ext == "pdf":
        # report which {tokens} are present so the UI can confirm the merge will work
        try:
            from cert_engine import pdf_tokens_found
            tokens = pdf_tokens_found(path)
        except Exception:
            tokens = []
        return {"url": url, "filename": fname, "kind": "pdf", "tokens_found": tokens}
    return {"url": url, "filename": fname, "kind": "image"}


@router.get("/fonts")
async def list_fonts(request: Request):
    """Curated font families for the designer dropdown."""
    await get_current_user(request)
    from cert_engine import font_families
    return {"families": font_families()}


@router.post("/templates/pdf-preview")
async def pdf_preview(request: Request, file: UploadFile = File(...)):
    """Upload a PDF template and get a raster preview (page 0 @150dpi) the drag
    designer can place fields on. Stores the real PDF + the preview PNG."""
    await get_current_user(request)
    import fitz  # PyMuPDF
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Must be a PDF")
    data = await file.read()
    pdf_name = f"tpl_{uuid.uuid4().hex[:12]}.pdf"
    with open(os.path.join(CERT_DIR, pdf_name), "wb") as fh:
        fh.write(data)
    doc = fitz.open(os.path.join(CERT_DIR, pdf_name))
    try:
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        prev_name = pdf_name[:-4] + "_preview.png"
        pix.save(os.path.join(CERT_DIR, prev_name))
        w, h = pix.width, pix.height
    finally:
        doc.close()
    try:
        from cert_engine import pdf_tokens_found
        tokens = pdf_tokens_found(os.path.join(CERT_DIR, pdf_name))
    except Exception:
        tokens = []
    return {"pdf_url": f"/uploads/certificates/{pdf_name}",
            "preview_url": f"/uploads/certificates/{prev_name}",
            "width_px": w, "height_px": h, "tokens_found": tokens}


class TemplateField(BaseModel):
    key: str            # name | date | theme | expert
    x: int
    y: int
    size: int = 24
    color: str = "#000000"
    align: str = "center"   # left | center | right
    font: str = "Default"   # curated family name (see cert_engine.FONT_REGISTRY)

class TemplateCreate(BaseModel):
    name: str
    background_url: str
    kind: str = "image"          # image (PNG/JPG + drag fields) | pdf (token-merge OR drag fields)
    orientation: str = "landscape"
    width_px: Optional[int] = 0
    height_px: Optional[int] = 0
    preview_url: Optional[str] = ""   # raster preview the designer placed fields on (pdf kind)
    fields: List[TemplateField] = []

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
            if k in ("name", "background_url", "kind", "orientation", "width_px", "height_px", "preview_url", "fields", "is_active")}
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
    # Mail-merge message templates (support {Name}/{Date}/{Theme}/{Conducted By}).
    # Empty → engine defaults are used at delivery time.
    email_subject: Optional[str] = None
    email_body: Optional[str] = None
    wa_caption: Optional[str] = None


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
        "email_subject": (body.email_subject or "").strip() or None,
        "email_body": (body.email_body or "").strip() or None,
        "wa_caption": (body.wa_caption or "").strip() or None,
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

@router.post("/batches/{batch_id}/stop")
async def stop_batch(batch_id: str, request: Request):
    """Pause an in-progress generate/send. Already-done work is kept; remaining items
    stay pending so the user can resume with Generate/Send. The scheduler stops picking
    the batch up because its status is no longer generating/sending."""
    user = await get_current_user(request); require_admin(user)
    batch = await db.cert_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.get("status") not in ("generating", "sending"):
        return {"ok": True, "message": "Batch is not running", "status": batch.get("status")}
    await db.cert_batches.update_one({"batch_id": batch_id}, {"$set": {"status": "stopped"}})
    return {"ok": True, "message": "Batch stopped", "status": "stopped"}

@router.post("/_run-loop")
async def debug_run_loop(request: Request):
    """Admin-only: run one pass of the cert generation+delivery loop synchronously (tests/manual)."""
    user = await get_current_user(request); require_admin(user)
    from scheduler import run_cert_pass
    await run_cert_pass()
    return {"ok": True}


# ── Zoom integration (config in db.settings + participant fetch) ───────────────

class ZoomConfig(BaseModel):
    account_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None

@router.get("/zoom/config")
async def get_zoom_cfg(request: Request):
    user = await get_current_user(request); require_admin(user)
    cfg = await db.settings.find_one({"type": "zoom"}, {"_id": 0}) or {}
    # never return the secret; just say whether one is stored
    return {
        "account_id": cfg.get("account_id", ""),
        "client_id": cfg.get("client_id", ""),
        "has_secret": bool(cfg.get("client_secret")),
        "configured": bool(cfg.get("account_id") and cfg.get("client_id") and cfg.get("client_secret")),
    }

@router.post("/zoom/config")
async def save_zoom_cfg(body: ZoomConfig, request: Request):
    user = await get_current_user(request); require_admin(user)
    update = {"type": "zoom", "updated_at": now_iso(), "updated_by": user.get("email")}
    if body.account_id is not None:
        update["account_id"] = body.account_id.strip()
    if body.client_id is not None:
        update["client_id"] = body.client_id.strip()
    # only overwrite the secret when a non-empty value is supplied
    if body.client_secret:
        update["client_secret"] = body.client_secret.strip()
    await db.settings.update_one({"type": "zoom"}, {"$set": update}, upsert=True)
    cfg = await db.settings.find_one({"type": "zoom"}, {"_id": 0}) or {}
    return {"ok": True, "configured": bool(cfg.get("account_id") and cfg.get("client_id") and cfg.get("client_secret"))}

@router.get("/zoom/participants")
async def zoom_participants(request: Request, meeting_id: str = ""):
    user = await get_current_user(request); require_admin(user)
    import zoom_service
    if not await zoom_service.is_configured():
        raise HTTPException(400, "Zoom is not configured. Add your Zoom API credentials first.")
    if not meeting_id.strip():
        raise HTTPException(400, "Meeting ID is required")
    from cert_engine import clean_name
    try:
        people = await zoom_service.get_meeting_participants(meeting_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Zoom fetch failed: {str(e)[:300]}")
    rows = [{"name": clean_name(p["name"]), "email": p.get("email", ""), "phone": ""} for p in people]
    return {"participants": rows, "count": len(rows)}


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
    from cert_engine import (render_certificate_pdf, render_certificate_pdf_merge,
                             render_certificate_pdf_overlay, safe_bg_path)
    try:
        bg_path = safe_bg_path(CERT_DIR, tpl.get("background_url", ""))
    except ValueError:
        raise HTTPException(400, "Invalid background path")
    out_path = os.path.join(tempfile.gettempdir(), f"preview_{item_id}.pdf")
    if tpl.get("kind") == "pdf":
        if tpl.get("fields"):
            render_certificate_pdf_overlay(bg_path, out_path, tpl.get("fields", []),
                                           {"name": it["name"]}, batch.get("shared_values", {}),
                                           tpl.get("width_px") or 0, tpl.get("height_px") or 0)
        else:
            render_certificate_pdf_merge(bg_path, out_path,
                                         {"name": it["name"]}, batch.get("shared_values", {}))
    else:
        render_certificate_pdf(bg_path, out_path, tpl.get("fields", []),
                               {"name": it["name"]}, batch.get("shared_values", {}))
    return FileResponse(out_path, media_type="application/pdf", filename="preview.pdf")


# ── Bulk download (ZIP of individual PDFs, named per attendee) ─────────────────

@router.get("/batches/{batch_id}/download")
async def download_batch_zip(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    batch = await db.cert_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    items = await db.cert_items.find(
        {"batch_id": batch_id, "gen_status": "generated"}, {"_id": 0}).to_list(2000)
    if not items:
        raise HTTPException(400, "No generated certificates to download yet")

    from cert_engine import safe_bg_path, sanitize_filename
    buf = io.BytesIO()
    used: Dict[str, int] = {}
    added = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for it in items:
            pdf_url = it.get("pdf_url") or ""
            try:
                local = safe_bg_path(CERT_DIR, pdf_url)
            except ValueError:
                continue
            if not os.path.isfile(local):
                continue
            base = sanitize_filename(it.get("name", ""))
            n = used.get(base, 0) + 1
            used[base] = n
            arcname = f"{base}.pdf" if n == 1 else f"{base}_{n}.pdf"
            zf.write(local, arcname)
            added += 1
    if added == 0:
        raise HTTPException(400, "Certificate files are not available on disk")

    zip_name = sanitize_filename(batch.get("title", "")) or "certificates"
    headers = {"Content-Disposition": f'attachment; filename="{zip_name}_certificates.zip"'}
    return Response(content=buf.getvalue(), media_type="application/zip", headers=headers)
