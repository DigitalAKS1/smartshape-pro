"""Past purchases — orders a school placed before the app existed, or outside it.

Entered once (by hand on the school profile, or uploaded from Excel/CSV) so the
app knows what each school already owns. They are HISTORY, not work: nothing
here writes to orders, order items, stock, payments or leads. They do count as
buying events for account status and reorder-due (services/purchase_history.py).
"""
import csv
import hashlib
import io
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError

from auth_utils import get_current_user
from database import db
from rbac import get_team, has_module
import import_engine as ie
import routes.crm_routes as crm
import services.account_lifecycle as al
from services.purchase_history import school_purchase_history

router = APIRouter()

TEMPLATE_HEADER = ["school_id", "school_name", "city", "purchase_date", "die_code", "item_name",
                   "item_type", "qty", "reference", "amount", "notes"]
ITEM_TYPES = ("die", "machine", "other")
DUP_MSG = "This old order is already recorded for this school"


# ── helpers ───────────────────────────────────────────────────────────────────

def parse_date(raw):
    """YYYY-MM-DD from ISO, DD-MM-YYYY, DD/MM/YYYY (Indian day-first), an Excel
    serial number, or a date/datetime. None when it can't be read."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return _from_serial(float(raw))
    s = str(raw).strip()
    if not s:
        return None
    if re.fullmatch(r"\d{4,5}(\.0+)?", s):
        return _from_serial(float(s))
    s = s.split(" ")[0].split("T")[0]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y", "%d-%m-%y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _from_serial(n: float):
    if not (1 <= n <= 80000):          # 1900 … ~2119
        return None
    return (date(1899, 12, 30) + timedelta(days=int(n))).isoformat()


def _code_key(code) -> str:
    """'ss 101', 'SS-101', '"SS101"' all compare equal."""
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def _int(v):
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


def _float(v):
    try:
        return round(float(str(v).replace(",", "").strip()), 2)
    except (TypeError, ValueError):
        return 0.0


def dedupe_key(school_id: str, purchase_date: str, reference: str, items: list) -> str:
    parts = sorted(f"{(i.get('die_code') or i.get('name') or '').strip().lower()}:{i.get('qty')}" for i in items)
    raw = "|".join([school_id, purchase_date, (reference or "").strip().lower(), *parts])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


async def _dies_by(field_key):
    dies = await db.dies.find({}, {"_id": 0, "die_id": 1, "code": 1, "name": 1, "type": 1}).to_list(None)
    return {field_key(d): d for d in dies if field_key(d)}


def _die_item(die: dict, qty: int) -> dict:
    return {"die_id": die["die_id"], "die_code": die.get("code") or "", "name": die.get("name") or die.get("code") or "",
            "item_type": "machine" if die.get("type") == "machine" else "die", "qty": qty}


async def _normalise_items(raw_items) -> list:
    """Manual entry items → stored items. Raises 400 on anything unusable."""
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(status_code=400, detail="Add at least one item")
    by_id = await _dies_by(lambda d: d.get("die_id"))
    by_code = {_code_key(d.get("code")): d for d in by_id.values() if d.get("code")}
    out = []
    for n, it in enumerate(raw_items, 1):
        it = it or {}
        qty = _int(it.get("qty"))
        if not qty or qty < 1:
            raise HTTPException(status_code=400, detail=f"Item {n}: quantity must be 1 or more")
        die_id = (it.get("die_id") or "").strip() if isinstance(it.get("die_id"), str) else it.get("die_id")
        if die_id:
            die = by_id.get(die_id)
            if not die:
                raise HTTPException(status_code=400, detail=f"Item {n}: product not found")
            out.append(_die_item(die, qty))
            continue
        code = str(it.get("die_code") or "").strip()
        typed = str(it.get("name") or "").strip()
        # A die code typed into the name box (not picked from the list) still links.
        die = (by_code.get(_code_key(code)) if code else None) or (by_code.get(_code_key(typed)) if typed else None)
        if die:
            out.append(_die_item(die, qty))
            continue
        name = str(it.get("name") or "").strip() or code
        if not name:
            raise HTTPException(status_code=400, detail=f"Item {n}: pick a product or type a name")
        itype = it.get("item_type") if it.get("item_type") in ITEM_TYPES else ("die" if code else "other")
        out.append({"die_id": None, "die_code": code, "name": name, "item_type": itype, "qty": qty})
    return out


async def _school_or_404(school_id: str) -> dict:
    school = await db.schools.find_one({"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    return school


async def _require_school_access(user: dict, school: dict, write: bool = False):
    if not await crm._user_can_access_school(user, school):
        raise HTTPException(status_code=403, detail="You don't have access to this school")
    # Recording history flips account status and reorder-due, so it needs CRM
    # WRITE access: read-only CRM users can look, not record.
    if write and not crm.has_team(user, "admin") and not crm._crm_write(user):
        raise HTTPException(status_code=403, detail="You need CRM edit access to record old orders")


def _latest_allowed() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()


def _valid_date_or_400(raw) -> str:
    pdate = parse_date(raw)
    if not pdate:
        raise HTTPException(status_code=400, detail="Enter a valid purchase date")
    if pdate > _latest_allowed():
        raise HTTPException(status_code=400, detail="Purchase date can't be in the future")
    return pdate


async def _dup_exists(key: str) -> bool:
    return bool(await db.past_purchases.find_one({"dedupe_key": key, "is_deleted": {"$ne": True}}, {"_id": 1}))


def _can_adjust_stock(user: dict) -> bool:
    return get_team(user) == "admin" or has_module(user, "store", "read_write") \
        or has_module(user, "stock_management", "read_write")


async def _move_stock(items: list, direction: int, note: str, user: dict):
    """direction -1 = take these dies out of stock, +1 = put them back. All or
    nothing: never below zero; a shortfall rolls back what was already taken."""
    lines = [(i["die_id"], int(i.get("qty") or 0)) for i in items if i.get("die_id") and int(i.get("qty") or 0) > 0]
    done = []
    for die_id, qty in lines:
        q = {"die_id": die_id}
        if direction < 0:
            q["stock_qty"] = {"$gte": qty}
        res = await db.dies.update_one(q, {"$inc": {"stock_qty": direction * qty}})
        if not res.modified_count:
            for d_id, d_qty in done:                       # undo the partial take
                await db.dies.update_one({"die_id": d_id}, {"$inc": {"stock_qty": -direction * d_qty}})
            die = await db.dies.find_one({"die_id": die_id}, {"_id": 0, "code": 1, "stock_qty": 1}) or {}
            raise HTTPException(status_code=409, detail=f"Only {int(die.get('stock_qty') or 0)} of {die.get('code', die_id)} in stock — can't take {qty}")
        done.append((die_id, qty))
    now = datetime.now(timezone.utc).isoformat()
    for die_id, qty in done:
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0, "code": 1, "name": 1}) or {}
        await db.stock_movements.insert_one({
            "movement_id": f"mov_{uuid.uuid4().hex[:12]}", "die_id": die_id,
            "die_code": die.get("code"), "die_name": die.get("name"),
            "movement_type": "stock_out" if direction < 0 else "stock_in", "quantity": qty,
            "sales_person_id": None, "sales_person_name": None, "notes": note,
            "movement_date": now, "reference_number": None,
            "created_by": user["email"], "created_by_name": user.get("name", ""),
        })


async def _recompute(school_id: str):
    try:
        await al.recompute_school_lifecycle(db, school_id)
    except Exception as e:       # history must save even if the roll-up hiccups
        logging.warning("past purchases: lifecycle recompute failed for %s: %s", school_id, e)


# ── history ───────────────────────────────────────────────────────────────────

@router.get("/schools/{school_id}/purchase-history")
async def get_purchase_history(school_id: str, request: Request):
    user = await get_current_user(request)
    school = await _school_or_404(school_id)
    await _require_school_access(user, school)
    return await school_purchase_history(db, school_id)


# ── manual CRUD ───────────────────────────────────────────────────────────────

@router.post("/past-purchases")
async def create_past_purchase(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    school = await _school_or_404(str(body.get("school_id") or "").strip())
    await _require_school_access(user, school, write=True)
    pdate = _valid_date_or_400(body.get("purchase_date"))
    items = await _normalise_items(body.get("items"))
    reference = str(body.get("reference") or "").strip()
    key = dedupe_key(school["school_id"], pdate, reference, items)
    if await _dup_exists(key):
        raise HTTPException(status_code=409, detail=DUP_MSG)
    # Optional: the old order also leaves current stock (default: history only).
    adjust = bool(body.get("adjust_stock"))
    if adjust and not _can_adjust_stock(user):
        raise HTTPException(status_code=403, detail="You need Store edit access to deduct stock")
    if adjust:
        await _move_stock(items, -1, f"Old order {reference or pdate} — {school.get('school_name', '')}", user)
    doc = {
        "purchase_id": f"pp_{uuid.uuid4().hex[:12]}",
        "school_id": school["school_id"], "school_name": school.get("school_name", ""),
        "purchase_date": pdate, "reference": reference,
        "notes": str(body.get("notes") or "").strip(), "amount": _float(body.get("amount")),
        "items": items, "source": "manual", "import_batch_id": None, "dedupe_key": key,
        "stock_adjusted": adjust,
        "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
        "is_deleted": False,
    }
    try:
        await db.past_purchases.insert_one(dict(doc))
    except DuplicateKeyError:          # a parallel save won the race
        if adjust:
            await _move_stock(items, +1, "Undo: duplicate old order not saved", user)
        raise HTTPException(status_code=409, detail=DUP_MSG)
    await _recompute(school["school_id"])
    return doc


async def _owned_purchase(purchase_id: str, user: dict) -> dict:
    doc = await db.past_purchases.find_one({"purchase_id": purchase_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Old order not found")
    school = await _school_or_404(doc["school_id"])
    await _require_school_access(user, school, write=True)
    return doc


@router.put("/past-purchases/{purchase_id}")
async def update_past_purchase(purchase_id: str, request: Request):
    user = await get_current_user(request)
    doc = await _owned_purchase(purchase_id, user)
    body = await request.json()
    patch = {}
    if "purchase_date" in body:
        patch["purchase_date"] = _valid_date_or_400(body.get("purchase_date"))
    if "items" in body:
        if doc.get("stock_adjusted"):
            raise HTTPException(status_code=400, detail="This old order took items out of stock — delete it and add it again to change the items")
        patch["items"] = await _normalise_items(body.get("items"))
    for k in ("reference", "notes"):
        if k in body:
            patch[k] = str(body.get(k) or "").strip()
    if "amount" in body:
        patch["amount"] = _float(body.get("amount"))
    if patch:
        merged = {**doc, **patch}
        patch["dedupe_key"] = dedupe_key(merged["school_id"], merged["purchase_date"],
                                         merged.get("reference", ""), merged["items"])
        patch["updated_by"] = user["email"]
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            await db.past_purchases.update_one({"purchase_id": purchase_id}, {"$set": patch})
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail=DUP_MSG)
        await _recompute(doc["school_id"])
    return await db.past_purchases.find_one({"purchase_id": purchase_id}, {"_id": 0})


@router.delete("/past-purchases/{purchase_id}")
async def delete_past_purchase(purchase_id: str, request: Request):
    user = await get_current_user(request)
    doc = await _owned_purchase(purchase_id, user)
    if get_team(user) != "admin" and doc.get("created_by") != user["email"]:
        raise HTTPException(status_code=403, detail="Only an admin or the person who added it can delete this")
    await db.past_purchases.update_one(
        {"purchase_id": purchase_id},
        {"$set": {"is_deleted": True, "deleted_by": user["email"],
                  "deleted_at": datetime.now(timezone.utc).isoformat()}})
    if doc.get("stock_adjusted"):      # it took stock out — put it back
        await _move_stock(doc.get("items") or [], +1,
                          f"Old order deleted: {doc.get('reference') or doc.get('purchase_date')} — {doc.get('school_name', '')}", user)
    await _recompute(doc["school_id"])
    return {"message": "deleted"}


# ── template + bulk import ────────────────────────────────────────────────────

@router.get("/past-purchases/template")
async def past_purchase_template(request: Request):
    await get_current_user(request)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(TEMPLATE_HEADER)
    # Example rows use a name no real school has, so leaving them in imports nothing.
    w.writerow(["", "EXAMPLE SCHOOL - DELETE THIS ROW", "", "15-03-2023", "SS-101", "", "", "4", "BILL-123", "15000", "one row per item"])
    w.writerow(["", "EXAMPLE SCHOOL - DELETE THIS ROW", "", "15-03-2023", "", "Die Cutting Machine", "machine", "1", "BILL-123", "", "same bill no = same order"])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="old-orders-template.csv"'})


def _cell(row: dict, *names):
    lowered = {str(k or "").strip().lower().replace(" ", "_"): v for k, v in row.items()}
    for n in names:
        v = lowered.get(n)
        if v not in (None, ""):
            return v
    return ""


@router.post("/past-purchases/import")
async def import_past_purchases(request: Request, file: UploadFile = File(...), dry_run: bool = True):
    user = await get_current_user(request)
    if get_team(user) != "admin" and not has_module(user, "orders", "read_write"):
        raise HTTPException(status_code=403, detail="Only an admin or someone with Orders access can import old orders")
    content = await file.read()
    try:
        _headers, rows = ie.parse_table(file.filename or "upload.csv", content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:120]}")

    by_code = await _dies_by(lambda d: _code_key(d.get("code")))
    school_cache: dict = {}
    groups: dict = {}
    skipped = []

    for idx, row in enumerate(rows):
        line = idx + 2                                  # header is line 1
        vals = {k: str(_cell(row, k)).strip()
                for k in ("school_id", "school_name", "city", "die_code", "item_name", "item_type", "reference", "notes")}
        if not any(vals.values()) and not _cell(row, "qty"):
            continue                                    # blank line
        pdate = parse_date(_cell(row, "purchase_date", "date", "order_date"))
        if not pdate:
            skipped.append({"row": line, "reason": "Invalid or missing purchase date"})
            continue
        if pdate > _latest_allowed():
            skipped.append({"row": line, "reason": f"Date {pdate} is in the future"})
            continue
        qty = _int(_cell(row, "qty", "quantity")) or 0
        if qty < 1:
            skipped.append({"row": line, "reason": "Quantity must be 1 or more"})
            continue
        ck = (vals["school_id"].lower(), vals["school_name"].lower(), vals["city"].lower())
        if ck not in school_cache:
            school_cache[ck] = await ie.resolve_school(db, {
                "school_id": vals["school_id"], "school_name": vals["school_name"], "city": vals["city"]})
        res = school_cache[ck]
        if res["action"] == "needs_review":
            skipped.append({"row": line, "reason": f"{res['candidates']} schools match this name — add school_id or city"})
            continue
        if res["action"] != "update" or not res.get("school_id"):
            skipped.append({"row": line, "reason": f"School not found: {vals['school_name'] or vals['school_id'] or '(blank)'}"})
            continue
        die = by_code.get(_code_key(vals["die_code"])) if vals["die_code"] else None
        if die:
            item = _die_item(die, qty)
        else:
            name = vals["item_name"] or vals["die_code"]
            if not name:
                skipped.append({"row": line, "reason": "Give a die_code or an item_name"})
                continue
            itype = vals["item_type"].lower() if vals["item_type"].lower() in ITEM_TYPES else ("die" if vals["die_code"] else "other")
            item = {"die_id": None, "die_code": vals["die_code"], "name": name, "item_type": itype, "qty": qty}
        gk = (res["school_id"], pdate, vals["reference"].lower())
        g = groups.setdefault(gk, {"school_id": res["school_id"], "purchase_date": pdate,
                                   "reference": vals["reference"], "amount": 0.0, "notes": [], "items": [], "rows": []})
        g["items"].append(item)
        g["rows"].append(line)
        amt = _float(_cell(row, "amount"))
        if amt and not g["amount"]:
            g["amount"] = amt
        if vals["notes"] and vals["notes"] not in g["notes"]:
            g["notes"].append(vals["notes"])

    names = {s["school_id"]: s.get("school_name", "") async for s in db.schools.find(
        {"school_id": {"$in": list({g["school_id"] for g in groups.values()})}}, {"_id": 0, "school_id": 1, "school_name": 1})}
    batch_id = f"ppb_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    created = duplicates = 0
    preview = []
    touched = set()
    for g in groups.values():
        key = dedupe_key(g["school_id"], g["purchase_date"], g["reference"], g["items"])
        exists = await _dup_exists(key)
        preview.append({"school_id": g["school_id"], "school_name": names.get(g["school_id"], ""),
                        "purchase_date": g["purchase_date"], "reference": g["reference"], "amount": g["amount"],
                        "items": g["items"], "rows": g["rows"], "duplicate": exists})
        if exists:
            duplicates += 1
            if not dry_run:
                touched.add(g["school_id"])   # heal a school left stale by an interrupted import
            continue
        if dry_run:
            continue
        try:
            await db.past_purchases.insert_one({
                "purchase_id": f"pp_{uuid.uuid4().hex[:12]}", "school_id": g["school_id"],
                "school_name": names.get(g["school_id"], ""), "purchase_date": g["purchase_date"],
                "reference": g["reference"], "notes": "; ".join(g["notes"]), "amount": g["amount"],
                "items": g["items"], "source": "import", "import_batch_id": batch_id, "dedupe_key": key,
                "created_by": user["email"], "created_at": now, "is_deleted": False,
            })
        except DuplicateKeyError:          # a parallel import got there first
            duplicates += 1
            preview[-1]["duplicate"] = True
            touched.add(g["school_id"])
            continue
        created += 1
        # Recompute per group, so an import cut off mid-file leaves no stale school.
        await _recompute(g["school_id"])
        touched.discard(g["school_id"])
    for sid in touched:
        await _recompute(sid)
    return {"dry_run": dry_run, "groups": len(groups), "created": created, "duplicates": duplicates,
            "skipped": skipped, "preview": preview, "batch_id": None if dry_run else batch_id}
