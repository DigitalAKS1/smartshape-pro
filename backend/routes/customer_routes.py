from fastapi import APIRouter, HTTPException, Request, Response
from datetime import datetime, timezone, timedelta
import uuid, os, logging, smtplib, jwt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db
from auth_utils import get_current_user, hash_password, verify_password
from rbac import get_team, require_module

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
            "selection_change_status": quot.get("selection_change_status"),
            "selection_change_reason": quot.get("selection_change_reason"),
            "selection_changed_at":    quot.get("selection_changed_at"),
            "selection_approved_at":   quot.get("selection_approved_at"),
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

    # The owning sales person may always edit; everyone else needs module access.
    team = get_team(user)
    owns = (quot.get("sales_person_email", "").lower() == user.get("email", "").lower())
    if not (team == "sales" and owns):
        require_module(user, "quotations", "read_write")

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
                # NOTE: reservation is NOT touched here. The change is only a proposal
                # until the customer approves; approve-changes reconciles the order
                # (the single owner of reservation). See reconcile_order_to_selection.
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
                        "quantity": 1,
                        "status": "added_by_admin",
                        "admin_note": note,
                        "updated_at": now,
                        "updated_by": user["email"],
                    })
                    # Reservation handled at approval (reconcile_order_to_selection), not here.
                    added_dies.append(new_die)

    # Flag the selection as awaiting customer approval (the removed_by_admin /
    # added_by_admin item statuses double as the highlight markers on the portal).
    if removed_dies or added_dies:
        await db.quotations.update_one(
            {"quotation_id": quot["quotation_id"]},
            {"$set": {
                "selection_change_status": "pending_customer_approval",
                "selection_change_reason": reason,
                "selection_changed_at": now,
                "selection_changed_by": user["email"],
                "selection_approved_at": None,
            }})

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
👉 Please REVIEW & APPROVE these changes here:
{portal_url}

The changes are highlighted (added in green, removed in red). They are not
final until you tap "Confirm These Changes" on that page.

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


@router.post("/customer-portal/{token}/approve-changes")
async def approve_selection_changes(token: str):
    """PUBLIC (token-based): the customer confirms the admin's proposed changes.

    Clears the pending flag, settles the highlighted items, and notifies the
    owning sales person + whoever made the change.
    """
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")
    if quot.get("selection_change_status") != "pending_customer_approval":
        # Idempotent — nothing to approve (already approved or no changes).
        return {"message": "No pending changes to approve",
                "selection_change_status": quot.get("selection_change_status")}

    now = datetime.now(timezone.utc).isoformat()
    selection = await db.catalogue_selections.find_one(
        {"quotation_id": quot["quotation_id"]}, {"_id": 0})
    reconcile_summary = None
    if selection:
        # Added items become normal selected items (highlight clears); removed items
        # stay removed (already excluded from the active selection everywhere).
        await db.catalogue_selection_items.update_many(
            {"catalogue_selection_id": selection["selection_id"], "status": "added_by_admin"},
            {"$set": {"status": "selected", "approved_at": now}})

        # Commit point: make the approved selection real on the order. The order is
        # the single owner of reservation, so this is the ONLY place stock moves for
        # these changes (the edit path deliberately leaves reservation untouched).
        active = await db.catalogue_selection_items.find(
            {"catalogue_selection_id": selection["selection_id"], "status": {"$ne": "removed_by_admin"}},
            {"_id": 0, "die_id": 1, "quantity": 1}).to_list(1000)
        desired = {it["die_id"]: int(it.get("quantity", 1) or 1) for it in active if it.get("die_id")}
        order = await db.orders.find_one({"quotation_id": quot["quotation_id"]}, {"_id": 0})
        if order and desired:
            try:
                from routes.order_routes import reconcile_order_to_selection
                reconcile_summary = await reconcile_order_to_selection(
                    order["order_id"], desired, actor="customer")
            except Exception as e:
                logging.error(f"Order reconcile after approval failed for {quot['quotation_id']}: {e}")

    await db.quotations.update_one(
        {"quotation_id": quot["quotation_id"]},
        {"$set": {"selection_change_status": "approved", "selection_approved_at": now}})

    # Notify staff: owning sales + whoever proposed the change.
    try:
        se, ap, sn = await _email_cfg()
        staff = [quot.get("sales_person_email", ""), quot.get("selection_changed_by", "")]
        staff = [e for e in dict.fromkeys(staff) if e and e.lower() != se.lower()]
        if staff:
            body = (f"Good news — {quot.get('school_name', 'the customer')} has APPROVED the "
                    f"changes you made to their shape selection.\n\n"
                    f"Quote: {quot.get('quote_number')}\n"
                    f"School: {quot.get('school_name')}\n"
                    f"Approved at: {now}\n\nYou can proceed with the order.")
            await _send_email(se, ap, sn, staff, [],
                f"Selection changes APPROVED – {quot.get('school_name')}", body)
    except Exception as e:
        logging.error(f"Approval notification email failed: {e}")

    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": "customer", "action": "approve_selection_changes",
        "entity_type": "quotation", "entity_id": quot["quotation_id"],
        "details": f"Customer approved selection changes for {quot.get('quote_number','')}",
        "timestamp": now,
    })
    return {"message": "Changes approved", "selection_change_status": "approved",
            "selection_approved_at": now, "order_sync": reconcile_summary}


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
            "selection_change_status": quot.get("selection_change_status"),
            "selection_change_reason": quot.get("selection_change_reason"),
            "selection_changed_at":    quot.get("selection_changed_at"),
            "selection_approved_at":   quot.get("selection_approved_at"),
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


# ── School support tickets (public, by catalogue token) ───────────────────────

@router.post("/customer-portal/{token}/support-ticket")
async def submit_school_support_ticket(token: str, request: Request):
    """School submits a support ticket from their customer portal."""
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")

    body = await request.json()
    title       = body.get("title", "").strip()
    description = body.get("description", "").strip()
    priority    = body.get("priority", "medium")
    if not title or not description:
        raise HTTPException(status_code=400, detail="Title and description are required")

    ticket_count = await db.support_tickets.count_documents({})
    ticket_number = f"TKT-{ticket_count + 1001:04d}"

    ticket_doc = {
        "ticket_id":           f"tk_{uuid.uuid4().hex[:12]}",
        "ticket_number":       ticket_number,
        "title":               title,
        "description":         description,
        "priority":            priority,
        "status":              "open",
        "source":              "school_portal",
        "submitted_by_name":   quot.get("principal_name", quot.get("school_name", "")),
        "submitted_by_email":  quot.get("customer_email", ""),
        "school_name":         quot.get("school_name", ""),
        "quotation_id":        quot.get("quotation_id", ""),
        "catalogue_token":     token,
        "created_at":          datetime.now(timezone.utc).isoformat(),
        "has_screenshot":      False,
    }
    await db.support_tickets.insert_one(ticket_doc)

    # Try to notify admin by email
    try:
        email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
        if email_settings and email_settings.get("enabled") and email_settings.get("sender_email"):
            admin_email = email_settings.get("sender_email")
            msg = MIMEMultipart()
            msg["From"]    = f"SmartShape Pro <{admin_email}>"
            msg["To"]      = admin_email
            msg["Subject"] = f"[{priority.upper()}] New Support Ticket {ticket_number} from {quot.get('school_name','')}"
            body_text = f"""
New support ticket from school portal:

Ticket: {ticket_number}
School: {quot.get('school_name','')}
Contact: {quot.get('principal_name','')} <{quot.get('customer_email','')}>
Priority: {priority.upper()}
Title: {title}

{description}
"""
            msg.attach(MIMEText(body_text, "plain", "utf-8"))
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
                smtp.login(admin_email, email_settings["gmail_app_password"])
                smtp.send_message(msg)
    except Exception:
        pass  # email notification is best-effort

    result = dict(ticket_doc)
    result.pop("_id", None)
    return result


@router.get("/customer-portal/{token}/support-tickets")
async def get_school_support_tickets(token: str):
    """Fetch tickets submitted by this school."""
    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Portal not found")
    tickets = await db.support_tickets.find(
        {"catalogue_token": token},
        {"_id": 0, "screenshot_data": 0}
    ).sort("created_at", -1).to_list(50)
    return tickets
