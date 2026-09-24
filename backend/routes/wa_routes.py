"""WhatsApp team numbers (spec 2026-09-24, W1): the per-instance webhook (this block) and the
/wa routes for "My WhatsApp" and Settings → WhatsApp (appended in Task 7)."""
import hmac
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException, Request

from database import db
from services import wa_send

router = APIRouter()
log = logging.getLogger("wa_routes")


def _now_iso() -> str:
    return wa_send._iso(wa_send._now())


# ══ Webhook ═══════════════════════════════════════════════════════════════════

_STATUS_RANK = {"queued": 0, "sending": 0, "sent": 1, "delivered": 2, "read": 3, "played": 3}
_FAILABLE = ("queued", "sending", "sent")            # a receipt may fail a message only before delivery
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


def _event_name(raw) -> str:
    return str(raw or "").strip().upper().replace(".", "_")


@router.post("/webhooks/whatsapp/{instance}")
async def wa_instance_webhook(instance: str, request: Request, t: str = ""):
    """Evolution → us, one URL per instance (set by EvolutionClient.set_webhook).

    The shared secret is checked BEFORE the body is read, and an unset secret refuses
    everything (never an open door). `payload.instance` is never trusted over the path.
    Anything we accept but cannot use is answered 200: Evolution retries non-2xx forever."""
    secret = os.getenv("WA_WEBHOOK_SECRET", "")
    if not secret or not hmac.compare_digest(str(t or "").encode(), secret.encode()):
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
            await db.wa_instances.update_one({"instance_name": name}, {"$set": {
                "state": "unlinked", "state_at": now, "qr_base64": "", "evolution_state": "open",
                "paused_reason": f"+{phone} is already linked as {other}. Link a different company SIM."}})
            await wa_send.alert(
                db, emails=[inst.get("owner_email"), clash.get("owner_email")] + await wa_send.admin_emails(db),
                title="WhatsApp number already linked",
                body=(f"+{phone} was scanned on {inst.get('label') or name}, but it is already linked as "
                      f"{other}. The new link was undone — one number can be linked only once."),
                dedup_key=f"wa_dup:{name}:{phone}", ref_id=name)
            return
    sets = {"state": "paused" if inst.get("state") == "paused" else "connected", "state_at": now,
            "qr_base64": "", "evolution_state": "open"}
    if data.get("profileName"):
        sets["profile_name"] = str(data["profileName"])[:120]
    if phone:
        sets.update({"phone_e164": phone, "jid": f"{phone}@s.whatsapp.net"})
        if phone != inst.get("phone_e164") or not inst.get("warmup_started_at"):
            sets["warmup_started_at"] = now          # a new SIM starts its own warm-up (D5)
    await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})


async def _on_close(inst: dict, data: dict) -> None:
    name = inst["instance_name"]
    if inst.get("state") == "unlinked":
        await db.wa_instances.update_one({"instance_name": name}, {"$set": {"evolution_state": "close"}})
        return
    raw = str(data.get("statusReason") or "0")
    code = int(raw) if raw.isdigit() else 0
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
    company = inst.get("kind") == "company"
    title = "Company WhatsApp disconnected" if company else "A WhatsApp number disconnected"
    body = (f"{_who(inst)} (+{inst.get('phone_e164') or '?'}) disconnected."
            + (" Messages for unowned records are held until it is relinked." if company
               else " Its messages go from the company number until it is relinked on My WhatsApp."))
    await wa_send.alert(db, emails=([] if company else [inst.get("owner_email")]) + await wa_send.admin_emails(db),
                        title=title, body=body,
                        dedup_key=f"wa_close:{name}:{wa_send.ist_day(wa_send._now())}", ref_id=name)


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


def _lower_than(new: str, rank: dict, failable) -> list:
    """The statuses a row may move FROM to reach `new` (forward-only)."""
    if new == "failed":
        return list(failable)
    return [s for s, r in rank.items() if r < rank.get(new, -1)]


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
        # One atomic, conditional write: two receipts racing can never move a row backwards.
        sets = {"status": new}
        if new == "failed":
            sets["fail_reason"] = "receipt: ERROR"
        await db.wa_messages.update_one(
            {"instance_name": name, "provider_msg_id": pmid,
             "status": {"$in": _lower_than(new, _STATUS_RANK, _FAILABLE)}},
            {"$set": sets, "$push": {"status_history": {"status": new, "at": now, "reason": "receipt"}}})
        # Campaign rows sent before W1 carry the provider id on whatsapp_scheduled.
        await db.whatsapp_scheduled.update_many(
            {"wa_message_id": pmid,
             "$or": [{"status": {"$in": _lower_than(new, _LEGACY_RANK, ("pending", "sent"))}},
                     {"status": {"$exists": False}}]},
            {"$set": {"status": new, "updated_at": now}})


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
    if await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid}, {"_id": 1}):
        return
    remote = str(key.get("remoteJid") or "")
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
        pass                    # our own send (or a duplicate delivery) wrote it first — one row


# ── MESSAGES_UPSERT (W1 stub) ─────────────────────────────────────────────────

async def _on_messages_upsert(inst: dict, data) -> None:
    """W1 STUB. Inbound messages are only KEPT here, raw, for W2's ingest (spec W2 "Ingest"),
    which replaces this handler in _HANDLERS and back-fills from wa_events_raw. Any
    wa_messages row W2 creates must carry a `message_id` of ours (`wam_<uuid>`) — see
    _on_send_message."""
    await db.wa_events_raw.insert_one({"instance_name": inst["instance_name"], "event": "MESSAGES_UPSERT",
                                       "data": data, "received_at": _now_iso(), "processed": False})


_HANDLERS = {
    "CONNECTION_UPDATE": _on_connection_update,
    "QRCODE_UPDATED": _on_qrcode_updated,
    "MESSAGES_UPDATE": _on_messages_update,
    "SEND_MESSAGE": _on_send_message,
    "MESSAGES_UPSERT": _on_messages_upsert,
}
