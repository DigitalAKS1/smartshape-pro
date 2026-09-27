"""WhatsApp team inbox (spec 2026-09-24, W2 task 4): the chat list, a chat's messages, an
attributed reply, read / resolve / reopen / assign / notes / link, the per-record thread, the
unread badge and the SSE stream.

Scope (the one rule every route applies):
    a manager (admin, or CRM reader with `leads` scope "all") -> every chat.
    a user who cannot read the CRM (accounts, store) -> nothing, anywhere.
    a rep                                       -> chats on their own number(s), plus chats on the
                                                   COMPANY number whose contact / school / lead is
                                                   one they can see in the CRM (crm_routes rules).
    hidden chats (groups, channels, statuses)   -> nobody, anywhere.

A reply always leaves from the chat's own number (`channel=<instance>`), typed by whoever pressed
send (`typed_by`), so a manager answering on a rep's number is attributed to the manager while
the customer keeps talking to the rep's number (D2).
"""
import asyncio
import json
import logging
import re
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

import routes.crm_routes as crm
from auth_utils import get_current_user
from database import db
from rbac import can_read_crm, get_team, sees_all  # noqa: F401  (get_team: the same admin test wa_routes uses)
from routes.wa_routes import _body, _is_admin, _my_instance  # noqa: F401
from services import wa_events, wa_send
from services.wa_config import COMPANY_INSTANCE

router = APIRouter()
log = logging.getLogger("wa_inbox_routes")

NOT_HIDDEN = {"hidden": {"$ne": True}}
PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX = 50, 200
MESSAGES_DEFAULT, MESSAGES_MAX = 50, 200
RECORD_DEFAULT, RECORD_MAX = 20, 100
NOTE_MAX = 2000
TEXT_MAX = 4096                    # WhatsApp's own limit for one text message
QUOTED_ID_MAX = 128
NONE_SCOPE = {"chat_id": "__none__"}   # a user outside the CRM: nothing, anywhere
READ_BATCH = 50                   # inbound rows marked read (locally and on Evolution) per read call
PING_S = 25.0                      # SSE comment frame cadence while nothing happens
RESCOPE_S = 300.0                  # how often an open stream re-reads the rep's CRM scope
_LINK_KEYS = ("contact_id", "lead_id", "school_id")
_UNSET = {"$in": ["", None]}


def _now_iso() -> str:
    return wa_send._iso(wa_send._now())


def _int(raw, default: int, lo: int, hi: int) -> int:
    try:
        v = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _missing(field: str) -> dict:
    return {"$or": [{field: _UNSET}, {field: {"$exists": False}}]}


# ── Scope ─────────────────────────────────────────────────────────────────────

def is_manager(user: dict) -> bool:
    """Admins (the owner has role admin and no module_permissions) and anyone who can read the
    CRM with an org-wide `leads` scope: they see every chat and may assign. The `can_read_crm`
    guard matters: `sees_all` alone answers "all" for an accounts/store user (the legacy
    "not sales-only" fallback), who must see no chats at all (fix round 1 ruling)."""
    return _is_admin(user) or (can_read_crm(user) and sees_all(user, "leads"))


async def _my_instance_names(email: str) -> list:
    """users.wa_instance_name plus every rep row this person owns (never the company row)."""
    names = []
    u = await db.users.find_one({"email": wa_send._email_q(email)}, {"_id": 0, "wa_instance_name": 1}) or {}
    if u.get("wa_instance_name"):
        names.append(str(u["wa_instance_name"]))
    async for r in db.wa_instances.find({"kind": "rep", "owner_email": wa_send._email_q(email)},
                                        {"_id": 0, "instance_name": 1}):
        if r.get("instance_name") and r["instance_name"] not in names:
            names.append(r["instance_name"])
    return names


async def _company_instance_name() -> str:
    row = await db.wa_instances.find_one({"kind": "company"}, {"_id": 0, "instance_name": 1})
    return str((row or {}).get("instance_name") or COMPANY_INSTANCE)


async def scope_ctx(user: dict) -> dict:
    """Everything the scope rule needs, read ONCE: the rep's instance names, the company
    instance, and the ids of the contacts / schools / leads they can see (empty for a manager,
    who is not filtered). The stream keeps one of these and refreshes it every RESCOPE_S."""
    email = str(user.get("email") or "")
    manager = is_manager(user)
    ctx = {"manager": manager, "none": not manager and not can_read_crm(user), "email": email,
           "my_instances": await _my_instance_names(email), "company": await _company_instance_name(),
           "contact_ids": set(), "school_ids": set(), "lead_ids": set()}
    if manager or ctx["none"]:
        return ctx
    vis = await crm._contacts_visibility_or(email, dbh=db)
    async for c in db.contacts.find({"$or": vis, "is_deleted": {"$ne": True}}, {"_id": 0, "contact_id": 1}):
        if c.get("contact_id"):
            ctx["contact_ids"].add(c["contact_id"])
    ctx["school_ids"] = {s for s in await crm._owned_school_ids(email, dbh=db) if s}
    lead_vis = await crm._leads_visibility_or(email, dbh=db)      # assigned to me, or at a school I own
    async for ld in db.leads.find({"$or": lead_vis, "is_deleted": {"$ne": True}}, {"_id": 0, "lead_id": 1}):
        if ld.get("lead_id"):
            ctx["lead_ids"].add(ld["lead_id"])
    return ctx


def _scope_query(ctx: dict) -> Optional[dict]:
    """The wa_chats filter for this scope: None for a manager (no filter); a filter nothing
    matches for someone outside the CRM."""
    if ctx["manager"]:
        return None
    if ctx.get("none"):
        return dict(NONE_SCOPE)
    return {"$or": [
        {"instance_name": {"$in": list(ctx["my_instances"])}},
        {"$and": [{"instance_name": ctx["company"]},
                  {"$or": [{"contact_id": {"$in": sorted(ctx["contact_ids"])}},
                           {"school_id": {"$in": sorted(ctx["school_ids"])}},
                           {"lead_id": {"$in": sorted(ctx["lead_ids"])}}]}]},
    ]}


async def chat_scope(user: dict) -> Optional[dict]:
    """None for a manager; the rep's `$or` filter otherwise (hidden chats are excluded by the
    routes, which always AND `NOT_HIDDEN` on top)."""
    return _scope_query(await scope_ctx(user))


def _in_scope(doc: dict, ctx: dict) -> bool:
    """A chat, a message row or a bus event (they all carry instance_name + the record ids)."""
    if ctx is None or ctx.get("manager"):
        return True
    if ctx.get("none"):
        return False
    inst = str(doc.get("instance_name") or "")
    if inst in ctx["my_instances"]:
        return True
    if inst != ctx["company"]:
        return False
    return bool((doc.get("contact_id") and doc["contact_id"] in ctx["contact_ids"])
                or (doc.get("school_id") and doc["school_id"] in ctx["school_ids"])
                or (doc.get("lead_id") and doc["lead_id"] in ctx["lead_ids"]))


def _event_in_scope(event: dict, ctx: Optional[dict]) -> bool:
    """`instance_state` (a number linked / dropped) reaches the number's owner and managers;
    everything else follows the chat rule."""
    if ctx is None or ctx.get("manager"):
        return True
    if ctx.get("none"):
        return False
    if (event or {}).get("type") == "instance_state":
        return str(event.get("instance_name") or "") in ctx["my_instances"]
    return _in_scope(event or {}, ctx)


async def _chat_or_403(chat_id: str, user: dict, ctx: Optional[dict] = None) -> dict:
    chat = await db.wa_chats.find_one({"chat_id": chat_id, **NOT_HIDDEN}, {"_id": 0})
    if not chat:
        raise HTTPException(404, "No such chat")
    if ctx is None:
        ctx = await scope_ctx(user)
    if not _in_scope(chat, ctx):
        raise HTTPException(403, "This chat is not in your scope")
    return chat


def _clean_row(row: dict) -> dict:
    """A wa_messages row for the UI: no _id, and never a token of any kind."""
    return {k: v for k, v in (row or {}).items() if k != "_id" and "token" not in k.lower()}


async def _publish_chat(chat_id: str) -> dict:
    """{"type": "chat_updated"} with the chat's scope fields; returns the chat as stored."""
    chat = await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0}) or {"chat_id": chat_id}
    await wa_events.publish({
        "type": "chat_updated", "instance_name": chat.get("instance_name") or "", "chat_id": chat_id,
        "contact_id": chat.get("contact_id") or "", "lead_id": chat.get("lead_id") or "",
        "school_id": chat.get("school_id") or "", "unread_count": int(chat.get("unread_count") or 0),
        "status": chat.get("status") or "", "assignee_email": chat.get("assignee_email") or ""})
    return chat


# ── Chat list ─────────────────────────────────────────────────────────────────

async def _decorate(rows: list) -> list:
    """instance_label / owner_email, contact_name, school_name and opted_out for each chat, in
    four batched reads."""
    inst_names = {r.get("instance_name") for r in rows if r.get("instance_name")}
    contact_ids = {r.get("contact_id") for r in rows if r.get("contact_id")}
    school_ids = {r.get("school_id") for r in rows if r.get("school_id")}
    phones = {r.get("phone_e164") for r in rows if r.get("phone_e164")}
    insts, contacts, schools, opted = {}, {}, {}, set()
    if inst_names:
        async for i in db.wa_instances.find({"instance_name": {"$in": sorted(inst_names)}},
                                            {"_id": 0, "instance_name": 1, "label": 1, "owner_email": 1, "kind": 1,
                                             "history_synced_at": 1}):
            insts[i["instance_name"]] = i
    if contact_ids:
        async for c in db.contacts.find({"contact_id": {"$in": sorted(contact_ids)}}, {"_id": 0, "contact_id": 1, "name": 1}):
            contacts[c["contact_id"]] = str(c.get("name") or "")
    if school_ids:
        async for s in db.schools.find({"school_id": {"$in": sorted(school_ids)}},
                                       {"_id": 0, "school_id": 1, "school_name": 1, "name": 1}):
            schools[s["school_id"]] = str(s.get("school_name") or s.get("name") or "")
    if phones:
        async for o in db.wa_opt_outs.find({"phone_e164": {"$in": sorted(phones)}, "active": True}, {"_id": 0, "phone_e164": 1}):
            opted.add(o.get("phone_e164"))
    out = []
    for r in rows:
        inst = insts.get(r.get("instance_name"), {})
        out.append({**{k: v for k, v in r.items() if "token" not in k.lower()},
                    "instance_label": inst.get("label") or r.get("instance_name") or "",
                    "instance_kind": inst.get("kind") or "",
                    "owner_email": inst.get("owner_email") or "",
                    # the inbox shows "History before <date> may be incomplete" from this
                    "history_synced_at": inst.get("history_synced_at"),
                    "contact_name": contacts.get(r.get("contact_id"), ""),
                    "school_name": schools.get(r.get("school_id"), ""),
                    "opted_out": r.get("phone_e164") in opted})
    return out


async def _unread_total(clauses: list) -> int:
    q = {"$and": clauses + [{"status": "open"}]}
    try:
        agg = await db.wa_chats.aggregate([{"$match": q}, {"$group": {"_id": None, "n": {"$sum": "$unread_count"}}}]).to_list(1)
        return int((agg[0] if agg else {}).get("n") or 0)
    except Exception as e:                                       # pragma: no cover - driver quirk
        log.debug("[wa-inbox] unread aggregate failed, summing: %s", str(e)[:120])
        total = 0
        async for c in db.wa_chats.find(q, {"_id": 0, "unread_count": 1}):
            total += int(c.get("unread_count") or 0)
        return total


@router.get("/wa/chats")
async def wa_chats(request: Request):
    """?scope=mine|unassigned|all &status=open|resolved|all &instance= &q= &page= &page_size=
    mine = assigned to me OR on one of my numbers; unassigned = no assignee; all = my whole scope."""
    user = await get_current_user(request)
    qp = request.query_params
    scope = str(qp.get("scope") or "all").lower()
    status = str(qp.get("status") or "open").lower()
    instance = str(qp.get("instance") or "").strip()
    q = str(qp.get("q") or "").strip()
    page = _int(qp.get("page"), 1, 1, 100000)
    page_size = _int(qp.get("page_size"), PAGE_SIZE_DEFAULT, 1, PAGE_SIZE_MAX)
    ctx = await scope_ctx(user)
    base = [dict(NOT_HIDDEN)]
    sq = _scope_query(ctx)
    if sq:
        base.append(sq)
    clauses = list(base)
    if scope == "mine":
        clauses.append({"$or": [{"assignee_email": wa_send._email_q(user["email"])},
                                {"instance_name": {"$in": list(ctx["my_instances"])}}]})
    elif scope == "unassigned":
        clauses.append(_missing("assignee_email"))
    if status in ("open", "resolved"):
        clauses.append({"status": status})
    if instance:
        clauses.append({"instance_name": instance})
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        cids = [c["contact_id"] async for c in db.contacts.find(
            {"name": rx, "is_deleted": {"$ne": True}}, {"_id": 0, "contact_id": 1}).limit(500) if c.get("contact_id")]
        clauses.append({"$or": [{"display_name": rx}, {"push_name": rx}, {"phone_e164": rx},
                                {"contact_id": {"$in": cids}}]})
    query = {"$and": clauses}
    total = await db.wa_chats.count_documents(query)
    rows = await db.wa_chats.find(query, {"_id": 0}).sort("last_message_at", -1) \
        .skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": await _decorate(rows), "total": int(total), "page": page,
            "page_size": page_size, "unread_total": await _unread_total(base)}


# ── Messages of one chat ──────────────────────────────────────────────────────

@router.get("/wa/chats/{chat_id}/messages")
async def wa_chat_messages(chat_id: str, request: Request):
    """?before=<created_at iso> &before_id=<message_id> &limit=50 -> the `limit` rows before the
    cursor, oldest -> newest. The cursor is the pair (created_at, message_id) — rows that share a
    timestamp (a burst, a history sync) are never skipped or repeated; the response hands back
    `next_before` / `next_before_id` (the oldest row returned) for the next page."""
    user = await get_current_user(request)
    await _chat_or_403(chat_id, user)
    qp = request.query_params
    limit = _int(qp.get("limit"), MESSAGES_DEFAULT, 1, MESSAGES_MAX)
    before = str(qp.get("before") or "").strip()
    before_id = str(qp.get("before_id") or "").strip()
    q = {"chat_id": chat_id, **NOT_HIDDEN}
    if before:
        try:
            wa_send._parse(before)
        except Exception:
            raise HTTPException(400, "before must be an ISO datetime")
        if before_id:
            q["$or"] = [{"created_at": {"$lt": before}}, {"created_at": before, "message_id": {"$lt": before_id}}]
        else:
            q["created_at"] = {"$lt": before}
    rows = await db.wa_messages.find(q, {"_id": 0}).sort([("created_at", -1), ("message_id", -1)]) \
        .limit(limit + 1).to_list(limit + 1)
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()
    oldest = rows[0] if rows else {}
    return {"items": [_clean_row(r) for r in rows], "has_more": has_more,
            "next_before": oldest.get("created_at") or None, "next_before_id": oldest.get("message_id") or None}


# ── Send ──────────────────────────────────────────────────────────────────────

async def _render(body: str, chat: dict, user: dict, inst: dict) -> str:
    """The Settings -> WhatsApp template placeholders, with the chat's own records and the
    number the reply leaves from as {my_phone}."""
    contact_name = str(chat.get("display_name") or "")
    school_name = ""
    if chat.get("contact_id"):
        c = await db.contacts.find_one({"contact_id": chat["contact_id"]}, {"_id": 0, "name": 1, "school_id": 1}) or {}
        contact_name = str(c.get("name") or contact_name)
    sid = chat.get("school_id") or ""
    if sid:
        s = await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_name": 1, "name": 1}) or {}
        school_name = str(s.get("school_name") or s.get("name") or "")
    phone = str(inst.get("phone_e164") or "")
    return (str(body or "")
            .replace("{contact_name}", contact_name).replace("{school_name}", school_name)
            .replace("{my_name}", str(user.get("name") or user.get("email") or ""))
            .replace("{my_phone}", f"+{phone}" if phone else ""))


@router.post("/wa/chats/{chat_id}/send")
async def wa_chat_send(chat_id: str, request: Request):
    """{text?, attachment_id?, template_id?, quoted_provider_msg_id?} -> {status, message_id, reason,
    message}. The reply leaves from the chat's number; a rep may reply on their own number, or on
    the company number for a record they can see; a manager on any. `skipped` / `failed` /
    `queued` come back as 200 with the reason (the UI shows it inline) — never a 500."""
    user = await get_current_user(request)
    body = await _body(request)
    text = str(body.get("text") or "").strip()
    attachment_id = str(body.get("attachment_id") or "").strip()
    template_id = str(body.get("template_id") or "").strip()
    quoted = str(body.get("quoted_provider_msg_id") or "").strip()
    if not (text or attachment_id or template_id):
        raise HTTPException(400, "Type a message or attach a file.")
    if len(text) > TEXT_MAX:
        raise HTTPException(400, f"A WhatsApp message can be at most {TEXT_MAX} characters")
    if len(quoted) > QUOTED_ID_MAX:
        raise HTTPException(400, "quoted_provider_msg_id is not a valid message id")
    ctx = await scope_ctx(user)
    chat = await _chat_or_403(chat_id, user, ctx)
    name = str(chat.get("instance_name") or "")
    inst = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})
    if not inst or inst.get("state") != "connected":
        label = (inst or {}).get("label") or name or "This number"
        raise HTTPException(409, f"{label} is not connected")
    if not ctx["manager"] and name not in ctx["my_instances"] and name != ctx["company"]:
        raise HTTPException(403, "You can reply only from your own number or the company number")
    rendered = False
    if template_id:
        tpl = await db.whatsapp_templates.find_one({"template_id": template_id}, {"_id": 0, "body": 1})
        if not tpl:
            raise HTTPException(404, "Template not found")
        if not text:
            text = await _render(tpl.get("body") or "", chat, user, inst)
            rendered = True
        if len(text) > TEXT_MAX:
            raise HTTPException(400, f"A WhatsApp message can be at most {TEXT_MAX} characters")
    media = None
    if attachment_id:
        att = await db.whatsapp_attachments.find_one({"attachment_id": attachment_id}, {"_id": 0})
        if not att:
            raise HTTPException(404, "Attachment not found")
        media = {"type": att.get("attachment_type") or "document", "url": att.get("url") or "",
                 "filename": att.get("filename") or "", "mime": att.get("content_type") or ""}
    if not (text or (media and media.get("url"))):
        raise HTTPException(400, "Type a message or attach a file.")
    # ref.template_id only when the text really came from the template (an edited text is the person's)
    ref = {k: v for k, v in (("template_id", template_id if rendered else ""), ("attachment_id", attachment_id)) if v}
    try:
        res = await wa_send.send_whatsapp(
            db, to=chat.get("phone_e164") or "", text=text, media=media, kind="chat", ref=ref,
            typed_by=user["email"], channel=name, contact_id=chat.get("contact_id") or "",
            lead_id=chat.get("lead_id") or "", school_id=chat.get("school_id") or "", enforce_consent=False)
    except Exception as e:
        log.error("[wa-inbox] send on %s by %s failed: %s", chat_id, user["email"], str(e)[:200])
        return {"status": "failed", "message_id": "", "reason": str(e)[:200] or type(e).__name__, "message": None}
    mid = res.get("message_id") or ""
    if mid and quoted:
        await db.wa_messages.update_one({"message_id": mid}, {"$set": {"quoted_provider_msg_id": quoted}})
    row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0}) if mid else None
    return {"status": res.get("status") or "failed", "message_id": mid, "reason": res.get("reason") or "",
            "message": _clean_row(row) if row else None}


# ── Read / resolve / reopen / assign / notes ──────────────────────────────────

@router.post("/wa/chats/{chat_id}/read")
async def wa_chat_read(chat_id: str, request: Request):
    """unread_count -> 0; up to READ_BATCH unread inbound rows get read_at, and Evolution is told
    (best effort: a provider error is logged, the local state stands)."""
    user = await get_current_user(request)
    chat = await _chat_or_403(chat_id, user)
    now = _now_iso()
    await db.wa_chats.update_one({"chat_id": chat_id}, {"$set": {"unread_count": 0, "updated_at": now}})
    rows = await db.wa_messages.find(
        {"chat_id": chat_id, "direction": "in", **NOT_HIDDEN, **_missing("read_at")},
        {"_id": 0, "message_id": 1, "provider_msg_id": 1}).sort("created_at", -1).limit(READ_BATCH).to_list(READ_BATCH)
    if rows:
        await db.wa_messages.update_many({"message_id": {"$in": [r["message_id"] for r in rows]}},
                                         {"$set": {"read_at": now, "read_by": user["email"]}})
        keys = [{"remoteJid": chat.get("remote_jid") or "", "fromMe": False, "id": r["provider_msg_id"]}
                for r in rows if r.get("provider_msg_id")]
        if keys:
            inst = await db.wa_instances.find_one({"instance_name": chat.get("instance_name")}, {"_id": 0}) or {}
            try:
                await wa_send._client().mark_read(chat.get("instance_name"), keys,
                                                  token=inst.get("instance_token") or None)
            except Exception as e:
                log.warning("[wa-inbox] mark-read on %s failed: %s", chat_id, str(e)[:160])
    await _publish_chat(chat_id)
    return {"chat_id": chat_id, "unread_count": 0, "marked": len(rows)}


async def _set_status(chat_id: str, user: dict, status: str) -> dict:
    await _chat_or_403(chat_id, user)
    now = _now_iso()
    sets = {"status": status, "updated_at": now}
    if status == "resolved":
        sets.update({"resolved_at": now, "resolved_by": user["email"]})
    else:
        sets.update({"reopened_at": now, "reopened_by": user["email"]})
    await db.wa_chats.update_one({"chat_id": chat_id}, {"$set": sets})
    return await _publish_chat(chat_id)


@router.post("/wa/chats/{chat_id}/resolve")
async def wa_chat_resolve(chat_id: str, request: Request):
    user = await get_current_user(request)
    return await _set_status(chat_id, user, "resolved")


@router.post("/wa/chats/{chat_id}/reopen")
async def wa_chat_reopen(chat_id: str, request: Request):
    user = await get_current_user(request)
    return await _set_status(chat_id, user, "open")


@router.post("/wa/chats/{chat_id}/assign")
async def wa_chat_assign(chat_id: str, request: Request):
    """{email} — managers only; the email must be an active user who is a manager or has this
    chat in their own scope (a rep cannot be handed a chat they could never open); "" clears."""
    user = await get_current_user(request)
    if not is_manager(user):
        raise HTTPException(403, "Only a manager can assign chats")
    chat = await _chat_or_403(chat_id, user)
    email = wa_send._norm_email((await _body(request)).get("email"))
    if email:
        u = await db.users.find_one({"email": wa_send._email_q(email), "is_active": {"$ne": False}}, {"_id": 0})
        if not u:
            raise HTTPException(400, "No active user with that email")
        email = wa_send._norm_email(u.get("email")) or email
        if not is_manager(u) and not _in_scope(chat, await scope_ctx(u)):
            raise HTTPException(400, f"{email} cannot see this chat")
    await db.wa_chats.update_one({"chat_id": chat_id}, {"$set": {
        "assignee_email": email, "assigned_by": user["email"], "assigned_at": _now_iso(), "updated_at": _now_iso()}})
    return await _publish_chat(chat_id)


@router.post("/wa/chats/{chat_id}/notes")
async def wa_chat_notes(chat_id: str, request: Request):
    """{text} -> $push notes {by, text, at} (NOTE_MAX chars). Notes travel with the chat."""
    user = await get_current_user(request)
    await _chat_or_403(chat_id, user)
    text = str((await _body(request)).get("text") or "").strip()[:NOTE_MAX]
    if not text:
        raise HTTPException(400, "The note is empty")
    now = _now_iso()
    await db.wa_chats.update_one({"chat_id": chat_id}, {
        "$push": {"notes": {"by": user["email"], "text": text, "at": now}}, "$set": {"updated_at": now}})
    return await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0})


# ── Link a chat to a CRM record ───────────────────────────────────────────────

async def _visible_contact(contact_id: str, ctx: dict) -> dict:
    c = await db.contacts.find_one({"contact_id": contact_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not c:
        raise HTTPException(404, "No such contact")
    if not ctx["manager"] and contact_id not in ctx["contact_ids"]:
        raise HTTPException(403, "You can link only a contact you can see")
    return c


async def _visible_school(school_id: str, ctx: dict) -> dict:
    s = await db.schools.find_one({"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not s:
        raise HTTPException(404, "No such school")
    if not ctx["manager"] and school_id not in ctx["school_ids"]:
        vis = await crm._schools_visibility_or(ctx["email"], dbh=db)
        if not await db.schools.find_one({"school_id": school_id, "$or": vis}, {"_id": 1}):
            raise HTTPException(403, "You can link only a school you can see")
    return s


async def _apply_link(chat: dict, links: dict, display_name: str = "") -> dict:
    """The ids go on the chat, and on every row of the chat that has none of that id."""
    chat_id = chat["chat_id"]
    sets = {k: v for k, v in links.items() if k in _LINK_KEYS and v}
    if not sets:
        raise HTTPException(400, "Nothing to link")
    placeholder = {chat.get("phone_e164") or "", chat.get("push_name") or "", chat.get("remote_jid") or "", ""}
    if display_name and (chat.get("display_name") or "") in placeholder:
        sets["display_name"] = display_name
    sets["updated_at"] = _now_iso()
    await db.wa_chats.update_one({"chat_id": chat_id}, {"$set": sets})
    for k in _LINK_KEYS:
        if sets.get(k):
            await db.wa_messages.update_many({"chat_id": chat_id, **_missing(k)}, {"$set": {k: sets[k]}})
    return await _publish_chat(chat_id)


@router.post("/wa/chats/{chat_id}/link")
async def wa_chat_link(chat_id: str, request: Request):
    """{contact_id} | {school_id} | {create_contact: {name, school_id?}}. A rep links only to a
    record they can see; `create_contact` makes a CRM contact from the chat's number, owned by
    the number's rep (a company-number chat: by whoever links it)."""
    user = await get_current_user(request)
    body = await _body(request)
    ctx = await scope_ctx(user)
    chat = await _chat_or_403(chat_id, user, ctx)
    if isinstance(body.get("create_contact"), dict):
        spec = body["create_contact"]
        name = str(spec.get("name") or "").strip()[:120]
        if not name:
            raise HTTPException(400, "The contact needs a name")
        # Only a school the caller picked is checked; the chat's own school (the chat may be in
        # their scope through its contact, not its school) is carried over as-is.
        school_id = str(spec.get("school_id") or "").strip()
        if school_id:
            await _visible_school(school_id, ctx)
        else:
            school_id = str(chat.get("school_id") or "")
        inst = await db.wa_instances.find_one({"instance_name": chat.get("instance_name")}, {"_id": 0}) or {}
        owner = (wa_send._norm_email(inst.get("owner_email")) if inst.get("kind") == "rep" else "") or user["email"]
        owner_doc = await db.users.find_one({"email": wa_send._email_q(owner)}, {"_id": 0, "name": 1}) or {}
        now = _now_iso()
        contact = {"contact_id": f"con_{uuid.uuid4().hex[:12]}", "name": name, "phone": chat.get("phone_e164") or "",
                   "school_id": school_id, "assigned_to": owner, "assigned_name": str(owner_doc.get("name") or ""),
                   "created_by": user["email"], "created_at": now, "updated_at": now, "is_deleted": False,
                   "source": "whatsapp", "tag_ids": []}
        await db.contacts.insert_one(dict(contact))
        return await _apply_link(chat, {"contact_id": contact["contact_id"], "school_id": school_id}, name)
    if body.get("contact_id"):
        c = await _visible_contact(str(body["contact_id"]), ctx)
        return await _apply_link(chat, {"contact_id": c["contact_id"],
                                        "school_id": "" if chat.get("school_id") else (c.get("school_id") or "")},
                                 str(c.get("name") or ""))
    if body.get("school_id"):
        s = await _visible_school(str(body["school_id"]), ctx)
        return await _apply_link(chat, {"school_id": s["school_id"]},
                                 "" if chat.get("contact_id") else str(s.get("school_name") or s.get("name") or ""))
    if body.get("lead_id"):
        ld = await db.leads.find_one({"lead_id": str(body["lead_id"]), "is_deleted": {"$ne": True}}, {"_id": 0})
        if not ld:
            raise HTTPException(404, "No such lead")
        if not ctx["manager"] and ld["lead_id"] not in ctx["lead_ids"]:
            raise HTTPException(403, "You can link only a lead you can see")
        return await _apply_link(chat, {"lead_id": ld["lead_id"],
                                        "contact_id": "" if chat.get("contact_id") else (ld.get("contact_id") or ""),
                                        "school_id": "" if chat.get("school_id") else (ld.get("school_id") or "")},
                                 str(ld.get("contact_name") or ld.get("company_name") or ""))
    raise HTTPException(400, "Send contact_id, school_id, lead_id or create_contact")


# ── Per-record thread, unread badge ───────────────────────────────────────────

@router.get("/wa/messages")
async def wa_messages_by_record(request: Request):
    """?contact_id= | school_id= | lead_id= &limit=20 -> the record's latest rows, newest first,
    each with its chat_id ("Open chat"). A rep gets only rows whose chat is in their scope."""
    user = await get_current_user(request)
    qp = request.query_params
    key = next((k for k in _LINK_KEYS if str(qp.get(k) or "").strip()), "")
    if not key:
        raise HTTPException(400, "Send contact_id, school_id or lead_id")
    limit = _int(qp.get("limit"), RECORD_DEFAULT, 1, RECORD_MAX)
    ctx = await scope_ctx(user)
    rows = await db.wa_messages.find({key: str(qp.get(key)).strip(), **NOT_HIDDEN}, {"_id": 0}) \
        .sort("created_at", -1).limit(limit * 5).to_list(limit * 5)
    chat_ids = sorted({r.get("chat_id") for r in rows if r.get("chat_id")})
    allowed = set()
    if chat_ids:
        async for c in db.wa_chats.find({"chat_id": {"$in": chat_ids}, **NOT_HIDDEN}, {"_id": 0}):
            if _in_scope(c, ctx):
                allowed.add(c["chat_id"])
    items = [_clean_row(r) for r in rows if r.get("chat_id") in allowed][:limit]
    return {"items": items}


@router.get("/wa/unread-count")
async def wa_unread_count(request: Request):
    user = await get_current_user(request)
    clauses = [dict(NOT_HIDDEN)]
    sq = await chat_scope(user)
    if sq:
        clauses.append(sq)
    return {"unread": await _unread_total(clauses)}


# ── SSE stream ────────────────────────────────────────────────────────────────

def _frame(event: dict) -> str:
    return f"event: {event.get('type') or 'message'}\ndata: {json.dumps(event, default=str)}\n\n"


async def _events(user: dict, *, ping_s: float = PING_S, rescope_s: float = RESCOPE_S):
    """The SSE body: `: connected`, then every bus event in this person's scope, `: ping` after
    `ping_s` of silence, the scope re-read every `rescope_s`. The pending `__anext__` of the bus
    subscription is kept across pings (cancelling it would close the subscription)."""
    ctx = await scope_ctx(user)
    scoped_at = time.monotonic()
    agen = wa_events.subscribe()
    pending = asyncio.ensure_future(agen.__anext__())      # registers the queue on the next loop tick
    try:
        yield ": connected\n\n"
        while True:
            try:
                ev = await asyncio.wait_for(asyncio.shield(pending), timeout=ping_s)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            pending = asyncio.ensure_future(agen.__anext__())
            if time.monotonic() - scoped_at >= rescope_s:
                try:
                    ctx = await scope_ctx(user)
                except Exception as e:
                    log.warning("[wa-inbox] stream rescope for %s failed: %s", user.get("email"), str(e)[:120])
                scoped_at = time.monotonic()
            if isinstance(ev, dict) and _event_in_scope(ev, ctx):
                yield _frame(ev)
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
            try:
                await pending
            except BaseException:
                pass
        try:
            await agen.aclose()
        except BaseException:
            pass


@router.get("/wa/stream")
async def wa_stream(request: Request):
    user = await get_current_user(request)
    return StreamingResponse(_events(user), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})
