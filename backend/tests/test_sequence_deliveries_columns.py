"""D: the deliveries drill-down must name the PERSON, not just the school."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.drip_routes as drip
import rbac

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
    monkeypatch.setattr(drip, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(drip, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "Principal Pitch",
        "steps": [{"step_number": 1, "delay_days": 0, "message_type": "physical_material",
                   "material_type": "catalogue", "material_name": "2026 Catalogue"}]})
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                 "assigned_to": "parul@smartshape.in"})
    await db.leads.insert_one({"lead_id": "l1", "school_id": "s1", "contact_name": "R Sharma",
                               "company_name": "DPS", "assigned_to": "parul@smartshape.in"})
    await db.contacts.insert_one({"contact_id": "c2", "name": "A Menon", "school_id": "s1",
                                  "company": "DPS", "assigned_to": "bde@smartshape.in"})
    await db.drip_enrollments.insert_many([
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "status": "active",
         "enrolled_at": "2026-09-10T00:00:00+00:00", "current_step": 0},
        {"enrollment_id": "e2", "sequence_id": "seq1", "contact_id": "c2", "status": "active",
         "enrolled_at": "2026-09-10T00:00:00+00:00", "current_step": 0},
    ])


def test_every_row_names_the_person_and_the_owner(db):
    async def go():
        await _seed(db)
        out = await drip.sequence_deliveries("seq1", FakeRequest())
        by = {r["enrollment_id"]: r for r in out["rows"]}
        assert by["e1"]["recipient_name"] == "R Sharma"
        assert by["e1"]["recipient_kind"] == "lead"
        assert by["e1"]["owner"] == "parul@smartshape.in"
        assert by["e2"]["recipient_name"] == "A Menon"
        assert by["e2"]["recipient_kind"] == "contact"
        assert by["e2"]["owner"] == "bde@smartshape.in"
    _run(go())


def test_the_owner_filter_narrows_the_rows(db):
    async def go():
        await _seed(db)
        out = await drip.sequence_deliveries(
            "seq1", FakeRequest(params={"owner": "bde@smartshape.in"}))
        assert [r["enrollment_id"] for r in out["rows"]] == ["e2"]
    _run(go())


def test_the_owner_filter_composes_with_the_others(db):
    async def go():
        await _seed(db)
        out = await drip.sequence_deliveries(
            "seq1", FakeRequest(params={"owner": "bde@smartshape.in", "channel": "whatsapp"}))
        assert out["rows"] == [], "the only step is a post step, so nothing matches"
    _run(go())
