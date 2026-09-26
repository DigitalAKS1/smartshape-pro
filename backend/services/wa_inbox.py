"""W2 ingest: one Evolution MESSAGES_UPSERT event -> one wa_messages row, one wa_chats upsert
(spec W2 "Ingest", D9: one row per (instance, provider message id); media is re-hosted on our
own storage, never left as WhatsApp's encrypted reference).

    ingest_message(db, inst, data)
        normalise_upsert  -> the row-to-be (pure)
        match_record      -> contact / lead / school by the last 10 digits of the phone
        insert            -> $setOnInsert keyed (instance_name, provider_msg_id); a duplicate
                             delivery returns {"duplicate": True} and touches nothing else
        store_media       -> download through Evolution, save through services.storage
        upsert_chat       -> the chat row (skipped for groups / statuses / newsletters)
        engagement event  -> inbound only, only when a record matched
        wa_events.publish -> {"type": "message_new", ...}

    backfill_raw_events(db) -> the W1 stub parked inbound events raw; run them through ingest once.
"""
import base64
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from services import storage, wa_events, wa_send

log = logging.getLogger("wa_inbox")

HIDDEN_SUFFIXES = ("@g.us", "@newsletter", "@broadcast")      # groups, channels, status@broadcast
_MEDIA_KEYS = (("imageMessage", "image"), ("videoMessage", "video"), ("audioMessage", "audio"),
               ("documentMessage", "document"), ("stickerMessage", "sticker"))
_EXT = {"image": "jpg", "video": "mp4", "audio": "mp3", "document": "bin", "sticker": "webp"}
# Common WhatsApp mimetypes first: mimetypes.guess_extension is platform-dependent (the Windows
# registry, /etc/mime.types) and answers None for "audio/ogg; codecs=opus".
_MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
             "video/mp4": "mp4", "video/3gpp": "3gp", "audio/ogg": "ogg", "audio/mpeg": "mp3",
             "audio/mp4": "m4a", "audio/aac": "aac", "application/pdf": "pdf"}
# Baileys wraps the real message under `.message` for these.
_WRAPPERS = ("ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
             "documentWithCaptionMessage", "editedMessage")
_EMPTY_MATCH = {"contact_id": "", "lead_id": "", "school_id": "", "display_name": ""}
PREVIEW_LEN = 120


# ── Pure helpers ──────────────────────────────────────────────────────────────

def norm10(phone) -> str:
    """Digits only, the last 10 when there are at least 10 (crm_routes._norm_phone, re-implemented
    here so the service never imports a route module)."""
    d = re.sub(r"\D", "", str(phone or ""))
    return d[-10:] if len(d) >= 10 else d


def _phone_regex(n10: str) -> dict:
    """Matches a stored phone whose digits END with `n10`, however it was typed: '98000 00001',
    '+91-98000-00001', '098000 00001' all match '9800000001'."""
    return {"$regex": r"\D*".join(re.escape(c) for c in n10) + r"\D*$"}


def _text_of(message) -> str:
    """Moved verbatim from routes/wa_routes.py (W1); wa_routes imports it back from here."""
    m = message if isinstance(message, dict) else {}
    return str(m.get("conversation")
               or (m.get("extendedTextMessage") or {}).get("text")
               or (m.get("imageMessage") or {}).get("caption")
               or (m.get("videoMessage") or {}).get("caption")
               or (m.get("documentMessage") or {}).get("caption") or "")


def _unwrap(message) -> dict:
    """`{"ephemeralMessage": {"message": {...}}}` (and the other wrappers) -> the inner message."""
    m = message if isinstance(message, dict) else {}
    for _ in range(4):
        wrapped = next((m[k] for k in _WRAPPERS if isinstance(m.get(k), dict)), None)
        if wrapped is None or not isinstance(wrapped.get("message"), dict):
            return m
        m = wrapped["message"]
    return m


def _media_ref(message) -> Optional[dict]:
    m = message if isinstance(message, dict) else {}
    for key, mtype in _MEDIA_KEYS:
        part = m.get(key)
        if isinstance(part, dict):
            return {"type": mtype, "mime": str(part.get("mimetype") or "").split(";")[0].strip(),
                    "filename": str(part.get("fileName") or ""), "caption": str(part.get("caption") or "")}
    return None


def _quoted(message) -> Optional[str]:
    m = message if isinstance(message, dict) else {}
    for part in m.values():
        if isinstance(part, dict) and isinstance(part.get("contextInfo"), dict):
            sid = part["contextInfo"].get("stanzaId")
            if sid:
                return str(sid)
    return None


def _provider_ts(raw) -> Optional[str]:
    """messageTimestamp: int seconds, a digit string, or a protobuf Long {"low", "high"} -> UTC ISO."""
    if isinstance(raw, dict):
        raw = int(raw.get("low") or 0) + (int(raw.get("high") or 0) << 32)
    try:
        ts = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    if ts > 10 ** 11:                        # milliseconds
        ts //= 1000
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def normalise_upsert(inst: dict, data: dict) -> Optional[dict]:
    """Pure. The row-to-be for one 2.3.x MESSAGES_UPSERT `data` item, or None when it carries no
    key id (nothing to key a row on)."""
    d = data if isinstance(data, dict) else {}
    key = d.get("key") if isinstance(d.get("key"), dict) else {}
    pmid = str(key.get("id") or "").strip()
    if not pmid:
        return None
    remote = str(key.get("remoteJid") or "").strip()
    if remote.endswith("@lid"):
        # A linked-device id: the real number rides along as remoteJidAlt (on data or on key).
        alt = str(d.get("remoteJidAlt") or key.get("remoteJidAlt") or "").strip()
        if alt:
            remote = alt
    hidden = remote.endswith(HIDDEN_SUFFIXES)
    phone = ""
    if remote.endswith("@s.whatsapp.net"):
        # The JID's user part is the full international number without '+': add it so a
        # foreign number survives to_e164 (which keeps only internationally written numbers).
        phone = wa_send.to_e164("+" + remote.split("@")[0].split(":")[0])
    msg = _unwrap(d.get("message"))
    media_ref = _media_ref(msg)
    return {
        "provider_msg_id": pmid,
        "direction": "in" if not key.get("fromMe") else "out",
        "remote_jid": remote,
        "hidden": hidden,
        "phone_e164": phone,
        "push_name": str(d.get("pushName") or "")[:120],
        "text": (_text_of(msg) or (media_ref or {}).get("caption") or "").strip(),
        "media_ref": media_ref,
        "quoted_provider_msg_id": _quoted(msg),
        "provider_ts": _provider_ts(d.get("messageTimestamp")),
        "raw_type": str(d.get("messageType") or ""),
    }


# ── Record matching ───────────────────────────────────────────────────────────

async def match_record(db, phone_e164: str) -> dict:
    """{"contact_id", "lead_id", "school_id", "display_name"} for the phone's last 10 digits:
    a non-deleted contact first (one with an owner preferred), then a lead, then a school.
    The collections are small and the phone fields carry every formatting: a separator-tolerant
    regex, no new index."""
    n = norm10(phone_e164)
    out = dict(_EMPTY_MATCH)
    if len(n) < 8:
        return out
    rx = _phone_regex(n)
    contacts = await db.contacts.find(
        {"is_deleted": {"$ne": True}, "$or": [{"phone": rx}, {"mobile": rx}, {"whatsapp": rx}]},
        {"_id": 0, "contact_id": 1, "name": 1, "school_id": 1, "assigned_to": 1}).to_list(20)
    contacts = [c for c in contacts if c.get("contact_id")]
    if contacts:
        c = sorted(contacts, key=lambda c: 0 if c.get("assigned_to") else 1)[0]
        out.update({"contact_id": c["contact_id"], "school_id": c.get("school_id") or "",
                    "display_name": str(c.get("name") or "")})
        return out
    lead = await db.leads.find_one(
        {"is_deleted": {"$ne": True}, "$or": [{"phone": rx}, {"contact_phone": rx}]},
        {"_id": 0, "lead_id": 1, "contact_id": 1, "school_id": 1, "contact_name": 1, "company_name": 1})
    if lead and lead.get("lead_id"):
        out.update({"lead_id": lead["lead_id"], "contact_id": lead.get("contact_id") or "",
                    "school_id": lead.get("school_id") or "",
                    "display_name": str(lead.get("contact_name") or lead.get("company_name") or "")})
        return out
    school = await db.schools.find_one(
        {"is_deleted": {"$ne": True}, "$or": [{"phone": rx}, {"contact_phone": rx}]},
        {"_id": 0, "school_id": 1, "school_name": 1, "name": 1})
    if school and school.get("school_id"):
        out.update({"school_id": school["school_id"],
                    "display_name": str(school.get("school_name") or school.get("name") or "")})
    return out


# ── The chat row ──────────────────────────────────────────────────────────────

def _preview(row: dict) -> str:
    media = row.get("media") or row.get("media_ref")
    if media:
        cap = (row.get("text") or media.get("caption") or "").strip()
        return (f"📎 {media.get('type') or 'file'}" + (f" · {cap}" if cap else ""))[:PREVIEW_LEN]
    return (row.get("text") or "")[:PREVIEW_LEN]


async def upsert_chat(db, inst: dict, row: dict, *, inbound: bool, match: dict) -> dict:
    """One wa_chats row per (instance, remote jid). A record link already on the chat is never
    overwritten (a person may have linked it by hand); a resolved chat that receives an inbound
    message goes back to `open`; unread_count grows only on inbound."""
    name = inst["instance_name"]
    remote = row["remote_jid"]
    chat_id = row.get("chat_id") or f"{name}:{remote}"
    existing = await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0}) or {}
    match = match or {}
    at = row.get("provider_ts") or row.get("created_at") or wa_send._iso(wa_send._now())
    sets = {"last_message_at": at, "last_message_preview": _preview(row),
            "last_direction": row.get("direction") or ("in" if inbound else "out"),
            "last_message_id": row.get("message_id") or "", "hidden": bool(row.get("hidden")),
            "updated_at": wa_send._iso(wa_send._now())}
    if row.get("phone_e164") and not existing.get("phone_e164"):
        sets["phone_e164"] = row["phone_e164"]
    linked = any(existing.get(k) for k in ("contact_id", "lead_id", "school_id"))
    if not linked:
        # Fill the links only while the chat has none — never over a manual link.
        for k in ("contact_id", "lead_id", "school_id"):
            if match.get(k):
                sets[k] = match[k]
    name_now = (match.get("display_name") if not linked else "") or ""
    if not existing.get("display_name") or (not linked and name_now):
        sets["display_name"] = name_now or existing.get("display_name") or row.get("push_name") or row.get("phone_e164") or remote
    if row.get("push_name"):
        sets["push_name"] = row["push_name"]
    if inbound and existing.get("status") == "resolved":
        sets["status"] = "open"
    on_insert = {"chat_id": chat_id, "instance_name": name, "remote_jid": remote,
                 "created_at": wa_send._iso(wa_send._now()), "status": "open",
                 "assignee_email": inst.get("owner_email") or "", "notes": []}
    # A field may sit in $set OR $setOnInsert, never both (Mongo rejects the conflict).
    for k in ("contact_id", "lead_id", "school_id", "phone_e164"):
        if k not in sets:
            on_insert[k] = ""
    if not inbound:
        on_insert["unread_count"] = 0           # inbound: $inc creates it as 1 on insert
    update = {"$set": sets, "$setOnInsert": on_insert}
    if inbound:
        update["$inc"] = {"unread_count": 1}
    try:
        await db.wa_chats.update_one({"chat_id": chat_id}, update, upsert=True)
    except DuplicateKeyError:
        # Two events for a brand-new chat raced on the unique chat_id: the other insert won;
        # apply this event's $set/$inc onto it.
        update.pop("$setOnInsert", None)
        await db.wa_chats.update_one({"chat_id": chat_id}, update)
    return await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0}) or {"chat_id": chat_id}


# ── Media ─────────────────────────────────────────────────────────────────────

def _ext_for(filename: str, mime: str, mtype: str) -> str:
    if filename and "." in filename:
        ext = re.sub(r"[^A-Za-z0-9]", "", filename.rsplit(".", 1)[1])[:8].lower()
        if ext:
            return ext
    m = (mime or "").split(";")[0].strip().lower()
    if m in _MIME_EXT:
        return _MIME_EXT[m]
    guess = mimetypes.guess_extension(m) if m else None
    if guess:
        return guess.lstrip(".").lower()
    return _EXT.get(mtype, "bin")


def _decode_b64(raw) -> bytes:
    s = str(raw or "").strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1]
    s = re.sub(r"\s", "", s)
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s)


async def store_media(inst: dict, provider_msg_id: str, media_ref: dict) -> Optional[dict]:
    """Download the media through Evolution and re-host it on our storage. On any failure the
    row still gets a media stub (`pending: True`, `url: ""`) — never WhatsApp's encrypted URL (D9)."""
    if not media_ref:
        return None
    mtype = media_ref.get("type") or "document"
    caption = media_ref.get("caption") or ""
    name = inst["instance_name"]
    try:
        res = await wa_send._client().get_media_base64(
            name, provider_msg_id, convert_to_mp4=(mtype == "audio"), token=inst.get("instance_token") or None)
        res = res if isinstance(res, dict) else {}
        data = _decode_b64(res.get("base64"))
        if not data:
            raise ValueError("empty media payload")
        mime = (str(res.get("mimetype") or media_ref.get("mime") or "").split(";")[0].strip()
                or mimetypes.guess_type(str(res.get("fileName") or media_ref.get("filename") or ""))[0]
                or "application/octet-stream")
        fname = str(res.get("fileName") or media_ref.get("filename") or "").strip()
        ext = _ext_for(fname, mime, mtype)
        path = f"whatsapp/in/{name}/{provider_msg_id}.{ext}"
        url = await storage.save_upload(path, data, mime)
        return {"type": mtype, "url": url, "mime": mime, "filename": fname or f"{provider_msg_id}.{ext}",
                "size": len(data), "caption": caption}
    except Exception as e:
        log.warning("[wa-inbox] media for %s on %s not stored: %s", provider_msg_id, name, str(e)[:160])
        return {"type": mtype, "caption": caption, "url": "", "pending": True,
                "error": str(e)[:160] or type(e).__name__}


# ── Ingest ────────────────────────────────────────────────────────────────────

def _build_row(inst: dict, n: dict, match: dict) -> dict:
    """Every W1 field a wa_messages row carries (routes/wa_routes._on_send_message) plus W2's."""
    now = wa_send._now()
    now_iso = wa_send._iso(now)
    name = inst["instance_name"]
    inbound = n["direction"] == "in"
    own_jid = inst.get("jid") or ""
    status = "delivered" if inbound else "sent"
    row = {
        "message_id": f"wam_{uuid.uuid4().hex[:16]}", "instance_name": name, "provider_msg_id": n["provider_msg_id"],
        "chat_id": f"{name}:{n['remote_jid']}", "direction": n["direction"],
        "from_jid": n["remote_jid"] if inbound else own_jid, "to_jid": own_jid if inbound else n["remote_jid"],
        "to_e164": n["phone_e164"], "phone_e164": n["phone_e164"], "remote_jid": n["remote_jid"],
        "contact_id": match.get("contact_id") or "", "lead_id": match.get("lead_id") or "",
        "school_id": match.get("school_id") or "", "kind": "chat", "ref": {},
        "text": n["text"], "media": None, "quoted_provider_msg_id": n["quoted_provider_msg_id"],
        "typed_by": None, "owner_email": inst.get("owner_email") or "",
        "sent_via_owner_email": inst.get("owner_email") or "", "sender_kind": inst.get("kind") or "",
        "provider": "evolution", "status": status,
        "status_history": [{"status": status, "at": now_iso,
                            "reason": "received" if inbound else "sent from the phone"}],
        "fail_reason": "", "source": "webhook" if inbound else "phone", "created_at": now_iso,
        "provider_ts": n["provider_ts"], "hidden": n["hidden"], "push_name": n["push_name"],
        "raw_type": n["raw_type"],
    }
    if inbound:
        row["received_at"] = now_iso
    else:
        row["sent_at"] = now_iso
        row["sent_day"] = wa_send.ist_day(now)
    return row


async def _log_inbound_event(row: dict) -> None:
    if not (row.get("contact_id") or row.get("lead_id") or row.get("school_id")):
        return                                  # nothing to attach it to
    from services.engagement import log_engagement_event
    media = row.get("media") or {}
    await log_engagement_event(
        channel="whatsapp", kind="WhatsApp · reply",
        title=(row.get("text") or media.get("filename") or (f"📎 {media['type']}" if media.get("type") else "")
               or "WhatsApp")[:100],
        school_id=row.get("school_id") or "", lead_id=row.get("lead_id") or "",
        contact_id=row.get("contact_id") or "", status="received", direction="in",
        by=row.get("push_name") or row.get("phone_e164") or "WhatsApp",
        at=row.get("received_at") or row.get("created_at"),
        meta={"message_id": row["message_id"], "instance_name": row.get("instance_name") or "",
              "provider_msg_id": row.get("provider_msg_id") or "", "kind": "chat"},
        dedup_key=f"wa:{row['message_id']}")


async def ingest_message(db, inst: dict, data: dict) -> Optional[dict]:
    """The one entry point. Returns the stored row, {"duplicate": True} for a provider id already
    held, or None when the event carries nothing to store. A list `data` (Evolution sometimes
    batches) ingests every item and returns the last item's result."""
    if isinstance(data, list):
        last = None
        for item in data:
            last = await ingest_message(db, inst, item)
        return last
    n = normalise_upsert(inst, data)
    if n is None:
        return None
    name = inst["instance_name"]
    match = await match_record(db, n["phone_e164"]) if (n["phone_e164"] and not n["hidden"]) else dict(_EMPTY_MATCH)
    row = _build_row(inst, n, match)
    key = {"instance_name": name, "provider_msg_id": n["provider_msg_id"]}
    try:
        res = await db.wa_messages.update_one(key, {"$setOnInsert": row}, upsert=True)
    except DuplicateKeyError:
        return {"duplicate": True}
    if getattr(res, "upserted_id", None) is None:
        return {"duplicate": True}              # a second delivery (or W1's phone row): one row, no side effects
    inbound = n["direction"] == "in"
    if n["media_ref"]:
        row["media"] = await store_media(inst, n["provider_msg_id"], n["media_ref"])
        try:
            await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": {"media": row["media"]}})
        except Exception as e:
            log.error("[wa-inbox] media not written on %s: %s", row["message_id"], str(e)[:160])
    chat = {}
    if not n["hidden"]:
        try:
            chat = await upsert_chat(db, inst, row, inbound=inbound, match=match)
        except Exception as e:
            log.error("[wa-inbox] chat upsert failed for %s: %s", row["message_id"], str(e)[:160])
        if inbound:
            try:
                await _log_inbound_event(row)
            except Exception as e:
                log.error("[wa-inbox] engagement event failed for %s: %s", row["message_id"], str(e)[:160])
    await wa_events.publish({
        "type": "message_new", "instance_name": name, "chat_id": row["chat_id"],
        "contact_id": chat.get("contact_id") or row["contact_id"], "lead_id": chat.get("lead_id") or row["lead_id"],
        "school_id": chat.get("school_id") or row["school_id"], "message_id": row["message_id"],
        "status": row["status"], "direction": row["direction"], "preview": _preview(row),
        "unread_count": int(chat.get("unread_count") or 0), "hidden": n["hidden"]})
    return row


# ── Back-fill of the W1 raw stub ──────────────────────────────────────────────

async def backfill_raw_events(db, *, limit: int = 500) -> int:
    """Run the MESSAGES_UPSERT events the W1 stub parked in wa_events_raw through ingest, oldest
    first, marking each `processed`. An event that fails is marked `processed` WITH its error so
    the back-fill never loops on it. Returns how many events were marked this pass."""
    events = await db.wa_events_raw.find(
        {"processed": {"$ne": True}, "event": "MESSAGES_UPSERT"}).sort("received_at", 1).to_list(max(1, int(limit)))
    insts: dict = {}
    done = 0
    for ev in events:
        marks = {"processed": True, "processed_at": wa_send._iso(wa_send._now())}
        try:
            name = str(ev.get("instance_name") or "")
            inst = insts.get(name)
            if inst is None:
                inst = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})
                if not inst:
                    raise LookupError(f"unknown instance {name!r}")
                insts[name] = inst
            data = ev.get("data")
            items = data if isinstance(data, list) else [data]
            if not items or not all(isinstance(i, dict) for i in items):
                raise TypeError("malformed event data")
            for item in items:
                await ingest_message(db, inst, item)
        except Exception as e:
            marks["error"] = (str(e)[:200] or type(e).__name__)
            log.warning("[wa-inbox] backfill: raw event %s skipped: %s", ev.get("_id"), marks["error"])
        await db.wa_events_raw.update_one({"_id": ev["_id"]}, {"$set": marks})
        done += 1
    return done
