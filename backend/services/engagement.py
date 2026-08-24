"""Engagement ledger — the spine of the unified plan-send-track engine (Phase 0).

Two responsibilities:

1. ``normalize_timeline`` — a PURE function that folds every already-fetched
   engagement stream (calls, visits, meetings, quotes, orders, dispatches,
   marketing communications, planned activities, and first-class engagement
   events) into ONE chronological, channel-tagged timeline. It touches no
   database, so it is cheap to call inside the school-360 (the streams are
   already in memory there) and trivially unit-testable.

2. ``log_engagement_event`` / ``fetch_events`` — a thin write-through layer over
   ``db.engagement_events`` so future first-class touches (a brochure share, a
   webinar RSVP, a tracked email open) record into a single collection that the
   same timeline reads back. Historical rows are NOT required for the timeline
   to be complete today — the normaliser already surfaces the source
   collections — the ledger is the forward-looking spine later phases write to.

The frontend owns all colour/icon choice; this module stays presentation-free
and only emits a stable ``channel`` + short ``kind`` per event.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional
import uuid

from database import db

# Canonical channels. Kept as plain strings (not an enum) so Mongo docs and JSON
# stay simple and forward-compatible with channels added in later phases.
CHANNELS = (
    "call", "visit", "meeting", "quote", "order", "mail",
    "whatsapp", "email", "drip", "greeting", "activity", "note", "event",
)

# Marketing "communications" rows already carry their own channel string; anything
# unrecognised collapses to this so the timeline never silently drops a row.
_COMM_CHANNELS = {"whatsapp", "email", "drip", "greeting", "sms"}


def _iso(v: Any) -> str:
    """Coerce a date-ish value to a comparable ISO string ('' if unknown)."""
    if not v:
        return ""
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _money_short(amount: Any, symbol: str = "₹") -> str:
    """Compact Indian-style money label for a timeline detail line.

    Returns '' for an absent amount (None/'') but '₹0' for a genuine zero."""
    if amount is None or amount == "":
        return ""
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return ""
    if n >= 100000:
        return f"{symbol}{n / 100000:.1f}L"
    if n >= 1000:
        return f"{symbol}{n / 1000:.0f}K"
    return f"{symbol}{n:.0f}"


def _ev(channel: str, ref: str, kind: str, title: str, at: Any, *,
        detail: str = "", status: str = "", direction: str = "out",
        amount: Optional[float] = None, by: str = "") -> dict:
    return {
        "id": f"{channel}:{ref}" if ref else f"{channel}:{uuid.uuid4().hex[:8]}",
        "channel": channel,
        "kind": kind,
        "title": (title or "").strip(),
        "detail": (detail or "").strip(),
        "status": (status or "").strip(),
        "direction": direction,
        "amount": amount,
        "by": (by or "").strip(),
        "at": _iso(at),
    }


def normalize_timeline(
    *,
    call_notes: Iterable[dict] = (),
    visits: Iterable[dict] = (),
    meetings: Iterable[dict] = (),
    quotations: Iterable[dict] = (),
    orders: Iterable[dict] = (),
    dispatches: Iterable[dict] = (),
    communications: Iterable[dict] = (),
    activities: Iterable[dict] = (),
    events: Iterable[dict] = (),
    limit: int = 300,
) -> list[dict]:
    """Fold every stream into one sorted (newest-first) timeline.

    Every argument is optional so callers pass only what they have. Each row is
    read defensively with ``.get`` — real production docs vary in shape across
    the two visit systems, legacy call notes, etc.
    """
    out: list[dict] = []

    for n in call_notes or ():
        who = n.get("created_by_name") or n.get("created_by") or "Team"
        out.append(_ev(
            "call", n.get("call_id") or n.get("_ref") or n.get("created_at") or "",
            "Call logged", f"Call · {who}", n.get("created_at"),
            detail=n.get("content") or n.get("outcome") or "",
            status=n.get("outcome") or "", direction="out", by=who,
        ))

    for v in visits or ():
        who = v.get("rep_name") or v.get("executive_name") or v.get("sales_person_name") or "Sales Rep"
        out.append(_ev(
            "visit", v.get("visit_id") or v.get("plan_id") or v.get("visit_date") or "",
            "School visit", f"Visit · {who}", v.get("visit_date"),
            detail=v.get("purpose") or v.get("notes") or v.get("outcome") or "",
            status=v.get("status") or "", direction="out", by=who,
        ))

    for m in meetings or ():
        who = m.get("assigned_name") or m.get("assigned_to") or "Team"
        out.append(_ev(
            "meeting", m.get("followup_id") or m.get("followup_date") or "",
            "Meeting", f"Meeting · {who}", m.get("followup_date"),
            detail=m.get("notes") or m.get("purpose") or "",
            status=m.get("status") or "", direction="out", by=who,
        ))

    for q in quotations or ():
        sym = q.get("currency_symbol") or "₹"
        num = q.get("quotation_number") or q.get("quotation_id") or ""
        out.append(_ev(
            "quote", q.get("quotation_id") or num or "",
            "Quotation", f"Quotation {num}".strip(), q.get("created_at"),
            detail=_money_short(q.get("grand_total"), sym),
            status=q.get("status") or "", direction="out",
            amount=q.get("grand_total"),
        ))

    for o in orders or ():
        sym = o.get("currency_symbol") or "₹"
        num = o.get("order_number") or o.get("order_id") or ""
        out.append(_ev(
            "order", o.get("order_id") or num or "",
            "Sales order", f"Sales Order {num}".strip(), o.get("created_at"),
            detail=_money_short(o.get("grand_total"), sym),
            status=o.get("order_status") or o.get("status") or "", direction="out",
            amount=o.get("grand_total"),
        ))

    for d in dispatches or ():
        courier = d.get("courier_name") or ""
        track = d.get("tracking_number") or ""
        detail = (f"Via {courier}" + (f" · {track}" if track else "")) if courier else ""
        out.append(_ev(
            "mail", d.get("dispatch_id") or d.get("sent_date") or d.get("created_at") or "",
            "Physical dispatch", f"{d.get('material_type') or 'Material'} sent",
            d.get("sent_date") or d.get("created_at"),
            detail=detail, status=d.get("status") or "sent", direction="out",
        ))

    for c in communications or ():
        ch = (c.get("channel") or "").strip().lower()
        if ch not in _COMM_CHANNELS:
            ch = "email" if "mail" in ch else "note"
        kind = {
            "whatsapp": "WhatsApp", "email": "Email", "drip": "Drip step",
            "greeting": "Greeting", "sms": "SMS",
        }.get(ch, "Message")
        out.append(_ev(
            ch, c.get("id") or c.get("at") or "", kind,
            c.get("label") or kind, c.get("at"),
            detail=c.get("detail") or "", status=c.get("status") or "", direction="out",
        ))

    for a in activities or ():
        who = a.get("assigned_name") or a.get("assigned_to") or ""
        title = a.get("title") or a.get("activity_type") or "Planned activity"
        out.append(_ev(
            "activity", a.get("activity_id") or a.get("created_at") or "",
            "Planned activity", title,
            a.get("scheduled_date") or a.get("due_date") or a.get("created_at"),
            detail=a.get("notes") or "", status=a.get("status") or "planned",
            direction="internal", by=who,
        ))

    # First-class ledger events (already normalised at write time).
    for e in events or ():
        out.append(_ev(
            e.get("channel") or "event", e.get("event_id") or e.get("_ref") or "",
            e.get("kind") or "Touch", e.get("title") or "", e.get("at"),
            detail=e.get("detail") or "", status=e.get("status") or "",
            direction=e.get("direction") or "out", amount=e.get("amount"),
            by=e.get("by") or "",
        ))

    out.sort(key=lambda x: x.get("at") or "", reverse=True)
    return out[: max(1, limit)]


async def log_engagement_event(
    *,
    channel: str,
    kind: str,
    title: str,
    school_id: str = "",
    lead_id: str = "",
    contact_id: str = "",
    detail: str = "",
    status: str = "",
    direction: str = "out",
    amount: Optional[float] = None,
    by: str = "",
    at: Optional[str] = None,
    meta: Optional[dict] = None,
    dedup_key: Optional[str] = None,
) -> dict:
    """Record one first-class touch into ``db.engagement_events`` (the spine).

    ``dedup_key`` makes the write idempotent — a repeated call with the same key
    updates the existing row instead of creating a duplicate (safe for retries
    and re-fires of a drip/webinar step).
    """
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "channel": channel if channel in CHANNELS else "event",
        "kind": kind, "title": title,
        "school_id": school_id or "", "lead_id": lead_id or "", "contact_id": contact_id or "",
        "detail": detail or "", "status": status or "", "direction": direction or "out",
        "amount": amount, "by": by or "", "meta": meta or {},
        "at": at or now, "created_at": now,
    }
    if dedup_key:
        doc["dedup_key"] = dedup_key
        existing = await db.engagement_events.find_one({"dedup_key": dedup_key}, {"_id": 0, "event_id": 1})
        if existing:
            await db.engagement_events.update_one(
                {"dedup_key": dedup_key}, {"$set": {**doc, "event_id": existing["event_id"]}})
            return {**doc, "event_id": existing["event_id"]}
    doc["event_id"] = uuid.uuid4().hex
    await db.engagement_events.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def fetch_events(
    *, school_id: str = "", lead_ids: Iterable[str] = (), contact_ids: Iterable[str] = (),
    channel: str = "", limit: int = 300,
) -> list[dict]:
    """Read first-class events for an account (empty until later phases write)."""
    ors: list[dict] = []
    if school_id:
        ors.append({"school_id": school_id})
    lead_ids = [x for x in lead_ids if x]
    contact_ids = [x for x in contact_ids if x]
    if lead_ids:
        ors.append({"lead_id": {"$in": lead_ids}})
    if contact_ids:
        ors.append({"contact_id": {"$in": contact_ids}})
    if not ors:
        return []
    q: dict = {"$or": ors}
    if channel:
        q["channel"] = channel
    return await db.engagement_events.find(q, {"_id": 0}).sort("at", -1).to_list(max(1, limit))
