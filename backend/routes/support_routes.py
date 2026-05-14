from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid
import logging

from database import db
from auth_utils import get_current_user
from rbac import require_teams

router = APIRouter()


async def _get_email_settings():
    es = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not es:
        raise ValueError("Email settings not configured")
    se = es.get("sender_email")
    pw = es.get("gmail_app_password")
    sn = es.get("sender_name", "SmartShape Pro")
    if not se or not pw:
        raise ValueError("Incomplete email configuration")
    return se, pw, sn


async def _notify_admin(ticket: dict):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    try:
        sender_email, app_password, sender_name = await _get_email_settings()
        admin = await db.users.find_one({"role": "admin"}, {"email": 1})
        admin_email = admin.get("email") if admin else sender_email

        emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(ticket.get("priority", "medium"), "⚪")
        subject = f"{emoji} Support Ticket {ticket['ticket_number']}: {ticket['title']}"
        body = f"""New support ticket submitted via SmartShape Pro.

Ticket #:   {ticket['ticket_number']}
Title:      {ticket['title']}
Priority:   {ticket.get('priority', 'medium').upper()}
Submitted:  {ticket.get('submitted_by_name', '')} ({ticket.get('submitted_by_email', '')})
Date:       {ticket.get('created_at', '')[:10]}

Description:
{ticket.get('description', '')}

Screenshot: {'Uploaded — view in admin panel' if ticket.get('has_screenshot') else 'Not provided'}

---
SmartShape Pro Support System"""

        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = admin_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.sendmail(sender_email, [admin_email], msg.as_string())
    except Exception as e:
        logging.warning(f"Support ticket email failed: {e}")


@router.post("/support-tickets")
async def create_support_ticket(request: Request):
    user = await get_current_user(request)
    body = await request.json()

    title = (body.get("title") or "").strip()
    description = (body.get("description") or "").strip()
    if not title:
        raise HTTPException(400, "Title is required")
    if not description:
        raise HTTPException(400, "Description is required")

    count = await db.support_tickets.count_documents({})
    ticket_number = f"TKT-{(count + 1):04d}"
    screenshot_data = body.get("screenshot_data")

    ticket = {
        "ticket_id": str(uuid.uuid4()),
        "ticket_number": ticket_number,
        "title": title,
        "description": description,
        "priority": body.get("priority", "medium"),
        "screenshot_data": screenshot_data,
        "has_screenshot": bool(screenshot_data),
        "status": "open",
        "submitted_by": user.get("email"),
        "submitted_by_name": user.get("name", ""),
        "submitted_by_email": user.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.support_tickets.insert_one({**ticket})
    await _notify_admin(ticket)

    return {"success": True, "ticket_id": ticket["ticket_id"], "ticket_number": ticket_number}


@router.get("/support-tickets")
async def list_support_tickets(request: Request):
    require_teams(request, ["admin"])
    cursor = db.support_tickets.find({}, {"_id": 0, "screenshot_data": 0}).sort("created_at", -1)
    tickets = await cursor.to_list(500)
    return tickets


@router.get("/support-tickets/{ticket_id}/screenshot")
async def get_ticket_screenshot(ticket_id: str, request: Request):
    require_teams(request, ["admin"])
    t = await db.support_tickets.find_one({"ticket_id": ticket_id}, {"screenshot_data": 1})
    if not t or not t.get("screenshot_data"):
        raise HTTPException(404, "No screenshot")
    return {"screenshot_data": t["screenshot_data"]}


@router.patch("/support-tickets/{ticket_id}")
async def update_ticket_status(ticket_id: str, request: Request):
    require_teams(request, ["admin"])
    body = await request.json()
    await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$set": {"status": body.get("status", "open"), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"success": True}
