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


def _compute_totals(lines: list, d1: float, d2: float, fr: float) -> dict:
    """New formula: freight in sub-total, per-line GST rates, combined GST line."""
    items_total  = sum(l.get("line_subtotal", 0) for l in lines)
    disc1_amount = items_total * (d1 / 100)
    after_d1     = items_total - disc1_amount
    disc2_amount = after_d1 * (d2 / 100)
    after_disc   = after_d1 - disc2_amount
    freight_base = float(fr)
    sub_total    = after_disc + freight_base  # before GST, includes freight

    discount_factor = (after_disc / items_total) if items_total > 0 else 1.0
    raw_items_gst   = sum(
        l.get("line_subtotal", 0) * (l.get("gst_pct", 18) / 100) for l in lines
    )
    items_gst   = raw_items_gst * discount_factor
    freight_gst = freight_base * 0.18
    total_gst   = items_gst + freight_gst
    grand_total = sub_total + total_gst

    return dict(
        subtotal            = items_total,
        disc1_amount        = disc1_amount,
        after_disc1         = after_d1,
        disc2_amount        = disc2_amount,
        after_disc2         = after_disc,
        subtotal_after_disc = after_disc,
        sub_total_after     = after_disc,
        sub_total           = sub_total,
        items_gst           = items_gst,
        freight_gst         = freight_gst,
        freight_with_gst    = freight_base + freight_gst,
        freight_total       = freight_base + freight_gst,
        gst_amount          = total_gst,
        total_with_gst      = after_disc + total_gst,
        grand_total         = grand_total,
    )
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
    d1 = body.get("discount1_pct", 0)
    d2 = body.get("discount2_pct", 0)
    fr = body.get("freight_amount", 0)
    t  = _compute_totals(lines, d1, d2, fr)

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
        "currency_symbol": body.get("currency_symbol", "₹"),
        "discount1_pct": d1,
        "discount2_pct": d2,
        "freight_amount": fr,
        "freight_gst_pct": 18,
        **t,
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

    existing = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0}) or {}

    # Save edit history when quotation has already been sent
    prev_status = existing.get("quotation_status", "draft")
    if prev_status in ("sent", "pending", "confirmed"):
        edit_reason = body.get("edit_reason", "").strip()
        snapshot = {k: existing.get(k) for k in
                    ("lines", "discount1_pct", "discount2_pct", "freight_amount",
                     "grand_total", "gst_amount", "subtotal", "quotation_status")}
        await db.quotation_edit_history.insert_one({
            "history_id": f"hist_{uuid.uuid4().hex[:12]}",
            "quotation_id": quotation_id,
            "edited_by": user["email"],
            "edited_by_name": user.get("name", user["email"]),
            "edited_at": datetime.now(timezone.utc).isoformat(),
            "edit_reason": edit_reason or "No reason provided",
            "previous_snapshot": snapshot,
        })

    allowed = {}
    for key in ("principal_name", "school_name", "address", "customer_email", "customer_phone",
                "customer_gst", "sales_person_id", "discount1_pct", "discount2_pct",
                "freight_amount", "lines", "quotation_status", "currency_symbol",
                "font_size_mode", "bank_details_override", "terms_override"):
        if key in body:
            allowed[key] = body[key]

    if "lines" in allowed:
        lines = allowed["lines"]
        d1 = allowed.get("discount1_pct", existing.get("discount1_pct", 0))
        d2 = allowed.get("discount2_pct", existing.get("discount2_pct", 0))
        fr = allowed.get("freight_amount", existing.get("freight_amount", 0))
        allowed.update(_compute_totals(lines, d1, d2, fr))

    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": allowed})
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})


@router.get("/quotations/{quotation_id}/history")
async def get_quotation_history(quotation_id: str, request: Request):
    await get_current_user(request)
    history = await db.quotation_edit_history.find(
        {"quotation_id": quotation_id}, {"_id": 0}
    ).sort("edited_at", -1).to_list(50)
    return history


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
    user = await get_current_user(request)
    try:
        body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    except Exception:
        body = {}
    extra_to  = body.get("extra_to", []) if isinstance(body, dict) else []
    extra_cc  = body.get("extra_cc", []) if isinstance(body, dict) else []

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

    all_cc = list({user.get("email", "")} | set(extra_cc))
    # Pass token + url directly — avoids a second DB read that can miss the just-written token
    email_result = await _send_catalogue_email(quotation_id, cc_emails=all_cc, extra_to=extra_to,
                                               catalogue_url=catalogue_url, token=token, quot=quot)

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


async def _send_catalogue_email(quotation_id: str, cc_emails=None, extra_to=None,
                                catalogue_url: str = None, token: str = None, quot: dict = None):
    import smtplib, io as _io
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.application import MIMEApplication

    if quot is None:
        quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return {"success": False, "error": "Quotation not found"}

    primary_to = quot.get("customer_email", "").strip()
    extra_to_clean = [e.strip().lower() for e in (extra_to or []) if e and e.strip()]
    all_to = list(dict.fromkeys(filter(None, [primary_to] + extra_to_clean)))
    if not all_to:
        return {"success": False, "error": "No recipient email — add customer email to the quotation or enter one in the send dialog."}

    if not token:
        token = quot.get("catalogue_token")
    if not token:
        return {"success": False, "error": "Catalogue link not generated yet."}
    if not catalogue_url:
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
        catalogue_url = f"{frontend_url}/catalogue/{token}"

    try:
        sender_email, app_password, sender_name = await _get_email_settings()
    except ValueError as ve:
        return {"success": False, "error": str(ve)}

    cc_set = _build_cc_set(sender_email, all_to[0], cc_emails, quot.get("sales_person_email"))

    # ── Generate quotation PDF to attach ───────────────────────────────────────
    pdf_bytes = None
    pdf_filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"
    try:
        company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
        pdf_bytes = await _generate_pdf_bytes(quot, company)
    except Exception as _pdf_err:
        logging.warning(f"PDF generation for email attachment failed: {_pdf_err}")

    # ── HTML email body ────────────────────────────────────────────────────────
    subject   = f"Your Personalized Catalogue — {quot.get('school_name', '')}"
    principal = quot.get("principal_name", "") or "there"
    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a0a12 0%,#1a0a1a 60%,#0a0a12 100%);padding:40px 40px 32px;text-align:center;">
            <div style="display:inline-block;width:56px;height:56px;background:#e94560;border-radius:14px;line-height:56px;font-size:26px;font-weight:900;color:#fff;margin-bottom:14px;">S</div>
            <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">SmartShape<span style="color:#e94560;">Pro</span></h1>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.5);">Select Your Shapes, Seal the Deal</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Hello, {principal}!</h2>
            <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.7;">
              Thank you for your interest in <strong style="color:#1a1a2e;">SmartShape Pro</strong>.
              Your personalized product catalogue and quotation are ready.
            </p>

            <!-- School info box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:#fdf2f4;border-left:4px solid #e94560;border-radius:0 10px 10px 0;padding:18px 20px;">
                  <p style="margin:0 0 4px;font-size:13px;color:#888;">Catalogue prepared for</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">{quot.get('school_name', '')}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#e94560;font-weight:600;">{quot.get('package_name', '')} &nbsp;·&nbsp; Quote: {quot.get('quote_number', '')}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;font-size:15px;color:#555555;line-height:1.7;">
              Browse our product range and select your preferred dies. Your selections will be sent directly to our team.
              The quotation PDF is also attached for your reference.
            </p>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td align="center">
                  <a href="{catalogue_url}"
                     style="display:inline-block;background:#e94560;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 44px;border-radius:50px;letter-spacing:0.2px;box-shadow:0 4px 16px rgba(233,69,96,0.35);">
                    🎨&nbsp;&nbsp;Open My Catalogue
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;font-size:12px;color:#aaaaaa;text-align:center;">
              Or copy this link into your browser:<br>
              <a href="{catalogue_url}" style="color:#e94560;font-size:11px;word-break:break-all;">{catalogue_url}</a>
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr><td style="border-top:1px solid #eeeeee;"></td></tr>
            </table>

            <p style="margin:0 0 4px;font-size:13px;color:#888888;">Your sales executive</p>
            <p style="margin:0;font-size:15px;font-weight:700;color:#1a1a2e;">{quot.get('sales_person_name', '')}</p>
            <p style="margin:2px 0 0;font-size:13px;color:#555555;">{quot.get('sales_person_email', '')}</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fb;padding:24px 40px;border-top:1px solid #eeeeee;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;line-height:1.6;">
              This email was sent by SmartShape Pro on behalf of {quot.get('sales_person_name', 'your sales team')}.<br>
              Please do not reply to this email directly.
            </p>
            <p style="margin:10px 0 0;font-size:11px;color:#cccccc;">© 2025 SmartShape Pro. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    try:
        msg = MIMEMultipart("mixed")
        msg["From"]    = f"{sender_name} <{sender_email}>"
        msg["To"]      = ", ".join(all_to)
        if cc_set:
            msg["Cc"]  = ", ".join(cc_set)
        msg["Subject"] = subject

        # HTML part
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(html_body, "html", "utf-8"))
        msg.attach(alt)

        # PDF attachment
        if pdf_bytes:
            pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
            pdf_part.add_header("Content-Disposition", "attachment", filename=pdf_filename)
            msg.attach(pdf_part)

        recipients = all_to + cc_set
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())
        logging.info(f"Catalogue+PDF email sent to {all_to} for quotation {quotation_id}")
        return {"success": True, "message": "Email sent successfully", "cc": cc_set, "pdf_attached": pdf_bytes is not None}
    except Exception as e:
        logging.error(f"Catalogue email send error for {quotation_id}: {e}")
        return {"success": False, "error": str(e)}


@router.post("/quotations/{quotation_id}/send-quotation-email")
async def send_quotation_email(quotation_id: str, request: Request):
    """Send the quotation PDF as email attachment. Accepts extra_to / extra_cc in JSON body."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.application import MIMEApplication

    user = await get_current_user(request)
    body_json = {}
    try:
        body_json = await request.json()
    except Exception:
        pass
    extra_to = [e.strip().lower() for e in body_json.get("extra_to", []) if e and e.strip()]
    extra_cc = [e.strip().lower() for e in body_json.get("extra_cc", []) if e and e.strip()]

    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    primary_to = quot.get("customer_email", "").strip()
    all_to = list(dict.fromkeys(filter(None, [primary_to] + extra_to)))
    if not all_to:
        raise HTTPException(status_code=400, detail="No recipient email — add customer email to the quotation or enter one in the send dialog.")

    try:
        sender_email, app_password, sender_name = await _get_email_settings()
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    all_cc_inputs = list({user.get("email", "")} | set(extra_cc))
    cc_set = _build_cc_set(sender_email, all_to[0], all_cc_inputs, quot.get("sales_person_email"))

    gst = quot.get("gst_amount", 0)
    freight = quot.get("freight_with_gst", quot.get("freight_total", 0))
    grand = quot.get("grand_total", 0)
    lines = quot.get("lines", [])
    line_summary = "\n".join(
        f"  • {l.get('description', 'Item')}  Qty: {l.get('qty', 1)}  ₹{l.get('line_total', 0):,.0f}"
        for l in lines
    )
    freight_line = f"Freight      : ₹{freight:,.0f}\n" if freight else ""

    salutation = quot.get("principal_name", "") or "Sir/Ma'am"
    frontend_url_q = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_token = quot.get("catalogue_token", "")
    portal_url = f"{frontend_url_q}/my-quote/{catalogue_token}" if catalogue_token else ""

    subject = f"Quotation {quot.get('quote_number', '')} – SmartShape Pro"
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
{('You can track your quotation and view your selection at:' + chr(10) + portal_url + chr(10)) if portal_url else ''}
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
        msg["To"] = ", ".join(all_to)
        if cc_set:
            msg["Cc"] = ", ".join(cc_set)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # Attach PDF
        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(pdf_part)

        recipients = all_to + cc_set
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, recipients, msg.as_string())
        logging.info(f"Quotation email+PDF sent to {all_to} CC {cc_set} for {quotation_id}")
        return {"success": True, "message": f"Quotation emailed to {', '.join(all_to)}"}
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

    # Send confirmation email to customer (non-blocking)
    try:
        from routes.customer_routes import send_submission_confirmation
        await send_submission_confirmation(quot["quotation_id"], token)
    except Exception as e:
        logging.error(f"Submission confirmation email error: {e}")

    return {"message": "Selection submitted successfully"}


# ==================== QUOTATION PDF ====================

async def _generate_pdf_bytes(quot: dict, company: dict) -> bytes:
    """Generate a professional quotation PDF and return raw bytes."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT, TA_JUSTIFY
    from datetime import datetime as _dt, timedelta
    import io as stdio

    buf = stdio.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        leftMargin=14*mm, rightMargin=14*mm,
        topMargin=8*mm, bottomMargin=12*mm)

    # ── Palette ────────────────────────────────────────────────────────────────
    BRAND  = colors.Color(0.914, 0.271, 0.376)   # #e94560
    BRAND2 = colors.Color(0.95,  0.35,  0.48)    # lighter brand
    NAVY   = colors.Color(0.102, 0.102, 0.180)   # #1a1a2e
    NAVY2  = colors.Color(0.16,  0.16,  0.28)    # slightly lighter navy
    GRAY   = colors.Color(0.42,  0.42,  0.50)
    DKGRAY = colors.Color(0.25,  0.25,  0.32)
    LGRAY  = colors.Color(0.953, 0.953, 0.968)
    BORDER = colors.Color(0.80,  0.80,  0.86)
    ALT    = colors.Color(0.975, 0.975, 0.990)
    GREEN  = colors.Color(0.07,  0.53,  0.20)
    ACCENT = colors.Color(0.98,  0.97,  1.00)    # very light purple tint
    WHITE  = colors.white
    BLACK  = colors.black

    font_scale = {"small": 0.85, "medium": 1.0, "large": 1.15}.get(
        quot.get("font_size_mode") or "medium", 1.0)
    def sz(n): return max(5, round(n * font_scale))

    SYM = quot.get("currency_symbol", "₹")  # default ₹

    S = getSampleStyleSheet()
    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))

    ps('CoName',  fontSize=sz(14), leading=sz(18), fontName='Helvetica-Bold', textColor=NAVY)
    ps('CoSub',   fontSize=sz(7.5),leading=sz(10.5), textColor=GRAY)
    ps('QTitle',  fontSize=sz(22), leading=sz(26), fontName='Helvetica-Bold', textColor=BRAND, alignment=TA_RIGHT)
    ps('QNum',    fontSize=sz(9.5),leading=sz(12.5),fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('QDate',   fontSize=sz(7.5),leading=sz(10), textColor=GRAY, alignment=TA_RIGHT)
    ps('SectLbl', fontSize=sz(6.5),leading=sz(8.5),fontName='Helvetica-Bold', textColor=BRAND, spaceAfter=1)
    ps('InfoKey', fontSize=sz(7),  leading=sz(9.5), textColor=GRAY)
    ps('InfoVal', fontSize=sz(8.5),leading=sz(11), fontName='Helvetica-Bold', textColor=NAVY)
    ps('BillBig', fontSize=sz(11), leading=sz(14), fontName='Helvetica-Bold', textColor=NAVY)
    ps('BillMed', fontSize=sz(8.5),leading=sz(11), textColor=NAVY)
    ps('BillSub', fontSize=sz(7.5),leading=sz(10), textColor=GRAY)
    ps('TblHdrC', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_CENTER)
    ps('TblHdrR', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_RIGHT)
    ps('TblHdrL', fontSize=sz(7.5),leading=sz(9.5),fontName='Helvetica-Bold', textColor=WHITE)
    ps('TblL',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY)
    ps('TblC',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY, alignment=TA_CENTER)
    ps('TblR',    fontSize=sz(8.5),leading=sz(10.5),textColor=NAVY, alignment=TA_RIGHT)
    ps('TblRB',   fontSize=sz(9),  leading=sz(11), fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('TblGst',  fontSize=sz(8),  leading=sz(10), textColor=GRAY, alignment=TA_CENTER)
    ps('SumLbl',  fontSize=sz(8.5),leading=sz(11), textColor=GRAY)
    ps('SumVal',  fontSize=sz(8.5),leading=sz(11), fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('SumGrn',  fontSize=sz(8.5),leading=sz(11), textColor=GREEN, alignment=TA_RIGHT)
    ps('SubLbl',  fontSize=sz(9),  leading=sz(12), fontName='Helvetica-Bold', textColor=NAVY)
    ps('SubVal',  fontSize=sz(9),  leading=sz(12), fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('GstLbl',  fontSize=sz(8.5),leading=sz(11), textColor=DKGRAY)
    ps('GstVal',  fontSize=sz(8.5),leading=sz(11), textColor=DKGRAY, alignment=TA_RIGHT)
    ps('GrandL',  fontSize=sz(11), leading=sz(14), fontName='Helvetica-Bold', textColor=WHITE)
    ps('GrandR',  fontSize=sz(13.5),leading=sz(17),fontName='Helvetica-Bold', textColor=WHITE, alignment=TA_RIGHT)
    ps('Bold8',   fontSize=sz(8.5),leading=sz(11), fontName='Helvetica-Bold', textColor=NAVY)
    ps('Tiny',    fontSize=sz(7),  leading=sz(9.5),textColor=GRAY)
    ps('SigLbl',  fontSize=sz(7.5),leading=sz(10), textColor=GRAY, alignment=TA_RIGHT)
    ps('SigCo',   fontSize=sz(9),  leading=sz(12), fontName='Helvetica-Bold', textColor=NAVY, alignment=TA_RIGHT)
    ps('FootNote',fontSize=sz(7),  leading=sz(9),  textColor=GRAY, alignment=TA_CENTER)

    elements = []

    # ── Load logo ──────────────────────────────────────────────────────────────
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
                MAX_LOGO_W, MAX_LOGO_H = 40 * mm, 16 * mm
                if iw and ih:
                    logo_scale = min(MAX_LOGO_W / iw, MAX_LOGO_H / ih)
                    tw = min(iw * logo_scale, MAX_LOGO_W)
                    th = min(ih * logo_scale, MAX_LOGO_H)
                else:
                    tw, th = 24 * mm, 14 * mm
                # Hard safety clamp — never let logo overflow the page frame
                tw = min(tw, MAX_LOGO_W)
                th = min(th, MAX_LOGO_H)
                logo_image = RLImage(_io.BytesIO(img_bytes), width=tw, height=th)
                # Force dimensions — some ReportLab builds ignore ctor params on BytesIO
                logo_image.drawWidth  = tw
                logo_image.drawHeight = th
        except Exception as _e:
            logging.warning(f"PDF logo load failed: {_e}")

    # ── Company data ───────────────────────────────────────────────────────────
    co_name  = company.get("company_name", "SmartShapes")
    co_addr  = company.get("address", "")
    co_city  = company.get("city", "")
    co_state = company.get("state", "")
    co_pin   = company.get("pincode", "")
    co_phone = company.get("phone", "")
    co_email = company.get("email", "")
    co_gst   = company.get("gst_number", "")
    city_str = ", ".join(filter(None, [co_city, co_state, co_pin]))
    addr_line = (co_addr + (f", {city_str}" if city_str else "")) if co_addr else city_str

    # ── Header row ─────────────────────────────────────────────────────────────
    left_co = [Paragraph(co_name, S['CoName'])]
    if addr_line:
        left_co.append(Paragraph(addr_line, S['CoSub']))
    contact_parts = []
    if co_phone: contact_parts.append(f"Ph: {co_phone}")
    if co_email: contact_parts.append(co_email)
    if contact_parts:
        left_co.append(Paragraph("  •  ".join(contact_parts), S['CoSub']))
    if co_gst:
        left_co.append(Paragraph(f"GSTIN: {co_gst}", S['CoSub']))

    try:
        _qd      = _dt.fromisoformat(quot.get("created_at", "")[:10])
        date_str = _qd.strftime("%d %B %Y")
        valid_str= (_qd + timedelta(days=30)).strftime("%d %B %Y")
    except Exception:
        date_str  = quot.get("created_at", "")[:10]
        valid_str = "30 days from date"

    right_co = [
        Paragraph("QUOTATION", S['QTitle']),
        Paragraph(quot.get("quote_number", ""), S['QNum']),
        Paragraph(date_str, S['QDate']),
    ]

    col_logo = 44 * mm if logo_image else 0
    col_left = (182 - col_logo) * mm - 52 * mm
    if logo_image:
        hdr = Table([[logo_image, left_co, right_co]],
                    colWidths=[col_logo, col_left, 52*mm])
        hdr.setStyle(TableStyle([
            ('VALIGN', (0, 0), (1, 0), 'MIDDLE'),
            ('VALIGN', (2, 0), (2, 0), 'TOP'),
            ('LEFTPADDING',  (0,0),(-1,-1), 0),
            ('RIGHTPADDING', (0,0),(-1,-1), 0),
            ('TOPPADDING',   (0,0),(-1,-1), 0),
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
        ]))
    else:
        hdr = Table([[left_co, right_co]], colWidths=[130*mm, 52*mm])
        hdr.setStyle(TableStyle([
            ('VALIGN', (0,0),(-1,-1), 'TOP'),
            ('LEFTPADDING',  (0,0),(-1,-1), 0),
            ('RIGHTPADDING', (0,0),(-1,-1), 0),
            ('TOPPADDING',   (0,0),(-1,-1), 0),
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
        ]))
    elements.append(hdr)
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width="100%", thickness=3, color=BRAND, spaceAfter=0.5))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=NAVY, spaceAfter=0))
    elements.append(Spacer(1, 4*mm))

    # ── Quote Details + Bill To ─────────────────────────────────────────────────
    school    = quot.get("school_name", "")
    principal = quot.get("principal_name", "")
    address   = quot.get("address", "")
    cust_ph   = quot.get("customer_phone", "")
    cust_em   = quot.get("customer_email", "")
    cust_gst  = quot.get("customer_gst", "")

    def _row(label, value):
        return Table([[Paragraph(label, S['InfoKey']), Paragraph(str(value), S['InfoVal'])]],
                     colWidths=[22*mm, 54*mm])

    details_block = [
        Paragraph("QUOTE DETAILS", S['SectLbl']),
        _row("Quote No.",    quot.get("quote_number", "")),
        _row("Date",         date_str),
        _row("Valid Until",  valid_str),
        _row("Sales Person", quot.get("sales_person_name", "—")),
    ]
    if quot.get("package_name"):
        details_block.append(_row("Package", quot["package_name"]))

    bill_block = [Paragraph("BILL TO", S['SectLbl'])]
    if school:
        bill_block.append(Paragraph(f'<b>{school}</b>', S['BillBig']))
        if principal:
            bill_block.append(Paragraph(principal, S['BillMed']))
    elif principal:
        bill_block.append(Paragraph(f'<b>{principal}</b>', S['BillBig']))
    for _ln in filter(None, [
        address,
        f"☎  {cust_ph}" if cust_ph else "",
        f"✉  {cust_em}" if cust_em else "",
        f"GSTIN: {cust_gst}" if cust_gst else "",
    ]):
        bill_block.append(Paragraph(_ln, S['BillSub']))

    info_t = Table([[details_block, bill_block]], colWidths=[82*mm, 100*mm])
    info_t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (0, 0), LGRAY),
        ('BACKGROUND',    (1, 0), (1, 0), ACCENT),
        ('BOX',           (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEAFTER',     (0, 0), (0,  0),  0.5, BORDER),
        ('LINEABOVE',     (0, 0), (0,  0),  2.5, BRAND),
        ('LINEABOVE',     (1, 0), (1,  0),  2.5, NAVY),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
    ]))
    elements.append(info_t)
    elements.append(Spacer(1, 5*mm))

    # ── Items table ────────────────────────────────────────────────────────────
    # Sr(8) + Description(85) + Qty(12) + Rate(28) + GST%(15) + Amount(34) = 182 mm
    lines = quot.get("lines", [])
    cw = [8*mm, 85*mm, 12*mm, 28*mm, 15*mm, 34*mm]

    rate_hdr  = f"RATE ({SYM})"
    amt_hdr   = f"AMOUNT ({SYM})"

    tbl_data = [[
        Paragraph("SR",          S['TblHdrC']),
        Paragraph("DESCRIPTION", S['TblHdrL']),
        Paragraph("QTY",         S['TblHdrC']),
        Paragraph(rate_hdr,      S['TblHdrR']),
        Paragraph("GST %",       S['TblHdrC']),
        Paragraph(amt_hdr,       S['TblHdrR']),
    ]]
    for i, l in enumerate(lines):
        gst_pct  = l.get("gst_pct", 18)
        gst_label = f"{int(gst_pct)}%" if gst_pct == int(gst_pct) else f"{gst_pct}%"
        tbl_data.append([
            Paragraph(str(i + 1),                                     S['TblC']),
            Paragraph(l.get("description", ""),                       S['TblL']),
            Paragraph(str(l.get("qty", 0)),                           S['TblC']),
            Paragraph(f"{l.get('unit_price', 0):,.0f}",               S['TblR']),
            Paragraph(gst_label,                                       S['TblGst']),
            Paragraph(f"<b>{l.get('line_total', 0):,.0f}</b>",        S['TblRB']),
        ])

    it = Table(tbl_data, colWidths=cw)
    it.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1,  0), NAVY),
        ('LINEBELOW',     (0,  0),(-1,  0), 1.0, BRAND),
        ('GRID',          (0, 1), (-1, -1), 0.25, BORDER),
        ('LINEBELOW',     (0, -1),(-1, -1), 1.0, NAVY),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 4),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [WHITE, ALT]),
    ]))
    elements.append(it)
    elements.append(Spacer(1, 4*mm))

    # ── Pricing summary (right-aligned) ────────────────────────────────────────
    items_total = quot.get("subtotal", 0)
    d1p  = quot.get("discount1_pct", 0)
    d1a  = quot.get("disc1_amount",  0)
    d2p  = quot.get("discount2_pct", 0)
    d2a  = quot.get("disc2_amount",  0)
    after_disc  = quot.get("subtotal_after_disc", quot.get("after_disc2", items_total - d1a - d2a))
    freight_base = float(quot.get("freight_amount", 0))
    sub_total   = quot.get("sub_total", after_disc + freight_base)
    gst_amount  = quot.get("gst_amount", 0)
    gt          = quot.get("grand_total", 0)

    def fc(n): return f"{n:,.2f}"

    sum_rows = [
        (Paragraph("Item Total", S['SumLbl']), Paragraph(fc(items_total), S['SumVal'])),
    ]
    if d1p > 0:
        sum_rows.append((Paragraph(f"Discount ({d1p}%)", S['SumLbl']),
                         Paragraph(f"&#8722; {fc(d1a)}", S['SumGrn'])))
    if d2p > 0:
        sum_rows.append((Paragraph(f"Additional Discount ({d2p}%)", S['SumLbl']),
                         Paragraph(f"&#8722; {fc(d2a)}", S['SumGrn'])))
    if freight_base > 0:
        sum_rows.append((Paragraph("Freight", S['SumLbl']),
                         Paragraph(f"+ {fc(freight_base)}", S['SumVal'])))

    sub_idx = len(sum_rows)
    sum_rows.append((Paragraph("Sub Total", S['SubLbl']),
                     Paragraph(fc(sub_total), S['SubVal'])))

    sum_rows.append((Paragraph("GST", S['GstLbl']),
                     Paragraph(fc(gst_amount), S['GstVal'])))

    # Summary table
    sum_tbl = Table([[r[0], r[1]] for r in sum_rows], colWidths=[60*mm, 34*mm])
    style_cmds = [
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 2),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 2),
        ('LINEABOVE',     (0, sub_idx), (-1, sub_idx), 0.8, NAVY),
        ('LINEBELOW',     (0, sub_idx), (-1, sub_idx), 0.3, BORDER),
        ('BACKGROUND',    (0, sub_idx), (-1, sub_idx), LGRAY),
    ]
    sum_tbl.setStyle(TableStyle(style_cmds))

    grand_row = [[
        Paragraph("TOTAL PAYABLE", S['GrandL']),
        Paragraph(f"{SYM} {fc(gt)}", S['GrandR']),
    ]]
    grand_tbl = Table(grand_row, colWidths=[40*mm, 54*mm])
    grand_tbl.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), NAVY),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEABOVE',     (0, 0), (-1, 0),  1.5, BRAND),
    ]))

    outer_sum = Table(
        [['', sum_tbl], ['', grand_tbl]],
        colWidths=[88*mm, 94*mm]
    )
    outer_sum.setStyle(TableStyle([
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 1), (-1, 1),  2),
        ('BOTTOMPADDING', (0, 0), (-1, 0),  0),
    ]))
    elements.append(outer_sum)
    elements.append(Spacer(1, 5*mm))

    # ── Terms & Bank Details ───────────────────────────────────────────────────
    terms_raw  = quot.get("terms_override") or company.get("terms_conditions", "")
    terms_lines = (
        [t.strip().lstrip("0123456789. )-") for t in str(terms_raw).split("\n") if t.strip()]
        if terms_raw else [
            "Payment: 50% advance and balance 50% against delivery",
            "Warranty: 1 year against any manufacturing defect",
            "Machine not to be used for commercial purpose",
            "Local duties / taxes extra to be borne by buyer",
        ]
    )

    bank_raw   = quot.get("bank_details_override") or company.get("bank_details", "")
    bank_lines = [l.strip() for l in str(bank_raw).split("\n") if l.strip()] if bank_raw else []

    tc_block = [Paragraph("<b>Terms &amp; Conditions</b>", S['Bold8']), Spacer(1, 1.5*mm)]
    for i, t in enumerate(terms_lines):
        tc_block.append(Paragraph(f"{i + 1}.  {t}", S['Tiny']))

    bk_block = [Paragraph("<b>Bank Details</b>", S['Bold8']), Spacer(1, 1.5*mm)]
    if bank_lines:
        for ln in bank_lines:
            bk_block.append(Paragraph(ln, S['Tiny']))
    else:
        bk_block.append(Paragraph(f"Account: {co_name}", S['Tiny']))
        bk_block.append(Paragraph("Bank details will be shared separately.", S['Tiny']))

    footer_t = Table([[tc_block, bk_block]], colWidths=[110*mm, 72*mm])
    footer_t.setStyle(TableStyle([
        ('BOX',           (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEAFTER',     (0, 0), (0,  0),  0.5, BORDER),
        ('LINEABOVE',     (0, 0), (-1, 0),  2.0, NAVY),
        ('BACKGROUND',    (0, 0), (-1, -1), LGRAY),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',    (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
    ]))
    elements.append(footer_t)
    elements.append(Spacer(1, 5*mm))

    # ── Signature block ────────────────────────────────────────────────────────
    sig_t = Table([
        ['', Paragraph(f'For &nbsp;<b>{co_name}</b>', S['SigCo'])],
        ['', Spacer(1, 14*mm)],
        ['', Paragraph("Authorized Signatory", S['SigLbl'])],
    ], colWidths=[120*mm, 62*mm])
    sig_t.setStyle(TableStyle([
        ('VALIGN',        (0, 0), (-1, -1), 'BOTTOM'),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LINEABOVE',     (1, 2), (1,  2),  0.5, GRAY),
    ]))
    elements.append(sig_t)

    # ── Footer note ────────────────────────────────────────────────────────────
    elements.append(Spacer(1, 3*mm))
    elements.append(HRFlowable(width="100%", thickness=0.3, color=BORDER))
    elements.append(Spacer(1, 1*mm))
    elements.append(Paragraph(
        f"This is a computer-generated quotation and does not require a signature. "
        f"Quote valid until {valid_str}.  •  {co_name}  •  {co_email}",
        S['FootNote']))

    try:
        doc.build(elements)
        buf.seek(0)
        return buf.read()
    except Exception as _build_err:
        # Retry without logo — most common cause is an oversized image overflowing a page frame
        logging.warning(f"PDF build failed ({_build_err}); retrying without company logo")
        if company.get("logo_url"):
            return await _generate_pdf_bytes(quot, {**company, "logo_url": ""})
        raise


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
