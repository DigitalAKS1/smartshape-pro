"""W2 task 5: history sync on first link (services/wa_inbox.sync_history) and the admin
resync route.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_history_sync.py -q -p no:cacheprovider
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.wa_routes as wr
from services import wa_events, wa_inbox
from wa_fixtures import seed_instance, seed_user

PARUL = "parul@smartshape.in"
PHONE = "919800000001"
JID = f"{PHONE}@s.whatsapp.net"
OTHER_PHONE = "919800000002"
OTHER_JID = f"{OTHER_PHONE}@s.whatsapp.net"
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    """Wires wa_routes at the shared test db, AND captures every `asyncio.create_task` call so a
    test can await the coroutine it wraps instead of racing it (the brief's pattern: monkeypatch
    create_task, then await the captured task)."""
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    tasks = []
    real_ensure_future = asyncio.ensure_future

    def _capture(coro, *a, **k):
        t = real_ensure_future(coro)
        tasks.append(t)
        return t
    monkeypatch.setattr(asyncio, "create_task", _capture)
    wa_env.tasks = tasks
    return wa_env


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(wr, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def _hook(instance, data):
    return wr.wa_instance_webhook(instance, FakeRequest({"event": "connection.update",
                                                         "instance": instance, "data": data}),
                                  t="s3cret")


async def _settle(env):
    """Await every task `asyncio.create_task` produced so far, then forget them."""
    if env.tasks:
        await asyncio.gather(*env.tasks)
        env.tasks.clear()


async def _inst(db, name):
    return await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})


def chat_rec(jid, updated_at=None, name=""):
    """A 2.3.x `findChats` record."""
    c = {"id": jid, "remoteJid": jid, "name": name}
    if updated_at is not None:
        c["updatedAt"] = updated_at
    return c


def msg_rec(pmid, phone, text, ts, *, from_me=False, **extra):
    """A `findMessages` record — the same shape as a MESSAGES_UPSERT `data` item."""
    d = {"key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": from_me, "id": pmid},
         "pushName": "Sunita", "message": {"conversation": text}, "messageType": "conversation",
         "messageTimestamp": int(ts)}
    d.update(extra)
    return d


# ── sync_history via the webhook (the real wiring) ───────────────────────────

def test_first_open_starts_a_sync_and_marks_the_instance(env, monkeypatch):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        env.evo.chats["rep_parul"] = [chat_rec(JID)]
        now_s = int(env.clock["now"].timestamp())
        env.evo.messages[("rep_parul", JID)] = [msg_rec("H1", PHONE, "hi there", now_s - 3600)]
        q = asyncio.Queue()
        wa_events._queues.add(q)
        try:
            await _hook("rep_parul", {"state": "open", "wuid": JID})
            # _on_open's own instance_state publish happens before the sync task is scheduled —
            # drain it so only history-sync-caused events would remain.
            while not q.empty():
                q.get_nowait()
            await _settle(env)
            saw_more = not q.empty()
        finally:
            wa_events._queues.discard(q)
        i = await _inst(db, "rep_parul")
        assert i["history_synced_at"]
        assert i["history_stats"] == {"chats": 1, "messages": 1, "truncated": False, "errors": 0}
        row = await db.wa_messages.find_one({"provider_msg_id": "H1"}, {"_id": 0})
        assert row and row["text"] == "hi there"
        chat = await db.wa_chats.find_one({"chat_id": "rep_parul:" + JID}, {"_id": 0})
        assert chat and chat["unread_count"] == 0
        assert await db.engagement_events.count_documents({}) == 0
        assert saw_more is False           # no message_new (or any other) event from the sync
    _run(go())


def test_a_second_open_does_not_resync(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        env.evo.chats["rep_parul"] = [chat_rec(JID)]
        now_s = int(env.clock["now"].timestamp())
        env.evo.messages[("rep_parul", JID)] = [msg_rec("H1", PHONE, "hi there", now_s - 3600)]
        await _hook("rep_parul", {"state": "open", "wuid": JID})
        await _settle(env)
        first = (await _inst(db, "rep_parul"))["history_stats"]
        find_chats_calls = sum(1 for c in env.evo.calls if c["path"].startswith("/chat/findChats/"))
        assert find_chats_calls == 1
        # Reconnect: add a second chat that a resync WOULD pick up, then open again.
        env.evo.chats["rep_parul"].append(chat_rec(OTHER_JID))
        env.evo.messages[("rep_parul", OTHER_JID)] = [msg_rec("H2", OTHER_PHONE, "later", now_s - 60)]
        await _hook("rep_parul", {"state": "open", "wuid": JID})
        await _settle(env)          # nothing new to await — the guard never called create_task again
        find_chats_calls_after = sum(1 for c in env.evo.calls if c["path"].startswith("/chat/findChats/"))
        assert find_chats_calls_after == 1                      # sync_history was not called again
        assert (await _inst(db, "rep_parul"))["history_stats"] == first
        assert await db.wa_messages.count_documents({"provider_msg_id": "H2"}) == 0
    _run(go())


# ── sync_history called directly — day window, message cap, per-chat errors ──

def test_sync_stops_at_the_day_window_and_the_message_cap(env):
    db = env.db

    async def go():
        inst = await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone=PHONE)
        now = env.clock["now"]
        now_s = int(now.timestamp())
        old_s = int((now - timedelta(days=100)).timestamp())
        env.evo.chats["rep_parul"] = [chat_rec(JID)]
        # Newest first, as Evolution returns them: two in-window, then one 100 days old.
        env.evo.messages[("rep_parul", JID)] = [
            msg_rec("W1", PHONE, "recent 1", now_s - 60),
            msg_rec("W2", PHONE, "recent 2", now_s - 120),
            msg_rec("W3", PHONE, "too old", old_s),
        ]
        stats = await wa_inbox.sync_history(db, inst, days=90)
        assert stats == {"chats": 1, "messages": 2, "truncated": False, "errors": 0}
        assert await db.wa_messages.count_documents({"provider_msg_id": "W3"}) == 0
        assert await db.wa_messages.count_documents({}) == 2

        # A second, fresh instance for the message cap (max_messages hit mid-chat -> truncated).
        inst2 = await seed_instance(db, "rep_kalpana", owner_email="kalpana@smartshape.in",
                                    state="connected", phone=OTHER_PHONE)
        env.evo.chats["rep_kalpana"] = [chat_rec(OTHER_JID)]
        env.evo.messages[("rep_kalpana", OTHER_JID)] = [
            msg_rec("C1", OTHER_PHONE, "one", now_s - 10),
            msg_rec("C2", OTHER_PHONE, "two", now_s - 20),
            msg_rec("C3", OTHER_PHONE, "three", now_s - 30),
        ]
        stats2 = await wa_inbox.sync_history(db, inst2, days=90, max_messages=2)
        assert stats2 == {"chats": 1, "messages": 2, "truncated": True, "errors": 0}
        assert await db.wa_messages.count_documents(
            {"provider_msg_id": {"$in": ["C1", "C2", "C3"]}}) == 2
    _run(go())


def test_one_bad_chat_does_not_stop_the_others(env):
    db = env.db

    async def go():
        inst = await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone=PHONE)
        now_s = int(env.clock["now"].timestamp())
        env.evo.chats["rep_parul"] = [chat_rec(JID), chat_rec(OTHER_JID)]
        env.evo.messages[("rep_parul", JID)] = [msg_rec("G1", PHONE, "good chat", now_s - 30)]
        env.evo.messages[("rep_parul", OTHER_JID)] = [msg_rec("B1", OTHER_PHONE, "bad chat", now_s - 30)]
        env.evo.fail_find_for = {OTHER_JID}
        stats = await wa_inbox.sync_history(db, inst, days=90)
        assert stats["errors"] == 1
        assert stats["chats"] == 2                        # both chats counted; only the bad one's page failed
        assert stats["messages"] == 1
        assert await db.wa_messages.count_documents({"provider_msg_id": "G1"}) == 1
        assert await db.wa_messages.count_documents({"provider_msg_id": "B1"}) == 0
        i = await _inst(db, "rep_parul")
        assert i["history_synced_at"]                      # $set happens even with a per-chat error
        assert i["history_stats"] == stats
    _run(go())


# ── admin resync route ────────────────────────────────────────────────────────

def test_admin_resync_route_clears_and_restarts(env, monkeypatch):
    db = env.db

    async def go():
        inst = await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone=PHONE,
                                   history_synced_at="2026-09-01T00:00:00+00:00",
                                   history_stats={"chats": 0, "messages": 0, "truncated": False, "errors": 0})
        env.evo.chats["rep_parul"] = [chat_rec(JID)]
        now_s = int(env.clock["now"].timestamp())
        env.evo.messages[("rep_parul", JID)] = [msg_rec("R1", PHONE, "resynced", now_s - 30)]

        _as({"email": "someone@smartshape.in", "role": "sales_person"}, monkeypatch)
        with pytest.raises(HTTPException) as e:
            await wr.wa_instance_resync_history("rep_parul", FakeRequest())
        assert e.value.status_code == 403

        _as(ADMIN, monkeypatch)
        with pytest.raises(HTTPException) as e:
            await wr.wa_instance_resync_history("no_such_instance", FakeRequest())
        assert e.value.status_code == 404

        out = await wr.wa_instance_resync_history("rep_parul", FakeRequest())
        assert out == {"ok": True, "started": True}
        mid = await _inst(db, "rep_parul")
        assert "history_synced_at" not in mid              # cleared immediately, before the task runs
        await _settle(env)
        after = await _inst(db, "rep_parul")
        assert after["history_synced_at"]
        assert after["history_stats"]["messages"] == 1
        assert await db.wa_messages.count_documents({"provider_msg_id": "R1"}) == 1
    _run(go())
