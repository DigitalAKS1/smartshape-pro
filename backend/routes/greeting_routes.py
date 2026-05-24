from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── 26 pre-seeded Indian festival / important day rules ────────────────────────
# fixed_date format: MM-DD  |  is_date_fixed: False = changes yearly (update each Jan)
_DEFAULT_RULES = [
    # ── Personal ──────────────────────────────────────────────────────────────
    {
        "name": "Birthday Greetings",
        "type": "birthday", "category": "Personal",
        "trigger": "birthday", "fixed_date": None, "is_date_fixed": None,
        "audience": "birthday_person",
        "template_body": (
            "Happy Birthday {name}! 🎂🎉 On this special day, SmartShape wishes you a year "
            "filled with happiness, health and wonderful achievements. Many happy returns of "
            "the day! 🎈 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "School Anniversary",
        "type": "anniversary", "category": "Personal",
        "trigger": "anniversary", "fixed_date": None, "is_date_fixed": None,
        "audience": "primary_contact",
        "template_body": (
            "Happy School Anniversary {name}! 🎓🎊 Congratulations on another magnificent year "
            "of shaping young minds and building futures. SmartShape is truly honoured to be part "
            "of your school's journey. Here's to many more years of excellence! 🌟 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },

    # ── National Days (fixed dates) ────────────────────────────────────────────
    {
        "name": "New Year's Day",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "01-01", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy New Year {name}! 🎆 SmartShape wishes you, your school family and all your "
            "wonderful students a prosperous, creative and joyful New Year ahead. May this year "
            "be your school's best yet! 🌟 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Makar Sankranti",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "01-14", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Makar Sankranti {name}! 🪁 May this auspicious harvest festival bring "
            "warmth, sweetness and new beginnings to your school family. Til-Gul Ghya, God God "
            "Bola! 🌾 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Republic Day",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "01-26", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Republic Day {name}! 🇮🇳 On this proud day, we celebrate India's "
            "Constitution and the democratic values we teach our children every day. "
            "SmartShape is deeply honoured to serve India's education community. Jai Hind! 🙏"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Basant Panchami / Saraswati Puja",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "02-02", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Saraswati Puja ki Hardik Shubhkamnaen {name}! 🌼 May Goddess Saraswati — "
            "the divine patron of knowledge, arts and wisdom — bless your students with "
            "creativity and excellence. A very Happy Basant Panchami from SmartShape! 🙏"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Holi",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "03-14", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Holi {name}! 🎨🌈 May the vibrant colours of Holi fill your school with "
            "joy, laughter and togetherness. Wishing your students a safe, colourful and "
            "unforgettable celebration! — SmartShape Team 🥳"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Ugadi / Gudi Padwa",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "03-30", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Ugadi / Gudi Padwa {name}! 🌺 May the New Year bring your school abundant "
            "success, happiness and fresh beginnings. Ugadi Shubhashayagalu! 🙏 "
            "— SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Baisakhi",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "04-13", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Baisakhi {name}! 🌾 May this golden harvest festival bring abundant joy, "
            "success and prosperity to your school family. Wishing everyone a wonderful "
            "Baisakhi celebration! — SmartShape Team 🎉"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Ambedkar Jayanti",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "04-14", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "On this Ambedkar Jayanti, we pay our deepest respects to Dr. B.R. Ambedkar — "
            "the great champion of education, equality and justice. {name}, let us inspire "
            "our students to uphold his timeless values. 🙏 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "World Earth Day",
        "type": "festival", "category": "Global",
        "trigger": "fixed_date", "fixed_date": "04-22", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Earth Day {name}! 🌍🌱 Today let us pledge to inspire our students to love "
            "and protect our beautiful planet. SmartShape is committed to eco-conscious school "
            "materials. Together, let's build a greener future! 💚 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Back to School",
        "type": "festival", "category": "School",
        "trigger": "fixed_date", "fixed_date": "06-01", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "New academic year, fresh possibilities! 📚✂️ {name}, SmartShape is fully stocked "
            "and ready to power your school's craft activities for the new session. Reply to "
            "get your annual supply catalogue and special bulk pricing! — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "World Environment Day",
        "type": "festival", "category": "Global",
        "trigger": "fixed_date", "fixed_date": "06-05", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy World Environment Day {name}! 🌿 Let's make our classrooms champions of "
            "sustainability. SmartShape uses responsibly sourced materials in all our craft "
            "kits because we believe every school can make a difference. 🌳 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Independence Day",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "08-15", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Independence Day {name}! 🇮🇳 Jai Hind! SmartShape salutes every teacher, "
            "principal and school leader who shapes the next generation of proud Indians. "
            "Thank you for your extraordinary dedication! 🙏 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Raksha Bandhan",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "08-09", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Raksha Bandhan {name}! 💝 May the sacred bond of love, trust and protection "
            "grow stronger every year. Wishing you and your school family a joyful and "
            "memorable Raksha Bandhan! 🌸 — SmartShape Family"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Janmashtami",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "08-16", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Janmashtami {name}! 🦚🪈 May Lord Krishna's divine wisdom, boundless "
            "creativity and eternal joy fill your school with happiness and blessings. "
            "Jai Shri Krishna! 🙏 — SmartShape Team"
        ),
        "is_active": False, "sent_total": 0,
    },
    {
        "name": "Ganesh Chaturthi",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "08-22", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Ganesh Chaturthi {name}! 🐘 May Lord Ganesha — the remover of obstacles "
            "and patron of new beginnings — bless your school with wisdom, success and "
            "prosperity. Ganapati Bappa Morya! 🪷 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Teachers' Day",
        "type": "festival", "category": "School",
        "trigger": "fixed_date", "fixed_date": "09-05", "is_date_fixed": True,
        "audience": "role:Teacher",
        "template_body": (
            "Happy Teachers' Day {name}! 🍎 You are not just a teacher — you are a "
            "life-changer, a dream-builder and a nation-maker. The impact you make every "
            "single day is immeasurable. SmartShape is deeply honoured to serve you. "
            "Thank you for everything! 🙏 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Gandhi Jayanti",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "10-02", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Gandhi Jayanti {name}! 🕊️ Bapu said: 'Live as if you were to die tomorrow. "
            "Learn as if you were to live forever.' May his timeless wisdom guide our students "
            "to become better human beings. Jai Hind! — SmartShape"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Dussehra",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "10-12", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Happy Dussehra {name}! 🏹 May the victory of good over evil inspire your students "
            "to always stand for truth and righteousness. Vijayadashami ki Shubhkamnaen! "
            "🙏 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Diwali",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "10-20", "is_date_fixed": False,
        "audience": "all_contacts",
        "template_body": (
            "Shubh Deepawali {name}! 🪔✨ May this festival of lights illuminate every corner "
            "of your school with joy, prosperity and creativity. SmartShape wishes your entire "
            "school family a sparkling Diwali filled with love, laughter and new dreams! "
            "🎆 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Children's Day",
        "type": "festival", "category": "School",
        "trigger": "fixed_date", "fixed_date": "11-14", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Children's Day {name}! 👧🎈 Every child is an unwritten story, an undiscovered "
            "talent and an unlimited future. SmartShape is proud to fuel their creativity and "
            "imagination every day. Here's to the little champions who make every school "
            "worth building! 🌟 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Constitution Day",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "11-26", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Happy Constitution Day {name}! 📜 On Samvidhan Divas, we honour the visionaries "
            "who gifted India its democratic Constitution. May our schools inspire every student "
            "to be a responsible, compassionate and informed citizen. 🇮🇳 — SmartShape"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Christmas",
        "type": "festival", "category": "Festival",
        "trigger": "fixed_date", "fixed_date": "12-25", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Merry Christmas {name}! 🎄🌟 May the joy, peace and warmth of Christmas fill your "
            "school with happiness and togetherness. Wishing you and your students a wonderful "
            "holiday season full of laughter and beautiful memories! 🎁 — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
    {
        "name": "Year End Wishes",
        "type": "festival", "category": "National",
        "trigger": "fixed_date", "fixed_date": "12-31", "is_date_fixed": True,
        "audience": "all_contacts",
        "template_body": (
            "Dear {name}, as this year draws to a close, SmartShape is deeply grateful for "
            "your trust and partnership. Thank you for letting us be part of your school's "
            "creative journey. Here's wishing you, your team and all your students an "
            "extraordinary New Year ahead! 🥂✨ — SmartShape Team"
        ),
        "is_active": True, "sent_total": 0,
    },
]


async def _seed_defaults():
    count = await db.greeting_rules.count_documents({})
    if count > 0:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    for rule in _DEFAULT_RULES:
        await db.greeting_rules.insert_one({
            "rule_id": f"greet_{uuid.uuid4().hex[:10]}",
            **rule,
            "created_by": "system",
            "created_at": now_iso,
            "updated_at": now_iso,
        })


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/greetings/rules")
async def list_rules(request: Request):
    await get_current_user(request)
    await _seed_defaults()
    this_year = datetime.now(timezone.utc).year
    rules = await db.greeting_rules.find({}, {"_id": 0}).sort("fixed_date", 1).to_list(200)
    for r in rules:
        r["sent_this_year"] = await db.greeting_logs.count_documents(
            {"rule_id": r["rule_id"], "year": this_year}
        )
    return rules


@router.post("/greetings/rules")
async def create_rule(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(400, "name is required")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "rule_id": f"greet_{uuid.uuid4().hex[:10]}",
        "name": body["name"].strip(),
        "type": body.get("type", "festival"),
        "category": body.get("category", "Festival"),
        "trigger": body.get("trigger", "fixed_date"),
        "fixed_date": (body.get("fixed_date") or "").strip() or None,
        "is_date_fixed": body.get("is_date_fixed", True),
        "audience": body.get("audience", "all_contacts"),
        "template_body": body.get("template_body", "").strip(),
        "is_active": bool(body.get("is_active", True)),
        "sent_total": 0,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.greeting_rules.insert_one(doc)
    doc.pop("_id", None)
    doc["sent_this_year"] = 0
    return doc


@router.put("/greetings/rules/{rule_id}")
async def update_rule(rule_id: str, request: Request):
    await get_current_user(request)
    if not await db.greeting_rules.find_one({"rule_id": rule_id}):
        raise HTTPException(404, "Rule not found")
    body = await request.json()
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "type", "category", "trigger", "fixed_date", "is_date_fixed",
                  "audience", "template_body", "is_active"):
        if field in body:
            updates[field] = body[field]
    await db.greeting_rules.update_one({"rule_id": rule_id}, {"$set": updates})
    doc = await db.greeting_rules.find_one({"rule_id": rule_id}, {"_id": 0})
    doc["sent_this_year"] = await db.greeting_logs.count_documents(
        {"rule_id": rule_id, "year": datetime.now(timezone.utc).year}
    )
    return doc


@router.delete("/greetings/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    await get_current_user(request)
    if not await db.greeting_rules.find_one({"rule_id": rule_id}):
        raise HTTPException(404, "Rule not found")
    await db.greeting_rules.delete_one({"rule_id": rule_id})
    return {"ok": True}


@router.get("/greetings/logs")
async def list_logs(request: Request):
    await get_current_user(request)
    params = dict(request.query_params)
    filt = {}
    if params.get("rule_id"):   filt["rule_id"] = params["rule_id"]
    if params.get("year"):      filt["year"] = int(params["year"])
    return await db.greeting_logs.find(filt, {"_id": 0}).sort("sent_at", -1).to_list(500)
