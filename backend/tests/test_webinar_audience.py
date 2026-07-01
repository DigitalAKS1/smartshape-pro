"""test_webinar_audience.py — in-process tests for Task 8: `session_id`
audience filter in `_resolve_audience` (routes.email_routes), so
campaigns/composer can target a training session's registrants/attendees/
no-shows sourced from `session_registrations` instead of `contacts`.

Does NOT import main.app (would trigger start_scheduler() against prod
Atlas). Calls `routes.email_routes._resolve_audience` directly (no HTTP
needed) after patching its module-level `db` to a test Motor client bound
to the current test's event loop.
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

# Verify we are not running against prod
_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing non-test DB: {_DB_NAME}"
)

import routes.email_routes as er

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


@pytest_asyncio.fixture
async def test_db(monkeypatch):
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]

    monkeypatch.setattr(er, "db", d)

    yield d

    await d.session_registrations.delete_many({})
    motor_client.close()


@pytest.mark.asyncio
async def test_session_audience_filters_by_status(test_db):
    sid = "sess_a"
    await test_db.session_registrations.insert_many([
        {
            "reg_id": "reg_1", "session_id": sid, "email": "att@x.com",
            "name": "Att One", "school_name": "DPS", "status": "attended",
        },
        {
            "reg_id": "reg_2", "session_id": sid, "email": "ns@x.com",
            "name": "No Show", "school_name": "DPS", "status": "no_show",
        },
        {
            "reg_id": "reg_3", "session_id": sid, "email": "",
            "name": "Empty Email", "school_name": "DPS", "status": "attended",
        },
    ])

    res = await er._resolve_audience({"session_id": sid, "session_status": "attended"})
    assert len(res) == 1
    assert res[0]["email"] == "att@x.com"
    assert res[0]["first_name"] == "Att"
    assert res[0]["company"] == "DPS"

    res_all = await er._resolve_audience({"session_id": sid})
    assert len(res_all) == 2
    emails = {r["email"] for r in res_all}
    assert emails == {"att@x.com", "ns@x.com"}
