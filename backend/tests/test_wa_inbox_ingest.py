"""W2 ingest (services/wa_inbox.py): one Evolution MESSAGES_UPSERT event -> one wa_messages row,
one wa_chats upsert, one engagement event — idempotent on (instance, provider message id).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_inbox_ingest.py -q -p no:cacheprovider
"""
import asyncio
import base64
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

from services import storage, wa_events, wa_inbox
from wa_fixtures import seed_instance, seed_user

PARUL = "parul@smartshape.in"
PHONE = "919800000001"
JID = f"{PHONE}@s.whatsapp.net"
CHAT = f"rep_parul:{JID}"


@pytest.fixture()
def env(wa_env):
    return wa_env


def _run(coro):
    return asyncio.run(coro)


def inbound(pmid, phone, text, **extra):
    """A 2.3.x-shaped MESSAGES_UPSERT `data`. `extra` overrides top-level keys (key, message, ...)."""
    d = {"key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": False, "id": pmid}, "pushName": "Sunita",
         "message": {"conversation": text}, "messageType": "conversation", "messageTimestamp": 1790400000}
    d.update(extra)
    return d


async def _setup(db, *, contact=True):
    await seed_user(db, PARUL)
    await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919000000111")
    if contact:
        await db.schools.insert_one({"school_id": "sch1", "school_name": "Sunrise School", "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Sunita Verma", "phone": "98000 00001",
                                      "school_id": "sch1", "assigned_to": PARUL, "is_deleted": False})
    return await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})


async def _chat(db, chat_id=CHAT):
    return await db.wa_chats.find_one({"chat_id": chat_id}, {"_id": 0})


# ── the twelve ───────────────────────────────────────────────────────────────

def test_an_inbound_text_creates_one_row_one_chat_and_one_engagement_event(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        q = asyncio.Queue()
        wa_events._queues.add(q)
        try:
            row = await wa_inbox.ingest_message(db, inst, inbound("IN1", PHONE, "hello"))
        finally:
            wa_events._queues.discard(q)
        assert row["direction"] == "in" and row["status"] == "delivered" and row["source"] == "webhook"
        assert row["contact_id"] == "c1" and row["school_id"] == "sch1" and row["lead_id"] == ""
        assert row["message_id"].startswith("wam_")
        assert row["text"] == "hello" and row["push_name"] == "Sunita" and row["hidden"] is False
        assert row["chat_id"] == CHAT and row["to_e164"] == PHONE and row["provider_msg_id"] == "IN1"
        assert row["from_jid"] == JID and row["to_jid"] == "919000000111@s.whatsapp.net"
        assert row["status_history"] == [{"status": "delivered", "at": row["received_at"], "reason": "received"}]
        assert row["provider_ts"] == "2026-09-26T05:20:00+00:00"
        assert await db.wa_messages.count_documents({}) == 1
        stored = await db.wa_messages.find_one({"provider_msg_id": "IN1"}, {"_id": 0})
        assert stored["message_id"] == row["message_id"] and stored["contact_id"] == "c1"
        chat = await _chat(db)
        assert chat["unread_count"] == 1 and chat["last_direction"] == "in" and chat["status"] == "open"
        assert chat["display_name"] == "Sunita Verma" and chat["contact_id"] == "c1" and chat["school_id"] == "sch1"
        assert chat["assignee_email"] == PARUL and chat["phone_e164"] == PHONE and chat["instance_name"] == "rep_parul"
        assert chat["last_message_preview"] == "hello" and chat["notes"] == [] and chat["hidden"] is False
        assert await db.wa_chats.count_documents({}) == 1
        events = await db.engagement_events.find({}, {"_id": 0}).to_list(None)
        assert len(events) == 1
        assert events[0]["direction"] == "in" and events[0]["contact_id"] == "c1"
        assert events[0]["kind"] == "WhatsApp · reply" and events[0]["dedup_key"] == f"wa:{row['message_id']}"
        assert events[0]["by"] == "Sunita" and events[0]["channel"] == "whatsapp"
        ev = q.get_nowait()
        assert ev["type"] == "message_new" and ev["chat_id"] == CHAT and ev["message_id"] == row["message_id"]
        assert ev["direction"] == "in" and ev["unread_count"] == 1 and ev["contact_id"] == "c1" and ev["at"]
    _run(go())


def test_the_same_provider_id_twice_changes_nothing(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        first = await wa_inbox.ingest_message(db, inst, inbound("IN1", PHONE, "hello"))
        second = await wa_inbox.ingest_message(db, inst, inbound("IN1", PHONE, "hello"))
        assert first["message_id"].startswith("wam_") and second == {"duplicate": True}
        assert await db.wa_messages.count_documents({}) == 1
        assert (await _chat(db))["unread_count"] == 1
        assert await db.engagement_events.count_documents({}) == 1
    _run(go())


def test_lid_jid_is_mapped_through_remote_jid_alt(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "IN2", "123", "hi", key={"remoteJid": "123@lid", "fromMe": False, "id": "IN2"}, remoteJidAlt=JID))
        assert row["phone_e164"] == PHONE and row["remote_jid"] == JID and row["chat_id"] == CHAT
        assert row["contact_id"] == "c1"
        assert (await _chat(db))["remote_jid"] == JID
        # the alt may also sit inside `key`
        row2 = await wa_inbox.ingest_message(db, inst, inbound(
            "IN2b", "123", "hi", key={"remoteJid": "123@lid", "fromMe": False, "id": "IN2b", "remoteJidAlt": JID}))
        assert row2["chat_id"] == CHAT and await db.wa_chats.count_documents({}) == 1
    _run(go())


def test_group_and_status_messages_are_stored_hidden_and_make_no_chat(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        g = await wa_inbox.ingest_message(db, inst, inbound(
            "G1", "x", "in a group", key={"remoteJid": "120363012345678901@g.us", "fromMe": False, "id": "G1"}))
        s = await wa_inbox.ingest_message(db, inst, inbound(
            "S1", "x", "a status", key={"remoteJid": "status@broadcast", "fromMe": False, "id": "S1"}))
        assert g["hidden"] is True and s["hidden"] is True
        assert g["phone_e164"] == "" and g["to_e164"] == ""
        assert await db.wa_messages.count_documents({"hidden": True}) == 2
        assert await db.wa_chats.count_documents({}) == 0
        assert await db.engagement_events.count_documents({}) == 0
    _run(go())


def test_an_image_is_downloaded_and_stored_through_storage(env, monkeypatch):
    db = env.db
    env.evo.media["IN3"] = {"base64": base64.b64encode(b"abc").decode(), "mimetype": "image/jpeg"}
    saved = []

    async def fake_save(path, data, content_type, **kw):
        saved.append((path, data, content_type))
        return "https://cdn/x.jpg"
    monkeypatch.setattr(storage, "save_upload", fake_save)

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "IN3", PHONE, "", message={"imageMessage": {"caption": "look", "mimetype": "image/jpeg",
                                                         "url": "https://mmg.whatsapp.net/enc"}},
            messageType="imageMessage"))
        assert row["media"] == {"type": "image", "url": "https://cdn/x.jpg", "mime": "image/jpeg",
                                "filename": "IN3.jpg", "size": 3, "caption": "look"}
        assert saved == [("whatsapp/in/rep_parul/IN3.jpg", b"abc", "image/jpeg")]
        stored = await db.wa_messages.find_one({"provider_msg_id": "IN3"}, {"_id": 0})
        assert stored["media"] == row["media"] and stored["text"] == "look"
        assert (await _chat(db))["last_message_preview"].startswith("📎")
        call = [c for c in env.evo.calls if c["path"].startswith("/chat/getBase64FromMediaMessage/")][0]
        assert call["path"].endswith("/rep_parul") and call["token"] == "tok_rep_parul"
        assert call["json"] == {"message": {"key": {"id": "IN3"}}, "convertToMp4": False}
    _run(go())


def test_media_download_failure_still_stores_the_row(env):
    db = env.db
    env.evo.media_raises = True

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "IN4", PHONE, "", message={"documentMessage": {"fileName": "quote.pdf", "mimetype": "application/pdf",
                                                            "url": "https://mmg.whatsapp.net/enc"}},
            messageType="documentMessage"))
        stored = await db.wa_messages.find_one({"provider_msg_id": "IN4"}, {"_id": 0})
        assert stored is not None and stored["media"]["pending"] is True and stored["media"]["url"] == ""
        assert stored["media"]["type"] == "document" and stored["media"]["error"]
        assert row["media"]["pending"] is True
        assert (await _chat(db))["unread_count"] == 1
    _run(go())


def test_history_flags_skip_unread_media_events_and_publish(env):
    """W2 task 5: quiet=True, history=True (a history-sync record) never bumps unread, never
    downloads media (a `skipped: history` stub instead), never logs an engagement event, and
    never publishes on the bus — but the row and chat are still written, exactly as a live
    message idempotent on provider_msg_id would be."""
    db = env.db

    async def go():
        inst = await _setup(db)
        q = asyncio.Queue()
        wa_events._queues.add(q)
        try:
            row = await wa_inbox.ingest_message(db, inst, inbound(
                "IH1", PHONE, "", message={"imageMessage": {"caption": "old pic", "mimetype": "image/jpeg",
                                                             "url": "https://mmg.whatsapp.net/enc"}},
                messageType="imageMessage"), quiet=True, history=True)
            saw_anything = not q.empty()
        finally:
            wa_events._queues.discard(q)
        assert row["media"] == {"type": "image", "caption": "old pic", "url": "", "pending": True,
                                "skipped": "history"}
        assert saw_anything is False                          # no message_new (quiet)
        chat = await _chat(db)
        assert chat["unread_count"] == 0                       # never bumped (history)
        assert chat["last_direction"] == "in"                  # but still the row's real direction
        assert await db.engagement_events.count_documents({}) == 0
        stored = await db.wa_messages.find_one({"provider_msg_id": "IH1"}, {"_id": 0})
        assert stored["media"]["skipped"] == "history"
        # A second delivery of the SAME provider id (a live webhook catching up with the history
        # import) is still the ordinary idempotent no-op.
        again = await wa_inbox.ingest_message(db, inst, inbound(
            "IH1", PHONE, "", message={"imageMessage": {"caption": "old pic"}}, messageType="imageMessage"))
        assert again == {"duplicate": True}
    _run(go())


def test_quoted_message_id_is_kept(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "IN5", PHONE, "", message={"extendedTextMessage": {"text": "yes please",
                                                                "contextInfo": {"stanzaId": "Q1"}}},
            messageType="extendedTextMessage"))
        assert row["quoted_provider_msg_id"] == "Q1" and row["text"] == "yes please"
    _run(go())


def test_unknown_number_gets_a_chat_named_by_push_name(env):
    db = env.db

    async def go():
        inst = await _setup(db, contact=False)
        row = await wa_inbox.ingest_message(db, inst, inbound("IN6", PHONE, "who dis"))
        assert row["contact_id"] == "" and row["lead_id"] == "" and row["school_id"] == ""
        chat = await _chat(db)
        assert chat["display_name"] == "Sunita" and chat["contact_id"] == "" and chat["unread_count"] == 1
        assert await db.engagement_events.count_documents({}) == 0
    _run(go())


def test_a_message_typed_on_the_phone_is_out_and_does_not_bump_unread(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "OUT1", PHONE, "typed on the phone", key={"remoteJid": JID, "fromMe": True, "id": "OUT1"}))
        assert row["direction"] == "out" and row["status"] == "sent" and row["source"] == "phone"
        assert row["from_jid"] == "919000000111@s.whatsapp.net" and row["to_jid"] == JID and row["to_e164"] == PHONE
        assert row["sent_at"] and row["sent_day"] == "2026-09-24" and "received_at" not in row
        assert row["status_history"][0]["reason"] == "sent from the phone"
        chat = await _chat(db)
        assert chat["unread_count"] == 0 and chat["last_direction"] == "out" and chat["contact_id"] == "c1"
        assert await db.engagement_events.count_documents({}) == 0
    _run(go())


def test_a_resolved_chat_reopens_on_an_inbound_message(env):
    db = env.db

    async def go():
        inst = await _setup(db)
        await db.wa_chats.insert_one({"chat_id": CHAT, "instance_name": "rep_parul", "remote_jid": JID,
                                      "phone_e164": PHONE, "status": "resolved", "unread_count": 0,
                                      "assignee_email": PARUL, "contact_id": "c1", "lead_id": "", "school_id": "sch1",
                                      "display_name": "Sunita Verma", "notes": [], "created_at": "2026-09-01T00:00:00+00:00"})
        await wa_inbox.ingest_message(db, inst, inbound("IN7", PHONE, "one more thing"))
        chat = await _chat(db)
        assert chat["status"] == "open" and chat["unread_count"] == 1 and chat["last_message_preview"] == "one more thing"
        assert await db.wa_chats.count_documents({}) == 1
        # an outbound-from-phone message does not reopen a resolved chat
        await db.wa_chats.update_one({"chat_id": CHAT}, {"$set": {"status": "resolved"}})
        await wa_inbox.ingest_message(db, inst, inbound(
            "OUT2", PHONE, "ok", key={"remoteJid": JID, "fromMe": True, "id": "OUT2"}))
        assert (await _chat(db))["status"] == "resolved"
    _run(go())


def test_backfill_processes_raw_events_once_and_marks_bad_ones(env):
    db = env.db

    async def go():
        await _setup(db)
        base = env.clock["now"]
        from datetime import timedelta
        for i, data in enumerate([inbound("R1", PHONE, "first"), "x", inbound("R2", PHONE, "second")]):
            await db.wa_events_raw.insert_one({"instance_name": "rep_parul", "event": "MESSAGES_UPSERT",
                                               "data": data, "received_at": base + timedelta(seconds=i),
                                               "processed": False})
        n = await wa_inbox.backfill_raw_events(db)
        assert n == 3
        assert await db.wa_messages.count_documents({}) == 2
        raws = await db.wa_events_raw.find({}, {"_id": 0}).sort("received_at", 1).to_list(None)
        assert all(r["processed"] is True and r["processed_at"] for r in raws)
        assert raws[1]["error"] and "error" not in raws[0] and "error" not in raws[2]
        assert (await _chat(db))["unread_count"] == 2
        assert await wa_inbox.backfill_raw_events(db) == 0
        assert await db.wa_messages.count_documents({}) == 2
    _run(go())


def test_manual_record_link_is_never_overwritten_by_a_later_match(env):
    db = env.db

    async def go():
        inst = await _setup(db, contact=False)
        await db.contacts.insert_one({"contact_id": "c_auto", "name": "Auto Match", "phone": "+91 98000 00001",
                                      "school_id": "sch_auto", "assigned_to": PARUL, "is_deleted": False})
        await db.wa_chats.insert_one({"chat_id": CHAT, "instance_name": "rep_parul", "remote_jid": JID,
                                      "phone_e164": PHONE, "status": "open", "unread_count": 0,
                                      "assignee_email": PARUL, "contact_id": "c_manual", "lead_id": "",
                                      "school_id": "sch_manual", "display_name": "Linked By Hand", "notes": [],
                                      "created_at": "2026-09-01T00:00:00+00:00"})
        row = await wa_inbox.ingest_message(db, inst, inbound("IN8", PHONE, "hello again"))
        assert row["contact_id"] == "c_auto"                       # the row records what matched
        chat = await _chat(db)
        assert chat["contact_id"] == "c_manual" and chat["school_id"] == "sch_manual"
        assert chat["display_name"] == "Linked By Hand" and chat["unread_count"] == 1
    _run(go())


# ── the pieces on their own ──────────────────────────────────────────────────

def test_normalise_upsert_needs_a_key_id_and_reads_every_field():
    inst = {"instance_name": "rep_parul"}
    assert wa_inbox.normalise_upsert(inst, {"key": {"remoteJid": JID}}) is None
    assert wa_inbox.normalise_upsert(inst, "x") is None
    n = wa_inbox.normalise_upsert(inst, inbound("N1", PHONE, "", message={
        "documentWithCaptionMessage": {"message": {"documentMessage": {
            "fileName": "a.pdf", "mimetype": "application/pdf", "caption": "the quote",
            "contextInfo": {"stanzaId": "Q9"}}}}}, messageType="documentWithCaptionMessage"))
    assert n["media_ref"] == {"type": "document", "mime": "application/pdf", "filename": "a.pdf", "caption": "the quote"}
    assert n["text"] == "the quote" and n["quoted_provider_msg_id"] == "Q9" and n["raw_type"] == "documentWithCaptionMessage"
    assert n["direction"] == "in" and n["hidden"] is False and n["provider_ts"] == "2026-09-26T05:20:00+00:00"
    nl = wa_inbox.normalise_upsert(inst, inbound("N2", "x", "n", key={"remoteJid": "1@newsletter", "fromMe": False, "id": "N2"}))
    assert nl["hidden"] is True and nl["phone_e164"] == ""
    foreign = wa_inbox.normalise_upsert(inst, inbound("N3", "4915112345678", "hallo"))
    assert foreign["phone_e164"] == "4915112345678"


def test_norm10_and_match_record_order(env):
    db = env.db
    assert wa_inbox.norm10("+91 98000-00001") == "9800000001" and wa_inbox.norm10("12345") == "12345"
    assert wa_inbox.norm10(None) == ""

    async def go():
        assert await wa_inbox.match_record(db, "") == {"contact_id": "", "lead_id": "", "school_id": "", "display_name": ""}
        await db.contacts.insert_one({"contact_id": "c_del", "name": "Gone", "mobile": "9800000001", "is_deleted": True})
        await db.leads.insert_one({"lead_id": "l1", "contact_name": "Lead Person", "contact_phone": "09800000001",
                                   "contact_id": "c_lead", "school_id": "sch_lead"})
        await db.schools.insert_one({"school_id": "s1", "school_name": "Some School", "phone": "98000 00001"})
        m = await wa_inbox.match_record(db, PHONE)
        assert m == {"contact_id": "c_lead", "lead_id": "l1", "school_id": "sch_lead", "display_name": "Lead Person"}
        await db.leads.delete_many({})
        m = await wa_inbox.match_record(db, PHONE)
        assert m == {"contact_id": "", "lead_id": "", "school_id": "s1", "display_name": "Some School"}
        await db.contacts.insert_one({"contact_id": "c_unassigned", "name": "No Owner", "whatsapp": "9800000001"})
        await db.contacts.insert_one({"contact_id": "c_owned", "name": "Owned", "phone": "9800000001",
                                      "school_id": "sch_o", "assigned_to": PARUL})
        m = await wa_inbox.match_record(db, PHONE)
        assert m == {"contact_id": "c_owned", "lead_id": "", "school_id": "sch_o", "display_name": "Owned"}
    _run(go())


# ══ Fix round 1 ══════════════════════════════════════════════════════════════

def _disjoint(update):
    return set(update["$set"]) & set(update.get("$setOnInsert", {}))


def test_chat_update_never_puts_a_field_in_both_set_and_set_on_insert(env):
    # 1. Real MongoDB rejects a field in $set and $setOnInsert (ConflictingUpdateOperators);
    #    mongomock does not, so the update document is checked on every branch.
    inst = {"instance_name": "rep_parul", "owner_email": PARUL, "jid": "919000000111@s.whatsapp.net"}
    match = {"contact_id": "c1", "lead_id": "", "school_id": "sch1", "display_name": "Sunita Verma"}
    row = {"message_id": "wam_x", "chat_id": CHAT, "remote_jid": JID, "phone_e164": PHONE, "direction": "in",
           "text": "hi", "push_name": "Sunita", "created_at": "2026-09-24T05:30:00+00:00", "hidden": False}
    out_row = {**row, "direction": "out"}
    linked = {"chat_id": CHAT, "contact_id": "c_manual", "display_name": "By Hand", "status": "open",
              "phone_e164": PHONE}
    resolved = {**linked, "status": "resolved"}
    cases = {
        "new chat, inbound": wa_inbox._chat_update(inst, row, {}, inbound=True, match=match),
        "new chat, outbound": wa_inbox._chat_update(inst, out_row, {}, inbound=False, match=match),
        "new lid chat": wa_inbox._chat_update(inst, {**row, "lid": "123@lid", "remote_jid": "123@lid",
                                                     "chat_id": "rep_parul:123@lid", "phone_e164": ""},
                                              {}, inbound=True, match=dict(wa_inbox._EMPTY_MATCH)),
        "existing linked": wa_inbox._chat_update(inst, row, linked, inbound=True, match=match),
        "resolved + inbound": wa_inbox._chat_update(inst, row, resolved, inbound=True, match=match),
        "resolved + outbound": wa_inbox._chat_update(inst, out_row, resolved, inbound=False, match=match),
    }
    for name, upd in cases.items():
        assert _disjoint(upd) == set(), f"{name}: {_disjoint(upd)}"
        assert "unread_count" not in upd["$set"], name
    new_in, new_out = cases["new chat, inbound"], cases["new chat, outbound"]
    assert new_in["$inc"] == {"unread_count": 1} and "unread_count" not in new_in["$setOnInsert"]
    assert new_out["$setOnInsert"]["unread_count"] == 0 and "$inc" not in new_out
    assert new_in["$set"]["contact_id"] == "c1" and new_in["$setOnInsert"]["lead_id"] == ""
    assert cases["new lid chat"]["$setOnInsert"]["lid"] == "123@lid"
    assert "contact_id" not in cases["existing linked"]["$set"] and "display_name" not in cases["existing linked"]["$set"]
    assert cases["resolved + inbound"]["$set"]["status"] == "open"
    assert "status" not in cases["resolved + inbound"]["$setOnInsert"]
    assert "status" not in cases["resolved + outbound"]["$set"]


def test_a_resolved_chat_reopens_with_a_conflict_free_update(env, monkeypatch):
    # The live path: the update sent to the driver on the resolved -> open branch has no overlap.
    # (mongomock_motor hands out a fresh collection object per `db.wa_chats`, so the update
    # document is captured at the builder, whose return value goes to the driver unchanged.)
    db = env.db
    seen = []
    real = wa_inbox._chat_update

    def spy(*a, **kw):
        upd = real(*a, **kw)
        seen.append(upd)
        return upd
    monkeypatch.setattr(wa_inbox, "_chat_update", spy)

    async def go():
        inst = await _setup(db)
        await db.wa_chats.insert_one({"chat_id": CHAT, "instance_name": "rep_parul", "remote_jid": JID,
                                      "phone_e164": PHONE, "status": "resolved", "unread_count": 0,
                                      "assignee_email": PARUL, "contact_id": "c1", "lead_id": "", "school_id": "sch1",
                                      "display_name": "Sunita Verma", "notes": [], "created_at": "2026-09-01T00:00:00+00:00"})
        await wa_inbox.ingest_message(db, inst, inbound("IN9", PHONE, "back again"))
        assert len(seen) == 1 and _disjoint(seen[0]) == set() and seen[0]["$set"]["status"] == "open"
        chat = await _chat(db)
        assert chat["status"] == "open" and chat["unread_count"] == 1
    _run(go())


def test_a_reaction_leaves_the_chat_and_events_untouched(env):
    # 2. content-less events: the row is kept (D9), nothing else happens.
    db = env.db

    async def go():
        inst = await _setup(db)
        q = asyncio.Queue()
        wa_events._queues.add(q)
        try:
            row = await wa_inbox.ingest_message(db, inst, inbound(
                "RX1", PHONE, "", message={"reactionMessage": {"key": {"id": "IN1"}, "text": "+1"}},
                messageType="reactionMessage"))
            empty = await wa_inbox.ingest_message(db, inst, inbound("RX2", PHONE, "", message=None,
                                                                    messageType=""))
            proto = await wa_inbox.ingest_message(db, inst, inbound(
                "RX3", PHONE, "", message={"protocolMessage": {"type": "REVOKE"}, "messageContextInfo": {}},
                messageType="protocolMessage"))
            wrapper = await wa_inbox.ingest_message(db, inst, inbound(
                "RX4", PHONE, "", message={"ephemeralMessage": {"message": {}}}, messageType="ephemeralMessage"))
        finally:
            wa_events._queues.discard(q)
        for r, t in ((row, "reactionMessage"), (empty, ""), (proto, "protocolMessage"), (wrapper, "ephemeralMessage")):
            assert r["hidden"] is True and r["contentless"] is True and r["raw_type"] == t
        assert await db.wa_messages.count_documents({"contentless": True}) == 4
        assert await db.wa_chats.count_documents({}) == 0
        assert await db.engagement_events.count_documents({}) == 0
        assert q.empty()
        # a real message still makes the chat, with unread 1 (the reactions never counted)
        await wa_inbox.ingest_message(db, inst, inbound("IN10", PHONE, "real"))
        assert (await _chat(db))["unread_count"] == 1
        # messageContextInfo beside real content is not content-less
        n = wa_inbox.normalise_upsert(inst, inbound("N9", PHONE, "", message={
            "messageContextInfo": {"deviceListMetadata": {}}, "conversation": "hey"}))
        assert n["contentless"] is False and n["hidden"] is False and n["text"] == "hey"
    _run(go())


def test_a_group_message_publishes_nothing(env):
    # Task 3 ruling: a hidden row (group / status / newsletter) makes no chat AND no bus event.
    db = env.db

    async def go():
        inst = await _setup(db)
        q = asyncio.Queue()
        wa_events._queues.add(q)
        try:
            g = await wa_inbox.ingest_message(db, inst, inbound(
                "G3", "x", "in a group", key={"remoteJid": "120363012345678901@g.us", "fromMe": False, "id": "G3"}))
            nl = await wa_inbox.ingest_message(db, inst, inbound(
                "NL1", "x", "news", key={"remoteJid": "1@newsletter", "fromMe": False, "id": "NL1"}))
            real = await wa_inbox.ingest_message(db, inst, inbound("IN11", PHONE, "real"))
        finally:
            wa_events._queues.discard(q)
        assert g["hidden"] is True and nl["hidden"] is True and real["hidden"] is False
        assert await db.wa_messages.count_documents({}) == 3
        evs = []
        while not q.empty():
            evs.append(q.get_nowait())
        assert [e["message_id"] for e in evs] == [real["message_id"]]
        assert "hidden" not in evs[0]
    _run(go())


def test_a_group_image_is_not_downloaded(env):
    # 3. hidden rows never fetch media
    db = env.db
    env.evo.media["G2"] = {"base64": base64.b64encode(b"abc").decode(), "mimetype": "image/jpeg"}

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "G2", "x", "", key={"remoteJid": "120363012345678901@g.us", "fromMe": False, "id": "G2"},
            message={"imageMessage": {"caption": "group pic", "mimetype": "image/jpeg"}}, messageType="imageMessage"))
        assert row["media"] == {"type": "image", "caption": "group pic", "url": "", "pending": True, "skipped": "hidden"}
        stored = await db.wa_messages.find_one({"provider_msg_id": "G2"}, {"_id": 0})
        assert stored["media"] == row["media"] and stored["hidden"] is True
        assert not [c for c in env.evo.calls if "getBase64" in c["path"]]
        assert await db.wa_chats.count_documents({}) == 0
    _run(go())


def test_lid_without_an_alt_makes_a_lid_chat_and_sender_pn_is_an_alt(env):
    # 4. @lid with no alt: keyed by the lid, nothing crashes; senderPn counts as the alt.
    db = env.db

    async def go():
        inst = await _setup(db)
        row = await wa_inbox.ingest_message(db, inst, inbound(
            "L1", "x", "from a lid", key={"remoteJid": "123@lid", "fromMe": False, "id": "L1"}))
        assert row["lid"] == "123@lid" and row["remote_jid"] == "123@lid" and row["phone_e164"] == ""
        assert row["chat_id"] == "rep_parul:123@lid" and row["contact_id"] == "" and row["hidden"] is False
        chat = await _chat(db, "rep_parul:123@lid")
        assert chat["lid"] == "123@lid" and chat["display_name"] == "Sunita" and chat["unread_count"] == 1
        assert await db.engagement_events.count_documents({}) == 0
        # senderPn on the key, or on data
        r2 = await wa_inbox.ingest_message(db, inst, inbound(
            "L2", "x", "hi", key={"remoteJid": "123@lid", "fromMe": False, "id": "L2", "senderPn": JID}))
        r3 = await wa_inbox.ingest_message(db, inst, inbound(
            "L3", "x", "hi", key={"remoteJid": "123@lid", "fromMe": False, "id": "L3"}, senderPn=JID))
        assert r2["chat_id"] == CHAT and r3["chat_id"] == CHAT and r2["lid"] == "" and r2["contact_id"] == "c1"
        assert await db.wa_chats.count_documents({}) == 2
    _run(go())


def test_provider_ts_accepts_float_str_and_milliseconds():
    # 5.
    iso = "2026-09-26T05:20:00+00:00"
    assert wa_inbox._provider_ts(1790400000) == iso
    assert wa_inbox._provider_ts(1790400000.7) == iso
    assert wa_inbox._provider_ts("1790400000") == iso
    assert wa_inbox._provider_ts(" 1790400000.0 ") == iso
    assert wa_inbox._provider_ts(1790400000123) == iso
    assert wa_inbox._provider_ts("1790400000123") == iso
    assert wa_inbox._provider_ts({"low": 1790400000, "high": 0, "unsigned": False}) == iso
    for bad in (None, "", "abc", 0, -5, {}, [1]):
        assert wa_inbox._provider_ts(bad) is None


def test_an_empty_remote_jid_is_not_ingested(env):
    # 6.
    inst = {"instance_name": "rep_parul"}
    assert wa_inbox.normalise_upsert(inst, {"key": {"id": "X1", "remoteJid": ""}, "message": {"conversation": "x"}}) is None
    assert wa_inbox.normalise_upsert(inst, {"key": {"id": "X1"}, "message": {"conversation": "x"}}) is None
    db = env.db

    async def go():
        i = await _setup(db)
        assert await wa_inbox.ingest_message(db, i, {"key": {"id": "X1", "remoteJid": " "}}) is None
        assert await db.wa_messages.count_documents({}) == 0
    _run(go())


def test_a_redelivery_is_caught_before_the_record_scan(env, monkeypatch):
    # 7.
    db = env.db
    scans = []
    real = wa_inbox.match_record

    async def counting(db_, phone):
        scans.append(phone)
        return await real(db_, phone)
    monkeypatch.setattr(wa_inbox, "match_record", counting)

    async def go():
        inst = await _setup(db)
        await wa_inbox.ingest_message(db, inst, inbound("IN1", PHONE, "hello"))
        assert await wa_inbox.ingest_message(db, inst, inbound("IN1", PHONE, "hello")) == {"duplicate": True}
        assert scans == [PHONE]
    _run(go())


def test_backfill_lets_a_connection_error_propagate_and_leaves_the_event_unprocessed(env, monkeypatch):
    # 8.
    db = env.db

    async def boom(db_, inst, data):
        raise ConnectionError("mongo went away")
    monkeypatch.setattr(wa_inbox, "ingest_message", boom)

    async def go():
        await _setup(db)
        await db.wa_events_raw.insert_one({"instance_name": "rep_parul", "event": "MESSAGES_UPSERT",
                                           "data": inbound("R9", PHONE, "x"), "received_at": env.clock["now"],
                                           "processed": False})
        with pytest.raises(ConnectionError):
            await wa_inbox.backfill_raw_events(db)
        raw = await db.wa_events_raw.find_one({}, {"_id": 0})
        assert raw["processed"] is False and "error" not in raw
    _run(go())


# ══ W2 task 5, fix round 1 — history rows never clobber a newer last_message ═══

def test_history_rows_walk_newest_first_and_the_chat_keeps_the_newest(env):
    # 1. History comes newest -> oldest. After three history rows the chat shows the NEWEST; a live
    #    message newer still wins; a history row older than the chat's latest changes nothing.
    db = env.db
    T = 1790400000

    async def go():
        inst = await _setup(db)
        for pmid, text, ts, name in (("H3", "newest", T + 300, "Sunita-new"),
                                     ("H2", "middle", T + 200, "Sunita-mid"),
                                     ("H1", "oldest", T + 100, "Sunita-old")):
            await wa_inbox.ingest_message(db, inst, inbound(pmid, PHONE, text, messageTimestamp=ts, pushName=name),
                                          quiet=True, history=True)
        chat = await _chat(db)
        newest_row = await db.wa_messages.find_one({"provider_msg_id": "H3"}, {"_id": 0})
        assert chat["last_message_preview"] == "newest"
        assert chat["last_message_id"] == newest_row["message_id"]
        assert chat["last_message_at"] == newest_row["provider_ts"]
        assert chat["push_name"] == "Sunita-new"
        assert chat["unread_count"] == 0
        assert await db.wa_messages.count_documents({}) == 3           # every row still stored

        # A live message newer than everything: it wins (and bumps unread as usual).
        live = await wa_inbox.ingest_message(db, inst, inbound("L1", PHONE, "live one", messageTimestamp=T + 400,
                                                                pushName="Sunita-live"))
        chat = await _chat(db)
        assert chat["last_message_preview"] == "live one" and chat["last_message_id"] == live["message_id"]
        assert chat["push_name"] == "Sunita-live" and chat["unread_count"] == 1

        # A history row older than the live one (the import catching up): row stored, chat unchanged.
        before = dict(chat)
        await wa_inbox.ingest_message(db, inst, inbound("H0", PHONE, "ancient", messageTimestamp=T + 50,
                                                        pushName="Sunita-ancient"), quiet=True, history=True)
        chat = await _chat(db)
        assert await db.wa_messages.count_documents({"provider_msg_id": "H0"}) == 1
        for k in ("last_message_preview", "last_message_id", "last_message_at", "last_direction",
                  "push_name", "unread_count"):
            assert chat[k] == before[k], k
    _run(go())


def test_a_history_row_without_a_timestamp_never_becomes_the_latest(env):
    # 5. No messageTimestamp -> no provider_ts -> older than anything the chat already shows.
    db = env.db

    async def go():
        inst = await _setup(db)
        await wa_inbox.ingest_message(db, inst, inbound("T1", PHONE, "dated", messageTimestamp=1790400000),
                                      quiet=True, history=True)
        d = dict(inbound("T0", PHONE, "undated"))
        d.pop("messageTimestamp")
        row = await wa_inbox.ingest_message(db, inst, d, quiet=True, history=True)
        assert row["message_id"] and row["provider_ts"] is None       # stored, just not the latest
        chat = await _chat(db)
        assert chat["last_message_preview"] == "dated"
        # ... but on a chat with nothing yet, it is the only thing known and does land.
        other = "919800000009"
        d2 = dict(inbound("T2", other, "only one")); d2.pop("messageTimestamp")
        await wa_inbox.ingest_message(db, inst, d2, quiet=True, history=True)
        c2 = await _chat(db, f"rep_parul:{other}@s.whatsapp.net")
        assert c2["last_message_preview"] == "only one" and c2["last_message_at"]
    _run(go())


def test_chat_update_history_branches_keep_set_and_set_on_insert_disjoint(env):
    inst = {"instance_name": "rep_parul", "owner_email": PARUL, "jid": "919000000111@s.whatsapp.net"}
    match = {"contact_id": "c1", "lead_id": "", "school_id": "sch1", "display_name": "Sunita Verma"}
    row = {"message_id": "wam_x", "chat_id": CHAT, "remote_jid": JID, "phone_e164": PHONE, "direction": "in",
           "text": "hi", "push_name": "Sunita", "created_at": "2026-09-24T05:30:00+00:00", "hidden": False,
           "provider_ts": "2026-09-20T00:00:00+00:00"}
    older_chat = {"chat_id": CHAT, "phone_e164": PHONE, "status": "open", "display_name": "Sunita Verma",
                  "contact_id": "c1", "last_message_at": "2026-09-10T00:00:00+00:00", "last_message_preview": "old"}
    newer_chat = {**older_chat, "last_message_at": "2026-09-23T00:00:00+00:00", "last_message_preview": "new"}
    cases = {
        "history, new chat": wa_inbox._chat_update(inst, row, {}, inbound=False, match=match, history=True),
        "history, newer than chat": wa_inbox._chat_update(inst, row, older_chat, inbound=False, match=match, history=True),
        "history, older than chat": wa_inbox._chat_update(inst, row, newer_chat, inbound=False, match=match, history=True),
        "history, no ts, chat has one": wa_inbox._chat_update(inst, {**row, "provider_ts": None}, older_chat,
                                                              inbound=False, match=match, history=True),
    }
    for name, upd in cases.items():
        assert _disjoint(upd) == set(), f"{name}: {_disjoint(upd)}"
        assert "unread_count" not in upd["$set"] and "$inc" not in upd, name
    assert cases["history, new chat"]["$set"]["last_message_preview"] == "hi"
    assert cases["history, newer than chat"]["$set"]["last_message_preview"] == "hi"
    for name in ("history, older than chat", "history, no ts, chat has one"):
        s = cases[name]["$set"]
        assert not ({"last_message_at", "last_message_preview", "last_message_id", "last_direction", "push_name"} & set(s)), name
        assert "updated_at" in s
    # A LIVE row always moves last_message_*, even when the chat shows something newer (webhook order).
    live = wa_inbox._chat_update(inst, row, newer_chat, inbound=True, match=match)
    assert live["$set"]["last_message_preview"] == "hi" and live["$inc"] == {"unread_count": 1}
