from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta
import asyncio
import re
import uuid

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_module, sees_all
from routes.crm_routes import create_physical_from_drip
from services.tag_scope import resolve_tag_scope
from services.drip_recipient import (CONTACT_DELETED_REASON, RECIPIENT_GONE_REASON,
                                     contacts_already_enrolled, find_active_duplicate)

router = APIRouter()

# ── Pre-seed defaults ────────────────────────────────────────────────────────
# ── SmartShape sales cycle sequences for the SMARTS-SHAPES cutting machine ────
_DEFAULT_SEQUENCES = [
    {
        "name": "Principal Machine Pitch",
        "description": "Full nurture journey for Principals — WhatsApp, a posted brochure, calls and a sample kit over 45 days",
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
                "step_number": 2, "delay_days": 2, "message_type": "physical_material",
                "material_type": "brochure", "material_name": "2026 Die Catalogue + savings sheet",
                "message_template": (
                    "Post the 2026 Die Catalogue with the savings sheet to the Principal. The mailer "
                    "carries a QR — a scan tells us the school is warm, so watch Offline Mail."
                ),
            },
            {
                "step_number": 3, "delay_days": 5, "message_type": "call_task",
                "message_template": (
                    "Call the Principal — did the catalogue reach you? Ask which activity the school "
                    "spends the most teacher-hours on. Do not pitch; listen and note the answer."
                ),
            },
            {
                "step_number": 4, "delay_days": 9, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 📹 A 40-second clip of SMARTS-SHAPES actually cutting — 100+ shapes "
                    "an hour, bulletin boards and teaching aids in minutes. Schools using it save ₹2–5 "
                    "lakh a year on craft teachers, materials and prep hours. Shall I send a savings "
                    "estimate for {school_name}? — SmartShape"
                ),
            },
            {
                "step_number": 5, "delay_days": 14, "message_type": "email",
                "message_template": (
                    "Dear {name},<br><br>Attached is a short case study from a school of similar size to "
                    "{school_name}, along with our 2026 die library.<br><br>Most Principals forward this "
                    "to their management committee, so it is written to be read without me in the "
                    "room.<br><br>Happy to arrange a free demo at your school whenever it suits.<br><br>"
                    "Warm regards,<br>SmartShape Team"
                ),
            },
            {
                "step_number": 6, "delay_days": 21, "message_type": "call_task",
                "message_template": (
                    "Call to offer a free 15-minute demo at the school. Five touches of value have gone "
                    "out — this is the ask. Offer two specific slots rather than 'sometime next week'."
                ),
            },
            {
                "step_number": 7, "delay_days": 30, "message_type": "physical_material",
                "material_type": "sample", "material_name": "Physical cut samples (5 designs)",
                "message_template": (
                    "Post the 5-design sample pack. Highest-cost touch in the sequence — send only if "
                    "the school is still responding. Mark it Not sent with a reason if it has gone cold."
                ),
            },
            {
                "step_number": 8, "delay_days": 45, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 🎒 Schools that install before the session starts get priority "
                    "installation, free teacher training worth ₹25,000 and the 2026 Premium Die Library. "
                    "Slots are limited and go in order of confirmation. Shall I hold one for "
                    "{school_name}? — SmartShape Team"
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Teacher Awareness Series",
        "description": "Teacher-focused nurture — show how SMARTS-SHAPES removes hours of craft prep",
        "trigger": "lead_created",
        "filter_designation": "Teacher",
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 👋 I'm from SmartShape — we make the SMARTS-SHAPES cutting machine "
                    "used by 1,500+ teachers across India. Bulletin boards, teaching aids and activity "
                    "kits in minutes — no scissors, no hours of prep. Would you like to see how it "
                    "works? — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 3, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! ✂️ 100 perfect butterfly shapes for a Science lesson in under 5 "
                    "minutes. An entire festive bulletin board in an hour. That is what SMARTS-SHAPES "
                    "does for teachers every day — your prep time drops to almost nothing. Shall I show "
                    "you? — SmartShape"
                ),
            },
            {
                "step_number": 3, "delay_days": 7, "message_type": "email",
                "message_template": (
                    "Dear {name},<br><br>Here is our Activity Ideas pack — 30 ready-to-cut classroom "
                    "projects across Maths, Science and Art, with the die list for each.<br><br>Teachers "
                    "tell us this is the part that makes the machine click, so do share it in your "
                    "staff room.<br><br>Warm regards,<br>SmartShape Team"
                ),
            },
            {
                "step_number": 4, "delay_days": 12, "message_type": "call_task",
                "message_template": (
                    "Call the teacher and offer a free 15-minute demo in the school. Ask who else should "
                    "be in the room — the Principal or the activity head usually signs off."
                ),
            },
            {
                "step_number": 5, "delay_days": 20, "message_type": "physical_material",
                "material_type": "sample", "material_name": "Teacher sample pack + activity cards",
                "message_template": (
                    "Post the teacher sample pack with the activity cards. Something they can hold in "
                    "the staff room does more than any message."
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Post-Demo / Quotation Follow-up",
        "description": "After a demo or quotation — close the loop over 18 days without nagging",
        "trigger": "quotation_sent",
        "filter_designation": None,
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Thank you for your time today, {name} ji! 🙏 Your quotation for {school_name} is on "
                    "its way. Any question at all — price, installation, training — just reply here and "
                    "I'll answer straight away. — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 2, "message_type": "call_task",
                "message_template": (
                    "Call to walk through the quotation line by line. Most objections at this stage are "
                    "about installation and training, not price — ask directly which one is on their mind."
                ),
            },
            {
                "step_number": 3, "delay_days": 5, "message_type": "email",
                "message_template": (
                    "Dear {name},<br><br>Attaching the written proposal for {school_name}, along with "
                    "references from two schools nearby who are happy to take your call.<br><br>"
                    "Everything you need to put this in front of your committee is in one place here."
                    "<br><br>Warm regards,<br>SmartShape Team"
                ),
            },
            {
                "step_number": 4, "delay_days": 10, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name} ji! 📋 Just checking whether the committee has had a chance to look at "
                    "the proposal. If anything needs changing — configuration, payment terms, delivery "
                    "date — tell me and I'll revise it today. — SmartShape"
                ),
            },
            {
                "step_number": 5, "delay_days": 18, "message_type": "call_task",
                "message_template": (
                    "Decision call. Ask for a yes or a no, not a maybe — and if it is no, ask what would "
                    "have made it a yes. Record the answer as the lost reason; it feeds the funnel report."
                ),
            },
        ],
        "is_active": True,
    },
    {
        "name": "Re-engagement: Cold Leads",
        "description": "Revive leads that went silent — a message, a posted catalogue and one honest call",
        "trigger": "manual",
        "filter_designation": None,
        "steps": [
            {
                "step_number": 1, "delay_days": 0, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 👋 It's been a while since we last connected — a lot has happened at "
                    "SmartShape! We've upgraded the machine, launched 200+ new die designs, and onboarded "
                    "100+ new schools this year. I'd love to show you what {school_name} can now achieve. "
                    "Just 10 minutes? — SmartShape Team"
                ),
            },
            {
                "step_number": 2, "delay_days": 4, "message_type": "physical_material",
                "material_type": "brochure", "material_name": "2026 Die Catalogue (what's new)",
                "message_template": (
                    "Post the new catalogue to a lead that stopped replying online. A cover on the desk "
                    "gets opened when a message does not — and the QR tells us the moment it works."
                ),
            },
            {
                "step_number": 3, "delay_days": 10, "message_type": "call_task",
                "message_template": (
                    "Call once, warmly. Reference the catalogue you posted. If the timing is genuinely "
                    "wrong, ask when to come back and set that date — do not keep the lead open by default."
                ),
            },
            {
                "step_number": 4, "delay_days": 20, "message_type": "whatsapp",
                "message_template": (
                    "Hello {name}! 🙏 One final message from SmartShape. We've genuinely helped 750+ "
                    "schools save lakhs and transform their activity programmes. Whenever you're ready "
                    "to explore, we'll be right here. Wishing {school_name} a wonderful year ahead! "
                    "— SmartShape Team"
                ),
            },
        ],
        "is_active": False,
    },
]


# Stock sequences used to carry their step count in the name ("(7-step)"), which went
# stale the moment the cadence changed. Old name -> current name, migrated in place so
# the live enrolments on the original are kept instead of orphaned beside a copy.
_RENAMED_DEFAULTS = {
    "Principal Machine Pitch (7-step)":       "Principal Machine Pitch",
    "Teacher Awareness Series (5-step)":      "Teacher Awareness Series",
    "Post-Demo / Quotation Follow-up (5-step)": "Post-Demo / Quotation Follow-up",
    "Re-engagement: Cold Leads (3-step)":     "Re-engagement: Cold Leads",
}


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

    # Migrate the old counted names before seeding, so we rename rather than duplicate.
    # A sequence the owner customised keeps whatever name they gave it.
    for old_name, new_name in _RENAMED_DEFAULTS.items():
        # `is not None`, never truthiness: a projection that excludes _id returns an
        # EMPTY DICT for a document missing the projected field, and {} is falsy.
        if await db.drip_sequences.find_one({"name": new_name}) is not None:
            continue                       # already migrated
        await db.drip_sequences.update_one(
            {"name": old_name, "created_by": "system", "customised": {"$ne": True}},
            {"$set": {"name": new_name, "name_lower": new_name.lower(),
                      "updated_at": now_iso}})

    for seq in _DEFAULT_SEQUENCES:
        # Fetch the whole document and test `is not None`. Projecting to
        # {"_id": 0, "customised": 1} returns {} for the pre-existing production
        # documents that have no `customised` field yet — and {} is falsy, which sent
        # this branch to the insert and duplicated every stock sequence on every load.
        existing = await db.drip_sequences.find_one(
            {"name": seq["name"], "created_by": "system"}, {"_id": 0})
        if existing is None:
            # A3: the name may already belong to a hand-made sequence. The lookup
            # above only sees `created_by: "system"`, so without this the seeder
            # would insert a system TWIN beside the owner's own sequence and both
            # would sit in the list under the same name.
            if await db.drip_sequences.find_one({"name": seq["name"]}, {"_id": 0}) is not None:
                continue                      # the owner owns this name — hands off
        if existing is not None:
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
                "name_lower": seq["name"].lower(),
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
    if not (body.get("name") or "").strip():
        raise HTTPException(400, "name is required")
    name = body["name"].strip()
    steps = _normalise_steps(body.get("steps", []))

    # Duplicate guard (D7) — the same belt-and-braces shape as the quotation one
    # (quotation_routes.py:506-518), because the owner ended up with 2-3 copies of
    # the same sequence: Enter in the name box fires save() again while the first
    # POST is still in flight, and this route used to insert unconditionally.
    # `drip_sequences` has no soft delete (DELETE removes the document), so there
    # is no is_deleted flag to exclude here.
    # `name_lower` is written on create/update, but legacy documents predate it —
    # the anchored case-insensitive regex catches those too.
    existing = await db.drip_sequences.find_one(
        {"$or": [{"name_lower": name.lower()},
                 {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}]},
        {"_id": 0})
    if existing is not None:
        # (b) Idempotency window: same creator + same name + same step count within
        # 30s is one intent double-submitted — hand back the document we just made.
        recent_cutoff = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
        if (existing.get("created_by") == user["email"]
                and (existing.get("created_at") or "") >= recent_cutoff
                and len(existing.get("steps") or []) == len(steps)):
            return await _enrich(existing)
        # (a) A deliberate second sequence under a name already in use.
        raise HTTPException(409, f'A sequence called "{existing.get("name")}" already exists')

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "sequence_id": f"drip_{uuid.uuid4().hex[:10]}",
        "name": name,
        "name_lower": name.lower(),
        "description": body.get("description", "").strip(),
        "trigger": body.get("trigger", "manual"),
        "filter_designation": (body.get("filter_designation") or "").strip() or None,
        "steps": steps,
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
    if "name" in body:
        # Keep the dedupe key true after a rename, or the next create could twin it.
        nm = (body.get("name") or "").strip()
        if not nm:
            raise HTTPException(400, "name is required")
        # A rename must not land on ANOTHER sequence's name — that would recreate
        # the duplicate-in-the-list state the create guard exists to prevent.
        clash = await db.drip_sequences.find_one(
            {"sequence_id": {"$ne": sequence_id},
             "$or": [{"name_lower": nm.lower()},
                     {"name": {"$regex": f"^{re.escape(nm)}$", "$options": "i"}}]},
            {"_id": 0, "name": 1})
        if clash is not None:
            raise HTTPException(409, f'A sequence called "{clash.get("name")}" already exists')
        updates["name"] = nm
        updates["name_lower"] = nm.lower()
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
        # Same person, same sequence, never twice — incl. the lead's contact (R3).
        if await find_active_duplicate(db, seq["sequence_id"], lead_id=lead_doc["lead_id"]):
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

def _dup_message(existing: dict, *, asked_lead: bool) -> str:
    """Why a second enrolment was refused, naming the cross case plainly."""
    if asked_lead and existing.get("lead_id") is None and existing.get("contact_id"):
        return ("This lead's contact is already running this sequence — the same "
                "person would get every message twice.")
    if not asked_lead and existing.get("lead_id"):
        return ("This contact's lead is already running this sequence — the same "
                "person would get every message twice.")
    return ("Lead is already actively enrolled in this sequence" if asked_lead
            else "Contact is already actively enrolled in this sequence")


@router.post("/drip/enroll")
async def enroll_lead(request: Request):
    """Enrol ONE lead or ONE contact (D5) — `{sequence_id, lead_id}` or
    `{sequence_id, contact_id}`, never both. Refuses a second active enrolment
    for the same person, including a contact whose linked lead is already in
    the sequence and vice-versa."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    sequence_id = body.get("sequence_id")
    lead_id = body.get("lead_id") or None
    contact_id = body.get("contact_id") or None
    if not sequence_id or (not lead_id and not contact_id):
        raise HTTPException(400, "sequence_id and a lead_id or contact_id are required")
    if lead_id and contact_id:
        raise HTTPException(400, "Enrol a lead or a contact, not both at once")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq:
        raise HTTPException(404, "Sequence not found")
    if not seq.get("steps"):
        raise HTTPException(400, "Sequence has no steps")

    school_id = ""
    if contact_id:
        contact = await db.contacts.find_one(
            {"contact_id": contact_id, "is_deleted": {"$ne": True}},
            {"_id": 0, "contact_id": 1, "school_id": 1})
        if not contact:
            raise HTTPException(404, "Contact not found")
        if not sees_all(user, "leads"):
            from routes.crm_routes import _contacts_visibility_or, _merge_or
            vq = _merge_or({"contact_id": contact_id},
                           await _contacts_visibility_or(user["email"]))
            if not await db.contacts.find_one(vq, {"_id": 0, "contact_id": 1}):
                raise HTTPException(403, "Not authorized for this contact")
        school_id = contact.get("school_id") or ""
    else:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
        school_id = (lead or {}).get("school_id") or ""

    existing = await find_active_duplicate(db, sequence_id, lead_id=lead_id, contact_id=contact_id)
    if existing:
        raise HTTPException(409, _dup_message(existing, asked_lead=bool(lead_id)))
    now = datetime.now(timezone.utc)
    first_delay = seq["steps"][0].get("delay_days", 0)
    enr = {
        "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
        "sequence_id": sequence_id,
        # Exactly one of the two is set; the other is written as null so every
        # new enrolment has the same shape.
        "lead_id": lead_id,
        "contact_id": contact_id,
        "school_id": school_id,
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


_CONTACT_BULK_CAP = 2000


@router.post("/drip/enroll-contacts")
async def enroll_contacts(request: Request):
    """Enrol many CONTACTS in one sequence — `{sequence_id, contact_ids[]}` or
    `{sequence_id, tag_id}` (both may be given; the sets are unioned).

    A tag reaches the people who carry it themselves (D1) — never their
    colleagues at the same school. A caller without "all" scope reaches only
    the contacts GET /contacts shows them; the rest are counted, not enrolled
    and not a 403 for the batch. Deleted contacts are skipped. A contact with
    no phone and no email is still enrolled (a post or call step can reach
    them) and counted in `no_channel`. No lead is created.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    sequence_id = body.get("sequence_id")
    raw_ids = body.get("contact_ids") or []
    tag_id = (body.get("tag_id") or "").strip() if isinstance(body.get("tag_id"), str) else ""
    if not sequence_id:
        raise HTTPException(400, "sequence_id is required")
    if not isinstance(raw_ids, list):
        raise HTTPException(400, "contact_ids must be a list")
    ids = [c for c in raw_ids if isinstance(c, str) and c]

    matched_by_tag = 0
    if tag_id:
        tagged = sorted((await resolve_tag_scope(db, tag_id))["contact_ids"], key=str)
        matched_by_tag = len(tagged)
        ids.extend(tagged)
        if not ids:
            raise HTTPException(400, "That tag matched no contacts, so nobody was enrolled.")
    if not ids:
        raise HTTPException(400, "contact_ids or tag_id is required")
    ids = list(dict.fromkeys(ids))          # dedupe, order kept
    if len(ids) > _CONTACT_BULK_CAP:
        raise HTTPException(400, f"Cannot enrol more than {_CONTACT_BULK_CAP} contacts at once")

    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq or not seq.get("steps"):
        raise HTTPException(404, "Sequence not found or has no steps")

    requested = len(ids)
    proj = {"_id": 0, "contact_id": 1, "school_id": 1, "lead_id": 1,
            "phone": 1, "email": 1, "is_deleted": 1}
    docs = {c["contact_id"]: c async for c in db.contacts.find(
        {"contact_id": {"$in": ids}}, proj)}
    live = [cid for cid in ids if cid in docs and not docs[cid].get("is_deleted")]
    skipped_missing = requested - len(live)

    skipped_not_visible = 0
    if not sees_all(user, "leads") and live:
        from routes.crm_routes import _contacts_visibility_or, _merge_or
        vq = _merge_or({"contact_id": {"$in": live}},
                       await _contacts_visibility_or(user["email"]))
        visible = {c["contact_id"] async for c in db.contacts.find(vq, {"_id": 0, "contact_id": 1})}
        skipped_not_visible = sum(1 for cid in live if cid not in visible)
        live = [cid for cid in live if cid in visible]

    covered = await contacts_already_enrolled(db, sequence_id, [docs[cid] for cid in live])
    skipped_duplicate = sum(1 for cid in live if cid in covered)
    to_enrol = [cid for cid in live if cid not in covered]

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    first_delay = seq["steps"][0].get("delay_days", 0)
    next_at = (now + timedelta(days=first_delay)).isoformat()
    rows, no_channel = [], 0
    for cid in to_enrol:
        c = docs[cid]
        if not (c.get("phone") or "").strip() and not (c.get("email") or "").strip():
            no_channel += 1
        rows.append({
            "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
            "sequence_id": sequence_id,
            "lead_id": None, "contact_id": cid, "school_id": c.get("school_id") or "",
            "current_step": 0, "status": "active", "enrolled_at": now_iso,
            "next_step_at": next_at, "last_step_at": None, "completed_at": None,
            "enrolled_by": user["email"],
        })
    if rows:
        await db.drip_enrollments.insert_many(rows)

    from routes.crm_routes import log_activity
    await log_activity(
        user["email"], "drip_enroll_contacts", "drip_sequence", sequence_id,
        details=(f"sequence={seq.get('name', '')} tag_id={tag_id or '-'} requested={requested} "
                 f"enrolled={len(rows)} skipped_duplicate={skipped_duplicate} "
                 f"skipped_not_visible={skipped_not_visible} skipped_missing={skipped_missing} "
                 f"no_channel={no_channel} contacts={','.join(to_enrol[:20])}"))

    # Same as enroll-schools: a first step due today goes out now, not in an hour.
    starting_now = False
    if rows and first_delay == 0:
        try:
            import scheduler as _sched          # lazy: avoid an import cycle
            asyncio.create_task(_sched.run_drip_executor())
            starting_now = True
        except Exception:
            starting_now = False

    return {"sequence_id": sequence_id, "sequence_name": seq.get("name", ""),
            "requested": requested, "enrolled": len(rows),
            "skipped_duplicate": skipped_duplicate,
            "skipped_not_visible": skipped_not_visible,
            "skipped_missing": skipped_missing,
            "no_channel": no_channel, "matched_by_tag": matched_by_tag,
            "starting_now": starting_now}


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
    if not isinstance(school_ids, list):
        raise HTTPException(400, "school_ids must be a list")
    school_ids = list(school_ids)   # never mutate the caller's body below
    tag_id = (body.get("tag_id") or "").strip()
    if not sequence_id:
        raise HTTPException(400, "sequence_id is required")

    # Target by tag: the labels the team already keeps become the audience, instead
    # of a list assembled by hand every time. This enrols SCHOOLS, so it takes the
    # school set of the tag roll-up (D2): a school carrying the tag itself, or one
    # where any live contact or lead carries it. Asking db.schools alone matched
    # nothing — in production no school is tagged directly, the tags sit on people.
    matched_by_tag = 0
    if tag_id:
        # key=str: the order only has to be stable, and a stray non-string id
        # must not raise a TypeError out of sorted() and 500 the request.
        tagged = sorted((await resolve_tag_scope(db, tag_id))["school_ids"], key=str)
        matched_by_tag = len(tagged)
        for sid in tagged:
            if sid not in school_ids:
                school_ids.append(sid)
        if not school_ids:
            # Enrolling nobody and reporting success is indistinguishable from a
            # campaign that ran — say so instead.
            raise HTTPException(400, "That tag matched no schools, so nobody was enrolled.")
    if not school_ids:
        raise HTTPException(400, "school_ids or tag_id is required")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq or not seq.get("steps"):
        raise HTTPException(404, "Sequence not found or has no steps")

    from routes.crm_routes import (OPEN_STAGES, _upsert_direct_mail_lead,
                                   _schools_visibility_or, _merge_or)

    # A caller without "all" scope reaches only the schools GET /schools shows
    # them — for the tag path AND hand-picked school_ids alike. The tag roll-up
    # is the whole CRM, so without this a rep's GSLC drip would enrol (and open
    # Direct-Mail leads at) other reps' schools. Out-of-reach schools are
    # counted, not silently dropped and not a 403 for the whole batch.
    school_ids = list(dict.fromkeys(s for s in school_ids if isinstance(s, str) and s))
    skipped_not_visible = 0
    if not sees_all(user, "leads"):
        vq = _merge_or({"school_id": {"$in": school_ids}},
                       await _schools_visibility_or(user["email"]))
        visible = {s["school_id"] async for s in db.schools.find(vq, {"_id": 0, "school_id": 1})}
        skipped_not_visible = sum(1 for s in school_ids if s not in visible)
        school_ids = [s for s in school_ids if s in visible]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    first_delay = seq["steps"][0].get("delay_days", 0)
    enrolled, skipped, leads_created = 0, 0, 0

    seq_deal_type = (seq.get("deal_type") or "").strip()
    for sid in school_ids:
        # Prefer an open deal of the SEQUENCE's deal type. A termly die-reorder
        # campaign must not enrol against the school's open machine deal — that
        # is one motion hijacking the other, and it is how the annuity ended up
        # with nowhere to live. A sequence with no deal type behaves as before.
        base = {"school_id": sid, "is_deleted": {"$ne": True}}
        type_q = {"deal_type": seq_deal_type} if seq_deal_type else {}
        lead = await db.leads.find_one(
            {**base, **type_q, "stage": {"$in": list(OPEN_STAGES)}}, {"_id": 0, "lead_id": 1})
        if not lead and not seq_deal_type:
            lead = await db.leads.find_one(base, {"_id": 0, "lead_id": 1})
        if not lead:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "assigned_to": 1})
            owner_email = (sch or {}).get("assigned_to") or user["email"]  # the school's sales agent
            lead_id = await _upsert_direct_mail_lead(sid, seq.get("deal_type", ""), owner_email, now_iso)
            leads_created += 1
        else:
            lead_id = lead["lead_id"]
        if not lead_id:
            continue
        # A lead whose contact is already running this sequence (enrolled as a
        # contact, D5) is the same person — skip it like any other duplicate.
        if await find_active_duplicate(db, sequence_id, lead_id=lead_id):
            skipped += 1
            continue
        await db.drip_enrollments.insert_one({
            "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
            "sequence_id": sequence_id, "lead_id": lead_id,
            "contact_id": None, "school_id": sid,
            "current_step": 0, "status": "active", "enrolled_at": now_iso,
            "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
            "last_step_at": None, "completed_at": None,
            "enrolled_by": user["email"],
        })
        enrolled += 1

    # The executor loops hourly. Without this, enrolling schools into a sequence
    # whose first step is due TODAY left Offline Mail empty for up to an hour
    # with nothing on screen to say a thing was pending — indistinguishable from
    # the feature being broken. Kick it now (as a task, so a 400-school enrolment
    # doesn't block the response) and tell the caller, so the UI can say where
    # the mailers are about to show up.
    starting_now = False
    if enrolled and first_delay == 0:
        try:
            import scheduler as _sched          # lazy: avoid an import cycle
            asyncio.create_task(_sched.run_drip_executor())
            starting_now = True
        except Exception:
            starting_now = False   # the hourly tick still picks it up

    return {"sequence_id": sequence_id, "sequence_name": seq.get("name", ""),
            "enrolled": enrolled, "skipped": skipped, "leads_created": leads_created,
            "matched_by_tag": matched_by_tag, "total": len(school_ids),
            "skipped_not_visible": skipped_not_visible,
            "starting_now": starting_now}


@router.get("/drip/enrollments")
async def list_enrollments(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    params = dict(request.query_params)
    filt = {}
    if params.get("lead_id"):      filt["lead_id"] = params["lead_id"]
    if params.get("contact_id"):   filt["contact_id"] = params["contact_id"]
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


@router.put("/drip/enrollments/{enrollment_id}/resume")
async def resume_enrollment(enrollment_id: str, request: Request):
    """Restart an enrolment the executor paused after repeated send failures.

    Clears the failure count and makes the step due now, so the very next run
    retries it — use this once the channel that was failing is configured.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    enr = await db.drip_enrollments.find_one({"enrollment_id": enrollment_id}, {"_id": 0})
    if not enr:
        raise HTTPException(404, "Enrollment not found")
    if enr.get("status") not in ("paused", "cancelled"):
        raise HTTPException(400, f"Enrollment is {enr.get('status')}, not paused")
    if enr.get("cancel_reason"):
        # Bulk-cancelled by cancel_stale_drip_enrollments.py — the owner's
        # call was "cancel all, re-enrol deliberately". Resuming would fire
        # whatever stale step the migration froze it at (or, for a formerly-
        # "completed" enrolment, leave it active with no step left to fire,
        # re-checked forever). Refuse; point at re-enrolment instead.
        if enr["cancel_reason"] in (RECIPIENT_GONE_REASON, CONTACT_DELETED_REASON):
            # Stopped because the person is gone (D5) — not the bulk migration.
            raise HTTPException(
                409, f"This enrolment cannot be resumed: {enr['cancel_reason']} "
                     "Enrol them again if they are back.")
        raise HTTPException(
            409,
            "This enrolment was cancelled in bulk and cannot be resumed. "
            "Re-enrol the lead into a current sequence instead.",
        )
    # Resuming must not put the same person in the sequence twice: while this
    # one sat paused, they may have been enrolled again (as a lead or as the
    # linked contact).
    if await find_active_duplicate(db, enr.get("sequence_id"), lead_id=enr.get("lead_id"),
                                   contact_id=enr.get("contact_id"),
                                   exclude_enrollment_id=enrollment_id):
        raise HTTPException(
            409, "This person is already running this sequence in another enrolment, "
                 "so this one cannot be resumed.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.drip_enrollments.update_one(
        {"enrollment_id": enrollment_id},
        {"$set": {"status": "active", "step_fail_count": 0, "next_step_at": now_iso,
                  "paused_reason": "", "completed_at": None}})
    return await db.drip_enrollments.find_one({"enrollment_id": enrollment_id}, {"_id": 0})


# ── What marketing is THIS school getting? ────────────────────────────────────

@router.get("/schools/{school_id}/drips")
async def school_drips(school_id: str, request: Request):
    """The sequences a school is enrolled in, from the school's side.

    The deliveries drill-down answers "who is in this sequence"; a rep about to ring
    a school needs the opposite — "what has this school already been sent, and what
    lands next?" Both read the same enrolments; only the direction differs.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read")

    leads = {l["lead_id"]: l for l in await db.leads.find(
        {"school_id": school_id},
        {"_id": 0, "lead_id": 1, "contact_name": 1, "assigned_to": 1}).to_list(500)
        if l.get("lead_id")}
    # A contact-keyed enrolment (D5) belongs to the school through its contact.
    contacts = {c["contact_id"]: c for c in await db.contacts.find(
        {"school_id": school_id},
        {"_id": 0, "contact_id": 1, "name": 1, "designation": 1, "assigned_to": 1}).to_list(2000)
        if c.get("contact_id")}
    ors = [{"school_id": school_id, "lead_id": {"$in": [None, ""]}}]
    if leads:
        ors.append({"lead_id": {"$in": list(leads)}})
    if contacts:
        ors.append({"contact_id": {"$in": list(contacts)}})

    enrolments = await db.drip_enrollments.find(
        {"$or": ors}, {"_id": 0}).sort("enrolled_at", -1).to_list(200)
    if not enrolments:
        return {"school_id": school_id, "rows": [], "active": 0, "total": 0}
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1}) or {}
    seq_ids = list({e["sequence_id"] for e in enrolments})
    seqs = {s["sequence_id"]: s for s in await db.drip_sequences.find(
        {"sequence_id": {"$in": seq_ids}}, {"_id": 0}).to_list(200)}

    rows = []
    for e in enrolments:
        seq = seqs.get(e["sequence_id"], {})
        steps = sorted(seq.get("steps", []), key=lambda x: x["step_number"])
        idx = int(e.get("current_step", 0) or 0)
        live = e.get("status") == "active" and idx < len(steps)
        nxt = steps[idx] if live else None
        lead = leads.get(e.get("lead_id")) if e.get("lead_id") else None
        contact = contacts.get(e.get("contact_id")) if e.get("contact_id") else None
        if lead:
            kind, who, owner = "lead", lead.get("contact_name", ""), lead.get("assigned_to", "")
        elif contact:
            kind, who = "contact", contact.get("name", "")
            owner = contact.get("assigned_to") or school.get("assigned_to", "")
        else:
            kind, who, owner = ("contact" if e.get("contact_id") else "lead"), "", ""
        rows.append({
            "enrollment_id": e["enrollment_id"],
            "sequence_id": e["sequence_id"],
            "sequence_name": seq.get("name", "(deleted sequence)"),
            "lead_id": e.get("lead_id"),
            "contact_id": e.get("contact_id"),
            "recipient_kind": kind,
            "recipient_name": who,
            "owner": owner,
            "status": e.get("status", "active"),
            "paused_reason": e.get("paused_reason", ""),
            "step": idx + 1 if live else idx,
            "total_steps": len(steps),
            "enrolled_at": str(e.get("enrolled_at") or "")[:10],
            "next_channel": _CHANNEL_OF.get(nxt.get("message_type", ""),
                                            nxt.get("message_type", "")) if nxt else "",
            "next_item": (nxt.get("material_name") or nxt.get("material_type") or "") if nxt else "",
            "next_due": str(e.get("next_step_at") or "")[:10] if live else "",
        })

    return {"school_id": school_id, "rows": rows,
            "active": sum(1 for r in rows if r["status"] == "active"),
            "total": len(rows)}


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
    lead_ids = [e["lead_id"] for e in enrolments if e.get("lead_id")]
    leads = {l["lead_id"]: l for l in await db.leads.find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(None)}
    # Contact-keyed enrolments (D5) name their school + owner through the contact.
    contact_ids = [e["contact_id"] for e in enrolments if e.get("contact_id")]
    contacts = {c["contact_id"]: c for c in await db.contacts.find(
        {"contact_id": {"$in": contact_ids}},
        {"_id": 0, "contact_id": 1, "name": 1, "school_id": 1, "company": 1,
         "assigned_to": 1}).to_list(None)} if contact_ids else {}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1, "assigned_to": 1}).to_list(None)}
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
        lead = leads.get(enr.get("lead_id"), {}) if enr.get("lead_id") else {}
        contact = contacts.get(enr.get("contact_id"), {}) if enr.get("contact_id") else {}
        if lead or not enr.get("contact_id"):   # lead-keyed (as before)
            sid = lead.get("school_id", "")
            school_name = schools.get(sid, {}).get("school_name") or lead.get("company_name", "")
            owner = lead.get("assigned_to", "")
        else:
            sid = contact.get("school_id") or enr.get("school_id") or ""
            school_name = schools.get(sid, {}).get("school_name") or contact.get("company", "")
            owner = contact.get("assigned_to") or schools.get(sid, {}).get("assigned_to", "")
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
                "enrollment_id": enr["enrollment_id"], "lead_id": enr.get("lead_id"),
                "contact_id": enr.get("contact_id"),
                "school_id": sid, "school_name": school_name or "(no school)",
                "owner": owner, "step_number": n,
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
