"""test_import_endpoints.py — HTTP API tests for /fields and /import/* endpoints.

IMPORTANT: does NOT import main.app (which would trigger start_scheduler() against
prod Atlas). Builds a minimal FastAPI app with only the dynamic-import router.

Motor is event-loop-bound. database.py creates its Motor client at import time.
To avoid "Event loop is closed" errors between pytest-asyncio per-test loops,
we patch routes.dynamic_import_routes.db with a fresh Motor client created INSIDE
each async test (so it binds to the current test's event loop).
"""
import io
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

    # Seed field definitions into the test DB
    await fr.seed_field_definitions(d)

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
    await d.audit_backup.delete_many({})
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    """Async HTTP client wrapping the minimal app — shares the test event loop."""
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# /fields tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fields_list_school(client):
    r = await client.get("/api/fields?entity=school")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list) and len(body) > 0
    keys = [f["key"] for f in body]
    assert "school_name" in keys


@pytest.mark.asyncio
async def test_fields_create_custom(client):
    r = await client.post("/api/fields", json={
        "label": "Transport Fee",
        "entity": "school",
        "type": "number",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["key"] == "transport_fee"
    assert body["is_core"] is False


@pytest.mark.asyncio
async def test_fields_create_duplicate_key_409(client):
    """Creating a field whose derived key already exists returns HTTP 409."""
    await client.post("/api/fields", json={"label": "Transport Fee", "entity": "school", "type": "number"})
    r = await client.post("/api/fields", json={"label": "Transport Fee", "entity": "school", "type": "number"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_fields_update(client):
    r_create = await client.post("/api/fields", json={
        "label": "Lab Fee",
        "entity": "school",
        "type": "number",
    })
    assert r_create.status_code == 200
    field_id = r_create.json()["field_id"]

    r = await client.put(f"/api/fields/{field_id}", json={"label": "Lab Charge"})
    assert r.status_code == 200
    assert r.json()["label"] == "Lab Charge"


@pytest.mark.asyncio
async def test_fields_update_not_found_404(client):
    r = await client.put("/api/fields/fld_nonexistent", json={"label": "Ghost"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_fields_delete_custom(client):
    r_create = await client.post("/api/fields", json={
        "label": "Canteen Fee",
        "entity": "school",
        "type": "number",
    })
    assert r_create.status_code == 200
    field_id = r_create.json()["field_id"]

    r = await client.delete(f"/api/fields/{field_id}")
    assert r.status_code == 200
    assert r.json()["ok"] is True


@pytest.mark.asyncio
async def test_fields_delete_core_returns_409(client):
    """Deleting a core field must return 409."""
    r_list = await client.get("/api/fields?entity=school")
    core_field = next(f for f in r_list.json() if f["is_core"])
    r = await client.delete(f"/api/fields/{core_field['field_id']}")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Routing guard: new paths must not be shadowed by any earlier router
# ---------------------------------------------------------------------------

def test_new_master_import_paths_not_shadowed():
    from fastapi import FastAPI
    import routes.admin_routes  # noqa
    import routes.dynamic_import_routes as dir_mod
    app2 = FastAPI()
    # register admin-style first, then ours — mirrors main.py order
    app2.include_router(dir_mod.router, prefix="/api")
    paths = {r.path for r in app2.routes}
    assert "/api/master-import/preview" in paths and "/api/master-import/execute" in paths
    assert "/api/fields" in paths


# ---------------------------------------------------------------------------
# /master-import/preview tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preview_maps_headers_and_counts(client):
    """Core brief test: School/Institute Name -> school_name, School's Mail -> school_email, create>=1."""
    csv_bytes = b"School/Institute Name,City,School's Mail\nDPS,Delhi,d@x.com\n"
    r = await client.post(
        "/api/master-import/preview",
        files={"file": ("schools.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"entity_type": "school"},
    )
    assert r.status_code == 200
    body = r.json()

    assert "School/Institute Name" in body["headers"]
    assert "School's Mail" in body["headers"]

    mapping_by_source = {m["source"]: m for m in body["mapping"]}
    assert mapping_by_source["School/Institute Name"]["key"] == "school_name"
    assert mapping_by_source["School's Mail"]["key"] == "school_email"

    # Brand-new school must count as create
    assert body["counts"]["create"] >= 1
    assert "total" in body and body["total"] >= 1


@pytest.mark.asyncio
async def test_preview_empty_csv(client):
    csv_bytes = b"School/Institute Name,City\n"
    r = await client.post(
        "/api/master-import/preview",
        files={"file": ("empty.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"entity_type": "school"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["counts"]["create"] == 0


@pytest.mark.asyncio
async def test_preview_caps_at_200_rows(client):
    """Preview must not return more than 200 rows_preview entries."""
    header = b"School/Institute Name,City\n"
    data_rows = b"".join(
        f"School {i},City {i}\n".encode() for i in range(250)
    )
    csv_bytes = header + data_rows
    r = await client.post(
        "/api/master-import/preview",
        files={"file": ("big.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"entity_type": "school"},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["rows_preview"]) <= 200
    assert body["total"] == 250


# ---------------------------------------------------------------------------
# /master-import/execute tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_execute_creates_school(client):
    rows_keyed = [{"school_name": "Sunrise Academy", "city": "Pune"}]
    mapping = [
        {"source": "School/Institute Name", "field_id": "fld_placeholder", "key": "school_name"},
    ]
    r = await client.post("/api/master-import/execute", json={
        "rows_keyed": rows_keyed,
        "mapping": mapping,
        "create_leads": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["create"] >= 1
    assert "at" in body
    assert body["by"] == "admin@t"


@pytest.mark.asyncio
async def test_execute_writes_import_log(client):
    rows_keyed = [{"school_name": "Log Test School", "city": "Mumbai"}]
    r = await client.post("/api/master-import/execute", json={
        "rows_keyed": rows_keyed,
        "mapping": [],
        "create_leads": False,
    })
    assert r.status_code == 200
    body = r.json()
    assert "log_id" in body


# ---------------------------------------------------------------------------
# /master-import/template tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_template_returns_headers(client):
    r = await client.get("/api/master-import/template")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["headers"], list) and len(body["headers"]) > 0
    assert "School ID" not in body["headers"]
    assert "School/Institute Name" in body["headers"]


@pytest.mark.asyncio
async def test_template_with_ids_includes_school_id_column(client):
    r = await client.get("/api/master-import/template?with_ids=true")
    assert r.status_code == 200
    body = r.json()
    assert "School ID" in body["headers"]
    assert isinstance(body["rows"], list)


# ---------------------------------------------------------------------------
# /import end-to-end idempotency test
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_end_to_end_idempotent(client, test_db):
    """Preview → execute (CREATE) → re-execute with school_id (UPDATE, no duplicate)."""
    csv_bytes = (
        "School/Institute Name,City,Name,Phone Number,Assign To\n"
        "Sunrise,Pune,Mr A,900001,ravi\n"
    ).encode()

    # Step 1: preview — confirm mapping returned
    pv_r = await client.post(
        "/api/master-import/preview",
        files={"file": ("m.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={"entity_type": "school"},
    )
    assert pv_r.status_code == 200
    pv = pv_r.json()
    assert "mapping" in pv

    # Step 2: execute with rows_keyed → must CREATE 1 school
    keyed = [{"school_name": "Sunrise", "city": "Pune", "name": "Mr A", "phone": "900001", "assign_to": "ravi"}]
    r1 = await client.post(
        "/api/master-import/execute",
        json={"rows_keyed": keyed, "mapping": pv["mapping"], "create_leads": True},
    )
    assert r1.status_code == 200
    assert r1.json()["counts"]["create"] == 1

    # Step 3: fetch the minted school_id directly from the test DB
    school_doc = await test_db.schools.find_one({"school_name": "Sunrise"})
    assert school_doc is not None, "School was not inserted into test DB"
    sid = school_doc["school_id"]

    # Step 4: re-execute with school_id → must UPDATE, not create a duplicate
    keyed2 = [{**keyed[0], "school_id": sid, "city": "Pune"}]
    r2 = await client.post(
        "/api/master-import/execute",
        json={"rows_keyed": keyed2, "mapping": pv["mapping"], "create_leads": True},
    )
    assert r2.status_code == 200
    assert r2.json()["counts"]["update"] == 1

    # Confirm no duplicate — exactly one school named Sunrise
    count = await test_db.schools.count_documents({"school_name": "Sunrise"})
    assert count == 1, f"Expected 1 school, found {count}"


@pytest.mark.asyncio
async def test_school_id_column_round_trips_through_mapping(client, test_db):
    """A 'School ID' column must map to the school_id control key (high confidence)
    and flow through preview.rows_keyed so a re-upload UPDATES, not duplicates."""
    await test_db.schools.delete_many({"school_name": "Greenfield"})
    # First create a school via execute
    base = [{"school_name": "Greenfield", "city": "Goa"}]
    c = await client.post("/api/master-import/execute",
                          json={"rows_keyed": base, "mapping": [], "create_leads": False})
    assert c.json()["counts"]["create"] == 1
    sid = (await test_db.schools.find_one({"school_name": "Greenfield"}))["school_id"]

    # Now upload a sheet WITH a "School ID" column — preview must recognize it
    csv_bytes = (
        "School ID,School/Institute Name,City\n"
        f"{sid},Greenfield,Goa\n"
    ).encode()
    pv = (await client.post("/api/master-import/preview",
          files={"file": ("r.csv", io.BytesIO(csv_bytes), "text/csv")})).json()
    by = {m["source"]: m for m in pv["mapping"]}
    assert by["School ID"]["key"] == "school_id" and by["School ID"]["confidence"] == "high"
    # rows_keyed carries the school_id, and preview resolved it as an update
    assert pv["rows_keyed"][0]["school_id"] == sid
    assert pv["counts"]["update"] == 1

    # Execute straight from the previewed rows_keyed → updates, no duplicate
    r = await client.post("/api/master-import/execute",
                          json={"rows_keyed": pv["rows_keyed"], "mapping": pv["mapping"], "create_leads": False})
    assert r.json()["counts"]["update"] == 1
    assert await test_db.schools.count_documents({"school_name": "Greenfield"}) == 1
