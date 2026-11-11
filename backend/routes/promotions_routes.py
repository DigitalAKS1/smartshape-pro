from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid, logging, os, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db
from auth_utils import get_current_user
from rbac import has_module, get_team
import services.offers as offers_svc

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _email_cfg():
    s = await db.settings.find_one({"type": "email"}, {"_id": 0})
    se = s.get("sender_email") if s else None
    ap = s.get("gmail_app_password") if s else None
    sn = s.get("sender_name", "SmartShape Pro") if s else "SmartShape Pro"
    if not se or not ap:
        raise ValueError("Email not configured")
    return se, ap, sn


async def _blast_customers(subject: str, body_fn):
    """Send bulk email to all customers with a catalogue_token. body_fn(q) -> str"""
    se, ap, sn = await _email_cfg()
    quotations = await db.quotations.find(
        {"customer_email": {"$exists": True, "$ne": ""},
         "catalogue_token": {"$exists": True, "$ne": ""}},
        {"_id": 0, "customer_email": 1, "principal_name": 1,
         "school_name": 1, "catalogue_token": 1}
    ).to_list(2000)
    sent = 0
    for q in quotations:
        email = q.get("customer_email", "").strip()
        if not email:
            continue
        try:
            msg = MIMEMultipart()
            msg["From"] = f"{sn} <{se}>"
            msg["To"] = email
            msg["Subject"] = subject
            msg.attach(MIMEText(body_fn(q), "plain", "utf-8"))
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
                smtp.login(se, ap)
                smtp.sendmail(se, [email], msg.as_string())
            sent += 1
        except Exception as e:
            logging.error(f"Blast failed for {email}: {e}")
    return sent


# ── Promotions ────────────────────────────────────────────────────────────────

def _require_offer_editor(user: dict):
    # Offers change what schools are shown and quoted — CRM edit access only.
    if get_team(user) != "admin" and not has_module(user, "leads", "read_write"):
        raise HTTPException(status_code=403, detail="You need CRM edit access to manage offers")


def _str_list(v) -> list:
    return list(dict.fromkeys(str(x).strip() for x in v if str(x or "").strip()))[:500] if isinstance(v, list) else []


def _offer_fields(body: dict) -> dict:
    out = {}
    if "discount_pct" in body:
        try:
            pct = round(float(body.get("discount_pct") or 0), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Discount must be a number")
        if not 0 <= pct <= 90:
            raise HTTPException(status_code=400, detail="Discount must be between 0 and 90%")
        out["discount_pct"] = pct
    for k in ("categories", "die_ids", "package_ids"):
        if k in body:
            out[k] = _str_list(body.get(k))
    if "applies_to_all" in body:
        out["applies_to_all"] = bool(body.get("applies_to_all"))
    return out

@router.get("/promotions")
async def list_promotions():
    promos = await db.promotions.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return promos


@router.post("/promotions")
async def create_promotion(request: Request):
    user = await get_current_user(request)
    _require_offer_editor(user)
    body = await request.json()
    promo_id = f"promo_{uuid.uuid4().hex[:12]}"
    doc = {
        "promo_id": promo_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "promo_type": body.get("promo_type", "discount"),   # discount / bundle / scheme
        "details": body.get("details", ""),
        "valid_from": body.get("valid_from", ""),
        "valid_until": body.get("valid_until", ""),
        "image_url": body.get("image_url", ""),
        "cta_text": body.get("cta_text", ""),
        "cta_url": body.get("cta_url", ""),
        "is_active": body.get("is_active", True),
        "target": body.get("target", "all"),               # all / new / existing
        "discount_pct": 0.0, "categories": [], "die_ids": [], "package_ids": [], "applies_to_all": False,
        **_offer_fields(body),
        "created_at": _now(),
        "created_by": user["email"],
    }
    await db.promotions.insert_one(doc)
    return doc


@router.put("/promotions/{promo_id}")
async def update_promotion(promo_id: str, request: Request):
    user = await get_current_user(request)
    _require_offer_editor(user)
    body = await request.json()
    allowed = ["title", "description", "promo_type", "details",
               "valid_from", "valid_until", "image_url", "cta_text", "cta_url",
               "is_active", "target"]
    updates = {k: body[k] for k in allowed if k in body}
    updates.update(_offer_fields(body))
    updates["updated_at"] = _now()
    await db.promotions.update_one({"promo_id": promo_id}, {"$set": updates})
    return {"ok": True}


@router.delete("/promotions/{promo_id}")
async def delete_promotion(promo_id: str, request: Request):
    user = await get_current_user(request)
    _require_offer_editor(user)
    await db.promotions.delete_one({"promo_id": promo_id})
    return {"ok": True}


@router.get("/offers/package/{package_id}")
async def offers_for_package(package_id: str, request: Request):
    """Live offers a quotation for this package can apply (best first)."""
    await get_current_user(request)
    return await offers_svc.offers_for_package(db, package_id)


# ── Announcements ─────────────────────────────────────────────────────────────

@router.get("/announcements")
async def list_announcements():
    items = await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@router.post("/announcements")
async def create_announcement(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    ann_id = f"ann_{uuid.uuid4().hex[:12]}"
    doc = {
        "announcement_id": ann_id,
        "title": body.get("title", ""),
        "body": body.get("body", ""),
        "type": body.get("type", "news"),      # new_die / new_feature / news
        "image_url": body.get("image_url", ""),
        "die_id": body.get("die_id", ""),      # optional, for new die announcements
        "is_published": body.get("is_published", True),
        "published_at": _now() if body.get("is_published", True) else "",
        "notify_sent": False,
        "notify_sent_at": "",
        "notify_count": 0,
        "created_at": _now(),
        "created_by": user["email"],
    }
    await db.announcements.insert_one(doc)
    return doc


@router.put("/announcements/{ann_id}")
async def update_announcement(ann_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = ["title", "body", "type", "image_url", "die_id", "is_published"]
    updates = {k: body[k] for k in allowed if k in body}
    if "is_published" in updates and updates["is_published"]:
        updates.setdefault("published_at", _now())
    updates["updated_at"] = _now()
    await db.announcements.update_one({"announcement_id": ann_id}, {"$set": updates})
    return {"ok": True}


@router.delete("/announcements/{ann_id}")
async def delete_announcement(ann_id: str, request: Request):
    await get_current_user(request)
    await db.announcements.delete_one({"announcement_id": ann_id})
    return {"ok": True}


@router.post("/announcements/{ann_id}/notify")
async def notify_announcement(ann_id: str, request: Request):
    """Blast all customers with this announcement via email."""
    await get_current_user(request)
    ann = await db.announcements.find_one({"announcement_id": ann_id}, {"_id": 0})
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")

    def body_fn(q):
        salutation = q.get("principal_name") or "Sir/Ma'am"
        portal_url = f"{frontend_url}/my-quote/{q['catalogue_token']}"
        return f"""Dear {salutation},

{ann['title']}

{ann.get('body', '')}

Stay updated with the latest from SmartShape Pro:
{portal_url}

Best regards,
SmartShape Pro Team"""

    try:
        sent = await _blast_customers(f"SmartShape Update: {ann['title']}", body_fn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await db.announcements.update_one(
        {"announcement_id": ann_id},
        {"$set": {"notify_sent": True, "notify_sent_at": _now(), "notify_count": sent}}
    )
    return {"sent": sent}


@router.post("/promotions/{promo_id}/notify")
async def notify_promotion(promo_id: str, request: Request):
    """Blast all customers with this promotion."""
    await get_current_user(request)
    promo = await db.promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")

    def body_fn(q):
        salutation = q.get("principal_name") or "Sir/Ma'am"
        portal_url = f"{frontend_url}/my-quote/{q['catalogue_token']}"
        return f"""Dear {salutation},

Exclusive Offer for You: {promo['title']}

{promo.get('description', '')}
{promo.get('details', '')}

Valid: {promo.get('valid_from', '')} to {promo.get('valid_until', '')}

View your portal for more details:
{portal_url}

Best regards,
SmartShape Pro Team"""

    try:
        sent = await _blast_customers(f"Special Offer: {promo['title']}", body_fn)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"sent": sent}
