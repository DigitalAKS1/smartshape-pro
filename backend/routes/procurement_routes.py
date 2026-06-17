"""
Procurement module for SmartShape Pro.

Pipeline: Vendor Master -> Requisition / Direct Order Planning -> Purchase Order
(+ GST PDF) -> Goods Verification -> QC checklist -> Stock-in / Vendor Return.

Conventions mirror the rest of the codebase (FastAPI + Motor, raw dicts,
`{prefix}_{uuid4hex12}` ids, ISO-8601 UTC timestamps, rbac.require_teams).

Phase 1 (this file, initial): masters + shared foundations
  - counters (human-readable sequential numbers)
  - procurement_stage_logs (hybrid tracking)
  - GST calculation helper (used by PO phase)
  - Vendor Master, Purchase Item Master, Vendor price list, QC templates
  - Unified item catalog (dies + purchase_items) for the image picker
"""

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid
import os

from database import db
from auth_utils import get_current_user
from rbac import require_teams, require_module

router = APIRouter()

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


# ==================== SHARED HELPERS ====================

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def save_file(path: str, data: bytes) -> str:
    """Save bytes under UPLOADS_DIR, return the relative path."""
    full_path = os.path.join(UPLOADS_DIR, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(data)
    return path


async def next_number(key: str, prefix: str, width: int = 4) -> str:
    """Atomically issue the next human-readable number, e.g. PO-0001.

    Uses a `counters` collection keyed by `key`. Atomic via findOneAndUpdate.
    """
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,  # ReturnDocument.AFTER == True in motor/pymongo
    )
    seq = (doc or {}).get("seq", 1)
    return f"{prefix}-{str(seq).zfill(width)}"


async def log_stage(doc_type: str, doc_id: str, from_status: Optional[str],
                    to_status: str, by: str, remark: str = "") -> None:
    """Append an immutable transition log (hybrid tracking for future TAT/FMS)."""
    await db.procurement_stage_logs.insert_one({
        "log_id": _new_id("plog"),
        "doc_type": doc_type,
        "doc_id": doc_id,
        "from_status": from_status,
        "to_status": to_status,
        "by": by,
        "at": _now(),
        "remark": remark or "",
    })


def _timeline_entry(action: str, by: str, note: str = "") -> dict:
    return {"action": action, "by": by, "note": note or "", "at": _now()}


def round2(x: float) -> float:
    return round(float(x or 0) + 1e-9, 2)


async def _company_state_code() -> str:
    """Company GST state code from settings (for intra/inter-state GST)."""
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    return str(company.get("state_code") or "").strip()


def compute_gst_line(qty: float, rate: float, gst_pct: float, tax_mode: str) -> dict:
    """Return GST breakup for a single line. tax_mode in {'intra','inter'}."""
    qty = float(qty or 0)
    rate = float(rate or 0)
    gst_pct = float(gst_pct or 0)
    taxable = round2(qty * rate)
    if tax_mode == "intra":
        cgst = round2(taxable * gst_pct / 200.0)
        sgst = round2(taxable * gst_pct / 200.0)
        igst = 0.0
    else:  # inter
        cgst = 0.0
        sgst = 0.0
        igst = round2(taxable * gst_pct / 100.0)
    line_total = round2(taxable + cgst + sgst + igst)
    return {"taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst,
            "line_total": line_total}


# ==================== VENDOR MASTER ====================

class VendorIn(BaseModel):
    name: str
    gstin: Optional[str] = ""
    pan: Optional[str] = ""
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    state_code: Optional[str] = ""
    payment_terms: Optional[str] = ""
    is_active: bool = True


@router.get("/vendors")
async def list_vendors(request: Request, include_inactive: bool = False):
    await get_current_user(request)
    query = {} if include_inactive else {"is_active": {"$ne": False}}
    return await db.vendors.find(query, {"_id": 0}).sort("name", 1).to_list(2000)


@router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str, request: Request):
    await get_current_user(request)
    v = await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return v


@router.post("/vendors")
async def create_vendor(payload: VendorIn, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Vendor name is required")
    vendor_id = _new_id("ven")
    doc = {
        "vendor_id": vendor_id,
        **payload.model_dump(),
        "name": name,
        "logo_url": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.vendors.insert_one(doc)
    return await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})


@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    updates = await request.json()
    safe = {k: v for k, v in updates.items() if k not in ("vendor_id", "_id", "created_at")}
    safe["updated_at"] = _now()
    if safe:
        await db.vendors.update_one({"vendor_id": vendor_id}, {"$set": safe})
    return await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})


@router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write_delete")
    await db.vendors.update_one({"vendor_id": vendor_id}, {"$set": {"is_active": False, "updated_at": _now()}})
    return {"message": "Vendor deactivated"}


@router.post("/vendors/{vendor_id}/upload-logo")
async def upload_vendor_logo(vendor_id: str, request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    if not await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Vendor not found")
    ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "png"
    path = f"vendors/{vendor_id}/{uuid.uuid4()}.{ext}"
    save_file(path, await file.read())
    logo_url = f"/api/files/{path}"
    await db.vendors.update_one({"vendor_id": vendor_id}, {"$set": {"logo_url": logo_url}})
    return {"logo_url": logo_url}


# ==================== PURCHASE ITEM MASTER ====================
# Raw materials / packaging / supplies that are NOT finished products (dies).

class PurchaseItemIn(BaseModel):
    name: str
    code: Optional[str] = ""
    category: Optional[str] = ""
    uom: Optional[str] = "pcs"
    hsn: Optional[str] = ""
    gst_pct: float = 0
    default_rate: float = 0
    min_level: int = 0
    stock_qty: int = 0
    is_active: bool = True


@router.get("/purchase-items")
async def list_purchase_items(request: Request, include_inactive: bool = False):
    await get_current_user(request)
    query = {} if include_inactive else {"is_active": {"$ne": False}}
    return await db.purchase_items.find(query, {"_id": 0}).sort("name", 1).to_list(2000)


@router.post("/purchase-items")
async def create_purchase_item(payload: PurchaseItemIn, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Item name is required")
    pid = _new_id("pitem")
    doc = {
        "purchase_item_id": pid,
        **payload.model_dump(),
        "name": name,
        "image_url": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.purchase_items.insert_one(doc)
    return await db.purchase_items.find_one({"purchase_item_id": pid}, {"_id": 0})


@router.put("/purchase-items/{item_id}")
async def update_purchase_item(item_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    updates = await request.json()
    # stock_qty changes only via stock-in movements, never a free-form edit.
    safe = {k: v for k, v in updates.items()
            if k not in ("purchase_item_id", "_id", "created_at", "stock_qty")}
    safe["updated_at"] = _now()
    if safe:
        await db.purchase_items.update_one({"purchase_item_id": item_id}, {"$set": safe})
    return await db.purchase_items.find_one({"purchase_item_id": item_id}, {"_id": 0})


@router.delete("/purchase-items/{item_id}")
async def delete_purchase_item(item_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write_delete")
    await db.purchase_items.update_one({"purchase_item_id": item_id}, {"$set": {"is_active": False, "updated_at": _now()}})
    return {"message": "Purchase item deactivated"}


@router.post("/purchase-items/{item_id}/upload-image")
async def upload_purchase_item_image(item_id: str, request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    if not await db.purchase_items.find_one({"purchase_item_id": item_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Purchase item not found")
    ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "png"
    path = f"purchase_items/{item_id}/{uuid.uuid4()}.{ext}"
    save_file(path, await file.read())
    image_url = f"/api/files/{path}"
    await db.purchase_items.update_one({"purchase_item_id": item_id}, {"$set": {"image_url": image_url}})
    return {"image_url": image_url}


# ==================== UNIFIED ITEM CATALOG ====================
# One list spanning finished products (dies) + purchase_items, for the image picker.

@router.get("/procurement/item-catalog")
async def item_catalog(request: Request, q: Optional[str] = None, source: Optional[str] = None):
    """Unified catalog for the procurement item picker.

    Returns rows with a stable `item_ref` ({source, id}) plus display fields.
    `source` filter in {die, purchase_item}; `q` matches name/code (case-insensitive).
    """
    await get_current_user(request)
    rows: List[dict] = []

    if source in (None, "die"):
        dies = await db.dies.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(5000)
        for d in dies:
            rows.append({
                "item_ref": {"source": "die", "id": d.get("die_id")},
                "source": "die",
                "id": d.get("die_id"),
                "name": d.get("name"),
                "code": d.get("code"),
                "image_url": d.get("image_url"),
                "uom": "pcs",
                "hsn": d.get("hsn", ""),
                "gst_pct": d.get("gst_pct", 0),
                "default_rate": d.get("purchase_rate", 0) or 0,
                "stock_qty": d.get("stock_qty", 0),
                "reserved_qty": d.get("reserved_qty", 0),
                "available_qty": (d.get("stock_qty", 0) or 0) - (d.get("reserved_qty", 0) or 0),
            })

    if source in (None, "purchase_item"):
        items = await db.purchase_items.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(5000)
        for it in items:
            rows.append({
                "item_ref": {"source": "purchase_item", "id": it.get("purchase_item_id")},
                "source": "purchase_item",
                "id": it.get("purchase_item_id"),
                "name": it.get("name"),
                "code": it.get("category", ""),
                "image_url": it.get("image_url"),
                "uom": it.get("uom", "pcs"),
                "hsn": it.get("hsn", ""),
                "gst_pct": it.get("gst_pct", 0),
                "default_rate": it.get("default_rate", 0) or 0,
                "stock_qty": it.get("stock_qty", 0),
                "reserved_qty": 0,
                "available_qty": it.get("stock_qty", 0) or 0,
            })

    if q:
        ql = q.strip().lower()
        rows = [r for r in rows if ql in (r.get("name") or "").lower()
                or ql in (str(r.get("code") or "").lower())]

    rows.sort(key=lambda r: (r.get("name") or "").lower())
    return rows


# ==================== DASHBOARD SUMMARY ====================

@router.get("/procurement/summary")
async def procurement_summary(request: Request):
    """At-a-glance KPIs for the procurement dashboard."""
    await get_current_user(request)

    async def counts_by_status(coll):
        out = {}
        async for row in db[coll].aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
            out[row.get("_id") or "unknown"] = row.get("n", 0)
        return out

    req_by_status = await counts_by_status("requisitions")
    po_by_status = await counts_by_status("purchase_orders")

    # committed spend = grand_total of POs that are live (not draft/cancelled)
    committed = 0.0
    open_value = 0.0
    async for po in db.purchase_orders.find(
            {}, {"_id": 0, "status": 1, "grand_total": 1}):
        gt = float(po.get("grand_total") or 0)
        st = po.get("status")
        if st in ("approved", "sent", "partially_received", "received", "closed"):
            committed += gt
        if st in ("draft", "approved", "sent", "partially_received"):
            open_value += gt

    pending_qc = await db.goods_receipts.count_documents({"status": {"$in": ["pending_qc", "qc_in_progress"]}})

    returns_count = await db.vendor_returns.count_documents({})
    returns_value = 0.0
    async for r in db.vendor_returns.find({}, {"_id": 0, "grand_total": 1}):
        returns_value += float(r.get("grand_total") or 0)

    # top vendors by committed spend
    top_vendors = []
    async for row in db.purchase_orders.aggregate([
        {"$match": {"status": {"$in": ["approved", "sent", "partially_received", "received", "closed"]}}},
        {"$group": {"_id": "$vendor_name", "spend": {"$sum": "$grand_total"}, "orders": {"$sum": 1}}},
        {"$sort": {"spend": -1}}, {"$limit": 5},
    ]):
        top_vendors.append({"vendor": row.get("_id") or "—",
                            "spend": round2(row.get("spend", 0)), "orders": row.get("orders", 0)})

    recent_pos = await db.purchase_orders.find(
        {}, {"_id": 0, "po_no": 1, "vendor_name": 1, "grand_total": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).limit(6).to_list(6)

    return {
        "requisitions": {"by_status": req_by_status, "total": sum(req_by_status.values()),
                         "needs_approval": req_by_status.get("submitted", 0)},
        "purchase_orders": {"by_status": po_by_status, "total": sum(po_by_status.values()),
                            "awaiting_approval": po_by_status.get("draft", 0),
                            "committed_value": round2(committed), "open_value": round2(open_value)},
        "pending_qc": pending_qc,
        "returns": {"count": returns_count, "value": round2(returns_value)},
        "vendors_active": await db.vendors.count_documents({"is_active": {"$ne": False}}),
        "top_vendors": top_vendors,
        "recent_pos": recent_pos,
    }


@router.get("/procurement/po-report")
async def po_report(request: Request, only_open: bool = True):
    """Per-line ordered/received/balance across purchase orders."""
    await get_current_user(request)
    query = {}
    if only_open:
        query["status"] = {"$in": ["approved", "sent", "partially_received"]}
    rows = []
    async for po in db.purchase_orders.find(query, {"_id": 0}):
        for l in po.get("lines", []):
            ordered = float(l.get("qty", 0) or 0)
            received = float(l.get("received_qty", 0) or 0)
            rows.append({
                "po_id": po["po_id"], "po_no": po.get("po_no"),
                "vendor_name": po.get("vendor_name"), "status": po.get("status"),
                "expected_date": po.get("expected_date"),
                "item_ref": l.get("item_ref"), "name": l.get("name"), "code": l.get("code", ""),
                "uom": l.get("uom", "pcs"),
                "ordered_qty": ordered, "received_qty": received,
                "balance_qty": round2(ordered - received),
            })
    rows.sort(key=lambda r: (r.get("expected_date") or "9999", r.get("po_no") or ""))
    return rows


# ==================== VENDOR PRICE LIST (vendor_items) ====================

class VendorItemIn(BaseModel):
    vendor_id: str
    item_ref: Dict[str, Any]            # {"source": "die"|"purchase_item", "id": "..."}
    name: Optional[str] = ""            # cached display name
    default_rate: float = 0
    hsn: Optional[str] = ""
    gst_pct: float = 0
    uom: Optional[str] = "pcs"
    lead_time_days: int = 0
    is_active: bool = True


@router.get("/vendor-items")
async def list_vendor_items(request: Request, vendor_id: Optional[str] = None,
                            item_id: Optional[str] = None):
    await get_current_user(request)
    query: dict = {"is_active": {"$ne": False}}
    if vendor_id:
        query["vendor_id"] = vendor_id
    if item_id:
        query["item_ref.id"] = item_id
    return await db.vendor_items.find(query, {"_id": 0}).to_list(5000)


@router.post("/vendor-items")
async def create_vendor_item(payload: VendorItemIn, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    ref = payload.item_ref or {}
    if ref.get("source") not in ("die", "purchase_item") or not ref.get("id"):
        raise HTTPException(status_code=400, detail="item_ref must be {source, id}")
    if not await db.vendors.find_one({"vendor_id": payload.vendor_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Vendor not found")
    # one price row per (vendor, item)
    existing = await db.vendor_items.find_one(
        {"vendor_id": payload.vendor_id, "item_ref.source": ref["source"],
         "item_ref.id": ref["id"]}, {"_id": 0})
    data = payload.model_dump()
    if existing:
        data["updated_at"] = _now()
        await db.vendor_items.update_one(
            {"vendor_item_id": existing["vendor_item_id"]}, {"$set": data})
        return await db.vendor_items.find_one(
            {"vendor_item_id": existing["vendor_item_id"]}, {"_id": 0})
    vid = _new_id("vitem")
    await db.vendor_items.insert_one({
        "vendor_item_id": vid, **data, "created_at": _now(), "updated_at": _now()})
    return await db.vendor_items.find_one({"vendor_item_id": vid}, {"_id": 0})


@router.put("/vendor-items/{vendor_item_id}")
async def update_vendor_item(vendor_item_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    updates = await request.json()
    safe = {k: v for k, v in updates.items() if k not in ("vendor_item_id", "_id", "created_at")}
    safe["updated_at"] = _now()
    if safe:
        await db.vendor_items.update_one({"vendor_item_id": vendor_item_id}, {"$set": safe})
    return await db.vendor_items.find_one({"vendor_item_id": vendor_item_id}, {"_id": 0})


@router.delete("/vendor-items/{vendor_item_id}")
async def delete_vendor_item(vendor_item_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write_delete")
    await db.vendor_items.delete_one({"vendor_item_id": vendor_item_id})
    return {"message": "Vendor price row removed"}


# ==================== QC CHECKLIST TEMPLATES ====================

_DEFAULT_QC_TEMPLATES = [
    {"name": "General Inbound QC", "checks": [
        {"label": "Quantity matches PO", "type": "boolean"},
        {"label": "No visible damage", "type": "boolean"},
        {"label": "Correct specification", "type": "boolean"},
        {"label": "Packaging intact", "type": "boolean"},
        {"label": "Remarks", "type": "text"},
    ]},
]


@router.get("/qc-templates")
async def list_qc_templates(request: Request):
    await get_current_user(request)
    items = await db.qc_checklist_templates.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    if not items:
        for t in _DEFAULT_QC_TEMPLATES:
            await db.qc_checklist_templates.insert_one({
                "template_id": _new_id("qct"), **t, "is_active": True, "created_at": _now()})
        items = await db.qc_checklist_templates.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return items


@router.post("/qc-templates")
async def create_qc_template(request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")
    tid = _new_id("qct")
    await db.qc_checklist_templates.insert_one({
        "template_id": tid, "name": name, "checks": body.get("checks", []),
        "is_active": True, "created_at": _now()})
    return await db.qc_checklist_templates.find_one({"template_id": tid}, {"_id": 0})


@router.put("/qc-templates/{template_id}")
async def update_qc_template(template_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "checks", "is_active") if k in body}
    if allowed:
        await db.qc_checklist_templates.update_one({"template_id": template_id}, {"$set": allowed})
    return await db.qc_checklist_templates.find_one({"template_id": template_id}, {"_id": 0})


@router.delete("/qc-templates/{template_id}")
async def delete_qc_template(template_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write_delete")
    await db.qc_checklist_templates.delete_one({"template_id": template_id})
    return {"message": "QC template deleted"}


# ==================== ITEM RESOLUTION HELPERS ====================

async def _item_display(item_ref: dict) -> dict:
    """Resolve name/image/hsn/gst/uom/default_rate/code for a {source,id} ref."""
    ref = item_ref or {}
    src, _id = ref.get("source"), ref.get("id")
    if src == "die":
        d = await db.dies.find_one({"die_id": _id}, {"_id": 0}) or {}
        return {"name": d.get("name", _id), "code": d.get("code", ""),
                "image_url": d.get("image_url"),
                "hsn": d.get("hsn", ""), "gst_pct": d.get("gst_pct", 0),
                "uom": "pcs", "default_rate": d.get("purchase_rate", 0) or 0}
    if src == "purchase_item":
        it = await db.purchase_items.find_one({"purchase_item_id": _id}, {"_id": 0}) or {}
        return {"name": it.get("name", _id), "code": it.get("code", ""),
                "image_url": it.get("image_url"),
                "hsn": it.get("hsn", ""), "gst_pct": it.get("gst_pct", 0),
                "uom": it.get("uom", "pcs"), "default_rate": it.get("default_rate", 0) or 0}
    return {"name": str(_id), "code": "", "image_url": None, "hsn": "", "gst_pct": 0,
            "uom": "pcs", "default_rate": 0}


async def _vendor_price(vendor_id: str, item_ref: dict) -> Optional[dict]:
    ref = item_ref or {}
    return await db.vendor_items.find_one(
        {"vendor_id": vendor_id, "item_ref.source": ref.get("source"),
         "item_ref.id": ref.get("id")}, {"_id": 0})


async def _tax_mode_for_vendor(vendor: dict) -> str:
    company_sc = await _company_state_code()
    vendor_sc = str((vendor or {}).get("state_code") or "").strip()
    # default to intra-state when company state unknown (most common single-state setup)
    if company_sc and vendor_sc and company_sc != vendor_sc:
        return "inter"
    return "intra"


async def _price_po_line(vendor_id: str, tax_mode: str, raw: dict) -> dict:
    """Build a fully-priced PO line from a raw {item_ref, qty, rate?, ...}."""
    ref = raw.get("item_ref") or {}
    disp = await _item_display(ref)
    vp = await _vendor_price(vendor_id, ref) or {}
    qty = float(raw.get("qty") or 0)
    rate = raw.get("rate")
    if rate in (None, "", 0):
        rate = vp.get("default_rate") or disp.get("default_rate") or 0
    rate = float(rate or 0)
    hsn = raw.get("hsn") or vp.get("hsn") or disp.get("hsn") or ""
    gst_pct = raw.get("gst_pct")
    if gst_pct in (None, ""):
        gst_pct = vp.get("gst_pct") if vp.get("gst_pct") not in (None, "") else disp.get("gst_pct")
    gst_pct = float(gst_pct or 0)
    uom = raw.get("uom") or vp.get("uom") or disp.get("uom") or "pcs"
    name = raw.get("name") or vp.get("name") or disp.get("name")
    code = raw.get("code") or vp.get("code") or disp.get("code") or ""
    gst = compute_gst_line(qty, rate, gst_pct, tax_mode)
    return {
        "item_ref": ref, "name": name, "code": code, "image_url": disp.get("image_url"),
        "hsn": hsn, "qty": qty, "uom": uom, "rate": round2(rate), "gst_pct": gst_pct,
        **gst,
    }


def _sum_po_totals(lines: List[dict]) -> dict:
    subtotal = round2(sum(l.get("taxable", 0) for l in lines))
    tax_total = round2(sum((l.get("cgst", 0) + l.get("sgst", 0) + l.get("igst", 0)) for l in lines))
    grand = round2(subtotal + tax_total)
    return {"subtotal": subtotal, "tax_total": tax_total, "grand_total": grand}


# ==================== REQUISITION ====================

@router.get("/requisitions")
async def list_requisitions(request: Request, status: Optional[str] = None):
    await get_current_user(request)
    query: dict = {}
    if status:
        query["status"] = status
    return await db.requisitions.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/requisitions/{requisition_id}")
async def get_requisition(requisition_id: str, request: Request):
    await get_current_user(request)
    r = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return r


async def _build_req_lines(raw_lines: List[dict]) -> List[dict]:
    out = []
    for raw in raw_lines or []:
        ref = raw.get("item_ref") or {}
        disp = await _item_display(ref)
        out.append({
            "item_ref": ref,
            "name": raw.get("name") or disp.get("name"),
            "code": raw.get("code") or disp.get("code") or "",
            "image_url": disp.get("image_url"),
            "qty": float(raw.get("qty") or 0),
            "uom": raw.get("uom") or disp.get("uom") or "pcs",
            "est_rate": float(raw.get("est_rate") or disp.get("default_rate") or 0),
        })
    return out


@router.post("/requisitions")
async def create_requisition(request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    rid = _new_id("req")
    req_no = await next_number("requisition", "REQ")
    lines = await _build_req_lines(body.get("lines", []))
    doc = {
        "requisition_id": rid, "req_no": req_no, "status": "draft",
        "requested_by": user["email"], "notes": body.get("notes", ""),
        "lines": lines, "approval": None,
        "timeline": [_timeline_entry("created", user["email"])],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.requisitions.insert_one(doc)
    await log_stage("requisition", rid, None, "draft", user["email"])
    return await db.requisitions.find_one({"requisition_id": rid}, {"_id": 0})


@router.put("/requisitions/{requisition_id}")
async def update_requisition(requisition_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    if req.get("status") not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Only draft/rejected requisitions can be edited")
    body = await request.json()
    updates: dict = {"updated_at": _now()}
    if "notes" in body:
        updates["notes"] = body["notes"]
    if "lines" in body:
        updates["lines"] = await _build_req_lines(body["lines"])
    await db.requisitions.update_one({"requisition_id": requisition_id}, {"$set": updates})
    return await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})


async def _transition_req(requisition_id: str, user: dict, to_status: str,
                          allowed_from: tuple, remark: str = "",
                          extra: Optional[dict] = None) -> dict:
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    cur = req.get("status")
    if cur not in allowed_from:
        raise HTTPException(status_code=400, detail=f"Cannot move requisition from '{cur}' to '{to_status}'")
    set_doc = {"status": to_status, "updated_at": _now(),
               **(extra or {})}
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": set_doc,
         "$push": {"timeline": _timeline_entry(to_status, user["email"], remark)}})
    await log_stage("requisition", requisition_id, cur, to_status, user["email"], remark)
    return await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})


@router.post("/requisitions/{requisition_id}/submit")
async def submit_requisition(requisition_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    return await _transition_req(requisition_id, user, "submitted", ("draft", "rejected"))


@router.post("/requisitions/{requisition_id}/approve")
async def approve_requisition(requisition_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json() if await _has_body(request) else {}
    remark = (body or {}).get("remark", "")
    return await _transition_req(
        requisition_id, user, "approved", ("submitted",), remark,
        extra={"approval": {"by": user["email"], "at": _now(), "remark": remark}})


@router.post("/requisitions/{requisition_id}/reject")
async def reject_requisition(requisition_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json() if await _has_body(request) else {}
    remark = (body or {}).get("remark", "")
    return await _transition_req(
        requisition_id, user, "rejected", ("submitted",), remark,
        extra={"approval": {"by": user["email"], "at": _now(), "remark": remark}})


async def _has_body(request: Request) -> bool:
    try:
        body = await request.body()
        return bool(body)
    except Exception:
        return False


@router.post("/requisitions/{requisition_id}/convert-to-po")
async def convert_requisition_to_po(requisition_id: str, request: Request):
    """Create a draft PO from an approved requisition for a chosen vendor."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    req = await db.requisitions.find_one({"requisition_id": requisition_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    if req.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Requisition must be approved before creating a PO")
    body = await request.json()
    vendor_id = body.get("vendor_id")
    vendor = await db.vendors.find_one({"vendor_id": vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # Atomically claim the requisition so it converts to exactly one PO.
    claimed = await db.requisitions.find_one_and_update(
        {"requisition_id": requisition_id, "status": "approved"},
        {"$set": {"status": "converting", "updated_at": _now()}}, return_document=True)
    if not claimed:
        raise HTTPException(status_code=400, detail="Requisition already converted")
    try:
        raw_lines = [{"item_ref": l["item_ref"], "qty": l["qty"], "uom": l.get("uom"),
                      "name": l.get("name"), "rate": l.get("est_rate")} for l in req.get("lines", [])]
        po = await _create_po_doc(user, vendor, raw_lines, origin="requisition",
                                  requisition_id=requisition_id,
                                  terms=body.get("terms", ""), expected_date=body.get("expected_date"))
    except Exception:
        # roll the requisition back so it can be retried
        await db.requisitions.update_one({"requisition_id": requisition_id},
                                         {"$set": {"status": "approved", "updated_at": _now()}})
        raise
    await db.requisitions.update_one(
        {"requisition_id": requisition_id},
        {"$set": {"status": "converted", "po_id": po["po_id"], "updated_at": _now()},
         "$push": {"timeline": _timeline_entry("converted", user["email"], f"PO {po.get('po_no')}")}})
    await log_stage("requisition", requisition_id, "approved", "converted", user["email"])
    return po


# ==================== PURCHASE ORDER ====================

async def _create_po_doc(user: dict, vendor: dict, raw_lines: List[dict],
                         origin: str, requisition_id: Optional[str] = None,
                         terms: str = "", expected_date: Optional[str] = None) -> dict:
    tax_mode = await _tax_mode_for_vendor(vendor)
    lines = [await _price_po_line(vendor["vendor_id"], tax_mode, rl) for rl in raw_lines]
    for l in lines:
        l["received_qty"] = 0.0   # cumulative accepted qty across goods receipts
    totals = _sum_po_totals(lines)
    po_id = _new_id("po")
    po_no = await next_number("po", "PO")
    doc = {
        "po_id": po_id, "po_no": po_no, "origin": origin,
        "requisition_id": requisition_id, "vendor_id": vendor["vendor_id"],
        "vendor_name": vendor.get("name"), "status": "draft", "tax_mode": tax_mode,
        "lines": lines, **totals, "terms": terms, "expected_date": expected_date,
        "approval": None,
        "timeline": [_timeline_entry("created", user["email"])],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.purchase_orders.insert_one(doc)
    await log_stage("po", po_id, None, "draft", user["email"])
    return await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})


@router.get("/purchase-orders")
async def list_purchase_orders(request: Request, status: Optional[str] = None,
                               vendor_id: Optional[str] = None):
    await get_current_user(request)
    query: dict = {}
    if status:
        query["status"] = status
    if vendor_id:
        query["vendor_id"] = vendor_id
    return await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, request: Request):
    await get_current_user(request)
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po


@router.post("/purchase-orders")
async def create_purchase_order(request: Request):
    """Direct Order Planning entry point (origin='direct')."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    vendor = await db.vendors.find_one({"vendor_id": body.get("vendor_id")}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if not body.get("lines"):
        raise HTTPException(status_code=400, detail="At least one line item is required")
    return await _create_po_doc(
        user, vendor, body["lines"], origin=body.get("origin", "direct"),
        requisition_id=body.get("requisition_id"),
        terms=body.get("terms", ""), expected_date=body.get("expected_date"))


@router.put("/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.get("status") not in ("draft",):
        raise HTTPException(status_code=400, detail="Only draft POs can be edited")
    body = await request.json()
    updates: dict = {"updated_at": _now()}
    if "terms" in body:
        updates["terms"] = body["terms"]
    if "expected_date" in body:
        updates["expected_date"] = body["expected_date"]
    if "lines" in body:
        tax_mode = po.get("tax_mode") or "intra"
        lines = [await _price_po_line(po["vendor_id"], tax_mode, rl) for rl in body["lines"]]
        for l in lines:
            l["received_qty"] = 0.0
        updates["lines"] = lines
        updates.update(_sum_po_totals(lines))
    await db.purchase_orders.update_one({"po_id": po_id}, {"$set": updates})
    return await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})


async def _transition_po(po_id: str, user: dict, to_status: str, allowed_from: tuple,
                         remark: str = "", extra: Optional[dict] = None) -> dict:
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    cur = po.get("status")
    if cur not in allowed_from:
        raise HTTPException(status_code=400, detail=f"Cannot move PO from '{cur}' to '{to_status}'")
    await db.purchase_orders.update_one(
        {"po_id": po_id},
        {"$set": {"status": to_status, "updated_at": _now(), **(extra or {})},
         "$push": {"timeline": _timeline_entry(to_status, user["email"], remark)}})
    await log_stage("po", po_id, cur, to_status, user["email"], remark)
    return await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})


@router.post("/purchase-orders/{po_id}/approve")
async def approve_po(po_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    return await _transition_po(po_id, user, "approved", ("draft",),
                                extra={"approval": {"by": user["email"], "at": _now()}})


@router.post("/purchase-orders/{po_id}/send")
async def send_po(po_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    return await _transition_po(po_id, user, "sent", ("approved",))


@router.post("/purchase-orders/{po_id}/cancel")
async def cancel_po(po_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    return await _transition_po(po_id, user, "cancelled",
                                ("draft", "approved", "sent", "partially_received"))


@router.get("/purchase-orders/{po_id}/pdf")
async def purchase_order_pdf(po_id: str, request: Request):
    await get_current_user(request)
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    vendor = await db.vendors.find_one({"vendor_id": po.get("vendor_id")}, {"_id": 0}) or {}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_po_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf_bytes = generate_po_pdf(po, vendor, company)
    return StreamingResponse(
        _io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po.get("po_no", "PO")}.pdf"'})


@router.get("/purchase-orders/{po_id}/packing-list-pdf")
async def purchase_order_packing_list(po_id: str, request: Request):
    await get_current_user(request)
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    vendor = await db.vendors.find_one({"vendor_id": po.get("vendor_id")}, {"_id": 0}) or {}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_packing_list_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf = generate_packing_list_pdf(po, vendor, company)
    return StreamingResponse(_io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po.get("po_no", "PO")}-packing-list.pdf"'})


# ==================== GOODS RECEIPT / VERIFICATION ====================

@router.post("/purchase-orders/{po_id}/receive")
async def create_goods_receipt(po_id: str, request: Request):
    """Open a Goods Receipt (GRN) pre-filled from the PO lines for verification."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.get("status") not in ("approved", "sent", "partially_received"):
        raise HTTPException(status_code=400, detail="PO must be approved/sent before receiving")
    open_grn = await db.goods_receipts.find_one(
        {"po_id": po_id, "status": {"$in": ["pending_qc", "qc_in_progress"]}}, {"_id": 0})
    if open_grn:
        raise HTTPException(status_code=400,
                            detail=f"An open goods receipt ({open_grn['grn_no']}) already exists for this PO")
    grn_id = _new_id("grn")
    grn_no = await next_number("grn", "GRN")
    lines = []
    for i, l in enumerate(po.get("lines", [])):
        ordered = float(l.get("qty", 0) or 0)
        already = float(l.get("received_qty", 0) or 0)
        outstanding = round2(ordered - already)
        if outstanding <= 0:
            continue  # this line is already fully received on an earlier GRN
        lines.append({
            "po_line_index": i, "item_ref": l["item_ref"], "name": l["name"],
            "code": l.get("code", ""),
            "image_url": l.get("image_url"), "ordered_qty": ordered,
            "outstanding_qty": outstanding, "received_qty": outstanding,
            "rate": l.get("rate", 0),
            "qc_status": "pending", "qc_template_id": None, "qc_results": [], "remark": "",
        })
    if not lines:
        raise HTTPException(status_code=400, detail="All items on this PO are already received")
    doc = {
        "grn_id": grn_id, "grn_no": grn_no, "po_id": po_id, "po_no": po.get("po_no"),
        "vendor_id": po.get("vendor_id"), "vendor_name": po.get("vendor_name"),
        "status": "pending_qc", "lines": lines, "received_by": user["email"],
        "received_date": _now()[:10],
        "timeline": [_timeline_entry("created", user["email"])],
        "created_at": _now(), "updated_at": _now(),
    }
    await db.goods_receipts.insert_one(doc)
    await log_stage("grn", grn_id, None, "pending_qc", user["email"])
    return await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})


@router.get("/goods-receipts")
async def list_goods_receipts(request: Request, status: Optional[str] = None,
                              po_id: Optional[str] = None):
    await get_current_user(request)
    query: dict = {}
    if status:
        query["status"] = status
    if po_id:
        query["po_id"] = po_id
    return await db.goods_receipts.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/goods-receipts/{grn_id}")
async def get_goods_receipt(grn_id: str, request: Request):
    await get_current_user(request)
    g = await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    return g


@router.put("/goods-receipts/{grn_id}")
async def update_goods_receipt(grn_id: str, request: Request):
    """Save received quantities / remarks before QC submission."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    g = await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    if g.get("status") == "qc_done":
        raise HTTPException(status_code=400, detail="QC already completed for this receipt")
    body = await request.json()
    set_extra = {}
    if "received_date" in body:
        set_extra["received_date"] = body["received_date"]
    incoming = {l.get("po_line_index"): l for l in body.get("lines", [])}
    new_lines = []
    for l in g["lines"]:
        upd = incoming.get(l["po_line_index"], {})
        new_lines.append({
            **l,
            "received_qty": float(upd.get("received_qty", l.get("received_qty", 0)) or 0),
            "remark": upd.get("remark", l.get("remark", "")),
        })
    await db.goods_receipts.update_one({"grn_id": grn_id},
                                       {"$set": {"lines": new_lines, "updated_at": _now(), **set_extra}})
    return await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})


async def _apply_stock_in(item_ref: dict, qty: float, grn_id: str, grn_no: str, user_email: str):
    """Record an inbound stock movement and bump the item's stock_qty.

    The movement doc matches the shape the existing Stock Management view reads
    (movement_id / die_code / die_name / movement_type / quantity / notes) and
    additionally carries `image_url` so inventory movement rows show the product
    image — for both finished products (dies) and purchase items.
    """
    ref = item_ref or {}
    src, _id = ref.get("source"), ref.get("id")
    qty = float(qty or 0)
    if qty <= 0 or not _id:
        return
    disp = await _item_display(ref)
    movement = {
        "movement_id": _new_id("mov"),
        "movement_type": "purchase_in",
        "quantity": qty,
        "item_ref": ref,
        "die_code": "",
        "die_name": disp.get("name"),
        "image_url": disp.get("image_url"),
        "sales_person_id": None,
        "sales_person_name": None,
        "notes": f"Purchase receipt {grn_no}",
        "reference_number": grn_no,
        "reference_id": grn_id,
        "movement_date": _now(),
        "by": user_email,
    }
    if src == "die":
        movement["die_id"] = _id
        d = await db.dies.find_one({"die_id": _id}, {"_id": 0}) or {}
        movement["die_code"] = d.get("code", "")
        await db.dies.update_one({"die_id": _id}, {"$inc": {"stock_qty": qty}})
    elif src == "purchase_item":
        movement["purchase_item_id"] = _id
        movement["die_code"] = (disp.get("name") or "")[:12]
        await db.purchase_items.update_one({"purchase_item_id": _id}, {"$inc": {"stock_qty": qty}})
    await db.stock_movements.insert_one(movement)


@router.post("/goods-receipts/{grn_id}/qc")
async def submit_qc(grn_id: str, request: Request):
    """Submit the QC checklist per line.

    Body: { lines: [{po_line_index, qc_status: ok|hold|return,
                     qc_template_id?, qc_results?, remark?}] }
    OK lines are stocked-in; hold/return lines are recorded but kept out of stock.
    """
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    # Atomically claim the receipt so QC (and its stock-in) can run exactly once,
    # even under double-click / retry / concurrent tabs.
    g = await db.goods_receipts.find_one_and_update(
        {"grn_id": grn_id, "status": "pending_qc"},
        {"$set": {"status": "qc_in_progress", "updated_at": _now()}},
        return_document=True)
    if not g:
        if not await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0}):
            raise HTTPException(status_code=404, detail="Goods receipt not found")
        raise HTTPException(status_code=400, detail="QC already completed or in progress")
    incoming = {l.get("po_line_index"): l for l in body.get("lines", [])}

    new_lines = []
    stocked = 0
    for l in g["lines"]:
        upd = incoming.get(l["po_line_index"], {})
        status = upd.get("qc_status", l.get("qc_status", "pending"))
        if status not in ("ok", "hold", "return"):
            raise HTTPException(status_code=400, detail=f"Invalid qc_status '{status}'")
        merged = {
            **l, "qc_status": status,
            "qc_template_id": upd.get("qc_template_id", l.get("qc_template_id")),
            "qc_results": upd.get("qc_results", l.get("qc_results", [])),
            "remark": upd.get("remark", l.get("remark", "")),
            "received_qty": float(upd.get("received_qty", l.get("received_qty", 0)) or 0),
        }
        if status == "ok":
            await _apply_stock_in(merged["item_ref"], merged["received_qty"],
                                  grn_id, g.get("grn_no"), user["email"])
            stocked += 1
        new_lines.append(merged)

    await db.goods_receipts.update_one(
        {"grn_id": grn_id},
        {"$set": {"lines": new_lines, "status": "qc_done", "updated_at": _now()},
         "$push": {"timeline": _timeline_entry("qc_done", user["email"],
                                               f"{stocked} line(s) stocked-in")}})
    await log_stage("grn", grn_id, "pending_qc", "qc_done", user["email"])

    # advance the PO using cumulative accepted quantities (partial-receipt aware)
    if g.get("po_id"):
        await _advance_po_after_qc(g["po_id"], new_lines, user, g.get("grn_no"))
    return await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})


async def _advance_po_after_qc(po_id: str, qc_lines: List[dict], user: dict, grn_no: str):
    """Add accepted (OK) quantities to each PO line and set the PO status.

    Only OK lines count as fulfilled; held/returned quantities stay outstanding
    so the remainder can be received on a later GRN. The PO becomes 'received'
    once every line is fully received, otherwise 'partially_received'.
    """
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        return
    lines = po.get("lines", [])
    for ql in qc_lines:
        if ql.get("qc_status") != "ok":
            continue
        idx = ql.get("po_line_index")
        if isinstance(idx, int) and 0 <= idx < len(lines):
            prev = float(lines[idx].get("received_qty", 0) or 0)
            lines[idx]["received_qty"] = round2(prev + float(ql.get("received_qty", 0) or 0))
    fully = all(float(l.get("received_qty", 0) or 0) >= float(l.get("qty", 0) or 0) for l in lines)
    new_status = "received" if fully else "partially_received"
    cur = po.get("status")
    set_doc = {"lines": lines, "updated_at": _now()}
    if cur in ("approved", "sent", "partially_received"):
        set_doc["status"] = new_status
        await db.purchase_orders.update_one(
            {"po_id": po_id},
            {"$set": set_doc,
             "$push": {"timeline": _timeline_entry(new_status, user["email"], f"GRN {grn_no}")}})
        await log_stage("po", po_id, cur, new_status, user["email"])
    else:
        await db.purchase_orders.update_one({"po_id": po_id}, {"$set": set_doc})


@router.post("/purchase-orders/{po_id}/close")
async def close_po(po_id: str, request: Request):
    """Settle a partially-received PO without receiving the remainder."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    return await _transition_po(po_id, user, "closed", ("partially_received", "received"))


# ==================== VENDOR RETURN / DEBIT NOTE ====================

@router.post("/goods-receipts/{grn_id}/create-return")
async def create_return(grn_id: str, request: Request):
    """Create a vendor return (debit note) from the GRN lines flagged 'return'."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    g = await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    if g.get("return_id"):
        raise HTTPException(status_code=400, detail="A return note already exists for this receipt")
    return_lines = [
        {"item_ref": l["item_ref"], "name": l["name"], "qty": l.get("received_qty", 0),
         "rate": l.get("rate", 0), "reason": l.get("remark", "") or "Rejected at QC"}
        for l in g.get("lines", []) if l.get("qc_status") == "return"
    ]
    if not return_lines:
        raise HTTPException(status_code=400, detail="No lines marked for return")
    grand = round2(sum(float(l["qty"] or 0) * float(l["rate"] or 0) for l in return_lines))
    return_id = _new_id("ret")
    return_no = await next_number("return", "RET")
    doc = {
        "return_id": return_id, "return_no": return_no, "grn_id": grn_id,
        "grn_no": g.get("grn_no"), "vendor_id": g.get("vendor_id"),
        "vendor_name": g.get("vendor_name"), "lines": return_lines,
        "grand_total": grand, "created_by": user["email"], "created_at": _now(),
    }
    await db.vendor_returns.insert_one(doc)
    await db.goods_receipts.update_one({"grn_id": grn_id}, {"$set": {"return_id": return_id}})
    return await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})


@router.get("/vendor-returns")
async def list_vendor_returns(request: Request, vendor_id: Optional[str] = None):
    await get_current_user(request)
    query = {"vendor_id": vendor_id} if vendor_id else {}
    return await db.vendor_returns.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


_OPEN_ORDER_STATUSES = ("pending", "confirmed")
_DEAD_ITEM_STATUSES = ("cancelled", "released", "delivered")


@router.get("/procurement/demand")
async def sales_order_demand(request: Request, shortfall_only: bool = False):
    """Required quantities from open sales orders vs available stock."""
    await get_current_user(request)
    open_ids = [o["order_id"] async for o in db.orders.find(
        {"order_status": {"$in": list(_OPEN_ORDER_STATUSES)}}, {"_id": 0, "order_id": 1})]
    required = {}
    if open_ids:
        async for it in db.order_items.find(
                {"order_id": {"$in": open_ids}}, {"_id": 0, "die_id": 1, "quantity": 1, "status": 1}):
            if it.get("status") in _DEAD_ITEM_STATUSES:
                continue
            did = it.get("die_id")
            if did:
                required[did] = required.get(did, 0) + float(it.get("quantity", 0) or 0)
    rows = []
    for did, req_qty in required.items():
        d = await db.dies.find_one({"die_id": did}, {"_id": 0}) or {}
        phys = float(d.get("stock_qty", 0) or 0)
        reserved = float(d.get("reserved_qty", 0) or 0)
        avail = phys - reserved
        shortfall = max(0.0, round2(req_qty - avail))
        if shortfall_only and shortfall <= 0:
            continue
        rows.append({
            "die_id": did, "item_ref": {"source": "die", "id": did},
            "name": d.get("name", did), "code": d.get("code", ""), "image_url": d.get("image_url"),
            "uom": "pcs", "gst_pct": d.get("gst_pct", 0), "default_rate": d.get("purchase_rate", 0) or 0,
            "required_qty": round2(req_qty), "physical_qty": phys, "reserved_qty": reserved,
            "available_qty": round2(avail), "shortfall_qty": shortfall,
        })
    rows.sort(key=lambda r: -r["shortfall_qty"])
    return rows


def group_demand_by_school(lines):
    """Group per-order demand lines into per-school buckets.

    `lines` is a list of {school_name, order_number, order_id, quantity}.
    Returns a list of {school_name, total_qty, order_count, orders[...]} sorted
    by total_qty descending."""
    buckets = {}
    for ln in lines or []:
        school = ln.get("school_name") or "—"
        b = buckets.setdefault(school, {"school_name": school, "total_qty": 0.0, "orders": []})
        qty = float(ln.get("quantity", 0) or 0)
        b["total_qty"] += qty
        b["orders"].append({
            "order_id": ln.get("order_id"),
            "order_number": ln.get("order_number"),
            "quantity": qty,
        })
    out = list(buckets.values())
    for b in out:
        b["total_qty"] = round2(b["total_qty"])
        b["order_count"] = len(b["orders"])
    out.sort(key=lambda b: -b["total_qty"])
    return out


@router.get("/procurement/demand/{die_id}")
async def sales_order_demand_detail(die_id: str, request: Request):
    """Drill-down for one die: which schools/orders need it, plus the stock summary.

    Powers the "click the shortfall to see why" detail on Procurement and Store."""
    await get_current_user(request)
    d = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Item not found")
    open_orders = await db.orders.find(
        {"order_status": {"$in": list(_OPEN_ORDER_STATUSES)}},
        {"_id": 0, "order_id": 1, "order_number": 1, "school_name": 1}).to_list(20000)
    omap = {o["order_id"]: o for o in open_orders}
    lines = []
    if omap:
        async for it in db.order_items.find(
                {"die_id": die_id, "order_id": {"$in": list(omap)}},
                {"_id": 0, "order_id": 1, "quantity": 1, "status": 1}):
            if it.get("status") in _DEAD_ITEM_STATUSES:
                continue
            o = omap.get(it.get("order_id"), {})
            lines.append({
                "school_name": o.get("school_name"),
                "order_number": o.get("order_number"),
                "order_id": it.get("order_id"),
                "quantity": float(it.get("quantity", 0) or 0),
            })
    schools = group_demand_by_school(lines)
    phys = float(d.get("stock_qty", 0) or 0)
    reserved = float(d.get("reserved_qty", 0) or 0)
    avail = phys - reserved
    required = round2(sum(float(l["quantity"]) for l in lines))
    return {
        "die_id": die_id, "name": d.get("name", die_id), "code": d.get("code", ""),
        "image_url": d.get("image_url"),
        "physical_qty": phys, "reserved_qty": reserved, "available_qty": round2(avail),
        "required_qty": required, "shortfall_qty": max(0.0, round2(required - avail)),
        "schools": schools,
    }


@router.get("/vendor-returns/{return_id}/pdf")
async def vendor_return_pdf(return_id: str, request: Request):
    await get_current_user(request)
    ret = await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    vendor = await db.vendors.find_one({"vendor_id": ret.get("vendor_id")}, {"_id": 0}) or {}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_return_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf_bytes = generate_return_pdf(ret, vendor, company)
    return StreamingResponse(
        _io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{ret.get("return_no", "RETURN")}.pdf"'})


# ==================== RETURNABLE CHALLANS ====================

_CHALLAN_TYPES = ("returnable_out", "returnable_in", "vendor_return_delivery")
_CHALLAN_REASONS = ("demo", "exhibition", "sampling", "other")


async def _adjust_die_stock_for_lines(lines, sign: int):
    """Move physical die stock when goods leave/return on a returnable challan.

    sign=-1 when items go OUT (stock leaves the building), +1 when they come back.
    Only lines that reference a die ({source:'die'}) affect inventory; purchase-item
    or vendor lines are ignored. `lines` is a list of (die_id, qty) pairs.

    Also writes a stock_movements log row so the change is visible in stock history
    — a return shows as a '+ back to stock' entry, mirroring dispatch deductions.
    """
    for die_id, qty in lines:
        q = int(round(float(qty or 0)))
        if die_id and q > 0:
            await db.dies.update_one({"die_id": die_id}, {"$inc": {"stock_qty": sign * q}})
            die = await db.dies.find_one({"die_id": die_id}, {"_id": 0, "code": 1, "name": 1}) or {}
            await db.stock_movements.insert_one({
                "movement_id": _new_id("mov"),
                "die_id": die_id,
                "die_code": die.get("code", ""),
                "die_name": die.get("name", ""),
                "movement_type": "returnable_in" if sign > 0 else "returnable_out",
                "quantity": q,
                "notes": "Returnable challan return" if sign > 0 else "Returnable challan out",
                "movement_date": _now(),
                "reference_number": None,
            })


def _die_line_pairs(lines):
    """Extract (die_id, qty) pairs from challan lines that reference a die."""
    pairs = []
    for ln in lines or []:
        ref = ln.get("item_ref") or {}
        if ref.get("source") == "die" and ref.get("id"):
            pairs.append((ref["id"], ln.get("qty", 0)))
    return pairs


async def _build_challan_lines(raw_lines):
    out = []
    for raw in raw_lines or []:
        ref = raw.get("item_ref") or {}
        disp = await _item_display(ref)
        out.append({
            "item_ref": ref, "name": raw.get("name") or disp.get("name"),
            "code": raw.get("code") or disp.get("code") or "",
            "uom": raw.get("uom") or disp.get("uom") or "pcs",
            "qty": float(raw.get("qty") or 0), "returned_qty": 0.0,
        })
    return out


@router.get("/challans")
async def list_challans(request: Request, type: Optional[str] = None, status: Optional[str] = None):
    await get_current_user(request)
    query = {}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    return await db.challans.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/challans/{challan_id}")
async def get_challan(challan_id: str, request: Request):
    await get_current_user(request)
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    return c


@router.post("/challans")
async def create_challan(request: Request):
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    body = await request.json()
    ctype = body.get("type")
    if ctype not in _CHALLAN_TYPES:
        raise HTTPException(status_code=400, detail="invalid challan type")
    if not body.get("lines"):
        raise HTTPException(status_code=400, detail="At least one line is required")
    cid = _new_id("chal")
    cno = await next_number("challan", "DC")
    reason = body.get("reason")
    if reason is not None and reason not in _CHALLAN_REASONS:
        raise HTTPException(status_code=400, detail="invalid reason")
    built_lines = await _build_challan_lines(body.get("lines", []))
    doc = {
        "challan_id": cid, "challan_no": cno, "type": ctype,
        "direction": body.get("direction", "outbound"),
        "party_type": body.get("party_type", "vendor"),
        "reason": reason,  # demo | exhibition | sampling | other (for returnable_out)
        "vendor_id": body.get("vendor_id"), "party_name": body.get("party_name", ""),
        "ref_type": body.get("ref_type"), "ref_id": body.get("ref_id"),
        "challan_date": body.get("challan_date") or _now()[:10],
        "expected_return_date": body.get("expected_return_date"),
        "notes": body.get("notes", ""),
        "lines": built_lines,
        "status": "open",
        "timeline": [_timeline_entry("created", user["email"])],
        "created_by": user["email"], "created_at": _now(), "updated_at": _now(),
    }
    await db.challans.insert_one(doc)
    # Goods leaving on a returnable challan reduce physical die stock.
    if ctype == "returnable_out":
        await _adjust_die_stock_for_lines(_die_line_pairs(built_lines), sign=-1)
    return await db.challans.find_one({"challan_id": cid}, {"_id": 0})


@router.post("/challans/{challan_id}/record-return")
async def record_challan_return(challan_id: str, request: Request):
    """Add returned quantities per line; set status open/partially_returned/closed."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    if c.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Challan already closed")
    body = await request.json()
    add = {}
    for l in body.get("lines", []):
        try:
            add[int(l["index"])] = float(l.get("returned_qty", 0) or 0)
        except (KeyError, ValueError, TypeError):
            continue  # ignore malformed line entries rather than 500
    lines = c.get("lines", [])
    restored = []  # (die_id, applied_qty) for stock restoration on returnable_out
    for idx, qty in add.items():
        if 0 <= idx < len(lines):
            prev = float(lines[idx].get("returned_qty", 0) or 0)
            cap = float(lines[idx].get("qty", 0) or 0)
            new_val = round2(min(cap, prev + qty))
            applied = new_val - prev  # actual delta after clamping
            lines[idx]["returned_qty"] = new_val
            ref = lines[idx].get("item_ref") or {}
            if applied > 0 and ref.get("source") == "die" and ref.get("id"):
                restored.append((ref["id"], applied))
    if c.get("type") == "returnable_out" and restored:
        await _adjust_die_stock_for_lines(restored, sign=+1)
    fully = all(float(l.get("returned_qty", 0) or 0) >= float(l.get("qty", 0) or 0) for l in lines)
    any_ret = any(float(l.get("returned_qty", 0) or 0) > 0 for l in lines)
    status = "closed" if fully else ("partially_returned" if any_ret else "open")
    await db.challans.update_one(
        {"challan_id": challan_id},
        {"$set": {"lines": lines, "status": status, "updated_at": _now()},
         "$push": {"timeline": _timeline_entry("return_recorded", user["email"])}})
    return await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})


@router.get("/challans/{challan_id}/pdf")
async def challan_pdf(challan_id: str, request: Request):
    await get_current_user(request)
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_challan_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf = generate_challan_pdf(c, company)
    return StreamingResponse(_io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{c.get("challan_no", "challan")}.pdf"'})


@router.post("/vendor-returns/{return_id}/challan")
async def challan_from_vendor_return(return_id: str, request: Request):
    """Create a delivery challan for the rejected goods of a vendor return."""
    user = await get_current_user(request)
    require_module(user, "procurement", "read_write")
    ret = await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    raw_lines = [{"item_ref": l.get("item_ref"), "name": l.get("name"), "qty": l.get("qty", 0)}
                 for l in ret.get("lines", [])]
    cid = _new_id("chal")
    cno = await next_number("challan", "DC")
    doc = {
        "challan_id": cid, "challan_no": cno, "type": "vendor_return_delivery",
        "direction": "outbound", "party_type": "vendor",
        "vendor_id": ret.get("vendor_id"), "party_name": ret.get("vendor_name", ""),
        "ref_type": "vendor_return", "ref_id": return_id,
        "challan_date": _now()[:10], "expected_return_date": None,
        "notes": f"Return goods for {ret.get('return_no')} (GRN {ret.get('grn_no')})",
        "lines": await _build_challan_lines(raw_lines),
        "status": "open", "timeline": [_timeline_entry("created", user["email"])],
        "created_by": user["email"], "created_at": _now(), "updated_at": _now(),
    }
    await db.challans.insert_one(doc)
    return await db.challans.find_one({"challan_id": cid}, {"_id": 0})
