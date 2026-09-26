"""D5 ban protection, per number: warm-up ramp, hourly and daily caps, one marketing message per
contact per day, the jittered gap, business hours (IST), the drainer, and auto-pause.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_send_caps.py -q
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import services.wa_send as ws
from services.wa_config import WA_DEFAULTS
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_wa

PARUL = "parul@smartshape.in"
UTC = timezone.utc


def _run(coro):
    return asyncio.run(coro)


def _at(y, mo, d, h, mi):          # a UTC instant
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


@pytest.mark.parametrize("started_days_ago,cap", [(0, 20), (2, 20), (3, 40), (5, 40), (6, 80), (9, 160),
                                                  (12, 200), (40, 200)])
def test_warmup_ramp_doubles_every_three_days_to_200(started_days_ago, cap):
    now = _at(2026, 9, 24, 5, 30)
    inst = {"warmup_started_at": (now - timedelta(days=started_days_ago)).isoformat()}
    assert ws.daily_cap(inst, dict(WA_DEFAULTS), now) == cap
    assert ws.warmup_day(inst, now) == started_days_ago + 1


def test_daily_cap_override_wins():
    now = _at(2026, 9, 24, 5, 30)
    assert ws.daily_cap({"warmup_started_at": now.isoformat(), "daily_cap_override": 150}, dict(WA_DEFAULTS), now) == 150


def test_ledger_day_is_the_ist_date_at_2330_and_0001_ist(wa_env):                    # RF5
    db = wa_env.db
    assert ws.ist_day(_at(2026, 9, 24, 18, 0)) == "2026-09-24"      # 23:30 IST
    assert ws.ist_day(_at(2026, 9, 24, 18, 31)) == "2026-09-25"     # 00:01 IST

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 18, 0)
        await send_whatsapp(db, to="9811111111", text="late reply", kind="chat", typed_by=PARUL)
        wa_env.clock["now"] = _at(2026, 9, 24, 18, 31)
        await send_whatsapp(db, to="9811111111", text="after midnight", kind="chat", typed_by=PARUL)
        days = sorted(r["day"] for r in await db.wa_send_ledger.find({}, {"_id": 0}).to_list(None))
        assert days == ["2026-09-24", "2026-09-25"]
        rows = await db.wa_send_ledger.find({}, {"_id": 0}).to_list(None)
        assert all(r["sent_count"] == 1 for r in rows)
        assert {tuple(r["hour_bucket"].items()) for r in rows} == {(("23", 1),), (("00", 1),)}
    _run(go())


def test_quiet_hours_queue_until_0900_ist_next_day(wa_env):                          # RF5
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                # 20:00 IST
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert (res["status"], res["reason"]) == ("queued", "quiet_hours")
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-25T03:30:00+00:00"       # 09:00 IST tomorrow
        assert wa_env.evo.sends == []
    _run(go())


def test_before_0900_ist_queues_for_the_same_morning(wa_env):                        # RF5
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 3, 29)                 # 08:59 IST
        res = await send_whatsapp(db, to="9811111111", text="x", kind="intro")
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-24T03:30:00+00:00"
    _run(go())


def test_manual_chat_and_internal_alerts_ignore_business_hours(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 17, 0)                # 22:30 IST
        a = await send_whatsapp(db, to="9811111111", text="x", kind="chat", typed_by=PARUL)
        b = await send_whatsapp(db, to="9822222222", text="x", kind="alert", channel="company")
        assert a["status"] == "sent" and b["status"] == "sent"
    _run(go())


def test_hourly_cap_queues_even_a_manual_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"hourly_cap": 2})
        r = [await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", typed_by=PARUL) for i in range(3)]
        assert [x["status"] for x in r] == ["sent", "sent", "queued"] and r[2]["reason"] == "hourly_cap"
        row = await db.wa_messages.find_one({"message_id": r[2]["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-24T06:30:00+00:00"       # 12:00 IST
    _run(go())


def test_daily_cap_queues_automations_to_tomorrow_but_not_a_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, company=None)
        await seed_instance(db, COMPANY, kind="company", phone="919000000001", daily_cap_override=1)
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch")
        c = await send_whatsapp(db, to="9833333333", text="x", kind="chat", typed_by=PARUL)
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "queued", "daily_cap", "sent")
        row = await db.wa_messages.find_one({"message_id": b["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-25T03:30:00+00:00"
    _run(go())


def test_one_marketing_message_per_contact_per_number_per_day(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        a = await send_whatsapp(db, to="9811111111", text="step 1", kind="drip")
        b = await send_whatsapp(db, to="+91 98111 11111", text="festival", kind="greeting")   # M-3: skipped
        c = await send_whatsapp(db, to="9811111111", text="your kit shipped", kind="dispatch")
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "skipped", "per_contact_per_day", "sent")
    _run(go())


def test_the_gap_queues_a_second_automation_but_never_a_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 8, "gap_max_s": 8})
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch")
        c = await send_whatsapp(db, to="9833333333", text="x", kind="chat", typed_by=PARUL)
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "queued", "gap", "sent")
        wa_env.clock["now"] += timedelta(seconds=9)
        d = await send_whatsapp(db, to="9844444444", text="x", kind="dispatch")
        assert d["status"] == "sent"
    _run(go())


def test_drainer_sends_due_rows_oldest_first_and_sleeps_between(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 8, "gap_max_s": 25})
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                # 20:00 IST — both queue
        first = await send_whatsapp(db, to="9811111111", text="first", kind="dispatch")
        wa_env.clock["now"] += timedelta(minutes=1)
        second = await send_whatsapp(db, to="9822222222", text="second", kind="dispatch")
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)                 # 09:05 IST next day
        out = await ws.run_wa_queue_pass(db)
        assert out == {"instances": 1, "processed": 2}
        assert [s["text"] for s in wa_env.evo.sends] == ["first", "second"]
        assert len(wa_env.clock["slept"]) == 2 and all(8 <= s <= 25 for s in wa_env.clock["slept"])
        for r in (first, second):
            assert (await db.wa_messages.find_one({"message_id": r["message_id"]}))["status"] == "sent"
    _run(go())


def test_drainer_leaves_rows_that_are_not_yet_due(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        out = await ws.run_wa_queue_pass(db)
        assert out["processed"] == 0 and wa_env.evo.sends == []
    _run(go())


def test_drainer_reroutes_when_the_owner_number_went_down(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", owner_email=PARUL)
        assert res["instance_name"] == "rep_parul"
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "disconnected"}})
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        await ws.run_wa_queue_pass(db)
        assert wa_env.evo.sends[-1]["instance"] == COMPANY
    _run(go())


def test_drainer_reclaims_a_stale_sending_row(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        await db.wa_messages.update_one({"message_id": res["message_id"]}, {"$set": {
            "status": "sending", "claimed_at": (wa_env.clock["now"] - timedelta(minutes=11)).isoformat()}})
        await ws.run_wa_queue_pass(db)
        assert (await db.wa_messages.find_one({"message_id": res["message_id"]}))["status"] == "sent"
    _run(go())


def test_a_pass_already_running_is_not_doubled(wa_env):
    async def go():
        async with ws._QUEUE_LOCK:
            assert await ws.run_wa_queue_pass(wa_env.db) == {"skipped": "already_running"}
    _run(go())


def test_five_consecutive_failures_pause_the_number_and_alert(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.fail_sends = True
        for i in range(5):
            r = await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", owner_email=PARUL,
                                    typed_by=PARUL)
            assert r["status"] == "failed"
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["state"] == "paused" and "5 sends in a row failed" in inst["paused_reason"]
        notes = await db.notifications.find({"type": "whatsapp_alert"}, {"_id": 0}).to_list(None)
        assert {n["assigned_to"] for n in notes} == {PARUL, "info@smartshape.in"}
        assert {p["email"] for p in wa_env.pushes} == {PARUL, "info@smartshape.in"}
        wa_env.evo.fail_sends = False
        nxt = await send_whatsapp(db, to="9899999999", text="x", kind="chat", owner_email=PARUL, typed_by=PARUL)
        assert nxt["instance_name"] == COMPANY                         # the paused number is not used
    _run(go())


def test_a_success_resets_the_failure_streak(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.fail_sends = True
        for i in range(4):
            await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", typed_by=PARUL)
        wa_env.evo.fail_sends = False
        await send_whatsapp(db, to="9899999999", text="x", kind="chat", typed_by=PARUL)
        wa_env.evo.fail_sends = True
        await send_whatsapp(db, to="9899999998", text="x", kind="chat", typed_by=PARUL)
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["state"] == "connected" and inst["consecutive_failures"] == 1
    _run(go())


def test_a_young_rep_number_does_not_carry_campaigns(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await seed_instance(db, "rep_parul", owner_email=PARUL, phone="919000000111",
                            warmup_started_at=(wa_env.clock["now"] - timedelta(days=5)).isoformat())
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        camp = await send_whatsapp(db, to="9811111111", text="x", kind="campaign", owner_email=PARUL)
        disp = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch", owner_email=PARUL)
        assert camp["instance_name"] == COMPANY and disp["instance_name"] == "rep_parul"
    _run(go())


# ── Rulings on top of the brief ──────────────────────────────────────────────

async def _stale_sending(db, wa_env, *, text="x", provider_msg_id=None):
    """A dispatch that was mid-send (row reads `sending`) 11 minutes ago, i.e. the process died."""
    await seed_wa(db)
    res = await send_whatsapp(db, to="9811111111", text=text, kind="dispatch")
    assert res["status"] == "sent"
    wa_env.clock["now"] += timedelta(minutes=11)
    await db.wa_messages.update_one({"message_id": res["message_id"]}, {"$set": {
        "status": "sending", "sending_at": (wa_env.clock["now"] - timedelta(minutes=11)).isoformat(),
        "provider_msg_id": provider_msg_id}})
    await db.engagement_events.delete_many({})
    return res["message_id"]


def test_a_stale_mid_send_row_is_failed_uncertain_and_never_resent(wa_env):          # ruling 2
    db = wa_env.db

    async def go():
        mid = await _stale_sending(db, wa_env)
        before = len(wa_env.evo.sends)
        await ws.run_wa_queue_pass(db)
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert row["status"] == "failed" and row["fail_reason"].startswith("uncertain")
        assert len(wa_env.evo.sends) == before                          # never resent
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["consecutive_failures"] == 0                        # uncertain is not the number's fault
    _run(go())


def test_a_stale_mid_send_row_whose_provider_id_is_on_another_row_is_sent(wa_env):   # ruling 2
    db = wa_env.db

    async def go():
        mid = await _stale_sending(db, wa_env, provider_msg_id="PMID77")
        await db.wa_messages.insert_one({"message_id": "wam_webhook", "instance_name": COMPANY,
                                         "provider_msg_id": "PMID77", "status": "delivered", "direction": "out"})
        before = len(wa_env.evo.sends)
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert row["status"] == "sent" and len(wa_env.evo.sends) == before
    _run(go())


def test_a_stale_mid_send_row_with_an_engagement_event_is_sent(wa_env):               # ruling 2
    db = wa_env.db

    async def go():
        mid = await _stale_sending(db, wa_env)
        await db.engagement_events.insert_one({"event_id": "e1", "dedup_key": f"wa:{mid}"})
        before = len(wa_env.evo.sends)
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert row["status"] == "sent" and len(wa_env.evo.sends) == before
    _run(go())


def test_a_recent_sending_row_is_left_alone(wa_env):
    db = wa_env.db

    async def go():
        mid = await _stale_sending(db, wa_env)
        await db.wa_messages.update_one({"message_id": mid}, {"$set": {
            "sending_at": (wa_env.clock["now"] - timedelta(minutes=3)).isoformat()}})
        await ws.run_wa_queue_pass(db)
        assert (await db.wa_messages.find_one({"message_id": mid}))["status"] == "sending"
    _run(go())


def test_a_queued_row_is_rechecked_at_send_time(wa_env):                             # ruling 3
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                # 20:00 IST — queues
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["status"] == "queued"
        await db.wa_opt_outs.insert_one({"phone_e164": "919811111111", "active": True})
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        out = await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert out["processed"] == 1 and (row["status"], row["fail_reason"]) == ("skipped", "opt_out")
        assert wa_env.evo.sends == [] and wa_env.clock["slept"] == []
    _run(go())


def test_the_drainer_requeues_a_row_still_over_the_cap(wa_env):                      # ruling 3
    db = wa_env.db

    async def go():
        await seed_wa(db, company=None)
        await seed_instance(db, COMPANY, kind="company", phone="919000000001", daily_cap_override=1)
        await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")
        b = await send_whatsapp(db, to="9822222222", text="b", kind="dispatch")
        assert b["reason"] == "daily_cap"
        await db.wa_messages.update_one({"message_id": b["message_id"]},
                                        {"$set": {"send_after": wa_env.clock["now"].isoformat()}})
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": b["message_id"]}, {"_id": 0})
        assert (row["status"], row["queue_reason"]) == ("queued", "daily_cap")
        assert row["send_after"] == "2026-09-25T03:30:00+00:00"
        assert [s["text"] for s in wa_env.evo.sends] == ["a"]
    _run(go())


def test_skipped_never_counts_as_a_failure(wa_env):                                  # ruling 1
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.not_on_whatsapp = {"919811111111"}
        for _ in range(6):
            r = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
            assert (r["status"], r["reason"]) == ("skipped", "not_on_whatsapp")
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["state"] == "connected" and inst.get("consecutive_failures", 0) == 0
    _run(go())


def test_a_recipient_error_does_not_count_toward_the_pause(wa_env, monkeypatch):
    db = wa_env.db

    async def go():
        await seed_wa(db)

        async def _bad(rec):
            raise ws.evo_mod.EvolutionError(400, "bad number")
        wa_env.evo.on_send = _bad
        for i in range(6):
            r = await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", typed_by=PARUL)
            assert r["status"] == "failed"
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["state"] == "connected"
    _run(go())


def test_a_marketing_row_rerouted_off_a_young_number_is_logged(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, company=None)
        await seed_instance(db, "rep_parul", owner_email=PARUL, phone="919000000111",
                            warmup_started_at=wa_env.clock["now"].isoformat())
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        r = await send_whatsapp(db, to="9811111111", text="x", kind="broadcast", owner_email=PARUL)
        assert (r["status"], r["reason"]) == ("skipped", "number_warming_up") and wa_env.evo.sends == []
    _run(go())


def test_wa_queue_loop_is_started_by_the_scheduler():
    import inspect
    import scheduler
    assert inspect.iscoroutinefunction(scheduler.wa_queue_loop)
    assert "wa_queue_loop()" in inspect.getsource(scheduler.start_scheduler)


# ── Fix round 1 ──────────────────────────────────────────────────────────────

async def _queue_one_overnight(db, wa_env, text="queued", **kw):
    wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                    # 20:00 IST — queues
    res = await send_whatsapp(db, to="9811111111", text=text, kind="dispatch", **kw)
    assert res["status"] == "queued"
    return res["message_id"]


def test_the_drainer_waits_for_the_gap_after_an_out_of_band_send(wa_env):           # fix 1
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 10, "gap_max_s": 10})
        mid = await _queue_one_overnight(db, wa_env)
        t = _at(2026, 9, 25, 3, 35)
        wa_env.clock["now"] = t
        oob = await send_whatsapp(db, to="9822222222", text="oob", kind="dispatch")   # e.g. a drip
        assert oob["status"] == "sent"
        await ws.run_wa_queue_pass(db)
        assert [s["text"] for s in wa_env.evo.sends] == ["oob", "queued"]
        assert wa_env.clock["slept"][0] == 10                                        # waited for the slot
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert row["status"] == "sent" and row["sent_at"] == (t + timedelta(seconds=10)).isoformat()
    _run(go())


def test_the_drainer_requeues_to_the_slot_when_the_pass_has_no_time_left(wa_env):   # fix 1
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 10, "gap_max_s": 10})
        mid = await _queue_one_overnight(db, wa_env)
        t = _at(2026, 9, 25, 3, 35)
        wa_env.clock["now"] = t
        await send_whatsapp(db, to="9822222222", text="oob", kind="dispatch")
        await ws.run_wa_queue_pass(db, budget_s=5)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert (row["status"], row["queue_reason"]) == ("queued", "gap")
        assert row["send_after"] == (t + timedelta(seconds=10)).isoformat()
        assert [s["text"] for s in wa_env.evo.sends] == ["oob"]
    _run(go())


def test_a_row_that_errors_before_the_send_is_requeued_three_times_then_failed(wa_env, monkeypatch):  # fix 2
    db = wa_env.db

    async def go():
        await seed_wa(db)
        mid = await _queue_one_overnight(db, wa_env)

        async def _boom(*a, **k):
            raise RuntimeError("policy blew up")
        monkeypatch.setattr(ws, "_policy", _boom)
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        seen = []
        for _ in range(4):
            await ws.run_wa_queue_pass(db)
            row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
            seen.append((row["status"], row.get("drain_errors"), row.get("claim_count")))
            wa_env.clock["now"] += timedelta(minutes=5)
        assert seen == [("queued", 1, 1), ("queued", 2, 2), ("queued", 3, 3), ("failed", 4, 4)]
        assert row["fail_reason"] == "drain_error" and wa_env.evo.sends == []
    _run(go())


def test_a_stalled_worker_cannot_complete_a_row_another_worker_resent(wa_env, monkeypatch):     # fix 3
    db = wa_env.db
    gate = {"ev": None}
    calls = {"n": 0}
    orig = ws._policy

    async def _slow_first(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            await gate["ev"].wait()                                   # worker A stalls here
        return await orig(*a, **k)

    async def go():
        gate["ev"] = asyncio.Event()
        await seed_wa(db)
        mid = await _queue_one_overnight(db, wa_env)
        monkeypatch.setattr(ws, "_policy", _slow_first)               # A's _policy call is #1
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        a = asyncio.create_task(ws._drain_instance(db, COMPANY, deadline=wa_env.clock["now"] + timedelta(hours=1)))
        while calls["n"] == 0:
            await asyncio.sleep(0)
        claim_a = (await db.wa_messages.find_one({"message_id": mid}))["claim_token"]
        wa_env.clock["now"] += timedelta(minutes=11)
        await ws.run_wa_queue_pass(db)                                # worker B: sweep, reclaim, send
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert row["status"] == "sent" and row["claim_token"] != claim_a and len(wa_env.evo.sends) == 1
        gate["ev"].set()
        await a                                                       # A resumes: ClaimLost, no send
        assert len(wa_env.evo.sends) == 1
        after = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert after["status"] == "sent" and after["status_history"] == row["status_history"]
    _run(go())


def test_daily_cap_override_zero_blocks_the_number(wa_env):                          # fix 4
    db = wa_env.db
    now = _at(2026, 9, 24, 5, 30)
    assert ws.daily_cap({"warmup_started_at": now.isoformat(), "daily_cap_override": 0}, dict(WA_DEFAULTS), now) == 0

    async def go():
        await seed_wa(db, company=None)
        await seed_instance(db, COMPANY, kind="company", phone="919000000001", daily_cap_override=0)
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        c = await send_whatsapp(db, to="9833333333", text="x", kind="chat", typed_by=PARUL)
        assert (a["status"], a["reason"], c["status"]) == ("queued", "daily_cap", "sent")
    _run(go())


def test_staff_alerts_skip_the_daily_cap_but_not_the_hourly_cap(wa_env):            # fix 5a
    from wa_fixtures import seed_user
    db = wa_env.db

    async def go():
        await seed_wa(db, company=None, settings={"hourly_cap": 3})
        await seed_instance(db, COMPANY, kind="company", phone="919000000001", daily_cap_override=1)
        await seed_user(db, "store@smartshape.in", phone="9822222222")
        d = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        outsider = await send_whatsapp(db, to="9833333333", text="x", kind="alert")
        s1 = await send_whatsapp(db, to="9822222222", text="x", kind="alert")
        s2 = await send_whatsapp(db, to="9822222222", text="x", kind="digest")
        s3 = await send_whatsapp(db, to="9822222222", text="x", kind="alert")
        assert d["status"] == "sent"
        assert (outsider["status"], outsider["reason"]) == ("queued", "daily_cap")
        assert (s1["status"], s2["status"]) == ("sent", "sent")
        assert (s3["status"], s3["reason"]) == ("queued", "hourly_cap")
    _run(go())


def test_a_queued_row_whose_sender_is_paused_waits_then_goes_after_resume(wa_env):   # fix 5b
    db = wa_env.db

    async def go():
        await seed_wa(db)
        mid = await _queue_one_overnight(db, wa_env)
        await db.wa_instances.update_one({"instance_name": COMPANY}, {"$set": {"state": "paused"}})
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert (row["status"], row["queue_reason"]) == ("queued", "sender_unavailable") and wa_env.evo.sends == []
        wa_env.clock["now"] += timedelta(minutes=2)
        await ws.run_wa_queue_pass(db)                                # still paused: still waiting
        assert (await db.wa_messages.find_one({"message_id": mid}))["status"] == "queued"
        await db.wa_instances.update_one({"instance_name": COMPANY}, {"$set": {"state": "connected"}})
        wa_env.clock["now"] += timedelta(minutes=2)
        await ws.run_wa_queue_pass(db)
        assert (await db.wa_messages.find_one({"message_id": mid}))["status"] == "sent"
    _run(go())


def test_a_queued_row_held_for_a_paused_sender_is_skipped_after_72h(wa_env):         # fix 5b
    db = wa_env.db

    async def go():
        await seed_wa(db)
        mid = await _queue_one_overnight(db, wa_env)
        await db.wa_instances.update_one({"instance_name": COMPANY}, {"$set": {"state": "paused"}})
        wa_env.clock["now"] = _at(2026, 9, 28, 4, 30)                 # 86 h later, 10:00 IST
        await ws.run_wa_queue_pass(db)
        row = await db.wa_messages.find_one({"message_id": mid}, {"_id": 0})
        assert (row["status"], row["fail_reason"]) == ("skipped", "sender_unavailable")
        assert wa_env.evo.sends == []
    _run(go())


def test_the_queue_and_ledger_queries_have_indexes():                               # fix 6
    import database
    calls = []

    class _Rec:
        def __getattr__(self, coll):
            class _C:
                async def create_index(self, keys, **kw):
                    calls.append((coll, str(keys)))
            return _C()
    _run(database.ensure_wa_indexes(_Rec()))
    for keys in ([("instance_name", 1), ("to_jid", 1), ("sent_day", 1)],
                 [("status", 1), ("instance_name", 1), ("send_after", 1), ("created_at", 1)],
                 [("status", 1), ("sending_at", 1)]):
        assert ("wa_messages", str(keys)) in calls


# ── Final review fix wave ─────────────────────────────────────────────────────

def test_a_second_greeting_to_a_contact_today_is_skipped_but_a_drip_is_deferred(wa_env):
    # M-3: per_contact_per_day defers a drip to tomorrow; a greeting is for today, so it is refused
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        await send_whatsapp(db, to="9811111111", text="festival", kind="greeting")
        g = await send_whatsapp(db, to="+91 98111 11111", text="festival again", kind="greeting")
        d = await send_whatsapp(db, to="9811111111", text="step 2", kind="drip")
        assert (g["status"], g["reason"]) == ("skipped", "per_contact_per_day")
        assert (d["status"], d["reason"]) == ("queued", "per_contact_per_day")
        rows = {r["text"]: r for r in await db.wa_messages.find({}, {"_id": 0}).to_list(None)}
        assert rows["festival again"]["fail_reason"] == "per_contact_per_day"
        assert rows["festival again"]["send_after"] is None
        assert rows["step 2"]["send_after"] == "2026-09-25T03:30:00+00:00"       # 09:00 IST tomorrow
        assert [s["text"] for s in wa_env.evo.sends] == ["festival"]
    _run(go())


class _LedgerRaisesOnce:
    """wa_send_ledger whose first upsert loses the (instance_name, day) unique-index race."""

    def __init__(self, coll):
        self._coll, self.calls = coll, 0

    async def update_one(self, *a, **k):
        self.calls += 1
        if self.calls == 1:
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("E11000 duplicate key error collection: wa_send_ledger")
        return await self._coll.update_one(*a, **k)

    def __getattr__(self, name):
        return getattr(self._coll, name)


class _DbWith:
    def __init__(self, db, **colls):
        self._db, self._colls = db, colls

    def __getattr__(self, name):
        return self._colls.get(name) or getattr(self._db, name)


def test_the_ledger_upsert_race_does_not_raise_out_of_the_policy(wa_env):
    # M-2: two first sends of an IST day on one number can both miss the ledger row; the loser's
    # upsert raises DuplicateKeyError, which must be swallowed (the row is there) - not surface
    # from send_whatsapp as a failed step / a 500.
    db = wa_env.db

    async def go():
        await seed_wa(db)
        first = await send_whatsapp(db, to="9811111111", text="first", kind="dispatch")
        assert first["status"] == "sent"
        ledger = _LedgerRaisesOnce(db.wa_send_ledger)
        second = await send_whatsapp(_DbWith(db, wa_send_ledger=ledger), to="9822222222", text="second",
                                     kind="dispatch")
        assert second["status"] == "sent" and ledger.calls >= 2
        led = await db.wa_send_ledger.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert led["sent_count"] == 2
        assert [s["text"] for s in wa_env.evo.sends] == ["first", "second"]
    _run(go())
