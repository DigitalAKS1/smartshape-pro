"""Feature A — reassign-on-import (main-adapted).

Covers the export→edit→re-import round-trip:
  • export shows the owner NAME (not email)
  • preview flags owner changes on existing schools (reassign / owner_unmatched)
  • execute cascade-reassigns ONLY confirmed schools to all contacts+leads
  • an unmatched owner keeps field edits but never cascades ownership
  • resolve_owner(db, raw) behaviour

Minimal app, patched module db, test DB only. On main, commit_row already resolves
the owner name→email and sets an existing school's own assigned_to on update — so
the confirm gate here controls the CASCADE to contacts/leads.
"""
import io
import os

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import routes.dynamic_import_routes as dir_mod
import routes.crm_routes as crm
import import_engine as ie
from routes.crm_routes import resolve_owner
import auth_utils
import field_registry as fr

_app = FastAPI()
_app.include_router(dir_mod.router, prefix="/api")
_app.dependency_overrides[auth_utils.get_current_user] = lambda: {
    "email": "admin@t", "name": "Admin", "team": "admin", "role": "admin",
    "assigned_modules": ["settings", "leads"],
}
_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


@pytest_asyncio.fixture
async def db():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    await fr.seed_field_definitions(d)
    original_db = dir_mod.db
    original_crm_db = crm.db
    dir_mod.db = d      # route handlers + helpers read this module global
    crm.db = d          # execute's cascade uses crm._assign_school_cascade (crm.db)
    await d.users.delete_many({})
    await d.salespersons.delete_many({})
    await d.users.insert_many([
        {"email": "ravi@t", "name": "Ravi Kumar", "is_active": True},
        {"email": "old@t", "name": "Old Owner", "is_active": True},
    ])
    yield d
    dir_mod.db = original_db
    crm.db = original_crm_db
    for c in ("field_definitions", "schools", "contacts", "leads", "import_logs",
              "audit_backup", "users", "salespersons"):
        await d[c].delete_many({})
    await d.app_meta.delete_many({"_id": "field_definitions_seeded"})
    motor_client.close()


@pytest_asyncio.fixture
async def client(db):
    async with AsyncClient(transport=ASGITransport(app=_app), base_url="http://test") as ac:
        yield ac


async def _seed_school_with_children(db, sid, name="Sunrise", owner="old@t", owner_name="Old Owner"):
    await db.schools.insert_one({
        "school_id": sid, "school_name": name, "city": "Pune",
        "assigned_to": owner, "assigned_name": owner_name, "is_deleted": False,
    })
    await db.contacts.insert_many([
        {"contact_id": f"con_{i}", "school_id": sid, "name": f"C{i}",
         "assigned_to": owner, "assigned_name": owner_name, "is_deleted": False}
        for i in range(2)
    ])
    await db.leads.insert_one({
        "lead_id": "lead_1", "school_id": sid, "assigned_to": owner,
        "assigned_name": owner_name, "stage": "new", "is_deleted": False,
    })


@pytest.mark.asyncio
async def test_resolve_owner_by_email_name_unknown(db):
    assert await resolve_owner(db, "ravi@t") == ("ravi@t", "Ravi Kumar")
    assert await resolve_owner(db, "Ravi Kumar") == ("ravi@t", "Ravi Kumar")
    assert await resolve_owner(db, "Nobody Here") == ("", "Nobody Here")
    assert await resolve_owner(db, "ghost@t") == ("ghost@t", "")


@pytest.mark.asyncio
async def test_export_owner_cell_shows_name(client, db):
    await db.schools.insert_one({
        "school_id": "sch_x", "school_name": "Falcon", "city": "Goa",
        "assigned_to": "ravi@t", "assigned_name": "Ravi Kumar", "is_deleted": False,
    })
    r = await client.get("/api/master-import/export")
    assert r.status_code == 200
    row = next(x for x in r.json()["rows"] if x["School ID"] == "sch_x")
    assert row["Assign To"] == "Ravi Kumar"  # name, not the email


@pytest.mark.asyncio
async def test_preview_flags_reassign(client, db):
    sid = "sch_r1"
    await _seed_school_with_children(db, sid)
    csv_bytes = (f"School ID,School/Institute Name,City,Assign To\n{sid},Sunrise,Pune,Ravi Kumar\n").encode()
    pv = (await client.post("/api/master-import/preview",
          files={"file": ("r.csv", io.BytesIO(csv_bytes), "text/csv")})).json()
    reas = [p for p in pv["reassignments"] if p["status"] == "reassign"]
    assert len(reas) == 1 and reas[0]["school_id"] == sid
    assert reas[0]["to_email"] == "ravi@t" and reas[0]["from_name"] == "Old Owner"
    assert reas[0]["counts"] == {"contacts": 2, "leads": 1}


@pytest.mark.asyncio
async def test_execute_cascades_when_confirmed(client, db):
    sid = "sch_r2"
    await _seed_school_with_children(db, sid)
    keyed = [{"school_id": sid, "school_name": "Sunrise", "city": "Pune", "assign_to": "Ravi Kumar"}]
    r = await client.post("/api/master-import/execute", json={
        "rows_keyed": keyed, "mapping": [], "create_leads": False,
        "confirm_reassign_school_ids": [sid],
    })
    assert r.status_code == 200 and r.json()["reassigned"] == 1
    assert await db.contacts.count_documents({"school_id": sid, "assigned_to": "ravi@t"}) == 2
    lead = await db.leads.find_one({"lead_id": "lead_1"})
    assert lead["assigned_to"] == "ravi@t"
    assert lead["reassignments"][-1]["from_email"] == "old@t"


@pytest.mark.asyncio
async def test_execute_skips_cascade_when_not_confirmed(client, db):
    sid = "sch_r3"
    await _seed_school_with_children(db, sid)
    keyed = [{"school_id": sid, "school_name": "Sunrise", "city": "Pune", "assign_to": "Ravi Kumar"}]
    r = await client.post("/api/master-import/execute", json={
        "rows_keyed": keyed, "mapping": [], "create_leads": False,
    })
    assert r.status_code == 200 and r.json()["reassigned"] == 0
    # children NOT cascaded (confirm gate controls the cascade)
    assert await db.contacts.count_documents({"school_id": sid, "assigned_to": "old@t"}) == 2
    assert (await db.leads.find_one({"lead_id": "lead_1"}))["assigned_to"] == "old@t"


@pytest.mark.asyncio
async def test_unmatched_owner_keeps_edits_no_reassign(client, db):
    sid = "sch_r4"
    await _seed_school_with_children(db, sid)
    csv_bytes = (f"School ID,School/Institute Name,City,Assign To\n{sid},Sunrise,Mumbai,Ghost Person\n").encode()
    pv = (await client.post("/api/master-import/preview",
          files={"file": ("u.csv", io.BytesIO(csv_bytes), "text/csv")})).json()
    assert any(p["status"] == "owner_unmatched" for p in pv["reassignments"])
    keyed = [{"school_id": sid, "school_name": "Sunrise", "city": "Mumbai", "assign_to": "Ghost Person"}]
    r = await client.post("/api/master-import/execute", json={
        "rows_keyed": keyed, "mapping": [], "create_leads": False,
        "confirm_reassign_school_ids": [sid],
    })
    assert r.json()["reassigned"] == 0
    school = await db.schools.find_one({"school_id": sid})
    assert school["assigned_to"] == "old@t"   # ownership unchanged
    assert school["city"] == "Mumbai"         # field edit applied
