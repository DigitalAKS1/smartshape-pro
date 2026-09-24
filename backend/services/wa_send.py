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


# ── D5: warm-up, caps and business hours (all IST — RF5) ──────────────────────

def _hm(s: str):
    h, m = str(s).split(":")
    return int(h), int(m)


def warmup_day(inst: dict, now: datetime) -> int:
    """1-based: day 1 is the IST date the number first connected."""
    started = inst.get("warmup_started_at")
    if not started:
        return 1
    return max(0, (now.astimezone(IST).date() - _parse(started).astimezone(IST).date()).days) + 1


def daily_cap(inst: dict, cfg: dict, now: datetime) -> int:
    """D5 warm-up: 20/day, doubling every 3 days, capped at 200 — or the admin's override."""
    if inst.get("daily_cap_override") is not None:      # 0 is a real override: "blocked"
        return int(inst["daily_cap_override"])
    if not inst.get("warmup_started_at"):
        return int(cfg["warmup_start_cap"])
    doublings = (warmup_day(inst, now) - 1) // int(cfg["warmup_double_every_days"])
    return int(min(int(cfg["daily_cap"]), int(cfg["warmup_start_cap"]) * (2 ** min(doublings, 20))))


def next_business_open(now: datetime, cfg: dict) -> Optional[datetime]:
    """None inside business hours (IST); otherwise the next opening instant, in UTC."""
    loc = now.astimezone(IST)
    sh, sm = _hm(cfg["business_start"])
    eh, em = _hm(cfg["business_end"])
    start = loc.replace(hour=sh, minute=sm, second=0, microsecond=0)
    end = loc.replace(hour=eh, minute=em, second=0, microsecond=0)
    if start <= loc < end:
        return None
    return (start if loc < start else start + timedelta(days=1)).astimezone(timezone.utc)


def _tomorrow_open(now: datetime, cfg: dict) -> datetime:
    loc = now.astimezone(IST)
    sh, sm = _hm(cfg["business_start"])
    return (loc.replace(hour=sh, minute=sm, second=0, microsecond=0) + timedelta(days=1)).astimezone(timezone.utc)


def _next_hour(now: datetime) -> datetime:
    loc = now.astimezone(IST)
    return (loc.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).astimezone(timezone.utc)


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


# ── Per-number ledger (wa_send_ledger, one row per instance per IST day) ──────

async def _ledger(db, name: str, now: datetime) -> dict:
    day = ist_day(now)                                  # RF5: the IST date, never the UTC one
    await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": day},
        {"$setOnInsert": {"instance_name": name, "day": day, "sent_count": 0, "hour_bucket": {},
                          "last_sent_at": None}},
        upsert=True)
    return await db.wa_send_ledger.find_one({"instance_name": name, "day": day}, {"_id": 0}) or {}


async def _claim_gap(db, name: str, now: datetime, cfg: dict, gap: Optional[float] = None):
    """Atomically take the next send slot on this number: succeeds only if the last send (by
    anyone — a direct send, a drip, any drainer) was at least `gap` seconds ago (default: a
    random 8–25 s). Two concurrent callers cannot both win.
    -> (True, None) | (False, the instant the slot opens)."""
    if float(cfg["gap_max_s"]) <= 0:
        return True, None
    if gap is None:
        gap = _jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"]))
    res = await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": ist_day(now),
         "$or": [{"last_sent_at": None}, {"last_sent_at": {"$lte": _iso(now - timedelta(seconds=gap))}}]},
        {"$set": {"last_sent_at": _iso(now)}})
    if getattr(res, "modified_count", 0) == 1:
        return True, None
    led = await db.wa_send_ledger.find_one({"instance_name": name, "day": ist_day(now)}, {"_id": 0}) or {}
    last = _parse(led["last_sent_at"]) if led.get("last_sent_at") else now
    return False, max(now, last + timedelta(seconds=gap))


async def _contacted_today(db, name: str, to_jid: str, now: datetime, cfg: dict) -> bool:
    n = await db.wa_messages.count_documents({
        "instance_name": name, "to_jid": to_jid, "direction": "out",
        "kind": {"$in": sorted(MARKETING_KINDS)}, "sent_day": ist_day(now),
        "status": {"$in": ["sent", "delivered", "read", "played"]}})
    return n >= int(cfg["per_contact_per_day"])


# ── Policy (the Task 5 table) ─────────────────────────────────────────────────
#
#   check                              chat   digest/alert  transactional  marketing
#   opt-out / consent (D10)             –     staff exempt      skip          skip
#   business hours 09:00–19:00 IST      –          –            queue         queue
#   hourly cap                        queue      queue          queue         queue
#   daily cap / warm-up                 –        queue          queue         queue
#   one per contact per number per day  –          –              –           queue
#   jittered gap                        –        queue          queue         queue

async def _policy(db, row: dict, inst: Optional[dict], cfg: dict, *, gap_s: Optional[float] = None):
    """-> ("send", "", None) | ("skip", reason, None) | ("queue", reason, send_after).

    `gap_s`: the gap to claim on this number (the drainer passes the one it has already slept);
    None draws a fresh random 8–25 s. Every automated send claims the slot — the drainer too."""
    kind = row["kind"]
    now = _now()
    automated = kind not in MANUAL_KINDS                # chat: a person pressed send
    customer_facing = automated and kind not in INTERNAL_KINDS
    to_staff = kind in INTERNAL_KINDS and await _is_staff_phone(db, row["to_e164"])
    if automated and not to_staff:
        # our own staff: an opt-out does not apply to an internal digest/alert
        if await is_opted_out(db, e164=row["to_e164"], contact_id=row["contact_id"],
                              school_id=row["school_id"], lead_id=row["lead_id"]):
            return "skip", "opt_out", None
        if kind in CONSENT_KINDS and row["enforce_consent"]:
            if not await consent_ok(db, lead_id=row["lead_id"], contact_id=row["contact_id"],
                                    school_id=row["school_id"]):
                return "skip", "no_consent", None
    if customer_facing:
        opens = next_business_open(now, cfg)
        if opens is not None:
            return "queue", "quiet_hours", opens
    if inst is None:                                    # AutoSender fallback: no per-number ledger
        return "send", "", None
    led = await _ledger(db, inst["instance_name"], now)
    if int((led.get("hour_bucket") or {}).get(ist_hour(now), 0)) >= int(cfg["hourly_cap"]):
        nxt = _next_hour(now)
        if customer_facing:
            nxt = next_business_open(nxt, cfg) or nxt
        return "queue", "hourly_cap", nxt
    if automated:
        # an internal digest/alert to our own staff is exempt from the warm-up/daily cap (not
        # from the hourly cap or the gap)
        if not to_staff and int(led.get("sent_count", 0)) >= daily_cap(inst, cfg, now):
            return "queue", "daily_cap", _tomorrow_open(now, cfg)
        if kind in MARKETING_KINDS and await _contacted_today(db, inst["instance_name"], row["to_jid"], now, cfg):
            return "queue", "per_contact_per_day", _tomorrow_open(now, cfg)
        ok, opens_at = await _claim_gap(db, inst["instance_name"], now, cfg, gap_s)
        if not ok:
            if customer_facing:
                opens_at = next_business_open(opens_at, cfg) or opens_at
            return "queue", "gap", opens_at
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


_INSTANCE_HTTP_ERRORS = frozenset({401, 403, 404})    # bad/rotated token, instance gone


def _classify_send_error(e: Exception):
    """-> (class, reason).
    "transport": the request never reached Evolution, Evolution itself broke (connect/DNS/
                 proxy failure, 5xx), or the instance is unusable (401/403/404) — counts
                 against the number and may use the fallback.
    "recipient": Evolution refused THIS message (any other 4xx) — this message fails, nothing else.
    "uncertain": it may have reached Evolution (read/write timeout, dropped connection) — fails
                 WITHOUT the fallback, which could deliver it twice."""
    import httpx        # already a dependency (evolution_client); lazy to keep this module light
    err = str(e)[:200] or type(e).__name__
    if isinstance(e, evo_mod.EvolutionError):
        if e.status_code >= 500 or e.status_code in _INSTANCE_HTTP_ERRORS:
            return "transport", err
        return "recipient", err
    if isinstance(e, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout, httpx.ProxyError,
                      httpx.UnsupportedProtocol, httpx.LocalProtocolError)):
        return "transport", err
    if isinstance(e, httpx.TimeoutException):
        return "uncertain", "timeout"
    return "uncertain", f"uncertain: {err}"


async def _record_success(db, inst: dict) -> None:
    now = _now()
    name = inst["instance_name"]
    await _ledger(db, name, now)
    await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": ist_day(now)},
        {"$inc": {"sent_count": 1, f"hour_bucket.{ist_hour(now)}": 1}, "$set": {"last_sent_at": _iso(now)}})
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "consecutive_failures": 0, "last_sent_at": _iso(now), "last_error": ""}})


async def _record_failure(db, inst: dict, err: str, cfg: dict) -> None:
    """Only instance-level failures reach here (see _classify_send_error): a `skipped`, a
    recipient 4xx or an uncertain timeout never counts toward the pause."""
    name = inst["instance_name"]
    await db.wa_instances.update_one({"instance_name": name}, {
        "$inc": {"consecutive_failures": 1}, "$set": {"last_error": err, "last_error_at": _iso(_now())}})
    cur = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}) or {}
    streak = int(cur.get("consecutive_failures", 0))
    if streak >= int(cfg["failure_pause_after"]) and cur.get("state") != "paused":
        await pause_instance(db, cur, reason=f"{streak} sends in a row failed. Last error: {err}")


async def pause_instance(db, inst: dict, *, reason: str, by: str = "system") -> None:
    """State `paused` (resolve_sender then never picks it) + bell and push to the number's owner
    and every admin. Only an admin resumes it (Settings → WhatsApp)."""
    now = _iso(_now())
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": {
        "state": "paused", "state_at": now, "paused_reason": reason, "paused_by": by}})
    who = ("The company WhatsApp number" if inst.get("kind") == "company"
           else f"{inst.get('label') or inst.get('owner_email') or inst['instance_name']}'s WhatsApp number")
    await alert(db, emails=[inst.get("owner_email")] + await admin_emails(db),
                title="WhatsApp number paused",
                body=(f"{who} (+{inst.get('phone_e164') or '?'}) was paused: {reason} "
                      "Nothing more goes out from it until an admin resumes it in Settings → WhatsApp."),
                dedup_key=f"wa_paused:{inst['instance_name']}", ref_id=inst["instance_name"])


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
    # Update the survivor FIRST: if that fails, our 'sending' row is still there and nothing is lost.
    await db.wa_messages.update_one({"message_id": existing["message_id"]}, {"$set": merged})
    row["message_id"] = existing["message_id"]
    try:
        await db.wa_messages.delete_one({"message_id": ours})
    except Exception as e:
        # The survivor already holds everything; our leftover row is a harmless duplicate that a
        # sweeper can recognise by `app_message_id` on the survivor.
        log.error("[wa] merged %s into %s but could not delete %s: %s",
                  ours, existing["message_id"], ours, str(e)[:160])


class ClaimLost(Exception):
    """A drainer's claim on a queued row was taken over (the sweeper requeued it after the claim
    went stale and another worker claimed it). The stalled worker must not touch the row."""


async def _save_row(db, row: dict) -> None:
    """$set the whole row. A row the drainer claimed is written only while this worker's
    `claim_token` is still on it - otherwise ClaimLost, and nothing is written."""
    tok = row.get("claim_token")
    if not tok:
        await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)
        return
    res = await db.wa_messages.update_one({"message_id": row["message_id"], "claim_token": tok}, {"$set": row})
    if getattr(res, "matched_count", 0) == 0:
        raise ClaimLost(f"{row['message_id']}: claim {tok} is no longer held")


async def _write_row(db, row: dict) -> None:
    from pymongo.errors import DuplicateKeyError
    try:
        await _save_row(db, row)
    except DuplicateKeyError:
        if not row.get("provider_msg_id"):
            raise
        await _merge_into_existing(db, row)


async def _mark_sending(db, row: dict) -> None:
    """Written BEFORE the provider call: a crash mid-send leaves a `sending` row, never nothing."""
    now = _iso(_now())
    row["status"] = "sending"
    row["sending_at"] = now          # the ACTUAL send attempt (a queued row's created_at is older)
    row.setdefault("status_history", []).append({"status": "sending", "at": now, "reason": ""})
    await _save_row(db, row)         # ClaimLost here means: do NOT call the provider


async def _mark_sent_minimal(db, message_id: str, row: dict) -> None:
    """The fallback write after a successful send whose full row write failed: just enough that
    the row no longer reads `sending` (which a sweeper would treat as undelivered)."""
    await db.wa_messages.update_one({"message_id": message_id}, {"$set": {
        "status": "sent", "provider_msg_id": row.get("provider_msg_id"), "provider": row.get("provider") or "",
        "status_history": row.get("status_history") or [], "sent_at": row.get("sent_at")}})


async def _finish(db, row: dict, status: str, reason: str) -> dict:
    now = _now()
    row["status"] = status
    row["fail_reason"] = reason if status in ("failed", "skipped") else ""
    row.setdefault("status_history", []).append({"status": status, "at": _iso(now), "reason": reason})
    row["send_after"] = None
    if status == "sent":
        row["sent_at"] = _iso(now)
        row["sent_day"] = ist_day(now)
    ours = row["message_id"]
    try:
        await _write_row(db, row)
    except Exception as e:
        if status != "sent":
            raise
        # The message is out. A bookkeeping failure must not make the caller think otherwise
        # (and retry → a double send), and must not leave the row reading `sending`.
        log.warning("[wa] row write after a successful send failed for %s: %s", ours, str(e)[:160])
        try:
            await _mark_sent_minimal(db, ours, row)
        except Exception as e2:
            log.error("[wa] message %s WAS SENT (provider id %s) but its row could not be updated and "
                      "still reads 'sending': %s", ours, row.get("provider_msg_id"), str(e2)[:160])
    if status == "sent":
        await _log_event(row)
    return {"status": status, "message_id": row["message_id"],
            "instance_name": row.get("instance_name") or "", "reason": reason}


async def _finish_queued(db, row: dict, reason: str, send_after: datetime) -> dict:
    row["status"] = "queued"
    row["send_after"] = _iso(send_after)
    row["queue_reason"] = reason
    row.setdefault("status_history", []).append({"status": "queued", "at": _iso(_now()), "reason": reason})
    await _save_row(db, row)
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


_HOLD_REASONS = frozenset({"no_sender", "sender_not_connected"})   # may come back (resume/reconnect)
QUEUE_HOLD_HOURS = 72
QUEUE_HOLD_RETRY_S = 60          # a held row is looked at again on the next drainer pass


async def _route_and_send(db, row: dict, cfg: dict, *, from_queue: bool,
                          gap_s: Optional[float] = None) -> dict:
    queued_on = row.get("instance_name") or ""          # the drainer's number, when from_queue
    inst, why, fallback = await _resolve_sender(db, owner_email=row["owner_email"] or None, channel=row["channel"])
    row["fallback_reason"] = fallback
    if (inst is not None and row["kind"] in YOUNG_NUMBER_BLOCKED_KINDS and inst.get("kind") == "rep"
            and warmup_day(inst, _now()) <= int(cfg["warmup_days"])):
        # Rollout 3: no campaign/broadcast from a rep number still in its warm-up period. An
        # explicit-instance send is never silently rerouted (it is skipped instead).
        comp = None
        if row["channel"] in ("auto", "rep"):
            comp, _ = await resolve_sender(db, channel="company")
        if comp is None:
            row["instance_name"] = inst["instance_name"]
            return await _finish(db, row, "skipped", "number_warming_up")
        inst = comp
        row["fallback_reason"] = "owner_warming_up"
    if inst is None:
        if not (why == "no_sender" and cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)):
            if from_queue and why in _HOLD_REASONS:
                # A queued row whose sender is paused/down with no fallback waits (next pass)
                # until it is sent, the number is resumed, or it is 72 h old.
                if _now() - _parse(row["created_at"]) < timedelta(hours=QUEUE_HOLD_HOURS):
                    return await _finish_queued(db, row, "sender_unavailable",
                                                _now() + timedelta(seconds=QUEUE_HOLD_RETRY_S))
                return await _finish(db, row, "skipped", "sender_unavailable")
            return await _finish(db, row, "skipped", why)
        row["instance_name"] = ""
    else:
        _stamp_sender(row, inst)
    # The drainer claims the gap it already slept on its own number; a queued row re-routed to
    # another number draws a fresh gap there like any send.
    same_number = from_queue and inst is not None and inst["instance_name"] == queued_on
    decision, reason, after = await _policy(db, row, inst, cfg, gap_s=gap_s if same_number else None)
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


# ── The queue drainer (scheduler.wa_queue_loop, every minute) ─────────────────
# Same two guards as the drip executor (scheduler.py _DRIP_LOCK / _claim_enrollment):
# an in-process lock so overlapping passes collapse, and a per-row compare-and-set claim
# (queued -> sending + claimed_at + a fresh claim_token) so two workers can never send one row.
# Every write the worker makes afterwards is conditioned on its claim_token (_save_row), so a
# worker that stalled past the reclaim window cannot complete a row somebody else now owns.
#
# A `sending` row is one of two things, told apart by `sending_at` (stamped by _mark_sending
# immediately before the provider call):
#   * no `sending_at` — only CLAIMED by a drainer that died before it tried to send. Nothing
#     went out; after QUEUE_CLAIM_MINUTES it goes back to `queued` (at most MAX_DRAIN_ERRORS
#     times, then `failed(drain_error)`).
#   * `sending_at` set — the provider WAS called and no result was recorded (crash mid-send).
#     It may have been delivered, so it is NEVER resent: after QUEUE_CLAIM_MINUTES it becomes
#     `sent` if there is evidence it went (another row holds its provider id, or its
#     engagement event exists), else `failed` with reason "uncertain: …".
_QUEUE_LOCK = asyncio.Lock()
QUEUE_CLAIM_MINUTES = 10
MAX_DRAIN_ERRORS = 3             # requeues after a drain error before the row is failed
DRAIN_ERROR_RETRY_MINUTES = 5
_UNCERTAIN_REASON = "uncertain: no result recorded for the send"


async def _went_out(db, row: dict) -> bool:
    if row.get("provider_msg_id") and await db.wa_messages.find_one(
            {"instance_name": row.get("instance_name") or "", "provider_msg_id": row["provider_msg_id"],
             "message_id": {"$ne": row["message_id"]}}, {"_id": 1}):
        return True
    return bool(await db.engagement_events.find_one(
        {"$or": [{"dedup_key": f"wa:{row['message_id']}"}, {"meta.message_id": row["message_id"]}]}, {"_id": 1}))


async def _release_unsent(db, row: dict, now: datetime, why: str, *, retry_at: datetime) -> None:
    """A claimed row that never reached the provider: back to the queue (a fresh claim is
    needed), or `failed(drain_error)` once it has errored more than MAX_DRAIN_ERRORS times.
    Compare-and-set on the claim this worker (or the stale claim the sweeper saw) holds."""
    errors = int(row.get("drain_errors") or 0) + 1
    if errors > MAX_DRAIN_ERRORS:
        upd = {"status": "failed", "fail_reason": "drain_error", "send_after": None}
        hist = {"status": "failed", "at": _iso(now), "reason": f"drain_error: {why}"[:200]}
    else:
        upd = {"status": "queued", "send_after": _iso(retry_at)}
        hist = {"status": "queued", "at": _iso(now), "reason": f"drain_retry: {why}"[:200]}
    upd.update({"drain_errors": errors, "claim_token": None})
    await db.wa_messages.update_one(
        {"message_id": row["message_id"], "status": "sending", "sending_at": None,
         "claim_token": row.get("claim_token")},
        {"$set": upd, "$push": {"status_history": hist}})


async def _sweep_stale_sending(db, now: datetime) -> None:
    cutoff = _iso(now - timedelta(minutes=QUEUE_CLAIM_MINUTES))
    # 1. claimed, never attempted: back to the queue (bounded)
    async for row in db.wa_messages.find(
            {"status": "sending", "sending_at": None, "claimed_at": {"$lt": cutoff}}, {"_id": 0}):
        await _release_unsent(db, row, now, "claim went stale", retry_at=now)
    # 2. attempted, no outcome: sent (with evidence) or failed(uncertain) — never resent
    async for row in db.wa_messages.find({"status": "sending", "sending_at": {"$lt": cutoff}}, {"_id": 0}):
        went = await _went_out(db, row)
        status = "sent" if went else "failed"
        reason = "" if went else _UNCERTAIN_REASON
        upd = {"status": status, "fail_reason": reason, "error_class": row.get("error_class") or "uncertain",
               "send_after": None}
        if went:
            upd.update({"sent_at": row["sending_at"], "sent_day": ist_day(_parse(row["sending_at"])),
                        "error_class": ""})
        res = await db.wa_messages.update_one(
            {"message_id": row["message_id"], "status": "sending", "sending_at": row["sending_at"]},
            {"$set": upd, "$push": {"status_history": {"status": status, "at": _iso(now),
                                                       "reason": reason or "swept: evidence it went"}}})
        if getattr(res, "modified_count", 0):
            log.warning("[wa-queue] %s stuck in 'sending' since %s -> %s", row["message_id"],
                        row["sending_at"], status)


async def run_wa_queue_pass(db, *, budget_s: float = 50.0) -> dict:
    if _QUEUE_LOCK.locked():
        return {"skipped": "already_running"}
    async with _QUEUE_LOCK:
        now = _now()
        await _sweep_stale_sending(db, now)
        names = await db.wa_messages.distinct("instance_name", {"status": "queued", "send_after": {"$lte": _iso(now)}})
        deadline = now + timedelta(seconds=budget_s)
        counts = await asyncio.gather(*[_drain_instance(db, n, deadline=deadline) for n in names])
        return {"instances": len(names), "processed": sum(counts)}


async def _drain_instance(db, name: str, *, deadline: datetime) -> int:
    """Oldest first, one at a time per number. Before every send the drainer takes the number's
    gap slot through the same _claim_gap compare-and-set as every other sender (so a drip or a
    rerouted row that used this number a moment ago is respected); after each real send it
    sleeps the gap its next send will claim."""
    cfg = await get_wa_settings(db)
    done = 0
    gap = _jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"]))    # the gap the next send claims
    while _now() < deadline:
        now_iso = _iso(_now())
        token = uuid.uuid4().hex
        row = await db.wa_messages.find_one_and_update(
            {"status": "queued", "instance_name": name, "send_after": {"$lte": now_iso}},
            {"$set": {"status": "sending", "claimed_at": now_iso, "claim_token": token},
             "$inc": {"claim_count": 1}},
            sort=[("created_at", 1)], projection={"_id": 0})
        if not row:
            break
        # `row` is the document before the claim; carry the claim so every write is fenced by it.
        row.update({"status": "sending", "claimed_at": now_iso, "claim_token": token,
                    "claim_count": int(row.get("claim_count") or 0) + 1})
        # It goes through the SAME path as a fresh send (ruling 3): the sender is re-resolved
        # (the owner's number may have gone down since it was queued) and every check runs
        # again — opt-out, consent, hours, caps, gap.
        try:
            res = await _route_and_send(db, row, cfg, from_queue=True, gap_s=gap)
        except ClaimLost as e:
            log.warning("[wa-queue] %s", e)
            continue
        except Exception as e:
            log.error("[wa-queue] %s on %s: %s", row.get("message_id"), name, str(e)[:160])
            cur = await db.wa_messages.find_one({"message_id": row["message_id"], "claim_token": token},
                                                {"_id": 0}) or {}
            if cur.get("status") == "sending" and not cur.get("sending_at"):
                await _release_unsent(db, cur, _now(), str(e)[:120] or type(e).__name__,
                                      retry_at=_now() + timedelta(minutes=DRAIN_ERROR_RETRY_MINUTES))
            # else: the provider was called — the sweeper settles it (never resent)
            done += 1
            continue
        if res["status"] == "queued" and res["reason"] == "gap" and res["instance_name"] == name:
            # Someone else sent from this number inside the gap: wait for the slot if this pass
            # still has time, else leave it queued with send_after = the slot.
            opens = _parse(row["send_after"])
            if opens > deadline:
                break
            await _sleep(max(0.5, (opens - _now()).total_seconds()))
            continue
        done += 1
        if res["status"] == "sent":
            gap = _jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"]))
            await _sleep(gap)
    return done
