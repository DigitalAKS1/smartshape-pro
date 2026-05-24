from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from auth_utils import get_current_user

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
    """Upsert system sequences — updates messages if already seeded, adds new ones."""
    now_iso = datetime.now(timezone.utc).isoformat()
    current_names = [s["name"] for s in _DEFAULT_SEQUENCES]

    for seq in _DEFAULT_SEQUENCES:
        existing = await db.drip_sequences.find_one({"name": seq["name"], "created_by": "system"})
        if existing:
            await db.drip_sequences.update_one(
                {"name": seq["name"], "created_by": "system"},
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
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # Remove obsolete system sequences
    await db.drip_sequences.delete_many({
        "created_by": "system",
        "name": {"$nin": current_names},
    })


def _normalise_steps(raw_steps: list) -> list:
    steps = []
    for i, s in enumerate(raw_steps):
        steps.append({
            "step_number": i + 1,
            "delay_days": max(0, int(s.get("delay_days", 0))),
            "message_type": s.get("message_type", "whatsapp"),
            "message_template": s.get("message_template", ""),
        })
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
    await get_current_user(request)
    await _seed_defaults()
    seqs = await db.drip_sequences.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [await _enrich(s) for s in seqs]


@router.post("/drip/sequences")
async def create_sequence(request: Request):
    user = await get_current_user(request)
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
    await get_current_user(request)
    if not await db.drip_sequences.find_one({"sequence_id": sequence_id}):
        raise HTTPException(404, "Sequence not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "description", "trigger", "filter_designation", "is_active"):
        if field in body:
            updates[field] = body[field]
    if "steps" in body:
        updates["steps"] = _normalise_steps(body["steps"])
    await db.drip_sequences.update_one({"sequence_id": sequence_id}, {"$set": updates})
    doc = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    return await _enrich(doc)


@router.delete("/drip/sequences/{sequence_id}")
async def delete_sequence(sequence_id: str, request: Request):
    await get_current_user(request)
    if not await db.drip_sequences.find_one({"sequence_id": sequence_id}):
        raise HTTPException(404, "Sequence not found")
    await db.drip_sequences.delete_one({"sequence_id": sequence_id})
    await db.drip_enrollments.update_many(
        {"sequence_id": sequence_id, "status": "active"},
        {"$set": {"status": "cancelled", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


# ── Enrollments ────────────────────────────────────────────────────────────────

@router.post("/drip/enroll")
async def enroll_lead(request: Request):
    user = await get_current_user(request)
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


@router.get("/drip/enrollments")
async def list_enrollments(request: Request):
    await get_current_user(request)
    params = dict(request.query_params)
    filt = {}
    if params.get("lead_id"):      filt["lead_id"] = params["lead_id"]
    if params.get("sequence_id"):  filt["sequence_id"] = params["sequence_id"]
    if params.get("status"):       filt["status"] = params["status"]
    return await db.drip_enrollments.find(filt, {"_id": 0}).sort("enrolled_at", -1).to_list(500)


@router.put("/drip/enrollments/{enrollment_id}/cancel")
async def cancel_enrollment(enrollment_id: str, request: Request):
    await get_current_user(request)
    if not await db.drip_enrollments.find_one({"enrollment_id": enrollment_id}):
        raise HTTPException(404, "Enrollment not found")
    await db.drip_enrollments.update_one(
        {"enrollment_id": enrollment_id},
        {"$set": {"status": "cancelled", "completed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}
