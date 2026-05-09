from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid
import os
import requests
import logging

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_teams

router = APIRouter()

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
_storage_key = None


def _init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


async def touch_last_activity(entity_type: str, entity_id: str):
    if not entity_type or not entity_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    coll_map = {
        "school": ("schools", "school_id"),
        "lead": ("leads", "lead_id"),
        "contact": ("contacts", "contact_id"),
    }
    pair = coll_map.get(entity_type)
    if not pair:
        return
    coll, key = pair
    await db[coll].update_one({key: entity_id}, {"$set": {"last_activity_date": now_iso}})


async def generate_quote_number() -> str:
    year = datetime.now(timezone.utc).year
    existing = await db.quotations.find(
        {"quote_number": {"$regex": f"^Q-{year}-"}}
    ).sort("quote_number", -1).limit(1).to_list(1)
    if existing:
        last_num = int(existing[0]["quote_number"].split("-")[-1])
        next_num = last_num + 1
    else:
        next_num = 1
    return f"Q-{year}-{next_num:03d}"


# ==================== QUOTATION ENDPOINTS ====================

@router.get("/quotations")
async def get_quotations(request: Request, sales_person_id: Optional[str] = None):
    user = await get_current_user(request)
    team = get_team(user)
    query = {}
    if sales_person_id:
        query["sales_person_id"] = sales_person_id
    elif team == "sales":
        # Sales only see their own quotations
        query["sales_person_email"] = user["email"]
    # admin, accounts, store: see all quotations

    quotations = await db.quotations.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quotations


@router.post("/quotations")
async def create_quotation(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    # store team cannot create quotations; admin, accounts, sales can
    if team == "store":
        raise HTTPException(status_code=403, detail="Store team cannot create quotations")

    body = await request.json()

    package_id = body.get("package_id")
    package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    sp_id = body.get("sales_person_id", "")
    sp = await db.salespersons.find_one({"sales_person_id": sp_id}, {"_id": 0})
    if not sp:
        sp = await db.salespersons.find_one({"email": user["email"]}, {"_id": 0})
        if not sp:
            raise HTTPException(status_code=404, detail="Sales person not found")

    lines = body.get("lines", [])
    items_total = sum(l.get("line_subtotal", 0) for l in lines)

    d1 = body.get("discount1_pct", 0)
    d2 = body.get("discount2_pct", 0)
    fr = body.get("freight_amount", 0)

    disc1_amount = items_total * (d1 / 100)
    disc2_amount = items_total * (d2 / 100)
    freight_base = fr
    sub_total_after = items_total - disc1_amount - disc2_amount + freight_base
    gst_amount_final = sub_total_after * 0.18
    grand_total = sub_total_after + gst_amount_final

    quotation_id = f"quot_{uuid.uuid4().hex[:12]}"
    quote_number = await generate_quote_number()

    quot_doc = {
        "quotation_id": quotation_id,
        "quote_number": quote_number,
        "package_id": package_id,
        "package_name": package["display_name"],
        "principal_name": body.get("principal_name", ""),
        "school_name": body.get("school_name", ""),
        "address": body.get("address", ""),
        "customer_email": body.get("customer_email", ""),
        "customer_phone": body.get("customer_phone", ""),
        "customer_gst": body.get("customer_gst", ""),
        "sales_person_id": sp.get("sales_person_id"),
        "sales_person_name": sp["name"],
        "sales_person_email": sp["email"],
        "discount1_pct": d1,
        "discount2_pct": d2,
        "freight_amount": fr,
        "freight_gst_pct": 0,
        "subtotal": items_total,
        "gst_amount": gst_amount_final,
        "total_with_gst": grand_total,
        "disc1_amount": disc1_amount,
        "after_disc1": items_total - disc1_amount,
        "disc2_amount": disc2_amount,
        "after_disc2": items_total - disc1_amount - disc2_amount,
        "sub_total_after": sub_total_after,
        "freight_total": freight_base,
        "grand_total": grand_total,
        "font_size_mode": body.get("font_size_mode", "medium"),
        "quotation_status": "draft",
        "catalogue_status": "not_sent",
        "catalogue_token": None,
        "lines": lines,
        "bank_details_override": body.get("bank_details_override", ""),
        "terms_override": body.get("terms_override", ""),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.quotations.insert_one(quot_doc)
    try:
        sname = (body.get("school_name") or "").strip()
        if sname:
            sch = await db.schools.find_one({"school_name": sname}, {"_id": 0, "school_id": 1})
            if sch and sch.get("school_id"):
                await touch_last_activity("school", sch["school_id"])
    except Exception:
        pass
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})


@router.put("/quotations/{quotation_id}")
async def edit_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    allowed = {}
    for key in ("principal_name", "school_name", "address", "customer_email", "customer_phone",
                "customer_gst", "sales_person_id", "discount1_pct", "discount2_pct",
                "freight_amount", "lines", "quotation_status",
                "font_size_mode", "bank_details_override", "terms_override"):
        if key in body:
            allowed[key] = body[key]
    if "lines" in allowed:
        existing = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0}) or {}
        lines = allowed["lines"]
        items_total = sum(l.get("line_subtotal", 0) for l in lines)
        d1 = allowed.get("discount1_pct", body.get("discount1_pct", existing.get("discount1_pct", 0)))
        d2 = allowed.get("discount2_pct", body.get("discount2_pct", existing.get("discount2_pct", 0)))
        fr = allowed.get("freight_amount", body.get("freight_amount", existing.get("freight_amount", 0)))
        disc1 = items_total * (d1 / 100)
        disc2 = items_total * (d2 / 100)
        sub_total_after = items_total - disc1 - disc2 + fr
        gst_final = sub_total_after * 0.18
        allowed.update({
            "subtotal": items_total,
            "gst_amount": gst_final,
            "total_with_gst": sub_total_after + gst_final,
            "disc1_amount": disc1,
            "after_disc1": items_total - disc1,
            "disc2_amount": disc2,
            "after_disc2": items_total - disc1 - disc2,
            "sub_total_after": sub_total_after,
            "freight_total": fr,
            "grand_total": sub_total_after + gst_final,
        })
    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": allowed})
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})


@router.put("/quotations/{quotation_id}/status")
async def update_quotation_status(quotation_id: str, status: str, request: Request):
    user = await get_current_user(request)
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"quotation_status": status}},
    )
    return {"message": "Status updated"}


@router.delete("/quotations/{quotation_id}")
async def delete_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team not in ("admin", "accounts"):
        raise HTTPException(status_code=403, detail="Only Admin/Accounts team can delete quotations")
    result = await db.quotations.delete_one({"quotation_id": quotation_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return {"message": "Quotation deleted"}


@router.post("/quotations/{quotation_id}/new-version")
async def create_quotation_version(quotation_id: str, request: Request):
    user = await get_current_user(request)
    orig = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not orig:
        raise HTTPException(status_code=404, detail="Quotation not found")
    root_id = orig.get("parent_quotation_id") or quotation_id
    all_versions = await db.quotations.find(
        {"$or": [{"quotation_id": root_id}, {"parent_quotation_id": root_id}]},
        {"_id": 0, "version": 1},
    ).to_list(None)
    next_version = max((v.get("version", 1) for v in all_versions), default=1) + 1
    new_id = f"quot_{uuid.uuid4().hex[:12]}"
    new_number = await generate_quote_number()
    new_doc = {k: v for k, v in orig.items() if k not in ("quotation_id", "quote_number", "_id")}
    new_doc.update({
        "quotation_id": new_id,
        "quote_number": new_number,
        "version": next_version,
        "parent_quotation_id": root_id,
        "quotation_status": "draft",
        "catalogue_status": "not_sent",
        "catalogue_token": None,
        "catalogue_sent_at": None,
        "catalogue_opened_at": None,
        "catalogue_submitted_at": None,
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    if "version" not in orig:
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {"version": 1, "parent_quotation_id": None}},
        )
    await db.quotations.insert_one(new_doc)
    return await db.quotations.find_one({"quotation_id": new_id}, {"_id": 0})


@router.get("/quotations/{quotation_id}/versions")
async def get_quotation_versions(quotation_id: str, request: Request):
    await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    root_id = quot.get("parent_quotation_id") or quotation_id
    versions = await db.quotations.find(
        {"$or": [{"quotation_id": root_id}, {"parent_quotation_id": root_id}]},
        {"_id": 0, "quotation_id": 1, "quote_number": 1, "version": 1,
         "quotation_status": 1, "grand_total": 1, "created_at": 1},
    ).sort("version", 1).to_list(None)
    return versions


@router.post("/quotations/{quotation_id}/send-catalogue")
async def send_catalogue(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": datetime.now(timezone.utc).isoformat(),
                "quotation_status": "sent",
            }},
        )
    else:
        token = quot["catalogue_token"]

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"
    return {"catalogue_url": catalogue_url, "message": "Catalogue link generated"}


@router.post("/quotations/{quotation_id}/send-catalogue-email")
async def send_catalogue_with_email(quotation_id: str, request: Request):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": datetime.now(timezone.utc).isoformat(),
                "quotation_status": "sent",
            }},
        )
    else:
        token = quot["catalogue_token"]

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"

    email_result = await _send_catalogue_email(quotation_id, cc_emails=[user.get("email")])

    return {
        "catalogue_url": catalogue_url,
        "email_sent": email_result.get("success", False),
        "email_error": email_result.get("error"),
        "cc": email_result.get("cc", []),
        "message": "Catalogue link generated" + (" and email sent!" if email_result.get("success") else " (email not configured)"),
    }


async def _send_catalogue_email(quotation_id: str, cc_emails=None):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return {"success": False, "error": "Quotation not found"}

    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    sender_email = email_settings.get("sender_email") if email_settings else None
    app_password = email_settings.get("gmail_app_password") if email_settings else None
    sender_name = email_settings.get("sender_name", "SmartShape Pro") if email_settings else "SmartShape Pro"

    if not sender_email or not app_password:
        return {"success": False, "error": "Email credentials not configured. Ask admin to set Gmail SMTP in App Settings."}

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{quot['catalogue_token']}"

    cc_set = []
    for e in (cc_emails or []):
        if e and e.lower() != sender_email.lower() and e.lower() != (quot.get("customer_email") or "").lower() and e not in cc_set:
            cc_set.append(e)
    sp_email = quot.get("sales_person_email")
    if sp_email and sp_email.lower() != sender_email.lower() and sp_email.lower() != (quot.get("customer_email") or "").lower() and sp_email not in cc_set:
        cc_set.append(sp_email)

    subject = f"Catalogue Link - {quot['school_name']}"
    body = f"""Dear {quot['principal_name']},

Thank you for your interest in SmartShape Pro products!

We are pleased to share your personalized catalogue for {quot['package_name']}.

Please click the link below to view and select your preferred dies:
{catalogue_url}

For any queries, please contact:
{quot['sales_person_name']}
Email: {quot.get('sales_person_email', 'N/A')}

Best regards,
SmartShape Pro Team"""

    try:
        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = quot["customer_email"]
        if cc_set:
            msg["Cc"] = ", ".join(cc_set)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        recipients = [quot["customer_email"]] + cc_set
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())
        return {"success": True, "message": "Email sent successfully", "cc": cc_set}
    except Exception as e:
        logging.error(f"Email send error: {e}")
        return {"success": False, "error": str(e)}


# ==================== CATALOGUE PUBLIC ====================

@router.get("/catalogue/{token}")
async def get_catalogue(token: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Catalogue not found")

    if quot.get("catalogue_status") == "sent":
        await db.quotations.update_one(
            {"catalogue_token": token},
            {"$set": {
                "catalogue_status": "opened",
                "catalogue_opened_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

    package = await db.packages.find_one({"package_id": quot["package_id"]}, {"_id": 0})
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)

    return {"quotation": quot, "package": package, "dies": dies}


@router.post("/catalogue/{token}/submit")
async def submit_catalogue_selection(token: str, request: Request):
    body = await request.json()
    selected_dies = body.get("selected_dies", [])

    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Catalogue not found")

    selection_id = f"sel_{uuid.uuid4().hex[:12]}"
    selection_doc = {
        "selection_id": selection_id,
        "quotation_id": quot["quotation_id"],
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "customer_ip": request.client.host if request.client else "unknown",
    }
    await db.catalogue_selections.insert_one(selection_doc)

    for die_id in selected_dies:
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
        if die:
            await db.catalogue_selection_items.insert_one({
                "catalogue_selection_id": selection_id,
                "die_id": die_id,
                "die_name": die["name"],
                "die_code": die["code"],
                "die_type": die["type"],
                "die_image_url": die.get("image_url"),
            })
            await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": 1}})
            updated_die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
            available = updated_die["stock_qty"] - updated_die["reserved_qty"]
            if available < 0:
                await db.purchase_alerts.insert_one({
                    "alert_id": f"alert_{uuid.uuid4().hex[:12]}",
                    "die_id": die_id,
                    "die_code": die["code"],
                    "die_name": die["name"],
                    "die_type": die["type"],
                    "triggered_by_catalogue_selection_id": selection_id,
                    "current_stock": updated_die["stock_qty"],
                    "required_qty": updated_die["reserved_qty"],
                    "shortage_qty": abs(available),
                    "priority": "urgent" if abs(available) > 10 else "high",
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

    await db.quotations.update_one(
        {"catalogue_token": token},
        {"$set": {
            "catalogue_status": "submitted",
            "catalogue_submitted_at": datetime.now(timezone.utc).isoformat(),
            "quotation_status": "pending",
        }},
    )

    return {"message": "Selection submitted successfully"}


# ==================== QUOTATION PDF ====================

@router.get("/quotations/{quotation_id}/pdf")
async def download_quotation_pdf(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER
    import io as stdio

    buf = stdio.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm, topMargin=10*mm, bottomMargin=10*mm)

    styles = getSampleStyleSheet()
    FONT_SCALES = {"small": 0.85, "medium": 1.0, "large": 1.15}
    fs_mode = (quot.get("font_size_mode") or "medium")
    scale = FONT_SCALES.get(fs_mode, 1.0)

    def sz(n):
        return max(5, round(n * scale))

    styles.add(ParagraphStyle(name='CoName', fontSize=sz(14), leading=sz(17), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2)))
    styles.add(ParagraphStyle(name='CoSub', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.3, 0.3, 0.4)))
    styles.add(ParagraphStyle(name='QTitle', fontSize=sz(13), leading=sz(16), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_CENTER))
    styles.add(ParagraphStyle(name='Sm', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.15, 0.15, 0.2)))
    styles.add(ParagraphStyle(name='SmR', fontSize=sz(8), leading=sz(10), textColor=colors.Color(0.15, 0.15, 0.2), alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name='Tiny', fontSize=sz(7), leading=sz(9), textColor=colors.Color(0.4, 0.4, 0.5)))
    styles.add(ParagraphStyle(name='BoldSm', fontSize=sz(9), leading=sz(11), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2)))
    styles.add(ParagraphStyle(name='BoldSmR', fontSize=sz(9), leading=sz(11), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name='Total', fontSize=sz(11), leading=sz(14), fontName='Helvetica-Bold', textColor=colors.Color(0.1, 0.1, 0.2), alignment=TA_RIGHT))

    elements = []
    accent = colors.Color(0.91, 0.27, 0.38)
    hdr_bg = colors.Color(0.95, 0.95, 0.97)

    co_name = company.get("company_name", "SmartShape Pro")
    co_addr = company.get("address", "")
    co_city = f"{company.get('city', '')}{', ' + company.get('state', '') if company.get('state') else ''} {company.get('pincode', '')}"
    co_contact = f"Phone: {company.get('phone', '')} | Email: {company.get('email', '')}"
    co_gst = f"GSTIN: {company.get('gst_number', '')}" if company.get('gst_number') else ""

    text_block = [Paragraph(co_name, styles['CoName'])]
    if co_addr:
        text_block.append(Paragraph(f"{co_addr}, {co_city}", styles['CoSub']))
    if co_contact:
        text_block.append(Paragraph(co_contact, styles['CoSub']))
    if co_gst:
        text_block.append(Paragraph(co_gst, styles['CoSub']))

    logo_image = None
    logo_url = company.get("logo_url", "")
    if logo_url:
        try:
            from reportlab.platypus import Image as RLImage
            from reportlab.lib.utils import ImageReader
            import io as _io
            img_bytes = None
            if logo_url.startswith("/api/files/"):
                key = _init_storage()
                obj_path = logo_url.replace("/api/files/", "", 1)
                r = requests.get(f"{STORAGE_URL}/objects/{obj_path}",
                                 headers={"X-Storage-Key": key}, timeout=15)
                if r.ok:
                    img_bytes = r.content
            elif logo_url.startswith("http://") or logo_url.startswith("https://"):
                r = requests.get(logo_url, timeout=15)
                if r.ok:
                    img_bytes = r.content
            if img_bytes:
                ir = ImageReader(_io.BytesIO(img_bytes))
                iw, ih = ir.getSize()
                target_h = 22 * mm
                target_w = (iw / ih) * target_h if ih else 30 * mm
                if target_w > 50 * mm:
                    target_w = 50 * mm
                    target_h = (ih / iw) * target_w if iw else target_h
                logo_image = RLImage(_io.BytesIO(img_bytes), width=target_w, height=target_h)
        except Exception as _e:
            logging.warning(f"PDF logo load failed: {_e}")
            logo_image = None

    if logo_image is not None:
        header_tbl = Table([[logo_image, text_block]], colWidths=[55*mm, 131*mm])
        header_tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_tbl)
    else:
        for el in text_block:
            elements.append(el)
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width="100%", thickness=1, color=accent))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph("QUOTATION", styles['QTitle']))
    elements.append(Spacer(1, 2*mm))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.Color(0.8, 0.8, 0.85)))
    elements.append(Spacer(1, 3*mm))

    quote_date = quot.get("created_at", "")[:10]
    info_left = f"""<b>Quote No:</b> {quot.get('quote_number', '')}<br/>
<b>Date:</b> {quote_date}<br/>
<b>Valid Till:</b> 30 days from date<br/>
<b>Sales Person:</b> {quot.get('sales_person_name', '')}"""

    info_right = f"""<b>To:</b><br/>
<b>{quot.get('school_name', '')}</b><br/>
{quot.get('principal_name', '')}<br/>
{quot.get('address', '')}<br/>
Ph: {quot.get('customer_phone', '')} | {quot.get('customer_email', '')}"""
    if quot.get('customer_gst'):
        info_right += f"<br/>GSTIN: {quot['customer_gst']}"

    info_table = Table([
        [Paragraph(info_left, styles['Sm']), Paragraph(info_right, styles['Sm'])]
    ], colWidths=[90*mm, 96*mm])
    info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 4*mm))

    lines = quot.get("lines", [])
    tbl_header = ["Sr.", "Description of Product", "Type", "Qty", "Rate", "GST", "Amount"]
    tbl_data = [tbl_header]
    for i, l in enumerate(lines):
        tbl_data.append([
            str(i + 1),
            Paragraph(l.get("description", ""), styles['Sm']),
            l.get("product_type", ""),
            str(l.get("qty", 0)),
            f"{l.get('unit_price', 0):,.0f}",
            f"{l.get('line_gst', 0):,.0f}",
            f"{l.get('line_total', 0):,.0f}",
        ])

    col_widths = [10*mm, 68*mm, 20*mm, 14*mm, 24*mm, 20*mm, 30*mm]
    items_table = Table(tbl_data, colWidths=col_widths)
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), hdr_bg),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.Color(0.75, 0.75, 0.8)),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.Color(0.98, 0.98, 0.99)]),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 3*mm))

    items_total = quot.get("subtotal", 0)
    d1p = quot.get("discount1_pct", 0)
    d1a = quot.get("disc1_amount", 0)
    d2p = quot.get("discount2_pct", 0)
    d2a = quot.get("disc2_amount", 0)
    fr_total = quot.get("freight_total", 0)
    sub_total = quot.get("sub_total_after", items_total - d1a - d2a + fr_total)
    gst = quot.get("gst_amount", 0)
    gt = quot.get("grand_total", 0)

    sum_rows = [["Total", f"{items_total:,.2f}"]]
    if d1p > 0:
        sum_rows.append([f"Discount @ {d1p}%", f"{d1a:,.2f}"])
    if d2p > 0:
        sum_rows.append([f"Spl Additional Discount {d2p}%", f"{d2a:,.2f}"])
    if fr_total > 0:
        sum_rows.append(["Freight & Packing", f"{fr_total:,.2f}"])
    sum_rows.append(["Sub-total", f"{sub_total:,.2f}"])
    sum_rows.append(["GST @ 18%", f"{gst:,.2f}"])
    sum_rows.append(["Total", f"{gt:,.2f}"])

    sum_data = []
    for i, row in enumerate(sum_rows):
        is_first = i == 0
        is_last = i == len(sum_rows) - 1
        is_subtotal = row[0] == "Sub-total"
        label_style = styles['BoldSm'] if (is_first or is_last or is_subtotal) else styles['Sm']
        if is_last:
            value_style = styles['Total']
        elif is_subtotal or is_first:
            value_style = styles['BoldSmR']
        else:
            value_style = styles['SmR']
        sum_data.append([Paragraph(row[0], label_style), Paragraph(row[1], value_style)])

    sum_tbl = Table(sum_data, colWidths=[55*mm, 35*mm])
    sub_total_row_idx = next((i for i, r in enumerate(sum_rows) if r[0] == "Sub-total"), None)
    tbl_styles = [
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEABOVE', (0, -1), (-1, -1), 1, accent),
        ('LINEBELOW', (0, -1), (-1, -1), 1, accent),
        ('TOPPADDING', (0, -1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -2), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -2), 2),
    ]
    if sub_total_row_idx is not None:
        tbl_styles.append(('LINEABOVE', (0, sub_total_row_idx), (-1, sub_total_row_idx), 0.5, colors.Color(0.7, 0.7, 0.75)))
    sum_tbl.setStyle(TableStyle(tbl_styles))
    outer_sum = Table([['', sum_tbl]], colWidths=[96*mm, 90*mm])
    outer_sum.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
    elements.append(outer_sum)
    elements.append(Spacer(1, 5*mm))

    terms_raw = quot.get("terms_override") or company.get("terms_conditions", "")
    if terms_raw:
        terms_lines = [t.strip().lstrip("0123456789. )-") for t in str(terms_raw).split("\n") if t.strip()]
    else:
        terms_lines = [
            "Payment : 50% advance and balance 50% against Delivery",
            "Warranty : 1 year against any manufacturing Defect",
            "Machine not to be used for commercial purpose",
            "Local Duties/Taxes extra to be bore by buyer",
        ]

    bank_info = quot.get("bank_details_override") or company.get("bank_details", "")
    bank_lines = [ln.strip() for ln in str(bank_info).split("\n") if ln.strip()] if bank_info else []

    terms_block = [Paragraph('<b>Terms &amp; Conditions</b>', styles['BoldSm'])]
    for i, t in enumerate(terms_lines):
        terms_block.append(Paragraph(f'{i+1}. {t}', styles['Tiny']))
    terms_block.append(Spacer(1, 2*mm))

    bank_block = [Paragraph('<b>Bank Details</b>', styles['BoldSm'])]
    if bank_lines:
        for ln in bank_lines:
            bank_block.append(Paragraph(ln, styles['Sm']))
    else:
        bank_block.append(Paragraph(f"<i>Account : {co_name}</i>", styles['Sm']))
        bank_block.append(Paragraph("Bank details will be shared separately.", styles['Tiny']))

    tb_table = Table([[terms_block, bank_block]], colWidths=[105*mm, 81*mm])
    tb_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, 0), 6),
        ('LEFTPADDING', (1, 0), (1, 0), 6),
        ('BOX', (0, 0), (-1, -1), 0.3, colors.Color(0.85, 0.85, 0.9)),
        ('LINEAFTER', (0, 0), (0, 0), 0.3, colors.Color(0.85, 0.85, 0.9)),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(tb_table)
    elements.append(Spacer(1, 6*mm))

    sig_table = Table([
        ['', Paragraph(f'<font size=8>For <b>{co_name}</b></font>', styles['SmR'])],
        ['', ''],
        ['', Paragraph('<font size=7>Authorized Signatory</font>', styles['SmR'])],
    ], colWidths=[120*mm, 66*mm])
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
        ('TOPPADDING', (0, 1), (-1, 1), 15*mm),
    ]))
    elements.append(sig_table)

    doc.build(elements)
    buf.seek(0)
    filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
