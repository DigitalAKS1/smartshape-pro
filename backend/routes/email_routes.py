from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── 15 SmartShape SMARTS-SHAPES email templates ───────────────────────────────
_DEFAULT_TEMPLATES = [
    # INTRO — first-touch emails per designation
    {
        "name": "Principal Introduction Email",
        "category": "intro",
        "variables": ["name"],
        "subject": "How 750+ Schools Save ₹2–5 Lakhs on Craft: SmartShape SMARTS-SHAPES",
        "body": (
            "Namaskar {name} ji,\n\n"
            "I'm writing from SmartShape (founded 1999, Faridabad) — makers of the "
            "SMARTS-SHAPES die-cutting machine, used by 750+ schools and 1,500+ teachers "
            "across India.\n\n"
            "The machine lets your school produce unlimited craft shapes, decorations, "
            "charts, and activity materials in-house — from foam, paper, and fabric — "
            "in seconds, with no skill required. Schools that adopt it typically save "
            "₹2–5 Lakhs every year on craft purchases and outsourced cutting.\n\n"
            "I'd love to share a brief overview and our ROI calculation for your school's "
            "scale. Would a 20-minute call or demo visit work for you this week?\n\n"
            "Warm regards,\nSmartShape Team\nwww.smartshape.in"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Teacher Introduction Email",
        "category": "intro",
        "variables": ["name"],
        "subject": "One Machine That Transforms Art & Craft Class — SmartShape SMARTS-SHAPES",
        "body": (
            "Hello {name},\n\n"
            "I'm from SmartShape — makers of the SMARTS-SHAPES die-cutting machine. "
            "I wanted to reach out because I think it could genuinely change how you "
            "run art & craft sessions.\n\n"
            "With SMARTS-SHAPES, you press a die onto the machine and get a perfect "
            "shape instantly — no scissors, no templates, no mess. 750+ designs available "
            "(alphabets, animals, festive shapes, STEM sets, and more). Teachers across "
            "CBSE, ICSE, and State Board schools use it for bulletin boards, project work, "
            "greeting cards, event decorations, and daily class activities.\n\n"
            "1,500+ teachers across India call it their favourite classroom tool. Would "
            "you be open to a quick look at what it can do?\n\n"
            "Best regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Purchase Head Budget Email",
        "category": "intro",
        "variables": ["name"],
        "subject": "SMARTS-SHAPES — Full Pricing, ROI & Budget Sheet for Your School",
        "body": (
            "Hello {name},\n\n"
            "I'm from SmartShape, and I'd like to share an opportunity that many school "
            "purchase departments have found valuable: the SMARTS-SHAPES die-cutting machine.\n\n"
            "In brief — schools currently spending ₹3–6 Lakhs/year on craft materials and "
            "outsourced cutting can reduce that by 60–80% with a single in-house machine. "
            "The machine is a one-time capital purchase with a clear ROI within the first year.\n\n"
            "What's included: machine unit, installation, teacher training, 1-year warranty, "
            "GST invoice, and access to our 750+ die design library.\n\n"
            "I'd be happy to send our full school pricing and a customised ROI sheet for "
            "your school's scale. May I?\n\n"
            "Regards,\nSmartShape Team\nwww.smartshape.in"
        ),
        "is_active": True, "usage_count": 0,
    },

    # CATALOGUE — demo and die library
    {
        "name": "Demo Invitation Email",
        "category": "catalogue",
        "variables": ["name", "school_name"],
        "subject": "Book a SMARTS-SHAPES Live Demo at {school_name} (Only 20 Minutes)",
        "body": (
            "Hello {name},\n\n"
            "I'd like to invite you to a live demonstration of the SMARTS-SHAPES "
            "die-cutting machine at {school_name} — it takes just 20 minutes and "
            "consistently impresses both principals and teachers.\n\n"
            "During the demo you'll see:\n"
            "• Perfect die-cut shapes from foam, paper, and fabric in seconds\n"
            "• The full die library — 750+ designs across categories\n"
            "• How teachers use it daily without any training burden\n"
            "• A live ROI comparison for your school's spending\n\n"
            "No purchase obligation — just a look at what 750+ schools are already using. "
            "We can work around your school schedule completely.\n\n"
            "Reply to this email or call us to book a slot.\n\n"
            "Best,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Die Library Catalogue Email",
        "category": "catalogue",
        "variables": ["name"],
        "subject": "750+ Die Designs for Your School's Activities — Full Catalogue Inside",
        "body": (
            "Hello {name},\n\n"
            "I wanted to share SmartShape's die library — 750+ designs that schools "
            "use with the SMARTS-SHAPES machine to create activity materials all year.\n\n"
            "Categories include:\n"
            "• Alphabets & Numbers (English, Hindi, regional languages)\n"
            "• Animals, Birds & Nature\n"
            "• Festivals & Seasonal (Diwali, Christmas, Holi, Eid, Republic Day…)\n"
            "• STEM & Subject-specific (science, math, geography shapes)\n"
            "• Borders, frames, and bulletin board elements\n"
            "• Activity kits (craft, origami, storytelling sets)\n\n"
            "New dies are added every quarter. Schools use the catalogue to plan their "
            "full academic year's activity calendar.\n\n"
            "Would you like me to send the full PDF catalogue? Happy to share it at no cost.\n\n"
            "Regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # OFFER — ROI pitch and payment plans
    {
        "name": "ROI Savings Calculator Email",
        "category": "offer",
        "variables": ["name", "school_name"],
        "subject": "How Much Is {school_name} Spending on Craft? (The Real Number May Surprise You)",
        "body": (
            "Hello {name},\n\n"
            "Quick question: what does {school_name} spend annually on craft materials, "
            "die-cut shapes, activity kits, and outsourced cutting?\n\n"
            "Most schools we work with are surprised when they add it up — typically "
            "₹3–6 Lakhs per year. With the SMARTS-SHAPES machine:\n\n"
            "• One machine replaces all outsourced cutting and most craft material purchases\n"
            "• Average school saves ₹2–5 Lakhs in year one\n"
            "• Machine pays for itself within 8–14 months\n"
            "• 750+ schools across India have already made the switch\n\n"
            "I can prepare a customised ROI calculation for {school_name}'s scale — "
            "based on student count and current craft spend — at no cost.\n\n"
            "Would that be useful?\n\n"
            "Best,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Flexible EMI Plan Email",
        "category": "offer",
        "variables": ["name"],
        "subject": "SMARTS-SHAPES on School Budget Terms — Zero-Cost EMI Available",
        "body": (
            "Hello {name},\n\n"
            "One of the most common questions we hear is: 'Can we fit this into our "
            "annual capital budget?' The answer is almost always yes — here's how:\n\n"
            "Payment options for the SMARTS-SHAPES machine:\n"
            "• Zero-cost EMI over 12 months — predictable monthly school budget line\n"
            "• One-time payment with extended warranty + free die starter pack\n"
            "• Academic year billing aligned to school calendar\n\n"
            "All options include: installation, teacher training, 1-year warranty, "
            "GST invoice, and access to our 750+ die design library.\n\n"
            "Many schools fund the machine from savings they see in their very first "
            "term — the cost reduction from reduced craft purchases covers the EMI.\n\n"
            "Would you like me to walk through the numbers for your school?\n\n"
            "Regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Academic Year Bundle Email",
        "category": "offer",
        "variables": ["name"],
        "subject": "New Session Early Bird: Free 50-Die Starter Pack + Priority Installation",
        "body": (
            "Hello {name},\n\n"
            "Planning your new academic session? We have a special early-bird offer "
            "for schools that commit before session start:\n\n"
            "New Session Bundle includes:\n"
            "✅ SMARTS-SHAPES machine (full unit)\n"
            "✅ Free 50-die starter pack (₹8,000 value — chosen for your curriculum)\n"
            "✅ On-site teacher training before school reopens\n"
            "✅ Priority installation slot (before the rush)\n"
            "✅ 1-year warranty + dedicated support\n\n"
            "Available for orders placed before [session start date]. Once slots fill "
            "up, installation timelines extend significantly.\n\n"
            "Reply to this email to check slot availability for your school.\n\n"
            "Best,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # FOLLOWUP — post-demo, post-quotation, post-installation
    {
        "name": "Post-Demo Thank You Email",
        "category": "followup",
        "variables": ["name", "school_name"],
        "subject": "Thank You for the SMARTS-SHAPES Demo — Quotation & ROI Sheet Attached",
        "body": (
            "Dear {name},\n\n"
            "Thank you so much for hosting our demo at {school_name} — it was a pleasure "
            "meeting you and the team!\n\n"
            "As promised, I've attached:\n"
            "1. Formal quotation for SMARTS-SHAPES (with all inclusions)\n"
            "2. ROI calculation sheet personalised to {school_name}'s scale\n"
            "3. Reference list of nearby schools using the machine\n\n"
            "Please take your time reviewing. I'm happy to answer any questions, adjust "
            "the die selection, or arrange a call with our installation team.\n\n"
            "I'll follow up in a few days, but please feel free to reach out anytime.\n\n"
            "Warm regards,\nSmartShape Team\nwww.smartshape.in"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Quotation Follow-up Email",
        "category": "followup",
        "variables": ["name", "school_name"],
        "subject": "Following Up: SMARTS-SHAPES Quotation for {school_name}",
        "body": (
            "Hello {name},\n\n"
            "I wanted to follow up on the SMARTS-SHAPES quotation I sent for {school_name}. "
            "I hope you had a chance to review it.\n\n"
            "A few things to know:\n"
            "• The quotation is fully adjustable — we can modify the die selection, "
            "payment terms, or bundle composition to match your budget\n"
            "• We can arrange a second demo or a reference call with another school if helpful\n"
            "• Installation timelines are currently running 2–3 weeks from order confirmation\n\n"
            "Is there anything specific holding the decision back? I'd love to help work "
            "through any concerns — budget, approvals, timing, or anything else.\n\n"
            "Please feel free to reply or call directly.\n\n"
            "Regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Post-Installation Welcome Email",
        "category": "followup",
        "variables": ["name", "school_name"],
        "subject": "Welcome to the SmartShape Family! — Your Die Library & Support Details",
        "body": (
            "Dear {name},\n\n"
            "Welcome to the SmartShape family — {school_name} is now part of a community "
            "of 750+ schools transforming craft across India! 🎉\n\n"
            "A few things to get you started:\n"
            "• Your dedicated support number: reach us Mon–Sat, 9am–6pm\n"
            "• Die ordering: reply to this email with die names from our catalogue\n"
            "• Warranty: 1 year on machine, spare parts available same-day\n"
            "• Teacher training refresher: available on request, at no cost\n\n"
            "Also — our 2026 Die Collection just launched with 80+ new designs "
            "(festive, STEM, and activity sets). I'll share the new catalogue shortly.\n\n"
            "Thank you for choosing SmartShape. We're truly excited for what {school_name} "
            "will create!\n\n"
            "Warm regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # RE-ENGAGEMENT — cold lead revival
    {
        "name": "Cold Lead Revival Email",
        "category": "reengagement",
        "variables": ["name"],
        "subject": "It's Been a While — Big Updates at SmartShape (New Dies + Pricing)",
        "body": (
            "Hello {name},\n\n"
            "It's been some time since we last connected, and I wanted to reach out "
            "with a genuine update — a lot has changed at SmartShape.\n\n"
            "What's new:\n"
            "• 150+ new die designs added to our library (STEM, regional, festive)\n"
            "• Improved payment plans — 12-month zero-cost EMI now available\n"
            "• Extended warranty on all new machines\n"
            "• 50+ new school installations in the past 6 months — now 750+ schools\n\n"
            "If the timing wasn't right before, I'd love to reconnect and see if "
            "things look different now. Even a 15-minute call could be worth it.\n\n"
            "No pressure — just wanted to stay in touch and share what's new.\n\n"
            "Best,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Peer School Success Story Email",
        "category": "reengagement",
        "variables": ["name", "school_name"],
        "subject": "How a School Near {school_name} Is Saving ₹4 Lakhs/Year with SMARTS-SHAPES",
        "body": (
            "Hello {name},\n\n"
            "I wanted to share a quick story that I thought might resonate with you.\n\n"
            "A school very similar to {school_name} — same board, similar strength — "
            "installed the SMARTS-SHAPES machine 18 months ago. Before the machine, they "
            "were spending ₹5.2 Lakhs/year on craft and outsourcing. In year one with "
            "SMARTS-SHAPES, that dropped to ₹1.1 Lakhs. Their teachers now produce all "
            "shapes, decorations, and project materials in-house.\n\n"
            "They've also said it's changed how engaged their students are during craft "
            "sessions — when kids see perfect shapes appear instantly, it sparks creativity.\n\n"
            "I'd love for {school_name} to have the same experience. Would a quick call "
            "or a reference visit to that school be useful?\n\n"
            "Best regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },

    # SEASONAL — academic calendar touchpoints
    {
        "name": "New Academic Year Email",
        "category": "seasonal",
        "variables": ["name", "school_name"],
        "subject": "New Session Starting — Is {school_name} Ready for In-House Craft Production?",
        "body": (
            "Hello {name},\n\n"
            "A new academic year is approaching — and with it comes the familiar challenge "
            "of sourcing craft materials, managing activity budgets, and preparing for "
            "competitions, events, and daily art classes.\n\n"
            "This is the year many schools we work with decided to bring it all in-house "
            "with the SMARTS-SHAPES machine. The difference is significant:\n\n"
            "Before: ordering craft materials monthly, waiting for stock, paying per piece\n"
            "After: all shapes made in-house, on demand, at a fraction of the cost\n\n"
            "750+ schools across India have already made this shift. Could this be the "
            "right session for {school_name}?\n\n"
            "I'd love to schedule a quick demo or send our new-session pricing before "
            "your budget is finalised.\n\n"
            "Best,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Annual Day Preparation Email",
        "category": "seasonal",
        "variables": ["name"],
        "subject": "Annual Day Coming Up? SMARTS-SHAPES Transforms School Event Preparation",
        "body": (
            "Hello {name},\n\n"
            "With Annual Day season approaching, I wanted to reach out at exactly the "
            "right moment.\n\n"
            "Annual Day, Sports Day, Science Fair, cultural programmes — every school event "
            "requires hundreds of props, decorations, name cards, backdrops, and craft pieces. "
            "Schools that try to source all of this externally face:\n"
            "• High per-piece costs\n"
            "• Long lead times and delivery uncertainty\n"
            "• Generic designs that don't match the school's theme\n\n"
            "With SMARTS-SHAPES, your team produces everything in-house — custom shapes, "
            "letters, thematic decorations — in hours rather than days. Schools tell us "
            "their Annual Day production time dropped from 3 weeks to 3 days.\n\n"
            "Would it be worth a 20-minute call before your event prep begins?\n\n"
            "Best regards,\nSmartShape Team"
        ),
        "is_active": True, "usage_count": 0,
    },
]


async def _seed_templates():
    now = datetime.now(timezone.utc).isoformat()
    current_names = [t["name"] for t in _DEFAULT_TEMPLATES]
    for tmpl in _DEFAULT_TEMPLATES:
        existing = await db.email_templates.find_one(
            {"name": tmpl["name"], "created_by": "system"}
        )
        if existing:
            await db.email_templates.update_one(
                {"name": tmpl["name"], "created_by": "system"},
                {"$set": {
                    "subject": tmpl["subject"],
                    "body": tmpl["body"],
                    "category": tmpl["category"],
                    "variables": tmpl["variables"],
                    "updated_at": now,
                }}
            )
        else:
            await db.email_templates.insert_one({
                "template_id": f"etmpl_{uuid.uuid4().hex[:10]}",
                **tmpl,
                "created_by": "system",
                "created_at": now,
                "updated_at": now,
            })
    await db.email_templates.delete_many({
        "created_by": "system", "name": {"$nin": current_names}
    })


# ── Audience resolution (same logic as WhatsApp, uses email field) ────────────

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


# ── Template endpoints ─────────────────────────────────────────────────────────

@router.get("/email/templates")
async def list_email_templates(request: Request):
    await get_current_user(request)
    await _seed_templates()
    return await db.email_templates.find({}, {"_id": 0}).sort("category", 1).to_list(200)


@router.post("/email/templates")
async def create_email_template(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": f"etmpl_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "category": body.get("category", "intro"),
        "subject": body.get("subject", "").strip(),
        "body": body.get("body", "").strip(),
        "variables": body.get("variables", []),
        "is_active": True,
        "usage_count": 0,
        "created_by": user["email"],
        "created_at": now,
        "updated_at": now,
    }
    await db.email_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/email/templates/{template_id}")
async def update_email_template(template_id: str, request: Request):
    await get_current_user(request)
    if not await db.email_templates.find_one({"template_id": template_id}):
        raise HTTPException(404, "Template not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "category", "subject", "body", "variables", "is_active"):
        if field in body:
            updates[field] = body[field]
    await db.email_templates.update_one({"template_id": template_id}, {"$set": updates})
    return await db.email_templates.find_one({"template_id": template_id}, {"_id": 0})


@router.delete("/email/templates/{template_id}")
async def delete_email_template(template_id: str, request: Request):
    await get_current_user(request)
    if not await db.email_templates.find_one({"template_id": template_id}):
        raise HTTPException(404, "Template not found")
    await db.email_templates.delete_one({"template_id": template_id})
    return {"ok": True}


# ── Campaign endpoints ─────────────────────────────────────────────────────────

@router.get("/email/campaigns")
async def list_email_campaigns(request: Request):
    await get_current_user(request)
    return await db.email_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/email/campaigns")
async def create_email_campaign(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    audience_filter = body.get("audience_filter", {})
    contacts = await _resolve_audience(audience_filter)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "campaign_id": f"ecamp_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "description": body.get("description", ""),
        "template_id": body.get("template_id"),
        "subject": body.get("subject", "").strip(),
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
    await db.email_campaigns.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/email/campaigns/{campaign_id}")
async def update_email_campaign(campaign_id: str, request: Request):
    await get_current_user(request)
    if not await db.email_campaigns.find_one({"campaign_id": campaign_id}):
        raise HTTPException(404, "Campaign not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "description", "template_id", "subject", "message",
                  "audience_filter", "audience_label", "scheduled_at"):
        if field in body:
            updates[field] = body[field]
    await db.email_campaigns.update_one({"campaign_id": campaign_id}, {"$set": updates})
    return await db.email_campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})


@router.delete("/email/campaigns/{campaign_id}")
async def delete_email_campaign(campaign_id: str, request: Request):
    await get_current_user(request)
    camp = await db.email_campaigns.find_one({"campaign_id": campaign_id})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp.get("status") in ("sent", "queued"):
        raise HTTPException(400, "Cannot delete a launched campaign")
    await db.email_campaigns.delete_one({"campaign_id": campaign_id})
    return {"ok": True}


@router.post("/email/campaigns/{campaign_id}/launch")
async def launch_email_campaign(campaign_id: str, request: Request):
    user = await get_current_user(request)
    camp = await db.email_campaigns.find_one({"campaign_id": campaign_id})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp.get("status") in ("sent", "queued"):
        raise HTTPException(400, "Campaign already launched")

    subject = (camp.get("subject") or "").strip()
    message = (camp.get("message") or "").strip()
    if not message and camp.get("template_id"):
        tmpl = await db.email_templates.find_one({"template_id": camp["template_id"]})
        if tmpl:
            message = tmpl.get("body", "")
            if not subject:
                subject = tmpl.get("subject", "")
    if not message:
        raise HTTPException(400, "No message content. Add a message or select a template.")
    if not subject:
        raise HTTPException(400, "No subject line. Add a subject or select a template.")

    contacts = await _resolve_audience(camp.get("audience_filter", {}))
    now = datetime.now(timezone.utc).isoformat()
    queued = 0
    for contact in contacts:
        email_addr = (contact.get("email") or "").strip()
        if not email_addr:
            continue
        first_name = (contact.get("first_name") or contact.get("name") or "").split()[0]
        school = contact.get("company") or "your school"
        personalized_subject = subject.replace("{name}", first_name).replace("{school_name}", school)
        personalized_body = message.replace("{name}", first_name).replace("{school_name}", school)
        await db.email_scheduled.insert_one({
            "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
            "campaign_id": campaign_id,
            "contact_id": contact.get("contact_id", ""),
            "contact_name": first_name,
            "email": email_addr,
            "subject": personalized_subject,
            "message": personalized_body,
            "status": "pending",
            "queued_at": now,
            "sent_at": None,
            "type": "campaign",
        })
        queued += 1

    new_status = "scheduled" if camp.get("scheduled_at") else "queued"
    await db.email_campaigns.update_one(
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
        await db.email_templates.update_one(
            {"template_id": camp["template_id"]},
            {"$inc": {"usage_count": 1}}
        )
    return {"queued": queued, "status": new_status}


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/email/analytics")
async def get_email_analytics(request: Request):
    await get_current_user(request)

    total_queued = await db.email_scheduled.count_documents({})
    pending      = await db.email_scheduled.count_documents({"status": "pending"})
    sent_msgs    = await db.email_scheduled.count_documents({"status": "sent"})
    failed_msgs  = await db.email_scheduled.count_documents({"status": "failed"})

    campaigns       = await db.email_campaigns.find({}, {"_id": 0}).to_list(200)
    total_campaigns = len(campaigns)
    live_campaigns  = len([c for c in campaigns if c.get("status") in ("sent", "queued", "scheduled")])

    by_type: dict = {}
    async for doc in db.email_scheduled.aggregate([
        {"$group": {"_id": "$type", "count": {"$sum": 1}}}
    ]):
        by_type[doc["_id"] or "other"] = doc["count"]

    return {
        "messages": {"total": total_queued, "pending": pending, "sent": sent_msgs, "failed": failed_msgs},
        "campaigns": {"total": total_campaigns, "live": live_campaigns, "list": campaigns[:10]},
        "by_type": by_type,
    }


# ── Queue ─────────────────────────────────────────────────────────────────────

@router.get("/email/queue")
async def get_email_queue(request: Request):
    await get_current_user(request)
    params = dict(request.query_params)
    filt = {}
    if params.get("status"):
        filt["status"] = params["status"]
    if params.get("type"):
        filt["type"] = params["type"]
    return await db.email_scheduled.find(filt, {"_id": 0}).sort("queued_at", -1).to_list(300)
