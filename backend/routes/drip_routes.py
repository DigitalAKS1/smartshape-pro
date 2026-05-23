from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()

# ── Pre-seed defaults ────────────────────────────────────────────────────────
_DEFAULT_SEQUENCES = [
    {
        "name": "Teacher Welcome Series",
        "description": "Auto-enroll new Teacher leads — 5-step awareness journey",
        "trigger": "lead_created",
        "filter_designation": "Teacher",
        "steps": [
            {"step_number": 1, "delay_days": 0,  "message_type": "whatsapp",
             "message_template": "Hi {name}! SmartShape offers premium die-cut craft materials perfect for classroom activities. Check out our Teacher's Day special catalogue."},
            {"step_number": 2, "delay_days": 3,  "message_type": "whatsapp",
             "message_template": "Hi {name}, here is our digital catalogue for classroom craft activities: {catalogue_link} — Free samples available on request!"},
            {"step_number": 3, "delay_days": 7,  "message_type": "whatsapp",
             "message_template": "Hi {name}, we noticed you haven't ordered yet. We are offering a 10% discount on your first order this month!"},
            {"step_number": 4, "delay_days": 14, "message_type": "whatsapp",
             "message_template": "Hi {name}, our field team is visiting schools in your area next week. Would you like a free product demonstration?"},
            {"step_number": 5, "delay_days": 21, "message_type": "whatsapp",
             "message_template": "Hi {name}, we would love to hear from you! Reply or call us to place your first order and get FREE shipping."},
        ],
        "is_active": True,
    },
    {
        "name": "Principal Awareness Series",
        "description": "5-step value proposition journey for Principals and Directors",
        "trigger": "lead_created",
        "filter_designation": "Principal",
        "steps": [
            {"step_number": 1, "delay_days": 0,  "message_type": "whatsapp",
             "message_template": "Dear {name}, SmartShape supplies premium die-cut craft materials to 500+ schools. Our products enhance student creativity and save teacher prep time."},
            {"step_number": 2, "delay_days": 5,  "message_type": "whatsapp",
             "message_template": "Dear {name}, our Annual Day and craft fair kits are trusted by leading CBSE and ICSE schools. See what our clients say: {catalogue_link}"},
            {"step_number": 3, "delay_days": 10, "message_type": "whatsapp",
             "message_template": "Dear {name}, we are currently running our end-of-semester sale. Bulk orders above Rs 5000 get 12% off plus free samples."},
            {"step_number": 4, "delay_days": 20, "message_type": "whatsapp",
             "message_template": "Dear {name}, our team can visit your school for a free product showcase. Would Tuesday or Wednesday work for you?"},
            {"step_number": 5, "delay_days": 30, "message_type": "whatsapp",
             "message_template": "Dear {name}, we would love to partner with your school this academic year. Reply to discuss your craft supply requirements."},
        ],
        "is_active": True,
    },
]


async def _seed_defaults():
    count = await db.drip_sequences.count_documents({})
    if count > 0:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    for seq in _DEFAULT_SEQUENCES:
        await db.drip_sequences.insert_one({
            "sequence_id": f"drip_{uuid.uuid4().hex[:10]}",
            **seq,
            "created_by": "system",
            "created_at": now_iso,
            "updated_at": now_iso,
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
