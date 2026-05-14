from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid, os, logging

from database import db
from auth_utils import get_current_user

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

async def _email_cfg():
    s = await db.settings.find_one({"type": "email"}, {"_id": 0})
    se = s.get("sender_email") if s else None
    ap = s.get("gmail_app_password") if s else None
    sn = s.get("sender_name", "SmartShape Pro") if s else "SmartShape Pro"
    if not se or not ap:
        raise ValueError("Email not configured")
    return se, ap, sn


async def _send_email(sender_email, app_password, sender_name, to_list, cc_list, subject, body_plain):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg["Subject"] = subject
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    recipients = to_list + cc_list
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender_email, app_password)
        smtp.sendmail(sender_email, recipients, msg.as_string())


# ── Customer portal — public read ─────────────────────────────────────────────

@router.get("/customer-portal/{token}")
async def get_customer_portal(token: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")

    selection = await db.catalogue_selections.find_one(
        {"quotation_id": quot["quotation_id"]}, {"_id": 0}
    )
    items = []
    if selection:
        items = await db.catalogue_selection_items.find(
            {"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}
        ).to_list(1000)

    # Check order status
    order = await db.orders.find_one({"quotation_id": quot["quotation_id"]}, {"_id": 0})

    return {
        "quotation": {
            "quote_number":       quot.get("quote_number"),
            "school_name":        quot.get("school_name"),
            "principal_name":     quot.get("principal_name"),
            "package_name":       quot.get("package_name"),
            "grand_total":        quot.get("grand_total"),
            "quotation_status":   quot.get("quotation_status"),
            "catalogue_status":   quot.get("catalogue_status"),
            "catalogue_submitted_at": quot.get("catalogue_submitted_at"),
            "sales_person_name":  quot.get("sales_person_name"),
            "sales_person_email": quot.get("sales_person_email"),
        },
        "selection_items": items,
        "order_status": order.get("order_status") if order else None,
        "production_stage": order.get("production_stage") if order else None,
    }


# ── Admin — update selection + notify customer ────────────────────────────────

@router.put("/customer-portal/{token}/update-selection")
async def update_customer_selection(token: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    replacements = body.get("replacements", [])   # [{old_die_id, new_die_id, note}]
    reason = body.get("reason", "").strip()

    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    selection = await db.catalogue_selections.find_one(
        {"quotation_id": quot["quotation_id"]}, {"_id": 0}
    )
    if not selection:
        raise HTTPException(status_code=404, detail="No catalogue selection found")

    now = datetime.now(timezone.utc).isoformat()
    removed_dies, added_dies = [], []

    for rep in replacements:
        old_die_id = rep.get("old_die_id")
        new_die_id = rep.get("new_die_id")
        note = rep.get("note", reason)

        # Mark old item removed
        if old_die_id:
            old_item = await db.catalogue_selection_items.find_one(
                {"catalogue_selection_id": selection["selection_id"], "die_id": old_die_id}, {"_id": 0}
            )
            if old_item:
                await db.catalogue_selection_items.update_one(
                    {"catalogue_selection_id": selection["selection_id"], "die_id": old_die_id},
                    {"$set": {"status": "removed_by_admin", "admin_note": note, "updated_at": now, "updated_by": user["email"]}}
                )
                # Release reserved stock
                await db.dies.update_one({"die_id": old_die_id}, {"$inc": {"reserved_qty": -1}})
                removed_dies.append(old_item)

        # Add new item
        if new_die_id:
            new_die = await db.dies.find_one({"die_id": new_die_id}, {"_id": 0})
            if new_die:
                # Check if already in selection
                existing = await db.catalogue_selection_items.find_one(
                    {"catalogue_selection_id": selection["selection_id"], "die_id": new_die_id}
                )
                if not existing:
                    await db.catalogue_selection_items.insert_one({
                        "catalogue_selection_id": selection["selection_id"],
                        "die_id": new_die_id,
                        "die_name": new_die["name"],
                        "die_code": new_die["code"],
                        "die_type": new_die["type"],
                        "die_image_url": new_die.get("image_url"),
                        "status": "added_by_admin",
                        "admin_note": note,
                        "updated_at": now,
                        "updated_by": user["email"],
                    })
                    await db.dies.update_one({"die_id": new_die_id}, {"$inc": {"reserved_qty": 1}})
                    added_dies.append(new_die)

    # Send notification email to customer
    customer_email = quot.get("customer_email", "")
    if customer_email and (removed_dies or added_dies):
        try:
            se, ap, sn = await _email_cfg()
            frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
            portal_url = f"{frontend_url}/my-quote/{token}"
            salutation = quot.get("principal_name") or "Sir/Ma'am"

            removed_lines = "\n".join(f"  ✗ {d.get('die_name')} ({d.get('die_code')})" for d in removed_dies)
            added_lines   = "\n".join(f"  ✓ {d.get('name')} ({d.get('code')})" for d in added_dies)

            body = f"""Dear {salutation},

We would like to inform you that some changes have been made to your shape selection for:

Quote: {quot.get('quote_number')}
School: {quot.get('school_name')}
"""
            if reason:
                body += f"\nReason: {reason}\n"
            if removed_lines:
                body += f"\nItems removed (not available):\n{removed_lines}\n"
            if added_lines:
                body += f"\nItems added as replacement:\n{added_lines}\n"

            body += f"""
You can view your updated selection at:
{portal_url}

For any queries please contact:
{quot.get('sales_person_name', '')}
{quot.get('sales_person_email', '')}

Best regards,
SmartShape Pro Team"""

            cc = [quot.get("sales_person_email", ""), user["email"]]
            cc = [e for e in cc if e and e.lower() != se.lower() and e.lower() != customer_email.lower()]
            await _send_email(se, ap, sn, [customer_email], cc,
                f"Update to your SmartShape selection – {quot.get('school_name')}", body)
        except Exception as e:
            logging.error(f"Customer selection update email failed: {e}")

    items = await db.catalogue_selection_items.find(
        {"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}
    ).to_list(1000)
    return {"message": "Selection updated", "items": items}


# ── Catalogue submission confirmation email (called from quotation_routes) ────

async def send_submission_confirmation(quotation_id: str, token: str):
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return

    customer_email = quot.get("customer_email", "")
    if not customer_email:
        return

    try:
        se, ap, sn = await _email_cfg()
    except ValueError:
        return

    selection = await db.catalogue_selections.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not selection:
        return

    items = await db.catalogue_selection_items.find(
        {"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}
    ).to_list(1000)

    std_items  = [i for i in items if i.get("die_type") == "standard"]
    large_items = [i for i in items if i.get("die_type") == "large"]
    other_items = [i for i in items if i.get("die_type") not in ("standard", "large")]

    def item_lines(lst):
        return "\n".join(f"  • {i.get('die_name')} ({i.get('die_code')})" for i in lst)

    sections = ""
    if std_items:
        sections += f"\nStandard Dies ({len(std_items)}):\n{item_lines(std_items)}\n"
    if large_items:
        sections += f"\nLarge Dies ({len(large_items)}):\n{item_lines(large_items)}\n"
    if other_items:
        sections += f"\nOther Items ({len(other_items)}):\n{item_lines(other_items)}\n"

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    portal_url = f"{frontend_url}/my-quote/{token}"
    salutation = quot.get("principal_name") or "Sir/Ma'am"

    body = f"""Dear {salutation},

Thank you! Your shape selection has been successfully submitted.

Quote Reference: {quot.get('quote_number')}
School: {quot.get('school_name')}
Total Items Selected: {len(items)}
{sections}
You can view your selection anytime at:
{portal_url}

Our team will review your selection and be in touch shortly. If any item is unavailable, we will inform you and suggest an alternative.

For queries please contact:
{quot.get('sales_person_name', '')}
{quot.get('sales_person_email', '')}

Best regards,
SmartShape Pro Team"""

    try:
        cc = [quot.get("sales_person_email", "")]
        cc = [e for e in cc if e and e.lower() != se.lower() and e.lower() != customer_email.lower()]
        await _send_email(se, ap, sn, [customer_email], cc,
            f"Your SmartShape Selection Confirmed – {quot.get('school_name')}", body)
        logging.info(f"Submission confirmation sent to {customer_email}")
    except Exception as e:
        logging.error(f"Submission confirmation email failed: {e}")
