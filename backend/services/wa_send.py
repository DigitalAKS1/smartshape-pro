"""The one door for WhatsApp (spec 2026-09-24, D3).

Every WhatsApp message the CRM sends goes through `send_whatsapp` and nowhere else. In order:
  1. normalise the number — one person is one key however the phone was typed (RF4);
  2. pick the sender (D2): the record owner's connected number, else the company number;
  3. policy (D5, D10): opt-out, consent, business hours, per-number caps. A refusal is
     `skipped`; a deferral is `queued` and the drainer in scheduler.py sends it later;
  4. number-exists check, cached 30 days;
  5. send through Evolution — or the AutoSender emergency fallback when configured;
  6. exactly one `wa_messages` row per call, whatever happened, plus an engagement event
     when it actually went.

`skipped` is a refusal, never a failure: callers must not retry or pause on it.
"""
import asyncio
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from services import evolution_client as evo_mod
from services.wa_config import get_wa_settings

log = logging.getLogger("wa_send")
IST = timezone(timedelta(hours=5, minutes=30))

KINDS = frozenset({"chat", "drip", "greeting", "campaign", "broadcast", "dispatch", "intro", "demo", "form",
                   "fms", "portal", "certificate", "scheduled", "digest", "alert", "system"})
MANUAL_KINDS = frozenset({"chat"})                      # a person pressed send
INTERNAL_KINDS = frozenset({"digest", "alert"})         # to our own staff
MARKETING_KINDS = frozenset({"drip", "greeting", "campaign", "broadcast"})   # caps + 1/contact/day
CONSENT_KINDS = frozenset({"drip", "greeting"})   # D10: consent gates automations only (ruling 2026-09-24)
YOUNG_NUMBER_BLOCKED_KINDS = frozenset({"campaign", "broadcast"})           # Rollout 3 (Task 5)
AUTOSENDER_URL = "https://app.messageautosender.com/message/new"


# ── Test seams ────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def _jitter(lo: float, hi: float) -> float:
    return random.uniform(lo, hi) if hi > lo else float(lo)


def _client() -> evo_mod.EvolutionClient:
    return evo_mod.evolution


async def _push(email: str, title: str, body: str) -> None:
    try:
        from routes.push_routes import send_push_to_user   # lazy: routes import this module
        await send_push_to_user(email, title, body, url="/app-settings?tab=whatsapp", tag="whatsapp")
    except Exception as e:
        log.warning("[wa] push to %s failed: %s", email, str(e)[:120])


# ── Small helpers ─────────────────────────────────────────────────────────────

def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(s) -> datetime:
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def ist_day(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%Y-%m-%d")


def ist_hour(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%H")


def to_e164(phone) -> str:
    """'+91 98111 11111', '98111-11111', '098111 11111', '919811111111', '0091…' -> '919811111111'.
    A foreign number is kept only when written internationally — '+<cc>…' or '00<cc>…'
    ('00971 50…' -> '97150…'). Anything else (a landline, a short or junk number) returns ''
    — it can never be a WhatsApp chat."""
    raw = str(phone or "").strip()
    digits = re.sub(r"\D", "", raw)
    intl = raw.startswith("+") or digits.startswith("00")
    if digits.startswith("00"):
        digits = digits[2:]
    if intl:
        if digits.startswith("91"):
            return digits if len(digits) == 12 and digits[2] in "6789" else ""
        return digits if 8 <= len(digits) <= 15 and digits[0] != "0" else ""
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        return "91" + digits if digits[0] in "6789" else ""
    if len(digits) == 12 and digits.startswith("91"):
        return digits if digits[2] in "6789" else ""
    return ""


def jid_for(e164: str) -> str:
    return f"{e164}@s.whatsapp.net" if e164 else ""


def _clean_media(media: Optional[dict]) -> Optional[dict]:
    if not media or not media.get("url"):
        return None
    t = media.get("type") or media.get("attachment_type") or "document"
    if t not in ("image", "video", "document", "audio"):
        t = "document"
    return {"type": t, "url": media["url"],
            "mime": media.get("mime") or media.get("content_type") or "",
            "filename": media.get("filename") or "",
            "size": media.get("size") or media.get("size_bytes"),
            "caption": media.get("caption") or ""}


# ── D2: owner and sender ──────────────────────────────────────────────────────

async def resolve_owner(db, *, lead_id: str = "", contact_id: str = "", school_id: str = "") -> Optional[str]:
    """The record's owner: the lead's, else the contact's, else the school's."""
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "assigned_to": 1, "school_id": 1}) or {}
        if lead.get("assigned_to"):
            return _norm_email(lead["assigned_to"])
        school_id = school_id or lead.get("school_id") or ""
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "assigned_to": 1, "school_id": 1}) or {}
        if c.get("assigned_to"):
            return _norm_email(c["assigned_to"])
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1}) or {}
        return _norm_email(s.get("assigned_to")) or None
    return None


def _norm_email(e) -> str:
    return str(e or "").strip().lower()


def _email_q(email: str) -> dict:
    """Case-insensitive exact match: stored emails are not reliably lower-cased."""
    return {"$regex": f"^\\s*{re.escape(_norm_email(email))}\\s*$", "$options": "i"}


async def _owner_instance(db, owner_email: str):
    """-> (the owner's linked instance doc or None, its state or 'unlinked')."""
    u = await db.users.find_one({"email": _email_q(owner_email)}, {"_id": 0, "wa_instance_name": 1}) or {}
    inst = None
    if u.get("wa_instance_name"):
        inst = await db.wa_instances.find_one({"instance_name": u["wa_instance_name"]}, {"_id": 0})
    if inst is None:
        inst = await db.wa_instances.find_one({"kind": "rep", "owner_email": _email_q(owner_email)}, {"_id": 0})
    if inst is None:
        return None, "unlinked"
    return inst, inst.get("state") or "unlinked"


_FALLBACK_REASONS = {"paused": "owner_paused", "disconnected": "owner_disconnected", "qr": "owner_qr",
                     "unlinked": "owner_unlinked"}


async def _resolve_sender(db, *, owner_email: Optional[str], channel: str):
    """-> (instance or None, skip reason, fallback_reason). fallback_reason says why the owner's
    own number was not the sender (D2: "the log says so")."""
    if channel == "official":
        return None, "official_channel_not_configured", ""
    if channel not in ("auto", "rep", "company"):           # an explicit instance (W2 chat reply)
        inst = await db.wa_instances.find_one({"instance_name": channel}, {"_id": 0})
        if inst and inst.get("state") == "connected":
            return inst, "", ""
        return None, "sender_not_connected", ""
    fallback = ""
    if channel != "company":
        if owner_email:
            inst, state = await _owner_instance(db, owner_email)
            if inst is not None and state == "connected":
                return inst, "", ""
            fallback = _FALLBACK_REASONS.get(state, "owner_disconnected")
        else:
            fallback = "no_owner"
    comp = await db.wa_instances.find_one({"kind": "company", "state": "connected"}, {"_id": 0})
    if comp:
        return comp, "", fallback
    return None, "no_sender", fallback


async def resolve_sender(db, *, owner_email: Optional[str] = None, channel: str = "auto"):
    """-> (instance doc, "") or (None, reason). Only a `connected` number sends."""
    inst, why, _ = await _resolve_sender(db, owner_email=owner_email, channel=channel)
    return inst, why


def _stamp_sender(row: dict, inst: dict) -> None:
    row["instance_name"] = inst["instance_name"]
    row["from_jid"] = inst.get("jid") or ""
    row["sent_via_owner_email"] = inst.get("owner_email") or ""
    row["sender_kind"] = inst.get("kind") or ""
    row["chat_id"] = f"{inst['instance_name']}:{row['to_jid']}"
    # D2: "the log says so" when the owner's own number could not be used.
    row["used_company_fallback"] = (inst.get("kind") == "company" and bool(row["owner_email"])
                                    and row["channel"] in ("auto", "rep"))


# ── D10: consent and opt-out ──────────────────────────────────────────────────

async def consent_ok(db, *, lead_id: str = "", contact_id: str = "", school_id: str = "") -> bool:
    """May we send a MARKETING WhatsApp here? Lead, else contact, else school consent; the rule
    itself is `notifications.require_wa_consent` (default ON — the safe side of a ban)."""
    cfg = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    if not cfg.get("require_wa_consent", True):
        return True
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "wa_consent": 1, "school_id": 1}) or {}
        if lead.get("wa_consent"):
            return True
        school_id = school_id or lead.get("school_id") or ""
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "wa_consent": 1, "school_id": 1}) or {}
        if c.get("wa_consent"):
            return True
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "wa_consent": 1}) or {}
        if s.get("wa_consent"):
            return True
    return False


async def is_opted_out(db, *, e164: str, contact_id: str = "", school_id: str = "", lead_id: str = "") -> bool:
    """The lead (via its contact and school), the contact, the school, or the number itself."""
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id},
                                       {"_id": 0, "wa_opt_out": 1, "school_id": 1, "contact_id": 1}) or {}
        if lead.get("wa_opt_out"):
            return True
        contact_id = contact_id or lead.get("contact_id") or ""
        school_id = school_id or lead.get("school_id") or ""
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "wa_opt_out": 1, "school_id": 1}) or {}
        if c.get("wa_opt_out"):
            return True
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "wa_opt_out": 1}) or {}
        if s.get("wa_opt_out"):
            return True
    if e164 and await db.wa_opt_outs.find_one({"phone_e164": e164, "active": True}, {"_id": 1}):
        return True
    return False


async def _is_staff_phone(db, e164: str) -> bool:
    """Does this number belong to one of our own people (users / del_employees)? Only then may
    an internal digest or alert ignore an opt-out. Both collections are small (staff)."""
    if not e164:
        return False
    for coll in (db.users, db.del_employees):
        async for p in coll.find({"$or": [{"phone": {"$nin": [None, ""]}}, {"mobile": {"$nin": [None, ""]}}]},
                                 {"_id": 0, "phone": 1, "mobile": 1}):
            if e164 in (to_e164(p.get("phone")), to_e164(p.get("mobile"))):
                return True
    return False


# ── Alerts ────────────────────────────────────────────────────────────────────

async def admin_emails(db) -> list:
    from rbac import SUPERADMIN_EMAIL
    out = [SUPERADMIN_EMAIL]
    async for u in db.users.find({"$or": [{"role": "admin"}, {"roles": "admin"}], "is_active": {"$ne": False}},
                                 {"_id": 0, "email": 1}):
        e = (u.get("email") or "").strip().lower()
        if e and e not in out:
            out.append(e)
    return out


async def alert(db, *, emails, title: str, body: str, dedup_key: str, ref_id: str = "") -> None:
    """Bell + push to each address once. The bell de-duplicates on (recipient, dedup_key) while
    unread; the push is sent only when the bell entry is new, so an hourly re-check does not buzz."""
    import notify
    seen = set()
    for e in emails or ():
        e = (e or "").strip().lower()
        if not e or e in seen:
            continue
        seen.add(e)
        existing = await db.notifications.find_one(
            {"assigned_to": e, "dedup_key": dedup_key, "is_read": False}, {"_id": 1})
        await notify.notify_user(e, type="whatsapp_alert", title=title, body=body, ref_type="wa_instance",
                                 ref_id=ref_id, from_name="WhatsApp", dedup_key=dedup_key)
        if not existing:
            await _push(e, title, body)


# ── AutoSender emergency fallback (D3) ────────────────────────────────────────

async def _autosender_ready(db) -> bool:
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0}) or {}
    return bool(wa.get("username") and wa.get("password"))


async def _send_via_autosender(db, e164: str, text: str, file_url: Optional[str] = None) -> bool:
    """The one remaining MessageAutoSender call (was six copies). True when accepted."""
    import httpx
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0}) or {}
    data = {"username": wa.get("username", ""), "password": wa.get("password", ""),
            "receiverMobileNo": e164[2:] if e164.startswith("91") and len(e164) == 12 else e164,
            "message": text}
    if file_url:
        data["filePathUrl"] = file_url
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(AUTOSENDER_URL, data=data)
    return 200 <= resp.status_code < 300


async def _try_autosender(db, row: dict) -> bool:
    if not await _autosender_ready(db):
        return False
    try:
        return await _send_via_autosender(db, row["to_e164"], row["text"], (row.get("media") or {}).get("url"))
    except Exception as e:
        log.warning("[wa] autosender fallback failed: %s", str(e)[:160])
        return False


async def wa_available(db) -> bool:
    """Is there any way to send right now? (Used by the digest/report producers.)"""
    if await db.wa_instances.find_one({"state": "connected"}, {"_id": 1}):
        return True
    cfg = await get_wa_settings(db)
    return cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)


# ── Policy (Task 5 extends with hours and caps) ───────────────────────────────

async def _policy(db, row: dict, inst: Optional[dict], cfg: dict, *, from_queue: bool = False):
    """-> ("send", "", None) | ("skip", reason, None) | ("queue", reason, send_after)."""
    kind = row["kind"]
    if kind in MANUAL_KINDS:                      # a person pressed send (typed_by is required)
        return "send", "", None
    if kind in INTERNAL_KINDS and await _is_staff_phone(db, row["to_e164"]):
        return "send", "", None                   # our own staff: an opt-out does not apply
    if await is_opted_out(db, e164=row["to_e164"], contact_id=row["contact_id"], school_id=row["school_id"],
                          lead_id=row["lead_id"]):
        return "skip", "opt_out", None
    if kind in CONSENT_KINDS and row["enforce_consent"]:
        if not await consent_ok(db, lead_id=row["lead_id"], contact_id=row["contact_id"],
                                school_id=row["school_id"]):
            return "skip", "no_consent", None
    return "send", "", None


# ── Number-exists check ───────────────────────────────────────────────────────

NOT_ON_WA_TTL_DAYS = 7     # a "no" is re-checked sooner: people join WhatsApp


async def _number_exists(db, inst: dict, e164: str, contact_id: str, cfg: dict) -> Optional[bool]:
    """True/False from cache or Evolution; None when unknown (the check failed, or Evolution did
    not answer for this number) — unknown never blocks and is never cached.

    `wa_number_cache` is the source of truth. `contacts.wa_number_exists/_checked_at` mirror it,
    written in the same place with the same values, for display only; nothing reads them here."""
    now = _now()
    cached = await db.wa_number_cache.find_one({"phone_e164": e164}, {"_id": 0})
    if cached and cached.get("checked_at") is not None:
        ttl = int(cfg["number_check_ttl_days"]) if cached.get("exists") else NOT_ON_WA_TTL_DAYS
        if _parse(cached["checked_at"]) > now - timedelta(days=ttl):
            return bool(cached["exists"])
    try:
        res = await _client().check_numbers([e164], instance=inst["instance_name"],
                                             token=inst.get("instance_token") or None)
    except Exception as e:
        log.warning("[wa] number check failed on %s: %s", inst["instance_name"], str(e)[:120])
        return None
    if e164 not in (res or {}):
        log.info("[wa] number check on %s gave no answer for %s", inst["instance_name"], e164)
        return None
    exists = bool(res[e164])
    await db.wa_number_cache.update_one(
        {"phone_e164": e164}, {"$set": {"phone_e164": e164, "exists": exists, "checked_at": _iso(now)}}, upsert=True)
    if contact_id:
        await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
            "wa_number_exists": exists, "wa_number_checked_at": _iso(now)}})
    return exists


# ── Delivery ──────────────────────────────────────────────────────────────────

async def _evolution_send(inst: dict, row: dict) -> dict:
    c, name, tok = _client(), inst["instance_name"], inst.get("instance_token") or None
    media = row.get("media")
    if media and media.get("url"):
        return await c.send_media(row["to_e164"], media["url"], mediatype=media["type"],
                                  caption=(row.get("text") or media.get("caption") or "")[:1000],
                                  filename=media.get("filename") or "", mimetype=media.get("mime") or "",
                                  instance=name, token=tok)
    return await c.send_text(row["to_e164"], row["text"], instance=name, token=tok)


def _classify_send_error(e: Exception):
    """-> (class, reason).
    "transport": the request never reached Evolution or Evolution itself broke (connect/DNS/
                 proxy failure, 5xx) — counts against the number and may use the fallback.
    "recipient": Evolution refused THIS message (4xx) — this message fails, nothing else.
    "uncertain": it may have reached Evolution (read/write timeout, dropped connection) — fails
                 WITHOUT the fallback, which could deliver it twice."""
    import httpx        # already a dependency (evolution_client); lazy to keep this module light
    err = str(e)[:200] or type(e).__name__
    if isinstance(e, evo_mod.EvolutionError):
        return ("transport" if e.status_code >= 500 else "recipient"), err
    if isinstance(e, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout, httpx.ProxyError,
                      httpx.UnsupportedProtocol, httpx.LocalProtocolError)):
        return "transport", err
    if isinstance(e, httpx.TimeoutException):
        return "uncertain", "timeout"
    return "uncertain", f"uncertain: {err}"


async def _record_success(db, inst: dict) -> None:
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": {
        "consecutive_failures": 0, "last_sent_at": _iso(_now()), "last_error": ""}})


async def _record_failure(db, inst: dict, err: str, cfg: dict) -> None:
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {
        "$inc": {"consecutive_failures": 1}, "$set": {"last_error": err, "last_error_at": _iso(_now())}})


async def _log_event(row: dict) -> None:
    if not (row.get("contact_id") or row.get("lead_id") or row.get("school_id")):
        return
    from services.engagement import log_engagement_event
    try:
        await log_engagement_event(
            channel="whatsapp", kind=f"WhatsApp · {row['kind']}",
            title=(row.get("text") or (row.get("media") or {}).get("filename") or "WhatsApp")[:100],
            school_id=row.get("school_id") or "", lead_id=row.get("lead_id") or "",
            contact_id=row.get("contact_id") or "", status="sent", direction="out",
            by=row.get("typed_by") or row.get("sent_via_owner_email") or "Company WhatsApp",
            at=row["sent_at"],
            meta={"message_id": row["message_id"], "instance_name": row.get("instance_name") or "",
                  "kind": row["kind"], "ref": row.get("ref") or {}},
            dedup_key=(row.get("ref") or {}).get("dedup_key") or f"wa:{row['message_id']}")
    except Exception as e:
        log.error("[wa] engagement event failed for %s: %s", row["message_id"], str(e)[:160])


_WEBHOOK_AHEAD = ("delivered", "read", "played")      # statuses a receipt may already have set


async def _merge_into_existing(db, row: dict) -> None:
    """A SEND_MESSAGE webhook (Task 6) recorded this provider id first. That row survives (D9:
    one row per message); it becomes app-owned and takes our kind/ref/typed_by/links. Our
    'sending' row is removed and `row["message_id"]` becomes the surviving row's id."""
    existing = await db.wa_messages.find_one(
        {"instance_name": row["instance_name"], "provider_msg_id": row["provider_msg_id"],
         "message_id": {"$ne": row["message_id"]}}, {"_id": 0})
    if not existing:
        raise LookupError("duplicate provider id but no other row holds it")
    ours = row["message_id"]
    status = existing.get("status") if existing.get("status") in _WEBHOOK_AHEAD else row["status"]
    merged = {k: v for k, v in row.items()
              if k not in ("message_id", "status", "status_history", "provider_ts", "created_at")}
    merged.update({"source": "app", "status": status, "app_message_id": ours,
                   "status_history": list(existing.get("status_history") or []) + list(row["status_history"])})
    await db.wa_messages.delete_one({"message_id": ours})
    await db.wa_messages.update_one({"message_id": existing["message_id"]}, {"$set": merged})
    row["message_id"] = existing["message_id"]


async def _write_row(db, row: dict) -> None:
    from pymongo.errors import DuplicateKeyError
    try:
        await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)
    except DuplicateKeyError:
        if not row.get("provider_msg_id"):
            raise
        await _merge_into_existing(db, row)


async def _mark_sending(db, row: dict) -> None:
    """Written BEFORE the provider call: a crash mid-send leaves a `sending` row, never nothing."""
    row["status"] = "sending"
    row.setdefault("status_history", []).append({"status": "sending", "at": _iso(_now()), "reason": ""})
    await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)


async def _finish(db, row: dict, status: str, reason: str) -> dict:
    now = _now()
    row["status"] = status
    row["fail_reason"] = reason if status in ("failed", "skipped") else ""
    row.setdefault("status_history", []).append({"status": status, "at": _iso(now), "reason": reason})
    row["send_after"] = None
    if status == "sent":
        row["sent_at"] = _iso(now)
        row["sent_day"] = ist_day(now)
    try:
        await _write_row(db, row)
    except Exception as e:
        if status != "sent":
            raise
        # The message is out. A bookkeeping failure must not make the caller think otherwise
        # (and retry → a double send).
        log.error("[wa] row write after a successful send failed for %s: %s", row["message_id"], str(e)[:160])
    if status == "sent":
        await _log_event(row)
    return {"status": status, "message_id": row["message_id"],
            "instance_name": row.get("instance_name") or "", "reason": reason}


async def _finish_queued(db, row: dict, reason: str, send_after: datetime) -> dict:
    row["status"] = "queued"
    row["send_after"] = _iso(send_after)
    row["queue_reason"] = reason
    row.setdefault("status_history", []).append({"status": "queued", "at": _iso(_now()), "reason": reason})
    await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)
    return {"status": "queued", "message_id": row["message_id"],
            "instance_name": row.get("instance_name") or "", "reason": reason}


async def _deliver(db, row: dict, inst: Optional[dict], cfg: dict) -> dict:
    kind = row["kind"]
    if inst is None:                     # only reached for the AutoSender fallback
        await _mark_sending(db, row)
        if await _try_autosender(db, row):
            row["provider"] = "autosender"
            return await _finish(db, row, "sent", "")
        return await _finish(db, row, "failed", "autosender_failed")
    if kind not in MANUAL_KINDS and kind not in INTERNAL_KINDS:
        if await _number_exists(db, inst, row["to_e164"], row["contact_id"], cfg) is False:
            return await _finish(db, row, "skipped", "not_on_whatsapp")
    await _mark_sending(db, row)
    try:
        resp = await _evolution_send(inst, row)
    except Exception as e:
        cls, reason = _classify_send_error(e)
        row["error_class"] = cls
        if cls == "transport":
            try:
                await _record_failure(db, inst, reason, cfg)
            except Exception as e2:
                log.error("[wa] could not record failure on %s: %s", inst["instance_name"], str(e2)[:120])
            if cfg["fallback_provider"] == "autosender" and await _try_autosender(db, row):
                row["provider"] = "autosender"
                row["status_history"].append(
                    {"status": "failed", "at": _iso(_now()), "reason": f"evolution: {reason}"})
                return await _finish(db, row, "sent", "")
        return await _finish(db, row, "failed", reason)
    row["provider"] = "evolution"
    row["provider_msg_id"] = evo_mod.provider_message_id(resp) or None
    try:
        await _record_success(db, inst)
    except Exception as e:
        log.error("[wa] could not record success on %s: %s", inst["instance_name"], str(e)[:120])
    return await _finish(db, row, "sent", "")


async def _route_and_send(db, row: dict, cfg: dict, *, from_queue: bool) -> dict:
    inst, why, fallback = await _resolve_sender(db, owner_email=row["owner_email"] or None, channel=row["channel"])
    row["fallback_reason"] = fallback
    if inst is None:
        if not (why == "no_sender" and cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)):
            return await _finish(db, row, "skipped", why)
        row["instance_name"] = ""
    else:
        _stamp_sender(row, inst)
    decision, reason, after = await _policy(db, row, inst, cfg, from_queue=from_queue)
    if decision == "skip":
        return await _finish(db, row, "skipped", reason)
    if decision == "queue":
        return await _finish_queued(db, row, reason, after)
    return await _deliver(db, row, inst, cfg)


async def send_whatsapp(db, *, to: str, text: str = "", media: Optional[dict] = None, kind: str,
                        ref: Optional[dict] = None, owner_email: Optional[str] = None, contact_id: str = "",
                        lead_id: str = "", school_id: str = "", typed_by: Optional[str] = None,
                        channel: str = "auto", enforce_consent: bool = True) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown WhatsApp kind: {kind!r}")
    if kind in MANUAL_KINDS and not (typed_by or "").strip():
        raise ValueError("a manual 'chat' send needs typed_by (the person who pressed send)")
    cfg = await get_wa_settings(db)
    e164 = to_e164(to)
    contact_id, lead_id, school_id = contact_id or "", lead_id or "", school_id or ""
    if owner_email is not None:
        owner_email = _norm_email(owner_email) or None
    elif channel in ("auto", "rep"):
        owner_email = await resolve_owner(db, lead_id=lead_id, contact_id=contact_id, school_id=school_id)
    row = {
        "message_id": f"wam_{uuid.uuid4().hex[:16]}", "instance_name": "", "provider_msg_id": None,
        "chat_id": "", "direction": "out", "from_jid": "", "to_jid": jid_for(e164), "to_e164": e164,
        "to_raw": str(to or "")[:40], "contact_id": contact_id, "lead_id": lead_id, "school_id": school_id,
        "kind": kind, "ref": dict(ref or {}), "text": (text or "").strip(), "media": _clean_media(media),
        "quoted_provider_msg_id": None, "typed_by": typed_by, "owner_email": owner_email or "",
        "channel": channel, "enforce_consent": bool(enforce_consent), "sent_via_owner_email": "",
        "sender_kind": "", "used_company_fallback": False, "fallback_reason": "", "provider": "",
        "status": "queued", "status_history": [], "fail_reason": "", "send_after": None, "source": "app",
        "created_at": _iso(_now()), "provider_ts": None,
    }
    if not e164:
        return await _finish(db, row, "skipped", "bad_phone")
    if not (row["text"] or row["media"]):
        return await _finish(db, row, "skipped", "empty_message")
    return await _route_and_send(db, row, cfg, from_queue=False)
