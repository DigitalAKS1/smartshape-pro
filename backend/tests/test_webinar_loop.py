"""test_webinar_loop.py — in-process tests for the webinar-lifecycle scheduler
loop (Task 6): `scheduler.process_webinar_lifecycle(now=...)`.

Does NOT import main.app (would trigger start_scheduler() against prod Atlas).
The loop reads sessions/registrations via `scheduler.db`, and its stage
enqueuer (`routes.training_routes._enqueue_webinar_stage`) writes via
`routes.training_routes.db` — both are patched to the SAME fresh Motor client
on smartshape_test so the idempotency guard (which reads sent_stages via
training_routes.db) sees what the loop itself just wrote.
"""
import os
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

# Verify we are not running against prod
_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing non-test DB: {_DB_NAME}"
)

import scheduler
import routes.training_routes as tr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


@pytest_asyncio.fixture
async def test_db():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]

    orig_scheduler_db = scheduler.db
    orig_tr_db = tr.db
    scheduler.db = d
    tr.db = d

    yield d

    scheduler.db = orig_scheduler_db
    tr.db = orig_tr_db
    await d.training_sessions.delete_many({})
    await d.session_registrations.delete_many({})
    await d.email_scheduled.delete_many({})
    await d.email_suppressions.delete_many({})
    await d.email_campaigns.delete_many({})
    motor_client.close()


def _default_webinar_emails():
    return {k: True for k in tr.WEBINAR_STAGES}


def _session(sid, start, **extra):
    # start is a UTC-aware datetime; session date/time are IST wall-clock.
    start_ist = start + timedelta(hours=5, minutes=30)
    doc = {
        "session_id": sid,
        "title": "Die Workshop",
        "description": "Live demo",
        "date": start_ist.strftime("%Y-%m-%d"),
        "time": start_ist.strftime("%H:%M"),
        "platform": "zoom",
        "meeting_link": "https://zoom.us/j/123",
        "location": "",
        "max_participants": 0,
        "status": "upcoming",
        "is_published": True,
        "host_name": "Aman",
        "host_email": "aman@smartshape.in",
        "recording_url": "",
        "zoom_meeting_id": "",
        "webinar_emails": _default_webinar_emails(),
        "reminders_sent": {},
        "created_at": tr._now(),
        "created_by": "admin@t",
    }
    doc.update(extra)
    return doc


def _reg(sid, email, name, status="registered", sent_stages=None, school_name="DPS"):
    return {
        "reg_id": f"reg_{email.split('@')[0]}_{sid}",
        "session_id": sid,
        "email": email,
        "name": name,
        "school_name": school_name,
        "status": status,
        "sent_stages": sent_stages or [],
        "created_at": tr._now(),
    }


@pytest.mark.asyncio
async def test_reminder_24h_enqueues_once(test_db):
    sid = "sess_loop1"
    start = datetime(2099, 3, 4, 10, 30, tzinfo=timezone.utc)
    await test_db.training_sessions.insert_one(_session(sid, start))
    await test_db.session_registrations.insert_one(_reg(sid, "a@x.com", "Asha"))
    await test_db.session_registrations.insert_one(_reg(sid, "b@x.com", "Bina"))

    now = start - timedelta(hours=23)

    await scheduler.process_webinar_lifecycle(now=now)

    rows = await test_db.email_scheduled.find(
        {"campaign_id": f"webinar_{sid}", "type": "webinar"}
    ).to_list(100)
    assert len(rows) == 2
    for r in rows:
        assert r["body_html"]

    regs = await test_db.session_registrations.find({"session_id": sid}).to_list(10)
    assert len(regs) == 2
    for r in regs:
        assert "remind_24h" in r["sent_stages"]

    # Idempotent: running again at the same `now` must not duplicate.
    await scheduler.process_webinar_lifecycle(now=now)
    rows2 = await test_db.email_scheduled.find(
        {"campaign_id": f"webinar_{sid}", "type": "webinar"}
    ).to_list(100)
    assert len(rows2) == 2


@pytest.mark.asyncio
async def test_noshow_held_without_recording(test_db):
    sid = "sess_loop2"
    start = datetime(2099, 3, 4, 10, 30, tzinfo=timezone.utc)
    await test_db.training_sessions.insert_one(_session(sid, start, recording_url=""))
    await test_db.session_registrations.insert_one(
        _reg(sid, "c@x.com", "Chitra", status="no_show")
    )

    now = start + timedelta(hours=3)

    await scheduler.process_webinar_lifecycle(now=now)
    rows = await test_db.email_scheduled.find(
        {"campaign_id": f"webinar_{sid}", "type": "webinar"}
    ).to_list(100)
    assert len(rows) == 0

    reg = await test_db.session_registrations.find_one({"session_id": sid, "email": "c@x.com"})
    assert "noshow" not in (reg.get("sent_stages") or [])

    # Once a recording is set, the noshow email should fire on the next cycle.
    await test_db.training_sessions.update_one(
        {"session_id": sid}, {"$set": {"recording_url": "https://example.com/rec.mp4"}}
    )
    await scheduler.process_webinar_lifecycle(now=now)
    rows2 = await test_db.email_scheduled.find(
        {"campaign_id": f"webinar_{sid}", "type": "webinar"}
    ).to_list(100)
    assert len(rows2) == 1

    reg2 = await test_db.session_registrations.find_one({"session_id": sid, "email": "c@x.com"})
    assert "noshow" in (reg2.get("sent_stages") or [])
