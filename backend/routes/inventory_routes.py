from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import uuid
import csv
import io
import requests
import os

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_teams

router = APIRouter()

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "smartshape"
storage_key = None


def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


# ==================== MODELS ====================

class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None


class StockMovementCreate(BaseModel):
    die_id: str
    movement_type: str
    quantity: int
    sales_person_id: Optional[str] = None
    notes: Optional[str] = None


# ==================== DIE ENDPOINTS ====================

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
    die_doc = {
        "die_id": die_id,
        **die_input.model_dump(),
        "stock_qty": 0,
        "reserved_qty": 0,
        "image_url": None,
        "is_active": True,
    }
    await db.dies.insert_one(die_doc)
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})


@router.put("/dies/{die_id}")
async def update_die(die_id: str, updates: dict, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    await db.dies.update_one({"die_id": die_id}, {"$set": updates})
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


@router.post("/dies/{die_id}/upload-image")
async def upload_die_image(die_id: str, file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")

    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"{APP_NAME}/dies/{die_id}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/octet-stream")

    image_url = f"/api/files/{result['path']}"
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
    duplicates = 0
    errors = []
    for row in reader:
        try:
            code = row.get("code", "").strip()
            name = row.get("name", "").strip()
            if not code or not name:
                errors.append("Row missing code or name")
                continue
            existing = await db.dies.find_one({"code": code})
            if existing:
                duplicates += 1
                continue
            die_id = f"die_{uuid.uuid4().hex[:8]}"
            await db.dies.insert_one({
                "die_id": die_id,
                "code": code,
                "name": name,
                "type": row.get("type", "standard").strip().lower(),
                "stock_qty": int(row.get("stock_qty", 0) or 0),
                "reserved_qty": int(row.get("reserved_qty", 0) or 0),
                "min_level": int(row.get("min_level", 5) or 5),
                "image_url": "",
                "description": row.get("description", "").strip(),
                "is_active": True,
            })
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "duplicates": duplicates, "errors": errors[:10]}


# ==================== FILE UPLOAD & PROXY ====================

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), request: Request = None):
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"{APP_NAME}/uploads/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/octet-stream")
    return {"url": f"/api/files/{result['path']}"}


@router.get("/files/{path:path}")
async def get_file(path: str):
    try:
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=30,
        )
        if resp.status_code == 200:
            return FastAPIResponse(
                content=resp.content,
                media_type=resp.headers.get("content-type", "application/octet-stream"),
            )
        raise HTTPException(status_code=404, detail="File not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        "reference_number": None,
    }

    if movement_input.movement_type == "stock_in":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": movement_input.quantity}})
    elif movement_input.movement_type == "stock_out":
        await db.dies.update_one({"die_id": movement_input.die_id}, {"$inc": {"stock_qty": -movement_input.quantity}})
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


# ==================== SALESPERSONS ====================

@router.get("/salespersons")
async def get_salespersons(request: Request):
    await get_current_user(request)
    persons = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(1000)
    return persons


@router.post("/salespersons")
async def create_salesperson(request: Request):
    await get_current_user(request)
    body = await request.json()
    person_id = f"sp_{uuid.uuid4().hex[:12]}"
    person_doc = {
        "sales_person_id": person_id,
        "name": body.get("name", ""),
        "email": body.get("email", ""),
        "phone": body.get("phone", ""),
        "is_active": True,
    }
    await db.salespersons.insert_one(person_doc)
    return await db.salespersons.find_one({"sales_person_id": person_id}, {"_id": 0})
