"""Catalogue Master — named catalogues that can be emailed to a school WITHOUT a
quotation.

A catalogue is a saved filter over the products schools may see (categories,
product types and/or hand-picked dies). "Send" emails a school (or any address)
a personal link `/c/{token}`; the page shows that catalogue's dies, badges the
ones the school already ordered, and the school's picks are filed as a
Quotation Request (source "catalogue") for the sales team to quote.

Deliberately separate from the quotation catalogue token (`/catalogue/{token}`),
which is welded to a quotation and auto-creates a sales order on submit.
"""
import html as _html
import os
import re
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from auth_utils import get_current_user
from database import db
from rbac import require_module
import routes.crm_routes as crm
from routes.quotation_request_routes import (_EMAIL_RE, _clean, _clean_multiline, _client_ip, _send_email,
                                             _visible_dies, create_request)
from services.purchase_history import owned_by_die

router = APIRouter()

RATE_LIMIT, RATE_WINDOW = 10, 600
_RATE: dict = {}
# Every send is a mail from the company Gmail, which the public form and the
# quotation mails also depend on — keep one rep from burning the daily quota.
SEND_PER_CALL = 20
SEND_DAILY_CAP = 100


def _rate_ok(ip: str) -> bool:
    now_s = time.time()
    hits = [t for t in _RATE.get(ip, []) if now_s - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        _RATE[ip] = hits
        return False
    hits.append(now_s)
    _RATE[ip] = hits
    if len(_RATE) > 10000:
        _RATE.clear()
    return True


def _str_list(v) -> list:
    if not isinstance(v, list):
        return []
    return list(dict.fromkeys(str(x).strip() for x in v if str(x or "").strip()))[:500]


def _matches(cat: dict, die: dict) -> bool:
    cats, ptypes, ids = cat.get("categories") or [], cat.get("product_type_ids") or [], cat.get("die_ids") or []
    if not (cats or ptypes or ids):
        return True                                     # empty filter = everything schools may see
    return (die.get("category") in cats
            or die.get("product_type_id", "ptype_dies") in ptypes
            or die.get("die_id") in ids)


async def _catalogue_dies(cat: dict) -> list:
    return [d for d in await _visible_dies() if _matches(cat, d)]


async def _get_catalogue(catalogue_id: str) -> dict:
    cat = await db.catalogues.find_one({"catalogue_id": catalogue_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="Catalogue not found")
    return cat


def _fields(body: dict) -> dict:
    return {
        "name": _clean(body.get("name"), 120),
        "intro": _clean_multiline(body.get("intro"), 1000),
        "categories": _str_list(body.get("categories")),
        "product_type_ids": _str_list(body.get("product_type_ids")),
        "die_ids": _str_list(body.get("die_ids")),
    }


# ── team side ─────────────────────────────────────────────────────────────────

@router.get("/catalogues")
async def list_catalogues(request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read")
    cats = await db.catalogues.find({"is_deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(200)
    visible = await _visible_dies()
    for c in cats:
        c["die_count"] = sum(1 for d in visible if _matches(c, d))
        counts = {"sent": 0, "opened": 0, "submitted": 0}
        async for s in db.catalogue_shares.find({"catalogue_id": c["catalogue_id"]}, {"_id": 0, "status": 1}):
            counts[s.get("status", "sent")] = counts.get(s.get("status", "sent"), 0) + 1
        c["shares"] = counts
    return cats


@router.post("/catalogues")
async def create_catalogue(request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read_write")
    f = _fields(await request.json())
    if not f["name"]:
        raise HTTPException(status_code=400, detail="Give the catalogue a name")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"catalogue_id": f"cat_{uuid.uuid4().hex[:10]}", **f, "is_deleted": False,
           "created_by": user["email"], "created_at": now, "updated_at": now}
    await db.catalogues.insert_one(dict(doc))
    return doc


@router.put("/catalogues/{catalogue_id}")
async def update_catalogue(catalogue_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read_write")
    await _get_catalogue(catalogue_id)
    body = await request.json()
    f = {k: v for k, v in _fields(body).items() if k in body}
    if "name" in f and not f["name"]:
        raise HTTPException(status_code=400, detail="Give the catalogue a name")
    if f:
        f["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.catalogues.update_one({"catalogue_id": catalogue_id}, {"$set": f})
    return await _get_catalogue(catalogue_id)


@router.delete("/catalogues/{catalogue_id}")
async def delete_catalogue(catalogue_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read_write")
    await _get_catalogue(catalogue_id)
    await db.catalogues.update_one({"catalogue_id": catalogue_id},
                                   {"$set": {"is_deleted": True, "deleted_by": user["email"]}})
    return {"message": "deleted"}


@router.get("/catalogues/{catalogue_id}/preview")
async def preview_catalogue(catalogue_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read")
    cat = await _get_catalogue(catalogue_id)
    return {"catalogue": cat, "dies": await _catalogue_dies(cat)}


def _share_email_html(cat: dict, school_name: str, link: str, sender_name: str) -> str:
    e = _html.escape
    intro = e(cat.get("intro") or "").replace("\n", "<br>")
    return (f"<div style='font-family:Arial,sans-serif;font-size:14px;max-width:560px'>"
            f"<p>Dear {e(school_name) or 'Sir/Madam'},</p>"
            f"<p>Please find our <b>{e(cat['name'])}</b> catalogue below.</p>"
            f"{('<p>' + intro + '</p>') if intro else ''}"
            f"<p style='margin:24px 0'><a href='{link}' style='background:#e94560;color:#fff;padding:12px 22px;"
            f"border-radius:6px;text-decoration:none;font-weight:bold'>Open catalogue &amp; choose dies</a></p>"
            f"<p>Tap the dies you like, set the quantity, and press <b>Send selection</b>. "
            f"We'll reply with a quotation.</p><p>— {e(sender_name)}</p></div>")


@router.post("/catalogues/{catalogue_id}/send")
async def send_catalogue(catalogue_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read_write")
    cat = await _get_catalogue(catalogue_id)
    body = await request.json()
    school = None
    if body.get("school_id"):
        school = await db.schools.find_one({"school_id": str(body["school_id"]), "is_deleted": {"$ne": True}}, {"_id": 0})
        # A rep may only send to (and so reveal the purchase history of) a school they can see.
        if not school or not await crm._user_can_access_school(user, school):
            raise HTTPException(status_code=404, detail="School not found")
    raw = body.get("emails") or ""
    if isinstance(raw, list):
        raw = ",".join(str(x) for x in raw)
    typed = [x.strip() for x in re.split(r"[,;\s]+", str(raw)) if x.strip()]
    if school and not typed and (school.get("email") or "").strip():
        typed = [school["email"].strip()]
    valid = list(dict.fromkeys(x for x in typed if _EMAIL_RE.match(x)))
    invalid = [x for x in typed if not _EMAIL_RE.match(x)]
    if not valid:
        raise HTTPException(status_code=400, detail="Add an email address (the school has none saved)" if school
                            else "Add at least one valid email address")

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    used = await db.catalogue_shares.count_documents({"sent_by": user["email"], "sent_at": {"$gte": day}})
    batch = valid[:SEND_PER_CALL]
    if used + len(batch) > SEND_DAILY_CAP:
        raise HTTPException(status_code=429, detail=f"Daily limit reached ({SEND_DAILY_CAP} catalogue emails per person) — try tomorrow")

    fe = os.environ.get("FRONTEND_URL", "").rstrip("/")
    school_name = _clean((school or {}).get("school_name") or body.get("school_name"), 200)
    now = datetime.now(timezone.utc).isoformat()
    shares, sent = [], []
    for to in batch:
        token = uuid.uuid4().hex
        await db.catalogue_shares.insert_one({
            "token": token, "catalogue_id": catalogue_id, "catalogue_name": cat["name"],
            "school_id": (school or {}).get("school_id"), "school_name": school_name, "email": to,
            "status": "sent", "sent_by": user["email"], "sent_by_name": user.get("name", ""),
            "sent_at": now, "opened_at": None, "submitted_at": None, "request_id": None,
        })
        ok = await _send_email(to, f"{cat['name']} — SmartShape catalogue",
                               _share_email_html(cat, school_name, f"{fe}/c/{token}", user.get("name") or "SmartShape"))
        shares.append(token)
        if ok:
            sent.append(to)
    return {"sent": sent, "failed": [x for x in batch if x not in sent], "invalid": invalid, "shares": shares,
            "skipped_over_limit": valid[SEND_PER_CALL:]}


# ── public (the school) ───────────────────────────────────────────────────────

async def _live_share(token: str):
    share = await db.catalogue_shares.find_one({"token": str(token)}, {"_id": 0})
    if not share:
        raise HTTPException(status_code=404, detail="Catalogue link not found")
    cat = await db.catalogues.find_one({"catalogue_id": share["catalogue_id"], "is_deleted": {"$ne": True}}, {"_id": 0})
    if not cat:
        raise HTTPException(status_code=404, detail="This catalogue is no longer available")
    return share, cat


@router.get("/public/catalogue-share/{token}")
async def public_catalogue_share(token: str):
    share, cat = await _live_share(token)
    if share.get("status") == "sent":
        await db.catalogue_shares.update_one({"token": share["token"]},
                                             {"$set": {"status": "opened", "opened_at": datetime.now(timezone.utc).isoformat()}})
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    logo_raw = company.get("logo_url", "")
    fe_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    return {
        "catalogue": {"name": cat["name"], "intro": cat.get("intro") or ""},
        "school_name": share.get("school_name") or "",
        "submitted": share.get("status") == "submitted",
        "dies": await _catalogue_dies(cat),
        "owned": await owned_by_die(db, share.get("school_id") or ""),
        "logo_url": (fe_url + logo_raw) if logo_raw.startswith("/") else logo_raw,
    }


@router.post("/public/catalogue-share/{token}/submit")
async def submit_catalogue_share(token: str, request: Request):
    if not _rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts — please try again in a few minutes")
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    share, cat = await _live_share(token)
    if share.get("status") in ("submitted", "submitting"):
        raise HTTPException(status_code=409, detail="This selection was already sent — we'll be in touch soon")

    by_id = {d["die_id"]: d for d in await _catalogue_dies(cat)}
    items = []
    sels = body.get("selections")
    for sel in (sels if isinstance(sels, list) else [])[:300]:
        if not isinstance(sel, dict):
            continue
        d = by_id.get(sel.get("die_id"))
        try:
            qty = int(float(sel.get("quantity") or 0))
        except (TypeError, ValueError):
            qty = 0
        if d and 1 <= qty <= 1000:
            items.append({"die_id": d["die_id"], "die_code": d.get("code") or "", "name": d.get("name") or "", "quantity": qty})
    if not items:
        raise HTTPException(status_code=400, detail="Choose at least one die")

    # Claim the link atomically BEFORE the slow part (team mail), so a double tap
    # or a retry can never file two requests.
    claimed = await db.catalogue_shares.find_one_and_update(
        {"token": share["token"], "status": {"$nin": ["submitted", "submitting"]}},
        {"$set": {"status": "submitting"}})
    if not claimed:
        raise HTTPException(status_code=409, detail="This selection was already sent — we'll be in touch soon")

    school = None
    if share.get("school_id"):
        school = await db.schools.find_one({"school_id": share["school_id"]}, {"_id": 0})
    doc = {
        "email": share["email"],
        "name": _clean(body.get("name"), 120),
        "phone": _clean(body.get("phone"), 40),
        "message": _clean_multiline(body.get("message")),
        "school_name": _clean(share.get("school_name") or (school or {}).get("school_name") or share["email"], 200),
        "address": _clean((school or {}).get("address"), 500),
        "city": _clean((school or {}).get("city"), 120),
        "principal_name": _clean((school or {}).get("primary_contact_name"), 120),
    }
    try:
        request_id = await create_request(doc, items, school, source="catalogue", extra={
            "catalogue_id": cat["catalogue_id"], "catalogue_name": cat["name"], "share_token": share["token"]})
    except Exception:
        await db.catalogue_shares.update_one({"token": share["token"]}, {"$set": {"status": claimed.get("status", "opened")}})
        raise
    await db.catalogue_shares.update_one({"token": share["token"]}, {"$set": {
        "status": "submitted", "submitted_at": datetime.now(timezone.utc).isoformat(), "request_id": request_id}})
    return {"ok": True, "request_id": request_id}
