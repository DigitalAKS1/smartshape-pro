"""The per-instance webhook: secret first, instance must match, unknown instances ignored, and
the four W1 event handlers (+ the W2 raw stub).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_webhook.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.wa_routes as wr
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

PARUL = "parul@smartshape.in"
KALPANA = "kalpana@smartshape.in"
OWNER = "info@smartshape.in"


class FakeRequest:
    def __init__(self, body=None):
        self._body = body if body is not None else {}
        self.read = False

    async def json(self):
        self.read = True
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    return wa_env


def _run(coro):
    return asyncio.run(coro)


def _hook(instance, body, t="s3cret"):
    return wr.wa_instance_webhook(instance, FakeRequest(body), t=t)


async def _inst(db, name):
    return await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})


# ── RF1: authentication and routing ──────────────────────────────────────────

def test_secret_is_checked_before_the_body_is_read(env):
    for t in ("wrong", ""):
        req = FakeRequest({"event": "connection.update"})
        with pytest.raises(HTTPException) as e:
            _run(wr.wa_instance_webhook("rep_parul", req, t=t))
        assert e.value.status_code == 401 and req.read is False


def test_no_secret_configured_refuses_everything(env, monkeypatch):
    monkeypatch.delenv("WA_WEBHOOK_SECRET")
    with pytest.raises(HTTPException) as e:
        _run(_hook("rep_parul", {"event": "connection.update"}, t=""))
    assert e.value.status_code == 401


def test_payload_instance_must_match_the_path(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        with pytest.raises(HTTPException) as e:
            await _hook("rep_parul", {"event": "connection.update", "instance": COMPANY,
                                      "data": {"state": "close", "statusReason": 401}})
        assert e.value.status_code == 400            # ruling: auth passed, the body is wrong
        assert (await _inst(db, "rep_parul"))["state"] == "connected"
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_unknown_instance_is_acknowledged_and_ignored(env):
    db = env.db

    async def go():
        out = await _hook("rep_ghost", {"event": "messages.upsert", "instance": "rep_ghost", "data": {"x": 1}})
        assert out == {"ok": True, "ignored": "unknown_instance"}
        assert await db.wa_instances.count_documents({}) == 0
        assert await db.wa_events_raw.count_documents({}) == 0
    _run(go())


# ── CONNECTION_UPDATE ────────────────────────────────────────────────────────

def test_open_marks_connected_with_phone_and_starts_warmup(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr", warmup_started_at=None,
                            qr_base64="data:QR")
        await _hook("rep_parul", {"event": "connection.update", "instance": "rep_parul",
                                  "data": {"state": "open", "wuid": "919811111111@s.whatsapp.net"}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "connected" and i["phone_e164"] == "919811111111"
        assert i["jid"] == "919811111111@s.whatsapp.net" and i["qr_base64"] == ""
        assert i["warmup_started_at"] == env.clock["now"].isoformat()
    _run(go())


def test_open_without_wuid_asks_evolution_for_the_owner(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        env.evo.owner_jid["rep_parul"] = "919822222222:12@s.whatsapp.net"
        await _hook("rep_parul", {"event": "CONNECTION_UPDATE", "data": {"state": "open"}})
        assert (await _inst(db, "rep_parul"))["phone_e164"] == "919822222222"
    _run(go())


def test_open_while_paused_stays_paused(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="paused", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["state"] == "paused"
    _run(go())


def test_relinking_the_same_sim_keeps_warmup_but_a_new_sim_restarts_it(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["warmup_started_at"] == "2026-01-01T00:00:00+00:00"
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919833333333@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["warmup_started_at"] == env.clock["now"].isoformat()
    _run(go())


def test_open_on_a_number_already_linked_elsewhere_unlinks_the_newcomer(env):          # RF2
    db = env.db

    async def go():
        await seed_instance(db, "rep_kalpana", owner_email=KALPANA, state="connected", phone="919811111111")
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        p = await _inst(db, "rep_parul")
        assert p["state"] == "unlinked" and "already linked" in p["paused_reason"]
        assert p.get("phone_e164", "") == ""
        assert any(c["path"] == "/instance/logout/rep_parul" for c in env.evo.calls)
        k = await _inst(db, "rep_kalpana")
        assert k["state"] == "connected" and k["phone_e164"] == "919811111111"
        told = {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)}
        assert told == {PARUL, KALPANA, OWNER}
    _run(go())


def test_close_401_pauses_and_alerts_the_rep_and_admins(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "close", "statusReason": 401}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "paused" and "logged this number out" in i["paused_reason"]
        told = {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)}
        assert told == {PARUL, OWNER}
    _run(go())


def test_transient_close_marks_disconnected_and_alerts_once_a_day(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        for _ in range(2):
            await _hook("rep_parul", {"event": "connection.update", "data": {"state": "close", "statusReason": 428}})
            await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "connected"}})
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        assert len([p for p in env.pushes if p["email"] == PARUL]) == 1
    _run(go())


def test_company_close_alerts_every_admin(env):                                        # RF3
    db = env.db

    async def go():
        await seed_user(db, "bde@smartshape.in", role="admin")
        await seed_wa(db, reps={PARUL: "connected"})
        await _hook(COMPANY, {"event": "connection.update", "data": {"state": "close", "statusReason": 500}})
        assert (await _inst(db, COMPANY))["state"] == "disconnected"
        notes = await db.notifications.find({}, {"_id": 0}).to_list(None)
        assert {n["assigned_to"] for n in notes} == {OWNER, "bde@smartshape.in"}
        assert all(n["title"] == "Company WhatsApp disconnected" for n in notes)
    _run(go())


def test_open_records_the_profile_name(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        await _hook("rep_parul", {"event": "connection.update", "data": {
            "state": "open", "wuid": "919811111111:7@s.whatsapp.net", "profileName": "Parul SmartShape"}})
        i = await _inst(db, "rep_parul")
        assert i["profile_name"] == "Parul SmartShape" and i["jid"] == "919811111111@s.whatsapp.net"
    _run(go())


def test_the_close_after_unlinking_a_duplicate_changes_nothing(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_kalpana", owner_email=KALPANA, state="connected", phone="919811111111")
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        before = await db.notifications.count_documents({})
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "close", "statusReason": 401}})
        assert (await _inst(db, "rep_parul"))["state"] == "unlinked"
        assert await db.notifications.count_documents({}) == before
    _run(go())


def test_connecting_and_unknown_events_change_no_state(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "connecting"}})
        out = await _hook("rep_parul", {"event": "chats.update", "data": {}})
        assert out == {"ok": True, "ignored": "CHATS_UPDATE"}
        assert (await _inst(db, "rep_parul"))["state"] == "connected"
    _run(go())


# ── QRCODE_UPDATED ───────────────────────────────────────────────────────────

def test_qrcode_updated_caches_the_qr_for_wa_me(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="disconnected")
        await _hook("rep_parul", {"event": "qrcode.updated",
                                  "data": {"qrcode": {"base64": "data:image/png;base64,NEW", "code": "2@x"}}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "qr" and i["qr_base64"] == "data:image/png;base64,NEW" and i["qr_at"]
    _run(go())


# ── MESSAGES_UPDATE ──────────────────────────────────────────────────────────

def test_messages_update_moves_status_forward_only(env):
    db = env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")        # provider id PMID1
        await _hook(COMPANY, {"event": "messages.update",
                              "data": {"keyId": "PMID1", "fromMe": True, "status": "DELIVERY_ACK"}})
        await _hook(COMPANY, {"event": "MESSAGES_UPDATE",
                              "data": [{"key": {"id": "PMID1"}, "update": {"status": 4}}]})
        await _hook(COMPANY, {"event": "messages.update",
                              "data": {"keyId": "PMID1", "status": "DELIVERY_ACK"}})        # late, out of order
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["status"] == "read"
        assert [h["status"] for h in row["status_history"]] == ["sending", "sent", "delivered", "read"]
    _run(go())


def test_a_receipt_error_fails_only_an_undelivered_message(env):
    db = env.db

    async def go():
        await seed_wa(db)
        a = await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")          # PMID1
        b = await send_whatsapp(db, to="9822222222", text="b", kind="dispatch")          # PMID2
        await _hook(COMPANY, {"event": "messages.update", "data": {"keyId": "PMID2", "status": "DELIVERY_ACK"}})
        for pmid in ("PMID1", "PMID2"):
            await _hook(COMPANY, {"event": "messages.update", "data": {"keyId": pmid, "status": 0}})
        ra = await db.wa_messages.find_one({"message_id": a["message_id"]}, {"_id": 0})
        rb = await db.wa_messages.find_one({"message_id": b["message_id"]}, {"_id": 0})
        assert ra["status"] == "failed" and ra["fail_reason"]
        assert rb["status"] == "delivered"
    _run(go())


def test_a_receipt_for_another_instances_message_is_ignored(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")        # company, PMID1
        await _hook("rep_parul", {"event": "messages.update", "data": {"keyId": "PMID1", "status": "READ"}})
        assert (await db.wa_messages.find_one({"message_id": res["message_id"]}))["status"] == "sent"
    _run(go())


def test_messages_update_for_a_legacy_campaign_row_updates_whatsapp_scheduled(env):
    db = env.db

    async def go():
        await seed_wa(db)
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "s1", "wa_message_id": "OLD1", "status": "sent"})
        await _hook(COMPANY, {"event": "messages.update", "data": {"keyId": "OLD1", "status": "READ"}})
        assert (await db.whatsapp_scheduled.find_one({"scheduled_id": "s1"}))["status"] == "read"
    _run(go())


# ── SEND_MESSAGE ─────────────────────────────────────────────────────────────

def test_a_message_sent_from_the_phone_is_recorded_once(env):
    db = env.db
    body = {"event": "send.message", "data": {"key": {"id": "PHONE1", "fromMe": True,
                                                       "remoteJid": "919811111111@s.whatsapp.net"},
                                               "message": {"conversation": "typed on the phone"},
                                               "messageTimestamp": 1790000000}}

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919000000111")
        await _hook("rep_parul", body)
        await _hook("rep_parul", body)
        rows = await db.wa_messages.find({"provider_msg_id": "PHONE1"}, {"_id": 0}).to_list(None)
        assert len(rows) == 1
        r = rows[0]
        assert r["message_id"].startswith("wam_")      # ruling: every ingested row carries an id of ours
        assert r["source"] == "phone" and r["text"] == "typed on the phone" and r["direction"] == "out"
        assert r["chat_id"] == "rep_parul:919811111111@s.whatsapp.net" and r["to_e164"] == "919811111111"
    _run(go())


def test_our_send_racing_its_own_send_message_webhook_leaves_one_row(env):
    db = env.db

    async def go():
        await seed_wa(db)
        # The partial unique index database.py creates in production (mongomock has none by default).
        await db.wa_messages.create_index([("instance_name", 1), ("provider_msg_id", 1)], unique=True,
                                          partialFilterExpression={"provider_msg_id": {"$type": "string"}})
        # The webhook for our message arrives before our own write (the fake will answer PMID1).
        await _hook(COMPANY, {"event": "send.message", "data": {"key": {"id": "PMID1", "fromMe": True,
                                                                         "remoteJid": "919811111111@s.whatsapp.net"},
                                                                 "message": {"conversation": "x"}}})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", ref={"dispatch_id": "d1"})
        rows = await db.wa_messages.find({"provider_msg_id": "PMID1"}, {"_id": 0}).to_list(None)
        assert len(rows) == 1 and rows[0]["message_id"] == res["message_id"]
        assert rows[0]["source"] == "app" and rows[0]["kind"] == "dispatch"
    _run(go())


# ── MESSAGES_UPSERT (W2 stub) ────────────────────────────────────────────────

def test_messages_upsert_is_stored_raw_for_w2(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected")
        data = {"key": {"id": "IN1", "fromMe": False, "remoteJid": "919811111111@s.whatsapp.net"},
                "message": {"conversation": "STOP"}, "pushName": "Ritu"}
        out = await _hook("rep_parul", {"event": "messages.upsert", "data": data})
        assert out == {"ok": True}
        raw = await db.wa_events_raw.find_one({}, {"_id": 0})
        assert raw["event"] == "MESSAGES_UPSERT" and raw["data"] == data and raw["processed"] is False
        assert await db.wa_messages.count_documents({}) == 0     # W2 ingests; W1 only keeps it
    _run(go())


def test_the_old_unauthenticated_webhook_is_gone():
    import routes.whatsapp_routes as old
    assert not [r for r in old.router.routes if getattr(r, "path", "").startswith("/webhooks/whatsapp")]
