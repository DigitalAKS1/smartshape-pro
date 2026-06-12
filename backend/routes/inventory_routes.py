from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response as FastAPIResponse, FileResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uuid
import csv
import io
import os
import re
import mimetypes

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_teams

router = APIRouter()

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


def save_file(path: str, data: bytes) -> str:
    """Save bytes to local uploads directory, return relative path."""
    full_path = os.path.join(UPLOADS_DIR, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(data)
    return path


# ==================== MODELS ====================

class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None
    stock_qty: int = 0


class StockMovementCreate(BaseModel):
    die_id: str
    movement_type: str
    quantity: int
    sales_person_id: Optional[str] = None
    notes: Optional[str] = None
    # physical_adjustment: the actual counted quantity (system stock is set to this)
    counted_qty: Optional[int] = None
    session_date: Optional[str] = None
    session_notes: Optional[str] = None
    reference_number: Optional[str] = None


# ==================== DIE ENDPOINTS ====================

def clean_die_code(raw: str) -> str:
    """Display code: trim, strip stray quotes, collapse internal whitespace to one space."""
    return re.sub(r"\s+", " ", (raw or "").strip().strip('"').strip())


def norm_die_code(raw: str) -> str:
    """Match key used to detect duplicates: no whitespace, no quotes, uppercase.
    So 'SSSD-07', 'SSSD-07 ' and '\"SSSD-07\"' all collide."""
    return re.sub(r"\s+", "", (raw or "").strip().strip('"').strip()).upper()


async def _code_in_use(norm: str, exclude_die_id: str = None) -> bool:
    """True if any existing die has the same normalized code."""
    q = {"die_id": {"$ne": exclude_die_id}} if exclude_die_id else {}
    async for d in db.dies.find(q, {"code": 1, "_id": 0}):
        if norm_die_code(d.get("code", "")) == norm:
            return True
    return False


@router.get("/dies")
async def get_dies(request: Request, include_archived: bool = False):
    await get_current_user(request)
    query = {} if include_archived else {"is_active": {"$ne": False}}
    dies = await db.dies.find(query, {"_id": 0}).to_list(1000)
    return dies


@router.post("/dies")
async def create_die(die_input: DieCreate, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die_id = f"die_{uuid.uuid4().hex[:12]}"
    data = die_input.model_dump()
    data["code"] = clean_die_code(data.get("code", ""))
    if data.get("name"):
        data["name"] = data["name"].strip()
    if not data["code"]:
        raise HTTPException(status_code=400, detail="Code is required")
    if await _code_in_use(norm_die_code(data["code"])):
        raise HTTPException(status_code=409, detail=f"A die with code '{data['code']}' already exists")
    initial_qty = data.pop("stock_qty", 0)
    die_doc = {
        "die_id": die_id,
        **data,
        "stock_qty": max(0, initial_qty),
        "reserved_qty": 0,
        "image_url": None,
        "is_active": True,
    }
    await db.dies.insert_one(die_doc)
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})


@router.put("/dies/{die_id}")
async def update_die(die_id: str, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    updates = await request.json()
    safe = {k: v for k, v in updates.items() if k not in ("die_id", "_id")}
    if "code" in safe:
        safe["code"] = clean_die_code(safe["code"])
        if not safe["code"]:
            raise HTTPException(status_code=400, detail="Code is required")
        if await _code_in_use(norm_die_code(safe["code"]), exclude_die_id=die_id):
            raise HTTPException(status_code=409, detail=f"A die with code '{safe['code']}' already exists")
    if isinstance(safe.get("name"), str):
        safe["name"] = safe["name"].strip()
    if safe:
        await db.dies.update_one({"die_id": die_id}, {"$set": safe})
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})


@router.put("/dies/{die_id}/archive")
async def archive_die(die_id: str, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    new_status = not die.get("is_active", True)
    await db.dies.update_one({"die_id": die_id}, {"$set": {"is_active": new_status}})
    updated = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    return updated


@router.delete("/dies/{die_id}")
async def delete_die(die_id: str, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin")  # only admin can hard-delete
    die = await db.dies.find_one({"die_id": die_id})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    await db.dies.delete_one({"die_id": die_id})
    return {"message": "Die deleted successfully"}


class BulkDeleteInput(BaseModel):
    die_ids: List[str]


@router.post("/dies/bulk-delete")
async def bulk_delete_dies(payload: BulkDeleteInput, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin")  # only admin can hard-delete
    ids = [i for i in (payload.die_ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No items selected")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Too many items in one request (max 500)")
    result = await db.dies.delete_many({"die_id": {"$in": ids}})
    return {"deleted": result.deleted_count, "requested": len(ids)}


@router.post("/dies/{die_id}/upload-image")
async def upload_die_image(die_id: str, request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"dies/{die_id}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    save_file(path, data)

    image_url = f"/api/files/{path}"
    await db.dies.update_one({"die_id": die_id}, {"$set": {"image_url": image_url}})
    return {"image_url": image_url}


@router.post("/dies/import")
async def import_dies_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    updated = 0
    errors = []

    def _norm_code(c):
        # Match ignoring stray quotes / spaces / tabs so re-imports update the
        # existing die instead of creating a whitespace-only duplicate.
        return re.sub(r"\s+", "", (c or "").strip().strip('"').strip()).upper()

    # Build a lookup of existing dies by normalized code (collection is small).
    existing_dies = await db.dies.find({}, {"die_id": 1, "code": 1, "_id": 0}).to_list(None)
    by_norm = {_norm_code(d.get("code", "")): d["die_id"] for d in existing_dies}

    valid_categories = {"decorative","flowers","leaf","alphabets","numbers","butterfly","borders","giant_flowers","3d_flowers","animals_birds","snowflake","fruits","shapes","other"}
    for row in reader:
        try:
            code = re.sub(r"\s+", " ", (row.get("code", "") or "").strip().strip('"').strip())
            name = (row.get("name", "") or "").strip()
            if not code or not name:
                errors.append("Row missing code or name")
                continue
            norm = _norm_code(code)
            sv = (row.get("stock_qty", "") or "").strip()
            stock_qty = int(sv) if sv.lstrip("-").isdigit() else 0
            raw_cat = row.get("category", "decorative").strip().lower().replace(" ", "_")
            category = raw_cat if raw_cat in valid_categories else "decorative"

            existing_id = by_norm.get(norm)
            if existing_id:
                # Update stock + metadata; preserve image_url and reserved_qty.
                await db.dies.update_one({"die_id": existing_id}, {"$set": {
                    "code": code,
                    "name": name,
                    "type": row.get("type", "standard").strip().lower(),
                    "category": category,
                    "stock_qty": stock_qty,
                    "min_level": int(row.get("min_level", 5) or 5),
                    "description": row.get("description", "").strip(),
                }})
                updated += 1
                continue

            die_id = f"die_{uuid.uuid4().hex[:8]}"
            await db.dies.insert_one({
                "die_id": die_id,
                "code": code,
                "name": name,
                "type": row.get("type", "standard").strip().lower(),
                "category": category,
                "stock_qty": stock_qty,
                "reserved_qty": 0,
                "min_level": int(row.get("min_level", 5) or 5),
                "image_url": "",
                "description": row.get("description", "").strip(),
                "is_active": True,
            })
            by_norm[norm] = die_id
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "updated": updated, "duplicates": 0, "errors": errors[:10]}


# ==================== FILE UPLOAD & PROXY ====================

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), request: Request = None):
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"uploads/{uuid.uuid4()}.{ext}"
    data = await file.read()
    save_file(path, data)
    return {"url": f"/api/files/{path}"}


_EXTRA_MIME = {".jfif": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif"}

@router.get("/files/{path:path}")
async def get_file(path: str):
    # Block path traversal: resolve the real path and confirm it stays inside the uploads
    # dir, so a crafted "../" link can't read server config/secrets outside the folder.
    base = os.path.realpath(UPLOADS_DIR)
    full_path = os.path.realpath(os.path.join(base, path))
    if full_path != base and not full_path.startswith(base + os.sep):
        raise HTTPException(status_code=403, detail="Invalid path")
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(full_path)[1].lower()
    media_type = _EXTRA_MIME.get(ext) or mimetypes.guess_type(full_path)[0] or "application/octet-stream"
    return FileResponse(full_path, media_type=media_type)


# ==================== PACKAGE ENDPOINTS ====================

@router.get("/packages")
async def get_packages():
    pkgs = await db.packages.find({}, {"_id": 0}).to_list(100)
    return pkgs


@router.post("/packages")
async def create_package(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    package_id = f"pkg_{uuid.uuid4().hex[:8]}"
    pkg_doc = {
        "package_id": package_id,
        "name": body.get("name", "").lower().replace(" ", "_"),
        "display_name": body.get("display_name", body.get("name", "")),
        "base_price": body.get("base_price", 0),
        "std_die_qty": body.get("std_die_qty", 0),
        "machine_qty": body.get("machine_qty", 0),
        "large_die_qty": body.get("large_die_qty", 0),
        "gst_pct": body.get("gst_pct", 18),
        "items": body.get("items", []),
        "is_active": True,
    }
    await db.packages.insert_one(pkg_doc)
    return await db.packages.find_one({"package_id": package_id}, {"_id": 0})


@router.put("/packages/{package_id}")
async def update_package(package_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for key in ("display_name", "base_price", "std_die_qty", "large_die_qty", "machine_qty", "gst_pct", "items", "is_active"):
        if key in body:
            allowed[key] = body[key]
    if allowed:
        await db.packages.update_one({"package_id": package_id}, {"$set": allowed})
    return await db.packages.find_one({"package_id": package_id}, {"_id": 0})


@router.delete("/packages/{package_id}")
async def delete_package(package_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.packages.delete_one({"package_id": package_id})
    return {"message": "Package deleted"}


# ==================== STOCK MANAGEMENT ====================

@router.post("/stock/movement")
async def create_stock_movement(movement_input: StockMovementCreate, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")

    die = await db.dies.find_one({"die_id": movement_input.die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")

    movement_id = f"mov_{uuid.uuid4().hex[:12]}"
    movement_doc = {
        "movement_id": movement_id,
        "die_id": movement_input.die_id,
        "die_code": die["code"],
        "die_name": die["name"],
        "movement_type": movement_input.movement_type,
        "quantity": movement_input.quantity,
        "sales_person_id": movement_input.sales_person_id,
        "sales_person_name": None,
        "notes": movement_input.notes,
        "movement_date": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "reference_number": movement_input.reference_number,
    }

    if movement_input.movement_type == "stock_in":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": movement_input.quantity}})
    elif movement_input.movement_type == "stock_out":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": -movement_input.quantity}})
    elif movement_input.movement_type == "physical_adjustment":
        # Reconcile: set system stock to the counted quantity. Record the
        # before/after/variance so the count history is reliable (no note-parsing).
        system_qty = int(die.get("stock_qty", 0) or 0)
        counted = movement_input.counted_qty
        if counted is None:
            raise HTTPException(status_code=400, detail="counted_qty required for physical_adjustment")
        counted = int(counted)
        variance = counted - system_qty
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$set": {"stock_qty": counted}})
        movement_doc.update({
            "quantity": abs(variance),
            "system_qty": system_qty,
            "counted_qty": counted,
            "variance": variance,
            "session_date": movement_input.session_date,
            "session_notes": movement_input.session_notes,
        })
    elif movement_input.movement_type == "allocated_to_sales":
        await db.sales_person_stock.update_one(
            {"sales_person_id": movement_input.sales_person_id, "die_id": movement_input.die_id},
            {"$inc": {"allocated_qty": movement_input.quantity, "current_holding": movement_input.quantity}},
            upsert=True,
        )

    await db.stock_movements.insert_one(movement_doc)
    return await db.stock_movements.find_one({"movement_id": movement_id}, {"_id": 0})


@router.get("/stock/movements")
async def get_stock_movements(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    movements = await db.stock_movements.find({}, {"_id": 0}).sort("movement_date", -1).limit(100).to_list(100)
    return movements


# ==================== PURCHASE ALERTS ====================

@router.get("/purchase-alerts")
async def get_purchase_alerts(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if status:
        query["status"] = status
    alerts = await db.purchase_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return alerts


@router.put("/purchase-alerts/{alert_id}/status")
async def update_alert_status(alert_id: str, status: str, request: Request):
    user = await get_current_user(request)
    await db.purchase_alerts.update_one({"alert_id": alert_id}, {"$set": {"status": status}})
    return {"message": "Alert updated"}


@router.post("/low-stock-alert/run")
async def run_low_stock_alert_now(request: Request):
    """Admin: run the low-stock digest immediately (in-app notification + email).
    The same job runs automatically every day at 8am IST."""
    user = await get_current_user(request)
    require_teams(user, "admin")
    from scheduler import run_low_stock_check  # lazy import avoids any import cycle
    return await run_low_stock_check(trigger="manual")


# ==================== SALES PERSON STOCK HOLDINGS ====================

@router.get("/sales-person-stock")
async def get_sales_person_stock(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    holdings = await db.sales_person_stock.find({}, {"_id": 0}).to_list(1000)
    # Enrich with salesperson name and die info
    sp_map = {sp["sales_person_id"]: sp async for sp in db.salespersons.find({}, {"_id": 0})}
    die_map = {d["die_id"]: d async for d in db.dies.find({}, {"_id": 0})}
    result = []
    for h in holdings:
        sp = sp_map.get(h.get("sales_person_id"), {})
        die = die_map.get(h.get("die_id"), {})
        result.append({
            **h,
            "sales_person_name": sp.get("name", "Unknown"),
            "die_code": die.get("code", ""),
            "die_name": die.get("name", ""),
        })
    # Group by sales person
    grouped = {}
    for r in result:
        sp_id = r["sales_person_id"]
        if sp_id not in grouped:
            grouped[sp_id] = {"sales_person_id": sp_id, "sales_person_name": r["sales_person_name"], "holdings": [], "total_units": 0}
        grouped[sp_id]["holdings"].append(r)
        grouped[sp_id]["total_units"] += r.get("current_holding", 0)
    return list(grouped.values())


# ==================== SALESPERSONS ====================
# Single source of truth: users collection.
# salespersons collection is kept in sync but users is authoritative.

@router.get("/salespersons")
async def get_salespersons(request: Request):
    await get_current_user(request)
    # Read from users — project to the salesperson shape callers expect
    users = await db.users.find(
        {"is_active": {"$ne": False}, "role": {"$in": ["admin", "sales_person", "accounts", "store"]}},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "is_active": 1}
    ).to_list(1000)
    result = []
    for u in users:
        # Find matching salesperson record for the sales_person_id field
        sp = await db.salespersons.find_one({"email": u["email"]}, {"_id": 0, "sales_person_id": 1})
        result.append({
            "sales_person_id": sp["sales_person_id"] if sp else u["user_id"],
            "name": u["name"],
            "email": u["email"],
            "phone": u.get("phone", ""),
            "is_active": u.get("is_active", True),
            "user_id": u["user_id"],
        })
    return result
