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

    # ── 2. Campaign A — COMPLETED: Diwali Offer (all 5 contacts) ─────────────
    camp_a_id = f"camp_{uuid.uuid4().hex[:10]}"
    diwali_msg = (
        "Shubh Deepawali {name}! 🪔✨ SmartShape has a special Diwali offer — "
        "20% off all craft kits for {school_name}. Place your order before Oct 25 "
        "and get free shipping! — SmartShape Team"
    )
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": camp_a_id,
        "name": f"Diwali Special Offer 2025 {DEMO_MARKER}",
        "description": "Festival season discount blast to all school contacts",
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

    # ── 3. Campaign B — QUEUED: New Academic Year (principals only) ───────────
    camp_b_id = f"camp_{uuid.uuid4().hex[:10]}"
    session_msg = (
        "Hello {name}! 🎒 The new academic year is almost here! "
        "Is {school_name} stocked up on craft materials for the new session? "
        "SmartShape has everything — colours, clay, die cuts, and activity kits. "
        "Order now for priority pre-session delivery! — SmartShape"
    )
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": camp_b_id,
        "name": f"New Academic Year 2026 Launch {DEMO_MARKER}",
        "description": "Pre-session catalogue push to school principals",
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

    # ── 4. Campaign C — DRAFT: Year End Clearance ─────────────────────────────
    await db.whatsapp_campaigns.insert_one({
        "campaign_id": f"camp_{uuid.uuid4().hex[:10]}",
        "name": f"Year End Clearance Sale {DEMO_MARKER}",
        "description": "End-of-year stock clearance offer — ready to launch",
        "template_id": None,
        "message": (
            "Hello {name}! The academic year is wrapping up — a great time to audit "
            "your craft stock and plan orders for next session! SmartShape is offering "
            "year-end clearance prices. Want the list? — SmartShape Team"
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
        ("Ramesh", "9876543210", "Day 0: Namaskar Ramesh ji! 🙏 I'm from SmartShape — India's premium school craft brand. May I share our catalogue and special school pricing? — SmartShape Team", "sent", 7),
        ("Ramesh", "9876543210", "Day 3: Hello Ramesh ji! 📚 Our 2026 School Craft Catalogue is here! New die sets, eco clay, and activity kits — all school-grade. Want the full PDF? — SmartShape", "sent", 4),
        ("Ramesh", "9876543210", "Day 7: Hello Ramesh ji! 🎉 Order above ₹10,000 this month and get a FREE Activity Craft Box (worth ₹1,500) + free shipping. Shall I call today? — SmartShape", "pending", 0),
        ("Priya",  "9876543211", "Day 0: Hello Priya! 👋 SmartShape specialises in school-grade craft materials for CBSE/ICSE schools. Can I share our latest collection? — SmartShape", "sent", 5),
        ("Priya",  "9876543211", "Day 3: Hello Priya! 🌟 Our new EVA Foam Die Cuts are perfect for art class — 200+ shapes. Schools love them! Want samples sent to your school? — SmartShape", "pending", 0),
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
        ("Ramesh",  "9876543210", "Happy Teachers' Day Ramesh! 🍎 You are not just a teacher — you are a life-changer and a nation-maker. SmartShape is deeply honoured to serve you. Thank you for everything! 🙏 — SmartShape Team", "Teachers' Day", 2025, 260),
        ("Priya",   "9876543211", "Happy Teachers' Day Priya! 🍎 You are not just a teacher — you are a life-changer and a nation-maker. SmartShape is deeply honoured to serve you. Thank you for everything! 🙏 — SmartShape Team", "Teachers' Day", 2025, 260),
        ("Ramesh",  "9876543210", "Happy New Year Ramesh! 🎆 SmartShape wishes you, your school family and all your wonderful students a prosperous, creative and joyful New Year ahead. 🌟 — SmartShape Team", "New Year's Day", 2026, 145),
        ("Anita",   "9876543213", "Happy New Year Anita! 🎆 SmartShape wishes you, your school family and all your wonderful students a prosperous, creative and joyful New Year ahead. 🌟 — SmartShape Team", "New Year's Day", 2026, 145),
        ("Suresh",  "9876543214", "Happy New Year Suresh! 🎆 SmartShape wishes you, your school family and all your wonderful students a prosperous, creative and joyful New Year ahead. 🌟 — SmartShape Team", "New Year's Day", 2026, 145),
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
            "Ramesh Kumar (DPS Principal) received a Diwali offer, was enrolled in a drip "
            "sequence, and got New Year + Teachers' Day greetings. "
            "2 campaigns queued for principals. 1 draft ready to launch."
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
