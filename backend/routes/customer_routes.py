from fastapi import APIRouter, HTTPException, Request, Response
from datetime import datetime, timezone, timedelta
import uuid, os, logging, smtplib, jwt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db
from auth_utils import get_current_user, hash_password, verify_password

router = APIRouter()

JWT_SECRET = os.environ.get("JWT_SECRET", "default-secret-key")
JWT_ALGORITHM = "HS256"


def _customer_token(account_id: str, email: str) -> str:
    payload = {
        "sub": account_id,
        "email": email,
        "role": "customer",
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_customer_account(request: Request) -> dict:
    token = request.cookies.get("customer_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "customer":
            raise HTTPException(status_code=403, detail="Customer access required")
        acc = await db.customer_accounts.find_one(
            {"account_id": payload["sub"]}, {"_id": 0, "password_hash": 0}
        )
        if not acc:
            raise HTTPException(status_code=401, detail="Account not found")
        return acc
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Customer account auth ─────────────────────────────────────────────────────

@router.post("/customer/login")
async def customer_login(request: Request, response: Response):
    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    acc = await db.customer_accounts.find_one({"email": email}, {"_id": 0})
    if not acc or not verify_password(password, acc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not acc.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account disabled")

    token = _customer_token(acc["account_id"], email)
    response.set_cookie(
        "customer_token", token,
        httponly=True, max_age=30 * 24 * 3600, samesite="lax", secure=False
    )
    return {
        "school_name":    acc.get("school_name"),
        "principal_name": acc.get("principal_name"),
        "email":          acc.get("email"),
        "catalogue_token": acc.get("catalogue_token"),
    }


@router.post("/customer/logout")
async def customer_logout(response: Response):
    response.delete_cookie("customer_token")
    return {"ok": True}


@router.get("/customer/me")
async def customer_me(request: Request):
    acc = await get_customer_account(request)
    return acc


# ── Admin: manage customer accounts ──────────────────────────────────────────

@router.get("/customer-accounts")
async def list_customer_accounts(request: Request):
    await get_current_user(request)
    accs = await db.customer_accounts.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return accs


@router.post("/customer-accounts")
async def create_customer_account(request: Request):
    await get_current_user(request)
    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "").strip()
    catalogue_token = body.get("catalogue_token", "").strip()

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    existing = await db.customer_accounts.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Account with this email already exists")

    # Auto-link quotation info if token provided
    school_name, principal_name = "", ""
    if catalogue_token:
        q = await db.quotations.find_one({"catalogue_token": catalogue_token}, {"_id": 0})
        if q:
            school_name    = q.get("school_name", "")
            principal_name = q.get("principal_name", "")

    acc = {
        "account_id":      f"cust_{uuid.uuid4().hex[:12]}",
        "email":           email,
        "password_hash":   hash_password(password),
        "catalogue_token": catalogue_token,
        "school_name":     body.get("school_name") or school_name,
        "principal_name":  body.get("principal_name") or principal_name,
        "is_active":       True,
        "created_at":      datetime.now(timezone.utc).isoformat(),
    }
    await db.customer_accounts.insert_one(acc)
    acc.pop("password_hash", None)
    acc.pop("_id", None)
    return acc


@router.put("/customer-accounts/{account_id}")
async def update_customer_account(account_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    updates = {}
    if "password" in body and body["password"]:
        updates["password_hash"] = hash_password(body["password"])
    for f in ["email", "catalogue_token", "school_name", "principal_name", "is_active"]:
        if f in body:
            updates[f] = body[f]
    if not updates:
        return {"ok": True}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.customer_accounts.update_one({"account_id": account_id}, {"$set": updates})
    return {"ok": True}


@router.delete("/customer-accounts/{account_id}")
async def delete_customer_account(account_id: str, request: Request):
    await get_current_user(request)
    await db.customer_accounts.delete_one({"account_id": account_id})
    return {"ok": True}


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


# ── Customer Dashboard — aggregated view ──────────────────────────────────────

@router.get("/customer-portal/{token}/dashboard")
async def get_customer_dashboard(token: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")

    quotation_id = quot["quotation_id"]

    # Order status
    order = await db.orders.find_one({"quotation_id": quotation_id}, {"_id": 0})

    # Selection items
    selection = await db.catalogue_selections.find_one({"quotation_id": quotation_id}, {"_id": 0})
    items = []
    if selection:
        items = await db.catalogue_selection_items.find(
            {"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}
        ).to_list(1000)

    # Upcoming sessions (published, status=upcoming, sorted by date)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sessions = await db.training_sessions.find(
        {"is_published": True, "status": "upcoming", "date": {"$gte": today}},
        {"_id": 0}
    ).sort("date", 1).to_list(20)

    # Enrich sessions with registration count + whether this customer is registered
    for sess in sessions:
        reg_count = await db.session_registrations.count_documents({"session_id": sess["session_id"]})
        is_reg = await db.session_registrations.find_one(
            {"session_id": sess["session_id"], "quotation_id": quotation_id}
        )
        sess["registration_count"] = reg_count
        sess["is_registered"] = bool(is_reg)

    # Videos (published, latest first)
    videos = await db.training_videos.find(
        {"is_published": True}, {"_id": 0}
    ).sort("published_at", -1).to_list(50)

    # Active promotions
    promotions = await db.promotions.find(
        {"is_active": True, "$or": [
            {"valid_until": {"$gte": today}},
            {"valid_until": ""},
            {"valid_until": {"$exists": False}},
        ]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)

    # Announcements (published, latest first)
    announcements = await db.announcements.find(
        {"is_published": True}, {"_id": 0}
    ).sort("published_at", -1).to_list(30)

    # Notifications for this customer
    notifications = await db.customer_notifications.find(
        {"quotation_id": quotation_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)

    unread_count = sum(1 for n in notifications if not n.get("is_read"))

    return {
        "quotation": {
            "quote_number":       quot.get("quote_number"),
            "school_name":        quot.get("school_name"),
            "principal_name":     quot.get("principal_name"),
            "package_name":       quot.get("package_name"),
            "grand_total":        quot.get("grand_total"),
            "quotation_status":   quot.get("quotation_status"),
            "catalogue_status":   quot.get("catalogue_status"),
            "sales_person_name":  quot.get("sales_person_name"),
            "sales_person_email": quot.get("sales_person_email"),
        },
        "selection_items": items,
        "order_status": order.get("order_status") if order else None,
        "production_stage": order.get("production_stage") if order else None,
        "sessions": sessions,
        "videos": videos,
        "promotions": promotions,
        "announcements": announcements,
        "notifications": notifications,
        "unread_count": unread_count,
    }


# ── Session registration (public) ─────────────────────────────────────────────

@router.post("/customer-portal/{token}/sessions/{session_id}/register")
async def register_session(token: str, session_id: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")

    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    existing = await db.session_registrations.find_one(
        {"session_id": session_id, "quotation_id": quot["quotation_id"]}
    )
    if existing:
        return {"ok": True, "already_registered": True}

    # Check max_participants
    if session.get("max_participants", 0) > 0:
        count = await db.session_registrations.count_documents({"session_id": session_id})
        if count >= session["max_participants"]:
            raise HTTPException(status_code=400, detail="Session is full")

    await db.session_registrations.insert_one({
        "reg_id": f"reg_{uuid.uuid4().hex[:12]}",
        "session_id": session_id,
        "quotation_id": quot["quotation_id"],
        "school_name": quot.get("school_name", ""),
        "contact_name": quot.get("principal_name", ""),
        "contact_email": quot.get("customer_email", ""),
        "registered_at": datetime.now(timezone.utc).isoformat(),
    })

    # Send confirmation email
    customer_email = quot.get("customer_email", "")
    if customer_email:
        try:
            s = await db.settings.find_one({"type": "email"}, {"_id": 0})
            se = s.get("sender_email") if s else None
            ap = s.get("gmail_app_password") if s else None
            sn = s.get("sender_name", "SmartShape Pro") if s else "SmartShape Pro"
            if se and ap:
                salutation = quot.get("principal_name") or "Sir/Ma'am"
                body = f"""Dear {salutation},

You are registered for:

{session['title']}
Date: {session['date']}  |  Time: {session['time']}
Platform: {session['platform'].upper()}
{f"Link: {session['meeting_link']}" if session.get('meeting_link') else f"Location: {session.get('location','')}"}

We'll send you a reminder before the session.

Best regards,
SmartShape Pro Team"""
                msg = MIMEMultipart()
                msg["From"] = f"{sn} <{se}>"
                msg["To"] = customer_email
                msg["Subject"] = f"Registered: {session['title']}"
                msg.attach(MIMEText(body, "plain", "utf-8"))
                with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
                    smtp.login(se, ap)
                    smtp.sendmail(se, [customer_email], msg.as_string())
        except Exception as e:
            logging.error(f"Registration confirmation email failed: {e}")

    return {"ok": True, "already_registered": False}


@router.delete("/customer-portal/{token}/sessions/{session_id}/register")
async def unregister_session(token: str, session_id: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")
    await db.session_registrations.delete_one(
        {"session_id": session_id, "quotation_id": quot["quotation_id"]}
    )
    return {"ok": True}


# ── Notifications — mark as read ──────────────────────────────────────────────

@router.post("/customer-portal/{token}/notifications/read")
async def mark_notifications_read(token: str):
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")
    await db.customer_notifications.update_many(
        {"quotation_id": quot["quotation_id"], "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"ok": True}
