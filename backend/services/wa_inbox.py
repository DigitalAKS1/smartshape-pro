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
        wa_events.publish -> {"type": "message_new", ...} (never for a hidden row)

    backfill_raw_events(db)        -> the W1 stub parked inbound events raw; run them through ingest once.
    touch_chat_after_send(db, row) -> wa_send._finish: an app send lands on its chat.
    sync_history(db, inst)         -> W2 task 5: the last 90 days of chats on first link (wa_routes._on_open).
        ingest_message(..., quiet=True, history=True) for every record: no engagement event, no bus
        event, no unread bump, media deferred to W4 (a stub is written, never 5,000 Evolution calls).
"""
import base64
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timedelta, timezone
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
# Message keys that carry no content a person reads: the row is kept (D9) but makes no chat.
_NO_CONTENT_KEYS = frozenset({"reactionMessage", "protocolMessage", "pollUpdateMessage",
                              "senderKeyDistributionMessage", "messageContextInfo"})
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
    """messageTimestamp: int/float seconds, a numeric string, milliseconds (> 1e11), or a protobuf
    Long {"low", "high"} -> UTC ISO. None when absent or unreadable."""
    if isinstance(raw, dict):
        raw = int(raw.get("low") or 0) + (int(raw.get("high") or 0) << 32)
    try:
        ts = int(float(str(raw).strip()))
    except (TypeError, ValueError, OverflowError):
        return None
    if ts <= 0:
        return None
    if ts > 10 ** 11:                        # milliseconds
        ts //= 1000
    try:
        return datetime.fromtimestamp(ts, timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _is_contentless(msg: dict) -> bool:
    """A reaction, a protocol message (delete/edit/history sync), a poll vote, a sender-key
    distribution or an empty wrapper: nothing a person would read in the inbox."""
    if not isinstance(msg, dict) or not msg:
        return True
    return not (set(msg.keys()) - _NO_CONTENT_KEYS)


def normalise_upsert(inst: dict, data: dict) -> Optional[dict]:
    """Pure. The row-to-be for one 2.3.x MESSAGES_UPSERT `data` item, or None when it carries no
    key id or no remote jid (nothing to key a row on / no chat to hang it on)."""
    d = data if isinstance(data, dict) else {}
    key = d.get("key") if isinstance(d.get("key"), dict) else {}
    pmid = str(key.get("id") or "").strip()
    remote = str(key.get("remoteJid") or "").strip()
    if not pmid or not remote:
        return None
    lid = ""
    if remote.endswith("@lid"):
        # A linked-device id: the real number rides along as remoteJidAlt / senderPn (on data or
        # on key). With no alt the chat is keyed by the lid itself (W4 merges it into the phone chat).
        alt = str(d.get("remoteJidAlt") or key.get("remoteJidAlt") or key.get("senderPn")
                  or d.get("senderPn") or "").strip()
        if alt and alt.endswith("@s.whatsapp.net"):
            remote = alt
        else:
            lid = remote
    hidden = remote.endswith(HIDDEN_SUFFIXES)
    phone = ""
    if remote.endswith("@s.whatsapp.net"):
        # The JID's user part is the full international number without '+': add it so a
        # foreign number survives to_e164 (which keeps only internationally written numbers).
        phone = wa_send.to_e164("+" + remote.split("@")[0].split(":")[0])
    msg = _unwrap(d.get("message"))
    media_ref = _media_ref(msg)
    contentless = _is_contentless(msg)
    return {
        "provider_msg_id": pmid,
        "direction": "in" if not key.get("fromMe") else "out",
        "remote_jid": remote,
        "lid": lid,
        "hidden": hidden or contentless,
        "contentless": contentless,
        "phone_e164": phone,
        "push_name": str(d.get("pushName") or "")[:120],
        "text": (_text_of(msg) or (media_ref or {}).get("caption") or "").strip(),
        "media_ref": media_ref,
        "quoted_provider_msg_id": _quoted(msg),
        "provider_ts": _provider_ts(d.get("messageTimestamp")),
        "raw_type": str(d.get("messageType") or next(iter(msg), "") or ""),
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


def _history_row_is_latest(row: dict, existing: dict) -> bool:
    """W2 task 5 fix round 1: may a HISTORY row move the chat's `last_message_*`? Only when its
    `provider_ts` is newer than the chat's current `last_message_at`. History walks newest ->
    oldest, so without this the oldest row would win, and a live message that raced ahead of the
    import would be clobbered. A chat with no `last_message_at` yet takes the row (it is the only
    thing known). A row WITHOUT a provider timestamp (fix 5) is treated as older than anything
    already on the chat — it can never become the latest message of a chat that has one."""
    current = existing.get("last_message_at")
    if not current:
        return True
    ts = row.get("provider_ts")
    if not ts:
        return False
    try:
        return wa_send._parse(ts) > wa_send._parse(current)
    except (TypeError, ValueError):
        return False


def _chat_update(inst: dict, row: dict, existing: dict, *, inbound: bool, match: dict,
                 history: bool = False) -> dict:
    """Pure: the update document for one message landing on a chat (`existing` = the chat as it
    is now, {} for a new one). INVARIANT: no field is in both $set and $setOnInsert — real
    MongoDB rejects that (ConflictingUpdateOperators; mongomock does not), and `unread_count`
    is never in $setOnInsert on an inbound message because $inc creates it as 1 on insert.
    `history` (W2 task 5): a history-import row only moves `last_message_*` / `push_name` when
    it is newer than what the chat already shows (`_history_row_is_latest`); a live row always
    does (the webhook delivers in order)."""
    name = inst["instance_name"]
    remote = row["remote_jid"]
    chat_id = row.get("chat_id") or f"{name}:{remote}"
    existing = existing or {}
    match = match or {}
    now_iso = wa_send._iso(wa_send._now())
    latest = (not history) or _history_row_is_latest(row, existing)
    sets = {"hidden": bool(row.get("hidden")), "updated_at": now_iso}
    if latest:
        sets.update({"last_message_at": row.get("provider_ts") or row.get("created_at") or now_iso,
                     "last_message_preview": _preview(row),
                     "last_direction": row.get("direction") or ("in" if inbound else "out"),
                     "last_message_id": row.get("message_id") or ""})
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
        sets["display_name"] = (name_now or existing.get("display_name") or row.get("push_name")
                                or row.get("phone_e164") or remote)
    if row.get("push_name") and latest:
        sets["push_name"] = row["push_name"]
    if inbound and existing.get("status") == "resolved":
        sets["status"] = "open"
    on_insert = {"chat_id": chat_id, "instance_name": name, "remote_jid": remote, "created_at": now_iso,
                 "status": "open", "assignee_email": inst.get("owner_email") or "", "notes": [],
                 "contact_id": "", "lead_id": "", "school_id": "", "phone_e164": "", "unread_count": 0}
    if row.get("lid"):
        on_insert["lid"] = row["lid"]              # an unmapped @lid chat (W4 merges it into the phone chat)
    if inbound:
        on_insert.pop("unread_count", None)
    for k in sets:
        on_insert.pop(k, None)
    update = {"$set": sets, "$setOnInsert": on_insert}
    if inbound:
        update["$inc"] = {"unread_count": 1}
    return update


async def upsert_chat(db, inst: dict, row: dict, *, inbound: bool, match: dict, existing: Optional[dict] = None,
                      history: bool = False) -> dict:
    """One wa_chats row per (instance, remote jid). A record link already on the chat is never
    overwritten (a person may have linked it by hand); a resolved chat that receives an inbound
    message goes back to `open`; unread_count grows only on inbound. `existing` is the chat as
    the caller already read it (saves the read); None reads it here. `history` (W2 task 5): the
    row is a history import — it moves `last_message_*` only when newer than the chat's current
    latest (see `_chat_update`)."""
    chat_id = row.get("chat_id") or f"{inst['instance_name']}:{row['remote_jid']}"
    if existing is None:
        existing = await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0}) or {}
    update = _chat_update(inst, row, existing, inbound=inbound, match=match, history=history)
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
        "provider_ts": n["provider_ts"], "hidden": n["hidden"], "contentless": bool(n.get("contentless")),
        "lid": n.get("lid") or "", "push_name": n["push_name"], "raw_type": n["raw_type"],
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


async def ingest_message(db, inst: dict, data: dict, *, quiet: bool = False, history: bool = False) -> Optional[dict]:
    """The one entry point. Returns the stored row, {"duplicate": True} for a provider id already
    held, or None when the event carries nothing to store. A list `data` (Evolution sometimes
    batches) ingests every item and returns the last item's result.

    `quiet` (W2 task 5): no engagement event, nothing published on the bus — for a history import,
    where nobody should be notified of a message that already happened.
    `history` (W2 task 5): the chat upsert never bumps unread_count (last_direction still reflects
    the row's real direction — see `_chat_update`, which reads it off the row, not off `inbound`);
    media is never downloaded — a `{"pending": True, "skipped": "history", "url": ""}` stub is
    written instead, so importing thousands of history messages never calls Evolution once per
    message (W4 fetches history media lazily)."""
    if isinstance(data, list):
        last = None
        for item in data:
            last = await ingest_message(db, inst, item, quiet=quiet, history=history)
        return last
    n = normalise_upsert(inst, data)
    if n is None:
        return None
    name = inst["instance_name"]
    key = {"instance_name": name, "provider_msg_id": n["provider_msg_id"]}
    # Cheap early exit for a redelivery (Evolution retries; W1's SEND_MESSAGE row): saves the
    # record scan. The atomic $setOnInsert below is the real guard.
    if await db.wa_messages.find_one(key, {"_id": 1}):
        return {"duplicate": True}
    match = await match_record(db, n["phone_e164"]) if (n["phone_e164"] and not n["hidden"]) else dict(_EMPTY_MATCH)
    row = _build_row(inst, n, match)
    try:
        res = await db.wa_messages.update_one(key, {"$setOnInsert": row}, upsert=True)
    except DuplicateKeyError:
        return {"duplicate": True}
    if getattr(res, "upserted_id", None) is None:
        return {"duplicate": True}              # a second delivery (or W1's phone row): one row, no side effects
    inbound = n["direction"] == "in"
    if n["media_ref"]:
        if n["hidden"]:
            # A group / status / newsletter / content-less message: never download its media.
            row["media"] = {"type": n["media_ref"].get("type") or "document",
                            "caption": n["media_ref"].get("caption") or "", "url": "", "pending": True,
                            "skipped": "hidden"}
        elif history:
            # A history import: never download media inline (W2 task 5) — W4 fetches it lazily.
            row["media"] = {"type": n["media_ref"].get("type") or "document",
                            "caption": n["media_ref"].get("caption") or "", "url": "", "pending": True,
                            "skipped": "history"}
        else:
            row["media"] = await store_media(inst, n["provider_msg_id"], n["media_ref"])
        try:
            await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": {"media": row["media"]}})
        except Exception as e:
            log.error("[wa-inbox] media not written on %s: %s", row["message_id"], str(e)[:160])
    if n["hidden"]:
        # A reaction / protocol message, a group / status / newsletter: the row only (D9) —
        # no chat, no engagement event, and nothing on the bus (Task 3 ruling).
        return row
    chat = {}
    try:
        # A history row is never inbound as far as the chat is concerned (no unread bump) —
        # `_chat_update` still reads the real direction off `row["direction"]` for last_direction.
        chat = await upsert_chat(db, inst, row, inbound=(inbound and not history), match=match, history=history)
    except Exception as e:
        log.error("[wa-inbox] chat upsert failed for %s: %s", row["message_id"], str(e)[:160])
    if inbound and not quiet:
        try:
            await _log_inbound_event(row)
        except Exception as e:
            log.error("[wa-inbox] engagement event failed for %s: %s", row["message_id"], str(e)[:160])
    if not quiet:
        await wa_events.publish({
            "type": "message_new", "instance_name": name, "chat_id": row["chat_id"],
            "contact_id": chat.get("contact_id") or row["contact_id"], "lead_id": chat.get("lead_id") or row["lead_id"],
            "school_id": chat.get("school_id") or row["school_id"], "message_id": row["message_id"],
            "status": row["status"], "direction": row["direction"], "preview": _preview(row),
            "unread_count": int(chat.get("unread_count") or 0)})
    return row


# ── An app send landing on a chat (wa_send._finish / _finish_queued) ─────────

async def _display_name_for(db, links: dict) -> str:
    """The name a chat shows for a send to a record: the contact's, else the lead's, else the
    school's. Only read when the chat is being created (an existing name is never replaced)."""
    try:
        if links.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": links["contact_id"]}, {"_id": 0, "name": 1})
            if c and c.get("name"):
                return str(c["name"])
        if links.get("lead_id"):
            ld = await db.leads.find_one({"lead_id": links["lead_id"]}, {"_id": 0, "contact_name": 1, "company_name": 1})
            if ld and (ld.get("contact_name") or ld.get("company_name")):
                return str(ld.get("contact_name") or ld.get("company_name"))
        if links.get("school_id"):
            s = await db.schools.find_one({"school_id": links["school_id"]}, {"_id": 0, "school_name": 1, "name": 1})
            if s and (s.get("school_name") or s.get("name")):
                return str(s.get("school_name") or s.get("name"))
    except Exception as e:
        log.debug("[wa-inbox] display name lookup failed: %s", str(e)[:120])
    return ""


async def touch_chat_after_send(db, row: dict) -> dict:
    """A wa_messages row the send door just settled (sent / queued / failed / skipped) lands on
    its chat: last_message_* move (direction out, no unread bump). A chat that does not exist
    yet is created, linked to the row's contact / lead / school (a phone match when the row
    carries none) and named after that record. Returns the chat as stored ({} when the row has
    no chat to land on)."""
    chat_id = str(row.get("chat_id") or "")
    name = str(row.get("instance_name") or "")
    if not chat_id or not name or ":" not in chat_id:
        return {}
    remote = str(row.get("to_jid") or chat_id.split(":", 1)[1])
    existing = await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0}) or {}
    match = dict(_EMPTY_MATCH)
    if any(row.get(k) for k in ("contact_id", "lead_id", "school_id")):
        match.update({k: str(row.get(k) or "") for k in ("contact_id", "lead_id", "school_id")})
        if not existing:
            match["display_name"] = await _display_name_for(db, match)
    elif not existing and row.get("to_e164"):
        match = await match_record(db, row["to_e164"])
    inst = {"instance_name": name,
            "owner_email": row.get("sent_via_owner_email") or row.get("owner_email") or ""}
    r = {**row, "remote_jid": remote, "chat_id": chat_id, "direction": "out", "hidden": False,
         "phone_e164": row.get("to_e164") or "", "push_name": "", "lid": "",
         "provider_ts": row.get("sent_at") or row.get("created_at") or ""}
    return await upsert_chat(db, inst, r, inbound=False, match=match, existing=existing)


# ── Back-fill of the W1 raw stub ──────────────────────────────────────────────

async def backfill_raw_events(db, *, limit: int = 500) -> int:
    """Run the MESSAGES_UPSERT events the W1 stub parked in wa_events_raw through ingest, oldest
    first, marking each `processed`. A BAD event (malformed data, unknown instance, a value the
    normaliser cannot read) is marked `processed` WITH its error so the back-fill never loops on
    it; any other exception (a database/connection error) propagates so the next pass retries
    from the same event. Returns how many events were marked this pass.

    Runs `quiet`: the first W2 boot replays every event parked since W1 went live, and a burst of
    engagement events + `message_new` frames for messages that already happened would only be
    noise. Rows, chats and unread bumps are written as usual (the rows are not history — nobody
    has seen them yet)."""
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
                await ingest_message(db, inst, item, quiet=True)
        except (TypeError, LookupError, ValueError, AttributeError) as e:
            marks["error"] = (str(e)[:200] or type(e).__name__)
            log.warning("[wa-inbox] backfill: raw event %s skipped: %s", ev.get("_id"), marks["error"])
        await db.wa_events_raw.update_one({"_id": ev["_id"]}, {"$set": marks})
        done += 1
    return done


# ── History sync on first link (W2 task 5) ────────────────────────────────────

def _history_jid(chat: dict) -> str:
    """A `findChats` record's jid: `remoteJid` (Evolution 2.3.x), else `id` (some builds put the
    jid there)."""
    c = chat if isinstance(chat, dict) else {}
    return str(c.get("remoteJid") or c.get("id") or "").strip()


def _history_chat_sort_key(chat: dict) -> datetime:
    """Newest first: `updatedAt`, else `lastMessage.messageTimestamp`, else the epoch (last)."""
    c = chat if isinstance(chat, dict) else {}
    iso = c.get("updatedAt")
    if not iso:
        last = c.get("lastMessage")
        if isinstance(last, dict):
            iso = _provider_ts(last.get("messageTimestamp"))
    if iso:
        try:
            return wa_send._parse(iso)
        except Exception:
            pass
    return datetime.min.replace(tzinfo=timezone.utc)


def _page_count(res: dict, name: str, jid: str, stats: dict) -> int:
    """Evolution's `pages` as an int >= 1. A value that is not a number (one build answered
    "n/a") is counted in `errors` and read as 1: this page's records are still imported, the
    chat just is not paged further, and the sync moves on to the next chat (fix round 1)."""
    raw = res.get("pages")
    try:
        return max(1, int(raw or 1))
    except (TypeError, ValueError):
        stats["errors"] += 1
        log.warning("[wa-inbox] history: unreadable page count %r for %s/%s — reading one page",
                    raw, name, jid)
        return 1


async def _pull_chat_history(db, inst: dict, name: str, jid: str, *, token, client, cutoff: datetime,
                             max_messages: int, stats: dict) -> None:
    """One chat's messages, newest page first, fed through `ingest_message(quiet=True,
    history=True)`. Stops on the first record older than `cutoff` (records come newest first) or
    once `stats["messages"]` (rows actually STORED — a duplicate a webhook already delivered is
    only `records_seen`) reaches `max_messages`. A `find_messages` failure on any page is
    counted and ends this chat only — the caller moves on to the next one."""
    page, pages = 1, 1
    while page <= pages:
        try:
            res = await client.find_messages(name, jid, page=page, token=token)
        except Exception as e:
            stats["errors"] += 1
            log.warning("[wa-inbox] history: find_messages failed for %s/%s p%s: %s",
                        name, jid, page, str(e)[:160])
            return
        res = res if isinstance(res, dict) else {}
        records = res.get("records") or []
        if not records:
            return
        pages = _page_count(res, name, jid, stats)
        for rec in records:
            if not isinstance(rec, dict):
                continue
            ts = _provider_ts(rec.get("messageTimestamp"))
            if ts and wa_send._parse(ts) < cutoff:
                return                            # older than the window: nothing past here matters
            stats["records_seen"] += 1
            try:
                out = await ingest_message(db, inst, rec, quiet=True, history=True)
            except Exception as e:
                stats["errors"] += 1
                log.warning("[wa-inbox] history: ingest failed for %s/%s: %s", name, jid, str(e)[:160])
                continue
            if not (isinstance(out, dict) and out.get("message_id")):
                continue                          # a duplicate ({"duplicate": True}) or nothing to store (None)
            stats["messages"] += 1
            if stats["messages"] >= max_messages:
                stats["truncated"] = True
                return
        page += 1


async def _pull_history(db, inst: dict, name: str, *, days: int, max_chats: int, max_messages: int,
                        stats: dict) -> None:
    token = inst.get("instance_token") or None
    client = wa_send._client()
    cutoff = wa_send._now() - timedelta(days=max(0, int(days)))
    try:
        raw_chats = await client.find_chats(name, token=token)
    except Exception as e:
        stats["errors"] += 1
        log.warning("[wa-inbox] history: find_chats failed for %s: %s", name, str(e)[:160])
        return
    chats = sorted(
        (c for c in (raw_chats or []) if isinstance(c, dict) and _history_jid(c).endswith("@s.whatsapp.net")),
        key=_history_chat_sort_key, reverse=True)[:max(0, int(max_chats))]
    for chat in chats:
        if stats["messages"] >= max_messages:
            stats["truncated"] = True
            break
        jid = _history_jid(chat)
        if not jid:
            continue
        stats["chats"] += 1
        try:
            await _pull_chat_history(db, inst, name, jid, token=token, client=client, cutoff=cutoff,
                                     max_messages=max_messages, stats=stats)
        except Exception as e:
            # Whatever went wrong inside this chat (a malformed page, a record the normaliser
            # cannot read) ends THIS chat only — the remaining chats still get imported.
            stats["errors"] += 1
            log.warning("[wa-inbox] history: chat %s/%s abandoned: %s", name, jid, str(e)[:160])


# Instances with a history sync in flight (fix round 1): `_on_open` on a flapping connection, or
# an admin resync while the first-link sync is still running, must not start a second walk over
# the same chats. One process — the worker is a single uvicorn process — so a set is enough.
_SYNCING: set = set()


async def sync_history(db, inst: dict, *, days: int = 90, max_chats: int = 200,
                       max_messages: int = 5000) -> dict:
    """W2 task 5 (spec D6): the last `days` of chats on first link, called from
    `wa_routes._on_open`. `find_chats` -> keep 1:1 chats (`@s.whatsapp.net`; groups and
    newsletters skipped), newest first, up to `max_chats`; for each, page `find_messages` until a
    record older than `now - days` or `max_messages` overall — every record goes through
    `ingest_message(quiet=True, history=True)`, so a message a webhook already delivered is a
    no-op (idempotent on provider_msg_id), and nobody is notified of history landing.

    Returns {"chats", "messages", "records_seen", "truncated", "errors"} — `messages` counts
    rows actually stored (the cap applies to those), `records_seen` every record Evolution
    handed over inside the window, duplicates included — and ALWAYS `$set`s `history_synced_at`
    and `history_stats` on the instance — even when every call to Evolution failed — so
    `_on_open` (which only starts this while `history_synced_at` is unset) does not restart it on
    every reconnect. Never raises: a bad chat, page or record is counted in `errors` and the rest
    of the sync continues. A second call while one is already running for the same instance
    returns {"skipped": "already_running"} at once and touches nothing."""
    name = str(inst.get("instance_name") or "")
    stats = {"chats": 0, "messages": 0, "records_seen": 0, "truncated": False, "errors": 0}
    if not name:
        return stats
    if name in _SYNCING:
        log.info("[wa-inbox] history sync for %s already running — not started again", name)
        return {"skipped": "already_running"}
    _SYNCING.add(name)
    try:
        try:
            await _pull_history(db, inst, name, days=days, max_chats=max_chats,
                                max_messages=max_messages, stats=stats)
        except Exception as e:
            stats["errors"] += 1
            log.error("[wa-inbox] history sync for %s aborted: %s", name, str(e)[:160])
        try:
            await db.wa_instances.update_one({"instance_name": name}, {"$set": {
                "history_synced_at": wa_send._iso(wa_send._now()), "history_stats": stats}})
        except Exception as e:
            log.error("[wa-inbox] history: stats not saved for %s: %s", name, str(e)[:160])
    finally:
        _SYNCING.discard(name)
    return stats
