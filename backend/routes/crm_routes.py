from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse, HTMLResponse, RedirectResponse
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import csv
import io
import re
import logging
import html as _html
import asyncio
import requests as http_requests

from database import db
from auth_utils import get_current_user
from rbac import (get_team, require_admin, require_superadmin, require_module, has_module,
                  has_team, sees_all, can_read_crm)
from audit_backup import snapshot_and_delete, preview_counts
from cascade_delete import build_school_plan, build_contact_plan
from services.engagement import normalize_timeline, fetch_events, log_engagement_event
import crm_contact_calls as cc
from notify import notify_user
import services.account_lifecycle as al
import services.reorder as ro

router = APIRouter()


def _html_escape(s):
    """Escape for safe interpolation into the public QR page (attrs + text)."""
    return _html.escape(str(s or ""), quote=True)


# ==================== HELPER ====================

async def touch_last_activity(entity_type: str, entity_id: str):
    if not entity_type or not entity_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    coll_map = {
        "school": ("schools", "school_id"),
        "lead": ("leads", "lead_id"),
        "contact": ("contacts", "contact_id"),
    }
    pair = coll_map.get(entity_type)
    if not pair:
        return
    coll, key = pair
    await db[coll].update_one({key: entity_id}, {"$set": {"last_activity_date": now_iso}})


async def _auto_enroll_lead(lead_doc: dict):
    """Background task: auto-enroll a new lead into matching drip sequences."""
    try:
        lead_des = (lead_doc.get("designation") or "").strip().lower()
        role_name = ""
        if lead_doc.get("contact_role_id"):
            role = await db.contact_roles.find_one(
                {"role_id": lead_doc["contact_role_id"]}, {"_id": 0, "name": 1}
            )
            if role:
                role_name = role.get("name", "").lower()

        seqs = await db.drip_sequences.find(
            {"trigger": "lead_created", "is_active": True}, {"_id": 0}
        ).to_list(50)

        now = datetime.now(timezone.utc)
        for seq in seqs:
            filt = (seq.get("filter_designation") or "").strip().lower()
            if filt and lead_des != filt and role_name != filt:
                continue
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
            })
    except Exception as exc:
        import logging as _log
        _log.error(f"_auto_enroll_lead error: {exc}")


async def _auto_enroll_on_trigger(lead_id: str, trigger: str) -> int:
    """Enroll a lead into every active sequence wired to `trigger` — the branching
    primitive (e.g. 'brochure_opened' → start a nurture flow). Mirrors
    _auto_enroll_lead's matching + dedup; returns how many enrolments were made."""
    try:
        if not lead_id:
            return 0
        lead_doc = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if not lead_doc:
            return 0
        lead_des = (lead_doc.get("designation") or "").strip().lower()
        role_name = ""
        if lead_doc.get("contact_role_id"):
            role = await db.contact_roles.find_one(
                {"role_id": lead_doc["contact_role_id"]}, {"_id": 0, "name": 1})
            if role:
                role_name = role.get("name", "").lower()
        seqs = await db.drip_sequences.find(
            {"trigger": trigger, "is_active": True}, {"_id": 0}).to_list(50)
        now = datetime.now(timezone.utc)
        enrolled = 0
        for seq in seqs:
            filt = (seq.get("filter_designation") or "").strip().lower()
            if filt and lead_des != filt and role_name != filt:
                continue
            if not seq.get("steps"):
                continue
            existing = await db.drip_enrollments.find_one(
                {"sequence_id": seq["sequence_id"], "lead_id": lead_id, "status": "active"})
            if existing:
                continue
            first_delay = seq["steps"][0].get("delay_days", 0)
            await db.drip_enrollments.insert_one({
                "enrollment_id": f"denr_{uuid.uuid4().hex[:10]}",
                "sequence_id": seq["sequence_id"], "lead_id": lead_id,
                "current_step": 0, "status": "active",
                "enrolled_at": now.isoformat(),
                "next_step_at": (now + timedelta(days=first_delay)).isoformat(),
                "last_step_at": None, "completed_at": None,
                "enrolled_by": f"trigger:{trigger}",
            })
            enrolled += 1
        return enrolled
    except Exception as exc:
        import logging as _log
        _log.error(f"_auto_enroll_on_trigger error: {exc}")
        return 0


async def log_activity(user_email: str, action: str, entity_type: str, entity_id: str, details: str = ""):
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    try:
        await touch_last_activity(entity_type, entity_id)
    except Exception:
        pass


async def create_physical_from_drip(lead: dict, material_type: str, seq_name: str,
                                    material_name: str = "", sequence_id: str = "",
                                    enrollment_id: str = "", step_number: int = 0,
                                    planned_date: str = "") -> str:
    """A drip physical step → physically send to the school. Queues a dispatch +
    a rep task, AND (if the lead has a school) drops a printable, QR-tracked
    mailer into Offline Mail under the run for this sequence + piece + day — so
    it's a real, trackable posting, not just a ship-it note. `material_name` is
    what you're actually sending (free text); it shows on the task + the mailer.

    The sequence/enrolment/step ids are carried onto the touch so the sequence
    drill-down can show what went to which school, and so the gap report can tell
    a slipped brochure apart from a slipped sample."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    item = (material_name or "").strip() or (material_type or "brochure")
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    await db.physical_dispatches.insert_one({
        "dispatch_id": dispatch_id,
        "lead_id": lead.get("lead_id", ""),
        "lead_name": lead.get("contact_name", ""),
        "material_type": material_type or "brochure",
        "material_name": (material_name or "").strip(),
        "description": f"Auto-queued by drip: {seq_name}",
        "courier_name": "", "tracking_number": "", "sent_date": "",
        "received_confirmed": False,
        "auto_from_drip": True, "needs_dispatch": True,
        "created_by": "system", "created_at": now_iso,
    })
    await db.tasks.insert_one({
        "task_id": f"task_{uuid.uuid4().hex[:10]}",
        "title": f"Ship {item} → {lead.get('company_name', '')}",
        "description": f"Auto-created by drip sequence '{seq_name}'. Add courier + tracking after shipping.",
        "type": "other", "lead_id": lead.get("lead_id", ""),
        "assigned_to": lead.get("assigned_to", ""),
        "due_date": "", "due_time": "", "priority": "medium",
        "status": "pending", "created_by": "system", "created_at": now_iso,
    })

    # Physically send to the school: a printable, QR-tracked mailer (Offline Mail).
    sid = lead.get("school_id", "")
    if sid:
        try:
            today = now.strftime("%Y-%m-%d")
            piece = material_type or "brochure"
            planned = planned_date or today
            # One run per (sequence, piece, day), so a brochure step and a sample step
            # from two sequences don't collapse into one unprintable pile.
            run = await db.mail_runs.find_one(
                {"is_drip_run": True, "send_date": today,
                 "sequence_id": sequence_id, "piece_type": piece},
                {"_id": 0, "run_id": 1})
            if not run:
                # Mid-day deploy safety: reuse a run made by the older, coarser key
                # rather than creating a second run and posting a school twice.
                run = await db.mail_runs.find_one(
                    {"is_drip_run": True, "send_date": today, "piece_type": piece,
                     "sequence_id": {"$exists": False}},
                    {"_id": 0, "run_id": 1})
            if not run:
                run_id = f"run_{uuid.uuid4().hex[:10]}"
                label = f"{seq_name} · {piece} — {today}" if seq_name else f"Drip Mailers — {today}"
                await db.mail_runs.insert_one({
                    "run_id": run_id, "name": label, "area_id": "",
                    "piece_type": piece, "deal_type_target": "", "school_ids": [],
                    "send_date": today, "courier": "", "tracking_no": "", "courier_cost": 0,
                    "status": "planned", "is_drip_run": True,
                    "sequence_id": sequence_id, "sequence_name": seq_name,
                    "created_by": "system", "created_at": now_iso,
                    "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
            else:
                run_id = run["run_id"]
            # One mailer per school per day's drip run (no duplicates).
            if not await db.mail_touches.find_one({"run_id": run_id, "school_id": sid}, {"_id": 0, "touch_id": 1}):
                await db.mail_touches.insert_one({
                    "touch_id": f"mt_{uuid.uuid4().hex[:10]}", "run_id": run_id, "school_id": sid,
                    "lead_id": lead.get("lead_id", ""), "piece_type": piece,
                    "item_name": item, "posted_at": None,
                    "qr_token": uuid.uuid4().hex[:16], "delivery_status": "pending",
                    "responded": False, "responded_at": None, "response_channel": "",
                    "appointment": False, "next_action_date": "", "outcome_note": "",
                    "owner": lead.get("assigned_to", "") or "system", "created_at": now_iso,
                    # lifecycle + drip back-links
                    "planned_date": planned, "verify_status": "pending",
                    "printed_at": None, "print_batch_id": "", "replan_count": 0,
                    "source": "drip", "sequence_id": sequence_id,
                    "enrollment_id": enrollment_id, "step_number": step_number})
                await db.mail_runs.update_one(
                    {"run_id": run_id}, {"$addToSet": {"school_ids": sid}, "$inc": {"counts.sent": 1}})
        except Exception:
            pass  # mailer is best-effort; the dispatch + task already exist
    return dispatch_id


import os as _os
DEMO_WA_DRY_RUN = _os.getenv("DEMO_WA_DRY_RUN", "0") == "1"

async def _send_demo_wa(phone: str, message: str) -> bool:
    """Direct WhatsApp send via the configured provider (mirrors dispatch auto-WA)."""
    if not phone:
        return False
    if DEMO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[demo][dry] WA -> {phone}: {message[:60]}")
        return True
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa or not wa.get("username"):
        return False
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            await client.post("https://app.messageautosender.com/message/new", data={
                "username": wa["username"], "password": wa["password"],
                "receiverMobileNo": phone, "message": message})
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message,
            "send_mode": "demo_link", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False


INTRO_WA_DRY_RUN = _os.getenv("INTRO_WA_DRY_RUN", "0") == "1"

async def _send_intro_wa(phone: str, message: str) -> bool:
    if not phone or not message:
        return False
    if INTRO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[intro][dry] WA -> {phone}: {message[:60]}")
        return True
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa or not wa.get("username"):
        return False
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            await client.post("https://app.messageautosender.com/message/new", data={
                "username": wa["username"], "password": wa["password"],
                "receiverMobileNo": phone, "message": message})
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message,
            "send_mode": "lead_intro", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False


def _coerce_int(val, default=0):
    """Form fields arrive as strings (and a blank field as ''). Store numeric
    school fields as real ints so later comparisons (e.g. strength > 1000,
    Mongo $gte segment filters) don't crash or silently mis-sort."""
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return default


def calc_lead_score(lead, school=None):
    score = 0
    if school:
        try:
            _strength = int(float(school.get("school_strength") or 0))
        except (TypeError, ValueError):
            _strength = 0  # tolerate non-numeric strengths stored as strings
        if _strength > 1000:
            score += 10
    desig = (lead.get("designation") or "").lower()
    if any(d in desig for d in ("principal", "trustee", "admin", "director")):
        score += 5
    if lead.get("stage") not in ("new",):
        score += 5
    if lead.get("lead_type") == "hot":
        score += 10
    elif lead.get("lead_type") == "warm":
        score += 5
    return score


def compute_visit_required(lead: dict, now: datetime = None) -> bool:
    if now is None:
        now = datetime.now(timezone.utc)
    triggers = (
        lead.get("stage") in ("demo", "negotiation")
        or lead.get("priority") == "high"
        or lead.get("lead_type") == "hot"
    )
    if not triggers:
        return False
    last_visit = lead.get("last_visit_date")
    if not last_visit:
        return True
    try:
        lv = datetime.fromisoformat(last_visit.replace("Z", "+00:00"))
        return (now - lv).days >= 7
    except Exception:
        return True


# ==================== PHASE 1: PIPELINE SETTINGS + COMPUTE ====================

OPEN_STAGES = ["new", "contacted", "demo", "quoted", "negotiation"]

# Open, but not yet a forecast. A lead sits in `new` until somebody has actually
# made contact — it may be a QR scan, a form fill or an imported row, and none of
# those are evidence that money is coming. Kept in the pipeline (they are real
# work to be done) but reported as a count, not as rupees.
UNQUALIFIED_STAGES = {"new"}

DEFAULT_PIPELINE_SETTINGS = {
    "type": "crm_pipeline",
    "stage_probabilities": {
        "new": 10, "contacted": 20, "demo": 30, "quoted": 50,
        "negotiation": 70, "won": 100, "lost": 0, "retention": 0, "resell": 0,
    },
    "stage_idle_limits": {
        "new": 7, "contacted": 5, "demo": 4, "quoted": 4,
        "negotiation": 3, "retention": 30, "resell": 14,
    },
    "lost_reasons": ["Price", "Competitor", "No budget", "No response", "Timing", "Other"],
    "digest_time": "08:00",
    "digest_enabled": False,
    # How long a customer can go without ordering before they count as dormant
    # and land on the win-back list. Two school terms, give or take.
    "dormant_after_days": 180,
    # Assumed gap between orders for a school that has only ordered once, where
    # there is no rhythm to measure yet.
    "reorder_interval_days": 180,
}


async def get_crm_settings() -> dict:
    doc = await db.settings.find_one({"type": "crm_pipeline"}, {"_id": 0})
    if not doc:
        await db.settings.insert_one(dict(DEFAULT_PIPELINE_SETTINGS))
        doc = {}
    merged = {**DEFAULT_PIPELINE_SETTINGS, **doc}
    for mk in ("stage_probabilities", "stage_idle_limits"):
        merged[mk] = {**DEFAULT_PIPELINE_SETTINGS[mk], **(doc.get(mk) or {})}
    merged.pop("_id", None)
    return merged


def resolve_lead_value(lead: dict, quote_map: dict) -> float:
    """Linked quotation grand_total (latest) wins; else manual expected_value."""
    qids = lead.get("quotation_ids") or []
    linked = [quote_map[q] for q in qids if q in quote_map]
    if linked:
        latest = max(linked, key=lambda q: q.get("created_at", "") or "")
        return float(latest.get("grand_total", 0) or 0)
    return float(lead.get("expected_value", 0) or 0)


# ── Won value: the money, not the estimate ──────────────────────────────────
#
# `expected_value` is what a rep typed while the deal was still a guess, and
# reporting it as won value meant the CRM's revenue figure never reconciled with
# what was invoiced — so "what is a demo actually worth?" had no answer. Once a
# deal is won, the order is the truth.

# An order that was cancelled never became revenue; every other status is money
# that has been committed, whether or not it has shipped yet.
NON_REVENUE_ORDER_STATUSES = {"cancelled"}


async def _build_order_map(lead_ids: list) -> dict:
    """lead_id -> [orders], excluding cancelled and deleted ones."""
    out: dict = {}
    ids = [i for i in (lead_ids or []) if i]
    if not ids:
        return out
    async for o in db.orders.find(
        {"lead_id": {"$in": ids}, "is_deleted": {"$ne": True}},
        {"_id": 0, "lead_id": 1, "grand_total": 1, "status": 1},
    ):
        if (o.get("status") or "") in NON_REVENUE_ORDER_STATUSES:
            continue
        out.setdefault(o["lead_id"], []).append(o)
    return out


def resolve_won_value(lead: dict, order_map: dict) -> float:
    """Invoiced total for a won deal. Zero when nothing was ordered.

    Deliberately does NOT fall back to expected_value: silently substituting the
    guess is exactly what stopped the number reconciling. A win with no order is
    worth nothing until an order exists, and is surfaced separately so it can be
    chased rather than quietly counted.
    """
    return round(sum(float(o.get("grand_total", 0) or 0)
                     for o in order_map.get(lead.get("lead_id"), [])), 2)


def is_unreconciled_win(lead: dict, order_map: dict) -> bool:
    """A deal marked won that has no order behind it — either the order was
    never raised, or the deal was not really won."""
    if lead.get("stage") != "won":
        return False
    return not order_map.get(lead.get("lead_id"))


def stage_probability(stage: str, settings: dict) -> int:
    return int((settings.get("stage_probabilities") or {}).get(stage, 0) or 0)


async def _build_quote_map(leads: list) -> dict:
    ids = [q for l in leads for q in (l.get("quotation_ids") or [])]
    qmap = {}
    if ids:
        async for q in db.quotations.find(
            {"quotation_id": {"$in": ids}},
            {"_id": 0, "quotation_id": 1, "grand_total": 1, "created_at": 1},
        ):
            qmap[q["quotation_id"]] = q
    return qmap


def _parse_dt(val):
    if not val:
        return None
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        try:
            dt = datetime.fromisoformat(str(val)[:10])
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compute_attention(lead: dict, now: datetime, settings: dict,
                      has_upcoming: bool, has_open_task: bool) -> list:
    """Return list of reason codes; empty if the lead is fine. Open stages only."""
    if lead.get("stage") not in OPEN_STAGES:
        return []
    reasons = []
    nfd = _parse_dt(lead.get("next_followup_date"))
    if nfd and nfd < now:
        reasons.append("overdue")
    last = _parse_dt(lead.get("last_activity_date"))
    limit = (settings.get("stage_idle_limits") or {}).get(lead.get("stage"), 7)
    if last and (now - last).days >= int(limit or 7):
        reasons.append("stuck")
    if not has_upcoming and not has_open_task:
        reasons.append("no_next_action")
    return reasons


FUNNEL_ORDER = ["new", "contacted", "demo", "quoted", "negotiation", "won"]
FUNNEL_RANK = {s: i for i, s in enumerate(FUNNEL_ORDER)}


def _max_stage_reached(lead: dict) -> int:
    """Highest funnel rank this lead has touched, from pipeline_history + current stage."""
    best = FUNNEL_RANK.get(lead.get("stage", ""), -1)
    for h in lead.get("pipeline_history", []) or []:
        best = max(best, FUNNEL_RANK.get(h.get("to_stage", ""), -1))
    return best


def _avg_days_in_stage(leads: list, stage: str) -> float:
    """Average days a lead spent in `stage`, from consecutive pipeline_history timestamps."""
    spans = []
    for lead in leads:
        hist = sorted((lead.get("pipeline_history") or []), key=lambda h: h.get("at", "") or "")
        for i, h in enumerate(hist):
            if h.get("to_stage") != stage:
                continue
            start = h.get("at")
            end = hist[i + 1].get("at") if i + 1 < len(hist) else None
            if not start or not end:
                continue
            d0 = _parse_dt(start)
            d1 = _parse_dt(end)
            if d0 and d1:
                spans.append((d1 - d0).total_seconds() / 86400)
    return round(sum(spans) / len(spans), 1) if spans else 0.0


# ==================== GROUP MASTER ====================

@router.get("/groups")
async def get_groups(request: Request):
    await get_current_user(request)
    groups = await db.groups.find({}, {"_id": 0}).sort("group_name", 1).to_list(500)
    return groups


@router.post("/groups")
async def create_group(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    group_id = f"grp_{uuid.uuid4().hex[:8]}"
    await db.groups.insert_one({
        "group_id": group_id,
        "group_name": body.get("group_name", ""),
        "head_office_address": body.get("head_office_address", ""),
        "chairman_name": body.get("chairman_name", ""),
        "contact_number": body.get("contact_number", ""),
        "email": body.get("email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})


@router.put("/groups/{group_id}")
async def update_group(group_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("group_name", "head_office_address", "chairman_name", "contact_number", "email") if k in body}
    await db.groups.update_one({"group_id": group_id}, {"$set": allowed})
    return await db.groups.find_one({"group_id": group_id}, {"_id": 0})


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request):
    await get_current_user(request)
    await db.groups.delete_one({"group_id": group_id})
    return {"message": "Group deleted"}


# ==================== SOURCE MASTER ====================

DEFAULT_SOURCES = ["Call", "Visit", "Reference", "Campaign", "Exhibition", "Website", "Social Media", "Walk-in", "Partner", "Other"]


@router.get("/sources")
async def get_sources(request: Request):
    await get_current_user(request)
    sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not sources:
        for s in DEFAULT_SOURCES:
            await db.sources.insert_one({
                "source_id": f"src_{uuid.uuid4().hex[:8]}",
                "name": s,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        sources = await db.sources.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return sources


@router.post("/sources")
async def create_source(request: Request):
    await get_current_user(request)
    body = await request.json()
    source_id = f"src_{uuid.uuid4().hex[:8]}"
    await db.sources.insert_one({
        "source_id": source_id,
        "name": body.get("name", ""),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})


@router.put("/sources/{source_id}")
async def update_source(source_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.sources.update_one({"source_id": source_id}, {"$set": allowed})
    return await db.sources.find_one({"source_id": source_id}, {"_id": 0})


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    await get_current_user(request)
    await db.sources.delete_one({"source_id": source_id})
    return {"message": "Source deleted"}


# ── Deal Types ───────────────────────────────────────────────────────────────
# Segments quotations + leads by what kind of deal it is. Powers the "which deal
# type was sent" filter (leads / quotations / schools) and the resale engine.
DEFAULT_DEAL_TYPES = ["New Machine Package", "Reorder - Dies", "New Dies / Add-on", "Sample / Trial / Demo"]


@router.get("/deal-types")
async def get_deal_types(request: Request):
    await get_current_user(request)
    rows = await db.deal_types.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not rows:
        for name in DEFAULT_DEAL_TYPES:
            await db.deal_types.insert_one({
                "deal_type_id": f"dt_{uuid.uuid4().hex[:8]}",
                "name": name,
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        rows = await db.deal_types.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return rows


@router.post("/deal-types")
async def create_deal_type(request: Request):
    await get_current_user(request)
    body = await request.json()
    deal_type_id = f"dt_{uuid.uuid4().hex[:8]}"
    await db.deal_types.insert_one({
        "deal_type_id": deal_type_id,
        "name": body.get("name", ""),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.deal_types.find_one({"deal_type_id": deal_type_id}, {"_id": 0})


@router.put("/deal-types/{deal_type_id}")
async def update_deal_type(deal_type_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    upd = {}
    if "name" in body:
        upd["name"] = body["name"]
    if "is_active" in body:
        upd["is_active"] = bool(body["is_active"])
    if upd:
        await db.deal_types.update_one({"deal_type_id": deal_type_id}, {"$set": upd})
    return await db.deal_types.find_one({"deal_type_id": deal_type_id}, {"_id": 0})


@router.delete("/deal-types/{deal_type_id}")
async def delete_deal_type(deal_type_id: str, request: Request):
    await get_current_user(request)
    await db.deal_types.delete_one({"deal_type_id": deal_type_id})
    return {"message": "Deal type deleted"}


# ── Mail Areas (Territory & Offline-Mail engine, sub-project A1) ──────────────
# An area is a city/pincode zone; schools belong to it by matching pincode
# (fallback city). auto-assign caches the count; the school list is queried on
# demand so the existing CRM/deal-type filter can narrow "who to mail".
def _area_school_query(area):
    if area.get("kind") == "city" and area.get("city"):
        return {"city": area["city"]}
    if area.get("pincode"):
        return {"pincode": area["pincode"]}
    return {"area_id_never_matches": True}  # misconfigured area matches nothing


@router.get("/mail-areas")
async def get_mail_areas(request: Request):
    await get_current_user(request)
    return await db.mail_areas.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/mail-areas")
async def create_mail_area(request: Request):
    await get_current_user(request)
    body = await request.json()
    area_id = f"area_{uuid.uuid4().hex[:8]}"
    await db.mail_areas.insert_one({
        "area_id": area_id,
        "name": body.get("name", ""),
        "kind": body.get("kind", "pincode"),
        "pincode": (body.get("pincode", "") or "").strip(),
        "city": (body.get("city", "") or "").strip(),
        "assigned_to": body.get("assigned_to", ""),
        "school_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.mail_areas.find_one({"area_id": area_id}, {"_id": 0})


@router.delete("/mail-areas/{area_id}")
async def delete_mail_area(area_id: str, request: Request):
    await get_current_user(request)
    await db.mail_areas.delete_one({"area_id": area_id})
    return {"message": "Area deleted"}


@router.post("/mail-areas/{area_id}/auto-assign")
async def auto_assign_mail_area(area_id: str, request: Request):
    await get_current_user(request)
    area = await db.mail_areas.find_one({"area_id": area_id}, {"_id": 0})
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    count = await db.schools.count_documents(_area_school_query(area))
    await db.mail_areas.update_one({"area_id": area_id}, {"$set": {"school_count": count}})
    return {"area_id": area_id, "school_count": count}


@router.get("/mail-areas/{area_id}/schools")
async def get_mail_area_schools(area_id: str, request: Request):
    await get_current_user(request)
    area = await db.mail_areas.find_one({"area_id": area_id}, {"_id": 0})
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    return await db.schools.find(_area_school_query(area), {"_id": 0}).sort("school_name", 1).to_list(5000)


# ── Mail Runs (Territory & Offline-Mail engine, sub-project A2) ───────────────
async def _upsert_direct_mail_lead(school_id, deal_type, owner, now_iso):
    """Tag a mailed school as a Direct-Mail lead — reuse its open deal OF THE SAME
    DEAL TYPE if present, else create one — so mailed schools become filterable
    pipeline.

    Keyed on deal type because this business runs two motions at once: a school
    can be evaluating a machine AND due to reorder dies. Matching on "any open
    lead" meant the reorder attached itself to the machine deal and overwrote its
    type, so the annuity had nowhere of its own to live. An untyped touch still
    matches an untyped deal, which is how everything behaved before deal types
    existed.
    """
    sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not sch:
        return None
    dt = (deal_type or "").strip()
    existing = await db.leads.find_one(
        {"school_id": school_id, "stage": {"$nin": ["won", "lost"]},
         "is_deleted": {"$ne": True},
         "deal_type": dt if dt else {"$in": ["", None]}},
        {"_id": 0, "lead_id": 1})
    if existing:
        _set = {"last_activity_date": now_iso, "source": "Direct Mail"}
        if deal_type:
            _set["deal_type"] = deal_type
        await db.leads.update_one({"lead_id": existing["lead_id"]}, {"$set": _set})
        return existing["lead_id"]
    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    await db.leads.insert_one({
        "lead_id": lead_id, "school_id": school_id,
        "company_name": sch.get("school_name", ""), "school_city": sch.get("city", ""),
        "contact_name": sch.get("primary_contact_name", ""),
        "contact_phone": sch.get("phone", ""), "contact_email": sch.get("email", ""),
        "source": "Direct Mail", "deal_type": deal_type or "", "lead_type": "cold",
        "stage": "new", "assigned_to": owner, "assigned_name": "",
        "last_activity_date": now_iso, "created_by": owner,
        "created_at": now_iso, "updated_at": now_iso,
    })
    return lead_id


async def _make_mail_run(user, *, name, piece_type="brochure", school_ids=None, deal_type="",
                         area_id="", send_date="", courier="", tracking_no="", courier_cost=0):
    """Shared run builder: one mail_runs doc + one mail_touches (with QR) per school
    + a Direct-Mail lead. Used by the normal create path and the file-import path."""
    school_ids = school_ids or []
    now_iso = datetime.now(timezone.utc).isoformat()
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    await db.mail_runs.insert_one({
        "run_id": run_id, "name": name, "area_id": area_id,
        "piece_type": piece_type, "deal_type_target": deal_type, "school_ids": school_ids,
        "send_date": send_date, "courier": courier, "tracking_no": tracking_no,
        "courier_cost": float(courier_cost or 0),
        "status": "planned", "created_by": user["email"], "created_at": now_iso,
        "counts": {"sent": len(school_ids), "delivered": 0, "responded": 0, "appointments": 0},
    })
    for sid in school_ids:
        lead_id = await _upsert_direct_mail_lead(sid, deal_type, user["email"], now_iso)
        await db.mail_touches.insert_one({
            "touch_id": f"mt_{uuid.uuid4().hex[:10]}", "run_id": run_id, "school_id": sid,
            "lead_id": lead_id, "piece_type": piece_type, "posted_at": None,
            "qr_token": uuid.uuid4().hex[:16], "delivery_status": "pending",
            "responded": False, "responded_at": None, "response_channel": "",
            "appointment": False, "next_action_date": "", "outcome_note": "",
            "owner": user["email"], "created_at": now_iso,
        })
    return await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})


@router.post("/mail-runs")
async def create_mail_run(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    return await _make_mail_run(
        user, name=body.get("name", ""), area_id=body.get("area_id", ""),
        piece_type=body.get("piece_type", "brochure"), deal_type=body.get("deal_type_target", ""),
        school_ids=body.get("school_ids", []) or [], send_date=body.get("send_date", ""),
        courier=body.get("courier", ""), tracking_no=body.get("tracking_no", ""),
        courier_cost=body.get("courier_cost", 0))


@router.post("/mail-runs/import")
async def import_mail_run(request: Request, file: UploadFile = File(...),
                          name: str = Form(""), piece_type: str = Form("brochure"),
                          send_date: str = Form("")):
    """Upload a spreadsheet → add/sync to the School+Contact database (via the
    audited master-import engine: matches by id → name+phone → phone → name) →
    build a mail run from those schools, ready to print. Admin only (writes master data)."""
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    import import_engine as ie
    from routes.dynamic_import_routes import _key_rows
    content = await file.read()
    try:
        headers, rows = ie.parse_table(file.filename or "upload.csv", content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")
    if not rows:
        raise HTTPException(status_code=400, detail="The file has no data rows.")
    mapping = await ie.propose_mapping(db, headers)
    keyed = _key_rows(headers, rows, mapping)
    counts = {"create": 0, "update": 0, "needs_review": 0, "error": 0}
    errors, school_ids = [], []
    for idx, kr in enumerate(keyed):
        try:
            res = await ie.commit_row(db, kr, user, False)   # no auto-leads; run makes its own
            counts[res["action"]] = counts.get(res["action"], 0) + 1
            sid = res.get("school_id")
            if sid and res["action"] in ("create", "update") and sid not in school_ids:
                school_ids.append(sid)
        except Exception as e:
            counts["error"] += 1
            errors.append({"row": idx + 1, "error": str(e)[:120]})
    if not school_ids:
        raise HTTPException(status_code=400,
            detail="No schools could be added — make sure the file has a 'School Name' column.")
    run = await _make_mail_run(
        user, piece_type=piece_type, school_ids=school_ids, send_date=send_date,
        name=name or f"Imported list — {datetime.now(timezone.utc).strftime('%d %b %Y')}")
    return {"run": run, "schools_added": len(school_ids), "counts": counts,
            "total_rows": len(keyed), "errors": errors[:20]}


@router.get("/mail-runs")
async def get_mail_runs(request: Request):
    await get_current_user(request)
    return await db.mail_runs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


async def _queued_touches(date_str: str):
    """Every piece that should already be in the post: due today or overdue."""
    return await db.mail_touches.find(
        {"verify_status": "pending", "planned_date": {"$lte": date_str, "$ne": ""}},
        {"_id": 0}).to_list(None)


# NOTE: static path — MUST stay above /mail-runs/{run_id} (see the analytics note).
@router.get("/mail-runs/today-queue")
async def mail_today_queue(request: Request):
    """The posting job for today, across every run — a drip mailer and a manual run
    are one task to whoever carries the bundle to the counter."""
    await get_current_user(request)
    today = request.query_params.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    touches = await _queued_touches(today)
    runs = {r["run_id"]: r for r in await db.mail_runs.find({}, {"_id": 0}).to_list(None)}

    groups = {}
    for t in touches:
        rid = t.get("run_id", "")
        run = runs.get(rid, {})
        g = groups.setdefault(rid, {
            "run_id": rid, "run_name": run.get("name", "(deleted run)"),
            "sequence_name": run.get("sequence_name", ""),
            "is_drip_run": bool(run.get("is_drip_run")),
            "piece_type": run.get("piece_type", t.get("piece_type", "")),
            "count": 0, "overdue": 0, "touch_ids": []})
        g["count"] += 1
        g["touch_ids"].append(t["touch_id"])
        if t.get("planned_date", "") < today:
            g["overdue"] += 1

    rows = sorted(groups.values(), key=lambda g: (-g["overdue"], -g["count"]))
    return {"date": today, "total": len(touches),
            "overdue": sum(g["overdue"] for g in rows), "groups": rows}


# NOTE: static path — MUST stay above /mail-runs/{run_id} (see the analytics note).
@router.get("/mail-runs/queue-stickers.pdf")
async def mail_queue_stickers(request: Request):
    """One combined sticker PDF for the whole day's queue — the printer gets loaded
    once, not once per run."""
    await get_current_user(request)
    qp = request.query_params
    today = qp.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    touches = await _queued_touches(today)
    ids = [t["school_id"] for t in touches]
    schools = await db.schools.find({"school_id": {"$in": ids}}, {"_id": 0}).to_list(None)
    schools_by_id = {s["school_id"]: s for s in schools}
    if qp.get("skip_incomplete") in ("1", "true", "yes"):
        touches = _complete_touches(touches, schools_by_id)
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    base = (_os.environ.get("FRONTEND_URL") or "https://app.smartshape.in").rstrip("/")

    endorsement = qp.get("endorsement")
    if endorsement is None:
        endorsement = company.get("sticker_endorsement", "")
    try:
        endorsement_pt = float(qp.get("endorsement_pt") or company.get("sticker_endorsement_pt") or 0)
    except (TypeError, ValueError):
        endorsement_pt = 0
    text_scale = _clamp_scale(qp.get("text_scale") or company.get("sticker_text_scale") or 1.0)

    if touches:
        await db.mail_touches.update_many(
            {"touch_id": {"$in": [t["touch_id"] for t in touches]}},
            {"$set": {"printed_at": datetime.now(timezone.utc).isoformat(),
                      "print_batch_id": f"pb_{uuid.uuid4().hex[:12]}"}})

    pdf = _build_stickers_pdf(
        touches, schools_by_id, company, base,
        orientation=("landscape" if qp.get("orientation") == "landscape" else "portrait"),
        size=(qp.get("size") or "100x150"),
        layout=("a4" if qp.get("layout") == "a4" else "label"),
        show_logo=(qp.get("no_logo") not in ("1", "true", "yes")),
        endorsement=endorsement, endorsement_pt=endorsement_pt, text_scale=text_scale,
        show_phone=(qp.get("no_phone") not in ("1", "true", "yes")))
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="post-{today}.pdf"'})


def _days_late(planned: str, posted_at: str):
    """Whole days between the planned date and the actual posting, or None when
    either is missing — a touch with no plan is excluded rather than scored on time."""
    if not planned or not posted_at:
        return None
    try:
        p = datetime.fromisoformat(planned).date()
        a = datetime.fromisoformat(str(posted_at).replace("Z", "+00:00")).date()
    except ValueError:
        return None
    return (a - p).days


# ── Reports hub ───────────────────────────────────────────────────────────────
# Fifteen reports were spread across twelve screens with nothing listing them, so
# nobody could find the one they needed and a report with no screen was invisible.
# This is the catalogue WITH a live headline number per report, so it reads as a
# dashboard rather than a menu.

async def _safe(coro, default="—"):
    """A headline number is a convenience, never a reason for the page to fail."""
    try:
        return await coro
    except Exception:
        return default


REPORT_CATALOGUE = [
    ("sales", "Sales", [
        ("funnel", "Lead funnel", "Where every open lead sits, stage by stage.",
         "/analytics", False),
        ("conversion", "Conversion tracking", "What turns into a quotation, and what closes.",
         "/conversion-tracking", True),
        ("quotations", "Quotations", "Value quoted, confirmed and still open.",
         "/quotations", False),
    ]),
    ("marketing", "Marketing", [
        ("drip", "Drip sequences", "Who is enrolled, what fired, and what stalled.",
         "/marketing", False),
        ("mail_gap", "Post: plan vs actual", "What you planned to post against what really went out.",
         "/offline-mail", False),
        ("mail_roi", "Postage ROI", "Response, appointments and cost per reply for each run.",
         "/offline-mail", False),
        ("engagement", "Engagement", "Every touch across WhatsApp, email, call and post.",
         "/marketing", False),
    ]),
    ("operations", "Operations", [
        ("orders", "Orders", "Open, on hold and dispatched.",
         "/orders", False),
        ("stock", "Stock", "What is reserved against what is physically there.",
         "/stock", True),
    ]),
    ("people", "People", [
        ("field", "Field sales", "Visits logged and attendance, per rep.",
         "/field-sales", True),
        ("delegation", "Delegation", "Tasks assigned, done and overdue.",
         "/delegation", False),
    ]),
]


@router.get("/reports/hub")
async def reports_hub(request: Request):
    """Every report in one place, each with a live number and a flag when it needs
    attention. Admin-only reports are filtered out for a rep rather than 403ing."""
    user = await get_current_user(request)
    is_admin = get_team(user) == "admin" or user.get("role") == "admin"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── the handful of numbers the hub shows, each independently guarded ──
    open_leads = await _safe(db.leads.count_documents(
        {"stage": {"$in": list(OPEN_STAGES)}, "is_deleted": {"$ne": True}}), "—")
    overdue_post = await _safe(db.mail_touches.count_documents(
        {"verify_status": "pending", "planned_date": {"$lt": today, "$ne": ""}}), 0)
    posted = await _safe(db.mail_touches.count_documents({"verify_status": "sent"}), 0)
    active_enrol = await _safe(db.drip_enrollments.count_documents({"status": "active"}), 0)
    stalled = await _safe(db.drip_enrollments.count_documents({"status": "paused"}), 0)
    open_quotes = await _safe(db.quotations.count_documents(
        {"status": {"$in": ["draft", "sent"]}}), "—")
    open_orders = await _safe(db.orders.count_documents(
        {"status": {"$nin": ["dispatched", "cancelled", "completed"]}}), "—")
    visits_today = await _safe(db.field_visits.count_documents({"visit_date": today}), "—")
    tasks_due = await _safe(db.tasks.count_documents(
        {"status": "pending", "due_date": {"$lte": today, "$ne": ""}}), "—")
    touches = await _safe(db.engagement_events.count_documents({}), "—")

    def _n(v):
        return v if isinstance(v, int) else "—"

    metrics = {
        "funnel":     {"label": "open leads", "value": _n(open_leads), "tone": "neutral"},
        "conversion": {"label": "quotations open", "value": _n(open_quotes), "tone": "neutral"},
        "quotations": {"label": "quotations open", "value": _n(open_quotes), "tone": "neutral"},
        "drip": {
            "label": "stalled" if stalled else "active enrolments",
            "value": stalled if stalled else active_enrol,
            "tone": "warn" if stalled else "neutral",
        },
        "mail_gap": {
            "label": "overdue to post" if overdue_post else "posted",
            "value": overdue_post if overdue_post else posted,
            "tone": "warn" if overdue_post else "neutral",
        },
        "mail_roi":    {"label": "pieces posted", "value": posted, "tone": "neutral"},
        "engagement":  {"label": "touches logged", "value": _n(touches), "tone": "neutral"},
        "orders":      {"label": "orders open", "value": _n(open_orders), "tone": "neutral"},
        "stock":       {"label": "see report", "value": "—", "tone": "neutral"},
        "field":       {"label": "visits today", "value": _n(visits_today), "tone": "neutral"},
        "delegation":  {"label": "tasks due", "value": _n(tasks_due), "tone": "neutral"},
    }

    sections, attention = [], 0
    for key, title, reports in REPORT_CATALOGUE:
        rows = []
        for rkey, rtitle, rdesc, route, admin_only in reports:
            if admin_only and not is_admin:
                continue
            m = metrics.get(rkey) or {"label": "", "value": "—", "tone": "neutral"}
            if m["tone"] == "warn":
                attention += 1
            rows.append({"key": rkey, "title": rtitle, "description": rdesc,
                         "route": route, "metric": m})
        if rows:
            sections.append({"key": key, "title": title, "reports": rows})

    return {"sections": sections, "needs_attention": attention, "as_of": today}


# NOTE: this static path MUST stay above /mail-runs/{run_id} or FastAPI matches
# "gap-report" as a run_id and this endpoint is never reached.
@router.get("/mail-runs/gap-report")
async def mail_gap_report(request: Request):
    """Planned vs actual across every mail touch, grouped, with the reasons behind
    the gap — counts alone say work slipped, not what to fix."""
    await get_current_user(request)
    qp = request.query_params
    group_by = qp.get("group_by") or "run"
    filt = {}
    d_from, d_to = qp.get("from"), qp.get("to")
    if d_from or d_to:
        rng = {}
        if d_from:
            rng["$gte"] = d_from
        if d_to:
            rng["$lte"] = d_to
        filt["planned_date"] = rng

    touches = await db.mail_touches.find(filt, {"_id": 0}).to_list(None)
    runs = {r["run_id"]: r for r in await db.mail_runs.find({}, {"_id": 0}).to_list(None)}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1}).to_list(None)}

    def _key_label(t):
        run = runs.get(t.get("run_id"), {})
        if group_by == "sequence":
            return run.get("sequence_id") or "_none", run.get("sequence_name") or "Not from a sequence"
        if group_by == "owner":
            o = t.get("owner") or "unassigned"
            return o, o
        if group_by == "school":
            sid = t.get("school_id", "")
            return sid, schools.get(sid, {}).get("school_name", "(deleted school)")
        return t.get("run_id", ""), run.get("name", "(deleted run)")

    groups, reasons = {}, {}
    for t in touches:
        key, label = _key_label(t)
        g = groups.setdefault(key, {"key": key, "label": label, "planned": 0, "sent": 0,
                                    "not_sent": 0, "pending": 0, "printed_not_posted": 0,
                                    "replans": 0, "_late": [], "postage_exposure": 0.0})
        st = t.get("verify_status", "pending")
        g["planned"] += 1
        g["replans"] += int(t.get("replan_count", 0) or 0)
        if st == "sent":
            g["sent"] += 1
            dl = _days_late(t.get("planned_date", ""), t.get("posted_at"))
            if dl is not None:
                g["_late"].append(dl)
        elif st == "not_sent":
            g["not_sent"] += 1
            r = (t.get("reason") or "").strip() or "no reason given"
            reasons[r] = reasons.get(r, 0) + 1
        elif st == "pending":
            g["pending"] += 1
        if st != "sent" and t.get("printed_at"):
            g["printed_not_posted"] += 1        # a sticker printed for nothing
        # Budgeted postage riding on a piece that never went out.
        if st == "not_sent":
            run = runs.get(t.get("run_id"), {})
            n = len(run.get("school_ids") or []) or 1
            g["postage_exposure"] += float(run.get("courier_cost") or 0) / n

    rows = []
    for g in groups.values():
        late = g.pop("_late")
        g["avg_days_late"] = round(sum(late) / len(late), 2) if late else None
        g["on_time_pct"] = round(100.0 * sum(1 for d in late if d <= 0) / len(late), 2) if late else None
        g["postage_exposure"] = round(g["postage_exposure"], 2)
        rows.append(g)
    rows.sort(key=lambda r: (-(r["pending"] + r["not_sent"]), -r["planned"]))

    all_late = [d for t in touches if t.get("verify_status") == "sent"
                for d in [_days_late(t.get("planned_date", ""), t.get("posted_at"))] if d is not None]
    totals = {
        "planned": sum(r["planned"] for r in rows),
        "sent": sum(r["sent"] for r in rows),
        "not_sent": sum(r["not_sent"] for r in rows),
        "pending": sum(r["pending"] for r in rows),
        "printed_not_posted": sum(r["printed_not_posted"] for r in rows),
        "replans": sum(r["replans"] for r in rows),
        "postage_exposure": round(sum(r["postage_exposure"] for r in rows), 2),
        "avg_days_late": round(sum(all_late) / len(all_late), 2) if all_late else None,
        "on_time_pct": round(100.0 * sum(1 for d in all_late if d <= 0) / len(all_late), 2) if all_late else None,
    }
    return {"group_by": group_by, "rows": rows, "totals": totals,
            "reasons": sorted([{"reason": k, "count": v} for k, v in reasons.items()],
                              key=lambda x: -x["count"])}


# NOTE: this static path MUST stay above /mail-runs/{run_id} or FastAPI matches
# "analytics" as a run_id and this endpoint is never reached.
@router.get("/mail-runs/analytics")
async def get_mail_analytics(request: Request):
    """Offline-mail ROI: per-run funnel + cost efficiency + roll-up.

    A quotation is attributed to a run when it's for one of the run's schools and
    was created on/after the run's send date (falls back to the run's created_at).
    Same school in two runs counts under both — a v1 attribution simplification.
    """
    await get_current_user(request)
    runs = await db.mail_runs.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    out = []
    tot = {"sent": 0, "responded": 0, "appointments": 0, "quoted": 0,
           "pipeline_value": 0.0, "courier_cost": 0.0}
    for run in runs:
        rid = run["run_id"]
        sids = run.get("school_ids", []) or []
        since = run.get("send_date") or (run.get("created_at") or "")[:10]
        touches = await db.mail_touches.find({"run_id": rid}, {"_id": 0}).to_list(None)
        responded = sum(1 for t in touches if t.get("responded"))
        appts = sum(1 for t in touches if t.get("appointment"))
        quoted, pipeline = 0, 0.0
        if sids:
            q = {"school_id": {"$in": sids}}
            if since:
                q["created_at"] = {"$gte": since}
            quotes = await db.quotations.find(q, {"_id": 0, "school_id": 1, "grand_total": 1}).to_list(None)
            quoted = len({x.get("school_id") for x in quotes})
            pipeline = float(sum(x.get("grand_total", 0) or 0 for x in quotes))
        sent = run.get("counts", {}).get("sent", len(sids)) or len(sids)
        cost = float(run.get("courier_cost", 0) or 0)
        out.append({
            "run_id": rid, "name": run.get("name", ""), "piece_type": run.get("piece_type", ""),
            "status": run.get("status", ""), "send_date": run.get("send_date", ""),
            "sent": sent, "responded": responded, "appointments": appts,
            "quoted": quoted, "pipeline_value": pipeline, "courier_cost": cost,
            "response_rate": (responded / sent) if sent else 0.0,
            "cost_per_response": round(cost / responded, 2) if responded else None,
            "cost_per_appointment": round(cost / appts, 2) if appts else None,
        })
        tot["sent"] += sent; tot["responded"] += responded; tot["appointments"] += appts
        tot["quoted"] += quoted; tot["pipeline_value"] += pipeline; tot["courier_cost"] += cost
    tot["response_rate"] = (tot["responded"] / tot["sent"]) if tot["sent"] else 0.0
    tot["cost_per_response"] = round(tot["courier_cost"] / tot["responded"], 2) if tot["responded"] else None
    tot["cost_per_appointment"] = round(tot["courier_cost"] / tot["appointments"], 2) if tot["appointments"] else None
    return {"runs": out, "totals": tot}


@router.get("/mail-runs/{run_id}")
async def get_mail_run(run_id: str, request: Request):
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    run["touches"] = await db.mail_touches.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    return run


def _addr_missing(s):
    """Too incomplete to courier: needs a pincode AND a street + city."""
    return not (str(s.get("pincode") or "").strip()
                and str(s.get("address") or "").strip()
                and str(s.get("city") or "").strip())


def _complete_touches(touches, schools_by_id):
    """Only the touches whose school has a courier-complete address — so a print
    run doesn't waste labels (or mail blanks) on incomplete records."""
    return [t for t in touches if not _addr_missing(schools_by_id.get(t.get("school_id"), {}))]


@router.get("/mail-runs/{run_id}/addresses")
async def get_mail_run_addresses(run_id: str, request: Request):
    """Editable address sheet for a run — fill blanks before printing stickers."""
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    touches = await db.mail_touches.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    ids = [t["school_id"] for t in touches]
    schools = await db.schools.find({"school_id": {"$in": ids}}, {"_id": 0}).to_list(None)
    by_id = {s["school_id"]: s for s in schools}
    rows = []
    for t in touches:
        sid = t["school_id"]
        s = by_id.get(sid, {"school_id": sid, "school_name": "(deleted school)"})
        rows.append({
            "school_id": sid,
            "touch_id": t.get("touch_id", ""),
            "school_name": s.get("school_name", ""),
            "primary_contact_name": s.get("primary_contact_name", ""),
            "address": s.get("address", ""), "city": s.get("city", ""),
            "state": s.get("state", ""), "pincode": s.get("pincode", ""),
            "phone": s.get("phone", ""),
            "missing": _addr_missing(s),
            # Lifecycle — drives the Verify & post tab.
            "verify_status": t.get("verify_status", "pending"),
            "planned_date": t.get("planned_date", ""),
            "posted_at": t.get("posted_at"),
            "printed_at": t.get("printed_at"),
            "reason": t.get("reason", ""),
            "replan_count": int(t.get("replan_count", 0) or 0),
        })
    return {"run_id": run_id, "rows": rows, "total": len(rows),
            "missing_count": sum(1 for r in rows if r["missing"]),
            "pending_count": sum(1 for r in rows if r["verify_status"] == "pending")}


@router.delete("/mail-runs/{run_id}")
async def delete_mail_run(run_id: str, request: Request):
    """Delete a mail run + its per-school touches + the follow-up cadence tasks it
    generated. Does NOT touch the school records (their addresses stay)."""
    user = await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    t = await db.mail_touches.delete_many({"run_id": run_id})
    a = await db.crm_activities.delete_many({"batch_id": run_id, "source": "mail_cadence"})
    await db.mail_runs.delete_one({"run_id": run_id})
    return {"ok": True, "deleted_touches": t.deleted_count, "deleted_followups": a.deleted_count}


@router.post("/mail-runs/{run_id}/sync-schools")
async def sync_mail_run_to_schools(run_id: str, request: Request):
    """Manual sync: push the address the run is using for each school back onto
    that school's record — a one-click 'save everything to the school database'.
    Only writes non-empty fields so it never blanks a school."""
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    body = await _parse_json_body(request) if request else {}
    rows = body.get("rows") or []
    synced = 0
    for r in rows:
        sid = r.get("school_id")
        if not sid:
            continue
        upd = {k: v for k, v in {
            "address": (r.get("address") or "").strip(),
            "city": (r.get("city") or "").strip(),
            "state": (r.get("state") or "").strip(),
            "pincode": (r.get("pincode") or "").strip(),
            "primary_contact_name": (r.get("primary_contact_name") or "").strip(),
            "phone": (r.get("phone") or "").strip(),
        }.items() if v}
        if not upd:
            continue
        res = await db.schools.update_one({"school_id": sid}, {"$set": upd})
        if res.matched_count:
            synced += 1
    return {"ok": True, "synced": synced}


def _build_mail_run_csv(run, touches, schools_by_id):
    """Courier manifest / records: one row per school with postal address + contact
    + piece + response status. Returns CSV text."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["#", "School Name", "Addressed To", "Address", "City", "State", "Pincode",
                "School Phone", "Contact", "Contact Phone", "Piece", "Responded",
                "Interest", "Responded At"])
    for i, t in enumerate(touches, 1):
        s = schools_by_id.get(t.get("school_id")) or {"school_name": f"(deleted: {t.get('school_id','')})"}
        w.writerow([
            i, s.get("school_name", ""), "The Principal",
            s.get("address", ""), s.get("city", ""), s.get("state", ""), s.get("pincode", ""),
            s.get("phone", ""), t.get("contact_name", ""), t.get("contact_phone", ""),
            run.get("piece_type", ""), "Yes" if t.get("responded") else "No",
            t.get("interest", ""), t.get("responded_at", ""),
        ])
    return buf.getvalue()


@router.get("/mail-runs/{run_id}/export.csv")
async def export_mail_run(run_id: str, request: Request):
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    touches = await db.mail_touches.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    ids = [t["school_id"] for t in touches]
    schools = await db.schools.find({"school_id": {"$in": ids}}, {"_id": 0}).to_list(None)
    csv_text = _build_mail_run_csv(run, touches, {s["school_id"]: s for s in schools})
    safe = (run.get("name") or run_id).replace('"', "").replace(",", "")[:40]
    return StreamingResponse(io.BytesIO(csv_text.encode("utf-8-sig")), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="mail-run-{safe}.csv"'})


# A4 — the follow-up cadence a posted mailer triggers (offset days, type, title).
# Research: mail + tight early follow-ups converts; a single call wastes the postage.
DEFAULT_MAIL_CADENCE = [
    (2,  "Call",       "Follow-up call — did the mailer reach you?"),
    (4,  "WhatsApp",   "Send a proof photo/video of a school using it"),
    (7,  "Newsletter", "Email case study + dies catalogue"),
    (12, "Call",       "Offer a demo / visit"),
    (18, "Call",       "Closing nudge — hold a slot?"),
]


async def _create_mail_cadence(run, posted_iso, planner):
    """One follow-up activity per school per cadence step, assigned to each
    school's owner (fallback to the planner), due dates staggered from posting."""
    try:
        base = datetime.fromisoformat(posted_iso.replace("Z", "+00:00"))
    except Exception:
        base = datetime.now(timezone.utc)
    now_iso = datetime.now(timezone.utc).isoformat()
    for sid in run.get("school_ids", []):
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_name": 1, "assigned_to": 1, "assigned_name": 1})
        if not sch:
            continue
        if sch.get("assigned_to"):
            ato, aname = sch["assigned_to"], sch.get("assigned_name", "")
        else:
            ato, aname = planner["email"], planner.get("name", "")
        for offset, atype, title in DEFAULT_MAIL_CADENCE:
            due = (base + timedelta(days=offset)).strftime("%Y-%m-%d")
            await db.crm_activities.insert_one({
                "activity_id": f"act_{uuid.uuid4().hex[:10]}", "batch_id": run["run_id"],
                "school_id": sid, "school_name": sch.get("school_name", ""),
                "activity_type": atype, "title": title,
                "notes": f"Follow-up for mail run: {run.get('name', '')}",
                "due_date": due, "assigned_to": ato, "assigned_name": aname,
                "status": "pending", "created_by": planner["email"],
                "source": "mail_cadence", "created_at": now_iso, "done_at": None})


def _require_master_admin(user):
    """Renaming or deleting CRM master data is an admin act.

    These lists (designations, tags, activity types, school types) are shared by
    every lead form, school form and contact dialog in the app — deleting one row
    changes what every user sees. Creating a row stays open to any signed-in user,
    because a stray extra tag is harmless and reps legitimately add them; it is the
    destructive half that needed a gate.
    """
    if get_team(user) != "admin" and user.get("role") != "admin":
        raise HTTPException(status_code=403,
                            detail="Only an admin can change or delete master data")


VERIFY_STATUSES = ("pending", "sent", "not_sent", "skipped")


async def _recompute_run_counts(run_id: str):
    """Run status is DERIVED from its touches, never set blind: 'planned' while any
    piece is unresolved, 'posted' once every piece is sent or deliberately skipped.
    'closed' is only ever set by an explicit user action."""
    touches = await db.mail_touches.find({"run_id": run_id},
                                         {"_id": 0, "verify_status": 1}).to_list(None)
    tally = {s: 0 for s in VERIFY_STATUSES}
    for t in touches:
        st = t.get("verify_status", "pending")
        tally[st] = tally.get(st, 0) + 1
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0, "status": 1})
    _set = {
        "counts.verified_sent": tally["sent"],
        "counts.not_sent": tally["not_sent"],
        "counts.pending": tally["pending"],
    }
    if (run or {}).get("status") != "closed":
        _set["status"] = "posted" if (touches and tally["pending"] == 0) else "planned"
    await db.mail_runs.update_one({"run_id": run_id}, {"$set": _set})
    return await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})


async def _do_verify(run_id: str, user: dict, body: dict):
    """Core of verification, shared by the endpoint and the legacy status dropdown."""
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    now_iso = datetime.now(timezone.utc).isoformat()

    if body.get("undo"):
        ids = body.get("touch_ids") or []
        await db.mail_touches.update_many(
            {"run_id": run_id, "touch_id": {"$in": ids}},
            {"$set": {"verify_status": "pending", "posted_at": None,
                      "verified_by": "", "verified_at": None, "reason": ""}})
        for tid in ids:
            await db.engagement_events.delete_many({"dedup_key": f"mailtouch:{tid}"})
        return await _recompute_run_counts(run_id)

    posted_date = (body.get("posted_date") or "").strip()
    posted_iso = f"{posted_date}T00:00:00+00:00" if posted_date else now_iso
    if body.get("select_all"):
        status = body.get("verify_status", "sent")
        pending = await db.mail_touches.find(
            {"run_id": run_id, "verify_status": "pending"}, {"_id": 0, "touch_id": 1}).to_list(None)
        rows = [{"touch_id": t["touch_id"], "verify_status": status} for t in pending]
    else:
        rows = body.get("rows") or []

    for r in rows:
        if r.get("verify_status") not in VERIFY_STATUSES:
            raise HTTPException(status_code=400,
                                detail=f"Invalid verify_status: {r.get('verify_status')}")

    newly_sent = []
    for r in rows:
        tid, status = r.get("touch_id"), r["verify_status"]
        touch = await db.mail_touches.find_one({"run_id": run_id, "touch_id": tid}, {"_id": 0})
        if not touch:
            continue
        was_sent = touch.get("verify_status") == "sent"
        actual = (r.get("posted_date") or posted_date)
        _set = {"verify_status": status, "verified_by": user["email"], "verified_at": now_iso,
                "reason": (r.get("reason") or "").strip()}
        _set["posted_at"] = (f"{actual}T00:00:00+00:00" if actual else posted_iso) \
            if status == "sent" else None
        await db.mail_touches.update_one({"touch_id": tid}, {"$set": _set})
        if status == "sent" and not was_sent:
            newly_sent.append({**touch, "posted_at": _set["posted_at"]})

    for t in newly_sent:
        try:
            await log_engagement_event(
                channel="mail", kind=f"{t.get('piece_type', 'mailer')} posted",
                title=f"{t.get('item_name') or t.get('piece_type', 'Mailer')} posted",
                school_id=t.get("school_id", ""), lead_id=t.get("lead_id", ""),
                status="sent", direction="out", by=user["email"], at=t["posted_at"],
                meta={"run_id": run_id, "touch_id": t["touch_id"]},
                dedup_key=f"mailtouch:{t['touch_id']}")
        except Exception as e:
            logging.getLogger("crm").warning("[mail] ledger log failed: %s", str(e)[:180])
        # Follow-up cadence per school, and ONLY for pieces that really went out —
        # a school whose mailer never left must not be asked if it arrived.
        already = await db.crm_activities.count_documents(
            {"batch_id": run_id, "school_id": t.get("school_id", ""), "source": "mail_cadence"})
        if not already:
            await _create_mail_cadence({**run, "school_ids": [t.get("school_id", "")]},
                                       t["posted_at"], user)

    return await _recompute_run_counts(run_id)


@router.post("/mail-runs/{run_id}/verify")
async def verify_mail_run(run_id: str, request: Request):
    """Record what was ACTUALLY posted, one school at a time.

    Body is either {rows: [{touch_id, verify_status, posted_date?, reason?}]},
    {select_all: true, verify_status, posted_date?}, or {touch_ids: [...], undo: true}.
    """
    user = await get_current_user(request)
    return await _do_verify(run_id, user, await _parse_json_body(request))


@router.post("/mail-runs/{run_id}/replan")
async def replan_mail_run(run_id: str, request: Request):
    """Push the pieces that didn't go out onto a new date.

    Deliberately does NOT touch the drip enrolment schedule: a postage delay must
    never stall the WhatsApp and call cadence behind it (design spec 7.4).
    """
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    body = await _parse_json_body(request)
    new_date = (body.get("new_date") or "").strip()
    if not new_date:
        raise HTTPException(status_code=400, detail="new_date is required")

    movable = ("pending", "not_sent")
    if body.get("select_pending"):
        touches = await db.mail_touches.find(
            {"run_id": run_id, "verify_status": {"$in": list(movable)}}, {"_id": 0}).to_list(None)
    else:
        ids = body.get("touch_ids") or []
        touches = await db.mail_touches.find(
            {"run_id": run_id, "touch_id": {"$in": ids}}, {"_id": 0}).to_list(None)
        blocked = [t["touch_id"] for t in touches if t.get("verify_status") not in movable]
        if blocked:
            raise HTTPException(status_code=400,
                detail=f"Already posted, cannot be re-planned: {', '.join(blocked)}")

    for t in touches:
        await db.mail_touches.update_one({"touch_id": t["touch_id"]}, {
            "$set": {"planned_date": new_date, "verify_status": "pending", "reason": ""},
            "$inc": {"replan_count": 1}})
    run = await _recompute_run_counts(run_id)
    return {**run, "moved": len(touches), "new_date": new_date}


@router.put("/mail-runs/{run_id}/status")
async def update_mail_run_status(run_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    status = body.get("status")
    if status not in ("planned", "posted", "closed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    if status == "posted":
        # "Posted" now means "every pending piece really went out", so it routes
        # through verification — keeping the per-school truth (and the follow-up
        # cadence) honest instead of blind-stamping the whole run.
        return await _do_verify(run_id, user, {"select_all": True, "verify_status": "sent"})
    await db.mail_runs.update_one({"run_id": run_id}, {"$set": {"status": status}})
    return await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})


# ── Address stickers (Godex-500, 100x150mm, Indian postal style) ─────────────
def _wrap_text(text, maxlen):
    words = str(text or "").replace("\n", " ").split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= maxlen:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


# Sticker sizes in mm (width, height), portrait. "a4" is a separate 4-up layout.
_STICKER_SIZES = {
    "100x150": (100, 150),   # Godex-500 default
    "100x100": (100, 100),
    "75x50":   (75, 50),
    "65x38":   (65, 38),
    "50x25":   (50, 25),
}


def _clamp_scale(v):
    """Sticker text scale — user-controlled, but bounded so a label can never be
    scaled into unreadability or off its own edges."""
    try:
        return max(0.8, min(1.3, float(v)))
    except (TypeError, ValueError):
        return 1.0


def _parse_sticker_size(size):
    s = (size or "100x150").lower().strip()
    if s in _STICKER_SIZES:
        return _STICKER_SIZES[s]
    try:
        w, h = s.split("x")
        return (max(20.0, float(w)), max(12.0, float(h)))   # custom WxH mm, sane floor
    except Exception:
        return _STICKER_SIZES["100x150"]


def _wrap_to_width(c, text, font, size, max_w):
    """Wrap by MEASURED string width (points) so text fits any label size/orientation."""
    words = str(text or "").replace("\n", " ").split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if not cur or c.stringWidth(trial, font, size) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _company_from_lines(company):
    cname = company.get("company_name", "") or "SmartShape"
    tail = [z for z in [
        " - ".join([x for x in [company.get("city", ""), company.get("pincode", "")] if x]),
        company.get("state", ""),
    ] if z]
    # Respect explicit newlines the user typed in the From address (each becomes a line).
    addr = str(company.get("address", "") or "")
    body = [ln.strip() for ln in addr.splitlines() if ln.strip()][:3]
    if not body and addr.strip():
        body = _wrap_text(addr, 60)[:2]
    if tail:
        body.append(", ".join(tail))
    return cname, body


def _load_company_logo(company, base_url):
    """Company logo as a reportlab ImageReader, or None. Reads the local upload file
    directly when possible (reliable, no network); else fetches the URL."""
    raw = (company.get("logo_url") or "").strip()
    if not raw:
        return None
    try:
        from reportlab.lib.utils import ImageReader
        # Local upload (…/api/files/<path> or /uploads/<path>) → read the file directly.
        if not raw.startswith("http"):
            rel = raw.split("/api/files/", 1)[-1].split("/uploads/", 1)[-1].lstrip("/")
            uploads = _os.environ.get("UPLOADS_DIR", "/app/uploads")
            path = _os.path.join(uploads, rel)
            if _os.path.exists(path):
                return ImageReader(path)
        # Fall back to fetching over HTTP (absolute URL, or if the file wasn't found).
        url = raw if raw.startswith("http") else (base_url.rstrip("/") + "/" + raw.lstrip("/"))
        r = http_requests.get(url, timeout=6)
        if r.status_code == 200 and r.content:
            return ImageReader(io.BytesIO(r.content))
    except Exception:
        pass
    return None


def _render_label(c, x, y, w, h, sch, token, company, base_url, logo=None, frame=True,
                  endorsement="", endorsement_pt=0, text_scale=1.0, show_phone=True):
    """One address label inside rect (x,y,w,h): TO on top (bold school name),
    FROM below (bold company name), QR bottom-right. Fonts + wrap scale to width.

    `endorsement` is the postal tariff note ("Book Post" / "Open Post") that used to
    be written on by hand; it prints right-aligned above the To block, where the
    counter clerk looks and clear of the address. `text_scale` (0.8–1.3) sizes the
    whole label up or down."""
    from reportlab.lib.units import mm
    from reportlab.graphics.barcode import qr
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics import renderPDF

    m = max(2 * mm, 0.05 * min(w, h))
    ix, iw = x + m, w - 2 * m
    ts = _clamp_scale(text_scale)
    endorsement = str(endorsement or "").strip()

    # Compact layout for small labels (can't fit full address + FROM + big QR).
    if h < 45 * mm:
        f_name = max(6, min(9.5, (h / mm) * 0.30)) * ts
        f_body = max(5, f_name * 0.8)
        qsz = max(9 * mm, min(h - 2 * m, w * 0.30))
        tw = w - qsz - 3 * m
        cy = y + h - m - f_name
        if endorsement:
            # Only if it fits one line — a small label must not lose the address.
            e_sz = float(endorsement_pt) if endorsement_pt else f_name * 0.8
            if c.stringWidth(endorsement, "Helvetica-Bold", e_sz) <= tw:
                c.setFont("Helvetica-Bold", e_sz)
                c.drawString(ix, cy, endorsement)
                cy -= e_sz * 1.15
        c.setFont("Helvetica-Bold", f_name)
        for ln in _wrap_to_width(c, sch.get("school_name", ""), "Helvetica-Bold", f_name, tw)[:2]:
            c.drawString(ix, cy, ln); cy -= f_name * 1.12
        c.setFont("Helvetica", f_body)
        cp = " - ".join([z for z in [sch.get("city", ""), sch.get("pincode", "")] if z])
        if cp:
            c.drawString(ix, cy, cp); cy -= f_body * 1.2
        if sch.get("state"):
            c.drawString(ix, cy, sch.get("state", ""))
        cname, _ = _company_from_lines(company)
        c.setFont("Helvetica", max(4.5, f_body * 0.78))
        c.drawString(ix, y + m, ("From: " + cname)[:44])
        if token:
            url = f"{base_url}/api/r/{token}"
            qrw = qr.QrCodeWidget(url)
            b = qrw.getBounds(); bw = (b[2] - b[0]) or 1; bh = (b[3] - b[1]) or 1
            d = Drawing(qsz, qsz, transform=[qsz / bw, 0, 0, qsz / bh, 0, 0]); d.add(qrw)
            renderPDF.draw(d, c, x + w - qsz - m, y + (h - qsz) / 2)
        return

    scale = w / (100 * mm)
    f_lbl  = max(5.5, min(9, 8 * scale)) * ts
    f_body = max(6.5, min(11, 11 * scale)) * ts
    f_name = max(8, min(15, 14 * scale)) * ts
    f_pin  = max(7, min(13, 12 * scale)) * ts
    LH = 1.22

    bottom_h = max(24 * mm, h * 0.46)          # From section gets ~half the label
    qsz = max(14 * mm, min(bottom_h - 2 * m, w * 0.32, 32 * mm))

    # ── clean frame border (finished look; A4 4-up passes frame=False, has cut lines) ──
    if frame:
        c.setLineWidth(0.7); c.setStrokeGray(0.72)
        c.roundRect(x + 1.3 * mm, y + 1.3 * mm, w - 2.6 * mm, h - 2.6 * mm, 2.6 * mm)
        c.setStrokeGray(0)

    dv = y + bottom_h   # divider between the TO (top) and FROM (bottom) halves

    # ── TO block — build every line first, then centre it (biased high) in the top
    #    zone so the recipient address is balanced, not crammed against the top edge.
    #    Postal order: NAME → SCHOOL → ADDRESS → PHONE. The person's own name goes
    #    first (falling back to "The Principal" only when we don't know it), because
    #    a cover addressed to a named person actually reaches that person.
    person = str(sch.get("primary_contact_name") or "").strip() or "The Principal"
    to_lines = [("To,", "Helvetica", f_lbl), (person + ",", "Helvetica", f_body)]
    nl = _wrap_to_width(c, sch.get("school_name", ""), "Helvetica-Bold", f_name, iw)[:2]
    for i, ln in enumerate(nl):
        to_lines.append((ln + ("," if i == len(nl) - 1 else ""), "Helvetica-Bold", f_name))
    al = _wrap_to_width(c, sch.get("address", ""), "Helvetica", f_body, iw)[:3]
    for i, ln in enumerate(al):
        to_lines.append((ln + ("," if i == len(al) - 1 else ""), "Helvetica", f_body))
    cp = " - ".join([z for z in [sch.get("city", ""), sch.get("pincode", "")] if z])
    if cp:
        to_lines.append((cp + ("," if sch.get("state") else "."), "Helvetica-Bold", f_pin))
    if sch.get("state"):
        to_lines.append((sch.get("state", "") + ".", "Helvetica", f_body))
    to_phone = str(sch.get("phone") or "").strip()
    if show_phone and to_phone:
        to_lines.append(("Ph: " + to_phone, "Helvetica", f_body))

    def _lh(sz):
        return sz * 1.18
    block_h = sum(_lh(sz) for _, _, sz in to_lines)

    top = y + h - m
    if endorsement:
        # Right-aligned above "To," — the TO block wraps to the full inner width, so
        # an overlay in the right margin would collide; this never can.
        e_sz = float(endorsement_pt) if endorsement_pt else f_name * 0.8
        c.setFont("Helvetica-Bold", e_sz)
        c.drawRightString(x + w - m, top - e_sz, endorsement[:40])
        top -= e_sz * 1.25

    # A larger text scale must never push the address down into the From block: if
    # the lines no longer fit the top zone, shrink them proportionally to fit.
    top_h = top - dv
    if block_h > top_h > 0:
        shrink = top_h / block_h
        to_lines = [(t, f, sz * shrink) for t, f, sz in to_lines]
        block_h = top_h

    cy = top - max(0.0, top_h - block_h) * 0.30     # 30% of slack above → gentle balance
    for text, font, sz in to_lines:
        c.setFont(font, sz); c.drawString(ix, cy - sz, text); cy -= _lh(sz)

    # ── divider ──
    c.setLineWidth(0.5); c.setStrokeGray(0.45); c.line(ix, dv, x + w - m, dv); c.setStrokeGray(0)

    # ── FROM (bottom-left): logo above, then company name (smaller but BOLD) ──
    cname, from_body = _company_from_lines(company)
    from_w = w - qsz - 3 * m
    f_from = f_body * 0.86            # company name: smaller than the To fields, still bold
    fy = dv - m

    # Logo sits just under the divider, above "From:"
    if logo is not None:
        try:
            iw_img, ih_img = logo.getSize()
            logo_h = min(9 * mm, h * 0.09)
            logo_w = min(from_w, logo_h * (iw_img / ih_img) if ih_img else logo_h)
            fy -= logo_h
            c.drawImage(logo, ix, fy, width=logo_w, height=logo_h, mask='auto', preserveAspectRatio=True)
            fy -= 1.2 * mm
        except Exception:
            pass

    # Optional text tagline / branding "liner" — always prints (unlike an image).
    tagline = str(company.get("sticker_tagline", "") or "").strip()
    if tagline:
        c.setFont("Helvetica-Bold", f_from)
        for tl in _wrap_to_width(c, tagline, "Helvetica-Bold", f_from, from_w)[:2]:
            fy -= f_from; c.drawString(ix, fy, tl)
        fy -= 1 * mm

    fy -= f_lbl
    c.setFont("Helvetica", f_lbl); c.drawString(ix, fy, "From:")
    fy -= f_from * LH
    # Contact / attention name — sits directly UNDER "From:" (standard sender format)
    contact = str(company.get("sticker_contact", "") or "").strip()
    if contact:
        c.setFont("Helvetica-Bold", f_from)
        for cl in _wrap_to_width(c, contact, "Helvetica-Bold", f_from, from_w)[:1]:
            c.drawString(ix, fy, cl); fy -= f_from * LH
    # Company name (bold)
    c.setFont("Helvetica-Bold", f_from)
    for ln in _wrap_to_width(c, cname, "Helvetica-Bold", f_from, from_w)[:2]:
        c.drawString(ix, fy, ln); fy -= f_from * LH
    # Address — wrap fully so it isn't cut mid-way (stop only if we run out of room)
    c.setFont("Helvetica", f_lbl)
    for ln in from_body:
        for wl in _wrap_to_width(c, ln, "Helvetica", f_lbl, from_w):
            if fy < y + m:
                break
            c.drawString(ix, fy, wl); fy -= f_lbl * LH
    # Sender phone last — the line the recipient uses to call back.
    from_phone = str(company.get("phone") or "").strip()
    if show_phone and from_phone and fy >= y + m:
        c.drawString(ix, fy, "Ph: " + from_phone[:24]); fy -= f_lbl * LH

    # ── QR (bottom-right) ──
    if token:
        url = f"{base_url}/api/r/{token}"
        qrw = qr.QrCodeWidget(url)
        b = qrw.getBounds(); bw = (b[2] - b[0]) or 1; bh = (b[3] - b[1]) or 1
        d = Drawing(qsz, qsz, transform=[qsz / bw, 0, 0, qsz / bh, 0, 0]); d.add(qrw)
        renderPDF.draw(d, c, x + w - qsz - m, y + m)
        c.setFont("Helvetica", max(5, f_lbl * 0.75))
        c.drawCentredString(x + w - qsz / 2 - m, y + m - f_lbl * 0.72, "Scan to connect")


def _build_stickers_pdf(touches, schools_by_id, company, base_url, *,
                        orientation="portrait", size="100x150", layout="label",
                        from_override=None, show_logo=True,
                        endorsement="", endorsement_pt=0, text_scale=1.0, show_phone=True):
    """Address labels — Godex thermal (one per page) or A4 4-up for a normal
    printer. TO on top, FROM below (company bold), QR, auto-wrapped to the size.
      orientation: portrait | landscape (thermal only)
      size:        preset ("100x150", "50x25"…) or custom "WxH" mm
      layout:      label (one per page) | a4 (2x2 = 4 labels per A4 sheet)
      from_override: optional {company_name,address,city,state,pincode} for this batch
    """
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.lib.pagesizes import A4

    if from_override:
        company = {**company, **{k: v for k, v in from_override.items() if v}}

    logo = _load_company_logo(company, base_url) if show_logo else None   # once, drawn on every label
    buf = io.BytesIO()

    if layout == "a4":
        PW, PH = A4
        c = canvas.Canvas(buf, pagesize=(PW, PH))
        gx = gy = 8 * mm
        cols, rows = 2, 2
        cw, ch = (PW - 2 * gx) / cols, (PH - 2 * gy) / rows
        per_page = cols * rows
        if not touches:
            c.showPage()
        for idx, t in enumerate(touches):
            if idx and idx % per_page == 0:
                c.showPage()
            slot = idx % per_page
            col, row = slot % cols, slot // cols
            cx = gx + col * cw
            cyy = PH - gy - (row + 1) * ch
            c.setDash(2, 2); c.setLineWidth(0.4); c.setStrokeGray(0.7)
            c.rect(cx, cyy, cw, ch); c.setDash(); c.setStrokeGray(0)
            _render_label(c, cx, cyy, cw, ch, schools_by_id.get(t.get("school_id"), {}),
                          t.get("qr_token", ""), company, base_url, logo=logo, frame=False,
                          endorsement=endorsement, endorsement_pt=endorsement_pt,
                          text_scale=text_scale, show_phone=show_phone)
        c.save()
        return buf.getvalue()

    # thermal: one label per page
    w_mm, h_mm = _parse_sticker_size(size)
    if orientation == "landscape":
        w_mm, h_mm = h_mm, w_mm
    W, H = w_mm * mm, h_mm * mm
    c = canvas.Canvas(buf, pagesize=(W, H))
    if not touches:
        c.showPage()
    for t in touches:
        _render_label(c, 0, 0, W, H, schools_by_id.get(t.get("school_id"), {}),
                      t.get("qr_token", ""), company, base_url, logo=logo,
                      endorsement=endorsement, endorsement_pt=endorsement_pt,
                      text_scale=text_scale, show_phone=show_phone)
        c.showPage()
    c.save()
    return buf.getvalue()


@router.get("/mail-runs/{run_id}/stickers.pdf")
async def mail_run_stickers(run_id: str, request: Request):
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    touches = await db.mail_touches.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    ids = [t["school_id"] for t in touches]
    schools = await db.schools.find({"school_id": {"$in": ids}}, {"_id": 0}).to_list(None)
    schools_by_id = {s["school_id"]: s for s in schools}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    base = (_os.environ.get("FRONTEND_URL") or "https://app.smartshape.in").rstrip("/")
    qp = request.query_params
    if qp.get("skip_incomplete") in ("1", "true", "yes"):
        touches = _complete_touches(touches, schools_by_id)
    orientation = "landscape" if qp.get("orientation") == "landscape" else "portrait"
    layout = "a4" if qp.get("layout") == "a4" else "label"
    size = qp.get("size") or "100x150"
    # Endorsement ("Book Post" / "Open Post") + text size: a per-batch query param
    # wins, else the saved Settings → Company defaults.
    endorsement = qp.get("endorsement")
    if endorsement is None:
        endorsement = company.get("sticker_endorsement", "")
    try:
        endorsement_pt = float(qp.get("endorsement_pt") or company.get("sticker_endorsement_pt") or 0)
    except (TypeError, ValueError):
        endorsement_pt = 0
    text_scale = _clamp_scale(qp.get("text_scale") or company.get("sticker_text_scale") or 1.0)
    # Printing IS the event: stamp the batch so "printed but never posted" is
    # answerable later. Only the labels actually rendered get marked — a touch
    # skipped for an incomplete address was never printed.
    if touches:
        await db.mail_touches.update_many(
            {"touch_id": {"$in": [t["touch_id"] for t in touches if t.get("touch_id")]}},
            {"$set": {"printed_at": datetime.now(timezone.utc).isoformat(),
                      "print_batch_id": f"pb_{uuid.uuid4().hex[:12]}"}})
    # Optional per-batch FROM override (else falls back to Settings → Company)
    show_logo = qp.get("no_logo") not in ("1", "true", "yes")
    from_override = None
    if any(qp.get(k) for k in ("from_name", "from_address", "from_tagline", "from_contact", "from_phone")):
        from_override = {
            "company_name": qp.get("from_name", ""), "address": qp.get("from_address", ""),
            "city": qp.get("from_city", ""), "state": qp.get("from_state", ""),
            "pincode": qp.get("from_pincode", ""), "sticker_tagline": qp.get("from_tagline", ""),
            "sticker_contact": qp.get("from_contact", ""), "phone": qp.get("from_phone", ""),
        }
    pdf = _build_stickers_pdf(touches, schools_by_id, company, base, orientation=orientation,
                              size=size, layout=layout, from_override=from_override,
                              show_logo=show_logo, endorsement=endorsement,
                              endorsement_pt=endorsement_pt, text_scale=text_scale,
                              show_phone=(qp.get("no_phone") not in ("1", "true", "yes")))
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="stickers-{run_id}.pdf"'})


async def _mark_touch_responded(t):
    """A scan/submit counts as one response on the run (idempotent)."""
    if t and not t.get("responded"):
        await db.mail_touches.update_one({"qr_token": t["qr_token"]}, {"$set": {
            "responded": True, "responded_at": datetime.now(timezone.utc).isoformat(), "response_channel": "qr"}})
        if t.get("run_id"):
            await db.mail_runs.update_one({"run_id": t["run_id"]}, {"$inc": {"counts.responded": 1}})


async def _qr_interest_options():
    rows = await db.deal_types.find({}, {"_id": 0, "name": 1}).sort("name", 1).to_list(100)
    opts = [r["name"] for r in rows if r.get("name")] or list(DEFAULT_DEAL_TYPES)
    return opts + ["Just exploring"]


# Public QR landing — renders a branded capture form. A scan itself already counts
# as a response; submitting tells us what the school wants + when to call.
@router.get("/r/{qr_token}")
async def mail_qr_respond(qr_token: str):
    t = await db.mail_touches.find_one({"qr_token": qr_token}, {"_id": 0})
    await _mark_touch_responded(t)
    school_name = (t or {}).get("school_name", "")
    if not school_name and t and t.get("school_id"):
        sch = await db.schools.find_one({"school_id": t["school_id"]}, {"_id": 0, "school_name": 1}) or {}
        school_name = sch.get("school_name", "")
    opts = await _qr_interest_options()
    chips = "".join(
        f"<label class='chip'><input type='radio' name='interest' value=\"{_html_escape(o)}\">{_html_escape(o)}</label>"
        for o in opts)
    greeting = f"Hello{(' — ' + _html_escape(school_name)) if school_name else ''}!"
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SMARTS-SHAPES</title>
<style>
 :root{{--brand:#e94560;--ink:#1a211e;--bg:#f4f5f2;--card:#fff;--muted:#6b7280;--line:#e5e7eb}}
 *{{box-sizing:border-box}} body{{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}}
 .wrap{{max-width:460px;margin:0 auto;padding:22px 16px 40px}}
 .brand{{font-weight:800;letter-spacing:.5px;color:var(--brand);font-size:20px}}
 .tag{{color:var(--muted);font-size:12px;margin-top:2px}}
 .card{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}}
 h1{{font-size:19px;margin:.2em 0 .1em}} p.sub{{color:var(--muted);font-size:13px;margin:.2em 0 1em}}
 .chips{{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 14px}}
 .chip{{border:1px solid var(--line);border-radius:999px;padding:8px 12px;font-size:13px;cursor:pointer;user-select:none}}
 .chip input{{display:none}} .chip:has(input:checked){{background:var(--brand);color:#fff;border-color:var(--brand)}}
 label.fld{{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}}
 input.f,select.f,textarea.f{{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px;font-size:15px;font-family:inherit}}
 .row{{display:flex;gap:10px}} .row>div{{flex:1}}
 button{{width:100%;margin-top:16px;background:var(--brand);color:#fff;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}}
 .ok{{text-align:center;padding:26px 8px}} .ok h1{{color:var(--brand)}}
 .hide{{display:none}}
</style></head><body><div class="wrap">
 <div class="brand">SMARTS-SHAPES</div><div class="tag">Learning through Craft</div>
 <div class="card" id="form">
  <h1>{greeting}</h1>
  <p class="sub">Tell us what you’d like — our team will call you back.</p>
  <div><label class="fld">I’m interested in</label><div class="chips">{chips}</div></div>
  <div class="row">
   <div><label class="fld">Your name</label><input class="f" id="name" placeholder="Name"></div>
   <div><label class="fld">Phone</label><input class="f" id="phone" inputmode="tel" placeholder="Mobile"></div>
  </div>
  <label class="fld">Best time to call</label>
  <select class="f" id="ptime"><option value="">Any time</option><option>Morning</option><option>Afternoon</option><option>Evening</option></select>
  <label class="fld">Anything else (optional)</label>
  <textarea class="f" id="note" rows="2" placeholder="e.g. need 20 dies, want a demo"></textarea>
  <button id="btn">Request a callback</button>
 </div>
 <div class="card ok hide" id="done"><h1>Thank you!</h1><p class="sub">We’ve got your details — our team will call you shortly about SMARTS-SHAPES.</p></div>
<script>
 var btn=document.getElementById('btn');
 btn.onclick=function(){{
  var sel=document.querySelector('input[name=interest]:checked');
  var body={{interest:sel?sel.value:'',name:document.getElementById('name').value,
    phone:document.getElementById('phone').value,preferred_time:document.getElementById('ptime').value,
    note:document.getElementById('note').value}};
  btn.disabled=true;btn.textContent='Sending…';
  fetch('/api/r/{qr_token}/interest',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(body)}})
   .then(function(){{document.getElementById('form').classList.add('hide');document.getElementById('done').classList.remove('hide');}})
   .catch(function(){{btn.disabled=false;btn.textContent='Request a callback';alert('Please try again.');}});
 }};
</script></div></body></html>"""
    return HTMLResponse(html)


async def _wa_notify(phone, message):
    """Send an internal WhatsApp alert to a rep. Reuses the school_routes sender
    (posts to messageautosender.com); safe no-op if WhatsApp isn't configured or
    the phone is blank. Never raises into the caller."""
    if not (phone or "").strip():
        return
    try:
        from routes.school_routes import _wa_send  # lazy → avoids import cycle
        await _wa_send(phone, message)
    except Exception:
        pass


@router.post("/r/{qr_token}/interest")
async def mail_qr_interest(qr_token: str, request: Request):
    """Public capture: record what the school wants + raise a HIGH-priority callback
    task for the account owner (fallback: the run's creator)."""
    try:
        body = await request.json()
    except Exception:
        body = {}  # bare/malformed POST from a scanner must never 500 a public page
    t = await db.mail_touches.find_one({"qr_token": qr_token}, {"_id": 0})
    if not t:
        return {"ok": True}  # unknown/expired token — never error a public scan
    now_iso = datetime.now(timezone.utc).isoformat()
    interest = (body.get("interest") or "").strip()
    name = (body.get("name") or "").strip()
    phone = (body.get("phone") or "").strip()
    ptime = (body.get("preferred_time") or "").strip()
    note = (body.get("note") or "").strip()

    # Idempotency guard: a public endpoint anyone can re-POST. Capture the interest
    # every time, but raise the task + bell + WhatsApp only on the FIRST submission
    # for this touch, so a double-tap (or abuse) can't spam the rep with duplicates.
    first_time = not t.get("interested")
    await _mark_touch_responded(t)
    await db.mail_touches.update_one({"qr_token": qr_token}, {"$set": {
        "interested": True, "interest": interest, "preferred_time": ptime,
        "contact_name": name, "contact_phone": phone, "interest_note": note,
        "interested_at": now_iso, "response_channel": "qr_form"}})

    sch = await db.schools.find_one({"school_id": t.get("school_id")}, {"_id": 0}) or {}
    owner = sch.get("assigned_to") or t.get("owner") or ""
    owner_name = sch.get("assigned_name", "")
    detail = f"Interested in: {interest or '(not specified)'}."
    if name or phone:
        detail += f" Contact: {name} {phone}.".rstrip()
    if ptime:
        detail += f" Best time: {ptime}."
    if note:
        detail += f" Note: {note}"
    school_name = sch.get("school_name", t.get("school_name", "")) or "A school"

    if first_time:
        await db.crm_activities.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:10]}", "batch_id": t.get("run_id", ""),
            "school_id": t.get("school_id", ""), "school_name": sch.get("school_name", t.get("school_name", "")),
            "activity_type": "Call", "title": "📩 Direct-mail QR lead — call back",
            "notes": detail, "due_date": now_iso[:10], "priority": "high",
            "assigned_to": owner, "assigned_name": owner_name, "status": "pending",
            "created_by": "qr", "source": "qr_interest", "created_at": now_iso, "done_at": None})

        # ping the owner instantly (bell + WhatsApp) so a hot lead doesn't wait in a list
        if owner:
            await notify_user(
                owner, type="qr_interest",
                title="📩 Hot lead from a mailer",
                body=f"{school_name} scanned your mailer — {detail}",
                ref_type="school", ref_id=t.get("school_id", ""),
                from_name=name or "Direct-mail QR")
            # reps live on their phones — also WhatsApp them the hot lead
            urep = await db.users.find_one({"email": owner},
                                           {"_id": 0, "phone": 1, "calling_number": 1}) or {}
            rep_phone = (urep.get("phone") or urep.get("calling_number") or "").strip()
            wa_msg = (f"📩 New mailer lead — {school_name}\n"
                      f"Interested in: {interest or 'not specified'}\n"
                      + (f"Contact: {name} {phone}\n" if (name or phone) else "")
                      + (f"Best time: {ptime}\n" if ptime else "")
                      + "Call them back — a task is waiting in SmartShape CRM.")
            await _wa_notify(rep_phone, wa_msg)

    # keep the school phone fresh if it was blank and the scanner gave one
    if phone and not sch.get("phone") and t.get("school_id"):
        await db.schools.update_one({"school_id": t["school_id"]},
                                    {"$set": {"phone": phone, "last_activity_date": now_iso}})
    return {"ok": True}


# ── Trackable brochure share (Engagement OS, Phase 3) ─────────────────────────
# Share a brochure/catalogue as a tracked link. Opening it records the open,
# logs a "brochure opened" event on the school Timeline (Phase 0), and drops a
# HOT call-back task on the owner's plate (calendar + daily queue, Phase 1) —
# turning a silent send into a buying signal.

def _brochure_public_url(token: str) -> str:
    base = (_os.environ.get("FRONTEND_URL") or "https://app.smartshape.in").rstrip("/")
    return f"{base}/api/b/{token}"


@router.post("/brochures/share")
async def create_brochure_share(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    brochure_url = (body.get("brochure_url") or "").strip()
    if not brochure_url:
        raise HTTPException(status_code=400, detail="brochure_url is required")
    if not brochure_url.lower().startswith(("http://", "https://", "/api/files/", "/uploads/")):
        raise HTTPException(status_code=400, detail="brochure_url must be an http(s) or uploaded-file link")

    lead_id = (body.get("lead_id") or "").strip()
    school_id = (body.get("school_id") or "").strip()
    contact_id = (body.get("contact_id") or "").strip()
    school_name = (body.get("school_name") or "").strip()
    recipient = (body.get("recipient_name") or "").strip()

    # Fill blanks from the linked records so the timeline + hot task read well.
    if lead_id and not (school_id and school_name):
        lead = await db.leads.find_one({"lead_id": lead_id},
                                       {"_id": 0, "school_id": 1, "company_name": 1, "contact_name": 1, "contact_id": 1})
        if lead:
            school_id = school_id or lead.get("school_id", "")
            school_name = school_name or lead.get("company_name", "")
            recipient = recipient or lead.get("contact_name", "")
            contact_id = contact_id or lead.get("contact_id", "")
    if school_id and not school_name:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
        school_name = (sch or {}).get("school_name", "")

    now_iso = datetime.now(timezone.utc).isoformat()
    token = uuid.uuid4().hex[:16]
    share = {
        "share_id": f"bsh_{uuid.uuid4().hex[:10]}", "token": token,
        "brochure_url": brochure_url, "title": (body.get("title") or "Brochure").strip(),
        "lead_id": lead_id, "school_id": school_id, "contact_id": contact_id,
        "school_name": school_name, "recipient_name": recipient,
        "status": "sent", "open_count": 0,
        "first_opened_at": None, "last_opened_at": None,
        "created_by": user["email"], "created_by_name": user.get("name", ""),
        "created_at": now_iso, "sent_at": now_iso,
    }
    await db.brochure_shares.insert_one(dict(share))

    await log_engagement_event(
        channel="brochure", kind="Brochure shared", title=share["title"],
        school_id=school_id, lead_id=lead_id, contact_id=contact_id,
        status="sent", direction="out", by=user.get("name", ""), at=now_iso,
        meta={"share_id": share["share_id"]})

    share.pop("_id", None)
    return {**share, "share_url": _brochure_public_url(token)}


@router.get("/brochures/shares")
async def list_brochure_shares(request: Request):
    await get_current_user(request)
    qp = request.query_params
    q = {}
    for k in ("lead_id", "school_id", "contact_id"):
        if qp.get(k):
            q[k] = qp.get(k)
    rows = await db.brochure_shares.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for r in rows:
        r["share_url"] = _brochure_public_url(r["token"])
    return rows


async def _record_brochure_open(share: dict, token: str):
    """Record the open + fire the hot signal on the FIRST open. Best-effort:
    open_brochure wraps this so serving the brochure never depends on tracking."""
    now_iso = datetime.now(timezone.utc).isoformat()
    first_open = share.get("status") != "opened"
    upd = {"status": "opened", "last_opened_at": now_iso}
    if first_open:
        upd["first_opened_at"] = now_iso
    await db.brochure_shares.update_one(
        {"token": token}, {"$set": upd, "$inc": {"open_count": 1}})
    if not first_open:
        return

    # A buying signal: log it on the Timeline (inbound) and raise a HOT call-back
    # for the owner — but only once, on first open.
    sid, lid, cid = share.get("school_id", ""), share.get("lead_id", ""), share.get("contact_id", "")
    try:
        await log_engagement_event(
            channel="brochure", kind="Brochure opened",
            title=f"Opened: {share.get('title', 'Brochure')}",
            school_id=sid, lead_id=lid, contact_id=cid,
            status="opened", direction="in", by=share.get("recipient_name", ""),
            at=now_iso, meta={"share_id": share.get("share_id", "")},
            dedup_key=f"brochure_open:{token}")
    except Exception:
        pass
    if lid:
        await db.leads.update_one(
            {"lead_id": lid},
            {"$set": {"lead_type": "hot", "brochure_opened_at": now_iso,
                      "last_activity_date": now_iso}})
        try:
            await _auto_enroll_on_trigger(lid, "brochure_opened")
        except Exception:
            pass
    owner_to, owner_name = "", ""
    if lid:
        lead = await db.leads.find_one({"lead_id": lid}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        owner_to, owner_name = (lead or {}).get("assigned_to", ""), (lead or {}).get("assigned_name", "")
    if not owner_to and sid:
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        owner_to, owner_name = (sch or {}).get("assigned_to", ""), (sch or {}).get("assigned_name", "")
    if owner_to:
        await db.crm_activities.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:10]}",
            "school_id": sid, "school_name": share.get("school_name", ""),
            "activity_type": "Call", "channel": "call", "priority": "high",
            "title": f"🔥 {share.get('school_name') or 'A school'} opened the brochure — call now",
            "notes": f"Opened '{share.get('title', 'Brochure')}' at {now_iso[:16].replace('T', ' ')}.",
            "due_date": now_iso[:10], "assigned_to": owner_to, "assigned_name": owner_name,
            "status": "pending", "source": "brochure_open",
            "created_by": "system", "created_at": now_iso, "done_at": None})


@router.get("/b/{token}")
async def open_brochure(token: str):
    """PUBLIC — records the open, fires the hot signal on the FIRST open, then
    redirects the visitor to the actual brochure. No auth (the recipient is a
    prospect, not a logged-in user)."""
    share = await db.brochure_shares.find_one({"token": token}, {"_id": 0})
    if not share:
        raise HTTPException(status_code=404, detail="Brochure not found")

    try:
        await _record_brochure_open(share, token)
    except Exception:
        pass  # tracking is best-effort — the brochure must always load

    return RedirectResponse(url=share["brochure_url"], status_code=302)


# ── Brochure library (upload once, reuse — powers one-tap tracked shares) ─────

@router.post("/brochures")
async def upload_brochure(file: UploadFile = File(...), title: str = Form(""), request: Request = None):
    user = await get_current_user(request) if request else {"email": "", "name": ""}
    from services.storage import save_upload
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "pdf"
    path = f"brochures/{uuid.uuid4().hex[:12]}.{ext}"
    data = await file.read()
    url = await save_upload(path, data, file.content_type or "application/pdf", legacy="local")
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "brochure_id": f"brc_{uuid.uuid4().hex[:10]}",
        "title": (title or (file.filename or "Brochure").rsplit(".", 1)[0]).strip(),
        "url": url, "file_type": ext, "size_bytes": len(data),
        "created_by": user.get("email", ""), "created_by_name": user.get("name", ""),
        "created_at": now_iso, "is_active": True,
    }
    await db.brochures.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/brochures")
async def list_brochures(request: Request):
    await get_current_user(request)
    return await db.brochures.find(
        {"is_active": {"$ne": False}}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.delete("/brochures/{brochure_id}")
async def delete_brochure(brochure_id: str, request: Request):
    user = await get_current_user(request)
    brc = await db.brochures.find_one({"brochure_id": brochure_id}, {"_id": 0})
    if not brc:
        raise HTTPException(status_code=404, detail="Brochure not found")
    if get_team(user) != "admin" and brc.get("created_by") != user.get("email"):
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can remove this")
    await db.brochures.update_one({"brochure_id": brochure_id}, {"$set": {"is_active": False}})
    return {"ok": True}


# ── Engagement funnel dashboard (Engagement OS, Phase 5) ──────────────────────
# The capstone scoreboard: pipeline funnel + cross-channel touch stats + brochure
# performance + hot signals + stuck deals, in one owner-facing view.

_FUNNEL_STAGES = ["new", "contacted", "demo", "quoted", "negotiation", "won", "lost"]


@router.get("/engagement/dashboard")
async def engagement_dashboard(request: Request):
    user = await get_current_user(request)
    try:
        days = max(1, min(365, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    stuck_cut = (now - timedelta(days=14)).isoformat()

    # Scope: admins see everything; everyone else sees only their own accounts.
    scope_owner = None if get_team(user) == "admin" else user.get("email", "")
    lead_q = {}
    my_lead_ids = None
    if scope_owner is not None:
        lead_q["assigned_to"] = scope_owner
        my_lead_ids = [l["lead_id"] async for l in
                       db.leads.find({"assigned_to": scope_owner}, {"_id": 0, "lead_id": 1})]

    # Assemble every query spec, then run the independent reads concurrently
    # (funnel, channels, brochure counts, sequences, hot signals, stuck deals).
    ev_match = {"at": {"$gte": since}}
    b_match = {"created_at": {"$gte": since}}
    seq_q = {"status": "active"}
    if my_lead_ids is not None:
        _in = {"$in": my_lead_ids}
        ev_match["lead_id"] = _in
        b_match["lead_id"] = _in
        seq_q["lead_id"] = _in
    hot_q = {"source": "brochure_open", "created_at": {"$gte": since}}
    if scope_owner is not None:
        hot_q["assigned_to"] = scope_owner

    agg, ev_agg, shared, opened, sequences_active, hot_signals, stuck_rows = await asyncio.gather(
        db.leads.aggregate([
            {"$match": lead_q},
            {"$group": {"_id": "$stage", "count": {"$sum": 1},
                        "value": {"$sum": {"$ifNull": ["$expected_value", 0]}}}},
        ]).to_list(None),
        db.engagement_events.aggregate([
            {"$match": ev_match},
            {"$group": {"_id": {"channel": "$channel", "direction": "$direction"}, "n": {"$sum": 1}}},
        ]).to_list(None),
        db.brochure_shares.count_documents(b_match),
        db.brochure_shares.count_documents({**b_match, "status": "opened"}),
        db.drip_enrollments.count_documents(seq_q),
        db.crm_activities.count_documents(hot_q),
        db.leads.find(
            {**lead_q, "stage": {"$in": ["quoted", "negotiation"]},
             "last_activity_date": {"$lt": stuck_cut}},
            {"_id": 0, "lead_id": 1, "company_name": 1, "school_id": 1, "stage": 1,
             "expected_value": 1, "assigned_name": 1, "last_activity_date": 1},
        ).sort("last_activity_date", 1).to_list(25),
    )

    # Pipeline funnel — count + expected value per stage.
    by_stage = {a["_id"]: a for a in agg}
    funnel = [{"stage": s, "count": by_stage.get(s, {}).get("count", 0),
               "value": round(by_stage.get(s, {}).get("value", 0) or 0, 2)} for s in _FUNNEL_STAGES]

    # Cross-channel touches from the ledger.
    channels = {}
    touches_total = 0
    for row in ev_agg:
        ch = row["_id"].get("channel") or "other"
        direction = row["_id"].get("direction") or "out"
        touches_total += row["n"]
        c = channels.setdefault(ch, {"channel": ch, "out": 0, "in": 0})
        c["in" if direction == "in" else "out"] += row["n"]
    channels = sorted(channels.values(), key=lambda c: c["out"] + c["in"], reverse=True)

    brochures = {"shared": shared, "opened": opened,
                 "open_rate": round(opened / shared * 100, 1) if shared else 0}

    today = now.strftime("%Y-%m-%d")
    stuck = [{**r, "days_silent": _age_days(r.get("last_activity_date"), today)} for r in stuck_rows]

    won = next((f for f in funnel if f["stage"] == "won"), {"count": 0, "value": 0})
    active_total = sum(f["count"] for f in funnel if f["stage"] in OPEN_STAGES)

    # Won value is invoiced money, not the estimate a rep typed while the deal
    # was still a guess — otherwise this figure can never be reconciled against
    # the books, and nobody can say what a demo is worth. Wins with no order
    # behind them are counted separately so they can be chased rather than
    # quietly reported as zero.
    won_q = {**lead_q, "stage": "won"}
    won_leads = await db.leads.find(
        won_q, {"_id": 0, "lead_id": 1, "stage": 1}).to_list(5000)
    order_map = await _build_order_map([l["lead_id"] for l in won_leads])
    won_value = round(sum(resolve_won_value(l, order_map) for l in won_leads), 2)
    won_unreconciled = sum(1 for l in won_leads if is_unreconciled_win(l, order_map))
    return {
        "days": days,
        "funnel": funnel,
        "channels": channels,
        "touches_total": touches_total,
        "brochures": brochures,
        "sequences_active": sequences_active,
        "hot_signals": hot_signals,
        "stuck": stuck,
        "totals": {"won_count": won["count"], "won_value": won_value,
                   "won_unreconciled": won_unreconciled, "active_leads": active_total},
    }


@router.get("/engagement/attribution")
async def engagement_attribution(request: Request):
    """Close attribution — of the deals won in the window, what share had each
    kind of touch (call / visit / sequence / meeting / brochure open), plus the
    average touches and days to close. Answers 'what actually wins deals'."""
    user = await get_current_user(request)
    try:
        days = max(7, min(730, int(request.query_params.get("days", 90))))
    except (TypeError, ValueError):
        days = 90
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()

    q = {"stage": "won"}
    if get_team(user) != "admin":
        q["assigned_to"] = user.get("email", "")
    won = await db.leads.find(
        q, {"_id": 0, "lead_id": 1, "school_id": 1, "created_at": 1, "updated_at": 1,
            "pipeline_history": 1, "expected_value": 1},
    ).to_list(3000)

    picked, total_days, dc_n = [], 0, 0
    for l in won:
        won_at = None
        for h in (l.get("pipeline_history") or []):
            if h.get("to_stage") == "won" and h.get("at") and (not won_at or h["at"] > won_at):
                won_at = h["at"]
        won_at = won_at or l.get("updated_at") or l.get("created_at")
        if not won_at or won_at < since:
            continue
        picked.append(l)
        ca = l.get("created_at")
        if ca and won_at:
            total_days += _age_days(ca, won_at[:10])
            dc_n += 1

    W = len(picked)
    ids = [l["lead_id"] for l in picked]

    async def _leads_with(coll, extra=None):
        if not ids:
            return 0
        match = {"lead_id": {"$in": ids}}
        if extra:
            match.update(extra)
        vals = await coll.distinct("lead_id", match)
        return len([v for v in vals if v])

    # All six presence/count reads are independent → run them concurrently.
    calls, visits, drips, meetings, broch, touches = await asyncio.gather(
        _leads_with(db.call_notes),
        _leads_with(db.visit_plans),
        _leads_with(db.drip_enrollments),
        _leads_with(db.followups, {"followup_type": "meeting"}),
        _leads_with(db.brochure_shares, {"status": "opened"}),
        db.engagement_events.count_documents({"lead_id": {"$in": ids}}),
    )

    def _sig(key, label, c):
        return {"key": key, "label": label, "count": c, "pct": round(c / W * 100) if W else 0}

    signals = [
        _sig("call", "Called", calls), _sig("visit", "Visited on-site", visits),
        _sig("meeting", "Met / demoed", meetings), _sig("drip", "In a sequence", drips),
        _sig("brochure", "Opened a brochure", broch),
    ]
    signals.sort(key=lambda s: s["count"], reverse=True)
    return {
        "days": days, "won_count": W,
        "avg_days_to_close": round(total_days / dc_n) if dc_n else None,
        "avg_touches": round(touches / W, 1) if W else 0,
        "signals": signals,
    }


def _drill_money(v):
    try:
        n = float(v or 0)
    except (TypeError, ValueError):
        return ""
    if n >= 1e5:
        return f"₹{n / 1e5:.1f}L"
    if n >= 1e3:
        return f"₹{n / 1e3:.0f}K"
    return f"₹{n:.0f}" if n else ""


@router.get("/engagement/drill")
async def engagement_drill(request: Request):
    """Clickable-report backend: every dashboard number opens the actual linked
    records behind it. Returns uniform rows {kind, primary, secondary, school_id,
    lead_id, at, badge} so the frontend can render + deep-link each one."""
    user = await get_current_user(request)
    metric = (request.query_params.get("metric") or "").strip()
    value = (request.query_params.get("value") or "").strip()
    try:
        days = max(1, min(365, int(request.query_params.get("days", 30))))
    except (TypeError, ValueError):
        days = 30
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    stuck_cut = (now - timedelta(days=14)).isoformat()
    LIMIT = 200

    scope_owner = None if get_team(user) == "admin" else user.get("email", "")
    lead_q = {}
    my_lead_ids = None
    if scope_owner is not None:
        lead_q["assigned_to"] = scope_owner
        my_lead_ids = [l["lead_id"] async for l in
                       db.leads.find({"assigned_to": scope_owner}, {"_id": 0, "lead_id": 1})]
    lead_scope = ({"lead_id": {"$in": my_lead_ids}} if my_lead_ids is not None else {})

    title, rows = value or metric, []

    if metric in ("stage", "active"):
        if metric == "active":
            title = "Active leads"
            stage_q = {"stage": {"$in": list(OPEN_STAGES)}}
        else:
            title = f"{value.title()} leads"
            stage_q = {"stage": value}
        docs = await db.leads.find(
            {**lead_q, **stage_q},
            {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "contact_name": 1,
             "stage": 1, "expected_value": 1, "assigned_name": 1, "last_activity_date": 1, "deal_type": 1},
        ).sort("last_activity_date", -1).to_list(LIMIT)
        for l in docs:
            bits = [x for x in [_drill_money(l.get("expected_value")), l.get("assigned_name")] if x]
            rows.append({"kind": "lead", "primary": l.get("company_name") or l.get("contact_name") or "Lead",
                         "secondary": " · ".join(bits), "school_id": l.get("school_id", ""),
                         "lead_id": l.get("lead_id", ""), "at": l.get("last_activity_date"),
                         "badge": l.get("deal_type") or (l.get("stage") if metric == "active" else "")})

    elif metric == "channel":
        title = f"{value.title()} touches · {days}d"
        m = {"channel": value, "at": {"$gte": since}, **lead_scope}
        docs = await db.engagement_events.find(
            m, {"_id": 0, "title": 1, "kind": 1, "school_id": 1, "lead_id": 1, "at": 1, "direction": 1},
        ).sort("at", -1).to_list(LIMIT)
        for e in docs:
            rows.append({"kind": "event", "primary": e.get("title") or e.get("kind") or "Touch",
                         "secondary": e.get("kind") or "", "school_id": e.get("school_id", ""),
                         "lead_id": e.get("lead_id", ""), "at": e.get("at"),
                         "badge": "response" if e.get("direction") == "in" else ""})

    elif metric in ("brochures_shared", "brochures_opened"):
        title = "Brochures opened" if metric == "brochures_opened" else "Brochures shared"
        m = {"created_at": {"$gte": since}, **lead_scope}
        if metric == "brochures_opened":
            m["status"] = "opened"
        docs = await db.brochure_shares.find(
            m, {"_id": 0, "title": 1, "school_name": 1, "school_id": 1, "lead_id": 1,
                "created_at": 1, "status": 1, "open_count": 1},
        ).sort("created_at", -1).to_list(LIMIT)
        for s in docs:
            oc = s.get("open_count") or 0
            rows.append({"kind": "brochure", "primary": s.get("title") or "Brochure",
                         "secondary": s.get("school_name") or "", "school_id": s.get("school_id", ""),
                         "lead_id": s.get("lead_id", ""), "at": s.get("created_at"),
                         "badge": (f"opened ×{oc}" if oc > 1 else "opened") if s.get("status") == "opened" else "sent"})

    elif metric == "hot_signals":
        title = f"Hot signals · {days}d"
        m = {"source": "brochure_open", "created_at": {"$gte": since}}
        if scope_owner is not None:
            m["assigned_to"] = scope_owner
        docs = await db.crm_activities.find(
            m, {"_id": 0, "title": 1, "school_name": 1, "school_id": 1, "assigned_name": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(LIMIT)
        for a in docs:
            rows.append({"kind": "activity", "primary": a.get("title") or "Hot signal",
                         "secondary": a.get("assigned_name") or "", "school_id": a.get("school_id", ""),
                         "lead_id": "", "at": a.get("created_at"), "badge": "hot"})

    elif metric == "won_touch":
        # Won deals (in the window) that had a specific touch — the clickable
        # half of "what wins deals". Window mirrors attribution (default 90d).
        won = await db.leads.find(
            {**lead_q, "stage": "won"},
            {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "expected_value": 1,
             "assigned_name": 1, "created_at": 1, "updated_at": 1, "pipeline_history": 1},
        ).to_list(3000)
        picked = []
        for l in won:
            won_at = None
            for h in (l.get("pipeline_history") or []):
                if h.get("to_stage") == "won" and h.get("at") and (not won_at or h["at"] > won_at):
                    won_at = h["at"]
            won_at = won_at or l.get("updated_at") or l.get("created_at")
            if won_at and won_at >= since:
                picked.append(l)
        ids = [l["lead_id"] for l in picked]
        coll, extra = db.call_notes, None
        if value == "visit":
            coll = db.visit_plans
        elif value == "drip":
            coll = db.drip_enrollments
        elif value == "meeting":
            coll, extra = db.followups, {"followup_type": "meeting"}
        elif value == "brochure":
            coll, extra = db.brochure_shares, {"status": "opened"}
        match = {"lead_id": {"$in": ids}}
        if extra:
            match.update(extra)
        have = {v for v in (await coll.distinct("lead_id", match)) if v}
        label = {"call": "Called", "visit": "Visited", "meeting": "Met / demoed",
                 "drip": "In a sequence", "brochure": "Opened a brochure"}.get(value, value)
        title = f"Won deals · {label}"
        for l in picked:
            if l["lead_id"] not in have:
                continue
            bits = [x for x in [_drill_money(l.get("expected_value")), l.get("assigned_name")] if x]
            rows.append({"kind": "lead", "primary": l.get("company_name") or "Lead",
                         "secondary": " · ".join(bits), "school_id": l.get("school_id", ""),
                         "lead_id": l.get("lead_id", ""), "at": None, "badge": "won"})

    elif metric == "stuck":
        title = "Stuck deals"
        today = now.strftime("%Y-%m-%d")
        docs = await db.leads.find(
            {**lead_q, "stage": {"$in": ["quoted", "negotiation"]}, "last_activity_date": {"$lt": stuck_cut}},
            {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "stage": 1,
             "expected_value": 1, "assigned_name": 1, "last_activity_date": 1},
        ).sort("last_activity_date", 1).to_list(LIMIT)
        for l in docs:
            rows.append({"kind": "lead", "primary": l.get("company_name") or "Lead",
                         "secondary": " · ".join([x for x in [_drill_money(l.get("expected_value")), l.get("assigned_name")] if x]),
                         "school_id": l.get("school_id", ""), "lead_id": l.get("lead_id", ""),
                         "at": l.get("last_activity_date"),
                         "badge": f"{_age_days(l.get('last_activity_date'), today)}d silent"})

    elif metric == "all_leads":
        title = "All leads"
        docs = await db.leads.find(
            {**lead_q},
            {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "contact_name": 1,
             "stage": 1, "expected_value": 1, "assigned_name": 1, "last_activity_date": 1, "deal_type": 1},
        ).sort("last_activity_date", -1).to_list(LIMIT)
        for l in docs:
            bits = [x for x in [_drill_money(l.get("expected_value")), l.get("assigned_name")] if x]
            rows.append({"kind": "lead", "primary": l.get("company_name") or l.get("contact_name") or "Lead",
                         "secondary": " · ".join(bits), "school_id": l.get("school_id", ""),
                         "lead_id": l.get("lead_id", ""), "at": l.get("last_activity_date"),
                         "badge": l.get("stage") or ""})

    elif metric == "rep":
        # A salesperson-leaderboard cell: value=<rep email>, sub=won|lost|active|
        # quotations|revenue. Admins may drill any rep; a rep only ever their own.
        is_admin = get_team(user) == "admin"
        rep = value if is_admin else user.get("email", "")
        sub = (request.query_params.get("sub") or "leads").strip()
        rep_name = ""
        sp = await db.salespersons.find_one({"email": rep}, {"_id": 0, "name": 1})
        if sp:
            rep_name = sp.get("name") or ""
        if sub in ("quotations", "revenue"):
            qm = {"sales_person_email": rep}
            if sub == "revenue":
                qm["quotation_status"] = "confirmed"
            title = f"{rep_name or rep} · {'confirmed quotations' if sub == 'revenue' else 'quotations'}"
            docs = await db.quotations.find(
                qm, {"_id": 0, "quotation_id": 1, "quote_number": 1, "school_name": 1,
                     "school_id": 1, "grand_total": 1, "quotation_status": 1, "created_at": 1},
            ).sort("created_at", -1).to_list(LIMIT)
            for q in docs:
                rows.append({"kind": "quote",
                             "primary": q.get("school_name") or q.get("quote_number") or "Quotation",
                             "secondary": " · ".join([x for x in [q.get("quote_number"), _drill_money(q.get("grand_total"))] if x]),
                             "school_id": q.get("school_id", ""), "lead_id": "",
                             "at": q.get("created_at"), "badge": q.get("quotation_status") or ""})
        else:
            stage_map = {"won": {"stage": "won"}, "lost": {"stage": "lost"},
                         "active": {"stage": {"$nin": ["won", "lost"]}}, "leads": {}}
            title = f"{rep_name or rep} · {sub if sub in stage_map else 'leads'}"
            docs = await db.leads.find(
                {"assigned_to": rep, **stage_map.get(sub, {})},
                {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "contact_name": 1,
                 "stage": 1, "expected_value": 1, "last_activity_date": 1, "deal_type": 1},
            ).sort("last_activity_date", -1).to_list(LIMIT)
            for l in docs:
                rows.append({"kind": "lead", "primary": l.get("company_name") or l.get("contact_name") or "Lead",
                             "secondary": _drill_money(l.get("expected_value")) or "",
                             "school_id": l.get("school_id", ""), "lead_id": l.get("lead_id", ""),
                             "at": l.get("last_activity_date"), "badge": l.get("stage") or ""})

    elif metric == "quotations":
        # Quotation-stats tile: value=total|draft|sent|confirmed.
        qm = {} if value in ("", "total") else {"quotation_status": value}
        if scope_owner is not None:
            qm["sales_person_email"] = scope_owner
        title = f"{(value or 'total').title()} quotations"
        docs = await db.quotations.find(
            qm, {"_id": 0, "quotation_id": 1, "quote_number": 1, "school_name": 1, "school_id": 1,
                 "grand_total": 1, "quotation_status": 1, "sales_person_name": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(LIMIT)
        for q in docs:
            bits = [x for x in [q.get("quote_number"), _drill_money(q.get("grand_total")), q.get("sales_person_name")] if x]
            rows.append({"kind": "quote", "primary": q.get("school_name") or q.get("quote_number") or "Quotation",
                         "secondary": " · ".join(bits), "school_id": q.get("school_id", ""), "lead_id": "",
                         "at": q.get("created_at"), "badge": q.get("quotation_status") or ""})

    elif metric == "lost_reason":
        title = f"Lost · {value or 'unspecified'}"
        rq = {**lead_q, "stage": "lost"}
        rq["lost_reason"] = value if value else {"$in": [None, ""]}
        docs = await db.leads.find(
            rq, {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1, "contact_name": 1,
                 "expected_value": 1, "assigned_name": 1, "last_activity_date": 1, "lost_reason": 1},
        ).sort("last_activity_date", -1).to_list(LIMIT)
        for l in docs:
            rows.append({"kind": "lead", "primary": l.get("company_name") or l.get("contact_name") or "Lead",
                         "secondary": " · ".join([x for x in [_drill_money(l.get("expected_value")), l.get("assigned_name")] if x]),
                         "school_id": l.get("school_id", ""), "lead_id": l.get("lead_id", ""),
                         "at": l.get("last_activity_date"), "badge": l.get("lost_reason") or "no reason"})

    elif metric == "tasks":
        # Task-stats tile: value=total|pending|done|missed.
        tq = {} if value in ("", "total") else {"status": value}
        if scope_owner is not None:
            tq["assigned_to"] = scope_owner
        title = f"{(value or 'total').title()} tasks"
        docs = await db.tasks.find(
            tq, {"_id": 0, "task_id": 1, "title": 1, "school_id": 1, "lead_id": 1,
                 "assigned_name": 1, "assigned_to": 1, "due_date": 1, "status": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(LIMIT)
        for t in docs:
            who = t.get("assigned_name") or t.get("assigned_to") or ""
            due = t.get("due_date") or ""
            rows.append({"kind": "event", "primary": t.get("title") or "Task",
                         "secondary": " · ".join([x for x in [who, (f"due {due}" if due else "")] if x]),
                         "school_id": t.get("school_id", ""), "lead_id": t.get("lead_id", ""),
                         "at": t.get("created_at"), "badge": t.get("status") or ""})

    else:
        raise HTTPException(status_code=400, detail="Unknown drill metric")

    return {"title": title, "count": len(rows), "rows": rows}


# ── Activity Types (editable master, powers the Bulk Activity Planner) ────────
DEFAULT_ACTIVITY_TYPES = ["Newsletter", "Call", "Visit", "WhatsApp", "Sample", "Meeting"]


@router.get("/activity-types")
async def get_activity_types(request: Request):
    await get_current_user(request)
    rows = await db.activity_types.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not rows:
        for name in DEFAULT_ACTIVITY_TYPES:
            await db.activity_types.insert_one({
                "activity_type_id": f"at_{uuid.uuid4().hex[:8]}", "name": name,
                "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()})
        rows = await db.activity_types.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return rows


@router.post("/activity-types")
async def create_activity_type(request: Request):
    await get_current_user(request)
    body = await request.json()
    at_id = f"at_{uuid.uuid4().hex[:8]}"
    await db.activity_types.insert_one({
        "activity_type_id": at_id, "name": body.get("name", ""),
        "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()})
    return await db.activity_types.find_one({"activity_type_id": at_id}, {"_id": 0})


@router.put("/activity-types/{at_id}")
async def update_activity_type(at_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    body = await request.json()
    if "name" in body:
        await db.activity_types.update_one({"activity_type_id": at_id}, {"$set": {"name": body["name"]}})
    return await db.activity_types.find_one({"activity_type_id": at_id}, {"_id": 0})


@router.delete("/activity-types/{at_id}")
async def delete_activity_type(at_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    await db.activity_types.delete_one({"activity_type_id": at_id})
    return {"message": "Activity type deleted"}


# ── Bulk Activity Planner ────────────────────────────────────────────────────
@router.post("/activities/bulk")
async def create_activities_bulk(request: Request):
    """Plan one activity per selected school. Default assigns each to that school's
    own account manager (school.assigned_to); 'person' mode assigns all to one."""
    user = await get_current_user(request)
    body = await request.json()
    now_iso = datetime.now(timezone.utc).isoformat()
    school_ids = body.get("school_ids", []) or []
    assign_mode = body.get("assign_mode", "owner")
    override_to = body.get("assigned_to", "")
    override_name = body.get("assigned_name", "")
    batch_id = f"batch_{uuid.uuid4().hex[:10]}"
    created, unassigned_fallback = 0, 0
    for sid in school_ids:
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_name": 1, "assigned_to": 1, "assigned_name": 1})
        if not sch:
            continue
        if assign_mode == "person" and override_to:
            ato, aname = override_to, override_name
        else:
            ato, aname = sch.get("assigned_to", ""), sch.get("assigned_name", "")
            if not ato:
                ato, aname = user["email"], user.get("name", "")  # fallback to planner
                unassigned_fallback += 1
        await db.crm_activities.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:10]}", "batch_id": batch_id,
            "school_id": sid, "school_name": sch.get("school_name", ""),
            "activity_type": body.get("activity_type", ""), "title": body.get("title", ""),
            "channel": body.get("channel", ""),   # Phase 1c: which channel this touch is
            "deal_type": body.get("deal_type", ""),  # which deal this marketing is for
            "notes": body.get("notes", ""), "due_date": body.get("due_date", ""),
            "assigned_to": ato, "assigned_name": aname, "status": "pending",
            "created_by": user["email"], "created_at": now_iso, "done_at": None})
        created += 1
    return {"batch_id": batch_id, "created": created, "unassigned_fallback": unassigned_fallback}


@router.get("/activities")
async def get_activities(request: Request):
    await get_current_user(request)
    qp = request.query_params
    q = {}
    if qp.get("status"):
        q["status"] = qp.get("status")
    if qp.get("assigned_to"):
        q["assigned_to"] = qp.get("assigned_to")
    if qp.get("activity_type"):
        q["activity_type"] = qp.get("activity_type")
    if qp.get("school_id"):
        q["school_id"] = qp.get("school_id")
    acts = await db.crm_activities.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for a in acts:
        a["overdue"] = a.get("status") == "pending" and bool(a.get("due_date")) and a["due_date"] < today
    return acts


def _age_days(date_str, today):
    """Whole days between an ISO date (YYYY-MM-DD or fuller) and today; 0 if unknown."""
    d = (date_str or "")[:10]
    if not d:
        return 0
    from datetime import date
    try:
        y, m, dd = (int(x) for x in d.split("-"))
        return max(0, (date.fromisoformat(today) - date(y, m, dd)).days)
    except Exception:
        return 0


@router.get("/activities/hot-leads")
async def get_hot_leads(request: Request):
    """The warmest leads: schools that scanned a mailer QR and submitted interest,
    still awaiting a call-back (pending qr_interest activities). Newest first."""
    await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    acts = await db.crm_activities.find(
        {"source": "qr_interest", "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    leads = [{
        "activity_id": a.get("activity_id", ""), "school_id": a.get("school_id", ""),
        "school_name": a.get("school_name", ""), "notes": a.get("notes", ""),
        "assigned_to": a.get("assigned_to", ""), "assigned_name": a.get("assigned_name", ""),
        "created_at": a.get("created_at", ""), "age_days": _age_days(a.get("created_at", ""), today),
    } for a in acts]
    return {"leads": leads, "count": len(leads)}


@router.get("/activities/scorecard")
async def get_activity_scorecard(request: Request):
    """Per-rep accountability: assigned / done / pending / overdue / completion% /
    oldest-overdue age. Sorted worst-first (most overdue on top) so a manager sees
    who has fallen behind on the tasks the system assigns them."""
    await get_current_user(request)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    acts = await db.crm_activities.find({}, {"_id": 0}).to_list(20000)
    reps = {}
    for a in acts:
        key = a.get("assigned_to") or ""
        r = reps.setdefault(key, {"assigned_to": key, "assigned_name": a.get("assigned_name", ""),
                                  "total": 0, "done": 0, "pending": 0, "overdue": 0, "oldest_overdue_date": ""})
        if not r["assigned_name"] and a.get("assigned_name"):
            r["assigned_name"] = a["assigned_name"]
        r["total"] += 1
        done = a.get("status") == "done"
        due = a.get("due_date") or ""
        if done:
            r["done"] += 1
        else:
            r["pending"] += 1
            if due and due < today:
                r["overdue"] += 1
                if not r["oldest_overdue_date"] or due < r["oldest_overdue_date"]:
                    r["oldest_overdue_date"] = due
    from datetime import date
    def _age(d):
        if not d:
            return 0
        try:
            y, m, dd = (int(x) for x in d.split("-"))
            return max(0, (date.fromisoformat(today) - date(y, m, dd)).days)
        except Exception:
            return 0
    out = []
    for r in reps.values():
        r["completion_rate"] = (r["done"] / r["total"]) if r["total"] else 0.0
        r["oldest_overdue_days"] = _age(r.pop("oldest_overdue_date"))
        out.append(r)
    # worst-first: most overdue, then lowest completion, then biggest workload
    out.sort(key=lambda x: (-x["overdue"], x["completion_rate"], -x["total"]))
    totals = {k: sum(r[k] for r in out) for k in ("total", "done", "pending", "overdue")}
    totals["completion_rate"] = (totals["done"] / totals["total"]) if totals["total"] else 0.0
    return {"reps": out, "totals": totals}


@router.put("/activities/{activity_id}")
async def update_activity(activity_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    upd = {}
    if "status" in body:
        upd["status"] = body["status"]
        upd["done_at"] = datetime.now(timezone.utc).isoformat() if body["status"] == "done" else None
    for k in ("title", "notes", "due_date", "activity_type"):
        if k in body:
            upd[k] = body[k]
    if "assigned_to" in body:
        upd["assigned_to"] = body["assigned_to"]
        upd["assigned_name"] = body.get("assigned_name", "")
    if upd:
        await db.crm_activities.update_one({"activity_id": activity_id}, {"$set": upd})
    return await db.crm_activities.find_one({"activity_id": activity_id}, {"_id": 0})


@router.delete("/activities/{activity_id}")
async def delete_activity(activity_id: str, request: Request):
    await get_current_user(request)
    await db.crm_activities.delete_one({"activity_id": activity_id})
    return {"message": "Activity deleted"}


# ==================== PIPELINE SETTINGS ====================

@router.get("/pipeline-settings")
async def get_pipeline_settings(request: Request):
    await get_current_user(request)
    return await get_crm_settings()


@router.put("/pipeline-settings")
async def update_pipeline_settings(request: Request):
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    allowed = {}
    for k in ("stage_probabilities", "stage_idle_limits", "lost_reasons",
              "digest_time", "digest_enabled"):
        if k in body:
            allowed[k] = body[k]
    if allowed:
        await db.settings.update_one(
            {"type": "crm_pipeline"}, {"$set": allowed}, upsert=True
        )
    return await get_crm_settings()


# ==================== SCHOOL TYPE MASTER ====================

DEFAULT_SCHOOL_TYPES = ["CBSE", "ICSE", "IB", "Cambridge", "State Board", "Coaching", "College"]


@router.get("/school-types")
async def get_school_types(request: Request):
    await get_current_user(request)
    items = await db.school_types.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    if not items:
        for s in DEFAULT_SCHOOL_TYPES:
            await db.school_types.insert_one({
                "type_id": f"st_{uuid.uuid4().hex[:8]}",
                "name": s, "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        items = await db.school_types.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return items


@router.post("/school-types")
async def create_school_type(request: Request):
    await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    existing = await db.school_types.find_one({"name": name}, {"_id": 0})
    if existing:
        return existing
    type_id = f"st_{uuid.uuid4().hex[:8]}"
    await db.school_types.insert_one({
        "type_id": type_id, "name": name, "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.school_types.find_one({"type_id": type_id}, {"_id": 0})


@router.put("/school-types/{type_id}")
async def update_school_type(type_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.school_types.update_one({"type_id": type_id}, {"$set": allowed})
    return await db.school_types.find_one({"type_id": type_id}, {"_id": 0})


@router.delete("/school-types/{type_id}")
async def delete_school_type(type_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    await db.school_types.delete_one({"type_id": type_id})
    return {"message": "School type deleted"}


# ==================== INTERESTED PRODUCT MASTER ====================
# Custom/individual "interested product" entries that aren't formal packages.
# Packages remain the primary UI options; these accumulate from rep input.

@router.get("/interested-products")
async def get_interested_products(request: Request):
    await get_current_user(request)
    return await db.interested_products.find({}, {"_id": 0}).sort("name", 1).to_list(300)


@router.post("/interested-products")
async def create_interested_product(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    existing = await db.interested_products.find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0})
    if existing:
        return existing
    product_id = f"ip_{uuid.uuid4().hex[:8]}"
    await db.interested_products.insert_one({
        "product_id": product_id, "name": name, "is_active": True,
        "created_by": user["email"], "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return await db.interested_products.find_one({"product_id": product_id}, {"_id": 0})


@router.delete("/interested-products/{product_id}")
async def delete_interested_product(product_id: str, request: Request):
    await get_current_user(request)
    await db.interested_products.delete_one({"product_id": product_id})
    return {"message": "Interested product deleted"}


# ==================== CONTACT ROLE MASTER ====================

DEFAULT_CONTACT_ROLES = [
    "Principal", "Vice Principal", "Admin Head", "Director", "Owner",
    "Manager", "Coordinator", "Teacher", "IT Head", "Purchase Head", "Other",
]


@router.get("/contact-roles")
async def get_contact_roles(request: Request):
    await get_current_user(request)
    roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not roles:
        for r in DEFAULT_CONTACT_ROLES:
            await db.contact_roles.insert_one({"role_id": f"cr_{uuid.uuid4().hex[:8]}", "name": r, "is_active": True})
        roles = await db.contact_roles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return roles


@router.post("/contact-roles")
async def create_contact_role(request: Request):
    await get_current_user(request)
    body = await request.json()
    role_id = f"cr_{uuid.uuid4().hex[:8]}"
    await db.contact_roles.insert_one({"role_id": role_id, "name": body.get("name", ""), "is_active": True})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})


@router.put("/contact-roles/{role_id}")
async def update_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "is_active") if k in body}
    if allowed:
        await db.contact_roles.update_one({"role_id": role_id}, {"$set": allowed})
    return await db.contact_roles.find_one({"role_id": role_id}, {"_id": 0})


@router.delete("/contact-roles/{role_id}")
async def delete_contact_role(role_id: str, request: Request):
    await get_current_user(request)
    await db.contact_roles.delete_one({"role_id": role_id})
    return {"message": "Role deleted"}


# ==================== DESIGNATION MASTER ====================

_DEFAULT_DESIGNATIONS = [
    "CEO", "MD", "Director", "Trustee", "Chairman",
    "Principal", "Vice Principal", "Head of Department",
    "Coordinator", "Administrator", "Accountant",
    "Teacher", "Librarian", "Counselor",
]

@router.get("/designations")
async def get_designations(request: Request):
    await get_current_user(request)
    designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    if not designations:
        for d in _DEFAULT_DESIGNATIONS:
            await db.designations.insert_one({"designation_id": f"des_{uuid.uuid4().hex[:8]}", "name": d, "is_active": True})
        designations = await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return designations

@router.post("/designations")
async def create_designation(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    existing = await db.designations.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if existing:
        raise HTTPException(status_code=409, detail="Designation already exists")
    did = f"des_{uuid.uuid4().hex[:8]}"
    doc = {"designation_id": did, "name": name, "department": body.get("department", ""), "is_active": True, "created_by": user["email"]}
    await db.designations.insert_one(doc)
    return await db.designations.find_one({"designation_id": did}, {"_id": 0})

@router.put("/designations/{designation_id}")
async def update_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    body = await request.json()
    allowed = {k: v for k, v in body.items() if k in ("name", "department", "is_active")}
    if allowed:
        await db.designations.update_one({"designation_id": designation_id}, {"$set": allowed})
    return await db.designations.find_one({"designation_id": designation_id}, {"_id": 0})

@router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    await db.designations.delete_one({"designation_id": designation_id})
    return {"message": "Designation deleted"}


# ==================== TAG MASTER ====================

# 12 expert marketing tags pre-seeded for SmartShape B2B school sales cycle
_DEFAULT_MARKETING_TAGS = [
    # Lead temperature
    {"name": "Hot Lead",           "color": "#ef4444", "group": "temperature"},
    {"name": "Warm Lead",          "color": "#f97316", "group": "temperature"},
    {"name": "Cold Lead",          "color": "#6b7280", "group": "temperature"},
    # Demo status
    {"name": "Demo Done",          "color": "#22c55e", "group": "demo"},
    {"name": "Demo Scheduled",     "color": "#3b82f6", "group": "demo"},
    {"name": "Demo Interested",    "color": "#a855f7", "group": "demo"},
    # Decision status
    {"name": "Budget Approved",    "color": "#10b981", "group": "decision"},
    {"name": "Decision Pending",   "color": "#eab308", "group": "decision"},
    {"name": "Price Sensitive",    "color": "#f59e0b", "group": "decision"},
    # Relationship
    {"name": "Key Decision Maker", "color": "#06b6d4", "group": "relationship"},
    {"name": "Referral",           "color": "#8b5cf6", "group": "relationship"},
    {"name": "Existing Customer",  "color": "#059669", "group": "relationship"},
]


async def _seed_marketing_tags():
    """Populate the default marketing tags once, on a database that has none.

    This used to run on EVERY GET /tags and re-insert any default whose NAME was
    missing. So renaming "Hot Lead" to "Very Hot" put a brand-new "Hot Lead"
    straight back on the very next list — the admin was told "Tag updated" and
    then watched the old tag reappear — and deleting a default was impossible.

    A seeder's job is to furnish an empty install, not to keep reinstating
    choices the admin has since changed. The guard is a flag rather than a
    per-name check for exactly that reason: absence is now a decision, not a
    gap to be filled. It also stops a write firing on every read of the list.
    """
    if await db.app_meta.find_one({"_id": "marketing_tags_seeded"}):
        return
    existing_names = {
        t["name"] async for t in db.tags.find({}, {"name": 1, "_id": 0})
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    for tag in _DEFAULT_MARKETING_TAGS:
        if tag["name"] not in existing_names:
            await db.tags.insert_one({
                "tag_id": f"tag_{uuid.uuid4().hex[:8]}",
                "name": tag["name"],
                "color": tag["color"],
                "group": tag["group"],
                "created_by": "system",
                "created_at": now_iso,
            })
    await db.app_meta.update_one(
        {"_id": "marketing_tags_seeded"},
        {"$setOnInsert": {"value": True, "at": now_iso}},
        upsert=True,
    )


@router.get("/tags")
async def get_tags(request: Request):
    await get_current_user(request)
    await _seed_marketing_tags()
    return await db.tags.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/tags")
async def create_tag(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name"):
        raise HTTPException(status_code=400, detail="Tag name is required")
    tag_id = f"tag_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "tag_id": tag_id,
        "name": body["name"].strip(),
        "color": body.get("color", "#6366f1"),
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.tags.insert_one(doc)
    return await db.tags.find_one({"tag_id": tag_id}, {"_id": 0})


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    body = await request.json()
    allowed = {k: body[k] for k in ("name", "color") if k in body}
    await db.tags.update_one({"tag_id": tag_id}, {"$set": allowed})
    return await db.tags.find_one({"tag_id": tag_id}, {"_id": 0})


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, request: Request):
    user = await get_current_user(request)
    _require_master_admin(user)
    await db.tags.delete_one({"tag_id": tag_id})
    return {"message": "Tag deleted"}


async def _resolve_tags(tag_names_or_ids: list, creator_email: str) -> list:
    """Resolve a list of tag_ids or tag name strings → list of tag_ids. Creates tags inline if name not found."""
    resolved = []
    for item in (tag_names_or_ids or []):
        if not item:
            continue
        if str(item).startswith("tag_"):
            existing = await db.tags.find_one({"tag_id": item}, {"_id": 0})
            if existing:
                resolved.append(item)
                continue
        # Treat as name string — find or create
        existing = await db.tags.find_one({"name": str(item).strip()}, {"_id": 0})
        if existing:
            resolved.append(existing["tag_id"])
        else:
            new_id = f"tag_{uuid.uuid4().hex[:8]}"
            await db.tags.insert_one({
                "tag_id": new_id,
                "name": str(item).strip(),
                "color": "#6366f1",
                "created_by": creator_email,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            resolved.append(new_id)
    return resolved


# ==================== SCHOOL MASTER ====================

def _owner_clause(email: str) -> dict:
    """Sales ownership as a Mongo query fragment: a record is mine when it is
    assigned to me, OR I created it AND it is still unassigned.

    The `created_by` fallback only applies while `assigned_to` is blank/absent —
    so the moment a school (or its contacts/leads) is assigned to someone else,
    the original creator loses access. This is what makes a reassignment truly
    remove the record from the previous owner. Keep `_owns` (below) in lockstep."""
    return {"$or": [
        {"assigned_to": email},
        {"$and": [
            {"created_by": email},
            {"$or": [{"assigned_to": {"$in": ["", None]}},
                     {"assigned_to": {"$exists": False}}]},
        ]},
    ]}


def _owns(doc: dict, email: str) -> bool:
    """In-memory mirror of `_owner_clause`, for guard checks on a single doc."""
    if not doc:
        return False
    if doc.get("assigned_to") == email:
        return True
    return doc.get("created_by") == email and not (doc.get("assigned_to") or "")


def _crm_read(user: dict) -> bool:
    """May this user see CRM records at all?

    Delegates to rbac.can_read_crm so the admin "remove user" dialog can warn
    about a recipient who cannot see CRM work without duplicating the rule.
    True on an explicit `leads` grant (the multi-role path), OR on legacy
    sales-team membership.
    """
    return can_read_crm(user)


def _crm_write(user: dict) -> bool:
    """Mutation counterpart of `_crm_read`."""
    return has_team(user, "sales") or has_module(user, "leads", "read_write")


async def _owned_school_ids(email: str) -> list:
    """School ids a sales user owns — assigned to them, or created by them while
    still unassigned (see `_owner_clause`). Excludes deleted."""
    cur = db.schools.find(
        {**_owner_clause(email), "is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1},
    )
    return [s["school_id"] async for s in cur]


async def _sales_lead_scope(email: str) -> list:
    """$or clauses making a sales user's lead view = assigned + under owned schools.
    Mirrors GET /leads so deal analytics agree with the pipeline a rep can see."""
    owned = await _owned_school_ids(email)
    return [{"assigned_to": email}, {"school_id": {"$in": owned}}]


async def resolve_owner(db, raw: str):
    """Map an owner value (an email OR a display name) to a real (email, name).

    Ownership everywhere is keyed by EMAIL (scoping is `assigned_to == user email`)
    while the UI shows `assigned_name`. A CSV/import that puts a person's NAME into
    `assigned_to` silently breaks both. This resolves against the salespersons + users
    directory (preferring an active match) and returns:
      • (email, name)  when resolved — set BOTH fields with these
      • (raw, "")      when given an unknown but syntactically-valid email (keep it)
      • ("", raw)      when a name can't be matched — keep it as the display name only,
                       never as `assigned_to`, so scoping is never corrupted.

    Takes the db handle explicitly so the import engine can reuse it with its own
    (test) database; `_resolve_owner` below keeps the module-global default.
    """
    raw = (raw or "").strip()
    if not raw:
        return "", ""
    if "@" in raw:
        for coll in (db.salespersons, db.users):
            u = await coll.find_one(
                {"email": {"$regex": f"^{re.escape(raw)}$", "$options": "i"}},
                {"_id": 0, "email": 1, "name": 1},
            )
            if u and u.get("email"):
                return u["email"], u.get("name", "") or raw
        return raw, ""  # unknown email — still a valid scoping key
    # name → prefer an active directory entry, else any match
    for active_only in (True, False):
        for coll in (db.salespersons, db.users):
            q = {"name": {"$regex": f"^{re.escape(raw)}$", "$options": "i"}}
            if active_only:
                q["is_active"] = {"$ne": False}
            u = await coll.find_one(q, {"_id": 0, "email": 1, "name": 1})
            if u and u.get("email"):
                return u["email"], u.get("name", "") or raw
    return "", raw  # unresolved name — keep as label, do not corrupt assigned_to


async def _resolve_owner(raw: str):
    """Backward-compatible wrapper: resolve against the module-global db."""
    return await resolve_owner(db, raw)


async def _apply_owner(body: dict, *, default_email: str, default_name: str):
    """Resolve a request body's "Assign To" (a NAME or EMAIL, typed or picked) into
    a real (assigned_to, assigned_name) on EVERY write path.

    - blank `assigned_to`            → the caller's default (sales self / school owner).
    - a name/email that resolves     → that user's (email, name).
    - an unknown-but-syntactically-valid email → kept as-is (valid scoping key).
    - an unresolvable NAME           → the default; a NAME is NEVER stored in
                                        assigned_to (that would break scoping).

    Always returns a non-blank assigned_name when assigned_to is set, so the UI
    never renders a blank owner."""
    raw = (body.get("assigned_to") or "").strip()
    if not raw:
        return default_email, default_name
    owner_email, owner_name = await resolve_owner(db, raw)
    if owner_email:
        body_name = (body.get("assigned_name") or "").strip()
        return owner_email, (owner_name or body_name or owner_email)
    if "@" in raw:  # syntactically valid but unknown email — keep it
        return raw, ((body.get("assigned_name") or "").strip() or raw)
    return default_email, default_name  # unresolvable name → default, never the name


async def _user_can_access_school(user: dict, school: dict) -> bool:
    """Mirror GET /schools scope: admin sees all. Everyone else needs CRM access
    (`_crm_read` — a `leads` grant or sales-team membership); a `leads` grant
    scoped "all" sees every school, an "own"-scoped one sees owned/created
    schools + schools holding their leads. No CRM access at all -> nothing."""
    if not school:
        return False
    if has_team(user, "admin"):
        return True
    if not _crm_read(user):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if _owns(school, email):
        return True
    sid = school.get("school_id")
    if sid:
        lead = await db.leads.find_one(
            {"school_id": sid, "assigned_to": email}, {"_id": 0, "lead_id": 1}
        )
        if lead:
            return True
    return False


async def _user_can_mutate_lead(user: dict, lead: dict) -> bool:
    """admin all; otherwise needs CRM write access (`_crm_write` — a `leads`
    read_write grant or sales-team membership). A "all"-scoped `leads` grant may
    mutate any lead; an "own"-scoped one only if assigned or under an owned
    school. No `leads` grant and not sales -> nothing."""
    if not lead:
        return False
    if has_team(user, "admin"):
        return True
    if not _crm_write(user):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if lead.get("assigned_to") == email:
        return True
    sid = lead.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
    return False


async def _user_can_mutate_contact(user: dict, contact: dict) -> bool:
    """admin all; otherwise needs CRM write access (`_crm_write` — a `leads`
    read_write grant or sales-team membership). A "all"-scoped `leads` grant may
    mutate any contact; an "own"-scoped one only if creator/assignee or under an
    owned school. No `leads` grant and not sales -> nothing."""
    if not contact:
        return False
    if has_team(user, "admin"):
        return True
    if not _crm_write(user):
        return False
    if sees_all(user, "leads"):
        return True
    email = user["email"]
    if _owns(contact, email):
        return True
    sid = contact.get("school_id")
    if sid and sid in (await _owned_school_ids(email)):
        return True
    return False


async def _assign_school_cascade(school_id: str, assigned_to: str, assigned_name: str, actor: dict) -> dict:
    """Set a school's owner and cascade that owner onto ALL its contacts and leads."""
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one(
        {"school_id": school_id},
        {"$set": {"assigned_to": assigned_to, "assigned_name": assigned_name,
                  "assigned_date": now_iso, "last_activity_date": now_iso}},
    )
    cres = await db.contacts.update_many(
        {"school_id": school_id, "is_deleted": {"$ne": True}},
        {"$set": {"assigned_to": assigned_to, "assigned_name": assigned_name,
                  "assigned_date": now_iso}},
    )
    leads = await db.leads.find(
        {"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(10000)
    moved = 0
    for lead in leads:
        if lead.get("assigned_to") == assigned_to:
            continue
        history = lead.get("reassignments", []) or []
        history.append({
            "from_email": lead.get("assigned_to", ""), "from_name": lead.get("assigned_name", ""),
            "to_email": assigned_to, "to_name": assigned_name,
            "by_email": actor.get("email", ""), "by_name": actor.get("name", ""),
            "reason": "School reassigned", "at": now_iso,
        })
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": assigned_to, "assigned_name": assigned_name,
            "assigned_date": now_iso,
            "reassignments": history, "reassignment_count": (lead.get("reassignment_count", 0) or 0) + 1,
            "last_reassigned_at": now_iso, "last_reassigned_by": actor.get("email", ""),
            "last_reassignment_reason": "School reassigned",
            "updated_at": now_iso, "last_activity_date": now_iso,
        }})
        moved += 1
    return {"contacts": cres.modified_count, "leads": moved}


# ── Cross-owner courtesy ────────────────────────────────────────────────────

async def notify_school_owner(school_id: str, actor: dict, what: str,
                              ref_type: str = "school", tail: str = "It is still assigned to you."):
    """Tell a school's owner when somebody else creates work against it.

    Reps can now find schools they don't own when starting a lead or a
    quotation (that is what stops them creating a second copy of the school).
    Using one must never be silent: the owner learns from their bell, not from
    stumbling over a quotation on their own account weeks later.

    Nothing is transferred and nothing is blocked — this is a courtesy, so it
    never raises. Skipped when the school has no owner, when the actor IS the
    owner, or when that owner has turned Auto Sync off.
    """
    try:
        sid = (school_id or "").strip()
        if not sid:
            return
        school = await db.schools.find_one(
            {"school_id": sid}, {"_id": 0, "assigned_to": 1, "school_name": 1})
        owner = ((school or {}).get("assigned_to") or "").strip()
        if not owner or owner == (actor.get("email") or "").strip():
            return
        # Auto Sync: absent means on, so nobody silently stops being told.
        prefs = await db.users.find_one(
            {"email": owner}, {"_id": 0, "notify_on_cross_owner": 1}) or {}
        if prefs.get("notify_on_cross_owner") is False:
            return
        actor_name = actor.get("name") or actor.get("email") or "A colleague"
        name = (school or {}).get("school_name") or "one of your schools"
        await notify_user(
            owner,
            type="cross_owner_work",
            title="Someone is working on your school",
            body=f"{actor_name} created {what} on {name}. {tail}",
            ref_type=ref_type, ref_id=sid, from_name=actor_name,
        )
    except Exception:
        pass   # never let a courtesy ping fail the thing the user actually did


@router.get("/schools")
async def get_schools(request: Request):
    user = await get_current_user(request)
    if not _crm_read(user):
        # No CRM grant — nothing to show
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — owned + created + schools holding their leads OR quotations
        own_leads = await db.leads.find({"assigned_to": user["email"]}, {"_id": 0, "school_id": 1}).to_list(10000)
        # A quotation links a school exactly as a lead does. Without this, a rep
        # who quoted another rep's school could not see it again afterwards —
        # so her own quotation would vanish from her CRM the moment she saved it.
        own_quotes = await db.quotations.find(
            {"$or": [{"assigned_to": user["email"]}, {"created_by": user["email"]}],
             "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1}).to_list(10000)
        linked_school_ids = [r.get("school_id") for r in (own_leads + own_quotes) if r.get("school_id")]
        query = {"$or": [
            *_owner_clause(user["email"])["$or"],
            {"school_id": {"$in": linked_school_ids}} if linked_school_ids else {"school_id": "__none__"},
        ]}
    query["is_deleted"] = {"$ne": True}
    schools = await db.schools.find(query, {"_id": 0}).sort("school_name", 1).to_list(10000)
    return schools


@router.get("/crm/reorder-due")
async def reorder_due(request: Request):
    """Schools whose usual gap between orders has elapsed again.

    Derived from order history on every read rather than stored: nothing to go
    stale, nothing to de-duplicate, and correct the moment an order lands.
    Scoped to the caller's own accounts unless they see everything.
    """
    user = await get_current_user(request)
    if not _crm_read(user):
        return []
    settings = await get_crm_settings()
    default_days = int(settings.get("reorder_interval_days") or ro.DEFAULT_INTERVAL_DAYS)
    owner = None if sees_all(user, "leads") else user["email"]
    return await ro.reorder_candidates(db, owner_email=owner,
                                       default_interval_days=default_days)


@router.post("/schools/backfill-lifecycle")
async def schools_backfill_lifecycle(request: Request):
    """Classify every school as prospect / customer / dormant from its orders.

    Account status is maintained on every order event from now on; this fills in
    the history that predates it. Idempotent — safe to run whenever, and worth
    re-running after changing how long counts as dormant.
    """
    user = await get_current_user(request)
    require_admin(user)
    settings = await get_crm_settings()
    days = int(settings.get("dormant_after_days") or al.DEFAULT_DORMANT_AFTER_DAYS)
    out = await al.backfill_all(db, dormant_after_days=days)
    await log_activity(user["email"], "backfill", "school", "-",
                       f"account lifecycle: {out['scanned']} schools — {out['by_status']}")
    return {"ok": True, "dormant_after_days": days, **out}


@router.get("/schools/lookup")
async def school_lookup(request: Request):
    """Find a school by name or city across EVERY owner, thinly.

    GET /schools hides other reps' schools, which is right for the CRM list and
    wrong at the two moments a rep starts new work: the lead form and the
    quotation builder. There, an invisible school isn't protected — it's
    duplicated, because "Add New" is the only door left open.

    So this searches all owners but returns only what identifies the school and
    says who to talk to. Phone, email, address, strength and contacts stay with
    the owner; ownership still protects the account, just not its existence.
    A two-character minimum and a hard cap keep it a lookup, not an export.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        return []
    rx = {"$regex": re.escape(q), "$options": "i"}
    rows = await db.schools.find(
        {"is_deleted": {"$ne": True}, "$or": [{"school_name": rx}, {"city": rx}]},
        {"_id": 0, "school_id": 1, "school_name": 1, "city": 1,
         "assigned_to": 1, "assigned_name": 1},
    ).sort("school_name", 1).to_list(20)
    me = user["email"]
    return [{
        "school_id": r.get("school_id", ""),
        "school_name": r.get("school_name", ""),
        "city": r.get("city", ""),
        "assigned_to": r.get("assigned_to", ""),
        "assigned_name": r.get("assigned_name", ""),
        "is_mine": (r.get("assigned_to") or "") == me,
    } for r in rows]


@router.post("/schools")
async def create_school(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    school_id = f"sch_{uuid.uuid4().hex[:12]}"
    # Owner: explicit, else the creating sales rep owns what they add.
    owner = body.get("assigned_to") or (user["email"] if has_team(user, "sales") else "")
    owner_name = body.get("assigned_name") or (user["name"] if owner == user["email"] else "")
    school_doc = {
        "school_id": school_id,
        "school_name": body.get("school_name", ""),
        "assigned_to": owner,
        "assigned_name": owner_name,
        "school_type": body.get("school_type", "CBSE"),
        "board": body.get("board", ""),
        "group_id": body.get("group_id", ""),
        "website": body.get("website", ""),
        "email": body.get("email", ""),
        "phone": body.get("phone", ""),
        "city": body.get("city", ""),
        "state": body.get("state", ""),
        "pincode": body.get("pincode", ""),
        "address": body.get("address", ""),
        "primary_contact_name": body.get("primary_contact_name", ""),
        "designation": body.get("designation", ""),
        "alternate_contact": body.get("alternate_contact", ""),
        "school_strength": _coerce_int(body.get("school_strength"), 0),
        "number_of_branches": _coerce_int(body.get("number_of_branches"), 1),
        "annual_budget_range": body.get("annual_budget_range", ""),
        "existing_vendor": body.get("existing_vendor", ""),
        "gstin": body.get("gstin", ""),
        "social_profiles": body.get("social_profiles", {}),
        "linkedin_url": body.get("linkedin_url", ""),
        "instagram_url": body.get("instagram_url", ""),
        "anniversary": body.get("anniversary", ""),
        "last_activity_date": datetime.now(timezone.utc).isoformat(),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _pm = body.get("portal_login_methods")
    if isinstance(_pm, dict):
        school_doc["portal_login_methods"] = {k: bool(_pm.get(k, False)) for k in ("email_link", "magic_link", "google")}
    await db.schools.insert_one(school_doc)
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.post("/schools/bulk-tag")
async def bulk_tag_schools(request: Request):
    """Add or remove one tag across many schools.

    Tags were kept on contacts and leads but not on schools, so the labels the team
    already maintains ("CBSE", "1000+ students") could not be used to build a mailing
    or a sequence audience. Tagging in bulk is the only way it happens in practice —
    nobody tags 400 schools one at a time.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await _parse_json_body(request)
    ids = body.get("school_ids") or []
    tag_id = (body.get("tag_id") or "").strip()
    action = body.get("action", "add")
    if not ids or not tag_id:
        raise HTTPException(status_code=400, detail="school_ids and tag_id are required")
    if action not in ("add", "remove"):
        raise HTTPException(status_code=400, detail="action must be add or remove")
    if not await db.tags.find_one({"tag_id": tag_id}):
        raise HTTPException(status_code=404, detail="Tag not found")
    op = {"$addToSet": {"tags": tag_id}} if action == "add" else {"$pull": {"tags": tag_id}}
    res = await db.schools.update_many({"school_id": {"$in": ids}}, op)
    return {"ok": True, "updated": res.modified_count, "tag_id": tag_id, "action": action}


@router.post("/schools/wa-consent")
async def record_wa_consent(request: Request):
    """Record WhatsApp opt-in for many schools at once.

    Consent is almost never collected one school at a time — it arrives as a stack
    of exhibition forms, a webinar sign-up list, or a rep confirming on a call. The
    `source` is stored with every row because that sentence ("Signed at the Delhi
    expo, 12 Aug") is the evidence if Meta ever asks why a number was messaged.

    Passing consent=false withdraws it, which is the opt-out path: the drip's
    WhatsApp steps stop for that school immediately while post and calls continue.
    """
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await _parse_json_body(request)
    ids = body.get("school_ids") or []
    if not ids:
        raise HTTPException(status_code=400, detail="school_ids is required")
    grant = bool(body.get("consent", True))
    source = (body.get("source") or "").strip()
    if grant and not source:
        raise HTTPException(status_code=400,
            detail="Say where the consent came from — it is the evidence if the opt-in is ever questioned.")
    now_iso = datetime.now(timezone.utc).isoformat()
    res = await db.schools.update_many({"school_id": {"$in": ids}}, {"$set": {
        "wa_consent": grant,
        "wa_consent_at": now_iso if grant else None,
        "wa_consent_by": user["email"] if grant else "",
        "wa_consent_source": source,
    }})
    return {"ok": True, "updated": res.modified_count, "consent": grant,
            "source": source, "at": now_iso}


@router.put("/schools/{school_id}")
async def update_school(school_id: str, request: Request):
    user = await get_current_user(request)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    if not await _user_can_access_school(user, school):
        raise HTTPException(status_code=403, detail="Not authorized to edit this school")
    body = await request.json()
    allowed = {}
    for k in ("school_name", "school_type", "board", "group_id", "website", "email", "phone",
              "city", "state", "pincode", "address", "primary_contact_name", "designation",
              "alternate_contact", "school_strength", "number_of_branches",
              "annual_budget_range", "existing_vendor", "gstin", "social_profiles",
              "linkedin_url", "instagram_url", "anniversary",
              "wa_consent", "wa_consent_source"):
        if k in body:
            allowed[k] = body[k]
    if "tags" in body:
        allowed["tags"] = await _resolve_tags(body["tags"], user["email"])
    if "wa_consent" in allowed:
        allowed["wa_consent"] = bool(allowed["wa_consent"])
        allowed["wa_consent_at"] = datetime.now(timezone.utc).isoformat() if allowed["wa_consent"] else None
        allowed["wa_consent_by"] = user["email"] if allowed["wa_consent"] else ""
    if "school_strength" in allowed:
        allowed["school_strength"] = _coerce_int(allowed["school_strength"], 0)
    if "number_of_branches" in allowed:
        allowed["number_of_branches"] = _coerce_int(allowed["number_of_branches"], 1)
    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one({"school_id": school_id}, {"$set": allowed})
    return await db.schools.find_one({"school_id": school_id}, {"_id": 0})


@router.delete("/schools/{school_id}")
async def delete_school(school_id: str, request: Request, force: bool = False):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    # Cascade check — block hard delete if live data references this school
    if not force:
        linked_leads = await db.leads.count_documents({"school_id": school_id, "is_deleted": {"$ne": True}})
        linked_contacts = await db.contacts.count_documents({"school_id": school_id, "is_deleted": {"$ne": True}})
        linked_quotations = await db.quotations.count_documents({"school_id": school_id})
        linked_visits = await db.visit_plans.count_documents({"school_id": school_id})
        if linked_leads or linked_contacts or linked_quotations or linked_visits:
            return {
                "blocked": True,
                "reason": "School has linked data. Soft-deleted instead.",
                "links": {"leads": linked_leads, "contacts": linked_contacts,
                          "quotations": linked_quotations, "visits": linked_visits},
            }

    # Soft delete — keeps the record but marks it invisible to normal queries
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.schools.update_one(
        {"school_id": school_id},
        {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user["email"]}}
    )
    return {"message": "School archived (soft-deleted)"}


@router.get("/schools/{school_id}/cascade-preview")
async def preview_school_cascade(school_id: str, request: Request):
    """Owner-only: count everything a full cascade delete of this school would remove."""
    user = await get_current_user(request)
    require_superadmin(user)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    plan, label, _ = await build_school_plan(school)
    counts = await preview_counts(plan)
    return {"root_type": "school", "root_id": school_id, "label": label,
            "counts": counts, "total": sum(counts.values())}


@router.delete("/schools/{school_id}/cascade")
async def cascade_delete_school(school_id: str, request: Request, reason: str = ""):
    """Owner-only: permanently delete a school AND every related CRM+ERP record.

    Backs the entire footprint into audit_backups, hard-deletes it, then recomputes
    stock reservations so any orders removed release their reserved (undispatched) qty.
    Dispatched stock stays deducted.
    """
    user = await get_current_user(request)
    require_superadmin(user)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    plan, label, touches_orders = await build_school_plan(school)
    result = await snapshot_and_delete(
        plan, root_type="school", root_id=school_id, root_label=label,
        deleted_by=user["email"], reason=reason)

    if touches_orders:
        from routes.order_routes import recompute_reservations
        await recompute_reservations()

    await log_activity(user["email"], "cascade_delete", "school", school_id,
                       f"Deleted school '{label}' + {result['total']} related docs "
                       f"(backup {result['backup_id']})")
    return {"message": "School and all related data permanently deleted", **result}


@router.post("/schools/{school_id}/assign")
async def assign_school(school_id: str, request: Request):
    """Assign a school to a Sales Executive and cascade ownership to its
    contacts + leads. Admin only."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    # Resolve name/email → real user; blank clears the owner (unassign).
    assigned_to, assigned_name = await _apply_owner(body, default_email="", default_name="")
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    counts = await _assign_school_cascade(school_id, assigned_to, assigned_name, user)
    await log_activity(user["email"], "assign_school", "school", school_id,
                       details=f"-> {assigned_name or 'Unassigned'} ({counts['leads']} leads, {counts['contacts']} contacts)")
    updated = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    return {"school": updated, "cascaded": counts}


@router.post("/schools/backfill-owners")
async def backfill_school_owners(request: Request):
    """One-time, idempotent: give each unowned school the Sales Exec who holds the
    most of its leads. Does not cascade (those leads are already assigned). Admin only."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}, "$or": [{"assigned_to": {"$exists": False}}, {"assigned_to": ""}, {"assigned_to": None}]},
        {"_id": 0, "school_id": 1},
    ).to_list(20000)
    assigned, skipped = 0, 0
    for sch in schools:
        sid = sch["school_id"]
        leads = await db.leads.find(
            {"school_id": sid, "is_deleted": {"$ne": True}}, {"_id": 0, "assigned_to": 1, "assigned_name": 1}
        ).to_list(10000)
        tally = {}
        for l in leads:
            a = (l.get("assigned_to") or "").strip()
            if a:
                tally.setdefault(a, {"n": 0, "name": l.get("assigned_name", "")})
                tally[a]["n"] += 1
        if not tally:
            skipped += 1
            continue
        best = max(tally.items(), key=lambda kv: kv[1]["n"])
        await db.schools.update_one(
            {"school_id": sid},
            {"$set": {"assigned_to": best[0], "assigned_name": best[1]["name"]}},
        )
        assigned += 1
    return {"assigned": assigned, "skipped": skipped, "scanned": len(schools)}


@router.post("/schools/bulk-assign")
async def bulk_assign_schools(request: Request):
    """Assign many schools to one Sales Executive at once, cascading each. Admin only."""
    user = await get_current_user(request)
    require_module(user, "leads", "read_write")
    body = await request.json()
    school_ids = body.get("school_ids") or []
    # Resolve name/email → real user; blank clears the owner (unassign).
    assigned_to, assigned_name = await _apply_owner(body, default_email="", default_name="")
    if not school_ids:
        raise HTTPException(status_code=400, detail="school_ids required")
    total = {"schools": 0, "contacts": 0, "leads": 0}
    for sid in school_ids:
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_id": 1})
        if not sch:
            continue
        c = await _assign_school_cascade(sid, assigned_to, assigned_name, user)
        total["schools"] += 1
        total["contacts"] += c["contacts"]
        total["leads"] += c["leads"]
    await log_activity(user["email"], "bulk_assign_schools", "school", ",".join(school_ids[:20]),
                       details=f"-> {assigned_name or 'Unassigned'} ({total['schools']} schools, {total['leads']} leads, {total['contacts']} contacts)")
    return {"cascaded": total}


@router.put("/schools/{school_id}/restore")
async def restore_school(school_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.schools.update_one(
        {"school_id": school_id},
        {"$unset": {"is_deleted": "", "deleted_at": "", "deleted_by": ""}}
    )
    return {"message": "School restored"}


@router.get("/schools/{school_id}/profile")
async def get_school_profile(school_id: str, request: Request):
    user = await get_current_user(request)
    school = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    if not await _user_can_access_school(user, school):
        raise HTTPException(status_code=403, detail="Not authorized to view this school")
    school_name = school.get("school_name", "")

    leads = await db.leads.find({"school_id": school_id}, {"_id": 0}).to_list(None)
    lead_ids = [l["lead_id"] for l in leads]

    # Query by FK first, fall back to string match for legacy records; deduplicate
    contacts_by_fk = await db.contacts.find({"school_id": school_id}, {"_id": 0}).to_list(None)
    fk_ids = {c["contact_id"] for c in contacts_by_fk}
    contacts_by_name = await db.contacts.find(
        {"company": school_name, "contact_id": {"$nin": list(fk_ids)}}, {"_id": 0}
    ).to_list(None)
    contacts_list = contacts_by_fk + contacts_by_name

    quotations = await db.quotations.find(
        {"$or": [{"school_id": school_id}, {"school_name": school_name}]},
        {"_id": 0, "quotation_id": 1, "quotation_number": 1, "status": 1, "quotation_status": 1,
         "grand_total": 1, "currency_symbol": 1, "created_at": 1, "created_by_name": 1, "items": 1,
         "deal_type": 1}
    ).sort("created_at", -1).to_list(None)

    # Fetch from visit_plans (admin-scheduled, have school_id)
    vp_list = await db.visit_plans.find({"school_id": school_id}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    # Also fetch self-created field_visits by school_name match (reps who didn't have a plan)
    fv_list = await db.field_visits.find({"$or": [{"school_id": school_id}, {"school_name": school_name}]}, {"_id": 0}).sort("visit_date", -1).to_list(None)
    # Normalize both to a unified schema for the frontend
    def _norm_vp(v):
        status = v.get("status", "planned")
        if status == "in_progress": status = "checked_in"
        return {
            "visit_id": v.get("plan_id"), "source": "visit_plan",
            "visit_date": v.get("visit_date"), "visit_time": v.get("visit_time"),
            "status": status, "purpose": v.get("purpose"), "outcome": v.get("outcome"),
            "notes": v.get("visit_notes"), "rep_name": v.get("assigned_name"),
            "check_in_time": v.get("check_in_time"), "check_out_time": v.get("check_out_time"),
            "check_in_address": v.get("check_in_address"), "school_name": v.get("school_name"),
        }
    def _norm_fv(v):
        status = v.get("status", "planned")
        if status == "visited": status = "checked_in"
        return {
            "visit_id": v.get("visit_id"), "source": "field_visit",
            "visit_date": v.get("visit_date"), "visit_time": v.get("visit_time"),
            "status": status, "purpose": v.get("purpose"), "outcome": v.get("outcome"),
            "notes": v.get("notes"), "rep_name": v.get("sales_person_name"),
            "check_in_time": v.get("check_in_time") or v.get("checked_in_at"),
            "check_out_time": v.get("check_out_time"), "check_in_address": None,
            "school_name": v.get("school_name"),
        }
    visits = sorted(
        [_norm_vp(v) for v in vp_list] + [_norm_fv(v) for v in fv_list],
        key=lambda v: (v.get("visit_date") or ""), reverse=True
    )

    call_notes = []
    meetings = []
    dispatches = []
    contact_ids = [c["contact_id"] for c in contacts_list if c.get("contact_id")]
    # Calls may hang off this school's leads OR directly off its contacts.
    call_or = []
    if lead_ids:
        call_or.append({"lead_id": {"$in": lead_ids}})
    if contact_ids:
        call_or.append({"contact_id": {"$in": contact_ids}})
    if call_or:
        call_notes = await db.call_notes.find({"$or": call_or}, {"_id": 0}).sort("created_at", -1).to_list(None)
    if lead_ids:
        meetings = await db.followups.find(
            {"lead_id": {"$in": lead_ids}, "followup_type": "meeting"}, {"_id": 0}
        ).sort("followup_date", -1).to_list(None)
        dispatches = await db.physical_dispatches.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).sort("sent_date", -1).to_list(None)

    # Sales Orders (SO) for this school — by FK, its leads, or its quotations
    quote_ids = [q.get("quotation_id") for q in quotations if q.get("quotation_id")]
    order_or = [{"school_id": school_id}]
    if lead_ids:
        order_or.append({"lead_id": {"$in": lead_ids}})
    if quote_ids:
        order_or.append({"quotation_id": {"$in": quote_ids}})
    orders = await db.orders.find({"$or": order_or}, {"_id": 0}).sort("created_at", -1).to_list(None)

    # Communications timeline — WhatsApp / Email / Drip / Greetings reaching this
    # school's contacts + leads (aggregated via existing contact_id / lead_id / phone links).
    contact_ids = [c.get("contact_id") for c in contacts_list if c.get("contact_id")]
    phones = [c.get("phone") for c in contacts_list if c.get("phone")]
    communications = []
    if contact_ids:
        async for m in db.whatsapp_scheduled.find(
            {"contact_id": {"$in": contact_ids}},
            {"_id": 0, "campaign_name": 1, "status": 1, "sent_at": 1, "scheduled_at": 1}
        ).sort("scheduled_at", -1).limit(200):
            communications.append({"channel": "whatsapp", "label": m.get("campaign_name") or "WhatsApp message",
                                   "status": m.get("status", ""), "at": m.get("sent_at") or m.get("scheduled_at")})
        async for m in db.email_scheduled.find(
            {"contact_id": {"$in": contact_ids}},
            {"_id": 0, "subject": 1, "status": 1, "sent_at": 1, "queued_at": 1}
        ).sort("queued_at", -1).limit(200):
            communications.append({"channel": "email", "label": m.get("subject") or "Email",
                                   "status": m.get("status", ""), "at": m.get("sent_at") or m.get("queued_at")})
    if lead_ids:
        enrolls = await db.drip_enrollments.find(
            {"lead_id": {"$in": lead_ids}},
            {"_id": 0, "sequence_id": 1, "status": 1, "enrolled_at": 1, "current_step": 1}
        ).sort("enrolled_at", -1).limit(100).to_list(100)
        seq_names = {}
        seq_ids = list({e.get("sequence_id") for e in enrolls if e.get("sequence_id")})
        if seq_ids:
            async for sq in db.drip_sequences.find({"sequence_id": {"$in": seq_ids}}, {"_id": 0, "sequence_id": 1, "name": 1}):
                seq_names[sq["sequence_id"]] = sq.get("name")
        for e in enrolls:
            communications.append({"channel": "drip", "label": seq_names.get(e.get("sequence_id")) or "Drip sequence",
                                   "status": e.get("status", ""), "at": e.get("enrolled_at"),
                                   "detail": f"Step {(e.get('current_step', 0) or 0) + 1}"})
    g_or = []
    if contact_ids:
        g_or.append({"contact_id": {"$in": contact_ids}})
    if phones:
        g_or.append({"phone": {"$in": phones}})
    if g_or:
        async for g in db.greeting_logs.find(
            {"$or": g_or}, {"_id": 0, "greeting_type": 1, "status": 1, "sent_at": 1}
        ).sort("sent_at", -1).limit(100):
            communications.append({"channel": "greeting", "label": g.get("greeting_type") or "Greeting",
                                   "status": g.get("status", ""), "at": g.get("sent_at")})
    communications.sort(key=lambda x: x.get("at") or "", reverse=True)
    communications = communications[:200]

    # Invoices — by school_id (primary) or by this school's orders/quotations
    inv_or = [{"school_id": school_id}]
    order_ids = [o.get("order_id") for o in orders if o.get("order_id")]
    if order_ids:
        inv_or.append({"order_id": {"$in": order_ids}})
    if quote_ids:
        inv_or.append({"quotation_id": {"$in": quote_ids}})
    invoices = await db.invoices.find({"$or": inv_or}, {"_id": 0, "raw": 0}).sort("invoice_date", -1).to_list(None)

    # Post-Order Implementation flows (FMS) for this school — so the 360 surfaces
    # training/implementation/engagement status instead of being blind to it.
    flows_raw = await db.fms_flows.find(
        {"$or": [{"school_id": school_id}, {"lead_id": {"$in": lead_ids}}]},
        {"_id": 0, "flow_id": 1, "title": 1, "flow_type": 1, "status": 1,
         "current_stage_key": 1, "order_id": 1, "reference_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(None)
    fms_flows = []
    for _f in flows_raw:
        cur = await db.fms_stages.find_one(
            {"flow_id": _f["flow_id"], "key": _f.get("current_stage_key")},
            {"_id": 0, "label": 1, "status": 1, "tat_status": 1, "plan_done": 1, "assigned_to": 1})
        fms_flows.append({**_f, "current_stage": cur})

    # Deal types this school has been sent/associated with (distinct across its
    # leads + quotations) — powers the 360 chips and school-level deal-type filter.
    deal_types_present = sorted(
        {(l.get("deal_type") or "").strip() for l in leads}
        | {(q.get("deal_type") or "").strip() for q in quotations}
    )
    deal_types_present = [d for d in deal_types_present if d]

    # Planned activities (Bulk Activity Planner) for this school — pending first.
    activities = await db.crm_activities.find({"school_id": school_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    active_stages = {"new", "contacted", "demo", "quoted", "negotiation"}
    active_leads_count = sum(1 for l in leads if l.get("stage") in active_stages)

    all_dates = [cn["created_at"] for cn in call_notes if cn.get("created_at")]
    all_dates += [v["visit_date"] for v in visits if v.get("visit_date")]
    last_contacted = max(all_dates) if all_dates else None

    days_since = None
    if last_contacted:
        from datetime import date as _date
        try:
            lc_str = last_contacted[:10]
            lc = _date.fromisoformat(lc_str)
            days_since = (_date.today() - lc).days
        except Exception:
            pass

    total_revenue_quoted = sum(q.get("grand_total", 0) or 0 for q in quotations)
    total_revenue_ordered = sum(o.get("grand_total", 0) or 0 for o in orders)
    total_paid = sum(o.get("payment_received", 0) or 0 for o in orders)
    total_invoiced = sum(i.get("total_amount", 0) or 0 for i in invoices)
    total_outstanding = max(0, round(total_invoiced - total_paid, 2))

    # Unified engagement timeline (Phase 0) — every channel folded into one
    # chronological stream. Built from the streams already fetched above (no new
    # queries) plus any first-class ledger events future phases have recorded.
    engagement_events = await fetch_events(
        school_id=school_id, lead_ids=lead_ids, contact_ids=contact_ids, limit=300)
    engagement_timeline = normalize_timeline(
        call_notes=call_notes, visits=visits, meetings=meetings,
        quotations=quotations, orders=orders, dispatches=dispatches,
        communications=communications, activities=activities,
        events=engagement_events, limit=300)

    return {
        "school": school,
        "leads": leads,
        "contacts": contacts_list,
        "quotations": quotations,
        "orders": orders,
        "visits": visits,
        "call_notes": call_notes,
        "meetings": meetings,
        "dispatches": dispatches,
        "communications": communications,
        "invoices": invoices,
        "fms_flows": fms_flows,
        "deal_types": deal_types_present,
        "activities": activities,
        "engagement_timeline": engagement_timeline,
        "metrics": {
            "total_leads": len(leads),
            "active_leads": active_leads_count,
            "total_contacts": len(contacts_list),
            "total_visits": len(visits),
            "total_calls": len(call_notes),
            "total_quotations": len(quotations),
            "total_revenue_quoted": total_revenue_quoted,
            "total_orders": len(orders),
            "total_revenue_ordered": total_revenue_ordered,
            "total_paid": total_paid,
            "total_invoices": len(invoices),
            "total_invoiced": total_invoiced,
            "total_outstanding": total_outstanding,
            "total_communications": len(communications),
            "total_engagement": len(engagement_timeline),
            "last_contacted": last_contacted,
            "days_since_last_contact": days_since,
        },
    }


@router.put("/schools/{school_id}/set-password")
async def set_school_password(school_id: str, request: Request):
    from auth_utils import hash_password as _hash_password
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    password = body.get("password", "")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    await db.schools.update_one({"school_id": school_id}, {"$set": {"password_hash": _hash_password(password)}})
    return {"message": "Password set"}


# ==================== CONTACTS ====================

@router.get("/contacts")
async def get_contacts(request: Request):
    user = await get_current_user(request)
    if not _crm_read(user):
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — own + assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        query = {"$or": [
            *_owner_clause(user["email"])["$or"],
            {"school_id": {"$in": owned}} if owned else {"contact_id": "__none__"},
        ]}
    query["is_deleted"] = {"$ne": True}
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return contacts


@router.post("/contacts")
async def create_contact(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("name") or not body.get("phone"):
        raise HTTPException(status_code=400, detail="Name and phone are required")
    contact_id = f"con_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    # Owner default: explicit (name/email resolved), else the creating sales rep.
    _sales_self = user["email"] if has_team(user, "sales") else ""
    _sales_self_name = user["name"] if _sales_self else ""
    _default_owner, _default_owner_name = await _apply_owner(
        body, default_email=_sales_self, default_name=_sales_self_name)

    # Resolve school_id → company (FK wins over string if both supplied)
    school_id = body.get("school_id") or None
    company = body.get("company", "")
    if school_id:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "school_name": 1})
        if sch:
            company = sch["school_name"]
        else:
            school_id = None  # invalid FK — ignore it

    # Auto-link: if company name matches a school, resolve school_id
    if not school_id and company:
        found_sch = await db.schools.find_one(
            {"school_name": {"$regex": f"^{re.escape(company)}$", "$options": "i"}},
            {"_id": 0, "school_id": 1}
        )
        if found_sch:
            school_id = found_sch["school_id"]
        elif body.get("create_school_if_missing"):
            # Auto-create a minimal school record so the contact is properly linked
            new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
            await db.schools.insert_one({
                "school_id": new_sch_id,
                "school_name": company,
                "school_type": "CBSE",
                "assigned_to": _default_owner,
                "assigned_name": _default_owner_name,
                "phone": body.get("phone", ""),
                "email": body.get("email", ""),
                "city": "", "state": "", "pincode": "", "address": "",
                "primary_contact_name": body.get("name", ""),
                "designation": body.get("designation", ""),
                "school_strength": 0, "number_of_branches": 1,
                "annual_budget_range": "", "existing_vendor": "",
                "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                "last_activity_date": now_iso,
                "created_by": user["email"],
                "created_at": now_iso,
            })
            school_id = new_sch_id

    # Owner: explicit (resolved above into _default_owner) > linked school's owner
    # > creating-rep default. When the body carried no owner, prefer the school's.
    c_assigned_to, c_assigned_name = _default_owner, _default_owner_name
    if not (body.get("assigned_to") or "").strip() and school_id:
        _s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _s and _s.get("assigned_to"):
            c_assigned_to, c_assigned_name = _s["assigned_to"], _s.get("assigned_name", "")

    contact_doc = {
        "contact_id": contact_id,
        "name": body.get("name", ""),
        "phone": body.get("phone", ""),
        "email": body.get("email", ""),
        "company": company,
        "school_id": school_id,
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "notes": body.get("notes", ""),
        "birthday": body.get("birthday", ""),
        "assigned_to": c_assigned_to,
        "assigned_name": c_assigned_name,
        "status": "active",
        "converted_to_lead": False,
        "lead_id": None,
        "previous_schools": [],
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.contacts.insert_one(contact_doc)
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    existing_contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not existing_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not await _user_can_mutate_contact(user, existing_contact):
        raise HTTPException(status_code=403, detail="Not authorized to edit this contact")
    body = await request.json()
    allowed = {}
    for k in ("name", "phone", "email", "designation", "contact_role_id", "source", "source_id", "notes", "status", "birthday", "assigned_to"):
        if k in body:
            allowed[k] = body[k]

    # school_id change: update FK, sync company, log previous school
    new_school_id = body.get("school_id")
    if "school_id" in body:
        if new_school_id:
            sch = await db.schools.find_one({"school_id": new_school_id}, {"_id": 0, "school_name": 1})
            if not sch:
                raise HTTPException(status_code=404, detail="School not found")
            existing = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "school_id": 1, "company": 1})
            old_school_id = existing.get("school_id") if existing else None
            if old_school_id and old_school_id != new_school_id:
                # Log the school change in history
                await db.contacts.update_one(
                    {"contact_id": contact_id},
                    {"$push": {"previous_schools": {
                        "school_id": old_school_id,
                        "company": existing.get("company", ""),
                        "until": datetime.now(timezone.utc).isoformat(),
                    }}}
                )
            allowed["school_id"] = new_school_id
            allowed["company"] = sch["school_name"]
        else:
            allowed["school_id"] = None

    # Allow direct company edit only when no school_id is being set
    elif "company" in body:
        new_company = body["company"]
        allowed["company"] = new_company
        # Auto-link: if the new company name matches a school, set school_id
        if new_company:
            found_sch = await db.schools.find_one(
                {"school_name": {"$regex": f"^{re.escape(new_company)}$", "$options": "i"}},
                {"_id": 0, "school_id": 1}
            )
            if found_sch:
                allowed["school_id"] = found_sch["school_id"]
            elif body.get("create_school_if_missing") and new_company:
                now_iso = datetime.now(timezone.utc).isoformat()
                existing_con = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "name": 1, "phone": 1, "designation": 1})
                new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
                await db.schools.insert_one({
                    "school_id": new_sch_id,
                    "school_name": new_company,
                    "school_type": "CBSE",
                    "phone": existing_con.get("phone", "") if existing_con else "",
                    "email": body.get("email", ""),
                    "city": "", "state": "", "pincode": "", "address": "",
                    "primary_contact_name": existing_con.get("name", "") if existing_con else "",
                    "designation": existing_con.get("designation", "") if existing_con else "",
                    "school_strength": 0, "number_of_branches": 1,
                    "annual_budget_range": "", "existing_vendor": "",
                    "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                    "last_activity_date": now_iso, "created_by": "auto", "created_at": now_iso,
                })
                allowed["school_id"] = new_sch_id

    allowed["last_activity_date"] = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": allowed})
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized to delete this contact")
    # Block deletion if contact has been converted to an active lead
    if contact.get("converted_to_lead") and contact.get("lead_id"):
        lead = await db.leads.find_one({"lead_id": contact["lead_id"], "is_deleted": {"$ne": True}}, {"_id": 0, "lead_id": 1})
        if lead:
            raise HTTPException(status_code=409, detail="Contact is linked to an active lead. Delete the lead first or unlink it.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user["email"]}}
    )
    # Null out the back-reference on any lead that referenced this contact, via
    # EITHER link style so no dangling pointer survives (D1/D2):
    #  - contact_id           = canonical link (create/import + unify migration)
    #  - converted_from_contact = legacy convert-flow link
    await db.leads.update_many(
        {"contact_id": contact_id},
        {"$unset": {"contact_id": ""}}
    )
    await db.leads.update_many(
        {"converted_from_contact": contact_id},
        {"$unset": {"converted_from_contact": ""}}
    )
    # Clear this contact's own forward link so it can't point at a lead anymore.
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$unset": {"lead_id": "", "converted_to_lead": ""}}
    )
    # Null out referral references
    await db.leads.update_many(
        {"referred_by_contact_id": contact_id},
        {"$unset": {"referred_by_contact_id": ""}}
    )
    return {"message": "Contact archived (soft-deleted)"}


@router.get("/contacts/{contact_id}/cascade-preview")
async def preview_contact_cascade(contact_id: str, request: Request):
    """Owner-only: count what a cascade delete of this contact + its lead chain removes."""
    user = await get_current_user(request)
    require_superadmin(user)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    plan, label, _ = await build_contact_plan(contact)
    counts = await preview_counts(plan)
    return {"root_type": "contact", "root_id": contact_id, "label": label,
            "counts": counts, "total": sum(counts.values())}


@router.delete("/contacts/{contact_id}/cascade")
async def cascade_delete_contact(contact_id: str, request: Request, reason: str = ""):
    """Owner-only: permanently delete a contact and its lead chain (leads, quotations,
    orders, activity). Sibling contacts / school-wide data are left intact."""
    user = await get_current_user(request)
    require_superadmin(user)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    plan, label, touches_orders = await build_contact_plan(contact)
    result = await snapshot_and_delete(
        plan, root_type="contact", root_id=contact_id, root_label=label,
        deleted_by=user["email"], reason=reason)

    if touches_orders:
        from routes.order_routes import recompute_reservations
        await recompute_reservations()

    await log_activity(user["email"], "cascade_delete", "contact", contact_id,
                       f"Deleted contact '{label}' + {result['total']} related docs "
                       f"(backup {result['backup_id']})")
    return {"message": "Contact and related data permanently deleted", **result}


@router.post("/contacts/{contact_id}/tags")
async def add_contact_tag(contact_id: str, request: Request):
    """Add a tag to a contact. Body: {tag_id: str}"""
    await get_current_user(request)
    body = await request.json()
    tag_id = body.get("tag_id", "").strip()
    if not tag_id:
        raise HTTPException(400, "tag_id is required")
    if not await db.tags.find_one({"tag_id": tag_id}):
        raise HTTPException(404, "Tag not found")
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$addToSet": {"tag_ids": tag_id}}
    )
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.delete("/contacts/{contact_id}/tags/{tag_id}")
async def remove_contact_tag(contact_id: str, tag_id: str, request: Request):
    """Remove a tag from a contact."""
    await get_current_user(request)
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$pull": {"tag_ids": tag_id}}
    )
    return await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})


@router.get("/contacts/{contact_id}/activity")
async def get_contact_activity(contact_id: str, request: Request):
    """Unified activity timeline: WhatsApp campaigns, drip enrollments, greeting logs."""
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(404, "Contact not found")
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized for this contact")

    items = []

    # Calls + follow-ups — merged with the linked lead's rows so a converted
    # contact shows ONE history rather than two.
    tq = cc.timeline_query(contact_id, contact.get("lead_id"))
    async for n in db.call_notes.find(tq, {"_id": 0}).sort("created_at", -1).limit(50):
        items.append({
            "type": "call",
            "label": f"Call · {(n.get('outcome') or 'logged').replace('_', ' ').title()}",
            "summary": n.get("content", ""),
            "status": n.get("outcome", ""),
            "recording_url": n.get("recording_url", ""),
            "at": n.get("created_at", ""),
        })
    async for f in db.followups.find(tq, {"_id": 0}).sort("followup_date", -1).limit(50):
        items.append({
            "type": "followup",
            "label": f"Follow-up · {(f.get('followup_type') or 'call').title()}",
            "summary": f.get("notes", ""),
            "status": f.get("status", ""),
            "at": f"{f.get('followup_date', '')}T{f.get('followup_time') or '00:00'}",
        })

    # WhatsApp campaign messages sent to this contact
    async for msg in db.whatsapp_scheduled.find(
        {"contact_id": contact_id}, {"_id": 0, "campaign_name": 1, "status": 1, "scheduled_at": 1, "sent_at": 1}
    ).sort("scheduled_at", -1).limit(50):
        items.append({
            "type": "whatsapp",
            "label": msg.get("campaign_name", "WhatsApp Campaign"),
            "summary": f"Status: {msg.get('status', 'unknown')}",
            "status": msg.get("status", ""),
            "at": msg.get("sent_at") or msg.get("scheduled_at", ""),
        })

    # Drip enrollments via linked lead
    lead_id = contact.get("lead_id")
    if lead_id:
        async for enr in db.drip_enrollments.find(
            {"lead_id": lead_id}, {"_id": 0, "sequence_id": 1, "status": 1, "enrolled_at": 1, "current_step": 1}
        ).sort("enrolled_at", -1).limit(20):
            seq = await db.drip_sequences.find_one({"sequence_id": enr["sequence_id"]}, {"_id": 0, "name": 1})
            seq_name = seq["name"] if seq else enr["sequence_id"]
            items.append({
                "type": "drip",
                "label": seq_name,
                "summary": f"Step {enr.get('current_step', 0) + 1} · {enr.get('status', '')}",
                "status": enr.get("status", ""),
                "at": enr.get("enrolled_at", ""),
            })

    # Greeting logs by phone
    phone = contact.get("phone", "")
    if phone:
        async for gl in db.greeting_logs.find(
            {"phone": phone}, {"_id": 0, "greeting_type": 1, "status": 1, "sent_at": 1}
        ).sort("sent_at", -1).limit(20):
            items.append({
                "type": "greeting",
                "label": gl.get("greeting_type", "Greeting"),
                "summary": f"Status: {gl.get('status', 'unknown')}",
                "status": gl.get("status", ""),
                "at": gl.get("sent_at", ""),
            })

    # Sort all by `at` descending; this endpoint returns the 100 most-recent
    # items across all sources.
    items.sort(key=lambda x: x.get("at") or "", reverse=True)
    return items[:100]


@router.put("/contacts/{contact_id}/restore")
async def restore_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    await db.contacts.update_one(
        {"contact_id": contact_id},
        {"$unset": {"is_deleted": "", "deleted_at": "", "deleted_by": ""}}
    )
    return {"message": "Contact restored"}


@router.post("/contacts/{contact_id}/convert-to-lead")
async def convert_contact_to_lead(contact_id: str, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.get("converted_to_lead"):
        raise HTTPException(status_code=400, detail="Contact already converted to a lead")

    body = await request.json()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Owner default for the convert flow: explicit (resolved) > contact owner > creating sales rep.
    _cv_default = (contact.get("assigned_to") or "").strip() or (user["email"] if has_team(user, "sales") else "")
    _cv_default_name = (contact.get("assigned_name") or "").strip() or (user["name"] if _cv_default == user["email"] else "")
    _cv_owner, _cv_owner_name = await _apply_owner(
        body, default_email=_cv_default, default_name=_cv_default_name)

    # Inline school creation
    school_id = body.get("school_id", "")
    company_name = contact.get("company", "")
    new_school_data = body.get("new_school")
    if new_school_data and new_school_data.get("school_name"):
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        company_name = new_school_data.get("school_name", "")
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": company_name,
            "assigned_to": _cv_owner,
            "assigned_name": _cv_owner_name,
            "school_type": new_school_data.get("school_type", "CBSE"),
            "phone": new_school_data.get("phone", ""),
            "email": new_school_data.get("email", ""),
            "city": new_school_data.get("city", ""),
            "state": new_school_data.get("state", ""),
            "pincode": new_school_data.get("pincode", ""),
            "school_strength": _coerce_int(new_school_data.get("school_strength"), 0),
            "primary_contact_name": contact["name"],
            "designation": contact.get("designation", ""),
            "created_at": now_iso,
            "last_activity_date": now_iso,
        })
    elif school_id:
        sch = await db.schools.find_one({"school_id": school_id}, {"_id": 0})
        if sch:
            company_name = sch.get("school_name", company_name)

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    # Assignee: explicit > the linked school's owner > convert-flow default.
    _school_owner, _school_owner_name = "", ""
    if school_id:
        _ls = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _ls and _ls.get("assigned_to"):
            _school_owner, _school_owner_name = _ls["assigned_to"], _ls.get("assigned_name", "")
    _eff_assigned_to, _eff_assigned_name = await _apply_owner(
        body, default_email=_school_owner or _cv_owner,
        default_name=_school_owner_name or _cv_owner_name)
    lead_doc = {
        "lead_id": lead_id,
        "school_id": school_id,
        "company_name": company_name,
        "contact_name": contact["name"],
        "designation": contact.get("designation", ""),
        "contact_role_id": contact.get("contact_role_id", ""),
        "contact_phone": contact["phone"],
        "contact_email": contact.get("email", ""),
        "source": contact.get("source", ""),
        "source_id": contact.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "deal_type": body.get("deal_type", ""),
        "interested_product": body.get("interested_product", ""),
        "stage": "new",
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": _eff_assigned_to,
        "assigned_name": _eff_assigned_name,
        "notes": contact.get("notes", ""),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "converted_from_contact": contact_id,
    }
    await db.leads.insert_one(lead_doc)
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "converted_to_lead": True,
        "lead_id": lead_id,
        "status": "converted",
        "last_activity_date": now_iso,
    }})
    if school_id:
        await touch_last_activity("school", school_id)
    intro = (body.get("intro_message") or "").strip()
    if intro:
        await _send_intro_wa(lead_doc.get("contact_phone", ""), intro)
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/contacts/import")
async def import_contacts_csv(
    file: UploadFile = File(...),
    tag_ids: Optional[str] = Form(None),
    global_notes: Optional[str] = Form(None),
    request: Request = None,
):
    if request:
        user = await get_current_user(request)
    tag_id_list = [t.strip() for t in (tag_ids or "").split(",") if t.strip()]
    extra_note = (global_notes or "").strip()
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    created = 0
    duplicates = 0
    errors = []
    for row in reader:
        try:
            name = row.get("name", "").strip()
            phone = row.get("phone", "").strip()
            if not name or not phone:
                errors.append("Row missing name or phone")
                continue
            existing = await db.contacts.find_one({"phone": phone, "name": name})
            if existing:
                duplicates += 1
                continue
            contact_id = f"con_{uuid.uuid4().hex[:12]}"
            csv_notes = row.get("notes", "").strip()
            notes_combined = f"{csv_notes}\n{extra_note}".strip() if csv_notes and extra_note else (extra_note or csv_notes)
            csv_company = (row.get("school", "") or row.get("company", "")).strip()
            csv_now = datetime.now(timezone.utc).isoformat()
            # Resolve the CSV owner (name OR email) → real (email, name). A bare name
            # like "Parul Kanchan" maps to that salesperson's email so the contact
            # actually syncs to their account and the UI shows the owner.
            owner_email, owner_name = await _resolve_owner(row.get("assigned_to", ""))
            # Auto-link company name → school_id; auto-create school if missing
            csv_school_id = None
            if csv_company:
                found_sch = await db.schools.find_one(
                    {"school_name": {"$regex": f"^{re.escape(csv_company)}$", "$options": "i"}},
                    {"_id": 0, "school_id": 1, "assigned_to": 1}
                )
                if found_sch:
                    csv_school_id = found_sch["school_id"]
                    # Link an unowned school to this contact's owner so the rep sees it.
                    if owner_email and not (found_sch.get("assigned_to") or ""):
                        await db.schools.update_one(
                            {"school_id": csv_school_id},
                            {"$set": {"assigned_to": owner_email, "assigned_name": owner_name}})
                else:
                    new_sch_id = f"sch_{uuid.uuid4().hex[:12]}"
                    await db.schools.insert_one({
                        "school_id": new_sch_id, "school_name": csv_company,
                        "school_type": "CBSE",
                        "assigned_to": owner_email, "assigned_name": owner_name,
                        "phone": phone, "email": row.get("email", "").strip(),
                        "city": "", "state": "", "pincode": "", "address": "",
                        "primary_contact_name": name,
                        "designation": row.get("designation", "").strip(),
                        "school_strength": 0, "number_of_branches": 1,
                        "annual_budget_range": "", "existing_vendor": "",
                        "social_profiles": {}, "linkedin_url": "", "instagram_url": "",
                        "last_activity_date": csv_now, "created_by": "import", "created_at": csv_now,
                    })
                    csv_school_id = new_sch_id
            await db.contacts.insert_one({
                "contact_id": contact_id,
                "name": name,
                "phone": phone,
                "email": row.get("email", "").strip(),
                "company": csv_company,
                "school_id": csv_school_id,
                "designation": row.get("designation", "").strip(),
                "source": row.get("source", "").strip(),
                "notes": notes_combined,
                "birthday": row.get("birthday", "").strip(),
                "assigned_to": owner_email,
                "assigned_name": owner_name,
                "tag_ids": tag_id_list,
                "status": "active",
                "converted_to_lead": False,
                "lead_id": None,
                "created_by": user["email"] if request else "import",
                "created_at": csv_now,
                "last_activity_date": csv_now,
            })
            created += 1
        except Exception as e:
            errors.append(str(e))
    return {"created": created, "duplicates": duplicates, "errors": errors[:10]}


async def _backfill_contact_owners_core() -> dict:
    """Idempotent repair for contacts whose `assigned_to` holds a NAME instead of an
    email (e.g. older CSV imports). Resolves the name → real user, sets both
    `assigned_to` (email) + `assigned_name`, and links the contact's school to that
    owner when the school is currently unowned. Also backfills a blank `assigned_name`
    when the owner email is already correct. Never overrides an already-owned school."""
    fixed = 0
    linked_schools = 0
    unresolved: dict = {}
    cursor = db.contacts.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "contact_id": 1, "assigned_to": 1, "assigned_name": 1, "school_id": 1},
    )
    async for c in cursor:
        at = (c.get("assigned_to") or "").strip()
        an = (c.get("assigned_name") or "").strip()
        set_doc = {}
        owner_email = ""
        owner_name = an
        if at and "@" not in at:
            # NAME in the email field — the broken case
            owner_email, resolved_name = await _resolve_owner(at)
            if owner_email:
                owner_name = resolved_name or at
                set_doc["assigned_to"] = owner_email
                set_doc["assigned_name"] = owner_name
            else:
                # can't resolve — keep the label as the name, clear the bad email field
                set_doc["assigned_to"] = ""
                set_doc["assigned_name"] = at
                unresolved[at] = unresolved.get(at, 0) + 1
        elif at and "@" in at:
            # already a real email owner — fill a missing display name
            owner_email = at
            if not an:
                _, resolved_name = await _resolve_owner(at)
                if resolved_name:
                    owner_name = resolved_name
                    set_doc["assigned_name"] = resolved_name
        if set_doc:
            await db.contacts.update_one({"contact_id": c["contact_id"]}, {"$set": set_doc})
            fixed += 1
        # Link an UNOWNED school to the contact's owner so the rep also sees the
        # account. Runs for every email-owned contact (not only ones we just
        # changed) so a re-run converges; never overrides an already-owned school.
        sid = c.get("school_id")
        if owner_email and sid:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "assigned_to": 1})
            if sch and not (sch.get("assigned_to") or ""):
                await db.schools.update_one(
                    {"school_id": sid},
                    {"$set": {"assigned_to": owner_email, "assigned_name": owner_name}})
                linked_schools += 1
    return {"fixed": fixed, "linked_schools": linked_schools, "unresolved": unresolved}


@router.post("/contacts/backfill-owners")
async def backfill_contact_owners(request: Request):
    """Admin-only, idempotent: repair contacts whose owner was stored as a name (not an
    email) — e.g. from an older CSV import — so they sync to the right Sales Exec."""
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return await _backfill_contact_owners_core()


# ==================== LEADS ====================

@router.get("/leads")
async def get_leads(request: Request):
    user = await get_current_user(request)
    if not _crm_read(user):
        return []
    if sees_all(user, "leads"):
        query = {}
    else:  # own-scoped — assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        query = {"$or": [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"},
        ]}
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    school_cache = {}
    now = datetime.now(timezone.utc)
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)

    # Batch-fetch linked contact names (P1-B). Resolve via EITHER link style so
    # both create/import leads (contact_id) and convert-flow leads
    # (converted_from_contact) show their contact — prefer contact_id (D1).
    def _linked_cid(l):
        return l.get("contact_id") or l.get("converted_from_contact")
    cfc_ids = list({_linked_cid(l) for l in leads if _linked_cid(l)})
    linked_map = {}
    if cfc_ids:
        async for c in db.contacts.find(
            {"contact_id": {"$in": cfc_ids}}, {"_id": 0, "contact_id": 1, "name": 1}
        ):
            linked_map[c["contact_id"]] = c["name"]

    for lead in leads:
        sid = lead.get("school_id")
        if sid and sid not in school_cache:
            sch = await db.schools.find_one({"school_id": sid}, {"_id": 0})
            school_cache[sid] = sch
        school = school_cache.get(sid)
        lead["school_name"] = school["school_name"] if school else lead.get("school_name", "")
        lead["school_type"] = school.get("school_type", "") if school else ""
        lead["school_city"] = school.get("city", "") if school else ""
        lead["school_strength"] = school.get("school_strength", 0) if school else 0
        lead["lead_score"] = calc_lead_score(lead, school)
        lead["visit_required"] = compute_visit_required(lead, now)
        lead["deal_value"] = resolve_lead_value(lead, quote_map)
        lead["probability"] = stage_probability(lead.get("stage", ""), settings)
        lead["weighted_value"] = round(lead["deal_value"] * lead["probability"] / 100, 2)
        lead["linked_contact_name"] = linked_map.get(_linked_cid(lead))
    return leads


@router.get("/leads/search")
async def search_leads(request: Request, q: str = "", limit: int = 8):
    """Typeahead lead search, scoped like GET /leads. Placed before /leads/{lead_id}
    routes so it isn't shadowed."""
    user = await get_current_user(request)
    q = (q or "").strip()
    if len(q) < 2:
        return {"leads": []}

    if not _crm_read(user):
        return {"leads": []}
    if sees_all(user, "leads"):
        scope = {}
    else:  # own-scoped — assigned + everything under owned schools
        owned = await _owned_school_ids(user["email"])
        scope = {"$or": [
            {"assigned_to": user["email"]},
            {"school_id": {"$in": owned}} if owned else {"lead_id": "__none__"},
        ]}

    rx = {"$regex": re.escape(q), "$options": "i"}
    text = {"$or": [
        {"company_name": rx},
        {"contact_name": rx},
        {"contact_phone": rx},
        {"school_name": rx},
    ]}
    query = {"$and": [scope, text]} if scope else text

    try:
        lim = max(1, min(25, int(limit)))
    except (TypeError, ValueError):
        lim = 8

    rows = await db.leads.find(
        query,
        {"_id": 0, "lead_id": 1, "company_name": 1, "contact_name": 1, "contact_phone": 1,
         "contact_email": 1, "school_id": 1, "school_name": 1, "stage": 1},
    ).sort("created_at", -1).limit(lim).to_list(lim)

    for r in rows:
        if not r.get("company_name"):
            r["company_name"] = r.get("school_name", "")
    return {"leads": rows}


def _norm_phone(p):
    """Digits-only, last 10 — used to match the same person across formatting."""
    d = re.sub(r"\D", "", p or "")
    return d[-10:] if len(d) >= 10 else d


async def _upsert_lead_contact(*, school_id, name, phone, email, designation,
                               contact_role_id, assigned_to, assigned_name,
                               explicit_contact_id, user_email):
    """Ensure a Contact row exists for a lead's person and return its contact_id.

    - explicit_contact_id: the caller already chose an existing contact (picked
      from the school's contact list) → link to it and propagate edited fields.
    - otherwise dedup by normalized phone WITHIN the school; create if none match.
    Returns the contact_id, or None when there is nothing to sync (no name/phone).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    name = (name or "").strip()
    phone = (phone or "").strip()

    # 1. Explicit pick / already-linked contact — keep it in sync with the lead.
    if explicit_contact_id:
        exists = await db.contacts.find_one(
            {"contact_id": explicit_contact_id, "is_deleted": {"$ne": True}},
            {"_id": 0, "contact_id": 1})
        if exists:
            patch = {}
            if name: patch["name"] = name
            if phone: patch["phone"] = phone
            if email: patch["email"] = email
            if designation: patch["designation"] = designation
            if contact_role_id: patch["contact_role_id"] = contact_role_id
            if patch:
                patch["last_activity_date"] = now_iso
                await db.contacts.update_one(
                    {"contact_id": explicit_contact_id}, {"$set": patch})
            return explicit_contact_id

    if not phone and not name:
        return None

    # Resolve the school's company name (and drop an invalid FK).
    company = ""
    if school_id:
        sch = await db.schools.find_one(
            {"school_id": school_id}, {"_id": 0, "school_name": 1})
        if sch:
            company = sch["school_name"]
        else:
            school_id = None

    # 2. Dedup by normalized phone within the same school.
    nphone = _norm_phone(phone)
    if nphone:
        async for c in db.contacts.find(
            {"school_id": school_id if school_id else None, "is_deleted": {"$ne": True}},
            {"_id": 0, "contact_id": 1, "phone": 1, "name": 1, "email": 1,
             "designation": 1, "contact_role_id": 1},
        ):
            if _norm_phone(c.get("phone")) == nphone:
                # Same person — fill in only the fields the contact is missing.
                patch = {}
                if name and not c.get("name"): patch["name"] = name
                if email and not c.get("email"): patch["email"] = email
                if designation and not c.get("designation"): patch["designation"] = designation
                if contact_role_id and not c.get("contact_role_id"): patch["contact_role_id"] = contact_role_id
                if patch:
                    patch["last_activity_date"] = now_iso
                    await db.contacts.update_one(
                        {"contact_id": c["contact_id"]}, {"$set": patch})
                return c["contact_id"]

    # 3. No match — create a new Contact under the school.
    contact_id = f"con_{uuid.uuid4().hex[:12]}"
    await db.contacts.insert_one({
        "contact_id": contact_id,
        "name": name,
        "phone": phone,
        "email": email or "",
        "company": company,
        "school_id": school_id,
        "designation": designation or "",
        "contact_role_id": contact_role_id or "",
        "source": "lead",
        "source_id": "",
        "notes": "",
        "birthday": "",
        "assigned_to": assigned_to or "",
        "assigned_name": assigned_name or "",
        "status": "active",
        "converted_to_lead": False,
        "lead_id": None,
        "previous_schools": [],
        "last_activity_date": now_iso,
        "created_by": user_email,
        "created_at": now_iso,
    })
    return contact_id


@router.post("/leads/backfill-contacts")
async def backfill_lead_contacts(request: Request):
    """One-time (re-runnable) admin job: create/link a Contact for every lead that
    doesn't have one yet, so historical leads show up in the Contacts directory."""
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    scanned = 0
    linked = 0
    async for lead in db.leads.find(
        {"$or": [{"contact_id": {"$exists": False}}, {"contact_id": None}, {"contact_id": ""}]},
        {"_id": 0},
    ):
        scanned += 1
        cid = await _upsert_lead_contact(
            school_id=lead.get("school_id") or None,
            name=lead.get("contact_name", ""),
            phone=lead.get("contact_phone", ""),
            email=lead.get("contact_email", ""),
            designation=lead.get("designation", ""),
            contact_role_id=lead.get("contact_role_id", ""),
            assigned_to=lead.get("assigned_to", ""),
            assigned_name=lead.get("assigned_name", ""),
            explicit_contact_id=None,
            user_email=lead.get("created_by") or user["email"],
        )
        if cid:
            await db.leads.update_one(
                {"lead_id": lead["lead_id"]}, {"$set": {"contact_id": cid}})
            linked += 1
    return {"scanned": scanned, "linked": linked}


@router.post("/leads")
async def create_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    # Owner for an inline new school: explicit (name/email resolved), else the creating sales rep.
    _sales_self = user["email"] if has_team(user, "sales") else ""
    _sales_self_name = user["name"] if _sales_self else ""
    _ns_owner, _ns_owner_name = await _apply_owner(
        body, default_email=_sales_self, default_name=_sales_self_name)

    school_id = body.get("school_id")
    # Validate existing school_id refers to a real, non-deleted school
    if school_id and not body.get("new_school"):
        sch_exists = await db.schools.find_one(
            {"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1}
        )
        if not sch_exists:
            raise HTTPException(status_code=404, detail="School not found or has been deleted")
    if not school_id and body.get("new_school"):
        ns = body["new_school"]
        school_id = f"sch_{uuid.uuid4().hex[:12]}"
        await db.schools.insert_one({
            "school_id": school_id,
            "school_name": ns.get("school_name", ""),
            "school_type": ns.get("school_type", "CBSE"),
            "assigned_to": _ns_owner,
            "assigned_name": _ns_owner_name,
            "website": ns.get("website", ""),
            "email": ns.get("email", ""),
            "phone": ns.get("phone", ""),
            "city": ns.get("city", ""),
            "state": ns.get("state", ""),
            "pincode": ns.get("pincode", ""),
            "primary_contact_name": body.get("contact_name", ""),
            "designation": body.get("designation", ""),
            "school_strength": _coerce_int(ns.get("school_strength"), 0),
            "number_of_branches": _coerce_int(ns.get("number_of_branches"), 1),
            "created_by": user["email"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    initial_stage = body.get("stage", "new")
    # Assignee: explicit > the linked school's owner > creator.
    _school_owner, _school_owner_name = "", ""
    if school_id:
        _ls = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
        if _ls and _ls.get("assigned_to"):
            _school_owner, _school_owner_name = _ls["assigned_to"], _ls.get("assigned_name", "")
    # Effective owner: explicit (resolved) > linked school's owner > creator.
    _eff_assigned_to, _eff_assigned_name = await _apply_owner(
        body, default_email=_school_owner or user["email"],
        default_name=_school_owner_name or user["name"])
    lead_doc = {
        "lead_id": lead_id,
        "school_id": school_id or "",
        "company_name": body.get("company_name", ""),
        "contact_name": body.get("contact_name", ""),
        "designation": body.get("designation", ""),
        "contact_role_id": body.get("contact_role_id", ""),
        "contact_phone": body.get("contact_phone", ""),
        "contact_email": body.get("contact_email", ""),
        "source": body.get("source", ""),
        "source_id": body.get("source_id", ""),
        "lead_type": body.get("lead_type", "warm"),
        "deal_type": body.get("deal_type", ""),
        "interested_product": body.get("interested_product", ""),
        "stage": initial_stage,
        "priority": body.get("priority", "medium"),
        "next_followup_date": body.get("next_followup_date", ""),
        "assigned_to": _eff_assigned_to,
        "assigned_name": _eff_assigned_name,
        "assignment_type": body.get("assignment_type", "manual"),
        "likely_closure_date": body.get("likely_closure_date", ""),
        "pipeline_history": [{
            "from_stage": None,
            "to_stage": initial_stage,
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": "Lead created",
        }],
        "last_visit_date": None,
        "notes": body.get("notes", ""),
        "expected_value": float(body.get("expected_value", 0) or 0),
        "lost_reason": body.get("lost_reason", ""),
        "lost_reason_note": body.get("lost_reason_note", ""),
        "referred_by_contact_id": body.get("referred_by_contact_id", ""),
        "referral_reward_status": body.get("referral_reward_status", "none"),
        "tags": await _resolve_tags(body.get("tags", []), user["email"]),
        "last_activity_date": now_iso,
        "created_by": user["email"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    # Sync the person into the Contacts directory (pick existing or create new).
    lead_doc["contact_id"] = await _upsert_lead_contact(
        school_id=school_id or None,
        name=body.get("contact_name", ""),
        phone=body.get("contact_phone", ""),
        email=body.get("contact_email", ""),
        designation=body.get("designation", ""),
        contact_role_id=body.get("contact_role_id", ""),
        assigned_to=_eff_assigned_to,
        assigned_name=_eff_assigned_name,
        explicit_contact_id=body.get("contact_id"),
        user_email=user["email"],
    )
    await db.leads.insert_one(lead_doc)
    asyncio.create_task(_auto_enroll_lead(lead_doc))
    if school_id:
        await touch_last_activity("school", school_id)
        # Leads inherit the SCHOOL's owner (see _apply_owner), so a lead Parul
        # starts on Amit's school is assigned to Amit. That is the territory
        # model working, but it means work silently appears on his plate —
        # which is precisely why he has to be told.
        await notify_school_owner(
            school_id, user, "a lead", ref_type="lead",
            tail="It has been assigned to you.")
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    existing = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await _user_can_mutate_lead(user, existing):
        raise HTTPException(status_code=403, detail="Not authorized to edit this lead")
    allowed = {}
    for k in ("school_id", "company_name", "contact_name", "designation", "contact_role_id",
              "contact_phone", "contact_email", "source", "source_id",
              "lead_type", "deal_type", "interested_product", "stage", "priority",
              "next_followup_date", "assigned_to", "assigned_name", "notes",
              "assignment_type", "likely_closure_date",
              "expected_value", "lost_reason", "lost_reason_note",
              "demo_format", "demo_date", "demo_time", "demo_link", "demo_visit_plan_id",
              "referred_by_contact_id", "referral_reward_status",
              "wa_consent"):
        if k in body:
            allowed[k] = body[k]
    if "wa_consent" in allowed:
        # Meta wants evidence, not a checkbox: stamp who recorded it and when.
        allowed["wa_consent"] = bool(allowed["wa_consent"])
        allowed["wa_consent_at"] = datetime.now(timezone.utc).isoformat() if allowed["wa_consent"] else None
        allowed["wa_consent_by"] = user["email"] if allowed["wa_consent"] else ""
    if "expected_value" in allowed:
        allowed["expected_value"] = float(allowed["expected_value"] or 0)
    if "tags" in body:
        allowed["tags"] = await _resolve_tags(body["tags"], user["email"])
    now_iso = datetime.now(timezone.utc).isoformat()
    allowed["updated_at"] = now_iso
    allowed["last_activity_date"] = now_iso

    # Resolve any "Assign To" (name/email) to a real user; never store a raw name.
    if "assigned_to" in body:
        _ao, _an = await _apply_owner(
            body, default_email=existing.get("assigned_to", ""),
            default_name=existing.get("assigned_name", ""))
        allowed["assigned_to"] = _ao
        allowed["assigned_name"] = _an
        if _ao and _ao != existing.get("assigned_to"):
            allowed["assigned_date"] = now_iso

    if existing.get("is_locked") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Lead is locked after order conversion. Admin unlock required.")

    if body.get("stage") == "lost" and existing.get("stage") != "lost":
        reason = (body.get("lost_reason") or existing.get("lost_reason") or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="lost_reason is required when marking a lead Lost")

    if "stage" in body and body["stage"] != existing.get("stage"):
        history = existing.get("pipeline_history", []) or []
        history.append({
            "from_stage": existing.get("stage"),
            "to_stage": body["stage"],
            "by_email": user["email"],
            "by_name": user["name"],
            "at": now_iso,
            "note": body.get("stage_change_note", ""),
        })
        allowed["pipeline_history"] = history

    if allowed.get("assigned_to") and allowed["assigned_to"] != existing.get("assigned_to"):
        await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                           details=f"From {existing.get('assigned_name', existing.get('assigned_to'))} to {allowed.get('assigned_name', allowed['assigned_to'])}")

    await db.leads.update_one({"lead_id": lead_id}, {"$set": allowed})

    # Keep the linked Contact in sync when the person's fields change.
    _cfields = {"contact_name", "contact_phone", "contact_email",
                "designation", "contact_role_id", "school_id", "contact_id"}
    if _cfields & set(body.keys()):
        merged = {**existing, **allowed}
        cid = await _upsert_lead_contact(
            school_id=merged.get("school_id") or None,
            name=merged.get("contact_name", ""),
            phone=merged.get("contact_phone", ""),
            email=merged.get("contact_email", ""),
            designation=merged.get("designation", ""),
            contact_role_id=merged.get("contact_role_id", ""),
            assigned_to=merged.get("assigned_to", ""),
            assigned_name=merged.get("assigned_name", ""),
            explicit_contact_id=body.get("contact_id") or existing.get("contact_id"),
            user_email=user["email"],
        )
        if cid and cid != existing.get("contact_id"):
            await db.leads.update_one(
                {"lead_id": lead_id}, {"$set": {"contact_id": cid}})

    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return lead


@router.get("/leads/referral-leaderboard")
async def referral_leaderboard(request: Request):
    """Returns top referrers: contacts who have referred the most leads."""
    await get_current_user(request)
    pipeline = [
        {"$match": {"referred_by_contact_id": {"$exists": True, "$ne": ""}}},
        {"$group": {
            "_id": "$referred_by_contact_id",
            "total_referred": {"$sum": 1},
            "won": {"$sum": {"$cond": [{"$eq": ["$stage", "won"]}, 1, 0]}},
            "pending": {"$sum": {"$cond": [{"$nin": ["$stage", ["won", "lost"]]}, 1, 0]}},
        }},
        {"$sort": {"total_referred": -1}},
        {"$limit": 20},
    ]
    rows = await db.leads.aggregate(pipeline).to_list(20)
    contact_ids = [r["_id"] for r in rows]
    contacts = await db.contacts.find({"contact_id": {"$in": contact_ids}}, {"_id": 0, "contact_id": 1, "name": 1, "company": 1, "phone": 1}).to_list(20)
    contact_map = {c["contact_id"]: c for c in contacts}
    result = []
    for r in rows:
        c = contact_map.get(r["_id"], {})
        result.append({
            "contact_id": r["_id"],
            "contact_name": c.get("name", "Unknown"),
            "company": c.get("company", ""),
            "phone": c.get("phone", ""),
            "total_referred": r["total_referred"],
            "won": r["won"],
            "pending": r["pending"],
        })
    return result


@router.get("/leads/forecast")
async def leads_forecast(request: Request):
    """Weighted pipeline forecast over OPEN stages, RBAC-scoped, per-stage + per-rep."""
    user = await get_current_user(request)
    if not _crm_read(user):
        return {"total_value": 0, "total_weighted": 0, "by_stage": {}, "by_rep": {}}
    query = {} if sees_all(user, "leads") else {"$or": await _sales_lead_scope(user["email"])}
    query["stage"] = {"$in": OPEN_STAGES}
    leads = await db.leads.find(query, {"_id": 0}).to_list(10000)
    settings = await get_crm_settings()
    quote_map = await _build_quote_map(leads)

    by_stage = {s: {"count": 0, "value": 0.0, "weighted": 0.0} for s in OPEN_STAGES}
    by_rep = {}
    total_value = total_weighted = 0.0
    # An enquiry nobody has spoken to yet is not a forecast. `new` holds QR
    # scans, form fills and imported rows; counting their rupee value as
    # pipeline made the headline number grow every time a mailer went out.
    # They stay visible as a count, separately from money being forecast.
    qualified_value = qualified_weighted = 0.0
    unqualified_count = 0
    unqualified_value = 0.0
    for lead in leads:
        stage = lead.get("stage", "")
        if stage not in by_stage:
            continue
        value = resolve_lead_value(lead, quote_map)
        weighted = round(value * stage_probability(stage, settings) / 100, 2)
        if stage in UNQUALIFIED_STAGES:
            unqualified_count += 1
            unqualified_value += value
        else:
            qualified_value += value
            qualified_weighted += weighted
        by_stage[stage]["count"] += 1
        by_stage[stage]["value"] = round(by_stage[stage]["value"] + value, 2)
        by_stage[stage]["weighted"] = round(by_stage[stage]["weighted"] + weighted, 2)
        rep = lead.get("assigned_name") or lead.get("assigned_to") or "Unassigned"
        rr = by_rep.setdefault(rep, {"count": 0, "value": 0.0, "weighted": 0.0})
        rr["count"] += 1
        rr["value"] = round(rr["value"] + value, 2)
        rr["weighted"] = round(rr["weighted"] + weighted, 2)
        total_value += value
        total_weighted += weighted
    return {
        # total_* keep every open lead, for anyone who wants the all-in number.
        "total_value": round(total_value, 2),
        "total_weighted": round(total_weighted, 2),
        # qualified_* are the forecast: deals someone has actually engaged with.
        "qualified_value": round(qualified_value, 2),
        "qualified_weighted": round(qualified_weighted, 2),
        "unqualified_count": unqualified_count,
        "unqualified_value": round(unqualified_value, 2),
        "by_stage": by_stage,
        "by_rep": by_rep,
    }


@router.get("/leads/funnel")
async def leads_funnel(request: Request,
                       start: Optional[str] = None, end: Optional[str] = None,
                       rep: Optional[str] = None, source: Optional[str] = None):
    """Stage-to-stage conversion %, avg days/stage, win/loss + lost-reason breakdown."""
    user = await get_current_user(request)
    if not _crm_read(user):
        return {"stages": [], "won": {"count": 0, "value": 0}, "lost": {"count": 0}, "lost_reasons": {}}
    query = {} if sees_all(user, "leads") else {"$or": await _sales_lead_scope(user["email"])}
    if rep and sees_all(user, "leads"):
        query["assigned_to"] = rep
    if source:
        query["source"] = source
    if start or end:
        cq = {}
        if start:
            cq["$gte"] = start
        if end:
            cq["$lte"] = end + "T23:59:59"
        query["created_at"] = cq
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)

    reached = {s: 0 for s in FUNNEL_ORDER}
    for lead in leads:
        top = _max_stage_reached(lead)
        for s in FUNNEL_ORDER:
            if top >= FUNNEL_RANK[s]:
                reached[s] += 1

    stages = []
    prev = None
    for s in FUNNEL_ORDER:
        cnt = reached[s]
        adv = round(cnt / prev * 100, 1) if prev else 100.0
        stages.append({"stage": s, "count": cnt, "advanced_pct": adv,
                       "avg_days": _avg_days_in_stage(leads, s)})
        prev = cnt if cnt else prev

    quote_map = await _build_quote_map(leads)
    won = [l for l in leads if l.get("stage") == "won"]
    won_value = round(sum(resolve_lead_value(l, quote_map) for l in won), 2)
    lost = [l for l in leads if l.get("stage") == "lost"]
    lost_reasons = {}
    for l in lost:
        key = l.get("lost_reason") or "Unspecified"
        lost_reasons[key] = lost_reasons.get(key, 0) + 1

    return {
        "stages": stages,
        "won": {"count": len(won), "value": won_value},
        "lost": {"count": len(lost)},
        "lost_reasons": lost_reasons,
    }


@router.get("/leads/needs-attention")
async def leads_needs_attention(request: Request):
    """Open leads flagged overdue / stuck / no-next-action, RBAC-scoped, sorted by value."""
    user = await get_current_user(request)
    if not _crm_read(user):
        return []
    query = {"stage": {"$in": OPEN_STAGES}}
    if not sees_all(user, "leads"):
        query["$or"] = await _sales_lead_scope(user["email"])
    leads = await db.leads.find(query, {"_id": 0}).to_list(20000)
    lead_ids = [l["lead_id"] for l in leads]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    settings = await get_crm_settings()

    upcoming = set()
    async for fu in db.followups.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending",
         "followup_date": {"$gte": today}}, {"_id": 0, "lead_id": 1}):
        upcoming.add(fu["lead_id"])
    open_tasks = set()
    async for t in db.tasks.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending"}, {"_id": 0, "lead_id": 1}):
        open_tasks.add(t["lead_id"])

    quote_map = await _build_quote_map(leads)
    out = []
    for lead in leads:
        reasons = compute_attention(
            lead, now, settings,
            lead["lead_id"] in upcoming, lead["lead_id"] in open_tasks)
        if reasons:
            out.append({
                "lead_id": lead["lead_id"],
                "company_name": lead.get("company_name", ""),
                "contact_name": lead.get("contact_name", ""),
                "stage": lead.get("stage", ""),
                "assigned_to": lead.get("assigned_to", ""),
                "assigned_name": lead.get("assigned_name", ""),
                "deal_value": resolve_lead_value(lead, quote_map),
                "reasons": reasons,
            })
    out.sort(key=lambda x: x["deal_value"], reverse=True)
    return out


@router.post("/leads/{lead_id}/schedule-demo")
async def schedule_demo(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fmt = body.get("format")
    if fmt not in ("physical", "online"):
        raise HTTPException(status_code=400, detail="format must be 'physical' or 'online'")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    demo_date = body.get("demo_date", "")
    demo_time = body.get("demo_time", "")
    update = {
        "stage": "demo", "demo_format": fmt,
        "demo_date": demo_date, "demo_time": demo_time,
        "updated_at": now_iso, "last_activity_date": now_iso,
    }

    if fmt == "physical":
        plan_id = f"vp_{uuid.uuid4().hex[:12]}"
        await db.visit_plans.insert_one({
            "plan_id": plan_id, "lead_id": lead_id,
            "lead_name": lead.get("contact_name", ""),
            "school_name": lead.get("company_name", ""),
            "school_id": lead.get("school_id", ""),
            "contact_person": lead.get("contact_name", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "assigned_to": body.get("assigned_to") or lead.get("assigned_to", ""),
            "assigned_name": lead.get("assigned_name", ""),
            "visit_date": demo_date, "visit_time": demo_time,
            "purpose": body.get("purpose") or "Demo / Workshop",
            "planned_address": body.get("address", ""),
            "status": "planned",
            "created_by": user["email"], "created_at": now_iso,
        })
        update["demo_visit_plan_id"] = plan_id
        await log_activity(user["email"], "schedule_demo_physical", "lead", lead_id,
                           details=f"Physical workshop {demo_date} {demo_time}")
    else:  # online
        link = body.get("demo_link", "")
        update["demo_link"] = link
        contact_name = lead.get("contact_name", "Sir/Madam")
        msg = (f"Dear {contact_name}, your SmartShape online workshop is scheduled for "
               f"{demo_date} {demo_time}.\nJoin here: {link}")
        sent = await _send_demo_wa(lead.get("contact_phone", ""), msg)
        await log_activity(user["email"], "schedule_demo_online", "lead", lead_id,
                           details=f"Online workshop {demo_date} {demo_time} | WA sent={sent}")

    if lead.get("stage") != "demo":
        hist = lead.get("pipeline_history", []) or []
        hist.append({"from_stage": lead.get("stage"), "to_stage": "demo",
                     "by_email": user["email"], "by_name": user["name"],
                     "at": now_iso, "note": f"Demo scheduled ({fmt})"})
        update["pipeline_history"] = hist

    await db.leads.update_one({"lead_id": lead_id}, {"$set": update})
    if lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/leads/reassign")
async def reassign_lead(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    lead_id = body.get("lead_id")
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "").strip()
    if not lead_id or not new_agent_email or not reason:
        raise HTTPException(status_code=400, detail="lead_id, new_agent_email and reason are required")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reassign leads")
    # Resolve a typed/picked NAME or EMAIL to the real user; never store a raw name.
    _r_email, _r_name = await resolve_owner(db, new_agent_email)
    if _r_email:
        new_agent_email = _r_email
        new_agent_name = _r_name or new_agent_name or _r_email
    elif "@" not in (new_agent_email or ""):
        raise HTTPException(status_code=400, detail="Could not resolve assignee to a user")
    now_iso = datetime.now(timezone.utc).isoformat()
    history = lead.get("reassignments", []) or []
    history.append({
        "from_email": lead.get("assigned_to", ""),
        "from_name": lead.get("assigned_name", ""),
        "to_email": new_agent_email,
        "to_name": new_agent_name,
        "by_email": user["email"],
        "by_name": user["name"],
        "reason": reason,
        "at": now_iso,
    })
    reassign_count = (lead.get("reassignment_count", 0) or 0) + 1
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {
        "assigned_to": new_agent_email,
        "assigned_name": new_agent_name,
        "assigned_date": now_iso,
        "assignment_type": "manual",
        "reassignments": history,
        "reassignment_count": reassign_count,
        "last_reassigned_at": now_iso,
        "last_reassigned_by": user["email"],
        "last_reassignment_reason": reason,
        "updated_at": now_iso,
        "last_activity_date": now_iso,
    }})
    await log_activity(user["email"], "reassign_lead", "lead", lead_id,
                       details=f"-> {new_agent_name} | {reason}")
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.post("/leads/bulk-assign")
async def bulk_assign_leads(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reassign leads")
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    new_agent_email = body.get("new_agent_email")
    new_agent_name = body.get("new_agent_name", "")
    reason = (body.get("reason") or "Bulk assignment").strip()
    if not lead_ids or not new_agent_email:
        raise HTTPException(status_code=400, detail="lead_ids and new_agent_email required")
    # Resolve a typed/picked NAME or EMAIL to the real user; never store a raw name.
    _r_email, _r_name = await resolve_owner(db, new_agent_email)
    if _r_email:
        new_agent_email = _r_email
        new_agent_name = _r_name or new_agent_name or _r_email
    elif "@" not in (new_agent_email or ""):
        raise HTTPException(status_code=400, detail="Could not resolve assignee to a user")
    now_iso = datetime.now(timezone.utc).isoformat()
    leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    count = 0
    for lead in leads:
        history = lead.get("reassignments", []) or []
        history.append({
            "from_email": lead.get("assigned_to", ""),
            "from_name": lead.get("assigned_name", ""),
            "to_email": new_agent_email,
            "to_name": new_agent_name,
            "by_email": user["email"],
            "by_name": user["name"],
            "reason": reason,
            "at": now_iso,
        })
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": new_agent_email,
            "assigned_name": new_agent_name,
            "assigned_date": now_iso,
            "assignment_type": "bulk",
            "reassignments": history,
            "reassignment_count": (lead.get("reassignment_count", 0) or 0) + 1,
            "last_reassigned_at": now_iso,
            "last_reassigned_by": user["email"],
            "last_reassignment_reason": reason,
            "updated_at": now_iso,
            "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "bulk_assign_lead", "lead", lead["lead_id"],
                           details=f"-> {new_agent_name} | {reason}")
        count += 1
    return {"assigned": count}


@router.post("/leads/bulk-tag")
async def bulk_tag_leads(request: Request):
    """Add or remove a tag from multiple leads at once."""
    user = await get_current_user(request)
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    tag_id = body.get("tag_id", "").strip()
    action = body.get("action", "add")  # "add" or "remove"
    if not lead_ids or not tag_id:
        raise HTTPException(400, "lead_ids and tag_id are required")
    if not await db.tags.find_one({"tag_id": tag_id}):
        raise HTTPException(404, "Tag not found")
    op = {"$addToSet": {"tags": tag_id}} if action == "add" else {"$pull": {"tags": tag_id}}
    result = await db.leads.update_many({"lead_id": {"$in": lead_ids}}, op)
    await log_activity(user["email"], f"bulk_tag_{action}", "lead", ",".join(lead_ids[:5]),
                       details=f"tag_id={tag_id} action={action} count={result.modified_count}")
    return {"modified": result.modified_count}


@router.post("/leads/bulk-stage")
async def bulk_stage_leads(request: Request):
    """Move multiple leads to a new pipeline stage."""
    user = await get_current_user(request)
    body = await request.json()
    lead_ids = body.get("lead_ids") or []
    stage = body.get("stage", "").strip()
    if not lead_ids or not stage:
        raise HTTPException(400, "lead_ids and stage are required")
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    for lead_id in lead_ids:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "stage": 1})
        if not lead:
            continue
        history_entry = {
            "from_stage": lead.get("stage"),
            "to_stage": stage,
            "by_email": user["email"],
            "by_name": user.get("name", user["email"]),
            "at": now_iso,
        }
        await db.leads.update_one(
            {"lead_id": lead_id},
            {
                "$set": {"stage": stage, "updated_at": now_iso, "last_activity_date": now_iso},
                "$push": {"pipeline_history": history_entry},
            },
        )
        count += 1
    await log_activity(user["email"], "bulk_stage_change", "lead", ",".join(lead_ids[:5]),
                       details=f"-> {stage} | count={count}")
    return {"modified": count}


@router.post("/leads/auto-assign")
async def auto_assign_leads(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    lead_ids = body.get("lead_ids") or None
    sps = await db.salespersons.find({"is_active": {"$ne": False}}, {"_id": 0}).sort("name", 1).to_list(1000)
    if not sps:
        raise HTTPException(status_code=400, detail="No active sales persons available")
    if lead_ids:
        leads = await db.leads.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(10000)
    else:
        leads = await db.leads.find({"$or": [{"assigned_to": ""}, {"assigned_to": None}]}, {"_id": 0}).to_list(10000)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = []
    for i, lead in enumerate(leads):
        sp = sps[i % len(sps)]
        await db.leads.update_one({"lead_id": lead["lead_id"]}, {"$set": {
            "assigned_to": sp["email"],
            "assigned_name": sp["name"],
            "assignment_type": "round_robin",
            "updated_at": now_iso,
            "last_activity_date": now_iso,
        }})
        await log_activity(user["email"], "auto_assign_lead", "lead", lead["lead_id"],
                           details=f"Round-robin to {sp['name']}")
        updates.append({"lead_id": lead["lead_id"], "assigned_to": sp["email"], "assigned_name": sp["name"]})
    return {"assigned": len(updates), "details": updates}


@router.post("/leads/import")
async def import_leads_csv(file: UploadFile = File(...), request: Request = None):
    if request:
        await get_current_user(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))

    created = 0
    linked = 0
    duplicates = 0
    errors = []

    for row in reader:
        try:
            school_name = row.get("school_name", "").strip()
            phone = row.get("phone", "").strip()
            website = row.get("website", "").strip()
            contact_name = row.get("contact_name", "").strip()

            if not school_name:
                errors.append("Row missing school_name")
                continue

            school = None
            if phone:
                school = await db.schools.find_one({"$or": [
                    {"school_name": school_name, "phone": phone},
                    {"phone": phone},
                ]}, {"_id": 0})
            if not school and website:
                school = await db.schools.find_one({"website": website}, {"_id": 0})
            if not school:
                school = await db.schools.find_one({"school_name": school_name}, {"_id": 0})

            school_id = None
            if school:
                school_id = school["school_id"]
                linked += 1
            else:
                school_id = f"sch_{uuid.uuid4().hex[:12]}"
                await db.schools.insert_one({
                    "school_id": school_id,
                    "school_name": school_name,
                    "school_type": row.get("school_type", "CBSE").strip(),
                    "website": website,
                    "email": row.get("email", "").strip(),
                    "phone": phone,
                    "city": row.get("location", row.get("city", "")).strip(),
                    "state": row.get("state", "").strip(),
                    "pincode": row.get("pincode", "").strip(),
                    "primary_contact_name": contact_name,
                    "designation": row.get("designation", "").strip(),
                    "school_strength": int(row.get("school_strength", 0) or 0),
                    "number_of_branches": 1,
                    "created_by": "import",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

            existing_lead = await db.leads.find_one({
                "school_id": school_id,
                "contact_phone": phone,
            }, {"_id": 0})
            if existing_lead:
                duplicates += 1
                continue

            lead_id = f"lead_{uuid.uuid4().hex[:12]}"
            await db.leads.insert_one({
                "lead_id": lead_id,
                "school_id": school_id,
                "company_name": school_name,
                "contact_name": contact_name,
                "designation": row.get("designation", "").strip(),
                "contact_phone": phone,
                "contact_email": row.get("email", "").strip(),
                "source": row.get("source", "import").strip(),
                "lead_type": "warm",
                "stage": "new",
                "priority": "medium",
                "interested_product": "",
                "next_followup_date": "",
                "assigned_to": "",
                "assigned_name": "",
                "notes": "",
                "created_by": "import",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            created += 1
        except Exception as e:
            errors.append(str(e))

    return {"created": created, "linked": linked, "duplicates": duplicates, "errors": errors[:10]}


@router.post("/leads/{lead_id}/lock")
async def lock_lead(lead_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json() if (await request.body()) else {}
    is_locked = bool(body.get("is_locked", True))
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"is_locked": is_locked}})
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})


@router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, request: Request, reason: str = ""):
    user = await get_current_user(request)
    lead = await db.leads.find_one(
        {"lead_id": lead_id},
        {"_id": 0, "converted_from_contact": 1, "order_id": 1, "assigned_to": 1,
         "school_id": 1, "company_name": 1, "contact_name": 1},
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not await _user_can_mutate_lead(user, lead):
        raise HTTPException(status_code=403, detail="Not authorized to delete this lead")

    # Block deletion if a live order exists for this lead
    if lead.get("order_id"):
        order = await db.orders.find_one({"order_id": lead["order_id"]}, {"_id": 0, "order_id": 1})
        if order:
            raise HTTPException(status_code=409, detail="Cannot delete lead: an order exists. Cancel or delete the order first.")

    # Snapshot the lead + all child CRM records into audit_backups, THEN hard-delete
    # — so a deleted lead's call history / follow-ups are recoverable, the same
    # safety the order & school cascades already have.
    plan = [
        ("leads", {"lead_id": lead_id}),
        ("followups", {"lead_id": lead_id}),
        ("call_notes", {"lead_id": lead_id}),
        ("tasks", {"lead_id": lead_id}),
        ("physical_dispatches", {"lead_id": lead_id}),
        ("drip_enrollments", {"lead_id": lead_id}),
    ]
    label = lead.get("company_name") or lead.get("contact_name") or lead_id
    await snapshot_and_delete(plan, root_type="lead", root_id=lead_id,
                              root_label=label, deleted_by=user["email"], reason=reason)

    # whatsapp_logs are kept (they belong to the school/contact) — just detach the
    # now-gone lead so they aren't orphaned to a dead id.
    await db.whatsapp_logs.update_many({"lead_id": lead_id}, {"$unset": {"lead_id": ""}})

    # Restore converted contact back to active if this lead was the conversion target
    if lead.get("converted_from_contact"):
        await db.contacts.update_one(
            {"contact_id": lead["converted_from_contact"]},
            {"$set": {"converted_to_lead": False, "lead_id": None,
                      "last_activity_date": datetime.now(timezone.utc).isoformat()}}
        )

    return {"message": "Lead and all related records deleted"}


@router.get("/leads/{lead_id}/notes")
async def get_lead_notes(lead_id: str, request: Request):
    await get_current_user(request)
    notes = await db.call_notes.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return notes


@router.post("/leads/{lead_id}/notes")
async def add_call_note(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    note_id = f"note_{uuid.uuid4().hex[:12]}"
    note_doc = {
        "note_id": note_id,
        "lead_id": lead_id,
        "type": body.get("type", "call"),
        "content": body.get("content", ""),
        "outcome": body.get("outcome", ""),
        "created_by": user["email"],
        "created_by_name": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.call_notes.insert_one(note_doc)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.leads.update_one({"lead_id": lead_id}, {"$set": {"updated_at": now_iso, "last_activity_date": now_iso}})
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "school_id": 1})
    if lead and lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.call_notes.find_one({"note_id": note_id}, {"_id": 0})


# ==================== FOLLOW-UPS ====================

@router.get("/followups")
async def get_followups(request: Request, lead_id: Optional[str] = None,
                        contact_id: Optional[str] = None):
    user = await get_current_user(request)
    team = get_team(user)
    query = {}
    if contact_id:
        contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
        if not contact:
            raise HTTPException(404, "Contact not found")
        if not await _user_can_mutate_contact(user, contact):
            raise HTTPException(status_code=403, detail="Not authorized for this contact")
        query["contact_id"] = contact_id
    elif lead_id:
        query["lead_id"] = lead_id
    elif team == "admin":
        pass  # no filter — see all
    else:
        query["assigned_to"] = user["email"]
    followups = await db.followups.find(query, {"_id": 0}).sort("followup_date", -1).to_list(5000)
    return followups


@router.post("/followups")
async def create_followup(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fid = f"fu_{uuid.uuid4().hex[:12]}"
    fu_doc = {
        "followup_id": fid,
        "lead_id": body.get("lead_id"),
        "followup_date": body.get("followup_date", ""),
        "followup_time": body.get("followup_time", ""),
        "followup_type": body.get("followup_type", "call"),
        "notes": body.get("notes", ""),
        "outcome": body.get("outcome", ""),
        "status": body.get("status", "pending"),
        "assigned_to": body.get("assigned_to", user["email"]),
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.followups.insert_one(fu_doc)
    if fu_doc.get("lead_id"):
        await touch_last_activity("lead", fu_doc["lead_id"])
        lead = await db.leads.find_one({"lead_id": fu_doc["lead_id"]}, {"_id": 0, "school_id": 1})
        if lead and lead.get("school_id"):
            await touch_last_activity("school", lead["school_id"])
    return await db.followups.find_one({"followup_id": fid}, {"_id": 0})


@router.put("/followups/{followup_id}")
async def update_followup(followup_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("followup_date", "followup_time", "followup_type", "notes", "outcome", "status") if k in body}
    await db.followups.update_one({"followup_id": followup_id}, {"$set": allowed})
    return await db.followups.find_one({"followup_id": followup_id}, {"_id": 0})


# ==================== CONTACT CALLS & FOLLOW-UPS ====================

async def _get_contact_or_404(contact_id: str) -> dict:
    contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    if not contact:
        raise HTTPException(404, "Contact not found")
    return contact


async def _parse_json_body(request: Request) -> dict:
    """Empty body -> {}; non-empty unparseable body -> 400 (never a bare 500)."""
    raw_body = await request.body()
    if not raw_body:
        return {}
    try:
        return await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")


@router.post("/contacts/{contact_id}/calls")
async def log_contact_call(contact_id: str, request: Request):
    """Record a call against a contact and denormalise the outcome onto it."""
    user = await get_current_user(request)
    contact = await _get_contact_or_404(contact_id)
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized for this contact")
    body = await _parse_json_body(request)
    outcome = (body.get("outcome") or "").strip()
    if not cc.is_valid_outcome(outcome):
        raise HTTPException(422, f"outcome must be one of {list(cc.CALL_OUTCOMES)}")

    now_iso = datetime.now(timezone.utc).isoformat()
    note = cc.build_call_note(contact, user, outcome, body.get("content", ""), now_iso)
    deal_type = (body.get("deal_type") or "").strip()
    if deal_type:
        note["deal_type"] = deal_type
    await db.call_notes.insert_one(dict(note))

    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "last_call_outcome": outcome, "last_call_at": now_iso}})
    await touch_last_activity("contact", contact_id)
    if contact.get("school_id"):
        await touch_last_activity("school", contact["school_id"])
    if contact.get("lead_id"):
        # Link the deal to the lead when the rep sets it on the call.
        if deal_type:
            await db.leads.update_one({"lead_id": contact["lead_id"]}, {"$set": {"deal_type": deal_type}})
        await touch_last_activity("lead", contact["lead_id"])

    return await db.call_notes.find_one({"note_id": note["note_id"]}, {"_id": 0})


@router.post("/contacts/{contact_id}/followups")
async def add_contact_followup(contact_id: str, request: Request):
    """Schedule a follow-up on a contact AND generate the reminder task."""
    user = await get_current_user(request)
    contact = await _get_contact_or_404(contact_id)
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized for this contact")
    body = await _parse_json_body(request)
    date = (body.get("followup_date") or "").strip()
    if not date:
        raise HTTPException(422, "followup_date is required")

    now_iso = datetime.now(timezone.utc).isoformat()
    fu = cc.build_followup(contact, user, date, body.get("followup_time", ""),
                           body.get("followup_type", "call"), body.get("notes", ""), now_iso)
    task = cc.build_task_for_followup(contact, user, fu, now_iso)

    # Both writes must land: the follow-up is useless without its reminder.
    # NOTE: this is a best-effort compensating delete, NOT a transaction — true
    # multi-document atomicity would require a replica-set session, which this
    # deployment does not use.
    await db.followups.insert_one(dict(fu))
    try:
        await db.tasks.insert_one(dict(task))
    except Exception:
        try:
            await db.followups.delete_one({"followup_id": fu["followup_id"]})
        except Exception:
            pass
        raise HTTPException(500, "Could not create the reminder task; follow-up not saved")

    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "next_followup_date": fu["followup_date"], "next_followup_time": fu["followup_time"]}})
    await touch_last_activity("contact", contact_id)

    return {
        "followup": await db.followups.find_one({"followup_id": fu["followup_id"]}, {"_id": 0}),
        "task": await db.tasks.find_one({"task_id": task["task_id"]}, {"_id": 0}),
    }


@router.patch("/contacts/{contact_id}/followups/{followup_id}/complete")
async def complete_contact_followup(contact_id: str, followup_id: str, request: Request):
    """Close a follow-up, close its task, and recompute the contact's next step."""
    user = await get_current_user(request)
    contact = await _get_contact_or_404(contact_id)
    if not await _user_can_mutate_contact(user, contact):
        raise HTTPException(status_code=403, detail="Not authorized for this contact")
    body = await _parse_json_body(request)
    now_iso = datetime.now(timezone.utc).isoformat()

    res = await db.followups.update_one(
        {"followup_id": followup_id, "contact_id": contact_id},
        {"$set": {"status": "completed", "outcome": body.get("outcome", ""),
                  "completed_at": now_iso, "completed_by": user["email"]}})
    if res.matched_count == 0:
        raise HTTPException(404, "Follow-up not found for this contact")

    await db.tasks.update_many({"followup_id": followup_id},
                               {"$set": {"status": "done", "outcome": body.get("outcome", "")}})

    # Next pending follow-up (if any) becomes the contact's next step.
    nxt = await db.followups.find(
        {"contact_id": contact_id, "status": "pending"}, {"_id": 0}
    ).sort("followup_date", 1).to_list(1)
    await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
        "next_followup_date": nxt[0]["followup_date"] if nxt else "",
        "next_followup_time": nxt[0].get("followup_time", "") if nxt else ""}})
    await touch_last_activity("contact", contact_id)
    return {"ok": True}


# ==================== PHYSICAL DISPATCHES ====================

@router.get("/physical-dispatches")
async def get_physical_dispatches(request: Request, lead_id: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if lead_id:
        query["lead_id"] = lead_id
    elif get_team(user) != "admin":
        query["created_by"] = user["email"]
    dispatches = await db.physical_dispatches.find(query, {"_id": 0}).sort("sent_date", -1).to_list(2000)
    return dispatches


@router.post("/physical-dispatches")
async def create_physical_dispatch(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    if not body.get("lead_id"):
        raise HTTPException(status_code=400, detail="lead_id is required")
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "dispatch_id": dispatch_id,
        "lead_id": body.get("lead_id", ""),
        "lead_name": body.get("lead_name", ""),
        "material_type": body.get("material_type", "brochure"),
        "description": body.get("description", ""),
        "courier_name": body.get("courier_name", ""),
        "tracking_number": body.get("tracking_number", ""),
        "sent_date": body.get("sent_date", now_iso[:10]),
        "received_confirmed": False,
        "dispatched_without_payment": bool(body.get("dispatched_without_payment", False)),
        "payment_pending_reason": body.get("payment_pending_reason", ""),
        "created_by": user["email"],
        "created_at": now_iso,
    }
    await db.physical_dispatches.insert_one(doc)
    await touch_last_activity("lead", body["lead_id"])

    # Auto-link to delegation: create a dispatch-follow-up task for the assigned rep
    try:
        lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})
        if lead_doc and lead_doc.get("assigned_to"):
            del_emp = await db.del_employees.find_one(
                {"email": lead_doc["assigned_to"], "is_active": True}, {"_id": 0}
            )
            if del_emp:
                _tid = f"task_{uuid.uuid4().hex[:10]}"
                _num = f"DISP-{dispatch_id[-6:].upper()}"
                _iid = f"inst_{uuid.uuid4().hex[:10]}"
                _now = datetime.now(timezone.utc).isoformat()
                _due = doc.get("sent_date", _now[:10])
                await db.del_tasks.insert_one({
                    "task_id": _tid, "task_number": _num,
                    "title": f"Dispatch: {doc['material_type'].title()} → {lead_doc.get('company_name', lead_doc.get('contact_name',''))}",
                    "description": f"Courier: {doc.get('courier_name','')} · {doc.get('tracking_number','')}",
                    "task_type": "onetime", "frequency": "onetime", "target_date": _due,
                    "priority": "medium", "assignee_ids": [del_emp["emp_id"]],
                    "assignees": [del_emp], "delegator_id": None, "delegator_name": "",
                    "score": 0, "require_verification": False, "requires_image": False,
                    "linked_entity_id": dispatch_id, "linked_entity_type": "dispatch",
                    "status": "active", "is_active": True, "created_at": _now,
                })
                await db.del_task_instances.insert_one({
                    "instance_id": _iid, "task_id": _tid, "task_title": f"Dispatch: {doc['material_type'].title()}",
                    "task_number": _num, "emp_id": del_emp["emp_id"], "emp_name": del_emp["name"],
                    "department_id": del_emp.get("department_id",""), "department_name": del_emp.get("department_name",""),
                    "delegator_id": None, "delegator_name": "", "due_date": _due, "frequency": "onetime",
                    "priority": "medium", "score": 0, "require_verification": False, "requires_image": False,
                    "linked_entity_id": dispatch_id, "linked_entity_type": "dispatch",
                    "status": "pending", "completed_at": None, "verified_at": None, "verified_by": None,
                    "completion_note": "", "completion_image_url": None, "created_at": _now,
                })
    except Exception:
        pass  # never block dispatch creation

    # Auto-WhatsApp: fire-and-forget tracking notification to the lead contact
    try:
        lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})
        if lead_doc and lead_doc.get("contact_phone"):
            courier_key = doc.get("courier_name", "").lower().strip()
            tn = doc.get("tracking_number", "")
            _COURIER_URLS = {
                "delhivery": f"https://www.delhivery.com/track/package/{tn}",
                "blue dart": f"https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
                "bluedart": f"https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
                "dtdc": f"https://tracking.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCustInter&cType=Consignment&cnNo={tn}",
            }
            tracking_url = _COURIER_URLS.get(courier_key, "")
            track_part = f"\nTrack here: {tracking_url}" if tracking_url else ""
            contact_name = lead_doc.get("contact_name", "Sir/Madam")
            courier_name = doc.get("courier_name", "courier")
            message = (
                f"Dear {contact_name}, your {doc.get('material_type', 'material')} from SmartShape "
                f"has been dispatched!\nCourier: {courier_name}"
                f"{(' | Tracking: ' + tn) if tn else ''}"
                f"{track_part}"
            )
            wa_settings = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
            if wa_settings and wa_settings.get("username"):
                import httpx as _httpx
                async with _httpx.AsyncClient(timeout=15) as client:
                    await client.post(
                        "https://app.messageautosender.com/message/new",
                        data={
                            "username": wa_settings["username"],
                            "password": wa_settings["password"],
                            "receiverMobileNo": lead_doc["contact_phone"],
                            "message": message,
                        },
                    )
                await db.whatsapp_logs.insert_one({
                    "log_id": f"wal_{uuid.uuid4().hex[:10]}",
                    "template_id": None,
                    "phone": lead_doc["contact_phone"],
                    "body": message,
                    "lead_id": body["lead_id"],
                    "send_mode": "auto_dispatch",
                    "status": "sent",
                    "sent_by": "system",
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                })
    except Exception:
        pass  # Dispatch is already saved — WA failure is non-blocking

    return await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})


@router.put("/physical-dispatches/{dispatch_id}")
async def update_physical_dispatch(dispatch_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("courier_name", "tracking_number", "sent_date", "received_confirmed", "description", "material_type", "dispatched_without_payment", "payment_pending_reason") if k in body}
    await db.physical_dispatches.update_one({"dispatch_id": dispatch_id}, {"$set": allowed})
    return await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})


@router.delete("/physical-dispatches/{dispatch_id}")
async def delete_physical_dispatch(dispatch_id: str, request: Request):
    await get_current_user(request)
    result = await db.physical_dispatches.delete_one({"dispatch_id": dispatch_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    return {"message": "Deleted"}


# ==================== TASKS ====================

@router.get("/tasks")
async def get_tasks(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "admin":
        query = {}
    else:
        query = {"$or": [{"assigned_to": user["email"]}, {"created_by": user["email"]}]}
    tasks = await db.tasks.find(query, {"_id": 0}).sort("due_date", 1).to_list(5000)
    return tasks


@router.post("/tasks")
async def create_task(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    task_doc = {
        "task_id": task_id,
        "title": body.get("title", ""),
        "description": body.get("description", ""),
        "type": body.get("type", "follow_up"),
        "lead_id": body.get("lead_id"),
        "lead_name": body.get("lead_name", ""),
        "assigned_to": body.get("assigned_to", user["email"]),
        "assigned_name": body.get("assigned_name", user["name"]),
        "due_date": body.get("due_date", ""),
        "due_time": body.get("due_time", ""),
        "priority": body.get("priority", "medium"),
        "status": "pending",
        "outcome": "",
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tasks.insert_one(task_doc)
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("title", "description", "type", "assigned_to", "assigned_name",
              "due_date", "due_time", "priority", "status", "outcome") if k in body}
    await db.tasks.update_one({"task_id": task_id}, {"$set": allowed})
    return await db.tasks.find_one({"task_id": task_id}, {"_id": 0})


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    await get_current_user(request)
    await db.tasks.delete_one({"task_id": task_id})
    return {"message": "Task deleted"}


# ── Google Maps URL resolver ──────────────────────────────────────────────────
@router.get("/resolve-maps-url")
async def resolve_maps_url(url: str, request: Request):
    """Follow redirects on Google Share / short URLs and extract coordinates."""
    await get_current_user(request)
    try:
        resp = http_requests.get(
            url,
            allow_redirects=True,
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SmartShapePro/1.0)"},
        )
        final_url = resp.url

        # Try all known coordinate patterns in the final URL
        patterns = [
            r'@(-?\d+\.\d+),(-?\d+\.\d+)',
            r'[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)',
            r'/place/[^/]+/@(-?\d+\.\d+),(-?\d+\.\d+)',
            r'[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)',
        ]
        for pat in patterns:
            m = re.search(pat, final_url)
            if m:
                return {"lat": float(m.group(1)), "lng": float(m.group(2)), "final_url": final_url}

        return {"lat": None, "lng": None, "final_url": final_url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve URL: {e}")
