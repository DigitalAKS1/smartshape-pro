"""Telephony (click-to-call) routes.

POST /telephony/call            — a sales rep dials a lead/contact/school
POST /telephony/bonvoice/webhook — Bonvoice posts notification + hangup events
GET  /telephony/calls/{event_id} — inspect a call's lifecycle (debug/UI)

The target phone is always resolved from the DB record (never trusted from the
request body), so a rep cannot dial an arbitrary number through the company line.
"""
from fastapi import APIRouter, HTTPException, Request

from database import db
from auth_utils import get_current_user
from rbac import get_team
from services import telephony_service

router = APIRouter()


async def _resolve_target(kind: str, ref_id: str) -> dict:
    """Return {phone, school_id, contact_id, lead_id} from the DB record."""
    if kind == "contact":
        c = await db.contacts.find_one({"contact_id": ref_id}, {"_id": 0}) or {}
        return {"phone": c.get("phone", ""), "school_id": c.get("school_id"),
                "contact_id": ref_id, "lead_id": c.get("lead_id")}
    if kind == "lead":
        l = await db.leads.find_one({"lead_id": ref_id}, {"_id": 0}) or {}
        return {"phone": l.get("contact_phone", ""), "school_id": l.get("school_id"),
                "contact_id": l.get("contact_id"), "lead_id": ref_id}
    s = await db.schools.find_one({"school_id": ref_id}, {"_id": 0}) or {}
    return {"phone": s.get("phone", ""), "school_id": ref_id, "contact_id": None, "lead_id": None}


@router.post("/telephony/call")
async def place_telephony_call(request: Request):
    user = await get_current_user(request)
    if get_team(user) not in ("sales", "admin"):
        raise HTTPException(403, "No calling access")
    if not await telephony_service.is_enabled():
        raise HTTPException(409, "Calling is not enabled. Ask admin to configure it in Settings → Calling.")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    kind = (body.get("kind") or "contact").strip()
    ref_id = (body.get("ref_id") or "").strip()
    if kind not in ("contact", "lead", "school") or not ref_id:
        raise HTTPException(400, "kind (contact|lead|school) and ref_id are required")

    rep = await db.salespersons.find_one({"email": user["email"]}, {"_id": 0}) or {}
    rep_number = (rep.get("calling_number") or rep.get("phone") or "").strip()
    if not rep_number:
        raise HTTPException(409, "Your calling number is not set. Ask admin to add it in User Management.")

    tgt = await _resolve_target(kind, ref_id)
    if not (tgt.get("phone") or "").strip():
        raise HTTPException(422, "This record has no phone number to call.")

    corr = {"kind": kind, "ref_id": ref_id, "school_id": tgt.get("school_id"),
            "contact_id": tgt.get("contact_id"), "lead_id": tgt.get("lead_id")}
    return await telephony_service.place_call(user["email"], user.get("name", ""),
                                              rep_number, tgt["phone"], corr)


@router.post("/telephony/bonvoice/webhook")
async def bonvoice_webhook(request: Request, secret: str = ""):
    cfg = await telephony_service.get_config()
    if not cfg.get("webhook_secret") or secret != cfg["webhook_secret"]:
        raise HTTPException(403, "Invalid webhook secret")
    ct = request.headers.get("content-type", "")
    raw = await request.body()
    form = None
    if "application/x-www-form-urlencoded" in ct.lower():
        form = dict(await request.form())
    return await telephony_service.handle_webhook(ct, raw, form)


@router.get("/telephony/calls/{event_id}")
async def get_telephony_call(event_id: str, request: Request):
    await get_current_user(request)
    row = await db.telephony_calls.find_one({"event_id": event_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Call not found")
    return row
