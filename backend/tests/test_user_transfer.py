"""Tests for deactivate-and-transfer on admin_delete_user.

Pure-Python tests cover the TRANSFER_SPECS contract (no DB / no network).
The endpoint tests spin up routes.admin_routes.router in-process against an
isolated test DB, following the pattern in test_admin_roles.py (patch
module-level `db` and `get_current_user`, never import main).
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from routes.admin_routes import TRANSFER_SPECS
import routes.admin_routes as ar

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

ADMIN = {"user_id": "user_admin", "email": "admin@smartshape.in", "role": "admin",
         "roles": ["admin"], "module_permissions": {}}


# ==================== TRANSFER_SPECS contract (pure Python) ====================

def test_transfer_specs_cover_live_crm_ownership():
    collections = {c for c, _ in TRANSFER_SPECS}
    for expected in ("leads", "schools", "contacts", "tasks", "followups",
                     "visit_plans", "visits", "field_visits", "del_task_instances"):
        assert expected in collections, f"{expected} missing from TRANSFER_SPECS"


def test_transfer_never_touches_sales_attribution():
    """Quotations and orders carry commission/revenue attribution and must not move."""
    collections = {c for c, _ in TRANSFER_SPECS}
    assert "quotations" not in collections
    assert "orders" not in collections
    assert "invoices" not in collections


def test_transfer_only_moves_assigned_to():
    """created_by is history, not ownership — it must never be rewritten."""
    fields = {f for _, f in TRANSFER_SPECS}
    assert fields == {"assigned_to"}, f"unexpected owner fields: {fields}"


def test_specs_have_no_duplicates():
    assert len(TRANSFER_SPECS) == len(set(TRANSFER_SPECS))


# ==================== Endpoint tests (isolated test DB) ====================

@pytest_asyncio.fixture
async def ctx():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = ar.db
    ar.db = d
    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        yield d, client
    ar.db = orig_db
    for coll in ("users", "salespersons", "leads", "schools", "contacts", "tasks",
                 "followups", "visit_plans", "visits", "field_visits",
                 "del_task_instances", "quotations", "orders", "activity_logs"):
        await d[coll].delete_many({})
    motor_client.close()


def _as(user):
    async def fake(request):
        return user
    return fake


@pytest_asyncio.fixture
async def leaving_and_recipient(ctx):
    d, client = ctx
    await d.users.insert_one({
        "user_id": "user_leaving", "email": "leaving@smartshape.in", "name": "Leaving Rep",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    await d.users.insert_one({
        "user_id": "user_recipient", "email": "recipient@smartshape.in", "name": "Recipient Rep",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    await d.salespersons.insert_one({"email": "leaving@smartshape.in", "is_active": True})

    # Live CRM records owned by the leaving user
    await d.leads.insert_one({"lead_id": "lead_1", "assigned_to": "leaving@smartshape.in",
                               "created_by": "leaving@smartshape.in"})
    await d.schools.insert_one({"school_id": "school_1", "assigned_to": "leaving@smartshape.in"})
    await d.contacts.insert_one({"contact_id": "contact_1", "assigned_to": "leaving@smartshape.in"})
    await d.tasks.insert_one({"task_id": "task_1", "assigned_to": "leaving@smartshape.in"})
    await d.followups.insert_one({"followup_id": "fu_1", "assigned_to": "leaving@smartshape.in"})
    await d.visit_plans.insert_one({"plan_id": "plan_1", "assigned_to": "leaving@smartshape.in"})

    # Sales-attribution records that must NOT move
    await d.quotations.insert_one({"quotation_id": "quot_1", "created_by": "leaving@smartshape.in"})
    await d.orders.insert_one({"order_id": "order_1", "sales_person_email": "leaving@smartshape.in"})

    return d, client


@pytest.mark.asyncio
async def test_data_summary_counts_only_live_crm_collections(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.get("/api/admin/users/user_leaving/data-summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {
        "leads": 1, "schools": 1, "contacts": 1, "tasks": 1,
        "followups": 1, "visit_plans": 1,
    }
    assert body["total"] == 6
    assert "quotations" not in body["counts"]
    assert "orders" not in body["counts"]


@pytest.mark.asyncio
async def test_data_summary_requires_admin(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    non_admin = {"user_id": "x", "email": "rep@smartshape.in", "role": "sales_person",
                 "roles": ["sales_person"], "module_permissions": {}}
    monkeypatch.setattr(ar, "get_current_user", _as(non_admin))
    r = await client.get("/api/admin/users/user_leaving/data-summary")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_without_transfer_deactivates_and_leaves_records_orphaned(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deactivated"] is True
    assert body["transferred"] == {}

    user_doc = await d.users.find_one({"user_id": "user_leaving"}, {"_id": 0})
    assert user_doc is not None, "user document must be kept, not deleted"
    assert user_doc["is_active"] is False

    sp_doc = await d.salespersons.find_one({"email": "leaving@smartshape.in"}, {"_id": 0})
    assert sp_doc["is_active"] is False

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "leaving@smartshape.in"


@pytest.mark.asyncio
async def test_delete_with_transfer_moves_live_crm_ownership_only(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deactivated"] is True
    assert body["transferred"] == {
        "leads": 1, "schools": 1, "contacts": 1, "tasks": 1,
        "followups": 1, "visit_plans": 1,
    }

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "recipient@smartshape.in"
    # created_by is history — never rewritten
    assert lead["created_by"] == "leaving@smartshape.in"

    school = await d.schools.find_one({"school_id": "school_1"}, {"_id": 0})
    assert school["assigned_to"] == "recipient@smartshape.in"

    # Sales attribution is untouched
    quot = await d.quotations.find_one({"quotation_id": "quot_1"}, {"_id": 0})
    assert quot["created_by"] == "leaving@smartshape.in"
    order = await d.orders.find_one({"order_id": "order_1"}, {"_id": 0})
    assert order["sales_person_email"] == "leaving@smartshape.in"

    user_doc = await d.users.find_one({"user_id": "user_leaving"}, {"_id": 0})
    assert user_doc["is_active"] is False


@pytest.mark.asyncio
async def test_delete_rejects_transfer_to_self(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "leaving@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_unknown_recipient(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "nobody@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_transfer_to_deactivated_recipient(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    await d.users.update_one({"user_id": "user_recipient"}, {"$set": {"is_active": False}})
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_removing_self(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    self_admin = dict(ADMIN, user_id="user_leaving")
    monkeypatch.setattr(ar, "get_current_user", _as(self_admin))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_requires_admin(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    non_admin = {"user_id": "x", "email": "rep@smartshape.in", "role": "sales_person",
                 "roles": ["sales_person"], "module_permissions": {}}
    monkeypatch.setattr(ar, "get_current_user", _as(non_admin))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_unknown_user_404s(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_does_not_exist")
    assert r.status_code == 404
