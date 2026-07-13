"""Owner resolution on every write path: an "Assign To" value (a user's NAME or
EMAIL, typed or picked) must resolve to the real user, so scoping never breaks
and the UI never shows a blank owner.

Uses mongomock_motor; patches the `db` + `get_current_user` handles in crm_routes
so NOTHING touches the production database. Run with:
    python -m pytest tests/test_assign_resolution.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm


ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin"}


def _run(coro):
    return asyncio.run(coro)


class FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


async def _seed_directory(db):
    await db.salespersons.insert_one(
        {"email": "parul@smartshape.in", "name": "Parul", "is_active": True})
    await db.salespersons.insert_one(
        {"email": "bde@smartshape.in", "name": "Parul Kanchan", "is_active": True})


def _as_user(monkeypatch, user):
    async def _fake(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _fake)


# ── _apply_owner unit tests ────────────────────────────────────────────────

def test_apply_owner_by_exact_email(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "bde@smartshape.in"}, default_email="d@x.in", default_name="D")
        assert to == "bde@smartshape.in"
        assert name == "Parul Kanchan"
    _run(go())


def test_apply_owner_by_name(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "Parul"}, default_email="d@x.in", default_name="D")
        assert to == "parul@smartshape.in"
        assert name == "Parul"
    _run(go())


def test_apply_owner_name_is_case_insensitive(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "  parul KANCHAN "}, default_email="d@x.in", default_name="D")
        assert to == "bde@smartshape.in"
        assert name == "Parul Kanchan"
    _run(go())


def test_apply_owner_unknown_but_valid_email_kept(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "ghost@ext.com", "assigned_name": "Ext Person"},
            default_email="d@x.in", default_name="D")
        assert to == "ghost@ext.com"           # kept as-is (valid scoping key)
        assert name == "Ext Person"
    _run(go())


def test_apply_owner_unknown_email_gets_nonblank_name(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "ghost@ext.com"}, default_email="d@x.in", default_name="D")
        assert to == "ghost@ext.com"
        assert name and name != ""             # never blank in the UI
    _run(go())


def test_apply_owner_unresolvable_name_falls_back_to_default(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {"assigned_to": "Nobody Here"}, default_email="d@x.in", default_name="Default Rep")
        assert to == "d@x.in"                  # NEVER the raw name
        assert name == "Default Rep"
        assert to != "Nobody Here"
    _run(go())


def test_apply_owner_blank_uses_default(db):
    async def go():
        await _seed_directory(db)
        to, name = await crm._apply_owner(
            {}, default_email="self@smartshape.in", default_name="Self")
        assert (to, name) == ("self@smartshape.in", "Self")
    _run(go())


# ── integration: create_lead ───────────────────────────────────────────────

def test_create_lead_resolves_name_to_email(monkeypatch, db):
    _as_user(monkeypatch, ADMIN)

    async def go():
        await _seed_directory(db)
        lead = await crm.create_lead(FakeRequest(
            {"company_name": "Acme", "contact_name": "R", "assigned_to": "Parul"}))
        assert lead["assigned_to"] == "parul@smartshape.in"
        assert lead["assigned_name"] == "Parul"
    _run(go())


def test_create_lead_unresolvable_name_falls_back(monkeypatch, db):
    _as_user(monkeypatch, ADMIN)

    async def go():
        await _seed_directory(db)
        lead = await crm.create_lead(FakeRequest(
            {"company_name": "Beta", "contact_name": "R", "assigned_to": "Ghost Name"}))
        # default for create_lead is the creator's email; the name is never stored
        assert lead["assigned_to"] == "admin@smartshape.in"
        assert lead["assigned_to"] != "Ghost Name"
        assert lead["assigned_name"] == "Admin"
    _run(go())


def test_create_lead_email_picked(monkeypatch, db):
    _as_user(monkeypatch, ADMIN)

    async def go():
        await _seed_directory(db)
        lead = await crm.create_lead(FakeRequest(
            {"company_name": "Gamma", "assigned_to": "bde@smartshape.in"}))
        assert lead["assigned_to"] == "bde@smartshape.in"
        assert lead["assigned_name"] == "Parul Kanchan"
    _run(go())


# ── integration: reassign_lead ─────────────────────────────────────────────

def test_reassign_lead_resolves_name_to_email(monkeypatch, db):
    _as_user(monkeypatch, ADMIN)

    async def go():
        await _seed_directory(db)
        await db.leads.insert_one(
            {"lead_id": "L1", "assigned_to": "old@smartshape.in", "assigned_name": "Old"})
        out = await crm.reassign_lead(FakeRequest(
            {"lead_id": "L1", "new_agent_email": "Parul", "reason": "coverage"}))
        assert out["assigned_to"] == "parul@smartshape.in"
        assert out["assigned_name"] == "Parul"
    _run(go())


def test_reassign_lead_email_kept(monkeypatch, db):
    _as_user(monkeypatch, ADMIN)

    async def go():
        await _seed_directory(db)
        await db.leads.insert_one(
            {"lead_id": "L2", "assigned_to": "old@smartshape.in", "assigned_name": "Old"})
        out = await crm.reassign_lead(FakeRequest(
            {"lead_id": "L2", "new_agent_email": "bde@smartshape.in", "reason": "x"}))
        assert out["assigned_to"] == "bde@smartshape.in"
        assert out["assigned_name"] == "Parul Kanchan"
    _run(go())
