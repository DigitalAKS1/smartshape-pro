"""test_webinar_attendance.py — in-process tests for Task 7: attendance
reconciliation (`POST /training/sessions/{id}/reconcile-attendance`) that marks
each session registration attended vs no-show from a Zoom attendee list.

Does NOT import main.app (would trigger start_scheduler() against prod Atlas).
Builds a minimal FastAPI app with only the training router. Follows the same
per-test fresh-Motor-client pattern as test_webinar_register.py to avoid
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
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_reconcile_sets_attended_and_noshow(client, test_db):
    sid = "sess_att1"
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
        "webinar_emails": {k: True for k in tr.WEBINAR_STAGES},
        "reminders_sent": {},
        "created_at": tr._now(),
        "created_by": "admin@t",
    })

    await test_db.session_registrations.insert_one({
        "reg_id": "reg_a1", "session_id": sid, "name": "Asha", "email": "a@x.com",
        "school_name": "DPS", "contact_id": None, "status": "registered",
        "sent_stages": [], "registered_at": tr._now(),
    })
    await test_db.session_registrations.insert_one({
        "reg_id": "reg_b1", "session_id": sid, "name": "Bina", "email": "b@x.com",
        "school_name": "DPS", "contact_id": None, "status": "registered",
        "sent_stages": [], "registered_at": tr._now(),
    })

    r = await client.post(
        f"/api/training/sessions/{sid}/reconcile-attendance",
        json={"attendee_emails": ["A@X.com"]},
    )
    assert r.status_code == 200
    assert r.json() == {"attended": 1, "no_show": 1}

    reg_a = await test_db.session_registrations.find_one({"reg_id": "reg_a1"})
    assert reg_a["status"] == "attended"
    assert reg_a.get("attended_at")

    reg_b = await test_db.session_registrations.find_one({"reg_id": "reg_b1"})
    assert reg_b["status"] == "no_show"


@pytest.mark.asyncio
async def test_reconcile_404_on_missing_session(client, test_db):
    r = await client.post(
        "/api/training/sessions/sess_missing/reconcile-attendance",
        json={"attendee_emails": []},
    )
    assert r.status_code == 404
