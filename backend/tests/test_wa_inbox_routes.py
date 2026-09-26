"""W2 inbox routes (routes/wa_inbox_routes.py): a rep sees their own number's chats plus the
company number's chats for records they own; a manager sees everything; a reply goes out from
the chat's number and is attributed to the person who typed it.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_inbox_routes.py -q -p no:cacheprovider
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.crm_routes as crm
import routes.wa_inbox_routes as wi
import routes.wa_routes as wr
import services.wa_send as ws
from services import wa_events
from services.wa_config import get_wa_settings
from wa_fixtures import COMPANY, seed_user, seed_wa

OWNER = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}          # no module_permissions
MULTI_ADMIN = {"email": "ops@smartshape.in", "name": "Ops", "role": "sales_person", "roles": ["sales_person", "admin"]}
PARUL = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales_person", "user_id": "user_parul",
         "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
KALPANA = {"email": "kalpana@smartshape.in", "name": "Kalpana", "role": "sales_person", "user_id": "user_kalpana"}

JID_A, JID_B, JID_C = "919811111111@s.whatsapp.net", "919822222222@s.whatsapp.net", "919833333333@s.whatsapp.net"
CHAT_PA = f"rep_parul:{JID_A}"            # parul's number  <-> contact A (hers, at school S1 she owns)
CHAT_KB = f"rep_kalpana:{JID_B}"          # kalpana's number <-> contact B (hers)
CHAT_CA = f"{COMPANY}:{JID_A}"            # company number  <-> contact A
CHAT_CC = f"{COMPANY}:{JID_C}"            # company number  <-> contact C (unassigned, at S2 nobody owns)
CHAT_GROUP = f"{COMPANY}:120363@g.us"     # a group: hidden everywhere
T0 = "2026-09-24T05:00:00+00:00"


class FakeRequest:
    def __init__(self, body=None, query_params=None):
        self._body = body or {}
        self.query_params = query_params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    monkeypatch.setattr(wi, "db", wa_env.db)
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setattr(crm, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    wa_events._queues.clear()
    yield wa_env
    wa_events._queues.clear()


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(wi, "get_current_user", _me)
    monkeypatch.setattr(wr, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as e:
        _run(coro)
    return e.value.status_code


def _chat(chat_id, instance, jid, phone, name, *, contact_id="", school_id="", assignee="", unread=0,
          at=T0, status="open", hidden=False, **extra):
    return {"chat_id": chat_id, "instance_name": instance, "remote_jid": jid, "phone_e164": phone,
            "display_name": name, "push_name": name, "contact_id": contact_id, "lead_id": "", "school_id": school_id,
            "assignee_email": assignee, "status": status, "unread_count": unread, "last_message_at": at,
            "last_message_preview": "hello", "last_direction": "in", "last_message_id": "", "notes": [],
            "created_at": T0, "updated_at": at, "hidden": hidden, **extra}


def _row(chat, i, *, direction="in", text="", read=False):
    at = (ws._parse(T0) + timedelta(minutes=i)).isoformat()
    r = {"message_id": f"wam_{chat['chat_id'][-6:]}_{i}", "instance_name": chat["instance_name"],
         "provider_msg_id": f"PM_{chat['chat_id'][-6:]}_{i}", "chat_id": chat["chat_id"], "direction": direction,
         "remote_jid": chat["remote_jid"], "phone_e164": chat["phone_e164"], "to_e164": chat["phone_e164"],
         "contact_id": chat.get("contact_id", ""), "lead_id": "", "school_id": chat.get("school_id", ""),
         "kind": "chat", "text": text or f"msg {i}", "media": None, "status": "delivered" if direction == "in" else "sent",
         "source": "webhook" if direction == "in" else "app", "created_at": at, "hidden": False}
    if read:
        r["read_at"] = at
    return r


async def _seed(db):
    """The brief's fixture: company + rep_parul + rep_kalpana (all connected); contacts A (parul,
    at S1 that parul owns), B (kalpana), C (unassigned at S2 that nobody owns); the five chats."""
    for u in (OWNER, PARUL, KALPANA):
        await seed_user(db, u["email"], role=u["role"], user_id=u.get("user_id"))
        await db.users.update_one({"email": u["email"]}, {"$set": {"name": u["name"]}})
    await seed_wa(db, reps={PARUL["email"]: "connected", KALPANA["email"]: "connected"})
    await db.schools.insert_many([
        {"school_id": "sch_1", "school_name": "St Mary", "name": "St Mary", "assigned_to": PARUL["email"], "is_deleted": False},
        {"school_id": "sch_2", "school_name": "Delhi Public", "name": "Delhi Public", "assigned_to": "", "is_deleted": False}])
    await db.contacts.insert_many([
        {"contact_id": "con_a", "name": "Anita", "phone": "9811111111", "school_id": "sch_1",
         "assigned_to": PARUL["email"], "is_deleted": False},
        {"contact_id": "con_b", "name": "Bhavna", "phone": "9822222222", "school_id": "",
         "assigned_to": KALPANA["email"], "is_deleted": False},
        {"contact_id": "con_c", "name": "Chetan", "phone": "9833333333", "school_id": "sch_2",
         "assigned_to": "", "is_deleted": False}])
    chats = {
        CHAT_PA: _chat(CHAT_PA, "rep_parul", JID_A, "919811111111", "Anita", contact_id="con_a", school_id="sch_1",
                       assignee=PARUL["email"], unread=2, at="2026-09-24T05:04:00+00:00"),
        CHAT_KB: _chat(CHAT_KB, "rep_kalpana", JID_B, "919822222222", "bee", contact_id="con_b",
                       assignee=KALPANA["email"], unread=1, at="2026-09-24T05:03:00+00:00"),
        CHAT_CA: _chat(CHAT_CA, COMPANY, JID_A, "919811111111", "Anita", contact_id="con_a", school_id="sch_1",
                       assignee=PARUL["email"], unread=3, at="2026-09-24T05:02:00+00:00"),
        CHAT_CC: _chat(CHAT_CC, COMPANY, JID_C, "919833333333", "Chetan", contact_id="con_c", school_id="sch_2",
                       assignee=KALPANA["email"], unread=4, at="2026-09-24T05:01:00+00:00"),
        CHAT_GROUP: _chat(CHAT_GROUP, COMPANY, "120363@g.us", "", "Parents group", unread=9, hidden=True),
    }
    await db.wa_chats.insert_many([dict(c) for c in chats.values()])
    rows = []
    for i in range(3):                                     # 3 unread inbound on parul's chat with A
        rows.append(_row(chats[CHAT_PA], i))
    rows.append(_row(chats[CHAT_CA], 0, text="company hello"))
    rows.append(_row(chats[CHAT_KB], 0, text="kalpana hello"))
    rows.append(_row(chats[CHAT_CC], 0, text="chetan hello"))
    await db.wa_messages.insert_many(rows)
    return chats


def _ids(out):
    return [c["chat_id"] for c in out["items"]]


# ── Scope ─────────────────────────────────────────────────────────────────────

def test_rep_sees_own_instance_chats_and_company_chats_for_own_records_only(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        out = await wi.wa_chats(FakeRequest())
        assert _ids(out) == [CHAT_PA, CHAT_CA] and out["total"] == 2          # last_message_at desc
        assert CHAT_KB not in _ids(out) and CHAT_CC not in _ids(out) and CHAT_GROUP not in _ids(out)
        first = out["items"][0]
        assert first["contact_name"] == "Anita" and first["school_name"] == "St Mary"
        assert first["instance_label"] == "rep_parul" and first["owner_email"] == PARUL["email"]
        assert first["opted_out"] is False and "instance_token" not in first
        assert out["unread_total"] == 5
    _run(go())


@pytest.mark.parametrize("user", [OWNER, MULTI_ADMIN])
def test_manager_sees_everything_including_the_owner_with_no_module_permissions(env, monkeypatch, user):
    db = env.db
    _as(user, monkeypatch)

    async def go():
        await _seed(db)
        assert wi.is_manager(user) is True and await wi.chat_scope(user) is None
        out = await wi.wa_chats(FakeRequest())
        assert set(_ids(out)) == {CHAT_PA, CHAT_KB, CHAT_CA, CHAT_CC} and out["total"] == 4
        assert out["unread_total"] == 10                                     # the group's 9 never count
    _run(go())


def test_scope_filters_mine_unassigned_and_status(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"scope": "mine"}))) == []
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"scope": "unassigned"}))) == []
        await db.wa_chats.update_one({"chat_id": CHAT_CC}, {"$set": {"assignee_email": ""}})
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"scope": "unassigned"}))) == [CHAT_CC]
        await db.wa_chats.update_one({"chat_id": CHAT_KB}, {"$set": {"status": "resolved"}})
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"status": "resolved"}))) == [CHAT_KB]
        assert CHAT_KB not in _ids(await wi.wa_chats(FakeRequest()))          # default: open
        assert len(_ids(await wi.wa_chats(FakeRequest(query_params={"status": "all"})))) == 4
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"instance": "rep_parul"}))) == [CHAT_PA]
        # a rep's "mine": her number's chats plus what is assigned to her
        _as(PARUL, monkeypatch)
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"scope": "mine"}))) == [CHAT_PA, CHAT_CA]
    _run(go())


def test_search_matches_name_and_phone(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"q": "anita"}))) == [CHAT_PA, CHAT_CA]
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"q": "98333"}))) == [CHAT_CC]
        # the contact's CRM name matches even when the chat shows the WhatsApp push name
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"q": "Bhavna"}))) == [CHAT_KB]
        assert _ids(await wi.wa_chats(FakeRequest(query_params={"q": "nobody"}))) == []
    _run(go())


# ── Messages ──────────────────────────────────────────────────────────────────

def test_messages_are_paged_oldest_to_newest_with_before_cursor(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        chats = await _seed(db)
        await db.wa_messages.delete_many({"chat_id": CHAT_PA})
        await db.wa_messages.insert_many([_row(chats[CHAT_PA], i) for i in range(70)])
        page = await wi.wa_chat_messages(CHAT_PA, FakeRequest())
        assert len(page["items"]) == 50 and page["has_more"] is True
        ats = [r["created_at"] for r in page["items"]]
        assert ats == sorted(ats) and page["items"][-1]["text"] == "msg 69" and page["items"][0]["text"] == "msg 20"
        assert all("instance_token" not in r and "_id" not in r for r in page["items"])
        older = await wi.wa_chat_messages(CHAT_PA, FakeRequest(query_params={"before": ats[0]}))
        assert len(older["items"]) == 20 and older["has_more"] is False
        assert older["items"][0]["text"] == "msg 0" and older["items"][-1]["text"] == "msg 19"
    _run(go())


def test_rep_cannot_read_or_send_on_another_reps_chat(env, monkeypatch):
    db = env.db
    _as(KALPANA, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_messages(CHAT_PA, FakeRequest())
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_PA, FakeRequest({"text": "hi"}))
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_messages(CHAT_GROUP, FakeRequest())                # hidden: never found
        assert e.value.status_code == 404
        assert env.evo.sends == []
    _run(go())


# ── Send ──────────────────────────────────────────────────────────────────────

def test_manager_reply_goes_out_from_the_reps_number_and_is_attributed(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        agen = wa_events.subscribe()
        first = asyncio.ensure_future(agen.__anext__())
        await asyncio.sleep(0)
        out = await wi.wa_chat_send(CHAT_PA, FakeRequest({"text": "On it, Anita", "quoted_provider_msg_id": "PM_x"}))
        assert out["status"] == "sent" and out["message_id"] and out["reason"] == ""
        assert env.evo.sends[-1]["instance"] == "rep_parul" and env.evo.sends[-1]["text"] == "On it, Anita"
        row = await db.wa_messages.find_one({"message_id": out["message_id"]}, {"_id": 0})
        assert row["typed_by"] == OWNER["email"] and row["sent_via_owner_email"] == PARUL["email"]
        assert row["kind"] == "chat" and row["chat_id"] == CHAT_PA and row["quoted_provider_msg_id"] == "PM_x"
        assert row["contact_id"] == "con_a" and row["school_id"] == "sch_1"
        assert out["message"]["message_id"] == out["message_id"] and "instance_token" not in out["message"]
        chat = await db.wa_chats.find_one({"chat_id": CHAT_PA}, {"_id": 0})
        assert chat["last_direction"] == "out" and chat["last_message_preview"] == "On it, Anita"
        assert chat["unread_count"] == 2                                     # a reply never bumps unread
        ev = await asyncio.wait_for(first, 1)
        assert ev["type"] == "message_new" and ev["chat_id"] == CHAT_PA and ev["direction"] == "out"
        await agen.aclose()
    _run(go())


def test_rep_reply_on_company_chat_for_own_record_is_allowed_but_not_for_others(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        out = await wi.wa_chat_send(CHAT_CA, FakeRequest({"text": "from the company number"}))
        assert out["status"] == "sent" and env.evo.sends[-1]["instance"] == COMPANY
        row = await db.wa_messages.find_one({"message_id": out["message_id"]}, {"_id": 0})
        assert row["typed_by"] == PARUL["email"] and row["sender_kind"] == "company"
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_CC, FakeRequest({"text": "not mine"}))
        assert e.value.status_code == 403 and len(env.evo.sends) == 1
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_CA, FakeRequest({}))                  # nothing to send
        assert e.value.status_code == 400
    _run(go())


def test_send_on_a_disconnected_number_is_409(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "disconnected"}})
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_PA, FakeRequest({"text": "hi"}))
        assert e.value.status_code == 409 and "is not connected" in e.value.detail
        assert env.evo.sends == [] and await db.wa_messages.count_documents({"direction": "out"}) == 0
    _run(go())


def test_send_with_template_renders_contact_and_my_phone(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        await db.whatsapp_templates.insert_one({"template_id": "wat_1", "name": "Follow-up",
                                                "body": "Hi {contact_name} from {my_name} {my_phone} re {school_name}"})
        out = await wi.wa_chat_send(CHAT_PA, FakeRequest({"template_id": "wat_1"}))
        assert out["status"] == "sent"
        text = env.evo.sends[-1]["text"]
        assert text.startswith("Hi Anita from Owner ") and "919000000100" in text and text.endswith("re St Mary")
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_PA, FakeRequest({"template_id": "wat_missing"}))
        assert e.value.status_code == 404
    _run(go())


def test_send_with_attachment_uses_the_stored_url(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        await db.whatsapp_attachments.insert_one({"attachment_id": "att_1", "filename": "catalogue.pdf",
                                                  "url": "https://cdn.example/catalogue.pdf",
                                                  "content_type": "application/pdf", "attachment_type": "document"})
        out = await wi.wa_chat_send(CHAT_PA, FakeRequest({"attachment_id": "att_1", "text": "Our catalogue"}))
        assert out["status"] == "sent"
        s = env.evo.sends[-1]
        assert s["media"] == "https://cdn.example/catalogue.pdf" and s["mediatype"] == "document"
        assert s["text"] == "Our catalogue"
        row = await db.wa_messages.find_one({"message_id": out["message_id"]}, {"_id": 0})
        assert row["media"]["url"] == "https://cdn.example/catalogue.pdf" and row["media"]["mime"] == "application/pdf"
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_send(CHAT_PA, FakeRequest({"attachment_id": "att_missing"}))
        assert e.value.status_code == 404
    _run(go())


def test_chat_reply_bypasses_the_daily_cap_but_not_the_hourly(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await _seed(db)
        await db.settings.update_one({"type": "wa"}, {"$set": {"hourly_cap": 3}})
        now = env.clock["now"]
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        cap = ws.daily_cap(inst, await get_wa_settings(db), now)
        await db.wa_send_ledger.insert_one({"instance_name": "rep_parul", "day": ws.ist_day(now),
                                            "sent_count": cap, "hour_bucket": {}, "last_sent_at": None})
        out = await wi.wa_chat_send(CHAT_PA, FakeRequest({"text": "still goes"}))
        assert out["status"] == "sent" and len(env.evo.sends) == 1
        await db.wa_send_ledger.update_one({"instance_name": "rep_parul", "day": ws.ist_day(now)},
                                           {"$set": {f"hour_bucket.{ws.ist_hour(now)}": 3}})
        out = await wi.wa_chat_send(CHAT_PA, FakeRequest({"text": "waits for the next hour"}))
        assert out["status"] == "queued" and out["reason"] == "hourly_cap" and len(env.evo.sends) == 1
        row = await db.wa_messages.find_one({"message_id": out["message_id"]}, {"_id": 0})
        assert row["status"] == "queued" and row["typed_by"] == OWNER["email"]
        assert out["message"]["status"] == "queued"
    _run(go())


# ── Read / resolve / reopen / assign / notes / link ───────────────────────────

def test_read_marks_locally_and_calls_evolution(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        out = await wi.wa_chat_read(CHAT_PA, FakeRequest())
        assert out["unread_count"] == 0 and out["marked"] == 3
        chat = await db.wa_chats.find_one({"chat_id": CHAT_PA}, {"_id": 0})
        assert chat["unread_count"] == 0
        rows = await db.wa_messages.find({"chat_id": CHAT_PA, "direction": "in"}, {"_id": 0}).to_list(None)
        assert len(rows) == 3 and all(r.get("read_at") for r in rows)
        keys = env.evo.read_marks[-1]["readMessages"]
        assert len(keys) == 3 and all(k["fromMe"] is False and k["remoteJid"] == JID_A for k in keys)
        assert {k["id"] for k in keys} == {r["provider_msg_id"] for r in rows}
        assert env.evo.calls[-1]["token"] == "tok_rep_parul"
        # a second read has nothing left to mark and never calls Evolution again
        n = len(env.evo.read_marks)
        assert (await wi.wa_chat_read(CHAT_PA, FakeRequest()))["marked"] == 0 and len(env.evo.read_marks) == n
    _run(go())


def test_read_survives_an_evolution_error(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)
    real = env.evo.request

    async def boom(method, path, json=None, token=None):
        if path.startswith("/chat/markMessageAsRead/"):
            from services.evolution_client import EvolutionError
            raise EvolutionError(500, "down")
        return await real(method, path, json=json, token=token)
    monkeypatch.setattr(env.evo, "request", boom)

    async def go():
        await _seed(db)
        out = await wi.wa_chat_read(CHAT_PA, FakeRequest())
        assert out["unread_count"] == 0 and out["marked"] == 3
        assert (await db.wa_chats.find_one({"chat_id": CHAT_PA}))["unread_count"] == 0
    _run(go())


def test_resolve_reopen_assign_notes(env, monkeypatch):
    db = env.db

    async def go():
        await _seed(db)
        got = []
        agen = wa_events.subscribe()
        first = asyncio.ensure_future(agen.__anext__())
        await asyncio.sleep(0)
        _as(PARUL, monkeypatch)
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_assign(CHAT_PA, FakeRequest({"email": KALPANA["email"]}))
        assert e.value.status_code == 403
        out = await wi.wa_chat_resolve(CHAT_PA, FakeRequest())
        assert out["status"] == "resolved"
        ev = await asyncio.wait_for(first, 1)
        assert ev["type"] == "chat_updated" and ev["chat_id"] == CHAT_PA and ev["status"] == "resolved"
        await agen.aclose()
        assert (await wi.wa_chat_reopen(CHAT_PA, FakeRequest()))["status"] == "open"
        out = await wi.wa_chat_notes(CHAT_PA, FakeRequest({"text": "  call back after 4 pm  "}))
        assert out["notes"][-1]["by"] == PARUL["email"] and out["notes"][-1]["text"] == "call back after 4 pm"
        assert out["notes"][-1]["at"]
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_notes(CHAT_PA, FakeRequest({"text": "   "}))
        assert e.value.status_code == 400
        long = await wi.wa_chat_notes(CHAT_PA, FakeRequest({"text": "x" * 5000}))
        assert len(long["notes"][-1]["text"]) == 2000
        _as(OWNER, monkeypatch)
        out = await wi.wa_chat_assign(CHAT_PA, FakeRequest({"email": KALPANA["email"]}))
        assert out["assignee_email"] == KALPANA["email"]
        assert (await db.wa_chats.find_one({"chat_id": CHAT_PA}))["assignee_email"] == KALPANA["email"]
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_assign(CHAT_PA, FakeRequest({"email": "ghost@smartshape.in"}))
        assert e.value.status_code == 400
        assert (await wi.wa_chat_assign(CHAT_PA, FakeRequest({"email": ""})))["assignee_email"] == ""
    _run(go())


def test_link_sets_record_on_chat_and_rows_and_create_contact_makes_one(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)
    jid = "919844444444@s.whatsapp.net"
    cid = f"{COMPANY}:{jid}"

    async def go():
        chats = await _seed(db)
        chat = _chat(cid, COMPANY, jid, "919844444444", "919844444444")
        await db.wa_chats.insert_one(dict(chat))
        await db.wa_messages.insert_many([_row(chat, 0), _row(chat, 1, direction="out")])
        out = await wi.wa_chat_link(cid, FakeRequest({"create_contact": {"name": "Dev Sharma", "school_id": "sch_2"}}))
        assert out["contact_id"].startswith("con_") and out["school_id"] == "sch_2" and out["display_name"] == "Dev Sharma"
        c = await db.contacts.find_one({"contact_id": out["contact_id"]}, {"_id": 0})
        assert c["phone"] == "919844444444" and c["source"] == "whatsapp" and c["name"] == "Dev Sharma"
        assert c["school_id"] == "sch_2" and c["created_by"] == OWNER["email"] and c["assigned_to"] == OWNER["email"]
        assert c["is_deleted"] is False and c["tag_ids"] == []
        rows = await db.wa_messages.find({"chat_id": cid}, {"_id": 0}).to_list(None)
        assert all(r["contact_id"] == out["contact_id"] and r["school_id"] == "sch_2" for r in rows)
        # linking an existing contact: the chat and only the rows that have none
        await db.wa_messages.update_one({"chat_id": CHAT_CC, "message_id": {"$exists": True}},
                                        {"$set": {"contact_id": "", "school_id": ""}})
        out = await wi.wa_chat_link(CHAT_CC, FakeRequest({"contact_id": "con_b"}))
        assert out["contact_id"] == "con_b"
        assert (await db.wa_messages.find_one({"chat_id": CHAT_CC}))["contact_id"] == "con_b"
        assert (await db.wa_messages.find_one({"chat_id": CHAT_PA}))["contact_id"] == "con_a"      # untouched
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_link(CHAT_CC, FakeRequest({"contact_id": "con_missing"}))
        assert e.value.status_code == 404
        # a rep links only to a record she can see
        _as(PARUL, monkeypatch)
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_link(CHAT_PA, FakeRequest({"contact_id": "con_b"}))
        assert e.value.status_code == 403
        assert (await wi.wa_chat_link(CHAT_PA, FakeRequest({"school_id": "sch_1"})))["school_id"] == "sch_1"
        with pytest.raises(HTTPException) as e:
            await wi.wa_chat_link(CHAT_PA, FakeRequest({"school_id": "sch_2"}))
        assert e.value.status_code == 403
        assert chats  # fixture used
    _run(go())


# ── Per-record, unread, stream ────────────────────────────────────────────────

def test_unread_count_is_scoped(env, monkeypatch):
    db = env.db

    async def go():
        await _seed(db)
        _as(PARUL, monkeypatch)
        assert await wi.wa_unread_count(FakeRequest()) == {"unread": 5}
        _as(KALPANA, monkeypatch)
        assert await wi.wa_unread_count(FakeRequest()) == {"unread": 1}
        _as(OWNER, monkeypatch)
        assert await wi.wa_unread_count(FakeRequest()) == {"unread": 10}
        await db.wa_chats.update_one({"chat_id": CHAT_CC}, {"$set": {"status": "resolved"}})
        assert await wi.wa_unread_count(FakeRequest()) == {"unread": 6}     # only open chats
    _run(go())


def test_messages_by_record_is_scoped(env, monkeypatch):
    db = env.db

    async def go():
        await _seed(db)
        _as(PARUL, monkeypatch)
        out = await wi.wa_messages_by_record(FakeRequest(query_params={"contact_id": "con_a"}))
        assert len(out["items"]) == 4 and {r["chat_id"] for r in out["items"]} == {CHAT_PA, CHAT_CA}
        ats = [r["created_at"] for r in out["items"]]
        assert ats == sorted(ats, reverse=True)                              # newest first
        assert all("instance_token" not in r for r in out["items"])
        out = await wi.wa_messages_by_record(FakeRequest(query_params={"contact_id": "con_a", "limit": "2"}))
        assert len(out["items"]) == 2
        out = await wi.wa_messages_by_record(FakeRequest(query_params={"school_id": "sch_1"}))
        assert len(out["items"]) == 4
        _as(KALPANA, monkeypatch)
        out = await wi.wa_messages_by_record(FakeRequest(query_params={"contact_id": "con_a"}))
        assert out["items"] == []
        with pytest.raises(HTTPException) as e:
            await wi.wa_messages_by_record(FakeRequest())
        assert e.value.status_code == 400
    _run(go())


def test_stream_filters_events_by_scope_and_pings(env, monkeypatch):
    db = env.db

    async def go():
        await _seed(db)
        frames = []
        gen = wi._events(PARUL, ping_s=0.05)

        async def reader():
            async for f in gen:
                frames.append(f)
        task = asyncio.ensure_future(reader())
        await asyncio.sleep(0.02)                                            # connected + subscribed
        assert frames and frames[0] == ": connected\n\n"
        await wa_events.publish({"type": "message_new", "instance_name": "rep_kalpana", "chat_id": CHAT_KB,
                                 "contact_id": "con_b", "lead_id": "", "school_id": ""})
        await wa_events.publish({"type": "message_new", "instance_name": "rep_parul", "chat_id": CHAT_PA,
                                 "contact_id": "con_a", "lead_id": "", "school_id": "sch_1"})
        await wa_events.publish({"type": "chat_updated", "instance_name": COMPANY, "chat_id": CHAT_CC,
                                 "contact_id": "con_c", "lead_id": "", "school_id": "sch_2"})
        await wa_events.publish({"type": "chat_updated", "instance_name": COMPANY, "chat_id": CHAT_CA,
                                 "contact_id": "con_a", "lead_id": "", "school_id": "sch_1"})
        await wa_events.publish({"type": "instance_state", "instance_name": "rep_kalpana", "state": "connected",
                                 "chat_id": "", "contact_id": "", "lead_id": "", "school_id": ""})
        await wa_events.publish({"type": "instance_state", "instance_name": "rep_parul", "state": "disconnected",
                                 "chat_id": "", "contact_id": "", "lead_id": "", "school_id": ""})
        await asyncio.sleep(0.3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        joined = "".join(frames)
        assert joined.count(CHAT_PA) == 1 and CHAT_KB not in joined
        assert joined.count(CHAT_CA) == 1 and CHAT_CC not in joined
        assert 'event: message_new\ndata: {' in joined and 'event: chat_updated\ndata: {' in joined
        assert '"state": "disconnected"' in joined and '"state": "connected"' not in joined
        assert joined.count(": ping\n\n") >= 1
        assert len(wa_events._queues) == 0                                   # the subscription was released
    _run(go())


def test_stream_lets_a_manager_see_every_instance_state(env, monkeypatch):
    async def go():
        await _seed(env.db)
        ctx = await wi.scope_ctx(OWNER)
        assert wi._event_in_scope({"type": "instance_state", "instance_name": "rep_kalpana"}, ctx) is True
        ctx = await wi.scope_ctx(PARUL)
        assert wi._event_in_scope({"type": "instance_state", "instance_name": "rep_kalpana"}, ctx) is False
        assert wi._event_in_scope({"type": "instance_state", "instance_name": "rep_parul"}, ctx) is True
        assert wi._event_in_scope({"type": "message_new", "instance_name": COMPANY, "contact_id": "con_a"}, ctx) is True
        assert wi._event_in_scope({"type": "message_new", "instance_name": COMPANY, "contact_id": "con_c"}, ctx) is False
        assert wi._event_in_scope({"type": "message_new", "instance_name": COMPANY, "school_id": "sch_1"}, ctx) is True
    _run(go())


def test_the_router_is_mounted_under_api():
    import main
    paths = {getattr(r, "path", "") for r in main.app.routes}
    for p in ("/api/wa/chats", "/api/wa/chats/{chat_id}/messages", "/api/wa/chats/{chat_id}/send",
              "/api/wa/chats/{chat_id}/read", "/api/wa/chats/{chat_id}/link", "/api/wa/messages",
              "/api/wa/unread-count", "/api/wa/stream"):
        assert p in paths
