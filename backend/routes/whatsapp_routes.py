from fastapi import APIRouter, HTTPException, Request, UploadFile, File, BackgroundTasks
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
import asyncio
import logging

from database import db
from auth_utils import get_current_user
from services.wa_send import send_whatsapp, consent_ok
from services.ai_personalizer import personalize_message
from services.tag_scope import resolve_tag_scope

logger = logging.getLogger(__name__)

# Directory where uploaded attachments are stored and served via /uploads static mount
_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "whatsapp")
os.makedirs(_UPLOAD_DIR, exist_ok=True)

# Public base URL so Evolution API can fetch the file (set in environment)
_PUBLIC_BASE = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")

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
    """Combined audience — AND across facets, OR within — matching the email
    resolver + the live recipient count, so what you filter is what you send.
    Hand-pick and non-purchasers stay one-off modes; everything else combines."""
    contact_ids = audience_filter.get("contact_ids") or []
    if contact_ids:  # hand-pick (webinar / direct list)
        return await db.contacts.find(
            {"contact_id": {"$in": contact_ids}, "is_deleted": {"$ne": True}}, {"_id": 0}).to_list(None)

    if audience_filter.get("not_purchased"):  # funnel: schools with no won deal
        won_school_ids = {l["school_id"] async for l in db.leads.find(
            {"stage": "won", "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1}) if l.get("school_id")}
        q = {"is_deleted": {"$ne": True}}
        if won_school_ids:
            q["school_id"] = {"$nin": list(won_school_ids)}
        return await db.contacts.find(q, {"_id": 0}).to_list(None)

    # ── Combinable facets ───────────────────────────────────────────────────
    sources      = audience_filter.get("sources") or []
    roles        = audience_filter.get("roles") or []
    tags         = audience_filter.get("tags") or []
    lead_stages  = audience_filter.get("lead_stages") or []
    school_types = audience_filter.get("school_types") or []
    cities       = audience_filter.get("cities") or audience_filter.get("school_cities") or []
    min_strength = audience_filter.get("min_strength")
    max_strength = audience_filter.get("max_strength")

    contact_q = {"is_deleted": {"$ne": True}}

    # School-level facets → intersect into one school_id set
    school_id_sets = []
    if school_types or cities or min_strength is not None or max_strength is not None:
        sch_q: dict = {}
        if school_types:
            sch_q["school_type"] = {"$in": school_types}
        if cities:
            sch_q["city"] = {"$in": cities}
        if min_strength is not None or max_strength is not None:
            strq: dict = {}
            if min_strength is not None:
                strq["$gte"] = int(min_strength)
            if max_strength is not None:
                strq["$lte"] = int(max_strength)
            sch_q["school_strength"] = strq
        school_id_sets.append(
            {s["school_id"] async for s in db.schools.find(sch_q, {"_id": 0, "school_id": 1})})
    if lead_stages:
        stage_ids = set()
        async for l in db.leads.find(
                {"stage": {"$in": lead_stages}, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1}):
            if l.get("school_id"):
                stage_ids.add(l["school_id"])
        school_id_sets.append(stage_ids)
    if school_id_sets:
        school_ids = set.intersection(*school_id_sets)
        if not school_ids:
            return []
        contact_q["school_id"] = {"$in": list(school_ids)}

    if sources:
        contact_q["source"] = {"$in": sources}
    if tags:
        # PEOPLE, so the contact set of the tag roll-up — D1: a contact carrying
        # one of the tags itself, never a colleague at a matching school. Same
        # resolver as the email audience, so the two channels cannot disagree.
        tagged = (await resolve_tag_scope(db, tags))["contact_ids"]
        if not tagged:
            return []
        contact_q["contact_id"] = {"$in": list(tagged)}

    contacts = await db.contacts.find(contact_q, {"_id": 0}).to_list(None)

    # Role facet: OR over contact_role_id and free-text designation (post-filter)
    if roles:
        role_docs = await db.contact_roles.find({"name": {"$in": roles}}, {"role_id": 1, "name": 1}).to_list(None)
        role_ids = {r["role_id"] for r in role_docs}
        role_names_lower = {r["name"].lower() for r in role_docs} | {r.lower() for r in roles}
        contacts = [c for c in contacts
                    if c.get("contact_role_id") in role_ids
                    or (c.get("designation") or "").lower() in role_names_lower]
    return contacts


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
        "campaign_id":        f"camp_{uuid.uuid4().hex[:10]}",
        "ai_personalization": body.get("ai_personalization", True),
        "attachment_id":      body.get("attachment_id"),
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
                  "audience_filter", "audience_label", "scheduled_at",
                  "ai_personalization", "attachment_id"):
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
async def launch_campaign(campaign_id: str, request: Request, background_tasks: BackgroundTasks):
    user = await get_current_user(request)
    camp = await db.whatsapp_campaigns.find_one({"campaign_id": campaign_id})
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if camp.get("status") in ("sending", "sent", "queued"):
        raise HTTPException(400, "Campaign already launched")

    # Resolve template / message
    message = (camp.get("message") or "").strip()
    if not message and camp.get("template_id"):
        tmpl = await db.whatsapp_templates.find_one({"template_id": camp["template_id"]})
        if tmpl:
            message = tmpl.get("body", "")
    if not message:
        raise HTTPException(400, "No message content. Add a message or select a template.")

    # Attachment (optional)
    attachment_id   = camp.get("attachment_id")
    attachment_doc  = None
    if attachment_id:
        attachment_doc = await db.whatsapp_attachments.find_one({"attachment_id": attachment_id}, {"_id": 0})

    contacts = await _resolve_audience(camp.get("audience_filter", {}))
    now = datetime.now(timezone.utc).isoformat()

    # Batch-fetch lead stages so AI personalizer gets the correct pipeline nudge
    lead_ids = list({c.get("lead_id") for c in contacts if c.get("lead_id")})
    lead_stage_map: dict = {}
    if lead_ids:
        async for ld in db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0, "lead_id": 1, "stage": 1}):
            lead_stage_map[ld["lead_id"]] = ld.get("stage", "")

    # Create pending records synchronously (fast) — background task does actual sending
    queued = 0
    sched_ids = []
    for contact in contacts:
        phone = (contact.get("phone") or contact.get("whatsapp") or "").strip()
        if not phone:
            continue
        sched_id = f"sched_{uuid.uuid4().hex[:10]}"
        sched_ids.append(sched_id)
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": sched_id,
            "campaign_id": campaign_id,
            "campaign_name": camp.get("name", ""),
            "contact_id": contact.get("contact_id", ""),
            "contact_name": contact.get("name", ""),
            "phone": phone,
            "message": "",           # filled in by background task after AI personalisation
            "status": "pending",
            "queued_at": now,
            "sent_at": None,
            "wa_message_id": None,
            "type": "campaign",
            "contact_snapshot": {    # store context for AI
                "name": contact.get("name", ""),
                "company": contact.get("company", ""),
                "designation": contact.get("designation", ""),
                "city": contact.get("city", ""),
                "stage": lead_stage_map.get(contact.get("lead_id", ""), ""),
            },
        })
        queued += 1

    new_status = "scheduled" if camp.get("scheduled_at") else "queued"
    await db.whatsapp_campaigns.update_one(
        {"campaign_id": campaign_id},
        {"$set": {
            "status": new_status,
            "audience_count": queued,
            "sent_count": 0,
            "sent_at": now,
            "launched_by": user["email"],
            "updated_at": now,
        }},
    )
    if camp.get("template_id"):
        await db.whatsapp_templates.update_one(
            {"template_id": camp["template_id"]}, {"$inc": {"usage_count": 1}}
        )

    # Fire-and-forget background task — does AI personalisation + Evolution API sending
    ai_enabled = camp.get("ai_personalization", True)
    background_tasks.add_task(
        _send_campaign_background,
        campaign_id=campaign_id,
        sched_ids=sched_ids,
        template=message,
        attachment_doc=attachment_doc,
        ai_enabled=ai_enabled,
    )

    # A campaign is not consent-gated (only drips and greetings are, D10), but the launcher is
    # told how many recipients have no WhatsApp consent on record.
    no_consent = 0
    for contact in contacts:
        if (contact.get("phone") or contact.get("whatsapp") or "").strip() and not await consent_ok(
                db, lead_id=contact.get("lead_id") or "", contact_id=contact.get("contact_id") or "",
                school_id=contact.get("school_id") or ""):
            no_consent += 1

    return {"queued": queued, "status": new_status, "ai_enabled": ai_enabled, "no_consent": no_consent}


async def _send_campaign_background(campaign_id: str, sched_ids: list, template: str,
                                    attachment_doc: Optional[dict], ai_enabled: bool):
    """AI-personalise each message, then hand it to send_whatsapp (W1, D3): each contact is sent
    from its owner's number (contact owner, else school owner, else the company's; a rep number
    still warming up -> the company's), with opt-out, caps and business hours enforced by the
    service - which also paces and queues the sends, so there is no fixed delay here any more."""
    counts = {"sent": 0, "queued": 0, "skipped": 0, "failed": 0}
    for sched_id in sched_ids:
        doc = await db.whatsapp_scheduled.find_one({"scheduled_id": sched_id}, {"_id": 0})
        if not doc:
            continue
        try:
            personalised_msg = await personalize_message(template=template, contact=doc.get("contact_snapshot", {}),
                                                         campaign_name=doc.get("campaign_name", ""),
                                                         ai_enabled=ai_enabled)
        except Exception as exc:
            logger.error(f"Personalisation error for {sched_id}: {exc}")
            personalised_msg = template
        try:
            res = await send_whatsapp(db, to=doc["phone"], text=personalised_msg, media=attachment_doc, kind="campaign",
                                      contact_id=doc.get("contact_id") or "",
                                      ref={"campaign_id": campaign_id, "scheduled_id": sched_id,
                                           "dedup_key": f"camp:{campaign_id}:{sched_id}"})
        except Exception as exc:
            res = {"status": "failed", "message_id": "", "reason": str(exc)[:200]}
        counts[res["status"]] = counts.get(res["status"], 0) + 1
        await db.whatsapp_scheduled.update_one({"scheduled_id": sched_id}, {"$set": {
            "message": personalised_msg, "status": res["status"], "wa_msg_id": res.get("message_id", ""),
            "error": res.get("reason", ""), "sent_at": datetime.now(timezone.utc).isoformat()}})
    delivered = counts["sent"] + counts["queued"]
    final_status = "sent" if delivered else ("failed" if counts["failed"] else "queued")
    await db.whatsapp_campaigns.update_one({"campaign_id": campaign_id}, {"$set": {
        "status": final_status, "sent_count": delivered, "queued_count": counts["queued"],
        "skipped_count": counts["skipped"], "failed_count": counts["failed"],
        "updated_at": datetime.now(timezone.utc).isoformat()}})
    logger.info(f"Campaign {campaign_id} complete — {counts}")


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


# ── Company number state (read-only) ──────────────────────────────────────────
# Instance management moved to routes/wa_routes.py (/wa/me*, /wa/instances*), which is
# owner/admin-gated. This read-only route stays for MarketingHub's connection badge.

@router.get("/whatsapp/instance/status")
async def wa_instance_status(request: Request):
    await get_current_user(request)
    inst = await db.wa_instances.find_one({"kind": "company"}, {"_id": 0, "instance_name": 1, "state": 1}) or {}
    state = {"connected": "open", "qr": "connecting"}.get(inst.get("state"), "close")
    return {"state": state, "connected": state == "open", "instance": inst.get("instance_name", "")}


# ── Attachment upload ──────────────────────────────────────────────────────────

_ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
    "video/mp4", "video/quicktime", "video/webm",
}

@router.post("/whatsapp/attachments/upload")
async def wa_upload_attachment(request: Request, file: UploadFile = File(...)):
    """Upload a file; returns a public URL Evolution API can fetch."""
    await get_current_user(request)
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(400, f"File type '{file.content_type}' not allowed. Allowed: PDF, JPEG, PNG, MP4")
    if file.size and file.size > 50 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 50 MB)")

    ext = (file.filename or "file").rsplit(".", 1)[-1].lower()
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    dest = os.path.join(_UPLOAD_DIR, safe_name)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    public_url = f"{_PUBLIC_BASE}/uploads/whatsapp/{safe_name}"
    # Guess attachment type for campaign storage
    if file.content_type.startswith("image/"):
        att_type = "image"
    elif file.content_type.startswith("video/"):
        att_type = "video"
    else:
        att_type = "document"

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "attachment_id": f"att_{uuid.uuid4().hex[:10]}",
        "filename": file.filename,
        "safe_name": safe_name,
        "url": public_url,
        "content_type": file.content_type,
        "attachment_type": att_type,
        "size_bytes": len(content),
        "uploaded_at": now,
    }
    await db.whatsapp_attachments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/whatsapp/attachments")
async def wa_list_attachments(request: Request):
    await get_current_user(request)
    return await db.whatsapp_attachments.find({}, {"_id": 0}).sort("uploaded_at", -1).to_list(100)


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
