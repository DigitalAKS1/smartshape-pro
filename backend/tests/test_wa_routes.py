"""/wa routes: a rep links and manages only their own number; admins manage every number, the
caps and the default proxy; the owner (role admin, no module_permissions) always passes.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_routes.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.wa_routes as wr
import routes.whatsapp_routes as old
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

OWNER = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}          # no module_permissions
MULTI_ADMIN = {"email": "ops@smartshape.in", "name": "Ops", "role": "sales_person", "roles": ["sales_person", "admin"]}
PARUL = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales_person", "user_id": "user_parul",
         "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
KALPANA = {"email": "kalpana@smartshape.in", "name": "Kalpana", "role": "sales_person", "user_id": "user_kalpana"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setattr(old, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    return wa_env


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(wr, "get_current_user", _me)
    monkeypatch.setattr(old, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as e:
        _run(coro)
    return e.value.status_code


# ── My WhatsApp ──────────────────────────────────────────────────────────────

def test_wa_me_unlinked_shows_the_notice(env, monkeypatch):
    _as(PARUL, monkeypatch)
    out = _run(wr.wa_me(FakeRequest()))
    assert out["linked"] is False and out["state"] == "unlinked"
    assert out["notice"].startswith("Every message this number sends or receives is visible to managers")


def test_link_requires_the_notice(env, monkeypatch):
    _as(PARUL, monkeypatch)
    assert _status(wr.wa_me_link(FakeRequest({}))) == 400
    assert _status(wr.wa_me_link(FakeRequest({"notice_accepted": "yes"}))) == 400
    assert env.evo.calls == []


def test_link_accepts_the_accept_notice_spelling(env, monkeypatch):
    _as(PARUL, monkeypatch)
    assert _run(wr.wa_me_link(FakeRequest({"accept_notice": True})))["state"] == "qr"


def test_link_refuses_without_a_webhook_secret(env, monkeypatch):
    _as(PARUL, monkeypatch)
    monkeypatch.delenv("WA_WEBHOOK_SECRET")
    assert _status(wr.wa_me_link(FakeRequest({"notice_accepted": True}))) == 500
    assert env.evo.calls == []


def test_rep_link_creates_the_instance_sets_webhook_and_default_proxy_and_returns_qr(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"], user_id="user_parul")
        await db.settings.insert_one({"type": "wa_proxy_default", "enabled": True, "host": "gate.decodo.com",
                                      "port": 10001, "protocol": "socks5", "username": "u", "password": "p"})
        out = await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert out == {"instance_name": "rep_user_parul", "state": "qr", "qr_base64": "data:image/png;base64,QR"}
        paths = [c["path"] for c in env.evo.calls]
        assert paths == ["/instance/create", "/webhook/set/rep_user_parul", "/proxy/set/rep_user_parul",
                         "/instance/connect/rep_user_parul"]
        assert env.evo.calls[0]["json"]["syncFullHistory"] is True
        hook = env.evo.calls[1]["json"]["webhook"]
        # Task 6 fix round: the secret travels in a header, never in the URL.
        assert hook["url"].endswith("/api/webhooks/whatsapp/rep_user_parul") and "?t=" not in hook["url"]
        assert hook["headers"] == {"X-WA-Secret": "s3cret"}
        assert env.evo.calls[2]["json"]["host"] == "gate.decodo.com"
        inst = await db.wa_instances.find_one({"instance_name": "rep_user_parul"}, {"_id": 0})
        assert inst["kind"] == "rep" and inst["owner_email"] == PARUL["email"] and inst["state"] == "qr"
        assert inst["instance_token"] == "tok_rep_user_parul" and inst["notice_accepted_at"]
        assert (await db.users.find_one({"email": PARUL["email"]}))["wa_instance_name"] == "rep_user_parul"
    _run(go())


def test_link_reuses_an_evolution_instance_that_already_exists(env, monkeypatch):
    _as(PARUL, monkeypatch)
    env.evo.create_status = 403                                  # "This name is already in use."
    out = _run(wr.wa_me_link(FakeRequest({"notice_accepted": True})))
    assert out["state"] == "qr"


def test_a_second_link_never_creates_a_second_instance(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"], user_id="user_parul")
        await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        again = await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert again["instance_name"] == "rep_user_parul" and again["state"] == "qr" and again["already_linked"]
        await db.wa_instances.update_one({"instance_name": "rep_user_parul"}, {"$set": {"state": "connected"}})
        again = await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert again["state"] == "connected" and "qr_base64" not in again
        assert [c["path"] for c in env.evo.calls].count("/instance/create") == 1
        assert await db.wa_instances.count_documents({}) == 1
    _run(go())


def test_capacity_counts_the_company_and_unlinked_numbers_free_their_slot(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_wa(db, reps={KALPANA["email"]: "connected"}, settings={"max_instances": 2})
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert e.value.status_code == 409 and "2 WhatsApp slots" in e.value.detail
        await db.wa_instances.update_one({"instance_name": "rep_kalpana"}, {"$set": {"state": "unlinked"}})
        assert (await wr.wa_me_link(FakeRequest({"notice_accepted": True})))["state"] == "qr"
    _run(go())


def test_link_refuses_when_the_server_is_low_on_memory(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await db.settings.insert_one({"type": "wa_health", "mem_available_mb": 300,
                                      "at": env.clock["now"].isoformat()})
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert e.value.status_code == 409 and "500 MB" in e.value.detail
        # A stale reading (the host script stopped) never blocks.
        await db.settings.update_one({"type": "wa_health"}, {"$set": {
            "at": (env.clock["now"] - timedelta(hours=2)).isoformat()}})
        assert (await wr.wa_me_link(FakeRequest({"notice_accepted": True})))["state"] == "qr"
    _run(go())


def test_wa_me_shows_warmup_today_and_refreshes_a_stale_qr(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        now = env.clock["now"]
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="connected",
                            phone="919000000111", warmup_started_at=(now - timedelta(days=3)).isoformat())
        await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul", typed_by=PARUL["email"])
        out = await wr.wa_me(FakeRequest())
        assert out["warmup"] == {"day": 4, "of": 14, "today_sent": 1, "today_cap": 40}
        assert (out["warmup_day"], out["sent_today"], out["cap_today"]) == (4, 1, 40)
        assert "instance_token" not in out
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {
            "state": "qr", "qr_base64": "OLD", "qr_at": (now - timedelta(seconds=30)).isoformat()}})
        out = await wr.wa_me(FakeRequest())
        assert out["qr_base64"] == "data:image/png;base64,QR"
    _run(go())


def test_wa_me_warns_when_the_number_looks_personal(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"], phone="98111 11111")
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], phone="919811111111")
        assert (await wr.wa_me(FakeRequest()))["looks_personal"] is True
    _run(go())


def test_a_rep_relinks_and_unlinks_only_their_own_number(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], phone="919000000111")
        await seed_instance(db, "rep_kalpana", owner_email=KALPANA["email"], phone="919000000112")
        assert (await wr.wa_me_relink(FakeRequest()))["state"] == "qr"
        assert (await wr.wa_me_unlink(FakeRequest()))["state"] == "unlinked"
        logouts = [c["path"] for c in env.evo.calls if c["path"].startswith("/instance/logout/")]
        assert logouts == ["/instance/logout/rep_parul", "/instance/logout/rep_parul"]
        assert (await db.wa_instances.find_one({"instance_name": "rep_kalpana"}))["state"] == "connected"
    _run(go())


def test_relink_of_an_unlinked_number_goes_to_qr_and_calls_connect(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="unlinked")
        out = await wr.wa_me_relink(FakeRequest())
        assert out["state"] == "qr" and out["qr_base64"] == "data:image/png;base64,QR"
        assert "/instance/connect/rep_parul" in [c["path"] for c in env.evo.calls]
        assert (await db.wa_instances.find_one({"instance_name": "rep_parul"}))["state"] == "qr"
    _run(go())


def test_a_rep_cannot_relink_past_an_admin_pause(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="paused", paused_by=OWNER["email"])
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_relink(FakeRequest())
        assert e.value.status_code == 409 and "Only an admin can resume it" in e.value.detail
    _run(go())


def test_unlinking_an_admin_paused_number_keeps_the_pause(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="paused",
                            paused_by=OWNER["email"], paused_reason="Complaint")
        await wr.wa_me_unlink(FakeRequest())
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["state"] == "unlinked" and inst["paused_before_unlink"] is True
        assert inst["paused_reason"] == "Complaint"
    _run(go())


# ── Admin gate ───────────────────────────────────────────────────────────────

def test_a_rep_is_refused_every_admin_route(env, monkeypatch):
    _as(PARUL, monkeypatch)
    calls = [
        wr.wa_instances_list(FakeRequest()),
        wr.wa_link_company(FakeRequest({"notice_accepted": True})),
        wr.wa_instance_pause("rep_kalpana", FakeRequest()),
        wr.wa_instance_resume("rep_kalpana", FakeRequest()),
        wr.wa_instance_unlink("rep_kalpana", FakeRequest()),
        wr.wa_instance_proxy("rep_kalpana", FakeRequest({"host": "h", "port": 1})),
        wr.wa_instance_update("rep_kalpana", FakeRequest({"daily_cap_override": 500})),
        wr.wa_settings_get(FakeRequest()),
        wr.wa_settings_put(FakeRequest({"hourly_cap": 500})),
        wr.wa_proxy_config_get(FakeRequest()),
        wr.wa_proxy_config_save(FakeRequest({"host": "h", "port": 1})),
    ]
    for c in calls:
        assert _status(c) == 403
    assert env.evo.calls == []


@pytest.mark.parametrize("user", [OWNER, MULTI_ADMIN])
def test_the_owner_and_a_multi_role_admin_pass(env, monkeypatch, user):
    _as(user, monkeypatch)
    out = _run(wr.wa_instances_list(FakeRequest()))
    assert out["max_instances"] == 4 and out["instances"] == []


def test_admin_list_shows_numbers_ram_and_capacity(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"])
        await seed_wa(db, reps={PARUL["email"]: "connected"})
        await db.settings.insert_one({"type": "wa_health", "mem_available_mb": 420, "mem_total_mb": 3900,
                                      "evolution_mem_mb": 900, "at": env.clock["now"].isoformat()})
        out = await wr.wa_instances_list(FakeRequest())
        assert out["used"] == 2 and out["company_instance"] == COMPANY
        assert {i["instance_name"] for i in out["instances"]} == {COMPANY, "rep_parul"}
        assert out["health"]["headroom_ok"] is False and out["health"]["min_headroom_mb"] == 500
        assert "instance_token" not in out["instances"][0]
        rep = next(i for i in out["instances"] if i["instance_name"] == "rep_parul")
        assert rep["owner_name"] == "Parul" and {"sent_today", "cap_today", "warmup_day"} <= set(rep)
    _run(go())


def test_pause_routes_around_the_number_and_resume_resets_the_streak(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_wa(db, reps={PARUL["email"]: "connected"})
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"consecutive_failures": 3}})
        await wr.wa_instance_pause("rep_parul", FakeRequest({"reason": "Complaint from a school"}))
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", owner_email=PARUL["email"])
        assert res["instance_name"] == COMPANY
        env.evo.state["rep_parul"] = "open"
        assert (await wr.wa_instance_resume("rep_parul", FakeRequest()))["state"] == "connected"
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["consecutive_failures"] == 0 and inst["paused_reason"] == ""
    _run(go())


def test_proxy_update_keeps_the_saved_password_when_blank(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"],
                            proxy={"host": "old", "port": 1, "protocol": "socks5", "username": "u", "password": "keep"})
        out = await wr.wa_instance_proxy("rep_parul", FakeRequest({"host": "gate.decodo.com", "port": "10001",
                                                                   "protocol": "socks5", "username": "u2", "password": ""}))
        assert out["proxy"] == {"host": "gate.decodo.com", "port": 10001, "protocol": "socks5",
                                "username": "u2", "has_password": True}
        assert env.evo.calls[-1]["json"]["password"] == "keep"
        with pytest.raises(HTTPException):
            await wr.wa_instance_proxy("rep_parul", FakeRequest({"host": "h", "port": "99999"}))
        listed = await wr.wa_instances_list(FakeRequest())
        assert "password" not in listed["instances"][0]["proxy"]
    _run(go())


def test_daily_cap_override_can_be_set_and_cleared(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_wa(db)
        v = await wr.wa_instance_update(COMPANY, FakeRequest({"daily_cap_override": 150, "label": "Company"}))
        assert v["daily_cap_override"] == 150 and v["warmup"]["today_cap"] == 150
        v = await wr.wa_instance_update(COMPANY, FakeRequest({"daily_cap_override": None}))
        assert v["daily_cap_override"] is None
    _run(go())


def test_settings_put_validates_and_saves(env, monkeypatch):
    _as(OWNER, monkeypatch)
    assert _status(wr.wa_settings_put(FakeRequest({"hourly_cap": 0}))) == 400
    out = _run(wr.wa_settings_put(FakeRequest({"hourly_cap": 20, "fallback_provider": "autosender"})))
    assert out["hourly_cap"] == 20 and out["fallback_provider"] == "autosender"
    assert _run(wr.wa_settings_get(FakeRequest()))["hourly_cap"] == 20


def test_proxy_config_saves_and_masks_the_password(env, monkeypatch):
    _as(OWNER, monkeypatch)
    out = _run(wr.wa_proxy_config_save(FakeRequest({"enabled": True, "host": "gate.decodo.com", "port": 10001,
                                                    "protocol": "socks5", "username": "u", "password": "p"})))
    assert out == {"enabled": True, "host": "gate.decodo.com", "port": 10001, "protocol": "socks5",
                   "username": "u", "has_password": True}
    assert "password" not in _run(wr.wa_proxy_config_get(FakeRequest()))


def test_company_link_adopts_an_instance_that_is_already_open(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)
    env.evo.state[COMPANY] = "open"
    env.evo.owner_jid[COMPANY] = "919818950815@s.whatsapp.net"

    async def go():
        out = await wr.wa_link_company(FakeRequest({"notice_accepted": True}))
        assert out == {"instance_name": COMPANY, "state": "connected", "phone_e164": "919818950815"}
        assert not any(c["path"] == "/instance/create" for c in env.evo.calls)
        assert any(c["path"] == f"/webhook/set/{COMPANY}" for c in env.evo.calls)
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["kind"] == "company" and inst["state"] == "connected"
        assert inst["owner_email"] == OWNER["email"] and inst["warmup_started_at"]
        # Fix round 1: an already-connected number is treated as warmed — full cap on day one.
        listed = await wr.wa_instances_list(FakeRequest())
        comp = next(i for i in listed["instances"] if i["instance_name"] == COMPANY)
        assert comp["cap_today"] == 200 and comp["warmup"]["today_cap"] == 200
        assert comp["warmup_day"] == 15
    _run(go())


def test_company_adopt_with_a_new_sim_restarts_warmup(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)
    env.evo.state[COMPANY] = "open"
    env.evo.owner_jid[COMPANY] = "919818950815@s.whatsapp.net"

    async def go():
        await seed_instance(db, COMPANY, kind="company", state="unlinked", phone="919000000001")
        await wr.wa_link_company(FakeRequest({"notice_accepted": True}))
        comp = (await wr.wa_instances_list(FakeRequest()))["instances"][0]
        assert comp["warmup_day"] == 1 and comp["cap_today"] == 20
    _run(go())


def test_company_adopt_of_an_unlinked_row_paused_before_unlink_comes_back_paused(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)
    env.evo.state[COMPANY] = "open"
    env.evo.owner_jid[COMPANY] = "919000000001@s.whatsapp.net"

    async def go():
        await seed_instance(db, COMPANY, kind="company", state="unlinked", phone="919000000001",
                            paused_before_unlink=True, paused_reason="Complaint")
        out = await wr.wa_link_company(FakeRequest({"notice_accepted": True}))
        assert out["state"] == "paused"
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["state"] == "paused" and inst["paused_reason"] == "Complaint"
        assert "paused_before_unlink" not in inst
    _run(go())


@pytest.mark.parametrize("raw", ["false", False, 0, "0", "off"])
def test_proxy_config_enabled_is_a_real_boolean(env, monkeypatch, raw):
    _as(OWNER, monkeypatch)
    out = _run(wr.wa_proxy_config_save(FakeRequest({"enabled": raw, "host": "gate.decodo.com", "port": 10001})))
    assert out["enabled"] is False
    assert _run(wr.wa_proxy_config_get(FakeRequest()))["enabled"] is False


def test_a_system_pause_is_cleared_only_by_an_admin_resume(env, monkeypatch):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="paused", paused_by="system",
                            paused_reason="5 sends in a row failed.")
        _as(PARUL, monkeypatch)
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_relink(FakeRequest())
        assert e.value.status_code == 409 and "Only an admin can resume it" in e.value.detail
        me = await wr.wa_me(FakeRequest())
        assert me["state"] == "paused" and me["needs_admin_resume"] is True
        assert me["paused_reason"] == "5 sends in a row failed."
        await wr.wa_me_unlink(FakeRequest())
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["state"] == "unlinked" and inst["paused_before_unlink"] is True
        me = await wr.wa_me(FakeRequest())
        assert me["needs_admin_resume"] is True and me["paused_reason"] == "5 sends in a row failed."
        _as(OWNER, monkeypatch)
        await wr.wa_instance_resume("rep_parul", FakeRequest())
        _as(PARUL, monkeypatch)
        me = await wr.wa_me(FakeRequest())
        assert me["needs_admin_resume"] is False and me["paused_reason"] == ""
        assert (await wr.wa_me_relink(FakeRequest()))["state"] == "qr"
    _run(go())


def test_relink_recreates_an_instance_evolution_no_longer_has(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)
    real = env.evo.request

    async def gone_once(method, path, json=None, token=None):
        if path == "/instance/connect/rep_parul" and not any(
                c["path"] == "/instance/create" for c in env.evo.calls):
            env.evo.calls.append({"method": method, "path": path, "json": json, "token": token})
            from services.evolution_client import EvolutionError
            raise EvolutionError(404, "The instance does not exist")
        return await real(method, path, json=json, token=token)
    monkeypatch.setattr(env.evo, "request", gone_once)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="disconnected",
                            notice_accepted_at="2026-09-01T00:00:00+00:00")
        out = await wr.wa_me_relink(FakeRequest())
        assert out == {"instance_name": "rep_parul", "state": "qr", "qr_base64": "data:image/png;base64,QR"}
        paths = [c["path"] for c in env.evo.calls]
        assert paths[-3:] == ["/instance/create", "/webhook/set/rep_parul", "/instance/connect/rep_parul"]
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["state"] == "qr" and inst["qr_base64"] == "data:image/png;base64,QR"
        assert inst["notice_accepted_at"] == "2026-09-01T00:00:00+00:00"       # kept
    _run(go())


def test_company_link_shows_a_qr_when_not_open(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        out = await wr.wa_link_company(FakeRequest({"notice_accepted": True}))
        assert out["instance_name"] == COMPANY and out["state"] == "qr"
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["kind"] == "company"
        assert (await db.users.find_one({"email": OWNER["email"]})) is None     # no users.wa_instance_name
    _run(go())


# ── Old routes ───────────────────────────────────────────────────────────────

def test_the_old_admin_agnostic_instance_routes_are_gone():
    paths = {(getattr(r, "path", ""), tuple(sorted(getattr(r, "methods", []) or []))) for r in old.router.routes}
    flat = {p for p, _ in paths}
    assert not [p for p in flat if p.startswith("/whatsapp/instances") or p.startswith("/whatsapp/proxy/")]
    for gone in ("/whatsapp/instance/create", "/whatsapp/instance/qr", "/whatsapp/instance/logout"):
        assert gone not in flat
    assert "/whatsapp/instance/status" in flat


def test_legacy_status_reads_the_company_row(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_wa(db)
        assert await old.wa_instance_status(FakeRequest()) == {"state": "open", "connected": True,
                                                               "instance": COMPANY}
    _run(go())
