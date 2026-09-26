"""test_import_entry.py — HTTP API tests for POST /master-import/entry (single-record
manual entry that reuses import_engine.commit_row).

IMPORTANT: does NOT import main.app (which would trigger start_scheduler() against
prod Atlas). Builds a minimal FastAPI app with only the dynamic-import router.

Motor is event-loop-bound. database.py creates its Motor client at import time.
To avoid "Event loop is closed" errors between pytest-asyncio per-test loops,
we patch routes.dynamic_import_routes.db with a fresh Motor client created INSIDE
each async test (so it binds to the current test's event loop).
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

import routes.dynamic_import_routes as dir_mod
import auth_utils
import field_registry as fr

# Build minimal app — no scheduler, no startup hooks
_app = FastAPI()
_app.include_router(dir_mod.router, prefix="/api")
_app.dependency_overrides[auth_utils.get_current_user] = lambda: {
    "email": "admin@t",
    "team": "admin",
    "role": "admin",
    "assigned_modules": ["settings"],
}

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


@pytest_asyncio.fixture
async def test_db():
    """Fresh Motor db handle created INSIDE the current test's event loop.

    Also patches dir_mod.db so the route handlers use this same connection,
    and seeds field definitions. Tears down all test collections after each test.
    """
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    assert d.name.endswith("_test") or d.name == "mtt_ci", f"refusing non-test DB: {d.name}"

    # Seed field definitions into the test DB
    await fr.seed_field_definitions(d)

    # Also register a custom field so we can exercise custom_fields round-trip
    try:
        await fr.create_field(d, {"label": "Transport Fee", "entity": "school", "type": "number"}, {"email": "admin@t"})
    except ValueError:
        pass  # already exists from a previous run's leftover seed guard

    # Patch the module-level db used by the route handlers so they share this loop
    original_db = dir_mod.db
    dir_mod.db = d

    yield d

    # Restore and teardown
    dir_mod.db = original_db
    await d.field_definitions.delete_many({})
    await d.app_meta.delete_many({"_id": "field_definitions_seeded"})
    await d.import_logs.delete_many({})
    await d.schools.delete_many({})
    await d.contacts.delete_many({})
    await d.leads.delete_many({})
    await d.audit_backup.delete_many({})
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    """Async HTTP client wrapping the minimal app — shares the test event loop."""
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# POST /master-import/entry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_entry_creates_school_contact(client, test_db):
    values = {
        "school_name": "Bright Future School",
        "city": "Nagpur",
        "name": "Mr Verma",
        "phone": "9990001111",
        "transport_fee": "500",
    }
    r = await client.post("/api/master-import/entry", json={"values": values, "create_leads": False})
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "create"
    assert body["school_id"]

    school = await test_db.schools.find_one({"school_id": body["school_id"]})
    assert school is not None
    assert school["school_name"] == "Bright Future School"

    contact = await test_db.contacts.find_one({"school_id": body["school_id"]})
    assert contact is not None
    assert contact["name"] == "Mr Verma"
    assert contact["phone"] == "9990001111"

    # Custom field value must be under custom_fields, not top-level
    assert school.get("custom_fields", {}).get("transport_fee") == "500"
    assert "transport_fee" not in {k for k in school.keys() if k not in ("custom_fields",)} or True
    assert "transport_fee" not in school  # ensure not written as a top-level native key


@pytest.mark.asyncio
async def test_entry_update_by_id_no_duplicate(client, test_db):
    values = {
        "school_name": "Hilltop Academy",
        "city": "Shimla",
        "transport_fee": "100",
    }
    r1 = await client.post("/api/master-import/entry", json={"values": values, "create_leads": False})
    assert r1.status_code == 200
    sid = r1.json()["school_id"]
    assert r1.json()["action"] == "create"

    values2 = {
        "school_id": sid,
        "school_name": "Hilltop Academy",
        "city": "Shimla",
        "transport_fee": "250",
    }
    r2 = await client.post("/api/master-import/entry", json={"values": values2, "create_leads": False})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["action"] == "update"
    assert body2["school_id"] == sid

    count = await test_db.schools.count_documents({"school_name": "Hilltop Academy"})
    assert count == 1

    school = await test_db.schools.find_one({"school_id": sid})
    assert school.get("custom_fields", {}).get("transport_fee") == "250"


@pytest.mark.asyncio
async def test_entry_needs_review_returns_200(client, test_db):
    # Insert two non-deleted schools with the same name+city
    for i in range(2):
        await test_db.schools.insert_one({
            "school_id": f"sch_dup{i}",
            "school_name": "Duplicate High",
            "city": "Indore",
            "is_deleted": False,
        })

    before = await test_db.schools.count_documents({})
    r = await client.post("/api/master-import/entry", json={
        "values": {"school_name": "Duplicate High", "city": "Indore"},
        "create_leads": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "needs_review"

    after = await test_db.schools.count_documents({})
    assert after == before  # nothing new written


@pytest.mark.asyncio
async def test_entry_drops_unregistered_keys(client, test_db):
    r = await client.post("/api/master-import/entry", json={
        "values": {"is_deleted": True, "school_name": "X", "city": "Y"},
        "create_leads": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "create"

    school = await test_db.schools.find_one({"school_id": body["school_id"]})
    assert not school.get("is_deleted")
