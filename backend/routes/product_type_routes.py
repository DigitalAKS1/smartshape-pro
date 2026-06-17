from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import uuid

from database import db
from auth_utils import get_current_user
from rbac import require_teams, require_module
from product_type_utils import slugify_prefix, next_code

router = APIRouter()

DIES_TYPE_ID = "ptype_dies"


class ProductTypeCreate(BaseModel):
    name: str
    code_prefix: Optional[str] = ""
    visible_to_schools: bool = True
    uses_quota: bool = False
    sort_order: int = 100


async def _name_in_use(name: str, exclude_id: str = None) -> bool:
    norm = (name or "").strip().lower()
    q = {"product_type_id": {"$ne": exclude_id}} if exclude_id else {}
    async for t in db.product_types.find(q, {"name": 1, "_id": 0}):
        if (t.get("name", "")).strip().lower() == norm:
            return True
    return False


@router.get("/product-types")
async def get_product_types(request: Request, active: bool = False, for_schools: bool = False):
    await get_current_user(request)
    query = {}
    if active or for_schools:
        query["is_active"] = {"$ne": False}
    if for_schools:
        query["visible_to_schools"] = True
    types = await db.product_types.find(query, {"_id": 0}).sort("sort_order", 1).to_list(200)
    return types


@router.post("/product-types")
async def create_product_type(payload: ProductTypeCreate, request: Request):
    user = await get_current_user(request)
    require_module(user, "inventory", "read_write")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if await _name_in_use(name):
        raise HTTPException(status_code=409, detail=f"A product type named '{name}' already exists")
    doc = {
        "product_type_id": f"ptype_{uuid.uuid4().hex[:12]}",
        "name": name,
        "code_prefix": slugify_prefix(payload.code_prefix),
        "visible_to_schools": bool(payload.visible_to_schools),
        "uses_quota": bool(payload.uses_quota),
        "sort_order": int(payload.sort_order),
        "is_active": True,
    }
    await db.product_types.insert_one(doc)
    return await db.product_types.find_one({"product_type_id": doc["product_type_id"]}, {"_id": 0})


@router.put("/product-types/{product_type_id}")
async def update_product_type(product_type_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "inventory", "read_write")
    updates = await request.json()
    safe = {k: v for k, v in updates.items() if k in (
        "name", "code_prefix", "visible_to_schools", "uses_quota", "sort_order", "is_active")}
    if "name" in safe:
        safe["name"] = (safe["name"] or "").strip()
        if not safe["name"]:
            raise HTTPException(status_code=400, detail="Name is required")
        if await _name_in_use(safe["name"], exclude_id=product_type_id):
            raise HTTPException(status_code=409, detail=f"A product type named '{safe['name']}' already exists")
    if "code_prefix" in safe:
        safe["code_prefix"] = slugify_prefix(safe["code_prefix"])
    for b in ("visible_to_schools", "uses_quota", "is_active"):
        if b in safe:
            safe[b] = bool(safe[b])
    if "sort_order" in safe:
        safe["sort_order"] = int(safe["sort_order"])
    if not safe:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.product_types.update_one({"product_type_id": product_type_id}, {"$set": safe})
    # Propagate a rename to the denormalized name on tagged products.
    if "name" in safe:
        await db.dies.update_many({"product_type_id": product_type_id}, {"$set": {"product_type": safe["name"]}})
    return await db.product_types.find_one({"product_type_id": product_type_id}, {"_id": 0})


@router.delete("/product-types/{product_type_id}")
async def delete_product_type(product_type_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "inventory", "read_write_delete")
    in_use = await db.dies.count_documents({"product_type_id": product_type_id})
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} product(s) use this type. Reassign them or archive the type instead.",
        )
    await db.product_types.delete_one({"product_type_id": product_type_id})
    return {"message": "Product type deleted"}


@router.get("/product-types/{product_type_id}/next-code")
async def suggest_next_code(product_type_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "inventory", "read")
    pt = await db.product_types.find_one({"product_type_id": product_type_id}, {"_id": 0})
    if not pt:
        raise HTTPException(status_code=404, detail="Product type not found")
    prefix = pt.get("code_prefix") or ""
    if not prefix:
        return {"code": ""}
    codes = [d.get("code", "") async for d in db.dies.find({}, {"code": 1, "_id": 0})]
    return {"code": next_code(prefix, codes)}
