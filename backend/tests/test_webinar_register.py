"""test_webinar_register.py — in-process tests for the session register endpoint
and the shared _enqueue_webinar_stage helper (Stage-2 confirmation email).

Does NOT import main.app (would trigger start_scheduler() against prod Atlas).
Builds a minimal FastAPI app with only the training router. Follows the same
per-test fresh-Motor-client pattern as test_webinar_model.py to avoid
"Event loop is closed" errors between pytest-asyncio per-test loops.
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

# Verify we are not running against prod
_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing non-test DB: {_DB_NAME}"
)

import routes.training_routes as tr

_app = FastAPI()
_app.include_router(tr.router, prefix="/api")

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


async def _fake_get_current_user(request):
    return {"email": "admin@t", "name": "Admin", "team": "admin", "role": "admin"}


@pytest_asyncio.fixture
async def test_db(monkeypatch):
    monkeypatch.setattr(tr, "get_current_user", _fake_get_current_user)

    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]

    original_db = tr.db
    tr.db = d

    yield d

    tr.db = original_db
    await d.training_sessions.delete_many({})
    await d.session_registrations.delete_many({})
    await d.email_scheduled.delete_many({})
    await d.email_suppressions.delete_many({})
    await d.email_campaigns.delete_many({})
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _default_webinar_emails():
    return {k: True for k in tr.WEBINAR_STAGES}


@pytest.mark.asyncio
async def test_register_creates_reg_and_confirm(client, test_db):
    sid = "sess_reg1"
    await test_db.training_sessions.insert_one({
        "session_id": sid,
        "title": "Die Workshop",
        "description": "Live demo",
        "date": "2099-03-04",
        "time": "10:30",
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
    })

    r = await client.post(f"/api/training/sessions/{sid}/register", json={
        "name": "Asha Rao", "email": "asha@x.com", "school_name": "DPS",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["registered"] is True
    reg_id = body["reg_id"]
    assert reg_id

    reg = await test_db.session_registrations.find_one({"session_id": sid, "email": "asha@x.com"})
    assert reg is not None
    assert reg["status"] == "registered"
    assert "confirm" in reg["sent_stages"]

    sched = await test_db.email_scheduled.find_one({"campaign_id": f"webinar_{sid}"})
    assert sched is not None
    assert sched["type"] == "webinar"
    assert sched["body_html"]
    assert "Die Workshop" in sched["body_html"]
    assert f"/api/training/sessions/{sid}/ics" in sched["body_html"]
    # personalized: {name} token substituted, first name present
    assert "{name}" not in sched["body_html"]
    assert "Asha" in sched["body_html"]

    # Re-register same email → idempotent: no duplicate registration, no dup confirm email
    r2 = await client.post(f"/api/training/sessions/{sid}/register", json={
        "name": "Asha Rao", "email": "asha@x.com", "school_name": "DPS",
    })
    assert r2.status_code == 200
    assert r2.json()["registered"] is True
    assert r2.json()["reg_id"] == reg_id

    regs_count = await test_db.session_registrations.count_documents({"session_id": sid, "email": "asha@x.com"})
    assert regs_count == 1

    sched_count = await test_db.email_scheduled.count_documents({"campaign_id": f"webinar_{sid}"})
    assert sched_count == 1


@pytest.mark.asyncio
async def test_register_creates_campaign_doc(client, test_db):
    sid = "sess_reg2"
    await test_db.training_sessions.insert_one({
        "session_id": sid,
        "title": "Stamp Workshop",
        "description": "Live demo",
        "date": "2099-04-05",
        "time": "11:00",
        "platform": "zoom",
        "meeting_link": "https://zoom.us/j/456",
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
    })

    r = await client.post(f"/api/training/sessions/{sid}/register", json={
        "name": "Neha Gupta", "email": "neha@x.com", "school_name": "SVM",
    })
    assert r.status_code == 200
    assert r.json()["registered"] is True

    campaign = await test_db.email_campaigns.find_one({"campaign_id": f"webinar_{sid}"})
    assert campaign is not None
    assert campaign["source"] == "webinar"
    assert campaign["source_id"] == sid
    assert "Stamp Workshop" in campaign["name"]
