"""Generic lookup masters — one editable home for lists that repeat across the app.

Each list is a registry entry in LOOKUP_LISTS (code), its values live in the
`lookup_values` collection. Adding the next repeating list is a registry entry,
not a new collection + CRUD + page.

`stores` decides what the records keep:
  - "name":  the display name (readable in exports/filters). Renaming cascades
             onto every record that held the old name.
  - "value": a stable slug (legacy die categories like `3d_flowers`). Renaming
             only changes the label; records are untouched.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")


def _seed(*names):
    return [(slugify(n), n) for n in names]


LOOKUP_LISTS = {
    "school_category": {
        "label": "School Category", "group": "crm",
        "collection": "schools", "field": "school_category", "stores": "name",
        "audience_key": "school_categories",
        "seed": _seed("Pre School", "K-12 School", "Franchise", "Navodaya", "Independent"),
    },
    "product_category": {
        "label": "Product Category", "group": "product",
        "collection": "dies", "field": "category", "stores": "value",
        "seed": [
            ("decorative", "Decorative"), ("flowers", "Flowers"), ("leaf", "Leaf"),
            ("alphabets", "Alphabets"), ("numbers", "Numbers"), ("butterfly", "Butterfly"),
            ("borders", "Borders"), ("giant_flowers", "Giant Flowers"), ("3d_flowers", "3D Flowers"),
            ("animals_birds", "Animals & Birds"), ("snowflake", "Snowflake"), ("fruits", "Fruits"),
            ("shapes", "Shapes"), ("other", "Other"),
        ],
    },
    "package_type": {
        "label": "Package Type", "group": "product",
        "collection": "packages", "field": "package_type", "stores": "name",
        "seed": _seed("Machine + Dies Combo", "Dies Only", "Machine Only", "Accessories"),
    },
}


def _spec(list_key: str) -> dict:
    spec = LOOKUP_LISTS.get(list_key)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown list '{list_key}'")
    return spec


def _require_master_admin(user):
    if get_team(user) != "admin" and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can change or delete master data")


def _stored(spec: dict, doc: dict) -> str:
    return doc["value"] if spec["stores"] == "value" else doc["name"]


async def _ensure_seeded(list_key: str, target_db=None):
    d = target_db if target_db is not None else db
    spec = _spec(list_key)
    if await d.lookup_values.count_documents({"list_key": list_key}, limit=1):
        return
    now = datetime.now(timezone.utc).isoformat()
    for i, (value, name) in enumerate(spec["seed"]):
        # Upsert per row: two concurrent first reads can never duplicate.
        await d.lookup_values.update_one(
            {"list_key": list_key, "value": value},
            {"$setOnInsert": {
                "lookup_id": f"lk_{uuid.uuid4().hex[:8]}", "list_key": list_key,
                "value": value, "name": name, "is_active": True,
                "sort_order": i * 10, "created_at": now,
            }},
            upsert=True,
        )


async def get_values(list_key: str, include_inactive: bool = True, target_db=None) -> list:
    d = target_db if target_db is not None else db
    await _ensure_seeded(list_key, d)
    q = {"list_key": list_key}
    if not include_inactive:
        q["is_active"] = {"$ne": False}
    return await d.lookup_values.find(q, {"_id": 0}).sort([("sort_order", 1), ("name", 1)]).to_list(1000)


async def canonical_name(list_key: str, raw, target_db=None) -> str:
    """Case-insensitive match on name or value → the stored form; unknown → raw stripped."""
    text = (raw or "").strip() if isinstance(raw, str) else ("" if raw is None else str(raw).strip())
    if not text:
        return ""
    spec = _spec(list_key)
    hit = _match(await get_values(list_key, target_db=target_db), text)
    if hit:
        return _stored(spec, hit)
    if spec["stores"] == "name":
        # Not in the master yet: reuse a spelling records already carry, so
        # "montessori" and "Montessori" never become two filter buckets.
        d = target_db if target_db is not None else db
        rec = await d[spec["collection"]].find_one(
            {spec["field"]: {"$regex": f"^{re.escape(text)}$", "$options": "i"}},
            {"_id": 0, spec["field"]: 1})
        if rec and rec.get(spec["field"]):
            return rec[spec["field"]]
    return text


def _match(rows: list, text: str):
    """Exact (case-insensitive) name first, then slug — so a renamed row's old
    slug can never capture a value that has its own row."""
    low, slug = text.lower(), slugify(text)
    return (next((r for r in rows if r["name"].lower() == low), None)
            or next((r for r in rows if r["value"] == slug), None))


async def _usage(spec: dict, stored: str) -> int:
    return await db[spec["collection"]].count_documents(
        {spec["field"]: stored, "is_deleted": {"$ne": True}})


@router.get("/lookups")
async def list_lookups(request: Request):
    await get_current_user(request)
    return [{"key": k, "label": v["label"], "group": v["group"]} for k, v in LOOKUP_LISTS.items()]


@router.get("/lookups/{list_key}")
async def get_lookup(list_key: str, request: Request):
    await get_current_user(request)
    spec = _spec(list_key)
    items = await get_values(list_key)
    for it in items:
        it["usage"] = await _usage(spec, _stored(spec, it))
    return items


@router.post("/lookups/{list_key}")
async def create_lookup(list_key: str, request: Request):
    await get_current_user(request)
    _spec(list_key)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    value = slugify(name)
    if not value:
        raise HTTPException(status_code=400, detail="name must contain letters or numbers")
    rows = await get_values(list_key)
    same_name = next((r for r in rows if r["name"].lower() == name.lower()), None)
    if same_name:
        return same_name
    if any(r["value"] == value for r in rows):
        # The slug belongs to a renamed row (e.g. "Pre School" → "Playgroup");
        # give the new value its own distinct slug.
        n = 2
        while any(r["value"] == f"{value}_{n}" for r in rows):
            n += 1
        value = f"{value}_{n}"
    last = await db.lookup_values.find({"list_key": list_key}).sort("sort_order", -1).to_list(1)
    doc = {
        "lookup_id": f"lk_{uuid.uuid4().hex[:8]}", "list_key": list_key,
        "value": value, "name": name, "is_active": True,
        "sort_order": (last[0].get("sort_order", 0) + 10) if last else 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.lookup_values.insert_one(dict(doc))
    return doc


@router.put("/lookups/{list_key}/{lookup_id}")
async def update_lookup(list_key: str, lookup_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    spec = _spec(list_key)
    current = await db.lookup_values.find_one({"list_key": list_key, "lookup_id": lookup_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Value not found")
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active", "sort_order") if k in body}
    if "name" in allowed:
        allowed["name"] = (allowed["name"] or "").strip()
        if not allowed["name"]:
            raise HTTPException(status_code=400, detail="name required")
        clash = await db.lookup_values.find_one({
            "list_key": list_key, "lookup_id": {"$ne": lookup_id},
            "name": {"$regex": f"^{re.escape(allowed['name'])}$", "$options": "i"}})
        if not clash:
            clash = await db.lookup_values.find_one({
                "list_key": list_key, "lookup_id": {"$ne": lookup_id},
                "value": slugify(allowed["name"])})
        if clash:
            raise HTTPException(status_code=409,
                                detail=f"'{allowed['name']}' is too close to existing '{clash['name']}'")
    if not allowed:
        return current
    await db.lookup_values.update_one({"lookup_id": lookup_id}, {"$set": allowed})
    if spec["stores"] == "name" and "name" in allowed and allowed["name"] != current["name"]:
        old, new = current["name"], allowed["name"]
        await db[spec["collection"]].update_many({spec["field"]: old}, {"$set": {spec["field"]: new}})
        # Saved campaign audiences filter by name too — keep them pointing at the renamed value.
        fkey = spec.get("audience_key")
        if fkey:
            path = f"audience_filter.{fkey}"
            for coll in ("email_campaigns", "whatsapp_campaigns"):
                async for camp in db[coll].find({path: old}, {"_id": 1, path: 1}):
                    vals = (camp.get("audience_filter") or {}).get(fkey) or []
                    await db[coll].update_one({"_id": camp["_id"]},
                                              {"$set": {path: [new if v == old else v for v in vals]}})
    return await db.lookup_values.find_one({"lookup_id": lookup_id}, {"_id": 0})


@router.delete("/lookups/{list_key}/{lookup_id}")
async def delete_lookup(list_key: str, lookup_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    spec = _spec(list_key)
    current = await db.lookup_values.find_one({"list_key": list_key, "lookup_id": lookup_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Value not found")
    # Count soft-deleted records too: restoring one must never bring back a value
    # the master no longer has.
    n = await db[spec["collection"]].count_documents({spec["field"]: _stored(spec, current)})
    if n:
        raise HTTPException(status_code=409,
                            detail=f"'{current['name']}' is used by {n} record(s) — deactivate it instead")
    await db.lookup_values.delete_one({"lookup_id": lookup_id})
    return {"message": "deleted"}
