"""Converting a contact to a lead must not orphan it from its school.

POST /contacts/{contact_id}/convert-to-lead only ever read school_id from the
request body. The School Profile's Convert button sends no school_id at all,
so every contact converted from its own school's profile produced a lead with
school_id='' — invisible on the school's Leads tab and missing from its
"Enroll Lead in Drip" dropdown. 8 of 82 converted contacts in production were
orphaned this way.

Fix: fall back to the contact's own school_id when the body omits one. An
explicit non-empty body value still wins. mongomock.
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

REP = {
    "email": "rep@ss.in", "name": "Rep One", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me, raising=False)


def _run(coro):
    return asyncio.run(coro)


async def _seed_contact(db, contact_id="c1", school_id="s_dps"):
    await db.schools.insert_one({
        "school_id": school_id, "school_name": "Delhi Public School",
        "assigned_to": "", "is_deleted": False,
    })
    await db.contacts.insert_one({
        "contact_id": contact_id, "name": "R Sharma", "phone": "9811111111",
        "school_id": school_id, "company": "Delhi Public School",
        "converted_to_lead": False, "is_deleted": False,
    })


def test_convert_falls_back_to_contacts_school_when_body_omits_it(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_contact(db)
        lead = await crm.convert_contact_to_lead("c1", FakeRequest({}))
        assert lead["school_id"] == "s_dps"
    _run(go())


def test_convert_falls_back_when_body_sends_school_id_as_empty_string(db, monkeypatch):
    # Mirrors the actual School Profile Convert button payload shape closely
    # enough, and also covers a body that explicitly sends '' rather than
    # omitting the key.
    _as(REP, monkeypatch)

    async def go():
        await _seed_contact(db)
        lead = await crm.convert_contact_to_lead("c1", FakeRequest({"school_id": ""}))
        assert lead["school_id"] == "s_dps"
    _run(go())


def test_explicit_body_school_id_still_wins(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_contact(db)
        await db.schools.insert_one({
            "school_id": "s_other", "school_name": "Other School",
            "assigned_to": "", "is_deleted": False,
        })
        lead = await crm.convert_contact_to_lead("c1", FakeRequest({"school_id": "s_other"}))
        assert lead["school_id"] == "s_other"
    _run(go())


def test_contact_with_no_school_id_produces_a_lead_with_no_school(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await db.contacts.insert_one({
            "contact_id": "c2", "name": "No School", "phone": "9800000000",
            "converted_to_lead": False, "is_deleted": False,
        })
        lead = await crm.convert_contact_to_lead("c2", FakeRequest({}))
        assert lead["school_id"] == ""
    _run(go())
