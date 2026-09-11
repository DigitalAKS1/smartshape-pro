"""GET /schools/{school_id}/profile must not show deleted contacts, and its
company-name fallback must not pull in contacts linked to a DIFFERENT school
or (worst case) every blank-company contact when the school itself has a
blank name. mongomock.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import services.engagement as engagement

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(engagement, "db", d, raising=False)
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me, raising=False)


def _run(coro):
    return asyncio.run(coro)


async def _seed_school(db, school_id="s_dps", school_name="Delhi Public School"):
    await db.schools.insert_one({
        "school_id": school_id, "school_name": school_name,
        "assigned_to": "", "is_deleted": False,
    })


def test_a_deleted_contact_is_excluded(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_school(db)
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "s_dps", "name": "Live Contact",
            "phone": "111", "is_deleted": False,
        })
        await db.contacts.insert_one({
            "contact_id": "c2", "school_id": "s_dps", "name": "Deleted Contact",
            "phone": "222", "is_deleted": True,
        })
        profile = await crm.get_school_profile("s_dps", FakeRequest())
        names = {c["name"] for c in profile["contacts"]}
        assert names == {"Live Contact"}
    _run(go())


def test_a_deleted_lead_is_excluded(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_school(db)
        await db.leads.insert_one({
            "lead_id": "l1", "school_id": "s_dps", "contact_name": "Live Lead",
            "is_deleted": False,
        })
        await db.leads.insert_one({
            "lead_id": "l2", "school_id": "s_dps", "contact_name": "Deleted Lead",
            "is_deleted": True,
        })
        profile = await crm.get_school_profile("s_dps", FakeRequest())
        lead_ids = {l["lead_id"] for l in profile["leads"]}
        assert lead_ids == {"l1"}
    _run(go())


def test_a_contact_linked_to_a_different_school_is_not_pulled_in_by_name(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_school(db, "s_dps", "Delhi Public School")
        await _seed_school(db, "s_dup", "Delhi Public School (duplicate)")
        # Same company string, but FK-linked to the OTHER (duplicate) school.
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "s_dup", "company": "Delhi Public School",
            "name": "Belongs Elsewhere", "phone": "333", "is_deleted": False,
        })
        profile = await crm.get_school_profile("s_dps", FakeRequest())
        names = {c["name"] for c in profile["contacts"]}
        assert "Belongs Elsewhere" not in names
    _run(go())


def test_a_blank_named_school_pulls_in_nobody_by_name(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_school(db, "s_blank", "")
        await db.contacts.insert_one({
            "contact_id": "c1", "company": "", "name": "Blank Company Contact",
            "phone": "444", "is_deleted": False,
        })
        profile = await crm.get_school_profile("s_blank", FakeRequest())
        assert profile["contacts"] == []
    _run(go())


def test_an_unlinked_contact_matching_by_company_is_still_found(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_school(db, "s_dps", "Delhi Public School")
        # Never FK-linked, but the company name matches and school_id is blank.
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "", "company": "Delhi Public School",
            "name": "Legacy Contact", "phone": "555", "is_deleted": False,
        })
        profile = await crm.get_school_profile("s_dps", FakeRequest())
        names = {c["name"] for c in profile["contacts"]}
        assert "Legacy Contact" in names
    _run(go())
