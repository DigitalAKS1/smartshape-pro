"""WhatsApp team numbers (spec 2026-09-24, W1): the per-instance webhook (this block) and the
/wa routes for "My WhatsApp" and Settings → WhatsApp (appended in Task 7)."""
import hmac
import logging
import os
import re
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth_utils import get_current_user
from database import db
from rbac import get_team
from services import wa_send
from services.evolution_client import EvolutionError, instance_token
from services.wa_config import (COMPANY_INSTANCE, PRIVACY_NOTICE, RAM_HEADROOM_MIN_MB, SLOT_STATES,
                                WaSettingsError, get_wa_settings, rep_instance_name, save_wa_settings)

router = APIRouter()
log = logging.getLogger("wa_routes")


def _now_iso() -> str:
    return wa_send._iso(wa_send._now())


# ══ Webhook ═══════════════════════════════════════════════════════════════════

_lower_than = wa_send._lower_than
_ACK_BY_INT = {0: "ERROR", 1: "PENDING", 2: "SERVER_ACK", 3: "DELIVERY_ACK", 4: "READ", 5: "PLAYED"}
_ACK_TO_STATUS = {"SERVER_ACK": "sent", "DELIVERY_ACK": "delivered", "READ": "read", "PLAYED": "read",
                  "ERROR": "failed"}
_TERMINAL_CLOSE = {
    401: "WhatsApp logged this number out (unlinked from the phone, or banned).",
    403: "WhatsApp refused this number (it may be banned).",
    440: "This number was opened on another device and this session was replaced.",
}
# Legacy whatsapp_scheduled statuses (pre-W1 campaigns) — same forward-only order.
_LEGACY_RANK = {"pending": 0, "sent": 1, "delivered": 2, "read": 3}
_SECRET_HEADER = "x-wa-secret"          # evolution_client.WEBHOOK_SECRET_HEADER (headers are case-insensitive)


def _event_name(raw) -> str:
    return str(raw or "").strip().upper().replace(".", "_")


def _same(given, secret: str) -> bool:
    return bool(given) and hmac.compare_digest(str(given).encode(), secret.encode())


# ── Access-log masking ────────────────────────────────────────────────────────

_T_PARAM = re.compile(r"([?&]t=)[^&\s\"']*")
_MASK = r"\g<1>***"


class MaskWebhookSecret(logging.Filter):
    """Masks `t=<secret>` in access-log lines. Webhooks registered before fix round 1 still carry
    the secret in `?t=` until they are re-registered with the X-WA-Secret header."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and "t=" in record.msg:
            record.msg = _T_PARAM.sub(_MASK, record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_T_PARAM.sub(_MASK, a) if isinstance(a, str) and "t=" in a else a
                                for a in record.args)
        return True


def install_access_log_mask() -> None:
    """Idempotent. Called from main.py's startup hook (after uvicorn has configured logging)."""
    lg = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, MaskWebhookSecret) for f in lg.filters):
        lg.addFilter(MaskWebhookSecret())


@router.post("/webhooks/whatsapp/{instance}")
async def wa_instance_webhook(instance: str, request: Request, t: str = ""):
    """Evolution → us, one URL per instance (set by EvolutionClient.set_webhook).

    The shared secret comes in the X-WA-Secret header (registered by set_webhook); `?t=` is a
    fallback for webhooks registered before the header existed. It is checked BEFORE the body
    is read, and an unset secret refuses everything (never an open door). `payload.instance`
    is never trusted over the path. When the payload carries `apikey` (Evolution sends the
    instance's token), it must equal the stored `instance_token` — the Task 12 runbook
    verifies Evolution sends it; when absent it is allowed. Anything we accept but cannot use
    is answered 200: Evolution retries non-2xx forever."""
    secret = os.getenv("WA_WEBHOOK_SECRET", "")
    headers = getattr(request, "headers", None) or {}
    if not secret or not (_same(headers.get(_SECRET_HEADER), secret) or _same(t, secret)):
        raise HTTPException(status_code=401, detail="bad webhook secret")
    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "ignored": "bad_json"}
    if not isinstance(payload, dict):
        return {"ok": True, "ignored": "bad_json"}
    claimed = payload.get("instance")
    if claimed and claimed != instance:
        log.warning("[wa-webhook] payload instance %r does not match the path %r — rejected",
                    str(claimed)[:60], instance[:60])
        raise HTTPException(status_code=400, detail="instance mismatch")
    inst = await db.wa_instances.find_one({"instance_name": instance}, {"_id": 0})
    if not inst:
        # Acknowledge so Evolution stops retrying; write nothing (RF1).
        log.warning("[wa-webhook] event for unknown instance %r ignored", instance[:60])
        return {"ok": True, "ignored": "unknown_instance"}
    apikey = payload.get("apikey")
    if apikey:
        stored = inst.get("instance_token") or ""
        if not stored:
            log.debug("[wa-webhook] %s has no stored instance_token; apikey not verified", instance[:60])
        elif not _same(apikey, stored):
            log.warning("[wa-webhook] apikey does not match the token of %r — rejected", instance[:60])
            raise HTTPException(status_code=401, detail="bad instance apikey")
    event = _event_name(payload.get("event"))
    await db.wa_instances.update_one({"instance_name": instance}, {"$set": {"last_seen_at": _now_iso()}})
    handler = _HANDLERS.get(event)
    if not handler:
        return {"ok": True, "ignored": event or "no_event"}
    await handler(inst, payload.get("data"))
    return {"ok": True}


# ── CONNECTION_UPDATE ─────────────────────────────────────────────────────────

def _who(inst: dict) -> str:
    if inst.get("kind") == "company":
        return "The company WhatsApp number"
    return f"{inst.get('label') or inst.get('owner_email') or inst['instance_name']}'s WhatsApp number"


async def _on_open(inst: dict, data: dict) -> None:
    name = inst["instance_name"]
    now = _now_iso()
    jid = str(data.get("wuid") or "")
    if not jid:
        try:
            jid = str((await wa_send._client().fetch_instance(name)).get("ownerJid") or "")
        except Exception as e:
            log.warning("[wa-webhook] could not read the owner of %s: %s", name, str(e)[:120])
    phone = jid.split("@")[0].split(":")[0]
    if phone:
        clean_jid = f"{phone}@s.whatsapp.net"
        clash = await db.wa_instances.find_one(
            {"$or": [{"phone_e164": phone}, {"jid": clean_jid}], "instance_name": {"$ne": name},
             "state": {"$in": ["connected", "paused", "disconnected"]}}, {"_id": 0})
        if clash:                                                    # RF2: one SIM, one instance
            try:
                await wa_send._client().logout(name, token=inst.get("instance_token") or None)
            except Exception as e:
                log.warning("[wa-webhook] logout of duplicate %s failed: %s", name, str(e)[:120])
            other = clash.get("label") or clash["instance_name"]
            detail = f"+{phone} is already linked as {other}. Link a different company SIM."
            sets = {"state": "unlinked", "state_at": now, "qr_base64": "", "evolution_state": "open",
                    "unlinked_reason": "duplicate_number", "unlinked_detail": detail}
            if inst.get("state") == "paused":
                # An admin's pause survives: its reason is kept, and the next successful link
                # comes back `paused`, not `connected` (only an admin resumes).
                sets["paused_before_unlink"] = True
            else:
                sets["paused_reason"] = detail
            await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
            await wa_send.alert(
                db, emails=[inst.get("owner_email"), clash.get("owner_email")] + await wa_send.admin_emails(db),
                title="WhatsApp number already linked",
                body=(f"+{phone} was scanned on {inst.get('label') or name}, but it is already linked as "
                      f"{other}. The new link was undone — one number can be linked only once."),
                dedup_key=f"wa_dup:{name}:{phone}", ref_id=name)
            return
    stay_paused = inst.get("state") == "paused" or bool(inst.get("paused_before_unlink"))
    sets = {"state": "paused" if stay_paused else "connected", "state_at": now,
            "qr_base64": "", "evolution_state": "open"}
    if data.get("profileName"):
        sets["profile_name"] = str(data["profileName"])[:120]
    if phone:
        sets.update({"phone_e164": phone, "jid": f"{phone}@s.whatsapp.net"})
        if phone != inst.get("phone_e164") or not inst.get("warmup_started_at"):
            sets["warmup_started_at"] = now          # a new SIM starts its own warm-up (D5)
    await db.wa_instances.update_one({"instance_name": name}, {
        "$set": sets, "$unset": {"unlinked_reason": "", "unlinked_detail": "", "paused_before_unlink": ""}})
    if phone:
        # One phone, one instance: a number no longer live elsewhere (a stale QR or an unlinked
        # row that still remembers it) forgets it.
        await db.wa_instances.update_many(
            {"instance_name": {"$ne": name}, "state": {"$in": ["qr", "unlinked"]},
             "$or": [{"phone_e164": phone}, {"jid": f"{phone}@s.whatsapp.net"}]},
            {"$unset": {"phone_e164": "", "jid": ""}})


async def _on_close(inst: dict, data: dict) -> None:
    name = inst["instance_name"]
    if inst.get("state") == "unlinked":
        await db.wa_instances.update_one({"instance_name": name}, {"$set": {"evolution_state": "close"}})
        return
    raw = str(data.get("statusReason") or "0")
    code = int(raw) if raw.isdigit() else 0
    if inst.get("state") == "qr":
        # Not linked yet: a close here is our own relink's logout or a QR that expired — never a
        # ban and never `disconnected`. The state and the cached QR stay; only the reason is kept.
        try:
            ours = bool(inst.get("logout_requested_at")) and (
                wa_send._parse(inst["logout_requested_at"]) > wa_send._now() - timedelta(minutes=2))
        except Exception:
            ours = False
        await db.wa_instances.update_one({"instance_name": name}, {"$set": {
            "evolution_state": "close", "last_close_reason": "logout_requested" if ours else str(code)}})
        return
    if code in _TERMINAL_CLOSE:
        # Permanent: pause (only an admin resumes) and alert the owner + admins.
        await db.wa_instances.update_one({"instance_name": name}, {"$set": {"evolution_state": "close"}})
        await wa_send.pause_instance(db, inst, reason=_TERMINAL_CLOSE[code])
        return
    now = _now_iso()
    was = inst.get("state")
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "state": "paused" if was == "paused" else "disconnected", "state_at": now, "evolution_state": "close"}})
    if was not in ("connected", "paused"):
        return                       # a QR that timed out, or already down: nothing new to tell anyone
    # ONE alert per number per IST day: an atomic claim on the instance, independent of whether
    # the previous bell was read, and safe against concurrent close events.
    day = wa_send.ist_day(wa_send._now())
    claim = await db.wa_instances.update_one({"instance_name": name, "close_alert_day": {"$ne": day}},
                                             {"$set": {"close_alert_day": day}})
    if getattr(claim, "modified_count", 0) != 1:
        return
    company = inst.get("kind") == "company"
    title = "Company WhatsApp disconnected" if company else "A WhatsApp number disconnected"
    body = (f"{_who(inst)} (+{inst.get('phone_e164') or '?'}) disconnected."
            + (" Messages for unowned records are held until it is relinked." if company
               else " Its messages go from the company number until it is relinked on My WhatsApp."))
    await wa_send.alert(db, emails=([] if company else [inst.get("owner_email")]) + await wa_send.admin_emails(db),
                        title=title, body=body,
                        dedup_key=f"wa_close:{name}:{day}", ref_id=name)


async def _on_connection_update(inst: dict, data) -> None:
    data = data if isinstance(data, dict) else {}
    state = str(data.get("state") or "").lower()
    if state == "open":
        await _on_open(inst, data)
    elif state == "close":
        await _on_close(inst, data)
    else:
        # "connecting": Baileys is dialling — not a state change for us.
        await db.wa_instances.update_one({"instance_name": inst["instance_name"]},
                                         {"$set": {"evolution_state": state or "unknown"}})


# ── QRCODE_UPDATED ────────────────────────────────────────────────────────────

async def _on_qrcode_updated(inst: dict, data) -> None:
    data = data if isinstance(data, dict) else {}
    qr = data.get("qrcode") if isinstance(data.get("qrcode"), dict) else data
    b64 = str(qr.get("base64") or "")
    if not b64:
        return
    now = _now_iso()
    sets = {"qr_base64": b64, "qr_at": now}
    if inst.get("state") not in ("connected", "paused", "unlinked"):
        sets.update({"state": "qr", "state_at": now})
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": sets})


# ── MESSAGES_UPDATE (receipts) ────────────────────────────────────────────────

def _ack_status(raw) -> str:
    if isinstance(raw, int) or (isinstance(raw, str) and raw.isdigit()):
        raw = _ACK_BY_INT.get(int(raw), "")
    return _ACK_TO_STATUS.get(str(raw or "").upper(), "")


async def _on_messages_update(inst: dict, data) -> None:
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    name = inst["instance_name"]
    now = _now_iso()
    for item in items:
        if not isinstance(item, dict):
            continue
        # 2.3.x: {keyId, status}; older: {key: {id}, update: {status}}. `messageId` is
        # Evolution's own DB id, not WhatsApp's — never used as the key.
        pmid = str(item.get("keyId") or (item.get("key") or {}).get("id") or "")
        raw = item.get("status") if item.get("status") is not None else (item.get("update") or {}).get("status")
        new = _ack_status(raw)
        if not pmid or not new:
            continue
        res = await wa_send.apply_receipt(db, name, pmid, new, now)
        # Campaign rows sent before W1 carry the provider id on whatsapp_scheduled.
        legacy = await db.whatsapp_scheduled.update_many(
            {"wa_message_id": pmid,
             "$or": [{"status": {"$in": _lower_than(new, _LEGACY_RANK, ("pending", "sent"))}},
                     {"status": {"$exists": False}}]},
            {"$set": {"status": new, "updated_at": now}})
        if getattr(res, "matched_count", 0) or getattr(legacy, "matched_count", 0):
            continue
        # Nothing moved. Park it only when NO row holds the id (an ignored regression is not parked).
        if not await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid}, {"_id": 1})                 and not await db.whatsapp_scheduled.find_one({"wa_message_id": pmid}, {"_id": 1}):
            await _park_receipt(name, pmid, new)


async def _park_receipt(name: str, pmid: str, new: str) -> None:
    """No row holds this provider id yet: most likely our own send is still `sending` (the
    provider answered, _finish has not written the id). Park it; wa_send._finish applies it.
    The re-check afterwards closes the gap where _finish wrote the id (and found nothing
    parked) between our lookup and this insert. Unclaimed receipts expire after a day (TTL)."""
    await db.wa_receipts_pending.insert_one({"instance_name": name, "provider_msg_id": pmid,
                                             "status": new, "at": wa_send._now()})
    if await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid}, {"_id": 1}):
        await wa_send.apply_parked_receipts(db, {"instance_name": name, "provider_msg_id": pmid})


# ── SEND_MESSAGE (sent from the phone) ────────────────────────────────────────

def _text_of(message) -> str:
    m = message if isinstance(message, dict) else {}
    return str(m.get("conversation")
               or (m.get("extendedTextMessage") or {}).get("text")
               or (m.get("imageMessage") or {}).get("caption")
               or (m.get("videoMessage") or {}).get("caption")
               or (m.get("documentMessage") or {}).get("caption") or "")


async def _on_send_message(inst: dict, data) -> None:
    """A message this number sent. Our own API sends already have their row (wa_send._finish
    merges into this placeholder if the webhook wins the race, and returns THIS row's
    message_id — so it carries one of ours); a message typed on the phone gets one
    `source: "phone"` row, keyed by provider id (D9). W2 fills contact/lead/school."""
    from pymongo.errors import DuplicateKeyError
    d = data if isinstance(data, dict) else {}
    key = d.get("key") or {}
    pmid = str(key.get("id") or "")
    if not pmid or key.get("fromMe") is False:
        return
    name = inst["instance_name"]
    remote = str(key.get("remoteJid") or "")
    if remote.endswith("@g.us") or remote == "status@broadcast" or inst.get("state") != "connected":
        log.debug("[wa-webhook] SEND_MESSAGE on %s to %s ignored (group/status, or not connected: %s)",
                  name, remote[:40], inst.get("state"))
        return
    if await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid}, {"_id": 1}):
        return
    now = wa_send._now()
    try:
        await db.wa_messages.update_one({"instance_name": name, "provider_msg_id": pmid}, {"$setOnInsert": {
            "message_id": f"wam_{uuid.uuid4().hex[:16]}", "instance_name": name, "provider_msg_id": pmid,
            "chat_id": f"{name}:{remote}", "direction": "out", "from_jid": inst.get("jid") or "",
            "to_jid": remote, "to_e164": remote.split("@")[0] if remote.endswith("@s.whatsapp.net") else "",
            "contact_id": "", "lead_id": "", "school_id": "", "kind": "chat", "ref": {},
            "text": _text_of(d.get("message")), "media": None, "quoted_provider_msg_id": None,
            "typed_by": None, "owner_email": inst.get("owner_email") or "",
            "sent_via_owner_email": inst.get("owner_email") or "", "sender_kind": inst.get("kind") or "",
            "provider": "evolution", "status": "sent",
            "status_history": [{"status": "sent", "at": wa_send._iso(now), "reason": "sent from the phone"}],
            "fail_reason": "", "source": "phone", "created_at": wa_send._iso(now),
            "sent_at": wa_send._iso(now), "sent_day": wa_send.ist_day(now),
            "provider_ts": d.get("messageTimestamp")}}, upsert=True)
    except DuplicateKeyError:
        return                  # our own send (or a duplicate delivery) wrote it first — one row
    # A receipt may have beaten this event here (parked by _on_messages_update).
    await wa_send.apply_parked_receipts(db, {"instance_name": name, "provider_msg_id": pmid})


# ── MESSAGES_UPSERT (W1 stub) ─────────────────────────────────────────────────

async def _on_messages_upsert(inst: dict, data) -> None:
    """W1 STUB. Inbound messages are only KEPT here, raw, for W2's ingest (spec W2 "Ingest"),
    which replaces this handler in _HANDLERS and back-fills from wa_events_raw. Any
    wa_messages row W2 creates must carry a `message_id` of ours (`wam_<uuid>`) — see
    _on_send_message."""
    await db.wa_events_raw.insert_one({"instance_name": inst["instance_name"], "event": "MESSAGES_UPSERT",
                                       "data": data, "received_at": wa_send._now(),   # datetime: TTL 30 days
                                       "processed": False})


_HANDLERS = {
    "CONNECTION_UPDATE": _on_connection_update,
    "QRCODE_UPDATED": _on_qrcode_updated,
    "MESSAGES_UPDATE": _on_messages_update,
    "SEND_MESSAGE": _on_send_message,
    "MESSAGES_UPSERT": _on_messages_upsert,
}


# ══ /wa routes: My WhatsApp, admin numbers, settings, default proxy (Task 7) ══════

QR_REFRESH_SECONDS = 20
HEALTH_FRESH_MINUTES = 30        # an older wa_health reading is shown but never blocks a link
_PROXY_PROTOCOLS = ("http", "https", "socks4", "socks5")


def _evo():
    return wa_send._client()


def _is_admin(user: dict) -> bool:
    # The same admin test used everywhere else (crm_routes._is_admin): the owner's account
    # (role "admin", no module_permissions) always passes, as does a multi-role admin.
    return get_team(user) == "admin" or user.get("role") == "admin"


def _require_admin(user: dict) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only an admin can manage WhatsApp numbers")


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
    except Exception:
        b = {}
    return b if isinstance(b, dict) else {}


def _notice_accepted(body: dict) -> bool:
    # `notice_accepted` (the brief) and `accept_notice` (the ruling) are both accepted.
    return body.get("notice_accepted") is True or body.get("accept_notice") is True


def _as_bool(v) -> bool:
    """A real boolean from JSON or a form: "false", "0", "no", "off", "" and 0 are False."""
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes", "on")
    return bool(v)


def _require_secret() -> None:
    if not os.getenv("WA_WEBHOOK_SECRET"):
        raise HTTPException(500, "WA_WEBHOOK_SECRET is not set on the server, so replies and receipts "
                                 "would be refused. Finish the WhatsApp setup runbook first.")


def _mask_proxy(p) -> dict:
    """Never returns the password — only whether one is saved."""
    p = p or {}
    return {"host": p.get("host", ""), "port": p.get("port", ""), "protocol": p.get("protocol") or "socks5",
            "username": p.get("username", ""), "has_password": bool(p.get("password"))}


def _clean_proxy(body: dict, saved) -> dict:
    """{} = no proxy (blank host). A blank password keeps the saved one."""
    host = str(body.get("host") or "").strip()
    if not host:
        return {}
    proto = str(body.get("protocol") or "socks5").lower()
    if proto not in _PROXY_PROTOCOLS:
        raise HTTPException(400, "protocol must be http, https, socks4 or socks5")
    try:
        port = int(body.get("port"))
    except (TypeError, ValueError):
        port = 0
    if not 1 <= port <= 65535:
        raise HTTPException(400, "port must be a number from 1 to 65535")
    return {"host": host, "port": port, "protocol": proto, "username": str(body.get("username") or "").strip(),
            "password": str(body.get("password") or "") or (saved or {}).get("password", "")}


async def _my_instance(email: str):
    """The rep's ONE number: users.wa_instance_name, else a rep row they own (never the company row)."""
    u = await db.users.find_one({"email": wa_send._email_q(email)}, {"_id": 0, "wa_instance_name": 1}) or {}
    inst = None
    if u.get("wa_instance_name"):
        inst = await db.wa_instances.find_one({"instance_name": u["wa_instance_name"]}, {"_id": 0})
    if inst is None:
        inst = await db.wa_instances.find_one({"kind": "rep", "owner_email": wa_send._email_q(email)}, {"_id": 0})
    return inst


async def _instance_or_404(name: str) -> dict:
    inst = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "No such WhatsApp number")
    return inst


async def _used_slots() -> int:
    return await db.wa_instances.count_documents({"state": {"$in": list(SLOT_STATES)}})


async def _health() -> dict:
    """settings{type:"wa_health"}, written by the host script (Task 8)."""
    h = await db.settings.find_one({"type": "wa_health"}, {"_id": 0}) or {}
    h.pop("type", None)
    try:
        avail = int(h["mem_available_mb"]) if h.get("mem_available_mb") is not None else None
    except (TypeError, ValueError):
        avail = None
    try:
        fresh = wa_send._parse(h["at"]) > wa_send._now() - timedelta(minutes=HEALTH_FRESH_MINUTES)
    except Exception:
        fresh = False
    return {**h, "headroom_ok": avail is None or avail >= RAM_HEADROOM_MIN_MB, "fresh": fresh,
            "min_headroom_mb": RAM_HEADROOM_MIN_MB}


async def _require_capacity(cfg: dict, *, check_ram: bool = True) -> None:
    """Linking a number that does not hold a slot yet: refuse past max_instances, or when the
    server's latest (fresh) memory reading is below the D7 headroom."""
    cap = int(cfg["max_instances"])
    if await _used_slots() >= cap:
        raise HTTPException(409, f"All {cap} WhatsApp slots on this server are in use. Unlink a number, "
                                 "or ask an admin — more numbers need a bigger server.")
    if check_ram:
        h = await _health()
        if h["fresh"] and not h["headroom_ok"]:
            raise HTTPException(409, f"The server has only {h.get('mem_available_mb')} MB of free memory; "
                                     f"linking another number needs at least {RAM_HEADROOM_MIN_MB} MB. "
                                     "Ask an admin.")


async def _view(inst: dict, cfg: dict) -> dict:
    """What the UI shows for one number. Never carries instance_token, the QR or proxy password."""
    now = wa_send._now()
    led = await db.wa_send_ledger.find_one(
        {"instance_name": inst["instance_name"], "day": wa_send.ist_day(now)}, {"_id": 0}) or {}
    day = wa_send.warmup_day(inst, now)
    sent = int(led.get("sent_count", 0))
    cap = wa_send.daily_cap(inst, cfg, now)
    return {
        "instance_name": inst["instance_name"], "kind": inst.get("kind"), "owner_email": inst.get("owner_email") or "",
        "label": inst.get("label") or "", "phone_e164": inst.get("phone_e164") or "", "state": inst.get("state"),
        "state_at": inst.get("state_at"), "last_seen_at": inst.get("last_seen_at"),
        "paused_reason": inst.get("paused_reason") or "", "paused_by": inst.get("paused_by") or "",
        "unlinked_detail": inst.get("unlinked_detail") or "",
        "consecutive_failures": int(inst.get("consecutive_failures") or 0),
        # "Day 4 of 14 — today 40 of 60": nested (brief) and flat (ruling 5).
        "warmup": {"day": day, "of": int(cfg["warmup_days"]), "today_sent": sent, "today_cap": cap},
        "warmup_day": day, "sent_today": sent, "cap_today": cap,
        "daily_cap_override": inst.get("daily_cap_override"),
        "proxy": _mask_proxy(inst.get("proxy")),
        "notice_accepted_at": inst.get("notice_accepted_at"),
    }


async def _looks_personal(inst: dict, email: str) -> bool:
    """D1: warn (never block) when the linked number is the rep's own phone on their profile."""
    linked = (inst.get("phone_e164") or "")[-10:]
    if not linked:
        return False
    u = await db.users.find_one({"email": wa_send._email_q(email)}, {"_id": 0, "phone": 1, "calling_number": 1}) or {}
    mine = {re.sub(r"\D", "", str(u.get(k) or ""))[-10:] for k in ("phone", "calling_number")}
    return linked in mine


async def _fresh_qr(inst: dict) -> str:
    at = inst.get("qr_at")
    try:
        young = bool(at) and wa_send._parse(at) > wa_send._now() - timedelta(seconds=QR_REFRESH_SECONDS)
    except Exception:
        young = False
    if inst.get("qr_base64") and young:
        return inst["qr_base64"]
    try:
        qr = await _evo().get_qr(inst["instance_name"], token=inst.get("instance_token") or None)
    except Exception as e:
        log.warning("[wa] QR refresh for %s failed: %s", inst["instance_name"], str(e)[:120])
        return inst.get("qr_base64") or ""
    b64 = str((qr or {}).get("base64") or "")
    if b64:
        await db.wa_instances.update_one({"instance_name": inst["instance_name"]},
                                         {"$set": {"qr_base64": b64, "qr_at": _now_iso()}})
    return b64 or inst.get("qr_base64") or ""


async def _default_proxy() -> dict:
    d = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    if not (d.get("enabled") and d.get("host")):
        return {}
    return {k: d.get(k, "") for k in ("host", "port", "protocol", "username", "password")}


async def _provision(name: str, *, kind: str, owner_email: str, label: str,
                     accepted_by: Optional[str]) -> dict:
    """Create (or reuse) the Evolution instance, point its webhook at us, apply its proxy, and
    return a QR to scan. The number becomes `connected` when CONNECTION_UPDATE: open arrives.
    `accepted_by=None` (a relink re-creating a vanished instance) keeps the recorded notice."""
    _require_secret()
    existing = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}) or {}
    token = existing.get("instance_token") or ""
    evo = _evo()
    try:
        token = instance_token(await evo.create_instance(name)) or token
    except EvolutionError as e:
        if e.status_code not in (403, 409):                 # 403/409 = the name already exists: reuse it
            raise HTTPException(502, f"The WhatsApp server refused to create the number: {str(e)[:160]}")
        if not token:
            try:
                token = str((await evo.fetch_instance(name)).get("token") or "")
            except Exception:
                token = ""
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server is not answering: {str(e)[:120]}")
    proxy = existing.get("proxy") or {}
    if not proxy.get("host"):
        proxy = await _default_proxy()
    try:
        await evo.set_webhook(name)
        if proxy.get("host"):
            await evo.set_proxy(name, proxy)
        qr = await evo.get_qr(name, token=token or None)
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server could not prepare the QR code: {str(e)[:120]}")
    b64 = str((qr or {}).get("base64") or "")
    now = _now_iso()
    sets = {"kind": kind, "owner_email": owner_email, "label": label, "state": "qr", "state_at": now,
            "qr_base64": b64, "qr_at": now, "instance_token": token, "proxy": proxy,
            "consecutive_failures": 0}
    if accepted_by is not None:
        sets.update({"notice_accepted_at": now, "notice_accepted_by": accepted_by})
    if not existing.get("paused_before_unlink"):
        sets["paused_reason"] = ""          # an admin's pause survives an unlink/relink (Task 6)
    await db.wa_instances.update_one({"instance_name": name}, {
        "$set": sets,
        "$unset": {"unlinked_reason": "", "unlinked_detail": ""},
        "$setOnInsert": {"phone_e164": "", "jid": "", "warmup_started_at": None, "daily_cap_override": None,
                         "last_seen_at": None, "created_at": now}}, upsert=True)
    if kind == "rep":
        await db.users.update_one({"email": wa_send._email_q(owner_email)}, {"$set": {"wa_instance_name": name}})
    return {"instance_name": name, "state": "qr", "qr_base64": b64}


def _needs_admin_resume(inst: dict) -> bool:
    """Any pause - an admin's or the system's (failure streak, 401/403/440 close) - is cleared
    ONLY by an admin's resume. A rep's relink/unlink never clears it."""
    return inst.get("state") == "paused" or bool(inst.get("paused_before_unlink"))


async def _relink(inst: dict) -> dict:
    """Log the old session out and show a fresh QR. The state moves to `qr` BEFORE the logout, so
    the CONNECTION_UPDATE close that the logout triggers is not read as a ban or a disconnect
    (_on_close records it as `logout_requested`). When Evolution no longer has the instance
    (404), it is created again (_provision). Never called on a paused number."""
    _require_secret()
    name, tok = inst["instance_name"], inst.get("instance_token") or None
    now = _now_iso()
    sets = {"state": "qr", "state_at": now, "qr_base64": "", "consecutive_failures": 0,
            "logout_requested_at": now}
    if not inst.get("paused_before_unlink"):
        sets.update({"paused_reason": "", "paused_by": ""})
    await db.wa_instances.update_one({"instance_name": name}, {
        "$set": sets, "$unset": {"unlinked_reason": "", "unlinked_detail": ""}})
    evo = _evo()
    try:
        await evo.logout(name, token=tok)
    except Exception:
        pass                                               # already logged out
    try:
        await evo.set_webhook(name)                        # re-register: header secret (Task 6 fix)
    except Exception as e:
        log.warning("[wa] webhook re-register for %s failed: %s", name, str(e)[:120])
    try:
        qr = await evo.get_qr(name, token=tok)             # /instance/connect: starts a new session
    except EvolutionError as e:
        if e.status_code == 404:                           # the instance is gone on Evolution
            return await _provision(name, kind=inst.get("kind") or "rep",
                                    owner_email=inst.get("owner_email") or "",
                                    label=inst.get("label") or name, accepted_by=None)
        raise HTTPException(502, f"The WhatsApp server could not prepare the QR code: {str(e)[:120]}")
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server could not prepare the QR code: {str(e)[:120]}")
    b64 = str((qr or {}).get("base64") or "")
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {"qr_base64": b64, "qr_at": _now_iso()}})
    return {"instance_name": name, "state": "qr", "qr_base64": b64}


async def _unlink(inst: dict, by: str) -> dict:
    """Frees the slot. The state moves to `unlinked` BEFORE the logout (see _relink). Any pause
    survives: the next link comes back `paused` (Task 6 paused_before_unlink) until an admin resumes."""
    name = inst["instance_name"]
    keep_pause = _needs_admin_resume(inst)
    sets = {"state": "unlinked", "state_at": _now_iso(), "qr_base64": "", "unlinked_by": by,
            "consecutive_failures": 0}
    if keep_pause:
        sets["paused_before_unlink"] = True
    else:
        sets["paused_reason"] = ""
    await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
    try:
        await _evo().logout(name, token=inst.get("instance_token") or None)
    except Exception:
        pass
    return {"instance_name": name, "state": "unlinked"}


# ── My WhatsApp ──────────────────────────────────────────────────────────────

@router.get("/wa/me")
async def wa_me(request: Request):
    user = await get_current_user(request)
    cfg = await get_wa_settings(db)
    inst = await _my_instance(user["email"])
    if not inst or inst.get("state") == "unlinked":
        return {"linked": False, "state": "unlinked", "notice": PRIVACY_NOTICE,
                "instance_name": (inst or {}).get("instance_name", ""),
                "slots_full": await _used_slots() >= int(cfg["max_instances"]),
                "paused_reason": (inst or {}).get("paused_reason", ""),
                "needs_admin_resume": bool(inst) and _needs_admin_resume(inst),
                "unlinked_detail": (inst or {}).get("unlinked_detail", "")}
    out = {"linked": True, **await _view(inst, cfg), "notice": PRIVACY_NOTICE,
           "needs_admin_resume": _needs_admin_resume(inst),
           "looks_personal": await _looks_personal(inst, user["email"])}
    if inst.get("state") == "qr":
        out["qr_base64"] = await _fresh_qr(inst)
    return out


@router.post("/wa/me/link")
async def wa_me_link(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    if not _notice_accepted(body):
        raise HTTPException(400, "Read and accept the notice before linking a number.")
    cfg = await get_wa_settings(db)
    inst = await _my_instance(user["email"])
    if inst and inst.get("state") != "unlinked":
        # One number per rep: never a second instance — report the one they have.
        out = {"instance_name": inst["instance_name"], "state": inst.get("state"), "already_linked": True}
        if inst.get("state") == "qr":
            out["qr_base64"] = await _fresh_qr(inst)
        return out
    await _require_capacity(cfg)
    name = inst["instance_name"] if inst else rep_instance_name(user)
    return await _provision(name, kind="rep", owner_email=user["email"],
                            label=str(body.get("label") or user.get("name") or user["email"])[:60],
                            accepted_by=user["email"])


@router.post("/wa/me/relink")
async def wa_me_relink(request: Request):
    user = await get_current_user(request)
    inst = await _my_instance(user["email"])
    if not inst:
        raise HTTPException(404, "You have no linked number yet.")
    if inst.get("state") == "paused":
        why = inst.get("paused_reason") or "it was paused"
        raise HTTPException(409, f"This number is paused ({why}). Only an admin can resume it "
                                 "in Settings -> WhatsApp; then relink here.")
    if inst.get("state") == "unlinked":
        await _require_capacity(await get_wa_settings(db))
    return await _relink(inst)


@router.post("/wa/me/unlink")
async def wa_me_unlink(request: Request):
    user = await get_current_user(request)
    inst = await _my_instance(user["email"])
    if not inst:
        raise HTTPException(404, "You have no linked number.")
    if inst.get("state") == "unlinked":
        return {"instance_name": inst["instance_name"], "state": "unlinked"}
    return await _unlink(inst, user["email"])


# ── Admin: every number ──────────────────────────────────────────────────────

@router.get("/wa/instances")
async def wa_instances_list(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    cfg = await get_wa_settings(db)
    rows = await db.wa_instances.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
    names = {}
    async for u in db.users.find({}, {"_id": 0, "email": 1, "name": 1}):
        names[str(u.get("email") or "").strip().lower()] = u.get("name", "")
    views = []
    for inst in rows:
        v = await _view(inst, cfg)
        v["owner_name"] = names.get((inst.get("owner_email") or "").strip().lower(), "")
        views.append(v)
    return {"instances": views, "max_instances": int(cfg["max_instances"]),
            "used": sum(1 for i in rows if i.get("state") in SLOT_STATES),
            "company_instance": COMPANY_INSTANCE, "health": await _health(), "settings": cfg}


@router.post("/wa/instances/company")
async def wa_link_company(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    body = await _body(request)
    if not _notice_accepted(body):
        raise HTTPException(400, "Read and accept the notice before linking a number.")
    _require_secret()
    cfg = await get_wa_settings(db)
    name = COMPANY_INSTANCE
    existing = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}) or {}
    holds_slot = existing.get("state") in SLOT_STATES
    evo = _evo()
    try:
        state = await evo.connection_state(name)
    except Exception:
        state = "close"
    if state == "open":
        # The number linked before the upgrade survives it: adopt it, no new QR.
        if not holds_slot:
            await _require_capacity(cfg, check_ram=False)      # already running: no new memory
        try:
            info = await evo.fetch_instance(name)
        except Exception:
            info = {}
        jid = str(info.get("ownerJid") or "")
        phone = jid.split("@")[0].split(":")[0]
        try:
            await evo.set_webhook(name)
        except Exception as e:
            raise HTTPException(502, f"Could not point the company number's webhook at the app: {str(e)[:120]}")
        now = _now_iso()
        stay_paused = existing.get("state") == "paused" or bool(existing.get("paused_before_unlink"))
        new_state = "paused" if stay_paused else "connected"
        sets = {"kind": "company", "owner_email": user["email"], "label": existing.get("label") or "Company",
                "state": new_state, "state_at": now, "qr_base64": "", "evolution_state": "open",
                "instance_token": str(info.get("token") or "") or existing.get("instance_token") or "",
                "notice_accepted_at": now, "notice_accepted_by": user["email"]}
        if phone:
            sets.update({"phone_e164": phone, "jid": f"{phone}@s.whatsapp.net"})
        if phone and existing.get("phone_e164") and phone != existing["phone_e164"]:
            sets["warmup_started_at"] = now              # a different SIM starts its own warm-up (D5)
        elif not existing.get("warmup_started_at"):
            # Already connected and sending before the upgrade: treat it as warmed, not day 1.
            sets["warmup_started_at"] = wa_send._iso(
                wa_send._now() - timedelta(days=int(cfg.get("warmup_days") or 14)))
        await db.wa_instances.update_one({"instance_name": name}, {
            "$set": sets,
            "$unset": {"paused_before_unlink": "", "unlinked_reason": "", "unlinked_detail": ""},
            "$setOnInsert": {"proxy": {}, "daily_cap_override": None, "consecutive_failures": 0,
                             "paused_reason": "", "last_seen_at": None, "created_at": now}},
            upsert=True)
        return {"instance_name": name, "state": new_state, "phone_e164": phone}
    if existing.get("state") == "qr":
        return {"instance_name": name, "state": "qr", "qr_base64": await _fresh_qr(existing)}
    if not holds_slot:
        await _require_capacity(cfg)
    return await _provision(name, kind="company", owner_email=user["email"],
                            label=existing.get("label") or "Company", accepted_by=user["email"])


@router.post("/wa/instances/{name}/pause")
async def wa_instance_pause(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    if inst.get("state") == "unlinked":
        raise HTTPException(409, "This number is not linked, so there is nothing to pause.")
    reason = str((await _body(request)).get("reason") or f"Paused by {user.get('name') or user['email']}")[:200]
    await wa_send.pause_instance(db, inst, reason=reason, by=user["email"])
    return {"instance_name": name, "state": "paused"}


@router.post("/wa/instances/{name}/resume")
async def wa_instance_resume(name: str, request: Request):
    """Clears the pause and the failure streak. The state follows Evolution: connected when the
    session is open, else disconnected (relink from My WhatsApp)."""
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    clear = {"consecutive_failures": 0, "paused_reason": "", "paused_by": "", "resumed_by": user["email"]}
    if inst.get("state") in ("unlinked", "qr"):
        await db.wa_instances.update_one({"instance_name": name}, {
            "$set": clear, "$unset": {"paused_before_unlink": ""}})
        return {"instance_name": name, "state": inst.get("state")}
    try:
        st = await _evo().connection_state(name, token=inst.get("instance_token") or None)
    except Exception:
        st = "close"
    new = "connected" if st == "open" else "disconnected"
    await db.wa_instances.update_one({"instance_name": name}, {
        "$set": {**clear, "state": new, "state_at": _now_iso()}, "$unset": {"paused_before_unlink": ""}})
    return {"instance_name": name, "state": new}


@router.post("/wa/instances/{name}/unlink")
async def wa_instance_unlink(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    if inst.get("state") == "unlinked":
        return {"instance_name": name, "state": "unlinked"}
    return await _unlink(inst, user["email"])


@router.put("/wa/instances/{name}/proxy")
async def wa_instance_proxy(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    proxy = _clean_proxy(await _body(request), inst.get("proxy"))
    try:
        await _evo().set_proxy(name, proxy or None, token=inst.get("instance_token") or None)
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server refused the proxy: {str(e)[:120]}")
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {"proxy": proxy}})
    return {"instance_name": name, "proxy": _mask_proxy(proxy)}


@router.put("/wa/instances/{name}")
async def wa_instance_update(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    await _instance_or_404(name)
    body = await _body(request)
    sets = {}
    if "label" in body:
        sets["label"] = str(body.get("label") or "")[:60]
    if "daily_cap_override" in body:
        v = body.get("daily_cap_override")
        if v in (None, ""):
            sets["daily_cap_override"] = None
        else:
            try:
                iv = int(v)
            except (TypeError, ValueError):
                iv = 0
            if not 1 <= iv <= 2000:
                raise HTTPException(400, "daily_cap_override must be 1-2000, or empty for the warm-up ramp")
            sets["daily_cap_override"] = iv
    if sets:
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
    return await _view(await _instance_or_404(name), await get_wa_settings(db))


@router.get("/wa/settings")
async def wa_settings_get(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    return await get_wa_settings(db)


@router.put("/wa/settings")
async def wa_settings_put(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    try:
        return await save_wa_settings(db, await _body(request), by=user["email"])
    except WaSettingsError as e:
        raise HTTPException(400, str(e))


# ── Default proxy (the endpoint the old Settings form called; it 404'd on main) ──

@router.get("/whatsapp/proxy-config")
async def wa_proxy_config_get(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    doc = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    return {"enabled": bool(doc.get("enabled")), **_mask_proxy(doc)}


@router.post("/whatsapp/proxy-config")
async def wa_proxy_config_save(request: Request):
    """The default proxy applied to a newly linked number. Existing numbers keep theirs
    (PUT /wa/instances/{name}/proxy changes one)."""
    user = await get_current_user(request)
    _require_admin(user)
    body = await _body(request)
    saved = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    proxy = _clean_proxy(body, saved)
    doc = {"type": "wa_proxy_default", "enabled": _as_bool(body.get("enabled", True)) and bool(proxy),
           **(proxy or {"host": "", "port": "", "protocol": "socks5", "username": "", "password": ""}),
           "updated_by": user["email"], "updated_at": _now_iso()}
    await db.settings.update_one({"type": "wa_proxy_default"}, {"$set": doc}, upsert=True)
    return {"enabled": doc["enabled"], **_mask_proxy(doc)}
