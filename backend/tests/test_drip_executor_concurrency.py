"""Overlapping drip executor runs send each due step EXACTLY once.

The executor is started by the hourly loop and also kicked (asyncio.create_task)
by enroll-contacts / enroll-schools. A review reproduced two overlapping runs
sending 10 WhatsApps to 5 contacts: both runs loaded the same due rows. Two
guards in scheduler.py, each tested here on its own and together:

  * `_DRIP_LOCK` — in one process an overlapping call returns at once and asks
    the running pass to look again (bounded), instead of running alongside it.
  * `_claim_enrollment` — a per-row compare-and-set on `next_step_at` /
    `current_step` before sending, so even two passes that bypass the lock (two
    workers, two processes) cannot both send one step.

Contact-keyed AND lead-keyed enrolments. No outward side effects: mongomock,
senders replaced by recorders that yield to the loop (so passes really
interleave), smtplib / httpx booby-trapped.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_drip_executor_concurrency.py -q
"""
import asyncio
import os
import smtplib
from collections import Counter
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import services.engagement as engagement

PAST = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()


@pytest.fixture()
def env(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched, engagement):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    monkeypatch.setattr(sched, "_DRIP_RERUN", False)
    sent = {"wa": [], "email": [], "errors": [], "on_send": None}

    async def _fake_wa(cfg, to_phone, message):
        sent["wa"].append(to_phone)
        if sent["on_send"]:
            await sent["on_send"](to_phone)
        await asyncio.sleep(0)            # let an overlapping pass run in between

    def _fake_smtp(*a, **k):
        sent["email"].append(a[3])

    async def _fake_notify(*a, **k):
        return None

    monkeypatch.setattr(sched, "_send_wa", _fake_wa)
    monkeypatch.setattr(sched, "_smtp_send", _fake_smtp)
    monkeypatch.setattr(sched, "notify_user", _fake_notify)

    def _no_network(*a, **k):
        raise AssertionError("a test tried to reach the network")
    monkeypatch.setattr(smtplib, "SMTP", _no_network)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _no_network)
    monkeypatch.setattr(httpx.AsyncClient, "post", _no_network)

    real_error = sched.log.error

    def _capture(msg, *a, **k):
        sent["errors"].append(str(msg))
        real_error(msg, *a, **k)
    monkeypatch.setattr(sched.log, "error", _capture)
    return d, sent


def _run(coro):
    return asyncio.run(coro)


async def _seed(db, *, kind, n=5, delays=(0, 7)):
    await db.settings.insert_one({"type": "whatsapp_provider", "provider": "meta", "api_key": "k"})
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "wa_consent": True,
                                 "assigned_to": "o@x.in", "is_deleted": False})
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "S", "is_active": True,
        "steps": [{"step_number": i + 1, "delay_days": d, "message_type": "whatsapp",
                   "message_template": "Hi {name}"} for i, d in enumerate(delays)]})
    for i in range(n):
        phone = f"98000000{i:02d}"
        if kind == "contact":
            await db.contacts.insert_one({"contact_id": f"c{i}", "name": f"C{i}", "phone": phone,
                                          "school_id": "s1", "is_deleted": False})
        else:
            await db.leads.insert_one({"lead_id": f"L{i}", "contact_name": f"L{i}",
                                       "contact_phone": phone, "school_id": "s1",
                                       "company_name": "DPS", "wa_consent": True,
                                       "is_deleted": False})
        await _enrol(db, f"e{i}", kind, i)


async def _enrol(db, eid, kind, i):
    await db.drip_enrollments.insert_one({
        "enrollment_id": eid, "sequence_id": "seq1",
        "lead_id": f"L{i}" if kind == "lead" else None,
        "contact_id": f"c{i}" if kind == "contact" else None,
        "school_id": "s1", "current_step": 0, "status": "active",
        "enrolled_at": PAST, "next_step_at": PAST, "last_step_at": None,
        "completed_at": None, "enrolled_by": "t"})


async def _assert_each_once(db, sent, n=5):
    counts = Counter(sent["wa"])
    assert len(counts) == n, f"not everyone got the step: {counts}"
    assert set(counts.values()) == {1}, f"someone got it twice: {counts}"
    assert await db.drip_step_logs.count_documents({}) == n
    for e in await db.drip_enrollments.find({}, {"_id": 0}).to_list(None):
        assert e["current_step"] == 1 and e["status"] == "active"
        assert e["next_step_at"] > PAST
    assert sent["errors"] == []


# ── Two overlapping public calls ────────────────────────────────────────────

@pytest.mark.parametrize("kind", ["contact", "lead"])
def test_two_overlapping_runs_send_each_step_once(env, kind):
    db, sent = env

    async def go():
        await _seed(db, kind=kind)
        await asyncio.gather(sched.run_drip_executor(), sched.run_drip_executor())
        await _assert_each_once(db, sent)
    _run(go())


# ── The claim alone: two passes that bypass the lock (= two workers) ────────

@pytest.mark.parametrize("kind", ["contact", "lead"])
def test_two_passes_without_the_lock_still_send_each_step_once(env, kind):
    db, sent = env

    async def go():
        await _seed(db, kind=kind)
        await asyncio.gather(sched._drip_executor_pass(), sched._drip_executor_pass(),
                             sched._drip_executor_pass())
        await _assert_each_once(db, sent)
    _run(go())


def test_a_claimed_row_is_not_due_again_until_the_window_expires(env):
    db, sent = env

    async def go():
        await _seed(db, kind="contact", n=1)
        enr = await db.drip_enrollments.find_one({}, {"_id": 0})
        now = datetime.now(timezone.utc)
        assert await sched._claim_enrollment(enr, now) is True
        # A second claim on the same loaded values loses.
        assert await sched._claim_enrollment(enr, now) is False
        claimed = await db.drip_enrollments.find_one({}, {"_id": 0})
        assert claimed["next_step_at"] > now.isoformat()
        # Nothing is due while the claim holds.
        await sched.run_drip_executor()
        assert sent["wa"] == []
        # When the claim lapses (the holder died mid-step), the step is retried.
        await db.drip_enrollments.update_one({}, {"$set": {"next_step_at": PAST}})
        await sched.run_drip_executor()
        assert sent["wa"] == ["9800000000"]
    _run(go())


def test_the_claim_leaves_the_failure_counter_and_retry_cadence_alone(env):
    db, sent = env

    async def boom(_phone):
        raise RuntimeError("provider down")
    sent["on_send"] = boom

    async def go():
        await _seed(db, kind="contact", n=1)
        before = datetime.now(timezone.utc)
        await sched.run_drip_executor()
        enr = await db.drip_enrollments.find_one({}, {"_id": 0})
        # The failure path, not the claim, decides the retry: +1 hour, count 1.
        assert enr["step_fail_count"] == 1 and enr["status"] == "active"
        assert enr["next_step_at"] >= (before + timedelta(minutes=55)).isoformat()
        assert enr["current_step"] == 0
    _run(go())


# ── The lock: overlapping calls collapse; a late batch still goes out now ───

def test_an_overlapping_call_returns_at_once_and_the_running_pass_picks_up_the_new_batch(env):
    db, sent = env
    state = {"kicked": False}

    async def enrol_more_mid_run(_phone):
        # While the first pass is sending, a new batch is enrolled with step 1
        # due now and the executor is kicked (what enroll-contacts does).
        if state["kicked"]:
            return
        state["kicked"] = True
        await db.contacts.insert_one({"contact_id": "c_late", "name": "Late", "phone": "9811110000",
                                      "school_id": "s1", "is_deleted": False})
        await db.drip_enrollments.insert_one({
            "enrollment_id": "e_late", "sequence_id": "seq1", "lead_id": None,
            "contact_id": "c_late", "school_id": "s1", "current_step": 0,
            "status": "active", "enrolled_at": PAST, "next_step_at": PAST})
        await sched.run_drip_executor()        # must return immediately, not deadlock
    sent["on_send"] = enrol_more_mid_run

    async def go():
        await _seed(db, kind="contact", n=2)
        await sched.run_drip_executor()
        assert Counter(sent["wa"]) == {"9800000000": 1, "9800000001": 1, "9811110000": 1}
        assert not sched._DRIP_LOCK.locked()
    _run(go())


def test_rerun_requests_are_bounded(env, monkeypatch):
    passes = {"n": 0}

    async def greedy_pass():
        passes["n"] += 1
        await sched.run_drip_executor()        # always asks for another pass
    monkeypatch.setattr(sched, "_drip_executor_pass", greedy_pass)

    async def go():
        await sched.run_drip_executor()
        assert passes["n"] == sched.DRIP_MAX_PASSES
        assert not sched._DRIP_LOCK.locked()
    _run(go())


def test_the_lock_is_released_when_a_pass_raises(env, monkeypatch):
    async def broken_pass():
        raise RuntimeError("db down")
    monkeypatch.setattr(sched, "_drip_executor_pass", broken_pass)

    async def go():
        with pytest.raises(RuntimeError):
            await sched.run_drip_executor()
        assert not sched._DRIP_LOCK.locked()
    _run(go())
