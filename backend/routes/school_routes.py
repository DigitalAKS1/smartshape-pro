from fastapi import APIRouter, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import Response as FResponse
from datetime import datetime, timezone, timedelta
import uuid
import os
import jwt
import time
import hashlib

from database import db
from auth_utils import get_current_school, get_current_user, hash_password, verify_password, JWT_SECRET, JWT_ALGORITHM
from services import teacher_auth

router = APIRouter()

# Cross-domain cookie flags (mirror auth_routes)
_PROD = os.environ.get("FRONTEND_URL", "").startswith("https")
_COOKIE_KWARGS = dict(httponly=True, secure=_PROD, samesite="none" if _PROD else "lax", path="/")


async def get_current_teacher(request: Request) -> dict:
    """Auth guard for teacher (school sub-account) sessions."""
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("role") != "teacher":
            raise HTTPException(status_code=403, detail="Teacher access required")
        teacher = await db.teachers.find_one({"teacher_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not teacher or teacher.get("status") == "inactive":
            raise HTTPException(status_code=401, detail="Teacher not found or inactive")
        return teacher
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def _notify_admin_school_action(school: dict, action: str):
    """Record an admin-facing notification for a school-portal write action."""
    await db.admin_notifications.insert_one({
        "notification_id": f"an_{uuid.uuid4().hex[:12]}",
        "type": "school_portal",
        "school_id": school.get("school_id"),
        "title": f"{school.get('school_name', 'School')} {action}",
        "message": action,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/school/me")
async def school_me(request: Request):
    school = await get_current_school(request)
    school["role"] = "school"
    return school


@router.get("/school/orders")
async def school_orders(request: Request):
    school = await get_current_school(request)
    orders = await db.orders.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders


@router.get("/school/orders/{order_id}")
async def school_order_detail(order_id: str, request: Request):
    school = await get_current_school(request)
    order = await db.orders.find_one({"order_id": order_id, "school_id": school["school_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    order["items"] = items
    timeline = await db.order_timeline.find({"order_id": order_id}, {"_id": 0}).sort("timestamp", 1).to_list(100)
    order["timeline"] = timeline
    return order


@router.get("/school/quotations")
async def school_quotations(request: Request):
    school = await get_current_school(request)
    quots = await db.quotations.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quots


@router.get("/school/notifications")
async def school_notifications(request: Request):
    school = await get_current_school(request)
    notifs = await db.school_notifications.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notifs


@router.put("/school/notifications/read")
async def school_mark_notifications_read(request: Request):
    school = await get_current_school(request)
    await db.school_notifications.update_many({"school_id": school["school_id"], "read": False}, {"$set": {"read": True}})
    return {"message": "All notifications marked as read"}


# ==================== PHASE 2 — CUSTOMER PORTAL ====================

@router.get("/school/payments")
async def school_payments(request: Request):
    school = await get_current_school(request)
    orders = await db.orders.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    rows, total_ordered, total_paid = [], 0.0, 0.0
    for o in orders:
        gt = float(o.get("grand_total", 0) or 0)
        paid = float(o.get("payment_received", 0) or 0)
        bal = max(0.0, gt - paid)
        status = "paid" if bal <= 0 and gt > 0 else ("partial" if paid > 0 else "unpaid")
        total_ordered += gt
        total_paid += paid
        rows.append({"order_id": o.get("order_id"), "order_number": o.get("order_number"),
                     "grand_total": gt, "payment_received": paid, "balance_due": bal,
                     "payment_status": status, "created_at": o.get("created_at")})
    return {"orders": rows, "totals": {"total_ordered": total_ordered, "total_paid": total_paid,
            "total_outstanding": max(0.0, total_ordered - total_paid)}}


_SCHOOL_EDITABLE = {"phone", "address", "city", "state", "pincode",
                    "primary_contact_name", "designation", "alternate_contact", "website"}


@router.get("/school/profile")
async def school_profile_get(request: Request):
    return await get_current_school(request)


@router.put("/school/profile")
async def school_profile_update(request: Request):
    school = await get_current_school(request)
    body = await request.json()
    update = {k: body[k] for k in _SCHOOL_EDITABLE if k in body}
    if update:
        update["last_activity_date"] = datetime.now(timezone.utc).isoformat()
        await db.schools.update_one({"school_id": school["school_id"]}, {"$set": update})
        await _notify_admin_school_action(school, "updated their portal profile")
    return await db.schools.find_one({"school_id": school["school_id"]}, {"_id": 0, "password_hash": 0})


@router.post("/school/contacts")
async def school_add_contact(request: Request):
    school = await get_current_school(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Contact name is required")
    contact_id = f"con_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "contact_id": contact_id, "name": name,
        "phone": (body.get("phone") or "").strip(), "email": (body.get("email") or "").strip(),
        "company": school.get("school_name", ""), "school_id": school["school_id"],
        "designation": (body.get("designation") or "").strip(), "contact_role_id": "",
        "source": "school_portal", "source_id": school["school_id"],
        "notes": "Added by school via portal", "status": "unverified",
        "converted_to_lead": False, "lead_id": None, "previous_schools": [],
        "last_activity_date": now_iso, "created_by": school["school_id"], "created_at": now_iso,
    }
    await db.contacts.insert_one(doc)
    await _notify_admin_school_action(school, f"added a contact: {name} (unverified)")
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.post("/school/reorder")
async def school_reorder(request: Request):
    school = await get_current_school(request)
    body = await request.json()
    req_id = f"sreq_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "request_id": req_id, "type": "reorder", "school_id": school["school_id"],
        "school_name": school.get("school_name", ""), "message": (body.get("message") or "").strip(),
        "items": body.get("items") or [], "status": "open", "created_at": now_iso,
    }
    await db.school_requests.insert_one(doc)
    await _notify_admin_school_action(school, "requested a reorder / new quote")
    return await db.school_requests.find_one({"request_id": req_id}, {"_id": 0})


@router.post("/school/quotations/{quotation_id}/po")
async def school_upload_po(quotation_id: str, request: Request, file: UploadFile = File(...)):
    school = await get_current_school(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id, "school_id": school["school_id"]})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    from services.storage import save_upload
    ext = file.filename.split(".")[-1] if "." in (file.filename or "") else "pdf"
    path = f"school_po/{quotation_id}_{uuid.uuid4().hex[:8]}.{ext}"
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 15MB)")
    url = await save_upload(path, data, file.content_type or "application/pdf", legacy="local")
    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": {
        "po_file_url": url, "po_status": "pending_review",
        "po_uploaded_by": "school_portal", "po_uploaded_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _notify_admin_school_action(school, f"uploaded a PO for quotation {quot.get('quote_number', quotation_id)}")
    return {"po_file_url": url, "po_status": "pending_review"}


@router.get("/school/documents")
async def school_documents(request: Request):
    school = await get_current_school(request)
    sid = school["school_id"]
    docs = []
    async for q in db.quotations.find({"school_id": sid}, {"_id": 0, "quotation_id": 1, "quote_number": 1, "created_at": 1}):
        docs.append({"doc_type": "quotation", "ref_id": q["quotation_id"],
                     "label": f"Quotation {q.get('quote_number', q['quotation_id'])}",
                     "date": q.get("created_at"),
                     "download_url": f"/api/school/documents/quotation/{q['quotation_id']}/download"})
    async for o in db.orders.find({"school_id": sid}, {"_id": 0, "order_id": 1, "order_number": 1, "created_at": 1}):
        docs.append({"doc_type": "order", "ref_id": o["order_id"],
                     "label": f"Order {o.get('order_number', o['order_id'])}",
                     "date": o.get("created_at"),
                     "download_url": f"/api/school/documents/order/{o['order_id']}/download"})
    async for inv in db.invoices.find({"school_id": sid}, {"_id": 0, "invoice_id": 1, "invoice_number": 1, "invoice_date": 1, "file_url": 1}):
        docs.append({"doc_type": "invoice", "ref_id": inv.get("invoice_id"),
                     "label": f"Invoice {inv.get('invoice_number', inv.get('invoice_id'))}",
                     "date": inv.get("invoice_date"),
                     "download_url": inv.get("file_url") or f"/api/school/documents/invoice/{inv.get('invoice_id')}/download"})
    try:
        # Certificates are recipient-keyed (no school_id); link by the school's email.
        sch_email = (school.get("email") or "").lower().strip()
        if sch_email:
            async for c in db.cert_items.find(
                {"email": sch_email, "pdf_url": {"$nin": [None, ""]}},
                {"_id": 0, "item_id": 1, "name": 1, "created_at": 1, "pdf_url": 1}
            ):
                docs.append({"doc_type": "certificate", "ref_id": c.get("item_id"),
                             "label": (f"Certificate — {c.get('name', '')}").strip(" —"),
                             "date": c.get("created_at"), "download_url": c["pdf_url"]})
    except Exception:
        pass
    docs.sort(key=lambda d: d.get("date") or "", reverse=True)
    return docs


@router.get("/school/documents/quotation/{quotation_id}/download")
async def school_quotation_pdf(quotation_id: str, request: Request):
    school = await get_current_school(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id, "school_id": school["school_id"]})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    from routes.quotation_routes import _generate_pdf_bytes
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    pdf = await _generate_pdf_bytes(quot, company)
    return FResponse(content=pdf, media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="quotation_{quotation_id}.pdf"'})


@router.get("/school/documents/order/{order_id}/download")
async def school_order_pdf(order_id: str, request: Request):
    school = await get_current_school(request)
    order = await db.orders.find_one({"order_id": order_id, "school_id": school["school_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    pdf = _render_order_pdf(order, items, company)
    return FResponse(content=pdf, media_type="application/pdf",
                     headers={"Content-Disposition": f'inline; filename="order_{order_id}.pdf"'})


def _render_order_pdf(order: dict, items: list, company: dict) -> bytes:
    """Minimal one-page Sales Order PDF (reportlab)."""
    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    y = h - 25 * mm
    c.setFont("Helvetica-Bold", 15)
    c.drawString(20 * mm, y, company.get("company_name", "SmartShape Pro"))
    c.setFont("Helvetica", 9)
    y -= 6 * mm
    c.drawString(20 * mm, y, f"{company.get('address', '')} {company.get('city', '')}")
    y -= 12 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, y, f"Sales Order {order.get('order_number', order.get('order_id', ''))}")
    c.setFont("Helvetica", 9)
    c.drawRightString(w - 20 * mm, y, f"Status: {order.get('order_status', '')}")
    y -= 6 * mm
    c.drawString(20 * mm, y, f"Date: {str(order.get('created_at', ''))[:10]}")
    y -= 10 * mm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, "Item")
    c.drawString(120 * mm, y, "Code")
    c.drawRightString(w - 20 * mm, y, "Status")
    y -= 2 * mm
    c.line(20 * mm, y, w - 20 * mm, y)
    y -= 6 * mm
    c.setFont("Helvetica", 9)
    for it in items:
        if y < 25 * mm:
            c.showPage()
            y = h - 25 * mm
            c.setFont("Helvetica", 9)
        c.drawString(20 * mm, y, str(it.get("die_name", ""))[:60])
        c.drawString(120 * mm, y, str(it.get("die_code", "")))
        c.drawRightString(w - 20 * mm, y, str(it.get("status", "")))
        y -= 6 * mm
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(w - 20 * mm, y, f"Total: {order.get('currency_symbol', '')}{order.get('grand_total', 0)}")
    c.showPage()
    c.save()
    return buf.getvalue()


# ==================== PHASE 2 / MODULE B1 — TEACHER ACCOUNTS ====================

def _issue_teacher_cookie(response: Response, teacher: dict) -> dict:
    payload = {
        "sub": teacher["teacher_id"], "email": teacher["email"], "role": "teacher",
        "school_id": teacher.get("school_id"),
        "exp": datetime.now(timezone.utc) + timedelta(hours=24), "type": "access",
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    response.set_cookie(key="access_token", value=token, max_age=86400, **_COOKIE_KWARGS)
    data = {k: v for k, v in teacher.items() if k not in ("_id", "password_hash")}
    data["role"] = "teacher"
    return data


# ── School manages its teachers (uses the school session) ──────────────────────

@router.get("/school/teachers")
async def school_list_teachers(request: Request):
    school = await get_current_school(request)
    rows = await db.teachers.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for t in rows:
        t["activated"] = bool(t.pop("password_hash", None))
    return rows


@router.post("/school/teachers")
async def school_create_teacher(request: Request):
    school = await get_current_school(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").lower().strip()
    if not name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")
    if await db.teachers.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="A teacher with this email already exists")
    teacher_id = f"tch_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "teacher_id": teacher_id, "school_id": school["school_id"],
        "name": name, "email": email, "subject": (body.get("subject") or "").strip(),
        "status": "active", "created_by": school["school_id"], "created_at": now_iso,
    }
    await db.teachers.insert_one(doc)
    try:
        await teacher_auth.send_teacher_invite(doc, school.get("school_name", ""))
    except Exception as e:
        import logging
        logging.error(f"teacher invite failed for {teacher_id}: {e}")
    return await db.teachers.find_one({"teacher_id": teacher_id}, {"_id": 0, "password_hash": 0})


@router.put("/school/teachers/{teacher_id}")
async def school_update_teacher(teacher_id: str, request: Request):
    school = await get_current_school(request)
    teacher = await db.teachers.find_one({"teacher_id": teacher_id, "school_id": school["school_id"]})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    body = await request.json()
    update = {k: body[k] for k in ("name", "subject", "status") if k in body}
    if update:
        await db.teachers.update_one({"teacher_id": teacher_id}, {"$set": update})
    return await db.teachers.find_one({"teacher_id": teacher_id}, {"_id": 0, "password_hash": 0})


@router.post("/school/teachers/{teacher_id}/resend-invite")
async def school_resend_teacher_invite(teacher_id: str, request: Request):
    school = await get_current_school(request)
    teacher = await db.teachers.find_one({"teacher_id": teacher_id, "school_id": school["school_id"]})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return await teacher_auth.send_teacher_invite(teacher, school.get("school_name", ""))


# ── Teacher auth (the teacher's own session) ───────────────────────────────────

@router.post("/teacher/auth/activate/verify")
async def teacher_activate_verify(request: Request):
    body = await request.json()
    teacher = await teacher_auth.peek_token((body.get("token") or "").strip())
    if not teacher:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    email = teacher.get("email", "")
    masked = (email[:2] + "***" + email[email.find("@"):]) if "@" in email else "***"
    return {"email_masked": masked, "name": teacher.get("name", "")}


@router.post("/teacher/auth/set-password")
async def teacher_set_password(request: Request, response: Response):
    body = await request.json()
    password = body.get("password") or ""
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    teacher = await teacher_auth.consume_token((body.get("token") or "").strip())
    if not teacher:
        raise HTTPException(status_code=400, detail="This link is invalid or has expired")
    await db.teachers.update_one({"teacher_id": teacher["teacher_id"]},
                                 {"$set": {"password_hash": hash_password(password)}})
    fresh = await db.teachers.find_one({"teacher_id": teacher["teacher_id"]})
    return _issue_teacher_cookie(response, fresh)


@router.post("/teacher/auth/login")
async def teacher_login(request: Request, response: Response):
    body = await request.json()
    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    teacher = await db.teachers.find_one({"email": email})
    if not teacher or not teacher.get("password_hash") or teacher.get("status") == "inactive":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(password, teacher["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _issue_teacher_cookie(response, teacher)


@router.get("/teacher/me")
async def teacher_me(request: Request):
    teacher = await get_current_teacher(request)
    teacher["role"] = "teacher"
    return teacher


# ==================== PHASE 2 / MODULE B — SHARED HELPERS ====================

async def _admin_notify(title: str, message: str, ntype: str = "teacher_content", extra: dict = None):
    doc = {"notification_id": f"an_{uuid.uuid4().hex[:12]}", "type": ntype,
           "title": title, "message": message, "read": False,
           "created_at": datetime.now(timezone.utc).isoformat()}
    if extra:
        doc.update(extra)
    await db.admin_notifications.insert_one(doc)


async def _notify_teacher(teacher_id: str, title: str, message: str):
    await db.teacher_notifications.insert_one({
        "notification_id": f"tn_{uuid.uuid4().hex[:12]}", "teacher_id": teacher_id,
        "title": title, "message": message, "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ── Transactional emails for portal events (reuse the Gmail pipeline; best-effort) ──

def _portal_email_html(name: str, heading: str, body: str, cta_label: str = "", cta_url: str = "") -> str:
    btn = (f'<p style="margin:24px 0"><a href="{cta_url}" style="background:#e94560;color:#fff;'
           f'padding:11px 20px;border-radius:8px;text-decoration:none">{cta_label}</a></p>') if cta_label and cta_url else ""
    return f"""<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#e94560">{heading}</h2>
      <p>Hello {name or 'there'},</p>
      <p>{body}</p>{btn}
      <p style="color:#888;font-size:12px">— SmartShape Pro</p></div>"""


async def _email_teacher(teacher_id: str, subject: str, heading: str, body: str, cta_label="", cta_url=""):
    from services.school_auth import _send_email
    t = await db.teachers.find_one({"teacher_id": teacher_id}, {"_id": 0, "email": 1, "name": 1})
    if t and (t.get("email") or "").strip():
        try:
            await _send_email(t["email"], subject, _portal_email_html(t.get("name", ""), heading, body, cta_label, cta_url))
        except Exception:
            pass


async def _email_school(school_id: str, subject: str, heading: str, body: str, cta_label="", cta_url=""):
    from services.school_auth import _send_email
    s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "email": 1, "school_name": 1})
    if s and (s.get("email") or "").strip():
        try:
            await _send_email(s["email"], subject, _portal_email_html(s.get("school_name", ""), heading, body, cta_label, cta_url))
        except Exception:
            pass


async def _require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def _portal_user(request: Request):
    """Accept either a teacher or a school portal session (for read-only shared surfaces)."""
    try:
        return await get_current_teacher(request)
    except HTTPException:
        return await get_current_school(request)


# ==================== MODULE B2 — TEACHER VIDEOS (Cloudinary signed upload) ====================

@router.post("/teacher/videos/sign")
async def teacher_video_sign(request: Request):
    await get_current_teacher(request)
    from services.storage import _cloudinary_config
    cfg = await _cloudinary_config()
    if not cfg:
        raise HTTPException(status_code=400,
                            detail="Video uploads need Cloudinary — ask your admin to set it up in App Settings.")
    timestamp = int(time.time())
    folder = "smartshape/teacher_videos"
    to_sign = f"folder={folder}&timestamp={timestamp}{cfg['api_secret']}"
    signature = hashlib.sha1(to_sign.encode("utf-8")).hexdigest()
    return {"cloud_name": cfg["cloud_name"], "api_key": cfg["api_key"],
            "timestamp": timestamp, "signature": signature, "folder": folder, "resource_type": "video"}


@router.post("/teacher/videos")
async def teacher_create_video(request: Request):
    teacher = await get_current_teacher(request)
    body = await request.json()
    cl = body.get("cloudinary") or {}
    if not cl.get("secure_url"):
        raise HTTPException(status_code=400, detail="Missing uploaded video")
    if cl.get("bytes") and int(cl["bytes"]) > 200 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Video too large (max 200MB)")
    vtype = body.get("type") if body.get("type") in ("review", "workshop", "competition") else "review"
    comp_id = body.get("competition_id")
    if vtype == "competition":
        if not comp_id:
            raise HTTPException(status_code=400, detail="competition_id required for a competition entry")
        comp = await db.competitions.find_one({"competition_id": comp_id})
        if not comp:
            raise HTTPException(status_code=404, detail="Competition not found")
        end = comp.get("end_date")
        if end and str(end) < datetime.now(timezone.utc).strftime("%Y-%m-%d"):
            raise HTTPException(status_code=400, detail="This competition has closed")
    title = (body.get("title") or "").strip() or "Untitled"
    video_id = f"vid_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "video_id": video_id, "teacher_id": teacher["teacher_id"], "school_id": teacher.get("school_id"),
        "teacher_name": teacher.get("name", ""), "type": vtype, "competition_id": comp_id if vtype == "competition" else None,
        "title": title, "description": (body.get("description") or "").strip(),
        "machine_used": (body.get("machine_used") or "").strip(), "dies_used": (body.get("dies_used") or "").strip(),
        "public_id": cl.get("public_id"), "video_url": cl.get("secure_url"),
        "thumbnail_url": cl.get("thumbnail_url") or "", "duration": cl.get("duration"), "bytes": cl.get("bytes"),
        "status": "pending", "review_note": None, "reviewed_by": None, "reviewed_at": None, "created_at": now,
    }
    await db.teacher_videos.insert_one(doc)
    await _admin_notify("New teacher video to review",
                        f"{teacher.get('name', 'A teacher')} uploaded a {vtype} video: {title}",
                        ntype="teacher_video", extra={"video_id": video_id, "school_id": teacher.get("school_id")})
    return await db.teacher_videos.find_one({"video_id": video_id}, {"_id": 0})


@router.get("/teacher/videos")
async def teacher_list_videos(request: Request):
    teacher = await get_current_teacher(request)
    return await db.teacher_videos.find({"teacher_id": teacher["teacher_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.delete("/teacher/videos/{video_id}")
async def teacher_delete_video(video_id: str, request: Request):
    teacher = await get_current_teacher(request)
    v = await db.teacher_videos.find_one({"video_id": video_id, "teacher_id": teacher["teacher_id"]})
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    if v.get("status") == "approved":
        raise HTTPException(status_code=400, detail="Approved videos can't be deleted")
    await db.teacher_videos.delete_one({"video_id": video_id})
    return {"message": "Deleted"}


@router.get("/teacher/notifications")
async def teacher_notifications(request: Request):
    teacher = await get_current_teacher(request)
    return await db.teacher_notifications.find({"teacher_id": teacher["teacher_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


# ==================== MODULE B3 — ADMIN REVIEW QUEUE ====================

@router.get("/admin/teacher-videos")
async def admin_list_teacher_videos(request: Request, status: str = "pending"):
    await _require_admin(request)
    q = {} if status == "all" else {"status": status}
    return await db.teacher_videos.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/admin/teacher-videos/{video_id}/approve")
async def admin_approve_video(video_id: str, request: Request):
    user = await _require_admin(request)
    v = await db.teacher_videos.find_one({"video_id": video_id})
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.teacher_videos.update_one({"video_id": video_id}, {"$set": {
        "status": "approved", "review_note": None, "reviewed_by": user.get("email"),
        "reviewed_at": datetime.now(timezone.utc).isoformat()}})
    await _notify_teacher(v["teacher_id"], "Your video was approved", f'"{v.get("title")}" is now live in the gallery.')
    await _email_teacher(v["teacher_id"], "Your SmartShape video was approved 🎉", "Video approved",
                         f'Your video "<b>{v.get("title")}</b>" has been approved and is now live in the gallery.')
    return await db.teacher_videos.find_one({"video_id": video_id}, {"_id": 0})


@router.post("/admin/teacher-videos/{video_id}/reject")
async def admin_reject_video(video_id: str, request: Request):
    user = await _require_admin(request)
    body = await request.json()
    reason = (body.get("reason") or "").strip() or "Not approved"
    v = await db.teacher_videos.find_one({"video_id": video_id})
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.teacher_videos.update_one({"video_id": video_id}, {"$set": {
        "status": "rejected", "review_note": reason, "reviewed_by": user.get("email"),
        "reviewed_at": datetime.now(timezone.utc).isoformat()}})
    await _notify_teacher(v["teacher_id"], "Your video needs changes", f'"{v.get("title")}": {reason}')
    await _email_teacher(v["teacher_id"], "Your SmartShape video needs changes", "Video needs changes",
                         f'Your video "<b>{v.get("title")}</b>" wasn\'t approved. Reason: {reason}. You can edit and re-upload from your portal.')
    return await db.teacher_videos.find_one({"video_id": video_id}, {"_id": 0})


# ==================== MODULE B4 — CENTRAL GALLERY ====================

@router.get("/gallery")
async def gallery(request: Request, type: str = None, competition_id: str = None, school_id: str = None):
    await _portal_user(request)
    q = {"status": "approved"}
    if type:
        q["type"] = type
    if competition_id:
        q["competition_id"] = competition_id
    if school_id:
        q["school_id"] = school_id
    vids = await db.teacher_videos.find(
        q, {"_id": 0, "video_id": 1, "title": 1, "description": 1, "type": 1, "teacher_name": 1,
            "school_id": 1, "machine_used": 1, "dies_used": 1, "video_url": 1, "thumbnail_url": 1,
            "competition_id": 1, "reviewed_at": 1}
    ).sort("reviewed_at", -1).to_list(500)
    return vids


# ==================== MODULE B5 — COMPETITIONS ====================

def _comp_status(comp: dict) -> str:
    if comp.get("status") in ("draft", "results", "closed"):
        return comp["status"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if comp.get("start_date") and today < str(comp["start_date"]):
        return "upcoming"
    if comp.get("end_date") and today > str(comp["end_date"]):
        return "closed"
    return "open"


@router.post("/admin/competitions")
async def admin_create_competition(request: Request):
    user = await _require_admin(request)
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    comp_id = f"comp_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "competition_id": comp_id, "title": title, "theme": (body.get("theme") or "").strip(),
        "description": (body.get("description") or "").strip(), "banner_url": (body.get("banner_url") or "").strip(),
        "start_date": body.get("start_date") or "", "end_date": body.get("end_date") or "",
        "rules": (body.get("rules") or "").strip(), "prizes": (body.get("prizes") or "").strip(),
        "status": "open", "winner_video_ids": [], "created_by": user.get("email"), "created_at": now,
    }
    await db.competitions.insert_one(doc)
    return await db.competitions.find_one({"competition_id": comp_id}, {"_id": 0})


@router.get("/admin/competitions")
async def admin_list_competitions(request: Request):
    await _require_admin(request)
    comps = await db.competitions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for c in comps:
        c["computed_status"] = _comp_status(c)
    return comps


@router.put("/admin/competitions/{competition_id}")
async def admin_update_competition(competition_id: str, request: Request):
    await _require_admin(request)
    body = await request.json()
    update = {k: body[k] for k in ("title", "theme", "description", "banner_url", "start_date",
                                   "end_date", "rules", "prizes", "status") if k in body}
    if not await db.competitions.find_one({"competition_id": competition_id}):
        raise HTTPException(status_code=404, detail="Competition not found")
    if update:
        await db.competitions.update_one({"competition_id": competition_id}, {"$set": update})
    return await db.competitions.find_one({"competition_id": competition_id}, {"_id": 0})


@router.get("/admin/competitions/{competition_id}/entries")
async def admin_competition_entries(competition_id: str, request: Request):
    await _require_admin(request)
    return await db.teacher_videos.find({"competition_id": competition_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.post("/admin/competitions/{competition_id}/winners")
async def admin_set_winners(competition_id: str, request: Request):
    await _require_admin(request)
    body = await request.json()
    winners = body.get("winner_video_ids") or []
    comp = await db.competitions.find_one({"competition_id": competition_id})
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    await db.competitions.update_one({"competition_id": competition_id},
                                     {"$set": {"winner_video_ids": winners, "status": "results"}})
    for vid in winners:
        v = await db.teacher_videos.find_one({"video_id": vid})
        if v:
            await _notify_teacher(v["teacher_id"], "🏆 You won!", f'"{v.get("title")}" won {comp.get("title")}!')
            await _email_teacher(v["teacher_id"], f"🏆 You won {comp.get('title')}!", "Congratulations!",
                                 f'Your entry "<b>{v.get("title")}</b>" won <b>{comp.get("title")}</b>. {comp.get("prizes") or ""}')
    return await db.competitions.find_one({"competition_id": competition_id}, {"_id": 0})


@router.get("/competitions")
async def portal_list_competitions(request: Request):
    await _portal_user(request)
    comps = await db.competitions.find({"status": {"$ne": "draft"}}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for c in comps:
        c["computed_status"] = _comp_status(c)
    return comps


@router.get("/competitions/{competition_id}")
async def portal_competition_detail(competition_id: str, request: Request):
    await _portal_user(request)
    comp = await db.competitions.find_one({"competition_id": competition_id}, {"_id": 0})
    if not comp or comp.get("status") == "draft":
        raise HTTPException(status_code=404, detail="Competition not found")
    comp["computed_status"] = _comp_status(comp)
    comp["entries"] = await db.teacher_videos.find(
        {"competition_id": competition_id, "status": "approved"},
        {"_id": 0, "video_id": 1, "title": 1, "teacher_name": 1, "school_id": 1,
         "video_url": 1, "thumbnail_url": 1, "machine_used": 1, "dies_used": 1}
    ).sort("reviewed_at", -1).to_list(500)
    return comp


# ==================== ADMIN — SCHOOL PORTAL INBOX (closes the review loop) ====================

@router.get("/admin/portal-inbox")
async def admin_portal_inbox(request: Request):
    await _require_admin(request)
    notifications = await db.admin_notifications.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    requests_ = await db.school_requests.find({"status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    unread = await db.admin_notifications.count_documents({"read": False})
    pending_videos = await db.teacher_videos.count_documents({"status": "pending"})
    return {
        "notifications": notifications,
        "requests": requests_,
        "counts": {"unread": unread, "open_requests": len(requests_), "pending_videos": pending_videos},
    }


@router.get("/admin/portal-inbox/summary")
async def admin_portal_inbox_summary(request: Request):
    await _require_admin(request)
    return {
        "unread": await db.admin_notifications.count_documents({"read": False}),
        "open_requests": await db.school_requests.count_documents({"status": "open"}),
        "pending_videos": await db.teacher_videos.count_documents({"status": "pending"}),
    }


@router.put("/admin/portal-inbox/notifications/{notification_id}/read")
async def admin_mark_notif_read(notification_id: str, request: Request):
    await _require_admin(request)
    await db.admin_notifications.update_one({"notification_id": notification_id}, {"$set": {"read": True}})
    return {"message": "ok"}


@router.put("/admin/portal-inbox/notifications/read-all")
async def admin_mark_all_notifs_read(request: Request):
    await _require_admin(request)
    await db.admin_notifications.update_many({"read": False}, {"$set": {"read": True}})
    return {"message": "ok"}


@router.put("/admin/school-requests/{request_id}")
async def admin_update_school_request(request_id: str, request: Request):
    await _require_admin(request)
    body = await request.json()
    status = body.get("status") or "handled"
    if not await db.school_requests.find_one({"request_id": request_id}):
        raise HTTPException(status_code=404, detail="Request not found")
    await db.school_requests.update_one({"request_id": request_id},
                                        {"$set": {"status": status, "handled_at": datetime.now(timezone.utc).isoformat()}})
    return await db.school_requests.find_one({"request_id": request_id}, {"_id": 0})


# ==================== PHASE 3 — TRAINING, CALENDAR & MEETINGS ====================

async def _portal_principal(request: Request):
    """Return (kind, principal) where kind is 'teacher' or 'school'."""
    try:
        t = await get_current_teacher(request)
        return "teacher", t
    except HTTPException:
        s = await get_current_school(request)
        return "school", s


# ── Training calendar (both portals) ───────────────────────────────────────────

@router.get("/portal/training")
async def portal_training(request: Request):
    kind, p = await _portal_principal(request)
    me_id = p["teacher_id"] if kind == "teacher" else p["school_id"]
    sessions = await db.training_sessions.find(
        {"is_published": {"$ne": False}, "status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).sort("date", 1).to_list(200)
    for s in sessions:
        sid = s.get("session_id")
        count = await db.session_registrations.count_documents({"session_id": sid})
        s["registration_count"] = count
        mx = int(s.get("max_participants", 0) or 0)
        s["is_full"] = (mx > 0 and count >= mx)
        s["registered"] = bool(await db.session_registrations.find_one(
            {"session_id": sid, "registrant_id": me_id}))
    return sessions


@router.post("/portal/training/{session_id}/register")
async def portal_training_register(session_id: str, request: Request):
    kind, p = await _portal_principal(request)
    sess = await db.training_sessions.find_one({"session_id": session_id})
    if not sess or sess.get("is_published") is False:
        raise HTTPException(status_code=404, detail="Session not found")
    me_id = p["teacher_id"] if kind == "teacher" else p["school_id"]
    existing = await db.session_registrations.find_one({"session_id": session_id, "registrant_id": me_id}, {"_id": 0})
    if existing:
        return existing
    mx = int(sess.get("max_participants", 0) or 0)
    if mx > 0 and await db.session_registrations.count_documents({"session_id": session_id}) >= mx:
        raise HTTPException(status_code=400, detail="This session is full")
    doc = {
        "registration_id": f"reg_{uuid.uuid4().hex[:12]}",
        "session_id": session_id,
        "registrant_type": kind,
        "registrant_id": me_id,
        "name": p.get("name") or p.get("school_name", ""),
        "email": p.get("email", ""),
        "school_id": p.get("school_id"),
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.session_registrations.insert_one(doc)
    return await db.session_registrations.find_one({"registration_id": doc["registration_id"]}, {"_id": 0})


@router.delete("/portal/training/{session_id}/register")
async def portal_training_unregister(session_id: str, request: Request):
    kind, p = await _portal_principal(request)
    me_id = p["teacher_id"] if kind == "teacher" else p["school_id"]
    await db.session_registrations.delete_many({"session_id": session_id, "registrant_id": me_id})
    return {"message": "Unregistered"}


# ── Training videos library (both portals) ─────────────────────────────────────

@router.get("/portal/training-videos")
async def portal_training_videos(request: Request):
    await _portal_principal(request)
    return await db.training_videos.find(
        {"is_published": {"$ne": False}},
        {"_id": 0, "video_id": 1, "title": 1, "description": 1, "youtube_url": 1,
         "thumbnail_url": 1, "duration_mins": 1, "category": 1, "view_count": 1}
    ).sort("published_at", -1).to_list(500)


@router.post("/portal/training-videos/{video_id}/view")
async def portal_training_video_view(video_id: str, request: Request):
    await _portal_principal(request)
    await db.training_videos.update_one({"video_id": video_id}, {"$inc": {"view_count": 1}})
    return {"ok": True}


# ── Private 1:1 meetings ───────────────────────────────────────────────────────

@router.get("/school/meetings")
async def school_meetings(request: Request):
    school = await get_current_school(request)
    return await db.portal_meetings.find(
        {"school_id": school["school_id"], "status": {"$ne": "cancelled"}}, {"_id": 0}
    ).sort("scheduled_at", 1).to_list(200)


@router.get("/teacher/meetings")
async def teacher_meetings(request: Request):
    teacher = await get_current_teacher(request)
    return await db.portal_meetings.find(
        {"school_id": teacher.get("school_id"), "status": {"$ne": "cancelled"},
         "$or": [{"teacher_id": None}, {"teacher_id": {"$exists": False}}, {"teacher_id": teacher["teacher_id"]}]},
        {"_id": 0}
    ).sort("scheduled_at", 1).to_list(200)


@router.post("/admin/portal-meetings")
async def admin_create_meeting(request: Request):
    user = await _require_admin(request)
    body = await request.json()
    school_id = body.get("school_id")
    if not school_id or not await db.schools.find_one({"school_id": school_id}):
        raise HTTPException(status_code=404, detail="School not found")
    title = (body.get("title") or "").strip() or "Meeting"
    platform = body.get("platform") if body.get("platform") in ("zoom", "meet", "physical") else "zoom"
    meeting_link = (body.get("meeting_link") or "").strip()
    scheduled_at = body.get("scheduled_at") or ""
    # Best-effort Zoom auto-create when asked and no link supplied.
    if platform == "zoom" and not meeting_link and body.get("create_zoom"):
        try:
            import zoom_service
            if await zoom_service.is_configured():
                zm = await zoom_service.create_meeting(topic=title, start_time=scheduled_at or "",
                                                       duration=int(body.get("duration") or 30),
                                                       timezone_str="Asia/Kolkata", agenda=body.get("description") or "")
                meeting_link = zm.get("join_url") or zm.get("start_url") or ""
        except Exception as e:
            import logging
            logging.warning(f"portal meeting zoom create failed: {e}")
    meeting_id = f"pm_{uuid.uuid4().hex[:12]}"
    doc = {
        "meeting_id": meeting_id, "school_id": school_id, "teacher_id": body.get("teacher_id") or None,
        "title": title, "description": (body.get("description") or "").strip(),
        "scheduled_at": scheduled_at, "platform": platform, "meeting_link": meeting_link,
        "location": (body.get("location") or "").strip(), "status": "scheduled",
        "notes": (body.get("notes") or "").strip(), "created_by": user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.portal_meetings.insert_one(doc)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    await _notify_admin_school_action(school, f"has a meeting scheduled: {title}")
    _mbody = f'A meeting "<b>{title}</b>" is scheduled for <b>{scheduled_at}</b>' + (f' ({platform}).' if platform else '.')
    _cta = ("Join meeting", meeting_link) if meeting_link else ("", "")
    if doc["teacher_id"]:
        await _notify_teacher(doc["teacher_id"], "New meeting scheduled", f'{title} — {scheduled_at}')
        await _email_teacher(doc["teacher_id"], f"Meeting scheduled: {title}", "Meeting scheduled", _mbody, *_cta)
    else:
        await _email_school(school_id, f"Meeting scheduled: {title}", "Meeting scheduled", _mbody, *_cta)
    return await db.portal_meetings.find_one({"meeting_id": meeting_id}, {"_id": 0})


@router.get("/admin/portal-meetings")
async def admin_list_meetings(request: Request, school_id: str = None, status: str = None):
    await _require_admin(request)
    q = {}
    if school_id:
        q["school_id"] = school_id
    if status:
        q["status"] = status
    return await db.portal_meetings.find(q, {"_id": 0}).sort("scheduled_at", -1).to_list(500)


@router.put("/admin/portal-meetings/{meeting_id}")
async def admin_update_meeting(meeting_id: str, request: Request):
    await _require_admin(request)
    body = await request.json()
    update = {k: body[k] for k in ("title", "description", "scheduled_at", "platform",
                                   "meeting_link", "location", "status", "notes", "teacher_id") if k in body}
    if not await db.portal_meetings.find_one({"meeting_id": meeting_id}):
        raise HTTPException(status_code=404, detail="Meeting not found")
    if update:
        await db.portal_meetings.update_one({"meeting_id": meeting_id}, {"$set": update})
    return await db.portal_meetings.find_one({"meeting_id": meeting_id}, {"_id": 0})
