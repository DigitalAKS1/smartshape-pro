from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── 15 expert B2B school WhatsApp message templates ───────────────────────────
_DEFAULT_TEMPLATES = [
    # INTRO — first-touch messages per designation
    {
        "name": "Principal First Touch",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Namaskar {name} ji! 🙏 I'm from SmartShape — India's premium craft materials "
            "brand for schools. We supply everything from clay and colours to 3D die sets "
            "and activity kits to 500+ schools across India. I'd love to share our catalogue "
            "and special school pricing with you. May I? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Teacher First Touch",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Hello {name}! 👋 I'm reaching out from SmartShape — we specialise in school-grade "
            "craft materials that make art & craft activities more engaging, mess-free and "
            "curriculum-aligned. Our products are trusted by teachers across CBSE, ICSE and "
            "State Board schools. Can I share our latest collection? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Purchase Head Introduction",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🙏 I'm from SmartShape — your one-stop supplier for school craft "
            "materials. We offer competitive bulk pricing, pan-India delivery, GST invoices, "
            "and dedicated account support. I'd love to send our school pricing catalogue. "
            "Shall I? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # CATALOGUE — product showcase messages
    {
        "name": "Annual Catalogue Launch",
        "category": "catalogue",
        "variables": ["name"],
        "body": (
            "Hello {name}! 📚 Our 2026 School Craft Catalogue is here! ✂️🎨 New this year: "
            "3D activity die sets, eco-friendly clay, jumbo size chart sets, and our bestselling "
            "finger paint kits — all school-grade tested. Want me to share the full PDF catalogue? "
            "— SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "New Product Showcase",
        "category": "catalogue",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🌟 Exciting news from SmartShape! We've just launched our new range of "
            "EVA Foam Die Cuts — 200+ shapes perfect for art class, bulletin boards, and project "
            "work. Schools love them! Would you like samples sent to your school? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },

    # OFFER — discount and deal messages
    {
        "name": "Bulk Order Discount",
        "category": "offer",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 🎉 Special offer for {school_name}: Order above ₹10,000 this month "
            "and get a FREE Activity Craft Box (worth ₹1,500) + free shipping anywhere in India. "
            "Valid for academic year stock-up orders. Interested? Reply YES and I'll call you "
            "today! — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Early Bird Session Offer",
        "category": "offer",
        "variables": ["name"],
        "body": (
            "Hello {name}! 📣 New session, new savings! Place your academic year craft order "
            "before June 15 and enjoy 15% off on all consumables + priority delivery before "
            "school reopens. Stock up early and never run out mid-term! — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Loyalty Reorder Offer",
        "category": "offer",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🙏 Thank you for being a valued SmartShape school partner. As our "
            "loyal customer, you have an exclusive 12% loyalty discount waiting on your next "
            "reorder. Your preferred items are ready to ship within 48 hours. "
            "Shall I raise the order? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },

    # FOLLOW-UP — post-visit, post-quotation, post-demo
    {
        "name": "Post-Visit Follow-up",
        "category": "followup",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! It was wonderful visiting {school_name} and meeting you in person. 😊 "
            "As discussed, I'm sharing our quotation and product list. Please feel free to call "
            "anytime with questions. Looking forward to supporting your school's craft programme! "
            "— SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Quotation Follow-up",
        "category": "followup",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! I wanted to follow up on the quotation we sent for {school_name}. 📋 "
            "Please let me know if you have any questions or if you'd like us to adjust quantities. "
            "We can also arrange a delivery date that suits your school calendar. — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Post-Demo Check-in",
        "category": "followup",
        "variables": ["name"],
        "body": (
            "Hello {name}! Hope you enjoyed our product demo! 😊 Our team is ready to process "
            "your first order with complimentary first-order samples. Just reply with your preferred "
            "quantity and we'll take it from there. — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },

    # RE-ENGAGEMENT — cold lead revival
    {
        "name": "Cold Lead Revival",
        "category": "reengagement",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 👋 It's been a while since we connected. SmartShape has exciting "
            "new products I think {school_name} would love — especially our new Activity Die Cut "
            "range. May I share an updated catalogue? No obligations, just wanted to stay "
            "in touch! — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "We Miss You",
        "category": "reengagement",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! We haven't heard from you in a while and just wanted to check in! 🙂 "
            "SmartShape has grown a lot — new products, better pricing, faster delivery. Would "
            "love to reconnect and see how we can support {school_name} this year. — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # SEASONAL — academic calendar touchpoints
    {
        "name": "New Academic Year Launch",
        "category": "seasonal",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 🎒 The new academic year is almost here! Is {school_name} stocked up "
            "on craft materials for the new session? SmartShape has everything you need — colours, "
            "clay, paper, scissors, die cuts, and activity kits. Order now for priority "
            "pre-session delivery! — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Session-End Order Reminder",
        "category": "seasonal",
        "variables": ["name"],
        "body": (
            "Hello {name}! The academic year is wrapping up — a great time to audit your craft "
            "material stock and plan orders for next session! SmartShape is offering year-end "
            "clearance prices on selected items. Want the list? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
]


async def _seed_templates():
    count = await db.whatsapp_templates.count_documents({})
    if count >= len(_DEFAULT_TEMPLATES):
        return
    now = datetime.now(timezone.utc).isoformat()
    for tmpl in _DEFAULT_TEMPLATES:
        exists = await db.whatsapp_templates.find_one({"name": tmpl["name"]})
        if not exists:
            await db.whatsapp_templates.insert_one({
                "template_id": f"tmpl_{uuid.uuid4().hex[:10]}",
                **tmpl,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            })


# ── Audience resolution helpers ────────────────────────────────────────────────

async def _resolve_audience(audience_filter: dict) -> list:
    roles = audience_filter.get("roles", [])
    boards = audience_filter.get("boards", [])
    cities = audience_filter.get("cities", [])

    if roles:
        role_docs = await db.contact_roles.find(
            {"name": {"$in": roles}}, {"role_id": 1, "name": 1}
        ).to_list(None)
        role_ids = {r["role_id"] for r in role_docs}
        role_names_lower = {r["name"].lower() for r in role_docs}
        all_contacts = await db.contacts.find({}, {"_id": 0}).to_list(None)
        return [
            c for c in all_contacts
            if c.get("contact_role_id") in role_ids
            or (c.get("designation") or "").lower() in role_names_lower
        ]

    filt = {}
    if boards:
        filt["board"] = {"$in": boards}
    if cities:
        filt["city"] = {"$in": cities}
    return await db.contacts.find(filt, {"_id": 0}).to_list(None)


# ── Templates endpoints ────────────────────────────────────────────────────────

@router.get("/whatsapp/templates")
async def list_templates(request: Request):
    await get_current_user(request)
    await _seed_templates()
    return await db.whatsapp_templates.find({}, {"_id": 0}).sort("category", 1).to_list(200)


@router.post("/whatsapp/templates")
async def create_template(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": f"tmpl_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "category": body.get("category", "intro"),
        "body": body.get("body", "").strip(),
        "variables": body.get("variables", []),
        "is_active": True,
        "usage_count": 0,
        "created_by": user["email"],
        "created_at": now,
        "updated_at": now,
    }
    await db.whatsapp_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/whatsapp/templates/{template_id}")
async def update_template(template_id: str, request: Request):
    await get_current_user(request)
    if not await db.whatsapp_templates.find_one({"template_id": template_id}):
        raise HTTPException(404, "Template not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "category", "body", "variables", "is_active"):
        if field in body:
            updates[field] = body[field]
    await db.whatsapp_templates.update_one({"template_id": template_id}, {"$set": updates})
    return await db.whatsapp_templates.find_one({"template_id": template_id}, {"_id": 0})


@router.delete("/whatsapp/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    await get_current_user(request)
    if not await db.whatsapp_templates.find_one({"template_id": template_id}):
        raise HTTPException(404, "Template not found")
    await db.whatsapp_templates.delete_one({"template_id": template_id})
    return {"ok": True}


# ── Campaigns endpoints ────────────────────────────────────────────────────────

@router.get("/whatsapp/campaigns")
async def list_campaigns(request: Request):
    await get_current_user(request)
    return await db.whatsapp_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/whatsapp/campaigns")
async def create_campaign(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    audience_filter = body.get("audience_filter", {})
    contacts = await _resolve_audience(audience_filter)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "campaign_id": f"camp_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "description": body.get("description", ""),
        "template_id": body.get("template_id"),
        "message": body.get("message", ""),
        "audience_filter": audience_filter,
        "audience_label": body.get("audience_label", "All Contacts"),
        "audience_count": len(contacts),
        "status": "draft",
        "scheduled_at": body.get("scheduled_at"),
        "sent_count": 0,
        "delivered_count": 0,
        "failed_count": 0,
        "created_by": user["email"],
        "created_by_name": user.get("name", user["email"]),
        "created_at": now,
        "updated_at": now,
        "sent_at": None,
    }
    await db.whatsapp_campaigns.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/whatsapp/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, request: Request):
    await get_current_user(request)
    if not await db.whatsapp_campaigns.find_one({"campaign_id": campaign_id}):
        raise HTTPException(404, "Campaign not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "description", "template_id", "message",
                  "audience_filter", "audience_label", "scheduled_at"):
        if field in body:
            updates[field] = body[field]
    await db.whatsapp_campaigns.update_one({"campaign_id": campaign_id}, {"$set": updates})
    return await db.whatsapp_campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})


@router.delete("/whatsapp/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, request: Request):
    await get_current_user(request)
    camp = await db.whatsapp_campaigns.find_one({"campaign_id": campaign_id})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp.get("status") in ("sent", "queued"):
        raise HTTPException(400, "Cannot delete a launched campaign")
    await db.whatsapp_campaigns.delete_one({"campaign_id": campaign_id})
    return {"ok": True}


@router.post("/whatsapp/campaigns/{campaign_id}/launch")
async def launch_campaign(campaign_id: str, request: Request):
    user = await get_current_user(request)
    camp = await db.whatsapp_campaigns.find_one({"campaign_id": campaign_id})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp.get("status") in ("sent", "queued"):
        raise HTTPException(400, "Campaign already launched")

    # Resolve message text
    message = (camp.get("message") or "").strip()
    if not message and camp.get("template_id"):
        tmpl = await db.whatsapp_templates.find_one({"template_id": camp["template_id"]})
        if tmpl:
            message = tmpl.get("body", "")
    if not message:
        raise HTTPException(400, "No message content. Add a message or select a template.")

    contacts = await _resolve_audience(camp.get("audience_filter", {}))
    now = datetime.now(timezone.utc).isoformat()
    queued = 0
    for contact in contacts:
        phone = (contact.get("phone") or contact.get("whatsapp") or "").strip()
        if not phone:
            continue
        first_name = (contact.get("first_name") or contact.get("name") or "").split()[0]
        personalized = (
            message
            .replace("{name}", first_name)
            .replace("{school_name}", contact.get("company") or "your school")
        )
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": f"sched_{uuid.uuid4().hex[:10]}",
            "campaign_id": campaign_id,
            "contact_id": contact.get("contact_id", ""),
            "contact_name": first_name,
            "phone": phone,
            "message": personalized,
            "status": "pending",
            "queued_at": now,
            "sent_at": None,
            "type": "campaign",
        })
        queued += 1

    new_status = "scheduled" if camp.get("scheduled_at") else "queued"
    await db.whatsapp_campaigns.update_one(
        {"campaign_id": campaign_id},
        {"$set": {
            "status": new_status,
            "sent_count": queued,
            "audience_count": queued,
            "sent_at": now,
            "launched_by": user["email"],
            "updated_at": now,
        }}
    )
    if camp.get("template_id"):
        await db.whatsapp_templates.update_one(
            {"template_id": camp["template_id"]},
            {"$inc": {"usage_count": 1}}
        )
    return {"queued": queued, "status": new_status}


# ── Analytics endpoint ─────────────────────────────────────────────────────────

@router.get("/whatsapp/analytics")
async def get_analytics(request: Request):
    await get_current_user(request)

    total_queued   = await db.whatsapp_scheduled.count_documents({})
    pending        = await db.whatsapp_scheduled.count_documents({"status": "pending"})
    sent_msgs      = await db.whatsapp_scheduled.count_documents({"status": "sent"})
    failed_msgs    = await db.whatsapp_scheduled.count_documents({"status": "failed"})

    campaigns       = await db.whatsapp_campaigns.find({}, {"_id": 0}).to_list(200)
    total_campaigns = len(campaigns)
    live_campaigns  = len([c for c in campaigns if c.get("status") in ("sent", "queued", "scheduled")])

    drip_active    = await db.drip_enrollments.count_documents({"status": "active"})
    drip_done      = await db.drip_enrollments.count_documents({"status": "completed"})
    greet_logs     = await db.greeting_logs.count_documents({})

    by_type: dict = {}
    async for doc in db.whatsapp_scheduled.aggregate([
        {"$group": {"_id": "$type", "count": {"$sum": 1}}}
    ]):
        by_type[doc["_id"] or "other"] = doc["count"]

    return {
        "messages": {"total": total_queued, "pending": pending, "sent": sent_msgs, "failed": failed_msgs},
        "campaigns": {"total": total_campaigns, "live": live_campaigns, "list": campaigns[:10]},
        "drips": {"active": drip_active, "completed": drip_done},
        "greetings": {"total_sent": greet_logs},
        "by_type": by_type,
    }


# ── Queue management ──────────────────────────────────────────────────────────

@router.get("/whatsapp/queue")
async def get_queue(request: Request):
    await get_current_user(request)
    params = dict(request.query_params)
    filt = {}
    if params.get("status"):
        filt["status"] = params["status"]
    if params.get("type"):
        filt["type"] = params["type"]
    return await db.whatsapp_scheduled.find(filt, {"_id": 0}).sort("queued_at", -1).to_list(300)
