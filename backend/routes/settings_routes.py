from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
import smtplib
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter()

# Storage helpers
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "smartshape"
storage_key = None


def _init_storage():
    global storage_key
    if storage_key:
        return storage_key
    import requests
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    import requests
    key = _init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()


# ==================== COMPANY SETTINGS ====================

@router.post("/settings/company")
async def save_company_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    await db.settings.update_one(
        {"type": "company"},
        {"$set": {**body, "type": "company", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Company settings saved"}


@router.get("/settings/company")
async def get_company_settings():
    settings = await db.settings.find_one({"type": "company"}, {"_id": 0})
    defaults = {
        "company_name": "SmartShape Pro", "logo_url": "", "address": "", "phone": "", "email": "",
        "gst_number": "", "pan": "", "website": "", "contact_person": "", "city": "", "state": "",
        "pincode": "", "industry": "", "bank_details": "", "terms_conditions": ""
    }
    if not settings:
        return defaults
    for k, v in defaults.items():
        settings.setdefault(k, v)
    return settings


@router.post("/settings/company/upload-logo")
async def upload_company_logo(file: UploadFile = File(...), request: Request = None):
    if request:
        user = await get_current_user(request)
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    ext = file.filename.split(".")[-1] if "." in file.filename else "png"
    path = f"{APP_NAME}/company/logo_{uuid.uuid4().hex[:8]}.{ext}"
    data = await file.read()
    result = _put_object(path, data, file.content_type or "image/png")
    logo_url = f"/api/files/{result['path']}"
    await db.settings.update_one({"type": "company"}, {"$set": {"logo_url": logo_url}}, upsert=True)
    return {"logo_url": logo_url}


# ==================== EMAIL SETTINGS ====================

@router.post("/settings/email")
async def save_email_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    settings = await request.json()
    # Auto-enable if credentials are present so admins don't need a separate toggle
    if settings.get("sender_email") and settings.get("gmail_app_password"):
        settings["enabled"] = True
    await db.settings.update_one(
        {"type": "email"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Email settings saved"}


@router.get("/settings/email")
async def get_email_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not settings:
        return {"sender_name": "SmartShape Pro", "sender_email": "", "gmail_app_password": "", "enabled": False}
    return settings


# ==================== WHATSAPP SETTINGS ====================

@router.post("/settings/whatsapp")
async def save_whatsapp_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    body = await request.json()
    await db.settings.update_one(
        {"type": "whatsapp"},
        {"$set": {**body, "type": "whatsapp", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "WhatsApp settings saved"}


@router.get("/settings/whatsapp")
async def get_whatsapp_settings(request: Request):
    await get_current_user(request)
    settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not settings:
        return {"username": "", "password": "", "enabled": False}
    return settings


# ==================== SHEETS & NOTIFICATION SETTINGS ====================

@router.post("/settings/sheets")
async def save_sheets_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    settings = await request.json()
    await db.settings.update_one(
        {"type": "sheets"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Sheets settings saved"}


@router.post("/settings/notifications")
async def save_notification_settings(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    settings = await request.json()
    await db.settings.update_one(
        {"type": "notifications"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Notification settings saved"}


# ==================== WHATSAPP SEND ====================

@router.post("/whatsapp/send")
async def send_whatsapp_message(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa_settings or not wa_settings.get("username"):
        raise HTTPException(status_code=400, detail="WhatsApp not configured. Go to Settings.")
    phone = body.get("phone", "")
    message = body.get("message", "")
    if not phone or not message:
        raise HTTPException(status_code=400, detail="phone and message required")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://app.messageautosender.com/message/new",
                data={
                    "username": wa_settings["username"],
                    "password": wa_settings["password"],
                    "receiverMobileNo": phone,
                    "message": message,
                },
            )
            return {"success": True, "status_code": resp.status_code, "response": resp.text[:500]}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/whatsapp/send-file")
async def send_whatsapp_file(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa_settings or not wa_settings.get("username"):
        raise HTTPException(status_code=400, detail="WhatsApp not configured")
    phone = body.get("phone", "")
    message = body.get("message", "")
    file_url = body.get("file_url", "")
    if not phone:
        raise HTTPException(status_code=400, detail="phone required")
    import httpx
    try:
        data = {"username": wa_settings["username"], "password": wa_settings["password"], "receiverMobileNo": phone}
        if message:
            data["message"] = message
        if file_url:
            data["filePathUrl"] = file_url
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://app.messageautosender.com/message/new", data=data)
            return {"success": True, "status_code": resp.status_code, "response": resp.text[:500]}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ==================== WHATSAPP TEMPLATE MASTER (FMS Phase 4) ====================

WA_TEMPLATE_MODULES = ["lead", "contact", "school", "visit", "order", "dispatch", "quotation", "general"]
WA_TEMPLATE_CATEGORIES = ["thankyou", "reminder", "followup", "marketing", "intro", "custom"]

DEFAULT_WA_TEMPLATES = [
    {"name": "Thank You - Call", "module": "lead", "category": "thankyou",
     "body": "Hi {contact_name}, thank you for your time on the call today. As discussed, we offer SmartShape solutions for {school_name}. I'll share the catalogue shortly.\n\nRegards,\n{my_name}"},
    {"name": "Visit Follow-up", "module": "visit", "category": "followup",
     "body": "Hi {contact_name}, it was great meeting you at {school_name} today. Sharing our catalogue & quotation as discussed. Please reach me on {my_phone} for any clarification.\n\nRegards,\n{my_name}"},
    {"name": "Quotation Sent", "module": "quotation", "category": "followup",
     "body": "Dear {contact_name}, please find attached our quotation for {school_name}. Looking forward to your review.\n\nRegards,\n{my_name}"},
    {"name": "Demo Reminder", "module": "lead", "category": "reminder",
     "body": "Hi {contact_name}, just a quick reminder of our scheduled demo. Looking forward to showing you the SmartShape advantage.\n\nRegards,\n{my_name}"},
    {"name": "Order Confirmed", "module": "order", "category": "thankyou",
     "body": "Dear {contact_name}, your order has been confirmed. We'll keep you updated on dispatch.\n\nRegards,\n{my_name}"},
    {"name": "Dispatch Update", "module": "dispatch", "category": "reminder",
     "body": "Hi {contact_name}, your shipment for {school_name} is on its way. Tracking details will be shared shortly.\n\nRegards,\n{my_name}"},
]


async def _ensure_default_wa_templates():
    count = await db.whatsapp_templates.count_documents({})
    if count > 0:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    docs = []
    for t in DEFAULT_WA_TEMPLATES:
        docs.append({
            "template_id": f"wat_{uuid.uuid4().hex[:10]}",
            "name": t["name"],
            "module": t["module"],
            "category": t["category"],
            "body": t["body"],
            "is_active": True,
            "is_default": True,
            "created_by": "system",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    await db.whatsapp_templates.insert_many(docs)


@router.get("/whatsapp-templates")
async def list_wa_templates(request: Request, module: Optional[str] = None, category: Optional[str] = None):
    await get_current_user(request)
    await _ensure_default_wa_templates()
    query = {"is_active": True}
    if module:
        query["module"] = module
    if category:
        query["category"] = category
    templates = await db.whatsapp_templates.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return templates


@router.post("/whatsapp-templates")
async def create_wa_template(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name or not body.get("body"):
        raise HTTPException(status_code=400, detail="Name and body are required")
    module = body.get("module", "general")
    if module not in WA_TEMPLATE_MODULES:
        module = "general"
    category = body.get("category", "custom")
    if category not in WA_TEMPLATE_CATEGORIES:
        category = "custom"
    tpl_id = f"wat_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": tpl_id,
        "name": name,
        "module": module,
        "category": category,
        "body": body["body"],
        "is_active": True,
        "is_default": False,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.whatsapp_templates.insert_one(doc)
    return await db.whatsapp_templates.find_one({"template_id": tpl_id}, {"_id": 0})


@router.put("/whatsapp-templates/{template_id}")
async def update_wa_template(template_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {}
    for k in ("name", "module", "category", "body", "is_active"):
        if k in body:
            allowed[k] = body[k]
    if "module" in allowed and allowed["module"] not in WA_TEMPLATE_MODULES:
        allowed["module"] = "general"
    if "category" in allowed and allowed["category"] not in WA_TEMPLATE_CATEGORIES:
        allowed["category"] = "custom"
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.whatsapp_templates.update_one({"template_id": template_id}, {"$set": allowed})
    return await db.whatsapp_templates.find_one({"template_id": template_id}, {"_id": 0})


@router.delete("/whatsapp-templates/{template_id}")
async def delete_wa_template(template_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.whatsapp_templates.delete_one({"template_id": template_id})
    return {"message": "Template deleted"}


def _interpolate_template(body_text: str, ctx: dict) -> str:
    """Replace {var} placeholders in template body with values from ctx (missing vars become blank)."""
    def _sub(m):
        key = m.group(1).strip()
        return str(ctx.get(key, ""))
    return re.sub(r"\{(\w+)\}", _sub, body_text or "")


@router.post("/whatsapp/render-template")
async def render_template(request: Request):
    """Resolve a template with context (lead/contact/school/order ids) and return preview body + phone."""
    user = await get_current_user(request)
    body = await request.json()
    tpl_id = body.get("template_id")
    custom_body = body.get("body", "")
    if tpl_id:
        tpl = await db.whatsapp_templates.find_one({"template_id": tpl_id}, {"_id": 0})
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")
        text = tpl["body"]
    else:
        text = custom_body

    ctx = {"my_name": user.get("name", ""), "my_phone": ""}
    sp = await db.salespersons.find_one({"email": user["email"]}, {"_id": 0})
    if sp:
        ctx["my_phone"] = sp.get("phone", "")

    phone = body.get("phone") or ""
    contact_id = body.get("contact_id")
    lead_id = body.get("lead_id")
    school_id = body.get("school_id")
    order_id = body.get("order_id")

    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
        if c:
            ctx.update({"contact_name": c.get("name", ""), "school_name": c.get("company", "")})
            phone = phone or c.get("phone", "")
    if lead_id:
        ld = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if ld:
            ctx.update({"contact_name": ld.get("contact_name", "")})
            phone = phone or ld.get("contact_phone", "")
            sid = ld.get("school_id") or school_id
            if sid:
                school_id = sid
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
        if s:
            ctx.setdefault("school_name", s.get("school_name", ""))
            ctx.update({"school_city": s.get("city", "")})
            phone = phone or s.get("phone", "")
    if order_id:
        o = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
        if o:
            ctx.setdefault("school_name", o.get("school_name", ""))
            ctx["order_id"] = o.get("order_id", "")

    rendered = _interpolate_template(text, ctx)
    return {"body": rendered, "phone": phone, "context": ctx}


@router.post("/whatsapp/send-via-template")
async def send_via_template(request: Request):
    """Send a WhatsApp message via API (if configured) and log it.
    Body: {template_id?, body, phone, lead_id?, contact_id?, school_id?, order_id?, send_mode='api'|'manual'}
    send_mode='manual' just logs (used after user shares via wa.me link)."""
    user = await get_current_user(request)
    body = await request.json()
    phone = (body.get("phone") or "").strip()
    msg = (body.get("body") or "").strip()
    if not phone or not msg:
        raise HTTPException(status_code=400, detail="phone and body required")
    send_mode = body.get("send_mode", "api")
    log_id = f"wal_{uuid.uuid4().hex[:10]}"
    log_doc = {
        "log_id": log_id,
        "template_id": body.get("template_id"),
        "phone": phone,
        "body": msg,
        "lead_id": body.get("lead_id"),
        "contact_id": body.get("contact_id"),
        "school_id": body.get("school_id"),
        "order_id": body.get("order_id"),
        "send_mode": send_mode,
        "status": "pending",
        "response": None,
        "sent_by": user["email"],
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }

    if send_mode == "manual":
        log_doc["status"] = "manual_sent"
    else:
        wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
        if not wa_settings or not wa_settings.get("username"):
            log_doc["status"] = "wa_not_configured"
        else:
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        "https://app.messageautosender.com/message/new",
                        data={
                            "username": wa_settings["username"],
                            "password": wa_settings["password"],
                            "receiverMobileNo": phone,
                            "message": msg,
                        },
                    )
                    log_doc["status"] = "sent" if 200 <= resp.status_code < 300 else "failed"
                    log_doc["response"] = resp.text[:500]
            except Exception as e:
                log_doc["status"] = "error"
                log_doc["response"] = str(e)[:500]

    await db.whatsapp_logs.insert_one(log_doc)

    # Cascade last_activity to related entity
    now_iso = datetime.now(timezone.utc).isoformat()
    if body.get("lead_id"):
        await db.leads.update_one({"lead_id": body["lead_id"]}, {"$set": {"last_activity_date": now_iso}})
    if body.get("contact_id"):
        await db.contacts.update_one({"contact_id": body["contact_id"]}, {"$set": {"last_activity_date": now_iso}})
    if body.get("school_id"):
        await db.schools.update_one({"school_id": body["school_id"]}, {"$set": {"last_activity_date": now_iso}})

    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:10]}",
        "user_email": user["email"],
        "action": "whatsapp_sent",
        "entity_type": "whatsapp_log",
        "entity_id": log_id,
        "details": f"{send_mode} -> {phone} | {msg[:60]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.whatsapp_logs.find_one({"log_id": log_id}, {"_id": 0})


@router.get("/whatsapp/logs")
async def list_wa_logs(request: Request, lead_id: Optional[str] = None, contact_id: Optional[str] = None,
                      school_id: Optional[str] = None, limit: int = 100):
    await get_current_user(request)
    q = {}
    if lead_id: q["lead_id"] = lead_id
    if contact_id: q["contact_id"] = contact_id
    if school_id: q["school_id"] = school_id
    logs = await db.whatsapp_logs.find(q, {"_id": 0}).sort("sent_at", -1).to_list(limit)
    return logs


# ==================== WHATSAPP SCHEDULER ====================

@router.post("/whatsapp/schedule")
async def create_scheduled_wa(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    phone = body.get("phone", "").strip()
    message = body.get("message", "").strip()
    scheduled_at = body.get("scheduled_at", "")
    if not phone or not message or not scheduled_at:
        raise HTTPException(status_code=400, detail="phone, message, and scheduled_at are required")
    schedule_id = f"wsch_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "schedule_id": schedule_id,
        "phone": phone,
        "lead_id": body.get("lead_id"),
        "contact_name": body.get("contact_name", ""),
        "message": message,
        "template_id": body.get("template_id"),
        "scheduled_at": scheduled_at,
        "status": "pending",
        "sent_at": None,
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.whatsapp_scheduled.insert_one(doc)
    return await db.whatsapp_scheduled.find_one({"schedule_id": schedule_id}, {"_id": 0})


@router.get("/whatsapp/schedule")
async def list_scheduled_wa(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    q = {}
    if status:
        q["status"] = status
    if get_team(user) != "admin":
        q["created_by"] = user["email"]
    items = await db.whatsapp_scheduled.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(500)
    return items


@router.delete("/whatsapp/schedule/{schedule_id}")
async def cancel_scheduled_wa(schedule_id: str, request: Request):
    await get_current_user(request)
    item = await db.whatsapp_scheduled.find_one({"schedule_id": schedule_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Scheduled message not found")
    if item.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending messages")
    await db.whatsapp_scheduled.update_one(
        {"schedule_id": schedule_id},
        {"$set": {"status": "cancelled"}}
    )
    return {"message": "Cancelled"}


# ==================== WHATSAPP BROADCAST BY TAG ====================

@router.post("/whatsapp/broadcast-by-tag")
async def whatsapp_broadcast_by_tag(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    tag_id = body.get("tag_id", "")
    template_id = body.get("template_id")
    if not tag_id:
        raise HTTPException(status_code=400, detail="tag_id is required")

    wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa_settings or not wa_settings.get("username"):
        raise HTTPException(status_code=400, detail="WhatsApp not configured")

    # Get template body if provided
    template_body = body.get("message", "")
    if template_id and not template_body:
        tmpl = await db.whatsapp_templates.find_one({"template_id": template_id}, {"_id": 0})
        if tmpl:
            template_body = tmpl.get("body", "")

    if not template_body:
        raise HTTPException(status_code=400, detail="message or template_id with body is required")

    leads = await db.leads.find({"tags": tag_id}, {"_id": 0}).to_list(5000)
    sent, failed, skipped = 0, 0, 0
    import httpx
    now_iso = datetime.now(timezone.utc).isoformat()

    for lead in leads:
        phone = lead.get("contact_phone", "").strip()
        if not phone:
            skipped += 1
            continue
        msg = template_body.replace("{contact_name}", lead.get("contact_name", "")).replace("{school_name}", lead.get("company_name", ""))
        status = "failed"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://app.messageautosender.com/message/new",
                    data={"username": wa_settings["username"], "password": wa_settings["password"],
                          "receiverMobileNo": phone, "message": msg},
                )
            status = "sent" if 200 <= resp.status_code < 300 else "failed"
            if status == "sent":
                sent += 1
            else:
                failed += 1
        except Exception:
            failed += 1
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}",
            "template_id": template_id,
            "phone": phone,
            "body": msg,
            "lead_id": lead.get("lead_id"),
            "send_mode": "broadcast_tag",
            "status": status,
            "sent_by": user["email"],
            "sent_at": now_iso,
        })
    return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(leads)}


# ==================== EMAIL BROADCAST BY TAG ====================

@router.post("/email/broadcast-by-tag")
async def email_broadcast_by_tag(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    tag_id = body.get("tag_id", "")
    subject = body.get("subject", "")
    html_body = body.get("body", "")
    if not tag_id or not subject or not html_body:
        raise HTTPException(status_code=400, detail="tag_id, subject, and body are required")

    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not email_settings or not email_settings.get("sender_email"):
        raise HTTPException(status_code=400, detail="Email not configured")

    leads = await db.leads.find({"tags": tag_id}, {"_id": 0}).to_list(5000)
    sent, failed, skipped = 0, 0, 0
    sender_email = email_settings["sender_email"]

    for lead in leads:
        to_email = lead.get("contact_email", "").strip()
        if not to_email:
            skipped += 1
            continue
        personalized_body = html_body.replace("{contact_name}", lead.get("contact_name", "")).replace("{school_name}", lead.get("company_name", ""))
        try:
            msg = MIMEMultipart()
            msg["From"] = f"{email_settings.get('sender_name', 'SmartShape Pro')} <{sender_email}>"
            msg["To"] = to_email
            msg["Subject"] = subject
            msg.attach(MIMEText(personalized_body, "html"))
            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
                server.login(sender_email, email_settings["gmail_app_password"])
                server.sendmail(sender_email, [to_email], msg.as_string())
            sent += 1
        except Exception:
            failed += 1
    return {"sent": sent, "failed": failed, "skipped": skipped, "total": len(leads)}


# ==================== EMAIL SEND ====================

@router.post("/email/send")
async def send_email_via_gmail(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not email_settings or not email_settings.get("sender_email") or not email_settings.get("gmail_app_password"):
        raise HTTPException(status_code=400, detail="Gmail not configured. Ask admin to set SMTP in App Settings.")
    to_email = body.get("to", "")
    subject = body.get("subject", "")
    html_body = body.get("body", "")
    if not to_email or not subject:
        raise HTTPException(status_code=400, detail="to and subject required")
    sender_email = email_settings["sender_email"]
    # Auto-CC the logged-in user (so their Sent folder effectively reflects what was sent on their behalf)
    cc_list = []
    if user.get("email") and user["email"].lower() not in (sender_email.lower(), to_email.lower()):
        cc_list.append(user["email"])
    # Caller-provided additional CCs
    for e in (body.get("cc") or []):
        if e and e.lower() not in (sender_email.lower(), to_email.lower()) and e not in cc_list:
            cc_list.append(e)
    try:
        msg = MIMEMultipart()
        msg["From"] = f"{email_settings.get('sender_name', 'SmartShape Pro')} <{sender_email}>"
        msg["To"] = to_email
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))
        recipients = [to_email] + cc_list
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender_email, email_settings["gmail_app_password"])
            server.sendmail(sender_email, recipients, msg.as_string())
        return {"success": True, "message": f"Email sent to {to_email}", "cc": cc_list}
    except Exception as e:
        return {"success": False, "error": str(e)}
