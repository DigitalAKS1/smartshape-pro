from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_module
from routes.crm_routes import create_physical_from_drip

router = APIRouter()

# ── Pre-seed defaults ────────────────────────────────────────────────────────
# ── SmartShape sales cycle sequences for the SMARTS-SHAPES cutting machine ────
_DEFAULT_SEQUENCES = [
    {
        "name": "Principal Machine Pitch (7-step)",
        "description": "Full nurture journey for Principals — from awareness to demo booking",
        "trigger": "lead_created",
        "filter_designation": "Principal",
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Namaskar {name} ji! 🙏 I'm from SmartShape — we've helped 750+ schools across India "
                    "transform their activity programme with the SMARTS-SHAPES automated cutting machine. "
                    "It does the work of 10+ craft teachers in a day, saves lakhs annually, and makes your "
                    "school stand out during admissions. May I share a quick overview? — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 3, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 💰 Schools using SMARTS-SHAPES save ₹2–5 Lakhs annually on craft "
                    "teachers, activity materials, and preparation hours. The machine creates 100+ custom "
                    "shapes per hour — bulletin boards, teaching aids, event decorations, all in minutes. "
                    "Would you like a customised savings estimate for your school? — SmartShape"
                ),
            },
            {
                "step_number": 3, "delay_days": 7, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 📹 I'd love to show you the SMARTS-SHAPES machine live! A 15-minute "
                    "demo at your school will show exactly how it creates teaching aids, activity kits and "
                    "30+ unique experiential learning materials. It's completely free — no obligation. "
                    "Can I schedule a visit? — SmartShape Team"
                ),
            },
            {
                "step_number": 4, "delay_days": 14, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! ✂️ SmartShape just launched 200+ new die designs for 2026! "
                    "Math manipulatives, Science models, Art & Craft patterns, festive decorations — "
                    "your school can create any teaching aid in seconds. Would you like to see the "
                    "full 2026 design library? — SmartShape"
                ),
            },
            {
                "step_number": 5, "delay_days": 21, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 🎒 Start the new academic year with a game-changer! Schools that "
                    "invest in SMARTS-SHAPES before June 15 get priority installation + free teacher "
                    "training worth ₹25,000 + the 2026 Premium Die Library. Limited slots available. "
                    "Shall I block one for your school? — SmartShape Team"
                ),
            },
            {
                "step_number": 6, "delay_days": 28, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 👋 A lot has happened at SmartShape — upgraded machine, 200+ new "
                    "die designs, and 100+ new schools onboarded this year. I'd love just 10 minutes to "
                    "show you what your school can achieve. Shall I arrange a visit? — SmartShape"
                ),
            },
            {
                "step_number": 7, "delay_days": 35, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 🙏 This is our final follow-up from SmartShape. If the timing isn't "
                    "right today, no worries at all — just reply LATER and I'll reconnect next session. "
                    "We wish your school a wonderful year ahead and are here whenever you're ready! "
                    "— SmartShape Team"
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Teacher Awareness Series (5-step)",
        "description": "Teacher-focused nurture — show how SMARTS-SHAPES saves hours of craft prep",
        "trigger": "lead_created",
        "filter_designation": "Teacher",
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 👋 I'm from SmartShape — we make the SMARTS-SHAPES automated cutting "
                    "machine used by 1,500+ teachers across India. Create beautiful bulletin boards, "
                    "teaching aids, and activity kits in minutes — no scissors, no hours of prep work. "
                    "Interested in seeing how it works? — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 3, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! ✂️ Imagine making 100 perfect butterfly shapes for a Science lesson "
                    "in under 5 minutes, or creating an entire festive bulletin board in one hour. That's "
                    "what SMARTS-SHAPES does for teachers every single day. Your prep time cuts to nearly "
                    "zero. Would you like to see a quick demo? — SmartShape"
                ),
            },
            {
                "step_number": 3, "delay_days": 7, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 📹 We'd love to demonstrate SMARTS-SHAPES at your school! It takes just "
                    "15 minutes and we can show you how to create any teaching aid — Math manipulatives, "
                    "Science models, craft patterns, festive decor — all in minutes. Can I arrange a "
                    "free demo visit? — SmartShape Team"
                ),
            },
            {
                "step_number": 4, "delay_days": 14, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🙏 Many teachers who love SMARTS-SHAPES told us their Principal became "
                    "an instant fan once they saw the machine in action. Has your school management had a "
                    "chance to learn about it? I can arrange a dedicated principal briefing too. "
                    "— SmartShape"
                ),
            },
            {
                "step_number": 5, "delay_days": 21, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! Final message from SmartShape — we genuinely believe SMARTS-SHAPES will "
                    "transform your classroom experience. If you're ever ready to explore, just reply and "
                    "we'll take it from there. Wishing you a wonderful teaching year! 🍎 — SmartShape Team"
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Post-Demo / Quotation Follow-up (5-step)",
        "description": "Close the deal after a demo or quotation — 5 steps over 14 days",
        "trigger": "quotation_sent",
        "filter_designation": None,
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 😊 Thank you for your time at the SMARTS-SHAPES demo! I've shared the "
                    "product brochure, die catalogue, and a customised quotation for your school. Please "
                    "do let me know if you have any questions — I'm here to help! — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 3, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 📋 Just checking in on the SMARTS-SHAPES quotation. We can fully "
                    "customise the die library and teacher training schedule to match your school's "
                    "curriculum and calendar. Would you like to discuss any adjustments? — SmartShape"
                ),
            },
            {
                "step_number": 3, "delay_days": 7, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🎒 Schools that placed their order this month got priority pre-session "
                    "delivery, free installation, and the 2026 Premium Die Library included. We have "
                    "limited installation slots before June — shall I hold one for your school? "
                    "— SmartShape Team"
                ),
            },
            {
                "step_number": 4, "delay_days": 10, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 💳 SmartShape offers a flexible payment plan that many schools find "
                    "very convenient — spread over the academic year with zero additional cost. Happy to "
                    "share the full details. — SmartShape"
                ),
            },
            {
                "step_number": 5, "delay_days": 14, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🙏 This is our last follow-up on the quotation. We're truly committed "
                    "to making SMARTS-SHAPES work perfectly for your school. Just reply and I'll arrange "
                    "a quick call with our School Success team to address any remaining questions. "
                    "— SmartShape Team"
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Re-engagement: Cold Leads (3-step)",
        "description": "Revive leads that went silent — 3 touches over 21 days",
        "trigger": "manual",
        "filter_designation": None,
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 👋 It's been a while since we last connected — a lot has happened at "
                    "SmartShape! We've upgraded the machine, launched 200+ new die designs, and onboarded "
                    "100+ new schools this year. I'd love to show you what your school can now achieve. "
                    "Just 10 minutes? — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 7, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🏫 We'd love to arrange a visit to a nearby SmartShape school so you "
                    "can see the machine in real action and speak directly with the teachers using it. "
                    "It's the most powerful thing we can show you — and it's completely free. "
                    "Interested? — SmartShape"
                ),
            },
            {
                "step_number": 3, "delay_days": 21, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🙏 One final message from SmartShape. We've genuinely helped 750+ "
                    "schools save lakhs and transform their activity programmes. Whenever you're ready "
                    "to explore, we'll be right here. Wishing your school a wonderful year ahead! "
                    "— SmartShape Team"
                ),
            },
        ],
        "is_active": False,
    },
]


async def _seed_defaults():
    """Upsert system sequences — updates default copy, adds new ones.

    NEVER touches a sequence the user has edited. This function runs on every
    GET /drip/sequences (i.e. every time the Drip tab is opened), so without the
    `customised` guard it force-wrote the seeded sequences back to their hardcoded
    steps — the owner's save worked and the next page load silently undid it — and
    it DELETED any system sequence that had been renamed, because the new name was
    no longer in the defaults list.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    current_names = [s["name"] for s in _DEFAULT_SEQUENCES]

    for seq in _DEFAULT_SEQUENCES:
        existing = await db.drip_sequences.find_one(
            {"name": seq["name"], "created_by": "system"}, {"_id": 0, "customised": 1})
        if existing:
            if existing.get("customised"):
                continue                      # the owner owns this one now — hands off
            await db.drip_sequences.update_one(
                {"name": seq["name"], "created_by": "system", "customised": {"$ne": True}},
                {"$set": {
                    "description": seq["description"],
                    "steps": seq["steps"],
                    "filter_designation": seq.get("filter_designation"),
                    "trigger": seq["trigger"],
                    "updated_at": now_iso,
                }}
            )
        else:
            await db.drip_sequences.insert_one({
                "sequence_id": f"drip_{uuid.uuid4().hex[:10]}",
                **seq,
                "created_by": "system",
                "customised": False,
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # Retire obsolete stock sequences — but never one the owner edited or renamed,
    # and never one that still has people enrolled in it.
    stale = await db.drip_sequences.find(
        {"created_by": "system", "customised": {"$ne": True},
         "name": {"$nin": current_names}}, {"_id": 0, "sequence_id": 1}).to_list(100)
    for s in stale:
        if await db.drip_enrollments.count_documents({"sequence_id": s["sequence_id"]}):
            continue                          # keep history joinable
        await db.drip_sequences.delete_one({"sequence_id": s["sequence_id"]})


def _normalise_steps(raw_steps: list) -> list:
    steps = []
    for i, s in enumerate(raw_steps):
        step = {
            "step_number": i + 1,
            "delay_days": max(0, int(s.get("delay_days", 0))),
            "message_type": s.get("message_type", "whatsapp"),
            "message_template": s.get("message_template", ""),
            "message_plain": s.get("message_plain", ""),
            "material_type": s.get("material_type", ""),
            "material_name": s.get("material_name", ""),
        }
        if s.get("attachment_id"):
            step["attachment_id"] = s["attachment_id"]
        steps.append(step)
    return steps


async def _enrich(seq: dict) -> dict:
    sid = seq["sequence_id"]
    seq["enrollment_count"] = await db.drip_enrollments.count_documents({"sequence_id": sid})
    seq["active_count"]     = await db.drip_enrollments.count_documents({"sequence_id": sid, "status": "active"})
    seq["completed_count"]  = await db.drip_enrollments.count_documents({"sequence_id": sid, "status": "completed"})
    return seq


# ── Sequences CRUD ─────────────────────────────────────────────────────────────

@router.get("/drip/sequences")
async def list_sequences(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    await _seed_defaults()
    seqs = await db.drip_sequences.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [await _enrich(s) for s in seqs]


@router.post("/drip/sequences")
async def create_sequence(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "sequence_id": f"drip_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "description": body.get("description", "").strip(),
        "trigger": body.get("trigger", "manual"),
        "filter_designation": (body.get("filter_designation") or "").strip() or None,
        "steps": _normalise_steps(body.get("steps", [])),
        "is_active": bool(body.get("is_active", True)),
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.drip_sequences.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.put("/drip/sequences/{sequence_id}")
async def update_sequence(sequence_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    if not await db.drip_sequences.find_one({"sequence_id": sequence_id}):
        raise HTTPException(404, "Sequence not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "description", "trigger", "filter_designation", "is_active"):
        if field in body:
            updates[field] = body[field]
    if "steps" in body:
        updates["steps"] = _normalise_steps(body["steps"])
    # Editing the CONTENT makes this sequence the owner's, so the default seed stops
    # rewriting it on the next page load. Pausing/resuming is not a content edit —
    # a paused stock sequence should still receive improved default copy.
    if any(f in body for f in ("name", "description", "trigger", "filter_designation", "steps")):
        updates["customised"] = True
    await db.drip_sequences.update_one({"sequence_id": sequence_id}, {"$set": updates})
    doc = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    return await _enrich(doc)


@router.delete("/drip/sequences/{sequence_id}")
async def delete_sequence(sequence_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write_delete")
    if not await db.drip_sequences.find_one({"sequence_id": sequence_id}):
        raise HTTPException(404, "Sequence not found")
    await db.drip_sequences.delete_one({"sequence_id": sequence_id})
    await db.drip_enrollments.update_many(
        {"sequence_id": sequence_id, "status": "active"},
        {"$set": {"status": "cancelled", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


# ── Auto-enrollment helpers ────────────────────────────────────────────────────

async def _auto_enroll_quotation_sent(lead_doc: dict):
    """Auto-enroll a lead into any sequence with trigger='quotation_sent'."""
    seqs = await db.drip_sequences.find(
        {"trigger": "quotation_sent", "is_active": True}, {"_id": 0}
    ).to_list(20)
    now = datetime.now(timezone.utc)
    for seq in seqs:
        if not seq.get("steps"):
            continue
        existing = await db.drip_enrollments.find_one(
            {"sequence_id": seq["sequence_id"], "lead_id": lead_doc["lead_id"], "status": "active"}
        )
        if existing:
            continue
        first_delay = seq["steps"][0].get("delay_days", 0)
        await db.drip_enrollments.insert_one({
            "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
            "sequence_id": seq["sequence_id"],
            "lead_id": lead_doc["lead_id"],
            "current_step": 0,
            "status": "active",
            "enrolled_at": now.isoformat(),
            "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
            "last_step_at": None,
            "completed_at": None,
            "enrolled_by": "system",
            "trigger": "quotation_sent",
        })


# ── Enrollments ────────────────────────────────────────────────────────────────

@router.post("/drip/enroll")
async def enroll_lead(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    sequence_id = body.get("sequence_id")
    lead_id = body.get("lead_id")
    if not sequence_id or not lead_id:
        raise HTTPException(400, "sequence_id and lead_id are required")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq:
        raise HTTPException(404, "Sequence not found")
    if not seq.get("steps"):
        raise HTTPException(400, "Sequence has no steps")
    existing = await db.drip_enrollments.find_one(
        {"sequence_id": sequence_id, "lead_id": lead_id, "status": "active"}
    )
    if existing:
        raise HTTPException(409, "Lead is already actively enrolled in this sequence")
    now = datetime.now(timezone.utc)
    first_delay = seq["steps"][0].get("delay_days", 0)
    enr = {
        "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
        "sequence_id": sequence_id,
        "lead_id": lead_id,
        "current_step": 0,
        "status": "active",
        "enrolled_at": now.isoformat(),
        "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
        "last_step_at": None,
        "completed_at": None,
        "enrolled_by": user["email"],
    }
    await db.drip_enrollments.insert_one(enr)
    enr.pop("_id", None)
    return enr


@router.post("/drip/enroll-schools")
async def enroll_schools(request: Request):
    """Start a marketing plan on many schools at once: enrol each selected
    school's lead into one sequence. Finds the school's active lead (or creates a
    Direct-Mail lead assigned to that school's sales agent), so every Call / Mail
    / WhatsApp step lands on the right agent's plate — surfacing in Delegation
    and School Activity. Idempotent: skips leads already active in the sequence."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    sequence_id = body.get("sequence_id")
    school_ids = body.get("school_ids", []) or []
    if not sequence_id:
        raise HTTPException(400, "sequence_id is required")
    if not school_ids:
        raise HTTPException(400, "school_ids is required")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq or not seq.get("steps"):
        raise HTTPException(404, "Sequence not found or has no steps")

    from routes.crm_routes import OPEN_STAGES, _upsert_direct_mail_lead
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    first_delay = seq["steps"][0].get("delay_days", 0)
    enrolled, skipped, leads_created = 0, 0, 0

    for sid in school_ids:
        # Prefer an active lead for this school; else any lead; else create one.
        lead = await db.leads.find_one(
            {"school_id": sid, "stage": {"$in": list(OPEN_STAGES)}, "is_deleted": {"$ne": True}},
            {"_id": 0, "lead_id": 1})
        if not lead:
            lead = await db.leads.find_one(
                {"school_id": sid, "is_deleted": {"$ne": True}}, {"_id": 0, "lead_id": 1})
        if not lead:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "assigned_to": 1})
            owner_email = (sch or {}).get("assigned_to") or user["email"]  # the school's sales agent
            lead_id = await _upsert_direct_mail_lead(sid, seq.get("deal_type", ""), owner_email, now_iso)
            leads_created += 1
        else:
            lead_id = lead["lead_id"]
        if not lead_id:
            continue
        if await db.drip_enrollments.find_one(
                {"sequence_id": sequence_id, "lead_id": lead_id, "status": "active"}, {"_id": 0, "enrollment_id": 1}):
            skipped += 1
            continue
        await db.drip_enrollments.insert_one({
            "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
            "sequence_id": sequence_id, "lead_id": lead_id,
            "current_step": 0, "status": "active", "enrolled_at": now_iso,
            "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
            "last_step_at": None, "completed_at": None,
            "enrolled_by": user["email"],
        })
        enrolled += 1

    return {"sequence_id": sequence_id, "sequence_name": seq.get("name", ""),
            "enrolled": enrolled, "skipped": skipped, "leads_created": leads_created,
            "total": len(school_ids)}


@router.get("/drip/enrollments")
async def list_enrollments(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    params = dict(request.query_params)
    filt = {}
    if params.get("lead_id"):      filt["lead_id"] = params["lead_id"]
    if params.get("sequence_id"):  filt["sequence_id"] = params["sequence_id"]
    if params.get("status"):       filt["status"] = params["status"]
    return await db.drip_enrollments.find(filt, {"_id": 0}).sort("enrolled_at", -1).to_list(500)


@router.put("/drip/enrollments/{enrollment_id}/cancel")
async def cancel_enrollment(enrollment_id: str, request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    if not await db.drip_enrollments.find_one({"enrollment_id": enrollment_id}):
        raise HTTPException(404, "Enrollment not found")
    await db.drip_enrollments.update_one(
        {"enrollment_id": enrollment_id},
        {"$set": {"status": "cancelled", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


# ── Sequence deliveries drill-down ─────────────────────────────────────────────

_CHANNEL_OF = {"whatsapp": "whatsapp", "email": "email",
               "physical_material": "mail", "call_task": "call"}


@router.get("/drip/sequences/{sequence_id}/deliveries")
async def sequence_deliveries(sequence_id: str, request: Request):
    """One row per (enrolment x step) — fired or not. The unfired rows are the point:
    without them, 'planned but not done' is invisible."""
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq:
        raise HTTPException(404, "Sequence not found")
    steps = {s["step_number"]: s for s in sorted(seq.get("steps", []),
                                                 key=lambda s: s["step_number"])}

    enrolments = await db.drip_enrollments.find({"sequence_id": sequence_id},
                                                {"_id": 0}).to_list(2000)
    lead_ids = [e["lead_id"] for e in enrolments]
    leads = {l["lead_id"]: l for l in await db.leads.find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(None)}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1}).to_list(None)}
    logs = {}
    for lg in await db.drip_step_logs.find({"sequence_id": sequence_id}, {"_id": 0}).to_list(5000):
        logs[(lg["enrollment_id"], lg["step_number"])] = lg
    touches = {}
    for t in await db.mail_touches.find({"sequence_id": sequence_id}, {"_id": 0}).to_list(5000):
        touches[(t.get("enrollment_id", ""), t.get("step_number", 0))] = t

    def _plus_days(enrolled_at, days):
        raw = str(enrolled_at or "")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            return (datetime.fromisoformat(raw) + timedelta(days=days)).strftime("%Y-%m-%d")
        except ValueError:
            return ""

    rows = []
    for enr in enrolments:
        lead = leads.get(enr["lead_id"], {})
        sid = lead.get("school_id", "")
        school_name = schools.get(sid, {}).get("school_name") or lead.get("company_name", "")
        for n, step in steps.items():
            log = logs.get((enr["enrollment_id"], n))
            touch = touches.get((enr["enrollment_id"], n))
            planned = _plus_days(enr.get("enrolled_at"), step.get("delay_days", 0))
            if touch:
                # A physical step's truth is the VERIFIED posting, not the fire time:
                # the drip queued it, but a person still had to take it to the post.
                status = {"sent": "sent", "not_sent": "not_sent", "skipped": "skipped"}.get(
                    touch.get("verify_status"),
                    "printed" if touch.get("printed_at") else "queued")
                actual = str(touch.get("posted_at") or "")[:10]
                planned = touch.get("planned_date") or planned
            elif log:
                status = "sent" if log.get("status") == "sent" else "failed"
                actual = str(log.get("fired_at") or "")[:10]
            else:
                status = "planned" if enr.get("status") == "active" else "cancelled"
                actual = ""
            rows.append({
                "enrollment_id": enr["enrollment_id"], "lead_id": enr["lead_id"],
                "school_id": sid, "school_name": school_name or "(no school)",
                "owner": lead.get("assigned_to", ""), "step_number": n,
                "channel": _CHANNEL_OF.get(step.get("message_type", ""), step.get("message_type", "")),
                "item": step.get("material_name") or step.get("material_type") or "",
                "planned_date": planned, "actual_date": actual, "status": status,
                "run_id": (touch or {}).get("run_id", ""),
                "touch_id": (touch or {}).get("touch_id", ""),
            })

    qp = request.query_params
    if qp.get("status"):
        rows = [r for r in rows if r["status"] == qp["status"]]
    if qp.get("channel"):
        rows = [r for r in rows if r["channel"] == qp["channel"]]
    if qp.get("step"):
        rows = [r for r in rows if str(r["step_number"]) == str(qp["step"])]
    rows.sort(key=lambda r: (r["school_name"], r["step_number"]))

    totals = {}
    for r in rows:
        totals[r["status"]] = totals.get(r["status"], 0) + 1
    totals.setdefault("sent", 0)
    totals.setdefault("planned", 0)
    return {"sequence_id": sequence_id, "sequence_name": seq.get("name", ""),
            "rows": rows, "totals": totals}


# ── Admin test trigger for physical dispatch helper ────────────────────────────

@router.post("/drip/_test-fire-physical")
async def _test_fire_physical(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    lead = await db.leads.find_one({"lead_id": body.get("lead_id")}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    did = await create_physical_from_drip(lead, body.get("material_type", "brochure"), body.get("seq_name", "drip"))
    return {"dispatch_id": did}
