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
    package = None
    if package_id:
        package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})

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

    disc1_amount       = items_total * (d1 / 100)
    subtotal_after_d1  = items_total - disc1_amount
    disc2_amount       = subtotal_after_d1 * (d2 / 100)
    subtotal_after_disc = subtotal_after_d1 - disc2_amount
    total_gst          = subtotal_after_disc * 0.18
    freight_base       = fr
    freight_gst        = freight_base * 0.18
    freight_with_gst   = freight_base + freight_gst
    grand_total        = subtotal_after_disc + total_gst + freight_with_gst

    quotation_id = f"quot_{uuid.uuid4().hex[:12]}"
    quote_number = await generate_quote_number()

    quot_doc = {
        "quotation_id": quotation_id,
        "quote_number": quote_number,
        "package_id": package_id,
        "package_name": package["display_name"] if package else "",
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
        "freight_gst_pct": 18,
        "subtotal": items_total,
        "gst_amount": total_gst,
        "total_with_gst": subtotal_after_disc + total_gst,
        "disc1_amount": disc1_amount,
        "after_disc1": subtotal_after_d1,
        "disc2_amount": disc2_amount,
        "after_disc2": subtotal_after_disc,
        "subtotal_after_disc": subtotal_after_disc,
        "sub_total_after": subtotal_after_disc,
        "freight_gst": freight_gst,
        "freight_with_gst": freight_with_gst,
        "freight_total": freight_with_gst,
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
        disc1              = items_total * (d1 / 100)
        sub_after_d1       = items_total - disc1
        disc2              = sub_after_d1 * (d2 / 100)
        sub_after_disc     = sub_after_d1 - disc2
        gst_final          = sub_after_disc * 0.18
        freight_gst_e      = fr * 0.18
        freight_with_gst_e = fr + freight_gst_e
        grand              = sub_after_disc + gst_final + freight_with_gst_e
        allowed.update({
            "subtotal": items_total,
            "gst_amount": gst_final,
            "total_with_gst": sub_after_disc + gst_final,
            "disc1_amount": disc1,
            "after_disc1": sub_after_d1,
            "disc2_amount": disc2,
            "after_disc2": sub_after_disc,
            "subtotal_after_disc": sub_after_disc,
            "sub_total_after": sub_after_disc,
            "freight_gst": freight_gst_e,
            "freight_with_gst": freight_with_gst_e,
            "freight_total": freight_with_gst_e,
            "grand_total": grand,
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


async def _get_email_settings():
    """Returns (sender_email, app_password, sender_name) or raises ValueError."""
    import smtplib
    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    sender_email = email_settings.get("sender_email") if email_settings else None
    app_password = email_settings.get("gmail_app_password") if email_settings else None
    sender_name = email_settings.get("sender_name", "SmartShape Pro") if email_settings else "SmartShape Pro"
    if not sender_email or not app_password:
        raise ValueError("Email credentials not configured. Go to Settings → Email and enter your Gmail address and App Password.")
    return sender_email, app_password, sender_name


def _build_cc_set(sender_email: str, customer_email: str, cc_emails=None, sp_email=None):
    seen = {sender_email.lower(), (customer_email or "").lower()}
    cc_set = []
    for e in (cc_emails or []):
        if e and e.lower() not in seen:
            seen.add(e.lower())
            cc_set.append(e)
    if sp_email and sp_email.lower() not in seen:
        cc_set.append(sp_email)
    return cc_set


async def _send_catalogue_email(quotation_id: str, cc_emails=None):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return {"success": False, "error": "Quotation not found"}

    to_email = quot.get("customer_email", "").strip()
    if not to_email:
        return {"success": False, "error": "Customer email not set on this quotation. Edit the quotation and add the customer email first."}

    token = quot.get("catalogue_token")
    if not token:
        return {"success": False, "error": "Catalogue link not generated yet."}

    try:
        sender_email, app_password, sender_name = await _get_email_settings()
    except ValueError as ve:
        return {"success": False, "error": str(ve)}

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"

    cc_set = _build_cc_set(sender_email, to_email, cc_emails, quot.get("sales_person_email"))

    subject = f"Your SmartShape Catalogue – {quot.get('school_name', '')}"
    body = f"""Dear {quot.get('principal_name', 'Sir/Ma\'am')},

Thank you for your interest in SmartShape Pro!

Please click the link below to view and select your preferred shapes from your personalised catalogue:

{catalogue_url}

Quote Reference: {quot.get('quote_number', '')}
School: {quot.get('school_name', '')}

For any queries please contact your sales representative:
{quot.get('sales_person_name', '')}
{quot.get('sales_person_email', '')}

Best regards,
SmartShape Pro Team"""

    try:
        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = to_email
        if cc_set:
            msg["Cc"] = ", ".join(cc_set)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        recipients = [to_email] + cc_set
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())
        logging.info(f"Catalogue email sent to {to_email} for quotation {quotation_id}")
        return {"success": True, "message": "Email sent successfully", "cc": cc_set}
    except Exception as e:
        logging.error(f"Catalogue email send error for {quotation_id}: {e}")
        return {"success": False, "error": str(e)}


@router.post("/quotations/{quotation_id}/send-quotation-email")
async def send_quotation_email(quotation_id: str, request: Request):
    """Send the quotation PDF as email attachment to the customer."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.application import MIMEApplication

    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    to_email = quot.get("customer_email", "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Customer email not set on this quotation. Edit it and add the customer email first.")

    try:
        sender_email, app_password, sender_name = await _get_email_settings()
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    cc_set = _build_cc_set(sender_email, to_email, [user.get("email")], quot.get("sales_person_email"))

    gst = quot.get("gst_amount", 0)
    freight = quot.get("freight_with_gst", quot.get("freight_total", 0))
    grand = quot.get("grand_total", 0)
    lines = quot.get("lines", [])
    line_summary = "\n".join(
        f"  • {l.get('description', 'Item')}  Qty: {l.get('qty', 1)}  ₹{l.get('line_total', 0):,.0f}"
        for l in lines
    )
    freight_line = f"Freight      : ₹{freight:,.0f}\n" if freight else ""

    salutation = quot.get(‘principal_name’, ‘’) or ‘Sir/Ma\’am’
    subject = f"Quotation {quot.get(‘quote_number’, ‘’)} – SmartShape Pro"
    body = f"""Dear {salutation},

Please find attached your quotation from SmartShape Pro.

Quote Number : {quot.get('quote_number', '')}
School       : {quot.get('school_name', '')}
Package      : {quot.get('package_name', '') or 'Custom'}

Items:
{line_summary or '  (No items listed)'}

GST (18%)    : ₹{gst:,.0f}
{freight_line}─────────────────────────
TOTAL PAYABLE: ₹{grand:,.0f}

The quotation PDF is attached to this email for your records.

For queries please contact:
{quot.get('sales_person_name', '')}
{quot.get('sales_person_email', '')}

Best regards,
SmartShape Pro Team"""

    # Generate PDF bytes
    try:
        company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
        pdf_bytes = await _generate_pdf_bytes(quot, company)
    except Exception as pdf_err:
        logging.error(f"PDF generation error for {quotation_id}: {pdf_err}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(pdf_err)}")

    filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"

    try:
        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = to_email
        if cc_set:
            msg["Cc"] = ", ".join(cc_set)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # Attach PDF
        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(pdf_part)

        recipients = [to_email] + cc_set
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())
        logging.info(f"Quotation email+PDF sent to {to_email} for {quotation_id}")
        return {"success": True, "message": f"Quotation emailed to {to_email}"}
    except Exception as e:
        logging.error(f"Quotation email error for {quotation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Email failed: {str(e)}")


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

    package_id = quot.get("package_id")
    package = None
    if package_id:
        package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})
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

async def _generate_pdf_bytes(quot: dict, company: dict) -> bytes:
    """Generate the quotation PDF and return raw bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
    from datetime import datetime as _dt, timedelta
    import io as stdio

    buf = stdio.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        leftMargin=12*mm, rightMargin=12*mm,
        topMargin=10*mm, bottomMargin=10*mm)

    # ── Brand palette ──────────────────────────────────────────────────────────
    BRAND  = colors.Color(0.914, 0.271, 0.376)  # #e94560
    NAVY   = colors.Color(0.102, 0.102, 0.180)  # #1a1a2e
    GRAY   = colors.Color(0.40,  0.40,  0.46)
    LGRAY  = colors.Color(0.955, 0.955, 0.970)
    BORDER = colors.Color(0.78,  0.78,  0.84)
    ALT    = colors.Color(0.978, 0.978, 0.992)
    GREEN  = colors.Color(0.09,  0.56,  0.22)
    WHITE  = colors.white

    scale = {"small": 0.85, "medium": 1.0, "large": 1.15}.get(
        quot.get("font_size_mode") or "medium", 1.0)
    def sz(n): return max(5, round(n * scale))

    S = getSampleStyleSheet()
    def ps(name, **kw): S.add(ParagraphStyle(name=name, **kw))

    ps('CoName',  fontSize=sz(15), leading=sz(19), fontName='Helvetica-Bold', textColor=NAVY)
    ps('CoSub',   fontSize=sz(7.5),leading=sz(10), textColor=GRAY)
    ps('QBig',    fontSize=sz(21), leading=sz(25), fontName='Helvetica-Bold', textColor=BRAND, alignment=TA_RIGHT)
    ps('QNum',    fontSize=sz(10), leading=sz(13), fontName='Helvetica-Bold', textColor=NAVY,  alignment=TA_RIGHT)
    ps('InfoLbl', fontSize=sz(7),  leading=sz(9),  fontName='Helvetica-Bold', textColor=BRAND)
    ps('InfoBig', fontSize=sz(10.5),leading=sz(13),fontName='Helvetica-Bold', textColor=NAVY)
    ps('InfoMed', fontSize=sz(9),  leading=sz(11.5),textColor=NAVY)
    ps('InfoGry', fontSize=sz(8),  leading=sz(10.5),textColor=GRAY)
    ps('TblHdrC', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_CENTER)
    ps('TblHdrR', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_RIGHT)
    ps('TblHdrL', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE)
    ps('TblL',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY)
    ps('TblC',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY, alignment=TA_CENTER)
    ps('TblR',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY, alignment=TA_RIGHT)
    ps('TblRB',   fontSize=sz(8.5),leading=sz(10.5),fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('SumL',    fontSize=sz(8.5),leading=sz(10.5),textColor=GRAY)
    ps('SumR',    fontSize=sz(8.5),leading=sz(10.5),fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('SumGrn',  fontSize=sz(8.5),leading=sz(10.5),textColor=GREEN, alignment=TA_RIGHT)
    ps('SubL',    fontSize=sz(9),  leading=sz(11.5),fontName='Helvetica-Bold', textColor=NAVY)
    ps('SubR',    fontSize=sz(9),  leading=sz(11.5),fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('GrandL',  fontSize=sz(10.5),leading=sz(14),fontName='Helvetica-Bold', textColor=WHITE)
    ps('GrandR',  fontSize=sz(13), leading=sz(17), fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_RIGHT)
    ps('Bold8',   fontSize=sz(8.5),leading=sz(10.5),fontName='Helvetica-Bold', textColor=NAVY)
    ps('Tiny',    fontSize=sz(7),  leading=sz(9),  textColor=GRAY)
    ps('SigTxt',  fontSize=sz(8),  leading=sz(10), textColor=GRAY, alignment=TA_RIGHT)
    ps('SigBold', fontSize=sz(8.5),leading=sz(11), fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)

    elements = []

    # ── Company info ───────────────────────────────────────────────────────────
    co_name   = company.get("company_name", "SmartShapes")
    co_addr   = company.get("address", "")
    co_city   = company.get("city", "")
    co_state  = company.get("state", "")
    co_pin    = company.get("pincode", "")
    co_phone  = company.get("phone", "")
    co_email  = company.get("email", "")
    co_gst    = company.get("gst_number", "")
    city_str  = ", ".join(filter(None, [co_city, co_state, co_pin]))
    cont_str  = "  |  ".join(filter(None, [f"Ph: {co_phone}" if co_phone else "", co_email]))

    left_co = [Paragraph(co_name, S['CoName'])]
    addr_line = (co_addr + (f", {city_str}" if city_str else "")) if co_addr else city_str
    if addr_line:
        left_co.append(Paragraph(addr_line, S['CoSub']))
    if cont_str:
        left_co.append(Paragraph(cont_str, S['CoSub']))
    if co_gst:
        left_co.append(Paragraph(f"GSTIN: {co_gst}", S['CoSub']))

    right_co = [
        Paragraph("QUOTATION", S['QBig']),
        Paragraph(quot.get("quote_number", ""), S['QNum']),
    ]

    # Logo
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
                if r.ok: img_bytes = r.content
            elif logo_url.startswith("http://") or logo_url.startswith("https://"):
                r = requests.get(logo_url, timeout=15)
                if r.ok: img_bytes = r.content
            if img_bytes:
                ir = ImageReader(_io.BytesIO(img_bytes))
                iw, ih = ir.getSize()
                th = 20 * mm
                tw = (iw / ih) * th if ih else 28 * mm
                if tw > 44 * mm:
                    tw = 44 * mm; th = (ih / iw) * tw if iw else th
                logo_image = RLImage(_io.BytesIO(img_bytes), width=tw, height=th)
        except Exception as _e:
            logging.warning(f"PDF logo load failed: {_e}")

    if logo_image:
        hdr = Table([[logo_image, left_co, right_co]], colWidths=[46*mm, 86*mm, 54*mm])
        hdr.setStyle(TableStyle([
            ('VALIGN', (0, 0), (1, 0), 'MIDDLE'),
            ('VALIGN', (2, 0), (2, 0), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
    else:
        hdr = Table([[left_co, right_co]], colWidths=[132*mm, 54*mm])
        hdr.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
    elements.append(hdr)
    elements.append(Spacer(1, 2.5*mm))
    elements.append(HRFlowable(width="100%", thickness=2.5, color=BRAND, spaceAfter=0.8))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=NAVY, spaceAfter=0))
    elements.append(Spacer(1, 4*mm))

    # ── Date calculations ──────────────────────────────────────────────────────
    try:
        _qd = _dt.fromisoformat(quot.get("created_at", "")[:10])
        date_str  = _qd.strftime("%d %b %Y")
        valid_str = (_qd + timedelta(days=30)).strftime("%d %b %Y")
    except Exception:
        date_str  = quot.get("created_at", "")[:10]
        valid_str = "30 days from date"

    # ── Info block ─────────────────────────────────────────────────────────────
    school    = quot.get("school_name", "")
    principal = quot.get("principal_name", "")
    address   = quot.get("address", "")
    cust_ph   = quot.get("customer_phone", "")
    cust_em   = quot.get("customer_email", "")
    cust_gst  = quot.get("customer_gst", "")

    def _kv(k, v):
        return Paragraph(f'<font color="#888899">{k}</font>  <b>{v}</b>', S['InfoGry'])

    left_info = [
        Paragraph("QUOTE DETAILS", S['InfoLbl']),
        Spacer(1, 1.5*mm),
        _kv("Quote No", quot.get("quote_number", "")),
        _kv("Date", date_str),
        _kv("Valid Till", valid_str),
        _kv("Sales Person", quot.get("sales_person_name", "—")),
    ]
    if quot.get("package_name"):
        left_info.append(_kv("Package", quot["package_name"]))

    right_info = [Paragraph("BILL TO", S['InfoLbl']), Spacer(1, 1.5*mm)]
    if school:
        right_info.append(Paragraph(f'<b>{school}</b>', S['InfoBig']))
        if principal:
            right_info.append(Paragraph(principal, S['InfoMed']))
    elif principal:
        right_info.append(Paragraph(f'<b>{principal}</b>', S['InfoBig']))
    for _line in filter(None, [
        address,
        f"Ph: {cust_ph}" if cust_ph else "",
        cust_em,
        f"GSTIN: {cust_gst}" if cust_gst else "",
    ]):
        right_info.append(Paragraph(_line, S['InfoGry']))

    info_t = Table([[left_info, right_info]], colWidths=[82*mm, 104*mm])
    info_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LGRAY),
        ('BOX',        (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEAFTER',  (0, 0), (0,  0),  0.5, BORDER),
        ('VALIGN',     (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING',   (0, 0), (-1, -1), 7),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 7),
    ]))
    elements.append(info_t)
    elements.append(Spacer(1, 4*mm))

    # ── Items table (Type column removed) ─────────────────────────────────────
    lines = quot.get("lines", [])
    # Sr(9) + Description(91) + Qty(13) + Rate(27) + GST(21) + Amount(25) = 186 mm
    cw = [9*mm, 91*mm, 13*mm, 27*mm, 21*mm, 25*mm]

    tbl_data = [[
        Paragraph("SR",            S['TblHdrC']),
        Paragraph("DESCRIPTION",   S['TblHdrL']),
        Paragraph("QTY",           S['TblHdrC']),
        Paragraph("RATE (₹)",      S['TblHdrR']),
        Paragraph("GST (₹)",       S['TblHdrR']),
        Paragraph("AMOUNT (₹)",    S['TblHdrR']),
    ]]
    for i, l in enumerate(lines):
        tbl_data.append([
            Paragraph(str(i + 1),                          S['TblC']),
            Paragraph(l.get("description", ""),            S['TblL']),
            Paragraph(str(l.get("qty", 0)),                S['TblC']),
            Paragraph(f"{l.get('unit_price', 0):,.0f}",   S['TblR']),
            Paragraph(f"{l.get('line_gst', 0):,.0f}",     S['TblR']),
            Paragraph(f"<b>{l.get('line_total', 0):,.0f}</b>", S['TblRB']),
        ])

    it = Table(tbl_data, colWidths=cw)
    it.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1,  0), NAVY),
        ('GRID',          (0, 0), (-1, -1), 0.3, BORDER),
        ('LINEBELOW',     (0, -1),(-1, -1), 0.8, NAVY),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING',   (0, 0), (-1, -1), 4),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [WHITE, ALT]),
    ]))
    elements.append(it)
    elements.append(Spacer(1, 3*mm))

    # ── Pricing summary ────────────────────────────────────────────────────────
    items_total = quot.get("subtotal", 0)
    d1p = quot.get("discount1_pct", 0)
    d1a = quot.get("disc1_amount", 0)
    d2p = quot.get("discount2_pct", 0)
    d2a = quot.get("disc2_amount", 0)
    sub_disc = quot.get("subtotal_after_disc", quot.get("after_disc2", items_total - d1a - d2a))
    gst = quot.get("gst_amount", 0)
    frw = quot.get("freight_with_gst", quot.get("freight_total", 0))
    gt  = quot.get("grand_total", 0)
    def fc(n): return f"{n:,.2f}"

    sum_rows = [(Paragraph("Items Total", S['SumL']), Paragraph(fc(items_total), S['SumR']))]
    if d1p > 0:
        sum_rows.append((Paragraph(f"Discount ({d1p}%)", S['SumL']), Paragraph(f"&#8722; {fc(d1a)}", S['SumGrn'])))
    if d2p > 0:
        sum_rows.append((Paragraph(f"Additional Discount ({d2p}%)", S['SumL']), Paragraph(f"&#8722; {fc(d2a)}", S['SumGrn'])))
    if d1p > 0 or d2p > 0:
        sum_rows.append((Paragraph("Subtotal After Discounts", S['SubL']), Paragraph(fc(sub_disc), S['SubR'])))
    sub_idx = len(sum_rows)
    sum_rows.append((Paragraph("Total GST @ 18%", S['SumL']), Paragraph(fc(gst), S['SumR'])))
    if frw > 0:
        sum_rows.append((Paragraph(f"Freight incl. 18% GST", S['SumL']), Paragraph(fc(frw), S['SumR'])))

    sum_tbl = Table([[r[0], r[1]] for r in sum_rows], colWidths=[60*mm, 32*mm])
    sum_tbl.setStyle(TableStyle([
        ('ALIGN',         (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LINEABOVE', (0, sub_idx), (-1, sub_idx), 0.5, BORDER),
        ('LINEBELOW', (0, sub_idx), (-1, sub_idx), 0.3, BORDER),
    ]))

    grand_tbl = Table([[
        Paragraph("TOTAL PAYABLE", S['GrandL']),
        Paragraph(f"&#8377; {fc(gt)}", S['GrandR']),
    ]], colWidths=[40*mm, 52*mm])
    grand_tbl.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), NAVY),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ]))

    outer_sum = Table([['', sum_tbl], ['', grand_tbl]], colWidths=[94*mm, 92*mm])
    outer_sum.setStyle(TableStyle([
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 1), (-1, 1),  3),
        ('BOTTOMPADDING', (0, 0), (-1, 0),  0),
    ]))
    elements.append(outer_sum)
    elements.append(Spacer(1, 5*mm))

    # ── Terms & Bank Details ───────────────────────────────────────────────────
    terms_raw = quot.get("terms_override") or company.get("terms_conditions", "")
    if terms_raw:
        terms_lines = [t.strip().lstrip("0123456789. )-") for t in str(terms_raw).split("\n") if t.strip()]
    else:
        terms_lines = [
            "Payment: 50% advance and balance 50% against delivery",
            "Warranty: 1 year against any manufacturing defect",
            "Machine not to be used for commercial purpose",
            "Local duties/taxes extra to be borne by buyer",
        ]

    bank_raw  = quot.get("bank_details_override") or company.get("bank_details", "")
    bank_lines = [l.strip() for l in str(bank_raw).split("\n") if l.strip()] if bank_raw else []

    tc_block = [Paragraph("<b>Terms &amp; Conditions</b>", S['Bold8'])]
    for i, t in enumerate(terms_lines):
        tc_block.append(Paragraph(f"{i + 1}.  {t}", S['Tiny']))

    bk_block = [Paragraph("<b>Bank Details</b>", S['Bold8'])]
    if bank_lines:
        for ln in bank_lines:
            bk_block.append(Paragraph(ln, S['Tiny']))
    else:
        bk_block.append(Paragraph(f"Account: {co_name}", S['Tiny']))
        bk_block.append(Paragraph("Bank details will be shared separately.", S['Tiny']))

    footer_t = Table([[tc_block, bk_block]], colWidths=[110*mm, 76*mm])
    footer_t.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEAFTER',     (0, 0), (0,  0),  0.5, BORDER),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',    (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING',   (0, 0), (-1, -1), 7),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 7),
    ]))
    elements.append(footer_t)
    elements.append(Spacer(1, 6*mm))

    # ── Signature block ────────────────────────────────────────────────────────
    sig_t = Table([
        ['', Paragraph(f'For &nbsp;<b>{co_name}</b>', S['SigBold'])],
        ['', ''],
        ['', Paragraph("Authorized Signatory", S['SigTxt'])],
    ], colWidths=[120*mm, 66*mm])
    sig_t.setStyle(TableStyle([
        ('VALIGN',        (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 1), (-1, 1),  12*mm),
        ('LINEABOVE',     (1, 2), (1,  2),  0.5, GRAY),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    elements.append(sig_t)

    doc.build(elements)
    buf.seek(0)
    return buf.read()


@router.get("/quotations/{quotation_id}/pdf")
async def download_quotation_pdf(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    import io as _io
    pdf_bytes = await _generate_pdf_bytes(quot, company)
    filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"
    return StreamingResponse(
        _io.BytesIO(pdf_bytes), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
