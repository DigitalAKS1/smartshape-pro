"""test_webinar_model.py — in-process tests for training-session webinar fields.

Does NOT import main.app (would trigger start_scheduler() against prod Atlas).
Builds a minimal FastAPI app with only the training router. training_routes
calls `await get_current_user(request)` directly (not via Depends), so we
monkeypatch that function on the module rather than using dependency_overrides.

Motor is event-loop-bound; database.py creates its Motor client at import
time. To avoid "Event loop is closed" errors between pytest-asyncio per-test
loops, each test patches routes.training_routes.db with a fresh Motor client
created INSIDE that test's event loop.
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
    """Fresh Motor db handle created INSIDE the current test's event loop.

    Patches tr.db so route handlers use this connection, and monkeypatches
    tr.get_current_user since it's called directly, not via Depends.
    Tears down training collections after each test.
    """
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
async def test_session_persists_webinar_fields(client, test_db):
    r = await client.post("/api/training/sessions", json={
        "title": "W", "date": "2099-01-02", "time": "09:00", "platform": "zoom",
        "meeting_link": "https://zoom.us/j/9", "host_name": "Aman",
        "webinar_emails": {"remind_1h": False}})
    assert r.status_code == 200
    sid = r.json()["session_id"]
    got = [s for s in (await client.get("/api/training/sessions")).json() if s["session_id"] == sid][0]
    assert got["host_name"] == "Aman"
    assert got["webinar_emails"]["remind_1h"] is False
    assert got["webinar_emails"].get("confirm") is True   # default-filled
