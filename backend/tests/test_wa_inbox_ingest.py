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
