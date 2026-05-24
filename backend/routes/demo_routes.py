"""
Demo data seeder for the WhatsApp Marketing system.
Seeds 5 realistic school contacts, 3 campaigns (completed/queued/draft),
drip enrollments, and greeting logs so every tab shows live example data.
All demo documents are tagged with is_demo=True for easy cleanup.
"""
from fastapi import APIRouter, Request
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── 5 realistic B2B school personas ───────────────────────────────────────────
DEMO_CONTACTS = [
    {
        "first_name": "Ramesh", "last_name": "Kumar",
        "company": "Delhi Public School, Dwarka",
        "designation": "Principal", "phone": "9876543210",
        "email": "ramesh@dpsdwarka.edu.in",
        "city": "New Delhi", "board": "CBSE",
    },
    {
        "first_name": "Priya", "last_name": "Sharma",
        "company": "St. Mary's Convent School",
        "designation": "Teacher", "phone": "9876543211",
        "email": "priya.sharma@stmarys.edu.in",
        "city": "Mumbai", "board": "ICSE",
    },
    {
        "first_name": "Rajesh", "last_name": "Patel",
        "company": "Navyug Vidyalaya",
        "designation": "Purchase Head", "phone": "9876543212",
        "email": "rajesh.patel@navyug.edu.in",
        "city": "Ahmedabad", "board": "CBSE",
    },
    {
        "first_name": "Anita", "last_name": "Singh",
        "company": "Ryan International School",
        "designation": "Principal", "phone": "9876543213",
        "email": "anita.singh@ryanis.edu.in",
        "city": "Gurugram", "board": "CBSE",
    },
    {
        "first_name": "Suresh", "last_name": "Mehta",
        "company": "DAV Public School",
        "designation": "Activity Teacher", "phone": "9876543214",
        "email": "suresh.mehta@davschool.edu.in",
        "city": "Pune", "board": "State Board",
    },
]

DEMO_MARKER = "[DEMO]"


@router.post("/demo/marketing")
async def seed_demo_marketing(request: Request):
    """Seed all demo data. Idempotent — skips if already seeded."""
    user = await get_current_user(request)

    # Guard: don't double-seed
    if await db.whatsapp_campaigns.find_one({"name": {"$regex": r"\[DEMO\]"}}):
        return {"already_seeded": True, "message": "Demo data already loaded. Clear it first to re-seed."}

    now = datetime.now(timezone.utc)
    created = {"contacts": 0, "campaigns": 0, "messages": 0, "enrollments": 0, "greetings": 0}

    # ── 1. Contacts ────────────────────────────────────────────────────────────
    contact_docs = []
    for c in DEMO_CONTACTS:
        existing = await db.contacts.find_one({"phone": c["phone"]})
        if not existing:
            cid = f"contact_{uuid.uuid4().hex[:10]}"
            doc = {
                "contact_id": cid,
                "name": f"{c['first_name']} {c['last_name']}",
                **c,
                "is_demo": True,
                "created_at": (now - timedelta(days=45)).isoformat(),
            }
            await db.contacts.insert_one(doc)
            contact_docs.append(doc)
            created["contacts"] += 1
        else:
            contact_docs.append(existing)

    principals   = [c for c in DEMO_CONTACTS if c["designation"] == "Principal"]
    teachers     = [c for c in DEMO_CONTACTS if "Teacher" in c["designation"]]

    # ── 2. Campaign A — COMPLETED: Diwali Demo Drive (all 5 contacts) ──────────
    camp_a_id = f"camp_{uuid.uuid4().hex[:10]}"
    diwali_msg = (
        "Shubh Deepawali {name} ji! 🪔✨ SmartShape is running a special Diwali Demo Drive — "
        "see the SMARTS-SHAPES die-cutting machine live at your school, no obligation. "
        "750+ schools across India are already saving ₹2–5 Lakhs/year with it. "
        "Book your slot before Oct 25! — SmartShape Team"
    )
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": camp_a_id,
        "name": f"Diwali Demo Drive 2025 {DEMO_MARKER}",
        "description": "Festival season demo invitation blast to all school contacts",
        "template_id": None,
        "message": diwali_msg,
        "audience_filter": {},
        "audience_label": "All Contacts",
        "audience_count": 5,
        "status": "completed",
        "sent_count": 5, "delivered_count": 4, "failed_count": 1,
        "created_by": user["email"],
        "created_by_name": user.get("name", user["email"]),
        "created_at": (now - timedelta(days=30)).isoformat(),
        "sent_at":    (now - timedelta(days=29)).isoformat(),
        "is_demo": True,
    })
    created["campaigns"] += 1

    # Seed sent + 1 failed message into whatsapp_scheduled
    for i, c in enumerate(DEMO_CONTACTS):
        is_sent = i < 4  # 4 sent, 1 failed
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": f"sched_{uuid.uuid4().hex[:10]}",
            "campaign_id": camp_a_id,
            "contact_name": c["first_name"],
            "phone": c["phone"],
            "message": diwali_msg.replace("{name}", c["first_name"]).replace("{school_name}", c["company"]),
            "status": "sent" if is_sent else "failed",
            "queued_at": (now - timedelta(days=29)).isoformat(),
            "sent_at":   (now - timedelta(days=29)).isoformat() if is_sent else None,
            "type": "campaign", "is_demo": True,
        })
        created["messages"] += 1

    # ── 3. Campaign B — QUEUED: New Academic Year Demo (principals only) ──────
    camp_b_id = f"camp_{uuid.uuid4().hex[:10]}"
    session_msg = (
        "Hello {name}! 🎒 New academic year — new opportunity for {school_name}! "
        "Is this the session your school finally brings craft production in-house? "
        "The SMARTS-SHAPES die-cutting machine means teachers never wait for shapes again — "
        "everything made fresh, on demand. Book a pre-session demo now! — SmartShape"
    )
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": camp_b_id,
        "name": f"New Academic Year Demo Drive 2026 {DEMO_MARKER}",
        "description": "Pre-session demo invitation to school principals",
        "template_id": None,
        "message": session_msg,
        "audience_filter": {"roles": ["Principal"]},
        "audience_label": "Principals",
        "audience_count": len(principals),
        "status": "queued",
        "sent_count": len(principals), "delivered_count": 0, "failed_count": 0,
        "created_by": user["email"],
        "created_by_name": user.get("name", user["email"]),
        "created_at": (now - timedelta(days=2)).isoformat(),
        "sent_at":    (now - timedelta(hours=1)).isoformat(),
        "is_demo": True,
    })
    created["campaigns"] += 1

    # Seed pending messages for principals
    for c in principals:
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": f"sched_{uuid.uuid4().hex[:10]}",
            "campaign_id": camp_b_id,
            "contact_name": c["first_name"],
            "phone": c["phone"],
            "message": session_msg.replace("{name}", c["first_name"]).replace("{school_name}", c["company"]),
            "status": "pending",
            "queued_at": (now - timedelta(hours=1)).isoformat(),
            "sent_at": None,
            "type": "campaign", "is_demo": True,
        })
        created["messages"] += 1

    # ── 4. Campaign C — DRAFT: Annual Day Pitch ───────────────────────────────
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": f"camp_{uuid.uuid4().hex[:10]}",
        "name": f"Annual Day & Events Craft Pitch {DEMO_MARKER}",
        "description": "Pitch SMARTS-SHAPES for school events — Annual Day, Sports Day, fairs",
        "template_id": None,
        "message": (
            "Hello {name}! 🎭 Annual Day, Sports Day, Science Fair — every school event needs "
            "hundreds of decorations, props, and craft pieces. With SMARTS-SHAPES, your team "
            "produces all of it in-house in hours instead of ordering for days. "
            "Want a demo before your next big event? — SmartShape Team"
        ),
        "audience_filter": {},
        "audience_label": "All Contacts",
        "audience_count": 5,
        "status": "draft",
        "sent_count": 0, "delivered_count": 0, "failed_count": 0,
        "created_by": user["email"],
        "created_by_name": user.get("name", user["email"]),
        "created_at": (now - timedelta(hours=6)).isoformat(),
        "sent_at": None,
        "is_demo": True,
    })
    created["campaigns"] += 1

    # ── 5. Drip messages (type=drip in whatsapp_scheduled) ────────────────────
    drip_steps = [
        ("Ramesh", "9876543210",
         "Day 0: Namaskar Ramesh ji! 🙏 I'm from SmartShape (est. 1999, Faridabad). "
         "We make the SMARTS-SHAPES die-cutting machine — 750+ schools across India use it "
         "to save ₹2–5 Lakhs/year on craft costs. May I share how it works? — SmartShape Team",
         "sent", 7),
        ("Ramesh", "9876543210",
         "Day 3: Hello Ramesh ji! 📊 A quick number: schools typically spend ₹3–6 Lakhs/year "
         "on craft materials and outsourced cutting. With one SMARTS-SHAPES machine, that cost "
         "drops by 60–80%. The machine pays for itself in under a year. Want the ROI sheet for "
         "DPS Dwarka? — SmartShape",
         "sent", 4),
        ("Ramesh", "9876543210",
         "Day 7: Hello Ramesh ji! 🎯 Our live demo takes just 20 minutes and always impresses "
         "the whole school team. You'll see perfect die-cut shapes from foam, paper, and fabric "
         "in seconds — no skill needed. Can we book a demo visit this week? — SmartShape",
         "pending", 0),
        ("Priya", "9876543211",
         "Day 0: Hello Priya! 👋 I'm from SmartShape — makers of the SMARTS-SHAPES die-cutting "
         "machine. With this one machine your school creates perfect shapes, decorations, and "
         "craft materials for every class activity — no scissors, no waste. 1,500+ teachers "
         "love it! Can I show you how? — SmartShape",
         "sent", 5),
        ("Priya", "9876543211",
         "Day 3: Hello Priya! 🌟 Our SMARTS-SHAPES die library has 750+ designs — alphabets, "
         "animals, festive shapes, STEM sets, borders, and more. New dies every quarter. "
         "Teachers plan the whole year's activity calendar from it. Want the full catalogue? "
         "— SmartShape",
         "pending", 0),
    ]
    for name, phone, msg, status, days_ago in drip_steps:
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": f"sched_{uuid.uuid4().hex[:10]}",
            "campaign_id": None,
            "contact_name": name,
            "phone": phone,
            "message": msg,
            "status": status,
            "queued_at": (now - timedelta(days=days_ago)).isoformat(),
            "sent_at": (now - timedelta(days=days_ago)).isoformat() if status == "sent" else None,
            "type": "drip", "is_demo": True,
        })
        created["messages"] += 1

    # ── 6. Drip enrollments ────────────────────────────────────────────────────
    sequences = await db.drip_sequences.find({}).to_list(3)
    if sequences:
        seq = sequences[0]
        for i, c_data in enumerate(DEMO_CONTACTS[:3]):
            status = "completed" if i == 2 else "active"
            await db.drip_enrollments.insert_one({
                "enrollment_id": f"enroll_{uuid.uuid4().hex[:10]}",
                "sequence_id": seq["sequence_id"],
                "lead_id": f"lead_demo_{i+1}",
                "contact_name": c_data["first_name"],
                "current_step": 2 if status == "completed" else i,
                "status": status,
                "enrolled_at": (now - timedelta(days=7 - i)).isoformat(),
                "next_step_at": (now + timedelta(days=3)).isoformat() if status == "active" else None,
                "last_step_at": (now - timedelta(days=i)).isoformat(),
                "completed_at": now.isoformat() if status == "completed" else None,
                "enrolled_by": "auto",
                "is_demo": True,
            })
            created["enrollments"] += 1

    # ── 7. Greeting messages (type=greeting) and greeting logs ─────────────────
    greeting_demos = [
        ("Ramesh",  "9876543210",
         "Happy Teachers' Day Ramesh ji! 🍎 You are not just a teacher — you are a "
         "life-changer and a nation-maker. SmartShape is deeply honoured to be part of "
         "your school's creative journey. Thank you for everything you do! 🙏 — SmartShape Team",
         "Teachers' Day", 2025, 260),
        ("Priya",   "9876543211",
         "Happy Teachers' Day Priya! 🍎 Teaching is the profession that creates all other "
         "professions. SmartShape is proud to support the incredible work you do every day "
         "in the classroom. Warm wishes from our whole team! 🙏 — SmartShape Team",
         "Teachers' Day", 2025, 260),
        ("Ramesh",  "9876543210",
         "Happy New Year Ramesh ji! 🎆 SmartShape wishes you, DPS Dwarka, and all your "
         "wonderful students a prosperous, creative, and joyful New Year ahead. May 2026 "
         "bring more creativity and achievement to every classroom! 🌟 — SmartShape Team",
         "New Year's Day", 2026, 145),
        ("Anita",   "9876543213",
         "Happy New Year Anita! 🎆 SmartShape wishes you, Ryan International, and all your "
         "wonderful students a prosperous, creative, and joyful New Year ahead. May 2026 "
         "bring more creativity and achievement to every classroom! 🌟 — SmartShape Team",
         "New Year's Day", 2026, 145),
        ("Suresh",  "9876543214",
         "Happy New Year Suresh! 🎆 SmartShape wishes you, DAV Public School, and all your "
         "wonderful students a prosperous, creative, and joyful New Year ahead. May 2026 "
         "bring more creativity and achievement to every classroom! 🌟 — SmartShape Team",
         "New Year's Day", 2026, 145),
    ]
    for name, phone, msg, rule_name, year, days_ago in greeting_demos:
        # Insert into whatsapp_scheduled
        await db.whatsapp_scheduled.insert_one({
            "scheduled_id": f"sched_{uuid.uuid4().hex[:10]}",
            "contact_name": name,
            "phone": phone,
            "message": msg,
            "status": "sent",
            "queued_at": (now - timedelta(days=days_ago)).isoformat(),
            "sent_at":   (now - timedelta(days=days_ago)).isoformat(),
            "type": "greeting", "is_demo": True,
        })
        created["messages"] += 1

        # Insert greeting log
        rule = await db.greeting_rules.find_one({"name": rule_name})
        if rule:
            contact = await db.contacts.find_one({"phone": phone})
            await db.greeting_logs.insert_one({
                "log_id": f"glog_{uuid.uuid4().hex[:10]}",
                "rule_id": rule["rule_id"],
                "rule_name": rule_name,
                "contact_id": contact["contact_id"] if contact else phone,
                "contact_name": name,
                "phone": phone,
                "year": year,
                "sent_at": (now - timedelta(days=days_ago)).isoformat(),
                "is_demo": True,
            })
            created["greetings"] += 1

    return {
        "seeded": True,
        "summary": {
            "contacts_added": created["contacts"],
            "campaigns": "3 (1 completed · 1 queued · 1 draft)",
            "whatsapp_messages": created["messages"],
            "drip_enrollments": created["enrollments"],
            "greeting_logs": created["greetings"],
        },
        "story": (
            "Ramesh Kumar (DPS Principal) received a Diwali demo invitation, was enrolled in "
            "the Principal Machine Pitch drip sequence (₹2–5L savings pitch → ROI sheet → demo "
            "booking), and received New Year + Teachers' Day greetings. "
            "2 campaigns: demo drive to principals queued, Annual Day pitch in draft."
        ),
    }


@router.delete("/demo/marketing")
async def clear_demo_marketing(request: Request):
    """Remove all demo-tagged documents from every collection."""
    await get_current_user(request)
    results = {}
    for coll_name in ("contacts", "whatsapp_campaigns", "whatsapp_scheduled",
                      "drip_enrollments", "greeting_logs"):
        coll = getattr(db, coll_name)
        r = await coll.delete_many({"is_demo": True})
        results[coll_name] = r.deleted_count
    return {"cleared": results}
