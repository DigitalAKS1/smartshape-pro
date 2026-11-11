"""Quotation Requests — a school asks for a quote; the sales team answers it.

Public (no login): `/request-quote` page posts here. The request is stored,
emailed to the sales team (Settings → Notifications → quotation request
recipients, else the company sender address), confirmed to the requester, and
belled to the school's owner when the school is already in the CRM.

Deliberately NOT done here: creating a lead/school/contact. A lead fires the
"lead_created" drip, i.e. real emails to a stranger who only asked for a price.
The CRM records are created when a rep turns the request into a quotation
(POST /quotations already registers school + contact + lead), and that
quotation links back via `mark_request_quoted`.
"""
import asyncio
import html as _html
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import re
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from auth_utils import get_current_user
from database import db
from media_utils import gate_die_for_customer
from notify import notify_user
from rbac import require_module, sees_all
import import_engine as ie

router = APIRouter()

STATUSES = ("new", "quoted", "closed")
RATE_LIMIT, RATE_WINDOW = 5, 600
# Whole-site ceiling on public submissions per UTC day: every submit mails the
# team from the company Gmail, so a flood must never burn its daily send quota.
DAILY_PUBLIC_CAP = 150
_RATE: dict = {}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Only these die fields leave the building on the PUBLIC catalogue — never stock,
# reservations, costs or reorder levels.
PUBLIC_DIE_FIELDS = ("die_id", "code", "name", "type", "category", "product_type", "product_type_id",
                     "images", "image_url", "video_url", "description", "show_video", "show_description")


async def _send_email(to: str, subject: str, html: str) -> bool:
    """Read the mail settings here (Motor is bound to this loop), then do the
    blocking SMTP work in a thread so a public form never freezes the backend
    while Gmail answers. Never raises."""
    cfg = await db.settings.find_one({"type": "email"}, {"_id": 0}) or {}
    sender = (cfg.get("sender_email") or "").strip()
    pwd = (cfg.get("gmail_app_password") or "").strip()
    if not (sender and pwd):
        logging.warning("quotation requests: email not configured; skipping send to %s", to)
        return False
    return await asyncio.to_thread(_smtp_send, sender, pwd, cfg.get("sender_name") or "SmartShape Pro",
                                   to, subject, html)


def _smtp_send(sender: str, pwd: str, sender_name: str, to: str, subject: str, html: str) -> bool:
    try:
        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{sender}>"
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
            server.login(sender, pwd)
            server.sendmail(sender, [to], msg.as_string())
        return True
    except Exception as e:
        logging.warning("quotation requests: send to %s failed: %s", to, e)
        return False


def _client_ip(request) -> str:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[-1].strip()
    return fwd or (request.client.host if getattr(request, "client", None) else "?")


def _rate_ok(ip: str) -> bool:
    now_s = time.time()
    hits = [t for t in _RATE.get(ip, []) if now_s - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        _RATE[ip] = hits
        return False
    hits.append(now_s)
    _RATE[ip] = hits
    if len(_RATE) > 10000:          # bot-flood memory backstop
        _RATE.clear()
    return True


def _clean(v, limit=500) -> str:
    """Single-line text: CR/LF collapsed so nothing can break an email header."""
    return re.sub(r"[\r\n]+", " ", str(v or "")).strip()[:limit]


def _clean_multiline(v, limit=2000) -> str:
    return str(v or "").replace("\r\n", "\n").strip()[:limit]


async def _daily_cap_ok() -> bool:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    n = await db.quotation_requests.count_documents({"source": "public_form", "created_at": {"$gte": day}})
    return n < DAILY_PUBLIC_CAP


def _public_die(d: dict) -> dict:
    g = gate_die_for_customer(d)
    return {k: g[k] for k in PUBLIC_DIE_FIELDS if k in g}


async def _visible_dies() -> list:
    """Same visibility rule as the school catalogue: active dies of a product
    type published to schools (legacy dies with no type = Dies, visible)."""
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)
    visible = {t["product_type_id"] async for t in db.product_types.find(
        {"visible_to_schools": True, "is_active": {"$ne": False}}, {"product_type_id": 1, "_id": 0})}
    visible.add("ptype_dies")
    return [_public_die(d) for d in dies if d.get("product_type_id", "ptype_dies") in visible]


async def _recipients() -> list:
    s = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    raw = s.get("quotation_request_recipients") or ""
    if isinstance(raw, (list, tuple)):
        raw = ",".join(str(x) for x in raw)
    raw = str(raw)
    emails = [e.strip() for e in re.split(r"[,;\s]+", raw) if _EMAIL_RE.match(e.strip())]
    if emails:
        return list(dict.fromkeys(emails))
    cfg = await db.settings.find_one({"type": "email"}, {"_id": 0}) or {}
    sender = (cfg.get("sender_email") or "").strip()
    return [sender] if sender else []


def _team_email_html(doc: dict, link: str, bought_before: bool) -> str:
    e = _html.escape
    rows = "".join(
        f"<tr><td style='padding:4px 8px;font-family:monospace'>{e(i['die_code'])}</td>"
        f"<td style='padding:4px 8px'>{e(i['name'])}</td><td style='padding:4px 8px'>{i['quantity']}</td></tr>"
        for i in doc["items"])
    items = (f"<table style='border-collapse:collapse;border:1px solid #ddd'>"
             f"<tr style='background:#f5f5f5'><th style='padding:4px 8px'>Code</th><th style='padding:4px 8px'>Item</th>"
             f"<th style='padding:4px 8px'>Qty</th></tr>{rows}</table>") if doc["items"] else "<p><i>No items picked.</i></p>"
    repeat = ("<p style='color:#b45309'><b>This school has bought from us before</b> — check Purchase History "
              "and offer new dies.</p>") if bought_before else ""
    return (f"<div style='font-family:Arial,sans-serif;font-size:14px'>"
            f"<h2 style='color:#e94560'>New quotation request</h2>{repeat}"
            f"<p><b>School:</b> {e(doc['school_name'])}{(', ' + e(doc['city'])) if doc['city'] else ''}<br>"
            f"<b>Address:</b> {e(doc['address'])}<br>"
            f"<b>Contact:</b> {e(doc['name'])} — {e(doc['email'])}{(' · ' + e(doc['phone'])) if doc['phone'] else ''}<br>"
            f"<b>Principal:</b> {e(doc['principal_name']) or '—'}</p>"
            f"{('<p><b>Message:</b> ' + e(doc['message']) + '</p>') if doc['message'] else ''}"
            f"{items}<p><a href='{link}' style='color:#e94560'>Open in SmartShape → Quotation Requests</a></p></div>")


# ── public ────────────────────────────────────────────────────────────────────

@router.get("/public/quote-request/catalogue")
async def public_quote_catalogue():
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    logo_raw = company.get("logo_url", "")
    fe_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    return {"dies": await _visible_dies(),
            "logo_url": (fe_url + logo_raw) if logo_raw.startswith("/") else logo_raw,
            "company_name": company.get("company_name") or company.get("name") or "SmartShape"}


@router.post("/public/quote-request")
async def submit_quote_request(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    if _clean(body.get("website")):                     # honeypot: bots fill every field
        return {"ok": True, "request_id": "qr_ignored"}
    if not _rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many requests — please try again in a few minutes")
    if not await _daily_cap_ok():
        raise HTTPException(status_code=429, detail="We're receiving a lot of requests — please email us directly today")

    doc = {k: _clean(body.get(k)) for k in ("email", "name", "school_name", "address", "city",
                                             "principal_name", "phone")}
    doc["message"] = _clean_multiline(body.get("message"))
    for k, label in (("email", "Email"), ("name", "Your name"), ("school_name", "School name"), ("address", "Address")):
        if not doc[k]:
            raise HTTPException(status_code=400, detail=f"{label} is required")
    if not _EMAIL_RE.match(doc["email"]):
        raise HTTPException(status_code=400, detail="Enter a valid email address")

    by_id = {d["die_id"]: d for d in await _visible_dies()}
    items = []
    selections = body.get("selections")
    for sel in (selections if isinstance(selections, list) else [])[:300]:
        if not isinstance(sel, dict):
            continue
        d = by_id.get(sel.get("die_id"))
        try:
            qty = int(float(sel.get("quantity") or 0))
        except (TypeError, ValueError):
            qty = 0
        if d and 1 <= qty <= 1000:
            items.append({"die_id": d["die_id"], "die_code": d.get("code") or "", "name": d.get("name") or "", "quantity": qty})

    match = await ie.resolve_school(db, {"school_name": doc["school_name"], "city": doc["city"]})
    school = None
    if match["action"] == "update" and match.get("school_id"):
        school = await db.schools.find_one({"school_id": match["school_id"]}, {"_id": 0})

    now = datetime.now(timezone.utc).isoformat()
    doc.update({
        "request_id": f"qr_{uuid.uuid4().hex[:12]}", "source": "public_form", "status": "new",
        "items": items, "school_id": school["school_id"] if school else None,
        "assigned_to": (school or {}).get("assigned_to") or "",
        "quotation_id": None, "quote_number": "", "notes": "",
        "created_at": now, "updated_at": now,
    })
    await db.quotation_requests.insert_one(dict(doc))

    bought_before = False
    if school:
        bought_before = bool(await db.past_purchases.find_one(
            {"school_id": school["school_id"], "is_deleted": {"$ne": True}}, {"_id": 1})) or bool(
            await db.orders.find_one({"school_id": school["school_id"], "is_deleted": {"$ne": True}}, {"_id": 1}))
    link = f"{os.environ.get('FRONTEND_URL', '').rstrip('/')}/quotation-requests"
    subject = f"Quotation request: {doc['school_name']}" + (" (repeat customer)" if bought_before else "")
    html_team = _team_email_html(doc, link, bought_before)
    # Team only. No confirmation mail to the requester: the address is whatever a
    # stranger typed, and the success screen already confirms the request.
    for to in await _recipients():
        await _send_email(to, subject, html_team)
    if doc["assigned_to"]:
        await notify_user(doc["assigned_to"], type="quotation_request", title=f"Quotation request from {doc['school_name']}",
                          body=f"{doc['name']} ({doc['email']}) asked for a quotation.", ref_type="quotation_request",
                          ref_id=doc["request_id"], from_name=doc["name"])
    return {"ok": True, "request_id": doc["request_id"]}


# ── team side ─────────────────────────────────────────────────────────────────

def _scope(user: dict) -> dict:
    """A rep limited to their own quotations sees requests for their schools plus
    unclaimed ones (new schools) — never another rep's."""
    if sees_all(user, "quotations"):
        return {}
    return {"$or": [{"assigned_to": user.get("email", "")}, {"assigned_to": ""}, {"assigned_to": None}]}


async def _visible_request(user: dict, request_id: str):
    q = {"request_id": request_id}
    scope = _scope(user)
    return await db.quotation_requests.find_one({"$and": [q, scope]} if scope else q, {"_id": 0})


@router.get("/quotation-requests")
async def list_quote_requests(request: Request, status: str = None):
    user = await get_current_user(request)
    require_module(user, "quotations", "read")
    q = {"status": status} if status in STATUSES else {}
    scope = _scope(user)
    if scope:
        q = {"$and": [q, scope]} if q else scope
    rows = await db.quotation_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    sids = list({r["school_id"] for r in rows if r.get("school_id")})
    bought = set()
    if sids:
        bought |= {p["school_id"] async for p in db.past_purchases.find(
            {"school_id": {"$in": sids}, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1})}
        bought |= {o["school_id"] async for o in db.orders.find(
            {"school_id": {"$in": sids}, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1})}
    for r in rows:
        r["bought_before"] = r.get("school_id") in bought
    return rows


@router.get("/quotation-requests/{request_id}")
async def get_quote_request(request_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read")
    doc = await _visible_request(user, request_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Request not found")
    return doc


@router.put("/quotation-requests/{request_id}")
async def update_quote_request(request_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "quotations", "read_write")
    body = await request.json()
    patch = {}
    if "status" in body:
        if body["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status")
        patch["status"] = body["status"]
    if "notes" in body:
        patch["notes"] = _clean(body.get("notes"), 2000)
    if "assigned_to" in body:
        patch["assigned_to"] = _clean(body.get("assigned_to"), 200)
    if not await _visible_request(user, request_id):
        raise HTTPException(status_code=404, detail="Request not found")
    if patch:
        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
        patch["updated_by"] = user["email"]
        await db.quotation_requests.update_one({"request_id": request_id}, {"$set": patch})
    return await db.quotation_requests.find_one({"request_id": request_id}, {"_id": 0})


async def mark_request_quoted(target_db, request_id: str, quotation: dict):
    """Called by POST /quotations when a quote was made from a request."""
    if not request_id:
        return
    # Only an unanswered request links: an old URL or the back button must never
    # re-point a request that already has its quotation.
    await target_db.quotation_requests.update_one(
        {"request_id": request_id, "status": {"$ne": "quoted"}},
        {"$set": {"status": "quoted", "quotation_id": quotation.get("quotation_id"),
                  "quote_number": quotation.get("quote_number") or "",
                  "updated_at": datetime.now(timezone.utc).isoformat()}})
