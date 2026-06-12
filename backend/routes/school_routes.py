from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response as FResponse
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_school

router = APIRouter()


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
        async for c in db.certificate_items.find({"school_id": sid}, {"_id": 0, "item_id": 1, "title": 1, "created_at": 1, "pdf_url": 1}):
            if c.get("pdf_url"):
                docs.append({"doc_type": "certificate", "ref_id": c.get("item_id"),
                             "label": c.get("title") or "Certificate", "date": c.get("created_at"),
                             "download_url": c["pdf_url"]})
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
