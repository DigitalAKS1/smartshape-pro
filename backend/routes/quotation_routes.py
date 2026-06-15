from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid
import os
import re
import requests
import logging

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_teams
from routes.drip_routes import _auto_enroll_quotation_sent
from media_utils import gate_die_for_customer

router = APIRouter()

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")


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

    # ── GST grouped by rate slab (for display) ─────────────────────────────────
    # Legally GST must be shown per rate, not blended. Freight (18%) folds into
    # the 18% slab. Discounts scale each slab's taxable base proportionally.
    slabs: dict = {}
    for l in lines:
        rate = l.get("gst_pct", 18)
        slab = slabs.setdefault(rate, {"rate": rate, "taxable": 0.0, "amount": 0.0})
        slab["taxable"] += l.get("line_subtotal", 0) * discount_factor
        slab["amount"]  += l.get("line_subtotal", 0) * (rate / 100) * discount_factor
    if freight_base > 0:
        slab = slabs.setdefault(18, {"rate": 18, "taxable": 0.0, "amount": 0.0})
        slab["taxable"] += freight_base
        slab["amount"]  += freight_gst
    gst_breakup = [slabs[r] for r in sorted(slabs, reverse=True) if slabs[r]["amount"] > 0]

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
        gst_breakup         = gst_breakup,
        total_with_gst      = after_disc + total_gst,
        grand_total         = grand_total,
    )


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


# ==================== AUTO-REGISTER HELPER ====================

async def _auto_register_from_quotation(quot: dict, created_by_email: str):
    """After a quotation is saved, silently upsert the school, contact, and lead into CRM,
    and store lead_id back on the quotation."""
    now_iso = datetime.now(timezone.utc).isoformat()
    sname        = (quot.get("school_name") or "").strip()
    pname        = (quot.get("principal_name") or "").strip()
    phone        = (quot.get("customer_phone") or "").strip()
    email        = (quot.get("customer_email") or "").strip()
    addr         = (quot.get("address") or "").strip()
    quotation_id = quot.get("quotation_id", "")

    school_id     = None
    contact_id_used = None  # track for lead linking

    # ── 1. School ──────────────────────────────────────────────────────────────
    if sname:
        existing_school = await db.schools.find_one(
            {"school_name": {"$regex": f"^{re.escape(sname)}$", "$options": "i"}},
            {"_id": 0, "school_id": 1}
        )
        if existing_school:
            school_id = existing_school["school_id"]
            await db.schools.update_one(
                {"school_id": school_id},
                {"$set": {"last_activity_date": now_iso}}
            )
        else:
            school_id = f"sch_{uuid.uuid4().hex[:12]}"
            await db.schools.insert_one({
                "school_id": school_id,
                "school_name": sname,
                "school_type": "School",
                "board": "",
                "group_id": "",
                "website": "",
                "email": email,
                "phone": phone,
                "city": "",
                "state": "",
                "pincode": "",
                "address": addr,
                "primary_contact_name": pname,
                "designation": "Principal",
                "alternate_contact": "",
                "school_strength": 0,
                "number_of_branches": 1,
                "annual_budget_range": "",
                "existing_vendor": "",
                "social_profiles": {},
                "anniversary": "",
                "source": "quotation",
                "source_id": quot.get("quotation_id"),
                "last_activity_date": now_iso,
                "created_by": created_by_email,
                "created_at": now_iso,
            })
            logging.info(f"Auto-created school '{sname}' from quotation {quot.get('quotation_id')}")

    # Stamp the resolved school_id back on the quotation so the 360° school view
    # links by FK (not a fragile school_name string match).
    if school_id and quotation_id:
        await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": {"school_id": school_id}})

    # ── School Portal: persist per-quote login methods + send activation/welcome invite ──
    if school_id and email:
        pm = quot.get("portal_login_methods")
        if isinstance(pm, dict):
            await db.schools.update_one(
                {"school_id": school_id},
                {"$set": {"portal_login_methods": {k: bool(pm.get(k, False)) for k in ("email_link", "magic_link", "google")}}},
            )
        school_doc = await db.schools.find_one({"school_id": school_id})
        # Only invite schools that have not yet set a password (avoid re-spamming on re-quote).
        if school_doc and not school_doc.get("password_hash"):
            try:
                from services.school_auth import send_portal_invite
                await send_portal_invite(school_doc)
            except Exception as e:
                logging.error(f"school portal invite failed for {school_id}: {e}")

    # ── 2. Contact ─────────────────────────────────────────────────────────────
    if pname and (phone or email):
        or_clauses = []
        if phone:
            or_clauses.append({"phone": phone})
        if email:
            or_clauses.append({"email": email})
        existing_contact = await db.contacts.find_one(
            {"$or": or_clauses},
            {"_id": 0, "contact_id": 1, "school_id": 1, "company": 1}
        )
        if existing_contact:
            contact_id_used = existing_contact["contact_id"]
            update_fields = {"last_activity_date": now_iso}
            existing_school_id = existing_contact.get("school_id")
            if school_id:
                if not existing_school_id:
                    update_fields["school_id"] = school_id
                    if not existing_contact.get("company"):
                        update_fields["company"] = sname
                elif existing_school_id != school_id:
                    logging.warning(
                        f"Quotation {quotation_id}: contact {existing_contact['contact_id']} "
                        f"belongs to school '{existing_contact.get('company')}' but quotation is for '{sname}'. "
                        "No auto-reassignment."
                    )
            await db.contacts.update_one(
                {"contact_id": contact_id_used},
                {"$set": update_fields}
            )
        else:
            contact_id_used = f"con_{uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({
                "contact_id": contact_id_used,
                "name": pname,
                "phone": phone,
                "email": email,
                "company": sname,
                "school_id": school_id,
                "designation": "Principal",
                "contact_role_id": "",
                "source": "quotation",
                "source_id": quotation_id,
                "notes": "",
                "birthday": "",
                "status": "active",
                "converted_to_lead": False,
                "lead_id": None,
                "previous_schools": [],
                "last_activity_date": now_iso,
                "created_by": created_by_email,
                "created_at": now_iso,
            })
            logging.info(f"Auto-created contact '{pname}' (school_id={school_id}) from quotation {quotation_id}")

    # ── 3. Lead — create or link ───────────────────────────────────────────────
    if not sname and not contact_id_used:
        return  # nothing to link a lead to

    # If this quotation already has a lead_id stored, skip
    if quot.get("lead_id"):
        return

    # Find existing active (non-won/lost/deleted) lead for this school
    lead_query: dict = {"is_deleted": {"$ne": True}, "stage": {"$nin": ["won", "lost"]}}
    if school_id:
        lead_query["school_id"] = school_id
    elif sname:
        lead_query["company_name"] = sname
    else:
        return

    existing_lead = await db.leads.find_one(lead_query, {"_id": 0, "lead_id": 1, "stage": 1})

    if existing_lead:
        lead_id = existing_lead["lead_id"]
        await db.leads.update_one(
            {"lead_id": lead_id},
            {"$set": {"last_activity_date": now_iso}, "$addToSet": {"quotation_ids": quotation_id}}
        )
        logging.info(f"Linked quotation {quotation_id} → existing lead {lead_id}")
    else:
        lead_id = f"lead_{uuid.uuid4().hex[:12]}"
        sp_email = quot.get("sales_person_email", created_by_email)
        sp_name  = quot.get("sales_person_name", "")
        await db.leads.insert_one({
            "lead_id": lead_id,
            "school_id": school_id,
            "company_name": sname,
            "school_city": quot.get("city", ""),
            "contact_name": pname,
            "designation": "Principal",
            "contact_role_id": "",
            "contact_phone": phone,
            "contact_email": email,
            "source": "quotation",
            "source_id": quotation_id,
            "lead_type": "warm",
            "interested_product": quot.get("package_name", ""),
            "stage": "negotiation",
            "priority": "high",
            "next_followup_date": "",
            "likely_closure_date": "",
            "assigned_to": sp_email,
            "assigned_name": sp_name,
            "notes": f"Auto-created from quotation {quot.get('quote_number', quotation_id)}",
            "tags": [],
            "quotation_ids": [quotation_id],
            "pipeline_history": [{
                "from_stage": None,
                "to_stage": "negotiation",
                "by_email": "system",
                "by_name": "Auto (Quotation)",
                "at": now_iso,
            }],
            "is_deleted": False,
            "converted_from_contact": contact_id_used,
            "last_activity_date": now_iso,
            "created_by": created_by_email,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        # Mark the contact as converted (linked to this lead)
        if contact_id_used:
            await db.contacts.update_one(
                {"contact_id": contact_id_used},
                {"$set": {"converted_to_lead": True, "lead_id": lead_id, "last_activity_date": now_iso}}
            )
        logging.info(f"Auto-created lead {lead_id} from quotation {quotation_id}")

    # Store lead_id on the quotation for direct navigation
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"lead_id": lead_id}}
    )


# ==================== BACKFILL ENDPOINT ====================

@router.post("/quotations/backfill-leads")
async def backfill_quotation_leads(request: Request):
    """Admin-only: process all existing quotations that lack a lead_id, create and link leads."""
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    quots = await db.quotations.find(
        {"lead_id": {"$in": [None, ""]}}, {"_id": 0}
    ).to_list(None)

    processed = 0
    skipped = 0
    errors_list = []
    for quot in quots:
        try:
            await _auto_register_from_quotation(quot, quot.get("created_by", "system"))
            processed += 1
        except Exception as e:
            errors_list.append(f"{quot.get('quote_number','?')}: {str(e)[:80]}")
            skipped += 1

    return {
        "total": len(quots),
        "processed": processed,
        "skipped": skipped,
        "errors": errors_list[:10],
        "message": f"Processed {processed}/{len(quots)} quotations — leads created/linked"
    }


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


async def _crm_hook_quotation(quot_doc: dict):
    """When a quotation is created/sent, advance linked leads to 'negotiation',
    apply the 'Demo Done' tag, and start the quotation_sent drip sequence."""
    school_name = quot_doc.get("school_name", "").strip()
    if not school_name:
        return
    # Find matching school by name (case-insensitive)
    school = await db.schools.find_one(
        {"school_name": {"$regex": f"^{re.escape(school_name)}$", "$options": "i"}}, {"_id": 0, "school_id": 1}
    )
    school_id = school["school_id"] if school else None

    # Collect active leads for this school (by school_id or company_name)
    lead_query = {"is_deleted": {"$ne": True}, "stage": {"$nin": ["negotiation", "won", "lost"]}}
    if school_id:
        lead_query["$or"] = [{"school_id": school_id}, {"company_name": school_name}]
    else:
        lead_query["company_name"] = school_name

    leads = await db.leads.find(lead_query, {"_id": 0}).to_list(100)
    if not leads:
        return

    # Ensure "Demo Done" tag exists
    demo_tag = await db.tags.find_one({"name": "Demo Done"}, {"_id": 0})
    if not demo_tag:
        demo_tag_id = f"tag_{uuid.uuid4().hex[:8]}"
        await db.tags.insert_one({
            "tag_id": demo_tag_id, "name": "Demo Done",
            "color": "#8b5cf6", "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        demo_tag_id = demo_tag["tag_id"]

    now_iso = datetime.now(timezone.utc).isoformat()
    for lead in leads:
        history_entry = {
            "from_stage": lead.get("stage"),
            "to_stage": "negotiation",
            "by_email": "system",
            "by_name": "Auto (Quotation)",
            "at": now_iso,
        }
        await db.leads.update_one(
            {"lead_id": lead["lead_id"]},
            {
                "$set": {"stage": "negotiation", "updated_at": now_iso, "last_activity_date": now_iso},
                "$push": {"pipeline_history": history_entry},
                "$addToSet": {"tags": demo_tag_id},
            },
        )
        lead["stage"] = "negotiation"
        try:
            await _auto_enroll_quotation_sent(lead)
        except Exception as e:
            logging.warning(f"Drip enroll for quotation_sent failed on {lead['lead_id']}: {e}")


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
        "lead_id": body.get("lead_id") or None,
        "sales_person_id": sp.get("sales_person_id"),
        "sales_person_name": sp["name"],
        "sales_person_email": sp["email"],
        "currency_symbol": body.get("currency_symbol", "₹"),
        "discount1_pct": d1,
        "discount2_pct": d2,
        "freight_amount": fr,
        "freight_gst_pct": 18,
        "format_version": 2,  # 2 = AMOUNT excl. GST, GST shown by slab after subtotal
        **t,
        "font_size_mode": body.get("font_size_mode", "medium"),
        "quotation_status": "draft",
        "catalogue_status": "not_sent",
        "catalogue_token": str(uuid.uuid4()),
        "lines": lines,
        "bank_details_override": body.get("bank_details_override", ""),
        "terms_override": body.get("terms_override", ""),
        "valid_until": body.get("valid_until", ""),
        "city": body.get("city", ""),
        "state": body.get("state", ""),
        "pincode": body.get("pincode", ""),
        "created_by": user["email"],
        "created_by_name": user.get("name", user["email"]),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.quotations.insert_one(quot_doc)
    try:
        await _auto_register_from_quotation(quot_doc, user["email"])
    except Exception as _e:
        logging.warning(f"Auto-register from quotation failed: {_e}")
    try:
        await _crm_hook_quotation(quot_doc)
    except Exception as _e:
        logging.warning(f"CRM hook for quotation failed: {_e}")
    return await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})


@router.put("/quotations/{quotation_id}")
async def edit_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()

    existing = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0}) or {}

    # Enforce write access (mirrors _get_quotation_for_po): store cannot edit;
    # sales can only edit their own quotations.
    _team = get_team(user)
    if _team == "store":
        raise HTTPException(status_code=403, detail="Store team cannot edit quotations")
    if _team == "sales" and existing.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="Sales can only edit their own quotations")

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
                "font_size_mode", "bank_details_override", "terms_override",
                "valid_until", "city", "state", "pincode"):
        if key in body:
            allowed[key] = body[key]

    if "lines" in allowed:
        lines = allowed["lines"]
        d1 = allowed.get("discount1_pct", existing.get("discount1_pct", 0))
        d2 = allowed.get("discount2_pct", existing.get("discount2_pct", 0))
        fr = allowed.get("freight_amount", existing.get("freight_amount", 0))
        allowed.update(_compute_totals(lines, d1, d2, fr))
        # Editing upgrades the quotation to the new format (AMOUNT excl. GST,
        # GST by slab after subtotal). Un-edited quotations keep their old layout.
        allowed["format_version"] = 2

    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": allowed})
    updated = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    # Ensure lead is linked (handles quotations created before this feature existed)
    if not updated.get("lead_id"):
        try:
            await _auto_register_from_quotation(updated, user["email"])
        except Exception as _e:
            logging.warning(f"Auto-register (edit) failed: {_e}")
    # Fire CRM hook when status changes to sent
    if allowed.get("quotation_status") == "sent":
        try:
            await _crm_hook_quotation(updated)
        except Exception as _e:
            logging.warning(f"CRM hook for quotation edit failed: {_e}")
    return updated


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
    # Enforce write access (mirrors _get_quotation_for_po): store cannot edit;
    # sales can only update their own quotations.
    quot = await db.quotations.find_one(
        {"quotation_id": quotation_id}, {"_id": 0, "sales_person_email": 1}
    )
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    _team = get_team(user)
    if _team == "store":
        raise HTTPException(status_code=403, detail="Store team cannot edit quotations")
    if _team == "sales" and quot.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="Sales can only edit their own quotations")
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"quotation_status": status}},
    )
    return {"message": "Status updated"}


# ==================== PURCHASE ORDER (customer PO against quotation) ====================

_PO_ALLOWED_TYPES = {
    "application/pdf", "image/jpeg", "image/jpg", "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_PO_EXT = {"pdf", "jpg", "jpeg", "png", "doc", "docx"}


async def _get_quotation_for_po(quotation_id: str, user: dict):
    """Fetch the quotation and enforce write access (admin/accounts/sales-owner; not store)."""
    team = get_team(user)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if team == "store":
        raise HTTPException(status_code=403, detail="Store team cannot manage PO documents")
    if team == "sales" and quot.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="Sales can only manage PO for their own quotations")
    return quot


@router.post("/quotations/{quotation_id}/upload-po")
async def upload_quotation_po(quotation_id: str, request: Request,
                              file: UploadFile = File(...),
                              po_number: str = Form(default=""),
                              po_date: str = Form(default="")):
    """Attach the customer's Purchase Order document to a quotation."""
    user = await get_current_user(request)
    await _get_quotation_for_po(quotation_id, user)

    if file.content_type not in _PO_ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: PDF, JPG, PNG, DOC, DOCX")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25 MB)")

    ext = (file.filename or "po.pdf").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "pdf"
    if ext not in _PO_EXT:
        ext = "pdf"
    path = f"quotations/{quotation_id}/po_{uuid.uuid4().hex[:8]}.{ext}"

    from services.storage import save_upload
    url = await save_upload(path, data, file.content_type or "application/pdf", legacy="local")

    form_po_number = (po_number or "").strip()
    form_po_date = (po_date or "").strip()

    now_iso = datetime.now(timezone.utc).isoformat()
    po_doc = {
        "file_id": f"po_{uuid.uuid4().hex[:10]}",
        "filename": file.filename,
        "url": url,
        "content_type": file.content_type,
        "size_bytes": len(data),
        "uploaded_at": now_iso,
        "uploaded_by": user.get("email"),
        "uploaded_by_name": user.get("name", user.get("email")),
    }
    update = {
        "po_document": po_doc,
        "po_status": "uploaded",
        "po_status_updated_at": now_iso,
    }
    if form_po_number:
        update["po_number"] = form_po_number
    if form_po_date:
        update["po_date"] = form_po_date

    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": update})
    return {"po_document": po_doc, "po_status": "uploaded",
            "po_number": form_po_number, "po_date": form_po_date}


@router.put("/quotations/{quotation_id}/po-status")
async def update_quotation_po_status(quotation_id: str, request: Request):
    """Approve/reject an uploaded PO. Admin/Accounts only."""
    user = await get_current_user(request)
    team = get_team(user)
    if team not in ("admin", "accounts"):
        raise HTTPException(status_code=403, detail="Only Admin/Accounts can review PO documents")
    body = await request.json()
    new_status = (body.get("po_status") or "").strip()
    if new_status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="po_status must be 'approved' or 'rejected'")
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0, "po_document": 1})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not quot.get("po_document"):
        raise HTTPException(status_code=400, detail="No PO document uploaded yet")
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {
            "po_status": new_status,
            "po_status_updated_at": datetime.now(timezone.utc).isoformat(),
            "po_notes": (body.get("notes") or "").strip(),
        }},
    )
    return {"message": f"PO {new_status}", "po_status": new_status}


@router.delete("/quotations/{quotation_id}/po")
async def remove_quotation_po(quotation_id: str, request: Request):
    """Remove the attached PO document (metadata reset; file left in storage)."""
    user = await get_current_user(request)
    await _get_quotation_for_po(quotation_id, user)
    await db.quotations.update_one(
        {"quotation_id": quotation_id},
        {"$set": {"po_status": "not_uploaded", "po_status_updated_at": datetime.now(timezone.utc).isoformat()},
         "$unset": {"po_document": "", "po_number": "", "po_date": "", "po_notes": ""}},
    )
    return {"message": "PO removed", "po_status": "not_uploaded"}


@router.delete("/quotations/{quotation_id}")
async def delete_quotation(quotation_id: str, request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team not in ("admin", "accounts"):
        raise HTTPException(status_code=403, detail="Only Admin/Accounts team can delete quotations")

    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0, "quotation_id": 1})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")

    # Block deletion if an order was created from this quotation
    existing_order = await db.orders.find_one({"quotation_id": quotation_id}, {"_id": 0, "order_id": 1})
    if existing_order:
        raise HTTPException(status_code=409, detail="Cannot delete quotation: order exists. Delete the order first.")

    # Cascade: remove catalogue selections and their items
    sel = await db.catalogue_selections.find_one({"quotation_id": quotation_id}, {"_id": 0, "selection_id": 1})
    if sel:
        await db.catalogue_selection_items.delete_many({"catalogue_selection_id": sel["selection_id"]})
        await db.catalogue_selections.delete_one({"quotation_id": quotation_id})

    # Remove edit history
    await db.quotation_edit_history.delete_many({"quotation_id": quotation_id})

    await db.quotations.delete_one({"quotation_id": quotation_id})
    return {"message": "Quotation and related catalogue data deleted"}


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
        "catalogue_token": str(uuid.uuid4()),
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

    now_iso = datetime.now(timezone.utc).isoformat()
    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": now_iso,
                "catalogue_sent_by": user["email"],
                "catalogue_sent_by_name": user.get("name", user["email"]),
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

    now_iso = datetime.now(timezone.utc).isoformat()
    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": now_iso,
                "catalogue_sent_by": user["email"],
                "catalogue_sent_by_name": user.get("name", user["email"]),
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
    sender_name = email_settings.get("sender_name", "Divine Computers Private Limited") if email_settings else "Divine Computers Private Limited"
    if not sender_email or not app_password:
        raise ValueError("Email credentials not configured. Go to Settings → Email and enter your Gmail address and App Password.")
    return sender_email, app_password, sender_name


def _build_cc_set(sender_email: str, customer_email, cc_emails=None, sp_email=None):
    # customer_email may be a single address OR a list of To addresses.
    # Seed `seen` with the sender plus EVERY To address so a recipient is never Cc'd too.
    if isinstance(customer_email, (list, tuple, set)):
        to_addrs = customer_email
    else:
        to_addrs = [customer_email]
    seen = {sender_email.lower()}
    for addr in to_addrs:
        if addr:
            seen.add(addr.lower())
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

    cc_set = _build_cc_set(sender_email, all_to, cc_emails, quot.get("sales_person_email"))

    # ── Generate quotation PDF to attach ───────────────────────────────────────
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    pdf_bytes = None
    pdf_filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"
    try:
        pdf_bytes = await _generate_pdf_bytes(quot, company)
    except Exception as _pdf_err:
        logging.warning(f"PDF generation for email attachment failed: {_pdf_err}")

    # ── HTML email body ────────────────────────────────────────────────────────
    school_name  = quot.get('school_name', '')
    quote_number = quot.get('quote_number', '')
    subject      = f"{school_name} & {quote_number} Quotation Attached – A Smarter Way to Create Engaging Classrooms"
    sp_name      = quot.get('sales_person_name', 'Sales Team')
    sp_email_val = quot.get('sales_person_email', '')
    package_name = quot.get('package_name', '')

    # Fetch logo from company settings
    frontend_url = os.environ.get("FRONTEND_URL", "https://app.smartshape.in")
    logo_raw     = company.get('logo_url', '')
    if logo_raw.startswith('/'):
        logo_img_url = frontend_url.rstrip('/') + logo_raw
    elif logo_raw:
        logo_img_url = logo_raw
    else:
        logo_img_url = ""

    # Logo HTML block — image if available, bold text fallback
    if logo_img_url:
        logo_block = f'<img src="{logo_img_url}" alt="SMARTS-SHAPES" style="max-height:72px;max-width:260px;width:auto;display:block;margin:0 auto;" />'
    else:
        logo_block = '<span style="font-size:28px;font-weight:900;color:#e94560;letter-spacing:1px;">SMARTS&#8209;SHAPES</span>'

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>SMARTS-SHAPES Quotation</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:28px 16px;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0"
         style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">

    <!-- Accent bar -->
    <tr><td style="background:#e94560;height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>

    <!-- Header — white with logo -->
    <tr>
      <td style="background:#ffffff;padding:32px 40px 20px;text-align:center;border-bottom:1px solid #f0f0f0;">
        {logo_block}
        <p style="margin:14px 0 0;font-size:13px;color:#888888;letter-spacing:0.3px;">A smarter way to create engaging classrooms</p>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:36px 40px 28px;">

        <p style="margin:0 0 20px;font-size:16px;color:#222222;font-weight:700;">Dear Principal,</p>

        <p style="margin:0 0 22px;font-size:15px;color:#444444;line-height:1.8;">
          Thank you for your time and interest in <strong style="color:#e94560;">SMARTS-SHAPES</strong>.
          Please find your personalized quotation attached to this email.
        </p>

        <!-- About box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          <tr>
            <td style="background:#fff5f7;border-left:5px solid #e94560;border-radius:0 8px 8px 0;padding:18px 20px;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#e94560;">About SMARTS-SHAPES Die-Cutting Machine</p>
              <p style="margin:0;font-size:14px;color:#333333;line-height:1.75;">
                Our zero-maintenance die-cutting machine empowers teachers to create stunning classroom decorations,
                teaching aids, and learning materials in minutes — saving up to <strong>80% of preparation time</strong>
                while delivering consistent, professional results every time.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 14px;font-size:15px;color:#444444;line-height:1.75;">Schools across India are using SMARTS-SHAPES to:</p>
        <ul style="margin:0 0 26px;padding-left:20px;font-size:14px;color:#444444;line-height:2.1;">
          <li>Create <strong>experiential learning environments</strong> without extra effort</li>
          <li><strong>Reduce decoration costs</strong> by up to 60% compared to outsourcing</li>
          <li>Promote <strong>sustainability</strong> with reusable, long-lasting dies</li>
          <li>Build <strong>visually enriched classrooms</strong> that students love</li>
        </ul>

        <!-- Quotation card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
          <tr>
            <td style="background:#fafafa;border:1px solid #eeeeee;border-top:3px solid #e94560;border-radius:8px;padding:18px 22px;">
              <p style="margin:0 0 6px;font-size:11px;color:#aaaaaa;text-transform:uppercase;letter-spacing:0.8px;">Quotation Prepared For</p>
              <p style="margin:0 0 6px;font-size:19px;font-weight:800;color:#1a1a1a;">{school_name}</p>
              <p style="margin:0;font-size:13px;color:#666666;">{package_name}{'&nbsp;&nbsp;•&nbsp;&nbsp;' if package_name else ''}Quote No: <strong style="color:#e94560;">{quote_number}</strong></p>
            </td>
          </tr>
        </table>

        <!-- Investment highlight -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">
          <tr>
            <td style="background:#fff5f7;border-left:5px solid #e94560;border-radius:0 8px 8px 0;padding:16px 20px;">
              <p style="margin:0;font-size:14px;color:#1a1a1a;line-height:1.75;">
                <strong style="color:#e94560;">SMARTS-SHAPES</strong> is a long-term investment in your school's future —
                boosting <strong>teacher efficiency</strong>, enhancing <strong>student engagement</strong>,
                and strengthening your <strong>school's brand</strong> as a forward-thinking institution.
              </p>
            </td>
          </tr>
        </table>

        <!-- CTA: View Catalogue -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
          <tr>
            <td align="center">
              <a href="{catalogue_url}"
                 style="display:inline-block;background:#e94560;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:15px 44px;border-radius:6px;letter-spacing:0.3px;">
                View Your Personalised Catalogue
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 4px;font-size:12px;color:#aaaaaa;text-align:center;">Or copy this catalogue link:</p>
        <p style="margin:0 0 28px;text-align:center;">
          <a href="{catalogue_url}" style="color:#e94560;font-size:11px;word-break:break-all;">{catalogue_url}</a>
        </p>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
          <tr><td style="border-top:1px solid #eeeeee;"></td></tr>
        </table>

        <!-- Terms -->
        <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#333333;">Terms &amp; Conditions:</p>
        <ul style="margin:0 0 26px;padding-left:18px;font-size:13px;color:#555555;line-height:2.0;">
          <li>Prices are valid for 30 days from the date of this quotation.</li>
          <li>Delivery within 7–10 working days after order confirmation.</li>
          <li>50% advance payment required to confirm the order.</li>
          <li>GST applicable as per prevailing government norms.</li>
        </ul>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
          <tr><td style="border-top:1px solid #eeeeee;"></td></tr>
        </table>

        <!-- Signature -->
        <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#1a1a1a;">{sp_name}</p>
        <p style="margin:0 0 2px;font-size:13px;color:#666666;">Sales Executive, SMARTS-SHAPES</p>
        <p style="margin:0;font-size:13px;color:#666666;">{sp_email_val}</p>

      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:#1a1a2e;padding:22px 40px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:rgba(255,255,255,0.75);line-height:1.6;font-weight:600;">
          SMARTS-SHAPES | Empowering Teachers. Engaging Students. Building Creative Schools.
        </p>
        <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.4);">
          This email was sent on behalf of {sp_name}. Please do not reply directly to this email.
        </p>
      </td>
    </tr>

    <!-- Bottom accent bar -->
    <tr><td style="background:#e94560;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

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
    cc_set = _build_cc_set(sender_email, all_to, all_cc_inputs, quot.get("sales_person_email"))

    gst = quot.get("gst_amount", 0)
    freight = quot.get("freight_with_gst", quot.get("freight_total", 0))
    grand = quot.get("grand_total", 0)
    lines = quot.get("lines", [])
    line_summary = "\n".join(
        f"  • {l.get('description', 'Item')}  Qty: {l.get('qty', 1)}  ₹{l.get('line_subtotal', l.get('qty', 1) * l.get('unit_price', 0)):,.0f}"
        for l in lines
    )
    freight_line = f"Freight      : ₹{freight:,.0f}\n" if freight else ""

    salutation = quot.get("principal_name", "") or "Sir/Ma'am"
    frontend_url_q = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_token = quot.get("catalogue_token", "")
    if not catalogue_token:
        catalogue_token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {"catalogue_token": catalogue_token}},
        )
    portal_url = f"{frontend_url_q}/catalogue/{catalogue_token}"

    # Fetch company settings for logo
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    logo_raw = company.get("logo_url", "")
    if logo_raw and logo_raw.startswith("/"):
        logo_full_url = frontend_url_q.rstrip("/") + logo_raw
    else:
        logo_full_url = logo_raw or ""

    sp_name = quot.get("sales_person_name", "") or "SMARTS-SHAPES Team"
    sp_email = quot.get("sales_person_email", "")
    sp_phone = quot.get("sales_person_phone", "") or quot.get("contact_phone", "")
    sp_desig = quot.get("sales_person_designation", "Sales Representative")
    quote_num = quot.get("quote_number", "")
    school_nm = quot.get("school_name", "")

    # Auto-detect Custom Package: compare actual line qtys to package defaults
    package_doc = None
    if quot.get("package_id"):
        package_doc = await db.packages.find_one({"package_id": quot["package_id"]}, {"_id": 0})
    _std_line   = next((l for l in lines if "standard die" in l.get("description","").lower()), None)
    _large_line = next((l for l in lines if "large die"    in l.get("description","").lower()), None)
    _std_qty    = _std_line["qty"]   if _std_line   else 0
    _large_qty  = _large_line["qty"] if _large_line else 0
    _is_custom  = package_doc and (
        (_std_qty   > 0 and _std_qty   != package_doc.get("std_die_qty",   0)) or
        (_large_qty > 0 and _large_qty != package_doc.get("large_die_qty", 0))
    )
    pkg_name = "Custom Package" if _is_custom else (quot.get("package_name", "") or "Custom Package")

    # Build items rows HTML. New format (v2): AMOUNT = qty × rate (excl. GST),
    # GST shown by slab below. Legacy: AMOUNT incl. GST, single GST line.
    is_new_fmt_email = quot.get("format_version", 1) >= 2
    items_rows_html = ""
    for ln in lines:
        if is_new_fmt_email:
            amount = ln.get("line_subtotal", ln.get("qty", 1) * ln.get("unit_price", 0))
        else:
            amount = ln.get("line_total", 0)
        items_rows_html += (
            f'<tr>'
            f'<td style="padding:8px 10px; font-size:14px; color:#333; border-bottom:1px solid #e8ecf0;">{ln.get("description","Item")}</td>'
            f'<td style="padding:8px 10px; font-size:14px; color:#333; border-bottom:1px solid #e8ecf0; text-align:center;">{ln.get("qty",1)}</td>'
            f'<td style="padding:8px 10px; font-size:14px; color:#333; border-bottom:1px solid #e8ecf0; text-align:right;">&#8377;{amount:,.0f}</td>'
            f'</tr>'
        )
    if not items_rows_html:
        items_rows_html = '<tr><td colspan="3" style="padding:10px; color:#888; font-size:13px; text-align:center;">—</td></tr>'

    # GST rows — by rate slab (v2) or single legacy line
    gst_rows_html = ""
    if is_new_fmt_email:
        gst_breakup = quot.get("gst_breakup")
        if not gst_breakup:
            gst_breakup = [{"rate": 18, "amount": gst}] if gst else []
        for slab in gst_breakup:
            rate = slab.get("rate", 18)
            rate_lbl = f"{int(rate)}" if rate == int(rate) else f"{rate}"
            gst_rows_html += (
                f'<tr style="background:#fdf6f7;">'
                f'<td style="padding:7px 16px; font-size:13px; color:#777;">GST @ {rate_lbl}%</td><td></td>'
                f'<td style="padding:7px 16px; font-size:13px; color:#777; text-align:right;">&#8377;{slab.get("amount",0):,.0f}</td>'
                f'</tr>'
            )
    else:
        gst_rows_html = (
            f'<tr style="background:#fdf6f7;">'
            f'<td style="padding:7px 16px; font-size:13px; color:#777;">GST (18%)</td><td></td>'
            f'<td style="padding:7px 16px; font-size:13px; color:#777; text-align:right;">&#8377;{gst:,.0f}</td>'
            f'</tr>'
        )

    freight_row_html = ""
    if freight:
        freight_row_html = f'<tr><td style="padding:6px 10px; font-size:13px; color:#555;">Freight</td><td></td><td style="padding:6px 10px; font-size:13px; color:#555; text-align:right;">&#8377;{freight:,.0f}</td></tr>'

    logo_html = (
        f'<img src="{logo_full_url}" alt="SMARTS-SHAPES" height="68" style="display:block; margin:0 auto;" />'
        if logo_full_url else
        '<span style="font-size:28px; font-weight:900; color:#e94560; letter-spacing:1px;">SMARTS&#x2733;SHAPES</span>'
    )

    subject = f"Quotation {quote_num} – SMARTS-SHAPES"
    html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>SMARTS-SHAPES Quotation</title></head>
<body style="margin:0; padding:0; background:#f5f5f7; font-family:Arial, sans-serif; color:#222;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7; padding:28px 0;">
  <tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 28px rgba(0,0,0,0.10);">

      <!-- TOP ACCENT BAR -->
      <tr><td style="background:#e94560; height:5px; font-size:0; line-height:0;">&nbsp;</td></tr>

      <!-- HEADER — white bg, logo centred -->
      <tr>
        <td style="background:#ffffff; padding:32px 36px 20px; text-align:center;">
          {logo_html}
          <p style="margin:14px 0 0; font-size:14px; color:#e94560; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;">
            A smarter way to create engaging classrooms
          </p>
        </td>
      </tr>

      <!-- DIVIDER -->
      <tr><td style="padding:0 36px;"><div style="border-top:1px solid #f0e0e4;"></div></td></tr>

      <!-- BODY -->
      <tr>
        <td style="padding:28px 36px 8px;">
          <p style="font-size:16px; margin-top:0; color:#222;">Dear {salutation},</p>
          <p style="font-size:15px; line-height:1.75; color:#444;">
            Greetings from <strong style="color:#e94560;">SMARTS-SHAPES</strong>.
          </p>
          <p style="font-size:15px; line-height:1.75; color:#444;">
            Thank you for your interest. Please find the <strong>quotation PDF attached</strong> for your reference.
          </p>
        </td>
      </tr>

      <!-- QUOTE SUMMARY CARD -->
      <tr>
        <td style="padding:0 36px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0d8dc; border-radius:10px; overflow:hidden;">
            <tr>
              <td colspan="3" style="background:#e94560; padding:11px 16px;">
                <span style="color:#ffffff; font-size:14px; font-weight:700; letter-spacing:0.3px;">
                  Quotation Summary &nbsp;·&nbsp; {quote_num}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 16px; font-size:13px; color:#777; width:38%;">School</td>
              <td colspan="2" style="padding:10px 16px; font-size:13px; color:#111; font-weight:700;">{school_nm}</td>
            </tr>
            <tr style="background:#fdf6f7;">
              <td style="padding:7px 16px; font-size:13px; color:#777;">Package</td>
              <td colspan="2" style="padding:7px 16px; font-size:13px; color:#333;">{pkg_name}</td>
            </tr>
            <tr>
              <td colspan="3" style="padding:0;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr style="background:#fdf0f2;">
                    <th style="padding:8px 16px; font-size:12px; color:#e94560; text-align:left; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Item</th>
                    <th style="padding:8px 10px; font-size:12px; color:#e94560; text-align:center; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Qty</th>
                    <th style="padding:8px 16px; font-size:12px; color:#e94560; text-align:right; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">Amount</th>
                  </tr>
                  {items_rows_html}
                  {gst_rows_html}
                  {freight_row_html}
                  <tr style="background:#e94560;">
                    <td style="padding:12px 16px; font-size:15px; font-weight:800; color:#fff;">Total Payable</td>
                    <td></td>
                    <td style="padding:12px 16px; font-size:15px; font-weight:800; color:#fff; text-align:right;">&#8377;{grand:,.0f}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- BODY CONT -->
      <tr>
        <td style="padding:0 36px 8px;">
          <!-- PRODUCT DESCRIPTION BOX -->
          <div style="background:#fff5f7; border-left:5px solid #e94560; padding:18px 20px; margin:6px 0 20px; border-radius:8px;">
            <p style="margin:0; font-size:15px; line-height:1.75; color:#2a1a1e;">
              <strong>SMARTS-SHAPES</strong> is a zero-maintenance manual cutting machine that helps teachers create teaching aids, classroom décor, student projects, and activity-based learning materials in minutes — while saving up to <strong>80% of preparation time</strong>.
            </p>
          </div>

          <p style="font-size:15px; line-height:1.75; color:#444;">
            Schools are using SMARTS-SHAPES to promote experiential learning, reduce recurring decoration and craft costs, encourage sustainability through reuse of materials, and create visually engaging classrooms that parents truly appreciate.
          </p>

          <!-- INVESTMENT BOX -->
          <div style="background:#fff8ec; border-left:5px solid #f5a623; padding:18px 20px; margin:4px 0 20px; border-radius:8px;">
            <p style="margin:0; font-size:15px; line-height:1.75; color:#3a2800;">
              In today's competitive educational landscape, SMARTS-SHAPES is more than just a classroom tool — it is a long-term investment in <strong>teacher efficiency, student engagement, and your school's innovative brand identity.</strong>
            </p>
          </div>

          <p style="font-size:15px; line-height:1.75; color:#444;">
            To help us recommend the most suitable dies for your school, kindly explore and select your preferred designs using your personalised catalogue:
          </p>
        </td>
      </tr>

      <!-- CTA BUTTON -->
      <tr>
        <td style="padding:4px 36px 6px;" align="center">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="border-radius:9px; background:#e94560;">
                <a href="{portal_url}" target="_blank"
                   style="display:inline-block; background:#e94560; color:#ffffff; text-decoration:none; font-size:15px; font-weight:700; padding:15px 40px; border-radius:9px; letter-spacing:0.4px;">
                  &#127873;&nbsp; View Your Personalised Catalogue
                </a>
              </td>
            </tr>
          </table>
          <p style="font-size:12px; color:#bbb; margin:10px 0 0; text-align:center;">
            Or copy: <a href="{portal_url}" style="color:#e94560; text-decoration:none;">{portal_url}</a>
          </p>
        </td>
      </tr>

      <!-- CLOSING -->
      <tr>
        <td style="padding:18px 36px 28px;">
          <p style="font-size:15px; line-height:1.75; color:#444;">
            Once submitted, our team will connect with you to discuss how SMARTS-SHAPES can be best utilised for your classrooms, activities, events, and learning goals.
          </p>
          <p style="font-size:15px; line-height:1.75; color:#444;">
            We look forward to partnering with your institution.
          </p>

          <!-- DIVIDER -->
          <div style="border-top:1px solid #f0e0e4; margin:20px 0;"></div>

          <!-- SIGNATURE -->
          <p style="font-size:15px; line-height:1.9; color:#333; margin:0;">
            Warm Regards,<br>
            <strong style="color:#e94560; font-size:16px;">{sp_name}</strong><br>
            <span style="color:#666; font-size:13px;">{sp_desig + " · " if sp_desig else ""}SMARTS-SHAPES</span><br>
            {(f'<a href="tel:{sp_phone}" style="color:#e94560; text-decoration:none; font-size:13px;">{sp_phone}</a><br>') if sp_phone else ""}
            {(f'<a href="mailto:{sp_email}" style="color:#e94560; text-decoration:none; font-size:13px;">{sp_email}</a>') if sp_email else ""}
          </p>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#1a1a2e; color:#ffffff; text-align:center; padding:18px 24px; font-size:13px; line-height:1.7; border-radius:0 0 16px 16px;">
          <span style="color:#e94560; font-weight:700;">SMARTS-SHAPES</span><br>
          <span style="opacity:0.75;">Empowering Teachers &nbsp;·&nbsp; Engaging Students &nbsp;·&nbsp; Building Creative Schools</span><br>
          <span style="opacity:0.45; font-size:11px;">This email and its attachments are confidential and intended solely for the addressee.</span>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>"""

    # Generate PDF bytes
    try:
        pdf_bytes = await _generate_pdf_bytes(quot, company)
    except Exception as pdf_err:
        logging.error(f"PDF generation error for {quotation_id}: {pdf_err}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(pdf_err)}")

    filename = f"Quotation_{quot.get('quote_number', quotation_id)}.pdf"

    try:
        msg = MIMEMultipart("mixed")
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = ", ".join(all_to)
        if cc_set:
            msg["Cc"] = ", ".join(cc_set)
        msg["Subject"] = subject

        # HTML body
        alt = MIMEMultipart("alternative")
        plain_fallback = (
            f"Dear {salutation},\n\nPlease find your SMARTS-SHAPES quotation attached.\n\n"
            f"Quote: {quote_num} | School: {school_nm} | Total: ₹{grand:,.0f}\n\n"
            f"View catalogue: {portal_url}\n\nWarm Regards,\n{sp_name}"
        )
        alt.attach(MIMEText(plain_fallback, "plain", "utf-8"))
        alt.attach(MIMEText(html_body, "html", "utf-8"))
        msg.attach(alt)

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
    # Only show products whose product type is published to schools. Legacy products
    # with no product_type_id are treated as the built-in (visible) "Dies" type.
    visible_type_ids = {t["product_type_id"] async for t in db.product_types.find(
        {"visible_to_schools": True, "is_active": {"$ne": False}}, {"product_type_id": 1, "_id": 0})}
    visible_type_ids.add("ptype_dies")
    dies = [gate_die_for_customer(d) for d in dies
            if d.get("product_type_id", "ptype_dies") in visible_type_ids]

    # Attach company logo for catalogue header
    company_s = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    logo_raw = company_s.get("logo_url", "")
    fe_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    logo_url = (fe_url + logo_raw) if logo_raw.startswith("/") else logo_raw

    return {"quotation": quot, "package": package, "dies": dies, "logo_url": logo_url}


@router.post("/catalogue/{token}/submit")
async def submit_catalogue_selection(token: str, request: Request):
    body = await request.json()
    # Accept either the new per-die-quantity payload `selections: [{die_id, quantity}]`
    # or the legacy `selected_dies: [die_id, ...]` (treated as quantity 1 each).
    raw_selections = body.get("selections")
    if raw_selections is None:
        raw_selections = [{"die_id": d, "quantity": 1} for d in body.get("selected_dies", [])]

    # Normalize + collapse duplicate die_ids into a single line with summed quantity.
    qty_by_die = {}
    for sel in raw_selections:
        die_id = sel.get("die_id") if isinstance(sel, dict) else sel
        if not die_id:
            continue
        qty = int(sel.get("quantity", 1) or 1) if isinstance(sel, dict) else 1
        qty = max(1, qty)
        qty_by_die[die_id] = qty_by_die.get(die_id, 0) + qty

    quot = await db.quotations.find_one({"catalogue_token": token}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Catalogue not found")
    if quot.get("catalogue_status") == "submitted":
        raise HTTPException(status_code=409, detail="This catalogue has already been submitted.")

    selection_id = f"sel_{uuid.uuid4().hex[:12]}"
    selection_doc = {
        "selection_id": selection_id,
        "quotation_id": quot["quotation_id"],
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "customer_ip": request.client.host if request.client else "unknown",
    }
    await db.catalogue_selections.insert_one(selection_doc)

    for die_id, qty in qty_by_die.items():
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
        if die:
            await db.catalogue_selection_items.insert_one({
                "catalogue_selection_id": selection_id,
                "die_id": die_id,
                "die_name": die["name"],
                "die_code": die["code"],
                "die_type": die["type"],
                "die_image_url": die.get("image_url"),
                "quantity": qty,
            })
            # Reserve the real quantity the customer asked for (was a +1 bug).
            await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": qty}})
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

    # Auto-generate the Sales Order from the submitted selection (toggle-controlled,
    # default ON). Idempotent + non-blocking: a failure must never break submission.
    auto_order = None
    try:
        notif = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
        if notif.get("auto_create_so_on_submit", True):
            from routes.order_routes import create_order_for_quotation
            order, created = await create_order_for_quotation(
                quot["quotation_id"], created_by="system", source="catalogue_submit",
            )
            if created:
                auto_order = {"order_id": order["order_id"], "order_number": order["order_number"]}
                logging.info(f"Auto-created order {order['order_number']} from catalogue {selection_id}")
    except Exception as e:
        logging.error(f"Auto SO creation failed for {quot.get('quotation_id')}: {e}")

    return {"message": "Selection submitted successfully", "order": auto_order}


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

    SYM = quot.get("currency_symbol", "₹")  # used as-is — Unicode font handles all symbols

    # ── Register Unicode fonts (DejaVu covers ₹ $ € £ ¥ ₩ and all others) ──────
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        _DEJAVU_PATHS = [
            ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',     'DejaVuSans'),
            ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','DejaVuSans-Bold'),
        ]
        for _path, _name in _DEJAVU_PATHS:
            if _name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(_name, _path))
        _FONT  = 'DejaVuSans'
        _FONTB = 'DejaVuSans-Bold'
    except Exception:
        _FONT  = 'Helvetica'
        _FONTB = 'Helvetica-Bold'

    S = getSampleStyleSheet()
    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))

    ps('CoName',  fontSize=sz(14), leading=sz(18), fontName=_FONTB, textColor=NAVY)
    ps('CoSub',   fontSize=sz(7.5),leading=sz(10.5),fontName=_FONT,  textColor=GRAY)
    ps('QTitle',  fontSize=sz(24), leading=sz(28), fontName=_FONTB, textColor=BRAND, alignment=TA_RIGHT, wordWrap='CJK')
    ps('QNum',    fontSize=sz(9.5),leading=sz(12.5),fontName=_FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('QDate',   fontSize=sz(7.5),leading=sz(10),  fontName=_FONT,  textColor=GRAY, alignment=TA_RIGHT)
    ps('SectLbl', fontSize=sz(6.5),leading=sz(8.5), fontName=_FONTB, textColor=BRAND, spaceAfter=1)
    ps('InfoKey', fontSize=sz(7),  leading=sz(9.5), fontName=_FONT,  textColor=GRAY)
    ps('InfoVal', fontSize=sz(8.5),leading=sz(11),  fontName=_FONTB, textColor=NAVY)
    ps('BillBig', fontSize=sz(11), leading=sz(14),  fontName=_FONTB, textColor=NAVY)
    ps('BillMed', fontSize=sz(8.5),leading=sz(11),  fontName=_FONT,  textColor=NAVY)
    ps('BillSub', fontSize=sz(7.5),leading=sz(10),  fontName=_FONT,  textColor=GRAY)
    ps('TblHdrC', fontSize=sz(7.5),leading=sz(9.5), fontName=_FONTB, textColor=WHITE, alignment=TA_CENTER)
    ps('TblHdrR', fontSize=sz(7.5),leading=sz(9.5), fontName=_FONTB, textColor=WHITE, alignment=TA_RIGHT)
    ps('TblHdrL', fontSize=sz(7.5),leading=sz(9.5), fontName=_FONTB, textColor=WHITE)
    ps('TblL',    fontSize=sz(8.5),leading=sz(10.5),fontName=_FONT,  textColor=NAVY)
    ps('TblC',    fontSize=sz(8.5),leading=sz(10.5),fontName=_FONT,  textColor=NAVY, alignment=TA_CENTER)
    ps('TblR',    fontSize=sz(8.5),leading=sz(10.5),fontName=_FONT,  textColor=NAVY, alignment=TA_RIGHT)
    ps('TblRB',   fontSize=sz(9),  leading=sz(11),  fontName=_FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('TblGst',  fontSize=sz(8),  leading=sz(10),  fontName=_FONT,  textColor=GRAY, alignment=TA_CENTER)
    ps('SumLbl',  fontSize=sz(8.5),leading=sz(11),  fontName=_FONT,  textColor=GRAY)
    ps('SumVal',  fontSize=sz(8.5),leading=sz(11),  fontName=_FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('SumGrn',  fontSize=sz(8.5),leading=sz(11),  fontName=_FONT,  textColor=GREEN, alignment=TA_RIGHT)
    ps('SubLbl',  fontSize=sz(9),  leading=sz(12),  fontName=_FONTB, textColor=NAVY)
    ps('SubVal',  fontSize=sz(9),  leading=sz(12),  fontName=_FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('GstLbl',  fontSize=sz(8.5),leading=sz(11),  fontName=_FONT,  textColor=DKGRAY)
    ps('GstVal',  fontSize=sz(8.5),leading=sz(11),  fontName=_FONT,  textColor=DKGRAY, alignment=TA_RIGHT)
    ps('GrandL',  fontSize=sz(11), leading=sz(14),  fontName=_FONTB, textColor=WHITE)
    ps('GrandR',  fontSize=sz(13.5),leading=sz(17), fontName=_FONTB, textColor=WHITE, alignment=TA_RIGHT)
    ps('Bold8',   fontSize=sz(8.5),leading=sz(11),  fontName=_FONTB, textColor=NAVY)
    ps('Tiny',    fontSize=sz(7),  leading=sz(9.5), fontName=_FONT,  textColor=GRAY)
    ps('SigLbl',  fontSize=sz(7.5),leading=sz(10),  fontName=_FONT,  textColor=GRAY, alignment=TA_RIGHT)
    ps('SigCo',   fontSize=sz(9),  leading=sz(12),  fontName=_FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('FootNote',fontSize=sz(7),  leading=sz(9),   fontName=_FONT,  textColor=GRAY, alignment=TA_CENTER)

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
                rel_path = logo_url.replace("/api/files/", "", 1)
                local_path = os.path.join(UPLOADS_DIR, rel_path)
                if os.path.isfile(local_path):
                    with open(local_path, "rb") as _f:
                        img_bytes = _f.read()
            elif logo_url.startswith("http://") or logo_url.startswith("https://"):
                r = requests.get(logo_url, timeout=15)
                if r.ok: img_bytes = r.content
            if img_bytes:
                ir = ImageReader(_io.BytesIO(img_bytes))
                iw, ih = ir.getSize()
                MAX_LOGO_W, MAX_LOGO_H = 54 * mm, 22 * mm   # bigger logo
                if iw and ih:
                    logo_scale = min(MAX_LOGO_W / iw, MAX_LOGO_H / ih)
                    tw = min(iw * logo_scale, MAX_LOGO_W)
                    th = min(ih * logo_scale, MAX_LOGO_H)
                else:
                    tw, th = 36 * mm, 18 * mm
                tw = min(tw, MAX_LOGO_W)
                th = min(th, MAX_LOGO_H)
                logo_image = RLImage(_io.BytesIO(img_bytes), width=tw, height=th)
                logo_image.drawWidth  = tw
                logo_image.drawHeight = th
        except Exception as _e:
            logging.warning(f"PDF logo load failed: {_e}")

    # ── Company data ───────────────────────────────────────────────────────────
    co_name  = company.get("company_name", "Divine Computers Private Limited")
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

    # Right column must fit "QUOTATION" at 24pt bold on a single line — 68mm ≈ 193pt is safe
    col_right = 68 * mm
    col_logo  = 56 * mm if logo_image else 0
    col_left  = 182 * mm - col_logo - col_right
    if logo_image:
        hdr = Table([[logo_image, left_co, right_co]],
                    colWidths=[col_logo, col_left, col_right])
        hdr.setStyle(TableStyle([
            ('VALIGN', (0, 0), (0, 0), 'MIDDLE'),
            ('VALIGN', (1, 0), (1, 0), 'MIDDLE'),
            ('VALIGN', (2, 0), (2, 0), 'TOP'),
            ('LEFTPADDING',  (0,0),(-1,-1), 0),
            ('RIGHTPADDING', (0,0),(-1,-1), 0),
            ('TOPPADDING',   (0,0),(-1,-1), 0),
            ('BOTTOMPADDING',(0,0),(-1,-1), 0),
        ]))
    else:
        hdr = Table([[left_co, right_co]], colWidths=[114*mm, col_right])
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
    # format_version >= 2: AMOUNT = qty × rate (excl. GST); GST shown by slab in
    # the summary. Older quotations keep the legacy per-item GST % + incl-GST layout.
    lines = quot.get("lines", [])
    is_new_fmt = quot.get("format_version", 1) >= 2

    rate_hdr  = f"RATE ({SYM})"
    amt_hdr   = f"AMOUNT ({SYM})"

    if is_new_fmt:
        # Sr(8) + Description(100) + Qty(12) + Rate(28) + Amount(34) = 182 mm
        cw = [8*mm, 100*mm, 12*mm, 28*mm, 34*mm]
        tbl_data = [[
            Paragraph("SR",          S['TblHdrC']),
            Paragraph("DESCRIPTION", S['TblHdrL']),
            Paragraph("QTY",         S['TblHdrC']),
            Paragraph(rate_hdr,      S['TblHdrR']),
            Paragraph(amt_hdr,       S['TblHdrR']),
        ]]
        for i, l in enumerate(lines):
            amount = l.get("line_subtotal", l.get("qty", 0) * l.get("unit_price", 0))
            tbl_data.append([
                Paragraph(str(i + 1),                                 S['TblC']),
                Paragraph(l.get("description", ""),                   S['TblL']),
                Paragraph(str(l.get("qty", 0)),                       S['TblC']),
                Paragraph(f"{l.get('unit_price', 0):,.0f}",           S['TblR']),
                Paragraph(f"<b>{amount:,.0f}</b>",                    S['TblRB']),
            ])
    else:
        # Legacy: Sr(8) + Description(85) + Qty(12) + Rate(28) + GST%(15) + Amount(34)
        cw = [8*mm, 85*mm, 12*mm, 28*mm, 15*mm, 34*mm]
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
                Paragraph(str(i + 1),                                 S['TblC']),
                Paragraph(l.get("description", ""),                   S['TblL']),
                Paragraph(str(l.get("qty", 0)),                       S['TblC']),
                Paragraph(f"{l.get('unit_price', 0):,.0f}",           S['TblR']),
                Paragraph(gst_label,                                   S['TblGst']),
                Paragraph(f"<b>{l.get('line_total', 0):,.0f}</b>",    S['TblRB']),
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

    if is_new_fmt:
        # GST shown by rate slab (single line in the all-18% case)
        gst_breakup = quot.get("gst_breakup")
        if not gst_breakup:
            gst_breakup = [{"rate": 18, "amount": gst_amount}] if gst_amount else []
        for slab in gst_breakup:
            rate = slab.get("rate", 18)
            rate_lbl = f"{int(rate)}" if rate == int(rate) else f"{rate}"
            sum_rows.append((Paragraph(f"GST @ {rate_lbl}%", S['GstLbl']),
                             Paragraph(fc(slab.get("amount", 0)), S['GstVal'])))
    else:
        sum_rows.append((Paragraph("GST", S['GstLbl']),
                         Paragraph(fc(gst_amount), S['GstVal'])))

    # Round off Total Payable to the nearest rupee (standard on Indian invoices)
    rounded_gt = round(gt)
    round_off  = rounded_gt - gt
    if abs(round_off) >= 0.005:
        sign = "+" if round_off >= 0 else "&#8722;"
        sum_rows.append((Paragraph("Round Off", S['SumLbl']),
                         Paragraph(f"{sign} {fc(abs(round_off))}", S['SumVal'])))

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
        Paragraph(f"{SYM} {rounded_gt:,.0f}", S['GrandR']),
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
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            # Always regenerate — the PDF is built live from the latest data, so
            # never let the browser serve a stale cached copy (no manual refresh).
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )
