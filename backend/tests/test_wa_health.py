"""The hourly WhatsApp health sweep and the host RAM reading.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_health.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

from services import evolution_client as ec
from services import wa_health as wh
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

PARUL = "parul@smartshape.in"
OWNER = "info@smartshape.in"


def _run(coro):
    return asyncio.run(coro)


async def _state(db, name):
    return (await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}))["state"]


def test_a_connected_number_that_is_closed_becomes_disconnected_and_alerts_once(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "close"})
        out = await wh.run_wa_health_pass(db)
        assert out["checked"] == 2 and out["changed"] == 1
        assert await _state(db, "rep_parul") == "disconnected" and await _state(db, COMPANY) == "connected"
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "connected"}})
        await wh.run_wa_health_pass(db)                          # same day: no second bell or push
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        assert [p["email"] for p in wa_env.pushes].count(PARUL) == 1
    _run(go())


def test_health_sweep_marks_company_disconnected_and_alerts(wa_env):                  # RF3
    db = wa_env.db

    async def go():
        await seed_user(db, "bde@smartshape.in", role="admin")
        await seed_wa(db)
        wa_env.evo.state[COMPANY] = "connecting"
        await wh.run_wa_health_pass(db)
        assert await _state(db, COMPANY) == "disconnected"
        assert {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)} == \
            {OWNER, "bde@smartshape.in"}
    _run(go())


def test_a_reconnected_number_comes_back_without_an_alert(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, company="disconnected")
        wa_env.evo.state[COMPANY] = "open"
        await wh.run_wa_health_pass(db)
        assert await _state(db, COMPANY) == "connected"
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_paused_and_unlinked_numbers_are_left_alone(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "paused"})
        await seed_instance(db, "rep_old", state="unlinked")
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "open"})
        out = await wh.run_wa_health_pass(db)
        assert out["checked"] == 2 and await _state(db, "rep_parul") == "paused"
        assert not any(c["path"].endswith("/rep_old") for c in wa_env.evo.calls)
    _run(go())


def test_evolution_down_keeps_states_and_raises_one_alert(wa_env, monkeypatch):
    db = wa_env.db

    async def _down(self, instance=None, *, token=None):
        raise ec.EvolutionError(502, "bad gateway")
    monkeypatch.setattr(ec.EvolutionClient, "connection_state", _down)

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        out = await wh.run_wa_health_pass(db)
        assert out["unreachable"] == 2 and await _state(db, "rep_parul") == "connected"
        notes = await db.notifications.find({}, {"_id": 0}).to_list(None)
        assert [n["title"] for n in notes] == ["WhatsApp server not answering"]
    _run(go())


def test_low_ram_alerts_admins_once_a_day_and_a_stale_reading_is_ignored(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.state[COMPANY] = "open"
        await wh.record_host_health(db, 420, 3900, 1100)
        doc = await db.settings.find_one({"type": "wa_health"}, {"_id": 0})
        assert doc["mem_available_mb"] == 420 and doc["at"] == wa_env.clock["now"].isoformat()
        assert (await wh.run_wa_health_pass(db))["ram_low"] is True
        await wh.run_wa_health_pass(db)
        assert await db.notifications.count_documents({"title": "Server memory is low"}) == 1
        wa_env.clock["now"] += timedelta(hours=4)
        out = await wh.run_wa_health_pass(db)
        assert out["health_stale"] is True and out["ram_low"] is False
    _run(go())


def test_concurrent_sweeps_on_a_disconnected_rep_alert_exactly_once(wa_env):              # ruling 2
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "close"})
        await asyncio.gather(wh.run_wa_health_pass(db), wh.run_wa_health_pass(db))
        assert await _state(db, "rep_parul") == "disconnected"
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        assert [p["email"] for p in wa_env.pushes].count(PARUL) == 1
    _run(go())


def test_a_self_heal_then_a_fresh_drop_the_same_day_alerts_again(wa_env):                 # ruling 3
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "close"})
        await wh.run_wa_health_pass(db)
        assert await _state(db, "rep_parul") == "disconnected"
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        # the owner reads the first bell before the number recovers on its own
        await db.notifications.update_many({"assigned_to": PARUL}, {"$set": {"is_read": True}})
        wa_env.evo.state["rep_parul"] = "open"
        await wh.run_wa_health_pass(db)
        assert await _state(db, "rep_parul") == "connected"
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert not inst.get("health_alert_day")             # cleared by the self-heal
        # a genuine new drop, still the same IST day
        wa_env.evo.state["rep_parul"] = "close"
        await wh.run_wa_health_pass(db)
        assert await _state(db, "rep_parul") == "disconnected"
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 2
        assert [p["email"] for p in wa_env.pushes].count(PARUL) == 2
    _run(go())


def test_evolution_down_flag_self_heals_once_one_instance_answers(wa_env, monkeypatch):   # ruling 4
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        real_connection_state = ec.EvolutionClient.connection_state

        async def _down(self, instance=None, *, token=None):
            raise ec.EvolutionError(502, "bad gateway")
        monkeypatch.setattr(ec.EvolutionClient, "connection_state", _down)
        out = await wh.run_wa_health_pass(db)
        assert out["unreachable"] == 2
        doc = await db.settings.find_one({"type": "wa_health"}, {"_id": 0})
        assert doc["evolution_down"] is True and doc.get("evolution_down_at")
        assert await db.notifications.count_documents({"title": "WhatsApp server not answering"}) == 1

        monkeypatch.setattr(ec.EvolutionClient, "connection_state", real_connection_state)
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "open"})
        out2 = await wh.run_wa_health_pass(db)
        assert out2["unreachable"] == 0
        doc2 = await db.settings.find_one({"type": "wa_health"}, {"_id": 0})
        assert doc2["evolution_down"] is False
    _run(go())
