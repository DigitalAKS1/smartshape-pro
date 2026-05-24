from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── 15 SmartShape SMARTS-SHAPES cutting machine WhatsApp templates ────────────
_DEFAULT_TEMPLATES = [
    # INTRO — first-touch messages per designation
    {
        "name": "Principal First Touch",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Namaskar {name} ji! 🙏 I'm from SmartShape (est. 1999, Faridabad). We make the "
            "SMARTS-SHAPES die-cutting machine — used by 750+ schools across India to produce "
            "unlimited craft shapes, charts, and activity materials in-house. Schools save "
            "₹2–5 Lakhs every year on outsourcing. May I share how it works? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Teacher First Touch",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Hello {name}! 👋 I'm from SmartShape — makers of the SMARTS-SHAPES die-cutting "
            "machine. With this one machine your school can create perfect die-cut shapes, "
            "decorations, and craft materials for every class activity — no scissors, no waste, "
            "no outsourcing. 1,500+ teachers love it! Can I show you how? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Purchase Head Introduction",
        "category": "intro",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🙏 I'm from SmartShape — we supply the SMARTS-SHAPES die-cutting "
            "machine to 750+ schools. It replaces the ongoing cost of buying ready-made craft "
            "materials: one machine + our die library = unlimited shapes at a fraction of the "
            "price. GST invoice, installation, and training included. May I send the pricing? "
            "— SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # CATALOGUE — demo invitation and die showcase
    {
        "name": "Demo Invitation",
        "category": "catalogue",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 📺 A live demo of the SMARTS-SHAPES machine takes just 20 minutes "
            "and always impresses the whole team at {school_name}. You'll see it cut perfect "
            "shapes from foam, paper, and fabric in seconds — no skill needed. Can we schedule "
            "a demo visit this week? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Die Cut Catalogue",
        "category": "catalogue",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🎨 Our SMARTS-SHAPES die library has 750+ designs — alphabets, "
            "numbers, animals, festive shapes, borders, geometric sets, and curriculum-linked "
            "activity kits. New dies added every quarter. Would you like our full die catalogue "
            "PDF? Schools use it to plan the whole year's activity calendar! — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },

    # OFFER — ROI pitch and payment plans
    {
        "name": "ROI Savings Pitch",
        "category": "offer",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 💰 A quick question for {school_name}: how much does your school "
            "currently spend on craft materials and outsourced cutting every year? Most schools "
            "spend ₹3–6 Lakhs. With one SMARTS-SHAPES machine, they bring it all in-house and "
            "cut that cost by 60–80%. The machine pays for itself in under a year. Want the "
            "calculation for your school? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Flexible EMI Offer",
        "category": "offer",
        "variables": ["name"],
        "body": (
            "Hello {name}! 📣 Great news — SMARTS-SHAPES is now available on easy school "
            "budget terms: zero-cost EMI over 12 months, or a one-time price with free "
            "installation + 1-year warranty + teacher training included. No hidden charges. "
            "Ideal for schools planning next session's capital purchase. Want the full "
            "breakdown? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Academic Year Bundle",
        "category": "offer",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🎒 New session special: buy the SMARTS-SHAPES machine before "
            "June 30 and get FREE — 50-die starter pack (₹8,000 value) + on-site teacher "
            "training + priority installation before school reopens. Only for early-session "
            "orders. Shall I block a slot for your school? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # FOLLOW-UP — post-demo, post-quotation, post-installation
    {
        "name": "Post-Demo Follow-up",
        "category": "followup",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! Thank you for the SMARTS-SHAPES demo at {school_name} — it was "
            "wonderful meeting your team! 😊 As promised, I'm sharing the formal quotation "
            "and ROI sheet. The teachers seemed very excited about the die library. Please "
            "feel free to call anytime with questions. — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Quotation Follow-up",
        "category": "followup",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! Following up on the SMARTS-SHAPES quotation for {school_name}. 📋 "
            "We can adjust the die pack or payment plan to suit your budget. Many schools start "
            "with our Starter Bundle and expand the die library over time. Would you like to "
            "talk through the options? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Post-Installation Check-in",
        "category": "followup",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! Hope the SMARTS-SHAPES machine is running beautifully at "
            "{school_name}! 🎉 Our team is always a call away for support. Also — our new "
            "2026 Die Collection just launched with 80+ new designs (festive, STEM, and "
            "activity sets). Want me to share the new catalogue? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },

    # RE-ENGAGEMENT — cold lead revival
    {
        "name": "Cold Lead Revival",
        "category": "reengagement",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 👋 It's been a while since we connected about SMARTS-SHAPES. "
            "A lot has changed — we've added 150+ new dies and a school near {school_name} "
            "just installed their machine last month. They're already saving on craft costs. "
            "Would you like to see how it's working for them? — SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "We Miss You",
        "category": "reengagement",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! We haven't connected in a while and wanted to check in! 🙂 "
            "750+ schools are now using SMARTS-SHAPES — saving lakhs and empowering teachers "
            "to create richer activities. We'd love to show {school_name} what's possible now. "
            "Even a 20-minute call could be eye-opening! — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # SEASONAL — academic calendar touchpoints
    {
        "name": "New Academic Year Demo",
        "category": "seasonal",
        "variables": ["name", "school_name"],
        "body": (
            "Hello {name}! 🎒 New academic year — new opportunities for {school_name}! "
            "Is this the session your school finally brings craft production in-house? "
            "The SMARTS-SHAPES machine means teachers never have to order or wait for "
            "shapes again — everything made fresh, on demand. Book a pre-session demo now! "
            "— SmartShape"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Annual Day & Events Pitch",
        "category": "seasonal",
        "variables": ["name"],
        "body": (
            "Hello {name}! 🎭 Annual Day, Sports Day, Science Fair — every school event needs "
            "hundreds of decorations, props, and craft pieces. With SMARTS-SHAPES, your team "
            "can produce all of it in-house in hours instead of days. Schools that have the "
            "machine say it transforms how they plan events. Want a demo before your next big "
            "event? — SmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
]


async def _seed_templates():
    now = datetime.now(timezone.utc).isoformat()
    current_names = [t["name"] for t in _DEFAULT_TEMPLATES]
    for tmpl in _DEFAULT_TEMPLATES:
        existing = await db.whatsapp_templates.find_one(
            {"name": tmpl["name"], "created_by": "system"}
        )
        if existing:
            await db.whatsapp_templates.update_one(
                {"name": tmpl["name"], "created_by": "system"},
                {"$set": {
                    "body": tmpl["body"],
                    "category": tmpl["category"],
                    "variables": tmpl["variables"],
                    "updated_at": now,
                }}
            )
        else:
            await db.whatsapp_templates.insert_one({
                "template_id": f"tmpl_{uuid.uuid4().hex[:10]}",
                **tmpl,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            })
    await db.whatsapp_templates.delete_many({
        "created_by": "system", "name": {"$nin": current_names}
    })


# ── Audience resolution helpers ────────────────────────────────────────────────

async def _resolve_audience(audience_filter: dict) -> list:
    roles  = audience_filter.get("roles", [])
    boards = audience_filter.get("boards", [])
    cities = audience_filter.get("cities", [])
    tags   = audience_filter.get("tags", [])   # list of tag_ids — ANY match

    base_filt = {"is_deleted": {"$ne": True}}
    if boards:
        base_filt["board"] = {"$in": boards}
    if cities:
        base_filt["city"] = {"$in": cities}

    if tags:
        base_filt["tag_ids"] = {"$in": tags}
        return await db.contacts.find(base_filt, {"_id": 0}).to_list(None)

    if roles:
        role_docs = await db.contact_roles.find(
            {"name": {"$in": roles}}, {"role_id": 1, "name": 1}
        ).to_list(None)
        role_ids = {r["role_id"] for r in role_docs}
        role_names_lower = {r["name"].lower() for r in role_docs}
        all_contacts = await db.contacts.find(base_filt, {"_id": 0}).to_list(None)
        return [
            c for c in all_contacts
            if c.get("contact_role_id") in role_ids
            or (c.get("designation") or "").lower() in role_names_lower
        ]

    return await db.contacts.find(base_filt, {"_id": 0}).to_list(None)


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


# ── WhatsApp Provider Settings ─────────────────────────────────────────────────

@router.get("/whatsapp/provider")
async def get_wa_provider(request: Request):
    await get_current_user(request)
    cfg = await db.settings.find_one({"type": "whatsapp_provider"}, {"_id": 0})
    if not cfg:
        return {"provider": "none", "api_key": "", "from_number": "", "phone_number_id": "", "app_name": "SmartShape", "connected": False}
    safe = {k: v for k, v in cfg.items() if k != "api_key"}
    safe["api_key"] = "••••" + cfg.get("api_key", "")[-4:] if cfg.get("api_key") else ""
    safe["connected"] = bool(cfg.get("api_key") and cfg.get("provider") not in (None, "none", ""))
    return safe


@router.post("/whatsapp/provider")
async def save_wa_provider(request: Request):
    await get_current_user(request)
    body = await request.json()
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {
        "type": "whatsapp_provider",
        "provider": body.get("provider", "none"),
        "api_key": body.get("api_key", ""),
        "from_number": body.get("from_number", ""),
        "phone_number_id": body.get("phone_number_id", ""),
        "app_name": body.get("app_name", "SmartShape"),
        "updated_at": now_iso,
    }
    await db.settings.update_one(
        {"type": "whatsapp_provider"},
        {"$set": update},
        upsert=True,
    )
    return {"ok": True, "provider": update["provider"], "connected": bool(update["api_key"] and update["provider"] not in ("none", ""))}
