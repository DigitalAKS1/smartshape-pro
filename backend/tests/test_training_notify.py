"""test_training_notify.py — verifies notify_session enqueues HTML campaign rows
instead of sending inline/synchronously via smtplib.

Does NOT import main.app (would trigger start_scheduler() against prod Atlas).
Builds a minimal FastAPI app with only routes.training_routes.router, and patches
routes.training_routes.db + routes.training_routes.get_current_user so the handler
runs against a fresh Motor client bound to this test's event loop.
"""
import os
import uuid
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

import routes.training_routes as tr_mod

_app = FastAPI()
_app.include_router(tr_mod.router, prefix="/api")

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


async def _fake_get_current_user(request):
    return {"email": "admin@t", "name": "Admin", "team": "admin", "role": "admin"}


@pytest_asyncio.fixture
async def test_db():
    """Fresh Motor db handle bound to this test's event loop; patches tr_mod.db
    and tr_mod.get_current_user; tears down test collections after each test."""
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]

    original_db = tr_mod.db
    original_gcu = tr_mod.get_current_user
    tr_mod.db = d
    tr_mod.get_current_user = _fake_get_current_user

    yield d

    tr_mod.db = original_db
    tr_mod.get_current_user = original_gcu
    await d.training_sessions.delete_many({})
    await d.quotations.delete_many({})
    await d.email_scheduled.delete_many({})
    await d.email_campaigns.delete_many({})
    await d.email_suppressions.delete_many({})
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_notify_session_enqueues_not_inline(client, test_db):
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    await test_db.training_sessions.insert_one({
        "session_id": session_id,
        "title": "QA Webinar",
        "description": "A test session",
        "date": "2099-01-01",
        "time": "10:00",
        "platform": "zoom",
        "meeting_link": "https://zoom.us/j/1",
        "location": "",
        "is_published": True,
        "status": "upcoming",
    })

    await test_db.quotations.insert_many([
        {
            "customer_email": "alice@example.com",
            "principal_name": "Alice Principal",
            "school_name": "Alice School",
        },
        {
            "customer_email": "bob@example.com",
            "principal_name": "Bob Principal",
            "school_name": "Bob School",
        },
    ])

    r = await client.post(f"/api/training/sessions/{session_id}/notify")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "queued" in body
    assert "sent" not in body
    assert body["queued"] == 2

    scheduled_rows = await test_db.email_scheduled.find({}).to_list(10)
    assert len(scheduled_rows) == 2
    for row in scheduled_rows:
        assert row["type"] == "campaign"
        assert row.get("body_html")
        assert "QA Webinar" in row["body_html"]

    campaign = await test_db.email_campaigns.find_one({"source_id": session_id})
    assert campaign is not None
    assert campaign["source"] == "training_session"
    assert campaign["status"] == "queued"


@pytest.mark.asyncio
async def test_notify_session_skips_suppressed(client, test_db):
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    await test_db.training_sessions.insert_one({
        "session_id": session_id,
        "title": "QA Webinar",
        "description": "A test session",
        "date": "2099-01-01",
        "time": "10:00",
        "platform": "zoom",
        "meeting_link": "https://zoom.us/j/1",
        "location": "",
        "is_published": True,
        "status": "upcoming",
    })

    # Insert two quotations with distinct customer emails
    await test_db.quotations.insert_many([
        {
            "customer_email": "alice@example.com",
            "principal_name": "Alice Principal",
            "school_name": "Alice School",
        },
        {
            "customer_email": "bob@example.com",
            "principal_name": "Bob Principal",
            "school_name": "Bob School",
        },
    ])

    # Suppress one of the emails
    await test_db.email_suppressions.insert_one({"email": "alice@example.com"})

    r = await client.post(f"/api/training/sessions/{session_id}/notify")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] == 1, "suppressed email should be skipped"

    scheduled_rows = await test_db.email_scheduled.find({}).to_list(10)
    assert len(scheduled_rows) == 1
    assert scheduled_rows[0]["email"] == "bob@example.com"
